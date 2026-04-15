//! Issue context provider.
//!
//! GitHub Issues API で linked issue の title / body / status を取得する。
//! PR body から `#N` / `Closes #N` / `Fixes #N` / `Resolves #N` を抽出する
//! 軽量パーサも同梱する。
//!
//! 契約:
//! - 404 は None を返す（静かに隠れる）
//! - 非 2xx は Err で伝搬
//! - 書き込み系 API は実装しない

use std::collections::BTreeSet;

use octocrab::Octocrab;

use super::pull_request::GithubError;

#[derive(Debug, Clone)]
pub struct IssueContextRecord {
    pub owner: String,
    pub repo: String,
    pub number: u64,
    pub title: String,
    pub body: Option<String>,
    pub state: IssueState,
    pub labels: Vec<String>,
    pub html_url: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum IssueState {
    Open,
    Closed,
}

/// `IssueContextProvider` 抽象。stub と live の 2 実装を切り替えられる。
pub trait IssueContextProvider {
    fn fetch(
        &self,
        owner: &str,
        repo: &str,
        number: u64,
    ) -> Result<Option<IssueContextRecord>, GithubError>;
}

/// octocrab backed live provider.
pub struct GithubIssueContextProvider<'a> {
    client: &'a Octocrab,
    runtime_handle: tokio::runtime::Handle,
}

impl<'a> GithubIssueContextProvider<'a> {
    pub fn new(client: &'a Octocrab, runtime_handle: tokio::runtime::Handle) -> Self {
        Self {
            client,
            runtime_handle,
        }
    }
}

impl<'a> IssueContextProvider for GithubIssueContextProvider<'a> {
    fn fetch(
        &self,
        owner: &str,
        repo: &str,
        number: u64,
    ) -> Result<Option<IssueContextRecord>, GithubError> {
        let client = self.client.clone();
        let owner = owner.to_string();
        let repo = repo.to_string();
        self.runtime_handle.block_on(async move {
            let issues = client.issues(&owner, &repo);
            match issues.get(number).await {
                Ok(issue) => {
                    // pull request オブジェクトは Issues API でも返ってくるが、
                    // PR 情報は別トラッキングなので context から除外する。
                    if issue.pull_request.is_some() {
                        return Ok(None);
                    }
                    let state = match issue.state {
                        octocrab::models::IssueState::Open => IssueState::Open,
                        octocrab::models::IssueState::Closed => IssueState::Closed,
                        _ => IssueState::Open,
                    };
                    let labels = issue
                        .labels
                        .into_iter()
                        .map(|l| l.name)
                        .collect::<Vec<_>>();
                    Ok(Some(IssueContextRecord {
                        owner,
                        repo,
                        number,
                        title: issue.title,
                        body: issue.body,
                        state,
                        labels,
                        html_url: issue.html_url.to_string(),
                    }))
                }
                Err(octocrab::Error::GitHub { source, .. })
                    if source.status_code == http::StatusCode::NOT_FOUND =>
                {
                    Ok(None)
                }
                Err(e) => Err(GithubError::Api(e.to_string())),
            }
        })
    }
}

/// 非同期で 1 issue の context を取得する low-level ヘルパ。
///
/// `IssueContextProvider` trait と違い block_on を内部で呼ばないため、
/// tokio runtime 上で他の async 処理と並行して spawn できる。
pub async fn fetch_issue_context_async(
    client: &Octocrab,
    owner: &str,
    repo: &str,
    number: u64,
) -> Result<Option<IssueContextRecord>, GithubError> {
    let issues = client.issues(owner, repo);
    match issues.get(number).await {
        Ok(issue) => {
            if issue.pull_request.is_some() {
                return Ok(None);
            }
            let state = match issue.state {
                octocrab::models::IssueState::Open => IssueState::Open,
                octocrab::models::IssueState::Closed => IssueState::Closed,
                _ => IssueState::Open,
            };
            let labels = issue.labels.into_iter().map(|l| l.name).collect::<Vec<_>>();
            Ok(Some(IssueContextRecord {
                owner: owner.to_string(),
                repo: repo.to_string(),
                number,
                title: issue.title,
                body: issue.body,
                state,
                labels,
                html_url: issue.html_url.to_string(),
            }))
        }
        Err(octocrab::Error::GitHub { source, .. })
            if source.status_code == http::StatusCode::NOT_FOUND =>
        {
            Ok(None)
        }
        Err(e) => Err(GithubError::Api(e.to_string())),
    }
}

/// テスト用 / fallback 用の決定論的 provider。
pub struct StubIssueContextProvider;

impl IssueContextProvider for StubIssueContextProvider {
    fn fetch(
        &self,
        owner: &str,
        repo: &str,
        number: u64,
    ) -> Result<Option<IssueContextRecord>, GithubError> {
        Ok(Some(IssueContextRecord {
            owner: owner.to_string(),
            repo: repo.to_string(),
            number,
            title: format!("stub issue #{number}"),
            body: Some("stub body".into()),
            state: IssueState::Open,
            labels: vec!["stub".into()],
            html_url: format!("https://example.test/{owner}/{repo}/issues/{number}"),
        }))
    }
}

/// PR body から linked issue の番号を抽出する。
///
/// 対応パターン:
/// - `Closes #123` / `Fixes #123` / `Resolves #123` (大小無視)
/// - 単独の `#123`
///
/// スキップ対象 (Markdown 文脈):
/// - fenced code block (``` または ~~~ で囲まれた範囲)
/// - inline code (` で囲まれた範囲)
/// - blockquote 行 (`> ` で始まる行)
/// - cross-repo 参照 (`owner/repo#N`)
pub fn extract_linked_issue_numbers(body: &str) -> Vec<u64> {
    let mut found: BTreeSet<u64> = BTreeSet::new();
    for line in strip_markdown_noise(body) {
        scan_line(&line, &mut found);
    }
    found.into_iter().collect()
}

/// fenced code block と blockquote 行を除外しつつ、各行を inline code を
/// 取り除いた状態で返す。
fn strip_markdown_noise(body: &str) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    let mut in_fence = false;
    let mut fence_marker: Option<&str> = None;
    for raw_line in body.lines() {
        let trimmed_start = raw_line.trim_start();
        // fenced code 開閉判定
        if let Some(marker) = fence_marker {
            if trimmed_start.starts_with(marker) {
                in_fence = false;
                fence_marker = None;
                continue;
            }
        } else if trimmed_start.starts_with("```") {
            in_fence = true;
            fence_marker = Some("```");
            continue;
        } else if trimmed_start.starts_with("~~~") {
            in_fence = true;
            fence_marker = Some("~~~");
            continue;
        }
        if in_fence {
            continue;
        }
        // blockquote
        if trimmed_start.starts_with('>') {
            continue;
        }
        out.push(strip_inline_code(raw_line));
    }
    out
}

fn strip_inline_code(line: &str) -> String {
    let mut out = String::with_capacity(line.len());
    let mut in_code = false;
    for c in line.chars() {
        if c == '`' {
            in_code = !in_code;
            continue;
        }
        if !in_code {
            out.push(c);
        }
    }
    out
}

fn scan_line(line: &str, found: &mut BTreeSet<u64>) {
    let bytes = line.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'#' {
            let is_cross_repo = i > 0
                && (bytes[i - 1].is_ascii_alphanumeric() || bytes[i - 1] == b'/');
            if !is_cross_repo {
                let mut j = i + 1;
                while j < bytes.len() && bytes[j].is_ascii_digit() {
                    j += 1;
                }
                if j > i + 1
                    && let Ok(n) = std::str::from_utf8(&bytes[i + 1..j])
                        .unwrap()
                        .parse::<u64>()
                {
                    found.insert(n);
                }
                i = j;
                continue;
            }
        }
        i += 1;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extract_bare_hash_reference() {
        let refs = extract_linked_issue_numbers("see #42 for details");
        assert_eq!(refs, vec![42]);
    }

    #[test]
    fn extract_closes_fixes_resolves() {
        let refs =
            extract_linked_issue_numbers("Closes #1, Fixes #2, resolves #3; also #100");
        assert_eq!(refs, vec![1, 2, 3, 100]);
    }

    #[test]
    fn extract_dedupes() {
        let refs = extract_linked_issue_numbers("#5 and again #5 and #5");
        assert_eq!(refs, vec![5]);
    }

    #[test]
    fn extract_skips_cross_repo_references() {
        let refs = extract_linked_issue_numbers("references other/repo#99 only");
        assert!(refs.is_empty());
    }

    #[test]
    fn extract_empty_body_returns_empty() {
        let refs = extract_linked_issue_numbers("");
        assert!(refs.is_empty());
    }

    #[test]
    fn extract_skips_fenced_code_blocks() {
        let body = "intro\n```\nCloses #12\n```\nactual #50";
        let refs = extract_linked_issue_numbers(body);
        assert_eq!(refs, vec![50]);
    }

    #[test]
    fn extract_skips_inline_code() {
        let body = "see `#34` not actually linked, but #99 is";
        let refs = extract_linked_issue_numbers(body);
        assert_eq!(refs, vec![99]);
    }

    #[test]
    fn extract_skips_blockquote_lines() {
        let body = "> Fixes #56 quoted from somewhere\nreal: Closes #77";
        let refs = extract_linked_issue_numbers(body);
        assert_eq!(refs, vec![77]);
    }

    #[test]
    fn extract_handles_tilde_fences() {
        let body = "~~~\n#42\n~~~\n#43";
        let refs = extract_linked_issue_numbers(body);
        assert_eq!(refs, vec![43]);
    }

    #[test]
    fn stub_provider_returns_predictable_record() {
        let stub = StubIssueContextProvider;
        let record = stub.fetch("o", "r", 7).unwrap().unwrap();
        assert_eq!(record.number, 7);
        assert_eq!(record.title, "stub issue #7");
        assert_eq!(record.state, IssueState::Open);
    }
}
