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
export interface ConnectionsWorkspaceConnectionDto {
  provider: "github" | "confluence" | "jira"
  status: "not_connected" | "planned"
  authMode: "oauth" | "none"
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

### `authMode`

- `oauth`: provider is expected to use OAuth in production
- `none`: provider intentionally has no auth integration path

## Localization Boundary

Provider/status/auth labels are localized in presentation (`src/app/**`), not in DTO values.
This keeps API responses stable and language-agnostic.

## Evolution Policy

When extending this contract:

1. Add new enum values in an additive way.
2. Keep existing values backward compatible.
3. Add fallback rendering for unknown future values in UI.
4. Cover DTO/use case changes with unit tests before wiring infrastructure.

## Next Steps

1. Add provider capability metadata (`supportsWebhook`, `supportsIssueContext`).
2. Introduce persisted connection state per reviewer/workspace.
3. Replace prototype catalog entries with provider adapters.
