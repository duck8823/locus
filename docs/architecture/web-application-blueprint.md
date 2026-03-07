# Web Application Blueprint

> 日本語: [web-application-blueprint.ja.md](web-application-blueprint.ja.md)

## Purpose

This document translates the high-level ADRs into an implementation-oriented blueprint for the first Locus web application.

It answers:
- what the main runtime pieces are
- where code should live in a Next.js project
- how requests flow through the layers
- which responsibilities belong to the web shell vs the analysis core

Related document:
- [Semantic Analysis Pipeline](semantic-analysis-pipeline.md)

## Runtime overview

```text
Browser
  -> Next.js App Router (UI + Backend for Frontend (BFF) surface)
    -> Application use cases
      -> Domain contracts
        -> Infrastructure adapters
          -> GitHub API / Database / Queue / Blob Store / Parser Runtime / LLM API
```

### Main runtime components

1. **Browser UI**
   - review workspace
   - authentication flow
   - settings for integrations
2. **Next.js web application**
   - route handlers
   - server rendering
   - server actions for local UI mutations
3. **Background execution**
   - pull request ingestion
   - semantic analysis jobs
   - architecture-context enrichment
4. **Persistence**
   - relational database for review sessions and metadata
   - optional blob storage for raw snapshots / large intermediate artifacts
5. **External systems**
   - GitHub
   - future context sources (Confluence, Jira, Notion)
   - optional LLM providers

## Recommended project structure

```text
src/
  app/
    (marketing)/
      page.tsx
    (workspace)/
      reviews/
        [reviewId]/
          page.tsx
          loading.tsx
          error.tsx
      settings/
        connections/page.tsx
    api/
      github/
        webhooks/route.ts
      reviews/
        [reviewId]/
          progress/route.ts
          reanalyze/route.ts
  server/
    presentation/
      api/
      actions/
      dto/
      mappers/
    application/
      usecases/
      services/
      ports/
    domain/
      entities/
      value-objects/
      repositories/
      services/
    infrastructure/
      db/
      github/
      parser/
      llm/
      queue/
      cache/
      storage/
```

## Layer mapping inside the web app

### `src/app/**`
Framework surface only.

Allowed:
- route files
- page/layout/loading/error files
- wiring UI components to use cases
- reading request params, cookies, headers, session

Not allowed:
- raw database queries
- direct GitHub SDK usage
- direct parser calls
- business rules that belong to use cases or domain

### `src/server/presentation/**`
Presentation helpers that should not live in framework files.

Examples:
- `presentReviewWorkspace.ts`
- `parseProgressRequest.ts`
- `toReviewWorkspaceDto.ts`

### `src/server/application/**`
Workflow orchestration.

Candidate use cases:
- `ConnectGitHubAccount`
- `IngestPullRequest`
- `OpenReviewWorkspace`
- `MarkSemanticChangeReviewed`
- `ReanalyzeReview`
- `GetArchitectureContext`

### `src/server/domain/**`
Framework-agnostic concepts.

Candidate entities/value objects:
- `ReviewId`
- `PullRequestRef`
- `ReviewSession`
- `ReviewProgress`
- `SemanticChange`
- `SemanticChangeGroup`
- `ArchitectureNode`

### `src/server/infrastructure/**`
Provider-specific implementations.

Examples:
- `PrismaReviewSessionRepository`
- `GitHubCodeHostClient`
- `TreeSitterTypeScriptParserAdapter`
- `OpenAIReviewAssistant`

## Primary user flows

### 1. GitHub ingestion flow

```text
GitHub webhook
  -> app/api/github/webhooks/route.ts
  -> presentation parser/validator
  -> application.IngestPullRequest
  -> infrastructure.github fetches changed files
  -> infrastructure.queue schedules analysis
  -> infrastructure.db stores review shell
```

### 2. Open review workspace

```text
GET /reviews/:reviewId
  -> app/(workspace)/reviews/[reviewId]/page.tsx
  -> application.OpenReviewWorkspace
  -> domain assembles review state
  -> presentation DTO mapper
  -> server-rendered workspace page
```

### 3. Mark progress

```text
POST /api/reviews/:reviewId/progress
  -> route handler
  -> request mapper
  -> application.MarkSemanticChangeReviewed
  -> domain ReviewSession updates progress rules
  -> repository persists state
  -> response DTO
```

## UI composition for the first workspace

The first review workspace should fit on one screen and keep navigation friction low.

Minimum panes/components:
- **Change group list** — stable ordering of semantic change groups
- **Detail pane** — selected change summary, before/after explanation, file references
- **Architecture pane** — immediate upstream/downstream neighbors only
- **Progress state** — unread / in-progress / reviewed

Nice-to-have later:
- spec context pane
- AI review comments pane
- collaborator cursors / presence

## Server Actions policy

Use Server Actions only when all of the following are true:
- the mutation originates from the current UI only
- no public API semantics are required
- the action still delegates immediately to an application use case

Use Route Handlers when:
- the endpoint is called by GitHub or another external system
- the endpoint may later be called by multiple clients
- the endpoint has explicit HTTP semantics we want to preserve

## Persistence boundaries

The first implementation needs at least:
- review session table
- pull request snapshot metadata table
- semantic change group table
- review progress state table

Raw source snapshots may live in blob storage if database row size becomes a problem. That decision does not need to be locked before the first web shell exists.

## Background job boundaries

Keep long-running analysis out of request/response paths.

Background jobs include:
- pull request snapshot ingestion
- parser-based semantic analysis
- architecture graph enrichment
- future AI review generation

The web shell may trigger jobs and poll or subscribe for state, but it must not perform the heavy analysis inline.

## Implementation slices

### Slice A — Web shell skeleton
- Next.js App Router scaffold
- auth/session stub
- empty review workspace route
- layered server folders and lintable dependency rules

### Slice B — Review session persistence
- open a review by ID
- store progress state
- render stub semantic change groups from fixtures

### Slice C — GitHub ingestion + first parser spike
- ingest changed files from GitHub
- create file snapshots
- run one parser adapter
- persist semantic change groups

### Slice D — Architecture context
- import graph extraction
- immediate neighbors pane
- review workspace enrichment

## Non-goals for the first implementation

- native desktop packaging
- multi-client API platform design
- plugin marketplace
- fully generalized real-time collaboration
