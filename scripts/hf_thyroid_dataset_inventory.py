from __future__ import annotations

import argparse
import json
import mimetypes
import sys
import time
from collections import Counter
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any
from urllib.parse import quote

try:
    import requests
except ImportError as exc:  # pragma: no cover - real CLI environment only.
    raise SystemExit("requests is required. Install it with: pip install requests") from exc

try:
    from PIL import Image
except ImportError:  # pragma: no cover - optional for metadata-only runs.
    Image = None  # type: ignore[assignment]

try:
    import pyarrow.parquet as pq
except ImportError:  # pragma: no cover - optional unless parquet files are inspected.
    pq = None  # type: ignore[assignment]


DEFAULT_ENDPOINT = "https://hf-mirror.com"
DEFAULT_OUTPUT_ROOT = Path("data/artifacts/datasets/hf-thyroid")
IMAGE_SUFFIXES = {".jpg", ".jpeg", ".png", ".bmp", ".webp"}
DATA_SUFFIXES = IMAGE_SUFFIXES | {".parquet", ".json", ".jsonl", ".csv", ".txt", ".md", ".yaml", ".yml"}


@dataclass(frozen=True)
class Candidate:
    repo_id: str
    local_id: str
    expected_use: str
    download_policy: str
    notes: str


CANDIDATES = [
    Candidate(
        repo_id="Johnyquest7/TN5000-thyroid-nodule-classification",
        local_id="tn5000_cropped_classification",
        expected_use="classification_or_auxiliary_cropped_detector_samples",
        download_policy="download_public",
        notes="Cropped 224x224 TN5000 classification imagefolder. No real bbox files were advertised in the dataset card.",
    ),
    Candidate(
        repo_id="BTX24/thyroid-cancer-classification-ultrasound-dataset",
        local_id="btx24_thyroid_cancer_classification_ultrasound",
        expected_use="classification_or_external_validation",
        download_policy="download_public",
        notes="Parquet image classification dataset with image and label columns.",
    ),
    Candidate(
        repo_id="Leeyuyu/ROCOv2_Thyroid",
        local_id="roco_v2_thyroid",
        expected_use="captioned_image_text_reference_only",
        download_policy="download_public",
        notes="Small ROCOv2 thyroid subset. Useful for caption/reference checks, not detector training.",
    ),
    Candidate(
        repo_id="FangDai/Thyroid_Ultrasound_Images",
        local_id="fangdai_thyroid_ultrasound_images",
        expected_use="classification_external_validation_after_access_approval",
        download_policy="metadata_only_gated",
        notes="Auto-gated. Do not download payload files without HF account approval.",
    ),
    Candidate(
        repo_id="hunglc007/ThyroidXL",
        local_id="thyroidxl",
        expected_use="detection_segmentation_classification_after_access_approval",
        download_policy="metadata_only_gated",
        notes="Manual-gated. Candidate for future detector/segmentation expansion after approval.",
    ),
    Candidate(
        repo_id="haifan-gong/TN3K",
        local_id="tn3k_reference",
        expected_use="already_downloaded_mask_to_bbox_detector_training",
        download_policy="metadata_only_existing",
        notes="Already downloaded separately under data/artifacts/datasets/tn3k.",
    ),
]


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Inventory and optionally download public Hugging Face thyroid datasets.")
    parser.add_argument("--endpoint", default=DEFAULT_ENDPOINT)
    parser.add_argument("--output-root", type=Path, default=DEFAULT_OUTPUT_ROOT)
    parser.add_argument("--download", action="store_true")
    parser.add_argument("--timeout", type=int, default=60)
    parser.add_argument("--workers", type=int, default=8)
    parser.add_argument("--max-files", type=int, default=0, help="Debug limit per repo; 0 means no limit.")
    parser.add_argument("--candidate", action="append", help="Limit to one or more repo ids.")
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(sys.argv[1:] if argv is None else argv)
    args.output_root.mkdir(parents=True, exist_ok=True)
    selected = [
        item for item in CANDIDATES if not args.candidate or item.repo_id in set(args.candidate)
    ]
    results = [
        inventory_candidate(
            candidate,
            endpoint=args.endpoint.rstrip("/"),
            output_root=args.output_root,
            download=args.download,
            timeout=args.timeout,
            workers=args.workers,
            max_files=args.max_files,
        )
        for candidate in selected
    ]
    report = {
        "schema_version": "hf.thyroid.dataset_inventory.v1",
        "created_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "endpoint": args.endpoint,
        "download_requested": args.download,
        "datasets": results,
    }
    write_json(args.output_root / "inventory.json", report)
    write_markdown(args.output_root / "evaluation.md", report)
    print(json.dumps(report, ensure_ascii=False, indent=2))
    return 0


def inventory_candidate(
    candidate: Candidate,
    *,
    endpoint: str,
    output_root: Path,
    download: bool,
    timeout: int,
    workers: int,
    max_files: int,
) -> dict[str, Any]:
    repo_root = output_root / candidate.local_id
    raw_root = repo_root / "raw"
    meta = api_json(endpoint, f"/api/datasets/{candidate.repo_id}", timeout=timeout)
    metadata = dataset_metadata(meta)
    if candidate.download_policy.startswith("metadata_only") and metadata.get("gated") not in (False, None):
        tree = []
    else:
        tree = api_json(endpoint, f"/api/datasets/{candidate.repo_id}/tree/main?recursive=1", timeout=timeout)
    if not isinstance(tree, list):
        tree = []

    gated = metadata.get("gated")
    files = merge_tree_and_siblings(
        [item for item in tree if isinstance(item, dict) and item.get("type") == "file"],
        meta,
    )
    selected_files = downloadable_files(files)
    if max_files > 0:
        selected_files = selected_files[:max_files]

    downloaded: list[dict[str, Any]] = []
    should_download = download and candidate.download_policy == "download_public" and gated in (False, None)
    if should_download:
        raw_root.mkdir(parents=True, exist_ok=True)
        downloaded = download_files(
            endpoint=endpoint,
            repo_id=candidate.repo_id,
            raw_root=raw_root,
            file_items=selected_files,
            timeout=timeout,
            workers=workers,
        )

    local_root = raw_root if raw_root.exists() else None
    local_eval = evaluate_local_files(local_root) if local_root else {}
    tree_eval = evaluate_tree(files)
    return {
        "candidate": asdict(candidate),
        "metadata": metadata,
        "tree": tree_eval,
        "download": {
            "requested": download,
            "attempted": should_download,
            "policy": candidate.download_policy,
            "raw_root": str(raw_root),
            "files_downloaded": len(downloaded),
            "bytes_downloaded": sum(int(item["size"]) for item in downloaded),
        },
        "local_evaluation": local_eval,
        "usability": usability(candidate, dataset_metadata(meta), tree_eval, local_eval),
    }


def api_json(endpoint: str, path: str, *, timeout: int) -> Any:
    url = f"{endpoint}{path}"
    response = requests.get(url, timeout=timeout)
    if response.status_code == 404:
        return {"error": "not_found", "url": url}
    if response.status_code == 401:
        return {"error": "unauthorized", "url": url}
    response.raise_for_status()
    return response.json()


def dataset_metadata(meta: Any) -> dict[str, Any]:
    if not isinstance(meta, dict):
        return {"error": "metadata_unavailable"}
    card = meta.get("cardData") if isinstance(meta.get("cardData"), dict) else {}
    return {
        "id": meta.get("id"),
        "gated": meta.get("gated"),
        "private": meta.get("private"),
        "disabled": meta.get("disabled"),
        "lastModified": meta.get("lastModified"),
        "downloads": meta.get("downloads"),
        "tags": meta.get("tags") or [],
        "cardData": {
            key: card.get(key)
            for key in ("license", "task_categories", "pretty_name", "size_categories", "tags", "splits", "dataset_info")
            if key in card
        },
        **({"error": meta.get("error"), "url": meta.get("url")} if meta.get("error") else {}),
    }


def merge_tree_and_siblings(tree_files: list[dict[str, Any]], meta: Any) -> list[dict[str, Any]]:
    merged = {str(item.get("path")): item for item in tree_files if item.get("path")}
    if isinstance(meta, dict):
        for sibling in meta.get("siblings") or []:
            if not isinstance(sibling, dict):
                continue
            path = sibling.get("rfilename")
            if not isinstance(path, str) or not path:
                continue
            merged.setdefault(
                path,
                {
                    "path": path,
                    "type": "file",
                    **({"size": sibling["size"]} if isinstance(sibling.get("size"), int) else {}),
                },
            )
    return [merged[key] for key in sorted(merged)]


def downloadable_files(files: list[dict[str, Any]]) -> list[dict[str, Any]]:
    chosen = []
    for item in files:
        path = str(item.get("path", ""))
        suffix = Path(path).suffix.lower()
        if suffix in DATA_SUFFIXES or path == "README.md":
            chosen.append(item)
    return chosen


def download_file(endpoint: str, repo_id: str, path: str, target: Path, *, expected_size: Any, timeout: int) -> None:
    target.parent.mkdir(parents=True, exist_ok=True)
    expected = int(expected_size) if isinstance(expected_size, int) and expected_size > 0 else None
    if target.exists() and (expected is None or target.stat().st_size == expected):
        return
    url = f"{endpoint}/datasets/{repo_id}/resolve/main/{quote(path)}"
    last_error: Exception | None = None
    for attempt in range(6):
        try:
            with requests.get(url, stream=True, timeout=timeout) as response:
                if response.status_code in {429, 500, 502, 503, 504} and attempt < 5:
                    time.sleep(min(60, 2 ** attempt))
                    continue
                response.raise_for_status()
                tmp = target.with_suffix(target.suffix + ".tmp")
                with tmp.open("wb") as handle:
                    for chunk in response.iter_content(chunk_size=1024 * 1024):
                        if chunk:
                            handle.write(chunk)
                tmp.replace(target)
                return
        except requests.RequestException as exc:
            last_error = exc
            if attempt >= 5:
                break
            time.sleep(min(60, 2 ** attempt))
    if last_error is not None:
        raise last_error


def download_files(
    *,
    endpoint: str,
    repo_id: str,
    raw_root: Path,
    file_items: list[dict[str, Any]],
    timeout: int,
    workers: int,
) -> list[dict[str, Any]]:
    if not file_items:
        return []
    max_workers = max(1, workers)
    results: list[dict[str, Any]] = []
    with ThreadPoolExecutor(max_workers=max_workers) as executor:
        futures = []
        for file_item in file_items:
            path = str(file_item["path"])
            target = raw_root / path
            futures.append(
                executor.submit(
                    download_one_with_result,
                    endpoint,
                    repo_id,
                    path,
                    target,
                    file_item.get("size"),
                    timeout,
                )
            )
        for index, future in enumerate(as_completed(futures), start=1):
            result = future.result()
            results.append(result)
            if index == 1 or index % 100 == 0 or index == len(futures):
                print(f"downloaded {index}/{len(futures)} files from {repo_id}", file=sys.stderr, flush=True)
    return results


def download_one_with_result(
    endpoint: str,
    repo_id: str,
    path: str,
    target: Path,
    expected_size: Any,
    timeout: int,
) -> dict[str, Any]:
    download_file(endpoint, repo_id, path, target, expected_size=expected_size, timeout=timeout)
    return {"path": path, "local_path": str(target), "size": target.stat().st_size}


def evaluate_tree(files: list[dict[str, Any]]) -> dict[str, Any]:
    suffixes = Counter(Path(str(item.get("path", ""))).suffix.lower() or "<none>" for item in files)
    image_files = [str(item.get("path", "")) for item in files if Path(str(item.get("path", ""))).suffix.lower() in IMAGE_SUFFIXES]
    annotation_like = [
        str(item.get("path", ""))
        for item in files
        if looks_like_annotation(str(item.get("path", "")))
    ]
    top_dirs = Counter(str(item.get("path", "")).split("/", 1)[0] for item in files if "/" in str(item.get("path", "")))
    return {
        "file_count": len(files),
        "suffix_counts": dict(sorted(suffixes.items())),
        "image_count": len(image_files),
        "annotation_like_count": len(annotation_like),
        "annotation_like_examples": annotation_like[:20],
        "top_dirs": dict(sorted(top_dirs.items())),
    }


def looks_like_annotation(path: str) -> bool:
    lowered = path.lower()
    suffix = Path(path).suffix.lower()
    tokens = ("bbox", "box", "mask", "seg", "annotation", "label", "coco", "yolo", "xml")
    return suffix in {".json", ".jsonl", ".xml", ".txt", ".csv", ".yaml", ".yml", ".parquet"} and any(
        token in lowered for token in tokens
    )


def evaluate_local_files(root: Path | None) -> dict[str, Any]:
    if root is None or not root.exists():
        return {}
    files = [path for path in root.rglob("*") if path.is_file()]
    image_files = [path for path in files if path.suffix.lower() in IMAGE_SUFFIXES]
    parquet_files = [path for path in files if path.suffix.lower() == ".parquet"]
    class_dirs = Counter(class_key(root, path) for path in image_files)
    image_sizes = sample_image_sizes(image_files[:50])
    parquet = [inspect_parquet(path) for path in parquet_files]
    return {
        "file_count": len(files),
        "image_count": len(image_files),
        "image_class_counts": dict(sorted(class_dirs.items())),
        "sample_image_sizes": image_sizes,
        "parquet_files": parquet,
    }


def class_key(root: Path, image_path: Path) -> str:
    rel = image_path.relative_to(root)
    parts = rel.parts
    if len(parts) >= 3:
        return "/".join(parts[:2])
    if len(parts) >= 2:
        return parts[0]
    return "<root>"


def sample_image_sizes(paths: list[Path]) -> dict[str, int]:
    sizes: Counter[str] = Counter()
    if Image is None:
        return {}
    for path in paths:
        try:
            with Image.open(path) as image:
                sizes[f"{image.width}x{image.height}"] += 1
        except Exception:
            sizes["<unreadable>"] += 1
    return dict(sorted(sizes.items()))


def inspect_parquet(path: Path) -> dict[str, Any]:
    if pq is None:
        return {"path": str(path), "error": "pyarrow_not_installed"}
    table = pq.read_table(path)
    schema = table.schema
    columns = []
    for field in schema:
        columns.append({"name": field.name, "type": str(field.type)})
    return {
        "path": str(path),
        "rows": table.num_rows,
        "columns": columns,
        "mime": mimetypes.guess_type(path.name)[0],
    }


def usability(
    candidate: Candidate,
    metadata: dict[str, Any],
    tree_eval: dict[str, Any],
    local_eval: dict[str, Any],
) -> dict[str, Any]:
    gated = metadata.get("gated")
    if gated not in (False, None):
        return {
            "detector_training": "blocked",
            "reason": "dataset is gated and requires Hugging Face account approval before payload download",
        }
    if candidate.local_id == "tn3k_reference":
        return {
            "detector_training": "usable_existing",
            "reason": "existing TN3K masks can be converted to true bbox labels",
        }
    if tree_eval.get("annotation_like_count", 0) > 0 and has_mask_or_bbox(tree_eval):
        return {
            "detector_training": "candidate_requires_converter",
            "reason": "annotation-like files exist; inspect native format before mixing into YOLO training",
        }
    suffix_counts = tree_eval.get("suffix_counts", {})
    if isinstance(suffix_counts, dict) and int(suffix_counts.get(".parquet", 0) or 0) > 0:
        return {
            "detector_training": "not_strict_detector_data",
            "classification_training": "usable_after_parquet_export",
            "reason": "parquet files are present, but no true bbox/mask files were found",
        }
    if local_eval.get("image_count", 0) > 0 or tree_eval.get("image_count", 0) > 0:
        return {
            "detector_training": "not_strict_detector_data",
            "classification_training": "usable",
            "auxiliary_detector_training": "possible_with_full_image_pseudo_bbox_for_cropped_images_only",
            "reason": "image labels exist but no true bbox/mask files were found",
        }
    return {
        "detector_training": "not_usable",
        "reason": "no image payload or detector annotation files found",
    }


def has_mask_or_bbox(tree_eval: dict[str, Any]) -> bool:
    examples = " ".join(tree_eval.get("annotation_like_examples", []))
    lowered = examples.lower()
    return any(token in lowered for token in ("bbox", "box", "mask", "seg", "coco", "yolo"))


def write_json(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def write_markdown(path: Path, report: dict[str, Any]) -> None:
    lines = [
        "# Hugging Face Thyroid Dataset Evaluation",
        "",
        f"- Created at: `{report['created_at']}`",
        f"- Endpoint: `{report['endpoint']}`",
        f"- Download requested: `{report['download_requested']}`",
        "",
        "| Dataset | Gated | Files | Images | Downloaded | Detector usability | Reason |",
        "| --- | --- | ---: | ---: | ---: | --- | --- |",
    ]
    for item in report["datasets"]:
        meta = item["metadata"]
        tree = item["tree"]
        download = item["download"]
        usability_info = item["usability"]
        lines.append(
            "| "
            + " | ".join(
                [
                    str(item["candidate"]["repo_id"]),
                    str(meta.get("gated")),
                    str(tree.get("file_count", 0)),
                    str(tree.get("image_count", 0)),
                    str(download.get("files_downloaded", 0)),
                    str(usability_info.get("detector_training")),
                    str(usability_info.get("reason", "")).replace("|", "/"),
                ]
            )
            + " |"
        )
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


if __name__ == "__main__":
    raise SystemExit(main())
