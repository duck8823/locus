<div align="center">

# Locus

**From checking diffs to understanding the meaning of changes.**

[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Status](https://img.shields.io/badge/status-planning-orange.svg)]()
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
| Review Progress Tracking | Never lose your place in a large PR | 🔴 Planned |
| Pluggable Connections | GitHub (first), GitLab, Bitbucket (via plugins) | 🔴 Planned |

## Pluggable by Design

Locus is built from the ground up to be extensible:

- **Code hosts** — GitHub (initial), GitLab, Bitbucket
- **Context sources** — Confluence, GitHub Issues/Projects (initial), Jira, Notion
- **AI models** — OpenAI, Anthropic Claude, local models
- **Language parsers** — Tree-sitter core with LSP integration per language

All external integrations use OAuth, so Locus works with your existing authentication.

## Prototype Status

The repository now includes the first executable artifact: `@locus/semantic-diff`.

- Callable-level semantic diffs for JavaScript / TypeScript
- Comment-only and whitespace-only changes are ignored
- CLI output available in both human-readable and JSON formats
- CI runs build + test on every push / pull request

### Quickstart

```bash
npm install
npm run build
npm test
npm run semantic-diff -- path/to/before.ts path/to/after.ts
```

Product scope and architectural decisions live in [`docs/mvp.md`](docs/mvp.md) and [`docs/adr/0001-prototype-first-mvp.md`](docs/adr/0001-prototype-first-mvp.md).

## Roadmap

### MVP
- GitHub integration
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

Locus is in the early planning stage. Feedback, ideas, and discussion are very welcome.

- Open an [Issue](https://github.com/duck8823/locus/issues) to share thoughts or report problems
- See [CONTRIBUTING.md](CONTRIBUTING.md) for contribution guidelines *(coming soon)*

## License

MIT License — see [LICENSE](LICENSE) for details.
