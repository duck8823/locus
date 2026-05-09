//! locus composition root.
//!
//! 起動モードは argv で切り替える:
//!
//! - `cargo run` / `cargo run -- <command>` — Terminal ペインモード
//! - `cargo run -- github <owner>/<repo>#<pr_number>` — Diff viewer モード

use std::cell::RefCell;
use std::rc::Rc;

use slint::{ComponentHandle, SharedString};

slint::include_modules!();

mod app;
mod config;
mod github;
mod i18n;
mod review;
mod semantic;
mod session;
mod terminal;
mod ui_state;

use app::diff_viewer::snapshot::{
    apply_snapshot_to_ui, build_pr_list_model, LinkedIssueDisplay,
};
use app::diff_viewer::refresh::{
    append_history, refresh_current_anchor_label, refresh_draft_panel, refresh_history_panel,
    refresh_preview, refresh_toasts,
};
use app::diff_viewer::state::{set_app_state, with_app_state, DiffAppState, ToastKind};
use app::diff_viewer::toast::{schedule_toast_auto_dismiss, set_active_window, show_toast};
use app::diff_viewer::util::resolve_line_number;

use github::issue_context::{
    extract_linked_issue_numbers, fetch_issue_context_async,
};
use github::pull_request::{
    build_client, fetch_pr_snapshot, fetch_pull_requests, parse_pr_spec, PrListFilter,
    PullRequestSnapshot,
};
use review::draft::{DraftEntry, PromptDraft, SendMode};
#[cfg(test)]
use review::selection::Side;
use review::selection::{Granularity, SelectionAnchor};
use review::snapshot::FileId;
use ui_state::draft_view::side_from_line_kind;

fn main() -> Result<(), Box<dyn std::error::Error>> {
    // tracing-subscriber を最初に初期化する。LOCUS_LOG=debug 等で詳細
    // レベルを上げられる。設定なしでは warn 以上のみ stderr に出る。
    init_logging();
    // i18n を初期化する。LANG が未設定なら locus 既定の ja に揃える。
    let _ = i18n::init_from_env();

    let args: Vec<String> = std::env::args().skip(1).collect();

    match args.as_slice() {
        [mode, spec] if mode == "github" => run_diff_viewer(spec),
        [command] => run_terminal(command),
        [] => {
            // terminal-only モードでも LOCUS_AGENT_CMD を尊重する。diff viewer
            // 側と挙動を揃えることで README に書ける起動形を一貫させる。
            let cmd = std::env::var("LOCUS_AGENT_CMD")
                .unwrap_or_else(|_| "claude".to_string());
            run_terminal(&cmd)
        }
        _ => {
            eprintln!("Usage:");
            eprintln!("  locus                          # terminal pane (LOCUS_AGENT_CMD or claude)");
            eprintln!("  locus <command>                # terminal pane (custom cmd, overrides env)");
            eprintln!("  locus github <owner>/<repo>#<pr_number>");
            std::process::exit(2);
        }
    }
}

/// `LOCUS_LOG` 環境変数 (`error` / `warn` / `info` / `debug` / `trace`)
/// を tracing-subscriber の EnvFilter に流し込む。未設定時は `warn`。
fn init_logging() {
    use tracing_subscriber::EnvFilter;
    let filter = EnvFilter::try_from_env("LOCUS_LOG")
        .unwrap_or_else(|_| EnvFilter::new("warn"));
    let _ = tracing_subscriber::fmt()
        .with_env_filter(filter)
        .with_writer(std::io::stderr)
        .try_init();
}

fn run_terminal(command: &str) -> Result<(), Box<dyn std::error::Error>> {
    let ui_cfg = config::UiConfig::from_env();
    let ui = AppWindow::new()?;
    ui.set_font_family(SharedString::from(ui_cfg.terminal_font_family.as_str()));
    ui.set_font_size(ui_cfg.terminal_font_size);
    ui.set_cell_w(ui_cfg.terminal_cell_w());
    ui.set_cell_h(ui_cfg.terminal_cell_h());
    tracing::debug!(
        terminal_font_family = %ui_cfg.terminal_font_family,
        terminal_font_size = ui_cfg.terminal_font_size,
        terminal_cell_w = ui_cfg.terminal_cell_w(),
        terminal_cell_h = ui_cfg.terminal_cell_h(),
        "terminal typography configured"
    );
    let pane = Rc::new(terminal::launch(&ui, command, ui_cfg.bracketed_paste)?);
    {
        let pane = pane.clone();
        let ui_weak = ui.as_weak();
        let ui_cfg = ui_cfg.clone();
        ui.on_resized(move |w_logical: f32, h_logical: f32| {
            let Some(ui) = ui_weak.upgrade() else {
                return;
            };
            // 初期 layout settling や hidden 中の transient 0x0 では PTY を縮めない。
            // measured-* も layout 確定前は 0 になるので両条件で skip する。
            if w_logical <= 0.0 || h_logical <= 0.0 {
                return;
            }
            let cell_w = ui_cfg.terminal_cell_w_from_measurement(ui.get_measured_cell_w());
            let cell_h = ui_cfg.terminal_cell_h_from_measurement(ui.get_measured_cell_h());
            ui.set_cell_w(cell_w);
            ui.set_cell_h(cell_h);
            let (cols, rows) = terminal::compute_grid_size(w_logical, h_logical, cell_w, cell_h);
            match pane.resize(cols, rows) {
                Ok(()) => {
                    let (cols_now, rows_now) = pane.current_size();
                    ui.set_cols(cols_now as i32);
                    ui.set_visible_rows(rows_now as i32);
                }
                Err(e) => {
                    tracing::warn!(%cols, %rows, error = %e, "terminal resize failed");
                }
            }
        });
    }
    ui.run()?;
    drop(pane);
    Ok(())
}

fn run_diff_viewer(spec: &str) -> Result<(), Box<dyn std::error::Error>> {
    let (owner, repo, pr_number) = parse_pr_spec(spec)
        .ok_or_else(|| format!("invalid PR spec: {spec} (expected owner/repo#N)"))?;

    let runtime = tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .build()?;
    let runtime_handle = runtime.handle().clone();

    // 起動を「ネットワーク待ち」にしないため、最初に空の DiffViewerWindow を
    // 作って表示し、PR snapshot / PR list / linked issues は非同期 hydrate
    // する。GitHub クライアントの初期化失敗のみ即時エラーで abort。
    //
    // octocrab::Octocrab::builder().build() は内部で tower buffer service を
    // spawn するため、tokio runtime context 内で呼ぶ必要がある。enter() の
    // guard を持っている間だけが runtime context として認識される。
    let client_arc = {
        let _guard = runtime_handle.enter();
        build_client()?
    };

    let placeholder_snapshot = PullRequestSnapshot {
        target: review::target::ReviewTarget::GitHubPr {
            owner: owner.clone(),
            repo: repo.clone(),
            pr_number,
        },
        title: i18n::tr("(loading…)"),
        body: None,
        head_sha: String::new(),
        base_sha: String::new(),
        files: Vec::new(),
    };

    let ui_cfg = config::UiConfig::from_env();
    let ui = DiffViewerWindow::new()?;
    ui.set_font_family(SharedString::from(ui_cfg.font_family.as_str()));
    ui.set_terminal_font_family(SharedString::from(ui_cfg.terminal_font_family.as_str()));
    ui.set_terminal_font_size(ui_cfg.terminal_font_size);
    ui.set_diff_font_size(ui_cfg.diff_font_size);
    ui.set_terminal_cell_w(ui_cfg.terminal_cell_w());
    ui.set_terminal_cell_h(ui_cfg.terminal_cell_h());
    ui.set_preview_max_chars(ui_cfg.prompt_max_chars.min(i32::MAX as usize) as i32);
    ui.set_require_send_confirm(ui_cfg.confirm_send);
    tracing::debug!(
        font_family = %ui_cfg.font_family,
        terminal_font_family = %ui_cfg.terminal_font_family,
        terminal_font_size = ui_cfg.terminal_font_size,
        terminal_cell_w = ui_cfg.terminal_cell_w(),
        terminal_cell_h = ui_cfg.terminal_cell_h(),
        "diff viewer typography configured"
    );

    // セッション復元 (#231): 前回保存した window size / position があれば適用する。
    if let Some(saved) = session::load() {
        if let (Some(w), Some(h)) = (saved.window_width, saved.window_height)
            && w > 0.0
            && h > 0.0
        {
            ui.window()
                .set_size(slint::WindowSize::Logical(slint::LogicalSize::new(w, h)));
        }
        if let (Some(x), Some(y)) = (saved.window_x, saved.window_y) {
            ui.window().set_position(slint::WindowPosition::Logical(
                slint::LogicalPosition::new(x, y),
            ));
        }
    }
    apply_snapshot_to_ui(&ui, &placeholder_snapshot, &[]);
    ui.set_current_pr_number(pr_number as i32);
    ui.set_pr_list(build_pr_list_model(&[]));
    ui.set_pr_list_filter(0);
    ui.set_pr_list_loading(true);

    let state = Rc::new(RefCell::new(DiffAppState {
        owner: owner.clone(),
        repo: repo.clone(),
        snapshot: placeholder_snapshot,
        draft: PromptDraft::new(),
        current_anchor: None,
        pending_range: false,
        history: Vec::new(),
        client: Some(client_arc.clone()),
        runtime: Some(runtime_handle.clone()),
        snapshot_generation: 0,
        list_generation: 0,
        toasts: Vec::new(),
        next_toast_id: 0,
        scroll_positions: std::collections::HashMap::new(),
    }));
    set_app_state(state.clone());
    set_active_window(&ui);

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

    // Terminal pane を立ち上げる。起動コマンドは LOCUS_AGENT_CMD 環境変数で
    // 上書きできる（既定は claude）。PATH に存在しなければ起動前に弾いて
    // toast でユーザーに知らせ、launch 自体は skip する。
    let agent_cmd =
        std::env::var("LOCUS_AGENT_CMD").unwrap_or_else(|_| "claude".to_string());
    let agent_resolution = which::which(&agent_cmd);
    let terminal_pane: Option<Rc<terminal::TerminalPane>> = match agent_resolution {
        Err(e) => {
            tracing::warn!(agent_cmd, error = %e, "agent command not found in PATH");
            ui.set_terminal_available(false);
            ui.set_terminal_status(SharedString::from(i18n::tr_args(
                "{}: not found in PATH",
                &[agent_cmd.as_str()],
            )));
            let id = state.borrow_mut().push_toast(
                ToastKind::Error,
                i18n::tr("Agent command not found"),
                i18n::tr_args(
                    "{}: not found in PATH (set LOCUS_AGENT_CMD)",
                    &[agent_cmd.as_str()],
                ),
            );
            refresh_toasts(&ui, &state);
            schedule_toast_auto_dismiss(id);
            None
        }
        Ok(_) => match terminal::launch_for_diff_viewer(&ui, &agent_cmd, ui_cfg.bracketed_paste) {
            Ok(p) => {
                ui.set_terminal_available(true);
                ui.set_terminal_status(SharedString::from(i18n::tr_args(
                    "{} (running)",
                    &[agent_cmd.as_str()],
                )));
                let pane_rc = Rc::new(p);
                wire_terminal_resize(&ui, pane_rc.clone(), &ui_cfg);
                Some(pane_rc)
            }
            Err(e) => {
                tracing::warn!(agent_cmd, error = %e, "failed to launch terminal pane (continuing without terminal)");
                ui.set_terminal_available(false);
                let err = e.to_string();
                ui.set_terminal_status(SharedString::from(i18n::tr_args(
                    "{}: failed to start ({})",
                    &[agent_cmd.as_str(), err.as_str()],
                )));
                let toast_id = state.borrow_mut().push_toast(
                    ToastKind::Error,
                    i18n::tr("Terminal pane failed to start"),
                    i18n::tr_args("{}: {}", &[agent_cmd.as_str(), err.as_str()]),
                );
                refresh_toasts(&ui, &state);
                schedule_toast_auto_dismiss(toast_id);
                None
            }
        },
    };

    refresh_current_anchor_label(&ui, &state);
    refresh_draft_panel(&ui, &state);
    refresh_history_panel(&ui, &state);
    refresh_preview(&ui, &state);

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
        let owner = owner.clone();
        let repo = repo.clone();
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
        let owner = owner.clone();
        let repo = repo.clone();
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
        let owner = owner.clone();
        let repo = repo.clone();
        ui.on_file_switch_requested(move |new_idx| {
            let Some(ui) = ui_weak.upgrade() else { return };
            let old_idx = ui.get_selected_file_index() as usize;
            let cur_scroll = ui.get_diff_scroll_y();
            state.borrow_mut().scroll_positions.insert(old_idx, cur_scroll);

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
                let snapshot_res =
                    fetch_pr_snapshot(&client, &owner, &repo, new_number).await;
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
                let linked = fetch_linked_issues_parallel(
                    &client, &owner, &repo, &numbers,
                )
                .await;
                let _ = slint::invoke_from_event_loop(move || {
                    let Some(ui) = weak_for_task.upgrade() else { return };
                    let stale = with_app_state(|state| {
                        state.borrow().is_stale_snapshot(snap_gen)
                    })
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
                            let key = session::SessionState::pr_key(
                                &owner,
                                &repo,
                                new_pr_number as u64,
                            );
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
                    let stale = with_app_state(|state| {
                        state.borrow().is_stale_list(list_gen)
                    })
                    .unwrap_or(true);
                    if stale {
                        return;
                    }
                    let Some(ui) = weak_for_task.upgrade() else { return };
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

    // 初期 hydrate: PR snapshot / PR list / linked issues を並列で取得し、
    // 完了後に UI を埋める。snapshot と list を別の世代で管理することで、
    // 起動 hydrate 中に user が filter を切り替えても snapshot 結果が
    // 破棄されない。
    {
        let (snap_gen, list_gen) = {
            let mut st = state.borrow_mut();
            (st.next_snapshot_generation(), st.next_list_generation())
        };
        let owner_clone = owner.clone();
        let repo_clone = repo.clone();
        let client_clone = client_arc.clone();
        let weak_for_task = ui.as_weak();
        runtime_handle.spawn(async move {
            // PR snapshot と PR list を join! で並列実行
            let snapshot_fut =
                fetch_pr_snapshot(&client_clone, &owner_clone, &repo_clone, pr_number);
            let list_fut = fetch_pull_requests(
                &client_clone,
                &owner_clone,
                &repo_clone,
                PrListFilter::Open,
            );
            let (snapshot_res, list_res) = tokio::join!(snapshot_fut, list_fut);

            // PR list は snapshot 完了を待たずに先に hydrate する
            {
                let weak = weak_for_task.clone();
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
                                i18n::tr_args(
                                    "Failed to load PR #{}",
                                    &[pr_str.as_str()],
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
            // linked issues を並列 fetch
            let body = snapshot.body.clone().unwrap_or_default();
            let numbers = extract_linked_issue_numbers(&body);
            let linked = fetch_linked_issues_parallel(
                &client_clone,
                &owner_clone,
                &repo_clone,
                &numbers,
            )
            .await;

            let _ = slint::invoke_from_event_loop(move || {
                let stale = with_app_state(|state| {
                    state.borrow().is_stale_snapshot(snap_gen)
                })
                .unwrap_or(true);
                if stale {
                    return;
                }
                let Some(ui) = weak_for_task.upgrade() else { return };
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
                    let key = session::SessionState::pr_key(
                        &owner_clone, &repo_clone, pr_number,
                    );
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

    // セッション保存 (#231):
    // - close 要求時 (X ボタン / 通常 close)
    // - terminal-resized callback 経由 (ウィンドウリサイズで間接的に発火)
    // の 2 経路で書き出す。Cmd+Q は Slint の on_close_requested を通らずに
    // process exit するため、resize 経由の保存が "ほぼリアルタイムの最新値"
    // を持っていればその時点の window size が次回起動で復元される。
    {
        let ui_weak = ui.as_weak();
        ui.window().on_close_requested(move || {
            if let Some(ui) = ui_weak.upgrade() {
                save_window_session(&ui);
            }
            slint::CloseRequestResponse::HideWindow
        });
    }

    // セッション位置の定期保存 (#231 Codex MUST 対応):
    // ウィンドウを移動しただけでは on_close_requested / on_terminal_resized
    // は発火せず position が stale になるため、1 秒周期で save_window_session
    // を呼ぶ。session::save() 側の LAST_SAVED キャッシュで実際の disk write は
    // 値が変化したときのみ。timer は drop されると停止するので、ui.run() の
    // ライフタイムで保持する。
    let position_save_timer = slint::Timer::default();
    {
        let ui_weak = ui.as_weak();
        position_save_timer.start(
            slint::TimerMode::Repeated,
            std::time::Duration::from_secs(1),
            move || {
                if let Some(ui) = ui_weak.upgrade() {
                    save_window_session(&ui);
                }
            },
        );
    }

    ui.run()?;
    drop(position_save_timer);
    drop(terminal_pane);
    Ok(())
}

/// Slint の `terminal-resized` callback を `TerminalPane::resize` に橋渡しする。
///
/// Slint 側は terminal-pane Rectangle の `width` / `height` の changed callback
/// から `terminal-resized(width, height)` を発火する。ここでは:
///
/// 1. UI から `measured-terminal-cell-w` / `measured-terminal-cell-h` を読み、
///    cell-w / cell-h プロパティに反映する（render と PTY の grid を一致させる）。
/// 2. (pane size / cell size) を floor して新しい cols / rows を算出する。
/// 3. `TerminalPane::resize` で PTY + alacritty Term + row model を再構成する。
fn wire_terminal_resize(
    ui: &DiffViewerWindow,
    pane: Rc<terminal::TerminalPane>,
    fallback: &config::UiConfig,
) {
    let ui_weak = ui.as_weak();
    let fallback = fallback.clone();
    ui.on_terminal_resized(move |w_logical: f32, h_logical: f32| {
        let Some(ui) = ui_weak.upgrade() else {
            return;
        };
        // 初期 layout settling や hidden 中の transient 0x0 では PTY を縮めない。
        // measured-* も layout 確定前は 0 になるので両条件で skip する。
        if w_logical <= 0.0 || h_logical <= 0.0 {
            return;
        }
        // 実 glyph metric が未測定 (= 0) の間は従来の比率近似を使う。
        // `LOCUS_TERMINAL_CELL_W/H` が指定されている場合は、実測値より
        // 手動 override を優先して grid と glyph のズレを切り分けられる。
        let cell_w = fallback.terminal_cell_w_from_measurement(ui.get_measured_terminal_cell_w());
        let cell_h = fallback.terminal_cell_h_from_measurement(ui.get_measured_terminal_cell_h());
        ui.set_terminal_cell_w(cell_w);
        ui.set_terminal_cell_h(cell_h);
        let (cols, rows) = terminal::compute_grid_size(w_logical, h_logical, cell_w, cell_h);
        match pane.resize(cols, rows) {
            Ok(()) => {
                let (cols_now, rows_now) = pane.current_size();
                ui.set_terminal_cols(cols_now as i32);
                ui.set_terminal_rows_count(rows_now as i32);
            }
            Err(e) => {
                tracing::warn!(%cols, %rows, error = %e, "terminal resize failed");
            }
        }
        // ウィンドウリサイズに連れて terminal-pane の width/height も変わる
        // ため、ここで session を保存しておくと Cmd+Q (close-requested を
        // 通らず process exit) でも最後の window size を残せる (#231 補強)。
        save_window_session(&ui);
    });
}

/// 現在のウィンドウサイズと位置を logical px にして session.json へ書き出す。
/// 既存の per_pr などは preserve したいので、session::mutate で部分更新する。
/// 失敗時は session::save 内部で warn ログのみ。
fn save_window_session(ui: &DiffViewerWindow) {
    let physical = ui.window().size();
    let pos = ui.window().position();
    let scale = ui.window().scale_factor().max(f32::EPSILON);
    session::mutate(|state| {
        state.window_width = Some(physical.width as f32 / scale);
        state.window_height = Some(physical.height as f32 / scale);
        state.window_x = Some(pos.x as f32 / scale);
        state.window_y = Some(pos.y as f32 / scale);
    });
}

/// PR 単位の draft / file index を session.json の per_pr table に書き出す。
///
/// PR 番号は UI の current-pr-number を読む (PR 切替後も正しい key に書く)。
/// owner/repo は同じ window の中では不変なので closure capture でよい。
fn save_pr_session(owner: &str, repo: &str, state: &DiffAppState, ui: &DiffViewerWindow) {
    let pr_number = ui.get_current_pr_number();
    if pr_number <= 0 {
        return;
    }
    let key = session::SessionState::pr_key(owner, repo, pr_number as u64);
    let pr_state = session::PerPrState {
        selected_file_index: Some(ui.get_selected_file_index()),
        draft: state.draft.entries().to_vec(),
    };
    session::mutate(|s| {
        s.per_pr.insert(key, pr_state);
    });
}

/// linked issue 番号一覧を受け取り、各 issue を tokio::spawn 系で並列 fetch
/// する。`octocrab::Octocrab` は内部で reqwest クライアントを共有しているので
/// 数件の concurrent 呼び出しは安全。
async fn fetch_linked_issues_parallel(
    client: &octocrab::Octocrab,
    owner: &str,
    repo: &str,
    numbers: &[u64],
) -> Vec<LinkedIssueDisplay> {
    use futures::stream::{FuturesUnordered, StreamExt};

    let mut futs: FuturesUnordered<_> = numbers
        .iter()
        .copied()
        .map(|n| {
            let client = client.clone();
            let owner = owner.to_string();
            let repo = repo.to_string();
            async move {
                let res = fetch_issue_context_async(&client, &owner, &repo, n).await;
                (n, res)
            }
        })
        .collect();

    let mut out: Vec<LinkedIssueDisplay> = Vec::new();
    let mut error_summary: Option<String> = None;
    let mut error_count: usize = 0;
    while let Some((n, res)) = futs.next().await {
        match res {
            Ok(Some(r)) => out.push(LinkedIssueDisplay::Found(r)),
            Ok(None) => {}
            Err(e) => {
                let message = e.to_string();
                if error_summary.is_none() {
                    error_summary = Some(format!("#{n}: {message}"));
                }
                error_count += 1;
                out.push(LinkedIssueDisplay::Failed {
                    number: n,
                    message,
                });
            }
        }
    }
    // 並列実行の完了順は不定なので number でソートして決定論的にする
    out.sort_by_key(|d| match d {
        LinkedIssueDisplay::Found(r) => r.number,
        LinkedIssueDisplay::Failed { number, .. } => *number,
    });

    // 1 件以上失敗していたら要約 toast を 1 つだけ出す。
    // (各 issue chip は別途 error 表示されるため、toast は重複させない)
    if let Some(first) = error_summary {
        let count_str = error_count.to_string();
        let _ = slint::invoke_from_event_loop(move || {
            show_toast(
                ToastKind::Warn,
                i18n::tr_args(
                    "Failed to fetch {} linked issue(s)",
                    &[count_str.as_str()],
                ),
                first,
            );
        });
    }
    out
}


#[cfg(test)]
mod tests {
    use super::*;
    use crate::github::pull_request::{FileStatus, PullRequestFile};
    use crate::review::snapshot::{FileId, UnsupportedFile};
    use crate::review::target::ReviewTarget;

    fn make_state() -> DiffAppState {
        let snapshot = PullRequestSnapshot {
            target: ReviewTarget::GitHubPr {
                owner: "o".into(),
                repo: "r".into(),
                pr_number: 1,
            },
            title: "t".into(),
            body: None,
            head_sha: "abcdefg".into(),
            base_sha: "0000000".into(),
            files: vec![PullRequestFile {
                file_id: FileId::new("a.rs"),
                file_path: "a.rs".into(),
                status: FileStatus::Modified,
                before_content: Some("a\nb\n".into()),
                after_content: Some("a\nB\n".into()),
                patch: None,
                is_binary: false,
                unsupported: None::<UnsupportedFile>,
            }],
        };
        DiffAppState {
            owner: "o".into(),
            repo: "r".into(),
            snapshot,
            draft: PromptDraft::new(),
            current_anchor: None,
            pending_range: false,
            history: Vec::new(),
            client: None,
            runtime: None,
            snapshot_generation: 0,
        list_generation: 0,
        toasts: Vec::new(),
        next_toast_id: 0,
        scroll_positions: std::collections::HashMap::new(),
        }
    }

    #[test]
    fn set_anchor_clears_pending_range() {
        let mut st = make_state();
        st.pending_range = true;
        st.set_anchor(SelectionAnchor {
            file_id: FileId::new("a.rs"),
            file_path: "a.rs".into(),
            granularity: Granularity::File,
        });
        assert!(!st.pending_range);
        assert!(st.current_anchor.is_some());
    }

    #[test]
    fn start_range_mode_sets_pending() {
        let mut st = make_state();
        st.start_range_mode();
        assert!(st.pending_range);
    }

    #[test]
    fn complete_range_from_line_to_range() {
        let mut st = make_state();
        st.set_anchor(SelectionAnchor {
            file_id: FileId::new("a.rs"),
            file_path: "a.rs".into(),
            granularity: Granularity::Line {
                line: 3,
                side: Side::After,
            },
        });
        st.start_range_mode();
        st.complete_range(&FileId::new("a.rs"), 7, Side::After);
        match &st.current_anchor.as_ref().unwrap().granularity {
            Granularity::Range {
                start_line,
                end_line,
                side,
            } => {
                assert_eq!(*start_line, 3);
                assert_eq!(*end_line, 7);
                assert_eq!(*side, Side::After);
            }
            _ => panic!("expected Range"),
        }
        assert!(!st.pending_range);
    }

    #[test]
    fn complete_range_reverses_when_end_before_start() {
        let mut st = make_state();
        st.set_anchor(SelectionAnchor {
            file_id: FileId::new("a.rs"),
            file_path: "a.rs".into(),
            granularity: Granularity::Line {
                line: 7,
                side: Side::Before,
            },
        });
        st.start_range_mode();
        st.complete_range(&FileId::new("a.rs"), 3, Side::Before);
        match &st.current_anchor.as_ref().unwrap().granularity {
            Granularity::Range {
                start_line,
                end_line,
                ..
            } => {
                assert_eq!(*start_line, 3);
                assert_eq!(*end_line, 7);
            }
            _ => panic!("expected Range"),
        }
    }

    #[test]
    fn snapshot_generation_increments_and_detects_stale() {
        let mut st = make_state();
        let g1 = st.next_snapshot_generation();
        let g2 = st.next_snapshot_generation();
        assert_ne!(g1, g2);
        assert!(st.is_stale_snapshot(g1));
        assert!(!st.is_stale_snapshot(g2));
    }

    #[test]
    fn list_generation_independent_from_snapshot() {
        let mut st = make_state();
        let snap_gen = st.next_snapshot_generation();
        let list_gen = st.next_list_generation();
        // list を進めても snapshot 側の生世代は変わらない
        assert!(!st.is_stale_snapshot(snap_gen));
        assert!(!st.is_stale_list(list_gen));
        // list を更に進めると古い list_gen は stale だが snapshot は無事
        let list_gen2 = st.next_list_generation();
        assert!(st.is_stale_list(list_gen));
        assert!(!st.is_stale_list(list_gen2));
        assert!(!st.is_stale_snapshot(snap_gen));
    }

    #[test]
    fn complete_range_aborts_when_file_differs() {
        let mut st = make_state();
        st.set_anchor(SelectionAnchor {
            file_id: FileId::new("a.rs"),
            file_path: "a.rs".into(),
            granularity: Granularity::Line {
                line: 3,
                side: Side::After,
            },
        });
        st.start_range_mode();
        // 別 file 由来のクリック
        st.complete_range(&FileId::new("b.rs"), 7, Side::After);
        // file 不一致なので pending は解除、anchor は元のまま
        assert!(!st.pending_range);
        match &st.current_anchor.as_ref().unwrap().granularity {
            Granularity::Line { line: 3, .. } => {}
            _ => panic!("expected Line(3) unchanged"),
        }
    }

    #[test]
    fn complete_range_aborts_across_sides() {
        let mut st = make_state();
        st.set_anchor(SelectionAnchor {
            file_id: FileId::new("a.rs"),
            file_path: "a.rs".into(),
            granularity: Granularity::Line {
                line: 3,
                side: Side::After,
            },
        });
        st.start_range_mode();
        st.complete_range(&FileId::new("a.rs"), 7, Side::Before);
        // side が違うので Range 昇格はされず、現在の anchor は維持される
        match &st.current_anchor.as_ref().unwrap().granularity {
            Granularity::Line { line: 3, .. } => {}
            _ => panic!("expected Line unchanged"),
        }
        assert!(!st.pending_range);
    }

    // resolve_line_number / short_sha / excerpt 等の純粋関数テストは
    // src/app/diff_viewer/util.rs に移動済み。

    // ===== Integration / flow tests (#233) =====
    //
    // run_diff_viewer のコールバック chain を Slint なしで再現する。コール
    // バック内では `state.borrow_mut().set_anchor(...)` などを呼んでいるだけで、
    // UI 操作 (refresh_*) は別 helper に分離されているため、state 側のフローを
    // ここで直接組み立てて end-to-end 動作を検証する。

    use review::formatter::{format_prompt, FileSourceEntry};

    fn fixture_files(state: &DiffAppState) -> Vec<FileSourceEntry<'_>> {
        state
            .snapshot
            .files
            .iter()
            .map(|f| FileSourceEntry {
                file_id: &f.file_id,
                file_path: f.file_path.as_str(),
                before_content: f.before_content.as_deref(),
                after_content: f.after_content.as_deref(),
            })
            .collect()
    }

    fn click_line(state: &mut DiffAppState, file_index: usize, line: u32, side: Side) {
        // run_diff_viewer の on_select_line 相当の業務ロジック。
        let file = state.file(file_index).cloned().expect("file exists");
        let file_id = FileId::new(file.file_path.clone());
        if state.pending_range {
            let same_file = state
                .current_anchor
                .as_ref()
                .map(|a| a.file_id == file_id)
                .unwrap_or(false);
            if same_file {
                state.complete_range(&file_id, line, side);
                return;
            }
            state.pending_range = false;
        }
        state.set_anchor(SelectionAnchor {
            file_id,
            file_path: file.file_path,
            granularity: Granularity::Line { line, side },
        });
    }

    fn add_current_to_draft(state: &mut DiffAppState, note: Option<&str>) -> bool {
        // run_diff_viewer の on_add_to_draft と同じ trim / empty→None 変換を踏襲する。
        let Some(anchor) = state.current_anchor.clone() else {
            return false;
        };
        let note_opt = note
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(str::to_string);
        state.draft.push(DraftEntry::new(anchor, note_opt));
        true
    }

    #[test]
    fn flow_click_line_add_to_draft_produces_one_entry() {
        let mut st = make_state();
        click_line(&mut st, 0, 1, Side::After);
        assert!(add_current_to_draft(&mut st, Some("first note")));
        assert_eq!(st.draft.len(), 1);
        let entry = &st.draft.entries()[0];
        assert!(matches!(entry.anchor.granularity, Granularity::Line { line: 1, side: Side::After }));
        assert_eq!(entry.note.as_deref(), Some("first note"));
    }

    #[test]
    fn flow_extend_range_across_two_clicks() {
        let mut st = make_state();
        click_line(&mut st, 0, 1, Side::After);
        st.start_range_mode();
        click_line(&mut st, 0, 2, Side::After);
        match &st.current_anchor.as_ref().unwrap().granularity {
            Granularity::Range {
                start_line: 1,
                end_line: 2,
                side: Side::After,
            } => {}
            other => panic!("expected Range(1..=2, After), got {other:?}"),
        }
        assert!(!st.pending_range);
    }

    #[test]
    fn flow_multiple_drafts_accumulate_in_order() {
        let mut st = make_state();
        click_line(&mut st, 0, 1, Side::After);
        add_current_to_draft(&mut st, None);
        click_line(&mut st, 0, 2, Side::After);
        add_current_to_draft(&mut st, Some("second"));
        assert_eq!(st.draft.len(), 2);
        assert_eq!(st.draft.entries()[0].note, None);
        assert_eq!(st.draft.entries()[1].note.as_deref(), Some("second"));
    }

    #[test]
    fn flow_cancel_range_on_file_switch_clears_pending() {
        let mut st = make_state();
        click_line(&mut st, 0, 1, Side::After);
        st.start_range_mode();
        assert!(st.pending_range);
        st.cancel_range_on_file_switch();
        assert!(!st.pending_range);
        // anchor itself は維持される (file 切替後にユーザが再度 extend するため)
        assert!(st.current_anchor.is_some());
    }

    #[test]
    fn flow_format_prompt_includes_added_snippet() {
        let mut st = make_state();
        click_line(&mut st, 0, 2, Side::After);
        // note に snippet 同名 token を入れない (assert を tautology にしないため)
        assert!(add_current_to_draft(&mut st, Some("inspecting after side")));
        let files = fixture_files(&st);
        let preview = format_prompt(&st.draft, &files);
        // anchor label と note が preview に含まれていること
        assert!(preview.contains("a.rs"), "preview lacks file path: {preview}");
        assert!(
            preview.contains("inspecting after side"),
            "preview lacks note: {preview}"
        );
        // After 側 line 2 (= "B") の本文が snippet に出ていること。
        // note には "B" が無いので、コードフェンス内の "B" が assertion を保証する。
        assert!(
            preview.contains("\nB"),
            "preview lacks after-line content: {preview}"
        );
        assert!(
            !preview.contains("\na\n") || preview.contains("\nB"),
            "preview should include after content (B), not only before (a/b): {preview}"
        );
    }

    #[test]
    fn flow_add_to_draft_trims_note_and_empty_becomes_none() {
        let mut st = make_state();
        click_line(&mut st, 0, 1, Side::After);
        assert!(add_current_to_draft(&mut st, Some("   ")));
        assert_eq!(st.draft.entries()[0].note, None);

        click_line(&mut st, 0, 2, Side::After);
        assert!(add_current_to_draft(&mut st, Some("  hello  ")));
        assert_eq!(
            st.draft.entries()[1].note.as_deref(),
            Some("hello"),
            "note should be trimmed of surrounding whitespace"
        );
    }

    #[test]
    fn flow_remove_draft_entry_decreases_length() {
        let mut st = make_state();
        click_line(&mut st, 0, 1, Side::After);
        add_current_to_draft(&mut st, None);
        click_line(&mut st, 0, 2, Side::After);
        add_current_to_draft(&mut st, None);
        assert_eq!(st.draft.len(), 2);
        st.draft.remove(0);
        assert_eq!(st.draft.len(), 1);
    }
}
