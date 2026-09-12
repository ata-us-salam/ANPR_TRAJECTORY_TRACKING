import datetime
from sqlalchemy import func
from database.models import PlateEvent, Camera, get_session

class TrafficVolumeAnalyzer:
    def __init__(self, session=None):
        self.session = session or get_session()

    def get_summary_metrics(self):
        """Returns high-level surveillance metrics."""
        total_events = self.session.query(func.count(PlateEvent.id)).scalar() or 0
        total_unique_plates = self.session.query(func.count(func.distinct(PlateEvent.plate_text))).scalar() or 0
        total_cameras = self.session.query(func.count(Camera.id)).scalar() or 0
        active_cameras = self.session.query(func.count(Camera.id)).filter(Camera.status == 'ACTIVE').scalar() or 0
        
        # Today's detections
        today = datetime.datetime.utcnow().date()
        today_start = datetime.datetime.combine(today, datetime.time.min)
        today_events = self.session.query(func.count(PlateEvent.id))\
                                   .filter(PlateEvent.timestamp >= today_start).scalar() or 0

        # Average confidence
        avg_conf = self.session.query(func.avg(PlateEvent.confidence)).scalar() or 0.0

        return {
            "total_detections": total_events,
            "unique_vehicles": total_unique_plates,
            "total_cameras": total_cameras,
            "active_cameras": active_cameras,
            "today_detections": today_events,
            "avg_ocr_confidence": round(float(avg_conf) * 100, 1)
        }

    def get_vehicle_type_distribution(self):
        """Returns distribution of vehicle types across the city."""
        rows = self.session.query(
            PlateEvent.vehicle_type,
            func.count(PlateEvent.id)
        ).group_by(PlateEvent.vehicle_type).all()
        
        total = sum(count for _, count in rows) or 1
        distribution = []
        for v_type, count in rows:
            distribution.append({
                "vehicle_type": v_type or "Unknown",
                "count": count,
                "percentage": round((count / total) * 100, 1)
            })
        return distribution

    def get_hourly_traffic_volume(self):
        """Aggregates traffic volume by hour of day (0-23)."""
        events = self.session.query(PlateEvent.timestamp).all()
        hourly_counts = {h: 0 for h in range(24)}
        
        for (ts,) in events:
            if ts:
                hourly_counts[ts.hour] += 1
                
        return [
            {"hour": f"{h:02d}:00", "count": count}
            for h, count in hourly_counts.items()
        ]

    def get_busiest_cameras(self, limit: int = 5):
        """Returns cameras ranked by total vehicle count."""
        results = self.session.query(
            Camera.id,
            Camera.name,
            Camera.location_name,
            Camera.latitude,
            Camera.longitude,
            func.count(PlateEvent.id).label("total_vehicles")
        ).outerjoin(PlateEvent, Camera.id == PlateEvent.camera_id)\
         .group_by(Camera.id)\
         .order_by(func.count(PlateEvent.id).desc())\
         .limit(limit).all()

        return [
            {
                "camera_id": cid,
                "name": name,
                "location": loc,
                "latitude": lat,
                "longitude": lng,
                "vehicle_count": count
            }
            for cid, name, loc, lat, lng, count in results
        ]
