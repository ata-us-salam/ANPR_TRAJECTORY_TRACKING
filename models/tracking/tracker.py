import numpy as np
from scipy.optimize import linear_sum_assignment

def calculate_iou(box1, box2):
    """
    Calculate IoU (Intersection over Union) between two bounding boxes.
    Box format: [x1, y1, x2, y2]
    """
    x1 = max(box1[0], box2[0])
    y1 = max(box1[1], box2[1])
    x2 = min(box1[2], box2[2])
    y2 = min(box1[3], box2[3])

    inter_area = max(0, x2 - x1) * max(0, y2 - y1)
    
    if inter_area == 0:
        return 0.0
        
    box1_area = (box1[2] - box1[0]) * (box1[3] - box1[1])
    box2_area = (box2[2] - box2[0]) * (box2[3] - box2[1])
    
    iou = inter_area / float(box1_area + box2_area - inter_area)
    return iou

class SimpleTracker:
    """
    A simple IoU-based tracker for assigning IDs to bounding boxes across frames.
    """
    def __init__(self, iou_threshold=0.3, max_age=5):
        self.iou_threshold = iou_threshold
        self.max_age = max_age
        
        self.tracks = {}  # track_id -> {'bbox': box, 'age': 0, 'class_id': class_id}
        self.next_track_id = 1
        
    def update(self, detections):
        """
        Updates the tracker with new detections.
        detections: list of dicts {'bbox': [x1, y1, x2, y2], 'confidence': c, 'class_id': id}
        Returns: list of dicts with an added 'track_id' field.
        """
        if not detections:
            # Increment age of all existing tracks
            for track_id in list(self.tracks.keys()):
                self.tracks[track_id]['age'] += 1
                if self.tracks[track_id]['age'] > self.max_age:
                    del self.tracks[track_id]
            return []

        # If no existing tracks, assign new IDs to all detections
        if not self.tracks:
            for det in detections:
                det['track_id'] = self.next_track_id
                self.tracks[self.next_track_id] = {'bbox': det['bbox'], 'age': 0, 'class_id': det['class_id']}
                self.next_track_id += 1
            return detections
            
        track_ids = list(self.tracks.keys())
        track_boxes = [self.tracks[tid]['bbox'] for tid in track_ids]
        det_boxes = [det['bbox'] for det in detections]
        
        # Calculate cost matrix (1 - IoU)
        cost_matrix = np.zeros((len(track_boxes), len(det_boxes)))
        for t, tbox in enumerate(track_boxes):
            for d, dbox in enumerate(det_boxes):
                cost_matrix[t, d] = 1.0 - calculate_iou(tbox, dbox)
                
        # Hungarian algorithm for assignment
        row_ind, col_ind = linear_sum_assignment(cost_matrix)
        
        assigned_tracks = set()
        assigned_dets = set()
        
        for r, c in zip(row_ind, col_ind):
            # If IoU is below threshold (cost is high), do not assign
            if cost_matrix[r, c] > (1.0 - self.iou_threshold):
                continue
                
            track_id = track_ids[r]
            det = detections[c]
            det['track_id'] = track_id
            
            # Update track
            self.tracks[track_id]['bbox'] = det['bbox']
            self.tracks[track_id]['age'] = 0
            
            assigned_tracks.add(r)
            assigned_dets.add(c)
            
        # Increment age for unassigned tracks and remove old ones
        for r, track_id in enumerate(track_ids):
            if r not in assigned_tracks:
                self.tracks[track_id]['age'] += 1
                if self.tracks[track_id]['age'] > self.max_age:
                    del self.tracks[track_id]
                    
        # Create new tracks for unassigned detections
        for c, det in enumerate(detections):
            if c not in assigned_dets:
                det['track_id'] = self.next_track_id
                self.tracks[self.next_track_id] = {'bbox': det['bbox'], 'age': 0, 'class_id': det['class_id']}
                self.next_track_id += 1
                
        return detections
