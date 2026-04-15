//! Slint モデルへの詰め替えユーティリティ。
//!
//! 当面は Terminal ペインの `TerminalRow` / `TerminalCell` 構築だけを扱う。
//! 将来 diff viewer が入る際もここに同種の builder を追加する想定。

pub mod color;
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
    }
}

fn cell_to_terminal_cell(cell: &Cell, span: i32, ch: &str) -> TerminalCell {
    TerminalCell {
        ch: SharedString::from(ch),
        fg: color::cell_fg(cell),
        bg: color::cell_bg(cell),
        span,
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
