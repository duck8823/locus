# ADR 0007: diff viewer に comment-driven send レイヤを追加する

> English: [0007-comment-driven-send.md](0007-comment-driven-send.md)

- Status: Proposed
- Date: 2026-05-09

## Context（背景）

現状の locus は diff の選択範囲をその場で `Insert + Send` するか `Copy` するかの 2 択である。これは「気づいた箇所を即座にエージェントへ流す」フローには合うが、**「複数箇所を見てから一括で依頼する」レビュアー的フロー** には合わない。

具体的には:

- PR を頭から流し読みしながら気づいた点を 5〜10 件メモしておきたい
- 全部見終わってから「これらをまとめて直して」とエージェントに渡したい
- 渡した後も、どのコメントが Sent / Open / Resolved かをトラッキングしたい

今の locus でこれをやると:

1. 1 件ずつ Send するか
2. 外部メモアプリで蓄積してからコピペするか

のいずれかになる。前者はエージェントに対してコンテキストが断片化し、後者は locus の外に出るので diff の行参照（`@file:line`）が手作業になる。

類似ツール:

- Cursor の Composer は複数ファイルを context に取れるが、コメントの蓄積機能はない
- Continue (VS Code) の "Context Items" は近いが、エディタ拡張として動作する
- GitHub Copilot Workspace はチェックリスト式の集約に近いが、ローカル CLI エージェントは扱えない
- 「ローカルで PR diff を読みながらコメントを溜め、AI CLI（Claude Code / Codex / Gemini）に流す」というニッチは locus の独自領域

本機能は milestone `v0.1: core review loop` のサブ機能として位置付ける。files モード（ローカルディレクトリ + コメント）への拡張は v0.2 以降の選択肢として残す。

## Decision（決定）

PR diff viewer に Comments レイヤを追加する。コメントはローカル SQLite に永続化し、`Send All Open` で既存の bracketed paste 経路に乗せて一括投下する。

### データモデル（SQLite）

`~/Library/Application Support/locus/comments.db` に永続化する。これは macOS
での想定パスであり、実装では既存依存の `directories::ProjectDirs` を使って
OS ごとの application data directory に解決する。

```sql
CREATE TABLE sessions (
  id           INTEGER PRIMARY KEY,
  kind         TEXT NOT NULL,           -- 'pr' | 'workspace'
  ref          TEXT NOT NULL,           -- PR URL or workspace path
  created_at   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE comments (
  id           INTEGER PRIMARY KEY,
  session_id   INTEGER NOT NULL REFERENCES sessions(id),
  file_path    TEXT NOT NULL,
  line_start   INTEGER NOT NULL,
  line_end     INTEGER,                 -- NULL = single line
  body         TEXT NOT NULL,
  status       TEXT NOT NULL DEFAULT 'open',  -- 'open' | 'sent' | 'resolved'
  created_at   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  sent_at      TIMESTAMP
);

CREATE INDEX idx_comments_session ON comments(session_id, status);
```

セッションは `(kind, ref)` で一意。同じ PR を再度開いた時は既存セッションを再利用してコメントを復元する。

### ローカル境界

コメントデータはユーザーのマシンに閉じる。GitHub Review Comments への push や他ユーザーとの同期は **本 ADR ではスコープ外**。エージェントへの中間バッファとしてローカル DB を経由してから、明示的に外部送信するかどうかは将来判断する。

### UI

- diff pane の右に **Comments pane**（既存ターミナルとタブ切替 or Comments / Terminal の 2 段）
- 既存の Insert/Send ボタンの隣に **Add Comment** ボタンを追加。選択範囲がある状態でクリックすると入力エリアが開く
- Comments pane で一覧・編集・削除・status 切替（`open` / `sent` / `resolved`）
- **Send All Open** ボタン: status=open のものを一括で bracketed paste し、対象を `sent` に更新する

### 貼り付け形式（Send All Open）

```
@src/foo.rs:42 ここの null チェックが足りない
@src/bar.rs:10-25 この関数はテストがない
@docs/api.md:5 タイトルの揺れ
```

1 コメント 1 行。Claude Code / Codex の `@` 参照そのままに乗る。複数行範囲は `@file:start-end`。

PR diff の場合、line は **変更後ファイル基準**。コメント保存時に diff のサイドを記録しておき、Send 時に「変更後ファイルでの行番号」に解決する。削除行のように変更後ファイルへ直接対応する行がない場合は、近傍の残存 context 行へ解決するか、削除行であることが分かる fallback 表記を実装時に定義する。

### Status ライフサイクル

`open` → `sent` → `resolved` の前進方向を基本とする:

- `open`: 入力済みでまだ Send されていない。`Send All Open` の対象。
- `sent`: `Send All Open` で bracketed paste 済み。エージェントに依頼済みの状態。
- `resolved`: ユーザーが手動で「処理済み」とマークしたもの。

任意の status へは Comments pane から手動で戻せる（誤って `sent` にした際の救済）。`resolved` は `Send All Open` の対象外。

### キーバインド

既存の `Cmd/Ctrl + Enter`（Insert + Send）と整合する形で:

| Key | Action |
|---|---|
| Cmd/Ctrl + N | 選択範囲に Add Comment（コメント入力エリアを開く） |
| Cmd/Ctrl + Enter（コメント入力中）| コメントを保存 |
| Cmd/Ctrl + Shift + Enter | Send All Open |
| Esc（コメント入力中） | キャンセル |

### モジュール配置

ADR 0003（layered server architecture）と整合する形で、Application 層と Infrastructure 層を分離する:

```
src/comments/
  mod.rs          # 公開 API
  model.rs        # Comment / Session / CommentStatus
  repository.rs   # SQLite アクセス
  service.rs      # Application 層: add_comment / list_open / send_all
ui/comments.slint # Comments pane の UI コンポーネント
```

マイグレーションは起動時に `CREATE TABLE IF NOT EXISTS` で十分（v0.0.x なので、break しても重大ではない）。将来スキーマ変更が必要になった時点でマイグレーション基盤を本格導入する。

### Send 経路

既存の bracketed paste 経路（`LOCUS_BRACKETED_PASTE`）に乗せる。`Send All Open` は内部的に「複数コメントを 1 つの文字列に連結 → 既存 Send パスを通す」。サイズが `LOCUS_PROMPT_MAX_CHARS` を超えた場合は、既存のプレビュー / 同意ダイアログのフローを再利用する。

## Consequences（結果）

### 正の影響

- 「気づいた点を全部メモしてから一括依頼」というレビュアー的フローが locus 内で完結する
- 永続化されているため、同じ PR を再度開いた時にコメントが残る（レビュー再開）
- traceary との連携余地: コメントの一覧と Send イベントを記録できれば、AI 駆動レビューの足跡として再利用できる
- `@file:line` 形式は Claude Code / Codex が解釈しやすい comment batch 用の明示形式である。現行の `Insert + Send` prompt は markdown header を含むため完全同一ではないが、実装時に両者をこの参照形式へ寄せるか、Send All Open 専用形式として併存させる判断を明示できる

### 負の影響

- SQLite 依存が増える。既存の locus は SQLite を使っていないため、`rusqlite` クレートとマイグレーションの仕組みが新規導入になる
- Comments pane を出すための画面分割が必要になり、Slint 側の layout 変更が走る（既存タブ構造との整合）
- 「コメント入力エリア」を実装する必要があり、既存の選択 → Send よりは UI が重くなる

### 境界

- ローカルディレクトリ（files モード）でのコメントは **本 ADR ではスコープ外**。`kind='workspace'` の枠だけ用意しておくが、UI は v0.2 以降。
- PR コメントの GitHub 同期は **本 ADR ではスコープ外**。ローカル DB に閉じる。GitHub Review Comments への push は別 ADR で検討する。
- エディタ機能（コメント以外でのファイル編集）はスコープ外。あくまで diff の補助レイヤとして位置付ける。

## 代替案

1. **メモリのみで永続化なし**: 軽量だが、再起動で消えるため「あとで Send All」のメリットが半減する。
2. **ワークスペースルートに JSON ファイル（`.locus/comments.json`）保存**: git 管理に乗せられる利点はあるが、PR diff 視点だとワークスペース概念がぶれる。SQLite を採用。
3. **GitHub Review Comments API を直接叩く**: 公開コメントになり、AI への中間バッファとしては不向き。ローカル DB を経由してから明示的に push する形を将来オプションに残す。

## 実装計画

1. `rusqlite` 導入 + マイグレーション基盤（起動時 idempotent な `CREATE TABLE IF NOT EXISTS`）
2. `src/comments/model.rs` + `repository.rs` の単体テスト
3. `service.rs` の Application 層（`add_comment` / `list_open` / `mark_sent` / `delete`）
4. Slint Comments pane の UI 実装
5. Add Comment ボタン + キーバインド
6. Send All Open の bracketed paste 経路統合
7. PR の line resolver（before/after side → after-side line）
8. e2e: 1 つの PR でコメント 3 件 → Send All → ターミナルに `@file:line` 3 行が貼り付けられる
