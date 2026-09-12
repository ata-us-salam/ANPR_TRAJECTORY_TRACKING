import cv2
import numpy as np
import os

os.makedirs('data', exist_ok=True)

def create_mock_car_image(text="OD02AB1234", filename="data/test_image_2.jpg"):
    # Create a dark gray image (the car)
    img = np.ones((480, 640, 3), dtype=np.uint8) * 100
    
    # Draw a white rectangle (the plate)
    plate_x1, plate_y1 = 200, 300
    plate_x2, plate_y2 = 440, 380
    cv2.rectangle(img, (plate_x1, plate_y1), (plate_x2, plate_y2), (255, 255, 255), -1)
    
    # Write text on the plate
    font = cv2.FONT_HERSHEY_SIMPLEX
    cv2.putText(img, text, (plate_x1 + 10, plate_y1 + 55), font, 1.2, (0, 0, 0), 3, cv2.LINE_AA)
    
    cv2.imwrite(filename, img)
    print(f"Created mock image: {filename}")

def create_mock_video(text="WB12AB1234", filename="data/test_video.mp4", duration_sec=3, fps=30):
    fourcc = cv2.VideoWriter_fourcc(*'mp4v')
    out = cv2.VideoWriter(filename, fourcc, fps, (640, 480))
    
    for i in range(duration_sec * fps):
        img = np.ones((480, 640, 3), dtype=np.uint8) * 100
        
        # Move the car horizontally
        offset = int(i * 2) 
        plate_x1, plate_y1 = 100 + offset, 300
        plate_x2, plate_y2 = 340 + offset, 380
        
        cv2.rectangle(img, (plate_x1, plate_y1), (plate_x2, plate_y2), (255, 255, 255), -1)
        
        font = cv2.FONT_HERSHEY_SIMPLEX
        cv2.putText(img, text, (plate_x1 + 10, plate_y1 + 55), font, 1.2, (0, 0, 0), 3, cv2.LINE_AA)
        
        out.write(img)
        
    out.release()
    print(f"Created mock video: {filename}")

if __name__ == "__main__":
    create_mock_car_image()
    create_mock_video()
