import sys
import os
import cv2

# Add the project root to sys.path so we can import from models
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from models.detection.vehicle_detector import VehicleDetector
from models.detection.plate_detector import PlateDetector
from models.anpr.preprocessing import ImageEnhancer
from models.anpr.ocr import OCREngine
from models.anpr.validation import PlateValidator

class SingleImagePipeline:
    def __init__(self):
        print("Initializing AI Models...")
        self.vehicle_detector = VehicleDetector()
        self.plate_detector = PlateDetector()
        self.enhancer = ImageEnhancer()
        self.ocr_engine = OCREngine()
        self.validator = PlateValidator()
        print("Models Initialized Successfully.")

    def run(self, image_path: str):
        print(f"--- Running Pipeline for {image_path} ---")
        
        # 1. Load Image
        image = cv2.imread(image_path)
        if image is None:
            print(f"Error: Could not read image at {image_path}")
            return None
            
        # 2. Detect Vehicles
        vehicles = self.vehicle_detector.detect(image)
        print(f"Detected {len(vehicles)} vehicle(s).")
        
        results = []
        
        for idx, vehicle in enumerate(vehicles):
            vx1, vy1, vx2, vy2 = vehicle['bbox']
            vehicle_img = image[vy1:vy2, vx1:vx2]
            
            # 3. Detect Plates in Vehicle
            plates = self.plate_detector.detect(vehicle_img)
            print(f"  Vehicle {idx+1}: Detected {len(plates)} plate(s).")
            
            for p_idx, plate in enumerate(plates):
                px1, py1, px2, py2 = plate['bbox']
                # Coordinates are relative to vehicle crop
                plate_img = vehicle_img[py1:py2, px1:px2]
                
                # 4. Image Enhancement
                variants = self.enhancer.preprocess_for_ocr(plate_img)
                
                # 5. OCR on variants
                text, conf = self.ocr_engine.read_from_variants(variants)
                
                # 6. Validation
                cleaned_text = self.validator.clean_text(text)
                is_valid = self.validator.is_valid(cleaned_text)
                
                print(f"    Plate {p_idx+1}: OCR='{cleaned_text}', Confidence={conf:.2f}, Valid={is_valid}")
                
                results.append({
                    'vehicle_idx': idx,
                    'plate_idx': p_idx,
                    'text': cleaned_text,
                    'confidence': conf,
                    'is_valid': is_valid,
                    'bbox': [vx1+px1, vy1+py1, vx1+px2, vy1+py2] # absolute bbox
                })
                
        return results

from pipeline.frame_sampler import FrameSampler
from models.tracking.tracker import SimpleTracker
from models.tracking.temporal_voting import TemporalVoting
import datetime

class VideoPipeline:
    def __init__(self, target_fps=5):
        self.image_pipeline = SingleImagePipeline()
        self.frame_sampler = FrameSampler(target_fps=target_fps)
        self.tracker = SimpleTracker(iou_threshold=0.3, max_age=5)
        self.voting = TemporalVoting()

    def run(self, video_path: str):
        print(f"--- Running Pipeline for Video {video_path} ---")
        
        # We start a mock start time for demonstration
        start_time = datetime.datetime.now()
        
        for frame_idx, timestamp_sec, frame in self.frame_sampler.sample_frames(video_path):
            print(f"\nProcessing Frame {frame_idx} (t={timestamp_sec:.2f}s)")
            
            # Detect vehicles
            vehicles = self.image_pipeline.vehicle_detector.detect(frame)
            
            # Update tracks
            tracked_vehicles = self.tracker.update(vehicles)
            
            for vehicle in tracked_vehicles:
                vx1, vy1, vx2, vy2 = vehicle['bbox']
                track_id = vehicle['track_id']
                vehicle_img = frame[vy1:vy2, vx1:vx2]
                
                # Check for empty crop
                if vehicle_img.size == 0:
                    continue
                    
                plates = self.image_pipeline.plate_detector.detect(vehicle_img)
                
                for plate in plates:
                    px1, py1, px2, py2 = plate['bbox']
                    plate_img = vehicle_img[py1:py2, px1:px2]
                    
                    if plate_img.size == 0:
                        continue
                        
                    variants = self.image_pipeline.enhancer.preprocess_for_ocr(plate_img)
                    text, conf = self.image_pipeline.ocr_engine.read_from_variants(variants)
                    cleaned_text = self.image_pipeline.validator.clean_text(text)
                    is_valid = self.image_pipeline.validator.is_valid(cleaned_text)
                    
                    current_time = start_time + datetime.timedelta(seconds=timestamp_sec)
                    
                    # Add to voting system
                    self.voting.add_read(track_id, cleaned_text, conf, is_valid, current_time)
                    
                    if cleaned_text:
                        print(f"  Track {track_id}: Plate {cleaned_text} (Conf: {conf:.2f}, Valid: {is_valid})")
            
        print("\n--- Video Processing Complete ---")
        print("Finalizing Plate Readings using Temporal Majority Voting...")
        
        final_plates = self.voting.get_all_finalized_plates()
        
        for p in final_plates:
            print(f"\nFinal Result for Vehicle Track ID {p['track_id']}:")
            print(f"  Plate: {p['plate_text']} (Valid: {p['valid']})")
            print(f"  Aggregated Confidence: {p['confidence']:.2f}")
            print(f"  Total Reads/Frames: {p['reads_count']} / {p['total_track_frames']}")
            
        return final_plates

if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser(description="Run ANPR pipeline.")
    parser.add_argument("--image", type=str, help="Path to input image.")
    parser.add_argument("--video", type=str, help="Path to input video.")
    parser.add_argument("--fps", type=int, default=5, help="Target FPS for video processing.")
    args = parser.parse_args()
    
    if args.image:
        pipeline = SingleImagePipeline()
        pipeline.run(args.image)
    elif args.video:
        pipeline = VideoPipeline(target_fps=args.fps)
        pipeline.run(args.video)
    else:
        print("Please provide --image or --video argument.")
