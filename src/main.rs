//! locus composition root.
//!
//! 起動モードは argv で切り替える:
//!
//! - `cargo run` / `cargo run -- <command>` — Terminal ペインモード
//!   AI agent CLI（既定は `claude`）を PTY で同居させる。
//! - `cargo run -- github <owner>/<repo>#<pr_number>` — Diff viewer モード
//!   GitHub PR の unified diff を表示する。
//!
//! 複雑な argv handling は v0.1 では入れず、2 モードを最小の分岐で切り替える。

use slint::ComponentHandle;

slint::include_modules!();

mod github;
mod review;
mod terminal;
mod ui_state;

use github::pull_request::{build_client, fetch_pr_snapshot, parse_pr_spec};
use ui_state::diff_view::build_diff_file_views;

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let args: Vec<String> = std::env::args().skip(1).collect();

    match args.as_slice() {
        [mode, spec] if mode == "github" => run_diff_viewer(spec),
        [command] => run_terminal(command),
        [] => run_terminal("claude"),
        _ => {
            eprintln!("Usage:");
            eprintln!("  locus                          # terminal pane (claude)");
            eprintln!("  locus <command>                # terminal pane (custom cmd)");
            eprintln!("  locus github <owner>/<repo>#<pr_number>");
            std::process::exit(2);
        }
    }
}

fn run_terminal(command: &str) -> Result<(), Box<dyn std::error::Error>> {
    let ui = AppWindow::new()?;
    let _pane = terminal::launch(&ui, command)?;
    ui.run()?;
    Ok(())
}

fn run_diff_viewer(spec: &str) -> Result<(), Box<dyn std::error::Error>> {
    let (owner, repo, pr_number) = parse_pr_spec(spec)
        .ok_or_else(|| format!("invalid PR spec: {spec} (expected owner/repo#N)"))?;

    let runtime = tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .build()?;

    let snapshot = runtime.block_on(async move {
        let client = build_client()?;
        fetch_pr_snapshot(&client, &owner, &repo, pr_number).await
    })?;

    let ui = DiffViewerWindow::new()?;
    ui.set_pr_title(slint::SharedString::from(snapshot.title.as_str()));
    ui.set_head_sha(slint::SharedString::from(short_sha(&snapshot.head_sha)));
    ui.set_base_sha(slint::SharedString::from(short_sha(&snapshot.base_sha)));

    let file_views = build_diff_file_views(&snapshot.files);
    let model = std::rc::Rc::new(slint::VecModel::from(file_views));
    ui.set_files(slint::ModelRc::from(model));
    ui.set_selected_file_index(0);

    ui.run()?;
    Ok(())
}

fn short_sha(sha: &str) -> String {
    sha.chars().take(7).collect()
}

#[cfg(test)]
mod tests {
    use super::short_sha;

    #[test]
    fn short_sha_truncates_to_seven_chars() {
        assert_eq!(short_sha("abcdef1234567890"), "abcdef1");
    }

    #[test]
    fn short_sha_of_short_input_is_itself() {
        assert_eq!(short_sha("abc"), "abc");
    }
}
