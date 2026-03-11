# Business Context Bridge Contract

> 日本語: [business-context-bridge.ja.md](business-context-bridge.ja.md)

## Purpose

Define a stable Phase-2 bridge contract for attaching requirement/spec context to a review workspace.

This keeps context UX wiring testable before real Confluence / GitHub Issues adapters are fully integrated.

## Scope

- Read-only context panel contract for `/reviews/[reviewId]`
- Source/status value semantics for linked requirement metadata
- Stub-provider behavior used in prototype mode

Out of scope:

- Bi-directional sync with issue trackers
- Confluence authentication/session management
- Automatic requirement extraction from PR text

## DTO Contract

```ts
export interface ReviewWorkspaceBusinessContextItemDto {
  contextId: string
  sourceType: "github_issue" | "confluence_page"
  status: "linked" | "candidate" | "unavailable"
  title: string
  summary: string | null
  href: string | null
}

export interface ReviewWorkspaceBusinessContextDto {
  generatedAt: string
  provider: "stub"
  items: ReviewWorkspaceBusinessContextItemDto[]
}
```

## Semantics

- `sourceType`
  - `github_issue`: issue/project style requirement context from GitHub
  - `confluence_page`: documentation/spec context from Confluence
- `status`
  - `linked`: confirmed requirement link
  - `candidate`: plausible context candidate (needs user confirmation)
  - `unavailable`: no linked context currently available

## Prototype Behavior

- A `StubBusinessContextProvider` emits deterministic placeholder context.
- GitHub-backed reviews receive one candidate GitHub issue link and one unavailable Confluence row.
- Non-GitHub sources receive unavailable rows only.

## Evolution Rules

1. Add source/status enums in an additive way.
2. Preserve fallback rendering for unknown future values.
3. Keep `href` nullable so unavailable entries can be represented without fake links.
4. Promote the provider from `stub` to real adapters without breaking field names.
