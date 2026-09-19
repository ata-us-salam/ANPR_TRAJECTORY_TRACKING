import numpy as np

class OCREngine:
    def __init__(self, lang=['en']):
        self.last_detected_tokens = []
        self.paddle_ocr = None
        self.easy_reader = None

        # 1. Initialize PaddleOCR with runtime compatibility check
        try:
            from paddleocr import PaddleOCR
            p_engine = PaddleOCR(use_textline_orientation=True, lang='en')
            # Test run with dummy 32x64 image to verify oneDNN/PIR runtime support
            dummy = np.zeros((32, 64, 3), dtype=np.uint8)
            p_engine.ocr(dummy)
            self.paddle_ocr = p_engine
            print("[OCR] PaddleOCR engine initialized and verified.")
        except Exception as e:
            # Common on Python 3.13 / oneDNN PIR environments
            print(f"[OCR] PaddleOCR runtime unavailable ({type(e).__name__}); cascading to high-accuracy EasyOCR.")
            self.paddle_ocr = None

        # 2. Initialize EasyOCR
        try:
            import easyocr
            self.easy_reader = easyocr.Reader(lang, gpu=False)
            print("[OCR] EasyOCR engine initialized successfully.")
        except Exception as e:
            print(f"[OCR] EasyOCR initialization warning: {e}")

    def read_text_paddle(self, image: np.ndarray) -> tuple[str, float]:
        """Reads text using PaddleOCR safely."""
        if not self.paddle_ocr or image is None or image.size == 0:
            return "", 0.0
        try:
            result = self.paddle_ocr.ocr(image)
            if not result:
                return "", 0.0
            
            texts = []
            confs = []
            for res in result:
                if res and isinstance(res, list):
                    for line in res:
                        if isinstance(line, list) and len(line) >= 2:
                            txt_info = line[1]
                            if isinstance(txt_info, (tuple, list)):
                                text = str(txt_info[0]).strip()
                                conf = float(txt_info[1])
                                texts.append(text)
                                confs.append(conf)
            full_text = "".join(texts).strip()
            avg_confidence = sum(confs) / len(confs) if confs else 0.0
            return full_text, avg_confidence
        except Exception:
            return "", 0.0

    def read_text_easy(self, image: np.ndarray) -> tuple[str, float]:
        """Reads text using EasyOCR safely without multi-worker deadlocks."""
        if not self.easy_reader or image is None or image.size == 0:
            return "", 0.0
        try:
            # workers=0 and batch_size=1 prevent PyTorch DataLoader spinlocks on Windows CPU
            result = self.easy_reader.readtext(image, workers=0, batch_size=1, detail=1)
            if not result:
                # Try with whitelist for alphanumeric characters
                result = self.easy_reader.readtext(
                    image, workers=0, batch_size=1, detail=1,
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
        Reads text from an image. Uses PaddleOCR if verified working,
        otherwise seamlessly executes EasyOCR.
        """
        # 1. Prioritize PaddleOCR if verified
        if self.paddle_ocr is not None:
            p_text, p_conf = self.read_text_paddle(image)
            if p_text and p_conf > 0.30:
                return p_text, p_conf

        # 2. EasyOCR engine
        if self.easy_reader is not None:
            e_text, e_conf = self.read_text_easy(image)
            if e_text:
                return e_text, e_conf

        return "", 0.0

    def read_from_variants(self, image_variants: dict) -> tuple[str, float]:
        """
        Runs OCR on preprocessed image variants in optimal priority order.
        Accumulates partial character candidates and returns the best recognition result.
        """
        self.last_detected_tokens = []
        if not image_variants:
            return "", 0.0

        best_text = ""
        best_conf = 0.0
        all_tokens = []

        # Optimal priority sequence for blurred/small surveillance plates
        priority_order = [
            'padded_upscaled',
            'clahe_sharp',
            'bilateral',
            'unsharp',
            'adaptive',
            'otsu',
            'contrast',
            'sharpened',
            'grayscale',
            'original'
        ]

        ordered_variants = []
        for k in priority_order:
            if k in image_variants:
                ordered_variants.append((k, image_variants[k]))

        # Include any remaining variants not in priority list
        for k, v in image_variants.items():
            if (k, v) not in ordered_variants:
                ordered_variants.append((k, v))

        for variant_name, img in ordered_variants:
            if img is None or img.size == 0:
                continue

            text, conf = self.read_text(img)
            clean_token = "".join(c for c in text.upper() if c.isalnum())
            if clean_token:
                all_tokens.append(clean_token)

            if conf > best_conf or (len(clean_token) > len(best_text) and conf >= 0.40):
                best_conf = max(best_conf, conf)
                best_text = text

            # Early exit if we already have a long confident read (e.g. full Indian plate)
            if best_conf >= 0.78 and len(clean_token) >= 8:
                break

        self.last_detected_tokens = all_tokens
        return best_text, best_conf

