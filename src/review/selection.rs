use super::snapshot::FileId;

/// 選択時にどちら側の行番号を指しているか。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum Side {
    Before,
    After,
}

/// 選択の粒度。
///
/// line-based な固定を避けるため、line 以上の粒度（range/hunk/file）を
/// 型レベルで用意する。
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub enum Granularity {
    File,
    Hunk { hunk_index: usize },
    Range { start_line: u32, end_line: u32, side: Side },
    Line { line: u32, side: Side },
}

/// diff 上の選択を一意に指し示すアンカー。
///
/// PromptDraft はこれを複数束ねて整形する。Comment ではなく Selection と
/// 呼ぶのは、送り先が GitHub ではなく AI Agent CLI であり、「書き戻し前提の
/// レビューコメント」という体験を避けるため。
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct SelectionAnchor {
    pub file_id: FileId,
    pub file_path: String,
    pub granularity: Granularity,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn anchor_equality_on_same_file_and_granularity() {
        let a = SelectionAnchor {
            file_id: FileId::new("a"),
            file_path: "a.rs".into(),
            granularity: Granularity::Line {
                line: 10,
                side: Side::After,
            },
        };
        let b = a.clone();
        assert_eq!(a, b);
    }

    #[test]
    fn anchor_inequality_across_sides() {
        let a = SelectionAnchor {
            file_id: FileId::new("a"),
            file_path: "a.rs".into(),
            granularity: Granularity::Line {
                line: 10,
                side: Side::After,
            },
        };
        let b = SelectionAnchor {
            file_id: FileId::new("a"),
            file_path: "a.rs".into(),
            granularity: Granularity::Line {
                line: 10,
                side: Side::Before,
            },
        };
        assert_ne!(a, b);
    }
}
