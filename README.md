<div align="center">

# Locus

**From checking diffs to understanding the meaning of changes.**

[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![license-ja](https://img.shields.io/badge/license-ja-lightgrey.svg)](LICENSE.ja.md)
[![Status](https://img.shields.io/badge/status-prototype-yellow.svg)]()
[![ja](https://img.shields.io/badge/lang-ja-green.svg)](README.ja.md)

</div>

---

## The Problem

Code review today is broken — not because reviewers lack skill, but because the tools give them an impossible task.

- **Narrow context** — 3 lines of surrounding code tell you *what* changed, but not *why* or *where in the system*
- **Fragmented diffs** — changes spanning multiple files lose their narrative; the connection between them disappears
- **Line-based noise** — indentation fixes and meaningful logic changes look identical in a unified diff
- **No map** — in a large PR, you lose track of where you are, what you've reviewed, and what's left

Studies confirm the consequences: PRs over 400 lines receive exponentially worse reviews. The average PR waits **4 days** for review. And today's AI review tools — despite impressive marketing — behave like smart linters; they analyze changed lines in isolation with no understanding of how the code fits into the broader system.

## What Locus Does Differently

Locus gives reviewers **two simultaneous views** of every change:

### Architecture Map
An auto-generated minimap of your system — always visible, always current. At a glance you know:
- Which layer this change lives in (controller, service, repository, domain…)
- Which use cases call this code
- Which endpoints are downstream

The map is generated automatically from static analysis and AI inference, requiring no manual maintenance.

### Semantic Diff
Instead of line-by-line diffs, Locus shows you **AST-based, function-level changes**:

```
Before                          After
────────────────────────────    ────────────────────────────
UserService.updateProfile()     UserService.updateProfile()
  └─ validates email only         └─ validates email
                                  └─ validates phone format  ← added
```

Related changes across multiple files are automatically grouped. Noise (whitespace, renames, comments) is folded away so you can focus on what actually matters.

### Business Logic Context
Locus connects your code changes to the requirements behind them. By integrating with Confluence and GitHub Issues/Projects, it surfaces relevant specs inline — so you can ask not just "does this code work?" but "does this code do what it was supposed to do?"

### AI Review Assistant
With full knowledge of your system's architecture and the linked specifications, Locus's AI reviewer gives feedback that's specific to *your* codebase — not generic best-practice suggestions.

## Core Features

| Feature | Description | Status |
|---|---|---|
| Architecture Minimap | Auto-generated system map, always shows your current location | 🔴 Planned |
| Semantic Diff | AST-based, function-level change visualization | 🔴 Planned |
| Business Logic Context | Confluence & GitHub Issues/Projects integration | 🔴 Planned |
| AI Review Assistant | Context-aware review powered by LLMs | 🔴 Planned |
| Web Review Workspace v0 | Next.js review shell with layered server boundaries and stub navigation | 🟡 Prototype |
| Review Progress Tracking | Never lose your place in a large PR | 🟡 Prototype |
| Pluggable Connections | GitHub (first), GitLab, Bitbucket (via plugins) | 🔴 Planned |

## Pluggable by Design

Locus is built from the ground up to be extensible:

- **Code hosts** — GitHub (initial), GitLab, Bitbucket
- **Context sources** — Confluence, GitHub Issues/Projects (initial), Jira, Notion
- **AI models** — OpenAI, Anthropic Claude, local models
- **Language parsers** — parser adapters with multi-language support as a product goal

All external integrations use OAuth, so Locus works with your existing authentication.

## Project Status

This repository now has a **runnable web-shell prototype**, while the deeper analysis slices remain documentation-led.

Already runnable today:
- a Next.js App Router web shell
- a layered `src/server/**` backend skeleton
- a file-backed demo review session that preserves selected change group and status
- route handlers and server actions that exercise the presentation/application boundary

What is already decided:
- the product surface is a **web application**
- the first implementation target is **TypeScript + Next.js App Router**
- the server follows a **Go-inspired layered architecture** based on the conceptual rules captured in our ADRs
- semantic analysis must cross a **parser adapter + common IR** boundary

What is intentionally still open:
- the long-term parser family per analysis language
- which languages ship in the first semantic-diff spike after the web shell exists
- production infrastructure details that are unnecessary for MVP validation

### Local development

```bash
npm install
npm run dev
```

Validation commands:

```bash
npm run lint
npm run typecheck
npm test
npm run build
```

### Recommended reading

- [`docs/mvp.md`](docs/mvp.md) / [`docs/mvp.ja.md`](docs/mvp.ja.md)
- [`docs/adr/0001-prototype-first-mvp.md`](docs/adr/0001-prototype-first-mvp.md) / [`docs/adr/0001-prototype-first-mvp.ja.md`](docs/adr/0001-prototype-first-mvp.ja.md)
- [`docs/adr/0002-web-first-nextjs-typescript.md`](docs/adr/0002-web-first-nextjs-typescript.md) / [`docs/adr/0002-web-first-nextjs-typescript.ja.md`](docs/adr/0002-web-first-nextjs-typescript.ja.md)
- [`docs/adr/0003-layered-server-architecture.md`](docs/adr/0003-layered-server-architecture.md) / [`docs/adr/0003-layered-server-architecture.ja.md`](docs/adr/0003-layered-server-architecture.ja.md)
- [`docs/adr/0004-semantic-change-ir.md`](docs/adr/0004-semantic-change-ir.md) / [`docs/adr/0004-semantic-change-ir.ja.md`](docs/adr/0004-semantic-change-ir.ja.md)
- [`docs/architecture/web-application-blueprint.md`](docs/architecture/web-application-blueprint.md) / [`docs/architecture/web-application-blueprint.ja.md`](docs/architecture/web-application-blueprint.ja.md)
- [`docs/architecture/semantic-analysis-pipeline.md`](docs/architecture/semantic-analysis-pipeline.md) / [`docs/architecture/semantic-analysis-pipeline.ja.md`](docs/architecture/semantic-analysis-pipeline.ja.md)
- [`CONTRIBUTING.md`](CONTRIBUTING.md) / [`CONTRIBUTING.ja.md`](CONTRIBUTING.ja.md)

## Roadmap

### MVP
- GitHub integration
- Web review workspace v0
- AI-generated architecture map
- Semantic diff (function-level)
- Review progress tracking

### Phase 2
- Confluence & GitHub Issues/Projects integration
- Business logic context overlay
- AI review assistant (with full system context)

### Phase 3
- Plugin SDK for community extensions
- Additional code host support
- Refined UI/UX

## Contributing

Locus is in the planning phase. Feedback, ideas, and discussion are very welcome.

- Open an [Issue](https://github.com/duck8823/locus/issues) to share thoughts or report problems
- See [CONTRIBUTING.md](CONTRIBUTING.md) or [CONTRIBUTING.ja.md](CONTRIBUTING.ja.md) for contribution guidelines

## License

MIT License — see [LICENSE](LICENSE) for the authoritative text, or [LICENSE.ja.md](LICENSE.ja.md) for a Japanese reference translation.
