"""
Camera health monitoring service.
Tracks camera uptime, detection rates, and last-seen timestamps.
"""

import datetime
from sqlalchemy import func
from database.models import Camera, PlateEvent, get_session


class CameraHealthService:
    """Provides camera health metrics and monitoring data."""

    def __init__(self, session=None):
        self.session = session or get_session()

    def get_camera_health_matrix(self):
        """
        Returns a detailed health matrix for all cameras including:
        - Status, total detections, detection rate per hour,
        - Last active time, uptime percentage estimate
        """
        now = datetime.datetime.utcnow()
        twenty_four_hours_ago = now - datetime.timedelta(hours=24)

        cameras = self.session.query(Camera).order_by(Camera.id).all()

        health_data = []
        for cam in cameras:
            # Total all-time detections
            total_detections = (
                self.session.query(func.count(PlateEvent.id))
                .filter(PlateEvent.camera_id == cam.id)
                .scalar() or 0
            )

            # Detections in last 24 hours
            recent_detections = (
                self.session.query(func.count(PlateEvent.id))
                .filter(
                    PlateEvent.camera_id == cam.id,
                    PlateEvent.timestamp >= twenty_four_hours_ago,
                )
                .scalar() or 0
            )

            # Last detection timestamp
            last_event = (
                self.session.query(func.max(PlateEvent.timestamp))
                .filter(PlateEvent.camera_id == cam.id)
                .scalar()
            )

            # Detection rate per hour (last 24h)
            detection_rate = round(recent_detections / 24.0, 1)

            # Estimate uptime: camera is "up" if it had any detection in last 24h
            # or its status is ACTIVE
            if cam.status == "ACTIVE":
                uptime_pct = 100.0 if recent_detections > 0 else 85.0
            elif cam.status == "MAINTENANCE":
                uptime_pct = 0.0
            else:
                uptime_pct = 0.0

            # Hours since last detection
            hours_since_last = None
            if last_event:
                hours_since_last = round(
                    (now - last_event).total_seconds() / 3600.0, 1
                )

            health_data.append({
                "camera_id": cam.id,
                "name": cam.name,
                "location_name": cam.location_name,
                "latitude": cam.latitude,
                "longitude": cam.longitude,
                "status": cam.status,
                "total_detections": total_detections,
                "detections_24h": recent_detections,
                "detection_rate_per_hour": detection_rate,
                "last_detection": last_event.isoformat() if last_event else None,
                "hours_since_last_detection": hours_since_last,
                "uptime_pct": uptime_pct,
            })

        return health_data

    def get_system_overview(self):
        """Returns high-level system health overview."""
        now = datetime.datetime.utcnow()
        today_start = datetime.datetime.combine(now.date(), datetime.time.min)

        total_cameras = self.session.query(func.count(Camera.id)).scalar() or 0
        active_cameras = (
            self.session.query(func.count(Camera.id))
            .filter(Camera.status == "ACTIVE")
            .scalar() or 0
        )
        total_events_today = (
            self.session.query(func.count(PlateEvent.id))
            .filter(PlateEvent.timestamp >= today_start)
            .scalar() or 0
        )
        total_events_all = (
            self.session.query(func.count(PlateEvent.id)).scalar() or 0
        )
        avg_confidence = (
            self.session.query(func.avg(PlateEvent.confidence)).scalar() or 0.0
        )

        return {
            "total_cameras": total_cameras,
            "active_cameras": active_cameras,
            "maintenance_cameras": total_cameras - active_cameras,
            "total_events_today": total_events_today,
            "total_events_all_time": total_events_all,
            "avg_ocr_confidence": round(float(avg_confidence) * 100, 1),
            "system_uptime_pct": round(
                (active_cameras / total_cameras * 100) if total_cameras > 0 else 0, 1
            ),
            "timestamp": now.isoformat(),
        }
