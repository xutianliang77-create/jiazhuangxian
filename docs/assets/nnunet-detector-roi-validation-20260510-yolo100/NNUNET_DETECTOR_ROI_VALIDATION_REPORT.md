# nnU-Net Tight ROI Detector-Prompt Validation

## Run

- Predictions: `data/artifacts/reports/nnunet-detector-roi-validation-20260510-yolo100/predictions`
- Input prompt: YOLO detector bbox expanded as tight ROI crop.
- Evaluation: ROI prediction pasted back to full image, compared with full-size TN3K test mask.

## Summary

- Total cases: 100
- Succeeded: 97
- Failed/skipped: 3
- Mean Dice: 0.875605
- Median Dice: 0.919343
- Min Dice: 0.085727
- Mean IoU: 0.797751
- Dice >= 0.90: 54
- Dice >= 0.95: 22

## Lowest Dice Cases

| image_id | nnU-Net Dice | SAM2 Dice | area_ratio |
|---|---:|---:|---:|
| 0038 | 0.085727 | 0.077499 | 0.064551 |
| 0041 | 0.176005 | 0.065372 | 0.115135 |
| 0067 | 0.526584 | 0.47615 | 0.458097 |
| 0050 | 0.594005 | 0.492342 | 0.444001 |
| 0036 | 0.631530 | 0.623471 | 0.614863 |
| 0054 | 0.653459 | 0.603834 | 2.060636 |
| 0011 | 0.695036 | 0.772804 | 1.861721 |
| 0003 | 0.737610 | 0.60801 | 1.465831 |
| 0076 | 0.751835 | 0.64753 | 0.781025 |
| 0017 | 0.772238 | 0.673569 | 0.670611 |
