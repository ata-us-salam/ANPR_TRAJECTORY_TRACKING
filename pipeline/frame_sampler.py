import cv2

class FrameSampler:
    def __init__(self, target_fps: int = 5):
        self.target_fps = target_fps

    def sample_frames(self, video_path: str):
        """
        Generator that yields frames from a video file at the target FPS.
        Returns tuples of (frame_number, timestamp_sec, frame)
        """
        cap = cv2.VideoCapture(video_path)
        if not cap.isOpened():
            print(f"Error: Could not open video file {video_path}")
            return

        original_fps = cap.get(cv2.CAP_PROP_FPS)
        if original_fps <= 0:
            original_fps = 30.0 # Fallback

        # Calculate how many frames to skip to achieve target FPS
        frame_skip = max(1, int(round(original_fps / self.target_fps)))
        
        frame_idx = 0
        
        while True:
            ret, frame = cap.read()
            if not ret:
                break
                
            if frame_idx % frame_skip == 0:
                timestamp_sec = frame_idx / original_fps
                yield frame_idx, timestamp_sec, frame
                
            frame_idx += 1
            
        cap.release()
