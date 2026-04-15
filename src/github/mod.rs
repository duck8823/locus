#![allow(dead_code)]

//! GitHub 連携境界。
//!
//! - [`pull_request`] — octocrab ラッパ。PR スナップショット取得を担う。

pub mod issue_context;
pub mod pull_request;
