import cv2
import numpy as np

class ImageEnhancer:
    def __init__(self):
        pass

    def preprocess_for_ocr(self, image: np.ndarray) -> dict:
        """
        Applies multi-stage super-resolution, deblurring, border padding,
        and adaptive binarization to cropped plate images to maximize OCR character extraction.
        Returns a dictionary of differently processed image variants.
        """
        if image is None or image.size == 0:
            return {}

        results = {}
        h, w = image.shape[:2]

        # 1. Base Original
        results['original'] = image

        # 2. Border Padding (prevents edge characters touching frame boundaries)
        pad_top = max(8, int(h * 0.12))
        pad_bot = max(8, int(h * 0.12))
        pad_left = max(12, int(w * 0.12))
        pad_right = max(12, int(w * 0.12))
        padded_bgr = cv2.copyMakeBorder(image, pad_top, pad_bot, pad_left, pad_right, cv2.BORDER_REPLICATE)

        # 3. Fast High-Quality Super-Resolution Upscaling (Cubic)
        target_w = max(320, w * 2)
        target_h = max(80, int(target_w * (h / max(1, w))))
        upscaled_bgr = cv2.resize(padded_bgr, (target_w, target_h), interpolation=cv2.INTER_CUBIC)
        results['padded_upscaled'] = upscaled_bgr

        # 4. Grayscale & Fast Gaussian Blur
        gray = cv2.cvtColor(upscaled_bgr, cv2.COLOR_BGR2GRAY)
        blurred = cv2.GaussianBlur(gray, (0, 0), sigmaX=1.5)
        unsharp = cv2.addWeighted(gray, 1.6, blurred, -0.6, 0)

        # 5. Adaptive High-Contrast Equalization (CLAHE)
        clahe = cv2.createCLAHE(clipLimit=2.5, tileGridSize=(8, 8))
        clahe_enhanced = clahe.apply(unsharp)
        results['clahe_sharp'] = clahe_enhanced
        results['contrast'] = clahe_enhanced

        # 6. Adaptive Gaussian Binarization
        adaptive_thresh = cv2.adaptiveThreshold(
            clahe_enhanced, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY, 19, 7
        )
        results['adaptive'] = adaptive_thresh

        return results


