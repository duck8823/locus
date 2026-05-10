//! Semantic diff 境界。ADR 0004 に従い、parser-adapter と共通 Semantic
//! Change IR を型として置く。具体実装 (tree-sitter-go など) は v0.2 以降で
//! 積むため、v0.1 時点では契約とフォールバック stub のみ用意する。

#![allow(dead_code, unused_imports)]

pub mod adapter;
pub mod analyze;
pub mod architecture;
pub mod fallback;
pub mod go;
pub mod ir;

pub use adapter::{ParsedSnapshot, ParserAdapter, ParserDiffItem, ParserDiffResult};
pub use analyze::analyze_pull_request_file;
pub use architecture::{ArchitectureNode, ArchitectureNodeKind, build_architecture_nodes};
pub use fallback::FallbackLineParserAdapter;
pub use go::GoParserAdapter;
pub use ir::{ChangeType, SemanticChange, SemanticChangeGroup, SymbolKind, UnsupportedFileAnalysis};
