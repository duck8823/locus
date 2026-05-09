//! 起動時の環境変数ベース設定。
//!
//! 動的なリロードは v0.0.x 時点では行わない。フォント / フォントサイズなど
//! UI 表示に関わる値を 1 箇所にまとめ、起動時に Slint プロパティとして
//! 注入する。

#[derive(Debug, Clone)]
pub struct UiConfig {
    /// Diff / chrome 側で使う既定フォント。
    pub font_family: String,
    /// Terminal grid 専用フォント。`LOCUS_TERMINAL_FONT_FAMILY` があれば
    /// `LOCUS_FONT_FAMILY` より優先する。
    pub terminal_font_family: String,
    pub terminal_font_size: f32,
    pub diff_font_size: f32,
    /// Terminal cell の手動 override。Slint の font metric probe が実機で
    /// 崩れる場合に `LOCUS_TERMINAL_CELL_W/H` で grid と glyph を強制同期する。
    pub terminal_cell_w_override: Option<f32>,
    pub terminal_cell_h_override: Option<f32>,
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
    /// terminal cell metric の崩れを実機で視覚 trace するための debug grid overlay。
    /// `LOCUS_TERMINAL_DEBUG_GRID=true` で各 cell に薄い border を出す。既定 false。
    pub terminal_debug_grid: bool,
}

impl UiConfig {
    pub fn from_env() -> Self {
        let font_family_env = std::env::var("LOCUS_FONT_FAMILY").ok();
        let font_family = font_family_env
            .clone()
            .unwrap_or_else(|| default_font_family().to_string());
        let terminal_font_family = std::env::var("LOCUS_TERMINAL_FONT_FAMILY")
            .ok()
            .or(font_family_env)
            .unwrap_or_else(|| default_terminal_font_family().to_string());
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
        let prompt_max_chars =
            parse_prompt_max_chars_env(std::env::var("LOCUS_PROMPT_MAX_CHARS").ok().as_deref());
        let confirm_send =
            parse_confirm_send_env(std::env::var("LOCUS_CONFIRM_SEND").ok().as_deref());
        let terminal_cell_w_override =
            parse_positive_f32_env(std::env::var("LOCUS_TERMINAL_CELL_W").ok().as_deref());
        let terminal_cell_h_override =
            parse_positive_f32_env(std::env::var("LOCUS_TERMINAL_CELL_H").ok().as_deref());
        let terminal_debug_grid = parse_terminal_debug_grid_env(
            std::env::var("LOCUS_TERMINAL_DEBUG_GRID").ok().as_deref(),
        );
        Self {
            font_family,
            terminal_font_family,
            terminal_font_size,
            diff_font_size,
            terminal_cell_w_override,
            terminal_cell_h_override,
            bracketed_paste,
            prompt_max_chars,
            confirm_send,
            terminal_debug_grid,
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
        self.terminal_cell_w_override
            .unwrap_or_else(|| (self.terminal_font_size * 0.6).round().max(4.0))
    }

    pub fn terminal_cell_h(&self) -> f32 {
        self.terminal_cell_h_override
            .unwrap_or_else(|| (self.terminal_font_size * 1.45).round().max(8.0))
    }

    /// Slint の probe から得た cell metric を実際に採用する値へ解決する。
    ///
    /// 手動 override がある場合は実測値より優先する。override が無い場合は
    /// 正の有限な実測値を使い、未測定 / 異常値なら従来の比率 fallback を使う。
    pub fn terminal_cell_w_from_measurement(&self, measured: f32) -> f32 {
        if let Some(cell_w) = self.terminal_cell_w_override {
            cell_w
        } else if measured.is_finite() && measured > 0.0 {
            measured
        } else {
            self.terminal_cell_w()
        }
    }

    pub fn terminal_cell_h_from_measurement(&self, measured: f32) -> f32 {
        if let Some(cell_h) = self.terminal_cell_h_override {
            cell_h
        } else if measured.is_finite() && measured > 0.0 {
            measured
        } else {
            self.terminal_cell_h()
        }
    }
}

/// OS 別の monospace + CJK/symbol/emoji fallback font family list。Slint Text の
/// `font-family` は CSS 風のカンマ区切り fallback を解決するため、
/// 先頭の monospace に CJK glyph がなくても次の候補に倒れる。
///
/// diff / chrome 側の既定。terminal pane は grid 幅を安定させるため
/// `default_terminal_font_family()` を別に持つ。`LOCUS_FONT_FAMILY` が明示
/// 指定されていれば terminal 側にも引き継がれるが、
/// `LOCUS_TERMINAL_FONT_FAMILY` があればそちらを優先する。
const fn default_font_family() -> &'static str {
    #[cfg(target_os = "macos")]
    {
        "Menlo, Hiragino Sans, Apple Symbols, Apple Color Emoji, Consolas, monospace"
    }
    #[cfg(target_os = "windows")]
    {
        "Consolas, Yu Gothic, Segoe UI Symbol, Segoe UI Emoji, monospace"
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        "DejaVu Sans Mono, Noto Sans CJK JP, Noto Sans Symbols 2, Noto Color Emoji, monospace"
    }
}

/// Terminal grid 専用の monospace 寄り fallback。
///
/// `default_font_family()` は diff/chrome の可読性を優先して CJK UI フォントを
/// 含むが、terminal grid で proportional fallback が先に選ばれると cell 幅と
/// glyph advance がズレる。Terminal だけは monospace 候補を前段に分離し、
/// CJK / symbol / emoji は最後の fallback として扱う。
const fn default_terminal_font_family() -> &'static str {
    #[cfg(target_os = "macos")]
    {
        "SF Mono, Menlo, Monaco, Osaka-Mono, Hiragino Sans, Apple Symbols, Apple Color Emoji, monospace"
    }
    #[cfg(target_os = "windows")]
    {
        "Cascadia Mono, Consolas, MS Gothic, Yu Gothic UI, Segoe UI Symbol, Segoe UI Emoji, monospace"
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        "DejaVu Sans Mono, Noto Sans Mono CJK JP, Noto Sans Symbols 2, Noto Color Emoji, Noto Sans CJK JP, monospace"
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
        Some(v) => !matches!(
            v.to_ascii_lowercase().as_str(),
            "0" | "false" | "off" | "no"
        ),
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

/// `LOCUS_TERMINAL_DEBUG_GRID` で terminal cell metric の debug overlay を出すか。
///
/// - 未設定 / 空 / 不明値 / `0` / `false` / `off` / `no` → false (既定)
/// - `1` / `true` / `on` / `yes` → true
///
/// 既定挙動を変えないため fail-closed 側にしている (`confirm_send` と同じ規則)。
pub fn parse_terminal_debug_grid_env(value: Option<&str>) -> bool {
    match value.map(|s| s.trim().to_ascii_lowercase()) {
        Some(v) => matches!(v.as_str(), "1" | "true" | "on" | "yes"),
        None => false,
    }
}

/// 正の有限な f32 だけを受理する環境変数 parser。
pub fn parse_positive_f32_env(value: Option<&str>) -> Option<f32> {
    value
        .and_then(|v| v.trim().parse::<f32>().ok())
        .filter(|v| v.is_finite() && *v > 0.0)
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
            terminal_font_family: "test-mono".into(),
            terminal_font_size: 12.0,
            diff_font_size: 12.0,
            terminal_cell_w_override: None,
            terminal_cell_h_override: None,
            bracketed_paste: true,
            prompt_max_chars: 32_000,
            confirm_send: false,
            terminal_debug_grid: false,
        };
        assert!(cfg.terminal_cell_w() >= 6.0);
        assert!(cfg.terminal_cell_h() >= 14.0);
    }

    #[test]
    fn cell_metrics_scale_with_font_size() {
        let small = UiConfig {
            font_family: "x".into(),
            terminal_font_family: "x-mono".into(),
            terminal_font_size: 10.0,
            diff_font_size: 10.0,
            terminal_cell_w_override: None,
            terminal_cell_h_override: None,
            bracketed_paste: true,
            prompt_max_chars: 32_000,
            confirm_send: false,
            terminal_debug_grid: false,
        };
        let big = UiConfig {
            font_family: "x".into(),
            terminal_font_family: "x-mono".into(),
            terminal_font_size: 20.0,
            diff_font_size: 20.0,
            terminal_cell_w_override: None,
            terminal_cell_h_override: None,
            bracketed_paste: true,
            prompt_max_chars: 32_000,
            confirm_send: false,
            terminal_debug_grid: false,
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

    #[test]
    fn positive_f32_env_accepts_only_positive_finite_values() {
        assert_eq!(parse_positive_f32_env(Some("8.5")), Some(8.5));
        assert_eq!(parse_positive_f32_env(Some("  16  ")), Some(16.0));
        assert_eq!(parse_positive_f32_env(None), None);
        assert_eq!(parse_positive_f32_env(Some("")), None);
        assert_eq!(parse_positive_f32_env(Some("0")), None);
        assert_eq!(parse_positive_f32_env(Some("-1")), None);
        assert_eq!(parse_positive_f32_env(Some("NaN")), None);
        assert_eq!(parse_positive_f32_env(Some("inf")), None);
        assert_eq!(parse_positive_f32_env(Some("garbage")), None);
    }

    #[test]
    fn manual_terminal_cell_metrics_override_probe_values() {
        let cfg = UiConfig {
            font_family: "x".into(),
            terminal_font_family: "x-mono".into(),
            terminal_font_size: 13.0,
            diff_font_size: 12.0,
            terminal_cell_w_override: Some(9.5),
            terminal_cell_h_override: Some(18.5),
            bracketed_paste: true,
            prompt_max_chars: 32_000,
            confirm_send: false,
            terminal_debug_grid: false,
        };
        assert_eq!(cfg.terminal_cell_w(), 9.5);
        assert_eq!(cfg.terminal_cell_h(), 18.5);
        assert_eq!(cfg.terminal_cell_w_from_measurement(7.0), 9.5);
        assert_eq!(cfg.terminal_cell_h_from_measurement(15.0), 18.5);
    }

    #[test]
    fn terminal_debug_grid_default_off() {
        assert!(!parse_terminal_debug_grid_env(None));
        assert!(!parse_terminal_debug_grid_env(Some("")));
        assert!(!parse_terminal_debug_grid_env(Some("garbage")));
    }

    #[test]
    fn terminal_debug_grid_explicit_on() {
        for v in ["1", "true", "True", "on", "yes", "ON", "  YES  "] {
            assert!(parse_terminal_debug_grid_env(Some(v)));
        }
    }

    #[test]
    fn terminal_debug_grid_explicit_off() {
        for v in ["0", "false", "off", "no", "False"] {
            assert!(!parse_terminal_debug_grid_env(Some(v)));
        }
    }

    #[test]
    fn measured_terminal_cell_metrics_win_without_manual_override() {
        let cfg = UiConfig {
            font_family: "x".into(),
            terminal_font_family: "x-mono".into(),
            terminal_font_size: 13.0,
            diff_font_size: 12.0,
            terminal_cell_w_override: None,
            terminal_cell_h_override: None,
            bracketed_paste: true,
            prompt_max_chars: 32_000,
            confirm_send: false,
            terminal_debug_grid: false,
        };
        assert_eq!(cfg.terminal_cell_w_from_measurement(7.25), 7.25);
        assert_eq!(cfg.terminal_cell_h_from_measurement(15.75), 15.75);
        assert_eq!(
            cfg.terminal_cell_w_from_measurement(0.0),
            cfg.terminal_cell_w()
        );
        assert_eq!(
            cfg.terminal_cell_h_from_measurement(f32::NAN),
            cfg.terminal_cell_h()
        );
    }
}
