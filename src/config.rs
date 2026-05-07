//! 起動時の環境変数ベース設定。
//!
//! 動的なリロードは v0.0.x 時点では行わない。フォント / フォントサイズなど
//! UI 表示に関わる値を 1 箇所にまとめ、起動時に Slint プロパティとして
//! 注入する。

#[derive(Debug, Clone)]
pub struct UiConfig {
    pub font_family: String,
    pub terminal_font_size: f32,
    pub diff_font_size: f32,
    /// PromptDraft を PTY に流し込む際に bracketed paste mode で囲うかどうか。
    /// 非対応 shell / agent CLI では `\x1b[200~` 等が文字としてそのまま表示
    /// されるため、`LOCUS_BRACKETED_PASTE=false` で raw 送信に切り替えられる。
    pub bracketed_paste: bool,
    /// preview text の上限文字数。`LOCUS_PROMPT_MAX_CHARS` で上書き可能。
    /// 既定 32000 (Claude API context window の安全圏内目安)。超過すると
    /// preview pane に warning が出るが、override checkbox で送信は可能。
    pub prompt_max_chars: usize,
    /// Insert+Send 押下前に「送信していい？」と確認 checkbox を要求するかどうか。
    /// `LOCUS_CONFIRM_SEND=true` で有効化、既定 false (毎回の確認はうざいため)。
    pub confirm_send: bool,
}

impl UiConfig {
    pub fn from_env() -> Self {
        let font_family = std::env::var("LOCUS_FONT_FAMILY")
            .unwrap_or_else(|_| "Menlo, Consolas, monospace".to_string());
        let general = std::env::var("LOCUS_FONT_SIZE")
            .ok()
            .and_then(|s| s.parse::<f32>().ok());
        let terminal_font_size = std::env::var("LOCUS_TERMINAL_FONT_SIZE")
            .ok()
            .and_then(|s| s.parse::<f32>().ok())
            .or(general)
            .unwrap_or(13.0);
        let diff_font_size = std::env::var("LOCUS_DIFF_FONT_SIZE")
            .ok()
            .and_then(|s| s.parse::<f32>().ok())
            .or(general)
            .unwrap_or(12.0);
        let bracketed_paste =
            parse_bracketed_paste_env(std::env::var("LOCUS_BRACKETED_PASTE").ok().as_deref());
        let prompt_max_chars = parse_prompt_max_chars_env(
            std::env::var("LOCUS_PROMPT_MAX_CHARS").ok().as_deref(),
        );
        let confirm_send = parse_confirm_send_env(
            std::env::var("LOCUS_CONFIRM_SEND").ok().as_deref(),
        );
        Self {
            font_family,
            terminal_font_size,
            diff_font_size,
            bracketed_paste,
            prompt_max_chars,
            confirm_send,
        }
    }

    /// monospace の典型的な比率 (advance ≈ 0.6 em, line height ≈ 1.45 em)
    /// から cell width/height をピクセルに変換する暫定値。
    ///
    /// 起動直後の Slint layout が settling していない短時間 (probe Text の
    /// `preferred-width` / `preferred-height` がまだ 0) に fallback として
    /// 使われる。実 glyph metric は `terminal-resized` callback 経由で
    /// `measured-terminal-cell-w` / `measured-terminal-cell-h` から取得する。
    pub fn terminal_cell_w(&self) -> f32 {
        (self.terminal_font_size * 0.6).round().max(4.0)
    }

    pub fn terminal_cell_h(&self) -> f32 {
        (self.terminal_font_size * 1.45).round().max(8.0)
    }
}

/// `LOCUS_BRACKETED_PASTE` の値から bracketed paste mode の使用可否を決める。
///
/// - 未設定 / 空文字 → `true` (既定。spawn 時に `TERM=xterm-256color` を
///   常時セットしているため、bash や殆どの agent CLI は paste 扱いになる)
/// - `0` / `false` / `off` / `no` → `false` (raw 送信)
/// - `1` / `true` / `on` / `yes` → `true`
/// - それ以外の文字列 → `true` (fail-open: paste 機能を不用意に殺さない)
///
/// host 側の `$TERM` は参照しない。子プロセス側の TERM は spawn 時に
/// `xterm-256color` で固定済みであり、実際に paste sequence を解釈するのは
/// 子プロセスの parser (bash / agent CLI 自体) だからである。
pub fn parse_bracketed_paste_env(value: Option<&str>) -> bool {
    match value.map(str::trim) {
        None | Some("") => true,
        Some(v) => !matches!(v.to_ascii_lowercase().as_str(), "0" | "false" | "off" | "no"),
    }
}

/// `LOCUS_CONFIRM_SEND` の値で Insert+Send 確認 checkbox を要求するかどうか。
///
/// - 未設定 / 空 / 不明値 / `0` / `false` / `off` / `no` → false (既定)
/// - `1` / `true` / `on` / `yes` → true
pub fn parse_confirm_send_env(value: Option<&str>) -> bool {
    match value.map(|s| s.trim().to_ascii_lowercase()) {
        Some(v) => matches!(v.as_str(), "1" | "true" | "on" | "yes"),
        None => false,
    }
}

/// `LOCUS_PROMPT_MAX_CHARS` を usize にパースする。
///
/// - 未設定 / 空 / 解釈不能な値 → 既定 32000
/// - 0 や 1 などの極端値もそのまま受け入れる (warning が常に出るだけで害はない)
pub fn parse_prompt_max_chars_env(value: Option<&str>) -> usize {
    const DEFAULT: usize = 32_000;
    value
        .and_then(|v| v.trim().parse::<usize>().ok())
        .unwrap_or(DEFAULT)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_metrics_are_reasonable() {
        let cfg = UiConfig {
            font_family: "test".into(),
            terminal_font_size: 12.0,
            diff_font_size: 12.0,
            bracketed_paste: true,
            prompt_max_chars: 32_000,
            confirm_send: false,
        };
        assert!(cfg.terminal_cell_w() >= 6.0);
        assert!(cfg.terminal_cell_h() >= 14.0);
    }

    #[test]
    fn cell_metrics_scale_with_font_size() {
        let small = UiConfig {
            font_family: "x".into(),
            terminal_font_size: 10.0,
            diff_font_size: 10.0,
            bracketed_paste: true,
            prompt_max_chars: 32_000,
            confirm_send: false,
        };
        let big = UiConfig {
            font_family: "x".into(),
            terminal_font_size: 20.0,
            diff_font_size: 20.0,
            bracketed_paste: true,
            prompt_max_chars: 32_000,
            confirm_send: false,
        };
        assert!(big.terminal_cell_w() > small.terminal_cell_w());
        assert!(big.terminal_cell_h() > small.terminal_cell_h());
    }

    #[test]
    fn bracketed_paste_default_is_on() {
        assert!(parse_bracketed_paste_env(None));
        assert!(parse_bracketed_paste_env(Some("")));
        assert!(parse_bracketed_paste_env(Some("   ")));
    }

    #[test]
    fn bracketed_paste_explicit_off() {
        for v in ["0", "false", "False", "OFF", "no"] {
            assert!(!parse_bracketed_paste_env(Some(v)));
        }
    }

    #[test]
    fn bracketed_paste_explicit_on() {
        for v in ["1", "true", "True", "on", "yes"] {
            assert!(parse_bracketed_paste_env(Some(v)));
        }
    }

    #[test]
    fn confirm_send_default_off() {
        assert!(!parse_confirm_send_env(None));
        assert!(!parse_confirm_send_env(Some("")));
        assert!(!parse_confirm_send_env(Some("garbage")));
    }

    #[test]
    fn confirm_send_explicit_on() {
        for v in ["1", "true", "True", "on", "yes", "ON"] {
            assert!(parse_confirm_send_env(Some(v)));
        }
    }

    #[test]
    fn confirm_send_explicit_off() {
        for v in ["0", "false", "off", "no"] {
            assert!(!parse_confirm_send_env(Some(v)));
        }
    }

    #[test]
    fn prompt_max_chars_default() {
        assert_eq!(parse_prompt_max_chars_env(None), 32_000);
        assert_eq!(parse_prompt_max_chars_env(Some("")), 32_000);
        assert_eq!(parse_prompt_max_chars_env(Some("garbage")), 32_000);
    }

    #[test]
    fn prompt_max_chars_explicit() {
        assert_eq!(parse_prompt_max_chars_env(Some("8000")), 8_000);
        assert_eq!(parse_prompt_max_chars_env(Some("  4096  ")), 4_096);
        assert_eq!(parse_prompt_max_chars_env(Some("0")), 0);
    }

    #[test]
    fn bracketed_paste_unknown_value_fails_open() {
        // fail-open: paste 機能を不用意に殺さないため未知値は true
        assert!(parse_bracketed_paste_env(Some("garbage")));
        assert!(parse_bracketed_paste_env(Some("auto"))); // 旧 auto モードも fail-open
    }
}
