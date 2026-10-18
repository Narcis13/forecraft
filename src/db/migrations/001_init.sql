-- forecraft schema v1. Timestamps are ISO-8601 UTC text; booleans are 0/1.

CREATE TABLE meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE users (
  id            TEXT PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name          TEXT NOT NULL DEFAULT '',
  password_hash TEXT NOT NULL,
  created_at    TEXT NOT NULL
);

CREATE TABLE workspaces (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE members (
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role         TEXT NOT NULL CHECK (role IN ('owner', 'member')),
  created_at   TEXT NOT NULL,
  PRIMARY KEY (workspace_id, user_id)
);

CREATE TABLE invites (
  id           TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  email        TEXT NOT NULL COLLATE NOCASE,
  token_hash   TEXT NOT NULL UNIQUE,
  created_by   TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at   TEXT NOT NULL,
  accepted_at  TEXT
);

CREATE TABLE sessions (
  token_hash   TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  created_at   TEXT NOT NULL,
  expires_at   TEXT NOT NULL
);

CREATE TABLE api_keys (
  id           TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  prefix       TEXT NOT NULL,
  key_hash     TEXT NOT NULL UNIQUE,
  created_at   TEXT NOT NULL,
  last_used_at TEXT,
  revoked_at   TEXT
);

CREATE TABLE forms (
  id                TEXT PRIMARY KEY,
  workspace_id      TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  slug              TEXT NOT NULL UNIQUE,
  definition        TEXT NOT NULL,
  status            TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
  submission_limit  INTEGER,
  published_version INTEGER,
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL
);
CREATE INDEX forms_workspace ON forms (workspace_id, updated_at);

CREATE TABLE form_versions (
  form_id      TEXT NOT NULL REFERENCES forms(id) ON DELETE CASCADE,
  version      INTEGER NOT NULL,
  definition   TEXT NOT NULL,
  published_at TEXT NOT NULL,
  PRIMARY KEY (form_id, version)
);

CREATE TABLE submissions (
  id         TEXT PRIMARY KEY,
  form_id    TEXT NOT NULL REFERENCES forms(id) ON DELETE CASCADE,
  version    INTEGER NOT NULL,
  data       TEXT NOT NULL,
  created_at TEXT NOT NULL,
  ip_hash    TEXT NOT NULL
);
CREATE INDEX submissions_form ON submissions (form_id, created_at);
CREATE INDEX submissions_form_version ON submissions (form_id, version);
CREATE INDEX submissions_ip ON submissions (ip_hash, created_at);
