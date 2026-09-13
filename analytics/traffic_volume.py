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

    def get_congestion_status(self):
        """
        Calculates dynamic congestion scores for all smart city camera nodes based on:
        - Recent volume (last 2 hours)
        - Average speed estimate
        - Directional camera capacity
        Returns ranking with status 'LOW', 'MODERATE', 'HIGH'.
        """
        two_hours_ago = datetime.datetime.utcnow() - datetime.timedelta(hours=2)
        cameras = self.session.query(Camera).all()
        
        congestion_data = []
        for cam in cameras:
            recent_events = self.session.query(PlateEvent)\
                .filter(PlateEvent.camera_id == cam.id, PlateEvent.timestamp >= two_hours_ago).all()
            
            recent_count = len(recent_events)
            all_speeds = [e.speed_estimate_kmh for e in recent_events if e.speed_estimate_kmh is not None]
            avg_speed = round(sum(all_speeds) / len(all_speeds), 1) if all_speeds else 50.0
            
            # Congestion logic:
            # High count + low average speed = high congestion
            # Estimated design capacity = 25 vehicles / hr per checkpoint
            capacity = 25.0
            hourly_rate = recent_count / 2.0
            density_ratio = min(hourly_rate / capacity, 1.5)
            
            # Speed penalty: slow traffic (<35 km/h) on arterials
            speed_penalty = max(0.0, (55.0 - avg_speed) / 55.0)
            
            score = (density_ratio * 0.6) + (speed_penalty * 0.4)
            score = min(max(score, 0.05), 0.98)
            
            if score >= 0.70 or avg_speed < 30:
                level = "HIGH"
                badge = "🔴 HIGH"
                color = "#ef4444"
            elif score >= 0.40 or avg_speed < 45:
                level = "MODERATE"
                badge = "🟡 MODERATE"
                color = "#f59e0b"
            else:
                level = "LOW"
                badge = "🟢 LOW"
                color = "#10b981"
                
            congestion_data.append({
                "camera_id": cam.id,
                "name": cam.name,
                "location": cam.location_name,
                "direction": cam.direction or "Northbound",
                "latitude": cam.latitude,
                "longitude": cam.longitude,
                "status": cam.status,
                "hourly_rate": round(hourly_rate, 1),
                "avg_speed_kmh": avg_speed,
                "congestion_score": round(score * 100, 1),
                "congestion_level": level,
                "badge": badge,
                "color": color
            })
            
        congestion_data.sort(key=lambda x: x["congestion_score"], reverse=True)
        return congestion_data

