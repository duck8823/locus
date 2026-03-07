# Contributing to Locus

> 日本語: [CONTRIBUTING.ja.md](CONTRIBUTING.ja.md)

Locus is still in the prototype phase. The current goal is to validate the reviewer experience before investing in a full hosted product.

## Working Agreement

- Ship thin vertical slices that prove product value.
- Keep architectural decisions explicit in `docs/adr/`.
- Prefer parser / integration abstractions over hard-coding provider details.
- Treat the current parser / implementation language choice as provisional until an ADR explicitly fixes it.
- Add tests for every semantic-diff regression you fix.

## Local Development

```bash
npm install
npm run build
npm test
```

Run the current CLI prototype against two source files:

```bash
npm run semantic-diff -- path/to/before.ts path/to/after.ts
```

JSON output is available with `--json`.

## Repository Layout

- `docs/` — product and architecture decisions
- `packages/semantic-diff` — current executable semantic-diff spike behind the parser contract

## Change Policy

Open or update an ADR before making one of these changes:

- replacing the parser strategy
- locking the long-term parser family or implementation language
- introducing a new persistence layer
- coupling GitHub ingestion directly to the diff engine
- broadening the MVP beyond the scope in `docs/mvp.md`

## Pull Request Checklist

- [ ] Scope matches the current MVP or an approved ADR
- [ ] `npm run build` passes
- [ ] `npm test` passes
- [ ] README / docs updated when behavior changes
