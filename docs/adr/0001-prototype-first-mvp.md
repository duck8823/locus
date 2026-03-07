# ADR 0001: Prototype-first MVP delivery

- Status: Accepted
- Date: 2026-03-07

## Context

Locus currently has product positioning but no executable artifact. The project needs a path that reduces ambiguity fast while preserving room for the longer-term architecture-map product.

## Decision

Start with a **prototype-first CLI package** that proves semantic diffs on JavaScript / TypeScript, and keep all upstream integrations behind explicit adapters.

For the parser layer, use a **replaceable parser interface** and implement the first adapter with Babel's JS / TS parser so we can validate the UX immediately. Tree-sitter remains the target direction for broader multi-language coverage once the semantic-diff contract stabilizes.

## Options considered

### Option A — Prototype-first semantic-diff engine (chosen)

- Build a CLI and test fixtures first
- Delay GitHub, storage, and UI until the core signal is trustworthy
- Keep parser and provider boundaries explicit from day one

### Option B — Full web application skeleton first

- Stand up web / API / DB layers before the analysis engine is proven
- Produces visible progress, but most code would be scaffolding rather than product proof

### Option C — GitHub App integration first

- Prioritize PR ingestion and a hosted flow before validating semantic grouping quality
- Stronger end-to-end story, but analysis quality risks staying opaque

## Rationale

### Time to signal

Option A is the fastest way to see whether Locus can detect the changes reviewers actually care about.

### Technical risk

The hardest part of the product is semantic grouping, not CRUD or OAuth. Option A attacks that risk directly.

### Reuse

A standalone engine can later power a web app, GitHub App, local CLI, or IDE integration. UI-first scaffolding does not offer the same portability.

### Cost of change

Keeping parser and provider contracts separate preserves the route to Tree-sitter, GitHub, GitLab, and Bitbucket without rewrites in the semantic core.

## Risks and mitigations

| Risk | Mitigation |
| --- | --- |
| CLI work may feel less product-like than a UI | keep outputs stable and fixture-driven so the future UI can consume them directly |
| Babel-first could drift from the long-term Tree-sitter plan | isolate parser output behind `collectCallables` / snapshot contracts |
| Narrow JS / TS support might bias the product too early | state the MVP boundary explicitly and expand only after signal quality is proven |

## Adoption conditions

- Semantic-diff records stay provider-agnostic.
- Parser-specific logic does not leak into higher layers.
- Every syntax form added to the prototype ships with regression tests.

## Rejection conditions

Revisit this ADR if one of the following becomes true:

- the prototype cannot represent the callable-level changes reviewers need
- Babel parser limitations materially block the JS / TS MVP
- the team decides the first customer signal must be a hosted GitHub workflow rather than an analysis engine

## Next actions

1. Ship a JS / TS semantic-diff CLI with tests.
2. Define the PR snapshot contract that GitHub ingestion must produce.
3. Add fixtures from real pull requests to evaluate precision before building UI.
