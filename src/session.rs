//! セッション永続化。
//!
//! ウィンドウサイズなど「アプリを再起動しても引き継ぎたい状態」を
//! `~/Library/Application Support/locus/session.json` (macOS) /
//! `$XDG_CONFIG_HOME/locus/session.json` (Linux) に書き出す。
//!
//! ファイル I/O は best-effort で、失敗しても tracing で warn するだけで
//! アプリは続行する (起動時に corrupt JSON / permission denied / disk full
//! などで止めない方針)。

use std::collections::HashMap;
use std::path::PathBuf;

use directories::ProjectDirs;
use serde::{Deserialize, Serialize};

use crate::review::draft::DraftEntry;

/// PR 単位の永続化状態。
///
/// 同じ owner/repo#pr を再度開いたとき、draft entries を復元する。snapshot
/// は再取得するので、anchor の file_id / line が現在の diff とずれている場合
/// は そのまま表示される (label は描画できる、snippet は format_prompt が
/// 旧 anchor を参照したときに `(missing)` 等になる)。
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
pub struct PerPrState {
    /// 直近に選択していた file index。0 始まり。
    #[serde(default)]
    pub selected_file_index: Option<i32>,
    /// 蓄積中の draft entries。
    #[serde(default)]
    pub draft: Vec<DraftEntry>,
}

/// ローカル永続化される session 状態。schema が将来増えたら `#[serde(default)]`
/// で後方互換を取る (古い session.json で新フィールドは default に倒れる)。
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
pub struct SessionState {
    /// 最後に閉じた時のウィンドウ幅 (logical px)。
    #[serde(default)]
    pub window_width: Option<f32>,
    /// 最後に閉じた時のウィンドウ高さ (logical px)。
    #[serde(default)]
    pub window_height: Option<f32>,
    /// 最後に閉じた時のウィンドウ X 位置 (logical px、screen 原点)。
    #[serde(default)]
    pub window_x: Option<f32>,
    /// 最後に閉じた時のウィンドウ Y 位置 (logical px、screen 原点)。
    #[serde(default)]
    pub window_y: Option<f32>,
    /// PR 単位の状態。key は "owner/repo#pr" 形式の文字列。
    #[serde(default)]
    pub per_pr: HashMap<String, PerPrState>,
}

impl SessionState {
    /// "owner/repo#pr" key を作る。
    pub fn pr_key(owner: &str, repo: &str, pr: u64) -> String {
        format!("{owner}/{repo}#{pr}")
    }
}

/// `directories` crate で OS 固有の config 領域を解決する。
///
/// reverse-DNS な subfolder を避けるため `qualifier` / `organization` を
/// 空にして `application = "locus"` だけ渡す。実際の解決先:
/// - macOS: `~/Library/Application Support/locus/session.json`
/// - Linux: `$XDG_CONFIG_HOME/locus/session.json` (default `~/.config/locus/`)
/// - Windows: `%APPDATA%\locus\config\session.json`
pub fn session_path() -> Option<PathBuf> {
    let dirs = ProjectDirs::from("", "", "locus")?;
    Some(dirs.config_dir().join("session.json"))
}

/// セッションを読み込む。
///
/// 戻り値の意味:
/// - `Some(SessionState)`: 読み込み成功
/// - `None`: ファイル不在 / 読み込み or parse 失敗 (NotFound 以外は warn ログ)
pub fn load() -> Option<SessionState> {
    let path = session_path()?;
    match std::fs::read_to_string(&path) {
        Ok(s) => match serde_json::from_str::<SessionState>(&s) {
            Ok(state) => Some(state),
            Err(e) => {
                tracing::warn!(path = %path.display(), error = %e, "failed to parse session.json (ignoring)");
                None
            }
        },
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => None,
        Err(e) => {
            tracing::warn!(path = %path.display(), error = %e, "failed to read session.json");
            None
        }
    }
}

use std::sync::Mutex;

/// プロセス内 cache。`mutate` の read-modify-write を 1 つの critical section
/// で守るために単一 Mutex で持つ。`save()` も同じ lock を使うので、
/// 並行な mutate / save が混在しても後勝ち上書きで partial update を失わない。
static LAST_SAVED: Mutex<Option<SessionState>> = Mutex::new(None);

/// LAST_SAVED の lock 配下で current state を取り出して closure で書き換え、
/// disk へ flush するまでを 1 つの critical section で行う。
pub fn mutate(updater: impl FnOnce(&mut SessionState)) {
    let mut guard = match LAST_SAVED.lock() {
        Ok(g) => g,
        Err(p) => p.into_inner(),
    };
    let mut state = guard.clone().unwrap_or_else(|| load().unwrap_or_default());
    updater(&mut state);
    if let Some(prev) = guard.as_ref()
        && prev == &state
    {
        return;
    }
    if let Err(e) = write_state_to_disk(&state) {
        tracing::warn!(error = %e, "failed to persist session state");
        return;
    }
    *guard = Some(state);
}

/// 純粋な write 経路 (lock を持たない、エラーは Err で返す)。`mutate` から
/// 呼ばれる。
fn write_state_to_disk(state: &SessionState) -> Result<(), String> {
    let path = session_path().ok_or_else(|| "could not resolve session.json path".to_string())?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("create_dir_all {}: {}", parent.display(), e))?;
    }
    let json = serde_json::to_string_pretty(state)
        .map_err(|e| format!("serialize: {e}"))?;
    std::fs::write(&path, json).map_err(|e| format!("write {}: {}", path.display(), e))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_session_state_has_no_window_size() {
        let s = SessionState::default();
        assert!(s.window_width.is_none());
        assert!(s.window_height.is_none());
    }

    #[test]
    fn round_trip_through_json() {
        let original = SessionState {
            window_width: Some(1700.0),
            window_height: Some(960.0),
            window_x: Some(120.0),
            window_y: Some(48.0),
            per_pr: HashMap::new(),
        };
        let json = serde_json::to_string(&original).unwrap();
        let decoded: SessionState = serde_json::from_str(&json).unwrap();
        assert_eq!(decoded, original);
    }

    #[test]
    fn pr_key_format_is_stable() {
        assert_eq!(
            SessionState::pr_key("duck8823", "locus", 282),
            "duck8823/locus#282"
        );
    }

    #[test]
    fn per_pr_round_trip_with_draft_entry() {
        use crate::review::draft::DraftEntry;
        use crate::review::selection::{Granularity, SelectionAnchor, Side};
        use crate::review::snapshot::FileId;

        let mut original = SessionState::default();
        let key = SessionState::pr_key("o", "r", 1);
        original.per_pr.insert(
            key.clone(),
            PerPrState {
                selected_file_index: Some(2),
                draft: vec![DraftEntry::new(
                    SelectionAnchor {
                        file_id: FileId::new("a.rs"),
                        file_path: "a.rs".into(),
                        granularity: Granularity::Line {
                            line: 42,
                            side: Side::After,
                        },
                    },
                    Some("note".into()),
                )],
            },
        );

        let json = serde_json::to_string(&original).unwrap();
        let decoded: SessionState = serde_json::from_str(&json).unwrap();
        assert_eq!(decoded.per_pr.get(&key).unwrap().selected_file_index, Some(2));
        assert_eq!(decoded.per_pr.get(&key).unwrap().draft.len(), 1);
    }

    #[test]
    fn missing_fields_default_to_none() {
        let json = r#"{}"#;
        let decoded: SessionState = serde_json::from_str(json).unwrap();
        assert!(decoded.window_width.is_none());
        assert!(decoded.window_height.is_none());
        assert!(decoded.window_x.is_none());
        assert!(decoded.window_y.is_none());
    }

    #[test]
    fn unknown_fields_are_ignored() {
        let json = r#"{"window_width": 100.0, "future_field": "future_value"}"#;
        let decoded: SessionState = serde_json::from_str(json).unwrap();
        assert_eq!(decoded.window_width, Some(100.0));
        assert!(decoded.window_height.is_none());
    }

    #[test]
    fn old_session_without_position_loads_cleanly() {
        // 旧 session.json (window_width / window_height のみ) が新 schema で
        // 読めて、欠落した window_x / window_y が None に倒れる。
        let json = r#"{"window_width": 1300.0, "window_height": 822.0}"#;
        let decoded: SessionState = serde_json::from_str(json).unwrap();
        assert_eq!(decoded.window_width, Some(1300.0));
        assert_eq!(decoded.window_height, Some(822.0));
        assert!(decoded.window_x.is_none());
        assert!(decoded.window_y.is_none());
    }
}
