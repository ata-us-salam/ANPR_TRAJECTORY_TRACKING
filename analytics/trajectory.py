import math
import datetime
import json
import os
import sys

sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from database.models import PlateEvent, Trajectory, Camera, get_session

def haversine_distance_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Calculate the great-circle distance between two points in km."""
    R = 6371.0  # Earth's radius in kilometers
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlambda = math.radians(lon2 - lon1)
    
    a = math.sin(dphi / 2.0) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlambda / 2.0) ** 2
    c = 2.0 * math.atan2(math.sqrt(a), math.sqrt(1.0 - a))
    return R * c

class TrajectoryEngine:
    def __init__(self, session=None):
        self.session = session or get_session()
        
    def build_trajectories_for_plate(self, plate_text: str, time_window_hours: float = 4.0, commit: bool = True):
        """
        Groups PlateEvents for a specific plate into Trajectories based on a time gap window.
        If the gap between two successive sightings exceeds time_window_hours, a new trajectory starts.
        """
        events = self.session.query(PlateEvent).filter(PlateEvent.plate_text == plate_text)\
                             .order_by(PlateEvent.timestamp).all()
                     
        if not events:
            return []
            
        trajectory_groups = []
        current_group = [events[0]]
        
        for i in range(1, len(events)):
            time_diff = (events[i].timestamp - events[i-1].timestamp).total_seconds() / 3600.0
            if time_diff > time_window_hours:
                trajectory_groups.append(current_group)
                current_group = [events[i]]
            else:
                current_group.append(events[i])
                
        trajectory_groups.append(current_group)
        
        saved_trajectories = []
        
        # Clear existing trajectories for this plate to rebuild fresh
        if commit:
            self.session.query(Trajectory).filter(Trajectory.plate_text == plate_text).delete()
            self.session.flush()

        for group in trajectory_groups:
            start_time = group[0].timestamp
            end_time = group[-1].timestamp
            total_duration_sec = (end_time - start_time).total_seconds()
            duration_minutes = total_duration_sec / 60.0
            
            # Extract ordered coordinates and camera IDs
            path_coords = []
            camera_ids = []
            total_distance_km = 0.0
            
            for idx, event in enumerate(group):
                cam = event.camera
                if cam and cam.latitude is not None and cam.longitude is not None:
                    path_coords.append({
                        "lat": cam.latitude,
                        "lng": cam.longitude,
                        "name": cam.name,
                        "location": cam.location_name,
                        "camera_id": cam.id,
                        "timestamp": event.timestamp.isoformat(),
                        "speed_kmh": event.speed_estimate_kmh
                    })
                    camera_ids.append(cam.id)
                    
                    if idx > 0:
                        prev_cam = group[idx - 1].camera
                        if prev_cam:
                            seg_dist = haversine_distance_km(
                                prev_cam.latitude, prev_cam.longitude,
                                cam.latitude, cam.longitude
                            )
                            total_distance_km += seg_dist
            
            # Compute average speed (km/h) with physical sanity capping
            if total_duration_sec > 5.0 and total_distance_km > 0.05:
                raw_speed = (total_distance_km / (total_duration_sec / 3600.0))
                # Cap speed between 5.0 km/h and 250.0 km/h
                avg_speed_kmh = max(5.0, min(raw_speed, 250.0))
            else:
                # Fallback to mean of speed estimates if single spot or very brief transit
                speeds = [e.speed_estimate_kmh for e in group if e.speed_estimate_kmh and e.speed_estimate_kmh > 0]
                avg_speed_kmh = (sum(speeds) / len(speeds)) if speeds else 40.0

            duration_minutes = max(0.1, duration_minutes)
                
            traj = Trajectory(
                plate_text=plate_text,
                start_time=start_time,
                end_time=end_time,
                total_cameras=len(path_coords),
                distance_km=round(total_distance_km, 2),
                avg_speed_kmh=round(avg_speed_kmh, 1),
                duration_minutes=round(duration_minutes, 1),
                path_coordinates_json=json.dumps(path_coords),
                camera_sequence_json=json.dumps(camera_ids)
            )
            
            if commit:
                self.session.add(traj)
            saved_trajectories.append(traj)
            
        if commit:
            self.session.commit()
            
        return saved_trajectories

    def rebuild_all_trajectories(self):
        """Reconstruct trajectories for all unique plates in plate_events."""
        unique_plates = self.session.query(PlateEvent.plate_text).distinct().all()
        rebuilt = []
        for (plate,) in unique_plates:
            rebuilt.extend(self.build_trajectories_for_plate(plate, commit=True))
        return rebuilt

if __name__ == "__main__":
    engine = TrajectoryEngine()
    print("Trajectory Engine Initialized.")
