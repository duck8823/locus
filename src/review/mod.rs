// v0.1 開始時点では後続 Issue (#201-#206) が消費するまで多くの型・メソッドが
// dead code として検出される。モジュール単位で許容する。
#![allow(dead_code, unused_imports)]

//! Locus のコアドメイン型。
//!
//! - [`target`] — ReviewTarget: PR や local compare を抽象化
//! - [`snapshot`] — before/after のファイルスナップショット
//! - [`diff`] — 内部 diff モデル (FileDiff / Hunk / DiffLine)
//! - [`selection`] — diff 上の選択アンカー
//! - [`draft`] — PromptDraft: Terminal に流す前の下書き
//!
//! いずれも I/O を持たない純粋な型で、UI / PTY / GitHub から独立している。

pub mod diff;
pub mod diff_builder;
pub mod draft;
pub mod formatter;
pub mod selection;
pub mod snapshot;
pub mod target;

pub use diff::{DiffLine, FileDiff, Hunk, LineKind};
pub use draft::{DraftEntry, PromptDraft, SendMode};
pub use selection::{Granularity, SelectionAnchor, Side};
pub use snapshot::{FileId, Revision, SourceSnapshot, UnsupportedFile};
pub use target::ReviewTarget;
