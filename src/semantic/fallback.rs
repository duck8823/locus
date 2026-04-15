//! 言語非依存のフォールバック parser adapter。
//!
//! 言語が分からない、あるいは対応 adapter が無いファイルに対して 1 ファイル
//! = 1 symbol として扱う stub 実装。stable_key は `FileId` ベースにするため
//! rename に対しても id が安定する。

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
        // フォールバックは全言語を一応受け付ける。
        true
    }

    fn parse(&self, snapshot: &SourceSnapshot) -> ParsedSnapshot {
        ParsedSnapshot {
            file_id: snapshot.file_id.clone(),
            file_path: snapshot.file_path.clone(),
            adapter_name: Self::NAME.into(),
            language: snapshot.language.clone().unwrap_or_else(|| "unknown".into()),
            parser_version: None,
            raw: None,
        }
    }

    fn diff(
        &self,
        before: Option<&ParsedSnapshot>,
        after: Option<&ParsedSnapshot>,
    ) -> ParserDiffResult {
        let (language, stable_key, display_name, change_type) = match (before, after) {
            (None, None) => return ParserDiffResult::default(),
            (None, Some(a)) => (
                a.language.clone(),
                format!("{}::<file>", a.file_id.as_str()),
                a.file_path.clone(),
                ChangeType::Added,
            ),
            (Some(b), None) => (
                b.language.clone(),
                format!("{}::<file>", b.file_id.as_str()),
                b.file_path.clone(),
                ChangeType::Removed,
            ),
            (Some(b), Some(a)) => {
                // FileId は before/after で同一である前提。呼び出し側が揃える責務。
                let key = format!("{}::<file>", a.file_id.as_str());
                let change_type = if b.file_path != a.file_path {
                    ChangeType::Renamed
                } else {
                    ChangeType::Modified
                };
                (a.language.clone(), key, a.file_path.clone(), change_type)
            }
        };

        let item = ParserDiffItem {
            stable_key,
            display_name,
            kind: SymbolKind::Module,
            container: None,
            change_type,
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
    fn parse_keeps_file_id_and_path() {
        let adapter = FallbackLineParserAdapter::new();
        let parsed = adapter.parse(&sample_snapshot("src/a.rs", "fn a() {}"));
        assert_eq!(parsed.adapter_name, "fallback-line");
        assert_eq!(parsed.language, "unknown");
        assert_eq!(parsed.file_path, "src/a.rs");
        assert_eq!(parsed.file_id.as_str(), "src/a.rs");
        assert!(parsed.raw.is_none());
    }

    #[test]
    fn diff_modified_when_both_sides_match() {
        let adapter = FallbackLineParserAdapter::new();
        let before = adapter.parse(&sample_snapshot("src/a.rs", "old"));
        let after = adapter.parse(&sample_snapshot("src/a.rs", "new"));
        let r = adapter.diff(Some(&before), Some(&after));
        assert_eq!(r.items.len(), 1);
        assert_eq!(r.items[0].change_type, ChangeType::Modified);
        assert_eq!(r.items[0].display_name, "src/a.rs");
    }

    #[test]
    fn diff_added_when_before_is_none() {
        let adapter = FallbackLineParserAdapter::new();
        let after = adapter.parse(&sample_snapshot("src/new.rs", "new"));
        let r = adapter.diff(None, Some(&after));
        assert_eq!(r.items.len(), 1);
        assert_eq!(r.items[0].change_type, ChangeType::Added);
        assert_eq!(r.items[0].display_name, "src/new.rs");
    }

    #[test]
    fn diff_removed_when_after_is_none() {
        let adapter = FallbackLineParserAdapter::new();
        let before = adapter.parse(&sample_snapshot("src/gone.rs", "gone"));
        let r = adapter.diff(Some(&before), None);
        assert_eq!(r.items.len(), 1);
        assert_eq!(r.items[0].change_type, ChangeType::Removed);
        assert_eq!(r.items[0].display_name, "src/gone.rs");
    }

    #[test]
    fn diff_renamed_when_paths_differ_but_file_id_matches() {
        let adapter = FallbackLineParserAdapter::new();
        // 呼び出し側が同じ file_id を両方に与える想定
        let before = ParsedSnapshot {
            file_id: FileId::new("src/same-id"),
            file_path: "src/old.rs".into(),
            adapter_name: "fallback-line".into(),
            language: "unknown".into(),
            parser_version: None,
            raw: None,
        };
        let after = ParsedSnapshot {
            file_id: FileId::new("src/same-id"),
            file_path: "src/new.rs".into(),
            adapter_name: "fallback-line".into(),
            language: "unknown".into(),
            parser_version: None,
            raw: None,
        };
        let r = adapter.diff(Some(&before), Some(&after));
        assert_eq!(r.items.len(), 1);
        assert_eq!(r.items[0].change_type, ChangeType::Renamed);
        // stable_key は file_id ベース
        assert!(r.items[0].stable_key.starts_with("src/same-id"));
        // display_name は after 側
        assert_eq!(r.items[0].display_name, "src/new.rs");
    }

    #[test]
    fn diff_both_none_returns_empty() {
        let adapter = FallbackLineParserAdapter::new();
        let r = adapter.diff(None, None);
        assert!(r.items.is_empty());
        assert!(r.adapter_name.is_empty());
    }

    #[test]
    fn diff_is_object_safe_as_trait_object() {
        let adapter: Box<dyn ParserAdapter> = Box::new(FallbackLineParserAdapter::new());
        assert_eq!(adapter.adapter_name(), "fallback-line");
    }
}
