# Exploratory Test Playbook (Web Workspace v0)

> 日本語: [exploratory-test-playbook.ja.md](exploratory-test-playbook.ja.md)

## Goal

Provide a repeatable exploratory test flow for the current `locus` prototype without relying on external systems.

## Scope

In scope:
- marketing page (`/`)
- review workspace (`/reviews/[reviewId]`)
- connections page (`/settings/connections`)
- local demo data operations (`.locus-data`)

Out of scope:
- private GitHub repositories and OAuth integration
- webhook signature validation against real external delivery
- production deployment concerns

## Environment Setup

```bash
npm install
# reset local demo data (script-less fallback)
rm -rf .locus-data
mkdir -p .locus-data/review-sessions .locus-data/analysis-jobs
printf '{\n  "jobs": []\n}\n' > .locus-data/analysis-jobs/jobs.json
npm run dev
```

Optional validation before/after a session:

```bash
npm run lint
npm run typecheck
npm test
```

## Session Charters

Run each charter as a 20–30 minute time-boxed session.

### Charter 1: First-run experience (no cache)

1. Ensure `.locus-data` is reset (use the setup commands above).
2. Open `/` and start the seed demo.
3. Verify:
   - workspace opens immediately
   - initial analysis status transitions are visible
   - first semantic groups appear without manual refresh loops

Expected risk to probe:
- user perceives the app as "stuck" while analysis is in progress

### Charter 2: Long text and locale stress

1. Switch language between Japanese and English on `/` and `/reviews/[reviewId]`.
2. Verify layout under narrow viewport (mobile-ish width).
3. Focus on:
   - button wrapping
   - group title/summary overflow
   - semantic change metadata overflow
   - status/hint blocks pushing controls off-screen

Expected risk to probe:
- UI breakage caused by long Japanese copy or dense metadata

### Charter 3: Review progress continuity

1. In workspace, switch groups and mark statuses (`unread` / `in_progress` / `reviewed`).
2. Reload page and reopen workspace.
3. Verify selected group and status persist.

Expected risk to probe:
- state loss across reload/reopen

### Charter 4: Reanalysis and retry behavior

1. Trigger manual reanalysis from workspace.
2. Observe queued/running/succeeded transitions.
3. If possible, simulate failure path and run retry action.
4. Verify status labels and timestamps remain coherent.

Expected risk to probe:
- inconsistent status timeline (requested/completed/error)

### Charter 5: Local demo-data operations

1. Run local demo-data reset/reseed manually:
   - remove `.locus-data`
   - recreate `.locus-data/review-sessions` and `.locus-data/analysis-jobs`
   - create `.locus-data/analysis-jobs/jobs.json` with `{ "jobs": [] }`
2. If your branch provides `npm run demo:data:*`, verify those commands as well.
3. Confirm the operations are safe and predictable.
4. Reopen seed demo and ensure workspace is regenerated.

Expected risk to probe:
- accidental destructive operation outside `.locus-data`

## Observation Log Template

Record findings in this format:

```text
Charter:
Timestamp:
Scenario:
Observed:
Expected:
Impact:
Repro Steps:
Screenshots/Logs:
Severity: MUST / SHOULD / NIT
```

## Exit Criteria

- No MUST issue remains unresolved.
- High-frequency SHOULD issues have concrete follow-up tickets.
- Reproduction steps exist for every accepted issue.
