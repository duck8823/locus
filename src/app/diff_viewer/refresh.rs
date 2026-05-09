//! Diff viewer の UI refresh / history 更新ヘルパ。
//!
//! Slint model への詰め替えや preview 再生成は callback 本体から分離し、
//! main.rs を composition root に近づける (#224 step 4)。

use std::cell::RefCell;
use std::rc::Rc;

use slint::{Model, ModelRc, SharedString, VecModel};

use crate::app::diff_viewer::state::{DiffAppState, HistoryEntry};
use crate::app::diff_viewer::util::{current_hhmmss, send_mode_label};
use crate::review::draft::SendMode;
use crate::review::formatter::{format_prompt, FileSourceEntry};
use crate::ui_state::draft_view::{anchor_label, build_draft_entry_views};
use crate::{DiffViewerWindow, HistoryEntryView, ToastView};

pub(crate) fn refresh_current_anchor_label(
    ui: &DiffViewerWindow,
    state: &Rc<RefCell<DiffAppState>>,
) {
    let st = state.borrow();
    let has_selection = st.current_anchor.is_some();
    let label = match &st.current_anchor {
        Some(a) => {
            let base = anchor_label(a);
            if st.pending_range {
                format!("{base}{}", crate::i18n::tr("  [range mode: click end line]"))
            } else {
                base
            }
        }
        None => crate::i18n::tr("(no selection)"),
    };
    ui.set_current_anchor_label(SharedString::from(label));
    ui.set_has_selection(has_selection);
}

pub(crate) fn refresh_draft_panel(ui: &DiffViewerWindow, state: &Rc<RefCell<DiffAppState>>) {
    let st = state.borrow();
    ui.set_draft_entries(build_draft_entry_views(&st.draft));
}

pub(crate) fn refresh_toasts(ui: &DiffViewerWindow, state: &Rc<RefCell<DiffAppState>>) {
    let st = state.borrow();
    let model = VecModel::<ToastView>::default();
    for t in &st.toasts {
        model.push(ToastView {
            id: t.id,
            kind: t.kind.to_int(),
            title: SharedString::from(t.title.as_str()),
            message: SharedString::from(t.message.as_str()),
        });
    }
    ui.set_toasts(ModelRc::from(
        Rc::new(model) as Rc<dyn Model<Data = ToastView>>,
    ));
}

pub(crate) fn refresh_history_panel(ui: &DiffViewerWindow, state: &Rc<RefCell<DiffAppState>>) {
    let st = state.borrow();
    let model = VecModel::<HistoryEntryView>::default();
    // 新しい順
    for entry in st.history.iter().rev() {
        model.push(HistoryEntryView {
            timestamp: SharedString::from(entry.timestamp.as_str()),
            mode: SharedString::from(send_mode_label(entry.mode)),
            label: SharedString::from(entry.anchors_label.as_str()),
        });
    }
    ui.set_history_entries(ModelRc::from(
        Rc::new(model) as Rc<dyn Model<Data = HistoryEntryView>>,
    ));
}

pub(crate) fn refresh_preview(ui: &DiffViewerWindow, state: &Rc<RefCell<DiffAppState>>) {
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
    // preview-length は Slint 側で root.preview-text.character-count から
    // 自動計算されるので Rust から set する必要はない。
}

pub(crate) fn append_history(
    state: &Rc<RefCell<DiffAppState>>,
    mode: SendMode,
    body: &str,
) {
    let mut st = state.borrow_mut();
    let anchors_label = if st.draft.is_empty() {
        crate::i18n::tr("(edited preview)")
    } else {
        let count = st.draft.len();
        let head = st.draft.entries().first().map(|e| anchor_label(&e.anchor));
        match head {
            Some(h) if count == 1 => h,
            Some(h) => {
                let extra = (count - 1).to_string();
                format!("{h} {}", crate::i18n::tr_args("+{} more", &[extra.as_str()]))
            }
            None => crate::i18n::tr("(empty)"),
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
