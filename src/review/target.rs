use std::path::PathBuf;

/// レビュー対象。Locus は「PR viewer」ではなく「ReviewTarget viewer」として
/// 将来のローカル比較にも同じ UI で対応できるように抽象を先に置く。
///
/// v0.1 では UI から開けるのは [`ReviewTarget::GitHubPr`] のみだが、他バリアントも
/// 型として用意しておく。
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub enum ReviewTarget {
    /// GitHub の pull request を直接指す。
    GitHubPr {
        owner: String,
        repo: String,
        pr_number: u64,
    },

    /// ローカルリポジトリの base..head 比較。将来対応。
    LocalCompare {
        repo_path: PathBuf,
        base_ref: String,
        head_ref: String,
    },

    /// 作業ツリー（HEAD と dirty の差分など）。将来対応。
    WorkingTree {
        repo_path: PathBuf,
        base_ref: String,
    },
}

impl ReviewTarget {
    /// UI 上のタイトルとして使える短い表現。
    pub fn display_label(&self) -> String {
        match self {
            ReviewTarget::GitHubPr {
                owner,
                repo,
                pr_number,
            } => format!("{owner}/{repo}#{pr_number}"),
            ReviewTarget::LocalCompare {
                repo_path,
                base_ref,
                head_ref,
            } => format!(
                "{}: {base_ref}..{head_ref}",
                repo_path.file_name().and_then(|s| s.to_str()).unwrap_or("?")
            ),
            ReviewTarget::WorkingTree {
                repo_path,
                base_ref,
            } => format!(
                "{}: {base_ref}..worktree",
                repo_path.file_name().and_then(|s| s.to_str()).unwrap_or("?")
            ),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn display_label_for_github_pr() {
        let target = ReviewTarget::GitHubPr {
            owner: "duck8823".into(),
            repo: "locus".into(),
            pr_number: 42,
        };
        assert_eq!(target.display_label(), "duck8823/locus#42");
    }

    #[test]
    fn display_label_for_local_compare() {
        let target = ReviewTarget::LocalCompare {
            repo_path: PathBuf::from("/tmp/sample-repo"),
            base_ref: "main".into(),
            head_ref: "topic".into(),
        };
        assert_eq!(target.display_label(), "sample-repo: main..topic");
    }

    #[test]
    fn display_label_for_working_tree() {
        let target = ReviewTarget::WorkingTree {
            repo_path: PathBuf::from("/tmp/sample-repo"),
            base_ref: "main".into(),
        };
        assert_eq!(target.display_label(), "sample-repo: main..worktree");
    }
}
