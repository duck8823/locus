//! PullRequestSnapshot / linked issues / PR list を Slint UI モデルに反映する
//! 純粋ヘルパ群 (#224 step 3)。
//!
//! いずれも `&DiffViewerWindow` または slice 引数だけを受け取り、
//! DIFF_APP_STATE thread_local には触れない。状態を持つ UI 更新や副作用は
//! `refresh` / `toast` module に分離している。

use slint::{ModelRc, SharedString, VecModel};

use crate::github::issue_context::{IssueContextRecord, IssueState};
use crate::github::pull_request::{
    PrListState, PullRequestFile, PullRequestSnapshot, PullRequestSummary,
};
use crate::semantic::{
    ArchitectureNodeKind, ChangeType, SymbolKind, analyze_pull_request_file,
    build_architecture_nodes,
};
use crate::ui_state::diff_view::build_diff_file_views;
use crate::{
    ArchitectureNodeView, DiffViewerWindow, IssueContextView, PullRequestListItemView,
    SemanticItemView,
};

use super::util::{excerpt, short_sha};

/// linked issue の取得結果。
pub(crate) enum LinkedIssueDisplay {
    Found(IssueContextRecord),
    /// 取得失敗。404 と PR が返ったケースは静かに隠すため LinkedIssueDisplay
    /// に乗せない。本バリアントは認証エラー / rate limit / 5xx 等の non-2xx。
    Failed { number: u64, message: String },
}

/// PR snapshot の中身を DiffViewerWindow に流し込む。selected-file-index は 0 に
/// リセット、scroll cache 引きずり防止のため diff-scroll-y も 0 に戻す。
/// 状態 (DiffAppState) 側のクリアは呼び出し側責務。
pub(crate) fn apply_snapshot_to_ui(
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
    let model = std::rc::Rc::new(VecModel::from(file_views));
    ui.set_files(ModelRc::from(model));
    ui.set_selected_file_index(0);
    ui.set_diff_scroll_y(0.0);
    ui.set_semantic_items(build_semantic_items_model(&snapshot.files));
    ui.set_architecture_nodes(build_architecture_nodes_model(&snapshot.files));
}

/// Architecture mini-map (#208) のノード列を Slint Model に詰め直す。
///
/// `file_index` は usize → i32。PR_FILE 数は実用的な範囲で i32 に収まる
/// 想定なので、unwrap_or(-1) と as i32 で外部 / 解決不可ノードを表現する。
pub(crate) fn build_architecture_nodes_model(
    files: &[PullRequestFile],
) -> ModelRc<ArchitectureNodeView> {
    let nodes = build_architecture_nodes(files);
    let model = VecModel::<ArchitectureNodeView>::default();
    for node in nodes {
        let (kind_label, kind_key) = architecture_kind_labels(node.kind);
        model.push(ArchitectureNodeView {
            kind_label: SharedString::from(kind_label),
            kind_key: SharedString::from(kind_key),
            label: SharedString::from(node.label.as_str()),
            detail: SharedString::from(node.detail.as_str()),
            file_index: node.file_index.map(|i| i as i32).unwrap_or(-1),
            line_no: node.line_no.map(|l| l as i32).unwrap_or(0),
        });
    }
    ModelRc::from(
        std::rc::Rc::new(model) as std::rc::Rc<dyn slint::Model<Data = ArchitectureNodeView>>,
    )
}

fn architecture_kind_labels(kind: ArchitectureNodeKind) -> (String, &'static str) {
    let (key, raw) = match kind {
        ArchitectureNodeKind::Center => ("Center", "center"),
        ArchitectureNodeKind::Upstream => ("Upstream", "upstream"),
        ArchitectureNodeKind::Downstream => ("Downstream", "downstream"),
    };
    (crate::i18n::tr(key), raw)
}

/// PR snapshot 全ファイルを semantic adapter に通し、UI 用の linear list を作る。
/// Go 以外は file-level の fallback item が並ぶ。
pub(crate) fn build_semantic_items_model(
    files: &[PullRequestFile],
) -> ModelRc<SemanticItemView> {
    let model = VecModel::<SemanticItemView>::default();
    for file in files {
        let result = analyze_pull_request_file(file);
        for item in result.items {
            let kind_label = symbol_kind_label(item.kind);
            let (change_label, change_kind) = change_type_labels(item.change_type);
            model.push(SemanticItemView {
                file_path: SharedString::from(file.file_path.as_str()),
                display_name: SharedString::from(item.display_name.as_str()),
                container: SharedString::from(item.container.as_deref().unwrap_or("")),
                kind_label: SharedString::from(kind_label),
                change_label: SharedString::from(change_label),
                change_kind: SharedString::from(change_kind),
            });
        }
    }
    ModelRc::from(
        std::rc::Rc::new(model) as std::rc::Rc<dyn slint::Model<Data = SemanticItemView>>,
    )
}

fn symbol_kind_label(kind: SymbolKind) -> String {
    let key = match kind {
        SymbolKind::Function => "function",
        SymbolKind::Method => "method",
        SymbolKind::Class => "class",
        SymbolKind::Module => "module",
        SymbolKind::Unknown => "symbol",
    };
    crate::i18n::tr(key)
}

fn change_type_labels(change: ChangeType) -> (String, &'static str) {
    let (key, raw) = match change {
        ChangeType::Added => ("added", "added"),
        ChangeType::Removed => ("removed", "removed"),
        ChangeType::Modified => ("modified", "modified"),
        ChangeType::Moved => ("moved", "moved"),
        ChangeType::Renamed => ("renamed", "renamed"),
    };
    (crate::i18n::tr(key), raw)
}

/// PR 一覧 (PullRequestSummary) を Slint Model に詰め直す。
pub(crate) fn build_pr_list_model(
    summaries: &[PullRequestSummary],
) -> ModelRc<PullRequestListItemView> {
    let model = VecModel::<PullRequestListItemView>::default();
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
    ModelRc::from(
        std::rc::Rc::new(model)
            as std::rc::Rc<dyn slint::Model<Data = PullRequestListItemView>>,
    )
}

/// linked issue 一覧を Slint Model に詰め直す。Failed バリアントは error
/// state として行内表示する。
pub(crate) fn build_issue_context_model(
    records: &[LinkedIssueDisplay],
) -> ModelRc<IssueContextView> {
    let model = VecModel::<IssueContextView>::default();
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
                    title: SharedString::from(crate::i18n::tr("(failed to fetch)")),
                    state: SharedString::from("error"),
                    body_excerpt: SharedString::from(message.as_str()),
                });
            }
        }
    }
    ModelRc::from(
        std::rc::Rc::new(model) as std::rc::Rc<dyn slint::Model<Data = IssueContextView>>,
    )
}
