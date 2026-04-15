use super::snapshot::FileId;

/// diff 行の種別。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LineKind {
    Context,
    Added,
    Removed,
}

/// unified diff 1 行分。
#[derive(Debug, Clone)]
pub struct DiffLine {
    pub kind: LineKind,
    pub old_line_no: Option<u32>,
    pub new_line_no: Option<u32>,
    pub content: String,
}

/// 1 hunk = @@ で区切られた差分ブロック。
#[derive(Debug, Clone)]
pub struct Hunk {
    pub old_start: u32,
    pub old_len: u32,
    pub new_start: u32,
    pub new_len: u32,
    pub lines: Vec<DiffLine>,
}

impl Hunk {
    pub fn header(&self) -> String {
        format!(
            "@@ -{},{} +{},{} @@",
            self.old_start, self.old_len, self.new_start, self.new_len
        )
    }
}

/// 1 ファイルの diff 内部モデル。
///
/// UI で描画する単位でもあり、selection anchor の解決単位でもある。
#[derive(Debug, Clone)]
pub struct FileDiff {
    pub file_id: FileId,
    pub file_path: String,
    pub hunks: Vec<Hunk>,
}

impl FileDiff {
    pub fn is_empty(&self) -> bool {
        self.hunks.is_empty()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn line_kind_equality() {
        assert_ne!(LineKind::Added, LineKind::Removed);
        assert_eq!(LineKind::Context, LineKind::Context);
    }

    #[test]
    fn hunk_header_format() {
        let hunk = Hunk {
            old_start: 10,
            old_len: 3,
            new_start: 10,
            new_len: 5,
            lines: vec![],
        };
        assert_eq!(hunk.header(), "@@ -10,3 +10,5 @@");
    }

    #[test]
    fn file_diff_is_empty_when_no_hunks() {
        let diff = FileDiff {
            file_id: FileId::new("x"),
            file_path: "x.rs".into(),
            hunks: vec![],
        };
        assert!(diff.is_empty());
    }
}
