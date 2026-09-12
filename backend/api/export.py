"""
Export API routes for downloading events, trajectories, and reports in various formats.
"""

from typing import Optional
from fastapi import APIRouter, Query
from fastapi.responses import Response
from database.models import get_session
from backend.services.export_service import ExportService

router = APIRouter(prefix="/export", tags=["Data Export"])


@router.get("/events")
def export_events(
    format: str = Query("csv", pattern="^(csv|json)$", description="Export format: csv or json"),
    plate: Optional[str] = Query(None, description="Filter by plate text"),
    camera_id: Optional[int] = Query(None, description="Filter by camera ID"),
    limit: int = Query(1000, ge=1, le=10000),
):
    """Export plate events as CSV or JSON file download."""
    session = get_session()
    try:
        service = ExportService(session)
        if format == "csv":
            content = service.export_events_csv(plate=plate, camera_id=camera_id, limit=limit)
            return Response(
                content=content,
                media_type="text/csv",
                headers={"Content-Disposition": "attachment; filename=anpr_events_export.csv"},
            )
        else:
            content = service.export_events_json(plate=plate, camera_id=camera_id, limit=limit)
            return Response(
                content=content,
                media_type="application/json",
                headers={"Content-Disposition": "attachment; filename=anpr_events_export.json"},
            )
    finally:
        session.close()


@router.get("/trajectories")
def export_trajectories(
    format: str = Query("csv", pattern="^(csv|json)$", description="Export format: csv or json"),
    limit: int = Query(500, ge=1, le=5000),
):
    """Export vehicle trajectories as CSV or JSON file download."""
    session = get_session()
    try:
        service = ExportService(session)
        if format == "csv":
            content = service.export_trajectories_csv(limit=limit)
            return Response(
                content=content,
                media_type="text/csv",
                headers={"Content-Disposition": "attachment; filename=anpr_trajectories_export.csv"},
            )
        else:
            content = service.export_trajectories_json(limit=limit)
            return Response(
                content=content,
                media_type="application/json",
                headers={"Content-Disposition": "attachment; filename=anpr_trajectories_export.json"},
            )
    finally:
        session.close()


@router.get("/report")
def export_summary_report():
    """Generate and download a styled HTML summary report."""
    session = get_session()
    try:
        service = ExportService(session)
        html = service.generate_summary_report_html()
        return Response(
            content=html,
            media_type="text/html",
            headers={"Content-Disposition": "attachment; filename=anpr_surveillance_report.html"},
        )
    finally:
        session.close()
