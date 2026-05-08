from __future__ import annotations

import argparse
import json
import os
import time
from pathlib import Path
from typing import Any

from .store import ModelJobStore, default_db_path


def run_once(store: ModelJobStore, *, worker_id: str = "model-worker") -> dict[str, Any]:
    job = store.claim_next_job()
    if not job:
        return {"status": "idle", "claimed": False, "worker_id": worker_id}

    error = build_failure(job, worker_id)
    failed = store.fail_job(str(job["id"]), error)
    return {
        "status": "failed" if failed else "error",
        "claimed": True,
        "worker_id": worker_id,
        "job_id": job["id"],
        "job_type": job["job_type"],
        "error": error,
    }


def build_failure(job: dict[str, Any], worker_id: str) -> dict[str, Any]:
    if job["job_type"] == "thyroid.detect_nodules":
        return {
            "code": "detector_not_configured",
            "message": "thyroid nodule detector is not configured in the validation worker",
            "detail": {
                "worker_id": worker_id,
                "model_name": job["model_name"],
                "model_version": job["model_version"],
                "expected_worker": "YOLOv11 or RT-DETR detector adapter",
            },
        }
    return {
        "code": "unsupported_job_type",
        "message": "model worker does not support this job type",
        "detail": {
            "worker_id": worker_id,
            "job_type": job["job_type"],
        },
    }


def run_loop(store: ModelJobStore, *, worker_id: str, interval_ms: int) -> None:
    while True:
        result = run_once(store, worker_id=worker_id)
        print(json.dumps(result, ensure_ascii=False), flush=True)
        if not result["claimed"]:
            time.sleep(interval_ms / 1000)


def main() -> None:
    parser = argparse.ArgumentParser(description="Consume model_job records for the validation model gateway.")
    parser.add_argument("--once", action="store_true", help="process at most one queued job and exit")
    parser.add_argument("--db", default=os.environ.get("JZX_DATA_DB"), help="SQLite database path")
    parser.add_argument("--worker-id", default=os.environ.get("JZX_MODEL_WORKER_ID", "model-worker"))
    parser.add_argument(
        "--interval-ms",
        type=int,
        default=int(os.environ.get("JZX_MODEL_WORKER_INTERVAL_MS", "1000")),
        help="idle polling interval for loop mode",
    )
    args = parser.parse_args()

    store = ModelJobStore(Path(args.db) if args.db else default_db_path())
    if args.once:
        print(json.dumps(run_once(store, worker_id=args.worker_id), ensure_ascii=False))
        return

    run_loop(store, worker_id=args.worker_id, interval_ms=args.interval_ms)


if __name__ == "__main__":
    main()
