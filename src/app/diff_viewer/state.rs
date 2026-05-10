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

use std::cell::RefCell;
use std::rc::Rc;

use crate::github::pull_request::{PullRequestFile, PullRequestSnapshot};
use crate::review::draft::{PromptDraft, SendMode};
use crate::review::selection::{Granularity, SelectionAnchor, Side};
use crate::review::snapshot::FileId;

thread_local! {
    /// 同期 callback / 非同期 spawn 完了後の invoke_from_event_loop closure
    /// から共通でアクセスする DiffAppState。Slint イベントループは UI スレッド
    /// 上で動くため thread_local で十分。Rc<RefCell<>> を closure に capture
    /// すると非 Send になり spawn できないので、thread_local 経由で
    /// 取り出す形にして closure を Send に保つ。
    static DIFF_APP_STATE: RefCell<Option<Rc<RefCell<DiffAppState>>>> = const {
        RefCell::new(None)
    };
}

/// `run_diff_viewer` 起動時に共有 state を thread_local へ登録する。
/// UI スレッド上で 1 度だけ呼ばれる前提。
pub(crate) fn set_app_state(state: Rc<RefCell<DiffAppState>>) {
    DIFF_APP_STATE.with(|cell| *cell.borrow_mut() = Some(state));
}

/// 登録済みの共有 state へクロージャでアクセスする。未登録なら `None`。
pub(crate) fn with_app_state<R>(f: impl FnOnce(&Rc<RefCell<DiffAppState>>) -> R) -> Option<R> {
    DIFF_APP_STATE.with(|cell| cell.borrow().as_ref().map(f))
}

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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::github::pull_request::FileStatus;
    use crate::review::draft::DraftEntry;
    use crate::review::formatter::{format_prompt, FileSourceEntry};
    use crate::review::snapshot::UnsupportedFile;
    use crate::review::target::ReviewTarget;

    fn make_state() -> DiffAppState {
        let snapshot = PullRequestSnapshot {
            target: ReviewTarget::GitHubPr {
                owner: "o".into(),
                repo: "r".into(),
                pr_number: 1,
            },
            title: "t".into(),
            body: None,
            head_sha: "abcdefg".into(),
            base_sha: "0000000".into(),
            files: vec![PullRequestFile {
                file_id: FileId::new("a.rs"),
                file_path: "a.rs".into(),
                previous_file_path: None,
                status: FileStatus::Modified,
                before_content: Some("a\nb\n".into()),
                after_content: Some("a\nB\n".into()),
                patch: None,
                is_binary: false,
                unsupported: None::<UnsupportedFile>,
            }],
        };
        DiffAppState {
            owner: "o".into(),
            repo: "r".into(),
            snapshot,
            draft: PromptDraft::new(),
            current_anchor: None,
            pending_range: false,
            history: Vec::new(),
            client: None,
            runtime: None,
            snapshot_generation: 0,
            list_generation: 0,
            toasts: Vec::new(),
            next_toast_id: 0,
            scroll_positions: std::collections::HashMap::new(),
        }
    }

    #[test]
    fn set_anchor_clears_pending_range() {
        let mut st = make_state();
        st.pending_range = true;
        st.set_anchor(SelectionAnchor {
            file_id: FileId::new("a.rs"),
            file_path: "a.rs".into(),
            granularity: Granularity::File,
        });
        assert!(!st.pending_range);
        assert!(st.current_anchor.is_some());
    }

    #[test]
    fn start_range_mode_sets_pending() {
        let mut st = make_state();
        st.start_range_mode();
        assert!(st.pending_range);
    }

    #[test]
    fn complete_range_from_line_to_range() {
        let mut st = make_state();
        st.set_anchor(SelectionAnchor {
            file_id: FileId::new("a.rs"),
            file_path: "a.rs".into(),
            granularity: Granularity::Line {
                line: 3,
                side: Side::After,
            },
        });
        st.start_range_mode();
        st.complete_range(&FileId::new("a.rs"), 7, Side::After);
        match &st.current_anchor.as_ref().unwrap().granularity {
            Granularity::Range {
                start_line,
                end_line,
                side,
            } => {
                assert_eq!(*start_line, 3);
                assert_eq!(*end_line, 7);
                assert_eq!(*side, Side::After);
            }
            _ => panic!("expected Range"),
        }
        assert!(!st.pending_range);
    }

    #[test]
    fn complete_range_reverses_when_end_before_start() {
        let mut st = make_state();
        st.set_anchor(SelectionAnchor {
            file_id: FileId::new("a.rs"),
            file_path: "a.rs".into(),
            granularity: Granularity::Line {
                line: 7,
                side: Side::Before,
            },
        });
        st.start_range_mode();
        st.complete_range(&FileId::new("a.rs"), 3, Side::Before);
        match &st.current_anchor.as_ref().unwrap().granularity {
            Granularity::Range {
                start_line,
                end_line,
                ..
            } => {
                assert_eq!(*start_line, 3);
                assert_eq!(*end_line, 7);
            }
            _ => panic!("expected Range"),
        }
    }

    #[test]
    fn snapshot_generation_increments_and_detects_stale() {
        let mut st = make_state();
        let g1 = st.next_snapshot_generation();
        let g2 = st.next_snapshot_generation();
        assert_ne!(g1, g2);
        assert!(st.is_stale_snapshot(g1));
        assert!(!st.is_stale_snapshot(g2));
    }

    #[test]
    fn list_generation_independent_from_snapshot() {
        let mut st = make_state();
        let snap_gen = st.next_snapshot_generation();
        let list_gen = st.next_list_generation();
        // list を進めても snapshot 側の生世代は変わらない
        assert!(!st.is_stale_snapshot(snap_gen));
        assert!(!st.is_stale_list(list_gen));
        // list を更に進めると古い list_gen は stale だが snapshot は無事
        let list_gen2 = st.next_list_generation();
        assert!(st.is_stale_list(list_gen));
        assert!(!st.is_stale_list(list_gen2));
        assert!(!st.is_stale_snapshot(snap_gen));
    }

    #[test]
    fn complete_range_aborts_when_file_differs() {
        let mut st = make_state();
        st.set_anchor(SelectionAnchor {
            file_id: FileId::new("a.rs"),
            file_path: "a.rs".into(),
            granularity: Granularity::Line {
                line: 3,
                side: Side::After,
            },
        });
        st.start_range_mode();
        // 別 file 由来のクリック
        st.complete_range(&FileId::new("b.rs"), 7, Side::After);
        // file 不一致なので pending は解除、anchor は元のまま
        assert!(!st.pending_range);
        match &st.current_anchor.as_ref().unwrap().granularity {
            Granularity::Line { line: 3, .. } => {}
            _ => panic!("expected Line(3) unchanged"),
        }
    }

    #[test]
    fn complete_range_aborts_across_sides() {
        let mut st = make_state();
        st.set_anchor(SelectionAnchor {
            file_id: FileId::new("a.rs"),
            file_path: "a.rs".into(),
            granularity: Granularity::Line {
                line: 3,
                side: Side::After,
            },
        });
        st.start_range_mode();
        st.complete_range(&FileId::new("a.rs"), 7, Side::Before);
        // side が違うので Range 昇格はされず、現在の anchor は維持される
        match &st.current_anchor.as_ref().unwrap().granularity {
            Granularity::Line { line: 3, .. } => {}
            _ => panic!("expected Line unchanged"),
        }
        assert!(!st.pending_range);
    }

    // resolve_line_number / short_sha / excerpt 等の純粋関数テストは
    // src/app/diff_viewer/util.rs に移動済み。

    // ===== Integration / flow tests (#233) =====
    //
    // run_diff_viewer のコールバック chain を Slint なしで再現する。コール
    // バック内では `state.borrow_mut().set_anchor(...)` などを呼んでいるだけで、
    // UI 操作 (refresh_*) は別 helper に分離されているため、state 側のフローを
    // ここで直接組み立てて end-to-end 動作を検証する。

    fn fixture_files(state: &DiffAppState) -> Vec<FileSourceEntry<'_>> {
        state
            .snapshot
            .files
            .iter()
            .map(|f| FileSourceEntry {
                file_id: &f.file_id,
                file_path: f.file_path.as_str(),
                before_content: f.before_content.as_deref(),
                after_content: f.after_content.as_deref(),
            })
            .collect()
    }

    fn click_line(state: &mut DiffAppState, file_index: usize, line: u32, side: Side) {
        // run_diff_viewer の on_select_line 相当の業務ロジック。
        let file = state.file(file_index).cloned().expect("file exists");
        let file_id = FileId::new(file.file_path.clone());
        if state.pending_range {
            let same_file = state
                .current_anchor
                .as_ref()
                .map(|a| a.file_id == file_id)
                .unwrap_or(false);
            if same_file {
                state.complete_range(&file_id, line, side);
                return;
            }
            state.pending_range = false;
        }
        state.set_anchor(SelectionAnchor {
            file_id,
            file_path: file.file_path,
            granularity: Granularity::Line { line, side },
        });
    }

    fn add_current_to_draft(state: &mut DiffAppState, note: Option<&str>) -> bool {
        // run_diff_viewer の on_add_to_draft と同じ trim / empty→None 変換を踏襲する。
        let Some(anchor) = state.current_anchor.clone() else {
            return false;
        };
        let note_opt = note
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(str::to_string);
        state.draft.push(DraftEntry::new(anchor, note_opt));
        true
    }

    #[test]
    fn flow_click_line_add_to_draft_produces_one_entry() {
        let mut st = make_state();
        click_line(&mut st, 0, 1, Side::After);
        assert!(add_current_to_draft(&mut st, Some("first note")));
        assert_eq!(st.draft.len(), 1);
        let entry = &st.draft.entries()[0];
        assert!(matches!(entry.anchor.granularity, Granularity::Line { line: 1, side: Side::After }));
        assert_eq!(entry.note.as_deref(), Some("first note"));
    }

    #[test]
    fn flow_extend_range_across_two_clicks() {
        let mut st = make_state();
        click_line(&mut st, 0, 1, Side::After);
        st.start_range_mode();
        click_line(&mut st, 0, 2, Side::After);
        match &st.current_anchor.as_ref().unwrap().granularity {
            Granularity::Range {
                start_line: 1,
                end_line: 2,
                side: Side::After,
            } => {}
            other => panic!("expected Range(1..=2, After), got {other:?}"),
        }
        assert!(!st.pending_range);
    }

    #[test]
    fn flow_multiple_drafts_accumulate_in_order() {
        let mut st = make_state();
        click_line(&mut st, 0, 1, Side::After);
        add_current_to_draft(&mut st, None);
        click_line(&mut st, 0, 2, Side::After);
        add_current_to_draft(&mut st, Some("second"));
        assert_eq!(st.draft.len(), 2);
        assert_eq!(st.draft.entries()[0].note, None);
        assert_eq!(st.draft.entries()[1].note.as_deref(), Some("second"));
    }

    #[test]
    fn flow_cancel_range_on_file_switch_clears_pending() {
        let mut st = make_state();
        click_line(&mut st, 0, 1, Side::After);
        st.start_range_mode();
        assert!(st.pending_range);
        st.cancel_range_on_file_switch();
        assert!(!st.pending_range);
        // anchor itself は維持される (file 切替後にユーザが再度 extend するため)
        assert!(st.current_anchor.is_some());
    }

    #[test]
    fn flow_format_prompt_includes_added_snippet() {
        let mut st = make_state();
        click_line(&mut st, 0, 2, Side::After);
        // note に snippet 同名 token を入れない (assert を tautology にしないため)
        assert!(add_current_to_draft(&mut st, Some("inspecting after side")));
        let files = fixture_files(&st);
        let preview = format_prompt(&st.draft, &files);
        // anchor label と note が preview に含まれていること
        assert!(preview.contains("a.rs"), "preview lacks file path: {preview}");
        assert!(
            preview.contains("inspecting after side"),
            "preview lacks note: {preview}"
        );
        // After 側 line 2 (= "B") の本文が snippet に出ていること。
        // note には "B" が無いので、コードフェンス内の "B" が assertion を保証する。
        assert!(
            preview.contains("\nB"),
            "preview lacks after-line content: {preview}"
        );
        assert!(
            !preview.contains("\na\n") || preview.contains("\nB"),
            "preview should include after content (B), not only before (a/b): {preview}"
        );
    }

    #[test]
    fn flow_add_to_draft_trims_note_and_empty_becomes_none() {
        let mut st = make_state();
        click_line(&mut st, 0, 1, Side::After);
        assert!(add_current_to_draft(&mut st, Some("   ")));
        assert_eq!(st.draft.entries()[0].note, None);

        click_line(&mut st, 0, 2, Side::After);
        assert!(add_current_to_draft(&mut st, Some("  hello  ")));
        assert_eq!(
            st.draft.entries()[1].note.as_deref(),
            Some("hello"),
            "note should be trimmed of surrounding whitespace"
        );
    }

    #[test]
    fn flow_remove_draft_entry_decreases_length() {
        let mut st = make_state();
        click_line(&mut st, 0, 1, Side::After);
        add_current_to_draft(&mut st, None);
        click_line(&mut st, 0, 2, Side::After);
        add_current_to_draft(&mut st, None);
        assert_eq!(st.draft.len(), 2);
        st.draft.remove(0);
        assert_eq!(st.draft.len(), 1);
    }
}
