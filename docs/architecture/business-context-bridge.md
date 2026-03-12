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
  confidence: "high" | "medium" | "low"
  inferenceSource:
    | "issue_url"
    | "repo_shorthand"
    | "same_repo_shorthand"
    | "same_repo_closing_keyword"
    | "branch_pattern"
    | "pull_request_fallback"
    | "none"
  title: string
  summary: string | null
  href: string | null
}

export interface ReviewWorkspaceBusinessContextDto {
  generatedAt: string
  provider: "stub" | "fallback"
  diagnostics: {
    status: "ok" | "fallback"
    retryable: boolean
    message: string | null
    occurredAt: string | null
  }
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
- `confidence`
  - `high`: explicit signals (issue URL, owner/repo shorthand, closing keywords)
  - `medium`: inferred but plausible signals (same-repo shorthand, branch pattern)
  - `low`: weak fallback or unavailable placeholder
- `inferenceSource`
  - deterministic reason code for why the row exists (`issue_url`, `branch_pattern`, etc.)
  - `none` is reserved for unavailable placeholder rows

## Prototype Behavior

- A `StubBusinessContextProvider` emits deterministic placeholder context.
- GitHub-backed reviews parse PR title metadata to infer issue links:
  - explicit `owner/repo#123` and GitHub issue URLs are surfaced as `linked`
  - same-repository `fixes #123` / `closes #123` style phrases are surfaced as `linked`
  - plain same-repository `#123` shorthand is surfaced as `candidate`
  - branch conventions (`feature/123-*`, `issue-456`, etc.) provide additional `candidate` links
  - when no reference exists, a deterministic fallback candidate (PR number) is emitted
- Non-GitHub sources receive unavailable rows only.

## Failure Handling (H3-4)

- When context loading fails, API returns `provider: "fallback"` with a deterministic unavailable item.
- `diagnostics` includes:
  - `status: "fallback"`
  - `retryable` flag for UI
  - error `message` (best effort)
  - `occurredAt` timestamp
- UI shows retry guidance (`Reload now`) and keeps workspace usable.

## Evolution Rules

1. Add source/status enums in an additive way.
2. Preserve fallback rendering for unknown future values.
3. Keep `href` nullable so unavailable entries can be represented without fake links.
4. Promote the provider from `stub` to real adapters without breaking field names.
