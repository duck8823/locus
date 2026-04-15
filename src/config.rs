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
        Self {
            font_family,
            terminal_font_size,
            diff_font_size,
        }
    }

    /// monospace の典型的な比率 (advance ≈ 0.6 em, line height ≈ 1.4 em)
    /// から cell width/height をピクセルに変換する。
    /// 本物の glyph metric を測る代わりに、十分実用的な近似値。
    pub fn terminal_cell_w(&self) -> f32 {
        (self.terminal_font_size * 0.6).round().max(4.0)
    }

    pub fn terminal_cell_h(&self) -> f32 {
        (self.terminal_font_size * 1.45).round().max(8.0)
    }
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
        };
        let big = UiConfig {
            font_family: "x".into(),
            terminal_font_size: 20.0,
            diff_font_size: 20.0,
        };
        assert!(big.terminal_cell_w() > small.terminal_cell_w());
        assert!(big.terminal_cell_h() > small.terminal_cell_h());
    }
}
