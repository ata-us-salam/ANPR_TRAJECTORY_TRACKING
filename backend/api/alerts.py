"""
Alert API routes for managing real-time alerts and flagged vehicles.
"""

from typing import Optional, List
from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel
from database.models import get_session
from backend.services.alert_service import AlertService


router = APIRouter(prefix="/alerts", tags=["Alerts"])


class FlagVehicleRequest(BaseModel):
    plate_text: str
    reason: str = "Manual flag"


class CreateAlertRequest(BaseModel):
    alert_type: str
    severity: str = "WARNING"
    message: str
    plate_text: Optional[str] = None
    camera_id: Optional[int] = None


@router.get("")
@router.get("/active")
def get_alerts(
    limit: int = Query(50, ge=1, le=200),
    acknowledged: Optional[bool] = Query(None),
):
    """Get alerts. If acknowledged param specified or /active called, returns active alerts."""
    session = get_session()
    try:
        service = AlertService(session)
        alerts = service.get_active_alerts(limit=limit)
        unread = service.get_unread_count()
        # If explicitly filtered by acknowledged status, return the array
        if acknowledged is not None:
            return alerts
        return alerts
    finally:
        session.close()


@router.post("")
def create_alert(req: CreateAlertRequest):
    """Manually create and persist a new security alert."""
    session = get_session()
    try:
        service = AlertService(session)
        return service.create_alert(
            alert_type=req.alert_type,
            severity=req.severity,
            message=req.message,
            plate_text=req.plate_text,
            camera_id=req.camera_id,
        )
    finally:
        session.close()


@router.get("/history")
def get_alert_history(
    limit: int = Query(100, ge=1, le=500),
    alert_type: Optional[str] = Query(None),
    severity: Optional[str] = Query(None),
):
    """Get historical alert log with optional filters."""
    session = get_session()
    try:
        service = AlertService(session)
        return service.get_alert_history(limit=limit, alert_type=alert_type, severity=severity)
    finally:
        session.close()


@router.post("/acknowledge-all")
def acknowledge_all_alerts():
    """Acknowledge all unacknowledged alerts in bulk."""
    session = get_session()
    try:
        service = AlertService(session)
        count = service.acknowledge_all_alerts()
        return {"acknowledged_count": count, "success": True}
    finally:
        session.close()


@router.post("/acknowledge/{alert_id}")
@router.post("/{alert_id}/acknowledge")
def acknowledge_alert(alert_id: int):
    """Acknowledge and dismiss an alert."""
    session = get_session()
    try:
        service = AlertService(session)
        result = service.acknowledge_alert(alert_id)
        if not result:
            raise HTTPException(status_code=404, detail=f"Alert {alert_id} not found")
        return result
    finally:
        session.close()


@router.get("/unread-count")
def get_unread_count():
    """Get count of unacknowledged alerts."""
    session = get_session()
    try:
        service = AlertService(session)
        return {"unread_count": service.get_unread_count()}
    finally:
        session.close()


@router.post("/check-anomalies")
@router.post("/check-speed-anomalies")
def trigger_speed_check():
    """Manually trigger a speed anomaly check and generate alerts."""
    session = get_session()
    try:
        service = AlertService(session)
        new_alerts = service.check_speed_anomalies()
        return {"alerts_created": len(new_alerts), "new_alerts_count": len(new_alerts), "alerts": new_alerts}
    finally:
        session.close()


# ── Flagged Vehicles (Dual Routing for REST convention and Dashboard compatibility) ──

@router.get("/flagged")
@router.get("/flagged-vehicles")
def list_flagged_vehicles(active_only: bool = Query(True)):
    """List all flagged/watchlist vehicles."""
    session = get_session()
    try:
        service = AlertService(session)
        return service.get_flagged_vehicles(active_only=active_only)
    finally:
        session.close()


@router.post("/flagged")
@router.post("/flag-vehicle")
def flag_vehicle(req: FlagVehicleRequest):
    """Add a vehicle to the flagged watchlist."""
    session = get_session()
    try:
        service = AlertService(session)
        return service.flag_vehicle(req.plate_text, req.reason)
    finally:
        session.close()


@router.delete("/flagged/{plate_text}")
@router.post("/unflag-vehicle/{plate_text}")
def unflag_vehicle(plate_text: str):
    """Remove a vehicle from the flagged watchlist."""
    session = get_session()
    try:
        service = AlertService(session)
        success = service.unflag_vehicle(plate_text)
        if not success:
            raise HTTPException(status_code=404, detail=f"Vehicle {plate_text} not found in flagged list")
        return {"success": True, "plate_text": plate_text.upper()}
    finally:
        session.close()
