-- Agent Team run snapshots.
--
-- Keep the first persistent Team implementation intentionally compact:
-- one row per TeamRun with the full bounded snapshot as JSON. This is enough
-- for Web replay/status and avoids prematurely normalizing Blackboard/Mailbox
-- before write-worker semantics settle.

CREATE TABLE IF NOT EXISTS team_runs (
  run_id      TEXT    PRIMARY KEY,
  session_id  TEXT,
  user_goal   TEXT    NOT NULL,
  status      TEXT    NOT NULL,
  summary     TEXT    NOT NULL DEFAULT '',
  run_json    TEXT    NOT NULL,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_team_runs_session ON team_runs(session_id, updated_at);
CREATE INDEX IF NOT EXISTS idx_team_runs_status  ON team_runs(status, updated_at);
