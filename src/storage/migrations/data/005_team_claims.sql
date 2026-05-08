-- Agent Team claimed-file gate.
--
-- Claims are persisted separately from the TeamRun JSON snapshot so future
-- write-worker execution can check conflicts without replaying every run blob.

CREATE TABLE IF NOT EXISTS team_claims (
  claim_id    TEXT    PRIMARY KEY,
  run_id      TEXT    NOT NULL,
  task_id     TEXT    NOT NULL,
  path        TEXT    NOT NULL,
  mode        TEXT    NOT NULL,
  status      TEXT    NOT NULL,
  reason      TEXT,
  created_at  INTEGER NOT NULL,
  released_at INTEGER,
  FOREIGN KEY (run_id) REFERENCES team_runs(run_id)
);

CREATE INDEX IF NOT EXISTS idx_team_claims_run    ON team_claims(run_id, task_id);
CREATE INDEX IF NOT EXISTS idx_team_claims_path   ON team_claims(path, status);
CREATE INDEX IF NOT EXISTS idx_team_claims_status ON team_claims(status, created_at);
