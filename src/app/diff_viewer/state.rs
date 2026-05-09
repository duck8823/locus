//! Diff viewer モードの実行時状態。
//!
//! `DiffAppState` を中心に PromptDraft / SelectionAnchor / 履歴 / トースト /
//! 世代カウンタなどを束ねる。Slint のイベント callback と非同期 fetch から
//! `Rc<RefCell<DiffAppState>>` で共有される。`run_diff_viewer` ローカルの
//! ヘルパに散らばっていたが、main.rs の肥大を緩和するため独立 module に
//! 切り出した (#224)。
//!
//! 一旦 `pub(crate)` で公開し、main.rs / app::diff_viewer 配下の helper から
//! のみアクセスする想定。

use crate::github::pull_request::{PullRequestFile, PullRequestSnapshot};
use crate::review::draft::{PromptDraft, SendMode};
use crate::review::selection::{Granularity, SelectionAnchor, Side};
use crate::review::snapshot::FileId;

/// 送信履歴の 1 エントリ。セッション内にのみ保持される。
#[derive(Debug, Clone)]
pub(crate) struct HistoryEntry {
    pub timestamp: String,
    pub mode: SendMode,
    pub anchors_label: String,
    #[allow(dead_code)]
    pub body: String,
}

/// Diff viewer mode 用の状態。Slint の複数コールバックから共有する。
///
/// `client` / `runtime` は live モードでのみ使う。テストでは make_state が
/// None を入れ、PR 切替や issue fetch を呼ばないテストだけが実行可能。
pub(crate) struct DiffAppState {
    pub owner: String,
    pub repo: String,
    pub snapshot: PullRequestSnapshot,
    pub draft: PromptDraft,
    pub current_anchor: Option<SelectionAnchor>,
    pub pending_range: bool,
    pub history: Vec<HistoryEntry>,
    pub client: Option<std::sync::Arc<octocrab::Octocrab>>,
    pub runtime: Option<tokio::runtime::Handle>,
    /// PR snapshot 切替の世代カウンタ。PR 切替と起動 hydrate で +1。
    /// PR list filter とは独立して進める (filter 変更で snapshot 結果を
    /// 破棄しないため)。
    pub snapshot_generation: u64,
    /// PR list filter の世代カウンタ。
    pub list_generation: u64,
    /// 表示中のトースト。new -> bottom 順 (UI 側 index で逆順表示)。
    pub toasts: Vec<ToastEntry>,
    pub next_toast_id: i32,
    /// ファイル切替時に viewport-y を保存する HashMap (#230)。
    /// key は selected-file-index、value は logical px。
    pub scroll_positions: std::collections::HashMap<usize, f32>,
}

#[derive(Debug, Clone)]
pub(crate) struct ToastEntry {
    pub id: i32,
    pub kind: ToastKind,
    pub title: String,
    pub message: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[allow(dead_code)]
pub(crate) enum ToastKind {
    Error,
    Warn,
    Info,
}

impl ToastKind {
    pub fn to_int(self) -> i32 {
        match self {
            ToastKind::Error => 0,
            ToastKind::Warn => 1,
            ToastKind::Info => 2,
        }
    }
}

impl DiffAppState {
    pub fn file(&self, index: usize) -> Option<&PullRequestFile> {
        self.snapshot.files.get(index)
    }

    pub fn set_anchor(&mut self, anchor: SelectionAnchor) {
        self.current_anchor = Some(anchor);
        self.pending_range = false;
    }

    pub fn start_range_mode(&mut self) {
        // range モードは「すでに Line 選択がある状態」で Range への昇格を宣言する。
        self.pending_range = true;
    }

    /// 現在の anchor と引数の line を使って Range 選択を作る。
    ///
    /// file_id を受け取り、現在の anchor と同じ file の場合にのみ Range 昇格する。
    /// 別 file の行がクリックされた場合や、side が異なる場合、pending は解除して
    /// anchor は変更しない。
    pub fn complete_range(&mut self, file_id: &FileId, line: u32, side: Side) {
        let Some(current) = self.current_anchor.clone() else {
            self.pending_range = false;
            return;
        };
        if current.file_id != *file_id {
            // 別 file をクリックした場合は pending を解除してその行の Line 選択にする。
            self.pending_range = false;
            return;
        }
        let Granularity::Line {
            line: start_line,
            side: start_side,
        } = current.granularity
        else {
            self.pending_range = false;
            return;
        };
        if start_side != side {
            self.pending_range = false;
            return;
        }
        let (from, to) = if start_line <= line {
            (start_line, line)
        } else {
            (line, start_line)
        };
        self.current_anchor = Some(SelectionAnchor {
            file_id: current.file_id,
            file_path: current.file_path,
            granularity: Granularity::Range {
                start_line: from,
                end_line: to,
                side,
            },
        });
        self.pending_range = false;
    }

    /// 選択中のファイルが変わったとき、進行中の range 作成を解除する。
    pub fn cancel_range_on_file_switch(&mut self) {
        self.pending_range = false;
    }

    /// snapshot 切替の世代を進めて返す。
    pub fn next_snapshot_generation(&mut self) -> u64 {
        self.snapshot_generation = self.snapshot_generation.wrapping_add(1);
        self.snapshot_generation
    }

    pub fn is_stale_snapshot(&self, captured: u64) -> bool {
        captured != self.snapshot_generation
    }

    pub fn next_list_generation(&mut self) -> u64 {
        self.list_generation = self.list_generation.wrapping_add(1);
        self.list_generation
    }

    pub fn is_stale_list(&self, captured: u64) -> bool {
        captured != self.list_generation
    }

    pub fn push_toast(&mut self, kind: ToastKind, title: String, message: String) -> i32 {
        let id = self.next_toast_id;
        self.next_toast_id = self.next_toast_id.wrapping_add(1);
        self.toasts.push(ToastEntry {
            id,
            kind,
            title,
            message,
        });
        // 多すぎたら古い方から落とす
        if self.toasts.len() > 5 {
            self.toasts.remove(0);
        }
        id
    }

    pub fn dismiss_toast(&mut self, id: i32) {
        self.toasts.retain(|t| t.id != id);
    }
}
