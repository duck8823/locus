//! Diff viewer モードの Slint コールバック配線 (#224 split)。
//!
//! `run_diff_viewer` から inline callback closure を移送し、main.rs を
//! composition root に近づける。toast 解除・diff scroll 診断・選択/draft 系・
//! ファイル切替・送信系・PR クリック・PR フィルタを一括で配線する。
//! 動作は移送前と等価で、初期 hydrate / セッションタイマー / window
//! close 要求は main.rs に残す。

use std::cell::RefCell;
use std::rc::Rc;
use std::time::Instant;

use slint::{ComponentHandle, SharedString};

use super::linked_issues::fetch_linked_issues_parallel;
use super::refresh::{
    append_history, refresh_current_anchor_label, refresh_draft_panel, refresh_history_panel,
    refresh_preview, refresh_toasts,
};
use super::session::save_pr_session;
use super::snapshot::{apply_snapshot_to_ui, build_pr_list_model};
use super::state::{DiffAppState, ToastKind, with_app_state};
use super::toast::{schedule_toast_auto_dismiss, show_toast};

use crate::github::issue_context::extract_linked_issue_numbers;
use crate::github::pull_request::{PrListFilter, fetch_pr_snapshot, fetch_pull_requests};
use crate::review::draft::{DraftEntry, SendMode};
use crate::review::selection::{Granularity, SelectionAnchor};
use crate::review::snapshot::FileId;
use crate::ui_state::draft_view::side_from_line_kind;
use crate::{DiffViewerWindow, i18n, session, terminal};

use super::util::resolve_line_number;

/// `LOCUS_DIAG_TRACE_RENDER_TICKS` が真を示す値かを判定する。diff scroll
/// 診断 callback が毎 frame log を出すと output が膨れるため opt-in する。
fn diag_trace_ui_events_enabled() -> bool {
    std::env::var("LOCUS_DIAG_TRACE_RENDER_TICKS")
        .map(|v| matches!(v.to_ascii_lowercase().as_str(), "true" | "1" | "on" | "yes"))
        .unwrap_or(false)
}

/// Diff viewer の Slint コールバックをまとめて配線する。
///
/// 配線対象:
/// - `dismiss_toast`
/// - `diff_scroll_diagnostic`
/// - `select_line` / `select_hunk` / `select_whole_file` / `extend_to_range`
/// - `add_to_draft` / `remove_draft_entry` / `clear_current_selection`
/// - `file_switched` / `file_switch_requested`
/// - `refresh_preview`
/// - `send_insert_only` / `send_insert_and_send` / `send_copy_to_clipboard`
/// - `pr_clicked`
/// - `pr_filter_changed`
///
/// `terminal_pane` は agent 起動失敗時に `None` になり得るため Option を取る。
/// `owner` / `repo` は per-PR session 保存と PR 切替時のクロージャ capture に
/// 必要なため、各 closure 用に都度 clone する。
pub(crate) fn wire_diff_viewer_callbacks(
    ui: &DiffViewerWindow,
    state: &Rc<RefCell<DiffAppState>>,
    terminal_pane: Option<Rc<terminal::TerminalPane>>,
    owner: &str,
    repo: &str,
) {
    // dismiss-toast コールバック
    {
        let state = state.clone();
        let ui_weak = ui.as_weak();
        ui.on_dismiss_toast(move |id: i32| {
            let Some(ui) = ui_weak.upgrade() else { return };
            state.borrow_mut().dismiss_toast(id);
            refresh_toasts(&ui, &state);
        });
    }

    {
        let trace_diff_scroll_events = diag_trace_ui_events_enabled();
        ui.on_diff_scroll_diagnostic(move |delta_x, delta_y| {
            if trace_diff_scroll_events {
                tracing::debug!(delta_x, delta_y, "diff scroll event");
            }
        });
    }

    // select-line
    {
        let state = state.clone();
        let ui_weak = ui.as_weak();
        ui.on_select_line(move |file_index, line_kind, old_no_str, new_no_str| {
            let Some(ui) = ui_weak.upgrade() else { return };
            let line = resolve_line_number(line_kind, &old_no_str, &new_no_str);
            let side = side_from_line_kind(line_kind);
            let mut st = state.borrow_mut();
            let Some(file) = st.file(file_index as usize).cloned() else {
                return;
            };
            let file_id = FileId::new(file.file_path.clone());
            if st.pending_range {
                // 現在の anchor と同じ file か 判定
                let same_file = st
                    .current_anchor
                    .as_ref()
                    .map(|a| a.file_id == file_id)
                    .unwrap_or(false);
                if same_file {
                    st.complete_range(&file_id, line, side);
                } else {
                    // 別 file をクリックしたので pending を解除して Line 選択に切り替える
                    st.pending_range = false;
                    st.set_anchor(SelectionAnchor {
                        file_id,
                        file_path: file.file_path,
                        granularity: Granularity::Line { line, side },
                    });
                }
            } else {
                st.set_anchor(SelectionAnchor {
                    file_id,
                    file_path: file.file_path,
                    granularity: Granularity::Line { line, side },
                });
            }
            drop(st);
            refresh_current_anchor_label(&ui, &state);
        });
    }

    // select-hunk
    {
        let state = state.clone();
        let ui_weak = ui.as_weak();
        ui.on_select_hunk(move |file_index, hunk_index| {
            let Some(ui) = ui_weak.upgrade() else { return };
            let mut st = state.borrow_mut();
            let Some(file) = st.file(file_index as usize).cloned() else {
                return;
            };
            st.set_anchor(SelectionAnchor {
                file_id: FileId::new(file.file_path.clone()),
                file_path: file.file_path,
                granularity: Granularity::Hunk {
                    hunk_index: hunk_index as usize,
                },
            });
            drop(st);
            refresh_current_anchor_label(&ui, &state);
        });
    }

    // select-whole-file
    {
        let state = state.clone();
        let ui_weak = ui.as_weak();
        ui.on_select_whole_file(move || {
            let Some(ui) = ui_weak.upgrade() else { return };
            let file_index = ui.get_selected_file_index() as usize;
            let mut st = state.borrow_mut();
            let Some(file) = st.file(file_index).cloned() else {
                return;
            };
            st.set_anchor(SelectionAnchor {
                file_id: FileId::new(file.file_path.clone()),
                file_path: file.file_path,
                granularity: Granularity::File,
            });
            drop(st);
            refresh_current_anchor_label(&ui, &state);
        });
    }

    // extend-to-range
    {
        let state = state.clone();
        let ui_weak = ui.as_weak();
        ui.on_extend_to_range(move || {
            let Some(ui) = ui_weak.upgrade() else { return };
            state.borrow_mut().start_range_mode();
            refresh_current_anchor_label(&ui, &state);
        });
    }

    // add-to-draft
    {
        let state = state.clone();
        let ui_weak = ui.as_weak();
        let owner = owner.to_string();
        let repo = repo.to_string();
        ui.on_add_to_draft(move |note: SharedString| {
            let Some(ui) = ui_weak.upgrade() else { return };
            let mut st = state.borrow_mut();
            let Some(anchor) = st.current_anchor.clone() else {
                return;
            };
            let note_trimmed = note.trim();
            let note_opt = if note_trimmed.is_empty() {
                None
            } else {
                Some(note_trimmed.to_string())
            };
            st.draft.push(DraftEntry::new(anchor, note_opt));
            // ドラフトが変わったので per-PR session を更新する (#231)
            save_pr_session(&owner, &repo, &st, &ui);
            drop(st);
            refresh_draft_panel(&ui, &state);
        });
    }

    // remove-draft-entry
    {
        let state = state.clone();
        let ui_weak = ui.as_weak();
        let owner = owner.to_string();
        let repo = repo.to_string();
        ui.on_remove_draft_entry(move |index: i32| {
            let Some(ui) = ui_weak.upgrade() else { return };
            let mut st = state.borrow_mut();
            st.draft.remove(index as usize);
            save_pr_session(&owner, &repo, &st, &ui);
            drop(st);
            refresh_draft_panel(&ui, &state);
        });
    }

    // clear-current-selection
    {
        let state = state.clone();
        let ui_weak = ui.as_weak();
        ui.on_clear_current_selection(move || {
            let Some(ui) = ui_weak.upgrade() else { return };
            let mut st = state.borrow_mut();
            st.current_anchor = None;
            st.pending_range = false;
            drop(st);
            refresh_current_anchor_label(&ui, &state);
        });
    }

    // file-switched: pending_range を解除する
    {
        let state = state.clone();
        let ui_weak = ui.as_weak();
        ui.on_file_switched(move |_| {
            let Some(ui) = ui_weak.upgrade() else { return };
            state.borrow_mut().cancel_range_on_file_switch();
            refresh_current_anchor_label(&ui, &state);
        });
    }

    // file-switch-requested (#230): file row click から呼ばれる。
    // 現在の diff-scroll-y を 旧 file index で保存し、selected-file-index を
    // 切り替えた後に新 index に対する保存値を復元する。さらに #231 の per-PR
    // 永続化として selected_file_index を session.json にも反映する。
    {
        let state = state.clone();
        let ui_weak = ui.as_weak();
        let owner = owner.to_string();
        let repo = repo.to_string();
        ui.on_file_switch_requested(move |new_idx| {
            let Some(ui) = ui_weak.upgrade() else { return };
            let started = Instant::now();
            let old_idx = ui.get_selected_file_index() as usize;
            let cur_scroll = ui.get_diff_scroll_y();
            state
                .borrow_mut()
                .scroll_positions
                .insert(old_idx, cur_scroll);

            ui.set_selected_file_index(new_idx);

            let restore = state
                .borrow()
                .scroll_positions
                .get(&(new_idx as usize))
                .copied()
                .unwrap_or(0.0);
            ui.set_diff_scroll_y(restore);

            // per-PR session に selected_file_index を反映
            save_pr_session(&owner, &repo, &state.borrow(), &ui);

            ui.invoke_file_switched(new_idx);
            tracing::debug!(
                old_idx,
                new_idx,
                saved_scroll = cur_scroll,
                restored_scroll = restore,
                elapsed_ms = started.elapsed().as_millis() as u64,
                "file switch requested"
            );
        });
    }

    // refresh-preview
    {
        let state = state.clone();
        let ui_weak = ui.as_weak();
        ui.on_refresh_preview(move || {
            let Some(ui) = ui_weak.upgrade() else { return };
            refresh_preview(&ui, &state);
        });
    }

    // send-insert-only
    {
        let state = state.clone();
        let ui_weak = ui.as_weak();
        let pane = terminal_pane.clone();
        ui.on_send_insert_only(move |text: SharedString| {
            let Some(ui) = ui_weak.upgrade() else { return };
            // terminal pane が無い場合は何もしない（UI 側で button も無効化
            // されているが保険として弾く）。
            let Some(p) = pane.as_ref() else {
                return;
            };
            p.insert(text.as_str());
            append_history(&state, SendMode::InsertOnly, text.as_str());
            refresh_history_panel(&ui, &state);
        });
    }

    // send-insert-and-send
    {
        let state = state.clone();
        let ui_weak = ui.as_weak();
        let pane = terminal_pane.clone();
        ui.on_send_insert_and_send(move |text: SharedString| {
            let Some(ui) = ui_weak.upgrade() else { return };
            let Some(p) = pane.as_ref() else {
                return;
            };
            p.insert_and_send(text.as_str());
            append_history(&state, SendMode::InsertAndSend, text.as_str());
            refresh_history_panel(&ui, &state);
        });
    }

    // send-copy-to-clipboard
    {
        let state = state.clone();
        let ui_weak = ui.as_weak();
        ui.on_send_copy_to_clipboard(move |text: SharedString| {
            let Some(ui) = ui_weak.upgrade() else { return };
            if let Ok(mut cb) = arboard::Clipboard::new() {
                let _ = cb.set_text(text.to_string());
            }
            append_history(&state, SendMode::CopyToClipboard, text.as_str());
            refresh_history_panel(&ui, &state);
        });
    }

    // pr-clicked: 別 PR に切り替える（draft はクリア）
    //
    // UI スレッドをブロックしないように、network 部分は tokio に spawn し、
    // 完了したら invoke_from_event_loop で UI スレッドに戻ってモデルを
    // 更新する。state (Rc<RefCell<>>) は Send ではないので spawn 内では
    // 触らず、完了後の closure 内でだけ触る。
    //
    // 高速に PR を切り替えた場合に古い応答が新しい応答を上書きしないよう、
    // task 開始時の世代を capture し、UI 更新前に現在の世代と照合する。
    {
        let state = state.clone();
        let ui_weak = ui.as_weak();
        ui.on_pr_clicked(move |new_pr_number: i32| {
            let Some(ui) = ui_weak.upgrade() else { return };
            let new_number = new_pr_number as u64;
            let (owner, repo, client_opt, runtime_opt, snap_gen) = {
                let mut st = state.borrow_mut();
                (
                    st.owner.clone(),
                    st.repo.clone(),
                    st.client.clone(),
                    st.runtime.clone(),
                    st.next_snapshot_generation(),
                )
            };
            let (Some(client), Some(runtime)) = (client_opt, runtime_opt) else {
                return;
            };
            let weak_for_task = ui.as_weak();
            runtime.spawn(async move {
                let started = Instant::now();
                let snapshot_started = Instant::now();
                let snapshot_res = fetch_pr_snapshot(&client, &owner, &repo, new_number).await;
                let snapshot_elapsed_ms = snapshot_started.elapsed().as_millis() as u64;
                let snapshot = match snapshot_res {
                    Ok(s) => s,
                    Err(e) => {
                        tracing::warn!(pr = new_number, error = %e, "failed to fetch PR");
                        let err_str = e.to_string();
                        let weak = weak_for_task.clone();
                        let _ = slint::invoke_from_event_loop(move || {
                            let Some(ui) = weak.upgrade() else { return };
                            with_app_state(|state| {
                                let id = state.borrow_mut().push_toast(
                                    ToastKind::Error,
                                    i18n::tr_args(
                                        "Failed to fetch PR #{}",
                                        &[new_number.to_string().as_str()],
                                    ),
                                    err_str.clone(),
                                );
                                refresh_toasts(&ui, state);
                                schedule_toast_auto_dismiss(id);
                            });
                        });
                        return;
                    }
                };
                // linked issues は join_all で並列 fetch
                let body = snapshot.body.clone().unwrap_or_default();
                let numbers = extract_linked_issue_numbers(&body);
                let linked_started = Instant::now();
                let linked = fetch_linked_issues_parallel(&client, &owner, &repo, &numbers).await;
                let linked_elapsed_ms = linked_started.elapsed().as_millis() as u64;
                let file_count = snapshot.files.len();
                let linked_count = linked.len();
                tracing::debug!(
                    pr = new_number,
                    file_count,
                    linked_count,
                    snapshot_elapsed_ms,
                    linked_elapsed_ms,
                    elapsed_ms = started.elapsed().as_millis() as u64,
                    "pr switch fetch completed"
                );
                let _ = slint::invoke_from_event_loop(move || {
                    let Some(ui) = weak_for_task.upgrade() else {
                        return;
                    };
                    let stale = with_app_state(|state| state.borrow().is_stale_snapshot(snap_gen))
                        .unwrap_or(true);
                    if stale {
                        return;
                    }
                    apply_snapshot_to_ui(&ui, &snapshot, &linked);
                    ui.set_current_pr_number(new_pr_number);
                    with_app_state(|state| {
                        {
                            let mut st = state.borrow_mut();
                            st.snapshot = snapshot;
                            st.draft.clear();
                            st.current_anchor = None;
                            st.pending_range = false;
                            // snapshot 切替で旧 PR の scroll cache を引きずらない (#230)
                            st.scroll_positions.clear();

                            // #231 PR 切替後の per-PR draft / file index 復元
                            let key =
                                session::SessionState::pr_key(&owner, &repo, new_pr_number as u64);
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
                        }
                        refresh_current_anchor_label(&ui, state);
                        refresh_draft_panel(&ui, state);
                        refresh_preview(&ui, state);
                    });
                });
            });
        });
    }

    // pr-filter-changed: 一覧を再取得（UI ブロックなし）
    {
        let state = state.clone();
        let ui_weak = ui.as_weak();
        ui.on_pr_filter_changed(move |filter_int: i32| {
            let Some(ui) = ui_weak.upgrade() else { return };
            let filter = match filter_int {
                0 => PrListFilter::Open,
                1 => PrListFilter::Closed,
                _ => PrListFilter::All,
            };
            let (owner, repo, client_opt, runtime_opt, list_gen) = {
                let mut st = state.borrow_mut();
                (
                    st.owner.clone(),
                    st.repo.clone(),
                    st.client.clone(),
                    st.runtime.clone(),
                    st.next_list_generation(),
                )
            };
            let (Some(client), Some(runtime)) = (client_opt, runtime_opt) else {
                return;
            };
            ui.set_pr_list_loading(true);
            let weak_for_task = ui.as_weak();
            runtime.spawn(async move {
                let result = fetch_pull_requests(&client, &owner, &repo, filter).await;
                let _ = slint::invoke_from_event_loop(move || {
                    let stale = with_app_state(|state| state.borrow().is_stale_list(list_gen))
                        .unwrap_or(true);
                    if stale {
                        return;
                    }
                    let Some(ui) = weak_for_task.upgrade() else {
                        return;
                    };
                    ui.set_pr_list_loading(false);
                    match result {
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
            });
        });
    }
}
