import cv2
import numpy as np

class ImageEnhancer:
    def __init__(self):
        pass

    def preprocess_for_ocr(self, image: np.ndarray) -> dict:
        """
        Applies various preprocessing steps to a cropped plate image to improve OCR accuracy.
        Returns a dictionary of differently processed images.
        """
        results = {}
        
        # 1. Original
        results['original'] = image
        
        # 2. Resize 2x (Upscaling)
        height, width = image.shape[:2]
        resized = cv2.resize(image, (width * 2, height * 2), interpolation=cv2.INTER_CUBIC)
        results['resized'] = resized
        
        # 3. Grayscale
        gray = cv2.cvtColor(resized, cv2.COLOR_BGR2GRAY)
        results['grayscale'] = gray
        
        # 4. Contrast enhancement (CLAHE)
        clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
        contrast_enhanced = clahe.apply(gray)
        results['contrast'] = contrast_enhanced
        
        # 5. Sharpening
        kernel = np.array([[0, -1, 0], 
                           [-1, 5,-1], 
                           [0, -1, 0]])
        sharpened = cv2.filter2D(contrast_enhanced, -1, kernel)
        results['sharpened'] = sharpened
        
        return results
