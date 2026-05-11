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

from app.detectors import build_detector_request, rgb_compatible_image_path, run_detector_job, select_detector_adapter  # noqa: E402
from app.config_check import build_config_report, parse_nvidia_smi_cuda_version  # noqa: E402
from app.schemas import DetectNodulesRequest, MeasureNoduleRequest, MeasureVideoNoduleRequest, SegmentNoduleRequest, SegmentVideoNoduleRequest  # noqa: E402
from app.server import create_server  # noqa: E402
from app.segmentation import run_segment_job, run_segment_video_job, torch_device  # noqa: E402
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
                self.assertIn("/model/v1/infer/thyroid/segment-nodule", payload["result"]["routes"])
                self.assertIn("/model/v1/infer/thyroid/measure-nodule", payload["result"]["routes"])
                self.assertIn("/model/v1/infer/thyroid/segment-video-nodule", payload["result"]["routes"])
                self.assertIn("/model/v1/infer/thyroid/measure-video-nodule", payload["result"]["routes"])
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
                self.assertEqual(result["pipeline"]["policy_version"], "thyroid-gpu-pipeline-v1")
                self.assertEqual(result["pipeline"]["static_image_chain"]["detector"]["primary"], "rf-detr")
                self.assertEqual(result["pipeline"]["static_image_chain"]["detector"]["comparator"], "yolov11")
                self.assertEqual(result["pipeline"]["static_image_chain"]["segmenter"]["primary"], "nnunet-tight-roi")
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

    def test_config_report_includes_nvidia_smi_and_torch_cuda_fields(self) -> None:
        report = build_config_report(env={})

        gpu = report["runtime"]["gpu"]
        self.assertIn("nvidia_smi", gpu)
        self.assertIn("torch_cuda_version", gpu)
        self.assertIn("devices", gpu)
        self.assertEqual(report["runtime"]["inference_device"]["effective"], "auto")
        self.assertEqual([segmenter["model_family"] for segmenter in report["segmenters"]], ["medsam", "sam2-static", "unet", "nnunet-tight-roi"])
        self.assertEqual(report["video_segmenters"][0]["model_family"], "sam2-video")

    def test_config_report_includes_explicit_inference_device(self) -> None:
        report = build_config_report(env={"JZX_MODEL_DEVICE": "0"})

        self.assertEqual(
            report["runtime"]["inference_device"],
            {"env": "JZX_MODEL_DEVICE", "configured": True, "value": "0", "effective": "0"},
        )

    def test_parse_nvidia_smi_cuda_version(self) -> None:
        self.assertEqual(
            parse_nvidia_smi_cuda_version("| NVIDIA-SMI 580.00    Driver Version: 580.00    CUDA Version: 12.8 |"),
            "12.8",
        )
        self.assertIsNone(parse_nvidia_smi_cuda_version("nvidia-smi output without cuda marker"))

    def test_static_segmenters_normalize_numeric_cuda_device(self) -> None:
        self.assertEqual(torch_device({"JZX_MODEL_DEVICE": "0"}), "cuda:0")
        self.assertEqual(torch_device({"JZX_MODEL_DEVICE": "cuda:1"}), "cuda:1")

    def test_rfdetr_rgb_compatible_image_path_converts_grayscale(self) -> None:
        from PIL import Image

        with tempfile.TemporaryDirectory() as tmp:
            image_path = Path(tmp) / "gray.png"
            Image.new("L", (8, 6), 128).save(image_path)

            converted_path, cleanup_path = rgb_compatible_image_path(image_path)

            self.assertIsNotNone(cleanup_path)
            with Image.open(converted_path) as image:
                self.assertEqual(image.mode, "RGB")
                self.assertEqual(image.size, (8, 6))
            if cleanup_path is not None:
                cleanup_path.unlink(missing_ok=True)

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

    def test_segment_and_measure_routes_enqueue_model_jobs(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            db_path = Path(tmp) / "model.db"
            server = create_server(port=0, db_path=db_path)
            thread = threading.Thread(target=server.serve_forever, daemon=True)
            thread.start()
            try:
                host, port = server.server_address
                segment_payload = post_json(
                    f"http://{host}:{port}/model/v1/infer/thyroid/segment-nodule",
                    {
                        "study_id": "S1",
                        "image_id": "IMG1",
                        "image_uri": "artifact://model-ready/S1/IMG1.png",
                        "nodule_id": "N1",
                        "bbox": [10, 20, 30, 40],
                    },
                )
                measure_payload = post_json(
                    f"http://{host}:{port}/model/v1/infer/thyroid/measure-nodule",
                    {
                        "study_id": "S1",
                        "image_id": "IMG1",
                        "nodule_id": "N1",
                        "mask_uri": "artifact://model-output/S1/N1-mask.png",
                        "pixel_spacing": {"row_mm": 0.08, "column_mm": 0.08},
                    },
                )

                self.assertEqual(segment_payload["status"], "ok")
                self.assertEqual(segment_payload["result"]["job_type"], "thyroid.segment_nodule")
                self.assertEqual(measure_payload["status"], "ok")
                self.assertEqual(measure_payload["result"]["job_type"], "thyroid.measure_nodule")
                with sqlite3.connect(db_path) as conn:
                    rows = conn.execute("SELECT job_type, model_name FROM model_job ORDER BY created_at").fetchall()
                self.assertEqual(
                    rows,
                    [
                        ("thyroid.segment_nodule", "nnunet-tight-roi-segmenter"),
                        ("thyroid.measure_nodule", "mask-measurement-worker"),
                    ],
                )
            finally:
                server.shutdown()
                server.server_close()
                thread.join(timeout=5)

    def test_video_segment_and_measure_routes_enqueue_model_jobs(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            db_path = Path(tmp) / "model.db"
            server = create_server(port=0, db_path=db_path)
            thread = threading.Thread(target=server.serve_forever, daemon=True)
            thread.start()
            try:
                host, port = server.server_address
                segment_payload = post_json(
                    f"http://{host}:{port}/model/v1/infer/thyroid/segment-video-nodule",
                    {
                        "study_id": "S1",
                        "video_id": "VID1",
                        "video_uri": "artifact://medical-videos/S1/VID1.mp4",
                        "targets": [
                            {
                                "nodule_id": "N1",
                                "track_id": "T1",
                                "prompt_frame_index": 42,
                                "bbox": [10, 20, 30, 40],
                            }
                        ],
                    },
                )
                measure_payload = post_json(
                    f"http://{host}:{port}/model/v1/infer/thyroid/measure-video-nodule",
                    {
                        "study_id": "S1",
                        "video_id": "VID1",
                        "segmentation_uri": "artifact://model-output/S1/VID1/video_segmentation.json",
                        "pixel_spacing": {"row_mm": 0.08, "column_mm": 0.08},
                    },
                )

                self.assertEqual(segment_payload["status"], "ok")
                self.assertEqual(segment_payload["result"]["job_type"], "thyroid.segment_video_nodule")
                self.assertEqual(measure_payload["status"], "ok")
                self.assertEqual(measure_payload["result"]["job_type"], "thyroid.measure_video_nodule")
                with sqlite3.connect(db_path) as conn:
                    rows = conn.execute("SELECT image_id, job_type, model_name FROM model_job ORDER BY created_at").fetchall()
                self.assertEqual(
                    rows,
                    [
                        ("VID1", "thyroid.segment_video_nodule", "video-bbox-fallback-segmenter"),
                        ("VID1", "thyroid.measure_video_nodule", "video-mask-measurement-worker"),
                    ],
                )
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
            self.assertEqual(error["detail"]["adapter"], "rf-detr")
            self.assertEqual(error["detail"]["model_family"], "rf-detr")
            self.assertEqual(error["detail"]["required_env"], ["JZX_RFDETR_WEIGHTS"])

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

    def test_worker_writes_segmentation_and_measurement_artifacts(self) -> None:
        from PIL import Image

        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "artifacts"
            source_path = root / "model-ready" / "S1" / "IMG1.png"
            source_path.parent.mkdir(parents=True)
            Image.new("RGB", (96, 72), (20, 20, 20)).save(source_path)
            store = ModelJobStore(Path(tmp) / "model.db")
            segment_job = store.enqueue_segment_nodule(
                SegmentNoduleRequest(
                    study_id="S1",
                    image_id="IMG1",
                    image_uri="artifact://model-ready/S1/IMG1.png",
                    nodule_id="N1",
                    bbox=[10, 20, 30, 40],
                )
            )

            with patch.dict(os.environ, {"JZX_ARTIFACT_ROOT": str(root)}, clear=False):
                segment_result = run_once(store, worker_id="worker-test")

            self.assertEqual(segment_result["status"], "succeeded")
            segment_artifact_path = root / segment_result["artifact_uri"].removeprefix("artifact://")
            segment_artifact = json.loads(segment_artifact_path.read_text(encoding="utf-8"))
            self.assertEqual(segment_artifact["schema_version"], "thyroid.segmentation.output.v1")
            self.assertEqual(segment_artifact["evaluation"]["protocol"], "thyroid.segmentation.evaluation.v1")
            self.assertEqual(segment_artifact["evaluation"]["status"], "validation_fallback_requires_review")
            self.assertTrue(segment_artifact["evaluation"]["fallback_used"])
            mask_uri = segment_artifact["segmentations"][0]["mask_uri"]
            self.assertTrue(mask_uri.endswith("/mask_nodule_1.png"))
            self.assertTrue((root / mask_uri.removeprefix("artifact://")).is_file())

            measure_job = store.enqueue_measure_nodule(
                MeasureNoduleRequest(
                    study_id="S1",
                    image_id="IMG1",
                    nodule_id="N1",
                    mask_uri=mask_uri,
                    pixel_spacing={"row_spacing_mm": 0.1, "col_spacing_mm": 0.2},
                )
            )
            with patch.dict(os.environ, {"JZX_ARTIFACT_ROOT": str(root)}, clear=False):
                measure_result = run_once(store, worker_id="worker-test")

            self.assertEqual(measure_result["status"], "succeeded")
            measure_artifact_path = root / measure_result["artifact_uri"].removeprefix("artifact://")
            measure_artifact = json.loads(measure_artifact_path.read_text(encoding="utf-8"))
            self.assertEqual(measure_artifact["schema_version"], "thyroid.measurement.output.v1")
            measurement = measure_artifact["measurements"][0]
            self.assertEqual(measure_job["job_type"], "thyroid.measure_nodule")
            self.assertEqual(segment_job["job_type"], "thyroid.segment_nodule")
            self.assertEqual(measurement["nodule_id"], "N1")
            self.assertGreater(measurement["long_axis_mm"], 0)
            self.assertEqual(measurement["measurement_source"], "mask")
            self.assertEqual(measure_artifact["pixel_spacing"], {"row_mm": 0.1, "column_mm": 0.2})
            self.assertEqual(measure_artifact["evaluation"]["protocol"], "thyroid.measurement.evaluation.v1")
            self.assertEqual(measure_artifact["evaluation"]["status"], "mm_measurement_available")

    def test_worker_writes_video_segmentation_and_measurement_artifacts(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "artifacts"
            store = ModelJobStore(Path(tmp) / "model.db")
            segment_job = store.enqueue_segment_video_nodule(
                SegmentVideoNoduleRequest(
                    study_id="S1",
                    video_id="VID1",
                    video_uri="artifact://medical-videos/S1/VID1.mp4",
                    targets=[{"nodule_id": "N1", "track_id": "T1", "prompt_frame_index": 7, "bbox": [10, 20, 30, 40]}],
                )
            )

            with patch.dict(os.environ, {"JZX_ARTIFACT_ROOT": str(root)}, clear=False):
                segment_result = run_once(store, worker_id="worker-test")

            self.assertEqual(segment_result["status"], "succeeded")
            segment_artifact_path = root / segment_result["artifact_uri"].removeprefix("artifact://")
            segment_artifact = json.loads(segment_artifact_path.read_text(encoding="utf-8"))
            self.assertEqual(segment_artifact["schema_version"], "thyroid.video_segmentation.output.v1")
            self.assertEqual(segment_artifact["evaluation"]["protocol"], "thyroid.video_segmentation.evaluation.v1")
            self.assertEqual(segment_artifact["evaluation"]["status"], "validation_fallback_requires_review")
            self.assertEqual(segment_artifact["tracks"][0]["track_id"], "T1")
            mask_uri = segment_artifact["tracks"][0]["frames"][0]["mask_uri"]
            self.assertTrue(mask_uri.endswith("/track_T1/frame_000007.png"))
            self.assertTrue((root / mask_uri.removeprefix("artifact://")).is_file())

            measure_job = store.enqueue_measure_video_nodule(
                MeasureVideoNoduleRequest(
                    study_id="S1",
                    video_id="VID1",
                    segmentation_uri=segment_result["artifact_uri"],
                    pixel_spacing={"row_mm": 0.1, "column_mm": 0.2},
                )
            )
            with patch.dict(os.environ, {"JZX_ARTIFACT_ROOT": str(root)}, clear=False):
                measure_result = run_once(store, worker_id="worker-test")

            self.assertEqual(measure_result["status"], "succeeded")
            measure_artifact_path = root / measure_result["artifact_uri"].removeprefix("artifact://")
            measure_artifact = json.loads(measure_artifact_path.read_text(encoding="utf-8"))
            self.assertEqual(measure_artifact["schema_version"], "thyroid.video_measurement.output.v1")
            measurement = measure_artifact["measurements"][0]
            self.assertEqual(segment_job["job_type"], "thyroid.segment_video_nodule")
            self.assertEqual(measure_job["job_type"], "thyroid.measure_video_nodule")
            self.assertEqual(measurement["track_id"], "T1")
            self.assertEqual(measurement["selected_frame_index"], 7)
            self.assertGreater(measurement["long_axis_mm"], 0)
            self.assertEqual(measure_artifact["evaluation"]["protocol"], "thyroid.video_measurement.evaluation.v1")
            self.assertEqual(measure_artifact["evaluation"]["status"], "mm_measurement_available")

    def test_static_model_does_not_fallback_when_disabled_and_unconfigured(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            store = ModelJobStore(Path(tmp) / "model.db")
            queued = store.enqueue_segment_nodule(
                SegmentNoduleRequest(
                    study_id="S1",
                    image_id="IMG1",
                    image_uri="artifact://model-ready/S1/IMG1.png",
                    nodule_id="N1",
                    bbox=[10, 20, 30, 40],
                    model="medsam-thyroid-segmenter",
                    allow_bbox_fallback=False,
                )
            )

            output = run_segment_job(queued, env={})

        self.assertEqual(output["segmentations"], [])
        self.assertIn("segmentation_model_unavailable:fallback_disabled", output["warnings"])
        self.assertTrue(any(str(warning).startswith("medsam_weights_env_missing") for warning in output["warnings"]))

    def test_static_unet_adapter_result_is_used_when_configured(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            weights = Path(tmp) / "unet.pt"
            weights.write_bytes(b"weights")
            store = ModelJobStore(Path(tmp) / "model.db")
            queued = store.enqueue_segment_nodule(
                SegmentNoduleRequest(
                    study_id="S1",
                    image_id="IMG1",
                    image_uri="artifact://model-ready/S1/IMG1.png",
                    nodule_id="N1",
                    bbox=[10, 20, 30, 40],
                    model="unet-thyroid-segmenter",
                    allow_bbox_fallback=False,
                )
            )
            adapter_output = {
                "segmentations": [{"nodule_id": "N1", "bbox": [10, 20, 30, 40]}],
                "model": {"name": "unet-thyroid-segmenter"},
                "warnings": [],
            }

            with patch("app.segmentation.TorchScriptUnetSegmenter.config_issues", return_value=[]):
                with patch("app.segmentation.TorchScriptUnetSegmenter.segment", return_value=adapter_output):
                    output = run_segment_job(queued, env={"JZX_UNET_SEGMENTER_WEIGHTS": str(weights)})

        self.assertEqual(output, adapter_output)

    def test_static_sam2_model_does_not_fallback_when_disabled_and_unconfigured(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            store = ModelJobStore(Path(tmp) / "model.db")
            queued = store.enqueue_segment_nodule(
                SegmentNoduleRequest(
                    study_id="S1",
                    image_id="IMG1",
                    image_uri="artifact://model-ready/S1/IMG1.png",
                    nodule_id="N1",
                    bbox=[10, 20, 30, 40],
                    model="sam2-thyroid-segmenter",
                    allow_bbox_fallback=False,
                )
            )

            output = run_segment_job(queued, env={})

        self.assertEqual(output["segmentations"], [])
        self.assertIn("segmentation_model_unavailable:fallback_disabled", output["warnings"])
        self.assertTrue(any(str(warning).startswith("sam2_weights_env_missing") for warning in output["warnings"]))
        self.assertTrue(any(str(warning).startswith("sam2_config_env_missing") for warning in output["warnings"]))

    def test_static_sam2_adapter_result_is_used_when_configured(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            weights = Path(tmp) / "sam2.pt"
            config = Path(tmp) / "sam2.yaml"
            weights.write_bytes(b"weights")
            config.write_text("model: test\n", encoding="utf-8")
            store = ModelJobStore(Path(tmp) / "model.db")
            queued = store.enqueue_segment_nodule(
                SegmentNoduleRequest(
                    study_id="S1",
                    image_id="IMG1",
                    image_uri="artifact://model-ready/S1/IMG1.png",
                    nodule_id="N1",
                    bbox=[10, 20, 30, 40],
                    model="sam2-thyroid-segmenter",
                    allow_bbox_fallback=False,
                )
            )
            adapter_output = {
                "segmentations": [{"nodule_id": "N1", "bbox": [10, 20, 30, 40]}],
                "model": {"name": "sam2-thyroid-segmenter"},
                "warnings": [],
            }

            with patch("app.segmentation.Sam2ImageSegmenter.config_issues", return_value=[]):
                with patch("app.segmentation.Sam2ImageSegmenter.segment", return_value=adapter_output):
                    output = run_segment_job(
                        queued,
                        env={
                            "JZX_SAM2_WEIGHTS": str(weights),
                            "JZX_SAM2_IMAGE_CONFIG": str(config),
                        },
                    )

        self.assertEqual(output, adapter_output)

    def test_nnunet_static_model_does_not_fallback_when_disabled_and_unconfigured(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            store = ModelJobStore(Path(tmp) / "model.db")
            queued = store.enqueue_segment_nodule(
                SegmentNoduleRequest(
                    study_id="S1",
                    image_id="IMG1",
                    image_uri="artifact://model-ready/S1/IMG1.png",
                    nodule_id="N1",
                    bbox=[10, 20, 30, 40],
                    model="nnunet-tight-roi-segmenter",
                    allow_bbox_fallback=False,
                )
            )

            output = run_segment_job(queued, env={})

        self.assertEqual(output["segmentations"], [])
        self.assertIn("segmentation_model_unavailable:fallback_disabled", output["warnings"])
        self.assertTrue(any(str(warning).startswith("nnunet_results_env_missing") for warning in output["warnings"]))

    def test_static_nnunet_adapter_result_is_used_when_configured(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            results = Path(tmp) / "nnUNet_results"
            results.mkdir()
            store = ModelJobStore(Path(tmp) / "model.db")
            queued = store.enqueue_segment_nodule(
                SegmentNoduleRequest(
                    study_id="S1",
                    image_id="IMG1",
                    image_uri="artifact://model-ready/S1/IMG1.png",
                    nodule_id="N1",
                    bbox=[10, 20, 30, 40],
                    model="nnunet-tight-roi-segmenter",
                    allow_bbox_fallback=False,
                )
            )
            adapter_output = {
                "segmentations": [
                    {
                        "nodule_id": "N1",
                        "bbox": [10, 20, 30, 40],
                        "metadata": {"crop_box_xyxy": [8, 18, 32, 42]},
                    }
                ],
                "model": {"name": "nnunet-tight-roi-segmenter"},
                "warnings": [],
            }

            with patch("app.segmentation.NnUnetTightRoiSegmenter.config_issues", return_value=[]):
                with patch("app.segmentation.NnUnetTightRoiSegmenter.segment", return_value=adapter_output):
                    output = run_segment_job(queued, env={"JZX_NNUNET_RESULTS": str(results)})

        self.assertEqual(output, adapter_output)

    def test_sam2_video_model_does_not_fallback_when_disabled_and_unconfigured(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            store = ModelJobStore(Path(tmp) / "model.db")
            queued = store.enqueue_segment_video_nodule(
                SegmentVideoNoduleRequest(
                    study_id="S1",
                    video_id="VID1",
                    video_uri="artifact://medical-videos/S1/VID1.mp4",
                    targets=[{"nodule_id": "N1", "track_id": "T1", "prompt_frame_index": 7, "bbox": [10, 20, 30, 40]}],
                    model="medsam2-thyroid-video-segmenter",
                    allow_framewise_fallback=False,
                )
            )

            output = run_segment_video_job(queued, env={})

        self.assertEqual(output["tracks"], [])
        self.assertIn("video_segmentation_model_unavailable:fallback_disabled", output["warnings"])
        self.assertTrue(any(str(warning).startswith("sam2_weights_env_missing") for warning in output["warnings"]))

    def test_sam2_video_adapter_result_is_used_when_configured(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            weights = Path(tmp) / "sam2.pt"
            config = Path(tmp) / "sam2.yaml"
            video = Path(tmp) / "video_frames"
            weights.write_bytes(b"weights")
            config.write_text("model: test\n", encoding="utf-8")
            video.mkdir()
            store = ModelJobStore(Path(tmp) / "model.db")
            queued = store.enqueue_segment_video_nodule(
                SegmentVideoNoduleRequest(
                    study_id="S1",
                    video_id="VID1",
                    video_uri=str(video),
                    targets=[{"nodule_id": "N1", "track_id": "T1", "prompt_frame_index": 7, "bbox": [10, 20, 30, 40]}],
                    model="medsam2-thyroid-video-segmenter",
                    allow_framewise_fallback=False,
                )
            )
            adapter_output = {
                "video": {"video_id": "VID1"},
                "tracks": [{"track_id": "T1", "frames": [{"frame_index": 7, "bbox": [10, 20, 30, 40]}]}],
                "model": {"name": "medsam2-thyroid-video-segmenter"},
                "warnings": [],
            }

            with patch("app.segmentation.Sam2VideoSegmenter.config_issues", return_value=[]):
                with patch("app.segmentation.Sam2VideoSegmenter.segment", return_value=adapter_output):
                    output = run_segment_video_job(
                        queued,
                        env={
                            "JZX_MEDSAM2_WEIGHTS": str(weights),
                            "JZX_MEDSAM2_CONFIG": str(config),
                            "JZX_ARTIFACT_ROOT": str(Path(tmp)),
                        },
                    )

        self.assertEqual(output, adapter_output)

    def test_detector_adapter_selection_supports_yolo_and_transformer_detectors(self) -> None:
        default_adapter = select_detector_adapter({}, env={})
        self.assertEqual(default_adapter.adapter_name, "rf-detr")
        self.assertEqual(default_adapter.model_family, "rf-detr")

        yolo = select_detector_adapter({"model_name": "yolov11-thyroid-detector"}, env={})
        self.assertEqual(yolo.adapter_name, "yolov11-ultralytics")
        self.assertEqual(yolo.model_family, "yolov11")

        forced_device = select_detector_adapter(
            {"model_name": "yolov11-thyroid-detector"},
            env={"JZX_MODEL_DEVICE": "0"},
        )
        self.assertEqual(forced_device.common_output([])["model"]["device"], "0")

        rtdetr = select_detector_adapter({"model_name": "rt-detr-thyroid-detector"}, env={})
        self.assertEqual(rtdetr.adapter_name, "rtdetr-ultralytics")
        self.assertEqual(rtdetr.model_family, "rt-detr")

        rfdetr = select_detector_adapter({"model_name": "rf-detr-thyroid-detector"}, env={})
        self.assertEqual(rfdetr.adapter_name, "rf-detr")
        self.assertEqual(rfdetr.model_family, "rf-detr")

    def test_rfdetr_primary_runs_yolo_comparator_and_builds_llm_pack(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            store = ModelJobStore(Path(tmp) / "model.db")
            queued = store.enqueue_detect_nodules(
                DetectNodulesRequest(
                    study_id="S1",
                    image_id="IMG1",
                    image_uri="artifact://model-ready/S1/IMG1.png",
                    model="rf-detr-medium-thyroid-detector",
                    metadata={"confidence_threshold": 0.2},
                )
            )
            primary_output = detector_output(
                model_name="rf-detr-medium-thyroid-detector",
                adapter="rf-detr",
                family="rf-detr",
                bbox=[10, 10, 50, 50],
                confidence=0.93,
            )
            comparator_output = detector_output(
                model_name="yolov11-thyroid-detector",
                adapter="yolov11-ultralytics",
                family="yolov11",
                bbox=[12, 12, 48, 48],
                confidence=0.88,
            )

            with patch("app.detectors.RfDetrDetectorAdapter.detect", return_value=primary_output):
                with patch("app.detectors.YoloV11DetectorAdapter.detect", return_value=comparator_output):
                    output = run_detector_job(queued, env={})

        self.assertEqual(output["model"]["family"], "rf-detr")
        self.assertEqual(output["nodules"][0]["model_name"], "rf-detr-medium-thyroid-detector")
        self.assertEqual(output["comparison"]["consensus"]["status"], "matched")
        self.assertEqual(output["comparison"]["consensus"]["matched_count"], 1)
        self.assertEqual(output["comparison"]["quality_gate"]["status"], "pass")
        self.assertEqual(output["comparison"]["quality_gate"]["primary_role"], "main_detector_rf_detr_medium")
        self.assertEqual(output["comparison"]["comparators"][0]["family"], "yolov11")
        self.assertEqual(output["llm_evaluation"]["status"], "pending_llm")
        self.assertEqual(output["llm_evaluation"]["overall_assessment"], "consistent")

    def test_worker_writes_comparison_artifact_for_dual_detector_output(self) -> None:
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
                    model="rf-detr-medium-thyroid-detector",
                )
            )
            primary_output = detector_output(
                model_name="rf-detr-medium-thyroid-detector",
                adapter="rf-detr",
                family="rf-detr",
                bbox=[10, 10, 50, 50],
                confidence=0.93,
            )
            comparison = {
                "comparators": [
                    {
                        "adapter": "yolov11-ultralytics",
                        "family": "yolov11",
                        "name": "yolov11-thyroid-detector",
                        "version": "validation-comparator",
                    }
                ],
                "matches": [{"primary_detection_id": "primary_001", "comparator_detection_id": "yolo_001", "iou": 0.81}],
                "primary_only": [],
                "comparator_only": [],
                "consensus": {"status": "matched", "matched_count": 1, "primary_only_count": 0, "comparator_only_count": 0},
                "quality_gate": {
                    "status": "pass",
                    "review_reasons": [],
                    "requires_doctor_review": True,
                },
            }
            detector_output_with_comparison = {
                **primary_output,
                "comparison": comparison,
                "llm_evaluation": {"status": "pending_llm", "overall_assessment": "consistent"},
            }

            with patch.dict(os.environ, {"JZX_ARTIFACT_ROOT": str(root)}, clear=False):
                with patch("app.worker.run_detector_job", return_value=detector_output_with_comparison):
                    result = run_once(store, worker_id="worker-test")

            self.assertEqual(result["status"], "succeeded")
            artifact_path = root / result["artifact_uri"].removeprefix("artifact://")
            artifact = json.loads(artifact_path.read_text(encoding="utf-8"))
            comparison_uri = artifact["artifacts"]["model_comparison_json"]
            self.assertTrue(comparison_uri.endswith("/comparison.json"))
            comparison_path = root / comparison_uri.removeprefix("artifact://")
            self.assertTrue(comparison_path.is_file())
            comparison_payload = json.loads(comparison_path.read_text(encoding="utf-8"))
            self.assertEqual(comparison_payload["schema_version"], "thyroid.detector.comparison.v1")
            self.assertEqual(comparison_payload["comparison"]["consensus"]["status"], "matched")
            self.assertEqual(comparison_payload["quality_gate"]["status"], "pass")
            self.assertEqual(artifact["evaluation"]["protocol"], "thyroid.detector.evaluation.v1")
            self.assertEqual(artifact["evaluation"]["status"], "pass")
            self.assertEqual(artifact["llm_evaluation"]["status"], "pending_llm")
            stored_output = result["output"]
            self.assertEqual(stored_output["artifacts"]["model_comparison_json"], comparison_uri)

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


def detector_output(
    *,
    model_name: str,
    adapter: str,
    family: str,
    bbox: list[int],
    confidence: float,
) -> dict[str, object]:
    return {
        "nodules": [
            {
                "nodule_index": 1,
                "bbox": bbox,
                "confidence": confidence,
                "class_id": 0,
                "source": "ai",
                "model_name": model_name,
                "model_version": "test",
            }
        ],
        "model": {
            "adapter": adapter,
            "family": family,
            "name": model_name,
            "version": "test",
            "weights_hash": "sha256:test",
        },
        "warnings": [],
    }


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
