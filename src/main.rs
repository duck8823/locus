//! locus composition root.
//!
//! 起動モードは argv で切り替える:
//!
//! - `cargo run` / `cargo run -- <command>` — Terminal ペインモード
//! - `cargo run -- github <owner>/<repo>#<pr_number>` — Diff viewer モード

slint::include_modules!();

mod app;
mod config;
mod github;
mod i18n;
mod review;
mod semantic;
mod session;
mod terminal;
mod ui_state;

fn main() -> Result<(), Box<dyn std::error::Error>> {
    // tracing-subscriber を最初に初期化する。LOCUS_LOG=debug 等で詳細
    // レベルを上げられる。設定なしでは warn 以上のみ stderr に出る。
    app::logging::init_logging();
    // i18n を初期化する。LANG が未設定なら locus 既定の ja に揃える。
    let _ = i18n::init_from_env();

    let args: Vec<String> = std::env::args().skip(1).collect();

    match args.as_slice() {
        [mode, spec] if mode == "github" => app::diff_viewer::run_diff_viewer(spec),
        [command] => app::terminal_mode::run_terminal(command),
        [] => {
            // terminal-only モードでも LOCUS_AGENT_CMD を尊重する。diff viewer
            // 側と挙動を揃えることで README に書ける起動形を一貫させる。
            let cmd = std::env::var("LOCUS_AGENT_CMD").unwrap_or_else(|_| "claude".to_string());
            app::terminal_mode::run_terminal(&cmd)
        }
        _ => {
            eprintln!("Usage:");
            eprintln!(
                "  locus                          # terminal pane (LOCUS_AGENT_CMD or claude)"
            );
            eprintln!(
                "  locus <command>                # terminal pane (custom cmd, overrides env)"
            );
            eprintln!("  locus github <owner>/<repo>#<pr_number>");
            std::process::exit(2);
        }
    }
}
