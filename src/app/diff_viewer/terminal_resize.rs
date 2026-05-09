//! Diff viewer terminal pane の resize 配線 (#224 split)。
//!
//! Slint 側の `terminal-resized` callback を `TerminalPane::resize` に橋渡し
//! しつつ、cell metric の解決 (override > opt-in probe > fallback) と
//! window session の保存も同時に行う。`run_diff_viewer` 起動時に一度だけ
//! 呼ばれる前提。

use std::rc::Rc;
use std::time::Instant;

use slint::ComponentHandle;

use super::session::save_window_session;
use crate::config::UiConfig;
use crate::terminal;
use crate::DiffViewerWindow;

/// Slint の `terminal-resized` callback を `TerminalPane::resize` に橋渡しする。
///
/// Slint 側は terminal-pane Rectangle の `width` / `height` の changed callback
/// から `terminal-resized(width, height)` を発火する。ここでは:
///
/// 1. UI から `measured-terminal-cell-w` / `measured-terminal-cell-h` を読み、
///    `UiConfig` の優先順位 (override > opt-in probe > fallback) で cell metric を
///    解決して cell-w / cell-h プロパティに反映する。
/// 2. (pane size / cell size) を floor して新しい cols / rows を算出する。
/// 3. `TerminalPane::resize` で PTY + alacritty Term + row model を再構成する。
pub(crate) fn wire_terminal_resize(
    ui: &DiffViewerWindow,
    pane: Rc<terminal::TerminalPane>,
    ui_cfg: &UiConfig,
) {
    let ui_weak = ui.as_weak();
    let ui_cfg = ui_cfg.clone();
    ui.on_terminal_resized(move |w_logical: f32, h_logical: f32| {
        let started = Instant::now();
        let Some(ui) = ui_weak.upgrade() else {
            return;
        };
        // 初期 layout settling や hidden 中の transient 0x0 では PTY を縮めない。
        // measured-* も layout 確定前は 0 になるので両条件で skip する。
        if w_logical <= 0.0 || h_logical <= 0.0 {
            return;
        }
        // 既定では Slint 隠し Text probe (`measured-terminal-cell-w/h`) を信用せず
        // 比率 fallback (`font_size * 0.6` / `* 1.45`) を採用する。macOS で probe が
        // SF Mono / Menlo の advance を過大・行高を過小に返し grid と glyph がズレる
        // #292 / #289 の再現を回避するため。`LOCUS_TERMINAL_CELL_W/H` の手動 override
        // が最優先、`LOCUS_TERMINAL_PROBE_METRICS=true` で opt-in 時のみ probe 採用。
        let measured_cell_w = ui.get_measured_terminal_cell_w();
        let measured_cell_h = ui.get_measured_terminal_cell_h();
        let cell_w = ui_cfg.terminal_cell_w_from_measurement(measured_cell_w);
        let cell_h = ui_cfg.terminal_cell_h_from_measurement(measured_cell_h);
        let cell_w_source = ui_cfg.terminal_cell_w_source(measured_cell_w);
        let cell_h_source = ui_cfg.terminal_cell_h_source(measured_cell_h);
        ui.set_terminal_cell_w(cell_w);
        ui.set_terminal_cell_h(cell_h);
        let (cols, rows) = terminal::compute_grid_size(w_logical, h_logical, cell_w, cell_h);
        match pane.resize(cols, rows) {
            Ok(()) => {
                let (cols_now, rows_now) = pane.current_size();
                ui.set_terminal_cols(cols_now as i32);
                ui.set_terminal_rows_count(rows_now as i32);
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
        // ウィンドウリサイズに連れて terminal-pane の width/height も変わる
        // ため、ここで session を保存しておくと Cmd+Q (close-requested を
        // 通らず process exit) でも最後の window size を残せる (#231 補強)。
        save_window_session(&ui);
    });
}
