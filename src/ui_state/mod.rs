//! Slint モデルへの詰め替えユーティリティ。
//!
//! 当面は Terminal ペインの `TerminalRow` / `TerminalCell` 構築だけを扱う。
//! 将来 diff viewer が入る際もここに同種の builder を追加する想定。

pub mod color;
pub mod diff_view;
pub mod draft_view;

use std::rc::Rc;
use std::sync::OnceLock;

use alacritty_terminal::event::EventListener;
use alacritty_terminal::grid::Dimensions;
use alacritty_terminal::index::{Column, Line, Point};
use alacritty_terminal::term::cell::Flags;
use alacritty_terminal::term::{cell::Cell, Term};
use slint::{Color, Model, ModelRc, SharedString, VecModel};

use crate::{TerminalCell, TerminalRow};

const FG: Color = Color::from_rgb_u8(0xee, 0xee, 0xee);
const BG: Color = Color::from_rgb_u8(0x0b, 0x0b, 0x0b);

pub fn empty_row(cols: usize) -> TerminalRow {
    let cells = VecModel::<TerminalCell>::default();
    for _ in 0..cols {
        cells.push(TerminalCell {
            ch: SharedString::from(" "),
            fg: FG,
            bg: BG,
            span: 1,
            font_family: SharedString::from(""),
        });
    }
    TerminalRow {
        cells: ModelRc::from(Rc::new(cells) as Rc<dyn Model<Data = TerminalCell>>),
    }
}

pub fn build_row<T: EventListener>(term: &Term<T>, row: usize, cols: usize) -> TerminalRow {
    let cells = VecModel::<TerminalCell>::default();
    let grid = term.grid();
    let line = Line(row as i32);

    // ZWJ chain (絵文字 family など) は alacritty の grid 上では複数 cell に
    // またがって保持される。各 cell を独立した Slint Text にすると text
    // shaper が単一グリフとして処理できないため、ZWJ で繋がる連続セルを
    // 1 つの TerminalCell に merge し、消費した後続セルは span=0 (spacer)
    // で置き換えてグリッド位置を維持する。
    let mut col = 0usize;
    while col < cols {
        let cell = &grid[Point::new(line, Column(col))];
        let initial_span = base_span(cell);
        if initial_span == 0 {
            // すでに前の wide char にカバーされている spacer
            cells.push(spacer_cell());
            col += 1;
            continue;
        }

        let mut s = String::with_capacity(8);
        s.push(cell.c);
        let mut total_span = initial_span;
        let mut trailing_zwj = false;
        if let Some(zw) = cell.zerowidth() {
            for c in zw {
                s.push(*c);
                if *c == '\u{200D}' {
                    trailing_zwj = true;
                }
            }
        }

        let mut next_col = col + initial_span as usize;
        while trailing_zwj && next_col < cols {
            let next = &grid[Point::new(line, Column(next_col))];
            // 末尾 ZWJ の後に空白 / NUL が来たら chain 終端
            if next.c == ' ' || next.c == '\u{0}' {
                break;
            }
            let next_base = base_span(next);
            if next_base == 0 {
                break;
            }
            s.push(next.c);
            trailing_zwj = false;
            if let Some(zw) = next.zerowidth() {
                for c in zw {
                    s.push(*c);
                    if *c == '\u{200D}' {
                        trailing_zwj = true;
                    }
                }
            }
            total_span += next_base;
            next_col += next_base as usize;
        }

        cells.push(cell_to_terminal_cell(cell, total_span, s.as_str()));
        // メインの 1 セル目の右側を spacer で埋めてグリッド整列を保つ
        for _ in 1..total_span {
            cells.push(spacer_cell());
        }
        col += total_span as usize;
    }

    TerminalRow {
        cells: ModelRc::from(Rc::new(cells) as Rc<dyn Model<Data = TerminalCell>>),
    }
}

fn spacer_cell() -> TerminalCell {
    TerminalCell {
        ch: SharedString::from(""),
        fg: FG,
        bg: BG,
        span: 0,
        font_family: SharedString::from(""),
    }
}

fn cell_to_terminal_cell(cell: &Cell, span: i32, ch: &str) -> TerminalCell {
    TerminalCell {
        ch: SharedString::from(ch),
        fg: color::cell_fg(cell),
        bg: color::cell_bg(cell),
        span,
        font_family: SharedString::from(font_family_for_glyph(ch)),
    }
}

/// Glyph 文字列の分類結果。emoji / 装飾 symbol / CJK / Hangul / その他
/// (ASCII 等) に分け、
/// per-cell font-family を選ぶ。Slint Text の font-family は実質単一 family と
/// して扱われがちで、カンマ区切り fallback の per-glyph 解決が崩れる事象 (#277)
/// があるため、必要な cell だけ専用 family を渡す。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum GlyphCategory {
    /// 既定 font-family にフォールバックする (ASCII / spacer)。
    Default,
    /// CJK / Kana などの East Asian glyph。
    Cjk,
    /// Hangul。Windows/macOS では日本語向け CJK font と別 family が必要。
    Hangul,
    /// emoji (絵文字 / ZWJ chain / Variation Selector-16 / Regional Indicator)。
    Emoji,
    /// 装飾的な記号・矢印 (例: ↯ U+21AF)。
    Symbol,
}

fn classify_glyph(s: &str) -> GlyphCategory {
    if s.is_empty() {
        return GlyphCategory::Default;
    }
    let mut emoji = false;
    let mut symbol = false;
    let mut hangul = false;
    let mut cjk = false;
    for ch in s.chars() {
        let c = ch as u32;
        // ZWJ / VS16 / Regional Indicator が含まれていれば確定で emoji。
        if c == 0x200D || c == 0xFE0F || (0x1F1E6..=0x1F1FF).contains(&c) {
            return GlyphCategory::Emoji;
        }
        if is_default_emoji_codepoint(c) {
            emoji = true;
        } else if is_decorative_symbol_codepoint(c) {
            symbol = true;
        } else if is_hangul_codepoint(c) {
            hangul = true;
        } else if is_cjk_codepoint(c) {
            cjk = true;
        }
    }
    if emoji {
        GlyphCategory::Emoji
    } else if symbol {
        GlyphCategory::Symbol
    } else if hangul {
        GlyphCategory::Hangul
    } else if cjk {
        GlyphCategory::Cjk
    } else {
        GlyphCategory::Default
    }
}

/// 既定で emoji presentation になる codepoint かどうかの近似判定。
/// Unicode の `Emoji_Presentation` プロパティを完全には参照しないが、
/// terminal pane で頻出する 🚀 や 1F000 系・主要 BMP emoji を拾う。
fn is_default_emoji_codepoint(c: u32) -> bool {
    // SMP の emoji 系ブロック。1FB00 以降には legacy computing symbols など
    // monospace terminal で通常フォントのまま扱いたいものもあるため含めない。
    if (0x1F000..=0x1FAFF).contains(&c) {
        return true;
    }
    // BMP 上で `Emoji_Presentation=Yes` の代表的 codepoint。網羅ではないが
    // よく出るもの (✅ ⭐ ⌚ など) を拾う。それ以外の dingbats / misc symbols は
    // VS16 が無ければ symbol 扱いで十分 (Apple Symbols / Segoe UI Symbol で描ける)。
    matches!(
        c,
        0x231A | 0x231B
            | 0x23E9..=0x23EC
            | 0x23F0
            | 0x23F3
            | 0x25FD
            | 0x25FE
            | 0x2614
            | 0x2615
            | 0x2648..=0x2653
            | 0x267F
            | 0x2693
            | 0x26A1
            | 0x26AA
            | 0x26AB
            | 0x26BD
            | 0x26BE
            | 0x26C4
            | 0x26C5
            | 0x26CE
            | 0x26D4
            | 0x26EA
            | 0x26F2
            | 0x26F3
            | 0x26F5
            | 0x26FA
            | 0x26FD
            | 0x2705
            | 0x270A
            | 0x270B
            | 0x2728
            | 0x274C
            | 0x274E
            | 0x2753..=0x2755
            | 0x2757
            | 0x2795..=0x2797
            | 0x27B0
            | 0x27BF
            | 0x2B1B
            | 0x2B1C
            | 0x2B50
            | 0x2B55
    )
}

/// 装飾的な symbol / arrow 系 BMP ブロック。↯ (U+21AF) を含む Arrows、
/// Geometric Shapes、Misc Symbols & Arrows などを拾う。Box Drawing / Block
/// Elements は terminal UI で罫線として頻出し、monospace font に任せた方が
/// grid が崩れにくいためここでは専用 symbol font に切り替えない。
fn is_decorative_symbol_codepoint(c: u32) -> bool {
    matches!(
        c,
        0x2190..=0x21FF // Arrows (↯ U+21AF)
            | 0x2200..=0x22FF // Mathematical Operators
            | 0x2300..=0x23FF // Misc Technical
            | 0x25A0..=0x25FF // Geometric Shapes
            | 0x2600..=0x26FF // Misc Symbols
            | 0x2700..=0x27BF // Dingbats
            | 0x2900..=0x297F // Supplemental Arrows-B
            | 0x2980..=0x29FF // Misc Math Symbols-B
            | 0x2A00..=0x2AFF // Supplemental Math Operators
            | 0x2B00..=0x2BFF // Misc Symbols and Arrows
    )
}

/// CJK / Kana など East Asian glyph の近似判定。
///
/// alacritty 側の wide-cell 判定により多くの CJK glyph は span=2 になるため、
/// Slint 側では cell ごとに CJK font を明示し、font-family fallback が効かず
/// □ になるケース (#327) を避ける。Box Drawing (U+2500..=U+257F) は terminal
/// grid を保つため含めない。
fn is_cjk_codepoint(c: u32) -> bool {
    matches!(
        c,
        0x2E80..=0x2EFF // CJK Radicals Supplement
            | 0x2F00..=0x2FDF // Kangxi Radicals
            | 0x3000..=0x303F // CJK Symbols and Punctuation
            | 0x3040..=0x309F // Hiragana
            | 0x30A0..=0x30FF // Katakana
            | 0x3100..=0x312F // Bopomofo
            | 0x3190..=0x319F // Kanbun
            | 0x31A0..=0x31BF // Bopomofo Extended
            | 0x31C0..=0x31EF // CJK Strokes
            | 0x31F0..=0x31FF // Katakana Phonetic Extensions
            | 0x3400..=0x4DBF // CJK Unified Ideographs Extension A
            | 0x4E00..=0x9FFF // CJK Unified Ideographs
            | 0xF900..=0xFAFF // CJK Compatibility Ideographs
            | 0xFE10..=0xFE1F // Vertical Forms
            | 0xFE30..=0xFE4F // CJK Compatibility Forms
            | 0xFF00..=0xFFEF // Halfwidth and Fullwidth Forms
            | 0x20000..=0x2FA1F // CJK Unified Ideographs Extensions B..compat
    )
}

/// Hangul glyph の近似判定。日本語向け CJK font は Hangul を含まないことがある
/// ため、CJK と別カテゴリにして per-cell family を分ける。
fn is_hangul_codepoint(c: u32) -> bool {
    matches!(
        c,
        0x1100..=0x11FF // Hangul Jamo
            | 0x3130..=0x318F // Hangul Compatibility Jamo
            | 0xA960..=0xA97F // Hangul Jamo Extended-A
            | 0xAC00..=0xD7AF // Hangul Syllables
            | 0xD7B0..=0xD7FF // Hangul Jamo Extended-B
    )
}

/// emoji 用 font family。`LOCUS_TERMINAL_EMOJI_FONT_FAMILY` で OS 既定を上書き
/// できる (例: Linux で `Twemoji Mozilla` を強制したい場合など)。
fn emoji_font_family() -> &'static str {
    static CACHE: OnceLock<String> = OnceLock::new();
    CACHE
        .get_or_init(|| {
            std::env::var("LOCUS_TERMINAL_EMOJI_FONT_FAMILY")
                .ok()
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty())
                .unwrap_or_else(|| default_emoji_font_family().to_string())
        })
        .as_str()
}

/// 装飾 symbol / arrow 用 font family。`LOCUS_TERMINAL_SYMBOL_FONT_FAMILY` で
/// OS 既定を上書き可能。
fn symbol_font_family() -> &'static str {
    static CACHE: OnceLock<String> = OnceLock::new();
    CACHE
        .get_or_init(|| {
            std::env::var("LOCUS_TERMINAL_SYMBOL_FONT_FAMILY")
                .ok()
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty())
                .unwrap_or_else(|| default_symbol_font_family().to_string())
        })
        .as_str()
}

/// Hangul 用 font family。`LOCUS_TERMINAL_HANGUL_FONT_FAMILY` で OS 既定を
/// 上書き可能。
fn hangul_font_family() -> &'static str {
    static CACHE: OnceLock<String> = OnceLock::new();
    CACHE
        .get_or_init(|| {
            std::env::var("LOCUS_TERMINAL_HANGUL_FONT_FAMILY")
                .ok()
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty())
                .unwrap_or_else(|| default_hangul_font_family().to_string())
        })
        .as_str()
}

/// CJK / Kana 用 font family。`LOCUS_TERMINAL_CJK_FONT_FAMILY` で
/// OS 既定を上書き可能。
fn cjk_font_family() -> &'static str {
    static CACHE: OnceLock<String> = OnceLock::new();
    CACHE
        .get_or_init(|| {
            std::env::var("LOCUS_TERMINAL_CJK_FONT_FAMILY")
                .ok()
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty())
                .unwrap_or_else(|| default_cjk_font_family().to_string())
        })
        .as_str()
}

const fn default_emoji_font_family() -> &'static str {
    #[cfg(target_os = "macos")]
    {
        "Apple Color Emoji"
    }
    #[cfg(target_os = "windows")]
    {
        "Segoe UI Emoji"
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        "Noto Color Emoji"
    }
}

const fn default_symbol_font_family() -> &'static str {
    #[cfg(target_os = "macos")]
    {
        "Apple Symbols"
    }
    #[cfg(target_os = "windows")]
    {
        "Segoe UI Symbol"
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        "Noto Sans Symbols 2"
    }
}

const fn default_hangul_font_family() -> &'static str {
    #[cfg(target_os = "macos")]
    {
        "Apple SD Gothic Neo"
    }
    #[cfg(target_os = "windows")]
    {
        "Malgun Gothic"
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        "Noto Sans CJK KR"
    }
}

const fn default_cjk_font_family() -> &'static str {
    #[cfg(target_os = "macos")]
    {
        "Hiragino Sans"
    }
    #[cfg(target_os = "windows")]
    {
        "Yu Gothic UI"
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        "Noto Sans CJK JP"
    }
}

fn font_family_for_glyph(s: &str) -> &'static str {
    match classify_glyph(s) {
        GlyphCategory::Emoji => emoji_font_family(),
        GlyphCategory::Symbol => symbol_font_family(),
        GlyphCategory::Hangul => hangul_font_family(),
        GlyphCategory::Cjk => cjk_font_family(),
        GlyphCategory::Default => "",
    }
}

fn base_span(cell: &Cell) -> i32 {
    if cell
        .flags
        .intersects(Flags::WIDE_CHAR_SPACER | Flags::LEADING_WIDE_CHAR_SPACER)
    {
        0
    } else if cell.flags.contains(Flags::WIDE_CHAR) {
        2
    } else {
        1
    }
}

// 旧 make_cell は廃止。build_row が ZWJ chain を merge しつつ直接構築する。

/// Term の現在の row 数を取得するヘルパ。
#[allow(dead_code)]
pub fn term_screen_lines<T: EventListener>(term: &Term<T>) -> usize {
    term.grid().screen_lines()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn arrow_decorative_symbol_classified_as_symbol() {
        // ↯ (U+21AF) は Apple Symbols / Segoe UI Symbol で描ける装飾的 arrow。
        // Slint の Text font-family fallback だけだと □ になる事象 (#277) を
        // 避けるため、symbol カテゴリに振り分ける。
        assert_eq!(classify_glyph("↯"), GlyphCategory::Symbol);
        assert_eq!(font_family_for_glyph("↯"), default_symbol_font_family());
    }

    #[test]
    fn rocket_emoji_classified_as_emoji() {
        // 🚀 (U+1F680) は SMP の emoji ブロックなので emoji 確定。
        assert_eq!(classify_glyph("🚀"), GlyphCategory::Emoji);
        assert_eq!(font_family_for_glyph("🚀"), default_emoji_font_family());
    }

    #[test]
    fn zwj_emoji_chain_classified_as_emoji() {
        // 👨‍👩‍👧 = U+1F468 ZWJ U+1F469 ZWJ U+1F467
        let zwj = "\u{1F468}\u{200D}\u{1F469}\u{200D}\u{1F467}";
        assert_eq!(classify_glyph(zwj), GlyphCategory::Emoji);
        assert_eq!(font_family_for_glyph(zwj), default_emoji_font_family());
    }

    #[test]
    fn variation_selector_16_forces_emoji_presentation() {
        // VS16 が付いた dingbat / misc symbol は emoji 扱い。
        let snowman_with_vs16 = "\u{2603}\u{FE0F}";
        assert_eq!(classify_glyph(snowman_with_vs16), GlyphCategory::Emoji);
    }

    #[test]
    fn regional_indicator_classified_as_emoji() {
        // 🇯🇵 = U+1F1EF U+1F1F5 (regional indicators)
        let flag = "\u{1F1EF}\u{1F1F5}";
        assert_eq!(classify_glyph(flag), GlyphCategory::Emoji);
    }

    #[test]
    fn ascii_classified_as_default() {
        assert_eq!(classify_glyph("A"), GlyphCategory::Default);
        assert_eq!(classify_glyph("hello"), GlyphCategory::Default);
        assert_eq!(font_family_for_glyph("A"), "");
    }

    #[test]
    fn cjk_classified_as_cjk() {
        // CJK は既存 fallback chain 任せだと Slint 側で □ になる環境があるため、
        // CJK cell ごとに専用 family を渡す。
        assert_eq!(classify_glyph("あ"), GlyphCategory::Cjk);
        assert_eq!(classify_glyph("漢"), GlyphCategory::Cjk);
        assert_eq!(font_family_for_glyph("あ"), default_cjk_font_family());
    }

    #[test]
    fn hangul_classified_as_hangul() {
        assert_eq!(classify_glyph("한"), GlyphCategory::Hangul);
        assert_eq!(
            font_family_for_glyph("한"),
            default_hangul_font_family()
        );
    }

    #[test]
    fn cjk_punctuation_uses_cjk_font() {
        assert_eq!(classify_glyph("。"), GlyphCategory::Cjk);
        assert_eq!(classify_glyph("："), GlyphCategory::Cjk);
        assert_eq!(font_family_for_glyph("。"), default_cjk_font_family());
    }

    #[test]
    fn empty_glyph_classified_as_default() {
        // span=0 spacer cell は空文字。font-family も空のままで spacer 整列を維持。
        assert_eq!(classify_glyph(""), GlyphCategory::Default);
        assert_eq!(font_family_for_glyph(""), "");
    }

    #[test]
    fn space_classified_as_default() {
        // ASCII space は通常 cell として扱う。symbol/emoji family を渡すと
        // monospace 幅が崩れる可能性があるので Default に倒す。
        assert_eq!(classify_glyph(" "), GlyphCategory::Default);
    }

    #[test]
    fn box_drawing_stays_default_to_preserve_grid() {
        // ─ U+2500, ┃ U+2503 などの罫線は terminal UI で頻出する。
        // 専用 symbol font に倒すと monospace grid と見た目がずれやすいため、
        // 通常 terminal font に任せる。
        assert_eq!(classify_glyph("─"), GlyphCategory::Default);
        assert_eq!(classify_glyph("┃"), GlyphCategory::Default);
    }

    #[test]
    fn empty_row_cells_have_empty_font_family() {
        // span=1 の通常 spacer cell の font-family は空文字 (既定 fallback)。
        let row = empty_row(3);
        let cells = row.cells;
        assert_eq!(cells.row_count(), 3);
        for i in 0..cells.row_count() {
            let c = cells.row_data(i).unwrap();
            assert_eq!(c.span, 1);
            assert_eq!(c.font_family.as_str(), "");
        }
    }
}
