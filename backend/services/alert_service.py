"""
Alert service for managing real-time alerts: speed anomalies, geofence breaches, flagged vehicles.
Provides in-memory alert queue with database persistence.
"""

import datetime
from enum import Enum
from typing import Optional, List
from sqlalchemy import func
from database.models import get_session, Alert, FlaggedVehicle


class AlertSeverity(str, Enum):
    INFO = "INFO"
    WARNING = "WARNING"
    CRITICAL = "CRITICAL"


class AlertType(str, Enum):
    SPEED_ANOMALY = "SPEED_ANOMALY"
    GEOFENCE_BREACH = "GEOFENCE_BREACH"
    FLAGGED_VEHICLE = "FLAGGED_VEHICLE"
    CAMERA_OFFLINE = "CAMERA_OFFLINE"
    SUSPICIOUS_ROUTE = "SUSPICIOUS_ROUTE"


class AlertService:
    """Manages creation, retrieval, and acknowledgment of alerts."""

    def __init__(self, session=None):
        self.session = session or get_session()

    def create_alert(
        self,
        alert_type: str,
        severity: str,
        message: str,
        plate_text: str = None,
        camera_id: int = None,
        metadata_json: str = None,
    ) -> dict:
        """Create and persist a new alert."""
        alert = Alert(
            alert_type=alert_type,
            severity=severity,
            message=message,
            plate_text=plate_text,
            camera_id=camera_id,
            metadata_json=metadata_json or "{}",
            acknowledged=False,
            timestamp=datetime.datetime.utcnow(),
        )
        self.session.add(alert)
        self.session.commit()
        return alert.to_dict()

    def get_active_alerts(self, limit: int = 50) -> List[dict]:
        """Get unacknowledged alerts ordered by most recent."""
        alerts = (
            self.session.query(Alert)
            .filter(Alert.acknowledged == False)
            .order_by(Alert.timestamp.desc())
            .limit(limit)
            .all()
        )
        return [a.to_dict() for a in alerts]

    def get_alert_history(
        self,
        limit: int = 100,
        alert_type: str = None,
        severity: str = None,
    ) -> List[dict]:
        """Get historical alerts with optional filters."""
        query = self.session.query(Alert).order_by(Alert.timestamp.desc())
        if alert_type:
            query = query.filter(Alert.alert_type == alert_type)
        if severity:
            query = query.filter(Alert.severity == severity)
        alerts = query.limit(limit).all()
        return [a.to_dict() for a in alerts]

    def acknowledge_alert(self, alert_id: int) -> Optional[dict]:
        """Mark an alert as acknowledged."""
        alert = self.session.query(Alert).filter(Alert.id == alert_id).first()
        if not alert:
            return None
        alert.acknowledged = True
        alert.acknowledged_at = datetime.datetime.utcnow()
        self.session.commit()
        return alert.to_dict()

    def acknowledge_all_alerts(self) -> int:
        """Mark all unacknowledged alerts as acknowledged."""
        now = datetime.datetime.utcnow()
        unacked = self.session.query(Alert).filter(Alert.acknowledged == False).all()
        for a in unacked:
            a.acknowledged = True
            a.acknowledged_at = now
        self.session.commit()
        return len(unacked)

    def get_unread_count(self) -> int:
        """Get count of unacknowledged alerts."""
        return (
            self.session.query(func.count(Alert.id))
            .filter(Alert.acknowledged == False)
            .scalar() or 0
        )

    def check_speed_anomalies(self, threshold_kmh: float = 75.0):
        """
        Scan recent trajectories for speed violations and create alerts.
        Returns list of newly created alerts.
        """
        from database.models import Trajectory

        # Find trajectories with excessive speed that don't already have alerts
        fast_trajs = (
            self.session.query(Trajectory)
            .filter(Trajectory.avg_speed_kmh >= threshold_kmh)
            .order_by(Trajectory.avg_speed_kmh.desc())
            .limit(20)
            .all()
        )

        new_alerts = []
        for t in fast_trajs:
            # Check if an alert already exists for this plate and time
            existing = (
                self.session.query(Alert)
                .filter(
                    Alert.alert_type == AlertType.SPEED_ANOMALY,
                    Alert.plate_text == t.plate_text,
                )
                .first()
            )
            if not existing:
                severity = (
                    AlertSeverity.CRITICAL
                    if t.avg_speed_kmh > 120
                    else AlertSeverity.WARNING
                )
                alert_data = self.create_alert(
                    alert_type=AlertType.SPEED_ANOMALY,
                    severity=severity,
                    message=f"Vehicle {t.plate_text} averaged {t.avg_speed_kmh} km/h across {t.total_cameras} cameras ({t.distance_km} km)",
                    plate_text=t.plate_text,
                )
                new_alerts.append(alert_data)

        return new_alerts

    # ── Flagged Vehicle Management ──

    def flag_vehicle(self, plate_text: str, reason: str) -> dict:
        """Add a vehicle to the flagged list."""
        existing = (
            self.session.query(FlaggedVehicle)
            .filter(FlaggedVehicle.plate_text == plate_text.upper())
            .first()
        )
        if existing:
            existing.reason = reason
            existing.active = True
            self.session.commit()
            return existing.to_dict()

        fv = FlaggedVehicle(
            plate_text=plate_text.upper(),
            reason=reason,
            active=True,
            flagged_at=datetime.datetime.utcnow(),
        )
        self.session.add(fv)
        self.session.commit()
        return fv.to_dict()

    def get_flagged_vehicles(self, active_only: bool = True) -> List[dict]:
        """Get all flagged vehicles."""
        query = self.session.query(FlaggedVehicle)
        if active_only:
            query = query.filter(FlaggedVehicle.active == True)
        return [fv.to_dict() for fv in query.order_by(FlaggedVehicle.flagged_at.desc()).all()]

    def unflag_vehicle(self, plate_text: str) -> bool:
        """Remove a vehicle from the flagged list."""
        fv = (
            self.session.query(FlaggedVehicle)
            .filter(FlaggedVehicle.plate_text == plate_text.upper())
            .first()
        )
        if fv:
            fv.active = False
            self.session.commit()
            return True
        return False

    def check_blacklist_match(
        self, plate_text: str, camera_id: int = None, camera_name: str = None
    ) -> Optional[dict]:
        """Check if sighted vehicle is blacklisted and create an alert (throttled to avoid spam)."""
        fv = (
            self.session.query(FlaggedVehicle)
            .filter(FlaggedVehicle.plate_text == plate_text.upper(), FlaggedVehicle.active == True)
            .first()
        )
        if fv:
            # Throttle: don't create duplicate alerts for the same plate within 10 minutes
            ten_mins_ago = datetime.datetime.utcnow() - datetime.timedelta(minutes=10)
            recent_alert = (
                self.session.query(Alert.id)
                .filter(
                    Alert.alert_type == AlertType.FLAGGED_VEHICLE,
                    Alert.plate_text == plate_text.upper(),
                    Alert.timestamp >= ten_mins_ago
                )
                .first()
            )
            if recent_alert:
                return None

            loc = camera_name or (f"Camera #{camera_id}" if camera_id else "Smart City Grid")
            msg = f"🚨 BLACKLISTED VEHICLE DETECTED: {plate_text.upper()} at {loc}! Flag reason: {fv.reason}"
            return self.create_alert(
                alert_type=AlertType.FLAGGED_VEHICLE,
                severity=AlertSeverity.CRITICAL,
                message=msg,
                plate_text=plate_text.upper(),
                camera_id=camera_id,
            )
        return None

    def check_suspicious_route(
        self, plate_text: str, current_camera_id: int, speed_kmh: float = None
    ) -> Optional[dict]:
        """Detect route anomalies such as severe overspeeding or impossible transit."""
        if speed_kmh and speed_kmh > 105.0:
            msg = f"⚡ SEVERE SPEED ANOMALY: Vehicle {plate_text.upper()} clocked at {speed_kmh:.1f} km/h (Limit: 60 km/h)!"
            return self.create_alert(
                alert_type=AlertType.SPEED_ANOMALY,
                severity=AlertSeverity.CRITICAL if speed_kmh > 120 else AlertSeverity.WARNING,
                message=msg,
                plate_text=plate_text.upper(),
                camera_id=current_camera_id,
            )
        return None

