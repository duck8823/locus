# Real PR Fixtures (TypeScript parser regression)

These fixture pairs are extracted from real historical commits in this repository to keep parser-regression tests anchored to non-synthetic changes.

## Fixture sources

1. `set-workspace-locale-action.before.ts.txt` / `set-workspace-locale-action.after.ts.txt`
   - source commit: `37d2437187bae19206238d9833f0b448eeeeb060`
   - change theme: redirect-path validation hardening (`\\` bypass rejection)

2. `start-github-demo-session-action.before.ts.txt` / `start-github-demo-session-action.after.ts.txt`
   - source commit: `13e9fb4eb253c57a8fbd619999e20ce371e94a2f`
   - change theme: structured GitHub demo error code refactor

The parser regression test for these fixtures lives at:
- `src/server/infrastructure/parser/typescript-parser-adapter.real-pr-fixtures.test.ts`
