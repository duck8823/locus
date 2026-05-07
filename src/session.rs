//! セッション永続化。
//!
//! ウィンドウサイズなど「アプリを再起動しても引き継ぎたい状態」を
//! `~/Library/Application Support/locus/session.json` (macOS) /
//! `$XDG_CONFIG_HOME/locus/session.json` (Linux) に書き出す。
//!
//! ファイル I/O は best-effort で、失敗しても tracing で warn するだけで
//! アプリは続行する (起動時に corrupt JSON / permission denied / disk full
//! などで止めない方針)。

use std::path::PathBuf;

use directories::ProjectDirs;
use serde::{Deserialize, Serialize};

/// ローカル永続化される session 状態。schema が将来増えたら `#[serde(default)]`
/// で後方互換を取る (古い session.json で新フィールドは default に倒れる)。
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct SessionState {
    /// 最後に閉じた時のウィンドウ幅 (logical px)。
    #[serde(default)]
    pub window_width: Option<f32>,
    /// 最後に閉じた時のウィンドウ高さ (logical px)。
    #[serde(default)]
    pub window_height: Option<f32>,
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

/// セッションを書き出す。失敗時は warn ログのみで panic しない。
pub fn save(state: &SessionState) {
    let Some(path) = session_path() else {
        tracing::warn!("could not resolve session.json path");
        return;
    };
    if let Some(parent) = path.parent()
        && let Err(e) = std::fs::create_dir_all(parent)
    {
        tracing::warn!(path = %parent.display(), error = %e, "failed to create config dir");
        return;
    }
    let json = match serde_json::to_string_pretty(state) {
        Ok(s) => s,
        Err(e) => {
            tracing::warn!(error = %e, "failed to serialize session state");
            return;
        }
    };
    if let Err(e) = std::fs::write(&path, json) {
        tracing::warn!(path = %path.display(), error = %e, "failed to write session.json");
    }
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
        };
        let json = serde_json::to_string(&original).unwrap();
        let decoded: SessionState = serde_json::from_str(&json).unwrap();
        assert_eq!(decoded.window_width, Some(1700.0));
        assert_eq!(decoded.window_height, Some(960.0));
    }

    #[test]
    fn missing_fields_default_to_none() {
        let json = r#"{}"#;
        let decoded: SessionState = serde_json::from_str(json).unwrap();
        assert!(decoded.window_width.is_none());
        assert!(decoded.window_height.is_none());
    }

    #[test]
    fn unknown_fields_are_ignored() {
        let json = r#"{"window_width": 100.0, "future_field": "future_value"}"#;
        let decoded: SessionState = serde_json::from_str(json).unwrap();
        assert_eq!(decoded.window_width, Some(100.0));
        assert!(decoded.window_height.is_none());
    }
}
