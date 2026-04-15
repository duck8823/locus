//! FileDiff / PullRequestFile から Slint の DiffFileView への詰め替え。

use std::rc::Rc;

use slint::{Model, ModelRc, SharedString, VecModel};

use crate::github::pull_request::{FileStatus, PullRequestFile};
use crate::review::diff::{FileDiff, LineKind};
use crate::review::diff_builder::build_file_diff;
use crate::review::snapshot::UnsupportedFile;
use crate::{DiffFileView, DiffLineView};

pub fn build_diff_file_views(files: &[PullRequestFile]) -> Vec<DiffFileView> {
    files.iter().map(build_diff_file_view).collect()
}

pub fn build_diff_file_view(file: &PullRequestFile) -> DiffFileView {
    let status_label = status_label(file.status);

    if let Some(reason) = &file.unsupported {
        return DiffFileView {
            file_path: SharedString::from(file.file_path.as_str()),
            status_label: SharedString::from(status_label),
            is_unsupported: true,
            unsupported_reason: SharedString::from(unsupported_reason(reason)),
            lines: empty_line_model(),
        };
    }

    let diff = build_file_diff(
        file.before_content.as_deref(),
        file.after_content.as_deref(),
        file.file_id.clone(),
        file.file_path.clone(),
    );
    let lines = flatten_diff_lines(&diff);

    DiffFileView {
        file_path: SharedString::from(file.file_path.as_str()),
        status_label: SharedString::from(status_label),
        is_unsupported: false,
        unsupported_reason: SharedString::default(),
        lines,
    }
}

fn flatten_diff_lines(diff: &FileDiff) -> ModelRc<DiffLineView> {
    let model = VecModel::<DiffLineView>::default();
    for hunk in &diff.hunks {
        model.push(DiffLineView {
            kind: 0,
            old_line_no: SharedString::default(),
            new_line_no: SharedString::default(),
            content: SharedString::from(hunk.header()),
        });
        for line in &hunk.lines {
            model.push(DiffLineView {
                kind: linekind_to_int(line.kind),
                old_line_no: line
                    .old_line_no
                    .map(|n| SharedString::from(n.to_string()))
                    .unwrap_or_default(),
                new_line_no: line
                    .new_line_no
                    .map(|n| SharedString::from(n.to_string()))
                    .unwrap_or_default(),
                content: SharedString::from(line.content.as_str()),
            });
        }
    }
    ModelRc::from(Rc::new(model) as Rc<dyn Model<Data = DiffLineView>>)
}

fn empty_line_model() -> ModelRc<DiffLineView> {
    let model = VecModel::<DiffLineView>::default();
    ModelRc::from(Rc::new(model) as Rc<dyn Model<Data = DiffLineView>>)
}

fn linekind_to_int(kind: LineKind) -> i32 {
    match kind {
        LineKind::Context => 0,
        LineKind::Added => 1,
        LineKind::Removed => 2,
    }
}

fn status_label(status: FileStatus) -> &'static str {
    match status {
        FileStatus::Added => "A",
        FileStatus::Modified => "M",
        FileStatus::Removed => "D",
        FileStatus::Renamed => "R",
        FileStatus::Copied => "C",
        FileStatus::Changed => "Ch",
        FileStatus::Unchanged => "=",
    }
}

fn unsupported_reason(reason: &UnsupportedFile) -> String {
    match reason {
        UnsupportedFile::Binary { .. } => "binary file (content not fetched)".into(),
        UnsupportedFile::PatchMissing { reason, .. } => format!("patch missing: {reason}"),
        UnsupportedFile::ParserFailed { detail, .. } => format!("parser failed: {detail}"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::github::pull_request::PullRequestFile;
    use crate::review::snapshot::FileId;

    fn base_file() -> PullRequestFile {
        PullRequestFile {
            file_id: FileId::new("a.txt"),
            file_path: "a.txt".into(),
            status: FileStatus::Modified,
            before_content: Some("a\nb\nc\n".into()),
            after_content: Some("a\nB\nc\n".into()),
            patch: None,
            is_binary: false,
            unsupported: None,
        }
    }

    #[test]
    fn supported_file_produces_lines() {
        let view = build_diff_file_view(&base_file());
        assert!(!view.is_unsupported);
        assert!(view.lines.row_count() > 0);
    }

    #[test]
    fn unsupported_file_short_circuits_lines() {
        let mut file = base_file();
        file.unsupported = Some(UnsupportedFile::Binary {
            file_id: file.file_id.clone(),
            file_path: file.file_path.clone(),
        });
        let view = build_diff_file_view(&file);
        assert!(view.is_unsupported);
        assert_eq!(view.lines.row_count(), 0);
    }

    #[test]
    fn status_labels_stable() {
        assert_eq!(status_label(FileStatus::Added), "A");
        assert_eq!(status_label(FileStatus::Modified), "M");
        assert_eq!(status_label(FileStatus::Removed), "D");
        assert_eq!(status_label(FileStatus::Renamed), "R");
    }
}
