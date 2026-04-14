# ADR 0005: Rewrite Locus as a Rust + Slint native application, with AI delegated to an embedded terminal pane

> 日本語: [0005-rust-slint-native-rewrite.ja.md](0005-rust-slint-native-rewrite.ja.md)

- Status: Accepted
- Date: 2026-04-15

## Context

The original Locus prototype (ADR 0002, ADR 0003) pursued a Web SaaS form factor built on Next.js + TypeScript with a layered server inside the web app. That form factor pulled in considerable infrastructure:

- LLM provider adapters with guardrails, prompt versioning, and cost estimation
- OAuth token encryption and connection transition audit trails
- A durable analysis job queue with retries and stale-running detection
- A plugin SDK with capability policy enforcement
- Multi-code-host adapters (GitHub, GitLab, eventual Bitbucket)

In practice, the realistic usage pattern has collapsed to **"a personal, local reviewer that sits next to an AI agent CLI"**. Users already have Claude Code / Codex / Gemini running in their terminal. They do not need Locus to authenticate to LLM providers, manage prompt templates, enforce cost caps, or persist audit logs — the agent CLI of their choice already does all of that, and will continue to evolve faster than a Locus-internal adapter layer can keep up.

The SaaS-grade machinery has become cost without benefit.

Separately, prototype experience with semantic diff made two technical preferences clear:

1. **`tree-sitter` is the right parser ecosystem** for multi-language semantic diff. The TypeScript-side `tree-sitter` bindings worked, but the Rust-native `tree-sitter` ecosystem is more direct and broadly covers our target languages (Go, TypeScript, Rust, Python, Dart, GDScript, …).
2. **The AI agent handoff is fundamentally a PTY handoff**, not an HTTP handoff. The value of Locus is composing structured prompts (file, line, diff slice, comment) and handing them to whichever agent the user is running; trying to mediate that over a network boundary inside a web app adds latency and configuration surface for no gain.

## Decision

Rewrite Locus as a **Rust + Slint native application** targeting **macOS** initially, with the following design commitments:

### 1. Form factor

- Rust + Slint binary, distributed as a desktop application
- macOS-first; Linux/Windows are explicit non-goals for the first release
- No in-application web server, no HTTP authentication, no persistent database by default

### 2. AI delegation via an embedded terminal pane

- Locus **does not call LLMs itself**
- A Slint-hosted Terminal pane (`alacritty_terminal` + `portable-pty`) runs an agent CLI as a child process — Claude Code, Codex, or Gemini, user-selectable
- The Viewer composes structured prompts from the PR / diff / comment selection and **writes them into the PTY**
- Authentication, provider choice, cost control, rate limiting, conversation history, and review memory all live in the agent CLI, not in Locus
- The PoC validating this design shipped in [#197](https://github.com/duck8823/locus/pull/197) and was promoted to the repository root in [#198](https://github.com/duck8823/locus/pull/198)

### 3. Semantic diff via `tree-sitter`

- First target language: **Go** (`tree-sitter-go` is official and high-quality)
- The parser-adapter + common Semantic Change IR boundary from [ADR 0004](0004-semantic-change-ir.md) is carried over intact; only the concrete adapter implementations move from TypeScript to Rust
- New languages are added by swapping in additional `tree-sitter-*` crates behind the same IR boundary

### 4. What is explicitly dropped

- LLM provider adapter layer (heuristic, `openai_compat`, guardrailed, prompt templates)
- AI suggestion audit / redaction policy and persistence
- Durable analysis job queue and retry policy
- OAuth token encryption, connection transition audit, OAuth start/callback flows
- Plugin SDK and capability policy
- GitLab / Bitbucket code-host adapters
- Web marketing page, sign-in flow, and SaaS onboarding surfaces

These capabilities were genuinely useful to the SaaS form factor, but each one cost maintenance budget without serving the "local reviewer next to an agent CLI" reality.

### 5. What is explicitly kept

- The **core product idea**: architecture map + semantic diff + business-logic context + "understanding over checking"
- [ADR 0001](0001-prototype-first-mvp.md) prototype-first delivery posture
- [ADR 0004](0004-semantic-change-ir.md) parser-adapter + Semantic Change IR boundary (implementation moves, abstraction does not)
- The thinking captured in `docs/architecture/semantic-analysis-pipeline.*`

## Consequences

### Positive

- The bulk of the SaaS infrastructure disappears, cutting long-term maintenance cost dramatically
- `tree-sitter` in Rust is a more direct fit for semantic diff than wrestling with TypeScript parser bindings
- Agent delegation via PTY means Locus inherits every improvement in Claude Code / Codex / Gemini automatically, for free
- Local-first removes the need to ever touch OAuth token storage, encryption keys, audit retention, or provider rate-limit politics
- A `tree-sitter-go` first focus lets us validate the semantic-diff UX on real code (the user's own Go projects) before spending time on parser breadth

### Negative

- We give up the possibility of a hosted, multi-user review surface without a second rewrite
- Contributors need Rust + Slint familiarity; the prior contributor base (TypeScript + Next.js) cannot transfer trivially
- macOS-first means Linux/Windows users cannot use Locus at all in the first release
- Embedding a terminal emulator (`alacritty_terminal`) is non-trivial and a real source of ongoing maintenance (ANSI, keyboard handling, resize, focus)
- Some users may *prefer* an in-app LLM experience; we're explicitly ceding that segment to other tools

### Reversibility

- The rewrite is a hard fork of the form factor, not of the product idea. If the decision proves wrong, the Next.js prototype is preserved on the `legacy/nextjs` branch (force-push / delete protected) and can be resumed
- The `tree-sitter` + Semantic Change IR boundary is implementation-language-agnostic; switching host language again later would not require re-thinking the parser strategy

## Relationship to other ADRs

- [ADR 0001 — Prototype-first MVP](0001-prototype-first-mvp.md): still in force. This ADR is itself a prototype-first move — it is cheaper to validate "PTY-hosted agent is the correct handoff" in a local binary than in a SaaS
- [ADR 0002 — Web-first + Next.js](0002-web-first-nextjs-typescript.md): **superseded** by this ADR
- [ADR 0003 — Layered server architecture](0003-layered-server-architecture.md): **superseded** by this ADR. The layered-ownership principles may still inform Rust module layout but are no longer normative
- [ADR 0004 — Parser-adapter + Semantic Change IR](0004-semantic-change-ir.md): still in force. Only the concrete adapter implementations change

## Notes

This ADR was retroactively written after the PoC (#197) and the Next.js asset removal (#198) had already landed on `main`. It records the decision that those PRs executed against, rather than gating them.
