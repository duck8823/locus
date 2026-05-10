//! tracing-subscriber の初期化。

/// `LOCUS_LOG` 環境変数 (`error` / `warn` / `info` / `debug` / `trace`)
/// を tracing-subscriber の EnvFilter に流し込む。未設定時は `warn`。
pub(crate) fn init_logging() {
    use tracing_subscriber::EnvFilter;
    let filter = EnvFilter::try_from_env("LOCUS_LOG").unwrap_or_else(|_| EnvFilter::new("warn"));
    let _ = tracing_subscriber::fmt()
        .with_env_filter(filter)
        .with_writer(std::io::stderr)
        .try_init();
}
