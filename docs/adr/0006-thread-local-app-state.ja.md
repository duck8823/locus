# ADR 0006: diff viewer の DIFF_APP_STATE に thread_local を採用する

> English: [0006-thread-local-app-state.md](0006-thread-local-app-state.md)

- Status: Accepted
- Date: 2026-04-20

## Context（背景）

diff viewer の non-blocking 化 (issue #204) で、以下のすべてが共有 `DiffAppState` にアクセスする必要が出てきた:

- Slint UI コールバック (例: `on_select_line`, `on_pr_clicked`)
- PR snapshot や linked issue を取りにいく `tokio::spawn` の future
- fetch 完了後に UI スレッドへ戻る `slint::invoke_from_event_loop` クロージャ

state の実体は `Rc<RefCell<DiffAppState>>` で、理由は:

- `Rc` で refcount を atomic 不要にできる。値が構築後にスレッド境界を跨がないため。
- `RefCell` で `Mutex` API をコードベースに撒かずに nested callback 内で mutate できる。

しかし `Rc<RefCell<T>>` は **`Send` ではない**。Slint UI コールバック (すべて同じ UI スレッドで動く) なら問題ないが、`tokio::spawn` は `Send + 'static` 要求があるため致命的。素直に `state.clone()` を `tokio::spawn` の中にキャプチャするとコンパイルが通らない。

これに対応する一般的な方法は 2 つ:

1. **`Arc<Mutex<DiffAppState>>` に全置換**: borrow をすべて lock に書き換える。スレッド境界を超えられる。
2. **Actor モデル**: state を 1 つの task に閉じ込め、callback はメッセージ送信。

どちらも今の段階では過剰だった:

- Locus は Slint window を 1 つ、UI スレッドを 1 つしか持たない。state は実態としてはスレッド間で共有されておらず、必要なのは「アクセス経路が `Send` であること」だけ。
- `Rc<RefCell<T>>` → `Arc<Mutex<T>>` への置換は mechanical refactor で全コールバックに波及し、なおかつ `RefCell` の nested borrow 落とし穴を `Mutex` 上で再発させる (再入 lock = deadlock)。
- Actor モデルはメッセージング boilerplate と間接層を、競合のない UI に対して導入することになる。

## Decision（決定）

**`thread_local!` slot** を使い、spawn された future がクロージャに `Rc` をキャプチャしないでも state を取れるようにする:

```rust
thread_local! {
    static DIFF_APP_STATE: RefCell<Option<Rc<RefCell<DiffAppState>>>> = const {
        RefCell::new(None)
    };
}

fn with_app_state<R>(f: impl FnOnce(&Rc<RefCell<DiffAppState>>) -> R) -> Option<R> {
    DIFF_APP_STATE.with(|cell| cell.borrow().as_ref().map(f))
}
```

- `run_diff_viewer` が `ui.run()` の前に UI スレッド上で 1 度だけ slot に値を入れる。
- `tokio::spawn` のクロージャは `Rc` を **キャプチャしない**。async 仕事を済ませて `slint::invoke_from_event_loop(...)` を呼び、その内側 (UI スレッド上で実行される) クロージャから `with_app_state(...)` 経由で state を取る。
- `with_app_state` は UI スレッドのコールバックからしか呼ばれないため `thread_local!` のアクセスは常に安全で、spawn された future 自体は `Send` を保つ。

これにより diff viewer 全体で使っている `Rc<RefCell<DiffAppState>>` の使い勝手を維持しつつ、tokio の `Send` 要求を spawn 境界で満たせる。

## Consequences（結果）

### 正の影響

- 影響範囲が小さい: `thread_local!` slot は 1 つだけ、`with_app_state(...)` 経由でしかアクセスしない。
- 既存の `Rc<RefCell<>>` 流儀がそのまま (`state.borrow_mut().push_toast(...)` 等)。
- spawn された future を `Send` のままに保てる。全コールバックを mutex / actor に書き換える必要がない。

### 負の影響

- DIFF_APP_STATE は *グローバル可変状態* (UI スレッドスコープ) である。教科書的にはグローバル可変状態は避けるべきだが、ここでは (a) Locus の UI スレッドが 1 本しかない、(b) slot は 1 度だけ初期化される、(c) 読み取りはすべて `with_app_state` 経由、という前提で許容している。
- state 依存テストは slot に値が入っていることを期待できないため、`DiffAppState` を直接組み立てる必要がある。今の unit test では十分だが、Slint を起動せずに行ける UI integration テストの範囲には限度がある。
- 将来 2 つ目の window (preferences、history のポップアウトなど) を持つ場合、同じ slot を別 state で再利用できない。その時点で本 ADR を見直し、以下のいずれかに移行する:
  - slot を window ごとの registry に置き換える
  - 真の actor モデルへ移行する

### 境界

`thread_local!` パターンは **`DIFF_APP_STATE` のみ** で使う。他の共有状態 (terminal の `Term`、PTY master、alacritty processor) は非 UI スレッド (PTY 読み取りスレッド、Timer 駆動の tick) からもアクセスされるため、`Arc<Mutex<...>>` が引き続き適切。lock コストはこれら境界では妥当。
