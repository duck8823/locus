# Connections Workspace Contract

> 日本語: [connections-workspace-contract.ja.md](connections-workspace-contract.ja.md)

## Purpose

Define a stable server-to-UI contract for `/settings/connections` before implementing real OAuth flows.

This keeps provider lifecycle/state modeling explicit and testable while infrastructure is still a stub.

## Scope

- Connection catalog shape for the workspace settings page
- Provider/status/auth-mode value semantics
- Backward-compatible evolution rules

Out of scope:
- OAuth token storage
- Provider callback handlers
- Multi-tenant credential management

## Current DTO Contract

```ts
export interface ConnectionsWorkspaceTransitionDto {
  transitionId: string
  previousStatus: string
  nextStatus: string
  changedAt: string
  connectedAccountLabel: string | null
}

export interface ConnectionsWorkspaceConnectionDto {
  provider: "github" | "confluence" | "jira"
  status: string
  authMode: "oauth" | "none"
  statusUpdatedAt: string | null
  connectedAccountLabel: string | null
  stateSource: "catalog_default" | "persisted"
  capabilities: {
    supportsWebhook: boolean
    supportsIssueContext: boolean
  }
  recentTransitions: ConnectionsWorkspaceTransitionDto[]
}

export interface ConnectionsWorkspaceDto {
  generatedAt: string // ISO-8601 UTC timestamp
  connections: ConnectionsWorkspaceConnectionDto[]
}
```

`generatedAt` represents when the catalog snapshot was produced by the server for the current request.

## Semantic Rules

### `provider`

- Stable machine key (not localized label)
- Used for UI copy lookup and future provider-specific actions
- Must remain deterministic across locales

### `status`

- `not_connected`: provider is available in the model, but not currently connected
- `planned`: provider is intentionally not yet enabled in this phase
- `connected`: OAuth handshake has succeeded for the current reviewer
- `reauth_required`: a previously connected provider now requires re-authentication
- unknown future values are passed through as-is so UI can apply fallback rendering safely

### `authMode`

- `oauth`: provider is expected to use OAuth in production
- `none`: provider intentionally has no auth integration path

### `stateSource`

- `catalog_default`: value came from static provider catalog defaults
- `persisted`: value came from reviewer-scoped persisted state

### `capabilities`

- `supportsWebhook`: provider can trigger inbound updates
- `supportsIssueContext`: provider can enrich review context with issue/spec data

### `recentTransitions`

- Most recent provider transitions in descending timestamp order
- Records status movement plus effective account label at transition time
- Intended for troubleshooting and local observability in prototype mode

## Localization Boundary

Provider/status/auth labels are localized in presentation (`src/app/**`), not in DTO values.
This keeps API responses stable and language-agnostic.

## Evolution Policy

When extending this contract:

1. Add new enum values in an additive way.
2. Keep existing values backward compatible.
3. Add fallback rendering for unknown future values in UI.
4. Cover DTO/use case changes with unit tests before wiring infrastructure.

## Current prototype coverage

- Read path merges static provider defaults with reviewer-scoped persisted states.
- Write path supports controlled transitions via `SetConnectionStateUseCase` + `setConnectionStateAction`.
- State transitions are now appended to reviewer-scoped transition audit history.
- Provider metadata now goes through a `ConnectionProviderCatalog` port with a prototype adapter implementation.
- Connection state persistence now uses a SQLite-backed repository with lazy migration from legacy file records.

## Next Steps

1. Add transition audit reason fields (`manual` / `token-expired` / `webhook`) and actor attribution.
2. Define retention policy and pruning strategy for transition history.
3. Replace prototype OAuth assumptions with real token/callback flows.
