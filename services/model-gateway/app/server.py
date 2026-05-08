from __future__ import annotations

import json
import os
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from pydantic import ValidationError

from .schemas import DetectNodulesRequest, GatewayResponse, error, ok
from .store import ModelJobStore, default_db_path


def create_server(host: str = "127.0.0.1", port: int = 8766, db_path: Path | None = None) -> ThreadingHTTPServer:
    store = ModelJobStore(db_path or Path(os.environ.get("JZX_DATA_DB", default_db_path())))

    class ModelGatewayHandler(BaseHTTPRequestHandler):
        server_version = "jzx-model-gateway/0.1"

        def do_GET(self) -> None:
            if self.path == "/health":
                self._write_response(
                    ok(
                        {
                            "service": "model-gateway",
                            "status": "ready",
                            "data_db": str(store.db_path),
                            "routes": [
                                "/model/v1/infer/thyroid/detect-nodules",
                                "/model/v1/jobs/{job_id}",
                                "/model/v1/config/check",
                            ],
                        }
                    )
                )
                return
            if self.path == "/model/v1/config/check":
                from .config_check import build_config_report

                self._write_response(ok(build_config_report(db_path=store.db_path)))
                return
            if self.path.startswith("/model/v1/jobs/"):
                job_id = self.path.rsplit("/", 1)[-1]
                row = store.get_job(job_id)
                if not row:
                    self._write_response(error("job_not_found", "model job was not found", detail={"job_id": job_id}), 404)
                    return
                self._write_response(ok({"job": format_job(row)}))
                return
            self._write_response(error("not_found", "route not found"), 404)

        def do_POST(self) -> None:
            if self.path != "/model/v1/infer/thyroid/detect-nodules":
                self._write_response(error("not_found", "route not found"), 404)
                return
            try:
                payload = self._read_json()
                request = DetectNodulesRequest.model_validate(payload)
                row = store.enqueue_detect_nodules(request)
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
                        warnings=["detector worker is not configured yet; job is queued for validation flow only"],
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

    return ThreadingHTTPServer((host, port), ModelGatewayHandler)


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
