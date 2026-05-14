from __future__ import annotations

import base64
import importlib.util
import json
import sys
import tempfile
import unittest
from pathlib import Path


TOOL_PATH = Path(__file__).resolve().parents[1] / "thyroid_dataset_builder.py"
SPEC = importlib.util.spec_from_file_location("thyroid_dataset_builder", TOOL_PATH)
assert SPEC is not None
builder = importlib.util.module_from_spec(SPEC)
assert SPEC.loader is not None
sys.modules["thyroid_dataset_builder"] = builder
SPEC.loader.exec_module(builder)


PNG_2X2 = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFElEQVR4nGP8z8DAwMDAxMDAwMDA"
    "AAAFBgIAf0wE9QAAAABJRU5ErkJggg=="
)


class ThyroidDatasetBuilderTest(unittest.TestCase):
    def test_builds_case_dataset_and_detection_manifest(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            source = root / "source"
            case = source / "caseA"
            case.mkdir(parents=True)
            image = case / "image1.png"
            image.write_bytes(PNG_2X2)
            (case / "image1.json").write_text(
                json.dumps(
                    {
                        "version": "5.9.1",
                        "imagePath": "image1.png",
                        "imageWidth": 2,
                        "imageHeight": 2,
                        "shapes": [
                            {
                                "label": "甲状腺结节",
                                "shape_type": "polygon",
                                "points": [[0, 0], [2, 0], [2, 2], [0, 2]],
                            }
                        ],
                    },
                    ensure_ascii=False,
                ),
                encoding="utf-8",
            )
            (case / "诊断报告.txt").write_text("超声提示甲状腺结节。", encoding="utf-8")
            raw_report = "姓名：张三\n手机号：13800138000\n超声提示甲状腺结节。"
            (case / "诊断报告.txt").write_text(raw_report, encoding="utf-8")
            (case / "cine.mp4").write_bytes(b"fake-video")

            output = root / "dataset"
            options = builder.BuildOptions(
                source_root=source,
                output_dir=output,
                dataset_id="demo",
                case_mode="auto",
                copy_mode="copy",
                case_regex=None,
                overwrite=False,
                extract_labelme_image_data=True,
                deidentify="basic",
                redact_regions=builder.DEFAULT_REDACT_REGIONS.copy(),
                sensitive_terms=[],
                linkage_mode="auto",
                linkage_salt=None,
                include_source_paths=False,
            )
            summary = builder.build_dataset(options)

            self.assertEqual(summary["case_count"], 1)
            self.assertEqual(summary["counts"]["image"], 1)
            self.assertEqual(summary["counts"]["annotation"], 1)
            self.assertTrue((output / "metadata" / "file_manifest.csv").is_file())

            rows = read_jsonl(output / "metadata" / "detection_manifest.jsonl")
            self.assertEqual(len(rows), 1)
            self.assertTrue(rows[0]["case_id"].startswith("st-path-"))
            self.assertEqual(rows[0]["source_image_reference"], "[redacted]")
            self.assertEqual(rows[0]["bboxes_xyxy"], [[0.0, 0.0, 2.0, 2.0]])
            self.assertTrue(Path(rows[0]["image_path"]).is_file())

            case_manifest = json.loads((output / "cases" / rows[0]["case_id"] / "case.json").read_text(encoding="utf-8"))
            self.assertEqual(len(case_manifest["static_images"]), 1)
            self.assertEqual(len(case_manifest["reports"]), 1)
            self.assertEqual(len(case_manifest["videos"]), 1)
            report_path = output / case_manifest["reports"][0]["path"]
            self.assertIn("姓名：[已脱敏]", report_path.read_text(encoding="utf-8"))
            self.assertNotIn("张三", report_path.read_text(encoding="utf-8"))
            self.assertEqual((case / "诊断报告.txt").read_text(encoding="utf-8"), raw_report)

    def test_extracts_labelme_embedded_image_when_source_image_is_missing(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            source = root / "source"
            source.mkdir()
            (source / "ann.json").write_text(
                json.dumps(
                    {
                        "imagePath": "missing.png",
                        "imageData": base64.b64encode(PNG_2X2).decode("ascii"),
                        "imageWidth": 2,
                        "imageHeight": 2,
                        "shapes": [
                            {
                                "label": "nodule",
                                "shape_type": "rectangle",
                                "points": [[0, 0], [2, 2]],
                            }
                        ],
                    }
                ),
                encoding="utf-8",
            )

            output = root / "dataset"
            options = builder.BuildOptions(
                source_root=source,
                output_dir=output,
                dataset_id="flat-demo",
                case_mode="flat",
                copy_mode="copy",
                case_regex=None,
                overwrite=False,
                extract_labelme_image_data=True,
                deidentify="basic",
                redact_regions=builder.DEFAULT_REDACT_REGIONS.copy(),
                sensitive_terms=[],
                linkage_mode="auto",
                linkage_salt=None,
                include_source_paths=False,
            )
            summary = builder.build_dataset(options)

            self.assertEqual(summary["counts"]["image"], 1)
            rows = read_jsonl(output / "metadata" / "detection_manifest.jsonl")
            self.assertEqual(len(rows), 1)
            self.assertTrue(Path(rows[0]["image_path"]).is_file())
            self.assertTrue(rows[0]["deidentified"])
            annotation = json.loads(Path(rows[0]["annotation_path"]).read_text(encoding="utf-8"))
            self.assertIsNone(annotation["imageData"])
            warnings = read_jsonl(output / "metadata" / "warnings.jsonl")
            self.assertTrue(any(row["warning"] == "image_extracted_from_labelme_imageData" for row in warnings))

    def test_identity_linkage_uses_hashed_keys_and_does_not_materialize_unsupported_raw_files(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            source = root / "hospital-disk"
            case = source / "病例-张三"
            case.mkdir(parents=True)
            image = case / "US_1.png"
            image.write_bytes(PNG_2X2)
            report_text = (
                "姓名：张三\n"
                "病历号：MR001\n"
                "检查号：ACC001\n"
                "检查日期：2026-04-09\n"
                "甲状腺结节 TI-RADS 4C，大小 8x6mm。\n"
                "病理提示乳头状癌。\n"
                "备注：张三本人复诊。"
            )
            (case / "超声报告.txt").write_text(report_text, encoding="utf-8")
            unsupported = case / "原始登记表.xlsx"
            unsupported.write_bytes(b"name=Zhang San")

            output = source / "derived-dataset"
            options = builder.BuildOptions(
                source_root=source,
                output_dir=output,
                dataset_id="clinical-demo",
                case_mode="auto",
                copy_mode="symlink",
                case_regex=None,
                overwrite=False,
                extract_labelme_image_data=True,
                deidentify="basic",
                redact_regions=builder.DEFAULT_REDACT_REGIONS.copy(),
                sensitive_terms=[],
                linkage_mode="identity",
                linkage_salt="secret-salt",
                include_source_paths=False,
            )
            summary = builder.build_dataset(options)

            self.assertEqual(summary["source_root"], "[redacted]")
            self.assertFalse(summary["include_source_paths"])
            self.assertEqual(summary["case_count"], 1)

            file_rows = read_csv(output / "metadata" / "file_manifest.csv")
            self.assertTrue(all(row["source_reference"] == "[redacted]" for row in file_rows))
            self.assertTrue(all("张三" not in json.dumps(row, ensure_ascii=False) for row in file_rows))

            case_rows = read_jsonl(output / "metadata" / "cases.jsonl")
            self.assertEqual(len(case_rows), 1)
            self.assertTrue(case_rows[0]["case_id"].startswith("st-"))
            self.assertFalse(case_rows[0]["case_id"].startswith("st-path-"))
            self.assertEqual(case_rows[0]["clinical_labels"]["tirads_reported"], "TI-RADS 4C")
            self.assertEqual(case_rows[0]["clinical_labels"]["malignancy_status"], "malignant")

            report_rows = read_jsonl(output / "metadata" / "reports.jsonl")
            report_path = output / report_rows[0]["path"]
            redacted_report = report_path.read_text(encoding="utf-8")
            self.assertIn("姓名：[已脱敏]", redacted_report)
            self.assertNotIn("张三", redacted_report)
            self.assertEqual((case / "超声报告.txt").read_text(encoding="utf-8"), report_text)

            unsupported_rows = [row for row in file_rows if row["subtype"] == "unclassified"]
            self.assertEqual(len(unsupported_rows), 1)
            self.assertEqual(unsupported_rows[0]["deidentification_status"], "unsupported_not_materialized")
            self.assertFalse((output / unsupported_rows[0]["relative_path"]).exists())


def read_jsonl(path: Path) -> list[dict]:
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]


def read_csv(path: Path) -> list[dict]:
    import csv

    with path.open(newline="", encoding="utf-8") as handle:
        return list(csv.DictReader(handle))


if __name__ == "__main__":
    unittest.main()
