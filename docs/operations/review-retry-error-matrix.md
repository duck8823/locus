# Review Retry Error Matrix (H1-3)

> 日本語: [review-retry-error-matrix.ja.md](review-retry-error-matrix.ja.md)

## Purpose

Define a single mapping between retry-related error codes and user-facing recovery guidance.

## Workspace action redirect codes

| Query code | Trigger | User guidance |
|---|---|---|
| `workspace_not_found` | Review session does not exist | Reopen workspace from home |
| `source_unavailable` | Reanalysis source cannot be resolved | Reconnect GitHub OAuth and retry |
| `action_failed` | Unexpected action failure | Reload page and retry |

## Review API response codes

| API endpoint | Error code | Meaning | Expected UI action |
|---|---|---|---|
| `POST /api/reviews/[reviewId]/reanalyze` | `REVIEW_SESSION_NOT_FOUND` | review missing | show not-found guidance |
| `POST /api/reviews/[reviewId]/reanalyze` | `INVALID_REANALYZE_REQUEST` | malformed payload or invalid source state | show retry + diagnostics |
| `POST /api/reviews/[reviewId]/progress` | `REVIEW_GROUP_NOT_FOUND` | selected group missing | reload latest state |
| `GET /api/reviews/[reviewId]/analysis-status` | `REVIEW_SESSION_NOT_FOUND` | polling target missing | stop polling and reopen |

## OAuth callback/start codes (connections workspace)

| Query code | Meaning | User action |
|---|---|---|
| `oauth_provider_rejected` | provider denied authorization | retry OAuth and re-consent |
| `oauth_callback_invalid` | callback params invalid | restart OAuth from settings |
| `oauth_callback_retryable` | temporary exchange failure | retry shortly |
| `oauth_callback_failed` | terminal exchange failure | inspect logs / credentials |
| `oauth_start_failed` | start flow failed | verify env + retry |

## Operational note

- Keep these mappings additive.
- Unknown codes should fall back to a generic retry message and diagnostics logging.
