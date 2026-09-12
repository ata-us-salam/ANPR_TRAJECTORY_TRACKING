"""
Converts Pascal VOC XML annotations from uploaded Indian number plate datasets
(archive 12, archive 10) into YOLOv8 format with an 85/15 train/val split.
"""

import os
import glob
import shutil
import random
import cv2
import xml.etree.ElementTree as ET

def find_matching_image(xml_path):
    p = os.path.normpath(xml_path)
    parts = p.split(os.sep)
    arch_dir = os.path.join(parts[0], parts[1])
    stem = os.path.splitext(parts[-1])[0]
    
    # Check same directory first
    for ext in ['.jpg', '.jpeg', '.png', '.JPG', '.JPEG', '.PNG']:
        cand = os.path.join(os.path.dirname(p), stem + ext)
        if os.path.exists(cand):
            return cand

    # Check filename attribute in XML
    try:
        tree = ET.parse(xml_path)
        fn = tree.getroot().find('filename')
        if fn is not None and fn.text:
            cand = os.path.join(os.path.dirname(p), fn.text)
            if os.path.exists(cand):
                return cand
            cand = os.path.join(os.path.dirname(p), os.path.basename(fn.text))
            if os.path.exists(cand):
                return cand
    except Exception:
        pass

    # Search in the archive directory
    for m in glob.glob(f'{arch_dir}/**/{stem}.*', recursive=True):
        if os.path.splitext(m)[1].lower() in ['.jpg', '.jpeg', '.png']:
            return m

    return None

def convert_and_build_dataset(
    output_base="dataset",
    train_split=0.85,
    seed=42
):
    random.seed(seed)

    # Gather all XML files from archive (12) and archive (10)
    xml_files = glob.glob('dataset/archive (12)/**/*.xml', recursive=True) + \
                glob.glob('dataset/archive (10)/**/*.xml', recursive=True)
    
    print(f"Total XML annotations discovered: {len(xml_files)}")

    samples = []
    skipped = 0

    for xml_path in xml_files:
        img_path = find_matching_image(xml_path)
        if not img_path:
            skipped += 1
            continue

        try:
            tree = ET.parse(xml_path)
            root = tree.getroot()
            boxes = []
            for obj in root.findall('object'):
                bnd = obj.find('bndbox')
                if bnd is not None:
                    xmin = float(bnd.find('xmin').text)
                    ymin = float(bnd.find('ymin').text)
                    xmax = float(bnd.find('xmax').text)
                    ymax = float(bnd.find('ymax').text)
                    if xmax > xmin and ymax > ymin:
                        boxes.append((xmin, ymin, xmax, ymax))

            if not boxes:
                skipped += 1
                continue

            samples.append((img_path, xml_path, boxes))
        except Exception as e:
            skipped += 1
            continue

    print(f"Valid matched image-annotation pairs: {len(samples)} (skipped {skipped})")

    # Shuffle samples
    random.shuffle(samples)

    split_idx = int(len(samples) * train_split)
    train_samples = samples[:split_idx]
    val_samples = samples[split_idx:]

    print(f"Train samples: {len(train_samples)}, Val samples: {len(val_samples)}")

    # Target directories
    dirs = {
        'train_img': os.path.join(output_base, 'images', 'train'),
        'val_img': os.path.join(output_base, 'images', 'val'),
        'train_lbl': os.path.join(output_base, 'labels', 'train'),
        'val_lbl': os.path.join(output_base, 'labels', 'val'),
    }

    # Clean previous generated images/labels
    for p in dirs.values():
        if os.path.exists(p):
            shutil.rmtree(p)
        os.makedirs(p, exist_ok=True)

    def process_split(sample_list, img_dir, lbl_dir, prefix):
        written = 0
        for idx, (img_path, _, boxes) in enumerate(sample_list):
            img = cv2.imread(img_path)
            if img is None:
                continue

            h, w = img.shape[:2]
            if h <= 0 or w <= 0:
                continue

            filename_base = f"{prefix}_{idx:05d}"
            target_img_path = os.path.join(img_dir, f"{filename_base}.jpg")
            target_lbl_path = os.path.join(lbl_dir, f"{filename_base}.txt")

            # Save JPEG image
            cv2.imwrite(target_img_path, img)

            # Write YOLO labels
            with open(target_lbl_path, "w", encoding="utf-8") as f:
                for (xmin, ymin, xmax, ymax) in boxes:
                    # Clip coordinates to image boundary
                    xmin = max(0.0, min(float(w), xmin))
                    ymin = max(0.0, min(float(h), ymin))
                    xmax = max(0.0, min(float(w), xmax))
                    ymax = max(0.0, min(float(h), ymax))

                    bw = xmax - xmin
                    bh = ymax - ymin
                    if bw <= 0 or bh <= 0:
                        continue

                    x_center = (xmin + bw / 2.0) / w
                    y_center = (ymin + bh / 2.0) / h
                    norm_w = bw / w
                    norm_h = bh / h

                    # class 0: license_plate
                    f.write(f"0 {x_center:.6f} {y_center:.6f} {norm_w:.6f} {norm_h:.6f}\n")

            written += 1
        return written

    print("Writing training set...")
    train_written = process_split(train_samples, dirs['train_img'], dirs['train_lbl'], "indian_plate_train")
    print(f"Successfully processed {train_written} training images.")

    print("Writing validation set...")
    val_written = process_split(val_samples, dirs['val_img'], dirs['val_lbl'], "indian_plate_val")
    print(f"Successfully processed {val_written} validation images.")

    # Write data.yaml
    data_yaml_content = f"""# YOLOv8 License Plate Detection Configuration (Real Indian Number Plates)
path: {os.path.abspath(output_base)}
train: images/train
val: images/val

names:
  0: license_plate
"""
    yaml_path = os.path.join(output_base, "data.yaml")
    with open(yaml_path, "w", encoding="utf-8") as f:
        f.write(data_yaml_content)

    print(f"Updated {yaml_path} successfully.")
    return train_written, val_written, yaml_path

if __name__ == "__main__":
    convert_and_build_dataset()
