<div align="center">

# Locus

**From "diff checking" to "understanding the meaning of changes".**

[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![license-ja](https://img.shields.io/badge/license-ja-lightgrey.svg)](LICENSE.ja.md)
[![Status](https://img.shields.io/badge/status-beta_v0.0.x-yellow.svg)]()
[![ja](https://img.shields.io/badge/lang-ja-red.svg)](README.ja.md)

</div>

---

## Status: beta (v0.0.x patch sprint)

Locus is a **local native application** for macOS, built in Rust + Slint, that hosts a GitHub PR diff viewer next to an embedded terminal running your agent CLI (Claude Code / Codex / Gemini). It is currently in a v0.0.x beta sprint stabilizing toward `v0.1: core review loop`.

![locus diff viewer](docs/screenshots/diff-viewer.png)

The diff pane on the left, the terminal pane on the bottom hosting an agent CLI, and the draft / history side panel on the right. A `cargo run` without arguments opens just the terminal pane:

![locus terminal pane only](docs/screenshots/terminal-pane.png)

The original Next.js web prototype is preserved on the [`legacy/nextjs`](https://github.com/duck8823/locus/tree/legacy/nextjs) branch.

## Quickstart

Requirements: Rust 1.85+ (uses `edition = "2024"`), macOS.

```sh
# Clone and build
git clone https://github.com/duck8823/locus.git
cd locus
cargo build --release

# Terminal-pane only (default agent: claude)
cargo run --release

# Terminal-pane with a custom CLI
cargo run --release -- bash
LOCUS_AGENT_CMD=codex cargo run --release

# Diff viewer for a GitHub PR
cargo run --release -- github duck8823/locus#236
```

If `LOCUS_AGENT_CMD` is set to an executable that is not on `PATH`, locus shows a red banner and disables the send buttons rather than crashing.

For GitHub access, locus reads tokens in this order:

1. `GITHUB_TOKEN`
2. `GH_TOKEN`
3. `gh auth token --hostname github.com` (set `LOCUS_NO_GH_AUTH=1` to disable this fallback)
4. unauthenticated (limited rate)

## Environment variables

| Variable | Default | Purpose |
|---|---|---|
| `LOCUS_LOCALE` | system / `LANG` | `ja` or `en`. Reads `LANG` when unset; falls back to `ja` for unsupported values. |
| `LOCUS_AGENT_CMD` | `claude` | Command launched in the embedded terminal pane. |
| `LOCUS_FONT_FAMILY` | OS-specific (macOS: `Menlo, Hiragino Sans, Consolas, monospace`) | Font family for terminal + diff. The default already includes a CJK fallback so Japanese / Chinese / Korean glyphs render. |
| `LOCUS_FONT_SIZE` | (unset) | Single override for both terminal and diff font sizes. |
| `LOCUS_TERMINAL_FONT_SIZE` | `13.0` | Terminal pane font size in logical pixels. |
| `LOCUS_DIFF_FONT_SIZE` | `12.0` | Diff pane font size in logical pixels. |
| `LOCUS_BRACKETED_PASTE` | `true` | `false`/`0`/`off`/`no` to send raw bytes when the agent CLI does not understand `\x1b[200~ ... \x1b[201~`. |
| `LOCUS_PROMPT_MAX_CHARS` | `32000` | Preview is gated above this character count; an override checkbox allows sending anyway. |
| `GITHUB_TOKEN` / `GH_TOKEN` | (unset) | GitHub PAT for the diff viewer. |
| `LOCUS_NO_GH_AUTH` | `false` | Disable the `gh auth token` fallback. |
| `GH_AUTH_TIMEOUT` | `3` | Seconds before the `gh auth token` subprocess is killed. |
| `LOCUS_LOG` | `warn` | Tracing filter (`error` / `warn` / `info` / `debug` / `trace`). |

## Keybindings

Implemented in v0.0.2 (full set lands in v0.1.0):

| Key | Action |
|---|---|
| Esc | clear the current selection |
| Cmd/Ctrl + Enter | Insert + Send the preview into the terminal |
| Cmd/Ctrl + C | Copy the preview to the clipboard |

Send shortcuts respect the preview-size limit and are disabled when over `LOCUS_PROMPT_MAX_CHARS` unless the override checkbox is on.

## The key design shift: no in-app LLM

Locus **does not call LLMs itself**. Instead, it hosts a Terminal pane (built on `alacritty_terminal` + `portable-pty`) where Claude Code / Codex / Gemini run as child processes. The Viewer composes structured prompts from the PR / diff / comment selection and **sends them to the Terminal pane**. Authentication, provider selection, cost control, and review history all live in the agent CLI of your choice — not in Locus.

## Core stack

- **Rust + Slint** — native UI
- **`alacritty_terminal` + `portable-pty`** — terminal pane hosting the agent CLI
- **`tree-sitter-go`** (first target language) — semantic diff
- **`octocrab`** — GitHub PR snapshots

## What's in this repo right now

- `Cargo.toml` / `src/` / `ui/` / `build.rs` — Rust + Slint binary
- `docs/adr/` — architectural decisions, including the rewrite (0005) and `thread_local DIFF_APP_STATE` rationale (0006)
- `docs/architecture/` — parser adapter + IR pipeline
- `docs/mvp.*` — historical MVP scope (retained for context)
- `lang/ja/LC_MESSAGES/locus.po` — Japanese bundled translations

Everything else from the Next.js era lives on [`legacy/nextjs`](https://github.com/duck8823/locus/tree/legacy/nextjs).

## License

MIT — see [LICENSE](LICENSE). Japanese reference translation: [LICENSE.ja.md](LICENSE.ja.md).
