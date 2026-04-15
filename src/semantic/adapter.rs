//! Parser adapter 境界。具体実装（tree-sitter-go など）は本 trait を
//! 満たす形で別 Issue で追加する。adapter の return 型は [`ParserDiffItem`]
//! の配列。これを呼び出し側が [`crate::semantic::ir::SemanticChange`] に
//! 詰め替える。

use std::any::Any;

use crate::review::snapshot::{FileId, SourceSnapshot};

/// parser-native な内部状態（AST、symbol table 等）を渡せるようにするための
/// opaque なバッグ。具体 adapter は自分の型を `Box<dyn Any + Send + Sync>`
/// に詰めて [`ParsedSnapshot::raw`] に入れ、diff 側で downcast して取り出す。
pub type ParsedRaw = Box<dyn Any + Send + Sync>;

/// parser が解析済みスナップショットとして保持する中間表現。
///
/// ADR 0004 / semantic-analysis-pipeline に従い、パース結果の正本は parser
/// native なデータ（AST 等）であり、本構造体はそれを抱える opaque な
/// 入れ物として振る舞う。
pub struct ParsedSnapshot {
    /// `SourceSnapshot.file_id` をそのまま引き継ぐ。rename でも stable。
    pub file_id: FileId,
    /// UI 表示用の path。rename で before/after で変わり得る。
    pub file_path: String,
    pub adapter_name: String,
    pub language: String,
    pub parser_version: Option<String>,
    /// parser-native な内部状態。`Any` で downcast してアクセスする。
    pub raw: Option<ParsedRaw>,
}

impl std::fmt::Debug for ParsedSnapshot {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("ParsedSnapshot")
            .field("file_id", &self.file_id)
            .field("file_path", &self.file_path)
            .field("adapter_name", &self.adapter_name)
            .field("language", &self.language)
            .field("parser_version", &self.parser_version)
            .field("raw", &self.raw.as_ref().map(|_| "<opaque>"))
            .finish()
    }
}

/// diff 結果に現れる 1 symbol。
#[derive(Debug, Clone)]
pub struct ParserDiffItem {
    /// 変化を追跡するための安定キー。たとえば `module::Type::method`。
    pub stable_key: String,
    /// UI に出す表示名。通常は識別子そのもの。
    pub display_name: String,
    pub kind: super::ir::SymbolKind,
    pub container: Option<String>,
    pub change_type: super::ir::ChangeType,
    pub signature_summary: Option<String>,
    pub body_summary: Option<String>,
}

/// 1 ファイル分の adapter 出力。
#[derive(Debug, Clone, Default)]
pub struct ParserDiffResult {
    pub adapter_name: String,
    pub language: String,
    pub items: Vec<ParserDiffItem>,
}

/// 言語固有 parser と共通 IR の間を橋渡しする境界 trait。
///
/// v0.1 段階では同期のみ想定。
pub trait ParserAdapter: Send + Sync {
    fn adapter_name(&self) -> &str;
    fn supports_language(&self, language: &str) -> bool;

    /// 1 スナップショットを解析して中間表現にする。
    fn parse(&self, snapshot: &SourceSnapshot) -> ParsedSnapshot;

    /// before / after の中間表現から diff 結果を作る。
    ///
    /// ADR 0004 に従い、片側のみ存在するケース（added / removed）にも
    /// 対応できるよう `Option<&ParsedSnapshot>` を受ける。両方 `None` の
    /// 呼び出しは仕様外とみなし、空の [`ParserDiffResult`] を返してよい。
    /// rename の場合、呼び出し側が同一 `file_id` で before/after 両方の
    /// `ParsedSnapshot` を渡す責務を持つ（path は変わってよい）。
    fn diff(
        &self,
        before: Option<&ParsedSnapshot>,
        after: Option<&ParsedSnapshot>,
    ) -> ParserDiffResult;
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parser_diff_result_default_is_empty() {
        let r = ParserDiffResult::default();
        assert!(r.adapter_name.is_empty());
        assert!(r.items.is_empty());
    }

    #[test]
    fn parsed_snapshot_can_hold_opaque_raw() {
        struct MyAst(#[allow(dead_code)] u32);
        let raw: ParsedRaw = Box::new(MyAst(42));
        let snap = ParsedSnapshot {
            file_id: FileId::new("a.rs"),
            file_path: "a.rs".into(),
            adapter_name: "t".into(),
            language: "rust".into(),
            parser_version: None,
            raw: Some(raw),
        };
        assert!(snap.raw.is_some());
        let downcast = snap.raw.as_ref().unwrap().downcast_ref::<MyAst>();
        assert!(downcast.is_some());
    }
}
