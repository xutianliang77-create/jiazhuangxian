#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import random
import shutil
from dataclasses import asdict, dataclass
from pathlib import Path

from PIL import Image


@dataclass(frozen=True)
class Sample:
    image: Path
    mask: Path


def main() -> int:
    parser = argparse.ArgumentParser(description="Prepare TN3K masks in nnU-Net v2 raw dataset layout.")
    parser.add_argument("--data-root", default="data/artifacts/datasets/tn3k/processed/datasets/tn3k")
    parser.add_argument("--nnunet-raw", default="data/nnunet/nnUNet_raw")
    parser.add_argument("--dataset-id", type=int, default=501)
    parser.add_argument("--dataset-name", default="TN3KThyroid")
    parser.add_argument("--seed", type=int, default=20260510)
    parser.add_argument("--val-ratio", type=float, default=0.2)
    parser.add_argument("--overwrite", action="store_true")
    args = parser.parse_args()

    samples = paired_samples(Path(args.data_root))
    if len(samples) < 10:
        raise SystemExit(f"not enough paired TN3K samples: {len(samples)}")
    random.Random(args.seed).shuffle(samples)
    val_count = max(1, int(round(len(samples) * args.val_ratio)))
    train_samples = samples[:-val_count]
    val_samples = samples[-val_count:]

    dataset_dir = Path(args.nnunet_raw) / f"Dataset{args.dataset_id:03d}_{args.dataset_name}"
    if dataset_dir.exists():
        if not args.overwrite:
            raise SystemExit(f"{dataset_dir} already exists; pass --overwrite to replace")
        shutil.rmtree(dataset_dir)
    for name in ("imagesTr", "labelsTr", "imagesTs", "labelsTs"):
        (dataset_dir / name).mkdir(parents=True, exist_ok=True)

    write_split(train_samples, dataset_dir / "imagesTr", dataset_dir / "labelsTr")
    write_split(val_samples, dataset_dir / "imagesTs", dataset_dir / "labelsTs")
    dataset_json = {
        "channel_names": {"0": "ultrasound"},
        "labels": {"background": 0, "nodule": 1},
        "numTraining": len(train_samples),
        "file_ending": ".png",
        "overwrite_image_reader_writer": "NaturalImage2DIO",
    }
    (dataset_dir / "dataset.json").write_text(json.dumps(dataset_json, ensure_ascii=False, indent=2), encoding="utf-8")
    split = {
        "seed": args.seed,
        "val_ratio": args.val_ratio,
        "train": [asdict(sample) for sample in train_samples],
        "validation": [asdict(sample) for sample in val_samples],
    }
    (dataset_dir / "split_manifest.json").write_text(json.dumps(split, ensure_ascii=False, indent=2, default=str), encoding="utf-8")
    summary = {
        "dataset_dir": str(dataset_dir),
        "dataset_id": args.dataset_id,
        "total_samples": len(samples),
        "train_samples": len(train_samples),
        "validation_samples": len(val_samples),
        "next_commands": [
            f"export nnUNet_raw={Path(args.nnunet_raw).resolve()}",
            "export nnUNet_preprocessed=$PWD/data/nnunet/nnUNet_preprocessed",
            "export nnUNet_results=$PWD/data/nnunet/nnUNet_results",
            f"nnUNetv2_plan_and_preprocess -d {args.dataset_id} --verify_dataset_integrity",
            f"nnUNetv2_train {args.dataset_id} 2d 0",
        ],
    }
    print(json.dumps(summary, ensure_ascii=False, indent=2))
    return 0


def paired_samples(data_root: Path) -> list[Sample]:
    image_dir = data_root / "trainval-image"
    mask_dir = data_root / "trainval-mask"
    masks_by_stem = {path.stem: path for path in sorted(mask_dir.iterdir()) if path.is_file()}
    samples = []
    for image in sorted(image_dir.iterdir()):
        if image.is_file() and image.stem in masks_by_stem:
            samples.append(Sample(image=image, mask=masks_by_stem[image.stem]))
    return samples


def write_split(samples: list[Sample], image_dir: Path, label_dir: Path) -> None:
    for index, sample in enumerate(samples):
        case_id = f"tn3k_{index:04d}"
        image_path = image_dir / f"{case_id}_0000.png"
        label_path = label_dir / f"{case_id}.png"
        with Image.open(sample.image) as image:
            image.convert("L").save(image_path)
        with Image.open(sample.mask) as mask:
            binary = mask.convert("L").point(lambda value: 1 if value > 0 else 0)
            binary.save(label_path)


if __name__ == "__main__":
    raise SystemExit(main())
