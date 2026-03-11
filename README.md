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
| Architecture Minimap v0 | Immediate upstream/downstream mini-map with change-group navigation | 🟡 Prototype |
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
- a GitHub pull-request snapshot adapter that can ingest real PR files into semantic analysis
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

Prerequisite: **Node.js 22.5+** (required for `node:sqlite`).
If your runtime disables experimental Node APIs, set `NODE_OPTIONS=--experimental-sqlite` before launch.

```bash
npm install
npm run dev
```

If you want to exercise the GitHub webhook route locally, set:

```bash
export GITHUB_WEBHOOK_SECRET=your-local-webhook-secret
```

If you want to exercise a real GitHub OAuth handshake from `/settings/connections`, set:

```bash
export GITHUB_OAUTH_CLIENT_ID=your-github-oauth-client-id
export GITHUB_OAUTH_CLIENT_SECRET=your-github-oauth-client-secret
export GITHUB_OAUTH_SCOPE="repo read:org"

# Optional but recommended: connection-token encryption key
# format: base64:<32-byte-key>  or  64-char hex
export LOCUS_CONNECTION_TOKEN_ENCRYPTION_KEY=base64:...
```

Without `GITHUB_OAUTH_CLIENT_ID`, the connections page uses a local demo OAuth fallback so you can validate the state machine without external setup.

If you want to run the live GitHub PR demo button from the marketing page, you can enter owner/repo/PR number directly in the form.
The environment variables below are optional defaults:

```bash
export GITHUB_TOKEN=your-github-token
export LOCUS_GITHUB_DEMO_OWNER=owner
export LOCUS_GITHUB_DEMO_REPO=repository
export LOCUS_GITHUB_DEMO_PR_NUMBER=123

# Optional: durable analysis queue tuning
export LOCUS_ANALYSIS_JOB_MAX_ATTEMPTS=3
export LOCUS_ANALYSIS_JOB_MAX_RETAINED_TERMINAL_JOBS=500
export LOCUS_ANALYSIS_JOB_STALE_RUNNING_MS=600000

# Optional: connection transition audit retention
export LOCUS_CONNECTION_TRANSITION_MAX_RETAINED=200
```

`GITHUB_TOKEN` is optional for public repositories (but recommended to avoid low anonymous rate limits).

Validation commands:

```bash
npm run lint
npm run typecheck
npm test
npm run test:e2e
npm run build
```

Demo data helper commands (local-only, no external dependency):

```bash
npm run demo:data:status   # inspect .locus-data summary
npm run demo:data:reset    # remove .locus-data
npm run demo:data:reseed   # recreate baseline directories + empty job queue
```

### Recommended reading

- [`docs/mvp.md`](docs/mvp.md) / [`docs/mvp.ja.md`](docs/mvp.ja.md)
- [`docs/adr/0001-prototype-first-mvp.md`](docs/adr/0001-prototype-first-mvp.md) / [`docs/adr/0001-prototype-first-mvp.ja.md`](docs/adr/0001-prototype-first-mvp.ja.md)
- [`docs/adr/0002-web-first-nextjs-typescript.md`](docs/adr/0002-web-first-nextjs-typescript.md) / [`docs/adr/0002-web-first-nextjs-typescript.ja.md`](docs/adr/0002-web-first-nextjs-typescript.ja.md)
- [`docs/adr/0003-layered-server-architecture.md`](docs/adr/0003-layered-server-architecture.md) / [`docs/adr/0003-layered-server-architecture.ja.md`](docs/adr/0003-layered-server-architecture.ja.md)
- [`docs/adr/0004-semantic-change-ir.md`](docs/adr/0004-semantic-change-ir.md) / [`docs/adr/0004-semantic-change-ir.ja.md`](docs/adr/0004-semantic-change-ir.ja.md)
- [`docs/architecture/web-application-blueprint.md`](docs/architecture/web-application-blueprint.md) / [`docs/architecture/web-application-blueprint.ja.md`](docs/architecture/web-application-blueprint.ja.md)
- [`docs/architecture/semantic-analysis-pipeline.md`](docs/architecture/semantic-analysis-pipeline.md) / [`docs/architecture/semantic-analysis-pipeline.ja.md`](docs/architecture/semantic-analysis-pipeline.ja.md)
- [`docs/architecture/connections-workspace-contract.md`](docs/architecture/connections-workspace-contract.md) / [`docs/architecture/connections-workspace-contract.ja.md`](docs/architecture/connections-workspace-contract.ja.md)
- [`docs/architecture/business-context-bridge.md`](docs/architecture/business-context-bridge.md) / [`docs/architecture/business-context-bridge.ja.md`](docs/architecture/business-context-bridge.ja.md)
- [`docs/performance/analysis-benchmark-baseline.md`](docs/performance/analysis-benchmark-baseline.md) / [`docs/performance/analysis-benchmark-baseline.ja.md`](docs/performance/analysis-benchmark-baseline.ja.md)
- [`docs/testing/exploratory-test-playbook.md`](docs/testing/exploratory-test-playbook.md) / [`docs/testing/exploratory-test-playbook.ja.md`](docs/testing/exploratory-test-playbook.ja.md)
- [`docs/testing/exploratory-test-session-2026-03-11.md`](docs/testing/exploratory-test-session-2026-03-11.md) / [`docs/testing/exploratory-test-session-2026-03-11.ja.md`](docs/testing/exploratory-test-session-2026-03-11.ja.md)
- [`docs/operations/ai-review-workflow.md`](docs/operations/ai-review-workflow.md) / [`docs/operations/ai-review-workflow.ja.md`](docs/operations/ai-review-workflow.ja.md)
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
