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
        writer,
        _term: term,
        _processor: processor,
    })
}

/// Diff viewer モード用に Terminal ペインを起動する。
///
/// [`launch`] との差分は接続先 Slint コンポーネントだけで、PTY / Term /
/// Timer の組み立ては同じ。将来的に共通化する候補。
pub fn launch_for_diff_viewer(
    ui: &crate::DiffViewerWindow,
    command: &str,
) -> Result<TerminalPane, Box<dyn std::error::Error>> {
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
        // diff viewer モードでは子プロセスが落ちても UI は閉じない（PTY だけ
        // 死ぬのが想定される）。
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

    ui.set_terminal_cols(COLS as i32);
    ui.set_terminal_rows_count(ROWS as i32);

    let row_model = Rc::new(VecModel::<TerminalRow>::default());
    for _ in 0..ROWS {
        row_model.push(empty_row(COLS as usize));
    }
    ui.set_terminal_rows(ModelRc::from(row_model.clone()));

    {
        let writer = writer.clone();
        ui.on_terminal_key_pressed(move |text: SharedString| {
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
                ui.set_terminal_cursor_col(cursor.column.0 as i32);
                ui.set_terminal_cursor_row(cursor.line.0);
            }
        },
    );

    Ok(TerminalPane {
        _timer: timer,
        writer,
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
    writer: Arc<Mutex<Box<dyn Write + Send>>>,
    _term: Arc<Mutex<Term<EventProxy>>>,
    _processor: Arc<Mutex<Processor<StdSyncHandler>>>,
}

impl TerminalPane {
    /// 文字列を PTY に流し込む（Enter は送らない）。
    ///
    /// multiline / control-char 入りの prompt を受け取るため、以下を行う:
    /// 1. 制御文字（NUL / ESC / BEL / CR 等）をスペースに置き換えてサニタイズ
    ///    する（改行 LF だけは保存する）
    /// 2. bracketed paste mode (ESC[200~...ESC[201~) で本文を挟み、受け手の
    ///    shell / agent CLI が paste として扱えるようにする（行ごとに
    ///    submit される事故を防ぐ）
    pub fn insert(&self, text: &str) {
        if text.is_empty() {
            return;
        }
        let sanitized = sanitize_for_pty(text);
        let mut bytes: Vec<u8> = Vec::with_capacity(sanitized.len() + 16);
        bytes.extend_from_slice(b"\x1b[200~");
        bytes.extend_from_slice(sanitized.as_bytes());
        bytes.extend_from_slice(b"\x1b[201~");
        if let Ok(mut w) = self.writer.lock() {
            let _ = w.write_all(&bytes);
            let _ = w.flush();
        }
    }

    /// 文字列を流し込んだあと CR を送る。誤爆防止のため呼び出し側が明示的に
    /// InsertAndSend モードを選んだときだけ使われる想定。
    pub fn insert_and_send(&self, text: &str) {
        self.insert(text);
        if let Ok(mut w) = self.writer.lock() {
            let _ = w.write_all(b"\r");
            let _ = w.flush();
        }
    }
}

/// PTY に流す前に制御文字を無害化する。
///
/// - NUL / BEL / ESC / BS / VT / FF / CR / Ctrl-C 等はスペースに置換
/// - LF (`\n`) と TAB (`\t`) はそのまま通す
/// - 他の printable Unicode はそのまま
fn sanitize_for_pty(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    for c in text.chars() {
        match c {
            '\n' | '\t' => out.push(c),
            c if (c as u32) < 0x20 => out.push(' '),
            '\u{7f}' => out.push(' '),
            c => out.push(c),
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::{sanitize_for_pty, translate_key};

    #[test]
    fn sanitize_preserves_newlines_and_tabs() {
        let s = sanitize_for_pty("a\nb\tc\n");
        assert_eq!(s, "a\nb\tc\n");
    }

    #[test]
    fn sanitize_replaces_control_chars_with_space() {
        let s = sanitize_for_pty("a\x1bb\x07c\rd");
        assert_eq!(s, "a b c d");
    }

    #[test]
    fn sanitize_replaces_del() {
        let s = sanitize_for_pty("a\u{7f}b");
        assert_eq!(s, "a b");
    }

    #[test]
    fn sanitize_passes_utf8_through() {
        let s = sanitize_for_pty("あいう");
        assert_eq!(s, "あいう");
    }

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
