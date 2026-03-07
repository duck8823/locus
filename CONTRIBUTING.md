# Contributing to Locus

> 日本語: [CONTRIBUTING.ja.md](CONTRIBUTING.ja.md)

Locus is currently a documentation-first repository. The immediate goal is to align on product scope, architectural boundaries, and evaluation criteria before committing to a long-term implementation path.

## Working Agreement

- Ship thin vertical slices that reduce ambiguity.
- Keep architectural decisions explicit in `docs/adr/`.
- Prefer parser / integration abstractions over hard-coding provider details.
- Treat parser and implementation-language choices as provisional until an ADR explicitly fixes them.
- Do not let a temporary spike masquerade as a long-term platform decision.

## What contributions are useful right now

- refining the MVP definition
- tightening ADRs and decision criteria
- improving bilingual documentation quality
- clarifying plugin, parser, and adapter boundaries
- adding issue breakdowns and review scenarios

## Repository Layout

- `README.md` / `README.ja.md` — product overview
- `docs/mvp.md` / `docs/mvp.ja.md` — MVP scope and delivery slices
- `docs/adr/` — architecture decisions
- `CONTRIBUTING.md` / `CONTRIBUTING.ja.md` — contribution policy

## Change Policy

Open or update an ADR before making one of these changes:

- locking the long-term parser family
- locking the long-term implementation language
- replacing the parser abstraction strategy
- introducing a persistence layer
- coupling GitHub ingestion directly to the diff engine
- broadening the MVP beyond the scope in `docs/mvp.md`

## Pull Request Checklist

- [ ] Scope matches the current MVP or an approved ADR
- [ ] English and Japanese docs stay consistent when both are affected
- [ ] Cross-links between language variants are updated if needed
- [ ] README / docs updated when the documented direction changes
