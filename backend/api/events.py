from typing import Optional
from fastapi import APIRouter, Query, HTTPException
from database.models import PlateEvent, get_session

router = APIRouter(prefix="/events", tags=["Plate Events"])

@router.get("")
def search_events(
    plate: Optional[str] = Query(None, description="Filter by full or partial license plate"),
    camera_id: Optional[int] = Query(None, description="Filter by camera ID"),
    vehicle_type: Optional[str] = Query(None, description="Filter by vehicle type (Car, Truck, etc.)"),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0)
):
    session = get_session()
    try:
        query = session.query(PlateEvent)
        if plate:
            query = query.filter(PlateEvent.plate_text.ilike(f"%{plate.strip()}%"))
        if camera_id:
            query = query.filter(PlateEvent.camera_id == camera_id)
        if vehicle_type:
            query = query.filter(PlateEvent.vehicle_type.ilike(vehicle_type.strip()))

        total = query.count()
        events = query.order_by(PlateEvent.timestamp.desc()).offset(offset).limit(limit).all()

        return {
            "total": total,
            "limit": limit,
            "offset": offset,
            "events": [e.to_dict() for e in events]
        }
    finally:
        session.close()

@router.get("/recent")
def get_recent_events(limit: int = Query(15, ge=1, le=50)):
    session = get_session()
    try:
        events = session.query(PlateEvent)\
                        .order_by(PlateEvent.timestamp.desc())\
                        .limit(limit).all()
        return [e.to_dict() for e in events]
    finally:
        session.close()

from pydantic import BaseModel, Field
import datetime

class NewPlateEventRequest(BaseModel):
    camera_id: int = Field(..., description="ID of detecting surveillance camera")
    plate_text: str = Field(..., min_length=2, max_length=20, description="License plate string, e.g., MH12AB9999")
    confidence: float = Field(0.95, ge=0.0, le=1.0, description="OCR confidence score")
    vehicle_type: Optional[str] = Field("Car", description="Type of vehicle (Car, Truck, Bus, Motorcycle)")
    vehicle_color: Optional[str] = Field("White", description="Vehicle color")
    make_model: Optional[str] = Field("Sedan", description="Make and model of vehicle")
    direction: Optional[str] = Field("Northbound", description="Direction of vehicle travel")
    speed_estimate_kmh: Optional[float] = Field(None, ge=0.0, le=300.0, description="Estimated vehicle speed in km/h")
    timestamp: Optional[datetime.datetime] = Field(None, description="Detection timestamp (defaults to current UTC time)")

@router.post("")
@router.post("/simulate")
def create_plate_event(req: NewPlateEventRequest):
    """
    Registers a new vehicle plate sighting event in the database,
    checks for speed/geofence/blacklist alerts, and broadcasts to live WebSockets.
    """
    session = get_session()
    try:
        from database.models import Camera
        from backend.services.alert_service import AlertService
        cam = session.query(Camera).filter(Camera.id == req.camera_id).first()
        if not cam:
            raise HTTPException(status_code=404, detail=f"Camera with ID {req.camera_id} not found.")

        event_time = req.timestamp or datetime.datetime.utcnow()
        clean_plate = req.plate_text.strip().upper()

        event = PlateEvent(
            camera_id=req.camera_id,
            plate_text=clean_plate,
            confidence=round(req.confidence, 3),
            timestamp=event_time,
            vehicle_type=req.vehicle_type or "Car",
            vehicle_color=req.vehicle_color or "White",
            make_model=req.make_model or "Sedan",
            direction=req.direction or cam.direction or "Northbound",
            speed_estimate_kmh=req.speed_estimate_kmh
        )
        session.add(event)
        session.commit()
        session.refresh(event)

        event_dict = event.to_dict()

        # Reconstruct or update trajectory for this plate
        try:
            from analytics.trajectory import TrajectoryEngine
            traj_engine = TrajectoryEngine(session)
            traj_engine.build_trajectories_for_plate(clean_plate, commit=True)
        except Exception as te:
            print(f"[Trajectory Update Warning] {te}")

        # Check blacklist and route alerts
        created_alerts = []
        try:
            alert_svc = AlertService(session)
            bl_alert = alert_svc.check_blacklist_match(clean_plate, cam.id, cam.name)
            if bl_alert:
                created_alerts.append(bl_alert)
            sp_alert = alert_svc.check_suspicious_route(clean_plate, cam.id, req.speed_estimate_kmh)
            if sp_alert:
                created_alerts.append(sp_alert)
        except Exception as ae:
            print(f"[Alert Check Warning] {ae}")

        # Broadcast via WebSocket if connected clients exist
        try:
            from backend.services.websocket_manager import ws_manager
            import asyncio
            try:
                loop = asyncio.get_event_loop()
                if loop.is_running():
                    asyncio.create_task(ws_manager.broadcast_event(event_dict))
                    for alert in created_alerts:
                        asyncio.create_task(ws_manager.broadcast_alert(alert))
            except Exception:
                pass
        except Exception:
            pass

        return {
            "success": True,
            "message": f"Sighting for vehicle {clean_plate} at camera {cam.name} recorded successfully.",
            "event": event_dict
        }
    finally:
        session.close()

