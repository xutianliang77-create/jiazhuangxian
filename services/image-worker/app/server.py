from __future__ import annotations

import json
import os
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Callable

from pydantic import ValidationError

from .operations import (
    copy_input,
    deidentify_dicom,
    dependency_status,
    extract_calibration,
    image_quality_check,
    parse_dicom,
    preprocess_ultrasound,
    render_preview,
)
from .schemas import (
    ImageRequest,
    OutputImageRequest,
    PreprocessUltrasoundRequest,
    RenderPreviewRequest,
    WorkerResponse,
    error,
    ok,
)


RouteHandler = Callable[[dict[str, object], Path], WorkerResponse]


def create_server(host: str = "127.0.0.1", port: int = 8765, artifact_root: Path | None = None) -> ThreadingHTTPServer:
    root = artifact_root or Path(os.environ.get("JZX_ARTIFACT_ROOT", "data/artifacts"))

    class ImageWorkerHandler(BaseHTTPRequestHandler):
        server_version = "jzx-image-worker/0.1"

        def do_GET(self) -> None:
            if self.path == "/health":
                self._write_response(
                    ok(
                        {
                            "service": "image-worker",
                            "status": "ready",
                            "artifact_root": str(root),
                            "dependencies": dependency_status(),
                        }
                    )
                )
                return
            self._write_response(error("not_found", "route not found"), status_code=404)

        def do_POST(self) -> None:
            route = ROUTES.get(self.path)
            if not route:
                self._write_response(error("not_found", "route not found"), status_code=404)
                return
            try:
                payload = self._read_json()
                response = route(payload, root)
                self._write_response(response, status_code=200 if response.status == "ok" else 422)
            except json.JSONDecodeError:
                self._write_response(error("invalid_json", "request body must be valid JSON"), status_code=400)
            except ValidationError as exc:
                self._write_response(
                    error("invalid_request", "request payload failed schema validation", detail={"errors": exc.errors()}),
                    status_code=422,
                )
            except ValueError as exc:
                self._write_response(error("invalid_request", str(exc)), status_code=422)
            except Exception as exc:
                self._write_response(error("internal_error", "image-worker failed", detail={"reason": str(exc)}), status_code=500)

        def log_message(self, format: str, *args: object) -> None:
            if os.environ.get("JZX_IMAGE_WORKER_LOG_HTTP") == "1":
                super().log_message(format, *args)

        def _read_json(self) -> dict[str, object]:
            length = int(self.headers.get("Content-Length", "0"))
            body = self.rfile.read(length)
            data = json.loads(body.decode("utf-8") if body else "{}")
            if not isinstance(data, dict):
                raise ValueError("request body must be a JSON object")
            return data

        def _write_response(self, response: WorkerResponse, status_code: int = 200) -> None:
            payload = response.model_dump(mode="json", exclude_none=True)
            body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
            self.send_response(status_code)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

    return ThreadingHTTPServer((host, port), ImageWorkerHandler)


def handle_parse_dicom(payload: dict[str, object], artifact_root: Path) -> WorkerResponse:
    return parse_dicom(ImageRequest.model_validate(payload), artifact_root)


def handle_deidentify_dicom(payload: dict[str, object], artifact_root: Path) -> WorkerResponse:
    return deidentify_dicom(OutputImageRequest.model_validate(payload), artifact_root)


def handle_render_preview(payload: dict[str, object], artifact_root: Path) -> WorkerResponse:
    return render_preview(RenderPreviewRequest.model_validate(payload), artifact_root)


def handle_preprocess_ultrasound(payload: dict[str, object], artifact_root: Path) -> WorkerResponse:
    return preprocess_ultrasound(PreprocessUltrasoundRequest.model_validate(payload), artifact_root)


def handle_extract_calibration(payload: dict[str, object], artifact_root: Path) -> WorkerResponse:
    return extract_calibration(ImageRequest.model_validate(payload), artifact_root)


def handle_image_quality_check(payload: dict[str, object], artifact_root: Path) -> WorkerResponse:
    return image_quality_check(ImageRequest.model_validate(payload), artifact_root)


def handle_copy_input(payload: dict[str, object], artifact_root: Path) -> WorkerResponse:
    return copy_input(OutputImageRequest.model_validate(payload), artifact_root)


ROUTES: dict[str, RouteHandler] = {
    "/image/v1/parse-dicom": handle_parse_dicom,
    "/image/v1/deidentify-dicom": handle_deidentify_dicom,
    "/image/v1/render-preview": handle_render_preview,
    "/image/v1/preprocess-ultrasound": handle_preprocess_ultrasound,
    "/image/v1/extract-calibration": handle_extract_calibration,
    "/image/v1/image-quality-check": handle_image_quality_check,
    "/image/v1/copy-input": handle_copy_input,
}


def main() -> None:
    host = os.environ.get("JZX_IMAGE_WORKER_HOST", "127.0.0.1")
    port = int(os.environ.get("JZX_IMAGE_WORKER_PORT", "8765"))
    artifact_root = Path(os.environ.get("JZX_ARTIFACT_ROOT", "data/artifacts"))
    server = create_server(host, port, artifact_root)
    print(f"image-worker listening on http://{host}:{port}")
    print(f"artifact root: {artifact_root}")
    server.serve_forever()


if __name__ == "__main__":
    main()
