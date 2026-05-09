//! Diff viewer 関連の純粋ユーティリティ (#224 step 2)。
//!
//! Slint UI / DIFF_APP_STATE thread_local に依存しないものをここに集約する。
//! UI model への反映や toast など状態・副作用を持つ helper は
//! `refresh` / `toast` module に分離している。

use crate::review::draft::SendMode;

/// SendMode の人間可読ラベル (i18n 経由)。
pub(crate) fn send_mode_label(mode: SendMode) -> String {
    let key = match mode {
        SendMode::InsertOnly => "Insert",
        SendMode::InsertAndSend => "Insert+Send",
        SendMode::CopyToClipboard => "Copy",
    };
    crate::i18n::tr(key)
}

/// UNIX 時刻から `HH:MM:SS` の文字列。
pub(crate) fn current_hhmmss() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let h = (secs / 3600) % 24;
    let m = (secs / 60) % 60;
    let s = secs % 60;
    format!("{h:02}:{m:02}:{s:02}")
}

/// diff line click から行番号を 1 つに決定する。
///
/// Removed 行は old (before 側) を、それ以外は new (after 側) を優先。
/// 該当側で parse 失敗したらもう一方に倒す。最終的に 0 で fallback。
pub(crate) fn resolve_line_number(line_kind: i32, old_no: &str, new_no: &str) -> u32 {
    let prefer_old = line_kind == 2;
    let a = if prefer_old { old_no } else { new_no };
    let b = if prefer_old { new_no } else { old_no };
    a.parse::<u32>()
        .ok()
        .or_else(|| b.parse::<u32>().ok())
        .unwrap_or(0)
}

/// SHA を先頭 7 文字に切り詰める。
pub(crate) fn short_sha(sha: &str) -> String {
    sha.chars().take(7).collect()
}

/// 本文の最初の段落を切り出して `max_chars` 以内に短縮する。超過時は末尾 `…`。
pub(crate) fn excerpt(body: &str, max_chars: usize) -> String {
    let trimmed = body.trim();
    if trimmed.is_empty() {
        return String::new();
    }
    // 最初の空行までを 1 段落として扱い、長さを切り詰める。
    let first_paragraph = trimmed
        .split("\n\n")
        .next()
        .unwrap_or("")
        .replace('\n', " ");
    if first_paragraph.chars().count() <= max_chars {
        first_paragraph
    } else {
        let mut out: String = first_paragraph.chars().take(max_chars).collect();
        out.push('…');
        out
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resolve_line_number_prefers_old_for_removed() {
        assert_eq!(resolve_line_number(2, "10", "11"), 10);
    }

    #[test]
    fn resolve_line_number_prefers_new_for_added() {
        assert_eq!(resolve_line_number(1, "10", "11"), 11);
    }

    #[test]
    fn resolve_line_number_falls_back_to_other_side() {
        assert_eq!(resolve_line_number(1, "10", ""), 10);
        assert_eq!(resolve_line_number(2, "", "11"), 11);
    }

    #[test]
    fn short_sha_truncates_to_seven_chars() {
        assert_eq!(short_sha("abcdef1234567890"), "abcdef1");
    }

    #[test]
    fn short_sha_of_short_input_is_itself() {
        assert_eq!(short_sha("abc"), "abc");
    }

    #[test]
    fn excerpt_returns_empty_for_blank() {
        assert_eq!(excerpt("", 100), "");
        assert_eq!(excerpt("   \n\n", 100), "");
    }

    #[test]
    fn excerpt_truncates_with_ellipsis() {
        let result = excerpt("a".repeat(200).as_str(), 50);
        assert_eq!(result.chars().count(), 51); // 50 + "…"
        assert!(result.ends_with('…'));
    }

    #[test]
    fn excerpt_picks_first_paragraph() {
        let body = "first line\nstill first\n\nsecond paragraph";
        let result = excerpt(body, 100);
        assert_eq!(result, "first line still first");
    }
}
