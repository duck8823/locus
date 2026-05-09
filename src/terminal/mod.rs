//! Terminal ペインの組み立て。
//!
//! `alacritty_terminal` の `Term` + `portable-pty` の子プロセスを Slint の
//! `AppWindow` に接続する。
//!
//! 起動時の初期 grid サイズは `INITIAL_COLS` / `INITIAL_ROWS` だが、
//! [`TerminalPane::resize`] でウィンドウリサイズや font 変更に追従する。

use std::cell::{Cell, RefCell};
use std::io::{Read, Write};
use std::rc::Rc;
use std::sync::mpsc::{Receiver, SyncSender, sync_channel};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

use alacritty_terminal::event::{Event, EventListener};
use alacritty_terminal::grid::Dimensions;
use alacritty_terminal::term::{Config, Term, TermDamage};
use alacritty_terminal::vte::ansi::{Processor, StdSyncHandler};
use portable_pty::{CommandBuilder, MasterPty, PtySize, native_pty_system};
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
pub fn compute_grid_size(pane_w: f32, pane_h: f32, cell_w: f32, cell_h: f32) -> (u16, u16) {
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
    let cols = raw_cols.clamp(MIN_COLS as i64, MAX_COLS as i64) as u16;
    let rows = raw_rows.clamp(MIN_ROWS as i64, MAX_ROWS as i64) as u16;
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

/// PTY 起動 / Term 構築 / reader thread / row model の作成までをまとめた
/// 「UI 非依存の terminal 構築結果」。`launch` / `launch_for_diff_viewer`
/// から共通で組み立てる。
struct CoreParts {
    writer: Arc<Mutex<Box<dyn Write + Send>>>,
    term: Arc<Mutex<Term<EventProxy>>>,
    processor: Arc<Mutex<Processor<StdSyncHandler>>>,
    master_pty: Arc<Mutex<Box<dyn MasterPty + Send>>>,
    byte_rx: Receiver<Vec<u8>>,
    current_size: Rc<RefCell<(u16, u16)>>,
    row_model: Rc<VecModel<TerminalRow>>,
}

/// PTY を spawn し、Term / processor / reader thread / 初期 row model を組み立てる。
///
/// `on_child_exit` は子プロセス終了後に走るクロージャ。terminal-only mode は
/// ここで `slint::quit_event_loop()` を呼ぶが、diff viewer mode は何もしない。
fn spawn_core(
    command: &str,
    on_child_exit: impl FnOnce() + Send + 'static,
) -> Result<CoreParts, Box<dyn std::error::Error>> {
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
        on_child_exit();
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
    let processor = Arc::new(Mutex::new(Processor::<StdSyncHandler>::new()));

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

    let current_size = Rc::new(RefCell::new((INITIAL_COLS, INITIAL_ROWS)));
    let row_model = Rc::new(VecModel::<TerminalRow>::default());
    for _ in 0..INITIAL_ROWS {
        row_model.push(empty_row(INITIAL_COLS as usize));
    }

    Ok(CoreParts {
        writer,
        term,
        processor,
        master_pty,
        byte_rx,
        current_size,
        row_model,
    })
}

/// UI から受け取った key text を PTY に流し込むハンドラ。
///
/// 入力遅延診断 (#310) のために `bytes_len` と PTY write の `elapsed_us` を
/// debug log で残す。key forwarding は sub-ms で終わることが多いため、
/// ここだけは ms ではなく us で記録する。入力テキスト自体はパスワード等が
/// 混じり得るため絶対に log に乗せない。
fn make_key_handler(writer: Arc<Mutex<Box<dyn Write + Send>>>) -> impl Fn(SharedString) + 'static {
    move |text: SharedString| {
        let bytes = translate_key(text.as_str());
        if bytes.is_empty() {
            return;
        }
        let bytes_len = bytes.len();
        let started = Instant::now();
        let mut forwarded = false;
        if let Ok(mut w) = writer.lock() {
            forwarded = w.write_all(&bytes).and_then(|_| w.flush()).is_ok();
        }
        let elapsed_us = started.elapsed().as_micros() as u64;
        if forwarded {
            tracing::debug!(bytes_len, elapsed_us, "terminal input forwarded");
        } else {
            tracing::debug!(bytes_len, elapsed_us, "terminal input forward failed");
        }
    }
}

fn diag_trace_render_ticks_enabled() -> bool {
    std::env::var("LOCUS_DIAG_TRACE_RENDER_TICKS")
        .map(|v| matches!(v.to_ascii_lowercase().as_str(), "true" | "1" | "on" | "yes"))
        .unwrap_or(false)
}

fn make_scroll_diagnostic_handler() -> impl Fn(f32, f32) + 'static {
    let trace_scroll_events = diag_trace_render_ticks_enabled();
    move |delta_x, delta_y| {
        if trace_scroll_events {
            tracing::debug!(delta_x, delta_y, "terminal scroll event");
        }
    }
}

/// 1 tick あたりの VTE 処理量を制限する budget。
///
/// terminal が大量に書き込んでくると VTE 処理 + row model 更新が UI thread
/// を専有して scroll/input をブロックするため、chunk 数 / byte 数 / 経過時間
/// で打ち切る。channel に残った bytes は次の tick で消化する (#288)。
#[derive(Clone, Copy)]
struct RenderBudget {
    max_chunks: usize,
    max_bytes: usize,
    max_elapsed: Duration,
}

const RENDER_TICK_BUDGET: RenderBudget = RenderBudget {
    max_chunks: 48,
    max_bytes: 192 * 1024,
    max_elapsed: Duration::from_millis(7),
};

/// この値を超えた tick は「重い」と見なして debug log する閾値。
const RENDER_SLOW_TICK_THRESHOLD: Duration = Duration::from_millis(12);

/// budget hit が連続するとき、row model paint を最大どれだけ defer するか。
///
/// バーストが続いて budget hit が連続した場合、毎 tick paint すると Slint
/// の repaint コストで他の操作が詰まるため、原則 paint を coalesce する。
/// ただしこの上限を超えたら 1 回は paint し、terminal が完全に固まった
/// ように見えないようにする (#288 追補)。
const RENDER_MAX_DEFER: Duration = Duration::from_millis(750);

/// Paint vs Defer の判定結果。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum PaintDecision {
    Paint,
    Defer,
}

/// budget hit な tick が来たとき、row model paint を即時行うか defer するかを決定する。
///
/// 戻り値の 2 つ目は次 tick まで持ち越す defer 開始時刻。`Some(start)` なら
/// defer 継続、`None` なら paint 済み (もしくは defer 不要) でリセット済み。
///
/// 仕様:
/// - `budget_hit == false`: 通常通り paint。defer 状態はクリア。
/// - `budget_hit == true`, `deferred_since == None`: 初回 budget hit。即 paint
///   せず defer を開始する (idle → burst の瞬間に重い full paint をしないため)。
/// - `budget_hit == true`, `deferred_since == Some(start)`:
///   - `now - start >= max_defer` → 1 回 paint してリセット。
///   - そうでなければ defer 継続。
fn decide_render_action(
    budget_hit: bool,
    now: Instant,
    deferred_since: Option<Instant>,
    max_defer: Duration,
) -> (PaintDecision, Option<Instant>) {
    if !budget_hit {
        return (PaintDecision::Paint, None);
    }
    match deferred_since {
        None => (PaintDecision::Defer, Some(now)),
        Some(start) => {
            if now.duration_since(start) >= max_defer {
                (PaintDecision::Paint, None)
            } else {
                (PaintDecision::Defer, Some(start))
            }
        }
    }
}

/// `byte_rx` が空 (Empty/Disconnected) の idle tick で何をするかの判定結果。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum IdleTickAction {
    /// 通常通り早抜けする。
    Skip,
    /// 直前の budget hit で paint を持ち越していた damage を 1 回 flush する。
    FlushDeferred,
}

/// idle tick (byte が来なかった tick) の挙動を決める。
///
/// `drain_with_budget` は最後の chunk で budget が尽きた場合も `budget_hit=true`
/// を返すため、その後 channel が空でも `Defer` として残ってしまう。続く tick で
/// byte が来ないと paint されないままになるので、idle tick で deferred state を
/// 検出したら 1 回 flush して state をクリアする。
///
/// 戻り値の 2 つ目は呼び出し側が `deferred_since` Cell に書き戻す次状態。
fn decide_idle_action(deferred_since: Option<Instant>) -> (IdleTickAction, Option<Instant>) {
    match deferred_since {
        Some(_) => (IdleTickAction::FlushDeferred, None),
        None => (IdleTickAction::Skip, None),
    }
}

/// alacritty の damage を吸い上げて row_model / cursor を更新する。
///
/// 戻り値: (実際に書き換えた行数, 全行 paint だったか)。debug log 用。
fn paint_damage(
    term: &mut Term<EventProxy>,
    row_model: &VecModel<TerminalRow>,
    cols: u16,
    rows: u16,
    update_cursor: &dyn Fn(i32, i32),
) -> (usize, bool) {
    let damage = collect_damaged_lines(term);
    let cursor = term.grid().cursor.point;
    let total_rows = rows as usize;
    let cols_usize = cols as usize;
    let mut damaged_lines: usize = 0;
    let mut full_damage = false;
    match damage {
        DamageList::All => {
            full_damage = true;
            for r in 0..total_rows {
                let row = build_row(&*term, r, cols_usize);
                row_model.set_row_data(r, row);
            }
            damaged_lines = total_rows;
        }
        DamageList::Some(lines) => {
            for r in lines {
                if r < total_rows {
                    let row = build_row(&*term, r, cols_usize);
                    row_model.set_row_data(r, row);
                    damaged_lines += 1;
                }
            }
        }
    }
    update_cursor(cursor.column.0 as i32, cursor.line.0);
    (damaged_lines, full_damage)
}

/// `byte_rx` から budget を超えない範囲で chunk を取り出し `process` に渡す。
///
/// 戻り値 (chunks, bytes, budget_hit)。`budget_hit` はループが budget 条件で
/// 打ち切られたことを意味する (channel に残りがあるかは未検査)。
fn drain_with_budget<F>(
    rx: &Receiver<Vec<u8>>,
    first: Vec<u8>,
    started: Instant,
    budget: &RenderBudget,
    mut process: F,
) -> (usize, usize, bool)
where
    F: FnMut(&[u8]),
{
    let mut chunks: usize = 1;
    let mut bytes: usize = first.len();
    process(&first);
    while chunks < budget.max_chunks
        && bytes < budget.max_bytes
        && started.elapsed() < budget.max_elapsed
    {
        match rx.try_recv() {
            Ok(b) => {
                bytes += b.len();
                chunks += 1;
                process(&b);
            }
            Err(_) => return (chunks, bytes, false),
        }
    }
    (chunks, bytes, true)
}

/// 16ms 周期の render timer を組み立てる。
///
/// `byte_rx` は所有権で受け取り timer closure に移動する。`update_cursor`
/// は UI に依存する位置反映 (terminal-only / diff viewer で別の setter)。
///
/// 1 tick あたりの処理量は [`RENDER_TICK_BUDGET`] で制限する。byte が来て
/// いない tick では term/processor mutex を取らずに早抜けし、入力 / resize
/// と競合しないようにする (#288)。
fn start_render_timer(
    term: Arc<Mutex<Term<EventProxy>>>,
    processor: Arc<Mutex<Processor<StdSyncHandler>>>,
    row_model: Rc<VecModel<TerminalRow>>,
    current_size: Rc<RefCell<(u16, u16)>>,
    byte_rx: Receiver<Vec<u8>>,
    update_cursor: impl Fn(i32, i32) + 'static,
) -> slint::Timer {
    let timer = slint::Timer::default();
    let deferred_since: Cell<Option<Instant>> = Cell::new(None);
    let trace_all_render_ticks = diag_trace_render_ticks_enabled();
    timer.start(
        slint::TimerMode::Repeated,
        Duration::from_millis(16),
        move || {
            let tick_start = Instant::now();
            // byte が 1 つも来ていない tick では term/processor lock を取らない。
            // 入力 (writer.lock) や resize (term.lock) と競合させない。
            let first = match byte_rx.try_recv() {
                Ok(b) => b,
                Err(_) => {
                    // ただし直前 tick で budget hit のまま defer を持ち越して
                    // いた場合は、ここで蓄積 damage を 1 回 paint する。
                    // 次以降の idle tick では deferred_since が None なので
                    // 通常通り早抜けする。
                    let (action, next_defer) = decide_idle_action(deferred_since.get());
                    deferred_since.set(next_defer);
                    if let IdleTickAction::FlushDeferred = action {
                        let mut term_guard = term.lock().unwrap();
                        let (cols_now, rows_now) = *current_size.borrow();
                        let (damaged_lines, full_damage) = paint_damage(
                            &mut term_guard,
                            &row_model,
                            cols_now,
                            rows_now,
                            &update_cursor,
                        );
                        drop(term_guard);
                        tracing::debug!(
                            chunks = 0usize,
                            bytes = 0usize,
                            damaged_lines,
                            full_damage,
                            budget_exhausted = false,
                            render_deferred = false,
                            elapsed_ms = tick_start.elapsed().as_millis() as u64,
                            "terminal render idle flush"
                        );
                    }
                    return;
                }
            };

            let mut term_guard = term.lock().unwrap();
            let (chunks, bytes, budget_hit) = {
                let mut proc_guard = processor.lock().unwrap();
                drain_with_budget(&byte_rx, first, tick_start, &RENDER_TICK_BUDGET, |chunk| {
                    proc_guard.advance(&mut *term_guard, chunk)
                })
            };

            let (decision, next_defer) = decide_render_action(
                budget_hit,
                tick_start,
                deferred_since.get(),
                RENDER_MAX_DEFER,
            );
            deferred_since.set(next_defer);

            match decision {
                PaintDecision::Defer => {
                    // bytes は VTE/Term に既に反映済み。alacritty の damage は
                    // reset しない限り蓄積されるため、次に paint する tick で
                    // まとめて吸い上げる。row_model / cursor も更新しない。
                    drop(term_guard);
                    let elapsed = tick_start.elapsed();
                    tracing::debug!(
                        chunks,
                        bytes,
                        budget_exhausted = budget_hit,
                        render_deferred = true,
                        elapsed_ms = elapsed.as_millis() as u64,
                        "terminal render tick"
                    );
                }
                PaintDecision::Paint => {
                    let (cols_now, rows_now) = *current_size.borrow();
                    let (damaged_lines, full_damage) = paint_damage(
                        &mut term_guard,
                        &row_model,
                        cols_now,
                        rows_now,
                        &update_cursor,
                    );
                    drop(term_guard);

                    let elapsed = tick_start.elapsed();
                    if trace_all_render_ticks || budget_hit || elapsed >= RENDER_SLOW_TICK_THRESHOLD
                    {
                        tracing::debug!(
                            chunks,
                            bytes,
                            damaged_lines,
                            full_damage,
                            budget_exhausted = budget_hit,
                            render_deferred = false,
                            elapsed_ms = elapsed.as_millis() as u64,
                            "terminal render tick"
                        );
                    }
                }
            }
        },
    );
    timer
}

/// PTY を立てて Slint AppWindow に接続する。
///
/// 戻り値の [`TerminalPane`] は Timer と PTY 所有権をまとめて保持し、
/// イベントループが回っている間 drop されないようにする。
///
/// `bracketed_paste` は paste テキストを `\x1b[200~` / `\x1b[201~` で
/// 囲うかどうか。非対応 shell では false にする。
pub fn launch(
    ui: &AppWindow,
    command: &str,
    bracketed_paste: bool,
) -> Result<TerminalPane, Box<dyn std::error::Error>> {
    let core = spawn_core(command, || {
        let _ = slint::quit_event_loop();
    })?;

    ui.set_cols(INITIAL_COLS as i32);
    ui.set_visible_rows(INITIAL_ROWS as i32);
    ui.set_rows(ModelRc::from(core.row_model.clone()));

    ui.on_key_pressed(make_key_handler(core.writer.clone()));
    ui.on_terminal_scroll_diagnostic(make_scroll_diagnostic_handler());

    let ui_weak = ui.as_weak();
    let timer = start_render_timer(
        core.term.clone(),
        core.processor.clone(),
        core.row_model.clone(),
        core.current_size.clone(),
        core.byte_rx,
        move |col, row| {
            if let Some(ui) = ui_weak.upgrade() {
                ui.set_cursor_col(col);
                ui.set_cursor_row(row);
            }
        },
    );

    Ok(TerminalPane {
        _timer: timer,
        writer: core.writer,
        term: core.term,
        _processor: core.processor,
        master_pty: core.master_pty,
        row_model: core.row_model,
        current_size: core.current_size,
        bracketed_paste,
    })
}

/// Diff viewer モード用に Terminal ペインを起動する。
///
/// [`launch`] と Core 部 (PTY / Term / Timer) は共通で、Slint コンポーネント
/// 固有の binding (terminal-* prefix のプロパティと on_terminal_key_pressed)
/// だけがここに残る。子プロセス終了時も UI は閉じない (PTY だけ死ぬのが
/// 想定)。
pub fn launch_for_diff_viewer(
    ui: &crate::DiffViewerWindow,
    command: &str,
    bracketed_paste: bool,
) -> Result<TerminalPane, Box<dyn std::error::Error>> {
    let core = spawn_core(command, || {})?;

    ui.set_terminal_cols(INITIAL_COLS as i32);
    ui.set_terminal_rows_count(INITIAL_ROWS as i32);
    ui.set_terminal_rows(ModelRc::from(core.row_model.clone()));

    ui.on_terminal_key_pressed(make_key_handler(core.writer.clone()));
    ui.on_terminal_scroll_diagnostic(make_scroll_diagnostic_handler());

    let ui_weak = ui.as_weak();
    let timer = start_render_timer(
        core.term.clone(),
        core.processor.clone(),
        core.row_model.clone(),
        core.current_size.clone(),
        core.byte_rx,
        move |col, row| {
            if let Some(ui) = ui_weak.upgrade() {
                ui.set_terminal_cursor_col(col);
                ui.set_terminal_cursor_row(row);
            }
        },
    );

    Ok(TerminalPane {
        _timer: timer,
        writer: core.writer,
        term: core.term,
        _processor: core.processor,
        master_pty: core.master_pty,
        row_model: core.row_model,
        current_size: core.current_size,
        bracketed_paste,
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
    bracketed_paste: bool,
}

impl TerminalPane {
    /// 文字列を PTY に流し込む（Enter は送らない）。
    ///
    /// multiline / control-char 入りの prompt を受け取るため、以下を行う:
    /// 1. 制御文字（NUL / ESC / BEL / CR 等）をスペースに置き換えてサニタイズ
    ///    する（改行 LF だけは保存する）
    /// 2. bracketed paste mode が有効なら本文を `\x1b[200~` / `\x1b[201~` で
    ///    挟み、受け手の shell / agent CLI が paste として扱えるようにする
    ///    （行ごとに submit される事故を防ぐ）。非対応 shell では sequence が
    ///    そのまま表示されるため `LOCUS_BRACKETED_PASTE=false` で raw 送信に
    ///    切り替えられる。
    pub fn insert(&self, text: &str) {
        if text.is_empty() {
            return;
        }
        let sanitized = sanitize_for_pty(text);
        let bytes = encode_paste_bytes(&sanitized, self.bracketed_paste);
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

/// `sanitized` を PTY 送信用バイト列に変換する。
///
/// `bracketed_paste=true` のとき DEC paste の境界 sequence で囲み、
/// 非対応の shell では何も囲まずそのまま raw 送信する。
fn encode_paste_bytes(sanitized: &str, bracketed_paste: bool) -> Vec<u8> {
    if bracketed_paste {
        let mut bytes = Vec::with_capacity(sanitized.len() + 16);
        bytes.extend_from_slice(b"\x1b[200~");
        bytes.extend_from_slice(sanitized.as_bytes());
        bytes.extend_from_slice(b"\x1b[201~");
        bytes
    } else {
        sanitized.as_bytes().to_vec()
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
    use super::{
        IdleTickAction, MIN_COLS, MIN_ROWS, PaintDecision, RenderBudget, compute_grid_size,
        decide_idle_action, decide_render_action, drain_with_budget, encode_paste_bytes,
        sanitize_for_pty, translate_key,
    };
    use std::sync::mpsc::sync_channel;
    use std::time::{Duration, Instant};

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
    fn encode_paste_bytes_wraps_when_bracketed() {
        let bytes = encode_paste_bytes("hello", true);
        let head: &[u8] = b"\x1b[200~";
        let tail: &[u8] = b"\x1b[201~";
        assert!(bytes.starts_with(head));
        assert!(bytes.ends_with(tail));
        // 本文部分が末尾 tail を除き sanitized と一致
        let body = &bytes[head.len()..bytes.len() - tail.len()];
        assert_eq!(body, b"hello");
    }

    #[test]
    fn encode_paste_bytes_raw_when_disabled() {
        let bytes = encode_paste_bytes("hello", false);
        assert_eq!(bytes, b"hello".to_vec());
        assert!(!bytes.windows(2).any(|w| w == b"\x1b["));
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

    fn unconstrained_budget() -> RenderBudget {
        RenderBudget {
            max_chunks: 1024,
            max_bytes: 1024 * 1024,
            max_elapsed: Duration::from_secs(60),
        }
    }

    #[test]
    fn drain_stops_when_channel_empty() {
        let (tx, rx) = sync_channel::<Vec<u8>>(8);
        tx.send(vec![1u8; 8]).unwrap();
        tx.send(vec![2u8; 8]).unwrap();
        drop(tx);
        let first = rx.try_recv().unwrap();
        let mut received: Vec<usize> = Vec::new();
        let (chunks, bytes, budget_hit) =
            drain_with_budget(&rx, first, Instant::now(), &unconstrained_budget(), |b| {
                received.push(b.len())
            });
        assert_eq!(chunks, 2);
        assert_eq!(bytes, 16);
        assert_eq!(received, vec![8, 8]);
        assert!(!budget_hit);
    }

    #[test]
    fn drain_respects_chunks_cap() {
        let (tx, rx) = sync_channel::<Vec<u8>>(64);
        for _ in 0..50 {
            tx.send(vec![0u8; 4]).unwrap();
        }
        drop(tx);
        let first = rx.try_recv().unwrap();
        let budget = RenderBudget {
            max_chunks: 4,
            ..unconstrained_budget()
        };
        let mut count = 0;
        let (chunks, bytes, budget_hit) =
            drain_with_budget(&rx, first, Instant::now(), &budget, |_| count += 1);
        assert_eq!(chunks, 4);
        assert_eq!(bytes, 16);
        assert_eq!(count, 4);
        assert!(budget_hit);
    }

    #[test]
    fn drain_respects_bytes_cap() {
        let (tx, rx) = sync_channel::<Vec<u8>>(8);
        for _ in 0..5 {
            tx.send(vec![0u8; 100]).unwrap();
        }
        drop(tx);
        let first = rx.try_recv().unwrap();
        let budget = RenderBudget {
            max_bytes: 200,
            ..unconstrained_budget()
        };
        let (chunks, bytes, budget_hit) =
            drain_with_budget(&rx, first, Instant::now(), &budget, |_| {});
        assert_eq!(chunks, 2);
        assert_eq!(bytes, 200);
        assert!(budget_hit);
    }

    #[test]
    fn decide_paint_when_budget_not_hit() {
        // budget hit でない tick は通常通り paint。defer 状態はクリアされる。
        let now = Instant::now();
        let (decision, next) = decide_render_action(false, now, None, Duration::from_millis(750));
        assert_eq!(decision, PaintDecision::Paint);
        assert!(next.is_none());

        // 直前まで defer していても、budget が落ち着いたら即 paint。
        let started = now - Duration::from_millis(200);
        let (decision, next) =
            decide_render_action(false, now, Some(started), Duration::from_millis(750));
        assert_eq!(decision, PaintDecision::Paint);
        assert!(next.is_none());
    }

    #[test]
    fn decide_defer_on_first_budget_hit() {
        // 初回 budget hit は即 paint せず defer 開始。next_defer に now を保存する。
        let now = Instant::now();
        let (decision, next) = decide_render_action(true, now, None, Duration::from_millis(750));
        assert_eq!(decision, PaintDecision::Defer);
        assert_eq!(next, Some(now));
    }

    #[test]
    fn decide_defer_continues_within_max() {
        // defer 開始から max_defer 以内は defer 継続。defer 開始時刻は維持。
        let max = Duration::from_millis(750);
        let started = Instant::now();
        let now = started + Duration::from_millis(300);
        let (decision, next) = decide_render_action(true, now, Some(started), max);
        assert_eq!(decision, PaintDecision::Defer);
        assert_eq!(next, Some(started));
    }

    #[test]
    fn decide_paint_when_defer_exceeds_max() {
        // defer が max_defer を超えたら 1 回 paint してリセット。
        let max = Duration::from_millis(750);
        let started = Instant::now();
        let now = started + Duration::from_millis(800);
        let (decision, next) = decide_render_action(true, now, Some(started), max);
        assert_eq!(decision, PaintDecision::Paint);
        assert!(next.is_none());
    }

    #[test]
    fn decide_paint_at_exact_max_boundary() {
        // ちょうど max_defer に達した瞬間も paint 側に倒す (>=)。
        let max = Duration::from_millis(750);
        let started = Instant::now();
        let now = started + max;
        let (decision, next) = decide_render_action(true, now, Some(started), max);
        assert_eq!(decision, PaintDecision::Paint);
        assert!(next.is_none());
    }

    #[test]
    fn idle_tick_skips_when_no_defer() {
        // 通常 idle tick (defer 持ち越しなし) は何もしない。
        let (action, next) = decide_idle_action(None);
        assert_eq!(action, IdleTickAction::Skip);
        assert!(next.is_none());
    }

    #[test]
    fn idle_tick_flushes_and_clears_state_when_deferred() {
        // budget hit を持ち越したまま byte が来ない idle tick が来たら、
        // 蓄積 damage を 1 回 flush して deferred state を必ずクリアする。
        // クリアしないと次の idle tick でも flush 扱いになり毎 tick paint
        // してしまう。
        let started = Instant::now() - Duration::from_millis(100);
        let (action, next) = decide_idle_action(Some(started));
        assert_eq!(action, IdleTickAction::FlushDeferred);
        assert!(
            next.is_none(),
            "deferred_since must be reset to None after idle flush"
        );
    }

    #[test]
    fn drain_processes_first_even_when_over_budget() {
        // first chunk が単独で max_bytes を超えていてもループには入らないが
        // 既に取り出した分は process される (情報を捨てない)。
        let (_tx, rx) = sync_channel::<Vec<u8>>(1);
        let first = vec![0u8; 1024];
        let budget = RenderBudget {
            max_bytes: 16,
            ..unconstrained_budget()
        };
        let mut processed = 0usize;
        let (chunks, bytes, budget_hit) =
            drain_with_budget(&rx, first, Instant::now(), &budget, |b| {
                processed += b.len()
            });
        assert_eq!(chunks, 1);
        assert_eq!(bytes, 1024);
        assert_eq!(processed, 1024);
        assert!(budget_hit);
    }
}
