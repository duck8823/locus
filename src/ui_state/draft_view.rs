//! PromptDraft と SelectionAnchor を Slint の描画モデルに詰め替える。

use std::rc::Rc;

use slint::{Model, ModelRc, SharedString, VecModel};

use crate::review::draft::{DraftEntry, PromptDraft};
use crate::review::selection::{Granularity, SelectionAnchor, Side};
use crate::DraftEntryView;

pub fn anchor_label(anchor: &SelectionAnchor) -> String {
    let path = anchor.file_path.as_str();
    match &anchor.granularity {
        Granularity::File => crate::i18n::tr_args("{} (file)", &[path]),
        Granularity::Hunk { hunk_index } => {
            let idx = hunk_index.to_string();
            crate::i18n::tr_args("{} (hunk #{})", &[path, idx.as_str()])
        }
        Granularity::Range {
            start_line,
            end_line,
            side,
        } => {
            let from = start_line.to_string();
            let to = end_line.to_string();
            let side = crate::i18n::tr(side_key(*side));
            crate::i18n::tr_args(
                "{}:{}-{} ({})",
                &[path, from.as_str(), to.as_str(), side.as_str()],
            )
        }
        Granularity::Line { line, side } => {
            let line_str = line.to_string();
            let side = crate::i18n::tr(side_key(*side));
            crate::i18n::tr_args("{}:{} ({})", &[path, line_str.as_str(), side.as_str()])
        }
    }
}

fn side_key(side: Side) -> &'static str {
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

    // 翻訳結果は locale 依存なので、構造的にキー要素 (path / 数字) が含まれることだけを検査する。
    #[test]
    fn label_for_line_granularity_contains_path_and_line() {
        let a = anchor(Granularity::Line {
            line: 10,
            side: Side::After,
        });
        let label = anchor_label(&a);
        assert!(label.contains("a.rs"));
        assert!(label.contains("10"));
    }

    #[test]
    fn label_for_range_granularity_contains_span() {
        let a = anchor(Granularity::Range {
            start_line: 3,
            end_line: 7,
            side: Side::Before,
        });
        let label = anchor_label(&a);
        assert!(label.contains("3"));
        assert!(label.contains("7"));
    }

    #[test]
    fn label_for_hunk_granularity_contains_index() {
        let a = anchor(Granularity::Hunk { hunk_index: 2 });
        let label = anchor_label(&a);
        assert!(label.contains("a.rs"));
        assert!(label.contains("2"));
    }

    #[test]
    fn label_for_file_granularity_contains_path() {
        let a = anchor(Granularity::File);
        let label = anchor_label(&a);
        assert!(label.contains("a.rs"));
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
