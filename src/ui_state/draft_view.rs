//! PromptDraft と SelectionAnchor を Slint の描画モデルに詰め替える。

use std::rc::Rc;

use slint::{Model, ModelRc, SharedString, VecModel};

use crate::review::draft::{DraftEntry, PromptDraft};
use crate::review::selection::{Granularity, SelectionAnchor, Side};
use crate::DraftEntryView;

pub fn anchor_label(anchor: &SelectionAnchor) -> String {
    let path = &anchor.file_path;
    match &anchor.granularity {
        Granularity::File => format!("{path} (file)"),
        Granularity::Hunk { hunk_index } => {
            format!("{path} (hunk #{hunk_index})")
        }
        Granularity::Range {
            start_line,
            end_line,
            side,
        } => {
            format!(
                "{path}:{start_line}-{end_line} ({})",
                side_label(*side)
            )
        }
        Granularity::Line { line, side } => {
            format!("{path}:{line} ({})", side_label(*side))
        }
    }
}

fn side_label(side: Side) -> &'static str {
    match side {
        Side::Before => "before",
        Side::After => "after",
    }
}

pub fn build_draft_entry_views(draft: &PromptDraft) -> ModelRc<DraftEntryView> {
    let model = VecModel::<DraftEntryView>::default();
    for entry in draft.entries() {
        model.push(draft_entry_view(entry));
    }
    ModelRc::from(Rc::new(model) as Rc<dyn Model<Data = DraftEntryView>>)
}

fn draft_entry_view(entry: &DraftEntry) -> DraftEntryView {
    DraftEntryView {
        label: SharedString::from(anchor_label(&entry.anchor)),
        note: SharedString::from(entry.note.clone().unwrap_or_default()),
    }
}

/// LineKind から選択の Side を決める。
///
/// Added / Context 行は head (After) を指している扱いにし、Removed 行は
/// base (Before) を指している扱いにする。
pub fn side_from_line_kind(kind: i32) -> Side {
    match kind {
        2 => Side::Before, // Removed
        _ => Side::After,  // Context(0), Added(1), HunkHeader(-1) も After 扱い
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::review::snapshot::FileId;

    fn anchor(gran: Granularity) -> SelectionAnchor {
        SelectionAnchor {
            file_id: FileId::new("a.rs"),
            file_path: "a.rs".into(),
            granularity: gran,
        }
    }

    #[test]
    fn label_for_line_granularity() {
        let a = anchor(Granularity::Line {
            line: 10,
            side: Side::After,
        });
        assert_eq!(anchor_label(&a), "a.rs:10 (after)");
    }

    #[test]
    fn label_for_range_granularity() {
        let a = anchor(Granularity::Range {
            start_line: 3,
            end_line: 7,
            side: Side::Before,
        });
        assert_eq!(anchor_label(&a), "a.rs:3-7 (before)");
    }

    #[test]
    fn label_for_hunk_granularity() {
        let a = anchor(Granularity::Hunk { hunk_index: 2 });
        assert_eq!(anchor_label(&a), "a.rs (hunk #2)");
    }

    #[test]
    fn label_for_file_granularity() {
        let a = anchor(Granularity::File);
        assert_eq!(anchor_label(&a), "a.rs (file)");
    }

    #[test]
    fn side_from_added_line_is_after() {
        assert_eq!(side_from_line_kind(1), Side::After);
    }

    #[test]
    fn side_from_removed_line_is_before() {
        assert_eq!(side_from_line_kind(2), Side::Before);
    }

    #[test]
    fn side_from_context_line_is_after() {
        assert_eq!(side_from_line_kind(0), Side::After);
    }
}
