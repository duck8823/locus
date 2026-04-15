//! Parser adapter 境界。具体実装（tree-sitter-go など）は本 trait を
//! 満たす形で別 Issue で追加する。adapter の return 型は [`ParserDiffItem`]
//! の配列。これを呼び出し側が [`crate::semantic::ir::SemanticChange`] に
//! 詰め替える。

use crate::review::snapshot::SourceSnapshot;

use super::ir::{ChangeType, SymbolKind};

/// parser が解析済みスナップショットとして保持する中間表現。
///
/// adapter 固有のデータ（tree-sitter の syntax tree 等）は不透明な
/// バッグとして `raw_token` に詰めても良い。ここでは最小限の情報のみ持つ。
#[derive(Debug, Clone)]
pub struct ParsedSnapshot {
    pub adapter_name: String,
    pub language: String,
    pub parser_version: Option<String>,
    pub file_path: String,
}

/// diff 結果に現れる 1 symbol。
#[derive(Debug, Clone)]
pub struct ParserDiffItem {
    /// 変化を追跡するための安定キー。たとえば `module::Type::method`。
    pub stable_key: String,
    /// UI に出す表示名。通常は識別子そのもの。
    pub display_name: String,
    pub kind: SymbolKind,
    /// コンテナ（クラス名や modlue）のある言語向け。
    pub container: Option<String>,
    pub change_type: ChangeType,
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
/// 具体実装は Object Safety を壊さない範囲で async/blocking を選べるが、
/// v0.1 段階では同期のみを想定する。
pub trait ParserAdapter: Send + Sync {
    fn adapter_name(&self) -> &str;
    fn supports_language(&self, language: &str) -> bool;

    /// 1 スナップショットを解析して中間表現にする。
    fn parse(&self, snapshot: &SourceSnapshot) -> ParsedSnapshot;

    /// before / after の中間表現から diff 結果を作る。
    ///
    /// 実装側は symbol 単位の追加・削除・変更を列挙する責任を持つ。
    fn diff(&self, before: &ParsedSnapshot, after: &ParsedSnapshot) -> ParserDiffResult;
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
}
