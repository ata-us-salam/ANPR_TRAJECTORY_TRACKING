"""
Vehicle Profile & Search API.
Provides endpoints for dedicated vehicle profile inspection, history timeline,
and autocompletion across smart city surveillance sightings.
"""

from typing import Optional, List
from fastapi import APIRouter, HTTPException, Query
from sqlalchemy import func, or_
from database.models import get_session, PlateEvent, Camera, FlaggedVehicle, Trajectory, Alert

router = APIRouter(prefix="/vehicles", tags=["Vehicles"])

@router.get("/search")
def search_vehicles(
    q: str = Query("", min_length=1, description="Search query for license plate"),
    limit: int = Query(10, ge=1, le=50)
):
    """Search unique vehicle plates matching query string."""
    session = get_session()
    try:
        query_pattern = f"%{q.strip().upper()}%"
        
        # Query distinct plates with their latest metadata
        results = (
            session.query(
                PlateEvent.plate_text,
                PlateEvent.vehicle_type,
                PlateEvent.vehicle_color,
                func.count(PlateEvent.id).label("total_sightings"),
                func.max(PlateEvent.timestamp).label("last_seen")
            )
            .filter(PlateEvent.plate_text.ilike(query_pattern))
            .group_by(PlateEvent.plate_text, PlateEvent.vehicle_type, PlateEvent.vehicle_color)
            .order_by(func.count(PlateEvent.id).desc())
            .limit(limit)
            .all()
        )
        
        # Check flagged status for each
        flagged_plates = {
            fv.plate_text: fv.reason
            for fv in session.query(FlaggedVehicle).filter(FlaggedVehicle.active == True).all()
        }
        
        out = []
        for plate, v_type, color, count, last_seen in results:
            out.append({
                "plate_text": plate,
                "vehicle_type": v_type or "Car",
                "vehicle_color": color or "White",
                "total_sightings": count,
                "last_seen": last_seen.isoformat() if last_seen else None,
                "is_flagged": plate in flagged_plates,
                "flag_reason": flagged_plates.get(plate)
            })
        return out
    finally:
        session.close()

@router.get("/profile/{plate_text}")
def get_vehicle_profile(plate_text: str):
    """
    Returns complete intelligence profile for a target vehicle:
    - High-level stats (first/last seen, detection count, avg speed)
    - Blacklist / Flagged status
    - Chronological detection history with camera locations and GPS coordinates
    - Trajectories and active alerts
    """
    clean_plate = plate_text.strip().upper()
    session = get_session()
    try:
        events = (
            session.query(PlateEvent, Camera)
            .join(Camera, PlateEvent.camera_id == Camera.id)
            .filter(PlateEvent.plate_text == clean_plate)
            .order_by(PlateEvent.timestamp.asc())
            .all()
        )
        
        if not events:
            raise HTTPException(
                status_code=404,
                detail=f"No surveillance sightings found for vehicle '{clean_plate}'."
            )
            
        # Check blacklist
        flagged = (
            session.query(FlaggedVehicle)
            .filter(FlaggedVehicle.plate_text == clean_plate, FlaggedVehicle.active == True)
            .first()
        )
        
        # Speeds and locations
        speeds = [e[0].speed_estimate_kmh for e in events if e[0].speed_estimate_kmh is not None]
        avg_speed = round(sum(speeds) / len(speeds), 1) if speeds else None
        max_speed = round(max(speeds), 1) if speeds else None
        
        # Unique cameras visited in order
        cameras_visited = []
        for event, cam in events:
            if cam.name not in cameras_visited:
                cameras_visited.append(cam.name)
                
        # Primary vehicle details
        last_event, _ = events[-1]
        vehicle_type = last_event.vehicle_type or "Car"
        vehicle_color = last_event.vehicle_color or "Silver"
        make_model = last_event.make_model or "Sedan"
        
        # Build chronological timeline
        timeline = []
        for event, cam in events:
            timeline.append({
                "id": event.id,
                "camera_id": cam.id,
                "camera_name": cam.name,
                "location_name": cam.location_name,
                "latitude": cam.latitude,
                "longitude": cam.longitude,
                "timestamp": event.timestamp.isoformat() if event.timestamp else None,
                "confidence": round(float(event.confidence) * 100, 1),
                "speed_kmh": event.speed_estimate_kmh,
                "direction": event.direction or cam.direction or "Northbound",
                "vehicle_type": event.vehicle_type,
                "vehicle_color": event.vehicle_color,
                "make_model": event.make_model
            })
            
        # Alerts associated with this vehicle
        alerts = (
            session.query(Alert)
            .filter(Alert.plate_text == clean_plate)
            .order_by(Alert.timestamp.desc())
            .limit(10)
            .all()
        )
        
        # Trajectories
        trajectories = (
            session.query(Trajectory)
            .filter(Trajectory.plate_text == clean_plate)
            .order_by(Trajectory.start_time.desc())
            .all()
        )
        
        return {
            "plate_text": clean_plate,
            "is_flagged": bool(flagged),
            "flag_reason": flagged.reason if flagged else None,
            "vehicle_type": vehicle_type,
            "vehicle_color": vehicle_color,
            "make_model": make_model,
            "first_seen": events[0][0].timestamp.isoformat() if events[0][0].timestamp else None,
            "last_seen": events[-1][0].timestamp.isoformat() if events[-1][0].timestamp else None,
            "total_detections": len(events),
            "avg_speed_kmh": avg_speed,
            "max_speed_kmh": max_speed,
            "cameras_visited_count": len(cameras_visited),
            "cameras_visited": cameras_visited,
            "sightings": timeline,
            "alerts": [a.to_dict() for a in alerts],
            "trajectories": [t.to_dict() for t in trajectories]
        }
    finally:
        session.close()

@router.get("/flagged")
def get_flagged_plates():
    """Returns list of currently active flagged plates."""
    session = get_session()
    try:
        flagged = session.query(FlaggedVehicle).filter(FlaggedVehicle.active == True).all()
        return [f.to_dict() for f in flagged]
    finally:
        session.close()
