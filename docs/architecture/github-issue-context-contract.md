# GitHub Issue Read-Only Contract (H3-1)

## Motivation
- Business context must move from inference-only data to real issue data.
- Before wiring UI, the application layer needs a provider-agnostic contract and swap-ready adapters.

## Contract
- Port: `IssueContextProvider` (`src/server/application/ports/issue-context-provider.ts`)
- Supported reference (current): `provider: "github"` with `owner/repository/issueNumber`
- Returned record:
  - identity: provider, owner, repository, issueNumber
  - content: title, body
  - status: `open | closed`
  - metadata: labels, author, htmlUrl, updatedAt

## Adapter Strategy
- `StubIssueContextProvider`
  - deterministic local test data
  - no network dependency
- `GitHubIssueContextProvider`
  - reads `GET /repos/{owner}/{repo}/issues/{number}`
  - filters pull-request payloads returned by the Issues API
  - treats `404` as `null` (missing issue), other non-2xx as errors

## Swap Boundary
- Application/services depend only on `IssueContextProvider`.
- Adapter replacement is done in composition root.
- Existing business-context stub can continue to operate while live provider integration is staged.

## Non-Goals
- UI integration
- write-back operations (create/update issues)
- multi-codehost concrete implementation (only contract groundwork here)
