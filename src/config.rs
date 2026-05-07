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
        let bracketed_paste = parse_bracketed_paste_env(
            std::env::var("LOCUS_BRACKETED_PASTE").ok().as_deref(),
            std::env::var("TERM").ok().as_deref(),
        );
        Self {
            font_family,
            terminal_font_size,
            diff_font_size,
            bracketed_paste,
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
/// - 未設定 / 空文字 → `true` (現状互換: 殆どの xterm-256color 接続で動く)
/// - `0` / `false` / `off` / `no` → `false`
/// - `1` / `true` / `on` / `yes` → `true`
/// - `auto` → host `$TERM` から推定 (xterm / screen / tmux / rxvt / alacritty 系は `true`)
/// - それ以外の文字列 → `true` (fail-open: paste 機能を不用意に殺さない)
pub fn parse_bracketed_paste_env(value: Option<&str>, host_term: Option<&str>) -> bool {
    match value.map(str::trim) {
        None | Some("") => true,
        Some(v) => match v.to_ascii_lowercase().as_str() {
            "0" | "false" | "off" | "no" => false,
            "1" | "true" | "on" | "yes" => true,
            "auto" => host_term.map(is_bracketed_paste_capable).unwrap_or(false),
            _ => true,
        },
    }
}

/// よく見る xterm 互換 terminal emulator の TERM プレフィクスから bracketed
/// paste 対応を推定する。完全には網羅できないので「auto」モード時のヒント
/// 用途。空 / 未対応と分かっている TERM では `false`。
fn is_bracketed_paste_capable(term: &str) -> bool {
    if term.is_empty() {
        return false;
    }
    if term == "alacritty" || term == "wezterm" || term == "kitty" {
        return true;
    }
    let prefixes = ["xterm", "screen", "tmux", "rxvt", "vte", "konsole", "iterm"];
    prefixes.iter().any(|p| term.starts_with(p))
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
        };
        let big = UiConfig {
            font_family: "x".into(),
            terminal_font_size: 20.0,
            diff_font_size: 20.0,
            bracketed_paste: true,
        };
        assert!(big.terminal_cell_w() > small.terminal_cell_w());
        assert!(big.terminal_cell_h() > small.terminal_cell_h());
    }

    #[test]
    fn bracketed_paste_default_is_on() {
        assert!(parse_bracketed_paste_env(None, None));
        assert!(parse_bracketed_paste_env(Some(""), None));
        assert!(parse_bracketed_paste_env(Some("   "), None));
    }

    #[test]
    fn bracketed_paste_explicit_off() {
        for v in ["0", "false", "False", "OFF", "no"] {
            assert!(!parse_bracketed_paste_env(Some(v), Some("xterm-256color")));
        }
    }

    #[test]
    fn bracketed_paste_explicit_on() {
        for v in ["1", "true", "True", "on", "yes"] {
            assert!(parse_bracketed_paste_env(Some(v), Some("dumb")));
        }
    }

    #[test]
    fn bracketed_paste_auto_uses_term_heuristic() {
        assert!(parse_bracketed_paste_env(Some("auto"), Some("xterm-256color")));
        assert!(parse_bracketed_paste_env(Some("auto"), Some("screen")));
        assert!(parse_bracketed_paste_env(Some("auto"), Some("tmux-256color")));
        assert!(parse_bracketed_paste_env(Some("auto"), Some("alacritty")));
        assert!(!parse_bracketed_paste_env(Some("auto"), Some("dumb")));
        assert!(!parse_bracketed_paste_env(Some("auto"), Some("vt100")));
        assert!(!parse_bracketed_paste_env(Some("auto"), None));
    }

    #[test]
    fn bracketed_paste_unknown_value_fails_open() {
        // 「fail-open」: paste 機能を不用意に殺さないため未知値は true
        assert!(parse_bracketed_paste_env(Some("garbage"), Some("dumb")));
    }
}
