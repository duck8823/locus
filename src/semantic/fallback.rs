//! 言語非依存のフォールバック parser adapter。
//!
//! 言語が分からない、あるいは対応 adapter が無いファイルに対して 1 ファイル
//! = 1 symbol として扱う stub 実装。変更の粒度はファイル全体になるが、
//! それ以上の細分化が適切にできない場合のプレースホルダとして機能する。

use crate::review::snapshot::SourceSnapshot;

use super::adapter::{ParsedSnapshot, ParserAdapter, ParserDiffItem, ParserDiffResult};
use super::ir::{ChangeType, SymbolKind};

pub struct FallbackLineParserAdapter;

impl FallbackLineParserAdapter {
    pub const NAME: &'static str = "fallback-line";

    pub fn new() -> Self {
        Self
    }
}

impl Default for FallbackLineParserAdapter {
    fn default() -> Self {
        Self::new()
    }
}

impl ParserAdapter for FallbackLineParserAdapter {
    fn adapter_name(&self) -> &str {
        Self::NAME
    }

    fn supports_language(&self, _language: &str) -> bool {
        // フォールバックは全言語を一応受け付ける。具体 adapter が先に当たる
        // 前提で、最後の砦として使う。
        true
    }

    fn parse(&self, snapshot: &SourceSnapshot) -> ParsedSnapshot {
        ParsedSnapshot {
            adapter_name: Self::NAME.into(),
            language: snapshot.language.clone().unwrap_or_else(|| "unknown".into()),
            parser_version: None,
            file_path: snapshot.file_path.clone(),
        }
    }

    fn diff(&self, before: &ParsedSnapshot, after: &ParsedSnapshot) -> ParserDiffResult {
        let file_path = if !after.file_path.is_empty() {
            after.file_path.clone()
        } else {
            before.file_path.clone()
        };
        let language = if !after.language.is_empty() {
            after.language.clone()
        } else {
            before.language.clone()
        };
        let item = ParserDiffItem {
            stable_key: format!("{}::<file>", file_path),
            display_name: file_path.clone(),
            kind: SymbolKind::Module,
            container: None,
            change_type: ChangeType::Modified,
            signature_summary: None,
            body_summary: None,
        };
        ParserDiffResult {
            adapter_name: Self::NAME.into(),
            language,
            items: vec![item],
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::review::snapshot::{FileId, Revision};

    fn sample_snapshot(path: &str, content: &str) -> SourceSnapshot {
        SourceSnapshot {
            file_id: FileId::new(path),
            file_path: path.into(),
            language: Some("unknown".into()),
            revision: Revision::After,
            content: content.into(),
        }
    }

    #[test]
    fn adapter_name_is_stable() {
        let adapter = FallbackLineParserAdapter::new();
        assert_eq!(adapter.adapter_name(), "fallback-line");
    }

    #[test]
    fn supports_every_language() {
        let adapter = FallbackLineParserAdapter::new();
        assert!(adapter.supports_language("go"));
        assert!(adapter.supports_language("rust"));
        assert!(adapter.supports_language("brainfuck"));
    }

    #[test]
    fn parse_uses_snapshot_metadata() {
        let adapter = FallbackLineParserAdapter::new();
        let parsed = adapter.parse(&sample_snapshot("src/a.rs", "fn a() {}"));
        assert_eq!(parsed.adapter_name, "fallback-line");
        assert_eq!(parsed.language, "unknown");
        assert_eq!(parsed.file_path, "src/a.rs");
    }

    #[test]
    fn diff_returns_single_file_level_item() {
        let adapter = FallbackLineParserAdapter::new();
        let before = adapter.parse(&sample_snapshot("src/a.rs", "old"));
        let after = adapter.parse(&sample_snapshot("src/a.rs", "new"));
        let result = adapter.diff(&before, &after);
        assert_eq!(result.adapter_name, "fallback-line");
        assert_eq!(result.items.len(), 1);
        assert_eq!(result.items[0].display_name, "src/a.rs");
        assert_eq!(result.items[0].kind, SymbolKind::Module);
        assert_eq!(result.items[0].change_type, ChangeType::Modified);
    }

    #[test]
    fn diff_is_object_safe_as_trait_object() {
        let adapter: Box<dyn ParserAdapter> = Box::new(FallbackLineParserAdapter::new());
        assert_eq!(adapter.adapter_name(), "fallback-line");
    }
}
