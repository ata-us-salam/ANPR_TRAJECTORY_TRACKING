import os
import sys
import numpy as np

# Global cached EasyOCR reader to avoid redundant re-initializations
_GLOBAL_EASY_READER = None

class OCREngine:
    def __init__(self, lang=['en']):
        global _GLOBAL_EASY_READER
        self.last_detected_tokens = []
        self.paddle_ocr = None
        self.easy_reader = None

        # 1. Check PaddleOCR only if explicitly enabled via environment variable
        if os.getenv("ENABLE_PADDLEOCR", "false").lower() in ("true", "1") and sys.version_info < (3, 13):
            try:
                from paddleocr import PaddleOCR
                self.paddle_ocr = PaddleOCR(use_textline_orientation=True, lang='en')
                print("[OCR] PaddleOCR engine initialized.")
            except Exception as e:
                print(f"[OCR] PaddleOCR unavailable: {e}")
                self.paddle_ocr = None

        # 2. Fast High-Accuracy EasyOCR (Cached Globally)
        if _GLOBAL_EASY_READER is None:
            try:
                import easyocr
                _GLOBAL_EASY_READER = easyocr.Reader(lang, gpu=False)
                print("[OCR] Cached EasyOCR engine initialized successfully.")
            except Exception as e:
                print(f"[OCR] EasyOCR initialization warning: {e}")

        self.easy_reader = _GLOBAL_EASY_READER

    def read_text_paddle(self, image: np.ndarray, is_crop: bool = True) -> tuple[str, float]:
        """Reads text using PaddleOCR in direct recognition mode (det=False) on pre-cropped plates."""
        if not self.paddle_ocr or image is None or image.size == 0:
            return "", 0.0
        try:
            # Use det=False when processing already cropped plates to skip redundant text detection
            result = self.paddle_ocr.ocr(image, det=not is_crop, cls=False)
            if not result:
                return "", 0.0
            
            texts = []
            confs = []
            if is_crop:
                for item in result:
                    if isinstance(item, (list, tuple)) and len(item) >= 2:
                        if isinstance(item[0], str) and isinstance(item[1], (float, int)):
                            texts.append(item[0].strip())
                            confs.append(float(item[1]))
                        elif isinstance(item[0], list):
                            for sub in item:
                                if isinstance(sub, (list, tuple)) and len(sub) >= 2:
                                    texts.append(str(sub[0]).strip())
                                    confs.append(float(sub[1]))
            else:
                for res in result:
                    if res and isinstance(res, list):
                        for line in res:
                            if isinstance(line, list) and len(line) >= 2:
                                txt_info = line[1]
                                if isinstance(txt_info, (tuple, list)):
                                    texts.append(str(txt_info[0]).strip())
                                    confs.append(float(txt_info[1]))
            full_text = "".join(texts).strip()
            avg_confidence = sum(confs) / len(confs) if confs else 0.0
            return full_text, avg_confidence
        except Exception:
            return "", 0.0

    def read_text_easy(self, image: np.ndarray) -> tuple[str, float]:
        """
        Reads text using EasyOCR restricted to 36 alphanumeric characters (A-Z, 0-9),
        avoiding dictionary confusion and character drift.
        """
        if not self.easy_reader or image is None or image.size == 0:
            return "", 0.0
        try:
            # Enforce 36-char alphanumeric vocabulary (A-Z, 0-9) matching Indian RTO plates
            result = self.easy_reader.readtext(
                image,
                workers=0,
                batch_size=1,
                detail=1,
                paragraph=False,
                allowlist='0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ'
            )
            if not result:
                return "", 0.0

            texts = []
            confs = []
            for item in result:
                if len(item) >= 3:
                    raw = str(item[1]).strip()
                    if raw:
                        texts.append(raw)
                        confs.append(float(item[2]))
            full_text = "".join(texts).strip()
            avg_confidence = sum(confs) / len(confs) if confs else 0.0
            return full_text, avg_confidence
        except Exception:
            return "", 0.0

    def read_text(self, image: np.ndarray) -> tuple[str, float]:
        """
        Reads text from an image. Uses PaddleOCR if enabled/verified,
        otherwise seamlessly executes EasyOCR.
        """
        if self.paddle_ocr is not None:
            p_text, p_conf = self.read_text_paddle(image)
            if p_text and p_conf > 0.30:
                return p_text, p_conf

        if self.easy_reader is not None:
            e_text, e_conf = self.read_text_easy(image)
            if e_text:
                return e_text, e_conf

        return "", 0.0

    def read_from_variants(
        self,
        image_variants: dict,
        validator = None,
        fast_mode: bool = False
    ) -> tuple[str, float]:
        """
        Runs OCR on prioritized preprocessed image variants with early-exit.
        Immediately terminates upon detecting a verified valid license plate.
        """
        self.last_detected_tokens = []
        if not image_variants:
            return "", 0.0

        best_text = ""
        best_conf = 0.0
        all_tokens = []

        # High-yield priority sequence
        if fast_mode:
            priority_order = ['clahe_sharp', 'original']
            max_variants = 1
        else:
            priority_order = ['clahe_sharp', 'padded_upscaled', 'adaptive', 'original']
            max_variants = 3

        ordered_variants = []
        for k in priority_order:
            if k in image_variants:
                ordered_variants.append((k, image_variants[k]))

        variants_checked = 0
        for variant_name, img in ordered_variants:
            if img is None or img.size == 0:
                continue

            variants_checked += 1
            text, conf = self.read_text(img)
            clean_token = "".join(c for c in text.upper() if c.isalnum())
            if clean_token:
                all_tokens.append(clean_token)

            # Check if cleaned plate is valid Indian registration
            if validator is not None:
                cleaned_val = validator.clean_text(text)
                if validator.is_valid(cleaned_val) and len(cleaned_val) >= 8 and conf >= 0.40:
                    self.last_detected_tokens = [clean_token]
                    return text, max(best_conf, conf)

            if conf > best_conf or (len(clean_token) > len(best_text) and conf >= 0.40):
                best_conf = max(best_conf, conf)
                best_text = text

            # Early exit on confident plate read
            if best_conf >= 0.70 and len(clean_token) >= 8:
                break

            if variants_checked >= max_variants:
                break

        self.last_detected_tokens = all_tokens
        return best_text, best_conf


