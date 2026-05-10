# ADR 0008: diff viewer に GitHub "Files changed" 風レイアウトを採用する

> English: [0008-files-changed-diff-viewer-layout.md](0008-files-changed-diff-viewer-layout.md)

- Status: Proposed
- Date: 2026-05-10

## Context（背景）

現状の locus diff viewer は、PR メタ情報・PR list・file list・diff 本体・選択 controls・preview・送信 controls・terminal pane・draft / history pane を **1 枚の画面に同時に並べる** 構成になっている (`ui/app.slint::DiffViewerWindow`)。

実機での観察 (2026-05-08 検証, 1280×720) では以下の制約が顕在化している:

- **情報密度が高すぎる**: header (最大 150px) + 4 列 (PR list 190px / File list 220px / center / draft 300px) + bottom hint bar が常時固定で、中央 diff の実効幅が 1280px 環境では ~570px しか残らない。
- **focus が定まらない**: 「PR を選ぶ」「ファイルを切り替える」「行を選ぶ」「preview を編集する」「terminal を読む」「draft を見る」が同じ視野内で並列に存在し、利用者がどこを見るべきか視線移動が頻繁になる。
- **terminal pane が固定 220px**: diff content が縦方向にも 圧迫される。送信後にエージェント応答を読みたいフェーズでは terminal を広げたい一方、diff を読んでいる間は terminal を閉じたい。固定高では切替えられない。
- **collapsible / Viewed 概念がない**: 大きい PR (10+ files) を読むときに、すでに見たファイルを畳んだり、未読の Viewed 進捗を確認する手段がない。File list のカーソル移動だけでは「読んだ／読んでない」のトラッキングができない。
- **side-by-side mode が存在しない**: 現状 unified diff のみ。コードレビューで delete + add の対応関係を視認するときに不利。
- **行コメントの位置付けが曖昧**: ADR 0007 で comment-driven send レイヤーを別途追加するが、現行レイアウトに comment pane を増やすと右側がさらに混雑する。

GitHub の PR "Files changed" タブはこれらに対する成熟した UX 解 (公式 docs 参照: [References](#references-参考資料)) を持っている。ファイルごと折りたたみ・Viewed 進捗・ファイルツリー / filter・unified / split 切替・行クリックでのコメント追加 — を locus に取り込むのが本 ADR のスコープである。

本 ADR は **設計とワイヤーフレーム のみ** を扱う。Slint 実装は別 issue で扱い、本 PR では doc commit のみ行う。

## Decision（決定）

PR diff viewer を **Files changed 風レイアウト** に再設計する。実装はフラグ駆動で旧レイアウトと共存させ、安定後に既定切替 → 旧レイアウト撤去まで段階的に進める。

### 1. 画面の二段階モデル

PR を **選んでいない / 選んでいる** で UI の支配的領域を変える:

- **Inbox stage**: PR list が画面左側を 30〜35% 占有。中央は PR の preview / metadata。
- **Review stage** (本 ADR の主対象): PR list は左端の breadcrumb / 折り畳み済みサイドバーに退き、Files changed view が画面の主役になる。

この遷移は単方向ではなく、Inbox に戻るボタン (`< PRs`) で常時戻れる。

### 2. Review stage の三分割

```
┌──────────────────────────────────────────────────────────────────┐
│ Header bar: < PRs │ PR title │ base...head │ Viewed N/M │ filters│
├────────────┬───────────────────────────────────┬─────────────────┤
│            │                                   │ Comments / Term │
│ File tree  │   Diff stack (collapsible files)  │  (tabbed)       │
│ + filter   │                                   │                 │
│            │                                   │                 │
├────────────┴───────────────────────────────────┴─────────────────┤
│ Bottom hint bar (key bindings / hover tooltip)                    │
└──────────────────────────────────────────────────────────────────┘
```

- **左**: File tree (ディレクトリツリー) + filter chips (All / Modified / Added / Removed / Renamed) + 検索ボックス + Viewed-hide toggle。
- **中央**: ファイル単位のセクションを **縦に積んだ単一 ListView**。各セクションは header (path / status / Viewed checkbox / collapse) + diff body。
- **右**: Comments / Terminal の **タブ切替**。draft pane と history は Comments タブの下部にまとめる (現状の右 300px 列を再構成)。

具体的なワイヤーフレームは [docs/wireframes/diff-viewer-files-changed.ja.md](../wireframes/diff-viewer-files-changed.ja.md) を参照。

### 3. Files changed の locus 化

GitHub の概念を locus 文脈で 1:1 ではなく **ローカル AI 駆動レビュー** 向けに調整する:

| GitHub Files changed | locus での扱い |
|---|---|
| Viewed checkbox (per file) | ローカル SQLite (ADR 0007 の `comments.db` を共有) に保存。PR を再度開くと復元。 |
| Viewed 進捗バー | header bar に `Viewed 3/12` のテキスト。Inbox stage の PR list でも進捗 chip を表示。 |
| File tree | `ui/app.slint` に新規ツリーコンポーネントを追加。階層は path 先頭 segment で集約。1 ファイルしかないディレクトリは flatten してパス連結 (例: `src/comments/repository.rs`)。 |
| File filter (All / 拡張子 / status) | filter chip + free-text 検索。LCS でなく substring match で十分。 |
| Hide already-viewed | filter chip の 1 つとして実装。 |
| Hide deleted | filter chip の 1 つ。default で見えるが toggle で隠せる。 |
| Unified / Split toggle | header bar の単一 toggle。state は session local (永続化しない) で開始。要望が出れば永続化する。 |
| Rich diff (markdown / image) | **non-goal** (後述)。 |
| 行クリックで comment | ADR 0007 の `Add Comment` フローと統合。クリックした行の直下に inline 入力エリアを開く。 |
| Resolve conversation | ADR 0007 の `resolved` ステータスをそのまま使う。 |
| Submit review (Approve / Request changes) | **non-goal**。GitHub Review Comments への push は ADR 0007 同様スコープ外。 |

### 4. Side-by-side / Unified

- **Unified** (既定): 現状と同様、`+ ` / `- ` / context を 1 列で。新旧の行番号は左端に併記 (現状の `old / new` 90px ガターを継続)。
- **Side-by-side**: 1 行を `[old line# | old content | new line# | new content]` の 4 セルで描画。context 行は左右同内容。Added 行は左を空 cell、Removed 行は右を空 cell。

Slint レイアウトの観点では、`DiffLineView` を **両モード共通の中間表現** とし、レンダラーだけ切替える (Unified renderer / SideBySide renderer)。新たな per-line state (例えば `paired-line-id`) は本 ADR では追加せず、Hunk 単位の matching を Side-by-side renderer が hunk 内 line index で隣接対応に解決する。完全な before/after pairing が必要になった時点で `DiffLineView` に拡張フィールドを足す (本 ADR ではしない)。

ターミナル幅に対する fallback: Side-by-side の最低幅 (例: 1100px) を下回った場合は自動的に Unified に切替え、header の toggle を disabled にする。

### 5. Collapsible files

- 各ファイルセクションは **default expanded**。GitHub と異なり、locus は一度に 1 PR の diff を扱うことが多く、最初の 1 view ですべて見えていた方が情報損失が少ない。
- File 数が **threshold 超え (既定 20)** の場合のみ default collapsed にして、ユーザーが意図的に開く運用にする。threshold は env (`LOCUS_DIFF_AUTOCOLLAPSE_THRESHOLD`) で上書き可能。
- **Viewed = checked** にすると、そのファイルは自動で collapse される (GitHub と同じ挙動)。チェックを外すと再展開。
- 全展開 / 全 collapse のヘッダー操作 (`Expand all` / `Collapse all`)。

### 6. File tree / filter / Viewed state

- File tree は **lazy ではなく eager** に全ノードを構築する (PR の files API はすでに full list を持っている)。仮想化はスクロール領域 (Slint の `ListView`) に任せる。
- 選択中ファイルは tree 上で highlight。中央 diff stack 側の scroll 位置と双方向同期: tree クリック → diff の該当ファイル冒頭へ scroll、diff scroll → tree の active highlight 移動。
- Viewed state は `viewed_files` テーブルで永続化:

  ```sql
  CREATE TABLE viewed_files (
    session_id   INTEGER NOT NULL REFERENCES sessions(id),
    file_path    TEXT NOT NULL,
    viewed_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (session_id, file_path)
  );
  ```

  ADR 0007 の `sessions` を再利用する。`viewed_at` を持つことで、後で「いつ確認したか」を traceary に渡せる余地を残す。

### 7. Terminal pane と Comments / Draft pane の同居

右側カラムは **タブ切替の 1 ペイン** とする:

- **Comments タブ** (既定): ADR 0007 の Comments 一覧 + draft entries + history を縦スタック。`Send All Open` ボタンは Comments タブ header に常駐。
- **Terminal タブ**: 現状の terminal pane をそのまま縦に最大化したもの。タブ切替時にフォーカスが terminal-focus に移る。
- **同時表示モード** (option): 縦に 2 分割し上 Comments / 下 Terminal。`LOCUS_RIGHT_PANE=split` で起動時に有効化。default は tab 切替。

これにより:

- 通常レビュー時: Comments タブで draft / open コメントを見る。terminal pane は隠れる。
- Send 後: 自動で Terminal タブにスイッチ (option, `LOCUS_AUTOSWITCH_TERMINAL=true`)、エージェント応答を全画面で確認。
- ハイブリッドにしたい人は split mode を使う。

右ペインの幅は **resizable** にする (既存の固定 300px をやめる)。最小 280px / 最大 600px / persisted in `comments.db` の `ui_state` テーブル。ADR 0007 は `comments.db` と `sessions` を導入するが `ui_state` は定義しないため、`ui_state` の `CREATE TABLE IF NOT EXISTS` は本 ADR の Phase 2 以降が所有する。

### 8. 行コメント・draft とのインタラクション

ADR 0007 を前提に:

- 各行 hover で右端に `+` ボタンを表示。クリックすると行の **直下に inline 入力エリア** が開く (新規 row として diff stack に挿入される)。Esc でキャンセル、Cmd/Ctrl + Enter で保存。
- 既にコメントがある行は **左ガターに丸ドット** + 数字 (件数)。ドットクリックで右ペイン Comments タブの当該コメントへ scroll & highlight。
- range 選択 (shift + click または現状の Range ボタン) → range の最終行直下に入力エリア。
- 既存 selection-driven の `Insert` / `Insert + Send` / `Copy` / `Add to draft` フローは preview pane に集約 (現状と同じ機能を Comments タブの上部 collapsible section に寄せる)。

### 9. 移行戦略

実装フェーズ:

1. **Phase 0 (本 PR)**: ADR + ASCII wireframe を merge。コードは触らない。
2. **Phase 1**: feature flag `LOCUS_DIFF_VIEWER=files-changed` を追加し、新旧レイアウトを 2 つの Slint window component として並走させる。default は旧レイアウト。
3. **Phase 2**: file tree / filter / collapsible / Viewed の最小実装で flag 経由のレビューを開始 (drogfooding)。
4. **Phase 3**: side-by-side renderer 追加、右ペインタブ切替、ADR 0007 の Comments と統合。
5. **Phase 4**: default を `files-changed` に切替。旧レイアウトは `LOCUS_DIFF_VIEWER=classic` で 1 minor version (例: v0.2.x → v0.3.0) 残す。
6. **Phase 5**: 旧レイアウト削除。`DiffViewerWindow` の単一 component を新レイアウトに置換。

各 Phase は別 issue / 別 PR とし、CI の `cargo test` / `cargo clippy` を通す。Phase 1〜3 の途中で UX レビューを行い、必要なら本 ADR を改訂する。

### 10. 状態管理 (ADR 0006 との整合)

新レイアウトでも state の唯一の真は `DIFF_APP_STATE` (thread_local / `Rc<RefCell<>>`) に閉じる。新規 state:

- `viewed_files: HashSet<PathBuf>` — DB から起動時に hydrate。
- `expanded_files: HashSet<PathBuf>` — session-local。永続化しない。
- `diff_view_mode: DiffViewMode { Unified, SideBySide }` — session-local。
- `right_pane_tab: RightPaneTab { Comments, Terminal }` — session-local。
- `right_pane_width: f32` — DB 永続化。
- `file_tree_filter: FileTreeFilter` — session-local。

`tokio::spawn` 経由で fetch する側 (PR snapshot / linked issue) には変化なし。新 state は UI thread 上のみで mutate されるため `Send` 要件は発生しない。

### 11. i18n

新規 UI 文字列はすべて `src/i18n.rs::translate_ja` テーブルと Slint `@tr` の両方に登録する (CLAUDE.md の i18n 注意事項に従う)。新規キー候補:

- `Viewed`, `Unviewed`, `Hide viewed`, `Hide deleted`
- `Unified`, `Side by side`, `Expand all`, `Collapse all`
- `< PRs`, `Comments`, `Terminal`
- `(no comments yet)`, `(no diff to show)`

## Consequences（結果）

### 正の影響

- 1 ファイルにフォーカスして読みやすくなる。Viewed 進捗で「あといくつ」が見える。
- file tree により、深いディレクトリ構造の PR でも navigate しやすい。
- 右ペインのタブ化で、レビュー中は Comments・送信後は Terminal という時間軸の使い分けがしやすい。
- side-by-side で delete + add 対応の視認性が上がる。
- ADR 0007 の comment 流入口が「行直下の inline 入力」として自然に置ける。

### 負の影響

- Slint のレイアウトコードが大幅に増える (`DiffViewerWindow` の sub-component 化が必要)。`ui/` を複数ファイルに分割する仕事が新規に発生する。
- 旧レイアウトとの並走期間 (Phase 1〜4) は 2 経路のメンテが必要。bug fix を両方に当てる。
- File tree のレンダリングは Slint の reactive ListView 上で深さを表現する必要があり、現状にない実装パターン (indent guide / disclosure triangle) を導入する。
- Viewed / expanded / right pane width など new persisted state が増え、`comments.db` のスキーマが追加される (ADR 0007 とのリリース順序を調整する必要がある)。

### 境界 (Non-goals)

- **GitHub Review Comments への push**: ADR 0007 同様スコープ外。Viewed state も locus ローカルに閉じる。
- **Rich diff (markdown / image preview)**: GitHub の rich diff toggle 相当は実装しない。`is-unsupported` の現行扱い (テキスト diff として表示できない旨の注記) を継続。
- **Blame / history**: ファイル単位の git history 表示は本 ADR のスコープ外。
- **Multi-PR diff comparison**: 複数 PR を 1 画面に並べる UI は対象外。
- **Terminal の機能再設計**: alacritty_terminal / portable-pty まわりの挙動 (#perf / #font issues) は別 issue。本 ADR は terminal の **配置** だけを変える。
- **Semantic change IR の活用**: ADR 0004 の semantic diff を Files changed view に重ねる議論は本 ADR ではしない (将来 ADR で再検討)。
- **Approve / Request changes ボタン**: GitHub の Submit review に相当する操作は対象外。
- **個別の見切れ / もっさり / 文字化け修正** (#見切れ / #perf / #font): 旧レイアウト上で軽微なものだけ最小限維持。新レイアウト前に深追いしない (issue #291 の Scope NOT 通り)。

## 代替案

1. **既存レイアウトを維持しつつ collapse / Viewed だけ追加する**: 安いが、情報密度・focus 不足という根本問題は解決しない。collapse の効果は file 数依存だが、レイアウト全体の縦方向 (terminal 220px 固定など) には効かない。
2. **GitHub Files changed の DOM をそのままコピーする (split / file tree も full pixel-parity)**: 過剰最適化。locus の使われ方は GitHub Web 版とは違い、エージェント terminal を必須要素として含むため、3 列構成 (tree / diff / agent) を locus 固有形にする方が良い。
3. **diff viewer を完全別 window に切り出す (multi-window)**: macOS native では成立するが、PR list と diff の往復頻度が高く、window 切替コストが UX を悪化させる。Window 内タブ (Inbox / Review stage) で十分。
4. **file tree を持たず、breadcrumb + ファイルリストだけにする**: シンプルだが、深い path (例: `src/diff/render/side_by_side/mod.rs`) を持つ Rust リポジトリでは tree 表現が navigate に効く。
5. **Inline コメントではなく、行選択 → 右ペインで入力する従来形 (現行に近い)**: ADR 0007 をそのまま実装するならこちらが安い。ただし「行の文脈を見ながら書く」ことが review の本質なので、inline 入力を default にする本案を採用。

## 実装計画 (high level)

詳細スケジュールと issue 分解は別途登録 (Phase 1〜5 で 5+ 件想定)。ここでは順序のみ:

1. **ADR + wireframe** ← 本 PR
2. `ui/diff_viewer_v2.slint` に新 component 雛形 + feature flag を追加 (旧 component と並走)
3. file tree component + filter chips
4. collapsible file section + Viewed 永続化 (`viewed_files` table)
5. Unified renderer の流用 + side-by-side renderer 新規実装
6. 右ペイン tab 切替 + ADR 0007 Comments 統合 + inline 入力エリア
7. flag 既定値切替 + 旧 component 削除 (ADR 改訂時点)

## References (参考資料)

GitHub 公式ドキュメントを一次情報として参照した。

- [GitHub Docs — Reviewing proposed changes in a pull request](https://docs.github.com/en/pull-requests/collaborating-with-pull-requests/reviewing-changes-in-pull-requests/reviewing-proposed-changes-in-a-pull-request?tool=webui) — file 単位レビュー、Viewed checkbox、Viewed 進捗バー、unified / split 切替、PR submit フロー。
- [GitHub Docs — Filtering files in a pull request](https://docs.github.com/github/collaborating-with-pull-requests/reviewing-changes-in-pull-requests/filtering-files-in-a-pull-request) — 大きい PR のための file filter / file tree、Viewed / deleted 隠し。
- [GitHub Docs — About comparing branches in pull requests](https://docs.github.com/en/pull-requests/collaborating-with-pull-requests/proposing-changes-to-your-work-with-pull-requests/about-comparing-branches-in-pull-requests) — Files changed タブが merge 後を見せる事実、unified / split / rich / source の 4 表示、whitespace ignore、Viewed / deleted フィルタ。

関連 ADR:

- [ADR 0003: layered server architecture](0003-layered-server-architecture.ja.md) — モジュール分割の方針を継承。
- [ADR 0005: Rust + Slint native rewrite](0005-rust-slint-native-rewrite.ja.md) — Slint 上での UI 構築前提。
- [ADR 0006: thread_local app state](0006-thread-local-app-state.ja.md) — 新 state を `DIFF_APP_STATE` に閉じる根拠。
- [ADR 0007: comment-driven send](0007-comment-driven-send.ja.md) — Comments タブと inline コメント入力の前提。

実機検証ログ:

- 2026-05-08 1280×720 の `scripts/diagnose_ui.sh github` 結果より、現行レイアウトの中央 diff 実効幅と固定 chrome の比率を確認 (issue #291 本文)。
