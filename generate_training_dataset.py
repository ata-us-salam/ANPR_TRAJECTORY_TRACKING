"""
Synthetic YOLO Training & Validation Dataset Generator for License Plate Detection.
Generates images with realistic vehicles and Indian license plates with YOLO format bounding boxes.
"""

import os
import random
import cv2
import numpy as np

# Sample realistic Indian states and registration series
INDIAN_STATES = ["DL", "MH", "KA", "TN", "UP", "HR", "TS", "GJ", "WB", "OD", "KL", "RJ"]
VEHICLE_COLORS = [
    (40, 40, 40),      # Dark charcoal / black
    (210, 210, 210),  # Silver / white
    (25, 25, 140),    # Crimson / red
    (150, 70, 20),    # Blue
    (30, 80, 50),     # Dark green
    (70, 70, 80)      # Slate gray
]

def generate_random_plate_text():
    state = random.choice(INDIAN_STATES)
    rto = f"{random.randint(1, 99):02d}"
    series = "".join(random.choices("ABCDEFGHJKLMNPQRSTUVWXYZ", k=random.choice([1, 2])))
    num = f"{random.randint(1, 9999):04d}"
    return f"{state}{rto}{series}{num}"

def create_synthetic_sample(width=640, height=480):
    """
    Renders a realistic synthetic vehicle rear/front with an annotated license plate.
    Returns:
        image: np.ndarray (H, W, 3)
        plate_bbox_yolo: (x_center, y_center, norm_w, norm_h)
        plate_text: str
    """
    # Background road / environment
    bg_color = random.choice([(50, 55, 60), (70, 75, 80), (45, 50, 55)])
    img = np.full((height, width, 3), bg_color, dtype=np.uint8)

    # Road asphalt at bottom
    cv2.rectangle(img, (0, int(height * 0.7)), (width, height), (35, 38, 42), -1)

    # Vehicle body
    car_color = random.choice(VEHICLE_COLORS)
    v_w = random.randint(int(width * 0.55), int(width * 0.85))
    v_h = random.randint(int(height * 0.45), int(height * 0.65))
    v_x1 = (width - v_w) // 2 + random.randint(-20, 20)
    v_y1 = height - v_h - random.randint(30, 70)
    v_x2 = v_x1 + v_w
    v_y2 = v_y1 + v_h

    # Vehicle body rectangle with rounded-like bumper
    cv2.rectangle(img, (v_x1, v_y1), (v_x2, v_y2), car_color, -1)
    
    # Windshield / glass
    ws_h = int(v_h * 0.35)
    ws_margin = int(v_w * 0.12)
    cv2.rectangle(img, (v_x1 + ws_margin, v_y1 + 10), (v_x2 - ws_margin, v_y1 + ws_h), (25, 30, 35), -1)

    # Taillights
    light_w = int(v_w * 0.12)
    light_h = int(v_h * 0.12)
    light_y = v_y1 + int(v_h * 0.45)
    cv2.rectangle(img, (v_x1 + 10, light_y), (v_x1 + 10 + light_w, light_y + light_h), (0, 0, 200), -1)
    cv2.rectangle(img, (v_x2 - 10 - light_w, light_y), (v_x2 - 10, light_y + light_h), (0, 0, 200), -1)

    # License plate region (white or yellow plate background)
    plate_text = generate_random_plate_text()
    p_w = random.randint(180, 250)
    p_h = random.randint(45, 65)
    p_x1 = (width - p_w) // 2 + random.randint(-15, 15)
    p_y1 = v_y2 - p_h - random.randint(20, 50)
    p_x2 = p_x1 + p_w
    p_y2 = p_y1 + p_h

    plate_bg = (245, 245, 245) if random.random() > 0.3 else (0, 215, 255) # White or Commercial Yellow
    cv2.rectangle(img, (p_x1, p_y1), (p_x2, p_y2), plate_bg, -1)
    cv2.rectangle(img, (p_x1, p_y1), (p_x2, p_y2), (0, 0, 0), 2) # Border

    # Draw plate text
    font = cv2.FONT_HERSHEY_SIMPLEX
    font_scale = p_h / 48.0
    text_size = cv2.getTextSize(plate_text, font, font_scale, 2)[0]
    tx = p_x1 + (p_w - text_size[0]) // 2
    ty = p_y1 + (p_h + text_size[1]) // 2
    cv2.putText(img, plate_text, (tx, ty), font, font_scale, (10, 10, 10), 2, cv2.LINE_AA)

    # Add subtle Gaussian noise / lighting gradient
    if random.random() > 0.5:
        img = cv2.GaussianBlur(img, (3, 3), 0)

    # Normalize YOLO coordinates: [class_id, x_center, y_center, width, height]
    x_center = ((p_x1 + p_x2) / 2.0) / width
    y_center = ((p_y1 + p_y2) / 2.0) / height
    norm_w = (p_x2 - p_x1) / float(width)
    norm_h = (p_y2 - p_y1) / float(height)

    return img, (x_center, y_center, norm_w, norm_h), plate_text

def build_yolo_dataset(base_dir="dataset", train_count=40, val_count=10):
    """Generates train and validation images and annotations for YOLO training."""
    images_train = os.path.join(base_dir, "images", "train")
    images_val = os.path.join(base_dir, "images", "val")
    labels_train = os.path.join(base_dir, "labels", "train")
    labels_val = os.path.join(base_dir, "labels", "val")

    for p in [images_train, images_val, labels_train, labels_val]:
        os.makedirs(p, exist_ok=True)

    print(f"Generating {train_count} training samples and {val_count} validation samples in '{base_dir}'...")

    # Generate training set
    for i in range(train_count):
        img, bbox, plate = create_synthetic_sample()
        img_name = f"train_plate_{i:04d}.jpg"
        lbl_name = f"train_plate_{i:04d}.txt"
        cv2.imwrite(os.path.join(images_train, img_name), img)
        with open(os.path.join(labels_train, lbl_name), "w") as f:
            f.write(f"0 {bbox[0]:.6f} {bbox[1]:.6f} {bbox[2]:.6f} {bbox[3]:.6f}\n")

    # Generate validation set
    for i in range(val_count):
        img, bbox, plate = create_synthetic_sample()
        img_name = f"val_plate_{i:04d}.jpg"
        lbl_name = f"val_plate_{i:04d}.txt"
        cv2.imwrite(os.path.join(images_val, img_name), img)
        with open(os.path.join(labels_val, lbl_name), "w") as f:
            f.write(f"0 {bbox[0]:.6f} {bbox[1]:.6f} {bbox[2]:.6f} {bbox[3]:.6f}\n")

    # Write data.yaml configuration file
    yaml_content = f"""# YOLOv8 License Plate Detection Configuration
path: {os.path.abspath(base_dir)}
train: images/train
val: images/val

names:
  0: license_plate
"""
    yaml_path = os.path.join(base_dir, "data.yaml")
    with open(yaml_path, "w") as f:
        f.write(yaml_content)

    print(f"Dataset generation complete. Configuration written to: {yaml_path}")
    return yaml_path

if __name__ == "__main__":
    build_yolo_dataset()
