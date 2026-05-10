# ADR 0007: Comment-driven send for the diff viewer

> 日本語: [0007-comment-driven-send.ja.md](0007-comment-driven-send.ja.md)

- Status: Proposed
- Date: 2026-05-09

## Context

Today, locus offers two actions on a diff selection: `Insert + Send` (push the snippet to the agent immediately) or `Copy`. That fits the "spot something, fire it off right away" loop, but it does not fit the **reviewer-style loop of "read the whole change first, then ask the agent to fix several spots at once"**.

Concretely, a reviewer wants to:

- skim a PR top-to-bottom and jot down 5–10 observations,
- finish reading first, then hand all of those notes to the agent in one shot,
- track which notes are still Open vs. already Sent vs. Resolved.

With today's locus this forces one of:

1. send each comment individually, or
2. accumulate notes in an external app and paste them back later.

The first fragments context for the agent. The second pulls the user out of locus, and `@file:line` references have to be hand-crafted because the diff context is gone.

Adjacent tooling does not cover this niche:

- Cursor's Composer can pull multiple files into context but has no comment-accumulation surface.
- Continue (VS Code)'s "Context Items" is closer, but lives as an editor extension.
- GitHub Copilot Workspace has checklist-style aggregation but cannot drive a local CLI agent.
- "Read a PR diff locally, accumulate comments, then dispatch them to a local CLI agent (Claude Code / Codex / Gemini)" is a niche locus is uniquely placed to own.

This work is scoped under milestone `v0.1: core review loop`. Extending the same flow into the local-files (workspace) mode is deferred to v0.2 or later.

## Decision

Add a Comments layer to the PR diff viewer. Comments are persisted to a local SQLite database, and `Send All Open` flushes them through the existing bracketed-paste path in one batch.

### Data model (SQLite)

Persisted at `~/Library/Application Support/locus/comments.db`. This is the
expected macOS path; the implementation resolves the platform-specific
application data directory through the existing `directories::ProjectDirs`
dependency.

```sql
CREATE TABLE sessions (
  id           INTEGER PRIMARY KEY,
  kind         TEXT NOT NULL,           -- 'pr' | 'workspace'
  ref          TEXT NOT NULL,           -- PR URL or workspace path
  created_at   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE comments (
  id           INTEGER PRIMARY KEY,
  session_id   INTEGER NOT NULL REFERENCES sessions(id),
  file_path    TEXT NOT NULL,
  line_start   INTEGER NOT NULL,
  line_end     INTEGER,                 -- NULL = single line
  body         TEXT NOT NULL,
  status       TEXT NOT NULL DEFAULT 'open',  -- 'open' | 'sent' | 'resolved'
  created_at   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  sent_at      TIMESTAMP
);

CREATE INDEX idx_comments_session ON comments(session_id, status);
```

A session is unique on `(kind, ref)`. Reopening the same PR reuses the existing session and rehydrates comments.

### Local-only boundary

Comment data stays on the user's machine. Pushing to GitHub Review Comments and syncing across users are **out of scope for this ADR**. The local DB acts as a staging buffer in front of the agent; whether to ever push outward is a separate, later decision.

### UI

- A **Comments pane** to the right of the diff pane (either tab-switched with the existing terminal, or stacked as a Comments / Terminal split).
- An **Add Comment** button next to the existing Insert/Send buttons. With a selection active, clicking opens an input area.
- The Comments pane lists, edits, deletes, and toggles status (`open` / `sent` / `resolved`) per comment.
- A **Send All Open** button bulk-pastes every `open` comment via bracketed paste and flips them to `sent`.

### Paste format (Send All Open)

```
@src/foo.rs:42 missing null check here
@src/bar.rs:10-25 this function has no test
@docs/api.md:5 title casing inconsistency
```

One comment per line, riding the same `@` reference syntax used by Claude Code / Codex. Multi-line ranges use `@file:start-end`.

For PR diffs, the line is **the line number in the post-change file**. The diff side is captured at comment creation time and resolved to a post-change line number at Send time. For deleted lines, where no direct post-change line exists, the implementation must either resolve to a nearby surviving context line or define a fallback representation that makes the deletion explicit.

### Status lifecycle

The forward path is `open` → `sent` → `resolved`:

- `open`: written but not yet sent. Eligible for `Send All Open`.
- `sent`: bracketed-pasted via `Send All Open`; the agent has received it.
- `resolved`: manually marked done by the user.

Status can be moved backward manually from the Comments pane (an escape hatch when a comment was flipped to `sent` by mistake). `resolved` comments are excluded from `Send All Open`.

### Keybindings

Aligned with the existing `Cmd/Ctrl + Enter` (Insert + Send):

| Key | Action |
|---|---|
| Cmd/Ctrl + N | Add Comment on the current selection (open input area) |
| Cmd/Ctrl + Enter (while editing a comment) | Save comment |
| Cmd/Ctrl + Shift + Enter | Send All Open |
| Esc (while editing a comment) | Cancel |

### Module placement

Aligned with ADR 0003 (layered server architecture); Application and Infrastructure layers are kept separate:

```
src/comments/
  mod.rs          # public API
  model.rs        # Comment / Session / CommentStatus
  repository.rs   # SQLite access
  service.rs      # Application layer: add_comment / list_open / send_all
ui/comments.slint # Comments pane UI component
```

Migration is handled by `CREATE TABLE IF NOT EXISTS` at startup — sufficient at v0.0.x, where breakage is not a critical concern. A real migration framework is introduced only when the first schema change demands it.

### Send path

Reuses the existing bracketed-paste path (`LOCUS_BRACKETED_PASTE`). `Send All Open` internally concatenates the open comments into a single string and passes it through the same Send path. If the result exceeds `LOCUS_PROMPT_MAX_CHARS`, the existing preview / consent dialog flow is reused.

## Consequences

### Positive

- The reviewer-style loop ("note everything, then dispatch in one batch") fits inside locus end-to-end.
- Persistence means comments survive restarts; reopening the same PR resumes the review where it stopped.
- Hooks for traceary integration: with comments and Send events recorded locally, an AI-driven review trail can be reconstructed later.
- The `@file:line` paste format is an explicit batch-comment format that Claude Code / Codex can interpret naturally. The current `Insert + Send` prompt includes markdown headers rather than being identical; implementation should either converge both paths on this reference style or keep `Send All Open` as a dedicated format intentionally.

### Negative

- Adds a SQLite dependency. locus does not currently use SQLite, so `rusqlite` and a migration story arrive as new infrastructure.
- A Comments pane forces a layout change on the Slint side; reconciling it with the existing tab structure is non-trivial.
- A comment input area is a new UI surface and is heavier than the current select-then-Send flow.

### Boundaries

- Comments in the local-directory (files / workspace) mode are **out of scope here**. The schema reserves `kind='workspace'`, but the UI for it is deferred to v0.2 or later.
- Syncing PR comments back to GitHub is **out of scope here**. Data stays in the local DB. Pushing to GitHub Review Comments will be evaluated in a separate ADR.
- General editor capabilities (file edits beyond commenting) are out of scope. The Comments layer remains an auxiliary layer over the diff.

## Alternatives considered

1. **In-memory only, no persistence.** Lighter, but losing comments on restart cancels most of the "send later" benefit.
2. **JSON file at the workspace root (`.locus/comments.json`).** Could ride along in git, but blurs the workspace concept when the primary subject is a remote PR diff. SQLite was chosen instead.
3. **Call the GitHub Review Comments API directly.** That would publish comments publicly, which is wrong for a staging buffer in front of the agent. The local DB stays primary; explicit upstream push is left as a later option.

## Implementation plan

1. Introduce `rusqlite` and an idempotent startup migration (`CREATE TABLE IF NOT EXISTS`).
2. Unit tests for `src/comments/model.rs` and `repository.rs`.
3. Application layer in `service.rs` (`add_comment` / `list_open` / `mark_sent` / `delete`).
4. Slint Comments pane UI.
5. Add Comment button and keybindings.
6. Wire Send All Open through the bracketed-paste path.
7. PR line resolver (before/after side → post-change line).
8. End-to-end check: three comments on one PR → Send All → terminal receives three `@file:line` lines.
