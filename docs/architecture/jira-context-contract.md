# Jira Read-only Context Contract (H2-2)

> 日本語: [jira-context-contract.ja.md](jira-context-contract.ja.md)

## Purpose

Define a provider-neutral Jira issue-tracker adapter boundary with explicit capability flags and typed diagnostics.

## Scope

- Read-only issue search for review context enrichment
- Typed transient/terminal error contract
- Capability-flag model for GitHub / Confluence / Jira differentiation
- Fallback diagnostics mapping to existing business-context diagnostics fields
- Authentication-mode handling for OAuth bearer and Jira API token basic credentials

Out of scope:
- Jira issue create/update transitions
- workflow automation and status sync

## Port contract

File:
- `src/server/application/ports/jira-context-provider.ts`

```ts
interface JiraIssueContextRecord {
  provider: "jira"
  issueKey: string
  title: string
  summary: string | null
  url: string
  status: string | null
  updatedAt: string
}

interface JiraContextProvider {
  searchIssuesForReviewContext(input: {
    reviewId: string
    repositoryName: string
    branchLabel: string
    title: string
    accessToken: string | null
  }): Promise<JiraIssueContextRecord[]>
}
```

## Error contract

- `JiraContextProviderTemporaryError` (`retryable=true`)
- `JiraContextProviderPermanentError` (`retryable=false`)

Both expose normalized `reasonCode` based on integration-failure classification.

## Fallback diagnostics mapping

When Jira lookup participates in workspace context loading, diagnostics map to existing business-context fields:

- `diagnostics.status`
- `diagnostics.retryable`
- `diagnostics.reasonCode`
- `diagnostics.message`
- `diagnostics.occurredAt`
- `diagnostics.cacheHit`
- `diagnostics.fallbackReason`

## Capability flags model

File:
- `src/server/application/services/requirement-context-capabilities.ts`

```ts
interface RequirementContextCapabilityFlags {
  supportsIssueLinks: boolean
  supportsSpecPages: boolean
  supportsTaskTickets: boolean
  supportsLiveFetch: boolean
  supportsCandidateInference: boolean
}
```

Provider baselines:

- GitHub: issue links + live fetch + candidate inference
- Confluence: spec pages only (read-only)
- Jira: issue links + task tickets (read-only baseline)

This model is additive and does not require presentation DTO changes.

## Presentation boundary

- Jira-specific fields (`issueKey`, `status`) stay inside adapter contracts.
- Presentation-layer DTOs keep provider-neutral `sourceType/status/confidence` semantics.
- Capability flags are resolved in application services, not embedded into presentation contracts.

## Adapter reference implementation

File:
- `src/server/infrastructure/context/jira-readonly-context-provider.ts`

Behavior:
- performs read-only `/rest/api/3/search`
- maps issues into normalized records
- flattens Jira ADF description payloads into summary text
- supports `bearer` and `basic` authorization schemes
- throws typed temporary/permanent errors with reason code

## Tests

Files:
- `src/server/infrastructure/context/jira-readonly-context-provider.test.ts`
- `src/server/application/services/requirement-context-capabilities.test.ts`

Coverage:
- mapping success, retryable/terminal failure classification
- provider-specific capability flag differences
- capability object cloning (mutation safety)
