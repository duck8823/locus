//! Slint モデルへの詰め替えユーティリティ。
//!
//! 当面は Terminal ペインの `TerminalRow` / `TerminalCell` 構築だけを扱う。
//! 将来 diff viewer が入る際もここに同種の builder を追加する想定。

pub mod diff_view;

use std::rc::Rc;

use alacritty_terminal::event::EventListener;
use alacritty_terminal::grid::Dimensions;
use alacritty_terminal::index::{Column, Line, Point};
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
    let mut buf = [0u8; 4];
    let ch: &str = cell.c.encode_utf8(&mut buf);
    TerminalCell {
        ch: SharedString::from(ch),
        fg: FG,
        bg: BG,
    }
}

/// Term の現在の row 数を取得するヘルパ。
#[allow(dead_code)]
pub fn term_screen_lines<T: EventListener>(term: &Term<T>) -> usize {
    term.grid().screen_lines()
}
