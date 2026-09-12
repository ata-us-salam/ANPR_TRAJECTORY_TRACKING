import re

class PlateValidator:
    def __init__(self):
        # Basic Indian plate pattern: State(2 chars) District(1-2 digits) Optional(1-3 chars) Number(4 digits)
        # e.g., OD02AB1234, WB12AB1234, DL01CA1234
        self.pattern = re.compile(r"^[A-Z]{2}[0-9]{1,2}[A-Z]{1,3}[0-9]{4}$")
        
        # Common OCR confusions mapping (can be used for position-aware correction later)
        self.char_to_num = {'O': '0', 'I': '1', 'Z': '2', 'S': '5', 'B': '8', 'G': '6'}
        self.num_to_char = {'0': 'O', '1': 'I', '2': 'Z', '5': 'S', '8': 'B', '6': 'G'}

    def is_valid(self, plate_text: str) -> bool:
        """
        Check if the given plate text matches the basic Indian registration format.
        """
        plate_text = plate_text.upper().replace(" ", "").replace("-", "")
        return bool(self.pattern.match(plate_text))

    def clean_text(self, plate_text: str) -> str:
        """
        Clean the text and correct common OCR confusions based on expected format.
        """
        # Remove non-alphanumeric chars
        cleaned = re.sub(r'[^A-Z0-9]', '', plate_text.upper())
        
        # Strip 'IND' prefix that is commonly found on Indian HSRP plates
        if cleaned.startswith("IND"):
            cleaned = cleaned[3:]
        
        # If length is roughly correct (9-10 chars), try position-based correction
        # Format: AA(0-1) NN(2-3) [A](4) [AA](4-5) NNNN(6-9)
        # We will do a simple heuristic for the first 2 letters and next 2 numbers
        if len(cleaned) >= 9:
            corrected = list(cleaned)
            # First two should be letters
            for i in range(2):
                if corrected[i] in self.num_to_char:
                    corrected[i] = self.num_to_char[corrected[i]]
            # Next two should be numbers (State code)
            for i in range(2, 4):
                if corrected[i] in self.char_to_num:
                    corrected[i] = self.char_to_num[corrected[i]]
            
            # Last four should be numbers
            for i in range(len(corrected)-4, len(corrected)):
                if corrected[i] in self.char_to_num:
                    corrected[i] = self.char_to_num[corrected[i]]
                    
            cleaned = "".join(corrected)
            
        return cleaned
