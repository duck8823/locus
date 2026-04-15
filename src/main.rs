//! locus composition root.
//!
//! 起動モードは argv で切り替える:
//!
//! - `cargo run` / `cargo run -- <command>` — Terminal ペインモード
//! - `cargo run -- github <owner>/<repo>#<pr_number>` — Diff viewer モード

use std::cell::RefCell;
use std::rc::Rc;

thread_local! {
    /// 同期 callback / 非同期 spawn 完了後の invoke_from_event_loop closure
    /// から共通でアクセスする DiffAppState。Slint イベントループは UI スレッド
    /// 上で動くため thread_local で十分。Rc<RefCell<>> を closure に capture
    /// すると非 Send になり spawn できないので、thread_local 経由で
    /// 取り出す形にして closure を Send に保つ。
    static DIFF_APP_STATE: RefCell<Option<Rc<RefCell<DiffAppState>>>> = const {
        RefCell::new(None)
    };
}

fn with_app_state<R>(f: impl FnOnce(&Rc<RefCell<DiffAppState>>) -> R) -> Option<R> {
    DIFF_APP_STATE.with(|cell| cell.borrow().as_ref().map(f))
}

use slint::{ComponentHandle, SharedString};

slint::include_modules!();

mod github;
mod i18n;
mod review;
mod semantic;
mod terminal;
mod ui_state;

use github::issue_context::{
    extract_linked_issue_numbers, fetch_issue_context_async, IssueContextRecord, IssueState,
};
use github::pull_request::{
    build_client, fetch_pr_snapshot, fetch_pull_requests, parse_pr_spec, PrListFilter,
    PrListState, PullRequestFile, PullRequestSnapshot, PullRequestSummary,
};
use review::draft::{DraftEntry, PromptDraft, SendMode};
use review::formatter::{format_prompt, FileSourceEntry};
use review::selection::{Granularity, SelectionAnchor, Side};
use review::snapshot::FileId;
use ui_state::diff_view::build_diff_file_views;
use ui_state::draft_view::{anchor_label, build_draft_entry_views, side_from_line_kind};

fn main() -> Result<(), Box<dyn std::error::Error>> {
    // i18n を最初に初期化する。LANG が未設定なら locus 既定の ja に揃える。
    let _ = i18n::init_from_env();

    let args: Vec<String> = std::env::args().skip(1).collect();

    match args.as_slice() {
        [mode, spec] if mode == "github" => run_diff_viewer(spec),
        [command] => run_terminal(command),
        [] => run_terminal("claude"),
        _ => {
            eprintln!("Usage:");
            eprintln!("  locus                          # terminal pane (claude)");
            eprintln!("  locus <command>                # terminal pane (custom cmd)");
            eprintln!("  locus github <owner>/<repo>#<pr_number>");
            std::process::exit(2);
        }
    }
}

fn run_terminal(command: &str) -> Result<(), Box<dyn std::error::Error>> {
    let ui = AppWindow::new()?;
    let _pane = terminal::launch(&ui, command)?;
    ui.run()?;
    Ok(())
}

/// 送信履歴の 1 エントリ。セッション内にのみ保持される。
#[derive(Debug, Clone)]
struct HistoryEntry {
    timestamp: String,
    mode: SendMode,
    anchors_label: String,
    #[allow(dead_code)]
    body: String,
}

/// Diff viewer mode 用の状態。Slint の複数コールバックから共有する。
///
/// `client` / `runtime` は live モードでのみ使う。テストでは make_state が
/// None を入れ、PR 切替や issue fetch を呼ばないテストだけが実行可能。
struct DiffAppState {
    owner: String,
    repo: String,
    snapshot: PullRequestSnapshot,
    draft: PromptDraft,
    current_anchor: Option<SelectionAnchor>,
    pending_range: bool,
    history: Vec<HistoryEntry>,
    client: Option<std::sync::Arc<octocrab::Octocrab>>,
    runtime: Option<tokio::runtime::Handle>,
    /// PR snapshot 切替の世代カウンタ。PR 切替と起動 hydrate で +1。
    /// PR list filter とは独立して進める (filter 変更で snapshot 結果を
    /// 破棄しないため)。
    snapshot_generation: u64,
    /// PR list filter の世代カウンタ。
    list_generation: u64,
}

impl DiffAppState {
    fn file(&self, index: usize) -> Option<&PullRequestFile> {
        self.snapshot.files.get(index)
    }

    fn set_anchor(&mut self, anchor: SelectionAnchor) {
        self.current_anchor = Some(anchor);
        self.pending_range = false;
    }

    fn start_range_mode(&mut self) {
        // range モードは「すでに Line 選択がある状態」で Range への昇格を宣言する。
        self.pending_range = true;
    }

    /// 現在の anchor と引数の line を使って Range 選択を作る。
    ///
    /// file_id を受け取り、現在の anchor と同じ file の場合にのみ Range 昇格する。
    /// 別 file の行がクリックされた場合や、side が異なる場合、pending は解除して
    /// anchor は変更しない。
    fn complete_range(&mut self, file_id: &FileId, line: u32, side: Side) {
        let Some(current) = self.current_anchor.clone() else {
            self.pending_range = false;
            return;
        };
        if current.file_id != *file_id {
            // 別 file をクリックした場合は pending を解除してその行の Line 選択にする。
            self.pending_range = false;
            return;
        }
        let Granularity::Line {
            line: start_line,
            side: start_side,
        } = current.granularity
        else {
            self.pending_range = false;
            return;
        };
        if start_side != side {
            self.pending_range = false;
            return;
        }
        let (from, to) = if start_line <= line {
            (start_line, line)
        } else {
            (line, start_line)
        };
        self.current_anchor = Some(SelectionAnchor {
            file_id: current.file_id,
            file_path: current.file_path,
            granularity: Granularity::Range {
                start_line: from,
                end_line: to,
                side,
            },
        });
        self.pending_range = false;
    }

    /// 選択中のファイルが変わったとき、進行中の range 作成を解除する。
    fn cancel_range_on_file_switch(&mut self) {
        self.pending_range = false;
    }

    /// snapshot 切替の世代を進めて返す。
    fn next_snapshot_generation(&mut self) -> u64 {
        self.snapshot_generation = self.snapshot_generation.wrapping_add(1);
        self.snapshot_generation
    }

    fn is_stale_snapshot(&self, captured: u64) -> bool {
        captured != self.snapshot_generation
    }

    fn next_list_generation(&mut self) -> u64 {
        self.list_generation = self.list_generation.wrapping_add(1);
        self.list_generation
    }

    fn is_stale_list(&self, captured: u64) -> bool {
        captured != self.list_generation
    }
}

fn run_diff_viewer(spec: &str) -> Result<(), Box<dyn std::error::Error>> {
    let (owner, repo, pr_number) = parse_pr_spec(spec)
        .ok_or_else(|| format!("invalid PR spec: {spec} (expected owner/repo#N)"))?;

    let runtime = tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .build()?;
    let runtime_handle = runtime.handle().clone();

    // 起動を「ネットワーク待ち」にしないため、最初に空の DiffViewerWindow を
    // 作って表示し、PR snapshot / PR list / linked issues は非同期 hydrate
    // する。GitHub クライアントの初期化失敗のみ即時エラーで abort。
    let client_arc = build_client()?;

    let placeholder_snapshot = PullRequestSnapshot {
        target: review::target::ReviewTarget::GitHubPr {
            owner: owner.clone(),
            repo: repo.clone(),
            pr_number,
        },
        title: i18n::tr("(loading…)"),
        body: None,
        head_sha: String::new(),
        base_sha: String::new(),
        files: Vec::new(),
    };

    let ui = DiffViewerWindow::new()?;
    apply_snapshot_to_ui(&ui, &placeholder_snapshot, &[]);
    ui.set_current_pr_number(pr_number as i32);
    ui.set_pr_list(build_pr_list_model(&[]));
    ui.set_pr_list_filter(0);
    ui.set_pr_list_loading(true);

    let state = Rc::new(RefCell::new(DiffAppState {
        owner: owner.clone(),
        repo: repo.clone(),
        snapshot: placeholder_snapshot,
        draft: PromptDraft::new(),
        current_anchor: None,
        pending_range: false,
        history: Vec::new(),
        client: Some(client_arc.clone()),
        runtime: Some(runtime_handle.clone()),
        snapshot_generation: 0,
        list_generation: 0,
    }));
    DIFF_APP_STATE.with(|cell| *cell.borrow_mut() = Some(state.clone()));

    // Terminal pane を立ち上げる。起動コマンドは LOCUS_AGENT_CMD 環境変数で
    // 上書きできる（既定は claude）。
    let agent_cmd =
        std::env::var("LOCUS_AGENT_CMD").unwrap_or_else(|_| "claude".to_string());
    let terminal_pane = match terminal::launch_for_diff_viewer(&ui, &agent_cmd) {
        Ok(p) => {
            ui.set_terminal_available(true);
            ui.set_terminal_status(SharedString::from(i18n::tr_args(
                "{} (running)",
                &[agent_cmd.as_str()],
            )));
            Some(Rc::new(p))
        }
        Err(e) => {
            eprintln!(
                "warn: failed to launch terminal pane with '{agent_cmd}': {e} (continuing without terminal)"
            );
            ui.set_terminal_available(false);
            let err = e.to_string();
            ui.set_terminal_status(SharedString::from(i18n::tr_args(
                "{}: failed to start ({})",
                &[agent_cmd.as_str(), err.as_str()],
            )));
            None
        }
    };

    refresh_current_anchor_label(&ui, &state);
    refresh_draft_panel(&ui, &state);
    refresh_history_panel(&ui, &state);
    refresh_preview(&ui, &state);

    // select-line
    {
        let state = state.clone();
        let ui_weak = ui.as_weak();
        ui.on_select_line(move |file_index, line_kind, old_no_str, new_no_str| {
            let Some(ui) = ui_weak.upgrade() else { return };
            let line = resolve_line_number(line_kind, &old_no_str, &new_no_str);
            let side = side_from_line_kind(line_kind);
            let mut st = state.borrow_mut();
            let Some(file) = st.file(file_index as usize).cloned() else {
                return;
            };
            let file_id = FileId::new(file.file_path.clone());
            if st.pending_range {
                // 現在の anchor と同じ file か 判定
                let same_file = st
                    .current_anchor
                    .as_ref()
                    .map(|a| a.file_id == file_id)
                    .unwrap_or(false);
                if same_file {
                    st.complete_range(&file_id, line, side);
                } else {
                    // 別 file をクリックしたので pending を解除して Line 選択に切り替える
                    st.pending_range = false;
                    st.set_anchor(SelectionAnchor {
                        file_id,
                        file_path: file.file_path,
                        granularity: Granularity::Line { line, side },
                    });
                }
            } else {
                st.set_anchor(SelectionAnchor {
                    file_id,
                    file_path: file.file_path,
                    granularity: Granularity::Line { line, side },
                });
            }
            drop(st);
            refresh_current_anchor_label(&ui, &state);
        });
    }

    // select-hunk
    {
        let state = state.clone();
        let ui_weak = ui.as_weak();
        ui.on_select_hunk(move |file_index, hunk_index| {
            let Some(ui) = ui_weak.upgrade() else { return };
            let mut st = state.borrow_mut();
            let Some(file) = st.file(file_index as usize).cloned() else {
                return;
            };
            st.set_anchor(SelectionAnchor {
                file_id: FileId::new(file.file_path.clone()),
                file_path: file.file_path,
                granularity: Granularity::Hunk {
                    hunk_index: hunk_index as usize,
                },
            });
            drop(st);
            refresh_current_anchor_label(&ui, &state);
        });
    }

    // select-whole-file
    {
        let state = state.clone();
        let ui_weak = ui.as_weak();
        ui.on_select_whole_file(move || {
            let Some(ui) = ui_weak.upgrade() else { return };
            let file_index = ui.get_selected_file_index() as usize;
            let mut st = state.borrow_mut();
            let Some(file) = st.file(file_index).cloned() else {
                return;
            };
            st.set_anchor(SelectionAnchor {
                file_id: FileId::new(file.file_path.clone()),
                file_path: file.file_path,
                granularity: Granularity::File,
            });
            drop(st);
            refresh_current_anchor_label(&ui, &state);
        });
    }

    // extend-to-range
    {
        let state = state.clone();
        let ui_weak = ui.as_weak();
        ui.on_extend_to_range(move || {
            let Some(ui) = ui_weak.upgrade() else { return };
            state.borrow_mut().start_range_mode();
            refresh_current_anchor_label(&ui, &state);
        });
    }

    // add-to-draft
    {
        let state = state.clone();
        let ui_weak = ui.as_weak();
        ui.on_add_to_draft(move |note: SharedString| {
            let Some(ui) = ui_weak.upgrade() else { return };
            let mut st = state.borrow_mut();
            let Some(anchor) = st.current_anchor.clone() else {
                return;
            };
            let note_trimmed = note.trim();
            let note_opt = if note_trimmed.is_empty() {
                None
            } else {
                Some(note_trimmed.to_string())
            };
            st.draft.push(DraftEntry::new(anchor, note_opt));
            drop(st);
            refresh_draft_panel(&ui, &state);
        });
    }

    // remove-draft-entry
    {
        let state = state.clone();
        let ui_weak = ui.as_weak();
        ui.on_remove_draft_entry(move |index: i32| {
            let Some(ui) = ui_weak.upgrade() else { return };
            state.borrow_mut().draft.remove(index as usize);
            refresh_draft_panel(&ui, &state);
        });
    }

    // clear-current-selection
    {
        let state = state.clone();
        let ui_weak = ui.as_weak();
        ui.on_clear_current_selection(move || {
            let Some(ui) = ui_weak.upgrade() else { return };
            let mut st = state.borrow_mut();
            st.current_anchor = None;
            st.pending_range = false;
            drop(st);
            refresh_current_anchor_label(&ui, &state);
        });
    }

    // file-switched: pending_range を解除する
    {
        let state = state.clone();
        let ui_weak = ui.as_weak();
        ui.on_file_switched(move |_| {
            let Some(ui) = ui_weak.upgrade() else { return };
            state.borrow_mut().cancel_range_on_file_switch();
            refresh_current_anchor_label(&ui, &state);
        });
    }

    // refresh-preview
    {
        let state = state.clone();
        let ui_weak = ui.as_weak();
        ui.on_refresh_preview(move || {
            let Some(ui) = ui_weak.upgrade() else { return };
            refresh_preview(&ui, &state);
        });
    }

    // send-insert-only
    {
        let state = state.clone();
        let ui_weak = ui.as_weak();
        let pane = terminal_pane.clone();
        ui.on_send_insert_only(move |text: SharedString| {
            let Some(ui) = ui_weak.upgrade() else { return };
            // terminal pane が無い場合は何もしない（UI 側で button も無効化
            // されているが保険として弾く）。
            let Some(p) = pane.as_ref() else {
                return;
            };
            p.insert(text.as_str());
            append_history(&state, SendMode::InsertOnly, text.as_str());
            refresh_history_panel(&ui, &state);
        });
    }

    // send-insert-and-send
    {
        let state = state.clone();
        let ui_weak = ui.as_weak();
        let pane = terminal_pane.clone();
        ui.on_send_insert_and_send(move |text: SharedString| {
            let Some(ui) = ui_weak.upgrade() else { return };
            let Some(p) = pane.as_ref() else {
                return;
            };
            p.insert_and_send(text.as_str());
            append_history(&state, SendMode::InsertAndSend, text.as_str());
            refresh_history_panel(&ui, &state);
        });
    }

    // send-copy-to-clipboard
    {
        let state = state.clone();
        let ui_weak = ui.as_weak();
        ui.on_send_copy_to_clipboard(move |text: SharedString| {
            let Some(ui) = ui_weak.upgrade() else { return };
            if let Ok(mut cb) = arboard::Clipboard::new() {
                let _ = cb.set_text(text.to_string());
            }
            append_history(&state, SendMode::CopyToClipboard, text.as_str());
            refresh_history_panel(&ui, &state);
        });
    }

    // pr-clicked: 別 PR に切り替える（draft はクリア）
    //
    // UI スレッドをブロックしないように、network 部分は tokio に spawn し、
    // 完了したら invoke_from_event_loop で UI スレッドに戻ってモデルを
    // 更新する。state (Rc<RefCell<>>) は Send ではないので spawn 内では
    // 触らず、完了後の closure 内でだけ触る。
    //
    // 高速に PR を切り替えた場合に古い応答が新しい応答を上書きしないよう、
    // task 開始時の世代を capture し、UI 更新前に現在の世代と照合する。
    {
        let state = state.clone();
        let ui_weak = ui.as_weak();
        ui.on_pr_clicked(move |new_pr_number: i32| {
            let Some(ui) = ui_weak.upgrade() else { return };
            let new_number = new_pr_number as u64;
            let (owner, repo, client_opt, runtime_opt, snap_gen) = {
                let mut st = state.borrow_mut();
                (
                    st.owner.clone(),
                    st.repo.clone(),
                    st.client.clone(),
                    st.runtime.clone(),
                    st.next_snapshot_generation(),
                )
            };
            let (Some(client), Some(runtime)) = (client_opt, runtime_opt) else {
                return;
            };
            let weak_for_task = ui.as_weak();
            runtime.spawn(async move {
                let snapshot_res =
                    fetch_pr_snapshot(&client, &owner, &repo, new_number).await;
                let snapshot = match snapshot_res {
                    Ok(s) => s,
                    Err(e) => {
                        eprintln!("warn: failed to fetch PR #{new_number}: {e}");
                        return;
                    }
                };
                // linked issues は join_all で並列 fetch
                let body = snapshot.body.clone().unwrap_or_default();
                let numbers = extract_linked_issue_numbers(&body);
                let linked = fetch_linked_issues_parallel(
                    &client, &owner, &repo, &numbers,
                )
                .await;
                let _ = slint::invoke_from_event_loop(move || {
                    let Some(ui) = weak_for_task.upgrade() else { return };
                    let stale = with_app_state(|state| {
                        state.borrow().is_stale_snapshot(snap_gen)
                    })
                    .unwrap_or(true);
                    if stale {
                        return;
                    }
                    apply_snapshot_to_ui(&ui, &snapshot, &linked);
                    ui.set_current_pr_number(new_pr_number);
                    with_app_state(|state| {
                        {
                            let mut st = state.borrow_mut();
                            st.snapshot = snapshot;
                            st.draft.clear();
                            st.current_anchor = None;
                            st.pending_range = false;
                        }
                        refresh_current_anchor_label(&ui, state);
                        refresh_draft_panel(&ui, state);
                        refresh_preview(&ui, state);
                    });
                });
            });
        });
    }

    // pr-filter-changed: 一覧を再取得（UI ブロックなし）
    {
        let state = state.clone();
        let ui_weak = ui.as_weak();
        ui.on_pr_filter_changed(move |filter_int: i32| {
            let Some(ui) = ui_weak.upgrade() else { return };
            let filter = match filter_int {
                0 => PrListFilter::Open,
                1 => PrListFilter::Closed,
                _ => PrListFilter::All,
            };
            let (owner, repo, client_opt, runtime_opt, list_gen) = {
                let mut st = state.borrow_mut();
                (
                    st.owner.clone(),
                    st.repo.clone(),
                    st.client.clone(),
                    st.runtime.clone(),
                    st.next_list_generation(),
                )
            };
            let (Some(client), Some(runtime)) = (client_opt, runtime_opt) else {
                return;
            };
            ui.set_pr_list_loading(true);
            let weak_for_task = ui.as_weak();
            runtime.spawn(async move {
                let summaries = fetch_pull_requests(&client, &owner, &repo, filter)
                    .await
                    .unwrap_or_default();
                let _ = slint::invoke_from_event_loop(move || {
                    let stale = with_app_state(|state| {
                        state.borrow().is_stale_list(list_gen)
                    })
                    .unwrap_or(true);
                    if stale {
                        return;
                    }
                    if let Some(ui) = weak_for_task.upgrade() {
                        ui.set_pr_list_loading(false);
                        ui.set_pr_list(build_pr_list_model(&summaries));
                    }
                });
            });
        });
    }

    // 初期 hydrate: PR snapshot / PR list / linked issues を並列で取得し、
    // 完了後に UI を埋める。snapshot と list を別の世代で管理することで、
    // 起動 hydrate 中に user が filter を切り替えても snapshot 結果が
    // 破棄されない。
    {
        let (snap_gen, list_gen) = {
            let mut st = state.borrow_mut();
            (st.next_snapshot_generation(), st.next_list_generation())
        };
        let owner_clone = owner.clone();
        let repo_clone = repo.clone();
        let client_clone = client_arc.clone();
        let weak_for_task = ui.as_weak();
        runtime_handle.spawn(async move {
            // PR snapshot と PR list を join! で並列実行
            let snapshot_fut =
                fetch_pr_snapshot(&client_clone, &owner_clone, &repo_clone, pr_number);
            let list_fut = fetch_pull_requests(
                &client_clone,
                &owner_clone,
                &repo_clone,
                PrListFilter::Open,
            );
            let (snapshot_res, list_res) = tokio::join!(snapshot_fut, list_fut);

            // PR list は snapshot 完了を待たずに先に hydrate する
            let pr_list = list_res.unwrap_or_default();
            {
                let weak = weak_for_task.clone();
                let _ = slint::invoke_from_event_loop(move || {
                    let stale = with_app_state(|state| state.borrow().is_stale_list(list_gen))
                        .unwrap_or(true);
                    if stale {
                        return;
                    }
                    if let Some(ui) = weak.upgrade() {
                        ui.set_pr_list_loading(false);
                        ui.set_pr_list(build_pr_list_model(&pr_list));
                    }
                });
            }

            let snapshot = match snapshot_res {
                Ok(s) => s,
                Err(e) => {
                    eprintln!("warn: initial hydrate snapshot failed: {e}");
                    return;
                }
            };
            // linked issues を並列 fetch
            let body = snapshot.body.clone().unwrap_or_default();
            let numbers = extract_linked_issue_numbers(&body);
            let linked = fetch_linked_issues_parallel(
                &client_clone,
                &owner_clone,
                &repo_clone,
                &numbers,
            )
            .await;

            let _ = slint::invoke_from_event_loop(move || {
                let stale = with_app_state(|state| {
                    state.borrow().is_stale_snapshot(snap_gen)
                })
                .unwrap_or(true);
                if stale {
                    return;
                }
                let Some(ui) = weak_for_task.upgrade() else { return };
                apply_snapshot_to_ui(&ui, &snapshot, &linked);
                with_app_state(|state| {
                    state.borrow_mut().snapshot = snapshot;
                });
            });
        });
    }

    ui.run()?;
    drop(terminal_pane);
    Ok(())
}

fn apply_snapshot_to_ui(
    ui: &DiffViewerWindow,
    snapshot: &PullRequestSnapshot,
    linked_issues: &[LinkedIssueDisplay],
) {
    ui.set_pr_title(SharedString::from(snapshot.title.as_str()));
    ui.set_head_sha(SharedString::from(short_sha(&snapshot.head_sha)));
    ui.set_base_sha(SharedString::from(short_sha(&snapshot.base_sha)));
    ui.set_pr_body_excerpt(SharedString::from(excerpt(
        snapshot.body.as_deref().unwrap_or(""),
        180,
    )));
    ui.set_linked_issues(build_issue_context_model(linked_issues));

    let file_views = build_diff_file_views(&snapshot.files);
    let model = std::rc::Rc::new(slint::VecModel::from(file_views));
    ui.set_files(slint::ModelRc::from(model));
    ui.set_selected_file_index(0);
}

fn build_pr_list_model(
    summaries: &[PullRequestSummary],
) -> slint::ModelRc<PullRequestListItemView> {
    let model = slint::VecModel::<PullRequestListItemView>::default();
    for s in summaries {
        let state_label = match s.state {
            PrListState::Open => "open",
            PrListState::Closed => "closed",
        };
        model.push(PullRequestListItemView {
            number: s.number as i32,
            number_label: SharedString::from(format!("#{}", s.number)),
            title: SharedString::from(s.title.as_str()),
            author: SharedString::from(s.author.as_str()),
            updated_excerpt: SharedString::from(s.updated_at.as_str()),
            state: SharedString::from(state_label),
        });
    }
    slint::ModelRc::from(
        std::rc::Rc::new(model)
            as std::rc::Rc<dyn slint::Model<Data = PullRequestListItemView>>,
    )
}

fn refresh_current_anchor_label(ui: &DiffViewerWindow, state: &Rc<RefCell<DiffAppState>>) {
    let st = state.borrow();
    let label = match &st.current_anchor {
        Some(a) => {
            let base = anchor_label(a);
            if st.pending_range {
                format!("{base}{}", i18n::tr("  [range mode: click end line]"))
            } else {
                base
            }
        }
        None => i18n::tr("(no selection)"),
    };
    ui.set_current_anchor_label(SharedString::from(label));
}

fn refresh_draft_panel(ui: &DiffViewerWindow, state: &Rc<RefCell<DiffAppState>>) {
    let st = state.borrow();
    ui.set_draft_entries(build_draft_entry_views(&st.draft));
}

fn refresh_history_panel(ui: &DiffViewerWindow, state: &Rc<RefCell<DiffAppState>>) {
    let st = state.borrow();
    let model = slint::VecModel::<HistoryEntryView>::default();
    // 新しい順
    for entry in st.history.iter().rev() {
        model.push(HistoryEntryView {
            timestamp: SharedString::from(entry.timestamp.as_str()),
            mode: SharedString::from(send_mode_label(entry.mode)),
            label: SharedString::from(entry.anchors_label.as_str()),
        });
    }
    ui.set_history_entries(slint::ModelRc::from(
        std::rc::Rc::new(model) as std::rc::Rc<dyn slint::Model<Data = HistoryEntryView>>,
    ));
}

fn refresh_preview(ui: &DiffViewerWindow, state: &Rc<RefCell<DiffAppState>>) {
    let st = state.borrow();
    let entries: Vec<FileSourceEntry<'_>> = st
        .snapshot
        .files
        .iter()
        .map(|f| FileSourceEntry {
            file_id: &f.file_id,
            file_path: f.file_path.as_str(),
            before_content: f.before_content.as_deref(),
            after_content: f.after_content.as_deref(),
        })
        .collect();
    let text = format_prompt(&st.draft, &entries);
    ui.set_preview_text(SharedString::from(text));
}

fn append_history(state: &Rc<RefCell<DiffAppState>>, mode: SendMode, body: &str) {
    let mut st = state.borrow_mut();
    let anchors_label = if st.draft.is_empty() {
        i18n::tr("(edited preview)")
    } else {
        let count = st.draft.len();
        let head = st.draft.entries().first().map(|e| anchor_label(&e.anchor));
        match head {
            Some(h) if count == 1 => h,
            Some(h) => {
                let extra = (count - 1).to_string();
                format!("{h} {}", i18n::tr_args("+{} more", &[extra.as_str()]))
            }
            None => i18n::tr("(empty)"),
        }
    };
    let timestamp = current_hhmmss();
    st.history.push(HistoryEntry {
        timestamp,
        mode,
        anchors_label,
        body: body.to_string(),
    });
}

fn send_mode_label(mode: SendMode) -> String {
    let key = match mode {
        SendMode::InsertOnly => "Insert",
        SendMode::InsertAndSend => "Insert+Send",
        SendMode::CopyToClipboard => "Copy",
    };
    i18n::tr(key)
}

fn current_hhmmss() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let h = (secs / 3600) % 24;
    let m = (secs / 60) % 60;
    let s = secs % 60;
    format!("{h:02}:{m:02}:{s:02}")
}

fn resolve_line_number(line_kind: i32, old_no: &str, new_no: &str) -> u32 {
    // Removed 行は old 側を、それ以外は new 側を優先する。
    // number が取れなければ old→new→0 のフォールバックでゼロ埋め。
    let prefer_old = line_kind == 2;
    let a = if prefer_old { old_no } else { new_no };
    let b = if prefer_old { new_no } else { old_no };
    a.parse::<u32>()
        .ok()
        .or_else(|| b.parse::<u32>().ok())
        .unwrap_or(0)
}

fn short_sha(sha: &str) -> String {
    sha.chars().take(7).collect()
}

fn excerpt(body: &str, max_chars: usize) -> String {
    let trimmed = body.trim();
    if trimmed.is_empty() {
        return String::new();
    }
    // 最初の空行までを1段落として扱い、さらに長さを切り詰める
    let first_paragraph = trimmed
        .split("\n\n")
        .next()
        .unwrap_or("")
        .replace('\n', " ");
    if first_paragraph.chars().count() <= max_chars {
        first_paragraph
    } else {
        let mut out: String = first_paragraph.chars().take(max_chars).collect();
        out.push('…');
        out
    }
}

enum LinkedIssueDisplay {
    Found(IssueContextRecord),
    /// 取得失敗。404 と PR が返ったケースは静かに隠すため LinkedIssueDisplay
    /// に乗せない。本バリアントは認証エラー / rate limit / 5xx 等の non-2xx。
    Failed { number: u64, message: String },
}

/// linked issue 番号一覧を受け取り、各 issue を tokio::spawn 系で並列 fetch
/// する。`octocrab::Octocrab` は内部で reqwest クライアントを共有しているので
/// 数件の concurrent 呼び出しは安全。
async fn fetch_linked_issues_parallel(
    client: &octocrab::Octocrab,
    owner: &str,
    repo: &str,
    numbers: &[u64],
) -> Vec<LinkedIssueDisplay> {
    use futures::stream::{FuturesUnordered, StreamExt};

    let mut futs: FuturesUnordered<_> = numbers
        .iter()
        .copied()
        .map(|n| {
            let client = client.clone();
            let owner = owner.to_string();
            let repo = repo.to_string();
            async move {
                let res = fetch_issue_context_async(&client, &owner, &repo, n).await;
                (n, res)
            }
        })
        .collect();

    let mut out: Vec<LinkedIssueDisplay> = Vec::new();
    while let Some((n, res)) = futs.next().await {
        match res {
            Ok(Some(r)) => out.push(LinkedIssueDisplay::Found(r)),
            Ok(None) => {}
            Err(e) => out.push(LinkedIssueDisplay::Failed {
                number: n,
                message: e.to_string(),
            }),
        }
    }
    // 並列実行の完了順は不定なので number でソートして決定論的にする
    out.sort_by_key(|d| match d {
        LinkedIssueDisplay::Found(r) => r.number,
        LinkedIssueDisplay::Failed { number, .. } => *number,
    });
    out
}

fn build_issue_context_model(
    records: &[LinkedIssueDisplay],
) -> slint::ModelRc<IssueContextView> {
    let model = slint::VecModel::<IssueContextView>::default();
    for entry in records {
        match entry {
            LinkedIssueDisplay::Found(r) => {
                let state = match r.state {
                    IssueState::Open => "open",
                    IssueState::Closed => "closed",
                };
                model.push(IssueContextView {
                    number: SharedString::from(format!("#{}", r.number)),
                    title: SharedString::from(r.title.as_str()),
                    state: SharedString::from(state),
                    body_excerpt: SharedString::from(excerpt(
                        r.body.as_deref().unwrap_or(""),
                        140,
                    )),
                });
            }
            LinkedIssueDisplay::Failed { number, message } => {
                model.push(IssueContextView {
                    number: SharedString::from(format!("#{number}")),
                    title: SharedString::from(i18n::tr("(failed to fetch)")),
                    state: SharedString::from("error"),
                    body_excerpt: SharedString::from(message.as_str()),
                });
            }
        }
    }
    slint::ModelRc::from(
        std::rc::Rc::new(model) as std::rc::Rc<dyn slint::Model<Data = IssueContextView>>,
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::github::pull_request::{FileStatus, PullRequestFile};
    use crate::review::snapshot::{FileId, UnsupportedFile};
    use crate::review::target::ReviewTarget;

    fn make_state() -> DiffAppState {
        let snapshot = PullRequestSnapshot {
            target: ReviewTarget::GitHubPr {
                owner: "o".into(),
                repo: "r".into(),
                pr_number: 1,
            },
            title: "t".into(),
            body: None,
            head_sha: "abcdefg".into(),
            base_sha: "0000000".into(),
            files: vec![PullRequestFile {
                file_id: FileId::new("a.rs"),
                file_path: "a.rs".into(),
                status: FileStatus::Modified,
                before_content: Some("a\nb\n".into()),
                after_content: Some("a\nB\n".into()),
                patch: None,
                is_binary: false,
                unsupported: None::<UnsupportedFile>,
            }],
        };
        DiffAppState {
            owner: "o".into(),
            repo: "r".into(),
            snapshot,
            draft: PromptDraft::new(),
            current_anchor: None,
            pending_range: false,
            history: Vec::new(),
            client: None,
            runtime: None,
            snapshot_generation: 0,
        list_generation: 0,
        }
    }

    #[test]
    fn set_anchor_clears_pending_range() {
        let mut st = make_state();
        st.pending_range = true;
        st.set_anchor(SelectionAnchor {
            file_id: FileId::new("a.rs"),
            file_path: "a.rs".into(),
            granularity: Granularity::File,
        });
        assert!(!st.pending_range);
        assert!(st.current_anchor.is_some());
    }

    #[test]
    fn start_range_mode_sets_pending() {
        let mut st = make_state();
        st.start_range_mode();
        assert!(st.pending_range);
    }

    #[test]
    fn complete_range_from_line_to_range() {
        let mut st = make_state();
        st.set_anchor(SelectionAnchor {
            file_id: FileId::new("a.rs"),
            file_path: "a.rs".into(),
            granularity: Granularity::Line {
                line: 3,
                side: Side::After,
            },
        });
        st.start_range_mode();
        st.complete_range(&FileId::new("a.rs"), 7, Side::After);
        match &st.current_anchor.as_ref().unwrap().granularity {
            Granularity::Range {
                start_line,
                end_line,
                side,
            } => {
                assert_eq!(*start_line, 3);
                assert_eq!(*end_line, 7);
                assert_eq!(*side, Side::After);
            }
            _ => panic!("expected Range"),
        }
        assert!(!st.pending_range);
    }

    #[test]
    fn complete_range_reverses_when_end_before_start() {
        let mut st = make_state();
        st.set_anchor(SelectionAnchor {
            file_id: FileId::new("a.rs"),
            file_path: "a.rs".into(),
            granularity: Granularity::Line {
                line: 7,
                side: Side::Before,
            },
        });
        st.start_range_mode();
        st.complete_range(&FileId::new("a.rs"), 3, Side::Before);
        match &st.current_anchor.as_ref().unwrap().granularity {
            Granularity::Range {
                start_line,
                end_line,
                ..
            } => {
                assert_eq!(*start_line, 3);
                assert_eq!(*end_line, 7);
            }
            _ => panic!("expected Range"),
        }
    }

    #[test]
    fn snapshot_generation_increments_and_detects_stale() {
        let mut st = make_state();
        let g1 = st.next_snapshot_generation();
        let g2 = st.next_snapshot_generation();
        assert_ne!(g1, g2);
        assert!(st.is_stale_snapshot(g1));
        assert!(!st.is_stale_snapshot(g2));
    }

    #[test]
    fn list_generation_independent_from_snapshot() {
        let mut st = make_state();
        let snap_gen = st.next_snapshot_generation();
        let list_gen = st.next_list_generation();
        // list を進めても snapshot 側の生世代は変わらない
        assert!(!st.is_stale_snapshot(snap_gen));
        assert!(!st.is_stale_list(list_gen));
        // list を更に進めると古い list_gen は stale だが snapshot は無事
        let list_gen2 = st.next_list_generation();
        assert!(st.is_stale_list(list_gen));
        assert!(!st.is_stale_list(list_gen2));
        assert!(!st.is_stale_snapshot(snap_gen));
    }

    #[test]
    fn complete_range_aborts_when_file_differs() {
        let mut st = make_state();
        st.set_anchor(SelectionAnchor {
            file_id: FileId::new("a.rs"),
            file_path: "a.rs".into(),
            granularity: Granularity::Line {
                line: 3,
                side: Side::After,
            },
        });
        st.start_range_mode();
        // 別 file 由来のクリック
        st.complete_range(&FileId::new("b.rs"), 7, Side::After);
        // file 不一致なので pending は解除、anchor は元のまま
        assert!(!st.pending_range);
        match &st.current_anchor.as_ref().unwrap().granularity {
            Granularity::Line { line: 3, .. } => {}
            _ => panic!("expected Line(3) unchanged"),
        }
    }

    #[test]
    fn complete_range_aborts_across_sides() {
        let mut st = make_state();
        st.set_anchor(SelectionAnchor {
            file_id: FileId::new("a.rs"),
            file_path: "a.rs".into(),
            granularity: Granularity::Line {
                line: 3,
                side: Side::After,
            },
        });
        st.start_range_mode();
        st.complete_range(&FileId::new("a.rs"), 7, Side::Before);
        // side が違うので Range 昇格はされず、現在の anchor は維持される
        match &st.current_anchor.as_ref().unwrap().granularity {
            Granularity::Line { line: 3, .. } => {}
            _ => panic!("expected Line unchanged"),
        }
        assert!(!st.pending_range);
    }

    #[test]
    fn resolve_line_number_prefers_old_for_removed() {
        assert_eq!(resolve_line_number(2, "10", "11"), 10);
    }

    #[test]
    fn resolve_line_number_prefers_new_for_added() {
        assert_eq!(resolve_line_number(1, "10", "11"), 11);
    }

    #[test]
    fn resolve_line_number_falls_back_to_other_side() {
        assert_eq!(resolve_line_number(1, "10", ""), 10);
        assert_eq!(resolve_line_number(2, "", "11"), 11);
    }

    #[test]
    fn short_sha_truncates_to_seven_chars() {
        assert_eq!(short_sha("abcdef1234567890"), "abcdef1");
    }

    #[test]
    fn short_sha_of_short_input_is_itself() {
        assert_eq!(short_sha("abc"), "abc");
    }
}
