import cv2
import numpy as np

class ImageEnhancer:
    def __init__(self):
        pass

    def correct_perspective(self, image: np.ndarray) -> np.ndarray:
        """
        Detects 4 plate corners and warps tilted/skewed plates to a fronto-parallel rectangle.
        If no distinct 4-corner quadrilateral is detected, returns the original image safely.
        """
        if image is None or image.size == 0:
            return image
        h, w = image.shape[:2]
        if h < 20 or w < 40:
            return image

        gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY) if len(image.shape) == 3 else image
        blurred = cv2.GaussianBlur(gray, (5, 5), 0)
        edges = cv2.Canny(blurred, 40, 140)
        kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (7, 3))
        closed = cv2.morphologyEx(edges, cv2.MORPH_CLOSE, kernel)
        contours, _ = cv2.findContours(closed, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

        best_cnt = None
        max_area = 0
        img_area = w * h
        for c in contours:
            area = cv2.contourArea(c)
            if area > 0.15 * img_area:
                peri = cv2.arcLength(c, True)
                approx = cv2.approxPolyDP(c, 0.04 * peri, True)
                if len(approx) == 4 and area > max_area:
                    best_cnt = approx
                    max_area = area

        if best_cnt is not None:
            pts = best_cnt.reshape(4, 2).astype(np.float32)
            s = pts.sum(axis=1)
            rect = np.zeros((4, 2), dtype=np.float32)
            rect[0] = pts[np.argmin(s)]       # Top-left
            rect[2] = pts[np.argmax(s)]       # Bottom-right
            diff = np.diff(pts, axis=1)
            rect[1] = pts[np.argmin(diff)]    # Top-right
            rect[3] = pts[np.argmax(diff)]    # Bottom-left

            (tl, tr, br, bl) = rect
            widthA = np.sqrt(((br[0] - bl[0]) ** 2) + ((br[1] - bl[1]) ** 2))
            widthB = np.sqrt(((tr[0] - tl[0]) ** 2) + ((tr[1] - tl[1]) ** 2))
            maxW = max(int(widthA), int(widthB))
            heightA = np.sqrt(((tr[0] - br[0]) ** 2) + ((tr[1] - br[1]) ** 2))
            heightB = np.sqrt(((tl[0] - bl[0]) ** 2) + ((tl[1] - bl[1]) ** 2))
            maxH = max(int(heightA), int(heightB))

            if maxW >= 40 and maxH >= 15 and 1.8 <= float(maxW) / max(1, maxH) <= 6.0:
                dst = np.array([[0, 0], [maxW - 1, 0], [maxW - 1, maxH - 1], [0, maxH - 1]], dtype=np.float32)
                M = cv2.getPerspectiveTransform(rect, dst)
                warped = cv2.warpPerspective(image, M, (maxW, maxH))
                return warped

        return image

    def preprocess_for_ocr(self, image: np.ndarray) -> dict:
        """
        Applies multi-stage perspective correction, super-resolution (target height >= 64px),
        CLAHE contrast enhancement, and adaptive binarization for OCR recognition.
        """
        if image is None or image.size == 0:
            return {}

        results = {}

        # 1. Perspective deskewing
        rectified = self.correct_perspective(image)
        results['original'] = rectified

        h, w = rectified.shape[:2]

        # 2. Border Padding (prevents edge characters touching frame boundaries)
        pad_top = max(8, int(h * 0.12))
        pad_bot = max(8, int(h * 0.12))
        pad_left = max(14, int(w * 0.12))
        pad_right = max(14, int(w * 0.12))
        padded_bgr = cv2.copyMakeBorder(rectified, pad_top, pad_bot, pad_left, pad_right, cv2.BORDER_REPLICATE)

        # 3. Super-Resolution Upscaling (guarantee target height >= 64px, target width >= 280px)
        target_h = max(64, max(80, int(h * 2.0)))
        target_w = max(280, max(int(w * 2.0), int(target_h * max(2.5, float(w) / max(1, h)))))
        upscaled_bgr = cv2.resize(padded_bgr, (target_w, target_h), interpolation=cv2.INTER_CUBIC)
        results['padded_upscaled'] = upscaled_bgr

        # 4. Grayscale & Unsharp Masking
        gray = cv2.cvtColor(upscaled_bgr, cv2.COLOR_BGR2GRAY)
        blurred = cv2.GaussianBlur(gray, (0, 0), sigmaX=1.5)
        unsharp = cv2.addWeighted(gray, 1.65, blurred, -0.65, 0)

        # 5. Adaptive High-Contrast Equalization (CLAHE)
        clahe = cv2.createCLAHE(clipLimit=2.8, tileGridSize=(8, 8))
        clahe_enhanced = clahe.apply(unsharp)
        results['clahe_sharp'] = clahe_enhanced
        results['contrast'] = clahe_enhanced

        # 6. Adaptive Gaussian Binarization
        adaptive_thresh = cv2.adaptiveThreshold(
            clahe_enhanced, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY, 19, 7
        )
        results['adaptive'] = adaptive_thresh

        return results



