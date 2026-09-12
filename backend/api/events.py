from typing import Optional
from fastapi import APIRouter, Query
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
