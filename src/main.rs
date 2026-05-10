//! locus composition root.
//!
//! 起動モードは argv で切り替える:
//!
//! - `cargo run` / `cargo run -- <command>` — Terminal ペインモード
//! - `cargo run -- github <owner>/<repo>#<pr_number>` — Diff viewer モード

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

fn main() -> Result<(), Box<dyn std::error::Error>> {
    // tracing-subscriber を最初に初期化する。LOCUS_LOG=debug 等で詳細
    // レベルを上げられる。設定なしでは warn 以上のみ stderr に出る。
    init_logging();
    // i18n を初期化する。LANG が未設定なら locus 既定の ja に揃える。
    let _ = i18n::init_from_env();

    let args: Vec<String> = std::env::args().skip(1).collect();

    match args.as_slice() {
        [mode, spec] if mode == "github" => app::diff_viewer::run_diff_viewer(spec),
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
