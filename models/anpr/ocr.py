import numpy as np

class OCREngine:
    def __init__(self, lang=['en']):
        # 1. Initialize PaddleOCR if available
        self.paddle_ocr = None
        try:
            from paddleocr import PaddleOCR
            self.paddle_ocr = PaddleOCR(use_textline_orientation=True, lang='en')
            print("[OCR] PaddleOCR engine initialized successfully.")
        except Exception as e:
            print(f"[OCR] PaddleOCR initialization skipped: {e}")

        # 2. Initialize EasyOCR
        self.easy_reader = None
        try:
            import easyocr
            self.easy_reader = easyocr.Reader(lang, gpu=False)
            print("[OCR] EasyOCR engine initialized successfully.")
        except Exception as e:
            print(f"[OCR] EasyOCR initialization skipped: {e}")

    def read_text_paddle(self, image: np.ndarray) -> tuple[str, float]:
        """Reads text using PaddleOCR."""
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
            result = self.easy_reader.readtext(image, workers=0, batch_size=1)
            if not result:
                return "", 0.0
            texts = []
            confs = []
            for item in result:
                if len(item) >= 3:
                    texts.append(str(item[1]).strip())
                    confs.append(float(item[2]))
            full_text = "".join(texts).strip()
            avg_confidence = sum(confs) / len(confs) if confs else 0.0
            return full_text, avg_confidence
        except Exception:
            return "", 0.0

    def read_text(self, image: np.ndarray) -> tuple[str, float]:
        """
        Reads text from an image. Uses fast high-accuracy PaddleOCR if available.
        Only falls back to EasyOCR if PaddleOCR is completely absent.
        """
        # 1. Prioritize PaddleOCR
        if self.paddle_ocr is not None:
            p_text, p_conf = self.read_text_paddle(image)
            return p_text, p_conf

        # 2. EasyOCR fallback only when PaddleOCR is not installed
        if self.easy_reader is not None:
            e_text, e_conf = self.read_text_easy(image)
            return e_text, e_conf

        return "", 0.0

    def read_from_variants(self, image_variants: dict) -> tuple[str, float]:
        """
        Runs OCR on primary preprocessed variants ('enhanced', 'original') and returns the best result.
        Uses early exit if confident detection is reached to conserve CPU and guarantee sub-second response times.
        """
        best_text = ""
        best_conf = 0.0
        
        priority_keys = ['enhanced', 'original']
        ordered_variants = [(k, image_variants[k]) for k in priority_keys if k in image_variants]
        if not ordered_variants:
            ordered_variants = list(image_variants.items())[:2]

        for variant_name, img in ordered_variants:
            text, conf = self.read_text(img)
            if conf > best_conf:
                best_conf = conf
                best_text = text
            # Early exit for efficiency on CPU
            if best_conf >= 0.60 and len(best_text) >= 4:
                break
                
        return best_text, best_conf
