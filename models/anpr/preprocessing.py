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

        # 2. Border Padding (Crucial for OCR: prevents edge characters touching frame boundaries)
        pad_top = max(10, int(h * 0.15))
        pad_bot = max(10, int(h * 0.15))
        pad_left = max(15, int(w * 0.15))
        pad_right = max(15, int(w * 0.15))
        padded_bgr = cv2.copyMakeBorder(image, pad_top, pad_bot, pad_left, pad_right, cv2.BORDER_REPLICATE)
        results['padded'] = padded_bgr

        # 3. Intelligent Multi-Scale Super-Resolution Upscaling (Lanczos-4)
        target_w = max(360, w * 3)
        target_h = max(100, int(target_w * (h / max(1, w))))
        scale_x = target_w / float(w)
        scale_y = target_h / float(h)
        upscaled_bgr = cv2.resize(padded_bgr, (0, 0), fx=scale_x, fy=scale_y, interpolation=cv2.INTER_LANCZOS4)
        results['padded_upscaled'] = upscaled_bgr

        # 4. Grayscale conversion
        gray = cv2.cvtColor(upscaled_bgr, cv2.COLOR_BGR2GRAY)
        results['grayscale'] = gray

        # 5. Bilateral Filtering (removes JPEG compression noise and grain while preserving sharp edges)
        bilateral = cv2.bilateralFilter(gray, d=9, sigmaColor=75, sigmaSpace=75)
        results['bilateral'] = bilateral

        # 6. Unsharp Masking & Deblurring (Laplacian / Gaussian edge enhancement)
        gaussian = cv2.GaussianBlur(bilateral, (0, 0), sigmaX=2.0)
        unsharp = cv2.addWeighted(bilateral, 1.85, gaussian, -0.85, 0)
        results['unsharp'] = unsharp

        # 7. Adaptive High-Contrast Equalization (CLAHE)
        clahe = cv2.createCLAHE(clipLimit=3.0, tileGridSize=(8, 8))
        clahe_enhanced = clahe.apply(unsharp)
        results['clahe_sharp'] = clahe_enhanced
        results['contrast'] = clahe_enhanced

        # 8. Adaptive Gaussian Binarization
        adaptive_thresh = cv2.adaptiveThreshold(
            clahe_enhanced, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY, 21, 8
        )
        results['adaptive'] = adaptive_thresh

        # 9. Otsu Global Binarization
        _, otsu_thresh = cv2.threshold(clahe_enhanced, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
        results['otsu'] = otsu_thresh

        # 10. Inverted Binarization (Handles yellow/dark plates or white-on-black lettering)
        results['inverted'] = cv2.bitwise_not(otsu_thresh)

        # 11. Morphological Refinement (opens small character gaps)
        kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (2, 2))
        morph_cleaned = cv2.morphologyEx(otsu_thresh, cv2.MORPH_CLOSE, kernel)
        results['morph_cleaned'] = morph_cleaned

        return results

