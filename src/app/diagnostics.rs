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

fn schedule_diagnostic_diff_scroll(ui: &DiffViewerWindow, delay: Duration, attempts_left: u8) {
    let ui_weak = ui.as_weak();
    slint::Timer::single_shot(delay, move || {
        let Some(ui) = ui_weak.upgrade() else { return };
        let files = ui.get_files();
        let count = files.row_count();
        if count == 0 {
            if attempts_left > 0 {
                schedule_diagnostic_diff_scroll(
                    &ui,
                    Duration::from_millis(250),
                    attempts_left - 1,
                );
            } else {
                tracing::debug!("diagnostic diff scroll skipped");
            }
            return;
        }
        let selected = ui.get_selected_file_index().max(0) as usize;
        let Some(file) = files.row_data(selected) else {
            tracing::debug!(selected, files = count, "diagnostic diff scroll skipped");
            return;
        };
        if file.is_unsupported {
            tracing::debug!(
                selected,
                files = count,
                file_path = %file.file_path,
                "diagnostic diff scroll skipped unsupported file"
            );
            return;
        }

        let from = ui.get_diff_scroll_y();
        let to = from + 360.0;
        ui.set_diff_scroll_y(to);
        tracing::debug!(from, to, files = count, "diagnostic diff scroll triggered");
        // Rust 側から set_diff_scroll_y() しただけでは Slint の `changed
        // diff-scroll-y` callback が診断ログとして観測されない環境がある。
        // app-side timer 診断では「viewport を動かした直後の signal」を安定して
        // app.log に残すため、明示的に diagnostic callback も発火させる。
        ui.invoke_diff_scroll_diagnostic(0.0, to);
    });
}

/// 診断用 interaction を必要に応じて arm する。
///
/// `LOCUS_DIAG_FILE_SWITCH_AFTER_MS` が指定された diff viewer run では
/// file list が hydrate され次第 `file-switch-requested` を 1 回発火させる。
/// `LOCUS_DIAG_DIFF_SCROLL_AFTER_MS` では diff viewport-y を動かして
/// ListView scroll/render の app-side signal を出す。
pub(crate) fn schedule_diagnostic_interactions(ui: &DiffViewerWindow) {
    if let Some(delay_ms) = std::env::var("LOCUS_DIAG_FILE_SWITCH_AFTER_MS")
        .ok()
        .and_then(|v| v.parse::<u64>().ok())
    {
        schedule_diagnostic_file_switch(ui, Duration::from_millis(delay_ms), 20);
    }
    if let Some(delay_ms) = std::env::var("LOCUS_DIAG_DIFF_SCROLL_AFTER_MS")
        .ok()
        .and_then(|v| v.parse::<u64>().ok())
    {
        schedule_diagnostic_diff_scroll(ui, Duration::from_millis(delay_ms), 20);
    }
}
