//! セッション永続化。
//!
//! ウィンドウサイズなど「アプリを再起動しても引き継ぎたい状態」を
//! `~/Library/Application Support/locus/session.json` (macOS) /
//! `$XDG_CONFIG_HOME/locus/session.json` (Linux) に書き出す。
//!
//! ファイル I/O は best-effort で、失敗しても tracing で warn するだけで
//! アプリは続行する (起動時に corrupt JSON / permission denied / disk full
//! などで止めない方針)。
//!
//! 将来 wire schema が変わっても壊れた entry だけで window state ごと捨て
//! ないように、deserialize は lossy 実装になっている。schema_version は
//! `SESSION_SCHEMA_VERSION` 定数で管理する (#284)。

use std::collections::HashMap;
use std::path::PathBuf;

use directories::ProjectDirs;
use serde::de::Deserializer;
use serde::{Deserialize, Serialize};

use crate::review::draft::DraftEntry;

/// このバイナリが書き出す session.json の schema version。
///
/// schema を変える際 (フィールドの意味を破壊的に変える等) はこの値を
/// インクリメントする。新しい optional field を追加するだけなら
/// インクリメント不要。
pub const SESSION_SCHEMA_VERSION: u32 = 1;

/// `schema_version` 導入前の session.json は v1 として扱う。
///
/// ここを `SESSION_SCHEMA_VERSION` に連動させると、将来 schema を v2 へ上げた
/// ときに既存の version 欠落ファイルまで v2 と誤認するため、固定値にする。
pub const LEGACY_SESSION_SCHEMA_VERSION: u32 = 1;

/// 読み込み側が解釈できる最大 schema version。
///
/// `MAX_KNOWN_SCHEMA_VERSION` を超える session.json は「未来の locus が
/// 書いたファイル」として扱い、window state など解釈できる範囲だけ
/// 引き継ぎ、draft などの構造化データは捨てる。
pub const MAX_KNOWN_SCHEMA_VERSION: u32 = SESSION_SCHEMA_VERSION;

/// PR 単位の永続化状態。
///
/// 同じ owner/repo#pr を再度開いたとき、draft entries を復元する。snapshot
/// は再取得するので、anchor の file_id / line が現在の diff とずれている場合
/// は そのまま表示される (label は描画できる、snippet は format_prompt が
/// 旧 anchor を参照したときに `(missing)` 等になる)。
#[derive(Debug, Clone, Default, Serialize, PartialEq)]
pub struct PerPrState {
    /// 直近に選択していた file index。0 始まり。
    pub selected_file_index: Option<i32>,
    /// 蓄積中の draft entries。
    pub draft: Vec<DraftEntry>,
}

impl<'de> Deserialize<'de> for PerPrState {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        let value = serde_json::Value::deserialize(deserializer)?;
        // PerPrState 単体には schema_version が無いので、単体 decode は現行
        // schema とみなす。未来 schema 判定は SessionState 経由の decode で
        // per_pr value に is_future を伝播して行う。
        Ok(decode_per_pr_value(&value, false).unwrap_or_default())
    }
}

/// ローカル永続化される session 状態。
///
/// `Deserialize` は custom 実装で lossy にしてあり (#284)、壊れた draft entry
/// や型ミスマッチな per_pr value 1 つで window state まで失われないように
/// している。`Serialize` は derive。
#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct SessionState {
    /// 書き出し時の schema version。読み込み時は将来 schema を検出するために
    /// 利用される。在メモリ表現は常に現行 schema 形なので、load 時は
    /// `SESSION_SCHEMA_VERSION` 以下に固定される。
    pub schema_version: u32,
    /// 最後に閉じた時のウィンドウ幅 (logical px)。
    pub window_width: Option<f32>,
    /// 最後に閉じた時のウィンドウ高さ (logical px)。
    pub window_height: Option<f32>,
    /// 最後に閉じた時のウィンドウ X 位置 (logical px、screen 原点)。
    pub window_x: Option<f32>,
    /// 最後に閉じた時のウィンドウ Y 位置 (logical px、screen 原点)。
    pub window_y: Option<f32>,
    /// PR 単位の状態。key は "owner/repo#pr" 形式の文字列。
    pub per_pr: HashMap<String, PerPrState>,
}

impl Default for SessionState {
    fn default() -> Self {
        Self {
            schema_version: SESSION_SCHEMA_VERSION,
            window_width: None,
            window_height: None,
            window_x: None,
            window_y: None,
            per_pr: HashMap::new(),
        }
    }
}

impl SessionState {
    /// "owner/repo#pr" key を作る。
    pub fn pr_key(owner: &str, repo: &str, pr: u64) -> String {
        format!("{owner}/{repo}#{pr}")
    }

    /// `serde_json::Value` から lossy に SessionState を組み立てる。
    ///
    /// - 壊れた draft entry は skip
    /// - 壊れた per_pr value (object でない、selected_file_index が数値でない等) は
    ///   skip するか、当該フィールドだけ default にする
    /// - schema_version > MAX_KNOWN_SCHEMA_VERSION の場合は draft を捨てる
    fn from_json_value(value: &serde_json::Value) -> Self {
        let mut state = SessionState::default();
        let Some(map) = value.as_object() else {
            return state;
        };

        let schema_in_file = map
            .get("schema_version")
            .and_then(|v| v.as_u64())
            .map(|v| u32::try_from(v).unwrap_or(u32::MAX))
            .unwrap_or(LEGACY_SESSION_SCHEMA_VERSION);
        let is_future = schema_in_file > MAX_KNOWN_SCHEMA_VERSION;

        state.window_width = map.get("window_width").and_then(json_as_f32);
        state.window_height = map.get("window_height").and_then(json_as_f32);
        state.window_x = map.get("window_x").and_then(json_as_f32);
        state.window_y = map.get("window_y").and_then(json_as_f32);

        if let Some(per_pr_obj) = map.get("per_pr").and_then(|v| v.as_object()) {
            for (k, v) in per_pr_obj {
                if let Some(per_pr_state) = decode_per_pr_value(v, is_future) {
                    state.per_pr.insert(k.clone(), per_pr_state);
                }
            }
        }

        state
    }
}

impl<'de> Deserialize<'de> for SessionState {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        let value = serde_json::Value::deserialize(deserializer)?;
        Ok(SessionState::from_json_value(&value))
    }
}

fn json_as_f32(value: &serde_json::Value) -> Option<f32> {
    value.as_f64().map(|v| v as f32)
}

/// 1 つの per_pr value を lossy に decode する。
///
/// - object でない場合は `None` (= 当該 key を捨てる)
/// - selected_file_index が数値でなければ None
/// - draft 配列内の壊れた entry は skip し、decode できる entry は残す
/// - is_future == true なら draft は丸ごと捨てる (selected_file_index は preserve)
fn decode_per_pr_value(value: &serde_json::Value, is_future: bool) -> Option<PerPrState> {
    let map = value.as_object()?;
    let selected_file_index = map
        .get("selected_file_index")
        .and_then(|v| v.as_i64())
        .and_then(|v| i32::try_from(v).ok());
    let mut state = PerPrState {
        selected_file_index,
        ..Default::default()
    };

    if !is_future
        && let Some(arr) = map.get("draft").and_then(|v| v.as_array())
    {
        for entry_val in arr {
            if let Ok(entry) = serde_json::from_value::<DraftEntry>(entry_val.clone()) {
                state.draft.push(entry);
            }
        }
    }

    Some(state)
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
///
/// derive `Serialize` 経由で `schema_version` を含む全フィールドをそのまま
/// 出力する。
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
    use crate::review::draft::DraftEntry;
    use crate::review::selection::{Granularity, SelectionAnchor, Side};
    use crate::review::snapshot::FileId;
    use serde_json::json;

    fn sample_anchor(path: &str, line: u32) -> SelectionAnchor {
        SelectionAnchor {
            file_id: FileId::new(path),
            file_path: path.into(),
            granularity: Granularity::Line {
                line,
                side: Side::After,
            },
        }
    }

    #[test]
    fn default_session_state_has_no_window_size() {
        let s = SessionState::default();
        assert!(s.window_width.is_none());
        assert!(s.window_height.is_none());
    }

    #[test]
    fn default_session_state_has_current_schema_version() {
        let s = SessionState::default();
        assert_eq!(s.schema_version, SESSION_SCHEMA_VERSION);
        assert_eq!(s.schema_version, 1);
    }

    #[test]
    fn round_trip_through_json() {
        let original = SessionState {
            schema_version: SESSION_SCHEMA_VERSION,
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
    fn round_trip_preserves_schema_version() {
        let original = SessionState::default();
        let json = serde_json::to_string(&original).unwrap();
        assert!(
            json.contains("\"schema_version\":1"),
            "expected serialized form to include schema_version=1, got: {json}"
        );
        let decoded: SessionState = serde_json::from_str(&json).unwrap();
        assert_eq!(decoded.schema_version, SESSION_SCHEMA_VERSION);
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
        let mut original = SessionState::default();
        let key = SessionState::pr_key("o", "r", 1);
        original.per_pr.insert(
            key.clone(),
            PerPrState {
                selected_file_index: Some(2),
                draft: vec![DraftEntry::new(sample_anchor("a.rs", 42), Some("note".into()))],
            },
        );

        let json = serde_json::to_string(&original).unwrap();
        let decoded: SessionState = serde_json::from_str(&json).unwrap();
        assert_eq!(
            decoded.per_pr.get(&key).unwrap().selected_file_index,
            Some(2)
        );
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
        assert_eq!(decoded.schema_version, SESSION_SCHEMA_VERSION);
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

    #[test]
    fn old_session_without_schema_version_loads_as_v1() {
        // 既存 (#284 以前) の session.json は schema_version field を持たない。
        // 読み込み側はそれを schema v1 として解釈する。
        let json = r#"{
            "window_width": 1300.0,
            "window_height": 800.0,
            "per_pr": {
                "o/r#1": {"selected_file_index": 3, "draft": []}
            }
        }"#;
        let decoded: SessionState = serde_json::from_str(json).unwrap();
        assert_eq!(decoded.schema_version, SESSION_SCHEMA_VERSION);
        assert_eq!(decoded.window_width, Some(1300.0));
        assert_eq!(
            decoded.per_pr.get("o/r#1").unwrap().selected_file_index,
            Some(3)
        );
    }

    #[test]
    fn missing_schema_version_uses_fixed_legacy_v1() {
        // 将来 SESSION_SCHEMA_VERSION を上げても、version 欠落ファイルは常に
        // 「schema version 導入前の v1」として扱う。
        let json = r#"{"window_width": 1200.0}"#;
        let decoded: SessionState = serde_json::from_str(json).unwrap();
        assert_eq!(LEGACY_SESSION_SCHEMA_VERSION, 1);
        assert_eq!(decoded.schema_version, SESSION_SCHEMA_VERSION);
        assert_eq!(decoded.window_width, Some(1200.0));
    }

    #[test]
    fn future_schema_preserves_window_state_and_drops_draft() {
        // schema_version > MAX_KNOWN_SCHEMA_VERSION の session.json は、
        // 解釈できる範囲 (window state, selected_file_index) は preserve し、
        // draft は丸ごと捨てる。
        let json = r#"{
            "schema_version": 999,
            "window_width": 1300.0,
            "window_height": 800.0,
            "window_x": 100.0,
            "window_y": 50.0,
            "per_pr": {
                "o/r#1": {
                    "selected_file_index": 7,
                    "draft": [
                        {"this_is_an_unknown_future_format": true}
                    ],
                    "future_field_in_per_pr": "ignored"
                }
            }
        }"#;
        let decoded: SessionState = serde_json::from_str(json).unwrap();
        assert_eq!(decoded.window_width, Some(1300.0));
        assert_eq!(decoded.window_height, Some(800.0));
        assert_eq!(decoded.window_x, Some(100.0));
        assert_eq!(decoded.window_y, Some(50.0));
        assert_eq!(decoded.per_pr.len(), 1);
        let pr_state = decoded.per_pr.get("o/r#1").unwrap();
        assert_eq!(pr_state.selected_file_index, Some(7));
        assert!(
            pr_state.draft.is_empty(),
            "future-schema draft must be dropped, got: {:?}",
            pr_state.draft
        );
    }

    #[test]
    fn broken_draft_entry_is_skipped_but_valid_entries_are_kept() {
        // draft 配列の途中に壊れた entry が混じっていても、decode できる entry は残す。
        let valid_a = DraftEntry::new(sample_anchor("a.rs", 10), Some("a-note".into()));
        let valid_b = DraftEntry::new(sample_anchor("b.rs", 20), None);

        let session_json = json!({
            "schema_version": SESSION_SCHEMA_VERSION,
            "per_pr": {
                "o/r#1": {
                    "selected_file_index": 0,
                    "draft": [
                        serde_json::to_value(&valid_a).unwrap(),
                        json!({"foo": "this is not a valid DraftEntry"}),
                        serde_json::to_value(&valid_b).unwrap(),
                    ]
                }
            }
        });

        let decoded: SessionState = serde_json::from_value(session_json).unwrap();
        let pr_state = decoded.per_pr.get("o/r#1").unwrap();
        assert_eq!(pr_state.selected_file_index, Some(0));
        assert_eq!(
            pr_state.draft.len(),
            2,
            "valid entries must survive, got: {:?}",
            pr_state.draft
        );
        assert_eq!(pr_state.draft[0], valid_a);
        assert_eq!(pr_state.draft[1], valid_b);
    }

    #[test]
    fn per_pr_state_direct_deserialize_is_lossy() {
        let valid = DraftEntry::new(sample_anchor("a.rs", 10), Some("note".into()));
        let per_pr_json = json!({
            "selected_file_index": 1,
            "draft": [
                serde_json::to_value(&valid).unwrap(),
                json!({"foo": "broken"})
            ]
        });

        let decoded: PerPrState = serde_json::from_value(per_pr_json).unwrap();
        assert_eq!(decoded.selected_file_index, Some(1));
        assert_eq!(decoded.draft, vec![valid]);
    }

    #[test]
    fn broken_per_pr_value_does_not_drop_other_state() {
        // per_pr の中に object でない壊れた value が混じっても、
        // 他の per_pr key と window state は失われない。
        let valid_entry = DraftEntry::new(sample_anchor("a.rs", 5), None);
        let session_json = json!({
            "schema_version": SESSION_SCHEMA_VERSION,
            "window_width": 1234.0,
            "window_height": 567.0,
            "per_pr": {
                "good/repo#1": {
                    "selected_file_index": 4,
                    "draft": [serde_json::to_value(&valid_entry).unwrap()]
                },
                "bad/repo#2": "this-is-not-an-object",
                "broken-types/repo#3": {
                    "selected_file_index": "not-an-int",
                    "draft": "not-an-array"
                }
            }
        });

        let decoded: SessionState = serde_json::from_value(session_json).unwrap();

        // window state は preserve
        assert_eq!(decoded.window_width, Some(1234.0));
        assert_eq!(decoded.window_height, Some(567.0));

        // 健全な per_pr は preserve
        let good = decoded
            .per_pr
            .get("good/repo#1")
            .expect("valid per_pr must remain");
        assert_eq!(good.selected_file_index, Some(4));
        assert_eq!(good.draft, vec![valid_entry]);

        // object でない value は捨てる
        assert!(
            !decoded.per_pr.contains_key("bad/repo#2"),
            "non-object per_pr value should be dropped"
        );

        // 一部のフィールドだけ壊れた value は default で埋めて残す
        let broken = decoded
            .per_pr
            .get("broken-types/repo#3")
            .expect("partially-broken per_pr value should still be retained with defaults");
        assert!(broken.selected_file_index.is_none());
        assert!(broken.draft.is_empty());
    }

    #[test]
    fn write_state_serialize_includes_schema_version() {
        // serialize 経路 (= write_state_to_disk が使う derive Serialize) に
        // schema_version が含まれる。
        let state = SessionState::default();
        let json = serde_json::to_string_pretty(&state).unwrap();
        assert!(
            json.contains("\"schema_version\""),
            "serialized form must include schema_version, got: {json}"
        );
    }
}
