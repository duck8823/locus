//! PromptDraft を Terminal ペインに流す前に整形するロジック。
//!
//! 整形規則 (Issue #203):
//! - 並び順: file path → hunk order → line order
//! - 粒度別にヘッダを付ける
//! - コードスニペットは before/after snapshot から切り出す
//! - スニペットには行数上限
//! - note 省略を許容
//! - 重複 anchor はマージ

use std::collections::BTreeMap;

use super::diff::{FileDiff, LineKind};
use super::diff_builder::build_file_diff;
use super::draft::{DraftEntry, PromptDraft};
use super::selection::{Granularity, SelectionAnchor, Side};
use super::snapshot::FileId;

const SNIPPET_MAX_LINES: usize = 200;

/// 整形に必要な file メタデータを adapter から渡すための trait 風インターフェース。
///
/// v0.1 では PullRequestFile を直接受ける callsite だけなので関数オブジェクトに
/// する必要はなく、単純な slice + クロージャで十分。
pub struct FileSourceEntry<'a> {
    pub file_id: &'a FileId,
    pub file_path: &'a str,
    pub before_content: Option<&'a str>,
    pub after_content: Option<&'a str>,
}

pub fn format_prompt(draft: &PromptDraft, files: &[FileSourceEntry<'_>]) -> String {
    if draft.is_empty() {
        return String::new();
    }

    // file_id をキーに、file へのインデックスを持つ map を作る。
    let mut index_by_id: BTreeMap<&str, usize> = BTreeMap::new();
    for (idx, f) in files.iter().enumerate() {
        index_by_id.insert(f.file_id.as_str(), idx);
    }

    // entries を file path / hunk / line 順で sort する。
    // 同一 anchor の重複は Vec<&DraftEntry> の中で skip する。
    let mut sorted: Vec<&DraftEntry> = draft.entries().iter().collect();
    sorted.sort_by(|a, b| {
        cmp_entry(a, b, &index_by_id, files)
    });

    // 重複除去（同じ anchor で note も同じ）
    let mut seen: Vec<&DraftEntry> = Vec::new();
    for e in sorted {
        if !seen.iter().any(|prev| same_anchor_and_note(prev, e)) {
            seen.push(e);
        }
    }

    let mut out = String::new();
    out.push_str("# Locus PromptDraft\n\n");
    out.push_str(&format!("Selections: {}\n\n", seen.len()));
    out.push_str("---\n\n");

    for entry in seen {
        let anchor = &entry.anchor;
        let idx = index_by_id.get(anchor.file_id.as_str()).copied();
        let file = idx.and_then(|i| files.get(i));

        out.push_str(&format_header(anchor));
        out.push('\n');
        if let Some(note) = entry.note.as_deref()
            && !note.is_empty()
        {
            out.push('_');
            out.push_str(note);
            out.push_str("_\n\n");
        }
        if let Some(file) = file {
            let snippet = format_snippet(anchor, file);
            out.push_str(&snippet);
        } else {
            out.push_str("> (file content not available)\n");
        }
        out.push('\n');
    }

    out
}

fn cmp_entry(
    a: &DraftEntry,
    b: &DraftEntry,
    index_by_id: &BTreeMap<&str, usize>,
    files: &[FileSourceEntry<'_>],
) -> std::cmp::Ordering {
    let ai = index_by_id
        .get(a.anchor.file_id.as_str())
        .copied()
        .unwrap_or(usize::MAX);
    let bi = index_by_id
        .get(b.anchor.file_id.as_str())
        .copied()
        .unwrap_or(usize::MAX);
    if ai != bi {
        // file 順は files slice の順
        return ai.cmp(&bi);
    }
    // 同一 file 内: path → hunk → line
    let ap = files.get(ai).map(|f| f.file_path).unwrap_or("");
    let bp = files.get(bi).map(|f| f.file_path).unwrap_or("");
    if ap != bp {
        return ap.cmp(bp);
    }
    granularity_order(&a.anchor.granularity).cmp(&granularity_order(&b.anchor.granularity))
}

/// sort key 用の序列化。同一 granularity 種別内では line / hunk index を
/// 二次キーに使う。
fn granularity_order(g: &Granularity) -> (u8, u32, u32) {
    match g {
        Granularity::File => (0, 0, 0),
        Granularity::Hunk { hunk_index } => (1, *hunk_index as u32, 0),
        Granularity::Range {
            start_line,
            end_line,
            ..
        } => (2, *start_line, *end_line),
        Granularity::Line { line, .. } => (3, *line, 0),
    }
}

fn same_anchor_and_note(a: &DraftEntry, b: &DraftEntry) -> bool {
    a.anchor == b.anchor && a.note == b.note
}

fn format_header(anchor: &SelectionAnchor) -> String {
    let path = &anchor.file_path;
    match &anchor.granularity {
        Granularity::File => format!("### {path} (file)"),
        Granularity::Hunk { hunk_index } => format!("### {path} (hunk #{hunk_index})"),
        Granularity::Range {
            start_line,
            end_line,
            side,
        } => format!(
            "### {path}:{start_line}-{end_line} ({})",
            side_label(*side)
        ),
        Granularity::Line { line, side } => {
            format!("### {path}:{line} ({})", side_label(*side))
        }
    }
}

fn side_label(side: Side) -> &'static str {
    match side {
        Side::Before => "before",
        Side::After => "after",
    }
}

fn format_snippet(anchor: &SelectionAnchor, file: &FileSourceEntry<'_>) -> String {
    match &anchor.granularity {
        Granularity::File => {
            let content = file
                .after_content
                .or(file.before_content)
                .unwrap_or("");
            code_block(truncate_lines(content, SNIPPET_MAX_LINES))
        }
        Granularity::Hunk { hunk_index } => {
            let diff = build_file_diff(
                file.before_content,
                file.after_content,
                file.file_id.clone(),
                file.file_path.to_string(),
            );
            match diff.hunks.get(*hunk_index) {
                Some(hunk) => {
                    let mut rendered = String::new();
                    rendered.push_str(&hunk.header());
                    rendered.push('\n');
                    for line in &hunk.lines {
                        let prefix = match line.kind {
                            LineKind::Added => "+",
                            LineKind::Removed => "-",
                            LineKind::Context => " ",
                        };
                        rendered.push_str(prefix);
                        rendered.push(' ');
                        rendered.push_str(&line.content);
                        rendered.push('\n');
                    }
                    code_block(truncate_lines(&rendered, SNIPPET_MAX_LINES))
                }
                None => "> (hunk index out of range)\n".into(),
            }
        }
        Granularity::Line { line, side } | Granularity::Range { start_line: line, side, .. } => {
            let src = match side {
                Side::Before => file.before_content,
                Side::After => file.after_content,
            };
            let snippet = src
                .map(|s| extract_line_window(s, *line, range_span(anchor)))
                .unwrap_or_default();
            code_block(truncate_lines(&snippet, SNIPPET_MAX_LINES))
        }
    }
}

fn range_span(anchor: &SelectionAnchor) -> u32 {
    match &anchor.granularity {
        Granularity::Range {
            start_line,
            end_line,
            ..
        } => end_line.saturating_sub(*start_line) + 1,
        _ => 1,
    }
}

fn extract_line_window(content: &str, start_line_1based: u32, span: u32) -> String {
    if start_line_1based == 0 {
        return String::new();
    }
    let start = (start_line_1based - 1) as usize;
    let end = start + (span.max(1) as usize);
    content
        .lines()
        .skip(start)
        .take(end - start)
        .collect::<Vec<_>>()
        .join("\n")
}

fn truncate_lines(content: &str, max: usize) -> String {
    let lines: Vec<&str> = content.lines().collect();
    if lines.len() <= max {
        content.to_string()
    } else {
        let mut out = lines[..max].join("\n");
        out.push_str(&format!(
            "\n… (truncated: {} more lines)",
            lines.len() - max
        ));
        out
    }
}

fn code_block(s: String) -> String {
    format!("```\n{s}\n```\n")
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::review::draft::DraftEntry;
    use crate::review::selection::{Granularity, SelectionAnchor, Side};

    fn anchor(path: &str, g: Granularity) -> SelectionAnchor {
        SelectionAnchor {
            file_id: FileId::new(path),
            file_path: path.into(),
            granularity: g,
        }
    }

    fn file_entry<'a>(
        file_id: &'a FileId,
        path: &'a str,
        before: Option<&'a str>,
        after: Option<&'a str>,
    ) -> FileSourceEntry<'a> {
        FileSourceEntry {
            file_id,
            file_path: path,
            before_content: before,
            after_content: after,
        }
    }

    #[test]
    fn empty_draft_produces_empty_output() {
        let draft = PromptDraft::new();
        let out = format_prompt(&draft, &[]);
        assert!(out.is_empty());
    }

    #[test]
    fn file_anchor_formats_full_content() {
        let mut draft = PromptDraft::new();
        draft.push(DraftEntry::new(
            anchor("src/a.rs", Granularity::File),
            Some("ここを全部読んで".into()),
        ));
        let file_id = FileId::new("src/a.rs");
        let files = vec![file_entry(
            &file_id,
            "src/a.rs",
            Some("old\n"),
            Some("fn a() {}\nfn b() {}\n"),
        )];
        let out = format_prompt(&draft, &files);
        assert!(out.contains("### src/a.rs (file)"));
        assert!(out.contains("ここを全部読んで"));
        assert!(out.contains("fn a()"));
        assert!(out.contains("fn b()"));
    }

    #[test]
    fn line_anchor_extracts_only_target_line() {
        let mut draft = PromptDraft::new();
        draft.push(DraftEntry::new(
            anchor(
                "src/a.rs",
                Granularity::Line {
                    line: 2,
                    side: Side::After,
                },
            ),
            None,
        ));
        let file_id = FileId::new("src/a.rs");
        let files = vec![file_entry(
            &file_id,
            "src/a.rs",
            None,
            Some("line one\nline two\nline three\n"),
        )];
        let out = format_prompt(&draft, &files);
        assert!(out.contains("### src/a.rs:2 (after)"));
        assert!(out.contains("line two"));
        assert!(!out.contains("line three"));
    }

    #[test]
    fn range_anchor_extracts_span() {
        let mut draft = PromptDraft::new();
        draft.push(DraftEntry::new(
            anchor(
                "src/a.rs",
                Granularity::Range {
                    start_line: 2,
                    end_line: 4,
                    side: Side::After,
                },
            ),
            None,
        ));
        let file_id = FileId::new("src/a.rs");
        let files = vec![file_entry(
            &file_id,
            "src/a.rs",
            None,
            Some("one\ntwo\nthree\nfour\nfive\n"),
        )];
        let out = format_prompt(&draft, &files);
        assert!(out.contains("### src/a.rs:2-4 (after)"));
        assert!(out.contains("two"));
        assert!(out.contains("four"));
        assert!(!out.contains("five"));
    }

    #[test]
    fn duplicate_anchors_are_merged() {
        let mut draft = PromptDraft::new();
        let a = anchor("src/a.rs", Granularity::File);
        draft.push(DraftEntry::new(a.clone(), None));
        draft.push(DraftEntry::new(a, None));
        let file_id = FileId::new("src/a.rs");
        let files = vec![file_entry(&file_id, "src/a.rs", None, Some("x\n"))];
        let out = format_prompt(&draft, &files);
        let occurrences = out.matches("### src/a.rs (file)").count();
        assert_eq!(occurrences, 1);
    }

    #[test]
    fn snippet_is_truncated_past_max_lines() {
        let mut content = String::new();
        for i in 0..300 {
            content.push_str(&format!("line {i}\n"));
        }
        let mut draft = PromptDraft::new();
        draft.push(DraftEntry::new(
            anchor("src/big.rs", Granularity::File),
            None,
        ));
        let file_id = FileId::new("src/big.rs");
        let files = vec![file_entry(&file_id, "src/big.rs", None, Some(&content))];
        let out = format_prompt(&draft, &files);
        assert!(out.contains("truncated: 100 more lines"));
    }

    #[test]
    fn entries_sorted_by_file_then_granularity() {
        let mut draft = PromptDraft::new();
        // わざと b.rs の line → a.rs の file の順に push する
        draft.push(DraftEntry::new(
            anchor(
                "src/b.rs",
                Granularity::Line {
                    line: 10,
                    side: Side::After,
                },
            ),
            None,
        ));
        draft.push(DraftEntry::new(
            anchor("src/a.rs", Granularity::File),
            None,
        ));
        let a_id = FileId::new("src/a.rs");
        let b_id = FileId::new("src/b.rs");
        let b_content = "b\n".repeat(20);
        let files = vec![
            file_entry(&a_id, "src/a.rs", None, Some("a\n")),
            file_entry(&b_id, "src/b.rs", None, Some(b_content.as_str())),
        ];
        let out = format_prompt(&draft, &files);
        let a_pos = out.find("### src/a.rs (file)").unwrap();
        let b_pos = out.find("### src/b.rs:10 (after)").unwrap();
        assert!(a_pos < b_pos);
    }
}
