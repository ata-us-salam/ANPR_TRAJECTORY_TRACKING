from fastapi import APIRouter, HTTPException
from sqlalchemy import func
from database.models import Camera, PlateEvent, get_session
from backend.services.camera_service import CameraHealthService

router = APIRouter(prefix="/cameras", tags=["Cameras"])

@router.get("")
def list_cameras():
    session = get_session()
    try:
        # Single efficient aggregation query eliminating N+1 loop
        query = (
            session.query(Camera, func.count(PlateEvent.id).label("total_sightings"))
            .outerjoin(PlateEvent, Camera.id == PlateEvent.camera_id)
            .group_by(Camera.id)
            .order_by(Camera.id)
        )
        result = []
        for cam, count in query.all():
            cam_dict = cam.to_dict()
            cam_dict["total_sightings"] = count or 0
            result.append(cam_dict)
        return result
    finally:
        session.close()

@router.get("/health")
def get_camera_health():
    """Detailed health, uptime, and detection rate matrix for all cameras."""
    session = get_session()
    try:
        service = CameraHealthService(session)
        return service.get_camera_health_matrix()
    finally:
        session.close()

@router.get("/overview")
def get_system_overview():
    """High-level system health metrics and camera uptime."""
    session = get_session()
    try:
        service = CameraHealthService(session)
        return service.get_system_overview()
    finally:
        session.close()

@router.get("/{camera_id}")
def get_camera_details(camera_id: int):
    session = get_session()
    try:
        cam = session.query(Camera).filter(Camera.id == camera_id).first()
        if not cam:
            raise HTTPException(status_code=404, detail=f"Camera with ID {camera_id} not found")
        
        recent_events = session.query(PlateEvent)\
                               .filter(PlateEvent.camera_id == camera_id)\
                               .order_by(PlateEvent.timestamp.desc())\
                               .limit(10).all()
                               
        data = cam.to_dict()
        data["recent_sightings"] = [e.to_dict() for e in recent_events]
        return data
    finally:
        session.close()
