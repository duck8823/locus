//! locus composition root.
//!
//! UI / PTY / ドメイン型はそれぞれ子モジュールに切り出してあり、main はそれを
//! 配線するだけに徹する。v0.1 では Terminal ペインのみ起動するが、以降の
//! Issue で diff viewer と PR サイドバーが追加される予定。

use slint::ComponentHandle;

slint::include_modules!();

mod github;
mod review;
mod terminal;
mod ui_state;

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let cmd_name = std::env::args().nth(1).unwrap_or_else(|| "claude".to_string());

    let ui = AppWindow::new()?;
    let _pane = terminal::launch(&ui, &cmd_name)?;
    ui.run()?;
    Ok(())
}
