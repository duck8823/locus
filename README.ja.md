<div align="center">

# Locus

**「差分の確認」から、「変更の意味を理解するプロセス」へ。**

[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![license-ja](https://img.shields.io/badge/license-ja-lightgrey.svg)](LICENSE.ja.md)
[![Status](https://img.shields.io/badge/status-prototype-yellow.svg)]()
[![en](https://img.shields.io/badge/lang-en-blue.svg)](README.md)

</div>

---

## 問題

コードレビューが機能していません。レビュアーの能力の問題ではなく、ツールが不可能なタスクを課しているからです。

- **コンテキストが狭い** — 前後3行では「何が変わったか」はわかっても、「なぜ変えたか」「システムのどこで起きているか」がわかりません
- **ファイル単位の分断** — 複数ファイルにまたがる変更は文脈を失い、ファイル間の繋がりが見えなくなります
- **行ベースのノイズ** — インデント修正と本質的なロジック変更が、unified diffの上では区別できません
- **地図がない** — 大きなPRの中で、どこにいるか・どこまで見たか・何が残っているかを見失います

調査が示す現実として、400行を超えるPRはレビュー品質が指数的に劣化し、PRの平均待機時間は**4日**です。現在のAIレビューツールは、いくら宣伝が派手でも実態は「スマートなリンター」にとどまっています。変更行を孤立して解析するだけで、そのコードがシステム全体の中でどう機能するかを理解していません。

## Locusが違う理由

Locusはレビュアーに、あらゆる変更を**2つの視点から同時に**提供します。

### アーキテクチャマップ

システム全体の構成図を自動生成し、常に表示します。ひと目でわかります：

- この変更がどのレイヤーにあるか（コントローラ・サービス・リポジトリ・ドメイン…）
- このコードを呼び出しているユースケースはどれか
- 影響を受ける下流のエンドポイントはどれか

マップは静的解析とAI推論から自動生成されます。手作業でのメンテナンスは不要です。

### セマンティックDiff

行ベースのdiffではなく、**ASTベースの関数・メソッド単位の変更表示**を提供します：

```
変更前                             変更後
────────────────────────────────    ────────────────────────────────
UserService.updateProfile()         UserService.updateProfile()
  └─ メールアドレスのみ検証           └─ メールアドレスを検証
                                    └─ 電話番号フォーマットを検証  ← 追加
```

複数ファイルにまたがる関連変更は自動でグループ化されます。空白・リネーム・コメントのノイズは折りたたまれ、本質的な変更だけが前面に出ます。

### ビジネスロジックコンテキスト

コード変更を、その背景にある要件と繋げます。ConfluenceやGitHub Issues/Projectsと連携し、関連仕様をインラインで表示します。「このコードは動くか？」だけでなく「このコードは本来やるべきことをやっているか？」を問えるようになります。

### AIレビュー補助

システムアーキテクチャの全体像と、リンクされた仕様書の知識を持った上でフィードバックを生成します。汎用的なベストプラクティスの指摘ではなく、*あなたのコードベース*に固有のレビューコメントを提供します。

## 主な機能

| 機能 | 概要 | 状態 |
|---|---|---|
| アーキテクチャミニマップ v0 | 直近 upstream/downstream と change group 遷移を表示 | 🟡 Prototype |
| セマンティックDiff | ASTベースの関数・メソッド単位の変更可視化（TS/JS先行） | 🟡 Prototype |
| ビジネスロジックコンテキスト | GitHub Issueコンテキストのブリッジ + fallback diagnostics（Confluenceは計画中） | 🟡 Prototype |
| AIレビュー補助 | ワークスペース内提案パネル + ヒューリスティックProvider（LLM provider adapter は計画中） | 🟡 Prototype |
| Web review workspace v0 | Next.js 製レビューシェルとレイヤ境界、stub ナビゲーション | 🟡 Prototype |
| レビュー進捗トラッキング | 大きなPRで迷子にならない | 🟡 Prototype |
| プラガブル接続 | GitHub先行の契約境界 + Plugin SDK/runtime プロトタイプ | 🟡 Prototype |

## プラガブル設計

Locusは最初から拡張可能な設計で作られています：

- **コードホスト** — GitHub（初期実装）、GitLab、Bitbucket
- **コンテキストソース** — Confluence、GitHub Issues/Projects（初期実装）、Jira、Notion
- **AIモデル** — OpenAI、Anthropic Claude、ローカルモデル
- **言語パーサー** — 多言語対応を前提にした parser adapter 群

すべての外部連携はOAuth対応です。既存の認証基盤をそのまま使えます。

## プロジェクトの現状

現在のリポジトリには **コアレビュー導線を通しで実行できるプロトタイプ** があります。一方で、製品化と外部統合の強化はこれから進めます。

すでに動くもの:
- Next.js App Router の Web シェル
- `src/server/**` 配下のレイヤードサーバースケルトン
- 選択中の change group と進捗状態を保持できる file-backed demo review session
- 実際の PR ファイルを semantic analysis に流し込める GitHub pull request snapshot adapter
- provider-agnostic 境界の背後で動く GitLab merge request snapshot adapter（read-only）
- parser adapter 経由のセマンティック差分グルーピング（TS/JS先行）
- live GitHub Issue context + fallback diagnostics を持つ business-context bridge
- ヒューリスティック provider を使う AI提案パネルと採否保持
- 将来拡張向けの Plugin SDK/runtime プロトタイプ境界
- presentation / application 境界を通る route handler / server action

すでに決まっていること:
- プロダクト形態は **Web アプリ**
- 最初の実装ターゲットは **TypeScript + Next.js App Router**
- サーバー側実装は、ADR に明文化した Go に着想を得たレイヤードアーキテクチャに従う
- semantic analysis は **parser adapter + 共通 IR** の境界を必ずまたぐ

意図的にまだ固定していないこと:
- 解析言語ごとの長期的な parser family
- 本番品質での外部統合（Confluence/Jira、追加コードホスト）
- 本番運用向けの LLM provider 接続とガードレール
- MVP 検証に不要な本番インフラ詳細

### ローカル開発

前提: **Node.js 22.5+**（`node:sqlite` の利用に必要）
実行環境で実験的APIが無効化されている場合は、起動前に `NODE_OPTIONS=--experimental-sqlite` を設定してください。

```bash
npm install
npm run dev
```

GitHub webhook route もローカルで試す場合は、以下を設定してください。

```bash
export GITHUB_WEBHOOK_SECRET=your-local-webhook-secret
```

`/settings/connections` で実際の GitHub OAuth ハンドシェイクを試す場合は、以下を設定してください。

```bash
export GITHUB_OAUTH_CLIENT_ID=your-github-oauth-client-id
export GITHUB_OAUTH_CLIENT_SECRET=your-github-oauth-client-secret
export GITHUB_OAUTH_SCOPE="repo read:org"

# 任意（推奨）: 接続トークン暗号化キー
# 形式: base64:<32バイト鍵> または 64文字hex
export LOCUS_CONNECTION_TOKEN_ENCRYPTION_KEY=base64:...
```

`GITHUB_OAUTH_CLIENT_ID` を設定しない場合は、外部連携なしで状態遷移を検証できるようローカル demo OAuth fallback が使われます。

マーケティングページ上の GitHub / GitLab demo では、
GitHub は owner / repository / PR number、
GitLab は project path / merge request IID をフォームに直接入力できます。
以下の環境変数はフォーム既定値として使うための任意設定です。

```bash
export GITHUB_TOKEN=your-github-token
export LOCUS_GITHUB_DEMO_OWNER=owner
export LOCUS_GITHUB_DEMO_REPO=repository
export LOCUS_GITHUB_DEMO_PR_NUMBER=123
export LOCUS_GITLAB_DEMO_PROJECT_PATH=group/project
export LOCUS_GITLAB_DEMO_MERGE_REQUEST_IID=123

# 任意: 耐久 analysis queue のチューニング
export LOCUS_ANALYSIS_JOB_MAX_ATTEMPTS=3
export LOCUS_ANALYSIS_JOB_MAX_RETAINED_TERMINAL_JOBS=500
export LOCUS_ANALYSIS_JOB_STALE_RUNNING_MS=600000

# 任意: provider-agnostic code-host 境界で GitLab adapter を有効化
export LOCUS_ENABLE_GITLAB_ADAPTER=true
export LOCUS_GITLAB_API_BASE_URL=https://gitlab.com/api/v4
export GITLAB_TOKEN=your-gitlab-token

# 任意: plugin capability policy（最小権限）
# カンマ区切りキー、例: pull-request-snapshot-provider:github
export LOCUS_PLUGIN_CAPABILITY_ALLOWLIST=
export LOCUS_PLUGIN_CAPABILITY_DENYLIST=

# 任意: 接続遷移監査ログの保持件数
export LOCUS_CONNECTION_TRANSITION_MAX_RETAINED=200

# 任意: AI suggestion guardrail（heuristic provider 向け）
export LOCUS_AI_SUGGESTION_PROVIDER_HEURISTIC_TIMEOUT_MS=3000
export LOCUS_AI_SUGGESTION_PROVIDER_HEURISTIC_MAX_ESTIMATED_INPUT_TOKENS=12000
export LOCUS_AI_SUGGESTION_PROVIDER_HEURISTIC_MAX_ESTIMATED_INPUT_COST_USD=0.02
export LOCUS_AI_SUGGESTION_PROVIDER_HEURISTIC_ESTIMATED_INPUT_USD_PER_1K_TOKENS=0.0015

# 任意: LLM-backed AI suggestion provider を有効化（抽象化優先adapter）
export LOCUS_AI_SUGGESTION_PROVIDER=openai_compat
export LOCUS_AI_SUGGESTION_OPENAI_API_KEY=your-openai-key
export LOCUS_AI_SUGGESTION_OPENAI_MODEL=gpt-4o-mini
export LOCUS_AI_SUGGESTION_OPENAI_BASE_URL=https://api.openai.com/v1
export LOCUS_AI_SUGGESTION_PROMPT_VERSION=openai_compat.v1

# 任意: openai_compat provider 向けguardrail
export LOCUS_AI_SUGGESTION_PROVIDER_OPENAI_COMPAT_TIMEOUT_MS=3000
export LOCUS_AI_SUGGESTION_PROVIDER_OPENAI_COMPAT_MAX_ESTIMATED_INPUT_TOKENS=12000
export LOCUS_AI_SUGGESTION_PROVIDER_OPENAI_COMPAT_MAX_ESTIMATED_INPUT_COST_USD=0.02
export LOCUS_AI_SUGGESTION_PROVIDER_OPENAI_COMPAT_ESTIMATED_INPUT_USD_PER_1K_TOKENS=0.0015
```

`LOCUS_AI_SUGGESTION_PROVIDER=openai_compat` を設定していても `LOCUS_AI_SUGGESTION_OPENAI_API_KEY` が未設定なら、自動で heuristic provider にフォールバックします。

`GITHUB_TOKEN` は public repository なら必須ではありません（ただし匿名アクセスはレート制限が厳しいため、設定を推奨します）。
`GITLAB_TOKEN` も public GitLab repository では必須ではありませんが、private project や匿名レート制限回避のために設定を推奨します。

確認コマンド:

```bash
npm run lint
npm run security:sanity
npm run typecheck
npm test
npm run test:e2e
npm run build
```

デモデータ補助コマンド（ローカル完結・外部依存なし）:

```bash
npm run demo:data:status   # .locus-data の要約を表示
npm run demo:data:reset    # .locus-data を削除
npm run demo:data:reseed   # 基本ディレクトリと空のジョブキューを再作成
```

### まず読むもの

- [`docs/mvp.ja.md`](docs/mvp.ja.md) / [`docs/mvp.md`](docs/mvp.md)
- [`docs/adr/0001-prototype-first-mvp.ja.md`](docs/adr/0001-prototype-first-mvp.ja.md) / [`docs/adr/0001-prototype-first-mvp.md`](docs/adr/0001-prototype-first-mvp.md)
- [`docs/adr/0002-web-first-nextjs-typescript.ja.md`](docs/adr/0002-web-first-nextjs-typescript.ja.md) / [`docs/adr/0002-web-first-nextjs-typescript.md`](docs/adr/0002-web-first-nextjs-typescript.md)
- [`docs/adr/0003-layered-server-architecture.ja.md`](docs/adr/0003-layered-server-architecture.ja.md) / [`docs/adr/0003-layered-server-architecture.md`](docs/adr/0003-layered-server-architecture.md)
- [`docs/adr/0004-semantic-change-ir.ja.md`](docs/adr/0004-semantic-change-ir.ja.md) / [`docs/adr/0004-semantic-change-ir.md`](docs/adr/0004-semantic-change-ir.md)
- [`docs/architecture/web-application-blueprint.ja.md`](docs/architecture/web-application-blueprint.ja.md) / [`docs/architecture/web-application-blueprint.md`](docs/architecture/web-application-blueprint.md)
- [`docs/architecture/semantic-analysis-pipeline.ja.md`](docs/architecture/semantic-analysis-pipeline.ja.md) / [`docs/architecture/semantic-analysis-pipeline.md`](docs/architecture/semantic-analysis-pipeline.md)
- [`docs/architecture/connections-workspace-contract.ja.md`](docs/architecture/connections-workspace-contract.ja.md) / [`docs/architecture/connections-workspace-contract.md`](docs/architecture/connections-workspace-contract.md)
- [`docs/architecture/business-context-bridge.ja.md`](docs/architecture/business-context-bridge.ja.md) / [`docs/architecture/business-context-bridge.md`](docs/architecture/business-context-bridge.md)
- [`docs/architecture/context-arbitration-policy.ja.md`](docs/architecture/context-arbitration-policy.ja.md) / [`docs/architecture/context-arbitration-policy.md`](docs/architecture/context-arbitration-policy.md)
- [`docs/architecture/confluence-context-contract.ja.md`](docs/architecture/confluence-context-contract.ja.md) / [`docs/architecture/confluence-context-contract.md`](docs/architecture/confluence-context-contract.md)
- [`docs/architecture/jira-context-contract.ja.md`](docs/architecture/jira-context-contract.ja.md) / [`docs/architecture/jira-context-contract.md`](docs/architecture/jira-context-contract.md)
- [`docs/performance/analysis-benchmark-baseline.ja.md`](docs/performance/analysis-benchmark-baseline.ja.md) / [`docs/performance/analysis-benchmark-baseline.md`](docs/performance/analysis-benchmark-baseline.md)
- [`docs/performance/ai-suggestion-evaluation-format.ja.md`](docs/performance/ai-suggestion-evaluation-format.ja.md) / [`docs/performance/ai-suggestion-evaluation-format.md`](docs/performance/ai-suggestion-evaluation-format.md)
- [`docs/performance/ai-suggestion-quality-gate-policy.ja.md`](docs/performance/ai-suggestion-quality-gate-policy.ja.md) / [`docs/performance/ai-suggestion-quality-gate-policy.md`](docs/performance/ai-suggestion-quality-gate-policy.md)
- [`docs/testing/exploratory-test-playbook.ja.md`](docs/testing/exploratory-test-playbook.ja.md) / [`docs/testing/exploratory-test-playbook.md`](docs/testing/exploratory-test-playbook.md)
- [`docs/testing/exploratory-test-session-2026-03-11.ja.md`](docs/testing/exploratory-test-session-2026-03-11.ja.md) / [`docs/testing/exploratory-test-session-2026-03-11.md`](docs/testing/exploratory-test-session-2026-03-11.md)
- [`docs/operations/ai-review-workflow.ja.md`](docs/operations/ai-review-workflow.ja.md) / [`docs/operations/ai-review-workflow.md`](docs/operations/ai-review-workflow.md)
- [`docs/operations/ai-suggestion-audit-redaction-policy.ja.md`](docs/operations/ai-suggestion-audit-redaction-policy.ja.md) / [`docs/operations/ai-suggestion-audit-redaction-policy.md`](docs/operations/ai-suggestion-audit-redaction-policy.md)
- [`docs/operations/db-migration-rollback-runbook.ja.md`](docs/operations/db-migration-rollback-runbook.ja.md) / [`docs/operations/db-migration-rollback-runbook.md`](docs/operations/db-migration-rollback-runbook.md)
- [`docs/operations/slo-alert-taxonomy.ja.md`](docs/operations/slo-alert-taxonomy.ja.md) / [`docs/operations/slo-alert-taxonomy.md`](docs/operations/slo-alert-taxonomy.md)
- [`docs/operations/security-review-checklist.ja.md`](docs/operations/security-review-checklist.ja.md) / [`docs/operations/security-review-checklist.md`](docs/operations/security-review-checklist.md)
- [`CONTRIBUTING.ja.md`](CONTRIBUTING.ja.md) / [`CONTRIBUTING.md`](CONTRIBUTING.md)

## ロードマップ

### MVP（プロトタイプトラック）
- ✅ GitHub ingestion + review workspace フロー
- ✅ セマンティック差分グルーピング（TS/JS先行）
- ✅ アーキテクチャミニマップ v0
- ✅ レビュー進捗の永続化

### Phase 2（製品化・統合）
- ⏳ Confluence など要件コンテキスト統合の拡張
- ⏳ LLM provider adapter を使った AIレビュー補助の接続
- ⏳ live context / analysis 運用の信頼性強化

### Phase 3（エコシステム・運用スケール）
- ⏳ 追加コードホストアダプタ（GitLab / Bitbucket）
- ⏳ Plugin エコシステムのハードニング
- ⏳ 本番移行ハードニング（migration、SLO、セキュリティ運用）

## コントリビュート

Locusは現在、プロトタイプフェーズにあります。フィードバック・アイデア・議論を歓迎します。

- [Issue](https://github.com/duck8823/locus/issues) を開いてアイデアや問題を共有してください
- コントリビューションガイドは [CONTRIBUTING.ja.md](CONTRIBUTING.ja.md) を参照（英語版: [CONTRIBUTING.md](CONTRIBUTING.md)）

## ライセンス

MIT License — 正本は [LICENSE](LICENSE) を参照してください。日本語参考訳は [LICENSE.ja.md](LICENSE.ja.md) です。
