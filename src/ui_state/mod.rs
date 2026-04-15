//! Slint モデルへの詰め替えユーティリティ。
//!
//! 当面は Terminal ペインの `TerminalRow` / `TerminalCell` 構築だけを扱う。
//! 将来 diff viewer が入る際もここに同種の builder を追加する想定。

pub mod diff_view;
pub mod draft_view;

use std::rc::Rc;

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
    for col in 0..cols {
        let point = Point::new(line, Column(col));
        let cell = &grid[point];
        cells.push(make_cell(cell));
    }
    TerminalRow {
        cells: ModelRc::from(Rc::new(cells) as Rc<dyn Model<Data = TerminalCell>>),
    }
}

fn make_cell(cell: &Cell) -> TerminalCell {
    // alacritty_terminal の cell flags を信用し、Unicode East Asian Width を
    // 自前判定しない (Codex 助言)。spacer cell は span=0 で skip し、
    // wide char は span=2 で 2 セル分の幅で描画する。
    let span: i32 = if cell
        .flags
        .intersects(Flags::WIDE_CHAR_SPACER | Flags::LEADING_WIDE_CHAR_SPACER)
    {
        0
    } else if cell.flags.contains(Flags::WIDE_CHAR) {
        2
    } else {
        1
    };

    // base char + zero-width 結合文字 (combining marks / ZWJ 等)
    let mut s = String::with_capacity(4);
    s.push(cell.c);
    if let Some(zerowidth) = cell.zerowidth() {
        for c in zerowidth {
            s.push(*c);
        }
    }

    TerminalCell {
        ch: SharedString::from(s.as_str()),
        fg: FG,
        bg: BG,
        span,
    }
}

/// Term の現在の row 数を取得するヘルパ。
#[allow(dead_code)]
pub fn term_screen_lines<T: EventListener>(term: &Term<T>) -> usize {
    term.grid().screen_lines()
}
