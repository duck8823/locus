## Summary / 概要

<!-- What changed? 何を変更したか -->

## Motivation (What this achieves) / モチベーション（これで何を達成できるか）

<!-- Why now? Why this approach? なぜ今/なぜこの方針か -->

## Scope / スコープ

- In scope / 対象:
- Out of scope / 非対象:

## Validation / 検証

- [ ] `npm run lint`
- [ ] `npm run typecheck`
- [ ] `npm test`
- [ ] (If needed / 必要時) `npm run test:e2e`

## AI Review Loop / AIレビューループ

- [ ] Gemini first-pass done (or blocked reason recorded)
- [ ] Codex review done (or blocked reason recorded)

## Security Review (Required for integration-impacting PRs) / セキュリティレビュー（連携影響PRは必須）

Mark one:

- [ ] No OAuth/token/data-handling impact in this PR.
- [ ] OAuth/token/data-handling impact exists and all checks below are completed.

If impact exists, complete all:

- [ ] AuthN/AuthZ boundary checks reviewed (scope least-privilege + explicit server-side authorization)
- [ ] Token lifecycle checks reviewed (no plaintext persistence, rotation/revocation preserved, no token in logs/errors)
- [ ] Data exposure checks reviewed (redaction applied to payload/log/artifacts)
- [ ] Failure-mode checks reviewed (fallback/retry/timeout do not bypass auth or duplicate privileged effects)
- [ ] Severity assessed (Critical / Major / Minor) and blockers tracked
- [ ] Security sign-off reviewer: `@<github-id>`

Reference:

- [Security Review Checklist](/docs/operations/security-review-checklist.md)
- [セキュリティレビュー・チェックリスト](/docs/operations/security-review-checklist.ja.md)
