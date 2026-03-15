# Security Review Checklist (OAuth / Token / Data Handling)

> 日本語: [security-review-checklist.ja.md](security-review-checklist.ja.md)

## Purpose

Define a consistent review gate for pull requests that touch authentication, authorization, token handling, or data exposure boundaries.

Use this checklist when a PR changes any of:

- OAuth callback, token exchange, token persistence, or token revocation logic
- credential loading/encryption/storage paths
- third-party API integration boundaries that carry user or repository data
- logs/metrics/error payloads that may include sensitive fields

## Required checklist (for integration-impacting PRs)

For PRs with OAuth/token/data-handling impact, complete all checks below in the PR description:

1. **AuthN/AuthZ boundary review**
   - scopes/permissions are least-privilege
   - server-side authorization checks are explicit for each boundary crossing
2. **Token lifecycle review**
   - no plain-text token persistence
   - rotation/revocation paths are preserved
   - logs and error payloads do not expose token values
3. **Data exposure review**
   - request/response payloads are redacted where needed
   - analytics/audit artifacts do not leak secrets or personal data
4. **Failure-mode review**
   - fallback/error handling does not bypass auth gates
   - retries/timeouts do not duplicate privileged side effects
5. **Sign-off**
   - a named reviewer signs off the security section before merge

## Severity classification

Classify security findings with the following default levels:

| Severity | Meaning | Default handling |
| --- | --- | --- |
| Critical | credential exposure, auth bypass, privilege escalation, remote exploit path | block merge, immediate fix required |
| Major | incorrect scope gate, sensitive data over-disclosure risk, unsafe fallback with realistic abuse path | block merge unless explicitly waived with owner approval |
| Minor | hardening gap with low immediate exploitability | can merge with tracked follow-up issue |

If a finding is waived, record:

- rationale
- owner
- tracking issue/PR
- expected remediation date

## Automation sanity checks

Run `npm run security:sanity` locally and in CI. Current automated checks are:

- tracked `.env*` files are blocked except `.env.example` / `.env.sample` / `.env.template`
- known high-risk token patterns (GitHub PAT, OpenAI key-like, AWS access key-like, Slack token-like) are scanned in tracked text files

These checks are a baseline safety net and do **not** replace manual review.

