from __future__ import annotations

import json
import sys
import tempfile
import threading
import unittest
import urllib.request
from pathlib import Path


SERVICE_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SERVICE_ROOT))

from app.operations import image_quality_check, resolve_uri  # noqa: E402
from app.schemas import ImageRequest  # noqa: E402
from app.server import create_server  # noqa: E402


class ImageWorkerTest(unittest.TestCase):
    def test_health_endpoint_starts(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            server = create_server(port=0, artifact_root=Path(tmp))
            thread = threading.Thread(target=server.serve_forever, daemon=True)
            thread.start()
            try:
                host, port = server.server_address
                with urllib.request.urlopen(f"http://{host}:{port}/health", timeout=5) as response:
                    payload = json.loads(response.read().decode("utf-8"))
                self.assertEqual(payload["status"], "ok")
                self.assertEqual(payload["result"]["service"], "image-worker")
                self.assertIn("dependencies", payload["result"])
            finally:
                server.shutdown()
                server.server_close()
                thread.join(timeout=5)

    def test_resolve_artifact_uri_stays_inside_root(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            expected = (root / "raw" / "a.png").resolve()
            self.assertEqual(resolve_uri("artifact://raw/a.png", root), expected)
            with self.assertRaises(ValueError):
                resolve_uri("artifact://../escape.png", root)

    def test_image_quality_check_for_raster_file(self) -> None:
        from PIL import Image

        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "sample.png"
            image = Image.new("L", (512, 512), 0)
            for x in range(256, 512):
                for y in range(512):
                    image.putpixel((x, y), 255)
            image.save(path)

            response = image_quality_check(
                ImageRequest(study_id="S1", image_id="IMG1", image_uri=str(path)),
                Path(tmp),
            )
            self.assertEqual(response.status, "ok")
            self.assertTrue(response.result["is_analyzable"])
            self.assertGreaterEqual(response.result["quality_score"], 0.55)


if __name__ == "__main__":
    unittest.main()
