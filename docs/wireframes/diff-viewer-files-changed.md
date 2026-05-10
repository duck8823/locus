# Wireframe: Files changed-style diff viewer

> 日本語: [diff-viewer-files-changed.ja.md](diff-viewer-files-changed.ja.md)
> Related ADR: [ADR 0008](../adr/0008-files-changed-diff-viewer-layout.md)

This document collects the **ASCII wireframes** for the Files changed-style layout decided in ADR 0008. Conventions:

- `─ │ ┌ ┐ └ ┘ ├ ┤ ┬ ┴ ┼` — layout chrome
- `▼ ▶` — collapsible section (expanded / collapsed)
- `[ ]` unchecked checkbox / `[x]` checked
- `( )` unselected radio / `(•)` selected
- `…` truncation

All measurements are approximate; exact pixel sizing is decided per resolution at Slint implementation time.

---

## 1. Inbox stage (no PR selected)

```
┌────────────────────────────────────────────────────────────────────────────────────┐
│ locus — diff viewer                                                                 │
├────────────────────────────────────────────────────────────────────────────────────┤
│ Header: app title / connected repo / Open settings                                  │
├──────────────────────────────┬─────────────────────────────────────────────────────┤
│ PRs (Open)  (Closed)  (All)  │ Welcome / preview of the most recent PR, etc.       │
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

- Left PR list takes 30–35%. The Viewed counter sits on each row so review-resume is visible.
- Centre is a preview. `Open this PR` transitions to the Review stage.

---

## 2. Review stage — Unified mode (default)

```
┌────────────────────────────────────────────────────────────────────────────────────────────────┐
│ < PRs   #302 files changed adr wireframe   base main … head issue291…   Viewed 1/4   ⌥=⌘opts  │
├──────────────┬───────────────────────────────────────────────────────────┬─────────────────────┤
│ Filter:      │  ▼ docs/adr/0008-files-changed-diff-viewer-layout.md     │ Comments | Terminal │
│ [All ▾]      │     status: A   +312 / -0    Viewed [ ]    Collapse ▲    │ ─────────────────── │
│ [search…]    │  ┌─────────┬───────────────────────────────────────────┐ │ Send All Open  ↗   │
│ [ ] Hide     │  │ old new │ content                                   │ │ ─────────────────── │
│     viewed   │  │   1     │ # ADR 0008: …                             │ │ Open (2)            │
│ [ ] Hide     │  │   2     │                                           │ │ • src/foo.rs:42     │
│     deleted  │  │   3     │ > 日本語: [0008-…ja]                      │ │   missing null chk  │
│ ──────────── │  │ @@ -0,0 +1,42 @@   <hunk header — Cmd+click sends>  │ │ • docs/adr/0008..   │
│ ▾ docs       │  │   …                                                  │ │   typo on line 5    │
│   ▾ adr      │  │   42    │ ## References                             │ │ ─────────────────── │
│     0008-…   │  │                                                      │ │ Sent (1)            │
│     0008-…ja │  │   ・[+] add-comment row appears here on hover         │ │ • src/bar.rs:10-25  │
│   ▾ wirefr.. │  └─────────┴───────────────────────────────────────────┘ │ ─────────────────── │
│     diff-…   │                                                           │ Resolved (0)        │
│     diff-…ja │  ▶ docs/wireframes/diff-viewer-files-changed.md          │                     │
│ ▾ ui         │     status: A   +180 / -0    Viewed [x]    Expand ▼      │ ─────────────────── │
│   app.slint  │  (collapsed; auto because Viewed = checked)               │ Draft (1)           │
│              │                                                           │ • #302/foo.rs:42    │
│              │  ▼ src/i18n.rs                                            │   note: …           │
│              │     status: M   +6 / -0     Viewed [ ]    Collapse ▲     │ ─────────────────── │
│              │  ┌─────────┬───────────────────────────────────────────┐ │ History (3)         │
│              │  │  85  85 │   match key {                              │ │ 14:02  Send  3 cmts │
│              │  │  86  86 │       "Click a diff line, …" => …          │ │ 13:44  Insert       │
│              │  │     87  │+      "Viewed" => "Viewed",                │ │ 13:30  Copy         │
│              │  │     88  │+      "Hide viewed" => "Hide viewed",      │ │                     │
│              │  │  87  89 │       "Esc: clear selection" => …          │ │                     │
│              │  └─────────┴───────────────────────────────────────────┘ │                     │
│              │                                                           │                     │
│              │  ▶ ui/diff_viewer_v2.slint   status: A  Viewed [ ]        │                     │
│              │                                                           │                     │
├──────────────┴───────────────────────────────────────────────────────────┴─────────────────────┤
│ Click: select line  •  +: add comment  •  Cmd↵: Send  •  V: toggle Viewed  •  ⌘B: toggle tree │
└────────────────────────────────────────────────────────────────────────────────────────────────┘
```

- **Left** (file tree + filter): 240–280px. Filter chip + search + Viewed/Deleted hide. Tree directories are collapsible. Single-file directories are flattened in the label.
- **Centre** (diff stack): all files stacked into one ListView. Each section header is `▼/▶ path  status  +N/-M  Viewed [x]  Collapse/Expand`. Sections with Viewed = checked auto-collapse.
- **Right** (Comments / Terminal tab): defaults to Comments. `Send All Open`, then Open / Sent / Resolved / Draft / History stacked vertically.

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
│              │  │     │                      │  87 │+      "Viewed" => … │ │          │
│              │  │     │                      │  88 │+      "Hide viewed" │ │          │
│              │  │  87 │       "Esc: …" => … │  89 │       "Esc: …" => … │ │          │
│              │  └─────┴──────────────────────┴─────┴──────────────────────┘ │          │
│              │                                                              │          │
└──────────────┴──────────────────────────────────────────────────────────────┴──────────┘
```

- Four cells: `[old# | before | new# | after]`. Added rows leave the left empty; removed rows leave the right empty.
- Below **1100px window width** the renderer auto-falls back to Unified and the toggle is disabled.

---

## 4. Collapsed file + Viewed checkbox

```
▼ docs/adr/0008-files-changed-diff-viewer-layout.md
   status: A   +312 / -0    Viewed [ ]    Collapse ▲
   <diff body shown>
   …

▶ docs/wireframes/diff-viewer-files-changed.md
   status: A   +180 / -0    Viewed [x]    Expand ▼
   (collapsed: auto-folded because Viewed = checked)

▶ ui/diff_viewer_v2.slint
   status: A   +0 / -0    Viewed [ ]    Expand ▼
   (manual collapse)
```

- Collapse triangle and Viewed checkbox act independently. Setting Viewed = checked auto-collapses, but `Expand ▼` reopens the body without unchecking Viewed (i.e. "I've seen it but want to look again").
- Clicking the header anywhere except the Viewed checkbox toggles collapse — the checkbox uses its own TouchArea so the click does not bubble.

---

## 5. Inline comment input

```
   42  42      something_useful();
   43  43  +   another_line();        <- hover shows [+] on the right
              ┌──────────────────────────────────────────────┐
              │ Add comment on docs/adr/0008-…md:43          │
              │ ┌──────────────────────────────────────────┐ │
              │ │ This link is stale; point at the latest  │ │
              │ │ ADR.                                      │ │
              │ └──────────────────────────────────────────┘ │
              │ [ Cancel ]      [ Save (Cmd+Enter) ]         │
              └──────────────────────────────────────────────┘
   44  44      yet_another_line();
   45  ●●  -   removed_line();        <- left-gutter dot = existing comments (count)
   46  45      tail_line();
```

- Hovering a line surfaces a `+` on the right edge. Clicking inserts **a new row directly beneath the line** with the input area. Esc cancels, Cmd+Enter saves.
- Lines that already have comments show **a dot in the left gutter**. Clicking the dot scrolls and highlights the matching entry in the right Comments tab.
- Range selection (shift+click) opens the inline input below the last line of the range.

---

## 6. Right pane (Comments / Terminal tab swap)

### 6a. Comments tab (default)

```
┌─────────────────────────────────┐
│ Comments | Terminal             │   <- tab strip
├─────────────────────────────────┤
│ [ Send All Open ↗ ]   filters ▾ │
├─────────────────────────────────┤
│ Selection (collapsed) ▶          │   <- former preview / Insert / Copy folded here
├─────────────────────────────────┤
│ Open (2)                         │
│ • docs/adr/0008-…md:43           │
│   This link is stale, …          │
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

- The `Selection` section preserves today's preview pane as a collapsible band — old flow stays available during migration.
- `Open / Sent / Resolved` mirror ADR 0007's status grouping.
- Right-pane width is drag-resizable (280–600px).

### 6b. Terminal tab

```
┌─────────────────────────────────┐
│ Comments | Terminal             │
├─────────────────────────────────┤
│ agent: claude code (running)    │
├─────────────────────────────────┤
│ $ claude code                   │
│ ▍                               │
│ > Reconcile the wireframe with  │
│   ADR 0008.                     │
│                                 │
│ I'll update the wireframe to …  │
│ ──────────────────────────────  │
│                                 │
│ (terminal full-height; PTY)     │
│                                 │
└─────────────────────────────────┘
```

- Defaults to Comments at startup. With `LOCUS_AUTOSWITCH_TERMINAL=true` the pane auto-switches to Terminal right after `Send All Open`.
- `LOCUS_RIGHT_PANE=split` shows Comments and Terminal stacked vertically (50/50 initial split, drag handle to resize).

---

## 7. Filter / Viewed-hide / search

```
Filter:
  [All ▾]                    ← dropdown for extension / status
  [search…           ]       ← path substring match
  [ ] Hide already viewed
  [ ] Hide deleted
  [ Reset ]
```

- Filter is live-applied to the file tree. Tree roots (`docs/`, `src/`, …) remain visible even when child counts drop to 0; they are greyed out and labelled `(0 files)`.
- `Reset` clears the filters but keeps Viewed checkbox state intact.

---

## 8. 1280×720 compact layout

The supported minimum (per CLAUDE.md `min-width 1280px`) compresses the side panes:

```
┌──────────────────────────────────────────────────────────────────────┐
│ < PRs  #302 …  Viewed 1/4         [Unified ▾]  ⌘B tree  ⌘J side      │
├────┬─────────────────────────────────────────────────────┬──────────┤
│ ▼  │ ▼ docs/adr/0008-…md   +312/-0   [ ]  ▲              │ Comments │
│ ▾d │   …                                                  │ Open(2)  │
│ ▾a │                                                      │ Sent(1)  │
│ 8j │ ▶ docs/wireframes/diff-…md   +180/-0   [x]  ▼        │ ─────── │
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

- The left tree switches to **icon + truncated label mode** (~60px). `⌘B` cycles full ↔ icon ↔ hidden. Implementation should make the width change immediate and avoid animating ListView row width, to prevent visible reflow jitter.
- The right pane is 280px by default and refuses to drop below 280px. `⌘J` hides the right pane entirely so the centre diff can use the full width.

---

## 9. Keybindings (new + existing)

| Key | Action |
|---|---|
| `Click` (line) | Select line (unchanged from today) |
| `Shift + Click` | Range select |
| `+` (hover icon) or `Cmd/Ctrl + N` | Open inline comment input (ADR 0007) |
| `Cmd/Ctrl + Enter` (in comment input) | Save comment |
| `Esc` (in comment input) | Cancel |
| `Cmd/Ctrl + Shift + Enter` | Send All Open (ADR 0007) |
| `V` (over a file header) | Toggle Viewed |
| `Cmd/Ctrl + B` | Cycle left tree: full / icon / hidden |
| `Cmd/Ctrl + J` | Show / hide right pane |
| `Cmd/Ctrl + Shift + U` | Toggle Unified / Side-by-side |
| `Cmd/Ctrl + Enter` (with selection) | Insert + Send (unchanged) |
| `Cmd/Ctrl + C` | Copy (unchanged) |

These must not collide with ADR 0007 keys, nor break the current `ui/app.slint::global-focus` bindings.

---

## 10. Notes

- ASCII proportions are not Slint pixel sizes; they show **structure and hierarchy**, not measurements. Implementation must respect `min-width 1280px / min-height 720px` (`ui/app.slint`) and the side-by-side / file-tree breakpoints described above.
- Draft and history are **consolidated into the Comments tab** (ADR 0007). The current standalone 300px right column is retired.
- Side-by-side line pairing uses hunk-local indices; explicit pairing fields on `DiffLineView` are deferred until a concrete need (per ADR 0008's decision).
