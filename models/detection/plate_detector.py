import os
import cv2
import numpy as np
from ultralytics import YOLO

class PlateDetector:
    def __init__(self, model_path: str = 'models/detection/weights/license_plate_detector.pt'):
        """
        Initializes the YOLO model for license plate detection.
        If weights do not exist or fail to load, uses an OpenCV morphological
        candidate localization fallback to isolate horizontal plate regions.
        """
        self.model_loaded = False
        if os.path.exists(model_path):
            try:
                self.model = YOLO(model_path)
                self.model_loaded = True
            except Exception as e:
                print(f"Warning: Could not load plate detector model from {model_path}. Error: {e}")
                self.model_loaded = False
        else:
            self.model_loaded = False

    def _morphological_plate_candidates(self, image: np.ndarray) -> list:
        """
        Extracts candidate license plate bounding boxes from a vehicle crop using
        morphological filtering, horizontal gradient edge detection, and aspect-ratio heuristics.
        """
        h, w = image.shape[:2]
        if h < 20 or w < 30:
            return [{'bbox': [0, 0, w, h], 'confidence': 0.5}]

        # If already cropped close to plate aspect ratio (width/height 2.0 to 5.5 and small)
        ratio = float(w) / float(h)
        if 2.0 <= ratio <= 5.5 and h <= 160:
            return [{'bbox': [0, 0, w, h], 'confidence': 0.85}]

        gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY) if len(image.shape) == 3 else image
        
        # Sobel horizontal gradient to accentuate vertical strokes of license plate characters
        grad_x = cv2.Sobel(gray, cv2.CV_16S, 1, 0, ksize=3)
        abs_grad_x = cv2.convertScaleAbs(grad_x)
        
        # Blur and Otsu thresholding
        blurred = cv2.GaussianBlur(abs_grad_x, (5, 5), 0)
        _, thresh = cv2.threshold(blurred, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
        
        # Morphological close with wide horizontal kernel to connect character edges
        kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (17, 3))
        closed = cv2.morphologyEx(thresh, cv2.MORPH_CLOSE, kernel)
        
        contours, _ = cv2.findContours(closed, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        
        candidates = []
        img_area = float(w * h)
        
        for c in contours:
            bx, by, bw, bh = cv2.boundingRect(c)
            if bh == 0:
                continue
            ar = float(bw) / float(bh)
            area = float(bw * bh)
            area_ratio = area / img_area
            
            # Typical license plates: aspect ratio between 1.8 and 5.8, occupying 0.5% to 30% of vehicle crop
            if 1.8 <= ar <= 5.8 and 0.005 <= area_ratio <= 0.35 and bw >= 30 and bh >= 10:
                candidates.append({
                    'bbox': [int(bx), int(by), int(bx + bw), int(by + bh)],
                    'confidence': 0.75,
                    'area': area
                })
        
        if candidates:
            # Sort candidates by proximity to bumper region or area
            candidates.sort(key=lambda x: x['area'], reverse=True)
            return [{'bbox': c['bbox'], 'confidence': c['confidence']} for c in candidates[:2]]
        
        # Fallback: lower 45% center region where license plates commonly sit on vehicles
        margin_x = int(w * 0.15)
        top_y = int(h * 0.50)
        bot_y = int(h * 0.95)
        return [{
            'bbox': [margin_x, top_y, w - margin_x, bot_y],
            'confidence': 0.60
        }]

    def detect(self, image: np.ndarray, conf_threshold: float = 0.25, imgsz: int = 320):
        """
        Detects license plates in a given image (vehicle crop or full frame).
        Returns a list of dictionaries with bounding box [x1, y1, x2, y2] and confidence.
        """
        if not self.model_loaded:
            return self._morphological_plate_candidates(image)
            
        results = self.model(image, conf=conf_threshold, verbose=False, imgsz=imgsz)
        
        plates = []
        for result in results:
            boxes = result.boxes
            for box in boxes:
                x1, y1, x2, y2 = box.xyxy[0].tolist()
                conf = box.conf[0].item()
                
                plates.append({
                    'bbox': [int(x1), int(y1), int(x2), int(y2)],
                    'confidence': conf
                })
                
        if not plates:
            return self._morphological_plate_candidates(image)

        return plates
