"""
Dedicated Two-Stage YOLOv8 License Plate Detector Training Suite.
Prepares vehicle crop datasets and trains YOLOv8 with high-resolution plate augmentations.
"""

import os
import sys
import argparse
from ultralytics import YOLO

BASE_DIR = os.path.dirname(os.path.abspath(__file__))

def prepare_dataset(output_dir: str, num_train: int = 200, num_val: int = 40):
    """
    Ensures dataset directory structure exists and populates with realistic Indian plates
    if not already present.
    """
    train_img_dir = os.path.join(output_dir, "images", "train")
    train_lbl_dir = os.path.join(output_dir, "labels", "train")
    val_img_dir = os.path.join(output_dir, "images", "val")
    val_lbl_dir = os.path.join(output_dir, "labels", "val")

    os.makedirs(train_img_dir, exist_ok=True)
    os.makedirs(train_lbl_dir, exist_ok=True)
    os.makedirs(val_img_dir, exist_ok=True)
    os.makedirs(val_lbl_dir, exist_ok=True)

    # Check if dataset already has images
    if len(os.listdir(train_img_dir)) >= 10:
        print(f"[Dataset] Found existing dataset in {output_dir} ({len(os.listdir(train_img_dir))} training samples).")
        return

    print(f"[Dataset] Generating {num_train} training and {num_val} validation samples...")
    try:
        from generate_training_dataset import create_synthetic_sample
        import cv2

        for i in range(num_train):
            img, bbox_yolo, _ = create_synthetic_sample(width=640, height=480)
            img_name = f"synth_plate_train_{i:04d}.jpg"
            lbl_name = f"synth_plate_train_{i:04d}.txt"
            cv2.imwrite(os.path.join(train_img_dir, img_name), img)
            with open(os.path.join(train_lbl_dir, lbl_name), "w") as f:
                xc, yc, nw, nh = bbox_yolo
                f.write(f"0 {xc:.6f} {yc:.6f} {nw:.6f} {nh:.6f}\n")

        for i in range(num_val):
            img, bbox_yolo, _ = create_synthetic_sample(width=640, height=480)
            img_name = f"synth_plate_val_{i:04d}.jpg"
            lbl_name = f"synth_plate_val_{i:04d}.txt"
            cv2.imwrite(os.path.join(val_img_dir, img_name), img)
            with open(os.path.join(val_lbl_dir, lbl_name), "w") as f:
                xc, yc, nw, nh = bbox_yolo
                f.write(f"0 {xc:.6f} {yc:.6f} {nw:.6f} {nh:.6f}\n")

        print(f"[Dataset] Successfully prepared dataset at {output_dir}.")
    except Exception as e:
        print(f"[Dataset Warning] Synthetic generation skipped: {e}")


def train(
    data_yaml: str = "plate_data.yaml",
    model_name: str = "yolov8n.pt",
    epochs: int = 150,
    batch: int = 16,
    imgsz: int = 640,
    dry_run: bool = False
):
    yaml_path = os.path.abspath(os.path.join(BASE_DIR, data_yaml))
    if not os.path.exists(yaml_path):
        raise FileNotFoundError(f"Dataset YAML not found: {yaml_path}")

    print("=" * 65)
    print("STAGE 2: TRAINING DEDICATED LICENSE PLATE DETECTOR (YOLOv8)")
    print(f"Data YAML:    {yaml_path}")
    print(f"Base Model:   {model_name}")
    print(f"Epochs:       {epochs}")
    print(f"Batch Size:   {batch}")
    print(f"Input Size:   {imgsz}")
    print("=" * 65)

    if dry_run:
        print("[DRY RUN] Verifying model configuration and architecture...")
        model = YOLO(model_name)
        print(f"[DRY RUN] Model loaded successfully: {model.model.__class__.__name__}")
        print("[DRY RUN] Configuration check passed.")
        return

    # Prepare dataset if needed
    dataset_root = os.path.join(BASE_DIR, "dataset", "plate_dataset")
    prepare_dataset(dataset_root, num_train=100, num_val=20)

    model = YOLO(model_name)
    results = model.train(
        data=yaml_path,
        epochs=epochs,
        batch=batch,
        imgsz=imgsz,
        hsv_h=0.015,
        hsv_s=0.5,
        hsv_v=0.3,
        degrees=10.0,
        shear=5.0,
        perspective=0.0005,
        mosaic=1.0,
        mixup=0.1,
        patience=30,
        project="models/detection/runs",
        name="plate_detector_experiment",
        exist_ok=True
    )

    print("\n[Training Complete] Model saved in models/detection/runs/plate_detector_experiment/weights/best.pt")
    return results


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Train YOLOv8 plate detector")
    parser.add_argument("--epochs", type=int, default=150, help="Number of epochs")
    parser.add_argument("--batch", type=int, default=16, help="Batch size")
    parser.add_argument("--imgsz", type=int, default=640, help="Input image dimension")
    parser.add_argument("--dry-run", action="store_true", help="Validate config without full training")
    args = parser.parse_args()

    train(
        epochs=args.epochs,
        batch=args.batch,
        imgsz=args.imgsz,
        dry_run=args.dry_run
    )
