# Semantic Analysis Pipeline

> English: [semantic-analysis-pipeline.md](semantic-analysis-pipeline.md)

## 目的

この文書は semantic analysis pipeline の契約を実装可能な粒度で定義し、最初の parser spike、GitHub ingestion、persistence、UI を同じモデルの上で進められるようにするものです。

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
  language: string | 'unknown'
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

### 補足
- `fileId` は、同一 file の before/after で安定している必要があります
- `language` は ingestion 時点では `unknown` でもよく、後から解決してよいです
- rename detection により `filePath` が変わっても、review session 内の `fileId` は維持します
- GitHub の pull request number のような provider 固有 ID は、core contract の形に直接入れず、`providerMetadata` か安定した string reference に写像して扱います

## Parser contract

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
    outgoing: string[]
    incoming: string[]
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

UI は生の `SemanticChange[]` をそのまま描画しません。analysis pipeline 側で stable な review unit にまとめます。

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

### 初期 grouping 戦略
- まず file 単位でまとめる
- parser が container relationship を返せる場合は近接 symbol をマージしてよい
- reload しても ordering が安定することを優先する

MVP では意図的に単純にしておき、storage model を大きく変えずに後から改善できるようにします。

## Unsupported-language behavior

未対応 file は review session から消さず、明示的な record として残します。

```ts
export interface UnsupportedFileAnalysis {
  reviewId: string
  fileId: string
  filePath: string
  language: string | 'unknown'
  reason: 'unsupported_language' | 'parser_failed' | 'binary_file'
  detail?: string
}
```

理由:
- reviewer は skip された file の存在を知る必要がある
- coverage gap を可観測にしたい
- 将来の parser work に concrete fixture を残したい

## Architecture enrichment contract

architecture enrichment は semantic diff の後段で走らせます。

```ts
export interface ArchitectureEdge {
  fromNodeId: string
  toNodeId: string
  relation: 'imports' | 'calls' | 'implements' | 'uses'
}
```

MVP では graph を浅く保ちます。
- immediate outgoing neighbor
- immediate incoming neighbor
- optional な layer classification（directory heuristic ベース）

## Persistence guidance

最低でも次の record を分けて保存します。
- source snapshot metadata
- semantic changes
- semantic change groups
- unsupported file analysis records
- review progress state

parser-native な raw AST blob は、デフォルトでは main relational table に保存しません。保持が必要なら blob boundary の向こうに置き、DB には参照だけ持たせます。

## Parser evaluation criteria

最初の spike に使う parser / 言語の組み合わせは、少なくとも次を満たすべきです。
- fixture PR 上で callable boundary を安定して見つけられる
- whitespace-only / comment-only edit を無視できる
- rerun しても stable な `symbolKey` を出せる
- 後段の import reference 構築に必要な構造を取れる
- coverage 不足時に明示的に fail できる

## 推奨する実装順序

1. `SourceSnapshot` と `SemanticChange` の型を定義する
2. それらに対する fixture-driven test を先に作る
3. `ParserAdapter` を 1 つ実装する
4. `SemanticChangeGroup` と `UnsupportedFileAnalysis` を保存する
5. grouped DTO を Web workspace に流し込む
