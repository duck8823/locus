# Contributing to Locus

> 日本語: [CONTRIBUTING.ja.md](CONTRIBUTING.ja.md)

Locus is currently being rewritten as a Rust + Slint native application for macOS. The earlier Next.js prototype is preserved on the `legacy/nextjs` branch. Contributions should target the Rust rewrite unless explicitly coordinated against legacy maintenance.

## Working Agreement

- Ship thin vertical slices that reduce ambiguity.
- Keep architectural decisions explicit in `docs/adr/`.
- Prefer parser / integration abstractions over hard-coding provider details.
- Treat parser and implementation-language choices as provisional until an ADR explicitly fixes them.
- Do not let a temporary spike masquerade as a long-term platform decision.

## What contributions are useful right now

- refining the MVP definition
- tightening ADRs and decision criteria
- improving bilingual documentation quality
- clarifying plugin, parser, and adapter boundaries
- adding issue breakdowns and review scenarios

## Repository Layout

- `README.md` / `README.ja.md` — product overview
- `Cargo.toml` / `src/` / `ui/` / `build.rs` — Rust + Slint application
- `docs/adr/` — architecture decisions
- `docs/architecture/` — architecture notes carried over from the prototype
- `docs/mvp.md` / `docs/mvp.ja.md` — historical MVP scope reference
- `CONTRIBUTING.md` / `CONTRIBUTING.ja.md` — contribution policy

## Change Policy

Open or update an ADR before making one of these changes:

- locking the long-term parser family
- replacing the parser abstraction strategy
- changing the Terminal pane / AI agent handoff contract
- broadening the MVP beyond the scope recorded in `docs/mvp.md`

## Pull Request Checklist

- [ ] Scope matches the current milestone or an approved ADR
- [ ] English and Japanese docs stay consistent when both are affected
- [ ] Cross-links between language variants are updated if needed
- [ ] README / docs updated when the documented direction changes
- [ ] `cargo build` / `cargo clippy --all-targets` / `cargo test` pass locally
- [ ] AI review loop completed (Gemini scout + Codex verifier) or blocking reason documented
