# Locus 開発者向け AI 指示

Rust + Slint で macOS native PR review tool を作っている OSS プロジェクト。
Web SaaS 時代 (Next.js) からの転換が完了済み (ADR 0005)。

## ストレージ管理

`target/` は放置すると 10GB 超まで膨らむ (Slint コード生成 / 厚い依存ツリー / incremental compilation の旧 session 残留)。

ユーザーから「ストレージを圧迫している」「不要ファイル削除して」等の依頼があれば、以下を **確認後** 実行する:

1. `du -sh * .* 2>/dev/null | sort -hr | head -10` で実態確認
2. **無確認で削除して良いもの** (`.gitignore` に明記された Next.js-era leftover):
   - `node_modules/` `.next/` `.locus-data/` `playwright-report/` `test-results/` `*.tsbuildinfo`
3. **ユーザー確認を取ってから削除**: `target/` (cargo clean、フルリビルドが必要になる)
4. `.git/` には触れない

定期掃除として `cargo sweep -t 30` (30 日以上前の artifact) も提案可。

## AI レビュー設定 (`/review-and-merge` で使用)

- `source_dirs`: `src/ ui/`
- `source_extensions`: `rs slint`
- `source_exclude`: `target/ Cargo.lock lang/*/LC_MESSAGES/*.po`
- `test_command`: `cargo test`
- `analyze_command`: `cargo clippy --all-targets -- -D warnings`

## i18n の注意

- 翻訳源は `src/i18n.rs::translate_ja` (Rust 側) と Slint `@tr` の bundled translations
- `lang/ja/LC_MESSAGES/locus.po` だけに追加しても **Rust 側コードからは効かない**。`translate_ja` テーブルにも同キーを必ず登録する
- `lang/en/LC_MESSAGES/` は実体なし。英語はソース文字列がそのまま表示される

## 開発フロー

- v0.0.x patch sprint 進行中 (issue は milestone "v0.1: core review loop")
- PR は draft → multi-AI review (Codex verifier + Gemini scout) → Claude final → merge
- コミットメッセージは日本語、レビュー指摘起因の表現 (「レビュー対応」等) は使わず「何を・なぜ」で書く
- `Co-Authored-By: Claude` 等のトレーラーを付ける
