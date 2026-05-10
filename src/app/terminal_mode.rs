//! Terminal-only モード (`locus` / `locus <command>`) のエントリポイント。

use std::rc::Rc;
use std::time::Instant;

use slint::{ComponentHandle, SharedString};

use crate::AppWindow;
use crate::{config, terminal};

pub(crate) fn run_terminal(command: &str) -> Result<(), Box<dyn std::error::Error>> {
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
