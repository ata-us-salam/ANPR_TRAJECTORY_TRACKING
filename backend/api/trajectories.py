from typing import Optional
from fastapi import APIRouter, HTTPException, Query
from database.models import Trajectory, PlateEvent, get_session
from analytics.trajectory import TrajectoryEngine

router = APIRouter(prefix="/trajectories", tags=["Trajectories"])

@router.get("/plates")
def list_tracked_plates(limit: int = Query(100, ge=1, le=500)):
    """List unique plates available for trajectory tracking with summary info."""
    session = get_session()
    try:
        trajectories = session.query(Trajectory).order_by(Trajectory.total_cameras.desc()).limit(limit).all()
        return [
            {
                "plate_text": t.plate_text,
                "total_cameras": t.total_cameras,
                "distance_km": t.distance_km,
                "avg_speed_kmh": t.avg_speed_kmh,
                "start_time": t.start_time.isoformat() if t.start_time else None
            }
            for t in trajectories
        ]
    finally:
        session.close()

@router.get("/search")
def search_trajectory(plate: str = Query(..., min_length=2, max_length=20, description="Vehicle license plate to track")):
    cleaned_plate = plate.strip().upper()
    session = get_session()
    try:
        # Check if precomputed trajectory exists
        trajs = session.query(Trajectory)\
                       .filter(Trajectory.plate_text == cleaned_plate)\
                       .order_by(Trajectory.start_time.desc()).all()

        if not trajs:
            # Attempt on-the-fly reconstruction from plate_events
            events_count = session.query(PlateEvent)\
                                  .filter(PlateEvent.plate_text == cleaned_plate).count()
            if events_count > 0:
                engine = TrajectoryEngine(session)
                trajs = engine.build_trajectories_for_plate(cleaned_plate, commit=True)
                
        if not trajs:
            raise HTTPException(
                status_code=404, 
                detail=f"No trajectory sightings found for license plate: {cleaned_plate}"
            )

        return {
            "plate_text": cleaned_plate,
            "trajectories_count": len(trajs),
            "trajectories": [t.to_dict() for t in trajs]
        }
    finally:
        session.close()

@router.get("")
@router.get("/all")
def get_all_trajectories(
    limit: int = Query(50, ge=1, le=200, description="Max trajectories to return"),
    offset: int = Query(0, ge=0, description="Offset for pagination")
):
    session = get_session()
    try:
        query = session.query(Trajectory).order_by(Trajectory.start_time.desc())
        total = query.count()
        trajs = query.offset(offset).limit(limit).all()
        return {
            "total": total,
            "limit": limit,
            "offset": offset,
            "trajectories": [t.to_dict() for t in trajs]
        }
    finally:
        session.close()
