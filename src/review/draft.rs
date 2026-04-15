use super::selection::SelectionAnchor;

/// PromptDraft の 1 エントリ。選択 + 任意の note。
#[derive(Debug, Clone)]
pub struct DraftEntry {
    pub anchor: SelectionAnchor,
    pub note: Option<String>,
}

impl DraftEntry {
    pub fn new(anchor: SelectionAnchor, note: Option<String>) -> Self {
        Self { anchor, note }
    }
}

/// Terminal ペインに流す前の下書き。
///
/// 名前を "Comment" にしないのは、Locus が GitHub に write-back しないため。
/// このドラフトが届く先は PTY 上の Agent CLI である。
#[derive(Debug, Clone, Default)]
pub struct PromptDraft {
    entries: Vec<DraftEntry>,
}

impl PromptDraft {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn push(&mut self, entry: DraftEntry) {
        self.entries.push(entry);
    }

    pub fn remove(&mut self, index: usize) -> Option<DraftEntry> {
        if index < self.entries.len() {
            Some(self.entries.remove(index))
        } else {
            None
        }
    }

    pub fn entries(&self) -> &[DraftEntry] {
        &self.entries
    }

    pub fn is_empty(&self) -> bool {
        self.entries.is_empty()
    }

    pub fn len(&self) -> usize {
        self.entries.len()
    }

    pub fn clear(&mut self) {
        self.entries.clear();
    }
}

/// PTY / クリップボードへの送り方。
///
/// Codex 助言に従い、PTY busy 判定や queue は実装しない。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SendMode {
    /// 文字列を PTY に流し込むだけ。Enter は送らない。
    InsertOnly,
    /// 文字列 + CR を送る。誤爆を避けるため明示的な別操作に割り当てる。
    InsertAndSend,
    /// PTY ではなくクリップボードに書く。
    CopyToClipboard,
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::review::selection::{Granularity, Side};
    use crate::review::snapshot::FileId;

    fn sample_entry(note: Option<&str>) -> DraftEntry {
        DraftEntry::new(
            SelectionAnchor {
                file_id: FileId::new("a"),
                file_path: "a.rs".into(),
                granularity: Granularity::Line {
                    line: 1,
                    side: Side::After,
                },
            },
            note.map(str::to_string),
        )
    }

    #[test]
    fn push_and_len() {
        let mut draft = PromptDraft::new();
        assert!(draft.is_empty());
        draft.push(sample_entry(Some("first")));
        draft.push(sample_entry(None));
        assert_eq!(draft.len(), 2);
        assert!(!draft.is_empty());
    }

    #[test]
    fn remove_valid_index() {
        let mut draft = PromptDraft::new();
        draft.push(sample_entry(Some("a")));
        draft.push(sample_entry(Some("b")));
        let removed = draft.remove(0).unwrap();
        assert_eq!(removed.note.as_deref(), Some("a"));
        assert_eq!(draft.len(), 1);
        assert_eq!(draft.entries()[0].note.as_deref(), Some("b"));
    }

    #[test]
    fn remove_out_of_range_returns_none() {
        let mut draft = PromptDraft::new();
        draft.push(sample_entry(None));
        assert!(draft.remove(10).is_none());
        assert_eq!(draft.len(), 1);
    }

    #[test]
    fn clear_empties_the_draft() {
        let mut draft = PromptDraft::new();
        draft.push(sample_entry(None));
        draft.clear();
        assert!(draft.is_empty());
    }
}
