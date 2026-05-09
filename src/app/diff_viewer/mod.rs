//! Diff viewer モード関連のサブモジュール。
//!
//! main.rs の `run_diff_viewer` は依然として main.rs に残っているが、
//! 状態 / ヘルパは段階的にここへ移動する (#224 split)。

pub(crate) mod snapshot;
pub(crate) mod refresh;
pub(crate) mod state;
pub(crate) mod util;
