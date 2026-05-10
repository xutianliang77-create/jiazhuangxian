#!/usr/bin/env python3
from __future__ import annotations

import argparse
import copy
import csv
import json
import random
import time
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Iterable

import numpy as np
import torch
import torch.nn.functional as F
from PIL import Image
from torch import nn
from torch.utils.data import DataLoader, Dataset


@dataclass(frozen=True)
class Sample:
    image: Path
    mask: Path


class Tn3kRgbDataset(Dataset[tuple[torch.Tensor, torch.Tensor]]):
    def __init__(self, samples: list[Sample], image_size: int) -> None:
        self.samples = samples
        self.image_size = image_size

    def __len__(self) -> int:
        return len(self.samples)

    def __getitem__(self, index: int) -> tuple[torch.Tensor, torch.Tensor]:
        sample = self.samples[index]
        with Image.open(sample.image) as image:
            image = image.convert("RGB").resize((self.image_size, self.image_size), Image.Resampling.BILINEAR)
            array = np.asarray(image, dtype=np.float32) / 255.0
            image_tensor = torch.from_numpy(array).permute(2, 0, 1)
        with Image.open(sample.mask) as mask:
            mask = mask.convert("L").resize((self.image_size, self.image_size), Image.Resampling.NEAREST)
            mask_tensor = torch.from_numpy(np.asarray(mask, dtype=np.float32)).unsqueeze(0)
            mask_tensor = (mask_tensor > 0).float()
        return image_tensor, mask_tensor


def main() -> int:
    parser = argparse.ArgumentParser(description="Train a Swin-encoder U-Net on TN3K using segmentation-models-pytorch.")
    parser.add_argument("--data-root", default="data/artifacts/datasets/tn3k/processed/datasets/tn3k")
    parser.add_argument("--out-dir", default="data/models/segmentation/tn3k-swin-unet-v1")
    parser.add_argument("--encoder", default="tu-swin_tiny_patch4_window7_224")
    parser.add_argument("--encoder-weights", default=None, help="Use 'imagenet' when network access/cache is available.")
    parser.add_argument("--image-size", type=int, default=224)
    parser.add_argument("--epochs", type=int, default=40)
    parser.add_argument("--batch-size", type=int, default=8)
    parser.add_argument("--lr", type=float, default=3e-4)
    parser.add_argument("--seed", type=int, default=20260510)
    parser.add_argument("--num-workers", type=int, default=4)
    parser.add_argument("--val-ratio", type=float, default=0.2)
    parser.add_argument("--max-samples", type=int, default=0, help="Optional smoke-test cap before the 80/20 split.")
    args = parser.parse_args()

    try:
        import segmentation_models_pytorch as smp  # type: ignore[import-not-found]
    except ImportError as exc:
        raise SystemExit(
            "segmentation-models-pytorch is required. Install on 5090 with: "
            "python -m pip install segmentation-models-pytorch timm"
        ) from exc

    random.seed(args.seed)
    torch.manual_seed(args.seed)
    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    samples = paired_samples(Path(args.data_root))
    if args.max_samples > 0:
        samples = samples[: args.max_samples]
    if len(samples) < 10:
        raise SystemExit(f"not enough paired TN3K samples: {len(samples)}")
    random.Random(args.seed).shuffle(samples)
    val_count = max(1, int(round(len(samples) * args.val_ratio)))
    train_samples = samples[:-val_count]
    val_samples = samples[-val_count:]

    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    train_loader = DataLoader(
        Tn3kRgbDataset(train_samples, args.image_size),
        batch_size=args.batch_size,
        shuffle=True,
        num_workers=args.num_workers,
        pin_memory=device.type == "cuda",
    )
    val_loader = DataLoader(
        Tn3kRgbDataset(val_samples, args.image_size),
        batch_size=args.batch_size,
        shuffle=False,
        num_workers=args.num_workers,
        pin_memory=device.type == "cuda",
    )
    encoder_weights = normalized_encoder_weights(args.encoder_weights)
    model = smp.Unet(
        encoder_name=args.encoder,
        encoder_weights=encoder_weights,
        in_channels=3,
        classes=1,
        activation=None,
    ).to(device)
    optimizer = torch.optim.AdamW(model.parameters(), lr=args.lr)
    scheduler = torch.optim.lr_scheduler.CosineAnnealingLR(optimizer, T_max=args.epochs, eta_min=1e-6)
    best_dice = -1.0
    best_epoch = 0
    history: list[dict[str, float | int]] = []
    started_at = time.time()
    best_state_path = out_dir / "best_state.pt"
    best_script_path = out_dir / "best_torchscript.pt"

    for epoch in range(1, args.epochs + 1):
        train_loss = train_one_epoch(model, train_loader, optimizer, device)
        dice, iou = evaluate(model, val_loader, device)
        row = {
            "epoch": epoch,
            "train_loss": round(train_loss, 6),
            "lr": round(float(optimizer.param_groups[0]["lr"]), 8),
            "val_dice": round(dice, 6),
            "val_iou": round(iou, 6),
        }
        history.append(row)
        print(json.dumps(row, ensure_ascii=False), flush=True)
        if dice > best_dice:
            best_dice = dice
            best_epoch = epoch
            torch.save(
                {
                    "model_state": model.state_dict(),
                    "model": "smp.Unet",
                    "encoder": args.encoder,
                    "args": vars(args),
                    "train_samples": [asdict(sample) for sample in train_samples],
                    "val_samples": [asdict(sample) for sample in val_samples],
                    "val_metrics": {"dice": dice, "iou": iou},
                },
                best_state_path,
            )
            export_torchscript(best_script_path, model, args.image_size, device)
        scheduler.step()

    write_metrics_csv(out_dir / "metrics.csv", history)
    summary = {
        "dataset": {
            "data_root": args.data_root,
            "total_samples": len(samples),
            "train_samples": len(train_samples),
            "val_samples": len(val_samples),
            "seed": args.seed,
        },
        "training": {
            "epochs": args.epochs,
            "batch_size": args.batch_size,
            "image_size": args.image_size,
            "encoder": args.encoder,
            "encoder_weights": encoder_weights,
            "lr": args.lr,
            "device": str(device),
            "duration_seconds": round(time.time() - started_at, 3),
        },
        "best": {
            "epoch": best_epoch,
            "val_dice": round(best_dice, 6),
            "val_iou": next((row["val_iou"] for row in history if row["epoch"] == best_epoch), None),
            "state_dict": str(best_state_path),
            "torchscript": str(best_script_path),
        },
    }
    (out_dir / "summary.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
    return 0


def normalized_encoder_weights(value: str | None) -> str | None:
    if value is None:
        return None
    normalized = value.strip().lower()
    if normalized in {"", "none", "null", "false", "0"}:
        return None
    return value


def paired_samples(data_root: Path) -> list[Sample]:
    image_dir = data_root / "trainval-image"
    mask_dir = data_root / "trainval-mask"
    masks_by_stem = {path.stem: path for path in sorted(mask_dir.iterdir()) if path.is_file()}
    return [Sample(image=image, mask=masks_by_stem[image.stem]) for image in sorted(image_dir.iterdir()) if image.is_file() and image.stem in masks_by_stem]


def train_one_epoch(model: nn.Module, loader: DataLoader[tuple[torch.Tensor, torch.Tensor]], optimizer: torch.optim.Optimizer, device: torch.device) -> float:
    model.train()
    total = 0.0
    batches = 0
    for images, masks in loader:
        images = images.to(device, non_blocking=True)
        masks = masks.to(device, non_blocking=True)
        optimizer.zero_grad(set_to_none=True)
        logits = model(images)
        loss = segmentation_loss(logits, masks)
        loss.backward()
        optimizer.step()
        total += float(loss.detach().cpu())
        batches += 1
    return total / max(1, batches)


def evaluate(model: nn.Module, loader: DataLoader[tuple[torch.Tensor, torch.Tensor]], device: torch.device) -> tuple[float, float]:
    model.eval()
    dice_total = 0.0
    iou_total = 0.0
    count = 0
    with torch.inference_mode():
        for images, masks in loader:
            images = images.to(device, non_blocking=True)
            masks = masks.to(device, non_blocking=True)
            preds = (torch.sigmoid(model(images)) >= 0.5).float()
            dice, iou = dice_iou(preds, masks)
            batch_size = images.shape[0]
            dice_total += dice * batch_size
            iou_total += iou * batch_size
            count += batch_size
    return dice_total / max(1, count), iou_total / max(1, count)


def segmentation_loss(logits: torch.Tensor, masks: torch.Tensor) -> torch.Tensor:
    bce = F.binary_cross_entropy_with_logits(logits, masks)
    probs = torch.sigmoid(logits)
    dims = (1, 2, 3)
    intersection = torch.sum(probs * masks, dims)
    union = torch.sum(probs, dims) + torch.sum(masks, dims)
    dice = (2.0 * intersection + 1.0) / (union + 1.0)
    return bce + (1.0 - dice.mean())


def dice_iou(preds: torch.Tensor, masks: torch.Tensor) -> tuple[float, float]:
    dims = (1, 2, 3)
    intersection = torch.sum(preds * masks, dims)
    pred_sum = torch.sum(preds, dims)
    mask_sum = torch.sum(masks, dims)
    dice = (2.0 * intersection + 1.0) / (pred_sum + mask_sum + 1.0)
    union = pred_sum + mask_sum - intersection
    iou = (intersection + 1.0) / (union + 1.0)
    return float(dice.mean().detach().cpu()), float(iou.mean().detach().cpu())


def export_torchscript(path: Path, model: nn.Module, image_size: int, device: torch.device) -> None:
    script_model = copy.deepcopy(model).to(device)
    script_model.eval()
    example = torch.zeros(1, 3, image_size, image_size, device=device)
    traced = torch.jit.trace(script_model, example)
    traced.cpu().save(str(path))
    model.to(device)


def write_metrics_csv(path: Path, history: list[dict[str, float | int]]) -> None:
    with path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=["epoch", "train_loss", "lr", "val_dice", "val_iou"])
        writer.writeheader()
        writer.writerows(history)


if __name__ == "__main__":
    raise SystemExit(main())
