from __future__ import annotations

import json
import sqlite3
import sys
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
from pathlib import Path


SERVICE_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SERVICE_ROOT))

from app.server import create_server  # noqa: E402
from app.store import ModelJobStore  # noqa: E402


class ModelGatewayTest(unittest.TestCase):
    def test_health_endpoint_starts(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            server = create_server(port=0, db_path=Path(tmp) / "model.db")
            thread = threading.Thread(target=server.serve_forever, daemon=True)
            thread.start()
            try:
                host, port = server.server_address
                payload = get_json(f"http://{host}:{port}/health")
                self.assertEqual(payload["status"], "ok")
                self.assertEqual(payload["result"]["service"], "model-gateway")
                self.assertIn("/model/v1/infer/thyroid/detect-nodules", payload["result"]["routes"])
            finally:
                server.shutdown()
                server.server_close()
                thread.join(timeout=5)

    def test_detect_nodules_enqueues_model_job(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            db_path = Path(tmp) / "model.db"
            server = create_server(port=0, db_path=db_path)
            thread = threading.Thread(target=server.serve_forever, daemon=True)
            thread.start()
            try:
                host, port = server.server_address
                payload = post_json(
                    f"http://{host}:{port}/model/v1/infer/thyroid/detect-nodules",
                    {
                        "study_id": "S1",
                        "image_id": "IMG1",
                        "image_uri": "artifact://model-ready/S1/IMG1.png",
                        "model": "yolov11-thyroid-detector",
                        "model_version": "validation-placeholder",
                        "trace_id": "T1",
                    },
                )
                self.assertEqual(payload["status"], "ok")
                self.assertEqual(payload["trace_id"], "T1")
                self.assertEqual(payload["result"]["status"], "queued")
                job_id = payload["result"]["job_id"]

                job_payload = get_json(f"http://{host}:{port}/model/v1/jobs/{job_id}")
                self.assertEqual(job_payload["result"]["job"]["id"], job_id)
                self.assertEqual(job_payload["result"]["job"]["input"]["image_uri"], "artifact://model-ready/S1/IMG1.png")

                with sqlite3.connect(db_path) as conn:
                    row = conn.execute("SELECT id, job_type, status, model_name FROM model_job").fetchone()
                self.assertEqual(row, (job_id, "thyroid.detect_nodules", "queued", "yolov11-thyroid-detector"))
            finally:
                server.shutdown()
                server.server_close()
                thread.join(timeout=5)

    def test_store_can_reopen_existing_queue(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            db_path = Path(tmp) / "model.db"
            first = ModelJobStore(db_path)
            second = ModelJobStore(db_path)
            self.assertTrue(first.db_path.exists())
            self.assertTrue(second.db_path.exists())


def get_json(url: str) -> dict[str, object]:
    with urllib.request.urlopen(url, timeout=5) as response:
        return json.loads(response.read().decode("utf-8"))


def post_json(url: str, payload: dict[str, object]) -> dict[str, object]:
    data = json.dumps(payload).encode("utf-8")
    request = urllib.request.Request(url, data=data, headers={"content-type": "application/json"}, method="POST")
    try:
        with urllib.request.urlopen(request, timeout=5) as response:
            return json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        return json.loads(exc.read().decode("utf-8"))


if __name__ == "__main__":
    unittest.main()
