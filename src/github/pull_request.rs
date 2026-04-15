//! GitHub PR スナップショット取得。
//!
//! octocrab を用いて以下を取得する:
//!   1. PR メタデータ (title / head sha / base sha)
//!   2. PR 内の changed files
//!   3. 各ファイルの before/after content（base/head の tree に対する contents API）
//!
//! 内部モデルの正本は before/after snapshot。patch string は viewer 用にのみ
//! 保持する派生ビューとして扱う。binary / patch missing / parser failed は
//! [`UnsupportedFile`] で明示的に表現する。

use std::sync::Arc;

use octocrab::Octocrab;
use octocrab::models::pulls::PullRequest;
use octocrab::models::repos::DiffEntryStatus;

use crate::review::snapshot::{FileId, UnsupportedFile};
use crate::review::target::ReviewTarget;

/// GitHub 由来のエラー。PoC 用に簡素な wrapper にしておく。
#[derive(Debug)]
pub enum GithubError {
    /// octocrab がエラーを返した。
    Api(String),
    /// PR メタデータの必須フィールドが欠けていた。
    MissingField(&'static str),
    /// content のデコードに失敗した。
    ContentDecode(String),
}

impl std::fmt::Display for GithubError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            GithubError::Api(s) => write!(f, "GitHub API error: {s}"),
            GithubError::MissingField(s) => write!(f, "Missing field: {s}"),
            GithubError::ContentDecode(s) => write!(f, "Content decode failed: {s}"),
        }
    }
}

impl std::error::Error for GithubError {}

impl From<octocrab::Error> for GithubError {
    fn from(err: octocrab::Error) -> Self {
        GithubError::Api(err.to_string())
    }
}

/// PR 内の1ファイル分のスナップショット。
#[derive(Debug, Clone)]
pub struct PullRequestFile {
    pub file_id: FileId,
    pub file_path: String,
    pub status: FileStatus,
    /// base 側の content。Added / 取得失敗時は None。
    pub before_content: Option<String>,
    /// head 側の content。Removed / 取得失敗時は None。
    pub after_content: Option<String>,
    /// octocrab が返した unified patch。viewer 用の派生で、正本ではない。
    pub patch: Option<String>,
    /// binary と判定されたファイル（content 取得をスキップ）。
    pub is_binary: bool,
    /// before/after のどちらか両方とも取得できなかった場合の理由。
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

/// PR 全体のスナップショット。
#[derive(Debug, Clone)]
pub struct PullRequestSnapshot {
    pub target: ReviewTarget,
    pub title: String,
    pub head_sha: String,
    pub base_sha: String,
    pub files: Vec<PullRequestFile>,
}

/// `owner/repo#pr_number` 形式をパースする。
///
/// - `duck8823/locus#42` → (owner, repo, 42)
/// - 不正入力は None
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
/// どちらも無ければ unauthenticated。
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
    let head_sha = pr
        .head
        .sha
        .clone();
    let base_sha = pr
        .base
        .sha
        .clone();

    // 全ファイルを取得。octocrab は Page<DiffEntry> を返す。
    let files_page = pulls.list_files(pr_number).await?;
    let mut files: Vec<PullRequestFile> = Vec::new();

    for entry in files_page.items {
        let status = FileStatus::from_octocrab(entry.status);
        let file_path = entry.filename.clone();
        let file_id = FileId::new(file_path.clone());
        let patch = entry.patch.clone();
        // octocrab は "binary" を patch の有無で見分けるのが簡単。
        // patch が None かつ deletions+additions が 0 でないなら binary 疑い。
        let is_binary = patch.is_none() && (entry.additions + entry.deletions) > 0;

        let (before_content, after_content) = if is_binary {
            (None, None)
        } else {
            let before = if matches!(status, FileStatus::Added) {
                None
            } else {
                fetch_content(client, owner, repo, &file_path, &base_sha)
                    .await
                    .ok()
            };
            let after = if matches!(status, FileStatus::Removed) {
                None
            } else {
                fetch_content(client, owner, repo, &file_path, &head_sha)
                    .await
                    .ok()
            };
            (before, after)
        };

        let unsupported = if is_binary {
            Some(UnsupportedFile::Binary {
                file_id: file_id.clone(),
                file_path: file_path.clone(),
            })
        } else if before_content.is_none()
            && after_content.is_none()
            && !matches!(
                status,
                FileStatus::Added | FileStatus::Removed
            )
        {
            Some(UnsupportedFile::PatchMissing {
                file_id: file_id.clone(),
                file_path: file_path.clone(),
                reason: "content fetch returned neither before nor after".into(),
            })
        } else {
            None
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
        head_sha,
        base_sha,
        files,
    })
}

async fn fetch_content(
    client: &Octocrab,
    owner: &str,
    repo: &str,
    path: &str,
    sha: &str,
) -> Result<String, GithubError> {
    let resp = client
        .repos(owner, repo)
        .get_content()
        .path(path)
        .r#ref(sha)
        .send()
        .await?;
    let item = resp
        .items
        .into_iter()
        .next()
        .ok_or(GithubError::MissingField("contents.items[0]"))?;
    item
        .decoded_content()
        .ok_or_else(|| GithubError::ContentDecode(format!("{path}@{sha}")))
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
}
