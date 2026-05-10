//! locus composition root.
//!
//! 起動モードは argv で切り替える:
//!
//! - `cargo run` / `cargo run -- <command>` — Terminal ペインモード
//! - `cargo run -- github <owner>/<repo>#<pr_number>` — Diff viewer モード

use std::cell::RefCell;
use std::rc::Rc;
use std::time::Instant;

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

use app::diagnostics::schedule_diagnostic_interactions;
use app::diff_viewer::callbacks::wire_diff_viewer_callbacks;
use app::diff_viewer::hydrate::spawn_initial_hydrate;
use app::diff_viewer::refresh::{
    refresh_current_anchor_label, refresh_draft_panel, refresh_history_panel, refresh_preview,
    refresh_toasts,
};
use app::diff_viewer::session::save_window_session;
use app::diff_viewer::snapshot::{apply_snapshot_to_ui, build_pr_list_model};
use app::diff_viewer::state::{DiffAppState, ToastKind, set_app_state};
use app::diff_viewer::terminal_resize::wire_terminal_resize;
use app::diff_viewer::toast::{schedule_toast_auto_dismiss, set_active_window};

use github::pull_request::{PullRequestSnapshot, build_client, parse_pr_spec};
use review::draft::PromptDraft;

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
            let cmd = std::env::var("LOCUS_AGENT_CMD").unwrap_or_else(|_| "claude".to_string());
            run_terminal(&cmd)
        }
        _ => {
            eprintln!("Usage:");
            eprintln!(
                "  locus                          # terminal pane (LOCUS_AGENT_CMD or claude)"
            );
            eprintln!(
                "  locus <command>                # terminal pane (custom cmd, overrides env)"
            );
            eprintln!("  locus github <owner>/<repo>#<pr_number>");
            std::process::exit(2);
        }
    }
}

/// `LOCUS_LOG` 環境変数 (`error` / `warn` / `info` / `debug` / `trace`)
/// を tracing-subscriber の EnvFilter に流し込む。未設定時は `warn`。
fn init_logging() {
    use tracing_subscriber::EnvFilter;
    let filter = EnvFilter::try_from_env("LOCUS_LOG").unwrap_or_else(|_| EnvFilter::new("warn"));
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
            ui.window()
                .set_position(slint::WindowPosition::Logical(slint::LogicalPosition::new(
                    x, y,
                )));
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

    // Terminal pane を立ち上げる。起動コマンドは LOCUS_AGENT_CMD 環境変数で
    // 上書きできる（既定は claude）。PATH に存在しなければ起動前に弾いて
    // toast でユーザーに知らせ、launch 自体は skip する。
    let agent_cmd = std::env::var("LOCUS_AGENT_CMD").unwrap_or_else(|_| "claude".to_string());
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

    wire_diff_viewer_callbacks(&ui, &state, terminal_pane.clone(), &owner, &repo);

    // 初期 hydrate: PR snapshot / PR list / linked issues を並列で取得し、
    // 完了後に UI を埋める。snapshot と list を別の世代で管理することで、
    // 起動 hydrate 中に user が filter を切り替えても snapshot 結果が
    // 破棄されない。
    spawn_initial_hydrate(
        &ui,
        &state,
        &runtime_handle,
        client_arc.clone(),
        &owner,
        &repo,
        pr_number,
    );

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
