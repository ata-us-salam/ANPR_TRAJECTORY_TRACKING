from collections import defaultdict
from database.models import Trajectory, Camera, get_session

class ODMatrixAnalyzer:
    def __init__(self, session=None):
        self.session = session or get_session()

    def get_od_matrix(self, limit: int = 10):
        """
        Computes the top Origin -> Destination pairs across all reconstructed vehicle trajectories.
        """
        trajectories = self.session.query(Trajectory).all()
        cameras = {c.id: c for c in self.session.query(Camera).all()}
        
        od_counts = defaultdict(lambda: {"count": 0, "total_duration": 0.0, "total_distance": 0.0})
        
        for t in trajectories:
            seq = t.camera_sequence
            if len(seq) >= 2:
                origin_id = seq[0]
                dest_id = seq[-1]
                if origin_id != dest_id:
                    pair_key = (origin_id, dest_id)
                    od_counts[pair_key]["count"] += 1
                    od_counts[pair_key]["total_duration"] += (t.duration_minutes or 0.0)
                    od_counts[pair_key]["total_distance"] += (t.distance_km or 0.0)

        results = []
        for (orig_id, dest_id), data in od_counts.items():
            orig_cam = cameras.get(orig_id)
            dest_cam = cameras.get(dest_id)
            if orig_cam and dest_cam:
                count = data["count"]
                avg_dur = round(data["total_duration"] / count, 1) if count > 0 else 0
                avg_dist = round(data["total_distance"] / count, 2) if count > 0 else 0
                results.append({
                    "origin_camera_id": orig_id,
                    "origin_name": orig_cam.name,
                    "origin_location": orig_cam.location_name,
                    "origin_lat": orig_cam.latitude,
                    "origin_lng": orig_cam.longitude,
                    "destination_camera_id": dest_id,
                    "destination_name": dest_cam.name,
                    "destination_location": dest_cam.location_name,
                    "destination_lat": dest_cam.latitude,
                    "destination_lng": dest_cam.longitude,
                    "trips_count": count,
                    "avg_duration_minutes": avg_dur,
                    "avg_distance_km": avg_dist
                })

        results.sort(key=lambda x: x["trips_count"], reverse=True)
        return results[:limit]

    def get_speed_anomalies(self, threshold_kmh: float = 60.0, limit: int = 15):
        """Identifies trajectories with average speeds exceeding a threshold."""
        trajectories = self.session.query(Trajectory)\
                           .filter(Trajectory.avg_speed_kmh >= threshold_kmh)\
                           .order_by(Trajectory.avg_speed_kmh.desc())\
                           .limit(limit).all()

        return [
            {
                "plate_text": t.plate_text,
                "avg_speed_kmh": t.avg_speed_kmh,
                "distance_km": t.distance_km,
                "duration_minutes": t.duration_minutes,
                "start_time": t.start_time.isoformat() if t.start_time else None,
                "end_time": t.end_time.isoformat() if t.end_time else None,
                "total_cameras": t.total_cameras
            }
            for t in trajectories
        ]
