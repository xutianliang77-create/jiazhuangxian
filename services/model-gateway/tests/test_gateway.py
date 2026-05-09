from __future__ import annotations

import json
import os
import sqlite3
import sys
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
from pathlib import Path
from unittest.mock import patch


SERVICE_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SERVICE_ROOT))

from app.detectors import build_detector_request, select_detector_adapter  # noqa: E402
from app.config_check import build_config_report  # noqa: E402
from app.schemas import DetectNodulesRequest  # noqa: E402
from app.server import create_server  # noqa: E402
from app.store import ModelJobStore  # noqa: E402
from app.worker import run_once  # noqa: E402


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
                self.assertIn("/model/v1/config/check", payload["result"]["routes"])
            finally:
                server.shutdown()
                server.server_close()
                thread.join(timeout=5)

    def test_config_check_endpoint_reports_runtime_and_detectors(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            db_path = Path(tmp) / "model.db"
            server = create_server(port=0, db_path=db_path)
            thread = threading.Thread(target=server.serve_forever, daemon=True)
            thread.start()
            try:
                host, port = server.server_address
                payload = get_json(f"http://{host}:{port}/model/v1/config/check")
                self.assertEqual(payload["status"], "ok")
                result = payload["result"]
                self.assertEqual(result["service"], "model-gateway")
                self.assertEqual(result["storage"]["data_db"], str(db_path))
                self.assertIn("python", result["runtime"])
                self.assertIn("gpu", result["runtime"])
                self.assertEqual(
                    [detector["model_family"] for detector in result["detectors"]],
                    ["yolov11", "rt-detr", "rf-detr"],
                )
            finally:
                server.shutdown()
                server.server_close()
                thread.join(timeout=5)

    def test_config_report_validates_weight_environment_paths(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            weights = Path(tmp) / "yolov11.pt"
            weights.write_bytes(b"weights")
            report = build_config_report(env={"JZX_YOLOV11_WEIGHTS": str(weights)})

        yolo = next(item for item in report["detectors"] if item["model_family"] == "yolov11")
        self.assertTrue(yolo["weights"]["configured"])
        self.assertTrue(yolo["weights"]["exists"])
        self.assertTrue(yolo["weights"]["is_file"])
        self.assertTrue(yolo["weights"]["readable"])
        self.assertEqual(yolo["weights"]["size_bytes"], 7)

        rtdetr = next(item for item in report["detectors"] if item["model_family"] == "rt-detr")
        self.assertIn("weights_env_missing", [issue["code"] for issue in rtdetr["issues"]])

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

    def test_store_claims_and_completes_next_job(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            store = ModelJobStore(Path(tmp) / "model.db")
            queued = store.enqueue_detect_nodules(
                DetectNodulesRequest(
                    study_id="S1",
                    image_id="IMG1",
                    image_uri="artifact://model-ready/S1/IMG1.png",
                    priority=5,
                )
            )

            claimed = store.claim_next_job()
            self.assertIsNotNone(claimed)
            assert claimed is not None
            self.assertEqual(claimed["id"], queued["id"])
            self.assertEqual(claimed["status"], "running")
            self.assertEqual(claimed["attempts"], 1)
            self.assertIsNotNone(claimed["started_at"])
            self.assertIsNone(store.claim_next_job())

            completed = store.complete_job(claimed["id"], {"nodules": []}, artifact_uri="artifact://model-output/S1.json")
            self.assertIsNotNone(completed)
            assert completed is not None
            self.assertEqual(completed["status"], "succeeded")
            self.assertEqual(json.loads(completed["output_json"]), {"nodules": []})
            self.assertEqual(completed["artifact_uri"], "artifact://model-output/S1.json")

    def test_worker_marks_unconfigured_detector_job_failed(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            store = ModelJobStore(Path(tmp) / "model.db")
            queued = store.enqueue_detect_nodules(
                DetectNodulesRequest(
                    study_id="S1",
                    image_id="IMG1",
                    image_uri="artifact://model-ready/S1/IMG1.png",
                )
            )

            result = run_once(store, worker_id="worker-test")
            self.assertEqual(result["status"], "failed")
            self.assertTrue(result["claimed"])
            self.assertEqual(result["job_id"], queued["id"])
            self.assertEqual(result["error"]["code"], "detector_not_configured")

            failed = store.get_job(queued["id"])
            self.assertIsNotNone(failed)
            assert failed is not None
            self.assertEqual(failed["status"], "failed")
            self.assertEqual(failed["attempts"], 1)
            self.assertIsNotNone(failed["completed_at"])
            error = json.loads(failed["error_json"])
            self.assertEqual(error["detail"]["worker_id"], "worker-test")
            self.assertEqual(error["detail"]["adapter"], "yolov11-ultralytics")
            self.assertEqual(error["detail"]["model_family"], "yolov11")
            self.assertEqual(error["detail"]["required_env"], ["JZX_YOLOV11_WEIGHTS"])

            idle = run_once(store, worker_id="worker-test")
            self.assertEqual(idle["status"], "idle")
            self.assertFalse(idle["claimed"])

    def test_worker_writes_standard_detector_artifact_on_success(self) -> None:
        from PIL import Image

        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "artifacts"
            source_path = root / "model-ready" / "S1" / "IMG1.png"
            source_path.parent.mkdir(parents=True)
            Image.new("RGB", (96, 72), (20, 20, 20)).save(source_path)
            store = ModelJobStore(Path(tmp) / "model.db")
            queued = store.enqueue_detect_nodules(
                DetectNodulesRequest(
                    study_id="S1",
                    image_id="IMG1",
                    image_uri="artifact://model-ready/S1/IMG1.png",
                )
            )
            detector_output = {
                "nodules": [
                    {
                        "nodule_index": 1,
                        "bbox": [10, 20, 30, 40],
                        "confidence": 0.91,
                        "class_id": 0,
                        "source": "ai",
                        "model_name": "yolov11-thyroid-detector",
                        "model_version": "test",
                    }
                ],
                "model": {
                    "adapter": "yolov11-ultralytics",
                    "family": "yolov11",
                    "name": "yolov11-thyroid-detector",
                    "version": "test",
                    "weights_hash": "sha256:test",
                },
                "warnings": [],
            }

            with patch.dict(os.environ, {"JZX_ARTIFACT_ROOT": str(root)}, clear=False):
                with patch("app.worker.run_detector_job", return_value=detector_output):
                    result = run_once(store, worker_id="worker-test")

            self.assertEqual(result["status"], "succeeded")
            artifact_uri = result["artifact_uri"]
            self.assertTrue(artifact_uri.startswith("artifact://model-output/thyroid-detect-nodules/S1/IMG1/"))
            artifact_path = root / artifact_uri.removeprefix("artifact://")
            self.assertTrue(artifact_path.is_file())

            artifact = json.loads(artifact_path.read_text(encoding="utf-8"))
            self.assertEqual(artifact["schema_version"], "thyroid.detector.output.v1")
            self.assertEqual(artifact["artifact_kind"], "thyroid_nodule_detection")
            self.assertEqual(artifact["model_job_id"], queued["id"])
            self.assertEqual(artifact["source_image_uri"], "artifact://model-ready/S1/IMG1.png")
            self.assertEqual(artifact["coordinate_system"]["type"], "pixel_xyxy")
            self.assertEqual(artifact["detections"][0]["bbox"], [10.0, 20.0, 30.0, 40.0])
            self.assertEqual(artifact["detectors"]["consensus"]["status"], "single_model_only")
            self.assertEqual(artifact["artifacts"]["detections_json"], artifact_uri)
            overlay_uri = artifact["artifacts"]["overlay_image"]
            self.assertTrue(overlay_uri.startswith("artifact://model-output/thyroid-detect-nodules/S1/IMG1/"))
            overlay_path = root / overlay_uri.removeprefix("artifact://")
            self.assertTrue(overlay_path.is_file())

            completed = store.get_job(queued["id"])
            self.assertIsNotNone(completed)
            assert completed is not None
            self.assertEqual(completed["status"], "succeeded")
            self.assertEqual(completed["artifact_uri"], artifact_uri)
            stored_output = json.loads(completed["output_json"])
            self.assertEqual(stored_output["artifacts"]["detections_json"], artifact_uri)
            self.assertEqual(stored_output["artifacts"]["overlay_image"], overlay_uri)

    def test_detector_adapter_selection_supports_yolo_and_transformer_detectors(self) -> None:
        yolo = select_detector_adapter({"model_name": "yolov11-thyroid-detector"}, env={})
        self.assertEqual(yolo.adapter_name, "yolov11-ultralytics")
        self.assertEqual(yolo.model_family, "yolov11")

        rtdetr = select_detector_adapter({"model_name": "rt-detr-thyroid-detector"}, env={})
        self.assertEqual(rtdetr.adapter_name, "rtdetr-ultralytics")
        self.assertEqual(rtdetr.model_family, "rt-detr")

        rfdetr = select_detector_adapter({"model_name": "rf-detr-thyroid-detector"}, env={})
        self.assertEqual(rfdetr.adapter_name, "rf-detr")
        self.assertEqual(rfdetr.model_family, "rf-detr")

    def test_detector_request_is_built_from_model_job_input_json(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            store = ModelJobStore(Path(tmp) / "model.db")
            queued = store.enqueue_detect_nodules(
                DetectNodulesRequest(
                    study_id="S1",
                    image_id="IMG1",
                    image_uri="artifact://model-ready/S1/IMG1.png",
                    return_overlay=False,
                    metadata={"frame": 1},
                    trace_id="TRACE1",
                )
            )

            request = build_detector_request(queued)
            self.assertEqual(request.study_id, "S1")
            self.assertEqual(request.image_id, "IMG1")
            self.assertEqual(request.image_uri, "artifact://model-ready/S1/IMG1.png")
            self.assertFalse(request.return_overlay)
            self.assertEqual(request.metadata, {"frame": 1})
            self.assertEqual(request.trace_id, "TRACE1")


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
