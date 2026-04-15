//! alacritty_terminal の Cell に入っている `vte::ansi::Color` を Slint の
//! `slint::Color` に変換するパレット定義。
//!
//! 既定の前景 / 背景は terminal pane のテーマに合わせて持つ。Named / Spec
//! / Indexed の 3 形態すべてに対応する。
//!
//! 今は default の 16 色 + 6x6x6 cube + grayscale を採用。bold/italic/
//! underline は将来扱う予定だが、INVERSE と DIM は cell 単位で適用する。

use alacritty_terminal::term::cell::{Cell, Flags};
use alacritty_terminal::vte::ansi::{Color as AnsiColor, NamedColor, Rgb};
use slint::Color;

const FG: Color = Color::from_rgb_u8(0xee, 0xee, 0xee);
const BG: Color = Color::from_rgb_u8(0x0b, 0x0b, 0x0b);

/// xterm が出荷時に使う標準 16 色 (X11 rgb.txt の名前色)。
///
/// 参照: https://invisible-island.net/xterm/xterm.faq.html#color_by_number
const PALETTE_16: [Color; 16] = [
    Color::from_rgb_u8(0x00, 0x00, 0x00), // 0 black
    Color::from_rgb_u8(0xcd, 0x00, 0x00), // 1 red3
    Color::from_rgb_u8(0x00, 0xcd, 0x00), // 2 green3
    Color::from_rgb_u8(0xcd, 0xcd, 0x00), // 3 yellow3
    Color::from_rgb_u8(0x00, 0x00, 0xee), // 4 blue2
    Color::from_rgb_u8(0xcd, 0x00, 0xcd), // 5 magenta3
    Color::from_rgb_u8(0x00, 0xcd, 0xcd), // 6 cyan3
    Color::from_rgb_u8(0xe5, 0xe5, 0xe5), // 7 gray90
    Color::from_rgb_u8(0x7f, 0x7f, 0x7f), // 8 gray50
    Color::from_rgb_u8(0xff, 0x00, 0x00), // 9 red
    Color::from_rgb_u8(0x00, 0xff, 0x00), // 10 green
    Color::from_rgb_u8(0xff, 0xff, 0x00), // 11 yellow
    Color::from_rgb_u8(0x5c, 0x5c, 0xff), // 12 rgb:5c/5c/ff (xterm)
    Color::from_rgb_u8(0xff, 0x00, 0xff), // 13 magenta
    Color::from_rgb_u8(0x00, 0xff, 0xff), // 14 cyan
    Color::from_rgb_u8(0xff, 0xff, 0xff), // 15 white
];

/// 16〜231 の 6x6x6 RGB cube 用のレベル変換テーブル。
const CUBE_LEVELS: [u8; 6] = [0x00, 0x5f, 0x87, 0xaf, 0xd7, 0xff];

pub fn cell_fg(cell: &Cell) -> Color {
    let (fg, bg) = resolve_fg_bg(cell);
    if cell.flags.contains(Flags::INVERSE) { bg } else { fg }
}

pub fn cell_bg(cell: &Cell) -> Color {
    let (fg, bg) = resolve_fg_bg(cell);
    if cell.flags.contains(Flags::INVERSE) { fg } else { bg }
}

/// upstream alacritty に倣い、INVERSE swap の前に DIM を fg に適用する。
/// Indexed(0..15) + DIM の場合は通常 palette ではなく dim 色 (rgb 2/3 倍) を
/// 使う。これにより DIM+INVERSE を併用したセルで bg として dim 色が見える。
fn resolve_fg_bg(cell: &Cell) -> (Color, Color) {
    let mut fg = ansi_to_slint(cell.fg, FG);
    let bg = ansi_to_slint(cell.bg, BG);
    if cell.flags.contains(Flags::DIM) {
        fg = dim(fg);
    }
    (fg, bg)
}

fn ansi_to_slint(color: AnsiColor, fallback: Color) -> Color {
    match color {
        AnsiColor::Named(name) => named_to_color(name, fallback),
        AnsiColor::Spec(Rgb { r, g, b }) => Color::from_rgb_u8(r, g, b),
        AnsiColor::Indexed(idx) => indexed_to_color(idx, fallback),
    }
}

fn named_to_color(name: NamedColor, _fallback: Color) -> Color {
    match name {
        NamedColor::Black => PALETTE_16[0],
        NamedColor::Red => PALETTE_16[1],
        NamedColor::Green => PALETTE_16[2],
        NamedColor::Yellow => PALETTE_16[3],
        NamedColor::Blue => PALETTE_16[4],
        NamedColor::Magenta => PALETTE_16[5],
        NamedColor::Cyan => PALETTE_16[6],
        NamedColor::White => PALETTE_16[7],
        NamedColor::BrightBlack => PALETTE_16[8],
        NamedColor::BrightRed => PALETTE_16[9],
        NamedColor::BrightGreen => PALETTE_16[10],
        NamedColor::BrightYellow => PALETTE_16[11],
        NamedColor::BrightBlue => PALETTE_16[12],
        NamedColor::BrightMagenta => PALETTE_16[13],
        NamedColor::BrightCyan => PALETTE_16[14],
        NamedColor::BrightWhite => PALETTE_16[15],
        NamedColor::Foreground | NamedColor::BrightForeground | NamedColor::DimForeground => FG,
        NamedColor::Background => BG,
        NamedColor::Cursor => FG,
        NamedColor::DimBlack => dim(PALETTE_16[0]),
        NamedColor::DimRed => dim(PALETTE_16[1]),
        NamedColor::DimGreen => dim(PALETTE_16[2]),
        NamedColor::DimYellow => dim(PALETTE_16[3]),
        NamedColor::DimBlue => dim(PALETTE_16[4]),
        NamedColor::DimMagenta => dim(PALETTE_16[5]),
        NamedColor::DimCyan => dim(PALETTE_16[6]),
        NamedColor::DimWhite => dim(PALETTE_16[7]),
    }
}


fn indexed_to_color(idx: u8, fallback: Color) -> Color {
    match idx {
        0..=15 => PALETTE_16[idx as usize],
        16..=231 => {
            let v = (idx - 16) as usize;
            let r = CUBE_LEVELS[v / 36];
            let g = CUBE_LEVELS[(v / 6) % 6];
            let b = CUBE_LEVELS[v % 6];
            Color::from_rgb_u8(r, g, b)
        }
        232..=255 => {
            // 24 段グレースケール (8..238、step 10)
            let level = 8u8.saturating_add((idx - 232).saturating_mul(10));
            Color::from_rgb_u8(level, level, level)
        }
        #[allow(unreachable_patterns)]
        _ => fallback,
    }
}

fn dim(c: Color) -> Color {
    let r = (c.red() as u32 * 2 / 3) as u8;
    let g = (c.green() as u32 * 2 / 3) as u8;
    let b = (c.blue() as u32 * 2 / 3) as u8;
    Color::from_rgb_u8(r, g, b)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn indexed_0_to_15_is_palette() {
        for i in 0u8..16 {
            assert_eq!(indexed_to_color(i, FG), PALETTE_16[i as usize]);
        }
    }

    #[test]
    fn indexed_16_is_cube_origin() {
        let c = indexed_to_color(16, FG);
        // (0, 0, 0)
        assert_eq!((c.red(), c.green(), c.blue()), (0x00, 0x00, 0x00));
    }

    #[test]
    fn indexed_231_is_cube_corner() {
        let c = indexed_to_color(231, FG);
        // (5, 5, 5) -> (255, 255, 255)
        assert_eq!((c.red(), c.green(), c.blue()), (0xff, 0xff, 0xff));
    }

    #[test]
    fn indexed_232_is_dark_gray() {
        let c = indexed_to_color(232, FG);
        // 8
        assert_eq!((c.red(), c.green(), c.blue()), (8, 8, 8));
    }

    #[test]
    fn dim_reduces_components() {
        let c = dim(Color::from_rgb_u8(0xff, 0xff, 0xff));
        assert!(c.red() < 0xff);
    }

    #[test]
    fn named_red_is_palette_red() {
        assert_eq!(named_to_color(NamedColor::Red, FG), PALETTE_16[1]);
    }

    #[test]
    fn xterm_default_palette_values() {
        // 主要色について xterm 既定値で固定する
        assert_eq!(
            (PALETTE_16[1].red(), PALETTE_16[1].green(), PALETTE_16[1].blue()),
            (0xcd, 0x00, 0x00)
        );
        assert_eq!(
            (PALETTE_16[2].red(), PALETTE_16[2].green(), PALETTE_16[2].blue()),
            (0x00, 0xcd, 0x00)
        );
        assert_eq!(
            (PALETTE_16[4].red(), PALETTE_16[4].green(), PALETTE_16[4].blue()),
            (0x00, 0x00, 0xee)
        );
        assert_eq!(
            (PALETTE_16[12].red(), PALETTE_16[12].green(), PALETTE_16[12].blue()),
            (0x5c, 0x5c, 0xff)
        );
    }

    fn make_cell_with(flags: Flags, fg: AnsiColor, bg: AnsiColor) -> Cell {
        Cell {
            fg,
            bg,
            flags,
            ..Cell::default()
        }
    }

    #[test]
    fn dim_then_inverse_swaps_dimmed_fg_into_bg() {
        let red = AnsiColor::Indexed(1);
        let blue = AnsiColor::Indexed(4);
        let cell = make_cell_with(Flags::DIM | Flags::INVERSE, red, blue);
        // INVERSE swap 後の fg = もとの bg、bg = DIM 適用済の fg
        let fg = cell_fg(&cell);
        let bg = cell_bg(&cell);
        // 元の bg=blue が fg に
        let expected_fg = PALETTE_16[4];
        assert_eq!(
            (fg.red(), fg.green(), fg.blue()),
            (expected_fg.red(), expected_fg.green(), expected_fg.blue())
        );
        // bg は DIM(red) なので元 red より暗い (R 成分が下がる)
        assert!((bg.red() as u32) < 0xcd);
    }
}
