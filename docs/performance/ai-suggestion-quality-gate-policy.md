# AI Suggestion Quality Gate Policy

> 日本語: [ai-suggestion-quality-gate-policy.ja.md](ai-suggestion-quality-gate-policy.ja.md)

## Purpose

Define a stable fixture-maintenance workflow for Issue #138 so CI quality-gate changes remain auditable and intentional.

## Scope

Applies to:
- `scripts/fixtures/ai-suggestion-evaluation/*.json`
- `scripts/export-ai-suggestion-evaluation-artifacts.mjs`
- `docs/performance/ai-suggestion-evaluation-format*.md`

## Update rules

1. **One issue, one PR**
   - Fixture updates, threshold updates, and harness logic changes must each be traceable in PR motivation.
2. **Why now (motivation) is mandatory**
   - PR description must explain what quality risk is reduced or what signal is newly captured.
3. **Do not silently loosen gates**
   - Lowering `min-useful-rate-percent` or raising `max-false-positive-rate-percent` requires explicit justification and reviewer sign-off.
4. **Regression evidence is required**
   - Include before/after summary metrics and fixture-level deltas in PR notes.
5. **EN/JA parity**
   - If fixture semantics or thresholds change, update both English and Japanese docs in the same PR.

## PR checklist for fixture/threshold changes

- [ ] Motivation explains user or quality impact.
- [ ] `npm run ai:suggest:evaluate:artifact` output (summary + fixture table) is attached in PR comment/description.
- [ ] Changed fixtures include expectedUseful/expectedFalsePositive rationale.
- [ ] Threshold changes include rationale and reviewer acknowledgment.
- [ ] Related docs are updated in both EN and JA.

## Non-goals

- Cross-repository benchmark ranking
- Replacing human qualitative review with a single scalar metric
