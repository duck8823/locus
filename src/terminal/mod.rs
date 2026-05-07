//! Terminal ペインの組み立て。
//!
//! `alacritty_terminal` の `Term` + `portable-pty` の子プロセスを Slint の
//! `AppWindow` に接続する。
//!
//! 起動時の初期 grid サイズは `INITIAL_COLS` / `INITIAL_ROWS` だが、
//! [`TerminalPane::resize`] でウィンドウリサイズや font 変更に追従する。

use std::cell::RefCell;
use std::io::{Read, Write};
use std::rc::Rc;
use std::sync::mpsc::{sync_channel, Receiver, SyncSender};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;

use alacritty_terminal::event::{Event, EventListener};
use alacritty_terminal::grid::Dimensions;
use alacritty_terminal::term::{Config, Term, TermDamage};
use alacritty_terminal::vte::ansi::{Processor, StdSyncHandler};
use portable_pty::{native_pty_system, CommandBuilder, MasterPty, PtySize};
use slint::{ComponentHandle, Model, ModelRc, SharedString, VecModel};

use crate::ui_state::{build_row, empty_row};
use crate::{AppWindow, TerminalRow};

/// 起動時の初期グリッドサイズ。Slint の layout が走り `terminal-resized`
/// callback が発火するまでの間だけ使われる暫定値。
pub const INITIAL_COLS: u16 = 100;
pub const INITIAL_ROWS: u16 = 30;

/// `TerminalPane::resize` で受理する最小値。あまりに小さいと
/// alacritty_terminal が panic するため。
const MIN_COLS: u16 = 20;
const MIN_ROWS: u16 = 5;

/// `compute_grid_size` の上限。極小 cell metric や巨大 pane が来た際に
/// alacritty Term / VecModel が現実離れしたサイズで構築されるのを防ぐ。
/// 通常端末で 500 cols / 200 rows を超えるユースケースは想定しない。
const MAX_COLS: u16 = 500;
const MAX_ROWS: u16 = 200;

/// 与えられた pane サイズと cell metric から (cols, rows) を算出する。
///
/// floor で求めた値を `MIN_COLS` / `MIN_ROWS` 以上、`MAX_COLS` / `MAX_ROWS`
/// 以下に丸める。cell サイズが 0 以下のときは `MIN_COLS` / `MIN_ROWS` を返す
/// （0 除算を避ける）。
///
/// pane サイズが負や 0 の場合も同様に最小値を返す。
pub fn compute_grid_size(
    pane_w: f32,
    pane_h: f32,
    cell_w: f32,
    cell_h: f32,
) -> (u16, u16) {
    if cell_w <= 0.0 || cell_h <= 0.0 {
        return (MIN_COLS, MIN_ROWS);
    }
    let raw_cols = if pane_w > 0.0 {
        (pane_w / cell_w).floor() as i64
    } else {
        0
    };
    let raw_rows = if pane_h > 0.0 {
        (pane_h / cell_h).floor() as i64
    } else {
        0
    };
    let cols = raw_cols
        .clamp(MIN_COLS as i64, MAX_COLS as i64) as u16;
    let rows = raw_rows
        .clamp(MIN_ROWS as i64, MAX_ROWS as i64) as u16;
    (cols, rows)
}

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

/// terminal grid 上で再描画が必要な行集合。
///
/// alacritty_terminal の damage API から取り出して即座に reset_damage する
/// ため、TermDamage の借用を持ち歩かないようリスト化している。
enum DamageList {
    All,
    Some(Vec<usize>),
}

fn collect_damaged_lines<T: EventListener>(term: &mut Term<T>) -> DamageList {
    let damage = term.damage();
    let result = match damage {
        TermDamage::Full => DamageList::All,
        TermDamage::Partial(iter) => DamageList::Some(iter.map(|d| d.line).collect()),
    };
    term.reset_damage();
    result
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
        rows: INITIAL_ROWS,
        cols: INITIAL_COLS,
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

    let master = pair.master;
    let mut reader = master.try_clone_reader()?;
    let writer = Arc::new(Mutex::new(master.take_writer()?));
    let master_pty: Arc<Mutex<Box<dyn MasterPty + Send>>> = Arc::new(Mutex::new(master));

    let size = TermSize {
        cols: INITIAL_COLS as usize,
        rows: INITIAL_ROWS as usize,
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

    ui.set_cols(INITIAL_COLS as i32);
    ui.set_visible_rows(INITIAL_ROWS as i32);

    let row_model = Rc::new(VecModel::<TerminalRow>::default());
    for _ in 0..INITIAL_ROWS {
        row_model.push(empty_row(INITIAL_COLS as usize));
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
    let current_size = Rc::new(RefCell::new((INITIAL_COLS, INITIAL_ROWS)));
    let term_for_timer = term.clone();
    let processor_for_timer = processor.clone();
    let row_model_for_timer = row_model.clone();
    let current_size_for_timer = current_size.clone();
    let ui_weak = ui.as_weak();
    let timer = slint::Timer::default();
    timer.start(
        slint::TimerMode::Repeated,
        Duration::from_millis(16),
        move || {
            let mut updated = false;
            let mut term_guard = term_for_timer.lock().unwrap();
            {
                let mut proc_guard = processor_for_timer.lock().unwrap();
                while let Ok(bytes) = byte_rx.try_recv() {
                    proc_guard.advance(&mut *term_guard, &bytes);
                    updated = true;
                }
            }
            if !updated {
                return;
            }
            let damage = collect_damaged_lines(&mut *term_guard);
            let cursor = term_guard.grid().cursor.point;
            let (cols_now, rows_now) = *current_size_for_timer.borrow();
            let total_rows = rows_now as usize;
            let cols_usize = cols_now as usize;
            match damage {
                DamageList::All => {
                    for r in 0..total_rows {
                        let row = build_row(&*term_guard, r, cols_usize);
                        row_model_for_timer.set_row_data(r, row);
                    }
                }
                DamageList::Some(lines) => {
                    for r in lines {
                        if r < total_rows {
                            let row = build_row(&*term_guard, r, cols_usize);
                            row_model_for_timer.set_row_data(r, row);
                        }
                    }
                }
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
        term,
        _processor: processor,
        master_pty,
        row_model,
        current_size,
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
        rows: INITIAL_ROWS,
        cols: INITIAL_COLS,
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

    let master = pair.master;
    let mut reader = master.try_clone_reader()?;
    let writer = Arc::new(Mutex::new(master.take_writer()?));
    let master_pty: Arc<Mutex<Box<dyn MasterPty + Send>>> = Arc::new(Mutex::new(master));

    let size = TermSize {
        cols: INITIAL_COLS as usize,
        rows: INITIAL_ROWS as usize,
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

    ui.set_terminal_cols(INITIAL_COLS as i32);
    ui.set_terminal_rows_count(INITIAL_ROWS as i32);

    let row_model = Rc::new(VecModel::<TerminalRow>::default());
    for _ in 0..INITIAL_ROWS {
        row_model.push(empty_row(INITIAL_COLS as usize));
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
    let current_size = Rc::new(RefCell::new((INITIAL_COLS, INITIAL_ROWS)));
    let term_for_timer = term.clone();
    let processor_for_timer = processor.clone();
    let row_model_for_timer = row_model.clone();
    let current_size_for_timer = current_size.clone();
    let ui_weak = ui.as_weak();
    let timer = slint::Timer::default();
    timer.start(
        slint::TimerMode::Repeated,
        Duration::from_millis(16),
        move || {
            let mut updated = false;
            let mut term_guard = term_for_timer.lock().unwrap();
            {
                let mut proc_guard = processor_for_timer.lock().unwrap();
                while let Ok(bytes) = byte_rx.try_recv() {
                    proc_guard.advance(&mut *term_guard, &bytes);
                    updated = true;
                }
            }
            if !updated {
                return;
            }
            let damage = collect_damaged_lines(&mut *term_guard);
            let cursor = term_guard.grid().cursor.point;
            let (cols_now, rows_now) = *current_size_for_timer.borrow();
            let total_rows = rows_now as usize;
            let cols_usize = cols_now as usize;
            match damage {
                DamageList::All => {
                    for r in 0..total_rows {
                        let row = build_row(&*term_guard, r, cols_usize);
                        row_model_for_timer.set_row_data(r, row);
                    }
                }
                DamageList::Some(lines) => {
                    for r in lines {
                        if r < total_rows {
                            let row = build_row(&*term_guard, r, cols_usize);
                            row_model_for_timer.set_row_data(r, row);
                        }
                    }
                }
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
        term,
        _processor: processor,
        master_pty,
        row_model,
        current_size,
    })
}

/// Terminal ペインを活きた状態に保つためのオーナーシップ束。
///
/// 所有者が drop されると Timer と PTY writer / Term / master も落ちる。
/// 呼び出し側はイベントループが終わるまでこの値を保持する責任がある。
pub struct TerminalPane {
    _timer: slint::Timer,
    writer: Arc<Mutex<Box<dyn Write + Send>>>,
    term: Arc<Mutex<Term<EventProxy>>>,
    _processor: Arc<Mutex<Processor<StdSyncHandler>>>,
    master_pty: Arc<Mutex<Box<dyn MasterPty + Send>>>,
    row_model: Rc<VecModel<TerminalRow>>,
    current_size: Rc<RefCell<(u16, u16)>>,
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

    /// 現在の (cols, rows)。Slint UI の表示行数同期に使う。
    pub fn current_size(&self) -> (u16, u16) {
        *self.current_size.borrow()
    }

    /// PTY / alacritty Term / Slint row model を新しい (cols, rows) に
    /// 合わせて再構築する。サイズが変わらなければ no-op。
    ///
    /// PTY 側は SIGWINCH を子プロセスに送るため、bash や agent CLI は
    /// 自動で折り返し位置を更新する。
    pub fn resize(&self, cols: u16, rows: u16) -> Result<(), Box<dyn std::error::Error>> {
        let cols = cols.max(MIN_COLS);
        let rows = rows.max(MIN_ROWS);

        {
            let current = self.current_size.borrow();
            if current.0 == cols && current.1 == rows {
                return Ok(());
            }
        }

        // PTY: ioctl(TIOCSWINSZ) を子プロセスに飛ばす。
        self.master_pty.lock().unwrap().resize(PtySize {
            cols,
            rows,
            pixel_width: 0,
            pixel_height: 0,
        })?;

        // alacritty Term: グリッドを内部で再アロケート。
        let mut term = self.term.lock().unwrap();
        term.resize(TermSize {
            cols: cols as usize,
            rows: rows as usize,
        });

        // Slint VecModel: 行数を合わせ、全行を再描画。
        let total = rows as usize;
        let cols_usize = cols as usize;
        while self.row_model.row_count() > total {
            self.row_model.remove(self.row_model.row_count() - 1);
        }
        while self.row_model.row_count() < total {
            self.row_model.push(empty_row(cols_usize));
        }
        for r in 0..total {
            let row = build_row(&*term, r, cols_usize);
            self.row_model.set_row_data(r, row);
        }

        *self.current_size.borrow_mut() = (cols, rows);

        Ok(())
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
    use super::{compute_grid_size, sanitize_for_pty, translate_key, MIN_COLS, MIN_ROWS};

    #[test]
    fn compute_grid_size_floors_pane_div_cell() {
        // 800px / 8px = 100 cols, 200px / 16px = 12.5 → 12 rows
        let (cols, rows) = compute_grid_size(800.0, 200.0, 8.0, 16.0);
        assert_eq!(cols, 100);
        assert_eq!(rows, 12);
    }

    #[test]
    fn compute_grid_size_clamps_below_minimum() {
        // 50px / 8px = 6 → MIN_COLS, 30px / 16px = 1 → MIN_ROWS
        let (cols, rows) = compute_grid_size(50.0, 30.0, 8.0, 16.0);
        assert_eq!(cols, MIN_COLS);
        assert_eq!(rows, MIN_ROWS);
    }

    #[test]
    fn compute_grid_size_returns_minimum_for_zero_or_negative_inputs() {
        let (cols, rows) = compute_grid_size(0.0, 0.0, 8.0, 16.0);
        assert_eq!((cols, rows), (MIN_COLS, MIN_ROWS));
        let (cols, rows) = compute_grid_size(-100.0, -100.0, 8.0, 16.0);
        assert_eq!((cols, rows), (MIN_COLS, MIN_ROWS));
    }

    #[test]
    fn compute_grid_size_returns_minimum_when_cell_size_invalid() {
        let (cols, rows) = compute_grid_size(800.0, 200.0, 0.0, 16.0);
        assert_eq!((cols, rows), (MIN_COLS, MIN_ROWS));
        let (cols, rows) = compute_grid_size(800.0, 200.0, 8.0, 0.0);
        assert_eq!((cols, rows), (MIN_COLS, MIN_ROWS));
        let (cols, rows) = compute_grid_size(800.0, 200.0, -1.0, 16.0);
        assert_eq!((cols, rows), (MIN_COLS, MIN_ROWS));
    }

    #[test]
    fn compute_grid_size_caps_at_max() {
        // 巨大な pane / 極小 cell → MAX_COLS / MAX_ROWS で頭打ち
        let (cols, rows) = compute_grid_size(1.0e9, 1.0e9, 1.0, 1.0);
        assert_eq!(cols, super::MAX_COLS);
        assert_eq!(rows, super::MAX_ROWS);
    }

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
