//! Diff viewer 起動時の初期 hydrate spawn (#224 split)。
//!
//! `run_diff_viewer` から PR snapshot / PR list / linked issues を並列取得する
//! 初期 hydrate ブロックを移送した。snapshot と list を別世代で管理することで、
//! 起動 hydrate 中に user が filter を切り替えても snapshot 結果が破棄されない
//! 性質はそのまま保つ。terminal 起動 / window close timer / セッション周期保存
//! は composition root (main.rs) 側に残す。

use std::cell::RefCell;
use std::rc::Rc;
use std::sync::Arc;
use std::time::Instant;

use slint::ComponentHandle;

use super::linked_issues::fetch_linked_issues_parallel;
use super::refresh::{refresh_draft_panel, refresh_preview, refresh_toasts};
use super::snapshot::{apply_snapshot_to_ui, build_pr_list_model};
use super::state::{DiffAppState, ToastKind, with_app_state};
use super::toast::{schedule_toast_auto_dismiss, show_toast};

use crate::github::issue_context::extract_linked_issue_numbers;
use crate::github::pull_request::{PrListFilter, fetch_pr_snapshot, fetch_pull_requests};
use crate::{DiffViewerWindow, i18n, session};

/// 起動時の hydrate を tokio runtime に spawn する。
///
/// PR snapshot と PR list を `tokio::join!` で並列実行し、list は snapshot
/// 完了を待たずに先に UI へ流し込む。snapshot 取得後に linked issues を
/// 並列 fetch し、最後に `apply_snapshot_to_ui` と per-PR session 復元
/// (#231) を行う。世代カウンタは spawn 前に進めて capture し、UI 反映時に
/// stale 判定する。
pub(crate) fn spawn_initial_hydrate(
    ui: &DiffViewerWindow,
    state: &Rc<RefCell<DiffAppState>>,
    runtime_handle: &tokio::runtime::Handle,
    client: Arc<octocrab::Octocrab>,
    owner: &str,
    repo: &str,
    pr_number: u64,
) {
    let (snap_gen, list_gen) = {
        let mut st = state.borrow_mut();
        (st.next_snapshot_generation(), st.next_list_generation())
    };
    let owner_clone = owner.to_string();
    let repo_clone = repo.to_string();
    let client_clone = client;
    let weak_for_task = ui.as_weak();
    runtime_handle.spawn(async move {
        let hydrate_started = Instant::now();
        // PR snapshot と PR list を join! で並列実行
        let snapshot_fut =
            fetch_pr_snapshot(&client_clone, &owner_clone, &repo_clone, pr_number);
        let list_fut =
            fetch_pull_requests(&client_clone, &owner_clone, &repo_clone, PrListFilter::Open);
        let join_started = Instant::now();
        let (snapshot_res, list_res) = tokio::join!(snapshot_fut, list_fut);
        let join_elapsed_ms = join_started.elapsed().as_millis() as u64;

        // PR list は snapshot 完了を待たずに先に hydrate する
        {
            let weak = weak_for_task.clone();
            let list_count = match &list_res {
                Ok(summaries) => summaries.len(),
                Err(_) => 0,
            };
            let snapshot_file_count = match &snapshot_res {
                Ok(s) => s.files.len(),
                Err(_) => 0,
            };
            tracing::debug!(
                pr = pr_number,
                list_count,
                snapshot_file_count,
                snapshot_ok = snapshot_res.is_ok(),
                list_ok = list_res.is_ok(),
                elapsed_ms = join_elapsed_ms,
                "initial hydrate snapshot+list fetched"
            );
            let _ = slint::invoke_from_event_loop(move || {
                let stale = with_app_state(|state| state.borrow().is_stale_list(list_gen))
                    .unwrap_or(true);
                if stale {
                    return;
                }
                let Some(ui) = weak.upgrade() else { return };
                ui.set_pr_list_loading(false);
                match list_res {
                    Ok(summaries) => {
                        ui.set_pr_list(build_pr_list_model(&summaries));
                    }
                    Err(e) => {
                        show_toast(
                            ToastKind::Error,
                            i18n::tr("Failed to load PR list"),
                            e.to_string(),
                        );
                    }
                }
            });
        }

        let snapshot = match snapshot_res {
            Ok(s) => s,
            Err(e) => {
                tracing::warn!(error = %e, "initial hydrate snapshot failed");
                let err_str = e.to_string();
                let weak = weak_for_task.clone();
                let pr_str = pr_number.to_string();
                let _ = slint::invoke_from_event_loop(move || {
                    let Some(ui) = weak.upgrade() else { return };
                    with_app_state(|state| {
                        let id = state.borrow_mut().push_toast(
                            ToastKind::Error,
                            i18n::tr_args("Failed to load PR #{}", &[pr_str.as_str()]),
                            err_str.clone(),
                        );
                        refresh_toasts(&ui, state);
                        schedule_toast_auto_dismiss(id);
                    });
                });
                return;
            }
        };
        // linked issues を並列 fetch
        let body = snapshot.body.clone().unwrap_or_default();
        let numbers = extract_linked_issue_numbers(&body);
        let linked_started = Instant::now();
        let linked =
            fetch_linked_issues_parallel(&client_clone, &owner_clone, &repo_clone, &numbers)
                .await;
        tracing::debug!(
            pr = pr_number,
            file_count = snapshot.files.len(),
            linked_count = linked.len(),
            linked_elapsed_ms = linked_started.elapsed().as_millis() as u64,
            elapsed_ms = hydrate_started.elapsed().as_millis() as u64,
            "initial hydrate completed"
        );

        let _ = slint::invoke_from_event_loop(move || {
            let stale = with_app_state(|state| state.borrow().is_stale_snapshot(snap_gen))
                .unwrap_or(true);
            if stale {
                return;
            }
            let Some(ui) = weak_for_task.upgrade() else {
                return;
            };
            apply_snapshot_to_ui(&ui, &snapshot, &linked);
            with_app_state(|state| {
                let mut st = state.borrow_mut();
                st.snapshot = snapshot;
                // snapshot 切替で旧 file index の scroll cache を引きずらない
                st.scroll_positions.clear();

                // #231 per-PR 復元: session.json に保存されていた draft /
                // selected_file_index を読み戻す。snapshot は再取得した
                // ばかりなので anchor の file_id / line がずれていてもまずは
                // そのまま復元する (format_prompt 側で snippet が取れない
                // ものは最良 effort で出る)。
                let key = session::SessionState::pr_key(&owner_clone, &repo_clone, pr_number);
                if let Some(saved) = session::load()
                    && let Some(per_pr) = saved.per_pr.get(&key)
                {
                    for entry in &per_pr.draft {
                        st.draft.push(entry.clone());
                    }
                    if let Some(idx) = per_pr.selected_file_index
                        && (idx as usize) < st.snapshot.files.len()
                    {
                        ui.set_selected_file_index(idx);
                    }
                }
            });
            if let Some(ui) = weak_for_task.upgrade() {
                with_app_state(|state| {
                    refresh_draft_panel(&ui, state);
                    refresh_preview(&ui, state);
                });
            }
        });
    });
}
