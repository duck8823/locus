# Multi-codehost Boundary Hardening (H5-3)

> 日本語: [multi-codehost-boundary.ja.md](multi-codehost-boundary.ja.md)

## Goal

Reduce implicit GitHub-only assumptions and make code-host extension points explicit without breaking existing behavior.

## Port-level changes

File:
- `src/server/application/ports/pull-request-snapshot-provider.ts`

Added concepts:
- `PullRequestSourceRef` (provider-agnostic source reference)
- `PullRequestSnapshotProviderContract<TSource>`
- backward-compatible alias:
  - `PullRequestSnapshotProvider = PullRequestSnapshotProviderContract<GitHubPullRequestRef>`

This keeps current GitHub call sites intact while enabling plugin/runtime routing for non-GitHub providers.

## Adapter boundary

- GitHub adapter remains isolated in `src/server/infrastructure/github/*`.
- GitLab read-only adapter lives in `src/server/infrastructure/gitlab/*` and maps merge-request changes into shared snapshot pairs.
- Provider-agnostic router lives in `src/server/infrastructure/code-host/*`.
- Provider-specific parsing and API details do not leak into application contracts.
- Plugin runtime can bind additional providers at runtime through capability registration.

## Composition flag

- `LOCUS_ENABLE_GITLAB_ADAPTER=true` enables the GitLab adapter route in composition.
- Default is disabled, so current GitHub ingestion flow remains unchanged.
- `LOCUS_GITLAB_API_BASE_URL` customizes the GitLab API base (`https://gitlab.com/api/v4` by default).
- `GITLAB_TOKEN` is optional for public repositories; private projects require token-based access.
- Disabled or unsupported provider paths return typed diagnostics (`PullRequestProviderUnsupportedCapabilityError`) instead of generic errors.

## Safety rails

- Provider identity is explicit (`source.provider`).
- Missing provider capability raises deterministic `PluginCapabilityUnavailableError`.
- Capability execution errors can disable only the failing plugin, avoiding host-wide failure.

## Non-goals in this step

- Full GitLab UX onboarding and webhook/OAuth implementation
- Bitbucket implementation
- Dynamic plugin marketplace/discovery
- Hot reloading plugins in production
