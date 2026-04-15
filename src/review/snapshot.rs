/// Before/after で安定したファイル識別子。
///
/// GitHub ではリネームがあっても同じ file として扱いたいので、path ではなく
/// 別の識別を持たせる余地を残す。v0.1 では単純に path ベースで発行する想定。
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct FileId(pub String);

impl FileId {
    pub fn new(id: impl Into<String>) -> Self {
        Self(id.into())
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum Revision {
    Before,
    After,
}

/// 1ファイルの before/after どちらか一方のスナップショット。
///
/// セマンティック解析や diff 再構成はこのスナップショットを正本とする。
/// patch string は viewer 向けの派生ビューにすぎない。
#[derive(Debug, Clone)]
pub struct SourceSnapshot {
    pub file_id: FileId,
    pub file_path: String,
    pub language: Option<String>,
    pub revision: Revision,
    pub content: String,
}

/// 解析・表示対象外となったファイルを明示的に記録するための型。
///
/// 「黙って落とす」と信頼を失うため、理由付きで UI まで届ける前提。
#[derive(Debug, Clone)]
pub enum UnsupportedFile {
    Binary {
        file_id: FileId,
        file_path: String,
    },
    PatchMissing {
        file_id: FileId,
        file_path: String,
        reason: String,
    },
    ParserFailed {
        file_id: FileId,
        file_path: String,
        detail: String,
    },
}

impl UnsupportedFile {
    pub fn file_path(&self) -> &str {
        match self {
            UnsupportedFile::Binary { file_path, .. }
            | UnsupportedFile::PatchMissing { file_path, .. }
            | UnsupportedFile::ParserFailed { file_path, .. } => file_path,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn file_id_round_trip() {
        let id = FileId::new("src/main.rs");
        assert_eq!(id.as_str(), "src/main.rs");
    }

    #[test]
    fn unsupported_file_path_accessor() {
        let cases = [
            UnsupportedFile::Binary {
                file_id: FileId::new("a"),
                file_path: "a.bin".into(),
            },
            UnsupportedFile::PatchMissing {
                file_id: FileId::new("b"),
                file_path: "b.txt".into(),
                reason: "too large".into(),
            },
            UnsupportedFile::ParserFailed {
                file_id: FileId::new("c"),
                file_path: "c.rs".into(),
                detail: "syntax error".into(),
            },
        ];
        let paths: Vec<&str> = cases.iter().map(UnsupportedFile::file_path).collect();
        assert_eq!(paths, vec!["a.bin", "b.txt", "c.rs"]);
    }
}
