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

/// xterm 互換の標準 16 色。
const PALETTE_16: [Color; 16] = [
    Color::from_rgb_u8(0x00, 0x00, 0x00), // 0 black
    Color::from_rgb_u8(0xcd, 0x31, 0x31), // 1 red
    Color::from_rgb_u8(0x0d, 0xbc, 0x79), // 2 green
    Color::from_rgb_u8(0xe5, 0xe5, 0x10), // 3 yellow
    Color::from_rgb_u8(0x24, 0x72, 0xc8), // 4 blue
    Color::from_rgb_u8(0xbc, 0x3f, 0xbc), // 5 magenta
    Color::from_rgb_u8(0x11, 0xa8, 0xcd), // 6 cyan
    Color::from_rgb_u8(0xe5, 0xe5, 0xe5), // 7 white (light gray)
    Color::from_rgb_u8(0x66, 0x66, 0x66), // 8 bright black
    Color::from_rgb_u8(0xf1, 0x4c, 0x4c), // 9 bright red
    Color::from_rgb_u8(0x23, 0xd1, 0x8b), // 10 bright green
    Color::from_rgb_u8(0xf5, 0xf5, 0x43), // 11 bright yellow
    Color::from_rgb_u8(0x3b, 0x8e, 0xea), // 12 bright blue
    Color::from_rgb_u8(0xd6, 0x70, 0xd6), // 13 bright magenta
    Color::from_rgb_u8(0x29, 0xb8, 0xdb), // 14 bright cyan
    Color::from_rgb_u8(0xff, 0xff, 0xff), // 15 bright white
];

/// 16〜231 の 6x6x6 RGB cube 用のレベル変換テーブル。
const CUBE_LEVELS: [u8; 6] = [0x00, 0x5f, 0x87, 0xaf, 0xd7, 0xff];

pub fn cell_fg(cell: &Cell) -> Color {
    let (fg_color, bg_color) = base_colors(cell);
    let inverse = cell.flags.contains(Flags::INVERSE);
    if inverse {
        bg_color
    } else if cell.flags.contains(Flags::DIM) {
        dim(fg_color)
    } else {
        fg_color
    }
}

pub fn cell_bg(cell: &Cell) -> Color {
    let (fg_color, bg_color) = base_colors(cell);
    if cell.flags.contains(Flags::INVERSE) {
        fg_color
    } else {
        bg_color
    }
}

fn base_colors(cell: &Cell) -> (Color, Color) {
    let fg = ansi_to_slint(cell.fg, FG);
    let bg = ansi_to_slint(cell.bg, BG);
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
}
