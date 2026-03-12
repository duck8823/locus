# レビュー再試行エラーマトリクス (H1-3)

> English: [review-retry-error-matrix.md](review-retry-error-matrix.md)

## 目的

再試行系エラーコードと、ユーザーに提示する復帰導線を一箇所で定義する。

## ワークスペース action リダイレクトコード

| Query code | 発生条件 | ユーザー案内 |
|---|---|---|
| `workspace_not_found` | レビューセッションが存在しない | ホームから開き直す |
| `source_unavailable` | 再解析ソースを解決できない | GitHub OAuth再接続後に再試行 |
| `action_failed` | 想定外の action 失敗 | ページ再読み込み後に再試行 |

## Review API レスポンスコード

| API endpoint | Error code | 意味 | 想定UI挙動 |
|---|---|---|---|
| `POST /api/reviews/[reviewId]/reanalyze` | `REVIEW_SESSION_NOT_FOUND` | レビュー不存在 | not-found 案内表示 |
| `POST /api/reviews/[reviewId]/reanalyze` | `INVALID_REANALYZE_REQUEST` | payload不正 or ソース状態不正 | 再試行導線 + 診断情報 |
| `POST /api/reviews/[reviewId]/progress` | `REVIEW_GROUP_NOT_FOUND` | グループ不存在 | 最新状態を再読込 |
| `GET /api/reviews/[reviewId]/analysis-status` | `REVIEW_SESSION_NOT_FOUND` | poll対象不存在 | poll停止して開き直し |

## OAuth callback/start コード（接続設定画面）

| Query code | 意味 | ユーザー操作 |
|---|---|---|
| `oauth_provider_rejected` | provider 側で認可拒否 | OAuth を再実行して再同意 |
| `oauth_callback_invalid` | callback パラメータ不正 | 設定画面から OAuth 再開始 |
| `oauth_callback_retryable` | 一時的交換失敗 | 少し待って再試行 |
| `oauth_callback_failed` | 交換失敗（終端） | ログ/認証情報を確認 |
| `oauth_start_failed` | 開始処理失敗 | 環境変数確認後に再試行 |

## 運用メモ

- マッピングは加法的に拡張する。
- 未知コードは汎用再試行メッセージにフォールバックし、診断ログを残す。
