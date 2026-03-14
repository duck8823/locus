# Incident Response Runbook: Context / Reanalysis Reliability

> 日本語: [incident-response-runbook.ja.md](incident-response-runbook.ja.md)

## Purpose

Provide a deterministic on-call flow for incidents related to:
- live business-context fetch failures
- reanalysis queue degradation and repeated job failures

This runbook is scoped to local/file-backed MVP operations and internal dogfooding.

## Quick triage (first 5 minutes)

1. Confirm scope:
   - single review or multiple reviews
   - context panel only, queue only, or both
2. Capture evidence:
   - recent server logs around incident time
   - impacted `reviewId`, `jobId`, and `reasonCode`
3. Classify failure from diagnostics/logs:
   - `timeout`, `network`, `rate_limit`, `auth`, `not_found`, `upstream_5xx`, `client_error`, `unknown`
4. Apply matching mitigation from the matrix below.
5. Re-run smoke checks before closing incident.

## Reason-code matrix (source of truth)

| reasonCode | Retryable | Typical symptom | Primary action |
|---|---:|---|---|
| `timeout` | Yes | intermittent API timeout / aborted request | retry flow, verify upstream latency/network |
| `network` | Yes | DNS/connectivity/reset failures | verify DNS/network path, retry after recovery |
| `rate_limit` | Yes | 429 / throttling bursts | back off, reduce concurrent triggers, retry |
| `upstream_5xx` | Yes | provider 5xx responses | monitor upstream status, retry with backoff |
| `auth` | No | 401/403 or missing scope | re-auth/refresh token, verify scopes |
| `not_found` | No | 404 missing issue/PR | verify reference validity, relink source |
| `client_error` | No | non-auth 4xx contract failure | fix request/source contract, do not blind-retry |
| `unknown` | No | unclassified error | treat as terminal until classified; escalate with logs |

## Playbook A: Business-context fallback incidents

### Symptoms
- Workspace business context switches to fallback mode.
- Log event `business_context_fallback` appears with `reasonCode`.

### Diagnostics
1. Open affected workspace and capture:
   - `businessContext.diagnostics.retryable`
   - `businessContext.diagnostics.reasonCode`
   - `businessContext.diagnostics.fallbackReason`
2. Inspect logs for:
   - `business_context_fallback`
   - `Live business-context fetch failed`
3. Confirm OAuth scope/token state if `reasonCode=auth`.

### Mitigation
- `timeout` / `network` / `rate_limit` / `upstream_5xx`:
  - keep retries enabled, avoid immediate manual invalidation, verify upstream/network health
- `auth`:
  - reconnect GitHub OAuth and ensure issue-read scope (`repo` or equivalent) is granted
- `not_found`:
  - verify issue reference in PR context and fix broken links
- `client_error` / `unknown`:
  - stop blind retries, capture failing payload/error, escalate with diagnostics

### Rollback / containment
- Keep fallback provider active (do not block workspace loading).
- If new rollout changed behavior, revert to previous release and re-verify fallback behavior.

## Playbook B: Reanalysis queue degradation incidents

### Symptoms
- Queue health status becomes `degraded`.
- Logs emit `analysis_queue_health_degraded`, `analysis_job_retry_scheduled`, or `analysis_job_failed`.

### Diagnostics
1. Inspect latest queue signals:
   - queued/running/stale/failed counts
   - latest failed job metadata
2. Inspect logs for terminal failures:
   - `analysis_job_failed` with `reasonCode`
3. Confirm whether failures are transient (`retryable=true`) or terminal.

### Mitigation
- Transient (`timeout`/`network`/`rate_limit`/`upstream_5xx`):
  - allow bounded retries, reduce trigger storms, re-check upstream health
- Terminal (`auth`/`not_found`/`client_error`/`unknown`):
  - fix root cause first; retries are intentionally suppressed
  - for `auth`, recover provider token/scope before re-queue
  - for `not_found`, validate PR/issue references before re-queue

### Rollback / containment
- If queue degradation began after deployment, roll back to previous release.
- Preserve queue file state and logs before manual cleanup.

## Smoke validation checklist (post-mitigation)

Run in repository root:

```bash
npm run lint
npm run typecheck
npm run test
PLAYWRIGHT_PORT=3000 npm run test:e2e
```

Then verify:
- workspace opens without crash
- context fallback diagnostics are coherent (`retryable` + `reasonCode`)
- analysis queue transitions back to healthy for the impacted review(s)

## Incident closeout template

- Incident window (UTC):
- Blast radius (review count / users):
- Primary reasonCode(s):
- Mitigation applied:
- Rollback executed (yes/no):
- Follow-up issues:
