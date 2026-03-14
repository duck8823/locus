# Requirement Context Arbitration Policy (H2-3)

> 日本語: [context-arbitration-policy.ja.md](context-arbitration-policy.ja.md)

## Purpose

Define deterministic conflict-resolution rules when multiple context providers produce overlapping requirement candidates.

## Scope

- Arbitration precedence for duplicated requirement context candidates
- Conflict reason-code contract for operational diagnostics
- Composition-layer ownership (no presentation-layer branching)

Out of scope:
- Provider-specific fetch logic
- UI rendering rules beyond consuming diagnostics

## Implementation boundary

- Service: `src/server/application/services/arbitrate-business-context-candidates.ts`
- Composition usage: `src/server/infrastructure/context/live-business-context-provider.ts`

Presentation DTOs only consume the resolved item list and diagnostics.

## Candidate precedence

When candidates share the same dedupe key, selection follows this order:

1. Confidence priority (`high` > `medium` > `low`)
2. Source freshness (`updatedAt` newer wins)
3. Provider priority (`github` > `jira` > `confluence` > `stub`)
4. Status priority (`linked` > `candidate` > `unavailable`)
5. Stable tie-breaker (`candidateId` lexical order)

## Conflict reason codes

Arbitration publishes reason codes to diagnostics:

- `confidence_priority`
- `freshness_priority`
- `provider_priority`
- `status_priority`
- `stable_tie_breaker`

These codes are additive observability signals and do not change the presentation contract shape.
