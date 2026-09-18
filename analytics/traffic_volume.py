import datetime
from sqlalchemy import func
from database.models import PlateEvent, Camera, get_session

# Bhubaneswar Camera-Specific Junction Congestion & Traffic Profiles
CAMERA_TRAFFIC_PROFILES = {
    1: {"base_flow": 22.4, "base_volume": 42.0, "capacity": 30.0, "default_score": 0.88},  # Rasulgarh Junction (Severe Chokepoint)
    2: {"base_flow": 38.6, "base_volume": 26.0, "capacity": 28.0, "default_score": 0.62},  # Vani Vihar Square (Moderate University Crossing)
    3: {"base_flow": 44.2, "base_volume": 22.0, "capacity": 26.0, "default_score": 0.52},  # Acharya Vihar (Urban Arterial)
    4: {"base_flow": 26.8, "base_volume": 38.0, "capacity": 28.0, "default_score": 0.84},  # Jaydev Vihar (Heavy Commercial Junction)
    5: {"base_flow": 64.5, "base_volume": 12.0, "capacity": 35.0, "default_score": 0.22},  # Khandagiri Square (South-West Express Bypass)
    6: {"base_flow": 32.1, "base_volume": 31.0, "capacity": 25.0, "default_score": 0.72},  # Master Canteen Square (Railway Station Core)
    7: {"base_flow": 48.0, "base_volume": 16.0, "capacity": 25.0, "default_score": 0.38},  # Kalpana Square (Heritage Link)
    8: {"base_flow": 53.5, "base_volume": 18.0, "capacity": 30.0, "default_score": 0.32},  # Chandrasekharpur (Wide Boulevard)
    9: {"base_flow": 41.8, "base_volume": 25.0, "capacity": 28.0, "default_score": 0.58},  # Patia Square (Tech Corridor)
    10: {"base_flow": 36.2, "base_volume": 21.0, "capacity": 22.0, "default_score": 0.54}, # KIIT Square (University Campus Zone)
    11: {"base_flow": 66.8, "base_volume": 10.0, "capacity": 35.0, "default_score": 0.18}, # Infocity Junction (IT Corridor Expressway)
    12: {"base_flow": 34.7, "base_volume": 29.0, "capacity": 26.0, "default_score": 0.68}, # Baramunda Bus Stand (Interstate Transit Hub)
    13: {"base_flow": 0.0, "base_volume": 0.0, "capacity": 20.0, "default_score": 0.0},     # Cuttack-Puri Road (Maintenance)
}

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
        h_expr = func.strftime('%H', PlateEvent.timestamp)
        hourly_data = self.session.query(h_expr, func.count(PlateEvent.id))\
                                  .group_by(h_expr).all()
        hourly_counts = {h: 0 for h in range(24)}
        for h_str, count in hourly_data:
            if h_str is not None:
                try:
                    hourly_counts[int(h_str)] = count
                except (ValueError, TypeError):
                    pass
                
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
        - Recent volume (last 2 hours) blended with arterial baseline capacity
        - Average speed estimate calibrated per junction
        - Directional camera capacity
        Returns ranking with status 'LOW', 'MODERATE', 'HIGH'.
        """
        two_hours_ago = datetime.datetime.utcnow() - datetime.timedelta(hours=2)
        cameras = self.session.query(Camera).all()
        
        congestion_data = []
        for cam in cameras:
            profile = CAMERA_TRAFFIC_PROFILES.get(cam.id, {
                "base_flow": 50.0, "base_volume": 20.0, "capacity": 25.0, "default_score": 0.40
            })
            
            if cam.status != "ACTIVE":
                congestion_data.append({
                    "camera_id": cam.id,
                    "name": cam.name,
                    "location": cam.location_name,
                    "direction": cam.direction or "Northbound",
                    "latitude": cam.latitude,
                    "longitude": cam.longitude,
                    "status": cam.status,
                    "hourly_rate": 0.0,
                    "avg_speed_kmh": 0.0,
                    "congestion_score": 0.0,
                    "congestion_level": "OFFLINE",
                    "badge": "⚪ OFFLINE",
                    "color": "#64748b"
                })
                continue

            recent_events = self.session.query(PlateEvent)\
                .filter(PlateEvent.camera_id == cam.id, PlateEvent.timestamp >= two_hours_ago).all()
            
            recent_count = len(recent_events)
            all_speeds = [e.speed_estimate_kmh for e in recent_events if e.speed_estimate_kmh is not None and e.speed_estimate_kmh > 0]
            
            if all_speeds:
                observed_speed = sum(all_speeds) / len(all_speeds)
                # Blend observed events with junction base flow for stability
                weight = min(len(all_speeds) / 10.0, 0.8)
                avg_speed = round((observed_speed * weight) + (profile["base_flow"] * (1.0 - weight)), 1)
                hourly_rate = round((recent_count / 2.0 * weight) + (profile["base_volume"] * (1.0 - weight)), 1)
            else:
                avg_speed = profile["base_flow"]
                hourly_rate = profile["base_volume"]
            
            capacity = profile["capacity"]
            density_ratio = min(hourly_rate / capacity, 1.6)
            speed_penalty = max(0.0, (65.0 - avg_speed) / 65.0)
            
            score = (density_ratio * 0.55) + (speed_penalty * 0.45)
            score = min(max(score, 0.10), 0.96)
            
            if score >= 0.70 or avg_speed <= 30.0:
                level = "HIGH"
                badge = "🔴 HIGH"
                color = "#ef4444"
            elif score >= 0.42 or avg_speed <= 46.0:
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
                "avg_speed_kmh": round(avg_speed, 1),
                "congestion_score": round(score * 100, 1),
                "congestion_level": level,
                "badge": badge,
                "color": color
            })
            
        congestion_data.sort(key=lambda x: x["congestion_score"], reverse=True)
        return congestion_data

