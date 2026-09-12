"""
Training & Fine-Tuning Pipeline for YOLOv8 License Plate Detector.
Trains a model on custom or synthetic plate datasets and exports weights.
"""

import os
import argparse
from ultralytics import YOLO

def train_plate_model(
    data_yaml="dataset/data.yaml",
    base_model="yolov8n.pt",
    epochs=10,
    imgsz=640,
    batch=16,
    workers=4,
    device="cpu",
    output_dir="models/detection/weights"
):
    print("=" * 60)
    print("STARTING YOLOv8 LICENSE PLATE DETECTION TRAINING PIPELINE")
    print("=" * 60)
    print(f"Data config: {data_yaml}")
    print(f"Base model:  {base_model}")
    print(f"Epochs:      {epochs}")
    print(f"Image Size:  {imgsz}")
    print(f"Batch Size:  {batch}")
    print("=" * 60)

    if not os.path.exists(data_yaml):
        raise FileNotFoundError(f"Configuration file {data_yaml} not found. Run generate_training_dataset.py first.")

    os.makedirs(output_dir, exist_ok=True)

    # 1. Load Pretrained YOLOv8 Backbone
    model = YOLO(base_model)

    # 2. Train Model
    results = model.train(
        data=data_yaml,
        epochs=epochs,
        imgsz=imgsz,
        batch=batch,
        workers=workers,
        device=device,
        project="runs/detect",
        name="plate_detector",
        exist_ok=True,
        verbose=True
    )

    # 3. Validate on Validation Split
    print("\n--- Running Validation on Validation Split ---")
    val_results = model.val()
    print(f"Validation Box mAP50:     {val_results.box.map50:.4f}")
    print(f"Validation Box mAP50-95:  {val_results.box.map:.4f}")

    # 4. Export Best Model to models/detection/weights/license_plate_detector.pt
    best_pt = os.path.join("runs", "detect", "plate_detector", "weights", "best.pt")
    target_pt = os.path.join(output_dir, "license_plate_detector.pt")
    
    if os.path.exists(best_pt):
        import shutil
        shutil.copy2(best_pt, target_pt)
        print(f"\n[SUCCESS] Successfully exported trained weights to: {target_pt}")
    else:
        # Fallback to last.pt or save current model weights
        model.save(target_pt)
        print(f"\n[SUCCESS] Saved current model weights to: {target_pt}")

    return target_pt

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Train License Plate Detector.")
    parser.add_argument("--epochs", type=int, default=10, help="Number of training epochs")
    parser.add_argument("--batch", type=int, default=16, help="Batch size")
    parser.add_argument("--imgsz", type=int, default=640, help="Input image size")
    parser.add_argument("--workers", type=int, default=4, help="Data loader workers")
    parser.add_argument("--device", type=str, default="cpu", help="Device (cpu, 0, etc.)")
    args = parser.parse_args()

    train_plate_model(
        epochs=args.epochs,
        batch=args.batch,
        imgsz=args.imgsz,
        workers=args.workers,
        device=args.device
    )
