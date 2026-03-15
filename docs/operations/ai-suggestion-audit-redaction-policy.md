# AI Suggestion Audit + Redaction Policy

> 日本語: [ai-suggestion-audit-redaction-policy.ja.md](ai-suggestion-audit-redaction-policy.ja.md)

## Purpose

Define how Locus records prompt metadata for AI suggestions and how sensitive fields are redacted in logs/artifacts.

## Audit metadata contract

Each AI suggestion generation returns audit metadata in the workspace DTO (`aiSuggestionAudit`):

- `requestedMode`: requested provider mode from env (`heuristic` / `openai_compat`)
- `provider`: actual provider used for generation
- `fallbackProvider`: deterministic fallback provider
- `promptTemplateId`: stable template identifier
- `promptVersion`: resolved prompt version
- `generatedAt`: payload generation timestamp
- `redactionPolicyVersion`: active payload redaction policy version

This enables suggestion outputs to be traced to prompt-template/version decisions without storing raw sensitive payload text.

## Redaction policy (v1)

Policy version: `ai_suggestion_redaction.v1`

Redact free-text fields in:
- review title / branch label
- semantic symbol display / signature / summaries / locations
- architecture labels and group/file path labels
- business context title / summary / href
- AI suggestion headline / recommendation / rationale (for logs/artifacts)

Keep non-sensitive structural fields:
- IDs, enum values, counts, status/confidence levels
- repository name (for routing/diagnostics)

## Enforcement points

- Runtime error logs (`ai_suggestion_provider_failed`) include:
  - audit metadata
  - redacted payload snapshot
- Fixture evaluation artifacts include:
  - audit block
  - redacted payload snapshots

## Non-goals

- Encrypting all runtime telemetry in this policy document
- Replacing data-retention or access-control policy
