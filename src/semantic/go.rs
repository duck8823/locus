//! tree-sitter-go ベースの GoParserAdapter (#207 spike)。
//!
//! function_declaration / method_declaration を抽出し、body を
//! コメント除去 + 空白正規化した文字列で比較する。これにより
//! 「コメントのみ変更」「空白のみ変更」を Modified として誤検出しない。
//!
//! v0.2 spike なので rename 検出はしない（同じ stable_key の出現有無で
//! Added / Removed を出すのみ）。

use tree_sitter::{Language, Node, Parser};

use crate::review::snapshot::SourceSnapshot;

use super::adapter::{ParsedRaw, ParsedSnapshot, ParserAdapter, ParserDiffItem, ParserDiffResult};
use super::ir::{ChangeType, SymbolKind};

pub struct GoParserAdapter;

impl GoParserAdapter {
    pub const NAME: &'static str = "tree-sitter-go";
    pub const PARSER_VERSION: &'static str = "tree-sitter-go 0.25.0";
    pub const LANGUAGE: &'static str = "go";

    pub fn new() -> Self {
        Self
    }
}

impl Default for GoParserAdapter {
    fn default() -> Self {
        Self::new()
    }
}

#[derive(Debug, Clone)]
pub struct GoSymbol {
    pub stable_key: String,
    pub display_name: String,
    pub kind: SymbolKind,
    pub container: Option<String>,
    pub signature: String,
    pub body_normalized: String,
}

#[derive(Debug, Default)]
pub struct GoParseTree {
    pub symbols: Vec<GoSymbol>,
}

fn go_language() -> Language {
    tree_sitter_go::LANGUAGE.into()
}

fn extract_symbols(source: &str) -> GoParseTree {
    let mut parser = Parser::new();
    if parser.set_language(&go_language()).is_err() {
        return GoParseTree::default();
    }
    let Some(tree) = parser.parse(source, None) else {
        return GoParseTree::default();
    };
    let root = tree.root_node();
    let bytes = source.as_bytes();
    let mut symbols = Vec::new();
    for i in 0..(root.child_count() as u32) {
        let Some(child) = root.child(i) else { continue };
        match child.kind() {
            "function_declaration" => {
                if let Some(sym) = build_function_symbol(child, bytes) {
                    symbols.push(sym);
                }
            }
            "method_declaration" => {
                if let Some(sym) = build_method_symbol(child, bytes) {
                    symbols.push(sym);
                }
            }
            _ => {}
        }
    }
    GoParseTree { symbols }
}

fn build_function_symbol(node: Node, src: &[u8]) -> Option<GoSymbol> {
    let name_node = node.child_by_field_name("name")?;
    let name = name_node.utf8_text(src).ok()?.to_string();
    let signature = signature_text(node, src);
    let body_normalized = body_normalized(node, src);
    Some(GoSymbol {
        stable_key: format!("function::{name}"),
        display_name: name,
        kind: SymbolKind::Function,
        container: None,
        signature,
        body_normalized,
    })
}

fn build_method_symbol(node: Node, src: &[u8]) -> Option<GoSymbol> {
    let name_node = node.child_by_field_name("name")?;
    let name = name_node.utf8_text(src).ok()?.to_string();
    let receiver = node.child_by_field_name("receiver");
    let (recv_type, recv_name) = receiver
        .map(|r| extract_receiver_summary(r, src))
        .unwrap_or_default();
    let signature = signature_text(node, src);
    let body_normalized = body_normalized(node, src);
    let recv_label = if recv_type.is_empty() {
        "_".to_string()
    } else {
        recv_type.clone()
    };
    // stable_key には receiver の型と (あれば) 識別子名を入れる。
    // 同じ型に対して別名 receiver で同名 method を書いても衝突しないように
    // するための spike レベルの保険。
    let stable_key = match &recv_name {
        Some(rn) => format!("method::{recv_label}::{rn}::{name}"),
        None => format!("method::{recv_label}::{name}"),
    };
    let container = if recv_type.is_empty() {
        None
    } else {
        Some(recv_type)
    };
    let display_name = format!(
        "({}).{}",
        container.clone().unwrap_or_else(|| "_".into()),
        name
    );
    Some(GoSymbol {
        stable_key,
        display_name,
        kind: SymbolKind::Method,
        container,
        signature,
        body_normalized,
    })
}

fn extract_receiver_summary(node: Node, src: &[u8]) -> (String, Option<String>) {
    for i in 0..(node.child_count() as u32) {
        let Some(child) = node.child(i) else { continue };
        if child.kind() != "parameter_declaration" {
            continue;
        }
        let recv_name = child
            .child_by_field_name("name")
            .and_then(|n| n.utf8_text(src).ok())
            .map(str::to_string);
        let recv_type = child
            .child_by_field_name("type")
            .map(|ty| receiver_type_label(ty, src))
            .unwrap_or_default();
        return (recv_type, recv_name);
    }
    (String::new(), None)
}

fn receiver_type_label(node: Node, src: &[u8]) -> String {
    match node.kind() {
        "pointer_type" => {
            // pointer_type は `*` + 被参照型ノード。最後の子に被参照型が来る
            // 想定で walk する。
            let count = node.child_count() as u32;
            for i in (0..count).rev() {
                if let Some(inner) = node.child(i)
                    && inner.kind() != "*"
                {
                    return format!("*{}", receiver_type_label(inner, src));
                }
            }
            node.utf8_text(src).unwrap_or("").trim().to_string()
        }
        _ => node.utf8_text(src).unwrap_or("").trim().to_string(),
    }
}

fn signature_text(node: Node, src: &[u8]) -> String {
    let body = node.child_by_field_name("body");
    let end = body.map(|b| b.start_byte()).unwrap_or(node.end_byte());
    let start = node.start_byte();
    if end <= start || end > src.len() {
        return String::new();
    }
    let raw = std::str::from_utf8(&src[start..end])
        .unwrap_or("")
        .trim();
    raw.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn body_normalized(node: Node, src: &[u8]) -> String {
    let Some(body) = node.child_by_field_name("body") else {
        return String::new();
    };
    let mut buf = String::new();
    walk_non_comment(body, src, &mut buf);
    buf.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn walk_non_comment(node: Node, src: &[u8], buf: &mut String) {
    if node.kind() == "comment" {
        return;
    }
    let count = node.child_count();
    if count == 0 {
        if let Ok(t) = node.utf8_text(src) {
            buf.push_str(t);
            buf.push(' ');
        }
        return;
    }
    for i in 0..(count as u32) {
        if let Some(child) = node.child(i) {
            walk_non_comment(child, src, buf);
        }
    }
}

fn diff_items_from_trees(before: &GoParseTree, after: &GoParseTree) -> Vec<ParserDiffItem> {
    use std::collections::BTreeMap;
    let before_map: BTreeMap<&str, &GoSymbol> = before
        .symbols
        .iter()
        .map(|s| (s.stable_key.as_str(), s))
        .collect();
    let after_map: BTreeMap<&str, &GoSymbol> = after
        .symbols
        .iter()
        .map(|s| (s.stable_key.as_str(), s))
        .collect();

    let mut keys: Vec<&str> = before_map.keys().chain(after_map.keys()).copied().collect();
    keys.sort();
    keys.dedup();

    let mut items = Vec::new();
    for key in keys {
        match (before_map.get(key), after_map.get(key)) {
            (None, Some(a)) => items.push(symbol_to_item(a, ChangeType::Added)),
            (Some(b), None) => items.push(symbol_to_item(b, ChangeType::Removed)),
            (Some(b), Some(a)) => {
                if b.signature == a.signature && b.body_normalized == a.body_normalized {
                    continue;
                }
                items.push(symbol_to_item(a, ChangeType::Modified));
            }
            (None, None) => {}
        }
    }
    items
}

fn symbol_to_item(sym: &GoSymbol, change_type: ChangeType) -> ParserDiffItem {
    ParserDiffItem {
        stable_key: sym.stable_key.clone(),
        display_name: sym.display_name.clone(),
        kind: sym.kind,
        container: sym.container.clone(),
        change_type,
        signature_summary: Some(sym.signature.clone()),
        body_summary: None,
    }
}

impl ParserAdapter for GoParserAdapter {
    fn adapter_name(&self) -> &str {
        Self::NAME
    }

    fn supports_language(&self, language: &str) -> bool {
        let lower = language.to_ascii_lowercase();
        lower == "go" || lower == "golang"
    }

    fn parse(&self, snapshot: &SourceSnapshot) -> ParsedSnapshot {
        let tree = extract_symbols(&snapshot.content);
        let raw: ParsedRaw = Box::new(tree);
        ParsedSnapshot {
            file_id: snapshot.file_id.clone(),
            file_path: snapshot.file_path.clone(),
            adapter_name: Self::NAME.into(),
            language: snapshot
                .language
                .clone()
                .unwrap_or_else(|| Self::LANGUAGE.into()),
            parser_version: Some(Self::PARSER_VERSION.into()),
            raw: Some(raw),
        }
    }

    fn diff(
        &self,
        before: Option<&ParsedSnapshot>,
        after: Option<&ParsedSnapshot>,
    ) -> ParserDiffResult {
        let language = before
            .map(|b| b.language.clone())
            .or_else(|| after.map(|a| a.language.clone()))
            .unwrap_or_else(|| Self::LANGUAGE.into());

        let empty = GoParseTree::default();
        let before_tree = before
            .and_then(|s| s.raw.as_ref())
            .and_then(|r| r.downcast_ref::<GoParseTree>())
            .unwrap_or(&empty);
        let after_tree = after
            .and_then(|s| s.raw.as_ref())
            .and_then(|r| r.downcast_ref::<GoParseTree>())
            .unwrap_or(&empty);

        if before.is_none() && after.is_none() {
            return ParserDiffResult::default();
        }

        let items = diff_items_from_trees(before_tree, after_tree);
        ParserDiffResult {
            adapter_name: Self::NAME.into(),
            language,
            items,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::review::snapshot::{FileId, Revision};

    fn make_snapshot(path: &str, content: &str) -> SourceSnapshot {
        SourceSnapshot {
            file_id: FileId::new(path),
            file_path: path.into(),
            language: Some("go".into()),
            revision: Revision::After,
            content: content.into(),
        }
    }

    fn parse(content: &str) -> ParsedSnapshot {
        GoParserAdapter::new().parse(&make_snapshot("a.go", content))
    }

    #[test]
    fn supports_go_and_golang_case_insensitive() {
        let a = GoParserAdapter::new();
        assert!(a.supports_language("go"));
        assert!(a.supports_language("Go"));
        assert!(a.supports_language("golang"));
        assert!(!a.supports_language("rust"));
    }

    #[test]
    fn extracts_function_symbol() {
        let p = parse("package main\n\nfunc Hello() string { return \"hi\" }\n");
        let tree = p.raw.as_ref().unwrap().downcast_ref::<GoParseTree>().unwrap();
        assert_eq!(tree.symbols.len(), 1);
        assert_eq!(tree.symbols[0].stable_key, "function::Hello");
        assert_eq!(tree.symbols[0].display_name, "Hello");
        assert_eq!(tree.symbols[0].kind, SymbolKind::Function);
    }

    #[test]
    fn extracts_method_with_receiver() {
        let src = "package main\n\
             type S struct{}\n\
             func (s *S) Do() {}\n\
             func (s S) DoVal() {}\n";
        let p = parse(src);
        let tree = p.raw.as_ref().unwrap().downcast_ref::<GoParseTree>().unwrap();
        let keys: Vec<&str> = tree.symbols.iter().map(|s| s.stable_key.as_str()).collect();
        assert!(keys.contains(&"method::*S::s::Do"), "keys: {keys:?}");
        assert!(keys.contains(&"method::S::s::DoVal"), "keys: {keys:?}");
    }

    #[test]
    fn diff_added_function() {
        let adapter = GoParserAdapter::new();
        let before = adapter.parse(&make_snapshot("a.go", "package main\n"));
        let after = adapter.parse(&make_snapshot(
            "a.go",
            "package main\nfunc New() {}\n",
        ));
        let r = adapter.diff(Some(&before), Some(&after));
        assert_eq!(r.items.len(), 1);
        assert_eq!(r.items[0].change_type, ChangeType::Added);
        assert_eq!(r.items[0].stable_key, "function::New");
    }

    #[test]
    fn diff_removed_function() {
        let adapter = GoParserAdapter::new();
        let before = adapter.parse(&make_snapshot(
            "a.go",
            "package main\nfunc Old() {}\n",
        ));
        let after = adapter.parse(&make_snapshot("a.go", "package main\n"));
        let r = adapter.diff(Some(&before), Some(&after));
        assert_eq!(r.items.len(), 1);
        assert_eq!(r.items[0].change_type, ChangeType::Removed);
        assert_eq!(r.items[0].stable_key, "function::Old");
    }

    #[test]
    fn diff_modified_method_body() {
        let adapter = GoParserAdapter::new();
        let before = adapter.parse(&make_snapshot(
            "a.go",
            "package main\n\
             type S struct{}\n\
             func (s *S) Do() int { return 1 }\n",
        ));
        let after = adapter.parse(&make_snapshot(
            "a.go",
            "package main\n\
             type S struct{}\n\
             func (s *S) Do() int { return 2 }\n",
        ));
        let r = adapter.diff(Some(&before), Some(&after));
        assert_eq!(r.items.len(), 1);
        assert_eq!(r.items[0].change_type, ChangeType::Modified);
        assert_eq!(r.items[0].kind, SymbolKind::Method);
        assert_eq!(r.items[0].stable_key, "method::*S::s::Do");
    }

    #[test]
    fn diff_ignores_whitespace_only_change() {
        let adapter = GoParserAdapter::new();
        let before = adapter.parse(&make_snapshot(
            "a.go",
            "package main\nfunc F() int { return 1 }\n",
        ));
        let after = adapter.parse(&make_snapshot(
            "a.go",
            "package main\nfunc F() int {\n\treturn 1\n}\n",
        ));
        let r = adapter.diff(Some(&before), Some(&after));
        assert!(r.items.is_empty(), "items: {:?}", r.items);
    }

    #[test]
    fn diff_ignores_comment_only_change() {
        let adapter = GoParserAdapter::new();
        let before = adapter.parse(&make_snapshot(
            "a.go",
            "package main\nfunc F() int { return 1 }\n",
        ));
        let after = adapter.parse(&make_snapshot(
            "a.go",
            "package main\nfunc F() int {\n\t// new comment\n\treturn 1 // trailing\n}\n",
        ));
        let r = adapter.diff(Some(&before), Some(&after));
        assert!(r.items.is_empty(), "items: {:?}", r.items);
    }

    #[test]
    fn diff_signature_change_is_modified() {
        let adapter = GoParserAdapter::new();
        let before = adapter.parse(&make_snapshot(
            "a.go",
            "package main\nfunc F(x int) int { return x }\n",
        ));
        let after = adapter.parse(&make_snapshot(
            "a.go",
            "package main\nfunc F(x int, y int) int { return x }\n",
        ));
        let r = adapter.diff(Some(&before), Some(&after));
        assert_eq!(r.items.len(), 1);
        assert_eq!(r.items[0].change_type, ChangeType::Modified);
    }

    #[test]
    fn diff_added_only_when_before_is_none() {
        let adapter = GoParserAdapter::new();
        let after = adapter.parse(&make_snapshot(
            "a.go",
            "package main\nfunc A() {}\nfunc B() {}\n",
        ));
        let r = adapter.diff(None, Some(&after));
        let kinds: Vec<ChangeType> = r.items.iter().map(|i| i.change_type).collect();
        assert_eq!(kinds, vec![ChangeType::Added, ChangeType::Added]);
    }

    #[test]
    fn diff_both_none_returns_empty() {
        let adapter = GoParserAdapter::new();
        let r = adapter.diff(None, None);
        assert!(r.items.is_empty());
        assert!(r.adapter_name.is_empty());
    }

    #[test]
    fn parse_invalid_go_does_not_panic() {
        // tree-sitter は構文エラーがあっても部分的に解析するので panic しない
        // ことを確認する。symbols が 0 になっても OK。
        let adapter = GoParserAdapter::new();
        let p = adapter.parse(&make_snapshot("a.go", "package main\nfunc {{{"));
        let _tree = p.raw.as_ref().unwrap().downcast_ref::<GoParseTree>().unwrap();
    }
}
