"""
Extracts, enhances, and annotates frames from user-provided MP4 videos in dataset/
to augment the YOLOv8 license plate detection dataset.
"""

import os
import glob
import random
import cv2
import numpy as np
from ultralytics import YOLO

def extract_and_label_video_frames(
    dataset_dir="dataset",
    sample_interval_sec=1.0,
    train_ratio=0.85
):
    video_files = glob.glob(os.path.join(dataset_dir, "*.mp4"))
    print(f"Discovered {len(video_files)} video file(s) in {dataset_dir}:")
    for vf in video_files:
        print(f"  - {os.path.basename(vf)}")

    if not video_files:
        print("No videos found to process.")
        return

    # Load base detector for pseudo-labeling / refinement
    base_plate_model_path = "models/detection/weights/license_plate_detector.pt"
    if os.path.exists(base_plate_model_path):
        plate_detector = YOLO(base_plate_model_path)
    else:
        plate_detector = YOLO("yolov8n.pt")

    train_img_dir = os.path.join(dataset_dir, "images", "train")
    val_img_dir = os.path.join(dataset_dir, "images", "val")
    train_lbl_dir = os.path.join(dataset_dir, "labels", "train")
    val_lbl_dir = os.path.join(dataset_dir, "labels", "val")

    os.makedirs(train_img_dir, exist_ok=True)
    os.makedirs(val_img_dir, exist_ok=True)
    os.makedirs(train_lbl_dir, exist_ok=True)
    os.makedirs(val_lbl_dir, exist_ok=True)

    total_extracted = 0
    total_labeled = 0

    clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))

    for v_idx, v_path in enumerate(video_files):
        v_name = os.path.splitext(os.path.basename(v_path))[0].replace(" ", "_")
        cap = cv2.VideoCapture(v_path)
        if not cap.isOpened():
            print(f"Warning: Could not open video {v_path}")
            continue

        fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
        frame_interval = max(1, int(fps * sample_interval_sec))
        frame_num = 0
        saved_from_video = 0

        print(f"\nProcessing video [{v_idx+1}/{len(video_files)}]: {os.path.basename(v_path)} (FPS: {fps:.1f}, Interval: every {frame_interval} frames)")

        while True:
            ret, frame = cap.read()
            if not ret:
                break

            if frame_num % frame_interval == 0:
                h, w = frame.shape[:2]

                # Resize ultra-high-res frames (e.g. 4K) to standard resolution (max dimension 1280)
                max_dim = max(h, w)
                scale = 1.0
                if max_dim > 1280:
                    scale = 1280.0 / max_dim
                    frame_resized = cv2.resize(frame, (int(w * scale), int(h * scale)), interpolation=cv2.INTER_AREA)
                else:
                    frame_resized = frame

                rh, rw = frame_resized.shape[:2]

                # Preprocess: mild bilateral filtering + CLAHE on L channel for clear plate edges
                lab = cv2.cvtColor(frame_resized, cv2.COLOR_BGR2LAB)
                l, a, b = cv2.split(lab)
                cl = clahe.apply(l)
                enhanced_frame = cv2.cvtColor(cv2.merge((cl, a, b)), cv2.COLOR_LAB2BGR)

                # Run detector to find candidate license plate locations
                results = plate_detector(enhanced_frame, conf=0.20, verbose=False)
                boxes = []
                for r in results:
                    for b_box in r.boxes:
                        bx1, by1, bx2, by2 = b_box.xyxy[0].tolist()
                        bw_box = bx2 - bx1
                        bh_box = by2 - by1
                        
                        # Filter reasonable aspect ratio for Indian plates (width/height usually 1.8 to 5.5)
                        if bh_box > 8 and bw_box > 18:
                            aspect = bw_box / float(bh_box)
                            if 1.5 <= aspect <= 6.0:
                                # Convert to YOLO normalized format: class_id, x_center, y_center, width, height
                                x_center = (bx1 + bx2) / (2.0 * rw)
                                y_center = (by1 + by2) / (2.0 * rh)
                                norm_w = bw_box / float(rw)
                                norm_h = bh_box / float(rh)
                                boxes.append((0, x_center, y_center, norm_w, norm_h))

                # If model missed plates in CCTV scene, apply morphological candidate fallback
                if not boxes:
                    gray = cv2.cvtColor(enhanced_frame, cv2.COLOR_BGR2GRAY)
                    grad_x = cv2.Sobel(gray, cv2.CV_16S, 1, 0, ksize=3)
                    abs_grad = cv2.convertScaleAbs(grad_x)
                    _, thresh = cv2.threshold(abs_grad, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
                    kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (15, 3))
                    closed = cv2.morphologyEx(thresh, cv2.MORPH_CLOSE, kernel)
                    contours, _ = cv2.findContours(closed, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

                    for cnt in contours:
                        cx, cy, cw, ch = cv2.boundingRect(cnt)
                        if ch >= 12 and cw >= 35:
                            aspect = cw / float(ch)
                            area = cw * ch
                            if 2.0 <= aspect <= 5.2 and (area / float(rw * rh)) < 0.1:
                                x_center = (cx + cw / 2.0) / float(rw)
                                y_center = (cy + ch / 2.0) / float(rh)
                                norm_w = cw / float(rw)
                                norm_h = ch / float(rh)
                                boxes.append((0, x_center, y_center, norm_w, norm_h))
                                break # Keep top candidate

                if boxes:
                    # Decide train vs val split
                    is_train = (random.random() < train_ratio)
                    target_img_dir = train_img_dir if is_train else val_img_dir
                    target_lbl_dir = train_lbl_dir if is_train else val_lbl_dir

                    sample_id = f"video_{v_name}_f{frame_num:05d}"
                    img_filename = f"{sample_id}.jpg"
                    lbl_filename = f"{sample_id}.txt"

                    cv2.imwrite(os.path.join(target_img_dir, img_filename), enhanced_frame)

                    with open(os.path.join(target_lbl_dir, lbl_filename), "w") as f:
                        for cls_id, xc, yc, nw, nh in boxes:
                            f.write(f"{cls_id} {xc:.6f} {yc:.6f} {nw:.6f} {nh:.6f}\n")

                    saved_from_video += 1
                    total_labeled += 1

                total_extracted += 1

            frame_num += 1

        cap.release()
        print(f"  Extracted & annotated {saved_from_video} keyframes from {os.path.basename(v_path)}")

    print(f"\n[DONE] Extraction complete: {total_labeled} new annotated frames added to dataset.")

if __name__ == "__main__":
    extract_and_label_video_frames()
