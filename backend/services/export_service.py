"""
Export service for generating CSV, JSON, and HTML report exports of system data.
"""

import csv
import io
import json
import datetime
from typing import List
from sqlalchemy import func
from database.models import PlateEvent, Trajectory, Camera, get_session


class ExportService:
    """Generates export files in various formats."""

    def __init__(self, session=None):
        self.session = session or get_session()

    def export_events_csv(
        self, plate: str = None, camera_id: int = None, limit: int = 1000
    ) -> str:
        """Export plate events as CSV string."""
        query = self.session.query(PlateEvent).order_by(PlateEvent.timestamp.desc())
        if plate:
            query = query.filter(PlateEvent.plate_text.ilike(f"%{plate}%"))
        if camera_id:
            query = query.filter(PlateEvent.camera_id == camera_id)
        events = query.limit(limit).all()

        output = io.StringIO()
        writer = csv.writer(output)
        writer.writerow([
            "ID", "Camera ID", "Camera Name", "Location",
            "Plate Text", "Confidence", "Vehicle Type",
            "Speed (km/h)", "Timestamp",
        ])
        for e in events:
            writer.writerow([
                e.id,
                e.camera_id,
                e.camera.name if e.camera else "",
                e.camera.location_name if e.camera else "",
                e.plate_text,
                round(e.confidence, 3),
                e.vehicle_type,
                e.speed_estimate_kmh,
                e.timestamp.isoformat() if e.timestamp else "",
            ])
        return output.getvalue()

    def export_events_json(
        self, plate: str = None, camera_id: int = None, limit: int = 1000
    ) -> str:
        """Export plate events as JSON string."""
        query = self.session.query(PlateEvent).order_by(PlateEvent.timestamp.desc())
        if plate:
            query = query.filter(PlateEvent.plate_text.ilike(f"%{plate}%"))
        if camera_id:
            query = query.filter(PlateEvent.camera_id == camera_id)
        events = query.limit(limit).all()
        return json.dumps(
            [e.to_dict() for e in events],
            default=str,
            indent=2,
        )

    def export_trajectories_csv(self, limit: int = 500) -> str:
        """Export trajectories as CSV string."""
        trajectories = (
            self.session.query(Trajectory)
            .order_by(Trajectory.start_time.desc())
            .limit(limit)
            .all()
        )

        output = io.StringIO()
        writer = csv.writer(output)
        writer.writerow([
            "ID", "Plate Text", "Start Time", "End Time",
            "Total Cameras", "Distance (km)", "Avg Speed (km/h)",
            "Duration (min)",
        ])
        for t in trajectories:
            writer.writerow([
                t.id,
                t.plate_text,
                t.start_time.isoformat() if t.start_time else "",
                t.end_time.isoformat() if t.end_time else "",
                t.total_cameras,
                t.distance_km,
                t.avg_speed_kmh,
                t.duration_minutes,
            ])
        return output.getvalue()

    def export_trajectories_json(self, limit: int = 500) -> str:
        """Export trajectories as JSON string."""
        trajectories = (
            self.session.query(Trajectory)
            .order_by(Trajectory.start_time.desc())
            .limit(limit)
            .all()
        )
        return json.dumps(
            [t.to_dict() for t in trajectories],
            default=str,
            indent=2,
        )

    def generate_summary_report_html(self) -> str:
        """Generate an HTML summary report of the surveillance system."""
        now = datetime.datetime.utcnow()
        today_start = datetime.datetime.combine(now.date(), datetime.time.min)

        total_events = self.session.query(func.count(PlateEvent.id)).scalar() or 0
        today_events = (
            self.session.query(func.count(PlateEvent.id))
            .filter(PlateEvent.timestamp >= today_start)
            .scalar() or 0
        )
        unique_plates = (
            self.session.query(func.count(func.distinct(PlateEvent.plate_text))).scalar()
            or 0
        )
        total_cameras = self.session.query(func.count(Camera.id)).scalar() or 0
        active_cameras = (
            self.session.query(func.count(Camera.id))
            .filter(Camera.status == "ACTIVE")
            .scalar() or 0
        )
        avg_conf = self.session.query(func.avg(PlateEvent.confidence)).scalar() or 0.0
        total_trajectories = (
            self.session.query(func.count(Trajectory.id)).scalar() or 0
        )

        # Vehicle type breakdown
        vtype_rows = (
            self.session.query(
                PlateEvent.vehicle_type, func.count(PlateEvent.id)
            )
            .group_by(PlateEvent.vehicle_type)
            .all()
        )
        vtype_html = ""
        for vtype, count in vtype_rows:
            vtype_html += f"<tr><td>{vtype or 'Unknown'}</td><td>{count}</td></tr>"

        html = f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>ANPR Surveillance Report — {now.strftime('%Y-%m-%d %H:%M')}</title>
<style>
  body {{ font-family: 'Segoe UI', sans-serif; background: #0f172a; color: #e2e8f0; padding: 40px; }}
  h1 {{ color: #38bdf8; border-bottom: 2px solid #1e3a5f; padding-bottom: 12px; }}
  h2 {{ color: #94a3b8; margin-top: 30px; }}
  .metrics {{ display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px; margin: 20px 0; }}
  .metric {{ background: rgba(30, 41, 59, 0.8); border: 1px solid rgba(255,255,255,0.1); border-radius: 12px; padding: 20px; text-align: center; }}
  .metric-val {{ font-size: 2rem; font-weight: 800; color: #00f2fe; }}
  .metric-label {{ font-size: 0.85rem; color: #64748b; margin-top: 4px; }}
  table {{ width: 100%; border-collapse: collapse; margin-top: 16px; }}
  th {{ background: #1e293b; color: #94a3b8; text-align: left; padding: 10px 14px; font-size: 0.8rem; text-transform: uppercase; }}
  td {{ padding: 10px 14px; border-bottom: 1px solid rgba(255,255,255,0.06); }}
  .footer {{ margin-top: 40px; font-size: 0.8rem; color: #475569; text-align: center; }}
</style>
</head>
<body>
<h1>🛰️ CITYSURV ANPR Surveillance Report</h1>
<p style="color:#64748b;">Generated: {now.strftime('%B %d, %Y at %H:%M UTC')}</p>

<div class="metrics">
  <div class="metric"><div class="metric-val">{total_events:,}</div><div class="metric-label">Total Detections</div></div>
  <div class="metric"><div class="metric-val">{today_events:,}</div><div class="metric-label">Today's Detections</div></div>
  <div class="metric"><div class="metric-val">{unique_plates:,}</div><div class="metric-label">Unique Vehicles</div></div>
  <div class="metric"><div class="metric-val">{active_cameras}/{total_cameras}</div><div class="metric-label">Active Cameras</div></div>
</div>
<div class="metrics">
  <div class="metric"><div class="metric-val">{round(float(avg_conf) * 100, 1)}%</div><div class="metric-label">Avg OCR Confidence</div></div>
  <div class="metric"><div class="metric-val">{total_trajectories}</div><div class="metric-label">Reconstructed Trajectories</div></div>
</div>

<h2>Vehicle Type Distribution</h2>
<table>
  <thead><tr><th>Vehicle Type</th><th>Count</th></tr></thead>
  <tbody>{vtype_html}</tbody>
</table>

<div class="footer">
  CitySource ANPR Intelligence Platform &bull; Report auto-generated &bull; Confidential
</div>
</body>
</html>"""
        return html
