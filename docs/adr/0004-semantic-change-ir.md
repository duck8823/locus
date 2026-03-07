# ADR 0004: Put a parser-adapter boundary in front of a common Semantic Change IR

> 日本語: [0004-semantic-change-ir.ja.md](0004-semantic-change-ir.ja.md)

- Status: Accepted
- Date: 2026-03-07

## Context

Locus needs multi-language support eventually, but the first implementation will only validate one language at a time. We need a design that allows us to use TypeScript/Node parser ecosystems today without turning the first parser choice into the final architecture.

## Decision

Every language-specific parser must normalize into a **common Semantic Change IR** before the rest of the system consumes the result.

The system therefore has three explicit stages:
1. **Parser adapter** — parse a language-specific snapshot and expose parser-native information
2. **Normalizer** — convert parser-native output into the common IR
3. **Enricher** — attach architecture context, graph edges, and optional requirements context

Parser-native ASTs do **not** cross the infrastructure boundary.

## Options considered

### Option A — Expose parser-native contracts to higher layers

- Lets the first implementation move quickly with one parser stack
- Couples UI, persistence, and application logic to parser-specific shapes

### Option B — Lock one parser family and language model up front

- Simplifies early implementation choices
- Creates architectural lock-in before multi-language evaluation data exists

### Option C — Parser adapter boundary + common Semantic Change IR (chosen)

- Keeps the first parser implementation replaceable
- Preserves stable contracts for storage, UI, and future language expansion

## Required properties of the IR

The IR must be able to represent at least:
- file identity and snapshot identity
- language and parser adapter identity
- symbol identity and display name
- callable kind / container kind
- change type (`added`, `removed`, `modified`, `moved`, `renamed` if supported)
- signature summary and body summary
- architecture edges or references discovered later
- language-specific metadata in a namespaced escape hatch

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

## Why this design

- the first parser can be temporary
- the application/domain layers can operate on stable concepts
- language-specific richness is still possible through metadata and capability flags
- unsupported languages can fail explicitly without corrupting the main contracts

## Consequences

### Positive

- parser swaps stay local
- the UI and persistence models do not depend on raw AST shapes
- multi-language support becomes an additive adapter problem rather than a rewrite

### Negative

- extra normalization work exists for every language
- the IR can become too weak if we only design for the lowest common denominator

## Adoption conditions

- the IR carries a metadata escape hatch for language-specific details
- capability flags are explicit, not guessed downstream
- unsupported language files are marked intentionally, not silently dropped
- parser-specific objects never enter UI props, DB rows, or domain entities directly
