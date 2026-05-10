//! Architecture mini-map (#208)。
//!
//! Go の import グラフを使って、変更された関数・メソッドの 1 hop 上流 / 下流を
//! 列挙する小さなビューを作る。precise な caller/callee 解析はせず、package
//! 単位の import 関係に留める。
//!
//! 入力は PR の `PullRequestFile` 配列。Go かつ supported なファイルだけを対象に、
//! file-level の変更シンボル / file が import している外部 path / PR 内の他
//! ファイルが import している package を 1 つのフラットな `ArchitectureNode`
//! 配列にまとめる。
//!
//! UI 側はこの配列をそのまま縦並びの mini-map として表示し、ノードクリックで
//! `file_index` の指す PR ファイルにジャンプする。`line_no` が乗っている
//! ノード（changed symbol）は該当行までスクロールする。

use crate::github::pull_request::PullRequestFile;
use crate::semantic::analyze::analyze_pull_request_file;
use crate::semantic::go::{GoParseTree, GoParserAdapter};
use crate::semantic::ir::ChangeType;

/// 1 ノードがどの種類かを示す。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ArchitectureNodeKind {
    /// このファイルの変更シンボル本体。クリックでファイル＋シンボル行にジャンプ。
    Center,
    /// このファイルが import している package（1 hop 下流）。
    Downstream,
    /// PR 内の他ファイルがこのファイルの package を import している（1 hop 上流）。
    Upstream,
}

/// mini-map に並ぶ 1 ノード。UI に渡しやすいよう値型のみで構成する。
#[derive(Debug, Clone)]
pub struct ArchitectureNode {
    pub kind: ArchitectureNodeKind,
    /// 第一行（symbol 名 / import path / 他ファイル path）。
    pub label: String,
    /// 第二行（focus ファイル path や 補足）。空文字でも OK。
    pub detail: String,
    /// PR 内ファイルに解決できる場合の index。external import 等は None。
    pub file_index: Option<usize>,
    /// symbol の開始行 (1-indexed)。Center 以外は None。
    pub line_no: Option<u32>,
}

/// 1 focus ファイルあたりの downstream / upstream ノードの上限。表示過多防止。
const PER_FILE_NEIGHBOR_CAP: usize = 5;

/// 全ファイル合計のノード数の上限。さらに溢れた分は捨てる（mini-map 用途）。
const TOTAL_NODE_CAP: usize = 24;

/// PR 全体から architecture mini-map のノード列を作る。
///
/// 順序:
///   focus file ごとに [Center..., Downstream..., Upstream...] を並べる。
///   focus file は PR の `files` 並び順を保つ。
pub fn build_architecture_nodes(files: &[PullRequestFile]) -> Vec<ArchitectureNode> {
    let go_files = collect_go_files(files);
    let mut nodes: Vec<ArchitectureNode> = Vec::new();

    for focus in &go_files {
        if focus.changed_symbols.is_empty() {
            continue;
        }

        // Center: 変更された symbol。複数あれば全部出すが TOTAL_NODE_CAP には従う。
        for sym in &focus.changed_symbols {
            push_capped(
                &mut nodes,
                ArchitectureNode {
                    kind: ArchitectureNodeKind::Center,
                    label: sym.display.clone(),
                    detail: focus.file_path.clone(),
                    file_index: Some(focus.file_index),
                    line_no: Some(sym.start_line),
                },
            );
            if nodes.len() >= TOTAL_NODE_CAP {
                return nodes;
            }
        }

        // Downstream: focus file の import path を出す (PR 内ファイルなら index 解決)。
        let mut downstream_emitted = 0usize;
        let mut downstream_seen: Vec<&str> = Vec::new();
        for import_path in &focus.imports {
            if downstream_seen.contains(&import_path.as_str()) {
                continue;
            }
            downstream_seen.push(import_path.as_str());
            if downstream_emitted >= PER_FILE_NEIGHBOR_CAP {
                push_capped(
                    &mut nodes,
                    ArchitectureNode {
                        kind: ArchitectureNodeKind::Downstream,
                        label: format!("+{} more", focus.imports.len() - downstream_emitted),
                        detail: focus.file_path.clone(),
                        file_index: None,
                        line_no: None,
                    },
                );
                break;
            }
            let resolved = resolve_internal_target(import_path, &go_files);
            push_capped(
                &mut nodes,
                ArchitectureNode {
                    kind: ArchitectureNodeKind::Downstream,
                    label: import_path.clone(),
                    detail: focus.file_path.clone(),
                    file_index: resolved,
                    line_no: None,
                },
            );
            downstream_emitted += 1;
            if nodes.len() >= TOTAL_NODE_CAP {
                return nodes;
            }
        }

        // Upstream: PR 内の他 Go ファイルで focus.package_dir を import suffix
        // として持つものを列挙する。package name だけの一致は stdlib/external
        // import と誤結合しやすいため使わない。
        let upstream_targets = upstream_caller_indices(focus, &go_files);
        for (upstream_emitted, &caller_idx) in upstream_targets.iter().enumerate() {
            if upstream_emitted >= PER_FILE_NEIGHBOR_CAP {
                push_capped(
                    &mut nodes,
                    ArchitectureNode {
                        kind: ArchitectureNodeKind::Upstream,
                        label: format!("+{} more", upstream_targets.len() - upstream_emitted),
                        detail: focus.file_path.clone(),
                        file_index: None,
                        line_no: None,
                    },
                );
                break;
            }
            let caller = &go_files[caller_idx];
            push_capped(
                &mut nodes,
                ArchitectureNode {
                    kind: ArchitectureNodeKind::Upstream,
                    label: caller.file_path.clone(),
                    detail: focus.file_path.clone(),
                    file_index: Some(caller.file_index),
                    line_no: None,
                },
            );
            if nodes.len() >= TOTAL_NODE_CAP {
                return nodes;
            }
        }
    }

    nodes
}

/// 1 changed Go file に集約した内部表現。
#[derive(Debug, Clone)]
struct GoFileSummary {
    /// PR の `files[]` における index。UI からのクリック解決に使う。
    file_index: usize,
    file_path: String,
    /// `file_path` から取り出したパッケージのディレクトリパス。
    /// 例: `internal/foo/bar.go` -> `internal/foo`。
    package_dir: String,
    imports: Vec<String>,
    changed_symbols: Vec<ChangedSymbol>,
}

#[derive(Debug, Clone)]
struct ChangedSymbol {
    display: String,
    start_line: u32,
}

fn collect_go_files(files: &[PullRequestFile]) -> Vec<GoFileSummary> {
    let mut out = Vec::new();
    for (idx, file) in files.iter().enumerate() {
        if file.is_binary || file.unsupported.is_some() {
            continue;
        }
        if !is_go_file(&file.file_path) {
            continue;
        }

        let result = analyze_pull_request_file(file);
        if result.adapter_name != GoParserAdapter::NAME {
            // 言語検出は通ったが adapter routing が Go でないケース。
            // たとえば before/after 両方欠落で空結果が返ったような場合にここで弾く。
            continue;
        }

        // 解析木が無いと imports が取れないので after を再パース。
        // run_go_parser は ParserDiffResult しか返さないので、改めて raw 取得用に
        // GoParserAdapter で parse し直す。
        let after_tree = parse_go_tree_for_after(file);

        let imports = after_tree
            .as_ref()
            .map(|t| t.imports.clone())
            .unwrap_or_default();
        let package_dir = parent_dir(&file.file_path).to_string();

        let mut changed_symbols = Vec::new();
        for item in result.items {
            // file-level rename (Module) は Center に出さない。Function / Method
            // の Added / Removed / Modified / Renamed のみ対象。
            use crate::semantic::ir::SymbolKind;
            if !matches!(item.kind, SymbolKind::Function | SymbolKind::Method) {
                continue;
            }
            if !matches!(
                item.change_type,
                ChangeType::Added
                    | ChangeType::Removed
                    | ChangeType::Modified
                    | ChangeType::Renamed
            ) {
                continue;
            }
            // start_line が無い (parser が位置を持たない) アイテムは line jump を
            // None で乗せ、ファイルだけにジャンプさせる。
            changed_symbols.push(ChangedSymbol {
                display: item.display_name,
                start_line: item.start_line.unwrap_or(1),
            });
        }

        out.push(GoFileSummary {
            file_index: idx,
            file_path: file.file_path.clone(),
            package_dir,
            imports,
            changed_symbols,
        });
    }
    out
}

fn parse_go_tree_for_after(file: &PullRequestFile) -> Option<GoParseTree> {
    use crate::review::snapshot::{Revision, SourceSnapshot};
    use crate::semantic::adapter::ParserAdapter;
    let content = file.after_content.as_ref().or(file.before_content.as_ref())?;
    let snap = SourceSnapshot {
        file_id: file.file_id.clone(),
        file_path: file.file_path.clone(),
        language: Some("go".into()),
        revision: Revision::After,
        content: content.clone(),
    };
    let parsed = GoParserAdapter::new().parse(&snap);
    let raw = parsed.raw?;
    raw.downcast_ref::<GoParseTree>().cloned()
}

fn parent_dir(path: &str) -> &str {
    match path.rfind('/') {
        Some(i) => &path[..i],
        None => "",
    }
}

fn is_go_file(path: &str) -> bool {
    path.rsplit('.')
        .next()
        .map(|ext| ext.eq_ignore_ascii_case("go") && ext != path)
        .unwrap_or(false)
}

/// import path が PR 内のどの Go ファイルに対応するかを suffix heuristic で解決する。
///
/// 例: import path `github.com/foo/bar/internal/util` と PR 内の `internal/util/x.go`
/// は package_dir `internal/util` でマッチする。複数候補がある場合は
/// `util` より `internal/util` を優先するため、最長 package_dir 一致を採用する。
fn resolve_internal_target(import_path: &str, go_files: &[GoFileSummary]) -> Option<usize> {
    if import_path.is_empty() {
        return None;
    }
    let mut best: Option<(usize, usize)> = None; // (file_index, matched_dir_len)
    for f in go_files {
        if f.package_dir.is_empty() {
            continue;
        }
        if import_path == f.package_dir
            || import_path.ends_with(&format!("/{}", f.package_dir))
        {
            let len = f.package_dir.len();
            if best.is_none_or(|(_, best_len)| len > best_len) {
                best = Some((f.file_index, len));
            }
        }
    }
    best.map(|(idx, _)| idx)
}

/// focus を import している PR 内 Go ファイル の `go_files` index を返す。
///
/// マッチ条件 (suffix heuristic):
/// - caller の import 先 path が `focus.package_dir` と等しい
/// - caller の import 先 path が `<...>/<focus.package_dir>` の形で終わる
///
/// 自分自身は除外する。
fn upstream_caller_indices(focus: &GoFileSummary, go_files: &[GoFileSummary]) -> Vec<usize> {
    let mut indices = Vec::new();
    for (i, candidate) in go_files.iter().enumerate() {
        if candidate.file_index == focus.file_index {
            continue;
        }
        let mut matched = false;
        for imp in &candidate.imports {
            if !focus.package_dir.is_empty()
                && (imp == &focus.package_dir
                    || imp.ends_with(&format!("/{}", focus.package_dir)))
            {
                matched = true;
                break;
            }
        }
        if matched {
            indices.push(i);
        }
    }
    indices
}

fn push_capped(nodes: &mut Vec<ArchitectureNode>, node: ArchitectureNode) {
    if nodes.len() >= TOTAL_NODE_CAP {
        return;
    }
    nodes.push(node);
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::github::pull_request::FileStatus;
    use crate::review::snapshot::{FileId, UnsupportedFile};

    fn pr_file(path: &str, before: Option<&str>, after: Option<&str>) -> PullRequestFile {
        let status = match (before, after) {
            (None, Some(_)) => FileStatus::Added,
            (Some(_), None) => FileStatus::Removed,
            _ => FileStatus::Modified,
        };
        PullRequestFile {
            file_id: FileId::new(path),
            file_path: path.into(),
            previous_file_path: None,
            status,
            before_content: before.map(str::to_string),
            after_content: after.map(str::to_string),
            patch: None,
            is_binary: false,
            unsupported: None,
        }
    }

    #[test]
    fn parent_dir_helper() {
        assert_eq!(parent_dir("a/b/c.go"), "a/b");
        assert_eq!(parent_dir("foo.go"), "");
        assert_eq!(parent_dir("/abs/foo.go"), "/abs");
    }

    #[test]
    fn non_go_files_do_not_appear_in_minimap() {
        let files = vec![
            pr_file("README.md", Some("a"), Some("b")),
            pr_file("script.ts", Some("a"), Some("b")),
        ];
        let nodes = build_architecture_nodes(&files);
        assert!(nodes.is_empty(), "nodes: {nodes:?}");
    }

    #[test]
    fn binary_or_unsupported_go_file_skipped() {
        let mut bin = pr_file("blob.go", None, None);
        bin.is_binary = true;
        let mut unsup = pr_file(
            "src/x.go",
            Some("package main\nfunc A(){}\n"),
            Some("package main\nfunc A(){}\nfunc B(){}\n"),
        );
        unsup.unsupported = Some(UnsupportedFile::PatchMissing {
            file_id: unsup.file_id.clone(),
            file_path: unsup.file_path.clone(),
            reason: "x".into(),
        });
        let nodes = build_architecture_nodes(&[bin, unsup]);
        assert!(nodes.is_empty());
    }

    #[test]
    fn go_file_with_no_changes_emits_no_nodes() {
        // before == after かつ symbol body 同一なら ParserDiffResult.items は空。
        let same = "package main\nfunc A(){}\n";
        let files = vec![pr_file("a.go", Some(same), Some(same))];
        let nodes = build_architecture_nodes(&files);
        assert!(nodes.is_empty(), "nodes: {nodes:?}");
    }

    #[test]
    fn changed_symbol_emits_center_node_with_line_info() {
        let after = "package main\nimport \"fmt\"\nfunc Hello() string {\n  fmt.Println(\"x\")\n  return \"y\"\n}\n";
        let files = vec![pr_file("hello.go", None, Some(after))];
        let nodes = build_architecture_nodes(&files);
        let center = nodes
            .iter()
            .find(|n| n.kind == ArchitectureNodeKind::Center)
            .expect("center node");
        assert_eq!(center.label, "Hello");
        assert_eq!(center.file_index, Some(0));
        assert!(center.line_no.unwrap_or(0) >= 1);
        assert_eq!(center.detail, "hello.go");
    }

    #[test]
    fn downstream_node_emitted_for_each_unique_import() {
        let after = "package main\n\
             import (\n\
                 \"fmt\"\n\
                 \"os\"\n\
                 \"fmt\"\n\
             )\n\
             func Hello() {}\n";
        let files = vec![pr_file("hello.go", None, Some(after))];
        let nodes = build_architecture_nodes(&files);
        let downstream: Vec<&ArchitectureNode> = nodes
            .iter()
            .filter(|n| n.kind == ArchitectureNodeKind::Downstream)
            .collect();
        // dedupe で fmt が 2 回出ない
        let labels: Vec<&str> = downstream.iter().map(|n| n.label.as_str()).collect();
        assert!(labels.contains(&"fmt"));
        assert!(labels.contains(&"os"));
        assert_eq!(
            downstream.iter().filter(|n| n.label == "fmt").count(),
            1
        );
    }

    #[test]
    fn upstream_node_resolves_other_pr_file_by_directory_suffix() {
        // util/util.go を変更し、main.go が github.com/x/util を import している
        // ケース。util.go の package_dir は "util" なので suffix 一致で main.go が
        // upstream として出る。
        let util_after =
            "package util\nfunc Helper() string { return \"a\" }\n";
        let util_before = "package util\nfunc Helper() string { return \"b\" }\n";
        let main_after =
            "package main\nimport \"github.com/x/util\"\nfunc main(){ util.Helper() }\n";
        let files = vec![
            pr_file("util/util.go", Some(util_before), Some(util_after)),
            pr_file("main.go", Some(main_after), Some(main_after)),
        ];
        let nodes = build_architecture_nodes(&files);

        let upstream: Vec<&ArchitectureNode> = nodes
            .iter()
            .filter(|n| n.kind == ArchitectureNodeKind::Upstream)
            .collect();
        assert_eq!(upstream.len(), 1, "nodes: {nodes:?}");
        assert_eq!(upstream[0].label, "main.go");
        assert_eq!(upstream[0].file_index, Some(1));
    }

    #[test]
    fn upstream_does_not_match_by_package_name_only() {
        // internal/log/log.go は package log だが、main.go の `import "log"` は
        // Go stdlib の log であって internal/log ではない。package name だけで
        // 結びつけると false upstream になるため、directory suffix 一致だけを
        // 採用する。
        let focus_before = "package log\nfunc Helper() string { return \"old\" }\n";
        let focus_after = "package log\nfunc Helper() string { return \"new\" }\n";
        let main_after = "package main\nimport \"log\"\nfunc main(){ log.Println(\"x\") }\n";
        let files = vec![
            pr_file("internal/log/log.go", Some(focus_before), Some(focus_after)),
            pr_file("cmd/main.go", Some(main_after), Some(main_after)),
        ];
        let nodes = build_architecture_nodes(&files);
        let upstream: Vec<&ArchitectureNode> = nodes
            .iter()
            .filter(|n| n.kind == ArchitectureNodeKind::Upstream)
            .collect();
        assert!(upstream.is_empty(), "nodes: {nodes:?}");
    }

    #[test]
    fn downstream_resolves_internal_pr_file_index() {
        // a/foo.go is changed; it imports github.com/x/util; util/util.go is in PR.
        // Downstream node for "github.com/x/util" should resolve to util/util.go.
        let foo_after = "package a\nimport \"github.com/x/util\"\nfunc Use(){ util.Helper() }\n";
        let util_src = "package util\nfunc Helper() {}\n";
        let files = vec![
            pr_file("a/foo.go", None, Some(foo_after)),
            pr_file("util/util.go", Some(util_src), Some(util_src)),
        ];
        let nodes = build_architecture_nodes(&files);
        let downstream: Vec<&ArchitectureNode> = nodes
            .iter()
            .filter(|n| n.kind == ArchitectureNodeKind::Downstream)
            .collect();
        let resolved = downstream
            .iter()
            .find(|n| n.label == "github.com/x/util")
            .expect("util downstream node");
        assert_eq!(resolved.file_index, Some(1));
    }

    #[test]
    fn downstream_resolution_prefers_longest_directory_suffix() {
        let foo_after =
            "package a\nimport \"github.com/x/internal/util\"\nfunc Use(){ util.Helper() }\n";
        let util_src = "package util\nfunc Helper() {}\n";
        let files = vec![
            pr_file("a/foo.go", None, Some(foo_after)),
            pr_file("util/util.go", Some(util_src), Some(util_src)),
            pr_file("internal/util/util.go", Some(util_src), Some(util_src)),
        ];
        let nodes = build_architecture_nodes(&files);
        let resolved = nodes
            .iter()
            .find(|n| n.kind == ArchitectureNodeKind::Downstream
                && n.label == "github.com/x/internal/util")
            .expect("internal util downstream node");
        assert_eq!(resolved.file_index, Some(2));
    }

    #[test]
    fn focus_file_does_not_appear_as_its_own_upstream() {
        // 同じファイル内で自分自身に相当する import path があってもセルフループは
        // 出さない。collect_go_files で focus.file_index と一致する candidate を弾く。
        let after =
            "package util\nimport \"x/util\"\nfunc Hello() {}\n";
        let files = vec![pr_file("util/util.go", None, Some(after))];
        let nodes = build_architecture_nodes(&files);
        let upstream: Vec<&ArchitectureNode> = nodes
            .iter()
            .filter(|n| n.kind == ArchitectureNodeKind::Upstream)
            .collect();
        assert!(upstream.is_empty(), "nodes: {nodes:?}");
    }

    #[test]
    fn neighbor_cap_emits_overflow_summary() {
        // 6 件 import すると PER_FILE_NEIGHBOR_CAP=5 を超えるので
        // "+N more" ノードが 1 つ末尾に出る。
        let after = "package main\n\
             import (\n\
                 \"a/a\"\n\
                 \"a/b\"\n\
                 \"a/c\"\n\
                 \"a/d\"\n\
                 \"a/e\"\n\
                 \"a/f\"\n\
             )\n\
             func F() {}\n";
        let files = vec![pr_file("hello.go", None, Some(after))];
        let nodes = build_architecture_nodes(&files);
        let downstream: Vec<&ArchitectureNode> = nodes
            .iter()
            .filter(|n| n.kind == ArchitectureNodeKind::Downstream)
            .collect();
        assert_eq!(downstream.len(), PER_FILE_NEIGHBOR_CAP + 1);
        assert!(
            downstream
                .last()
                .unwrap()
                .label
                .starts_with("+"),
            "nodes: {downstream:?}"
        );
    }
}
