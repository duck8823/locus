//! `PullRequestFile` を semantic adapter に通すヘルパ (#207 spike)。
//!
//! Go ファイルは [`GoParserAdapter`] に、その他は [`FallbackLineParserAdapter`]
//! にルーティングする。binary / 取得失敗ファイルは空の結果を返し、UI 側で
//! `unsupported` 表示が別経路で行われる前提。

use crate::github::pull_request::{FileStatus, PullRequestFile};
use crate::review::snapshot::{Revision, SourceSnapshot};

use super::adapter::{ParserAdapter, ParserDiffResult};
use super::fallback::FallbackLineParserAdapter;
use super::go::GoParserAdapter;
use super::ir::ChangeType;

/// 1 ファイルぶんの semantic 解析を行う。
///
/// 解析結果は呼び出し側で `SemanticChange` 詰め替え or UI 表示モデル化する。
/// binary / 取得失敗の場合は空の [`ParserDiffResult`] を返し、UI には
/// 出さないことで「黙って落とす」を避けつつ Semantic 一覧を汚さない。
pub fn analyze_pull_request_file(file: &PullRequestFile) -> ParserDiffResult {
    if file.is_binary || file.unsupported.is_some() {
        return ParserDiffResult::default();
    }
    if file.before_content.is_none() && file.after_content.is_none() {
        return ParserDiffResult::default();
    }

    let language = detect_language(&file.file_path);
    if matches!(language.as_deref(), Some("go")) {
        let mut result = run_adapter(&GoParserAdapter::new(), file, "go");
        append_file_rename_item_if_needed(file, "go", &mut result);
        return result;
    }

    let lang = language.as_deref().unwrap_or("unknown");
    run_adapter(&FallbackLineParserAdapter::new(), file, lang)
}

fn run_adapter<A: ParserAdapter>(
    adapter: &A,
    file: &PullRequestFile,
    language: &str,
) -> ParserDiffResult {
    let before = file.before_content.as_ref().map(|content| {
        adapter.parse(&SourceSnapshot {
            file_id: file.file_id.clone(),
            file_path: previous_path(file).into(),
            language: Some(language.to_string()),
            revision: Revision::Before,
            content: content.clone(),
        })
    });
    let after = file.after_content.as_ref().map(|content| {
        adapter.parse(&SourceSnapshot {
            file_id: file.file_id.clone(),
            file_path: file.file_path.clone(),
            language: Some(language.to_string()),
            revision: Revision::After,
            content: content.clone(),
        })
    });
    adapter.diff(before.as_ref(), after.as_ref())
}

fn previous_path(file: &PullRequestFile) -> &str {
    file.previous_file_path.as_deref().unwrap_or(&file.file_path)
}

fn append_file_rename_item_if_needed(
    file: &PullRequestFile,
    language: &str,
    result: &mut ParserDiffResult,
) {
    if file.status != FileStatus::Renamed
        || file.previous_file_path.as_deref() == Some(file.file_path.as_str())
        || file.previous_file_path.is_none()
    {
        return;
    }

    let fallback = run_adapter(&FallbackLineParserAdapter::new(), file, language);
    for item in fallback.items {
        if item.change_type == ChangeType::Renamed {
            result.items.push(item);
        }
    }
}

fn detect_language(path: &str) -> Option<String> {
    let ext = path.rsplit('.').next()?;
    if ext == path {
        return None;
    }
    match ext.to_ascii_lowercase().as_str() {
        "go" => Some("go".into()),
        "rs" => Some("rust".into()),
        "ts" | "tsx" => Some("typescript".into()),
        "js" | "jsx" => Some("javascript".into()),
        "py" => Some("python".into()),
        _ => None,
    }
}

/// PullRequestFile.status と語幹のメタ情報をログ用に簡潔に表現する。
#[allow(dead_code)]
pub(crate) fn file_status_label(status: FileStatus) -> &'static str {
    match status {
        FileStatus::Added => "added",
        FileStatus::Removed => "removed",
        FileStatus::Modified => "modified",
        FileStatus::Renamed => "renamed",
        FileStatus::Copied => "copied",
        FileStatus::Changed => "changed",
        FileStatus::Unchanged => "unchanged",
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::review::snapshot::{FileId, UnsupportedFile};
    use crate::semantic::ir::{ChangeType, SymbolKind};

    fn pr_file(path: &str, before: Option<&str>, after: Option<&str>) -> PullRequestFile {
        let status = match (before, after) {
            (None, Some(_)) => FileStatus::Added,
            (Some(_), None) => FileStatus::Removed,
            _ => FileStatus::Modified,
        };
        PullRequestFile {
            file_id: FileId::new(path),
            file_path: path.into(),
            previous_file_path: None,
            status,
            before_content: before.map(str::to_string),
            after_content: after.map(str::to_string),
            patch: None,
            is_binary: false,
            unsupported: None,
        }
    }

    fn renamed_pr_file(
        before_path: &str,
        after_path: &str,
        before: &str,
        after: &str,
    ) -> PullRequestFile {
        PullRequestFile {
            file_id: FileId::new(after_path),
            file_path: after_path.into(),
            previous_file_path: Some(before_path.into()),
            status: FileStatus::Renamed,
            before_content: Some(before.into()),
            after_content: Some(after.into()),
            patch: None,
            is_binary: false,
            unsupported: None,
        }
    }

    #[test]
    fn detect_language_recognizes_go_extension() {
        assert_eq!(detect_language("foo/bar.go").as_deref(), Some("go"));
        assert_eq!(detect_language("FOO.GO").as_deref(), Some("go"));
        assert_eq!(detect_language("noext").as_deref(), None);
    }

    #[test]
    fn go_file_routes_to_go_adapter() {
        let file = pr_file(
            "x.go",
            Some("package main\nfunc A() {}\n"),
            Some("package main\nfunc A() {}\nfunc B() {}\n"),
        );
        let r = analyze_pull_request_file(&file);
        assert_eq!(r.adapter_name, GoParserAdapter::NAME);
        assert_eq!(r.items.len(), 1);
        assert_eq!(r.items[0].change_type, ChangeType::Added);
        assert_eq!(r.items[0].kind, SymbolKind::Function);
        assert_eq!(r.items[0].display_name, "B");
    }

    #[test]
    fn non_go_file_routes_to_fallback() {
        let file = pr_file("README.md", Some("old"), Some("new"));
        let r = analyze_pull_request_file(&file);
        assert_eq!(r.adapter_name, FallbackLineParserAdapter::NAME);
        assert_eq!(r.items.len(), 1);
        assert_eq!(r.items[0].change_type, ChangeType::Modified);
    }

    #[test]
    fn binary_file_returns_empty_result() {
        let mut file = pr_file("blob.bin", None, None);
        file.is_binary = true;
        let r = analyze_pull_request_file(&file);
        assert!(r.items.is_empty());
        assert!(r.adapter_name.is_empty());
    }

    #[test]
    fn unsupported_file_returns_empty_result() {
        let mut file = pr_file("blob.txt", Some("a"), Some("b"));
        file.unsupported = Some(UnsupportedFile::PatchMissing {
            file_id: file.file_id.clone(),
            file_path: file.file_path.clone(),
            reason: "fetch failed".into(),
        });
        let r = analyze_pull_request_file(&file);
        assert!(r.items.is_empty());
    }

    #[test]
    fn missing_both_contents_returns_empty() {
        let file = pr_file("x.go", None, None);
        let r = analyze_pull_request_file(&file);
        assert!(r.items.is_empty());
    }

    #[test]
    fn go_added_file_shows_each_function_as_added() {
        let file = pr_file(
            "new.go",
            None,
            Some("package main\nfunc X() {}\nfunc Y() {}\n"),
        );
        let r = analyze_pull_request_file(&file);
        assert_eq!(r.items.len(), 2);
        for item in &r.items {
            assert_eq!(item.change_type, ChangeType::Added);
        }
    }

    #[test]
    fn non_go_renamed_file_uses_previous_path_for_fallback() {
        let file = renamed_pr_file("old.md", "new.md", "same\n", "same\n");
        let r = analyze_pull_request_file(&file);
        assert_eq!(r.adapter_name, FallbackLineParserAdapter::NAME);
        assert_eq!(r.items.len(), 1);
        assert_eq!(r.items[0].change_type, ChangeType::Renamed);
        assert_eq!(r.items[0].display_name, "new.md");
    }

    #[test]
    fn go_rename_only_file_emits_file_level_rename_item() {
        let content = "package main\nfunc A() {}\n";
        let file = renamed_pr_file("old.go", "new.go", content, content);
        let r = analyze_pull_request_file(&file);
        assert_eq!(r.adapter_name, GoParserAdapter::NAME);
        assert_eq!(r.items.len(), 1);
        assert_eq!(r.items[0].change_type, ChangeType::Renamed);
        assert_eq!(r.items[0].kind, SymbolKind::Module);
        assert_eq!(r.items[0].display_name, "new.go");
    }
}
