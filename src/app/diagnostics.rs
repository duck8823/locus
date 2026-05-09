//! 実機診断ハーネス (`scripts/diagnose_ui.sh`) から使う UI 操作注入。
//!
//! 通常起動では環境変数が無い限り何もしない。LLM が `--interaction` 付き
//! diagnostics を実行したときだけ、アプリ側でしか安定して発火できない操作
//! (diff viewer の file switch など) を timer 経由で起こす。

use std::time::Duration;

use slint::{ComponentHandle, Model};

use crate::DiffViewerWindow;

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
            "diagnostic file switch triggered"
        );
        ui.invoke_file_switch_requested(next);
    });
}

/// 診断用 interaction を必要に応じて arm する。
///
/// 現在は `LOCUS_DIAG_FILE_SWITCH_AFTER_MS` が指定された diff viewer run で、
/// file list が hydrate され次第 `file-switch-requested` を 1 回発火させる。
pub(crate) fn schedule_diagnostic_interactions(ui: &DiffViewerWindow) {
    let Some(delay_ms) = std::env::var("LOCUS_DIAG_FILE_SWITCH_AFTER_MS")
        .ok()
        .and_then(|v| v.parse::<u64>().ok())
    else {
        return;
    };
    schedule_diagnostic_file_switch(ui, Duration::from_millis(delay_ms), 20);
}
