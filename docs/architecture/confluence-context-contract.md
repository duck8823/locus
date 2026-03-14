# Confluence Read-only Context Contract (H2-1)

> 日本語: [confluence-context-contract.ja.md](confluence-context-contract.ja.md)

## Purpose

Define a provider boundary for loading Confluence-based requirement/spec references **without leaking provider-specific details into presentation DTOs**.

## Scope

- Read-only lookup only (no page create/update/write-back)
- Contract for Confluence adapter inputs, outputs, and typed error classes
- Fallback diagnostics mapping to workspace business-context diagnostics

Out of scope:
- Confluence OAuth onboarding UX
- bi-directional sync and approval workflows

## Port contract

File:
- `src/server/application/ports/confluence-context-provider.ts`

```ts
interface ConfluencePageContextRecord {
  provider: "confluence"
  pageId: string
  spaceKey: string | null
  title: string
  summary: string | null
  url: string
  updatedAt: string
}

interface ConfluenceContextProvider {
  searchPagesForReviewContext(input: {
    reviewId: string
    repositoryName: string
    branchLabel: string
    title: string
    accessToken: string | null
  }): Promise<ConfluencePageContextRecord[]>
}
```

## Error contract

Adapter failures are classified into typed errors:

- `ConfluenceContextProviderTemporaryError`
  - `retryable = true`
  - examples: timeout, network, 429, upstream 5xx
- `ConfluenceContextProviderPermanentError`
  - `retryable = false`
  - examples: auth failures, not-found, non-retryable client errors

Both include normalized `reasonCode` from integration-failure classification.

## Fallback diagnostics mapping

When Confluence lookup participates in workspace context loading, diagnostics must map to existing business-context contract fields:

- `diagnostics.status`
- `diagnostics.retryable`
- `diagnostics.reasonCode`
- `diagnostics.message`
- `diagnostics.occurredAt`
- `diagnostics.cacheHit`
- `diagnostics.fallbackReason`

This keeps UI behavior provider-agnostic.

## Adapter reference implementation

File:
- `src/server/infrastructure/context/confluence-readonly-context-provider.ts`

Behavior:
- builds read-only CQL query from review metadata
- maps Confluence response to normalized page records
- classifies failures and throws typed temporary/permanent errors

## Tests

File:
- `src/server/infrastructure/context/confluence-readonly-context-provider.test.ts`

Coverage:
- no-base-url returns empty result
- successful mapping from Confluence response payload
- retryable failure -> temporary typed error
- terminal failure -> permanent typed error
