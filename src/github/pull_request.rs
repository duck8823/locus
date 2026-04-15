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

/// `GITHUB_TOKEN` / `GH_TOKEN` のどちらかがあれば、それを使って認証済み Octocrab を返す。
pub fn build_client() -> Result<Arc<Octocrab>, GithubError> {
    let token = std::env::var("GITHUB_TOKEN")
        .ok()
        .or_else(|| std::env::var("GH_TOKEN").ok());
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

    let mut files: Vec<PullRequestFile> = Vec::new();

    for entry in entries {
        let status = FileStatus::from_octocrab(entry.status);
        let file_path = entry.filename.clone();
        // renamed の場合は base 側のパスが変わる。
        let base_path = entry
            .previous_filename
            .clone()
            .unwrap_or_else(|| file_path.clone());
        let file_id = FileId::new(file_path.clone());
        let patch = entry.patch.clone();

        let (before, after) = match status {
            FileStatus::Added => (
                FetchedContent::Missing("added file has no base content".into()),
                fetch_content_typed(client, owner, repo, &file_path, &head_sha).await,
            ),
            FileStatus::Removed => (
                fetch_content_typed(client, owner, repo, &base_path, &base_sha).await,
                FetchedContent::Missing("removed file has no head content".into()),
            ),
            _ => (
                fetch_content_typed(client, owner, repo, &base_path, &base_sha).await,
                fetch_content_typed(client, owner, repo, &file_path, &head_sha).await,
            ),
        };

        let is_binary = matches!(before, FetchedContent::Binary)
            || matches!(after, FetchedContent::Binary);

        let unsupported = if is_binary {
            Some(UnsupportedFile::Binary {
                file_id: file_id.clone(),
                file_path: file_path.clone(),
            })
        } else {
            let before_ok = matches!(before, FetchedContent::Ok(_));
            let after_ok = matches!(after, FetchedContent::Ok(_));

            let unexpected_missing = match status {
                FileStatus::Added => !after_ok,
                FileStatus::Removed => !before_ok,
                _ => !before_ok || !after_ok,
            };

            if unexpected_missing {
                let reason = summarize_missing(&before, &after);
                Some(UnsupportedFile::PatchMissing {
                    file_id: file_id.clone(),
                    file_path: file_path.clone(),
                    reason,
                })
            } else {
                None
            }
        };

        let (before_content, after_content) = if unsupported.is_some() {
            (None, None)
        } else {
            (
                into_text(before),
                into_text(after),
            )
        };

        files.push(PullRequestFile {
            file_id,
            file_path,
            status,
            before_content,
            after_content,
            patch,
            is_binary,
            unsupported,
        });
    }

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
