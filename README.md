<div align="center">

# Locus

**From "diff checking" to "understanding the meaning of changes".**

[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![license-ja](https://img.shields.io/badge/license-ja-lightgrey.svg)](LICENSE.ja.md)
[![Status](https://img.shields.io/badge/status-rewriting-orange.svg)]()
[![ja](https://img.shields.io/badge/lang-ja-red.svg)](README.ja.md)

</div>

---

## Status: rewriting from scratch (Rust + Slint)

Locus is being rewritten as a **local native application** for macOS using Rust + Slint. The original Next.js web prototype is preserved on the [`legacy/nextjs`](https://github.com/duck8823/locus/tree/legacy/nextjs) branch (force-push / delete protected).

Tracking: [`v1.0: Rust/Slint rewrite` milestone](https://github.com/duck8823/locus/milestone/10)

## Why the rewrite

The original prototype pursued a Web SaaS form factor, which pulled in heavy infrastructure (LLM provider adapters with guardrails, OAuth token encryption, durable job queues, plugin capability policies). In practice the realistic usage pattern became "a personal local reviewer that lives next to an AI agent CLI (Claude Code / Codex / Gemini)". That made the SaaS-grade machinery unnecessary.

The native rewrite keeps the **core ideas** of Locus:

- **Architecture map** — where does this change sit in the system?
- **Semantic diff** — function/method-level changes via parser adapters over a common IR
- **Business logic context** — link code changes back to the requirements behind them
- **"Understanding" over "checking"** — the whole stack is designed around *why*, not just *what*

…and drops everything that only existed to serve the Web SaaS form factor.

## The key design shift: no in-app LLM

The new Locus **does not call LLMs itself**. Instead, it hosts a Terminal pane (built on `alacritty_terminal` + `portable-pty`) where Claude Code / Codex / Gemini run as child processes. The Viewer composes structured prompts from the PR / diff / comment selection and **sends them to the Terminal pane**. Authentication, provider selection, cost control, and review history all live in the agent CLI of your choice — not in Locus.

## Core stack

- **Rust + Slint** — native UI
- **`alacritty_terminal` + `portable-pty`** — Terminal pane hosting the agent CLI
- **`tree-sitter-go`** (first target language) — semantic diff
- **`octocrab`** — GitHub PR snapshots

Run `cargo run -- bash` to launch the current build and verify the Terminal pane hosts an interactive shell inside the Slint window. Substitute `claude` / `codex` / `gemini` for the target agent CLI.

## What's in this repo right now

- `Cargo.toml` / `src/` / `ui/` / `build.rs` — Rust + Slint binary (Terminal pane working)
- `docs/adr/0001`, `docs/adr/0004` — methodology and semantic-change-IR thinking (carried over)
- `docs/architecture/semantic-analysis-pipeline.*` — parser adapter + IR architecture
- `docs/mvp.*` — historical MVP scope (retained for context)

Everything else from the Next.js era lives on [`legacy/nextjs`](https://github.com/duck8823/locus/tree/legacy/nextjs).

## License

MIT — see [LICENSE](LICENSE). Japanese reference translation: [LICENSE.ja.md](LICENSE.ja.md).
