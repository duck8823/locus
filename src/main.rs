//! locus composition root.
//!
//! 起動モードは argv で切り替える:
//!
//! - `cargo run` / `cargo run -- <command>` — Terminal ペインモード
//! - `cargo run -- github <owner>/<repo>#<pr_number>` — Diff viewer モード

use std::cell::RefCell;
use std::rc::Rc;
use std::time::{Duration, Instant};

use slint::{ComponentHandle, Model, SharedString};

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

use app::diff_viewer::linked_issues::fetch_linked_issues_parallel;
use app::diff_viewer::snapshot::{apply_snapshot_to_ui, build_pr_list_model};
use app::diff_viewer::refresh::{
    append_history, refresh_current_anchor_label, refresh_draft_panel, refresh_history_panel,
    refresh_preview, refresh_toasts,
};
use app::diff_viewer::session::{save_pr_session, save_window_session};
use app::diff_viewer::state::{set_app_state, with_app_state, DiffAppState, ToastKind};
use app::diff_viewer::terminal_resize::wire_terminal_resize;
use app::diff_viewer::toast::{schedule_toast_auto_dismiss, set_active_window, show_toast};
use app::diff_viewer::util::resolve_line_number;

use github::issue_context::extract_linked_issue_numbers;
use github::pull_request::{
    build_client, fetch_pr_snapshot, fetch_pull_requests, parse_pr_spec, PrListFilter,
    PullRequestSnapshot,
};
use review::draft::{DraftEntry, PromptDraft, SendMode};
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
    ui.set_terminal_debug_grid(ui_cfg.terminal_debug_grid);
    tracing::debug!(
        terminal_font_family = %ui_cfg.terminal_font_family,
        terminal_font_size = ui_cfg.terminal_font_size,
        terminal_cell_w = ui_cfg.terminal_cell_w(),
        terminal_cell_h = ui_cfg.terminal_cell_h(),
        terminal_probe_metrics = ui_cfg.terminal_probe_metrics,
        terminal_debug_grid = ui_cfg.terminal_debug_grid,
        "terminal typography configured"
    );
    let pane = Rc::new(terminal::launch(&ui, command, ui_cfg.bracketed_paste)?);
    {
        let pane = pane.clone();
        let ui_weak = ui.as_weak();
        let ui_cfg = ui_cfg.clone();
        ui.on_resized(move |w_logical: f32, h_logical: f32| {
            let started = Instant::now();
            let Some(ui) = ui_weak.upgrade() else {
                return;
            };
            // 初期 layout settling や hidden 中の transient 0x0 では PTY を縮めない。
            // measured-* も layout 確定前は 0 になるので両条件で skip する。
            if w_logical <= 0.0 || h_logical <= 0.0 {
                return;
            }
            let measured_cell_w = ui.get_measured_cell_w();
            let measured_cell_h = ui.get_measured_cell_h();
            let cell_w = ui_cfg.terminal_cell_w_from_measurement(measured_cell_w);
            let cell_h = ui_cfg.terminal_cell_h_from_measurement(measured_cell_h);
            let cell_w_source = ui_cfg.terminal_cell_w_source(measured_cell_w);
            let cell_h_source = ui_cfg.terminal_cell_h_source(measured_cell_h);
            ui.set_cell_w(cell_w);
            ui.set_cell_h(cell_h);
            let (cols, rows) = terminal::compute_grid_size(w_logical, h_logical, cell_w, cell_h);
            match pane.resize(cols, rows) {
                Ok(()) => {
                    let (cols_now, rows_now) = pane.current_size();
                    ui.set_cols(cols_now as i32);
                    ui.set_visible_rows(rows_now as i32);
                    tracing::debug!(
                        pane_w = w_logical,
                        pane_h = h_logical,
                        cell_w,
                        cell_h,
                        cell_w_source,
                        cell_h_source,
                        cols = cols_now,
                        rows = rows_now,
                        elapsed_ms = started.elapsed().as_millis() as u64,
                        "terminal resized"
                    );
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

fn schedule_diagnostic_file_switch(ui: &DiffViewerWindow, delay: Duration, attempts_left: u8) {
    let ui_weak = ui.as_weak();
    slint::Timer::single_shot(delay, move || {
        let Some(ui) = ui_weak.upgrade() else { return };
        let files = ui.get_files();
        let count = files.row_count();
        if count <= 1 {
            if attempts_left > 0 {
                schedule_diagnostic_file_switch(
                    &ui,
                    Duration::from_millis(250),
                    attempts_left - 1,
                );
            } else {
                tracing::debug!(files = count, "diagnostic file switch skipped");
            }
            return;
        }

        let current = ui.get_selected_file_index().max(0);
        let next = if (current as usize) + 1 < count {
            current + 1
        } else {
            0
        };
        tracing::debug!(
            from = current,
            to = next,
            files = count,
            "diagnostic file switch requested"
        );
        ui.invoke_file_switch_requested(next);
    });
}

fn schedule_diagnostic_interactions(ui: &DiffViewerWindow) {
    let Some(delay_ms) = std::env::var("LOCUS_DIAG_FILE_SWITCH_AFTER_MS")
        .ok()
        .and_then(|v| v.parse::<u64>().ok())
    else {
        return;
    };
    schedule_diagnostic_file_switch(ui, Duration::from_millis(delay_ms), 20);
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
    ui.set_terminal_debug_grid(ui_cfg.terminal_debug_grid);
    ui.set_preview_max_chars(ui_cfg.prompt_max_chars.min(i32::MAX as usize) as i32);
    ui.set_require_send_confirm(ui_cfg.confirm_send);
    tracing::debug!(
        font_family = %ui_cfg.font_family,
        terminal_font_family = %ui_cfg.terminal_font_family,
        terminal_font_size = ui_cfg.terminal_font_size,
        terminal_cell_w = ui_cfg.terminal_cell_w(),
        terminal_cell_h = ui_cfg.terminal_cell_h(),
        terminal_probe_metrics = ui_cfg.terminal_probe_metrics,
        terminal_debug_grid = ui_cfg.terminal_debug_grid,
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
            let started = Instant::now();
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
                let snapshot_res =
                    fetch_pr_snapshot(&client, &owner, &repo, new_number).await;
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
                let linked = fetch_linked_issues_parallel(
                    &client, &owner, &repo, &numbers,
                )
                .await;
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
            let hydrate_started = Instant::now();
            // PR snapshot と PR list を join! で並列実行
            let snapshot_fut =
                fetch_pr_snapshot(&client_clone, &owner_clone, &repo_clone, pr_number);
            let list_fut = fetch_pull_requests(
                &client_clone,
                &owner_clone,
                &repo_clone,
                PrListFilter::Open,
            );
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
            let linked_started = Instant::now();
            let linked = fetch_linked_issues_parallel(
                &client_clone,
                &owner_clone,
                &repo_clone,
                &numbers,
            )
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

    schedule_diagnostic_interactions(&ui);

    ui.run()?;
    drop(position_save_timer);
    drop(terminal_pane);
    Ok(())
}
