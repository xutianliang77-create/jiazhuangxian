from __future__ import annotations

import json
import sqlite3
import time
import uuid
from pathlib import Path
from typing import Any

from .schemas import DetectNodulesRequest


MODEL_JOB_SCHEMA = """
CREATE TABLE IF NOT EXISTS model_job (
  id TEXT PRIMARY KEY,
  study_id TEXT,
  image_id TEXT,
  agent_task_id TEXT,
  job_type TEXT NOT NULL,
  status TEXT NOT NULL,
  priority INTEGER NOT NULL DEFAULT 100,
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 1,
  input_json TEXT NOT NULL DEFAULT '{}',
  output_json TEXT,
  error_json TEXT,
  model_name TEXT,
  model_version TEXT,
  weights_hash TEXT,
  artifact_uri TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  started_at INTEGER,
  completed_at INTEGER
);
"""


class ModelJobStore:
    def __init__(self, db_path: Path) -> None:
        self.db_path = db_path
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self._ensure_schema()

    def enqueue_detect_nodules(self, request: DetectNodulesRequest) -> dict[str, Any]:
        now = current_ms()
        job_id = f"mj_{uuid.uuid4().hex}"
        input_json = {
            "study_id": request.study_id,
            "image_id": request.image_id,
            "image_uri": request.image_uri,
            "return_overlay": request.return_overlay,
            "metadata": request.metadata,
            "trace_id": request.trace_id,
        }
        with self._connect() as conn:
            conn.execute(
                """
                INSERT INTO model_job(
                  id, study_id, image_id, agent_task_id, job_type, status,
                  priority, attempts, max_attempts, input_json, output_json, error_json,
                  model_name, model_version, weights_hash, artifact_uri,
                  created_at, updated_at, started_at, completed_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    job_id,
                    request.study_id,
                    request.image_id,
                    request.agent_task_id,
                    "thyroid.detect_nodules",
                    "queued",
                    request.priority,
                    0,
                    request.max_attempts,
                    json.dumps(input_json, ensure_ascii=False),
                    None,
                    None,
                    request.model,
                    request.model_version,
                    request.weights_hash,
                    None,
                    now,
                    now,
                    None,
                    None,
                ),
            )
            conn.commit()
        return self.get_job(job_id)

    def get_job(self, job_id: str) -> dict[str, Any] | None:
        with self._connect() as conn:
            row = conn.execute("SELECT * FROM model_job WHERE id = ?", (job_id,)).fetchone()
        return dict(row) if row else None

    def claim_next_job(self, job_type: str | None = None) -> dict[str, Any] | None:
        now = current_ms()
        filters = ["status = ?", "attempts < max_attempts"]
        params: list[Any] = ["queued"]
        if job_type:
            filters.append("job_type = ?")
            params.append(job_type)

        conn = self._connect()
        try:
            conn.execute("BEGIN IMMEDIATE")
            row = conn.execute(
                f"""
                SELECT id
                FROM model_job
                WHERE {' AND '.join(filters)}
                ORDER BY priority ASC, created_at ASC, id ASC
                LIMIT 1
                """,
                tuple(params),
            ).fetchone()
            if not row:
                conn.commit()
                return None

            cursor = conn.execute(
                """
                UPDATE model_job
                SET status = ?, attempts = attempts + 1, started_at = ?, updated_at = ?, error_json = NULL
                WHERE id = ? AND status = ?
                """,
                ("running", now, now, row["id"], "queued"),
            )
            if cursor.rowcount != 1:
                conn.rollback()
                return None

            claimed = conn.execute("SELECT * FROM model_job WHERE id = ?", (row["id"],)).fetchone()
            conn.commit()
            return dict(claimed) if claimed else None
        except Exception:
            conn.rollback()
            raise
        finally:
            conn.close()

    def complete_job(
        self,
        job_id: str,
        output: dict[str, Any],
        *,
        artifact_uri: str | None = None,
    ) -> dict[str, Any] | None:
        now = current_ms()
        with self._connect() as conn:
            cursor = conn.execute(
                """
                UPDATE model_job
                SET status = ?, output_json = ?, error_json = NULL, artifact_uri = ?,
                    completed_at = ?, updated_at = ?
                WHERE id = ? AND status = ?
                """,
                ("succeeded", json.dumps(output, ensure_ascii=False), artifact_uri, now, now, job_id, "running"),
            )
            conn.commit()
        return self.get_job(job_id) if cursor.rowcount == 1 else None

    def fail_job(self, job_id: str, error: dict[str, Any]) -> dict[str, Any] | None:
        now = current_ms()
        with self._connect() as conn:
            cursor = conn.execute(
                """
                UPDATE model_job
                SET status = ?, error_json = ?, completed_at = ?, updated_at = ?
                WHERE id = ? AND status = ?
                """,
                ("failed", json.dumps(error, ensure_ascii=False), now, now, job_id, "running"),
            )
            conn.commit()
        return self.get_job(job_id) if cursor.rowcount == 1 else None

    def _ensure_schema(self) -> None:
        with self._connect() as conn:
            conn.executescript(MODEL_JOB_SCHEMA)
            conn.execute("CREATE INDEX IF NOT EXISTS idx_model_job_status ON model_job(status, priority, created_at)")
            conn.execute("CREATE INDEX IF NOT EXISTS idx_model_job_study ON model_job(study_id)")
            conn.commit()

    def _connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(str(self.db_path))
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA journal_mode = WAL")
        conn.execute("PRAGMA foreign_keys = ON")
        return conn


def current_ms() -> int:
    return int(time.time() * 1000)


def default_db_path() -> Path:
    return Path("data/artifacts/model-gateway/model-gateway.db")
