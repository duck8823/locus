//! Toast 表示の副作用ヘルパ (#224 split)。
//!
//! `ACTIVE_DIFF_WINDOW` thread_local には auto-dismiss timer や非同期完了 closure
//! から `DiffViewerWindow` を取り出すための弱参照を保持する。`run_diff_viewer`
//! 起動時に `set_active_window` で登録する。
//!
//! `show_toast` / `schedule_toast_auto_dismiss` は Slint UI スレッド上で呼ばれる
//! 想定で、`state::with_app_state` 経由で `DIFF_APP_STATE` を借用し、
//! `refresh::refresh_toasts` で UI を再描画する。

use std::cell::RefCell;
use std::time::Duration;

use slint::{ComponentHandle, Weak};

use super::refresh::refresh_toasts;
use super::state::{with_app_state, ToastKind};
use crate::DiffViewerWindow;

thread_local! {
    /// auto-dismiss timer から UI を取り出すための弱参照。
    /// `set_active_window` で `run_diff_viewer` 起動時に登録する。
    static ACTIVE_DIFF_WINDOW: RefCell<Option<Weak<DiffViewerWindow>>> = const {
        RefCell::new(None)
    };
}

/// `run_diff_viewer` 起動時に `DiffViewerWindow` の弱参照を登録する。
pub(crate) fn set_active_window(ui: &DiffViewerWindow) {
    ACTIVE_DIFF_WINDOW.with(|cell| *cell.borrow_mut() = Some(ui.as_weak()));
}

/// 5 秒後に該当 toast を自動で dismiss する。
///
/// `slint::Timer::single_shot` は内部で self-manage されるため、Timer 自体を
/// 持ち回ったり leak したりする必要がない。
pub(crate) fn schedule_toast_auto_dismiss(toast_id: i32) {
    slint::Timer::single_shot(Duration::from_secs(5), move || {
        with_app_state(|state| {
            state.borrow_mut().dismiss_toast(toast_id);
            if let Some(ui) =
                ACTIVE_DIFF_WINDOW.with(|w| w.borrow().as_ref().and_then(|w| w.upgrade()))
            {
                refresh_toasts(&ui, state);
            }
        });
    });
}

/// UI イベントループ上で toast を push し、auto-dismiss スケジュールを行う。
/// 各エラー経路のヘルパとして使う。
pub(crate) fn show_toast(kind: ToastKind, title: String, message: String) {
    with_app_state(|state| {
        let id = state.borrow_mut().push_toast(kind, title, message);
        if let Some(ui) = ACTIVE_DIFF_WINDOW.with(|w| w.borrow().as_ref().and_then(|w| w.upgrade()))
        {
            refresh_toasts(&ui, state);
        }
        schedule_toast_auto_dismiss(id);
    });
}
