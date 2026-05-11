from __future__ import annotations

import json
import os
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

from pydantic import ValidationError

from .schemas import (
    DetectNodulesRequest,
    GatewayResponse,
    MeasureNoduleRequest,
    MeasureVideoNoduleRequest,
    SegmentNoduleRequest,
    SegmentVideoNoduleRequest,
    error,
    ok,
)
from .store import ModelJobStore, default_db_path

ARTIFACT_MAX_BYTES = 32 * 1024 * 1024
ARTIFACT_MIME_BY_EXT = {
    ".json": "application/json; charset=utf-8",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
}


def create_server(host: str = "127.0.0.1", port: int = 8766, db_path: Path | None = None) -> ThreadingHTTPServer:
    store = ModelJobStore(db_path or Path(os.environ.get("JZX_DATA_DB", default_db_path())))

    class ModelGatewayHandler(BaseHTTPRequestHandler):
        server_version = "jzx-model-gateway/0.1"

        def do_GET(self) -> None:
            parsed_url = urlparse(self.path)
            route_path = parsed_url.path
            if route_path == "/health":
                self._write_response(
                    ok(
                        {
                            "service": "model-gateway",
                            "status": "ready",
                            "data_db": str(store.db_path),
                            "routes": [
                                "/model/v1/infer/thyroid/detect-nodules",
                                "/model/v1/infer/thyroid/segment-nodule",
                                "/model/v1/infer/thyroid/measure-nodule",
                                "/model/v1/infer/thyroid/segment-video-nodule",
                                "/model/v1/infer/thyroid/measure-video-nodule",
                                "/model/v1/jobs/{job_id}",
                                "/model/v1/config/check",
                                "/model/v1/artifacts?uri={artifact_uri}",
                            ],
                        }
                    )
                )
                return
            if route_path == "/model/v1/config/check":
                from .config_check import build_config_report

                self._write_response(ok(build_config_report(db_path=store.db_path)))
                return
            if route_path == "/model/v1/artifacts":
                artifact_uri = first_query_value(parsed_url.query, "uri")
                if not artifact_uri:
                    self._write_response(error("invalid_request", "uri is required"), 400)
                    return
                try:
                    artifact_path = resolve_artifact_path(artifact_uri)
                except ValueError as exc:
                    self._write_response(error("invalid_request", str(exc)), 400)
                    return
                if not artifact_path.is_file():
                    self._write_response(error("artifact_not_found", "artifact was not found", detail={"uri": artifact_uri}), 404)
                    return
                stat = artifact_path.stat()
                if stat.st_size > ARTIFACT_MAX_BYTES:
                    self._write_response(error("artifact_too_large", "artifact exceeds validation preview size limit"), 413)
                    return
                self._write_file_response(artifact_path, stat.st_size)
                return
            if route_path.startswith("/model/v1/jobs/"):
                job_id = route_path.rsplit("/", 1)[-1]
                row = store.get_job(job_id)
                if not row:
                    self._write_response(error("job_not_found", "model job was not found", detail={"job_id": job_id}), 404)
                    return
                self._write_response(ok({"job": format_job(row)}))
                return
            self._write_response(error("not_found", "route not found"), 404)

        def do_POST(self) -> None:
            if self.path not in {
                "/model/v1/infer/thyroid/detect-nodules",
                "/model/v1/infer/thyroid/segment-nodule",
                "/model/v1/infer/thyroid/measure-nodule",
                "/model/v1/infer/thyroid/segment-video-nodule",
                "/model/v1/infer/thyroid/measure-video-nodule",
            }:
                self._write_response(error("not_found", "route not found"), 404)
                return
            try:
                payload = self._read_json()
                request, row = enqueue_request(self.path, payload, store)
                self._write_response(
                    ok(
                        {
                            "job": format_job(row),
                            "job_id": row["id"],
                            "job_type": row["job_type"],
                            "status": row["status"],
                            "model": {
                                "name": row["model_name"],
                                "version": row["model_version"],
                                "weights_hash": row["weights_hash"],
                            },
                        },
                        trace_id=request.trace_id,
                        warnings=[queued_warning(row["job_type"])],
                    )
                )
            except json.JSONDecodeError:
                self._write_response(error("invalid_json", "request body must be valid JSON"), 400)
            except ValidationError as exc:
                self._write_response(
                    error("invalid_request", "request payload failed schema validation", detail={"errors": exc.errors()}),
                    422,
                )
            except Exception as exc:
                self._write_response(error("queue_error", "failed to enqueue model job", detail={"reason": str(exc)}), 500)

        def log_message(self, format: str, *args: object) -> None:
            if os.environ.get("JZX_MODEL_GATEWAY_LOG_HTTP") == "1":
                super().log_message(format, *args)

        def _read_json(self) -> dict[str, object]:
            length = int(self.headers.get("Content-Length", "0"))
            body = self.rfile.read(length)
            data = json.loads(body.decode("utf-8") if body else "{}")
            if not isinstance(data, dict):
                raise ValueError("request body must be a JSON object")
            return data

        def _write_response(self, response: GatewayResponse, status_code: int = 200) -> None:
            payload = response.model_dump(mode="json", exclude_none=True)
            body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
            self.send_response(status_code)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def _write_file_response(self, artifact_path: Path, size_bytes: int) -> None:
            body = artifact_path.read_bytes()
            self.send_response(200)
            self.send_header("Content-Type", ARTIFACT_MIME_BY_EXT.get(artifact_path.suffix.lower(), "application/octet-stream"))
            self.send_header("Content-Length", str(size_bytes))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(body)

    return ThreadingHTTPServer((host, port), ModelGatewayHandler)


def enqueue_request(
    path: str,
    payload: dict[str, object],
    store: ModelJobStore,
) -> tuple[
    DetectNodulesRequest | SegmentNoduleRequest | MeasureNoduleRequest | SegmentVideoNoduleRequest | MeasureVideoNoduleRequest,
    dict[str, object],
]:
    if path == "/model/v1/infer/thyroid/detect-nodules":
        request = DetectNodulesRequest.model_validate(payload)
        return request, store.enqueue_detect_nodules(request)
    if path == "/model/v1/infer/thyroid/segment-nodule":
        request = SegmentNoduleRequest.model_validate(payload)
        return request, store.enqueue_segment_nodule(request)
    if path == "/model/v1/infer/thyroid/measure-nodule":
        request = MeasureNoduleRequest.model_validate(payload)
        return request, store.enqueue_measure_nodule(request)
    if path == "/model/v1/infer/thyroid/segment-video-nodule":
        request = SegmentVideoNoduleRequest.model_validate(payload)
        return request, store.enqueue_segment_video_nodule(request)
    request = MeasureVideoNoduleRequest.model_validate(payload)
    return request, store.enqueue_measure_video_nodule(request)


def queued_warning(job_type: object) -> str:
    if job_type == "thyroid.segment_nodule":
        return "segment worker is queued; validation fallback may use bbox-derived mask when no segmenter is configured"
    if job_type == "thyroid.measure_nodule":
        return "measurement worker is queued; mm values require pixel spacing or manual calibration"
    if job_type == "thyroid.segment_video_nodule":
        return "video segment worker is queued; validation fallback may only emit prompt-frame bbox masks when no video segmenter is configured"
    if job_type == "thyroid.measure_video_nodule":
        return "video measurement worker is queued; mm values require pixel spacing or manual calibration"
    return "detector worker is not configured yet; job is queued for validation flow only"


def first_query_value(query: str, key: str) -> str | None:
    values = parse_qs(query).get(key)
    if not values:
        return None
    value = values[0].strip()
    return value or None


def resolve_artifact_path(artifact_uri: str) -> Path:
    if not artifact_uri.startswith("artifact://"):
        raise ValueError("uri must start with artifact://")
    relative = artifact_uri.removeprefix("artifact://").lstrip("/")
    if not relative:
        raise ValueError("artifact URI must include a path")
    root = Path(os.environ.get("JZX_ARTIFACT_ROOT", "data/artifacts")).expanduser().resolve()
    target = (root / relative).resolve()
    if not target.is_relative_to(root):
        raise ValueError("artifact URI cannot escape artifact root")
    return target


def format_job(row: dict[str, object]) -> dict[str, object]:
    return {
        "id": row["id"],
        "study_id": row["study_id"],
        "image_id": row["image_id"],
        "agent_task_id": row["agent_task_id"],
        "job_type": row["job_type"],
        "status": row["status"],
        "priority": row["priority"],
        "attempts": row["attempts"],
        "max_attempts": row["max_attempts"],
        "model_name": row["model_name"],
        "model_version": row["model_version"],
        "weights_hash": row["weights_hash"],
        "artifact_uri": row["artifact_uri"],
        "created_at": row["created_at"],
        "updated_at": row["updated_at"],
        "started_at": row["started_at"],
        "completed_at": row["completed_at"],
        "input": parse_json(row["input_json"]),
        "output": parse_json(row["output_json"]),
        "error": parse_json(row["error_json"]),
    }


def parse_json(value: object) -> object:
    if not isinstance(value, str) or not value:
        return None
    try:
        return json.loads(value)
    except json.JSONDecodeError:
        return None


def main() -> None:
    host = os.environ.get("JZX_MODEL_GATEWAY_HOST", "127.0.0.1")
    port = int(os.environ.get("JZX_MODEL_GATEWAY_PORT", "8766"))
    db_path = Path(os.environ.get("JZX_DATA_DB", default_db_path()))
    server = create_server(host, port, db_path)
    print(f"model-gateway listening on http://{host}:{port}")
    print(f"data db: {db_path}")
    server.serve_forever()


if __name__ == "__main__":
    main()
