# Production Baseline (Migration / Monitoring / Security)

> 日本語: [production-baseline.ja.md](production-baseline.ja.md)

Operations index: [README.md](README.md)

## Purpose

Define a practical baseline for Issue #75 to move prototype persistence and operations toward a safer production posture.

## Operator runbook set

Use this document together with:

- [DB Migration / Rollback Runbook](db-migration-rollback-runbook.md)
- [SLO Dashboard Baseline and Alert Taxonomy](slo-alert-taxonomy.md)
- [Incident Response Runbook](incident-response-runbook.md)

## Assumptions / Non-goals

Assumptions:
- Current runtime persists data mainly under `.locus-data` via file stores and one SQLite store.
- A managed relational database (for example PostgreSQL) is the likely production target.
- Centralized logs/metrics are available in production.

Non-goals:
- This document does not lock vendor choice, IaC details, or final SLO values.
- This is not a full compliance policy (SOC 2 / ISO 27001 evidence set).

## Current Persistence Baseline

| Domain | Current storage | Notes |
|---|---|---|
| Review sessions | `.locus-data/review-sessions/*.json` | File-per-review JSON records |
| Analysis jobs | `.locus-data/analysis-jobs/jobs.json` | File-backed queue + history |
| Connection states | `.locus-data/connection-state.sqlite` | SQLite is active source, with lazy read migration from legacy files |
| Legacy connection states | `.locus-data/connection-states/*.json` | Legacy source consumed on demand |
| OAuth pending states | `.locus-data/oauth/pending-states.json` | File-backed state store |
| Connection tokens | `.locus-data/connection-tokens/*.json` | Sensitive fields encrypted at rest (AES-256-GCM) |

## Phased DB Migration Plan (File/SQLite → Production DB)

### Phase 0: Inventory and backup freeze

1. Snapshot `.locus-data` (including SQLite file + WAL/SHM if present).
2. Capture row/file counts per domain.
3. Define rollback artifact location and restore operator.

Exit criteria:
- Backup restoration is tested once in a non-production environment.

### Phase 1: Target schema + adapters

1. Define production DB tables equivalent to current domain records.
2. Add repository adapters behind existing ports.
3. Keep legacy stores as source of truth while validating new writes in shadow mode.

Exit criteria:
- Schema migration scripts are idempotent.
- Write-path tests pass for both legacy and new adapters.

### Phase 2: Backfill and verification

1. Run idempotent import jobs from:
   - file stores (`review-sessions`, `analysis-jobs`, `oauth`, `connection-tokens`)
   - SQLite (`connection_states`, `connection_state_transitions`)
2. Record count parity and checksum/hash samples.
3. Re-run imports to confirm no duplicate side effects.

Exit criteria:
- Count mismatch = 0 (or explicitly explained and approved).

### Phase 3: Read shadowing

1. Read from production DB in shadow mode.
2. Compare against legacy read results and log mismatches.
3. Keep user-facing response sourced from legacy until mismatch trend is acceptable.

Exit criteria:
- Mismatch rate is below agreed threshold for a full release cycle.

### Phase 4: Controlled cutover

1. Enable production DB as primary read/write source behind feature flags.
2. Keep rollback path to legacy for a fixed window.
3. Freeze legacy writes after stability confirmation.

Exit criteria:
- No unresolved MUST incidents during the cutover window.

### Phase 5: Legacy decommission

1. Archive legacy files and SQLite snapshots.
2. Remove dormant legacy write paths.
3. Keep documented recovery procedure for archived snapshots.

Exit criteria:
- Recovery drill from archive completes successfully.

## Mandatory Monitoring / Audit Events

Minimum common fields for every event:
- `eventId`, `eventName`, `occurredAt` (ISO-8601 UTC)
- `environment`, `requestId` (if available)
- `actorType`, `actorId` (or `null`)
- `reviewId` / `provider` when relevant
- `outcome` (`success` / `failure`) and `errorCode` (if failure)

Required events:

| Event name | Trigger | Minimum payload additions |
|---|---|---|
| `analysis.job.scheduled` | Reanalysis job accepted | `jobId`, `reason`, `queuedAt` |
| `analysis.job.started` | Worker starts job | `jobId`, `attempt`, `startedAt` |
| `analysis.job.succeeded` | Job completes successfully | `jobId`, `durationMs`, `completedAt` |
| `analysis.job.failed` | Job run fails | `jobId`, `attempt`, `durationMs`, `errorCode` |
| `analysis.job.retry_queued` | Failed job is re-queued | `jobId`, `nextAttempt` |
| `analysis.job.stale_recovered` | Stale running job is recovered | `jobId`, `staleThresholdMs` |
| `review.reanalysis.requested` | Manual/API reanalysis request | `reviewId`, `requestedAt` |
| `review.reanalysis.completed` | Reanalysis result persisted | `reviewId`, `snapshotPairCount` |
| `review.reanalysis.failed` | Reanalysis terminal failure | `reviewId`, `errorCode` |
| `connection.state.changed` | Provider state transition persisted | `transitionId`, `provider`, `previousStatus`, `nextStatus`, `reason` |
| `oauth.state.issued` | OAuth pending state stored | `provider`, `reviewerId`, `expiresAt` |
| `oauth.state.consumed` | OAuth callback state consumed | `provider`, `reviewerId` |
| `webhook.signature.rejected` | Webhook signature validation fails | `provider`, `sourceIpHash` |
| `authz.denied` | Access denied by authorization rules | `resource`, `action` |

## Security Operations Checklist

### Pre-release

- [ ] `GITHUB_WEBHOOK_SECRET` is set via secret manager (never hardcoded).
- [ ] `LOCUS_CONNECTION_TOKEN_ENCRYPTION_KEYS` is set as an ordered key ring (first key encrypts, all keys decrypt) for safe key rotation.
- [ ] `LOCUS_CONNECTION_TOKEN_ENCRYPTION_KEY` is used only for backward compatibility and migration fallback.
- [ ] OAuth client credentials are not committed and have rotation owner/date.
- [ ] CI quality gate is green (`lint`, `typecheck`, `test`, `build`).

### Daily / Continuous

- [ ] Monitor analysis failure rate and retry loops.
- [ ] Monitor webhook signature rejection spikes.
- [ ] Monitor OAuth pending-state growth (unexpected accumulation).
- [ ] Verify audit-event ingestion is healthy (no prolonged gaps).

### Weekly / Monthly

- [ ] Test backup restore for production DB snapshots.
- [ ] Review least-privilege access for DB/logging/secrets.
- [ ] Run dependency and container/base-image security updates.
- [ ] Verify key/token rotation logs and unresolved exceptions.

### Incident minimum actions

- [ ] Revoke potentially leaked provider tokens.
- [ ] Rotate encryption key / webhook secret when compromise is suspected.
- [ ] Preserve relevant audit logs before cleanup.
- [ ] Document timeline, blast radius, and follow-up tasks.
