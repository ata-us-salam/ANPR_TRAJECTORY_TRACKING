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

@router.get("/suggest")
def suggest_plates(q: str = Query("", max_length=20, description="Query prefix or substring for plate autocomplete")):
    """Provide real-time plate autocomplete suggestions for the search bar."""
    session = get_session()
    try:
        cleaned = q.strip().upper().replace(" ", "").replace("-", "")
        query = session.query(Trajectory.plate_text, Trajectory.total_cameras, Trajectory.distance_km)
        if cleaned:
            query = query.filter(Trajectory.plate_text.like(f"%{cleaned}%"))
        results = query.order_by(Trajectory.total_cameras.desc()).limit(15).all()
        return [
            {
                "plate_text": r[0],
                "total_cameras": r[1],
                "distance_km": round(r[2], 1) if r[2] else 0.0
            }
            for r in results
        ]
    finally:
        session.close()

@router.get("/search")
def search_trajectory(plate: str = Query(..., min_length=2, max_length=30, description="Vehicle license plate to track")):
    cleaned_plate = plate.strip().upper().replace(" ", "").replace("-", "").replace(".", "")
    session = get_session()
    try:
        # 1. Exact match check on precomputed trajectories
        trajs = session.query(Trajectory)\
                       .filter(Trajectory.plate_text == cleaned_plate)\
                       .order_by(Trajectory.start_time.desc()).all()

        # 2. Case/whitespace insensitive partial match on Trajectory table
        if not trajs:
            trajs = session.query(Trajectory)\
                           .filter(Trajectory.plate_text.like(f"%{cleaned_plate}%"))\
                           .order_by(Trajectory.total_cameras.desc()).all()

        # 3. If still not found, check PlateEvent table (exact or partial)
        if not trajs:
            event_match = session.query(PlateEvent.plate_text)\
                                 .filter(PlateEvent.plate_text == cleaned_plate)\
                                 .first()
            if not event_match:
                event_match = session.query(PlateEvent.plate_text)\
                                     .filter(PlateEvent.plate_text.like(f"%{cleaned_plate}%"))\
                                     .first()

            if event_match:
                matched_plate = event_match[0]
                engine = TrajectoryEngine(session)
                trajs = engine.build_trajectories_for_plate(matched_plate, commit=True)
                
        if not trajs:
            # Provide suggestions of existing plates
            sample_plates = [t.plate_text for t in session.query(Trajectory.plate_text).distinct().limit(5).all()]
            raise HTTPException(
                status_code=404, 
                detail={
                    "message": f"No trajectory sightings found for license plate: '{plate}'",
                    "cleaned_query": cleaned_plate,
                    "available_suggestions": sample_plates
                }
            )

        matched_plate = trajs[0].plate_text
        return {
            "plate_text": matched_plate,
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
