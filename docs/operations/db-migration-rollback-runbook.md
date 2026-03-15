# DB Migration / Rollback Runbook (Prototype data store → Production DB)

> 日本語: [db-migration-rollback-runbook.ja.md](db-migration-rollback-runbook.ja.md)

Operations index: [README.md](README.md)

## Purpose

Define an executable operator runbook for moving Locus persistence from local prototype stores (`.locus-data` + SQLite) to a production relational database, with deterministic rollback.

This runbook refines the migration phases in [production-baseline.md](production-baseline.md).

## Scope

In scope:
- review sessions
- analysis jobs
- connection state / transitions
- OAuth pending states
- encrypted connection token records

Out of scope:
- vendor-specific provisioning details (managed Postgres flavor, IaC)
- application schema design decisions not yet approved in ADRs

## Roles and ownership

| Role | Responsibility |
| --- | --- |
| Migration Commander | overall timeline, go/no-go decision |
| Data Operator | snapshot, backfill, verification execution |
| App Operator | feature-flag rollout and cutover |
| Incident Scribe | timeline + evidence capture |

## Prerequisites

- [ ] CI is green on the target commit.
- [ ] On-call channel and escalation contacts are announced.
- [ ] Feature flags for DB read/write cutover are prepared.
- [ ] Snapshot destination and retention window are agreed.

## Runbook

### Step 0 — Snapshot and freeze

1. Stop write-heavy maintenance actions (large batch reanalysis).
2. Snapshot `.locus-data` including:
   - `connection-state.sqlite`
   - `connection-state.sqlite-wal` (if present)
   - `connection-state.sqlite-shm` (if present)
3. Record snapshot checksum + location.

Evidence to keep:
- snapshot filename/checksum
- operator + UTC timestamp

### Step 1 — Schema migration (idempotent)

1. Run production DB migration script.
2. Re-run migration script to confirm idempotency.
3. Record migration version and status.

Go criteria:
- migration exits successfully twice
- schema version is expected

### Step 2 — Backfill import (idempotent)

1. Import from file stores:
   - `.locus-data/review-sessions/*.json`
   - `.locus-data/analysis-jobs/jobs.json`
   - `.locus-data/oauth/pending-states.json`
   - `.locus-data/connection-tokens/*.json`
2. Import from SQLite:
   - `connection_states`
   - `connection_state_transitions`
3. Re-run import once to verify no duplicate side effects.

Go criteria:
- second run introduces no unexpected delta

### Step 3 — Verification

1. Count parity checks by domain.
2. Sample hash/checksum parity for record payloads.
3. Verify encrypted token fields are still encrypted at rest.
4. Log mismatch report (must be empty or approved waiver).

Go criteria:
- count mismatch = 0, or waiver signed by Migration Commander

### Step 4 — Read shadowing

1. Enable DB read-shadow mode.
2. Compare DB vs legacy read results for one release cycle.
3. Track mismatch ratio and error reasons.

Go criteria:
- mismatch ratio below agreed threshold for the cycle

### Step 5 — Controlled cutover

1. Enable production DB primary read/write behind feature flags.
2. Keep legacy rollback path active during observation window.
3. Monitor alerts in [slo-alert-taxonomy.md](slo-alert-taxonomy.md).

Go criteria:
- no unresolved MUST incidents during observation window

### Step 6 — Legacy decommission

1. Archive legacy snapshot artifacts.
2. Disable/remove dormant legacy write paths.
3. Keep restoration drill instructions available (this runbook “Rollback runbook” section + [production-baseline.md](production-baseline.md) Phase 5).

## Rollback runbook (any phase after Step 4)

Trigger examples:
- sustained mismatch growth beyond threshold
- auth/token integrity regression
- data loss or corruption indicator

Rollback procedure:
1. Freeze new writes to production DB path.
2. Flip feature flags to legacy primary read/write.
3. Verify workspace load, reanalysis, OAuth flow on legacy path.
4. Preserve production DB evidence (logs, failed rows, mismatches).
5. Open incident record and follow [incident-response-runbook.md](incident-response-runbook.md).

Exit criteria:
- user-facing flow stable on legacy path
- rollback reason + follow-up owner documented

## Operator checklist template

Copy this section into the migration ticket:

- [ ] Step 0 snapshot completed (artifact + checksum recorded)
- [ ] Step 1 schema migration idempotency confirmed
- [ ] Step 2 backfill idempotency confirmed
- [ ] Step 3 verification mismatch report attached
- [ ] Step 4 read-shadow metrics captured
- [ ] Step 5 cutover completed (or aborted with reason)
- [ ] Rollback status documented (not required if no rollback)
- [ ] Incident/follow-up issues linked
