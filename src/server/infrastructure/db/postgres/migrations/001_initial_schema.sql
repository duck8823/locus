-- 001_initial_schema.sql
-- Initial PostgreSQL schema for Locus production infrastructure.
-- Covers: review_sessions, connection_states, connection_state_transitions,
--         connection_tokens, oauth_states, analysis_jobs.

CREATE TABLE IF NOT EXISTS schema_migrations (
  version INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Review Sessions
CREATE TABLE IF NOT EXISTS review_sessions (
  review_id TEXT PRIMARY KEY,
  data JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Connection States
CREATE TABLE IF NOT EXISTS connection_states (
  reviewer_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  status TEXT NOT NULL,
  status_updated_at TEXT,
  connected_account_label TEXT,
  PRIMARY KEY (reviewer_id, provider)
);

-- Connection State Transitions
CREATE TABLE IF NOT EXISTS connection_state_transitions (
  transition_id TEXT PRIMARY KEY,
  reviewer_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  previous_status TEXT NOT NULL,
  next_status TEXT NOT NULL,
  changed_at TEXT NOT NULL,
  reason TEXT NOT NULL DEFAULT 'manual',
  actor_type TEXT NOT NULL DEFAULT 'reviewer',
  actor_id TEXT,
  connected_account_label TEXT
);

CREATE INDEX IF NOT EXISTS idx_cst_reviewer_changed
  ON connection_state_transitions (reviewer_id, changed_at DESC, transition_id DESC);

CREATE INDEX IF NOT EXISTS idx_cst_reviewer_provider_changed
  ON connection_state_transitions (reviewer_id, provider, changed_at DESC, transition_id DESC);

CREATE INDEX IF NOT EXISTS idx_cst_reviewer_reason_changed
  ON connection_state_transitions (reviewer_id, reason, changed_at DESC, transition_id DESC);

-- Connection Tokens (encrypted at application level)
CREATE TABLE IF NOT EXISTS connection_tokens (
  reviewer_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  access_token TEXT NOT NULL,
  token_type TEXT,
  scope TEXT,
  refresh_token TEXT,
  expires_at TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (reviewer_id, provider)
);

-- OAuth Pending States
CREATE TABLE IF NOT EXISTS oauth_pending_states (
  state TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  reviewer_id TEXT NOT NULL,
  redirect_path TEXT NOT NULL,
  code_verifier TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_oauth_pending_states_expires
  ON oauth_pending_states (expires_at);

-- Analysis Jobs
CREATE TABLE IF NOT EXISTS analysis_jobs (
  job_id TEXT PRIMARY KEY,
  review_id TEXT NOT NULL,
  requested_at TEXT NOT NULL,
  reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued',
  queued_at TEXT NOT NULL,
  started_at TEXT,
  completed_at TEXT,
  duration_ms INTEGER,
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT
);

CREATE INDEX IF NOT EXISTS idx_analysis_jobs_review_id
  ON analysis_jobs (review_id);

CREATE INDEX IF NOT EXISTS idx_analysis_jobs_status
  ON analysis_jobs (status);

CREATE INDEX IF NOT EXISTS idx_analysis_jobs_review_status
  ON analysis_jobs (review_id, status);
