//! Linked issue を並列 fetch するヘルパ (#224 split)。
//!
//! `run_diff_viewer` 起動 hydrate と PR switch callback の双方から呼ばれる
//! async helper。`fetch_issue_context_async` を `FuturesUnordered` で束ねて
//! 並列実行し、完了結果を number 順にソートして返す。並列実行中に発生した
//! エラーがあれば、`slint::invoke_from_event_loop` 経由で要約 toast を 1 つ
//! だけ表示する (各 issue chip 側でも error 表示するため重複させない)。

use std::time::Instant;

use crate::github::issue_context::fetch_issue_context_async;
use crate::i18n;

use super::snapshot::LinkedIssueDisplay;
use super::state::ToastKind;
use super::toast::show_toast;

/// linked issue 番号一覧を受け取り、各 issue を tokio::spawn 系で並列 fetch
/// する。`octocrab::Octocrab` は内部で reqwest クライアントを共有しているので
/// 数件の concurrent 呼び出しは安全。
pub(crate) async fn fetch_linked_issues_parallel(
    client: &octocrab::Octocrab,
    owner: &str,
    repo: &str,
    numbers: &[u64],
) -> Vec<LinkedIssueDisplay> {
    use futures::stream::{FuturesUnordered, StreamExt};

    let started = Instant::now();
    let requested = numbers.len();
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
    let mut error_summary: Option<String> = None;
    let mut error_count: usize = 0;
    while let Some((n, res)) = futs.next().await {
        match res {
            Ok(Some(r)) => out.push(LinkedIssueDisplay::Found(r)),
            Ok(None) => {}
            Err(e) => {
                let message = e.to_string();
                if error_summary.is_none() {
                    error_summary = Some(format!("#{n}: {message}"));
                }
                error_count += 1;
                out.push(LinkedIssueDisplay::Failed {
                    number: n,
                    message,
                });
            }
        }
    }
    // 並列実行の完了順は不定なので number でソートして決定論的にする
    out.sort_by_key(|d| match d {
        LinkedIssueDisplay::Found(r) => r.number,
        LinkedIssueDisplay::Failed { number, .. } => *number,
    });

    tracing::debug!(
        requested,
        returned = out.len(),
        error_count,
        elapsed_ms = started.elapsed().as_millis() as u64,
        "linked issues fetched"
    );

    // 1 件以上失敗していたら要約 toast を 1 つだけ出す。
    // (各 issue chip は別途 error 表示されるため、toast は重複させない)
    if let Some(first) = error_summary {
        let count_str = error_count.to_string();
        let _ = slint::invoke_from_event_loop(move || {
            show_toast(
                ToastKind::Warn,
                i18n::tr_args(
                    "Failed to fetch {} linked issue(s)",
                    &[count_str.as_str()],
                ),
                first,
            );
        });
    }
    out
}
