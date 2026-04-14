// locus PoC: Slint + alacritty_terminal + portable-pty で AI Agent CLI を同居させる Terminal ペイン。
//
// 成功判定: 引数で与えたコマンド（既定 `claude`）がペイン内で起動・対話でき、
// 出力が描画され、キー入力が PTY に流れること。

use std::io::{Read, Write};
use std::rc::Rc;
use std::sync::mpsc::{channel, Receiver, Sender};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;

use alacritty_terminal::event::{Event, EventListener};
use alacritty_terminal::grid::Dimensions;
use alacritty_terminal::index::{Column, Line, Point};
use alacritty_terminal::term::{cell::Cell, Config, Term};
use alacritty_terminal::vte::ansi::{Processor, StdSyncHandler};
use portable_pty::{native_pty_system, CommandBuilder, PtySize};
use slint::{ComponentHandle, Model, ModelRc, SharedString, VecModel};

slint::include_modules!();

const COLS: u16 = 100;
const ROWS: u16 = 30;

#[derive(Clone)]
struct EventProxy;
impl EventListener for EventProxy {
    fn send_event(&self, _event: Event) {}
}

#[derive(Clone, Copy)]
struct TermSize {
    cols: usize,
    rows: usize,
}
impl Dimensions for TermSize {
    fn columns(&self) -> usize {
        self.cols
    }
    fn screen_lines(&self) -> usize {
        self.rows
    }
    fn total_lines(&self) -> usize {
        self.rows
    }
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let cmd_name = std::env::args().nth(1).unwrap_or_else(|| "claude".to_string());

    let pty_system = native_pty_system();
    let pair = pty_system.openpty(PtySize {
        rows: ROWS,
        cols: COLS,
        pixel_width: 0,
        pixel_height: 0,
    })?;

    let mut cmd = CommandBuilder::new(&cmd_name);
    if let Ok(cwd) = std::env::current_dir() {
        cmd.cwd(cwd);
    }
    cmd.env("TERM", "xterm-256color");

    let _child = pair.slave.spawn_command(cmd)?;
    drop(pair.slave);

    let mut reader = pair.master.try_clone_reader()?;
    let writer = Arc::new(Mutex::new(pair.master.take_writer()?));

    let size = TermSize {
        cols: COLS as usize,
        rows: ROWS as usize,
    };
    let term = Arc::new(Mutex::new(Term::new(Config::default(), &size, EventProxy)));

    let (byte_tx, byte_rx): (Sender<Vec<u8>>, Receiver<Vec<u8>>) = channel();
    thread::spawn(move || {
        let mut buf = [0u8; 4096];
        loop {
            match reader.read(&mut buf) {
                Ok(0) => break,
                Ok(n) => {
                    if byte_tx.send(buf[..n].to_vec()).is_err() {
                        break;
                    }
                }
                Err(_) => break,
            }
        }
    });

    let ui = AppWindow::new()?;
    ui.set_cols(COLS as i32);
    ui.set_visible_rows(ROWS as i32);

    let row_model = Rc::new(VecModel::<TerminalRow>::default());
    for _ in 0..ROWS {
        row_model.push(empty_row());
    }
    ui.set_rows(ModelRc::from(row_model.clone()));

    {
        let writer = writer.clone();
        ui.on_key_pressed(move |text: SharedString| {
            let bytes = text.as_str().as_bytes().to_vec();
            if let Ok(mut w) = writer.lock() {
                let _ = w.write_all(&bytes);
                let _ = w.flush();
            }
        });
    }

    let processor = Arc::new(Mutex::new(Processor::<StdSyncHandler>::new()));
    let term_for_timer = term.clone();
    let processor_for_timer = processor.clone();
    let row_model_for_timer = row_model.clone();
    let ui_weak = ui.as_weak();
    let timer = slint::Timer::default();
    timer.start(
        slint::TimerMode::Repeated,
        Duration::from_millis(16),
        move || {
            let mut updated = false;
            while let Ok(bytes) = byte_rx.try_recv() {
                let mut term_guard = term_for_timer.lock().unwrap();
                let mut proc_guard = processor_for_timer.lock().unwrap();
                proc_guard.advance(&mut *term_guard, &bytes);
                updated = true;
            }
            if !updated {
                return;
            }
            let term_guard = term_for_timer.lock().unwrap();
            let cursor = term_guard.grid().cursor.point;
            for r in 0..ROWS as usize {
                let row = build_row(&term_guard, r);
                row_model_for_timer.set_row_data(r, row);
            }
            if let Some(ui) = ui_weak.upgrade() {
                ui.set_cursor_col(cursor.column.0 as i32);
                ui.set_cursor_row(cursor.line.0 as i32);
            }
        },
    );

    ui.run()?;
    Ok(())
}

fn empty_row() -> TerminalRow {
    let cells = VecModel::<TerminalCell>::default();
    for _ in 0..COLS {
        cells.push(TerminalCell {
            ch: SharedString::from(" "),
            fg: slint::Color::from_rgb_u8(0xee, 0xee, 0xee),
            bg: slint::Color::from_rgb_u8(0x0b, 0x0b, 0x0b),
        });
    }
    TerminalRow {
        cells: ModelRc::from(Rc::new(cells) as Rc<dyn Model<Data = TerminalCell>>),
    }
}

fn build_row(term: &Term<EventProxy>, row: usize) -> TerminalRow {
    let cells = VecModel::<TerminalCell>::default();
    let grid = term.grid();
    let line = Line(row as i32);
    for col in 0..COLS as usize {
        let point = Point::new(line, Column(col));
        let cell = &grid[point];
        cells.push(make_cell(cell));
    }
    TerminalRow {
        cells: ModelRc::from(Rc::new(cells) as Rc<dyn Model<Data = TerminalCell>>),
    }
}

fn make_cell(cell: &Cell) -> TerminalCell {
    let mut s = [0u8; 4];
    let ch: &str = cell.c.encode_utf8(&mut s);
    TerminalCell {
        ch: SharedString::from(&*ch),
        fg: slint::Color::from_rgb_u8(0xee, 0xee, 0xee),
        bg: slint::Color::from_rgb_u8(0x0b, 0x0b, 0x0b),
    }
}
