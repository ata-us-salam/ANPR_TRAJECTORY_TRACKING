import easyocr
import numpy as np

class OCREngine:
    def __init__(self, lang=['en']):
        # Initialize EasyOCR
        self.reader = easyocr.Reader(lang, gpu=False) # GPU=False for generic compatibility
        
    def read_text(self, image: np.ndarray) -> tuple[str, float]:
        """
        Reads text from an image using EasyOCR.
        Returns a tuple of (detected_text, average_confidence)
        """
        try:
            # detail=1 returns bounding box, text, and confidence
            result = self.reader.readtext(image)
        except Exception as e:
            print(f"Warning: EasyOCR inference failed. Error: {e}")
            return "", 0.0
            
        if not result or len(result) == 0:
            return "", 0.0
            
        text_lines = []
        confidences = []
        
        for (bbox, text, conf) in result:
            text_lines.append(text)
            confidences.append(conf)
            
        full_text = "".join(text_lines).strip()
        avg_confidence = sum(confidences) / len(confidences) if confidences else 0.0
        
        return full_text, avg_confidence

    def read_from_variants(self, image_variants: dict) -> tuple[str, float]:
        """
        Runs OCR on multiple preprocessed variants of the image and returns the best result
        based on confidence score.
        """
        best_text = ""
        best_conf = 0.0
        
        for variant_name, img in image_variants.items():
            text, conf = self.read_text(img)
            if conf > best_conf:
                best_conf = conf
                best_text = text
                
        return best_text, best_conf
