# Semantic Analysis Pipeline

> 日本語: [semantic-analysis-pipeline.ja.md](semantic-analysis-pipeline.ja.md)

## Purpose

This document defines the implementation-oriented contracts for the semantic analysis pipeline so that the first parser spike, GitHub ingestion, persistence, and UI can all be designed against the same model.

Related document:
- [Web Application Blueprint](web-application-blueprint.md)

## End-to-end pipeline

```text
GitHub diff / file snapshots
  -> SourceSnapshot normalization
  -> language detection
  -> ParserAdapter.parse()
  -> ParserAdapter.diff()
  -> Semantic Change IR normalization
  -> change grouping
  -> architecture enrichment
  -> persistence
  -> review workspace DTOs
```

## Snapshot contract

```ts
export interface SourceSnapshot {
  snapshotId: string
  fileId: string
  filePath: string
  language: string | null
  revision: 'before' | 'after'
  content: string
  metadata: {
    codeHost: string
    repositoryRef?: string
    changeRequestRef?: string
    commitSha?: string
    providerMetadata?: Record<string, unknown>
  }
}
```

### Notes
- `fileId` must stay stable across before/after versions of the same file.
- `language` may be `null` at ingestion time and resolved later.
- rename detection may update `filePath`, but `fileId` should remain stable for the review session.
- provider-specific identifiers such as GitHub pull request numbers should live under `providerMetadata` or be mapped into stable string references, not into the core contract shape.

## Parser contracts

The canonical minimum `ParserAdapter` contract is defined in [ADR 0004](../adr/0004-semantic-change-ir.md). This document extends those payloads with persistence-oriented fields used by the pipeline.

```ts
export interface ParsedSnapshot {
  snapshotId: string
  adapterName: string
  language: string
  parserVersion?: string
  raw: unknown
}

export interface ParserDiffResult {
  adapterName: string
  language: string
  items: ParserDiffItem[]
}

export interface ParserDiffItem {
  symbolKey: string
  displayName: string
  kind: 'function' | 'method' | 'class' | 'module' | 'unknown'
  container?: string
  changeType: 'added' | 'removed' | 'modified' | 'moved' | 'renamed'
  signatureSummary?: string
  bodySummary?: string
  references?: string[]
  metadata?: Record<string, unknown>
}
```

## Semantic Change IR

```ts
export interface SemanticChange {
  semanticChangeId: string
  reviewId: string
  fileId: string
  language: string
  adapterName: string
  symbol: {
    stableKey: string
    displayName: string
    kind: 'function' | 'method' | 'class' | 'module' | 'unknown'
    container?: string
  }
  change: {
    type: 'added' | 'removed' | 'modified' | 'moved' | 'renamed'
    signatureSummary?: string
    bodySummary?: string
  }
  before?: CodeRegionRef
  after?: CodeRegionRef
  architecture?: {
    outgoingNodeIds: string[]
    incomingNodeIds: string[]
  }
  metadata: {
    parser: Record<string, unknown>
    languageSpecific: Record<string, unknown>
  }
}

export interface CodeRegionRef {
  filePath: string
  startLine: number
  endLine: number
}
```

## Change grouping contract

The UI should not render raw `SemanticChange[]` directly. The analysis pipeline should group them into stable review units.

```ts
export interface SemanticChangeGroup {
  groupId: string
  reviewId: string
  title: string
  fileIds: string[]
  semanticChangeIds: string[]
  dominantLayer?: string
  status: 'unread' | 'in_progress' | 'reviewed'
}
```

`dominantLayer` is filled by the architecture-enrichment stage when directory heuristics or future architecture metadata can infer a likely layer. It may stay undefined when that inference is unavailable.

### Initial grouping strategy
- group by file first
- optionally merge adjacent symbols when the parser reports a container relationship
- keep ordering stable across reloads

This is intentionally simple for MVP. The grouping algorithm can improve later without changing the storage model drastically.

## Unsupported-language behavior

Unsupported files must be preserved in the review session as explicit records.

```ts
export interface UnsupportedFileAnalysis {
  reviewId: string
  fileId: string
  filePath: string
  language: string | null
  reason: 'unsupported_language' | 'parser_failed' | 'binary_file'
  detail?: string
}
```

Why:
- the reviewer needs to know a file was skipped
- the system needs observability on coverage gaps
- future parser work needs concrete fixtures

## Architecture enrichment contract

Architecture enrichment runs after the semantic diff exists.

```ts
export interface ArchitectureEdge {
  fromNodeId: string
  toNodeId: string
  relation: 'imports' | 'calls' | 'implements' | 'uses'
}
```

`fromNodeId`, `toNodeId`, `outgoingNodeIds`, and `incomingNodeIds` all use the same architecture-node identifier space. They are not `fileId` or `symbolKey` values.
Those node IDs are assigned by the architecture-enrichment stage.

For MVP, keep the graph shallow:
- immediate outgoing neighbors
- immediate incoming neighbors
- optional layer classification from directory heuristics

## Persistence guidance

Persist at least these records separately:
- source snapshots metadata
- semantic changes
- semantic change groups
- unsupported file analysis records
- review progress state

Do **not** persist parser-native raw AST blobs in the main relational tables by default. If raw payloads need to be retained, store them behind a blob boundary and keep only references in the database.

## Parser evaluation criteria

A candidate parser/language combination is acceptable for the first spike if it can:
- identify callable boundaries reliably on fixture PRs
- ignore whitespace-only and comment-only edits
- produce stable `symbolKey` values across reruns
- expose enough structure to build import references later
- fail explicitly when coverage is missing

## Suggested first implementation order

1. Define `SourceSnapshot` and `SemanticChange` types.
2. Implement fixture-driven tests against those types.
3. Add one `ParserAdapter` implementation.
4. Persist `SemanticChangeGroup` and `UnsupportedFileAnalysis`.
5. Feed the grouped DTOs into the web workspace.
