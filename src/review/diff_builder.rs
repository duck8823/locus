//! before/after の文字列から [`FileDiff`] を組み立てるユーティリティ。
//!
//! `similar` crate の行ベース diff を使って unified 形式の hunk を作る。
//! context 行数は固定値 3。

use similar::{ChangeTag, TextDiff};

use super::diff::{DiffLine, FileDiff, Hunk, LineKind};
use super::snapshot::FileId;

const CONTEXT_LINES: usize = 3;

pub fn build_file_diff(
    before: Option<&str>,
    after: Option<&str>,
    file_id: FileId,
    file_path: String,
) -> FileDiff {
    let before_text = before.unwrap_or("");
    let after_text = after.unwrap_or("");
    let diff = TextDiff::from_lines(before_text, after_text);

    let mut hunks: Vec<Hunk> = Vec::new();
    for group in diff.grouped_ops(CONTEXT_LINES) {
        if group.is_empty() {
            continue;
        }
        let mut lines: Vec<DiffLine> = Vec::new();
        let mut old_start: Option<u32> = None;
        let mut new_start: Option<u32> = None;
        let mut old_len: u32 = 0;
        let mut new_len: u32 = 0;

        for op in &group {
            for change in diff.iter_changes(op) {
                let kind = match change.tag() {
                    ChangeTag::Equal => LineKind::Context,
                    ChangeTag::Insert => LineKind::Added,
                    ChangeTag::Delete => LineKind::Removed,
                };
                let old_line_no = change.old_index().map(|i| (i as u32) + 1);
                let new_line_no = change.new_index().map(|i| (i as u32) + 1);

                if old_start.is_none()
                    && let Some(v) = old_line_no
                {
                    old_start = Some(v);
                }
                if new_start.is_none()
                    && let Some(v) = new_line_no
                {
                    new_start = Some(v);
                }

                match kind {
                    LineKind::Context => {
                        old_len += 1;
                        new_len += 1;
                    }
                    LineKind::Added => {
                        new_len += 1;
                    }
                    LineKind::Removed => {
                        old_len += 1;
                    }
                }

                let content = strip_trailing_newline(change.value());
                lines.push(DiffLine {
                    kind,
                    old_line_no,
                    new_line_no,
                    content,
                });
            }
        }

        // 行が0本のまま抜けたら hunk を作らない。
        if lines.is_empty() {
            continue;
        }

        let old_start = old_start.unwrap_or(1);
        let new_start = new_start.unwrap_or(1);
        hunks.push(Hunk {
            old_start,
            old_len,
            new_start,
            new_len,
            lines,
        });
    }

    FileDiff {
        file_id,
        file_path,
        hunks,
    }
}

fn strip_trailing_newline(s: &str) -> String {
    let mut out = s.to_string();
    while out.ends_with('\n') || out.ends_with('\r') {
        out.pop();
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn identical_content_has_no_hunks() {
        let diff = build_file_diff(
            Some("a\nb\nc\n"),
            Some("a\nb\nc\n"),
            FileId::new("x"),
            "x.txt".into(),
        );
        assert!(diff.hunks.is_empty());
    }

    #[test]
    fn added_line_produces_added_linekind() {
        let diff = build_file_diff(
            Some("a\nb\n"),
            Some("a\nb\nc\n"),
            FileId::new("x"),
            "x.txt".into(),
        );
        assert_eq!(diff.hunks.len(), 1);
        let has_added = diff.hunks[0]
            .lines
            .iter()
            .any(|l| l.kind == LineKind::Added && l.content == "c");
        assert!(has_added, "expected an Added 'c' line");
    }

    #[test]
    fn removed_line_produces_removed_linekind() {
        let diff = build_file_diff(
            Some("a\nb\nc\n"),
            Some("a\nc\n"),
            FileId::new("x"),
            "x.txt".into(),
        );
        assert_eq!(diff.hunks.len(), 1);
        let has_removed = diff.hunks[0]
            .lines
            .iter()
            .any(|l| l.kind == LineKind::Removed && l.content == "b");
        assert!(has_removed, "expected a Removed 'b' line");
    }

    #[test]
    fn context_lines_are_included_around_changes() {
        let diff = build_file_diff(
            Some("a\nb\nc\nd\ne\n"),
            Some("a\nb\nX\nd\ne\n"),
            FileId::new("x"),
            "x.txt".into(),
        );
        assert_eq!(diff.hunks.len(), 1);
        let contexts = diff
            .hunks[0]
            .lines
            .iter()
            .filter(|l| l.kind == LineKind::Context)
            .count();
        assert!(contexts >= 2, "expected at least 2 context lines");
    }

    #[test]
    fn added_file_has_all_additions() {
        let diff = build_file_diff(
            None,
            Some("hello\nworld\n"),
            FileId::new("x"),
            "x.txt".into(),
        );
        assert_eq!(diff.hunks.len(), 1);
        assert!(
            diff.hunks[0]
                .lines
                .iter()
                .all(|l| l.kind == LineKind::Added)
        );
    }

    #[test]
    fn removed_file_has_all_removals() {
        let diff = build_file_diff(
            Some("hello\nworld\n"),
            None,
            FileId::new("x"),
            "x.txt".into(),
        );
        assert_eq!(diff.hunks.len(), 1);
        assert!(
            diff.hunks[0]
                .lines
                .iter()
                .all(|l| l.kind == LineKind::Removed)
        );
    }
}
