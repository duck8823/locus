//! locus composition root.
//!
//! 起動モードは argv で切り替える:
//!
//! - `cargo run` / `cargo run -- <command>` — Terminal ペインモード
//! - `cargo run -- github <owner>/<repo>#<pr_number>` — Diff viewer モード

use std::cell::RefCell;
use std::rc::Rc;

use slint::{ComponentHandle, SharedString};

slint::include_modules!();

mod github;
mod review;
mod semantic;
mod terminal;
mod ui_state;

use github::pull_request::{
    build_client, fetch_pr_snapshot, parse_pr_spec, PullRequestFile, PullRequestSnapshot,
};
use review::draft::{DraftEntry, PromptDraft, SendMode};
use review::formatter::{format_prompt, FileSourceEntry};
use review::selection::{Granularity, SelectionAnchor, Side};
use review::snapshot::FileId;
use ui_state::diff_view::build_diff_file_views;
use ui_state::draft_view::{anchor_label, build_draft_entry_views, side_from_line_kind};

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let args: Vec<String> = std::env::args().skip(1).collect();

    match args.as_slice() {
        [mode, spec] if mode == "github" => run_diff_viewer(spec),
        [command] => run_terminal(command),
        [] => run_terminal("claude"),
        _ => {
            eprintln!("Usage:");
            eprintln!("  locus                          # terminal pane (claude)");
            eprintln!("  locus <command>                # terminal pane (custom cmd)");
            eprintln!("  locus github <owner>/<repo>#<pr_number>");
            std::process::exit(2);
        }
    }
}

fn run_terminal(command: &str) -> Result<(), Box<dyn std::error::Error>> {
    let ui = AppWindow::new()?;
    let _pane = terminal::launch(&ui, command)?;
    ui.run()?;
    Ok(())
}

/// 送信履歴の 1 エントリ。セッション内にのみ保持される。
#[derive(Debug, Clone)]
struct HistoryEntry {
    timestamp: String,
    mode: SendMode,
    anchors_label: String,
    #[allow(dead_code)]
    body: String,
}

/// Diff viewer mode 用の状態。Slint の複数コールバックから共有する。
struct DiffAppState {
    snapshot: PullRequestSnapshot,
    draft: PromptDraft,
    current_anchor: Option<SelectionAnchor>,
    pending_range: bool,
    history: Vec<HistoryEntry>,
}

impl DiffAppState {
    fn file(&self, index: usize) -> Option<&PullRequestFile> {
        self.snapshot.files.get(index)
    }

    fn set_anchor(&mut self, anchor: SelectionAnchor) {
        self.current_anchor = Some(anchor);
        self.pending_range = false;
    }

    fn start_range_mode(&mut self) {
        // range モードは「すでに Line 選択がある状態」で Range への昇格を宣言する。
        self.pending_range = true;
    }

    /// 現在の anchor と引数の line を使って Range 選択を作る。
    ///
    /// file_id を受け取り、現在の anchor と同じ file の場合にのみ Range 昇格する。
    /// 別 file の行がクリックされた場合や、side が異なる場合、pending は解除して
    /// anchor は変更しない。
    fn complete_range(&mut self, file_id: &FileId, line: u32, side: Side) {
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
    fn cancel_range_on_file_switch(&mut self) {
        self.pending_range = false;
    }
}

fn run_diff_viewer(spec: &str) -> Result<(), Box<dyn std::error::Error>> {
    let (owner, repo, pr_number) = parse_pr_spec(spec)
        .ok_or_else(|| format!("invalid PR spec: {spec} (expected owner/repo#N)"))?;

    let runtime = tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .build()?;

    let snapshot = runtime.block_on(async move {
        let client = build_client()?;
        fetch_pr_snapshot(&client, &owner, &repo, pr_number).await
    })?;

    let ui = DiffViewerWindow::new()?;
    ui.set_pr_title(SharedString::from(snapshot.title.as_str()));
    ui.set_head_sha(SharedString::from(short_sha(&snapshot.head_sha)));
    ui.set_base_sha(SharedString::from(short_sha(&snapshot.base_sha)));

    let file_views = build_diff_file_views(&snapshot.files);
    let model = std::rc::Rc::new(slint::VecModel::from(file_views));
    ui.set_files(slint::ModelRc::from(model));
    ui.set_selected_file_index(0);

    let state = Rc::new(RefCell::new(DiffAppState {
        snapshot,
        draft: PromptDraft::new(),
        current_anchor: None,
        pending_range: false,
        history: Vec::new(),
    }));

    // Terminal pane を立ち上げる。起動コマンドは LOCUS_AGENT_CMD 環境変数で
    // 上書きできる（既定は claude）。
    let agent_cmd =
        std::env::var("LOCUS_AGENT_CMD").unwrap_or_else(|_| "claude".to_string());
    let terminal_pane = match terminal::launch_for_diff_viewer(&ui, &agent_cmd) {
        Ok(p) => Some(Rc::new(p)),
        Err(e) => {
            eprintln!(
                "warn: failed to launch terminal pane with '{agent_cmd}': {e} (continuing without terminal)"
            );
            None
        }
    };

    refresh_current_anchor_label(&ui, &state);
    refresh_draft_panel(&ui, &state);
    refresh_history_panel(&ui, &state);
    refresh_preview(&ui, &state);

    // select-line
    {
        let state = state.clone();
        let ui_weak = ui.as_weak();
        ui.on_select_line(move |file_index, line_kind, old_no_str, new_no_str| {
            let Some(ui) = ui_weak.upgrade() else { return };
            let line = resolve_line_number(line_kind, &old_no_str, &new_no_str);
            let side = side_from_line_kind(line_kind);
            let mut st = state.borrow_mut();
            let Some(file) = st.file(file_index as usize).cloned() else {
                return;
            };
            let file_id = FileId::new(file.file_path.clone());
            if st.pending_range {
                // 現在の anchor と同じ file か 判定
                let same_file = st
                    .current_anchor
                    .as_ref()
                    .map(|a| a.file_id == file_id)
                    .unwrap_or(false);
                if same_file {
                    st.complete_range(&file_id, line, side);
                } else {
                    // 別 file をクリックしたので pending を解除して Line 選択に切り替える
                    st.pending_range = false;
                    st.set_anchor(SelectionAnchor {
                        file_id,
                        file_path: file.file_path,
                        granularity: Granularity::Line { line, side },
                    });
                }
            } else {
                st.set_anchor(SelectionAnchor {
                    file_id,
                    file_path: file.file_path,
                    granularity: Granularity::Line { line, side },
                });
            }
            drop(st);
            refresh_current_anchor_label(&ui, &state);
        });
    }

    // select-hunk
    {
        let state = state.clone();
        let ui_weak = ui.as_weak();
        ui.on_select_hunk(move |file_index, hunk_index| {
            let Some(ui) = ui_weak.upgrade() else { return };
            let mut st = state.borrow_mut();
            let Some(file) = st.file(file_index as usize).cloned() else {
                return;
            };
            st.set_anchor(SelectionAnchor {
                file_id: FileId::new(file.file_path.clone()),
                file_path: file.file_path,
                granularity: Granularity::Hunk {
                    hunk_index: hunk_index as usize,
                },
            });
            drop(st);
            refresh_current_anchor_label(&ui, &state);
        });
    }

    // select-whole-file
    {
        let state = state.clone();
        let ui_weak = ui.as_weak();
        ui.on_select_whole_file(move || {
            let Some(ui) = ui_weak.upgrade() else { return };
            let file_index = ui.get_selected_file_index() as usize;
            let mut st = state.borrow_mut();
            let Some(file) = st.file(file_index).cloned() else {
                return;
            };
            st.set_anchor(SelectionAnchor {
                file_id: FileId::new(file.file_path.clone()),
                file_path: file.file_path,
                granularity: Granularity::File,
            });
            drop(st);
            refresh_current_anchor_label(&ui, &state);
        });
    }

    // extend-to-range
    {
        let state = state.clone();
        let ui_weak = ui.as_weak();
        ui.on_extend_to_range(move || {
            let Some(ui) = ui_weak.upgrade() else { return };
            state.borrow_mut().start_range_mode();
            refresh_current_anchor_label(&ui, &state);
        });
    }

    // add-to-draft
    {
        let state = state.clone();
        let ui_weak = ui.as_weak();
        ui.on_add_to_draft(move |note: SharedString| {
            let Some(ui) = ui_weak.upgrade() else { return };
            let mut st = state.borrow_mut();
            let Some(anchor) = st.current_anchor.clone() else {
                return;
            };
            let note_trimmed = note.trim();
            let note_opt = if note_trimmed.is_empty() {
                None
            } else {
                Some(note_trimmed.to_string())
            };
            st.draft.push(DraftEntry::new(anchor, note_opt));
            drop(st);
            refresh_draft_panel(&ui, &state);
        });
    }

    // remove-draft-entry
    {
        let state = state.clone();
        let ui_weak = ui.as_weak();
        ui.on_remove_draft_entry(move |index: i32| {
            let Some(ui) = ui_weak.upgrade() else { return };
            state.borrow_mut().draft.remove(index as usize);
            refresh_draft_panel(&ui, &state);
        });
    }

    // clear-current-selection
    {
        let state = state.clone();
        let ui_weak = ui.as_weak();
        ui.on_clear_current_selection(move || {
            let Some(ui) = ui_weak.upgrade() else { return };
            let mut st = state.borrow_mut();
            st.current_anchor = None;
            st.pending_range = false;
            drop(st);
            refresh_current_anchor_label(&ui, &state);
        });
    }

    // file-switched: pending_range を解除する
    {
        let state = state.clone();
        let ui_weak = ui.as_weak();
        ui.on_file_switched(move |_| {
            let Some(ui) = ui_weak.upgrade() else { return };
            state.borrow_mut().cancel_range_on_file_switch();
            refresh_current_anchor_label(&ui, &state);
        });
    }

    // refresh-preview
    {
        let state = state.clone();
        let ui_weak = ui.as_weak();
        ui.on_refresh_preview(move || {
            let Some(ui) = ui_weak.upgrade() else { return };
            refresh_preview(&ui, &state);
        });
    }

    // send-insert-only
    {
        let state = state.clone();
        let ui_weak = ui.as_weak();
        let pane = terminal_pane.clone();
        ui.on_send_insert_only(move |text: SharedString| {
            let Some(ui) = ui_weak.upgrade() else { return };
            if let Some(p) = pane.as_ref() {
                p.insert(text.as_str());
            }
            append_history(&state, SendMode::InsertOnly, text.as_str());
            refresh_history_panel(&ui, &state);
        });
    }

    // send-insert-and-send
    {
        let state = state.clone();
        let ui_weak = ui.as_weak();
        let pane = terminal_pane.clone();
        ui.on_send_insert_and_send(move |text: SharedString| {
            let Some(ui) = ui_weak.upgrade() else { return };
            if let Some(p) = pane.as_ref() {
                p.insert_and_send(text.as_str());
            }
            append_history(&state, SendMode::InsertAndSend, text.as_str());
            refresh_history_panel(&ui, &state);
        });
    }

    // send-copy-to-clipboard
    {
        let state = state.clone();
        let ui_weak = ui.as_weak();
        ui.on_send_copy_to_clipboard(move |text: SharedString| {
            let Some(ui) = ui_weak.upgrade() else { return };
            if let Ok(mut cb) = arboard::Clipboard::new() {
                let _ = cb.set_text(text.to_string());
            }
            append_history(&state, SendMode::CopyToClipboard, text.as_str());
            refresh_history_panel(&ui, &state);
        });
    }

    ui.run()?;
    drop(terminal_pane);
    Ok(())
}

fn refresh_current_anchor_label(ui: &DiffViewerWindow, state: &Rc<RefCell<DiffAppState>>) {
    let st = state.borrow();
    let label = match &st.current_anchor {
        Some(a) => {
            let base = anchor_label(a);
            if st.pending_range {
                format!("{base}  [range mode: click end line]")
            } else {
                base
            }
        }
        None => "(no selection)".into(),
    };
    ui.set_current_anchor_label(SharedString::from(label));
}

fn refresh_draft_panel(ui: &DiffViewerWindow, state: &Rc<RefCell<DiffAppState>>) {
    let st = state.borrow();
    ui.set_draft_entries(build_draft_entry_views(&st.draft));
}

fn refresh_history_panel(ui: &DiffViewerWindow, state: &Rc<RefCell<DiffAppState>>) {
    let st = state.borrow();
    let model = slint::VecModel::<HistoryEntryView>::default();
    // 新しい順
    for entry in st.history.iter().rev() {
        model.push(HistoryEntryView {
            timestamp: SharedString::from(entry.timestamp.as_str()),
            mode: SharedString::from(send_mode_label(entry.mode)),
            label: SharedString::from(entry.anchors_label.as_str()),
        });
    }
    ui.set_history_entries(slint::ModelRc::from(
        std::rc::Rc::new(model) as std::rc::Rc<dyn slint::Model<Data = HistoryEntryView>>,
    ));
}

fn refresh_preview(ui: &DiffViewerWindow, state: &Rc<RefCell<DiffAppState>>) {
    let st = state.borrow();
    let entries: Vec<FileSourceEntry<'_>> = st
        .snapshot
        .files
        .iter()
        .map(|f| FileSourceEntry {
            file_id: &f.file_id,
            file_path: f.file_path.as_str(),
            before_content: f.before_content.as_deref(),
            after_content: f.after_content.as_deref(),
        })
        .collect();
    let text = format_prompt(&st.draft, &entries);
    ui.set_preview_text(SharedString::from(text));
}

fn append_history(state: &Rc<RefCell<DiffAppState>>, mode: SendMode, body: &str) {
    let mut st = state.borrow_mut();
    let anchors_label = if st.draft.is_empty() {
        "(edited preview)".to_string()
    } else {
        let count = st.draft.len();
        let head = st.draft.entries().first().map(|e| anchor_label(&e.anchor));
        match head {
            Some(h) if count == 1 => h,
            Some(h) => format!("{h} +{} more", count - 1),
            None => "(empty)".to_string(),
        }
    };
    let timestamp = current_hhmmss();
    st.history.push(HistoryEntry {
        timestamp,
        mode,
        anchors_label,
        body: body.to_string(),
    });
}

fn send_mode_label(mode: SendMode) -> &'static str {
    match mode {
        SendMode::InsertOnly => "Insert",
        SendMode::InsertAndSend => "Insert+Send",
        SendMode::CopyToClipboard => "Copy",
    }
}

fn current_hhmmss() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let h = (secs / 3600) % 24;
    let m = (secs / 60) % 60;
    let s = secs % 60;
    format!("{h:02}:{m:02}:{s:02}")
}

fn resolve_line_number(line_kind: i32, old_no: &str, new_no: &str) -> u32 {
    // Removed 行は old 側を、それ以外は new 側を優先する。
    // number が取れなければ old→new→0 のフォールバックでゼロ埋め。
    let prefer_old = line_kind == 2;
    let a = if prefer_old { old_no } else { new_no };
    let b = if prefer_old { new_no } else { old_no };
    a.parse::<u32>()
        .ok()
        .or_else(|| b.parse::<u32>().ok())
        .unwrap_or(0)
}

fn short_sha(sha: &str) -> String {
    sha.chars().take(7).collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::github::pull_request::{FileStatus, PullRequestFile};
    use crate::review::snapshot::{FileId, UnsupportedFile};
    use crate::review::target::ReviewTarget;

    fn make_state() -> DiffAppState {
        let snapshot = PullRequestSnapshot {
            target: ReviewTarget::GitHubPr {
                owner: "o".into(),
                repo: "r".into(),
                pr_number: 1,
            },
            title: "t".into(),
            head_sha: "abcdefg".into(),
            base_sha: "0000000".into(),
            files: vec![PullRequestFile {
                file_id: FileId::new("a.rs"),
                file_path: "a.rs".into(),
                status: FileStatus::Modified,
                before_content: Some("a\nb\n".into()),
                after_content: Some("a\nB\n".into()),
                patch: None,
                is_binary: false,
                unsupported: None::<UnsupportedFile>,
            }],
        };
        DiffAppState {
            snapshot,
            draft: PromptDraft::new(),
            current_anchor: None,
            pending_range: false,
            history: Vec::new(),
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

    #[test]
    fn resolve_line_number_prefers_old_for_removed() {
        assert_eq!(resolve_line_number(2, "10", "11"), 10);
    }

    #[test]
    fn resolve_line_number_prefers_new_for_added() {
        assert_eq!(resolve_line_number(1, "10", "11"), 11);
    }

    #[test]
    fn resolve_line_number_falls_back_to_other_side() {
        assert_eq!(resolve_line_number(1, "10", ""), 10);
        assert_eq!(resolve_line_number(2, "", "11"), 11);
    }

    #[test]
    fn short_sha_truncates_to_seven_chars() {
        assert_eq!(short_sha("abcdef1234567890"), "abcdef1");
    }

    #[test]
    fn short_sha_of_short_input_is_itself() {
        assert_eq!(short_sha("abc"), "abc");
    }
}
