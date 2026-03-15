# SLO Dashboard Baseline and Alert Taxonomy

> 日本語: [slo-alert-taxonomy.ja.md](slo-alert-taxonomy.ja.md)

Operations index: [README.md](README.md)

## Purpose

Define the minimum SLO dashboard and alert taxonomy needed to operate Locus safely during production rollout.

This document focuses on operational signals that already exist or are explicitly planned in current architecture/runbooks.

## Service level indicators (SLI) baseline

| SLI | Target scope | Measurement source | Notes |
| --- | --- | --- | --- |
| Workspace load success rate | review workspace API/read path | API success/error logs + synthetic smoke | excludes client-side rendering glitches |
| Reanalysis completion rate | analysis queue job lifecycle | `analysis.job.*` events | split retryable vs terminal failures |
| Reanalysis p95 duration | end-to-end job completion latency | queue lifecycle events | watch for sustained degradation trend |
| Business-context live fetch success rate | live issue-context fetch path | `business_context_fallback` and fetch success logs | fallback use should be observable |
| OAuth callback success rate | OAuth pending-state consume flow | oauth issue/consume events + callback errors | detect scope/auth regressions early |

## Initial SLO targets (baseline defaults)

These defaults are conservative and should be revised with production data:

- Workspace load success rate: **>= 99.0%** (rolling 30 days)
- Reanalysis completion rate: **>= 97.0%** (rolling 30 days)
- Reanalysis p95 duration: **<= 120s** (rolling 7 days)
- Business-context live fetch success rate: **>= 95.0%** (rolling 30 days)
- OAuth callback success rate: **>= 99.5%** (rolling 30 days)

## Alert taxonomy

Severity mapping:
- **P1**: major user-impacting outage or data integrity risk
- **P2**: partial degradation with sustained user impact
- **P3**: non-critical anomaly requiring follow-up

| Alert key | Severity | Trigger baseline | Expected action |
| --- | --- | --- | --- |
| `workspace-load-success-drop` | P1 | success rate < 95% for 10m | incident start + rollback decision check |
| `reanalysis-terminal-failure-spike` | P1 | terminal failure rate > 10% for 15m | pause trigger storms, root-cause triage |
| `reanalysis-p95-latency-degraded` | P2 | p95 > 180s for 30m | capacity/queue diagnosis, mitigation |
| `business-context-fallback-spike` | P2 | fallback ratio > 20% for 15m | upstream/network/auth diagnosis |
| `oauth-callback-failure-spike` | P1 | callback failure rate > 5% for 10m | auth flow incident response |
| `webhook-signature-rejection-spike` | P2 | rejection count > baseline × 3 for 10m | secret/config/security check |
| `audit-ingestion-gap` | P2 | no critical audit events for > 15m | telemetry pipeline recovery |
| `queue-stale-job-growth` | P3 | stale running jobs increase for 30m | worker health check + cleanup plan |

For `audit-ingestion-gap`, prioritize this triage order:
1. application log emitter health (no process crash/restart loop)
2. log shipper/collector health between app and storage
3. destination ingestion endpoint availability and auth status

## Dashboard minimum panels

Create at least these panels:

1. Workspace load success/error rate (5m/1h)
2. Reanalysis queue:
   - queued/running/stale/failed counts
   - completion + terminal failure rates
   - p50/p95 duration
3. Business-context live fetch success vs fallback rate
4. OAuth callback success/failure + top reason codes
5. Webhook signature rejection count
6. Audit-event ingestion heartbeat

## On-call linkage

When alerts fire:

- follow [incident-response-runbook.md](incident-response-runbook.md)
- use reason-code matrix for transient vs terminal classification
- record timeline + blast radius + follow-up issue in incident closeout

## Review cadence

- Weekly: check noisy/low-signal alerts and adjust thresholds
- Monthly: review SLO targets against real usage and update this document
- Release gate: confirm dashboard + alert wiring before production cutover
