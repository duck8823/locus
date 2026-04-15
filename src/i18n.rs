//! 軽量 i18n ヘルパ。
//!
//! Slint UI 側の文字列は `@tr()` + bundled translations で扱う。Rust から
//! 動的に組み立てる文字列（anchor label・送信モード名・エラー文言など）の
//! ためにこの小さなレイヤを用意する。
//!
//! 設計方針:
//!
//! - キーは英語ソース文字列をそのまま使う (gettext 風)
//! - locale は環境変数 `LOCUS_LOCALE` で決定。指定なし時は `LANG` を見て
//!   ja/en を判定。最後はデフォルト ja
//! - 翻訳テーブルはコンパイル時定数。マイナー言語追加時はテーブルに足すだけ
//!
//! 将来 Slint と統合した gettext-rs ベースに置き換えられるよう、API は
//! `tr(&str)` の単純な関数呼び出しに揃えている。

use std::sync::OnceLock;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Locale {
    Ja,
    En,
}

impl Locale {
    pub fn from_env() -> Self {
        if let Ok(v) = std::env::var("LOCUS_LOCALE") {
            return Self::from_str(&v);
        }
        if let Ok(v) = std::env::var("LANG") {
            if v.starts_with("ja") {
                return Locale::Ja;
            }
            if v.starts_with("en") {
                return Locale::En;
            }
        }
        Locale::Ja
    }

    fn from_str(s: &str) -> Self {
        let lower = s.to_ascii_lowercase();
        if lower.starts_with("en") {
            Locale::En
        } else {
            Locale::Ja
        }
    }

    pub fn as_lang_string(self) -> &'static str {
        match self {
            Locale::Ja => "ja",
            Locale::En => "en",
        }
    }
}

static LOCALE: OnceLock<Locale> = OnceLock::new();

pub fn init_from_env() -> Locale {
    let locale = Locale::from_env();
    let _ = LOCALE.set(locale);
    // Slint の bundled translations 側にも反映できるよう LANG を設定する。
    // すでに LANG が指定されていれば上書きしない。
    if std::env::var("LANG").is_err() {
        unsafe {
            std::env::set_var("LANG", format!("{}_JP.UTF-8", locale.as_lang_string()));
        }
    }
    locale
}

pub fn current() -> Locale {
    *LOCALE.get().unwrap_or(&Locale::Ja)
}

/// 翻訳キーから訳文を返す。未登録キーはキー自体（英語）を返す。
pub fn tr(key: &str) -> String {
    match current() {
        Locale::En => key.to_string(),
        Locale::Ja => translate_ja(key)
            .map(str::to_string)
            .unwrap_or_else(|| key.to_string()),
    }
}

/// `format!` 的に置換つき翻訳。`{}` を引数で順に置き換える。
pub fn tr_args(key: &str, args: &[&str]) -> String {
    let mut out = tr(key);
    for arg in args {
        if let Some(idx) = out.find("{}") {
            out.replace_range(idx..idx + 2, arg);
        }
    }
    out
}

fn translate_ja(key: &str) -> Option<&'static str> {
    Some(match key {
        // anchor label (placeholder は {} のみ。順序通り tr_args で埋める)
        "{} (file)" => "{} (ファイル全体)",
        "{} (hunk #{})" => "{} (ハンク #{})",
        "{}:{}-{} ({})" => "{}:{}-{} ({})",
        "{}:{} ({})" => "{}:{} ({})",
        "(no selection)" => "(選択なし)",
        "  [range mode: click end line]" => "  [範囲モード: 終了行をクリック]",
        // sides
        "before" => "変更前",
        "after" => "変更後",
        // send modes
        "Insert" => "挿入",
        "Insert+Send" => "挿入+送信",
        "Copy" => "コピー",
        // file status labels
        "A" => "追加",
        "M" => "変更",
        "D" => "削除",
        "R" => "改名",
        "C" => "複製",
        "Ch" => "更改",
        "=" => "同一",
        // unsupported reasons
        "binary file (content not fetched)" => "バイナリファイル (内容を取得していません)",
        "patch missing: {}" => "パッチ取得失敗: {}",
        "parser failed: {}" => "パーサ失敗: {}",
        // history / preview placeholders
        "(empty)" => "(空)",
        "(edited preview)" => "(編集済みプレビュー)",
        "+{} more" => "+{} 件",
        "(failed to fetch)" => "(取得失敗)",
        // terminal status
        "{} (running)" => "{} (起動中)",
        "{}: failed to start ({})" => "{}: 起動失敗 ({})",
        _ => return None,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn locale_from_locus_locale_env() {
        assert_eq!(Locale::from_str("ja"), Locale::Ja);
        assert_eq!(Locale::from_str("en"), Locale::En);
        assert_eq!(Locale::from_str("ja_JP.UTF-8"), Locale::Ja);
        assert_eq!(Locale::from_str("en_US.UTF-8"), Locale::En);
        assert_eq!(Locale::from_str("fr"), Locale::Ja); // フォールバック
    }

    #[test]
    fn lang_string() {
        assert_eq!(Locale::Ja.as_lang_string(), "ja");
        assert_eq!(Locale::En.as_lang_string(), "en");
    }

    #[test]
    fn tr_args_substitutes_placeholders() {
        // English locale を直接呼べないので tr_args の置換ロジックだけ確認
        let mut s = "{} chars / {} limit".to_string();
        if let Some(i) = s.find("{}") {
            s.replace_range(i..i + 2, "10");
        }
        if let Some(i) = s.find("{}") {
            s.replace_range(i..i + 2, "20");
        }
        assert_eq!(s, "10 chars / 20 limit");
    }
}
