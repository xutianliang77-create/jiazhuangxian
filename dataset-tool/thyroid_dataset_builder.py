#!/usr/bin/env python3
from __future__ import annotations

import argparse
import base64
import csv
import hashlib
import json
import os
import re
import shutil
import struct
import subprocess
import sys
import zipfile
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png"}
VIDEO_EXTENSIONS = {".mp4", ".mov", ".avi", ".mkv", ".wmv", ".mpeg", ".mpg", ".m4v"}
REPORT_EXTENSIONS = {".docx", ".pdf", ".txt", ".md", ".rtf", ".html", ".htm"}
DICOM_EXTENSIONS = {".dcm", ".dicom", ".ima"}
SKIP_NAMES = {".DS_Store", "Thumbs.db"}
DEFAULT_REDACT_REGIONS = [(0.0, 0.0, 1.0, 0.16), (0.0, 0.88, 1.0, 1.0)]
TEXT_REDACTION_PATTERNS = [
    re.compile(r"((?:患者)?姓名|病人姓名|姓名)\s*[:：]?\s*[\u4e00-\u9fffA-Za-z·]{1,20}"),
    re.compile(r"((?:住院|门诊|病案|检查|登记|影像|超声)号)\s*[:：]?\s*[A-Za-z0-9_.\-]{3,40}"),
    re.compile(r"(身份证号?)\s*[:：]?\s*[0-9Xx]{15,18}"),
    re.compile(r"((?:手机号|手机|电话|联系方式))\s*[:：]?\s*(?:\+?86[- ]?)?1[3-9]\d{9}"),
    re.compile(r"(地址)\s*[:：]?\s*[^。\n\r]{4,80}"),
]
BARE_SENSITIVE_PATTERNS = [
    re.compile(r"\b(?:\+?86[- ]?)?1[3-9]\d{9}\b"),
    re.compile(r"\b\d{17}[0-9Xx]\b"),
]
TEXT_FIELD_PATTERNS = {
    "patient_name": [
        re.compile(r"(?:患者姓名|病人姓名|姓名)\s*[:：]?\s*([^\s,，;；。]{1,20})"),
    ],
    "patient_id": [
        re.compile(r"(?:病历号|病案号|门诊号|住院号|患者ID|PatientID|ID)\s*[:：]?\s*([A-Za-z0-9_.\-]{3,40})", re.IGNORECASE),
    ],
    "sex": [
        re.compile(r"(?:性别)\s*[:：]?\s*(男|女|male|female|M|F)", re.IGNORECASE),
    ],
    "birth_year": [
        re.compile(r"(?:出生年|出生日期|出生)\s*[:：]?\s*(19\d{2}|20\d{2})"),
    ],
    "accession_number": [
        re.compile(r"(?:检查号|登记号|影像号|超声号|AccessionNumber|Accession)\s*[:：]?\s*([A-Za-z0-9_.\-]{3,40})", re.IGNORECASE),
    ],
    "study_date": [
        re.compile(r"(?:检查日期|报告日期|日期|StudyDate)\s*[:：]?\s*((?:19|20)\d{2}[-/.年]?\d{1,2}[-/.月]?\d{1,2})", re.IGNORECASE),
    ],
}
DATE_IN_PATH_PATTERN = re.compile(r"(?<!\d)((?:19|20)\d{2})[-_./年]?([01]?\d)[-_./月]?([0-3]?\d)(?!\d)")
TIRADS_PATTERN = re.compile(r"(?:C[- ]?)?TI[- ]?RADS\s*[-:：]?\s*([1-5](?:[abcABC])?)", re.IGNORECASE)
SIZE_PATTERN = re.compile(r"(\d+(?:\.\d+)?)\s*[x×*]\s*(\d+(?:\.\d+)?)(?:\s*[x×*]\s*(\d+(?:\.\d+)?))?\s*(mm|毫米|cm|厘米)", re.IGNORECASE)


@dataclass
class FileRecord:
    file_id: str
    case_id: str
    kind: str
    subtype: str
    source_path: Path | None
    source_relative_path: str
    extension: str
    size_bytes: int
    sha256: str
    target_relative_path: str | None = None
    width: int | None = None
    height: int | None = None
    label: str | None = None
    linked_image_id: str | None = None
    bboxes_xyxy: list[list[float]] = field(default_factory=list)
    shape_count: int = 0
    metadata: dict[str, Any] = field(default_factory=dict)
    warnings: list[str] = field(default_factory=list)
    content_bytes: bytes | None = None
    target_size_bytes: int | None = None
    target_sha256: str | None = None
    deidentified: bool = False
    deidentification_status: str = "not_required"
    source_case_id: str = ""
    patient_key: str | None = None
    study_key: str | None = None
    linkage_confidence: float = 0.0
    linkage_evidence: list[str] = field(default_factory=list)
    clinical_doc_type: str | None = None
    clinical_labels: dict[str, Any] = field(default_factory=dict)
    _identity_fields: dict[str, str] = field(default_factory=dict, repr=False)
    _study_fields: dict[str, str] = field(default_factory=dict, repr=False)


@dataclass
class BuildOptions:
    source_root: Path
    output_dir: Path
    dataset_id: str
    case_mode: str
    copy_mode: str
    case_regex: str | None
    overwrite: bool
    extract_labelme_image_data: bool
    deidentify: str
    redact_regions: list[tuple[float, float, float, float]]
    sensitive_terms: list[str]
    linkage_mode: str
    linkage_salt: str | None
    include_source_paths: bool


def main() -> None:
    options = parse_args(sys.argv[1:])
    summary = build_dataset(options)
    print(json.dumps(summary, ensure_ascii=False, indent=2))


def parse_args(argv: list[str]) -> BuildOptions:
    parser = argparse.ArgumentParser(
        description="Build a standalone thyroid ultrasound dataset from images, JSON labels, reports, and videos."
    )
    parser.add_argument("--source-root", required=True, help="Hard-drive folder that contains raw thyroid materials.")
    parser.add_argument("--output-dir", required=True, help="Dataset folder to create.")
    parser.add_argument("--dataset-id", help="Dataset id. Default: output folder name.")
    parser.add_argument(
        "--case-mode",
        choices=["auto", "first-folder", "parent-folder", "flat"],
        default="auto",
        help="How to infer case ids. Default auto uses the first folder when present.",
    )
    parser.add_argument("--case-regex", help="Regex with named group 'case' or group 1 to extract case id.")
    parser.add_argument(
        "--copy-mode",
        choices=["copy", "symlink", "hardlink", "manifest-only"],
        default="symlink",
        help="How to materialize files. Default symlink avoids duplicating large disks.",
    )
    parser.add_argument("--overwrite", action="store_true", help="Remove output dir before rebuilding.")
    parser.add_argument(
        "--no-extract-labelme-image-data",
        action="store_true",
        help="Do not create images from embedded LabelMe imageData when source images are missing.",
    )
    parser.add_argument(
        "--deidentify",
        choices=["off", "basic"],
        default="basic",
        help="Save de-identified dataset copies. Default basic.",
    )
    parser.add_argument(
        "--redact-region",
        action="append",
        default=[],
        help="Normalized image/video redaction box x1,y1,x2,y2. Can be repeated. Default redacts top 16%% and bottom 12%%.",
    )
    parser.add_argument(
        "--sensitive-term",
        action="append",
        default=[],
        help="Exact patient name or other term to replace in text reports. Can be repeated.",
    )
    parser.add_argument("--sensitive-terms-file", help="One sensitive term per line.")
    parser.add_argument(
        "--linkage-mode",
        choices=["auto", "path", "identity"],
        default="auto",
        help="Case linkage mode. auto uses identity linkage only when a salt is provided.",
    )
    parser.add_argument("--linkage-salt", help="Secret salt for irreversible patient/study linkage hashes.")
    parser.add_argument("--linkage-salt-file", help="File containing secret salt for linkage hashes.")
    parser.add_argument(
        "--include-source-paths",
        action="store_true",
        help="Write raw source paths into manifests. Default hides them because paths may contain PHI.",
    )
    args = parser.parse_args(argv)

    source_root = Path(args.source_root).expanduser().resolve()
    output_dir = Path(args.output_dir).expanduser().resolve()
    if not source_root.is_dir():
        raise SystemExit(f"source root is not a directory: {source_root}")
    dataset_id = safe_id(args.dataset_id or output_dir.name)
    linkage_salt = load_linkage_salt(args.linkage_salt, args.linkage_salt_file)
    if args.linkage_mode == "identity" and not linkage_salt:
        raise SystemExit("--linkage-mode identity requires --linkage-salt, --linkage-salt-file, or THYROID_DATASET_LINKAGE_SALT")
    return BuildOptions(
        source_root=source_root,
        output_dir=output_dir,
        dataset_id=dataset_id,
        case_mode=args.case_mode,
        copy_mode=args.copy_mode,
        case_regex=args.case_regex,
        overwrite=args.overwrite,
        extract_labelme_image_data=not args.no_extract_labelme_image_data,
        deidentify=args.deidentify,
        redact_regions=parse_redact_regions(args.redact_region),
        sensitive_terms=load_sensitive_terms(args.sensitive_term, args.sensitive_terms_file),
        linkage_mode=args.linkage_mode,
        linkage_salt=linkage_salt,
        include_source_paths=args.include_source_paths,
    )


def build_dataset(options: BuildOptions) -> dict[str, Any]:
    if options.output_dir.exists() and options.overwrite:
        shutil.rmtree(options.output_dir)
    options.output_dir.mkdir(parents=True, exist_ok=True)
    (options.output_dir / "metadata").mkdir(parents=True, exist_ok=True)
    (options.output_dir / "cases").mkdir(parents=True, exist_ok=True)

    records = scan_source(options)
    apply_case_linkage(options, records)
    link_annotations_and_extract_embedded_images(options, records)
    assign_targets(records)
    materialize_records(options, records)
    write_case_manifests(options, records)
    write_metadata(options, records)
    write_readme(options, records)
    return dataset_summary(options, records)


def scan_source(options: BuildOptions) -> list[FileRecord]:
    records: list[FileRecord] = []
    for path in sorted(options.source_root.rglob("*")):
        if is_relative_to(path, options.output_dir):
            continue
        if not path.is_file() or should_skip(path):
            continue
        rel = path.relative_to(options.source_root).as_posix()
        case_id = infer_case_id(rel, options)
        kind, subtype, metadata, warnings = classify_file(path)
        if kind == "ignore":
            continue
        context = extract_record_context(path, rel, kind, subtype, metadata)
        digest = sha256_file(path)
        size = path.stat().st_size
        width, height = image_dimensions(path) if kind == "image" else (None, None)
        label = metadata.get("primary_label") if isinstance(metadata.get("primary_label"), str) else None
        bboxes = metadata.get("bboxes_xyxy") if isinstance(metadata.get("bboxes_xyxy"), list) else []
        records.append(
            FileRecord(
                file_id=stable_file_id(kind, digest, rel),
                case_id=case_id,
                kind=kind,
                subtype=subtype,
                source_path=path,
                source_relative_path=rel,
                extension=path.suffix.lower(),
                size_bytes=size,
                sha256=digest,
                source_case_id=case_id,
                width=width,
                height=height,
                label=label,
                bboxes_xyxy=bboxes,
                shape_count=int(metadata.get("shape_count", 0) or 0),
                metadata={**metadata, **context["safe_metadata"]},
                warnings=warnings,
                clinical_doc_type=context["clinical_doc_type"],
                clinical_labels=context["clinical_labels"],
                _identity_fields=context["identity_fields"],
                _study_fields=context["study_fields"],
            )
        )
    return records


def classify_file(path: Path) -> tuple[str, str, dict[str, Any], list[str]]:
    ext = path.suffix.lower()
    warnings: list[str] = []
    if ext in IMAGE_EXTENSIONS:
        if overlay_like_name(path):
            return "image", "review_overlay", {}, ["review_overlay_not_model_input"]
        return "image", "static_image", {}, warnings
    if ext == ".json":
        return classify_json(path)
    if ext in REPORT_EXTENSIONS or report_like_name(path):
        return "report", report_subtype(path), {}, warnings
    if ext in VIDEO_EXTENSIONS:
        return "video", "video_file", {}, warnings
    if ext in DICOM_EXTENSIONS or sniff_dicom(path):
        return classify_dicom(path)
    return "other", "unclassified", {}, warnings


def classify_json(path: Path) -> tuple[str, str, dict[str, Any], list[str]]:
    warnings: list[str] = []
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except UnicodeDecodeError:
        value = json.loads(path.read_text(encoding="utf-8-sig"))
    except Exception as exc:
        return "metadata", "json_unreadable", {"error": str(exc)}, ["json_unreadable"]

    if isinstance(value, dict) and isinstance(value.get("shapes"), list):
        shapes = [shape for shape in value["shapes"] if isinstance(shape, dict)]
        bboxes: list[list[float]] = []
        labels: list[str] = []
        for shape in shapes:
            points = shape.get("points")
            if not valid_points(points):
                warnings.append("labelme_shape_has_invalid_points")
                continue
            labels.append(str(shape.get("label") or "thyroid_nodule"))
            bboxes.append(bbox_from_points(points))
        metadata = {
            "annotation_format": "labelme",
            "image_path": value.get("imagePath"),
            "image_width": value.get("imageWidth"),
            "image_height": value.get("imageHeight"),
            "shape_count": len(shapes),
            "labels": labels,
            "primary_label": labels[0] if labels else None,
            "bboxes_xyxy": bboxes,
            "has_image_data": isinstance(value.get("imageData"), str) and bool(value.get("imageData")),
        }
        if not bboxes:
            warnings.append("labelme_has_no_valid_bbox")
        return "annotation", "labelme", metadata, sorted(set(warnings))

    if report_like_name(path):
        return "report", "json_report", {"json_top_level": json_type_name(value)}, warnings
    return "metadata", "json_metadata", {"json_top_level": json_type_name(value)}, warnings


def classify_dicom(path: Path) -> tuple[str, str, dict[str, Any], list[str]]:
    warnings: list[str] = []
    metadata: dict[str, Any] = {}
    try:
        import pydicom  # type: ignore

        ds = pydicom.dcmread(str(path), stop_before_pixels=True, force=True)
        modality = str(getattr(ds, "Modality", "") or "")
        number_of_frames = int(getattr(ds, "NumberOfFrames", 0) or 0)
        metadata = {
            "modality": modality or None,
            "rows": int(getattr(ds, "Rows", 0) or 0) or None,
            "columns": int(getattr(ds, "Columns", 0) or 0) or None,
            "number_of_frames": number_of_frames or None,
            "cine_rate_fps": numeric_or_none(getattr(ds, "CineRate", None)),
            "frame_time_ms": numeric_or_none(getattr(ds, "FrameTime", None)),
            "pixel_spacing": list(getattr(ds, "PixelSpacing", [])) or None,
            "sop_class_uid": str(getattr(ds, "SOPClassUID", "") or "") or None,
        }
        if modality == "SR":
            return "dicom", "structured_report", metadata, warnings
        if number_of_frames > 1:
            return "dicom", "video", metadata, warnings
        return "dicom", "static", metadata, warnings
    except Exception as exc:
        warnings.append(f"dicom_metadata_unavailable:{type(exc).__name__}")
        return "dicom", "unknown", metadata, warnings


def extract_record_context(path: Path, rel_path: str, kind: str, subtype: str, metadata: dict[str, Any]) -> dict[str, Any]:
    identity_fields: dict[str, str] = {}
    study_fields: dict[str, str] = {}
    clinical_labels: dict[str, Any] = {}
    clinical_doc_type: str | None = None
    safe_metadata: dict[str, Any] = {}

    path_study_date = first_date_in_text(rel_path)
    if path_study_date:
        study_fields["study_date"] = path_study_date

    text = ""
    if kind in {"report", "metadata"}:
        text = extract_text_for_linkage(path)
    elif kind == "dicom":
        identity_fields.update(extract_dicom_identity_fields(path))

    if text:
        identity_fields.update(extract_text_fields(text, ["patient_name", "patient_id", "sex", "birth_year"]))
        study_fields.update(extract_text_fields(text, ["accession_number", "study_date"]))
        clinical_labels = extract_clinical_labels(text)
        clinical_doc_type = classify_clinical_doc_type(path, text)

    if kind == "dicom":
        for key in ["study_instance_uid", "accession_number", "study_date"]:
            value = identity_fields.pop(key, None)
            if value:
                study_fields[key] = value

    if clinical_doc_type:
        safe_metadata["clinical_doc_type"] = clinical_doc_type
    if clinical_labels:
        safe_metadata["clinical_labels"] = clinical_labels
    if identity_fields or study_fields:
        safe_metadata["linkage_field_presence"] = {
            "identity": sorted(identity_fields),
            "study": sorted(study_fields),
        }
    return {
        "identity_fields": normalize_field_map(identity_fields),
        "study_fields": normalize_field_map(study_fields),
        "clinical_labels": clinical_labels,
        "clinical_doc_type": clinical_doc_type,
        "safe_metadata": safe_metadata,
    }


def apply_case_linkage(options: BuildOptions, records: list[FileRecord]) -> None:
    use_identity = options.linkage_mode == "identity" or (options.linkage_mode == "auto" and bool(options.linkage_salt))
    if not use_identity:
        for record in records:
            fallback_key = short_hash(f"path:{options.dataset_id}:{record.source_case_id}", "path")
            record.patient_key = f"pt-path-{fallback_key}"
            record.study_key = f"st-path-{fallback_key}"
            record.case_id = safe_id(record.study_key)
            record.linkage_confidence = 0.4
            record.linkage_evidence = ["path_group_only"]
            record.warnings.append("identity_linkage_not_enabled")
        return

    assert options.linkage_salt
    group_identity = unique_group_fields(records, field_name="_identity_fields")
    group_study = unique_group_fields(records, field_name="_study_fields")
    for record in records:
        identity = {**group_identity.get(record.source_case_id, {}), **record._identity_fields}
        study = {**group_study.get(record.source_case_id, {}), **record._study_fields}
        if not patient_identity_basis(identity):
            record.warnings.append("identity_linkage_missing_patient_fields")
            fallback = short_hash(f"{options.linkage_salt}:path:{record.source_case_id}", "path")
            record.patient_key = f"pt-path-{fallback}"
            record.study_key = f"st-path-{fallback}"
            record.case_id = safe_id(record.study_key)
            record.linkage_confidence = 0.35
            record.linkage_evidence = ["path_fallback_after_missing_identity"]
            continue

        patient_basis = patient_identity_basis(identity)
        study_basis = study_identity_basis(study, record.source_case_id)
        record.patient_key = f"pt-{short_hash(options.linkage_salt + ':patient:' + patient_basis, 'patient')}"
        record.study_key = f"st-{short_hash(options.linkage_salt + ':study:' + record.patient_key + ':' + study_basis, 'study')}"
        record.case_id = safe_id(record.study_key)
        record.linkage_confidence = linkage_confidence(identity, study)
        record.linkage_evidence = linkage_evidence(identity, study, inherited=not bool(record._identity_fields))


def unique_group_fields(records: list[FileRecord], field_name: str) -> dict[str, dict[str, str]]:
    output: dict[str, dict[str, str]] = {}
    by_group: dict[str, list[dict[str, str]]] = {}
    for record in records:
        fields = getattr(record, field_name)
        if fields:
            by_group.setdefault(record.source_case_id, []).append(fields)
    for source_case_id, field_sets in by_group.items():
        merged: dict[str, set[str]] = {}
        for fields in field_sets:
            for key, value in fields.items():
                merged.setdefault(key, set()).add(value)
        unique = {key: next(iter(values)) for key, values in merged.items() if len(values) == 1}
        if unique:
            output[source_case_id] = unique
        if any(len(values) > 1 for values in merged.values()):
            for record in records:
                if record.source_case_id == source_case_id:
                    record.warnings.append("identity_linkage_ambiguous_source_group")
    return output


def patient_identity_basis(fields: dict[str, str]) -> str:
    patient_id = fields.get("patient_id")
    if patient_id:
        return f"patient_id:{patient_id}"
    name = fields.get("patient_name")
    if name:
        return "|".join([f"name:{name}", f"sex:{fields.get('sex', '')}", f"birth_year:{fields.get('birth_year', '')}"])
    return ""


def study_identity_basis(fields: dict[str, str], source_case_id: str) -> str:
    for key in ["study_instance_uid", "accession_number"]:
        if fields.get(key):
            return f"{key}:{fields[key]}"
    if fields.get("study_date"):
        return f"study_date:{fields['study_date']}"
    return f"source_case:{source_case_id}"


def linkage_confidence(identity: dict[str, str], study: dict[str, str]) -> float:
    has_strong_patient = bool(identity.get("patient_id"))
    has_name = bool(identity.get("patient_name"))
    has_strong_study = bool(study.get("study_instance_uid") or study.get("accession_number"))
    has_date = bool(study.get("study_date"))
    if has_strong_patient and has_strong_study:
        return 0.95
    if (has_strong_patient or has_name) and (has_strong_study or has_date):
        return 0.85
    if has_strong_patient or has_name:
        return 0.7
    return 0.4


def linkage_evidence(identity: dict[str, str], study: dict[str, str], *, inherited: bool) -> list[str]:
    evidence = [f"identity:{key}" for key in sorted(identity)]
    evidence.extend(f"study:{key}" for key in sorted(study))
    if inherited:
        evidence.append("inherited_from_unique_source_group")
    return evidence or ["path_group_only"]


def link_annotations_and_extract_embedded_images(options: BuildOptions, records: list[FileRecord]) -> None:
    images_by_case_stem: dict[tuple[str, str], FileRecord] = {}
    for record in records:
        if record.kind == "image":
            stem = source_stem(record).lower()
            images_by_case_stem[(record.case_id, stem)] = record

    new_records: list[FileRecord] = []
    for record in records:
        if record.kind != "annotation" or record.subtype != "labelme":
            continue
        image_path = record.metadata.get("image_path")
        candidates = []
        if isinstance(image_path, str) and image_path:
            candidates.append(Path(image_path).stem.lower())
        candidates.append(source_stem(record).lower())

        linked = next((images_by_case_stem.get((record.case_id, item)) for item in candidates if item), None)
        if linked:
            record.linked_image_id = linked.file_id
            continue

        if not options.extract_labelme_image_data:
            record.warnings.append("annotation_image_not_found")
            continue
        embedded = embedded_image_record(record)
        if embedded is None:
            record.warnings.append("annotation_image_not_found")
            continue
        record.linked_image_id = embedded.file_id
        images_by_case_stem[(embedded.case_id, source_stem(embedded).lower())] = embedded
        new_records.append(embedded)
    records.extend(new_records)


def embedded_image_record(annotation: FileRecord) -> FileRecord | None:
    if not annotation.source_path:
        return None
    try:
        raw = json.loads(annotation.source_path.read_text(encoding="utf-8"))
    except Exception:
        return None
    image_data = raw.get("imageData") if isinstance(raw, dict) else None
    if not isinstance(image_data, str) or not image_data:
        return None
    try:
        content = base64.b64decode(image_data)
    except Exception:
        annotation.warnings.append("labelme_image_data_decode_failed")
        return None
    ext = extension_from_image_bytes(content) or ".png"
    width, height = image_dimensions_from_bytes(content)
    digest = hashlib.sha256(content).hexdigest()
    source_rel = f"{annotation.source_relative_path}#imageData"
    return FileRecord(
        file_id=stable_file_id("image", digest, source_rel),
        case_id=annotation.case_id,
        kind="image",
        subtype="labelme_embedded_image",
        source_path=None,
        source_relative_path=source_rel,
        extension=ext,
        size_bytes=len(content),
        sha256=digest,
        width=width,
        height=height,
        metadata={"embedded_from_annotation_id": annotation.file_id},
        warnings=["image_extracted_from_labelme_imageData"],
        content_bytes=content,
        source_case_id=annotation.source_case_id,
        patient_key=annotation.patient_key,
        study_key=annotation.study_key,
        linkage_confidence=annotation.linkage_confidence,
        linkage_evidence=annotation.linkage_evidence.copy(),
    )


def assign_targets(records: list[FileRecord]) -> None:
    used: set[str] = set()
    for record in sorted(records, key=lambda item: (item.case_id, item.kind, item.source_relative_path)):
        folder = target_folder(record)
        ext = record.extension or Path(record.source_relative_path).suffix.lower()
        name = f"{record.file_id}{ext}" if ext else record.file_id
        rel = f"cases/{safe_component(record.case_id)}/{folder}/{name}"
        index = 2
        candidate = rel
        while candidate in used:
            stem = Path(name).stem
            suffix = Path(name).suffix
            candidate = f"cases/{safe_component(record.case_id)}/{folder}/{stem}_{index}{suffix}"
            index += 1
        used.add(candidate)
        record.target_relative_path = candidate


def materialize_records(options: BuildOptions, records: list[FileRecord]) -> None:
    if options.copy_mode == "manifest-only":
        return
    for record in records:
        if not record.target_relative_path:
            continue
        target = options.output_dir / record.target_relative_path
        target.parent.mkdir(parents=True, exist_ok=True)
        if should_deidentify_record(options, record):
            deidentify_record(options, record, target)
        else:
            if record.content_bytes is not None:
                target.write_bytes(record.content_bytes)
                record.deidentification_status = "off_embedded_copy"
                record_target_stats(record, target)
                continue
            if not record.source_path:
                record.warnings.append("source_path_missing")
                continue
            materialize_file(record.source_path, target, options.copy_mode)
            record.deidentification_status = "not_required"
        record_target_stats(record, target)


def materialize_file(source: Path, target: Path, copy_mode: str) -> None:
    if target.exists() or target.is_symlink():
        target.unlink()
    if copy_mode == "copy":
        shutil.copy2(source, target)
    elif copy_mode == "symlink":
        os.symlink(source, target)
    elif copy_mode == "hardlink":
        os.link(source, target)
    else:
        raise ValueError(f"unknown copy mode: {copy_mode}")


def should_deidentify_record(options: BuildOptions, record: FileRecord) -> bool:
    if options.deidentify == "off":
        return False
    return record.kind in {"image", "report", "video", "dicom", "annotation", "metadata", "other"}


def deidentify_record(options: BuildOptions, record: FileRecord, target: Path) -> None:
    if target.exists() or target.is_symlink():
        target.unlink()
    try:
        if record.content_bytes is not None and record.kind == "image":
            redacted = deidentify_image_bytes(record.content_bytes, record.extension, options.redact_regions)
            target.write_bytes(redacted)
            record.deidentified = True
            record.deidentification_status = "image_region_redacted"
            return
        if not record.source_path:
            raise ValueError("source path is missing")
        if record.kind == "image":
            deidentify_image_file(record.source_path, target, options.redact_regions)
            record.deidentified = True
            record.deidentification_status = "image_region_redacted"
        elif record.kind == "video":
            deidentify_video_file(record.source_path, target, options.redact_regions)
            record.deidentified = True
            record.deidentification_status = "video_region_redacted"
        elif record.kind == "report":
            deidentify_report_file(record.source_path, target, record_sensitive_terms(options, record))
            record.deidentified = True
            record.deidentification_status = "text_report_redacted"
        elif record.kind == "annotation" and record.subtype == "labelme":
            deidentify_labelme_json(record.source_path, target, record_sensitive_terms(options, record))
            record.deidentified = True
            record.deidentification_status = "labelme_json_redacted"
        elif record.kind == "metadata" and record.extension == ".json":
            deidentify_json_text_file(record.source_path, target, record_sensitive_terms(options, record))
            record.deidentified = True
            record.deidentification_status = "json_text_redacted"
        elif record.kind == "dicom":
            deidentify_dicom_file(record.source_path, target)
            record.deidentified = True
            record.deidentification_status = "dicom_tags_redacted"
            record.warnings.append("dicom_pixel_burned_in_text_not_redacted_by_basic_mode")
        else:
            record.warnings.append("unsupported_file_not_materialized_in_deidentified_dataset")
            record.deidentification_status = "unsupported_not_materialized"
    except Exception as exc:
        record.warnings.append(f"deidentify_failed:{type(exc).__name__}")
        if target.exists() or target.is_symlink():
            target.unlink()
        record.deidentified = False
        record.deidentification_status = "failed_not_materialized"


def record_target_stats(record: FileRecord, target: Path) -> None:
    if not target.exists():
        return
    record.target_size_bytes = target.stat().st_size
    record.target_sha256 = sha256_file(target)


def record_sensitive_terms(options: BuildOptions, record: FileRecord) -> list[str]:
    terms = list(options.sensitive_terms)
    for key, value in list(record._identity_fields.items()) + list(record._study_fields.items()):
        min_length = 2 if key == "patient_name" else 3
        if len(value) >= min_length and value.lower() not in {"male", "female"}:
            terms.append(value)
    return sorted(set(terms), key=len, reverse=True)


def deidentify_image_file(source: Path, target: Path, regions: list[tuple[float, float, float, float]]) -> None:
    try:
        from PIL import Image, ImageDraw  # type: ignore
    except Exception as exc:
        raise RuntimeError("Pillow is required for image de-identification") from exc
    with Image.open(source) as image:
        redacted = redact_image(image, regions)
        save_image(redacted, target)


def deidentify_image_bytes(content: bytes, extension: str, regions: list[tuple[float, float, float, float]]) -> bytes:
    try:
        from io import BytesIO
        from PIL import Image  # type: ignore
    except Exception as exc:
        raise RuntimeError("Pillow is required for embedded image de-identification") from exc
    source = BytesIO(content)
    with Image.open(source) as image:
        redacted = redact_image(image, regions)
        output = BytesIO()
        fmt = "JPEG" if extension.lower() in {".jpg", ".jpeg"} else "PNG"
        if fmt == "JPEG":
            redacted = redacted.convert("RGB")
        redacted.save(output, format=fmt)
        return output.getvalue()


def redact_image(image: Any, regions: list[tuple[float, float, float, float]]) -> Any:
    from PIL import ImageDraw  # type: ignore

    redacted = image.copy()
    if redacted.mode not in {"RGB", "RGBA", "L"}:
        redacted = redacted.convert("RGB")
    draw = ImageDraw.Draw(redacted)
    width, height = redacted.size
    fill = 0 if redacted.mode == "L" else (0, 0, 0, 255) if redacted.mode == "RGBA" else (0, 0, 0)
    for region in regions:
        x1, y1, x2, y2 = normalized_region_to_pixels(region, width, height)
        if x2 > x1 and y2 > y1:
            draw.rectangle([x1, y1, x2, y2], fill=fill)
    return redacted


def save_image(image: Any, target: Path) -> None:
    suffix = target.suffix.lower()
    if suffix in {".jpg", ".jpeg"}:
        image.convert("RGB").save(target, format="JPEG", quality=95)
    else:
        image.save(target, format="PNG")


def normalized_region_to_pixels(region: tuple[float, float, float, float], width: int, height: int) -> tuple[int, int, int, int]:
    x1, y1, x2, y2 = region
    return (
        max(0, min(width, int(round(x1 * width)))),
        max(0, min(height, int(round(y1 * height)))),
        max(0, min(width, int(round(x2 * width)))),
        max(0, min(height, int(round(y2 * height)))),
    )


def deidentify_video_file(source: Path, target: Path, regions: list[tuple[float, float, float, float]]) -> None:
    ffmpeg = shutil.which("ffmpeg")
    if not ffmpeg:
        raise RuntimeError("ffmpeg is required for video de-identification")
    filters = []
    for region in regions:
        x1, y1, x2, y2 = region
        filters.append(
            "drawbox="
            f"x=iw*{x1:.6f}:"
            f"y=ih*{y1:.6f}:"
            f"w=iw*{max(0.0, x2 - x1):.6f}:"
            f"h=ih*{max(0.0, y2 - y1):.6f}:"
            "color=black@1:t=fill"
        )
    vf = ",".join(filters) if filters else "null"
    command = [
        ffmpeg,
        "-y",
        "-i",
        str(source),
        "-vf",
        vf,
        "-map_metadata",
        "-1",
        "-an",
        "-c:v",
        "libx264",
        "-crf",
        "18",
        "-preset",
        "veryfast",
        "-pix_fmt",
        "yuv420p",
        str(target),
    ]
    completed = subprocess.run(command, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    if completed.returncode != 0:
        raise RuntimeError(f"ffmpeg failed: {completed.stderr[-500:]}")


def deidentify_report_file(source: Path, target: Path, sensitive_terms: list[str]) -> None:
    ext = source.suffix.lower()
    if ext == ".docx":
        deidentify_docx(source, target, sensitive_terms)
    elif ext in {".txt", ".md", ".rtf", ".html", ".htm", ".json"}:
        text = read_text_best_effort(source)
        target.write_text(redact_text(text, sensitive_terms), encoding="utf-8")
    elif ext == ".pdf":
        shutil.copy2(source, target)
        raise RuntimeError("PDF text redaction is not supported by this standalone tool")
    else:
        text = read_text_best_effort(source)
        target.write_text(redact_text(text, sensitive_terms), encoding="utf-8")


def deidentify_docx(source: Path, target: Path, sensitive_terms: list[str]) -> None:
    with zipfile.ZipFile(source, "r") as src, zipfile.ZipFile(target, "w", compression=zipfile.ZIP_DEFLATED) as dst:
        for item in src.infolist():
            data = src.read(item.filename)
            if item.filename.startswith(("word/", "docProps/")) and item.filename.endswith(".xml"):
                try:
                    text = data.decode("utf-8")
                    data = redact_text(text, sensitive_terms).encode("utf-8")
                except UnicodeDecodeError:
                    pass
            dst.writestr(item, data)


def deidentify_labelme_json(source: Path, target: Path, sensitive_terms: list[str]) -> None:
    raw = json.loads(read_text_best_effort(source))
    if isinstance(raw, dict):
        raw["imageData"] = None
        raw["imagePath"] = redact_text(str(raw.get("imagePath", "")), sensitive_terms) if raw.get("imagePath") else raw.get("imagePath")
        for key in ["description", "flags"]:
            if isinstance(raw.get(key), str):
                raw[key] = redact_text(raw[key], sensitive_terms)
        raw.setdefault("deidentification", {})
        raw["deidentification"] = {
            **(raw["deidentification"] if isinstance(raw.get("deidentification"), dict) else {}),
            "imageData": "removed",
            "text": "basic_regex_redacted",
        }
    write_json(target, raw)


def deidentify_json_text_file(source: Path, target: Path, sensitive_terms: list[str]) -> None:
    value = json.loads(read_text_best_effort(source))
    write_json(target, redact_json_value(value, sensitive_terms))


def deidentify_dicom_file(source: Path, target: Path) -> None:
    try:
        import pydicom  # type: ignore
    except Exception as exc:
        raise RuntimeError("pydicom is required for DICOM tag de-identification") from exc
    ds = pydicom.dcmread(str(source), force=True)
    ds.remove_private_tags()
    for attr in [
        "PatientName",
        "PatientID",
        "PatientBirthDate",
        "PatientAddress",
        "PatientTelephoneNumbers",
        "OtherPatientIDs",
        "OtherPatientNames",
        "InstitutionAddress",
        "ReferringPhysicianName",
        "PerformingPhysicianName",
        "OperatorsName",
        "AccessionNumber",
    ]:
        if hasattr(ds, attr):
            setattr(ds, attr, "ANONYMIZED")
    ds.save_as(str(target))


def redact_json_value(value: Any, sensitive_terms: list[str]) -> Any:
    if isinstance(value, str):
        return redact_text(value, sensitive_terms)
    if isinstance(value, list):
        return [redact_json_value(item, sensitive_terms) for item in value]
    if isinstance(value, dict):
        output = {}
        for key, item in value.items():
            if sensitive_key(str(key)):
                output[key] = "[已脱敏]"
            else:
                output[key] = redact_json_value(item, sensitive_terms)
        return output
    return value


def redact_text(text: str, sensitive_terms: list[str]) -> str:
    redacted = text
    for term in sensitive_terms:
        if term:
            redacted = redacted.replace(term, "[已脱敏]")
    for pattern in TEXT_REDACTION_PATTERNS:
        redacted = pattern.sub(lambda match: f"{match.group(1)}：[已脱敏]", redacted)
    for pattern in BARE_SENSITIVE_PATTERNS:
        redacted = pattern.sub("[已脱敏]", redacted)
    return redacted


def sensitive_key(key: str) -> bool:
    lowered = key.lower()
    return any(
        token in lowered or token in key
        for token in ["name", "patient", "phone", "mobile", "idcard", "address", "姓名", "电话", "手机", "身份证", "地址"]
    )


def read_text_best_effort(path: Path) -> str:
    for encoding in ["utf-8", "utf-8-sig", "gb18030", "latin-1"]:
        try:
            return path.read_text(encoding=encoding)
        except UnicodeDecodeError:
            continue
    return path.read_bytes().decode("utf-8", errors="replace")


def extract_text_for_linkage(path: Path) -> str:
    ext = path.suffix.lower()
    try:
        if ext == ".docx":
            return extract_docx_text(path)
        if ext in {".txt", ".md", ".rtf", ".html", ".htm", ".json"}:
            return read_text_best_effort(path)
    except Exception:
        return ""
    return ""


def extract_docx_text(path: Path) -> str:
    parts: list[str] = []
    with zipfile.ZipFile(path, "r") as archive:
        for name in archive.namelist():
            if name.startswith(("word/", "docProps/")) and name.endswith(".xml"):
                try:
                    text = archive.read(name).decode("utf-8")
                except UnicodeDecodeError:
                    continue
                parts.append(re.sub(r"<[^>]+>", " ", text))
    return "\n".join(parts)


def extract_dicom_identity_fields(path: Path) -> dict[str, str]:
    try:
        import pydicom  # type: ignore

        ds = pydicom.dcmread(str(path), stop_before_pixels=True, force=True)
    except Exception:
        return {}
    fields = {
        "patient_name": str(getattr(ds, "PatientName", "") or ""),
        "patient_id": str(getattr(ds, "PatientID", "") or ""),
        "sex": str(getattr(ds, "PatientSex", "") or ""),
        "birth_year": str(getattr(ds, "PatientBirthDate", "") or "")[:4],
        "study_date": str(getattr(ds, "StudyDate", "") or ""),
        "accession_number": str(getattr(ds, "AccessionNumber", "") or ""),
        "study_instance_uid": str(getattr(ds, "StudyInstanceUID", "") or ""),
    }
    return normalize_field_map(fields)


def extract_text_fields(text: str, keys: list[str]) -> dict[str, str]:
    fields: dict[str, str] = {}
    for key in keys:
        for pattern in TEXT_FIELD_PATTERNS.get(key, []):
            match = pattern.search(text)
            if match:
                value = normalize_field_value(match.group(1))
                if value:
                    fields[key] = normalize_date(value) if key == "study_date" else value
                    break
    if "study_date" not in fields:
        date = first_date_in_text(text)
        if date:
            fields["study_date"] = date
    return fields


def extract_clinical_labels(text: str) -> dict[str, Any]:
    labels: dict[str, Any] = {}
    tirads = TIRADS_PATTERN.search(text)
    if tirads:
        labels["tirads_reported"] = f"TI-RADS {tirads.group(1).upper()}"
    sizes = []
    for match in SIZE_PATTERN.finditer(text):
        values = [float(item) for item in match.groups()[:3] if item]
        unit = match.group(4).lower()
        if unit in {"cm", "厘米"}:
            values = [round(item * 10, 3) for item in values]
        sizes.append({"axes_mm": values})
    if sizes:
        labels["nodule_sizes"] = sizes[:5]
    malignant_tokens = ["乳头状癌", "滤泡癌", "髓样癌", "未分化癌", "恶性", "癌"]
    benign_tokens = ["良性", "腺瘤", "结节性甲状腺肿", "桥本", "囊肿"]
    if any(token in text for token in malignant_tokens):
        labels["malignancy_status"] = "malignant"
    elif any(token in text for token in benign_tokens):
        labels["malignancy_status"] = "benign"
    if "随访" in text:
        labels["followup_mentioned"] = True
    return labels


def classify_clinical_doc_type(path: Path, text: str) -> str:
    value = f"{path.name}\n{text[:500]}"
    if any(token in value for token in ["病理", "穿刺", "活检", "手术记录"]):
        return "pathology"
    if "随访" in value:
        return "followup"
    if any(token in value for token in ["超声", "TI-RADS", "TIRADS", "甲状腺"]):
        return "ultrasound_report"
    return "clinical_report"


def normalize_field_map(fields: dict[str, str]) -> dict[str, str]:
    output = {}
    for key, value in fields.items():
        normalized = normalize_field_value(value)
        if not normalized or normalized.upper() in {"ANONYMIZED", "UNKNOWN", "NONE"}:
            continue
        output[key] = normalize_date(normalized) if key in {"study_date"} else normalized
    return output


def normalize_field_value(value: str) -> str:
    return re.sub(r"\s+", "", str(value).strip())


def first_date_in_text(text: str) -> str | None:
    match = DATE_IN_PATH_PATTERN.search(text)
    if not match:
        return None
    return normalize_date("".join(match.groups()))


def normalize_date(value: str) -> str:
    digits = re.sub(r"\D", "", value)
    if len(digits) >= 8:
        return digits[:8]
    return value


def short_hash(value: str, namespace: str) -> str:
    return hashlib.sha256(f"{namespace}:{value}".encode("utf-8")).hexdigest()[:16]


def write_case_manifests(options: BuildOptions, records: list[FileRecord]) -> None:
    for case_id in sorted({record.case_id for record in records}):
        case_records = [record for record in records if record.case_id == case_id]
        case_dir = options.output_dir / "cases" / safe_component(case_id)
        case_dir.mkdir(parents=True, exist_ok=True)
        manifest = case_manifest(options, case_id, case_records)
        write_json(case_dir / "case.json", manifest)


def write_metadata(options: BuildOptions, records: list[FileRecord]) -> None:
    metadata_dir = options.output_dir / "metadata"
    write_json(metadata_dir / "dataset.json", dataset_summary(options, records))
    write_jsonl(metadata_dir / "cases.jsonl", [case_manifest(options, case_id, [r for r in records if r.case_id == case_id]) for case_id in sorted({r.case_id for r in records})])
    write_jsonl(metadata_dir / "images.jsonl", [record_to_manifest_row(options, r) for r in records if r.kind == "image"])
    write_jsonl(metadata_dir / "annotations.jsonl", [record_to_manifest_row(options, r) for r in records if r.kind == "annotation"])
    write_jsonl(metadata_dir / "reports.jsonl", [record_to_manifest_row(options, r) for r in records if r.kind == "report"])
    write_jsonl(metadata_dir / "videos.jsonl", [record_to_manifest_row(options, r) for r in records if r.kind in {"video", "dicom"} and r.subtype in {"video", "video_file"}])
    write_jsonl(metadata_dir / "clinical_labels.jsonl", clinical_label_rows(options, records))
    write_jsonl(metadata_dir / "report_pair_manifest.jsonl", report_pair_manifest_rows(options, records))
    write_jsonl(metadata_dir / "tirads_manifest.jsonl", tirads_manifest_rows(options, records))
    write_jsonl(metadata_dir / "classification_manifest.jsonl", classification_manifest_rows(options, records))
    write_jsonl(metadata_dir / "warnings.jsonl", warning_rows(options, records))
    write_jsonl(metadata_dir / "detection_manifest.jsonl", detection_manifest_rows(options, records))
    write_file_manifest_csv(options, metadata_dir / "file_manifest.csv", records)


def case_manifest(options: BuildOptions, case_id: str, records: list[FileRecord]) -> dict[str, Any]:
    images = [r for r in records if r.kind == "image"]
    annotations = [r for r in records if r.kind == "annotation"]
    image_by_id = {r.file_id: r for r in images}
    static_images = []
    for image in images:
        linked_annotations = [item for item in annotations if item.linked_image_id == image.file_id]
        boxes = [box for item in linked_annotations for box in item.bboxes_xyxy]
        static_images.append(
            {
                "image_id": image.file_id,
                "path": image.target_relative_path,
                "source_reference": safe_source_reference(options, image),
                "source_reference_hash": source_reference_hash(options, image),
                "width": image.width,
                "height": image.height,
                "patient_key": image.patient_key,
                "study_key": image.study_key,
                "linkage_confidence": image.linkage_confidence,
                "linkage_evidence": image.linkage_evidence,
                "annotation_paths": [item.target_relative_path for item in linked_annotations],
                "bboxes_xyxy": boxes,
                "primary_use": primary_use_for_image(image, linked_annotations),
            }
        )
    return {
        "schema_version": "thyroid.dataset_case.v1",
        "dataset_id": options.dataset_id,
        "case_id": case_id,
        "patient_key": first_non_empty([r.patient_key for r in records]),
        "study_key": first_non_empty([r.study_key for r in records]),
        "linkage_confidence": min([r.linkage_confidence for r in records], default=0.0),
        "linkage_evidence": sorted({item for record in records for item in record.linkage_evidence}),
        "generated_at": now_iso(),
        "source_root": str(options.source_root) if options.include_source_paths else "[redacted]",
        "clinical_labels": aggregate_clinical_labels(records),
        "static_images": static_images,
        "annotations": [record_to_manifest_row(options, r) for r in annotations],
        "reports": [record_to_manifest_row(options, r) for r in records if r.kind == "report"],
        "videos": [record_to_manifest_row(options, r) for r in records if r.kind == "video"],
        "dicom_static": [record_to_manifest_row(options, r) for r in records if r.kind == "dicom" and r.subtype == "static"],
        "dicom_video": [record_to_manifest_row(options, r) for r in records if r.kind == "dicom" and r.subtype == "video"],
        "structured_report_assets": [
            record_to_manifest_row(options, r)
            for r in records
            if (r.kind == "dicom" and r.subtype == "structured_report") or r.kind == "report"
        ],
        "quality_and_limitations": case_limitations(records, image_by_id),
    }


def dataset_summary(options: BuildOptions, records: list[FileRecord]) -> dict[str, Any]:
    counts: dict[str, int] = {}
    subtype_counts: dict[str, int] = {}
    for record in records:
        counts[record.kind] = counts.get(record.kind, 0) + 1
        key = f"{record.kind}:{record.subtype}"
        subtype_counts[key] = subtype_counts.get(key, 0) + 1
    return {
        "schema_version": "thyroid.standalone_dataset.v1",
        "dataset_id": options.dataset_id,
        "generated_at": now_iso(),
        "source_root": str(options.source_root) if options.include_source_paths else "[redacted]",
        "output_dir": str(options.output_dir),
        "copy_mode": options.copy_mode,
        "deidentify": options.deidentify,
        "redact_regions": options.redact_regions,
        "linkage_mode": resolved_linkage_mode(options),
        "include_source_paths": options.include_source_paths,
        "case_mode": options.case_mode,
        "case_count": len({record.case_id for record in records}),
        "file_count": len(records),
        "counts": counts,
        "subtype_counts": subtype_counts,
        "manifests": {
            "file_manifest_csv": "metadata/file_manifest.csv",
            "cases_jsonl": "metadata/cases.jsonl",
            "images_jsonl": "metadata/images.jsonl",
            "annotations_jsonl": "metadata/annotations.jsonl",
            "reports_jsonl": "metadata/reports.jsonl",
            "videos_jsonl": "metadata/videos.jsonl",
            "clinical_labels_jsonl": "metadata/clinical_labels.jsonl",
            "report_pair_manifest_jsonl": "metadata/report_pair_manifest.jsonl",
            "tirads_manifest_jsonl": "metadata/tirads_manifest.jsonl",
            "classification_manifest_jsonl": "metadata/classification_manifest.jsonl",
            "detection_manifest_jsonl": "metadata/detection_manifest.jsonl",
            "warnings_jsonl": "metadata/warnings.jsonl",
        },
    }


def detection_manifest_rows(options: BuildOptions, records: list[FileRecord]) -> list[dict[str, Any]]:
    images = {record.file_id: record for record in records if record.kind == "image"}
    rows: list[dict[str, Any]] = []
    for annotation in records:
        if annotation.kind != "annotation" or not annotation.linked_image_id or not annotation.bboxes_xyxy:
            continue
        image = images.get(annotation.linked_image_id)
        if not image or not image.width or not image.height or not image.target_relative_path:
            continue
        labels = annotation.metadata.get("labels") if isinstance(annotation.metadata.get("labels"), list) else []
        rows.append(
            {
                "dataset_id": options.dataset_id,
                "case_id": image.case_id,
                "image_id": image.file_id,
                "image_path": str(options.output_dir / image.target_relative_path),
                "annotation_path": str(options.output_dir / annotation.target_relative_path) if annotation.target_relative_path else None,
                "source_image_reference": safe_source_reference(options, image),
                "source_image_reference_hash": source_reference_hash(options, image),
                "source_annotation_reference": safe_source_reference(options, annotation),
                "source_annotation_reference_hash": source_reference_hash(options, annotation),
                "patient_key": image.patient_key,
                "study_key": image.study_key,
                "linkage_confidence": image.linkage_confidence,
                "width": image.width,
                "height": image.height,
                "bbox_xyxy": annotation.bboxes_xyxy[0],
                "bboxes_xyxy": annotation.bboxes_xyxy,
                "labels": labels,
                "yolo_class_ids": [0 for _ in annotation.bboxes_xyxy],
                "yolo_class_names": ["thyroid_nodule"],
                "split": "clinical_source",
                "fixed_training_split": None,
                "deidentified": image.deidentified,
                "deidentification_status": image.deidentification_status,
            }
        )
    return rows


def clinical_label_rows(options: BuildOptions, records: list[FileRecord]) -> list[dict[str, Any]]:
    rows = []
    for case_id in sorted({record.case_id for record in records}):
        case_records = [record for record in records if record.case_id == case_id]
        labels = aggregate_clinical_labels(case_records)
        if not labels:
            continue
        rows.append(
            {
                "dataset_id": options.dataset_id,
                "case_id": case_id,
                "patient_key": first_non_empty([record.patient_key for record in case_records]),
                "study_key": first_non_empty([record.study_key for record in case_records]),
                "clinical_labels": labels,
                "label_sources": [
                    {
                        "file_id": record.file_id,
                        "doc_type": record.clinical_doc_type,
                        "source_reference": safe_source_reference(options, record),
                        "source_reference_hash": source_reference_hash(options, record),
                    }
                    for record in case_records
                    if record.clinical_labels
                ],
            }
        )
    return rows


def report_pair_manifest_rows(options: BuildOptions, records: list[FileRecord]) -> list[dict[str, Any]]:
    rows = []
    for case_id in sorted({record.case_id for record in records}):
        case_records = [record for record in records if record.case_id == case_id]
        image_ids = [record.file_id for record in case_records if record.kind in {"image", "video", "dicom"}]
        reports = [record for record in case_records if record.kind == "report" or record.clinical_doc_type]
        for report in reports:
            rows.append(
                {
                    "dataset_id": options.dataset_id,
                    "case_id": case_id,
                    "patient_key": report.patient_key,
                    "study_key": report.study_key,
                    "report_id": report.file_id,
                    "report_path": report.target_relative_path,
                    "doc_type": report.clinical_doc_type or report.subtype,
                    "paired_asset_ids": image_ids,
                    "linkage_confidence": report.linkage_confidence,
                    "linkage_evidence": report.linkage_evidence,
                    "clinical_labels": report.clinical_labels,
                }
            )
    return rows


def tirads_manifest_rows(options: BuildOptions, records: list[FileRecord]) -> list[dict[str, Any]]:
    rows = []
    for row in clinical_label_rows(options, records):
        labels = row.get("clinical_labels", {})
        if isinstance(labels, dict) and labels.get("tirads_reported"):
            rows.append(
                {
                    "dataset_id": options.dataset_id,
                    "case_id": row["case_id"],
                    "patient_key": row["patient_key"],
                    "study_key": row["study_key"],
                    "tirads_reported": labels["tirads_reported"],
                    "nodule_sizes": labels.get("nodule_sizes", []),
                    "label_sources": row["label_sources"],
                    "status": "requires_doctor_review",
                }
            )
    return rows


def classification_manifest_rows(options: BuildOptions, records: list[FileRecord]) -> list[dict[str, Any]]:
    rows = []
    for row in clinical_label_rows(options, records):
        labels = row.get("clinical_labels", {})
        if isinstance(labels, dict) and labels.get("malignancy_status"):
            rows.append(
                {
                    "dataset_id": options.dataset_id,
                    "case_id": row["case_id"],
                    "patient_key": row["patient_key"],
                    "study_key": row["study_key"],
                    "malignancy_status": labels["malignancy_status"],
                    "label_sources": row["label_sources"],
                    "status": "requires_doctor_review",
                }
            )
    return rows


def write_file_manifest_csv(options: BuildOptions, path: Path, records: list[FileRecord]) -> None:
    columns = [
        "case_id",
        "patient_key",
        "study_key",
        "linkage_confidence",
        "file_id",
        "kind",
        "subtype",
        "relative_path",
        "source_reference",
        "source_reference_hash",
        "extension",
        "bytes",
        "sha256",
        "target_bytes",
        "target_sha256",
        "width",
        "height",
        "deidentified",
        "deidentification_status",
        "linked_image_id",
        "label",
        "bbox_count",
        "warnings",
    ]
    with path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=columns)
        writer.writeheader()
        for record in records:
            writer.writerow(
                {
                    "case_id": record.case_id,
                    "patient_key": record.patient_key or "",
                    "study_key": record.study_key or "",
                    "linkage_confidence": record.linkage_confidence,
                    "file_id": record.file_id,
                    "kind": record.kind,
                    "subtype": record.subtype,
                    "relative_path": record.target_relative_path or "",
                    "source_reference": safe_source_reference(options, record),
                    "source_reference_hash": source_reference_hash(options, record),
                    "extension": record.extension,
                    "bytes": record.size_bytes,
                    "sha256": record.sha256,
                    "target_bytes": record.target_size_bytes or "",
                    "target_sha256": record.target_sha256 or "",
                    "width": record.width or "",
                    "height": record.height or "",
                    "deidentified": "true" if record.deidentified else "false",
                    "deidentification_status": record.deidentification_status,
                    "linked_image_id": record.linked_image_id or "",
                    "label": record.label or "",
                    "bbox_count": len(record.bboxes_xyxy),
                    "warnings": "|".join(sorted(set(record.warnings))),
                }
            )


def write_readme(options: BuildOptions, records: list[FileRecord]) -> None:
    summary = dataset_summary(options, records)
    lines = [
        f"# {options.dataset_id}",
        "",
        "本数据集由 `thyroid_dataset_builder.py` 生成。",
        "",
        "## 目录",
        "",
        "- `cases/<case_id>/case.json`：病例级 manifest。",
        "- `metadata/file_manifest.csv`：全部发现文件的清单。",
        "- `metadata/detection_manifest.jsonl`：带 bbox 标注的脱敏图片，可供检测训练脚本使用。",
        "- `metadata/report_pair_manifest.jsonl`：图像/视频和报告配对清单。",
        "- `metadata/tirads_manifest.jsonl`：报告抽取到的 TI-RADS 标签，需医生复核。",
        "- `metadata/classification_manifest.jsonl`：报告/病理/随访抽取到的良恶性标签，需医生复核。",
        "- `metadata/warnings.jsonl`：需要人工复核的问题。",
        "",
        "## 数量",
        "",
    ]
    for key, value in sorted(summary["subtype_counts"].items()):
        lines.append(f"- `{key}`: {value}")
    lines.extend(
        [
            "",
            "## 安全说明",
            "",
            "- 原始硬盘目录只读，本工具不会移动、覆盖、重命名或修改源文件。",
            "- 默认 `--deidentify basic` 下，输出文件是脱敏副本；无法安全脱敏的文件不会落入数据集目录。",
            "- 默认不输出原始源路径；如需调试源路径，必须显式使用 `--include-source-paths`。",
            "- 病例关联输出 `patient_key`、`study_key` 和 `case_id`，不输出姓名、病历号、检查号等原始身份字段。",
            "- 图片和视频脱敏使用可配置黑框遮盖，请共享或训练前抽查输出样本。",
            "- 文本报告脱敏使用正则和敏感词替换，请结合 `warnings.jsonl` 人工复核。",
            "- 带勾画/marked/overlay 的图片仅用于医生复核，不作为模型输入。",
            "- 毫米测量需要 DICOM PixelSpacing 或人工标定尺。",
            "",
        ]
    )
    (options.output_dir / "README.md").write_text("\n".join(lines), encoding="utf-8")


def record_to_manifest_row(options: BuildOptions, record: FileRecord) -> dict[str, Any]:
    return {
        "file_id": record.file_id,
        "case_id": record.case_id,
        "patient_key": record.patient_key,
        "study_key": record.study_key,
        "linkage_confidence": record.linkage_confidence,
        "linkage_evidence": record.linkage_evidence,
        "kind": record.kind,
        "subtype": record.subtype,
        "path": record.target_relative_path,
        "source_reference": safe_source_reference(options, record),
        "source_reference_hash": source_reference_hash(options, record),
        "extension": record.extension,
        "bytes": record.size_bytes,
        "sha256": record.sha256,
        "target_bytes": record.target_size_bytes,
        "target_sha256": record.target_sha256,
        "width": record.width,
        "height": record.height,
        "deidentified": record.deidentified,
        "deidentification_status": record.deidentification_status,
        "label": record.label,
        "linked_image_id": record.linked_image_id,
        "bboxes_xyxy": record.bboxes_xyxy,
        "clinical_doc_type": record.clinical_doc_type,
        "clinical_labels": record.clinical_labels,
        "metadata": record.metadata,
        "warnings": sorted(set(record.warnings)),
    }


def warning_rows(options: BuildOptions, records: list[FileRecord]) -> list[dict[str, Any]]:
    rows = []
    for record in records:
        for warning in sorted(set(record.warnings)):
            rows.append(
                {
                    "case_id": record.case_id,
                    "patient_key": record.patient_key,
                    "study_key": record.study_key,
                    "file_id": record.file_id,
                    "kind": record.kind,
                    "subtype": record.subtype,
                    "source_reference": safe_source_reference(options, record),
                    "source_reference_hash": source_reference_hash(options, record),
                    "warning": warning,
                }
            )
    return rows


def case_limitations(records: list[FileRecord], image_by_id: dict[str, FileRecord]) -> list[str]:
    limitations: list[str] = []
    if any(r.kind == "report" for r in records):
        limitations.append("reports may contain PHI; review de-identification before sharing.")
    if any(r.kind == "dicom" and r.subtype == "video" and not r.metadata.get("pixel_spacing") for r in records):
        limitations.append("dicom video lacks confirmed PixelSpacing; millimeter measurements need calibration.")
    for annotation in [r for r in records if r.kind == "annotation"]:
        if not annotation.linked_image_id:
            limitations.append("one or more annotations are not linked to an image.")
            break
        image = image_by_id.get(annotation.linked_image_id)
        if image and (not image.width or not image.height):
            limitations.append("one or more linked images have unknown dimensions.")
            break
    return sorted(set(limitations))


def primary_use_for_image(image: FileRecord, annotations: list[FileRecord]) -> list[str]:
    if image.subtype == "review_overlay":
        return ["doctor_review_overlay", "annotation_visual_check_only"]
    if annotations:
        return ["static_detection_training", "static_segmentation_training_or_validation", "measurement_validation"]
    return ["static_image_review", "inference_smoke"]


def target_folder(record: FileRecord) -> str:
    if record.kind == "image":
        return "images"
    if record.kind == "annotation":
        return "annotations/labelme" if record.subtype == "labelme" else "annotations/metadata"
    if record.kind == "report":
        return "reports"
    if record.kind == "video":
        return "videos"
    if record.kind == "dicom":
        return {
            "static": "dicom/static",
            "video": "dicom/video",
            "structured_report": "dicom/structured-report",
        }.get(record.subtype, "dicom/unknown")
    return "other"


def infer_case_id(rel_path: str, options: BuildOptions) -> str:
    if options.case_regex:
        match = re.search(options.case_regex, rel_path)
        if match:
            value = match.groupdict().get("case") or match.group(1)
            return safe_id(value)
    parts = Path(rel_path).parts
    if options.case_mode == "flat":
        return options.dataset_id
    if options.case_mode == "parent-folder":
        return safe_id(parts[-2]) if len(parts) >= 2 else options.dataset_id
    if options.case_mode in {"auto", "first-folder"}:
        return safe_id(parts[0]) if len(parts) >= 2 else options.dataset_id
    return options.dataset_id


def parse_redact_regions(values: list[str]) -> list[tuple[float, float, float, float]]:
    if not values:
        return DEFAULT_REDACT_REGIONS.copy()
    regions = []
    for value in values:
        parts = [part.strip() for part in value.split(",")]
        if len(parts) != 4:
            raise SystemExit(f"--redact-region must be x1,y1,x2,y2: {value}")
        try:
            x1, y1, x2, y2 = [float(part) for part in parts]
        except ValueError as exc:
            raise SystemExit(f"--redact-region has non-numeric value: {value}") from exc
        if not (0 <= x1 < x2 <= 1 and 0 <= y1 < y2 <= 1):
            raise SystemExit(f"--redact-region values must satisfy 0 <= x1 < x2 <= 1 and 0 <= y1 < y2 <= 1: {value}")
        regions.append((x1, y1, x2, y2))
    return regions


def load_sensitive_terms(values: list[str], terms_file: str | None) -> list[str]:
    terms = [value.strip() for value in values if value.strip()]
    if terms_file:
        path = Path(terms_file).expanduser().resolve()
        if not path.is_file():
            raise SystemExit(f"sensitive terms file not found: {path}")
        for line in path.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if line and not line.startswith("#"):
                terms.append(line)
    return sorted(set(terms), key=len, reverse=True)


def load_linkage_salt(value: str | None, salt_file: str | None) -> str | None:
    if value:
        return value
    if salt_file:
        path = Path(salt_file).expanduser().resolve()
        if not path.is_file():
            raise SystemExit(f"linkage salt file not found: {path}")
        salt = path.read_text(encoding="utf-8").strip()
        if not salt:
            raise SystemExit(f"linkage salt file is empty: {path}")
        return salt
    env_value = os.environ.get("THYROID_DATASET_LINKAGE_SALT", "").strip()
    return env_value or None


def resolved_linkage_mode(options: BuildOptions) -> str:
    if options.linkage_mode == "auto":
        return "identity" if options.linkage_salt else "path"
    return options.linkage_mode


def first_non_empty(values: list[str | None]) -> str | None:
    return next((value for value in values if value), None)


def aggregate_clinical_labels(records: list[FileRecord]) -> dict[str, Any]:
    labels: dict[str, Any] = {}
    sizes = []
    for record in records:
        for key, value in record.clinical_labels.items():
            if key == "nodule_sizes" and isinstance(value, list):
                sizes.extend(value)
            elif key not in labels and value not in (None, "", []):
                labels[key] = value
    if sizes:
        labels["nodule_sizes"] = sizes[:10]
    return labels


def safe_source_reference(options: BuildOptions, record: FileRecord) -> str:
    if options.include_source_paths:
        return record.source_relative_path
    return "[redacted]"


def source_reference_hash(options: BuildOptions, record: FileRecord) -> str:
    salt = options.linkage_salt or options.dataset_id
    return short_hash(f"{salt}:source:{record.source_relative_path}:{record.sha256}", "source")


def is_relative_to(path: Path, parent: Path) -> bool:
    try:
        path.relative_to(parent)
        return True
    except ValueError:
        return False


def safe_id(value: str) -> str:
    cleaned = re.sub(r"[^0-9A-Za-z._\-\u4e00-\u9fff]+", "-", value.strip())
    cleaned = cleaned.strip("-._")
    return cleaned or "case"


def safe_component(value: str) -> str:
    return safe_id(value).replace("/", "-")


def should_skip(path: Path) -> bool:
    name = path.name
    return name in SKIP_NAMES or name.startswith(".~") or name.startswith("~$") or name.startswith("._")


def report_like_name(path: Path) -> bool:
    name = path.name.lower()
    return any(token in name for token in ["report", "diagnosis", "诊断", "报告", "病理", "超声"])


def overlay_like_name(path: Path) -> bool:
    name = path.name.lower()
    return any(token in name for token in ["marked", "overlay", "勾画", "标注图", "复核图"])


def report_subtype(path: Path) -> str:
    ext = path.suffix.lower().lstrip(".") or "unknown"
    return f"{ext}_report"


def sniff_dicom(path: Path) -> bool:
    try:
        with path.open("rb") as handle:
            head = handle.read(132)
        return len(head) >= 132 and head[128:132] == b"DICM"
    except OSError:
        return False


def image_dimensions(path: Path) -> tuple[int | None, int | None]:
    try:
        return image_dimensions_from_bytes(path.read_bytes())
    except Exception:
        return None, None


def image_dimensions_from_bytes(data: bytes) -> tuple[int | None, int | None]:
    if data.startswith(b"\x89PNG\r\n\x1a\n") and len(data) >= 24:
        return struct.unpack(">II", data[16:24])
    if data.startswith(b"\xff\xd8"):
        return jpeg_dimensions(data)
    return None, None


def jpeg_dimensions(data: bytes) -> tuple[int | None, int | None]:
    index = 2
    while index + 9 < len(data):
        if data[index] != 0xFF:
            index += 1
            continue
        marker = data[index + 1]
        index += 2
        if marker in {0xD8, 0xD9}:
            continue
        if index + 2 > len(data):
            break
        length = struct.unpack(">H", data[index : index + 2])[0]
        if marker in {0xC0, 0xC1, 0xC2, 0xC3, 0xC5, 0xC6, 0xC7, 0xC9, 0xCA, 0xCB, 0xCD, 0xCE, 0xCF}:
            if index + 7 <= len(data):
                height = struct.unpack(">H", data[index + 3 : index + 5])[0]
                width = struct.unpack(">H", data[index + 5 : index + 7])[0]
                return width, height
            break
        index += max(length, 2)
    return None, None


def extension_from_image_bytes(data: bytes) -> str | None:
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        return ".png"
    if data.startswith(b"\xff\xd8"):
        return ".jpg"
    return None


def valid_points(value: Any) -> bool:
    return (
        isinstance(value, list)
        and len(value) >= 2
        and all(isinstance(point, list) and len(point) >= 2 and all(isinstance(item, (int, float)) for item in point[:2]) for point in value)
    )


def bbox_from_points(points: list[list[float]]) -> list[float]:
    xs = [float(point[0]) for point in points]
    ys = [float(point[1]) for point in points]
    return [min(xs), min(ys), max(xs), max(ys)]


def source_stem(record: FileRecord) -> str:
    rel = record.source_relative_path.split("#", 1)[0]
    return Path(rel).stem


def stable_file_id(kind: str, digest: str, rel_path: str) -> str:
    key = hashlib.sha256(f"{kind}:{digest}:{rel_path}".encode("utf-8")).hexdigest()[:12]
    return f"{kind[:3]}-{key}"


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def numeric_or_none(value: Any) -> float | None:
    if value is None:
        return None
    try:
        return float(value)
    except Exception:
        return None


def json_type_name(value: Any) -> str:
    if isinstance(value, dict):
        return "object"
    if isinstance(value, list):
        return "array"
    return type(value).__name__


def write_json(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def write_jsonl(path: Path, rows: list[dict[str, Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("".join(json.dumps(row, ensure_ascii=False) + "\n" for row in rows), encoding="utf-8")


def now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


if __name__ == "__main__":
    main()
