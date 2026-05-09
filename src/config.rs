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
    /// Slint 隠し Text probe (`measured-terminal-cell-w/h`) の値を採用するか。
    /// 既定 false: 比率 fallback (`terminal_cell_w()` / `terminal_cell_h()`) を
    /// 優先する。macOS の SF Mono / Menlo では probe が advance を過大、行高を
    /// 過小に返し、結果として grid と glyph がズレる事象 (#292 / #289) を観測
    /// したため、`LOCUS_TERMINAL_PROBE_METRICS=true` を明示しない限り probe を
    /// 信用しない。手動 override (`LOCUS_TERMINAL_CELL_W/H`) は常に最優先。
    pub terminal_probe_metrics: bool,
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
            parse_bool_env(std::env::var("LOCUS_CONFIRM_SEND").ok().as_deref());
        let terminal_cell_w_override =
            parse_positive_f32_env(std::env::var("LOCUS_TERMINAL_CELL_W").ok().as_deref());
        let terminal_cell_h_override =
            parse_positive_f32_env(std::env::var("LOCUS_TERMINAL_CELL_H").ok().as_deref());
        let terminal_debug_grid =
            parse_bool_env(std::env::var("LOCUS_TERMINAL_DEBUG_GRID").ok().as_deref());
        let terminal_probe_metrics =
            parse_bool_env(std::env::var("LOCUS_TERMINAL_PROBE_METRICS").ok().as_deref());
        Self {
            font_family,
            terminal_font_family,
            terminal_font_size,
            diff_font_size,
            terminal_cell_w_override,
            terminal_cell_h_override,
            terminal_probe_metrics,
            bracketed_paste,
            prompt_max_chars,
            confirm_send,
            terminal_debug_grid,
        }
    }

    /// monospace の典型的な比率 (advance ≈ 0.6 em, line height ≈ 1.45 em)
    /// から cell width/height をピクセルに変換する既定値。
    ///
    /// 既定では `terminal_cell_w_from_measurement` 経由でこの比率値が採用される
    /// (Slint 側 `measured-terminal-cell-w/h` probe は #292 / #289 の再現を
    /// 避けるため既定 off)。`LOCUS_TERMINAL_CELL_W/H` の手動 override がある
    /// 場合はそちらが優先され、`LOCUS_TERMINAL_PROBE_METRICS=true` を opt-in
    /// したときだけ probe 値が採用される。
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
    /// 優先順位は: 手動 override (`LOCUS_TERMINAL_CELL_W/H`) > probe (有効時のみ) >
    /// 比率 fallback。probe は既定で無効化されており、`terminal_probe_metrics`
    /// が true で、かつ実測値が正の有限値の場合だけ採用する。macOS では
    /// `MMMMMMMMMM` の `preferred-width` が advance を過大、`preferred-height`
    /// が行高を過小に返すケース (#292 / #289) があり、既定で信用すると grid と
    /// glyph がズレるため。
    pub fn terminal_cell_w_from_measurement(&self, measured: f32) -> f32 {
        if let Some(cell_w) = self.terminal_cell_w_override {
            return cell_w;
        }
        if self.terminal_probe_metrics && measured.is_finite() && measured > 0.0 {
            return measured;
        }
        self.terminal_cell_w()
    }

    pub fn terminal_cell_h_from_measurement(&self, measured: f32) -> f32 {
        if let Some(cell_h) = self.terminal_cell_h_override {
            return cell_h;
        }
        if self.terminal_probe_metrics && measured.is_finite() && measured > 0.0 {
            return measured;
        }
        self.terminal_cell_h()
    }

    pub fn terminal_cell_w_source(&self, measured: f32) -> &'static str {
        if self.terminal_cell_w_override.is_some() {
            "override"
        } else if self.terminal_probe_metrics && measured.is_finite() && measured > 0.0 {
            "probe"
        } else {
            "fallback"
        }
    }

    pub fn terminal_cell_h_source(&self, measured: f32) -> &'static str {
        if self.terminal_cell_h_override.is_some() {
            "override"
        } else if self.terminal_probe_metrics && measured.is_finite() && measured > 0.0 {
            "probe"
        } else {
            "fallback"
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

/// fail-closed な真偽値環境変数の共通 parser。
///
/// - 未設定 / 空 / 不明値 / `0` / `false` / `off` / `no` → false (既定)
/// - `1` / `true` / `on` / `yes` → true
///
/// `LOCUS_CONFIRM_SEND` (Insert+Send 確認 checkbox の opt-in)、
/// `LOCUS_TERMINAL_DEBUG_GRID` (terminal cell metric の debug overlay)、
/// `LOCUS_TERMINAL_PROBE_METRICS` (Slint 隠し Text probe の opt-in) など、
/// 「明示的に有効化されたときだけ既定挙動を変える」フラグで使う。
/// `LOCUS_TERMINAL_PROBE_METRICS` は macOS で probe (`preferred-width` /
/// `preferred-height`) が SF Mono / Menlo 系の幅を過大・行高を過小に返し
/// cell と glyph がズレる #292 / #289 を避けるため、既定 false で比率
/// fallback を信用する設計になっている。
pub fn parse_bool_env(value: Option<&str>) -> bool {
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

    fn fixture(font_size: f32) -> UiConfig {
        UiConfig {
            font_family: "test".into(),
            terminal_font_family: "test-mono".into(),
            terminal_font_size: font_size,
            diff_font_size: font_size,
            terminal_cell_w_override: None,
            terminal_cell_h_override: None,
            terminal_probe_metrics: false,
            bracketed_paste: true,
            prompt_max_chars: 32_000,
            confirm_send: false,
            terminal_debug_grid: false,
        }
    }

    #[test]
    fn default_metrics_are_reasonable() {
        let cfg = fixture(12.0);
        assert!(cfg.terminal_cell_w() >= 6.0);
        assert!(cfg.terminal_cell_h() >= 14.0);
    }

    #[test]
    fn cell_metrics_scale_with_font_size() {
        let small = fixture(10.0);
        let big = fixture(20.0);
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
        let mut cfg = fixture(13.0);
        cfg.terminal_cell_w_override = Some(9.5);
        cfg.terminal_cell_h_override = Some(18.5);
        cfg.terminal_probe_metrics = true; // probe 有効でも override が最優先
        assert_eq!(cfg.terminal_cell_w(), 9.5);
        assert_eq!(cfg.terminal_cell_h(), 18.5);
        assert_eq!(cfg.terminal_cell_w_from_measurement(7.0), 9.5);
        assert_eq!(cfg.terminal_cell_h_from_measurement(15.0), 18.5);
    }

    #[test]
    fn bool_env_default_off() {
        assert!(!parse_bool_env(None));
        assert!(!parse_bool_env(Some("")));
        assert!(!parse_bool_env(Some("garbage")));
    }

    #[test]
    fn bool_env_explicit_on() {
        for v in ["1", "true", "True", "on", "yes", "ON", "  YES  "] {
            assert!(parse_bool_env(Some(v)));
        }
    }

    #[test]
    fn bool_env_explicit_off() {
        for v in ["0", "false", "off", "no", "False"] {
            assert!(!parse_bool_env(Some(v)));
        }
    }

    #[test]
    fn default_ignores_probe_metrics_and_uses_ratio_fallback() {
        // 既定 (probe 無効) では実測値が「妥当そう」でも採用しない。これは macOS で
        // probe 値が glyph と grid をズラす #292 / #289 の再現を回避するため。
        let cfg = fixture(13.0);
        assert!(!cfg.terminal_probe_metrics);

        // 同じ font_size で probe が advance を過大 (10.9) 行高を過小 (13.0) に
        // 返した実機ログ (#292 baseline) を入れても fallback ratio で解決される。
        assert_eq!(
            cfg.terminal_cell_w_from_measurement(10.9),
            cfg.terminal_cell_w()
        );
        assert_eq!(
            cfg.terminal_cell_h_from_measurement(13.0),
            cfg.terminal_cell_h()
        );
        // 一見妥当そうな値も既定では信用しない
        assert_eq!(
            cfg.terminal_cell_w_from_measurement(7.25),
            cfg.terminal_cell_w()
        );
        assert_eq!(
            cfg.terminal_cell_h_from_measurement(18.5),
            cfg.terminal_cell_h()
        );
        // pathological も従来同様 fallback
        assert_eq!(
            cfg.terminal_cell_w_from_measurement(0.0),
            cfg.terminal_cell_w()
        );
        assert_eq!(
            cfg.terminal_cell_h_from_measurement(f32::NAN),
            cfg.terminal_cell_h()
        );
        assert_eq!(cfg.terminal_cell_w_source(10.9), "fallback");
        assert_eq!(cfg.terminal_cell_h_source(13.0), "fallback");
    }

    #[test]
    fn opt_in_probe_metrics_use_measured_values() {
        // `LOCUS_TERMINAL_PROBE_METRICS=true` 相当: 旧挙動を opt-in できる。
        let mut cfg = fixture(13.0);
        cfg.terminal_probe_metrics = true;

        assert_eq!(cfg.terminal_cell_w_from_measurement(7.25), 7.25);
        assert_eq!(cfg.terminal_cell_h_from_measurement(15.75), 15.75);
        assert_eq!(cfg.terminal_cell_w_source(7.25), "probe");
        assert_eq!(cfg.terminal_cell_h_source(15.75), "probe");
        // 異常値 (0 / NaN) は probe 有効でも fallback に倒す
        assert_eq!(
            cfg.terminal_cell_w_from_measurement(0.0),
            cfg.terminal_cell_w()
        );
        assert_eq!(
            cfg.terminal_cell_h_from_measurement(f32::NAN),
            cfg.terminal_cell_h()
        );
    }

    #[test]
    fn manual_override_beats_probe_opt_in() {
        // override + probe 有効 でも override が最優先。診断時に
        // `LOCUS_TERMINAL_CELL_W/H` を強制値として使う運用を保証する。
        let mut cfg = fixture(13.0);
        cfg.terminal_cell_w_override = Some(8.0);
        cfg.terminal_cell_h_override = Some(19.0);
        cfg.terminal_probe_metrics = true;

        assert_eq!(cfg.terminal_cell_w_from_measurement(10.9), 8.0);
        assert_eq!(cfg.terminal_cell_h_from_measurement(13.0), 19.0);
        assert_eq!(cfg.terminal_cell_w_source(10.9), "override");
        assert_eq!(cfg.terminal_cell_h_source(13.0), "override");
    }

}
