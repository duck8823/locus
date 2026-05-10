//! GitHub PR スナップショット取得。
//!
//! octocrab を用いて以下を取得する:
//!   1. PR メタデータ (title / head sha / base sha)
//!   2. PR 内の changed files（pagination 済み）
//!   3. 各ファイルの before/after content（base/head の tree に対する contents API）
//!
//! 内部モデルの正本は before/after snapshot。patch string は viewer 用にのみ
//! 保持する派生ビュー。binary / patch missing / parser failed は
//! [`UnsupportedFile`] で明示的に表現する。

use std::sync::Arc;

use octocrab::Octocrab;
use octocrab::models::pulls::PullRequest;
use octocrab::models::repos::DiffEntryStatus;

use crate::review::snapshot::{FileId, UnsupportedFile};
use crate::review::target::ReviewTarget;

#[derive(Debug)]
pub enum GithubError {
    Api(String),
    MissingField(&'static str),
}

impl std::fmt::Display for GithubError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            GithubError::Api(s) => write!(f, "GitHub API error: {s}"),
            GithubError::MissingField(s) => write!(f, "Missing field: {s}"),
        }
    }
}

impl std::error::Error for GithubError {}

impl From<octocrab::Error> for GithubError {
    fn from(err: octocrab::Error) -> Self {
        GithubError::Api(err.to_string())
    }
}

#[derive(Debug, Clone)]
pub struct PullRequestFile {
    pub file_id: FileId,
    pub file_path: String,
    /// rename 前の path。Renamed 以外、または GitHub が previous_filename を
    /// 返さない場合は None。
    pub previous_file_path: Option<String>,
    pub status: FileStatus,
    /// base 側の content。Added / 取得失敗 / binary 時は None。
    pub before_content: Option<String>,
    /// head 側の content。Removed / 取得失敗 / binary 時は None。
    pub after_content: Option<String>,
    /// octocrab が返した unified patch。viewer 用の派生で、正本ではない。
    pub patch: Option<String>,
    pub is_binary: bool,
    /// unsupported と判定された場合の理由（Binary / PatchMissing / ParserFailed）。
    pub unsupported: Option<UnsupportedFile>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FileStatus {
    Added,
    Modified,
    Removed,
    Renamed,
    Copied,
    Changed,
    Unchanged,
}

impl FileStatus {
    fn from_octocrab(status: DiffEntryStatus) -> Self {
        match status {
            DiffEntryStatus::Added => FileStatus::Added,
            DiffEntryStatus::Modified => FileStatus::Modified,
            DiffEntryStatus::Removed => FileStatus::Removed,
            DiffEntryStatus::Renamed => FileStatus::Renamed,
            DiffEntryStatus::Copied => FileStatus::Copied,
            DiffEntryStatus::Changed => FileStatus::Changed,
            DiffEntryStatus::Unchanged => FileStatus::Unchanged,
            _ => FileStatus::Modified,
        }
    }
}

#[derive(Debug, Clone)]
pub struct PullRequestSnapshot {
    pub target: ReviewTarget,
    pub title: String,
    pub body: Option<String>,
    pub head_sha: String,
    pub base_sha: String,
    pub files: Vec<PullRequestFile>,
}

/// PR 一覧サイドバー向けの軽量メタデータ。
#[derive(Debug, Clone)]
pub struct PullRequestSummary {
    pub number: u64,
    pub title: String,
    pub author: String,
    pub state: PrListState,
    pub updated_at: String, // ISO8601 文字列のままで OK
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PrListState {
    Open,
    Closed,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PrListFilter {
    Open,
    Closed,
    All,
}

/// 指定リポジトリの PR 一覧を取得する。
///
/// サイドバー UI で使う想定なので all_pages は呼ばず最初の 1 ページ
/// (per_page=50) のみを返す。これにより数千 PR のある大きなリポジトリでも
/// フィルタ切替が速く完了する。
pub async fn fetch_pull_requests(
    client: &Octocrab,
    owner: &str,
    repo: &str,
    filter: PrListFilter,
) -> Result<Vec<PullRequestSummary>, GithubError> {
    use octocrab::params::State;

    let state = match filter {
        PrListFilter::Open => State::Open,
        PrListFilter::Closed => State::Closed,
        PrListFilter::All => State::All,
    };

    let pulls = client.pulls(owner, repo);
    let first_page = pulls
        .list()
        .state(state)
        .per_page(50)
        .send()
        .await?;
    let entries = first_page.items;

    let mut summaries: Vec<PullRequestSummary> = Vec::new();
    for pr in entries {
        let state_kind = match pr.state {
            Some(octocrab::models::IssueState::Open) => PrListState::Open,
            Some(octocrab::models::IssueState::Closed) => PrListState::Closed,
            _ => PrListState::Open,
        };
        let author = pr
            .user
            .as_deref()
            .map(|u| u.login.clone())
            .unwrap_or_else(|| "?".into());
        let updated_at = pr
            .updated_at
            .map(|t| t.to_rfc3339())
            .unwrap_or_default();
        summaries.push(PullRequestSummary {
            number: pr.number,
            title: pr.title.unwrap_or_default(),
            author,
            state: state_kind,
            updated_at,
        });
    }
    Ok(summaries)
}

/// `owner/repo#pr_number` 形式をパースする。
pub fn parse_pr_spec(spec: &str) -> Option<(String, String, u64)> {
    let (repo_part, pr_part) = spec.split_once('#')?;
    let (owner, repo) = repo_part.split_once('/')?;
    if owner.is_empty() || repo.is_empty() {
        return None;
    }
    let pr_number: u64 = pr_part.parse().ok()?;
    Some((owner.to_string(), repo.to_string(), pr_number))
}

/// 環境変数または `gh auth token` から取得した token を使って認証済み Octocrab を返す。
///
/// 優先順位:
/// 1. `GITHUB_TOKEN`
/// 2. `GH_TOKEN`
/// 3. `gh auth token` 出力 (`LOCUS_NO_GH_AUTH=1` で無効化)
/// 4. unauthenticated (rate limit が厳しい)
pub fn build_client() -> Result<Arc<Octocrab>, GithubError> {
    let token = resolve_github_token();
    let builder = Octocrab::builder();
    let client = match token {
        Some(t) => builder
            .personal_token(t)
            .build()
            .map_err(|e| GithubError::Api(e.to_string()))?,
        None => builder.build().map_err(|e| GithubError::Api(e.to_string()))?,
    };
    Ok(Arc::new(client))
}

fn resolve_github_token() -> Option<String> {
    if let Ok(t) = std::env::var("GITHUB_TOKEN")
        && !t.is_empty()
    {
        return Some(t);
    }
    if let Ok(t) = std::env::var("GH_TOKEN")
        && !t.is_empty()
    {
        return Some(t);
    }
    if gh_auth_disabled() {
        return None;
    }
    gh_auth_token()
}

/// `LOCUS_NO_GH_AUTH=1`/`true`/`yes` で `gh auth token` フォールバックを禁じる。
fn gh_auth_disabled() -> bool {
    parse_no_gh_auth_env(std::env::var("LOCUS_NO_GH_AUTH").ok().as_deref())
}

/// `LOCUS_NO_GH_AUTH` の値を解釈する。`Some("1"|"true"|"yes"|"on")` (case-insensitive)
/// なら true。未設定 / 空 / その他は false (= gh auth fallback 有効)。
fn parse_no_gh_auth_env(value: Option<&str>) -> bool {
    match value.map(|s| s.trim().to_ascii_lowercase()) {
        Some(v) => matches!(v.as_str(), "1" | "true" | "yes" | "on"),
        None => false,
    }
}

/// `gh auth token` を spawn してトークンを取得する。失敗時は `None`。
///
/// gh CLI が未インストール / 未ログイン / その他いずれの理由でも
/// unauthenticated にフォールバックさせるため、エラーは握って `None` を返す。
///
/// - `--hostname github.com` を固定指定して GH_HOST / Enterprise 設定の
///   影響を排除する (Octocrab は default で github.com に接続するため)。
/// - `GH_AUTH_TIMEOUT` (秒) を超えても gh が返らない場合は諦めて `None`。
///   Credential helper が固まったときに build_client が永遠にブロックする
///   のを防ぐ。既定 3 秒。
fn gh_auth_token() -> Option<String> {
    use std::io::Read;
    use std::sync::mpsc;
    use std::time::Duration;

    let timeout_secs = std::env::var("GH_AUTH_TIMEOUT")
        .ok()
        .and_then(|s| s.trim().parse::<u64>().ok())
        .unwrap_or(3);

    let mut child = std::process::Command::new("gh")
        .args(["auth", "token", "--hostname", "github.com"])
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::null())
        .spawn()
        .ok()?;

    let mut stdout = child.stdout.take()?;
    let (tx, rx) = mpsc::channel();
    std::thread::spawn(move || {
        let mut buf = String::new();
        let _ = stdout.read_to_string(&mut buf);
        let _ = tx.send(buf);
    });

    match rx.recv_timeout(Duration::from_secs(timeout_secs)) {
        Ok(buf) => {
            let status = child.wait().ok()?;
            if !status.success() {
                return None;
            }
            let token = buf.trim().to_string();
            if token.is_empty() { None } else { Some(token) }
        }
        Err(_) => {
            // タイムアウトした場合は子プロセスを kill して諦める。
            let _ = child.kill();
            let _ = child.wait();
            None
        }
    }
}

/// content 取得結果を 3 値で表現する。
#[derive(Debug)]
enum FetchedContent {
    Ok(String),
    /// content が存在したがテキストとしてデコードできなかった or null byte を含む（binary 相当）。
    Binary,
    /// 404 / rate limit / 取得失敗など。理由付きで保持する。
    Missing(String),
}

/// PR のスナップショットを取得する。
pub async fn fetch_pr_snapshot(
    client: &Octocrab,
    owner: &str,
    repo: &str,
    pr_number: u64,
) -> Result<PullRequestSnapshot, GithubError> {
    let pulls = client.pulls(owner, repo);
    let pr: PullRequest = pulls.get(pr_number).await?;

    let title = pr.title.unwrap_or_default();
    let body = pr.body.clone();
    let head_sha = pr.head.sha.clone();
    let base_sha = pr.base.sha.clone();

    // 全ページを回収する。
    let first_page = pulls.list_files(pr_number).await?;
    let entries: Vec<octocrab::models::repos::DiffEntry> = client.all_pages(first_page).await?;

    // ファイルあたり最大 2 件 (before / after) の content fetch を発生させるため、
    // 100 ファイル PR では sequential だと 200 リクエスト直列で起動が極端に遅い。
    // FuturesUnordered + buffer_unordered で N 並列に実行し、入力順を保つために
    // index を持ち回って後で並べ替える。並列度 8 は GitHub API の rate limit に
    // 対する保守値で、API レイテンシ ~200ms なら 8 並列で 100 file が
    // ~5 秒程度に収まる目安。
    use futures::stream::{self, StreamExt};
    const FETCH_CONCURRENCY: usize = 8;

    struct FileContext {
        file_id: FileId,
        file_path: String,
        base_path: String,
        status: FileStatus,
        patch: Option<String>,
    }

    let contexts: Vec<FileContext> = entries
        .into_iter()
        .map(|entry| {
            let status = FileStatus::from_octocrab(entry.status);
            let file_path = entry.filename.clone();
            let base_path = entry
                .previous_filename
                .clone()
                .unwrap_or_else(|| file_path.clone());
            let file_id = FileId::new(file_path.clone());
            FileContext {
                file_id,
                file_path,
                base_path,
                status,
                patch: entry.patch.clone(),
            }
        })
        .collect();

    let total = contexts.len();
    let head_sha_for_stream = head_sha.clone();
    let base_sha_for_stream = base_sha.clone();
    let fetched_files: Vec<(usize, FileContext, FetchedContent, FetchedContent)> =
        stream::iter(contexts.into_iter().enumerate())
            .map(|(idx, ctx)| {
                let head_sha = head_sha_for_stream.clone();
                let base_sha = base_sha_for_stream.clone();
                async move {
                    let (before, after) = match ctx.status {
                        FileStatus::Added => (
                            FetchedContent::Missing("added file has no base content".into()),
                            fetch_content_typed(client, owner, repo, &ctx.file_path, &head_sha)
                                .await,
                        ),
                        FileStatus::Removed => (
                            fetch_content_typed(client, owner, repo, &ctx.base_path, &base_sha)
                                .await,
                            FetchedContent::Missing("removed file has no head content".into()),
                        ),
                        _ => {
                            let (b, a) = futures::join!(
                                fetch_content_typed(client, owner, repo, &ctx.base_path, &base_sha),
                                fetch_content_typed(client, owner, repo, &ctx.file_path, &head_sha),
                            );
                            (b, a)
                        }
                    };
                    (idx, ctx, before, after)
                }
            })
            .buffer_unordered(FETCH_CONCURRENCY)
            .collect()
            .await;

    let mut indexed: Vec<Option<PullRequestFile>> = (0..total).map(|_| None).collect();
    for (idx, ctx, before, after) in fetched_files {
        let is_binary = matches!(before, FetchedContent::Binary)
            || matches!(after, FetchedContent::Binary);

        let unsupported = if is_binary {
            Some(UnsupportedFile::Binary {
                file_id: ctx.file_id.clone(),
                file_path: ctx.file_path.clone(),
            })
        } else {
            let before_ok = matches!(before, FetchedContent::Ok(_));
            let after_ok = matches!(after, FetchedContent::Ok(_));

            let unexpected_missing = match ctx.status {
                FileStatus::Added => !after_ok,
                FileStatus::Removed => !before_ok,
                _ => !before_ok || !after_ok,
            };

            if unexpected_missing {
                let reason = summarize_missing(&before, &after);
                Some(UnsupportedFile::PatchMissing {
                    file_id: ctx.file_id.clone(),
                    file_path: ctx.file_path.clone(),
                    reason,
                })
            } else {
                None
            }
        };

        let (before_content, after_content) = if unsupported.is_some() {
            (None, None)
        } else {
            (into_text(before), into_text(after))
        };

        let previous_file_path = (ctx.base_path != ctx.file_path).then_some(ctx.base_path);

        indexed[idx] = Some(PullRequestFile {
            file_id: ctx.file_id,
            file_path: ctx.file_path,
            previous_file_path,
            status: ctx.status,
            before_content,
            after_content,
            patch: ctx.patch,
            is_binary,
            unsupported,
        });
    }

    let files: Vec<PullRequestFile> = indexed.into_iter().flatten().collect();

    Ok(PullRequestSnapshot {
        target: ReviewTarget::GitHubPr {
            owner: owner.to_string(),
            repo: repo.to_string(),
            pr_number,
        },
        title,
        body,
        head_sha,
        base_sha,
        files,
    })
}

fn into_text(fetched: FetchedContent) -> Option<String> {
    match fetched {
        FetchedContent::Ok(s) => Some(s),
        FetchedContent::Binary | FetchedContent::Missing(_) => None,
    }
}

fn summarize_missing(before: &FetchedContent, after: &FetchedContent) -> String {
    match (before, after) {
        (FetchedContent::Missing(b), FetchedContent::Missing(a)) => {
            format!("before: {b}; after: {a}")
        }
        (FetchedContent::Missing(b), _) => format!("before: {b}"),
        (_, FetchedContent::Missing(a)) => format!("after: {a}"),
        _ => "unknown".into(),
    }
}

async fn fetch_content_typed(
    client: &Octocrab,
    owner: &str,
    repo: &str,
    path: &str,
    sha: &str,
) -> FetchedContent {
    match client
        .repos(owner, repo)
        .get_content()
        .path(path)
        .r#ref(sha)
        .send()
        .await
    {
        Ok(resp) => match resp.items.into_iter().next() {
            None => FetchedContent::Missing("content API returned empty items".into()),
            Some(item) => match item.decoded_content() {
                Some(s) => {
                    // null byte を含むテキストは実質的に binary とみなす。
                    if s.contains('\0') {
                        FetchedContent::Binary
                    } else {
                        FetchedContent::Ok(s)
                    }
                }
                None => FetchedContent::Binary,
            },
        },
        Err(e) => FetchedContent::Missing(format!("contents api: {e}")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_pr_spec_accepts_standard_form() {
        let parsed = parse_pr_spec("duck8823/locus#42").unwrap();
        assert_eq!(parsed, ("duck8823".into(), "locus".into(), 42));
    }

    #[test]
    fn parse_pr_spec_rejects_missing_hash() {
        assert!(parse_pr_spec("duck8823/locus").is_none());
    }

    #[test]
    fn parse_pr_spec_rejects_missing_owner() {
        assert!(parse_pr_spec("/locus#1").is_none());
    }

    #[test]
    fn no_gh_auth_default_off() {
        assert!(!parse_no_gh_auth_env(None));
        assert!(!parse_no_gh_auth_env(Some("")));
    }

    #[test]
    fn no_gh_auth_explicit_on() {
        for v in ["1", "true", "True", "yes", "ON"] {
            assert!(parse_no_gh_auth_env(Some(v)));
        }
    }

    #[test]
    fn no_gh_auth_unknown_off() {
        assert!(!parse_no_gh_auth_env(Some("0")));
        assert!(!parse_no_gh_auth_env(Some("garbage")));
    }

    #[test]
    fn parse_pr_spec_rejects_non_numeric_pr() {
        assert!(parse_pr_spec("a/b#xyz").is_none());
    }

    #[test]
    fn summarize_missing_combines_both_sides() {
        let s = summarize_missing(
            &FetchedContent::Missing("404 base".into()),
            &FetchedContent::Missing("rate limit".into()),
        );
        assert_eq!(s, "before: 404 base; after: rate limit");
    }

    #[test]
    fn summarize_missing_prefers_missing_side() {
        let s = summarize_missing(
            &FetchedContent::Ok("a".into()),
            &FetchedContent::Missing("404 head".into()),
        );
        assert_eq!(s, "after: 404 head");
    }

    #[test]
    fn into_text_binary_returns_none() {
        assert!(into_text(FetchedContent::Binary).is_none());
    }

    #[test]
    fn into_text_missing_returns_none() {
        assert!(into_text(FetchedContent::Missing("x".into())).is_none());
    }

    #[test]
    fn into_text_ok_returns_content() {
        assert_eq!(
            into_text(FetchedContent::Ok("hello".into())).as_deref(),
            Some("hello")
        );
    }
}
