# ADR 0006: thread_local-based DIFF_APP_STATE for the diff viewer

> 日本語: [0006-thread-local-app-state.ja.md](0006-thread-local-app-state.ja.md)

- Status: Accepted
- Date: 2026-04-20

## Context

When the diff viewer was made non-blocking (issue #204), several callbacks needed to access the shared `DiffAppState`:

- Slint UI callbacks (e.g. `on_select_line`, `on_pr_clicked`)
- `tokio::spawn` futures that fetch a PR snapshot or linked issues
- `slint::invoke_from_event_loop` closures that hop back to the UI thread after a fetch completes

The state itself is `Rc<RefCell<DiffAppState>>` because:

- `Rc` keeps refcounting cheap (no atomic), and the value is never sent across threads after construction.
- `RefCell` allows mutation under nested callback paths without surfacing `Mutex` lock APIs throughout the codebase.

`Rc<RefCell<T>>` is **not `Send`**. That is fine for Slint UI callbacks (which all run on the same UI thread), but it is fatal for `tokio::spawn`, whose argument must be `Send + 'static`. Capturing `state.clone()` into a `tokio::spawn` future therefore fails to compile.

Two patterns commonly resolve this:

1. **`Arc<Mutex<DiffAppState>>` everywhere.** Replaces every borrow site with a lock; works across threads.
2. **An actor model.** State lives in one task; callbacks send messages to it.

Neither felt right at this stage:

- Locus has a single Slint window with a single UI thread. State is *not* actually shared across threads — only the access path needs to be `Send`.
- Replacing `Rc<RefCell<T>>` with `Arc<Mutex<T>>` is a mechanical refactor that ripples through every callback, and reintroduces the nested-borrow pitfalls in `Mutex` form (re-entrant lock = deadlock).
- An actor model adds messaging boilerplate and indirection for a UI that has no contention.

## Decision

Use a **`thread_local!` slot** to hand state to spawned futures without making the closure capture the `Rc`:

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

- `run_diff_viewer` populates the slot once, on the UI thread, before `ui.run()`.
- `tokio::spawn` futures **do not** capture the `Rc` and do not read `DIFF_APP_STATE` themselves. They do their async work (e.g. an HTTP fetch), then call `slint::invoke_from_event_loop(|| { ... })`. The closure handed to `invoke_from_event_loop` runs on the UI thread, and *that* closure is what calls `with_app_state(...)` to apply the result.
- Because `with_app_state` is only invoked from UI-thread callbacks (Slint callbacks and `invoke_from_event_loop` closures), the `thread_local!` access is always on the same thread that initialized it, and the spawned future itself stays `Send`.

This preserves the ergonomic `Rc<RefCell<DiffAppState>>` model used throughout the diff viewer while satisfying tokio's `Send` requirement at the spawn boundary.

## Consequences

### Positive

- No global blast radius for `DiffAppState`: it lives in exactly one `thread_local!` slot (`DIFF_APP_STATE`), accessed only through `with_app_state(...)`. (A second, unrelated `thread_local!` — `ACTIVE_DIFF_WINDOW` — exists for the toast auto-dismiss `slint::Timer` to look up the live window via a `Weak`; that one is a small, single-purpose handle and not in scope of this ADR.)
- Existing `Rc<RefCell<>>` ergonomics remain (`state.borrow_mut().push_toast(...)`, etc.).
- Spawned futures stay `Send` without restructuring every callback to lock a mutex or marshal messages.

### Negative

- DIFF_APP_STATE is *global mutable state*, scoped to the UI thread. Conventional wisdom says global mutable state should be avoided. We accept this here because (a) Locus has exactly one UI thread, (b) the slot is initialized exactly once, and (c) every read is gated through `with_app_state`.
- Tests that touch state-dependent behaviour cannot rely on the slot being populated; they must construct `DiffAppState` directly. This is fine for the current unit tests but limits how much UI integration can be tested without spinning up Slint.
- A future second window (e.g. preferences, history pop-out) cannot reuse the slot for a different state. If that day comes, this ADR should be revisited and either:
  - the slot is replaced with a per-window registry, or
  - the design moves to a proper actor model.

### Boundaries

The `thread_local!` pattern is used here **specifically for `DiffAppState`**, via the `DIFF_APP_STATE` slot. The codebase has one other `thread_local!` (`ACTIVE_DIFF_WINDOW`) which holds a `Weak<DiffViewerWindow>` for the toast auto-dismiss timer; it is a single-purpose UI-thread handle and is treated as an implementation detail of the toast system. Other shared state (terminal `Term`, PTY master, alacritty processor) lives behind `Arc<Mutex<...>>` because those are accessed from non-UI threads (PTY reader thread, timer ticks) and the cost of a lock is appropriate there.
