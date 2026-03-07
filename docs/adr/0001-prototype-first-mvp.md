# ADR 0001: Prototype-first MVP delivery without locking parser/language choices

> 日本語: [0001-prototype-first-mvp.ja.md](0001-prototype-first-mvp.ja.md)

- Status: Accepted
- Date: 2026-03-07

## Context

Locus currently has product positioning but no executable artifact. The project needs a path that reduces ambiguity quickly while preserving room for the longer-term multi-language product direction.

## Decision

Start with a **prototype-first implementation path** that proves the semantic-diff contract and reviewer experience early, while keeping all upstream integrations behind explicit adapters.

Do **not** lock the long-term parser family or implementation language in this phase. Any first parser / language implementation must be treated as a **disposable spike** behind the adapter boundary, not as a repo-wide architecture commitment.

## Options considered

### Option A — Prototype-first implementation with deferred parser/language commitment (chosen)

- Build the first vertical slice early
- Keep parser / provider boundaries explicit from day one
- Treat the first parser / language implementation as provisional until the evaluation criteria are met

### Option B — Prototype-first with parser/language fixed up front

- Build the same prototype flow, but declare the parser family and implementation language as long-term decisions immediately
- Simplifies short-term communication, but creates lock-in before we have evidence from multi-language requirements

### Option C — Full implementation before the contracts are explicit

- Stand up a broad product surface, integrations, and persistence model before the analysis contracts are proven
- Produces visible progress, but makes it harder to replace weak analysis assumptions later

## Rationale

### Time to signal

Option A is still the fastest path to validate whether Locus can detect the changes reviewers actually care about.

### Avoid premature lock-in

Locus aims at multi-language support. Freezing the parser family or implementation language before we have precision and maintenance data would be a design mistake.

### Technical risk

The hardest part of the product is semantic grouping, not CRUD or OAuth. Option A attacks that risk directly without pretending that the first spike is the final platform choice.

### Reuse

A boundary-first implementation can later power a web app, GitHub App, local CLI, or IDE integration. Disposable spikes are acceptable as long as higher-layer contracts stay stable.

## Risks and mitigations

| Risk | Mitigation |
| --- | --- |
| The first spike may be mistaken for the final architecture | document it as provisional and require an ADR before locking parser or implementation language |
| Disposable spike work may feel less efficient than committing immediately | keep the adapter boundary narrow so replacement cost stays controlled |
| Narrow initial language coverage may bias the roadmap | evaluate with explicit criteria and revisit once real fixtures exist |

## Adoption conditions

- Semantic-diff records and snapshot contracts stay provider-agnostic.
- Parser-specific logic does not leak into higher layers.
- The first implementation can be replaced without changing the higher-layer contracts.
- ADR approval is required before locking the long-term parser family or implementation language.
- Every syntax form added to the first spike ships with regression tests.

## Rejection conditions

Revisit this ADR if one of the following becomes true:

- the adapter boundary prevents us from moving quickly enough
- the temporary spike cannot represent the callable-level changes reviewers need
- evidence shows that locking parser/language choices early is necessary for the MVP to ship

## Next actions

1. Keep the first spike behind adapter contracts and validate it with fixtures.
2. Define evaluation criteria for parser / language selection before making a long-term commitment.
3. Add real pull-request fixtures and use them to judge precision before building UI.
