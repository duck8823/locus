//! Diff viewer モード関連のサブモジュール。
//!
//! `run_diff_viewer` 本体と、それを構成するヘルパ群をまとめる。
//! `crate::session` (アプリ全体の session.json 永続化) と本モジュール内の
//! `session` サブモジュール (UI / `DiffAppState` から書き出し) が衝突するため、
//! 前者は `crate::session as app_session` で参照する。

pub(crate) mod callbacks;
pub(crate) mod hydrate;
pub(crate) mod linked_issues;
pub(crate) mod refresh;
pub(crate) mod session;
pub(crate) mod snapshot;
pub(crate) mod state;
pub(crate) mod terminal_resize;
pub(crate) mod toast;
pub(crate) mod util;

use std::cell::RefCell;
use std::rc::Rc;

use slint::{ComponentHandle, SharedString};

use crate::DiffViewerWindow;
use crate::app::diagnostics::schedule_diagnostic_interactions;
use crate::github::pull_request::{PullRequestSnapshot, build_client, parse_pr_spec};
use crate::review::draft::PromptDraft;
use crate::session as app_session;
use crate::{config, i18n, review, terminal};

use callbacks::wire_diff_viewer_callbacks;
use hydrate::spawn_initial_hydrate;
use refresh::{
    refresh_current_anchor_label, refresh_draft_panel, refresh_history_panel, refresh_preview,
    refresh_toasts,
};
use session::save_window_session;
use snapshot::{apply_snapshot_to_ui, build_pr_list_model};
use state::{DiffAppState, ToastKind, set_app_state};
use terminal_resize::wire_terminal_resize;
use toast::{schedule_toast_auto_dismiss, set_active_window};

pub(crate) fn run_diff_viewer(spec: &str) -> Result<(), Box<dyn std::error::Error>> {
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
    if let Some(saved) = app_session::load() {
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
