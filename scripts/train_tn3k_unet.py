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

import torch
import torch.nn as nn
import torch.nn.functional as F
import numpy as np
from PIL import Image, ImageEnhance, ImageOps
from torch.utils.data import DataLoader, Dataset


@dataclass(frozen=True)
class Sample:
    image: Path
    mask: Path


class Tn3kSegmentationDataset(Dataset[tuple[torch.Tensor, torch.Tensor]]):
    def __init__(self, samples: list[Sample], image_size: int, *, augment: bool = False) -> None:
        self.samples = samples
        self.image_size = image_size
        self.augment = augment

    def __len__(self) -> int:
        return len(self.samples)

    def __getitem__(self, index: int) -> tuple[torch.Tensor, torch.Tensor]:
        sample = self.samples[index]
        with Image.open(sample.image) as image:
            image = image.convert("L")

        with Image.open(sample.mask) as mask:
            mask = mask.convert("L")

        if self.augment:
            image, mask = augment_pair(image, mask)

        image = image.resize((self.image_size, self.image_size), Image.Resampling.BILINEAR)
        mask = mask.resize((self.image_size, self.image_size), Image.Resampling.NEAREST)
        image_tensor = torch.from_numpy(np.asarray(image, dtype=np.float32)).unsqueeze(0) / 255.0
        mask_tensor = torch.from_numpy(np.asarray(mask, dtype=np.float32)).unsqueeze(0)
        mask_tensor = (mask_tensor > 0).float()

        return image_tensor, mask_tensor


def augment_pair(image: Image.Image, mask: Image.Image) -> tuple[Image.Image, Image.Image]:
    if random.random() < 0.5:
        image = ImageOps.mirror(image)
        mask = ImageOps.mirror(mask)
    if random.random() < 0.15:
        image = ImageOps.flip(image)
        mask = ImageOps.flip(mask)
    if random.random() < 0.85:
        angle = random.uniform(-12.0, 12.0)
        image = image.rotate(angle, resample=Image.Resampling.BILINEAR, fillcolor=0)
        mask = mask.rotate(angle, resample=Image.Resampling.NEAREST, fillcolor=0)
    if random.random() < 0.7:
        image = ImageEnhance.Contrast(image).enhance(random.uniform(0.75, 1.35))
    if random.random() < 0.7:
        image = ImageEnhance.Brightness(image).enhance(random.uniform(0.8, 1.25))
    if random.random() < 0.25:
        array = np.asarray(image, dtype=np.float32)
        noise = np.random.normal(0.0, random.uniform(3.0, 10.0), size=array.shape)
        image = Image.fromarray(np.clip(array + noise, 0, 255).astype(np.uint8), mode="L")
    return image, mask


class ConvBlock(nn.Module):
    def __init__(self, in_channels: int, out_channels: int) -> None:
        super().__init__()
        self.net = nn.Sequential(
            nn.Conv2d(in_channels, out_channels, kernel_size=3, padding=1, bias=False),
            nn.BatchNorm2d(out_channels),
            nn.ReLU(inplace=True),
            nn.Conv2d(out_channels, out_channels, kernel_size=3, padding=1, bias=False),
            nn.BatchNorm2d(out_channels),
            nn.ReLU(inplace=True),
        )

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        return self.net(x)


class SmallUNet(nn.Module):
    def __init__(self, base_channels: int = 32) -> None:
        super().__init__()
        self.enc1 = ConvBlock(1, base_channels)
        self.enc2 = ConvBlock(base_channels, base_channels * 2)
        self.enc3 = ConvBlock(base_channels * 2, base_channels * 4)
        self.bottleneck = ConvBlock(base_channels * 4, base_channels * 8)
        self.up3 = nn.ConvTranspose2d(base_channels * 8, base_channels * 4, kernel_size=2, stride=2)
        self.dec3 = ConvBlock(base_channels * 8, base_channels * 4)
        self.up2 = nn.ConvTranspose2d(base_channels * 4, base_channels * 2, kernel_size=2, stride=2)
        self.dec2 = ConvBlock(base_channels * 4, base_channels * 2)
        self.up1 = nn.ConvTranspose2d(base_channels * 2, base_channels, kernel_size=2, stride=2)
        self.dec1 = ConvBlock(base_channels * 2, base_channels)
        self.out = nn.Conv2d(base_channels, 1, kernel_size=1)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        e1 = self.enc1(x)
        e2 = self.enc2(F.max_pool2d(e1, 2))
        e3 = self.enc3(F.max_pool2d(e2, 2))
        b = self.bottleneck(F.max_pool2d(e3, 2))
        d3 = self.dec3(torch.cat([self.up3(b), e3], dim=1))
        d2 = self.dec2(torch.cat([self.up2(d3), e2], dim=1))
        d1 = self.dec1(torch.cat([self.up1(d2), e1], dim=1))
        return self.out(d1)


class ResidualBlock(nn.Module):
    def __init__(self, in_channels: int, out_channels: int, dropout: float = 0.0) -> None:
        super().__init__()
        self.projection = (
            nn.Conv2d(in_channels, out_channels, kernel_size=1, bias=False)
            if in_channels != out_channels
            else nn.Identity()
        )
        self.net = nn.Sequential(
            nn.Conv2d(in_channels, out_channels, kernel_size=3, padding=1, bias=False),
            nn.BatchNorm2d(out_channels),
            nn.ReLU(inplace=True),
            nn.Dropout2d(dropout) if dropout > 0 else nn.Identity(),
            nn.Conv2d(out_channels, out_channels, kernel_size=3, padding=1, bias=False),
            nn.BatchNorm2d(out_channels),
        )

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        return F.relu(self.net(x) + self.projection(x), inplace=True)


class AttentionGate(nn.Module):
    def __init__(self, gate_channels: int, skip_channels: int, inter_channels: int) -> None:
        super().__init__()
        self.gate = nn.Sequential(nn.Conv2d(gate_channels, inter_channels, kernel_size=1, bias=False), nn.BatchNorm2d(inter_channels))
        self.skip = nn.Sequential(nn.Conv2d(skip_channels, inter_channels, kernel_size=1, bias=False), nn.BatchNorm2d(inter_channels))
        self.psi = nn.Sequential(nn.Conv2d(inter_channels, 1, kernel_size=1), nn.Sigmoid())

    def forward(self, gate: torch.Tensor, skip: torch.Tensor) -> torch.Tensor:
        attention = self.psi(F.relu(self.gate(gate) + self.skip(skip), inplace=True))
        return skip * attention


class ResidualAttentionUNet(nn.Module):
    def __init__(self, base_channels: int = 32, dropout: float = 0.1) -> None:
        super().__init__()
        self.enc1 = ResidualBlock(1, base_channels, dropout)
        self.enc2 = ResidualBlock(base_channels, base_channels * 2, dropout)
        self.enc3 = ResidualBlock(base_channels * 2, base_channels * 4, dropout)
        self.enc4 = ResidualBlock(base_channels * 4, base_channels * 8, dropout)
        self.bottleneck = ResidualBlock(base_channels * 8, base_channels * 16, dropout)
        self.up4 = nn.ConvTranspose2d(base_channels * 16, base_channels * 8, kernel_size=2, stride=2)
        self.att4 = AttentionGate(base_channels * 8, base_channels * 8, base_channels * 4)
        self.dec4 = ResidualBlock(base_channels * 16, base_channels * 8, dropout)
        self.up3 = nn.ConvTranspose2d(base_channels * 8, base_channels * 4, kernel_size=2, stride=2)
        self.att3 = AttentionGate(base_channels * 4, base_channels * 4, base_channels * 2)
        self.dec3 = ResidualBlock(base_channels * 8, base_channels * 4, dropout)
        self.up2 = nn.ConvTranspose2d(base_channels * 4, base_channels * 2, kernel_size=2, stride=2)
        self.att2 = AttentionGate(base_channels * 2, base_channels * 2, base_channels)
        self.dec2 = ResidualBlock(base_channels * 4, base_channels * 2, dropout)
        self.up1 = nn.ConvTranspose2d(base_channels * 2, base_channels, kernel_size=2, stride=2)
        self.att1 = AttentionGate(base_channels, base_channels, max(1, base_channels // 2))
        self.dec1 = ResidualBlock(base_channels * 2, base_channels, dropout)
        self.out = nn.Conv2d(base_channels, 1, kernel_size=1)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        e1 = self.enc1(x)
        e2 = self.enc2(F.max_pool2d(e1, 2))
        e3 = self.enc3(F.max_pool2d(e2, 2))
        e4 = self.enc4(F.max_pool2d(e3, 2))
        b = self.bottleneck(F.max_pool2d(e4, 2))
        u4 = self.up4(b)
        d4 = self.dec4(torch.cat([u4, self.att4(u4, e4)], dim=1))
        u3 = self.up3(d4)
        d3 = self.dec3(torch.cat([u3, self.att3(u3, e3)], dim=1))
        u2 = self.up2(d3)
        d2 = self.dec2(torch.cat([u2, self.att2(u2, e2)], dim=1))
        u1 = self.up1(d2)
        d1 = self.dec1(torch.cat([u1, self.att1(u1, e1)], dim=1))
        return self.out(d1)


def main() -> int:
    parser = argparse.ArgumentParser(description="Train a validation U-Net segmenter on TN3K masks.")
    parser.add_argument(
        "--data-root",
        default="data/artifacts/datasets/tn3k/processed/datasets/tn3k",
        help="Directory containing trainval-image/trainval-mask.",
    )
    parser.add_argument(
        "--out-dir",
        default="data/models/segmentation/tn3k-unet",
        help="Directory where weights and metrics will be written.",
    )
    parser.add_argument("--image-size", type=int, default=256)
    parser.add_argument("--epochs", type=int, default=30)
    parser.add_argument("--batch-size", type=int, default=16)
    parser.add_argument("--lr", type=float, default=1e-3)
    parser.add_argument("--min-lr", type=float, default=1e-5)
    parser.add_argument("--base-channels", type=int, default=32)
    parser.add_argument("--model", choices=("small", "residual_attention"), default="small")
    parser.add_argument("--dropout", type=float, default=0.1)
    parser.add_argument("--augment", action="store_true", help="Enable deterministic-safe online ultrasound augmentations.")
    parser.add_argument("--scheduler", choices=("none", "cosine"), default="none")
    parser.add_argument("--early-stopping-patience", type=int, default=0)
    parser.add_argument(
        "--threshold-sweep",
        action="store_true",
        help="Evaluate validation Dice/IoU across thresholds 0.30..0.70 and checkpoint by best threshold Dice.",
    )
    parser.add_argument("--seed", type=int, default=20260510)
    parser.add_argument("--num-workers", type=int, default=4)
    parser.add_argument("--val-ratio", type=float, default=0.2)
    parser.add_argument("--max-samples", type=int, default=0, help="Optional smoke-test cap before the 80/20 split.")
    args = parser.parse_args()

    random.seed(args.seed)
    torch.manual_seed(args.seed)
    data_root = Path(args.data_root)
    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    samples = paired_samples(data_root)
    if args.max_samples > 0:
        samples = samples[: args.max_samples]
    if len(samples) < 10:
        raise SystemExit(f"not enough paired TN3K samples under {data_root}: {len(samples)}")

    random.Random(args.seed).shuffle(samples)
    val_count = max(1, int(round(len(samples) * args.val_ratio)))
    train_samples = samples[:-val_count]
    val_samples = samples[-val_count:]

    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    train_loader = DataLoader(
        Tn3kSegmentationDataset(train_samples, args.image_size, augment=args.augment),
        batch_size=args.batch_size,
        shuffle=True,
        num_workers=args.num_workers,
        pin_memory=device.type == "cuda",
    )
    val_loader = DataLoader(
        Tn3kSegmentationDataset(val_samples, args.image_size),
        batch_size=args.batch_size,
        shuffle=False,
        num_workers=args.num_workers,
        pin_memory=device.type == "cuda",
    )

    model = build_model(args).to(device)
    optimizer = torch.optim.AdamW(model.parameters(), lr=args.lr)
    scheduler = (
        torch.optim.lr_scheduler.CosineAnnealingLR(optimizer, T_max=args.epochs, eta_min=args.min_lr)
        if args.scheduler == "cosine"
        else None
    )
    history: list[dict[str, float | int]] = []
    best_dice = -1.0
    best_epoch = 0
    epochs_since_improvement = 0
    best_state_path = out_dir / "best_state.pt"
    best_script_path = out_dir / "best_torchscript.pt"
    started_at = time.time()

    for epoch in range(1, args.epochs + 1):
        train_loss = train_one_epoch(model, train_loader, optimizer, device)
        val_metrics = evaluate(model, val_loader, device, threshold_sweep=args.threshold_sweep)
        checkpoint_score = val_metrics["best_dice"] if args.threshold_sweep else val_metrics["dice"]
        row = {
            "epoch": epoch,
            "train_loss": round(train_loss, 6),
            "lr": round(float(optimizer.param_groups[0]["lr"]), 8),
            "val_dice": round(val_metrics["dice"], 6),
            "val_iou": round(val_metrics["iou"], 6),
            "val_best_dice": round(val_metrics["best_dice"], 6),
            "val_best_iou": round(val_metrics["best_iou"], 6),
            "val_best_threshold": round(val_metrics["best_threshold"], 3),
        }
        history.append(row)
        print(json.dumps(row, ensure_ascii=False), flush=True)

        if checkpoint_score > best_dice:
            best_dice = checkpoint_score
            best_epoch = epoch
            save_checkpoint(best_state_path, model, args, train_samples, val_samples, val_metrics)
            export_torchscript(best_script_path, model, args.image_size, device)
            epochs_since_improvement = 0
        else:
            epochs_since_improvement += 1

        if scheduler:
            scheduler.step()
        if args.early_stopping_patience > 0 and epochs_since_improvement >= args.early_stopping_patience:
            print(json.dumps({"early_stopped": True, "epoch": epoch, "best_epoch": best_epoch}, ensure_ascii=False), flush=True)
            break

    metrics_csv = out_dir / "metrics.csv"
    write_metrics_csv(metrics_csv, history)
    summary = {
        "dataset": {
            "data_root": str(data_root),
            "total_samples": len(samples),
            "train_samples": len(train_samples),
            "val_samples": len(val_samples),
            "split": "seeded 80/20 train/validation split",
            "seed": args.seed,
        },
        "training": {
            "epochs": args.epochs,
            "batch_size": args.batch_size,
            "image_size": args.image_size,
            "base_channels": args.base_channels,
            "lr": args.lr,
            "min_lr": args.min_lr,
            "model": args.model,
            "dropout": args.dropout,
            "augment": args.augment,
            "scheduler": args.scheduler,
            "threshold_sweep": args.threshold_sweep,
            "device": str(device),
            "duration_seconds": round(time.time() - started_at, 3),
        },
        "best": {
            "epoch": best_epoch,
            "val_dice": round(best_dice, 6),
            "val_iou": next(
                (row["val_best_iou"] if args.threshold_sweep else row["val_iou"] for row in history if row["epoch"] == best_epoch),
                None,
            ),
            "threshold": next(
                (row["val_best_threshold"] if args.threshold_sweep else 0.5 for row in history if row["epoch"] == best_epoch),
                None,
            ),
            "state_dict": str(best_state_path),
            "torchscript": str(best_script_path),
        },
    }
    summary_path = out_dir / "summary.json"
    summary_path.write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({"summary": str(summary_path), "best": summary["best"]}, ensure_ascii=False), flush=True)
    return 0


def build_model(args: argparse.Namespace) -> nn.Module:
    if args.model == "residual_attention":
        return ResidualAttentionUNet(base_channels=args.base_channels, dropout=args.dropout)
    return SmallUNet(base_channels=args.base_channels)


def paired_samples(data_root: Path) -> list[Sample]:
    image_dir = data_root / "trainval-image"
    mask_dir = data_root / "trainval-mask"
    if not image_dir.is_dir() or not mask_dir.is_dir():
        raise SystemExit(f"TN3K trainval-image/trainval-mask not found under {data_root}")

    masks_by_stem = {path.stem: path for path in sorted(mask_dir.iterdir()) if path.is_file()}
    samples = []
    for image in sorted(image_dir.iterdir()):
        if not image.is_file():
            continue
        mask = masks_by_stem.get(image.stem)
        if mask:
            samples.append(Sample(image=image, mask=mask))
    return samples


def train_one_epoch(
    model: nn.Module,
    loader: DataLoader[tuple[torch.Tensor, torch.Tensor]],
    optimizer: torch.optim.Optimizer,
    device: torch.device,
) -> float:
    model.train()
    running_loss = 0.0
    batches = 0
    for images, masks in loader:
        images = images.to(device, non_blocking=True)
        masks = masks.to(device, non_blocking=True)
        optimizer.zero_grad(set_to_none=True)
        logits = model(images)
        loss = segmentation_loss(logits, masks)
        loss.backward()
        optimizer.step()
        running_loss += float(loss.detach().cpu())
        batches += 1
    return running_loss / max(1, batches)


def evaluate(
    model: nn.Module,
    loader: DataLoader[tuple[torch.Tensor, torch.Tensor]],
    device: torch.device,
    *,
    threshold_sweep: bool = False,
) -> dict[str, float]:
    model.eval()
    dice_total = 0.0
    iou_total = 0.0
    count = 0
    thresholds = [0.5]
    if threshold_sweep:
        thresholds = [round(value, 2) for value in np.arange(0.3, 0.71, 0.05)]
    sweep_totals = {threshold: {"dice": 0.0, "iou": 0.0} for threshold in thresholds}
    with torch.inference_mode():
        for images, masks in loader:
            images = images.to(device, non_blocking=True)
            masks = masks.to(device, non_blocking=True)
            probs = torch.sigmoid(model(images))
            preds = (probs >= 0.5).float()
            dice, iou = dice_iou(preds, masks)
            batch_size = images.shape[0]
            dice_total += dice * batch_size
            iou_total += iou * batch_size
            for threshold in thresholds:
                threshold_preds = (probs >= threshold).float()
                threshold_dice, threshold_iou = dice_iou(threshold_preds, masks)
                sweep_totals[threshold]["dice"] += threshold_dice * batch_size
                sweep_totals[threshold]["iou"] += threshold_iou * batch_size
            count += batch_size
    best_threshold = 0.5
    best_dice = -1.0
    best_iou = 0.0
    for threshold, totals in sweep_totals.items():
        threshold_dice = totals["dice"] / max(1, count)
        if threshold_dice > best_dice:
            best_threshold = threshold
            best_dice = threshold_dice
            best_iou = totals["iou"] / max(1, count)
    return {
        "dice": dice_total / max(1, count),
        "iou": iou_total / max(1, count),
        "best_threshold": float(best_threshold),
        "best_dice": best_dice,
        "best_iou": best_iou,
    }


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


def save_checkpoint(
    path: Path,
    model: nn.Module,
    args: argparse.Namespace,
    train_samples: Iterable[Sample],
    val_samples: Iterable[Sample],
    val_metrics: dict[str, float],
) -> None:
    torch.save(
        {
            "model_state": model.state_dict(),
            "model": args.model,
            "args": vars(args),
            "train_samples": [asdict(sample) for sample in train_samples],
            "val_samples": [asdict(sample) for sample in val_samples],
            "val_metrics": val_metrics,
        },
        path,
    )


def export_torchscript(path: Path, model: nn.Module, image_size: int, device: torch.device) -> None:
    script_model = copy.deepcopy(model).to(device)
    script_model.eval()
    example = torch.zeros(1, 1, image_size, image_size, device=device)
    traced = torch.jit.trace(script_model, example)
    traced.cpu().save(str(path))
    model.to(device)


def write_metrics_csv(path: Path, history: list[dict[str, float | int]]) -> None:
    with path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(
            handle,
            fieldnames=[
                "epoch",
                "train_loss",
                "lr",
                "val_dice",
                "val_iou",
                "val_best_dice",
                "val_best_iou",
                "val_best_threshold",
            ],
        )
        writer.writeheader()
        writer.writerows(history)


if __name__ == "__main__":
    raise SystemExit(main())
