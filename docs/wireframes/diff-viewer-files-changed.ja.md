# Wireframe: Files changed 風 diff viewer (ja)

> English: [diff-viewer-files-changed.md](diff-viewer-files-changed.md)
> 関連 ADR: [ADR 0008](../adr/0008-files-changed-diff-viewer-layout.ja.md)

このドキュメントは、ADR 0008 で決定した GitHub "Files changed" 風レイアウトの **ASCII ワイヤーフレーム** をまとめる。記号は次の通り:

- `─ │ ┌ ┐ └ ┘ ├ ┤ ┬ ┴ ┼` レイアウト枠
- `▼ ▶` collapsible セクション (展開 / 折り畳み)
- `[ ]` チェックボックス未チェック / `[x]` チェック済み
- `( )` ラジオ未選択 / `(•)` 選択中
- `…` 省略

すべての寸法は概算で、Slint 実装時に解像度ごとに再調整する。

---

## 1. Inbox stage (PR を選んでいない状態)

```
┌────────────────────────────────────────────────────────────────────────────────────┐
│ locus — diff viewer                                                                 │
├────────────────────────────────────────────────────────────────────────────────────┤
│ Header: アプリタイトル / 接続中リポジトリ / Open settings                           │
├──────────────────────────────┬─────────────────────────────────────────────────────┤
│ PRs (Open)  (Closed)  (All)  │ Welcome / 最近開いた PR の preview など              │
│ ──────────────────────────── │                                                     │
│ #302  duck8823               │  #302 files changed adr wireframe                   │
│   files changed adr wirefr.. │  base main … head issue291-files-changed-adr-wir.. │
│   Viewed 0/4    [open]       │  body excerpt …                                     │
│ ──────────────────────────── │  Viewed 0/4    Comments 0                           │
│ #301  bot                    │                                                     │
│   refactor diff viewer …     │  [ Open this PR ]                                   │
│   Viewed 2/3    [open]       │                                                     │
│ ──────────────────────────── │                                                     │
│ #298  duck8823               │                                                     │
│   thread_local app state     │                                                     │
│   Viewed 5/5 ✓  [merged]     │                                                     │
│ ──────────────────────────── │                                                     │
│ …                            │                                                     │
│                              │                                                     │
└──────────────────────────────┴─────────────────────────────────────────────────────┘
```

- 左 PR list は 30〜35% 幅。Viewed counter が PR 行に常駐し、レビュー再開が見えるようにする。
- 中央は preview。`Open this PR` で Review stage に遷移する。

---

## 2. Review stage — Unified mode (既定)

```
┌────────────────────────────────────────────────────────────────────────────────────────────────┐
│ < PRs   #302 files changed adr wireframe   base main … head issue291…   Viewed 1/4   ⌥=⌘opts  │
├──────────────┬───────────────────────────────────────────────────────────┬─────────────────────┤
│ Filter:      │  ▼ docs/adr/0008-files-changed-diff-viewer-layout.ja.md  │ Comments | Terminal │
│ [All ▾]      │     status: A   +312 / -0    Viewed [ ]    Collapse ▲    │ ─────────────────── │
│ [search…]    │  ┌─────────┬───────────────────────────────────────────┐ │ Send All Open  ↗   │
│ [ ] Hide     │  │ old new │ content                                   │ │ ─────────────────── │
│     viewed   │  │   1     │ # ADR 0008: …                             │ │ Open (2)            │
│ [ ] Hide     │  │   2     │                                           │ │ • src/foo.rs:42     │
│     deleted  │  │   3     │ > English: [0008-…]                       │ │   missing null chk  │
│ ──────────── │  │ @@ -0,0 +1,42 @@   <hunk header — Cmd+click to send>│ │ • docs/adr/0008..   │
│ ▾ docs       │  │   …                                                  │ │   typo on line 5    │
│   ▾ adr      │  │   42    │ ## References                             │ │ ─────────────────── │
│     0008-…ja │  │                                                      │ │ Sent (1)            │
│     0008-…   │  │   ・[+] Add comment row appears here on hover         │ │ • src/bar.rs:10-25  │
│   ▾ wirefr.. │  └─────────┴───────────────────────────────────────────┘ │ ─────────────────── │
│     diff-…ja │                                                           │ Resolved (0)        │
│     diff-…   │  ▶ docs/wireframes/diff-viewer-files-changed.ja.md       │                     │
│ ▾ ui         │     status: A   +180 / -0    Viewed [x]    Expand ▼      │ ─────────────────── │
│   app.slint  │  (collapsed; Viewed = checked のため自動折り畳み)         │ Draft (1)           │
│              │                                                           │ • #302/foo.rs:42    │
│              │  ▼ src/i18n.rs                                            │   note: …           │
│              │     status: M   +6 / -0     Viewed [ ]    Collapse ▲     │ ─────────────────── │
│              │  ┌─────────┬───────────────────────────────────────────┐ │ History (3)         │
│              │  │  85  85 │   match key {                              │ │ 14:02  Send  3 cmts │
│              │  │  86  86 │       "Click a diff line, …" => …          │ │ 13:44  Insert       │
│              │  │     87  │+      "Viewed" => "確認済み",              │ │ 13:30  Copy         │
│              │  │     88  │+      "Hide viewed" => "確認済みを隠す",    │ │                     │
│              │  │  87  89 │       "Esc: clear selection" => …          │ │                     │
│              │  └─────────┴───────────────────────────────────────────┘ │                     │
│              │                                                           │                     │
│              │  ▶ ui/diff_viewer_v2.slint   status: A  Viewed [ ]        │                     │
│              │                                                           │                     │
├──────────────┴───────────────────────────────────────────────────────────┴─────────────────────┤
│ Click: select line  •  +: add comment  •  Cmd↵: Send  •  V: toggle Viewed  •  ⌘B: toggle tree │
└────────────────────────────────────────────────────────────────────────────────────────────────┘
```

- **左** (file tree + filter): 240〜280px。`Filter` chip + 検索 + Viewed/Deleted hide。tree はディレクトリ折り畳み可。1 ファイルしかないディレクトリは flatten 表示。
- **中央** (diff stack): 全ファイルが 1 つの ListView に積み重なる。各セクションの header は `▼/▶ path  status  +N/-M  Viewed [x]  Collapse/Expand`。Viewed = checked のセクションは折り畳まれる。
- **右** (Comments / Terminal の tab): 既定は Comments。`Send All Open` / Open / Sent / Resolved / Draft / History を縦スタック。

---

## 3. Review stage — Side-by-side mode

```
┌──────────────┬────────────────────────────────────────────────────────────────┬──────────┐
│ (file tree)  │  ▼ src/i18n.rs   status: M   +6 / -0   Viewed [ ]   Collapse ▲│ (right)  │
│              │  ┌─────┬──────────────────────┬─────┬──────────────────────┐ │          │
│              │  │ old │ before               │ new │ after                │ │          │
│              │  ├─────┼──────────────────────┼─────┼──────────────────────┤ │          │
│              │  │  85 │   match key {        │  85 │   match key {        │ │          │
│              │  │  86 │       "Click …" => …│  86 │       "Click …" => …│ │          │
│              │  │     │                      │  87 │+      "Viewed" => …  │ │          │
│              │  │     │                      │  88 │+      "Hide viewed"  │ │          │
│              │  │  87 │       "Esc: …" => … │  89 │       "Esc: …" => … │ │          │
│              │  └─────┴──────────────────────┴─────┴──────────────────────┘ │          │
│              │                                                              │          │
└──────────────┴──────────────────────────────────────────────────────────────┴──────────┘
```

- 4 セル `[old# | before | new# | after]`。Added 行は左を空、Removed 行は右を空にする。
- ウィンドウ幅が **1100px 未満** に縮むと自動的に Unified にフォールバックし、header の toggle を disabled にする。

---

## 4. 折り畳み済みファイル + Viewed checkbox

```
▼ docs/adr/0008-files-changed-diff-viewer-layout.ja.md
   status: A   +312 / -0    Viewed [ ]    Collapse ▲
   <diff body 表示中>
   …

▶ docs/wireframes/diff-viewer-files-changed.ja.md
   status: A   +180 / -0    Viewed [x]    Expand ▼
   (collapsed: Viewed = checked のため自動折り畳み)

▶ ui/diff_viewer_v2.slint
   status: A   +0 / -0    Viewed [ ]    Expand ▼
   (manual collapse)
```

- collapse triangle と Viewed checkbox は独立操作。Viewed=checked にすると自動 collapse、ただし `Expand ▼` で再展開可。再展開しても Viewed=checked は維持される (= "見たけどもう一度見たい" を表現)。
- header 全体をクリックで collapse 切替、Viewed checkbox はバブルしない (TouchArea を分ける)。

---

## 5. 行コメント入力 (inline)

```
   42  42      something_useful();
   43  43  +   another_line();        <- hover で右端に [+] 表示
              ┌──────────────────────────────────────────────┐
              │ Add comment on docs/adr/0008-…ja.md:43       │
              │ ┌──────────────────────────────────────────┐ │
              │ │ ここのリンクが古い、最新 ADR に直して     │ │
              │ │                                          │ │
              │ └──────────────────────────────────────────┘ │
              │ [ Cancel ]      [ Save (Cmd+Enter) ]         │
              └──────────────────────────────────────────────┘
   44  44      yet_another_line();
   45  ●●  -   removed_line();        <- 左ガターのドット = 既存コメントあり (件数つき)
   46  45      tail_line();
```

- 行を hover すると右端に `+`。クリックで **その行直下に新しい row** として inline 入力エリアを差し込む。Esc cancel / Cmd+Enter save。
- 既にコメントがある行は **左ガターのドット** で示す。ドットクリックで右ペイン Comments タブの該当エントリへ scroll & highlight。
- range 選択 (shift+click) → range 終端の直下に inline 入力。

---

## 6. 右ペイン (Comments / Terminal タブ切替)

### 6a. Comments タブ (既定)

```
┌─────────────────────────────────┐
│ Comments | Terminal             │   <- tab strip
├─────────────────────────────────┤
│ [ Send All Open ↗ ]   filters ▾ │
├─────────────────────────────────┤
│ Selection (collapsed) ▶          │   <- 旧 preview / Insert / Copy をまとめた折り畳み
├─────────────────────────────────┤
│ Open (2)                         │
│ • docs/adr/0008-…ja.md:43        │
│   ここのリンクが古い…             │
│   [edit] [send] [resolve]        │
│ • src/foo.rs:42                  │
│   missing null check             │
├─────────────────────────────────┤
│ Sent (1)                         │
│ • src/bar.rs:10-25               │
│   this function has no test      │
├─────────────────────────────────┤
│ Resolved (0)                     │
│   (none yet)                     │
├─────────────────────────────────┤
│ Draft (1)                        │
│ • #302/foo.rs:42 — note: …       │
├─────────────────────────────────┤
│ History (3)                      │
│ 14:02  Send  3 cmts              │
│ 13:44  Insert  selection         │
│ 13:30  Copy   selection          │
└─────────────────────────────────┘
```

- `Selection` セクションは現行の preview pane を折り畳み式で温存 (旧フローからの移行コスト低減)。
- `Open / Sent / Resolved` は ADR 0007 の status 区分。
- 右ペインの幅は drag handle で resizable (280〜600px)。

### 6b. Terminal タブ

```
┌─────────────────────────────────┐
│ Comments | Terminal             │
├─────────────────────────────────┤
│ agent: claude code (running)    │
├─────────────────────────────────┤
│ $ claude code                   │
│ ▍                               │
│ > files changed の wireframe を  │
│   adr 0008 と整合させてくれ      │
│                                 │
│ I'll update the wireframe to …  │
│ ──────────────────────────────  │
│                                 │
│ (terminal full-height; PTY)     │
│                                 │
└─────────────────────────────────┘
```

- 起動時のデフォルトは Comments タブ。`LOCUS_AUTOSWITCH_TERMINAL=true` の場合 `Send All Open` 完了直後に Terminal タブへ自動切替。
- `LOCUS_RIGHT_PANE=split` で Comments / Terminal を縦 2 分割表示にも切替可 (上 50% / 下 50% を初期分割比とし、grip で resize)。

---

## 7. Filter / Viewed-hide / 検索

```
Filter:
  [All ▾]                    ← 拡張子 / status を選ぶ dropdown
  [search…           ]       ← path substring match
  [ ] Hide already viewed
  [ ] Hide deleted
  [ Reset ]
```

- filter は file tree とリアルタイムに連動。tree のルート (`docs/`, `src/` 等) は子要素が 0 件になっても残し、`(0 files)` と灰色化する。
- `Reset` で全 filter を解除し、`Viewed` checkbox の状態は保持。

---

## 8. 1280×720 環境での縮約レイアウト

最小サポート 1280×720 (CLAUDE.md `min-width 1280px`) では、左ペイン / 右ペインの一部を一時的に縮める想定:

```
┌──────────────────────────────────────────────────────────────────────┐
│ < PRs  #302 …  Viewed 1/4         [Unified ▾]  ⌘B tree  ⌘J side      │
├────┬─────────────────────────────────────────────────────┬──────────┤
│ ▼  │ ▼ docs/adr/0008-…ja.md   +312/-0   [ ]  ▲           │ Comments │
│ ▾d │   …                                                  │ Open(2)  │
│ ▾a │                                                      │ Sent(1)  │
│ 8j │ ▶ docs/wireframes/diff-…ja.md   +180/-0   [x]  ▼     │ ─────── │
│ 8e │ ▼ src/i18n.rs   +6/-0   [ ]  ▲                       │ Draft(1) │
│ ▾w │   …                                                  │ History  │
│ dj │                                                      │          │
│ d  │                                                      │          │
│ ▾u │                                                      │          │
│ as │                                                      │          │
├────┴─────────────────────────────────────────────────────┴──────────┤
│ Click: select  •  +: comment  •  Cmd↵: Send  •  V: Viewed  •  ⌘B/⌘J │
└──────────────────────────────────────────────────────────────────────┘
```

- 左 file tree は **アイコン+省略表示モード** に切替 (幅 ~60px)。`⌘B` で full ↔ icon ↔ hidden をサイクル。実装時は幅変更を即時切替にし、ListView 内で横幅 animation を掛けない (row reflow のガタつきを避ける)。
- 右ペインは default 280px / 最小幅 280px を維持。`⌘J` で右ペインを完全に隠して中央 diff を最大化することもできる。

---

## 8. キーバインド (新規 / 既存)

| Key | Action |
|---|---|
| `Click` (line) | 行を選択 (現行と同じ) |
| `Shift + Click` | range 選択 |
| `+` (hover アイコン) または `Cmd/Ctrl + N` | inline コメント入力を開く (ADR 0007) |
| `Cmd/Ctrl + Enter` (コメント入力中) | 保存 |
| `Esc` (コメント入力中) | キャンセル |
| `Cmd/Ctrl + Shift + Enter` | Send All Open (ADR 0007) |
| `V` (file header 上で) | Viewed toggle |
| `Cmd/Ctrl + B` | 左の file tree を full / icon / hidden サイクル |
| `Cmd/Ctrl + J` | 右ペインを show / hide |
| `Cmd/Ctrl + Shift + U` | Unified / Side-by-side toggle |
| `Cmd/Ctrl + Enter` (selection 中) | Insert + Send (現行と同じ) |
| `Cmd/Ctrl + C` | Copy (現行と同じ) |

ADR 0007 のキーと衝突しないこと、現行 (CLAUDE.md / `ui/app.slint::global-focus`) を破壊しないことを保証する。

---

## 9. 注記

- ASCII の比率 / 字下げは Slint 実装の正確な寸法ではなく、要素の **位置関係と階層** を示すための図形である。実装時は `min-width 1280px / min-height 720px` の制約 (`ui/app.slint`) と、resize に伴う side-by-side / file tree 切替の閾値を守る。
- 右ペインの draft / history は ADR 0007 の Comments tab に **集約** する。現状の独立した 300px 列は廃止する。
- Side-by-side renderer の line-pair 解決は hunk-local index を採用し、複雑なペアリングが要求された時点で `DiffLineView` を拡張する (本 ADR の決定事項)。
