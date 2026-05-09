<div align="center">

# Locus

**「差分の確認」から、「変更の意味を理解するプロセス」へ。**

[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![license-ja](https://img.shields.io/badge/license-ja-lightgrey.svg)](LICENSE.ja.md)
[![Status](https://img.shields.io/badge/status-beta_v0.0.x-yellow.svg)]()
[![en](https://img.shields.io/badge/lang-en-blue.svg)](README.md)

</div>

---

## ステータス: beta (v0.0.x patch sprint)

Locus は macOS 向け **ローカルネイティブ** PR review ツールです (Rust + Slint)。GitHub PR の diff viewer に、AI agent CLI (Claude Code / Codex / Gemini) を動かす terminal pane を同居させた構成で動きます。現在は v0.0.x の patch sprint で、`v0.1: core review loop` マイルストーンに向けて安定化中です。

![locus diff viewer](docs/screenshots/diff-viewer.png)

左に diff pane、下に agent CLI を抱えた terminal pane、右に下書き / 履歴のサイドパネル。引数なしの `cargo run` では terminal pane のみで起動します:

![locus terminal pane](docs/screenshots/terminal-pane.png)

旧 Next.js 版は [`legacy/nextjs`](https://github.com/duck8823/locus/tree/legacy/nextjs) ブランチに保全されています。

## クイックスタート

要件: Rust 1.85+ (`edition = "2024"`), macOS。

```sh
# clone & build
git clone https://github.com/duck8823/locus.git
cd locus
cargo build --release

# Terminal pane のみ (既定 agent: claude)
cargo run --release

# 別 CLI で terminal pane を起動
cargo run --release -- bash
LOCUS_AGENT_CMD=codex cargo run --release

# GitHub PR の diff viewer
cargo run --release -- github duck8823/locus#236
```

`LOCUS_AGENT_CMD` が PATH に存在しない実行ファイルを指している場合、locus はクラッシュせず赤バナーを表示し送信ボタンを無効化します。

GitHub アクセス用 token は次の優先順位で解決されます:

1. `GITHUB_TOKEN`
2. `GH_TOKEN`
3. `gh auth token --hostname github.com` (`LOCUS_NO_GH_AUTH=1` で無効化)
4. unauthenticated (rate limit が厳しい)

## 環境変数

| 変数 | 既定 | 用途 |
|---|---|---|
| `LOCUS_LOCALE` | system / `LANG` | `ja` / `en`。未設定時は `LANG` を見て、未対応値や未設定時は `ja` にフォールバック。 |
| `LOCUS_AGENT_CMD` | `claude` | 内蔵 terminal pane で起動するコマンド。 |
| `LOCUS_FONT_FAMILY` | OS 別 (macOS: `Menlo, Hiragino Sans, Apple Symbols, Apple Color Emoji, Consolas, monospace`) | diff / chrome 側のフォントファミリ。`LOCUS_TERMINAL_FONT_FAMILY` が未設定の場合は terminal にも適用される。 |
| `LOCUS_TERMINAL_FONT_FAMILY` | OS 別 (macOS: `SF Mono, Menlo, Monaco, Osaka-Mono, Hiragino Sans, Apple Symbols, Apple Color Emoji, monospace`) | terminal grid 専用のフォント fallback。等幅候補を優先し、terminal glyph や cell metrics が崩れる場合の切り分けに使う。 |
| `LOCUS_FONT_SIZE` | (未設定) | terminal/diff 両方のフォントサイズを一括指定。 |
| `LOCUS_TERMINAL_FONT_SIZE` | `13.0` | terminal pane のフォントサイズ (logical px)。 |
| `LOCUS_TERMINAL_CELL_W` / `LOCUS_TERMINAL_CELL_H` | Slint font probe / 比率 fallback | terminal cell の幅/高さを logical px で手動上書きする。glyph と cell metric のズレを診断・強制同期する場合に使う。 |
| `LOCUS_DIFF_FONT_SIZE` | `12.0` | diff pane のフォントサイズ (logical px)。 |
| `LOCUS_BRACKETED_PASTE` | `true` | `false`/`0`/`off`/`no` で paste 境界 sequence (`\x1b[200~ ... \x1b[201~`) を使わずに raw 送信。 |
| `LOCUS_PROMPT_MAX_CHARS` | `32000` | preview 文字数上限。超過時は警告 + override チェックボックス。 |
| `GITHUB_TOKEN` / `GH_TOKEN` | (未設定) | GitHub PAT。 |
| `LOCUS_NO_GH_AUTH` | `false` | `gh auth token` フォールバックを無効化。 |
| `GH_AUTH_TIMEOUT` | `3` | `gh auth token` サブプロセスの timeout 秒数。 |
| `LOCUS_LOG` | `warn` | tracing フィルタ (`error` / `warn` / `info` / `debug` / `trace`)。 |

## キーバインド

v0.0.2 で実装済み (フル設計は v0.1.0):

| キー | 動作 |
|---|---|
| Esc | 現在の選択を解除 |
| Cmd/Ctrl + Enter | preview を terminal に Insert + Send |
| Cmd/Ctrl + C | preview を clipboard にコピー |

送信系ショートカットは preview-size 制限を尊重し、`LOCUS_PROMPT_MAX_CHARS` を超えると override チェックを入れない限り無効化されます。

## 設計上の重要シフト: アプリ内に LLM を持たない

Locus は **LLM を直接呼びません**。Terminal pane (`alacritty_terminal` + `portable-pty` 製) を抱えて、その中で Claude Code / Codex / Gemini を子プロセスとして動かします。Viewer は PR / diff / comment の選択から構造化された prompt を組み立て、**Terminal pane に送り込みます**。認証・プロバイダ選択・コスト管理・レビュー履歴は使う agent CLI 側に任せ、Locus 側には持ち込みません。

## 主要スタック

- **Rust + Slint** — ネイティブ UI
- **`alacritty_terminal` + `portable-pty`** — agent CLI 用 terminal pane
- **`tree-sitter-go`** (最初の対象言語) — セマンティック diff
- **`octocrab`** — GitHub PR snapshot

## このリポジトリの中身

- `Cargo.toml` / `src/` / `ui/` / `build.rs` — Rust + Slint バイナリ
- `docs/adr/` — ADR (rewrite 経緯 0005、`thread_local DIFF_APP_STATE` 0006 等)
- `docs/architecture/` — parser adapter + IR pipeline
- `docs/mvp.*` — 旧 MVP スコープ (歴史的経緯のため残置)
- `lang/ja/LC_MESSAGES/locus.po` — 日本語 bundled translations

旧 Next.js 系は [`legacy/nextjs`](https://github.com/duck8823/locus/tree/legacy/nextjs) ブランチに残っています。

## ライセンス

MIT — [LICENSE](LICENSE) 参照。日本語参考訳: [LICENSE.ja.md](LICENSE.ja.md)
