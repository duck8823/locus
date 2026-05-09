//! Diff viewer の session persistence helper (#224 split)。
//!
//! `~/.../session.json` への書き出しは `crate::session` の最上位 API
//! (`mutate` / `SessionState::pr_key` / `PerPrState`) に委譲するだけで、
//! ここでは UI / `DiffAppState` から書き出すべきフィールドへ詰め替える
//! 役割だけを持つ。
//!
//! root の `crate::session` と本モジュール名 `session` が衝突しないよう、
//! ここでは `crate::session as app_session` にリネームして参照する。

use std::time::Instant;

use slint::ComponentHandle;

use super::state::DiffAppState;
use crate::session as app_session;
use crate::DiffViewerWindow;

/// 現在のウィンドウサイズと位置を logical px にして session.json へ書き出す。
/// 既存の per_pr などは preserve したいので、session::mutate で部分更新する。
/// 失敗時は session::save 内部で warn ログのみ。
pub(crate) fn save_window_session(ui: &DiffViewerWindow) {
    let started = Instant::now();
    let physical = ui.window().size();
    let pos = ui.window().position();
    let scale = ui.window().scale_factor().max(f32::EPSILON);
    let logical_w = physical.width as f32 / scale;
    let logical_h = physical.height as f32 / scale;
    app_session::mutate(|state| {
        state.window_width = Some(logical_w);
        state.window_height = Some(logical_h);
        state.window_x = Some(pos.x as f32 / scale);
        state.window_y = Some(pos.y as f32 / scale);
    });
    tracing::debug!(
        window_w = logical_w,
        window_h = logical_h,
        elapsed_ms = started.elapsed().as_millis() as u64,
        "window session saved"
    );
}

/// PR 単位の draft / file index を session.json の per_pr table に書き出す。
///
/// PR 番号は UI の current-pr-number を読む (PR 切替後も正しい key に書く)。
/// owner/repo は同じ window の中では不変なので closure capture でよい。
pub(crate) fn save_pr_session(
    owner: &str,
    repo: &str,
    state: &DiffAppState,
    ui: &DiffViewerWindow,
) {
    let started = Instant::now();
    let pr_number = ui.get_current_pr_number();
    if pr_number <= 0 {
        return;
    }
    let key = app_session::SessionState::pr_key(owner, repo, pr_number as u64);
    let selected_file_index = ui.get_selected_file_index();
    let draft_count = state.draft.len();
    let pr_state = app_session::PerPrState {
        selected_file_index: Some(selected_file_index),
        draft: state.draft.entries().to_vec(),
    };
    app_session::mutate(|s| {
        s.per_pr.insert(key, pr_state);
    });
    tracing::debug!(
        pr_number,
        selected_file_index,
        draft_count,
        elapsed_ms = started.elapsed().as_millis() as u64,
        "pr session saved"
    );
}
