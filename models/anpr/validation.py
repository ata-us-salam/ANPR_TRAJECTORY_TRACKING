import re

INDIAN_RTO_STATE_CODES = {
    "OD": ("Odisha", "Bhubaneswar / Cuttack Region"),
    "OR": ("Odisha", "Odisha State"),
    "DL": ("Delhi", "National Capital Territory"),
    "MH": ("Maharashtra", "Mumbai / Pune Region"),
    "WB": ("West Bengal", "Kolkata Region"),
    "KA": ("Karnataka", "Bengaluru Region"),
    "TN": ("Tamil Nadu", "Chennai Region"),
    "UP": ("Uttar Pradesh", "Lucknow / NCR Region"),
    "HR": ("Haryana", "Gurugram / Faridabad Region"),
    "CH": ("Chandigarh", "Union Territory"),
    "GJ": ("Gujarat", "Ahmedabad Region"),
    "TS": ("Telangana", "Hyderabad Region"),
    "AP": ("Andhra Pradesh", "Amaravati / Visakhapatnam Region"),
    "KL": ("Kerala", "Thiruvananthapuram / Kochi Region"),
    "RJ": ("Rajasthan", "Jaipur Region"),
    "PB": ("Punjab", "Amritsar / Ludhiana Region"),
    "MP": ("Madhya Pradesh", "Bhopal / Indore Region"),
    "BR": ("Bihar", "Patna Region"),
    "JH": ("Jharkhand", "Ranchi Region"),
    "AS": ("Assam", "Guwahati Region"),
    "UK": ("Uttarakhand", "Dehradun Region"),
    "UA": ("Uttarakhand", "Dehradun Region"),
    "HP": ("Himachal Pradesh", "Shimla Region"),
    "GA": ("Goa", "Panaji Region")
}

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

    def get_rto_details(self, plate_text: str) -> dict:
        """
        Extracts state name, RTO district code, series, and number from an Indian plate.
        """
        cleaned = self.clean_text(plate_text)
        state_code = cleaned[:2] if len(cleaned) >= 2 else ""
        state_info = INDIAN_RTO_STATE_CODES.get(state_code, ("Indian Union", "Standard Regional Transport"))
        
        rto_match = re.match(r"^([A-Z]{2})([0-9]{1,2})([A-Z]{0,3})([0-9]{1,4})$", cleaned)
        if rto_match:
            st, dist, series, num = rto_match.groups()
            return {
                "state_code": st,
                "state_name": state_info[0],
                "rto_jurisdiction": f"RTO {dist} ({state_info[1]})",
                "series": series,
                "registration_number": num,
                "hsrp_standard": True
            }
        return {
            "state_code": state_code,
            "state_name": state_info[0],
            "rto_jurisdiction": state_info[1],
            "series": "",
            "registration_number": cleaned[4:] if len(cleaned) > 4 else cleaned,
            "hsrp_standard": False
        }

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
