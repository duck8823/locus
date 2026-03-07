# ADR 0004: parser-adapter boundary の先に共通 Semantic Change IR を置く

> English: [0004-semantic-change-ir.md](0004-semantic-change-ir.md)

- Status: Accepted
- Date: 2026-03-07

## Context

Locus は将来的に多言語対応が必要ですが、最初の実装で検証するのは 1 言語ずつです。TypeScript/Node の parser ecosystem を今すぐ活用しつつ、最初の parser 選定を最終アーキテクチャにしてしまわない設計が必要です。

## Decision

言語ごとの parser は、必ず **共通 Semantic Change IR** に正規化してから後続処理に渡します。

システムの段階を 3 つに分けます。
1. **Parser adapter** — 言語固有 snapshot を parse し、parser native な情報を扱う
2. **Normalizer** — parser native な出力を共通 IR に変換する
3. **Enricher** — architecture context、graph edge、必要なら requirements context を後付けする

parser native な AST は infrastructure boundary を越えません。

## IR に必須の性質

IR は少なくとも次を表現できる必要があります。
- file identity と snapshot identity
- language と parser adapter identity
- symbol identity と display name
- callable kind / container kind
- change type (`added`, `removed`, `modified`, `moved`, `renamed` など、対応範囲に応じて)
- signature summary と body summary
- 後段で見つかる architecture edge / reference
- namespaced な escape hatch に載せる language-specific metadata

## Parser adapter contract

```ts
export interface ParserAdapter {
  readonly language: string
  readonly adapterName: string

  supports(file: SourceSnapshot): boolean

  parse(snapshot: SourceSnapshot): Promise<ParsedSnapshot>

  diff(input: {
    before: ParsedSnapshot | null
    after: ParsedSnapshot | null
  }): Promise<ParserDiffResult>

  capabilities(): ParserCapabilities
}
```

```ts
export interface ParserCapabilities {
  callableDiff: boolean
  importGraph: boolean
  renameDetection: boolean
  moveDetection: boolean
  typeAwareSummary: boolean
}
```

## この設計にする理由

- 最初の parser を暫定実装として扱える
- application/domain 層は安定した概念の上で動ける
- metadata と capability flag により、言語固有の情報量も落としすぎずに済む
- 未対応言語は main contract を壊さず、明示的に unsupported と扱える

## Consequences

### Positive

- parser の差し替え影響が局所化する
- UI や persistence model が生 AST 形状に依存しない
- 多言語対応が rewrite ではなく adapter 追加の問題になる

### Negative

- 言語ごとに normalization 実装が必要になる
- 最小公倍数だけを見すぎると IR が弱くなりすぎる

## 採用条件

- IR に language-specific metadata 用の escape hatch を持たせる
- capability flag は downstream 側で推測せず、adapter が明示する
- 未対応言語の file は黙って捨てずに intentional に unsupported と記録する
- parser-specific object を UI props / DB row / domain entity に直接流し込まない
