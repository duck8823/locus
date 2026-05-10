//! Diff viewer モード関連のサブモジュール。
//!
//! main.rs の `run_diff_viewer` は依然として main.rs に残っているが、
//! 状態 / ヘルパは段階的にここへ移動する (#224 split)。

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
