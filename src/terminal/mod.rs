//! Terminal ペインの組み立て。
//!
//! `alacritty_terminal` の `Term` + `portable-pty` の子プロセスを Slint の
//! `AppWindow` に接続する。既存挙動を壊さず `src/main.rs` からの一行呼び出しに
//! まとめることだけを目的にしている。
//!
//! 注: v0.1 では Terminal ペインの COLS / ROWS を固定。リサイズ追従は後続
//! Issue で扱う。

use std::io::{Read, Write};
use std::rc::Rc;
use std::sync::mpsc::{sync_channel, Receiver, SyncSender};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;

use alacritty_terminal::event::{Event, EventListener};
use alacritty_terminal::grid::Dimensions;
use alacritty_terminal::term::{Config, Term};
use alacritty_terminal::vte::ansi::{Processor, StdSyncHandler};
use portable_pty::{native_pty_system, CommandBuilder, PtySize};
use slint::{ComponentHandle, Model, ModelRc, SharedString, VecModel};

use crate::ui_state::{build_row, empty_row};
use crate::{AppWindow, TerminalRow};

const COLS: u16 = 100;
const ROWS: u16 = 30;

/// alacritty_terminal に渡すイベントリスナ。PoC 以来何もしていない。
#[derive(Clone, Default)]
pub struct EventProxy;

impl EventListener for EventProxy {
    fn send_event(&self, _event: Event) {}
}

/// Term に渡すサイズ情報。
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

/// Slint の KeyEvent.text を VT 互換のバイト列に翻訳する。
///
/// Slint は矢印等を Private Use Area の文字で表現するため、ANSI CSI に
/// 変換してから PTY に流す必要がある。
pub fn translate_key(text: &str) -> Vec<u8> {
    if text.is_empty() {
        return Vec::new();
    }
    match text {
        "\u{F700}" => b"\x1b[A".to_vec(), // Up
        "\u{F701}" => b"\x1b[B".to_vec(), // Down
        "\u{F702}" => b"\x1b[D".to_vec(), // Left
        "\u{F703}" => b"\x1b[C".to_vec(), // Right
        "\u{8}" | "\u{7f}" => vec![0x7f],
        "\n" | "\r" => b"\r".to_vec(),
        "\t" => b"\t".to_vec(),
        "\u{1b}" => b"\x1b".to_vec(),
        other => other.as_bytes().to_vec(),
    }
}

/// PTY を立てて Slint AppWindow に接続する。
///
/// 戻り値の [`TerminalPane`] は Timer と PTY 所有権をまとめて保持し、
/// イベントループが回っている間 drop されないようにする。
pub fn launch(ui: &AppWindow, command: &str) -> Result<TerminalPane, Box<dyn std::error::Error>> {
    let pty_system = native_pty_system();
    let pair = pty_system.openpty(PtySize {
        rows: ROWS,
        cols: COLS,
        pixel_width: 0,
        pixel_height: 0,
    })?;

    let mut cmd = CommandBuilder::new(command);
    if let Ok(cwd) = std::env::current_dir() {
        cmd.cwd(cwd);
    }
    cmd.env("TERM", "xterm-256color");

    let mut child = pair.slave.spawn_command(cmd)?;
    drop(pair.slave);

    thread::spawn(move || {
        let _ = child.wait();
        let _ = slint::quit_event_loop();
    });

    let mut reader = pair.master.try_clone_reader()?;
    let writer = Arc::new(Mutex::new(pair.master.take_writer()?));

    let size = TermSize {
        cols: COLS as usize,
        rows: ROWS as usize,
    };
    let term = Arc::new(Mutex::new(Term::new(Config::default(), &size, EventProxy)));

    let (byte_tx, byte_rx): (SyncSender<Vec<u8>>, Receiver<Vec<u8>>) = sync_channel(1024);
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

    ui.set_cols(COLS as i32);
    ui.set_visible_rows(ROWS as i32);

    let row_model = Rc::new(VecModel::<TerminalRow>::default());
    for _ in 0..ROWS {
        row_model.push(empty_row(COLS as usize));
    }
    ui.set_rows(ModelRc::from(row_model.clone()));

    {
        let writer = writer.clone();
        ui.on_key_pressed(move |text: SharedString| {
            let bytes = translate_key(text.as_str());
            if bytes.is_empty() {
                return;
            }
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
                let row = build_row(&term_guard, r, COLS as usize);
                row_model_for_timer.set_row_data(r, row);
            }
            if let Some(ui) = ui_weak.upgrade() {
                ui.set_cursor_col(cursor.column.0 as i32);
                ui.set_cursor_row(cursor.line.0);
            }
        },
    );

    Ok(TerminalPane {
        _timer: timer,
        _writer: writer,
        _term: term,
        _processor: processor,
    })
}

/// Terminal ペインを活きた状態に保つためのオーナーシップ束。
///
/// 所有者が drop されると Timer と PTY writer / Term も落ちる。呼び出し側は
/// イベントループが終わるまでこの値を保持する責任がある。
pub struct TerminalPane {
    _timer: slint::Timer,
    _writer: Arc<Mutex<Box<dyn Write + Send>>>,
    _term: Arc<Mutex<Term<EventProxy>>>,
    _processor: Arc<Mutex<Processor<StdSyncHandler>>>,
}

#[cfg(test)]
mod tests {
    use super::translate_key;

    #[test]
    fn empty_text_is_dropped() {
        assert!(translate_key("").is_empty());
    }

    #[test]
    fn arrows_map_to_csi() {
        assert_eq!(translate_key("\u{F700}"), b"\x1b[A");
        assert_eq!(translate_key("\u{F701}"), b"\x1b[B");
        assert_eq!(translate_key("\u{F702}"), b"\x1b[D");
        assert_eq!(translate_key("\u{F703}"), b"\x1b[C");
    }

    #[test]
    fn backspace_maps_to_del() {
        assert_eq!(translate_key("\u{8}"), vec![0x7f]);
        assert_eq!(translate_key("\u{7f}"), vec![0x7f]);
    }

    #[test]
    fn enter_maps_to_cr() {
        assert_eq!(translate_key("\n"), b"\r");
        assert_eq!(translate_key("\r"), b"\r");
    }

    #[test]
    fn regular_utf8_passes_through() {
        assert_eq!(translate_key("あ"), "あ".as_bytes());
        assert_eq!(translate_key("a"), b"a");
    }
}
