#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import random
import shutil
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any

from PIL import Image


@dataclass(frozen=True)
class Sample:
    image: Path
    mask: Path


@dataclass(frozen=True)
class RoiSample:
    source: Sample
    foreground_bbox_xyxy: tuple[int, int, int, int]
    crop_box_xyxy: tuple[int, int, int, int]


def main() -> int:
    parser = argparse.ArgumentParser(description="Prepare TN3K nodule-centered ROI crops in nnU-Net v2 raw dataset layout.")
    parser.add_argument("--data-root", default="data/artifacts/datasets/tn3k/processed/datasets/tn3k")
    parser.add_argument("--nnunet-raw", default="data/nnunet/nnUNet_raw")
    parser.add_argument("--dataset-id", type=int, default=502)
    parser.add_argument("--dataset-name", default="TN3KThyroidROI")
    parser.add_argument("--seed", type=int, default=20260510)
    parser.add_argument("--val-ratio", type=float, default=0.2)
    parser.add_argument("--output-size", type=int, default=384)
    parser.add_argument("--margin-ratio", type=float, default=0.35)
    parser.add_argument("--min-crop-size", type=int, default=96)
    parser.add_argument("--overwrite", action="store_true")
    args = parser.parse_args()

    summary = prepare_roi_dataset(
        data_root=Path(args.data_root),
        nnunet_raw=Path(args.nnunet_raw),
        dataset_id=args.dataset_id,
        dataset_name=args.dataset_name,
        seed=args.seed,
        val_ratio=args.val_ratio,
        output_size=args.output_size,
        margin_ratio=args.margin_ratio,
        min_crop_size=args.min_crop_size,
        overwrite=args.overwrite,
    )
    print(json.dumps(summary, ensure_ascii=False, indent=2))
    return 0


def prepare_roi_dataset(
    *,
    data_root: Path,
    nnunet_raw: Path,
    dataset_id: int,
    dataset_name: str,
    seed: int,
    val_ratio: float,
    output_size: int,
    margin_ratio: float,
    min_crop_size: int,
    overwrite: bool,
) -> dict[str, Any]:
    if not 0.0 < val_ratio < 1.0:
        raise SystemExit("--val-ratio must be between 0 and 1")
    if output_size < 32:
        raise SystemExit("--output-size must be at least 32")
    if margin_ratio < 0.0:
        raise SystemExit("--margin-ratio must be non-negative")
    if min_crop_size < 16:
        raise SystemExit("--min-crop-size must be at least 16")

    samples = paired_samples(data_root)
    roi_samples, skipped = build_roi_samples(samples, margin_ratio=margin_ratio, min_crop_size=min_crop_size)
    if len(roi_samples) < 10:
        raise SystemExit(f"not enough non-empty TN3K ROI samples: {len(roi_samples)}")

    random.Random(seed).shuffle(roi_samples)
    val_count = max(1, int(round(len(roi_samples) * val_ratio)))
    train_samples = roi_samples[:-val_count]
    val_samples = roi_samples[-val_count:]

    dataset_dir = nnunet_raw / f"Dataset{dataset_id:03d}_{dataset_name}"
    if dataset_dir.exists():
        if not overwrite:
            raise SystemExit(f"{dataset_dir} already exists; pass --overwrite to replace")
        shutil.rmtree(dataset_dir)
    for name in ("imagesTr", "labelsTr", "imagesTs", "labelsTs"):
        (dataset_dir / name).mkdir(parents=True, exist_ok=True)

    train_manifest = write_split(train_samples, dataset_dir / "imagesTr", dataset_dir / "labelsTr", output_size=output_size)
    val_manifest = write_split(val_samples, dataset_dir / "imagesTs", dataset_dir / "labelsTs", output_size=output_size)
    dataset_json = {
        "channel_names": {"0": "ultrasound_roi"},
        "labels": {"background": 0, "nodule": 1},
        "numTraining": len(train_samples),
        "file_ending": ".png",
        "overwrite_image_reader_writer": "NaturalImage2DIO",
    }
    (dataset_dir / "dataset.json").write_text(json.dumps(dataset_json, ensure_ascii=False, indent=2), encoding="utf-8")
    split = {
        "seed": seed,
        "val_ratio": val_ratio,
        "output_size": output_size,
        "margin_ratio": margin_ratio,
        "min_crop_size": min_crop_size,
        "skipped_empty_masks": skipped,
        "train": train_manifest,
        "validation": val_manifest,
    }
    (dataset_dir / "split_manifest.json").write_text(json.dumps(split, ensure_ascii=False, indent=2), encoding="utf-8")
    return {
        "dataset_dir": str(dataset_dir),
        "dataset_id": dataset_id,
        "total_paired_samples": len(samples),
        "total_roi_samples": len(roi_samples),
        "skipped_empty_masks": skipped,
        "train_samples": len(train_samples),
        "validation_samples": len(val_samples),
        "output_size": output_size,
        "margin_ratio": margin_ratio,
        "min_crop_size": min_crop_size,
        "next_commands": [
            f"export nnUNet_raw={nnunet_raw.resolve()}",
            "export nnUNet_preprocessed=$PWD/data/nnunet/nnUNet_preprocessed",
            "export nnUNet_results=$PWD/data/nnunet/nnUNet_results",
            f"nnUNetv2_plan_and_preprocess -d {dataset_id} --verify_dataset_integrity",
            f"nnUNetv2_train {dataset_id} 2d 0 -tr nnUNetTrainer_100epochs",
        ],
    }


def paired_samples(data_root: Path) -> list[Sample]:
    image_dir = data_root / "trainval-image"
    mask_dir = data_root / "trainval-mask"
    if not image_dir.is_dir() or not mask_dir.is_dir():
        raise SystemExit(f"TN3K trainval-image/trainval-mask not found under {data_root}")

    masks_by_stem = {path.stem: path for path in sorted(mask_dir.iterdir()) if path.is_file()}
    samples = []
    for image in sorted(image_dir.iterdir()):
        if image.is_file() and image.stem in masks_by_stem:
            samples.append(Sample(image=image, mask=masks_by_stem[image.stem]))
    return samples


def build_roi_samples(samples: list[Sample], *, margin_ratio: float, min_crop_size: int) -> tuple[list[RoiSample], int]:
    roi_samples = []
    skipped = 0
    for sample in samples:
        with Image.open(sample.image) as image, Image.open(sample.mask) as mask:
            image_size = image.size
            binary_mask = mask.convert("L")
            if binary_mask.size != image_size:
                binary_mask = binary_mask.resize(image_size, Image.Resampling.NEAREST)
            binary_mask = binary_mask.point(lambda value: 255 if value > 0 else 0)
            foreground_bbox = binary_mask.getbbox()
            if foreground_bbox is None:
                skipped += 1
                continue
            crop_box = expanded_crop_box(foreground_bbox, image_size, margin_ratio=margin_ratio, min_crop_size=min_crop_size)
            roi_samples.append(
                RoiSample(
                    source=sample,
                    foreground_bbox_xyxy=foreground_bbox,
                    crop_box_xyxy=crop_box,
                )
            )
    return roi_samples, skipped


def expanded_crop_box(
    bbox: tuple[int, int, int, int],
    image_size: tuple[int, int],
    *,
    margin_ratio: float,
    min_crop_size: int,
) -> tuple[int, int, int, int]:
    image_width, image_height = image_size
    left, top, right, bottom = bbox
    width = max(1, right - left)
    height = max(1, bottom - top)
    margin = int(round(max(width, height) * margin_ratio))
    side = max(width + 2 * margin, height + 2 * margin, min_crop_size)
    side = min(side, max(image_width, image_height))
    center_x = (left + right) / 2.0
    center_y = (top + bottom) / 2.0
    crop_left = int(round(center_x - side / 2.0))
    crop_top = int(round(center_y - side / 2.0))
    crop_right = crop_left + side
    crop_bottom = crop_top + side

    if crop_left < 0:
        crop_right -= crop_left
        crop_left = 0
    if crop_top < 0:
        crop_bottom -= crop_top
        crop_top = 0
    if crop_right > image_width:
        shift = crop_right - image_width
        crop_left = max(0, crop_left - shift)
        crop_right = image_width
    if crop_bottom > image_height:
        shift = crop_bottom - image_height
        crop_top = max(0, crop_top - shift)
        crop_bottom = image_height
    return crop_left, crop_top, crop_right, crop_bottom


def write_split(roi_samples: list[RoiSample], image_dir: Path, label_dir: Path, *, output_size: int) -> list[dict[str, Any]]:
    manifest = []
    for index, roi_sample in enumerate(roi_samples):
        case_id = f"tn3k_roi_{index:04d}"
        image_path = image_dir / f"{case_id}_0000.png"
        label_path = label_dir / f"{case_id}.png"
        with Image.open(roi_sample.source.image) as image, Image.open(roi_sample.source.mask) as mask:
            image = image.convert("L")
            mask = mask.convert("L")
            if mask.size != image.size:
                mask = mask.resize(image.size, Image.Resampling.NEAREST)
            crop_box = roi_sample.crop_box_xyxy
            image.crop(crop_box).resize((output_size, output_size), Image.Resampling.BILINEAR).save(image_path)
            binary = mask.crop(crop_box).resize((output_size, output_size), Image.Resampling.NEAREST)
            binary.point(lambda value: 1 if value > 0 else 0).save(label_path)
        manifest.append(
            {
                "case_id": case_id,
                "source": {
                    "image": str(roi_sample.source.image),
                    "mask": str(roi_sample.source.mask),
                },
                "foreground_bbox_xyxy": list(roi_sample.foreground_bbox_xyxy),
                "crop_box_xyxy": list(roi_sample.crop_box_xyxy),
                "image": str(image_path),
                "label": str(label_path),
            }
        )
    return manifest


if __name__ == "__main__":
    raise SystemExit(main())
