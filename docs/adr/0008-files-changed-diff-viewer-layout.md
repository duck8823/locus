# ADR 0008: GitHub "Files changed"-style layout for the diff viewer

> 日本語: [0008-files-changed-diff-viewer-layout.ja.md](0008-files-changed-diff-viewer-layout.ja.md)

- Status: Proposed
- Date: 2026-05-10

## Context

Today's locus diff viewer packs everything onto **a single screen** (`ui/app.slint::DiffViewerWindow`): PR metadata header, PR list, file list, diff body, selection controls, preview, send controls, terminal pane, and the draft / history pane.

On-device observation (verified 2026-05-08, 1280×720) surfaces several constraints:

- **Information density is too high.** Header (up to 150px) + four columns (PR list 190px / file list 220px / center / draft 300px) + bottom hint bar are always pinned, leaving the center diff with only ~570px of effective width at 1280px.
- **Focus is diffuse.** "Pick a PR", "switch files", "select a line", "edit the preview", "read the terminal", and "review the draft" all live side by side. The user's gaze hops constantly.
- **Terminal pane is hard-pinned to 220px.** Diff content gets vertically squeezed too. After Send the user wants the terminal large; while reading diff they want it gone. A fixed height cannot do both.
- **No collapsible / Viewed concepts.** Reviewing a large PR (10+ files), there is no way to fold already-seen files away or track Viewed progress. The file list cursor alone does not tell the user "which files have I already read".
- **No side-by-side mode.** Only unified diff exists. Visualising delete + add correspondence is harder.
- **Line comments do not have a clear home.** ADR 0007 will introduce the comment-driven send layer, but bolting another pane onto the current right column would crowd the screen further.

GitHub's PR "Files changed" tab has a mature UX answer to all of this (see the official docs cited in [References](#references)). Per-file collapse, Viewed progress, file tree / filter, unified / split toggle, and click-to-comment are exactly what locus needs to import.

This ADR covers **design and wireframes only**. The Slint implementation is tracked in follow-up issues; this PR ships docs only.

## Decision

Re-shape the PR diff viewer into a **Files changed-style layout**. Implementation is feature-flagged so the new and the classic layout coexist, with a staged migration that flips defaults and finally removes the classic path.

### 1. Two-stage screen model

Switch the dominant region based on whether a PR is **selected**:

- **Inbox stage**: PR list occupies 30–35% on the left. Centre shows the focused PR's preview / metadata.
- **Review stage** (the focus of this ADR): PR list collapses to a left-edge breadcrumb / folded sidebar, and the Files changed view becomes the screen's lead actor.

The transition is reversible — a `< PRs` button always returns to Inbox.

### 2. Three-column Review stage

```
┌──────────────────────────────────────────────────────────────────┐
│ Header: < PRs │ PR title │ base...head │ Viewed N/M │ filters     │
├────────────┬───────────────────────────────────┬─────────────────┤
│            │                                   │ Comments / Term │
│ File tree  │   Diff stack (collapsible files)  │  (tabbed)       │
│ + filter   │                                   │                 │
│            │                                   │                 │
├────────────┴───────────────────────────────────┴─────────────────┤
│ Bottom hint bar (key bindings / hover tooltip)                    │
└──────────────────────────────────────────────────────────────────┘
```

- **Left**: file tree + filter chips (All / Modified / Added / Removed / Renamed) + search box + Viewed-hide toggle.
- **Centre**: a single **vertically scrolling ListView of per-file sections**. Each section has a header (path / status / Viewed checkbox / collapse) and a diff body.
- **Right**: a tab-switched pane between **Comments** and **Terminal**. Draft and history live inside the Comments tab (the current 300px right column is reorganised, not duplicated).

See [docs/wireframes/diff-viewer-files-changed.md](../wireframes/diff-viewer-files-changed.md) for the concrete wireframes.

### 3. Translating Files changed into locus

GitHub's concepts adapt to the **local AI-driven review** context, not 1:1:

| GitHub Files changed | Locus interpretation |
|---|---|
| Per-file Viewed checkbox | Persisted to local SQLite (shares ADR 0007's `comments.db`). State rehydrates on PR reopen. |
| Viewed progress bar | Header-bar text `Viewed 3/12`. The Inbox PR list shows the same counter as a chip. |
| File tree | New tree component in `ui/`. Path segments are aggregated; directories with a single file are flattened (e.g. `src/comments/repository.rs`). |
| File filter (All / extension / status) | Filter chips + free-text search. Substring match is enough — no LCS / fuzzy. |
| Hide already-viewed | One of the filter chips. |
| Hide deleted | Filter chip. Visible by default; toggleable. |
| Unified / split toggle | Single toggle in the header bar. State is session-local at first; persistence can come later. |
| Rich diff (markdown / image) | **Non-goal** (see below). |
| Click-line-to-comment | Folds into ADR 0007's `Add Comment` flow. The input area opens **inline beneath the clicked line**. |
| Resolve conversation | Reuses ADR 0007's `resolved` status verbatim. |
| Submit review (Approve / Request changes) | **Non-goal**. As in ADR 0007, no GitHub Review Comments push. |

### 4. Side-by-side / unified

- **Unified** (default): same as today — `+ ` / `- ` / context in a single column. Old/new line numbers stay in the left 90px gutter.
- **Side-by-side**: each row is `[old line# | old content | new line# | new content]` (4 cells). Context lines mirror across. Added rows leave the left side empty; removed rows leave the right side empty.

Architecturally, `DiffLineView` stays as a **shared intermediate representation** for both modes. Only the renderer differs (Unified renderer / SideBySide renderer). No new per-line state (e.g. `paired-line-id`) is introduced in this ADR — the SideBySide renderer pairs by hunk-local index, which is sufficient. Adding explicit pairing fields is deferred until a real need shows up.

Width fallback: below a minimum side-by-side width (e.g. 1100px), the renderer auto-falls back to Unified and the toggle is disabled.

### 5. Collapsible files

- Each file section is **expanded by default**. Unlike GitHub Web, locus typically shows one PR's diff at a time, and showing all files up front loses less information.
- When the file count exceeds a **threshold (default 20)**, default to collapsed and let the user expand intentionally. Threshold is overridable via env (`LOCUS_DIFF_AUTOCOLLAPSE_THRESHOLD`).
- **Viewed = checked** auto-collapses the file (matches GitHub). Unchecking re-expands.
- Header-level `Expand all` / `Collapse all` buttons.

### 6. File tree / filter / Viewed state

- The file tree is **eagerly built** (the PR files API already returns the full list). Virtualisation is delegated to Slint's `ListView` for the visible rows.
- The active file is highlighted in the tree, and tree ↔ diff scroll are bidirectionally synced: clicking a tree node scrolls diff to that file's start, scrolling the diff updates the tree highlight.
- Viewed state is persisted as:

  ```sql
  CREATE TABLE viewed_files (
    session_id   INTEGER NOT NULL REFERENCES sessions(id),
    file_path    TEXT NOT NULL,
    viewed_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (session_id, file_path)
  );
  ```

  This reuses ADR 0007's `sessions` table. Keeping `viewed_at` leaves room for traceary integration ("when did the user check this file?").

### 7. Coexisting terminal pane and Comments / Draft pane

The right column becomes **a single tab-switched pane**:

- **Comments tab** (default): ADR 0007 comment list + draft entries + history, stacked vertically. `Send All Open` lives in this tab's header.
- **Terminal tab**: today's terminal pane, vertically maximised. Switching to this tab moves focus to terminal-focus.
- **Split mode** (option): vertical split — Comments on top, Terminal on bottom. Enable at startup with `LOCUS_RIGHT_PANE=split`. Default remains tab.

This gives:

- During review: Comments tab shows the draft / open comments; the terminal is hidden.
- After Send: optionally auto-switch to Terminal (`LOCUS_AUTOSWITCH_TERMINAL=true`) and read the agent response full-height.
- Users who want both at once enable split mode.

The right pane width is **resizable** (the current fixed 300px goes away). Min 280px, max 600px, persisted in `comments.db` `ui_state`. ADR 0007 introduces `comments.db` and `sessions` but does not define `ui_state`; the `CREATE TABLE IF NOT EXISTS` for `ui_state` is owned by Phase 2+ of this ADR.

### 8. Line comments and draft interaction

Building on ADR 0007:

- Hovering a line shows a `+` button on the right edge. Clicking opens an **inline input area directly beneath the line** (a new ListView row inserted into the diff stack). Esc cancels, Cmd/Ctrl + Enter saves.
- Lines with existing comments show a **dot in the left gutter** plus a count. Clicking the dot scrolls and highlights that comment in the right Comments tab.
- Range selections (shift+click or the existing Range button) open the input area beneath the last line of the range.
- The existing selection-driven `Insert` / `Insert + Send` / `Copy` / `Add to draft` flow lives at the top of the Comments tab as a collapsible section — same buttons, different home.

### 9. Migration strategy

Phases:

1. **Phase 0 (this PR)**: ADR + ASCII wireframes merge. No code changes.
2. **Phase 1**: Add a feature flag `LOCUS_DIFF_VIEWER=files-changed` and parallel-run the new and old layouts as two Slint window components. Default stays on the old layout.
3. **Phase 2**: Minimal new layout — file tree, filter, collapsible, Viewed — usable for dogfooding via the flag.
4. **Phase 3**: Add side-by-side renderer, right-pane tab swap, full ADR 0007 Comments integration.
5. **Phase 4**: Flip the default to `files-changed`. Keep the classic layout reachable via `LOCUS_DIFF_VIEWER=classic` for one minor version (e.g. v0.2.x → v0.3.0).
6. **Phase 5**: Remove the classic layout. `DiffViewerWindow` collapses back to a single component.

Each phase is its own issue / PR and must keep `cargo test` and `cargo clippy` green. UX checkpoints during phases 1–3 may revise this ADR.

### 10. State management (consistency with ADR 0006)

The single source of truth stays in `DIFF_APP_STATE` (thread_local / `Rc<RefCell<>>`). New state slots:

- `viewed_files: HashSet<PathBuf>` — hydrated from the DB at startup.
- `expanded_files: HashSet<PathBuf>` — session-local; not persisted.
- `diff_view_mode: DiffViewMode { Unified, SideBySide }` — session-local.
- `right_pane_tab: RightPaneTab { Comments, Terminal }` — session-local.
- `right_pane_width: f32` — DB-persisted.
- `file_tree_filter: FileTreeFilter` — session-local.

Code that fetches via `tokio::spawn` (PR snapshot, linked issues) is unchanged. The new state is mutated only on the UI thread, so no `Send` requirement appears.

### 11. i18n

Every new UI string is registered in **both** `src/i18n.rs::translate_ja` and Slint `@tr` (per CLAUDE.md). Candidate keys:

- `Viewed`, `Unviewed`, `Hide viewed`, `Hide deleted`
- `Unified`, `Side by side`, `Expand all`, `Collapse all`
- `< PRs`, `Comments`, `Terminal`
- `(no comments yet)`, `(no diff to show)`

## Consequences

### Positive

- One file at a time becomes the focus, with a Viewed counter telling users how much is left.
- The file tree makes deep directory structures navigable.
- Right-pane tabs cleanly separate the review phase (Comments) from the post-Send phase (Terminal).
- Side-by-side improves visual correspondence of delete + add.
- ADR 0007's comment intake fits naturally as an "inline input directly under the line".

### Negative

- Slint layout code grows substantially. `DiffViewerWindow` will need to be split into sub-components, and `ui/` must be reorganised across multiple files.
- Phases 1–4 require maintaining two layouts in parallel — bug fixes apply twice.
- File-tree rendering on Slint's reactive ListView introduces patterns we don't have today (indent guides / disclosure triangles).
- New persisted state (Viewed, right-pane width) extends the `comments.db` schema, so this ADR's ship order has to coordinate with ADR 0007's.

### Boundaries (Non-goals)

- **No GitHub Review Comments push.** Same boundary as ADR 0007. Viewed state is also locus-local.
- **No rich diff (markdown / image preview).** GitHub's rich-diff toggle is not implemented. The current `is-unsupported` notice continues to handle non-text content.
- **No blame / history view.** Per-file git history is out of scope.
- **No multi-PR diff comparison.** Showing diffs from several PRs in one window is out of scope.
- **No terminal-internals redesign.** alacritty_terminal / portable-pty changes (#perf, #font issues) are tracked separately. This ADR only changes terminal **placement**.
- **No semantic-change-IR overlay.** Layering ADR 0004's semantic diff onto Files changed is deferred to a future ADR.
- **No Approve / Request changes button.** GitHub's Submit review is out of scope.
- **No deep dives into individual clipping / lag / glyph fixes** (#見切れ, #perf, #font). Only the bare minimum to keep the classic layout usable while the new one rolls out (per issue #291's NOT scope).

## Alternatives considered

1. **Bolt collapse + Viewed onto the existing layout.** Cheap, but does not address the density / focus root cause. Collapse helps only with file count, not with the vertical chrome (e.g. the fixed 220px terminal).
2. **1:1 copy of GitHub's Files changed DOM (split + tree at full pixel parity).** Over-fitting. Locus has the agent terminal as a first-class element that GitHub Web does not, so a locus-shaped 3-column layout (tree / diff / agent) is preferable.
3. **Move the diff viewer to its own window (multi-window).** Plausible on macOS, but the round-trip between PR list and diff is high-frequency, and window switches hurt UX. In-window stages (Inbox / Review) suffice.
4. **Drop the file tree and ship only breadcrumb + flat list.** Simpler, but Rust repos with deep paths (`src/diff/render/side_by_side/mod.rs`) navigate noticeably better with a real tree.
5. **Right-pane input instead of inline (closer to today).** Cheaper if ADR 0007 lands as-is. But "writing a comment while still seeing the line in context" is the core of review, so inline-as-default wins.

## Implementation plan (high-level)

A more detailed schedule and issue split lives in follow-up issues (≥5 expected for phases 1–5). Order only:

1. **ADR + wireframes** ← this PR.
2. New component skeleton in `ui/diff_viewer_v2.slint` + feature flag, parallel to the classic component.
3. File tree component + filter chips.
4. Collapsible file sections + Viewed persistence (`viewed_files` table).
5. Reuse Unified renderer; add the SideBySide renderer.
6. Right-pane tab swap + ADR 0007 Comments integration + inline input area.
7. Default flip + classic layout removal (this ADR is revised at that point).

## References

GitHub's official docs are the primary source for the Files changed UX.

- [GitHub Docs — Reviewing proposed changes in a pull request](https://docs.github.com/en/pull-requests/collaborating-with-pull-requests/reviewing-changes-in-pull-requests/reviewing-proposed-changes-in-a-pull-request?tool=webui) — per-file review, Viewed checkbox, Viewed progress bar, unified / split toggle, PR submit flow.
- [GitHub Docs — Filtering files in a pull request](https://docs.github.com/github/collaborating-with-pull-requests/reviewing-changes-in-pull-requests/filtering-files-in-a-pull-request) — file filter and file tree for large PRs; hide already-viewed / deleted.
- [GitHub Docs — About comparing branches in pull requests](https://docs.github.com/en/pull-requests/collaborating-with-pull-requests/proposing-changes-to-your-work-with-pull-requests/about-comparing-branches-in-pull-requests) — Files changed shows post-merge state; unified / split / rich / source views; whitespace ignore; Viewed / deleted filters.

Related ADRs:

- [ADR 0003: layered server architecture](0003-layered-server-architecture.md) — module-split philosophy carried forward.
- [ADR 0005: Rust + Slint native rewrite](0005-rust-slint-native-rewrite.md) — the Slint UI premise.
- [ADR 0006: thread_local app state](0006-thread-local-app-state.md) — rationale for keeping new state inside `DIFF_APP_STATE`.
- [ADR 0007: comment-driven send](0007-comment-driven-send.md) — the Comments tab and inline-comment input premise.

On-device verification:

- 2026-05-08, `scripts/diagnose_ui.sh github` at 1280×720 — used to confirm effective center-diff width and the share of fixed chrome (issue #291 body).
