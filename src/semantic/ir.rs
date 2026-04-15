//! Semantic Change IR。ADR 0004 に従って parser 実装から独立した形で
//! 変更を表現する。UI / 永続化 / 分析 enrichment はこの IR を消費する。

use crate::review::snapshot::FileId;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum SymbolKind {
    Function,
    Method,
    Class,
    Module,
    Unknown,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum ChangeType {
    Added,
    Removed,
    Modified,
    Moved,
    Renamed,
}

/// IR の 1 symbol に対する変更。
#[derive(Debug, Clone)]
pub struct SemanticChange {
    pub semantic_change_id: String,
    pub review_id: String,
    pub file_id: FileId,
    pub language: String,
    pub adapter_name: String,
    pub symbol: SymbolRef,
    pub change: SymbolChange,
    pub before: Option<CodeRegionRef>,
    pub after: Option<CodeRegionRef>,
}

#[derive(Debug, Clone)]
pub struct SymbolRef {
    pub stable_key: String,
    pub display_name: String,
    pub kind: SymbolKind,
    pub container: Option<String>,
}

#[derive(Debug, Clone)]
pub struct SymbolChange {
    pub change_type: ChangeType,
    pub signature_summary: Option<String>,
    pub body_summary: Option<String>,
}

#[derive(Debug, Clone)]
pub struct CodeRegionRef {
    pub file_path: String,
    pub start_line: u32,
    pub end_line: u32,
}

/// UI で表示する前の変更グループ。grouping アルゴリズムの結果。
#[derive(Debug, Clone, Default)]
pub struct SemanticChangeGroup {
    pub group_id: String,
    pub review_id: String,
    pub title: String,
    pub file_ids: Vec<FileId>,
    pub semantic_change_ids: Vec<String>,
    pub dominant_layer: Option<String>,
    pub status: GroupStatus,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum GroupStatus {
    #[default]
    Unread,
    InProgress,
    Reviewed,
}

/// 解析に乗らなかったファイルの明示記録。parser と UI 共通でこの型を使って
/// 「黙って落とさない」原則を満たす。
#[derive(Debug, Clone)]
pub struct UnsupportedFileAnalysis {
    pub review_id: String,
    pub file_id: FileId,
    pub file_path: String,
    pub language: Option<String>,
    pub reason: UnsupportedReason,
    pub detail: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum UnsupportedReason {
    UnsupportedLanguage,
    ParserFailed,
    BinaryFile,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn group_status_default_is_unread() {
        assert_eq!(GroupStatus::default(), GroupStatus::Unread);
    }

    #[test]
    fn semantic_change_group_default_is_empty() {
        let g = SemanticChangeGroup::default();
        assert!(g.title.is_empty());
        assert!(g.semantic_change_ids.is_empty());
        assert_eq!(g.status, GroupStatus::Unread);
    }

    #[test]
    fn change_type_equality() {
        assert_ne!(ChangeType::Added, ChangeType::Removed);
        assert_eq!(ChangeType::Modified, ChangeType::Modified);
    }

    #[test]
    fn symbol_kind_equality() {
        assert_ne!(SymbolKind::Function, SymbolKind::Method);
    }
}
