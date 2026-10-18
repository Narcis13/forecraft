-- forecraft schema v2: reports, documents, assets.

-- Logos and figures, by id. Bytes live here; nothing is fetched from a URL.
CREATE TABLE assets (
  id           TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  type         TEXT NOT NULL CHECK (type IN ('image/png', 'image/jpeg', 'image/webp', 'image/svg+xml')),
  name         TEXT NOT NULL DEFAULT '',
  size         INTEGER NOT NULL,
  width        INTEGER,
  height       INTEGER,
  sha256       TEXT NOT NULL,
  bytes        BLOB NOT NULL,
  created_at   TEXT NOT NULL
);
CREATE INDEX assets_workspace ON assets (workspace_id, created_at);

-- A report: the working copy of its definition, plus the settings that are not
-- part of the definition (share defaults, a bound form).
CREATE TABLE reports (
  id                TEXT PRIMARY KEY,
  workspace_id      TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  definition        TEXT NOT NULL,
  published_version INTEGER,
  starter           TEXT,
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL
);
CREATE INDEX reports_workspace ON reports (workspace_id, updated_at);

CREATE TABLE report_versions (
  report_id    TEXT NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
  version      INTEGER NOT NULL,
  definition   TEXT NOT NULL,
  published_at TEXT NOT NULL,
  -- Page 1 of this version with its sample data, rendered once (the library shelf).
  thumbnail    BLOB,
  PRIMARY KEY (report_id, version)
);

-- The last number handed out per report and period ('' when the pattern has no year).
CREATE TABLE report_sequences (
  report_id TEXT NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
  period    TEXT NOT NULL,
  last      INTEGER NOT NULL,
  PRIMARY KEY (report_id, period)
);

-- One issue of a report with its data. Drafts have no number; issued and void
-- documents never change except for voiding, the share token and the PDF cache.
CREATE TABLE documents (
  id             TEXT PRIMARY KEY,
  workspace_id   TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  report_id      TEXT NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
  version        INTEGER NOT NULL,
  status         TEXT NOT NULL CHECK (status IN ('draft', 'issued', 'void')),
  number         TEXT,
  title          TEXT NOT NULL DEFAULT '',
  data           TEXT NOT NULL,
  locale         TEXT NOT NULL,
  currency       TEXT,
  submission_id  TEXT,
  share_token    TEXT NOT NULL UNIQUE,
  issued_at      TEXT,
  voided_at      TEXT,
  void_reason    TEXT,
  pdf            BLOB,
  pdf_sha256     TEXT,
  pages          INTEGER,
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL,
  UNIQUE (report_id, number)
);
CREATE INDEX documents_workspace ON documents (workspace_id, created_at);
CREATE INDEX documents_report ON documents (report_id, created_at);
CREATE INDEX documents_submission ON documents (submission_id);

-- Forms meet documents: the confirmation report a form issues, and whether the
-- thank-you state links to it.
ALTER TABLE forms ADD COLUMN confirmation_report_id TEXT REFERENCES reports(id) ON DELETE SET NULL;
ALTER TABLE forms ADD COLUMN issue_on_submit INTEGER NOT NULL DEFAULT 0;
ALTER TABLE forms ADD COLUMN thank_you_link INTEGER NOT NULL DEFAULT 0;
