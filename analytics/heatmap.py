"""
Heatmap analytics engine for generating hour-by-camera detection density matrices
and peak-hour identification.
"""

from collections import defaultdict
from sqlalchemy import func
from database.models import PlateEvent, Camera, get_session


class HeatmapEngine:
    """Generates heatmap data for traffic density visualization."""

    def __init__(self, session=None):
        self.session = session or get_session()

    def get_hour_camera_heatmap(self):
        """
        Generates a 24-hour × N-camera heatmap matrix.
        Returns:
        {
            "cameras": [...camera names...],
            "hours": ["00:00", "01:00", ...],
            "matrix": [[count_cam1_hour0, count_cam2_hour0, ...], ...]
        }
        """
        cameras = self.session.query(Camera).order_by(Camera.id).all()
        cam_ids = [c.id for c in cameras]
        cam_names = [c.name for c in cameras]

        # Build hour-by-camera counts
        events = self.session.query(
            PlateEvent.camera_id, PlateEvent.timestamp
        ).all()

        grid = defaultdict(lambda: defaultdict(int))
        for cam_id, ts in events:
            if ts:
                grid[ts.hour][cam_id] += 1

        hours = [f"{h:02d}:00" for h in range(24)]
        matrix = []
        for h in range(24):
            row = [grid[h].get(cid, 0) for cid in cam_ids]
            matrix.append(row)

        # Calculate max for normalization on the frontend
        max_val = max(max(row) for row in matrix) if matrix and any(any(r) for r in matrix) else 1

        return {
            "cameras": cam_names,
            "camera_ids": cam_ids,
            "hours": hours,
            "matrix": matrix,
            "max_value": max_val,
        }

    def get_peak_hours(self):
        """
        Identifies peak traffic hours and categorizes them into time bands.
        Returns hourly volumes with morning/afternoon/evening/night classification.
        """
        events = self.session.query(PlateEvent.timestamp).all()
        hourly = defaultdict(int)
        for (ts,) in events:
            if ts:
                hourly[ts.hour] += 1

        bands = {
            "night": (0, 6),
            "morning": (6, 12),
            "afternoon": (12, 18),
            "evening": (18, 24),
        }

        result = []
        for h in range(24):
            band = "night"
            for band_name, (start, end) in bands.items():
                if start <= h < end:
                    band = band_name
                    break

            result.append({
                "hour": f"{h:02d}:00",
                "count": hourly.get(h, 0),
                "band": band,
            })

        # Identify peak hour
        peak_hour = max(range(24), key=lambda h: hourly.get(h, 0))
        peak_count = hourly.get(peak_hour, 0)

        # Band totals
        band_totals = defaultdict(int)
        for h in range(24):
            for band_name, (start, end) in bands.items():
                if start <= h < end:
                    band_totals[band_name] += hourly.get(h, 0)
                    break

        return {
            "hourly": result,
            "peak_hour": f"{peak_hour:02d}:00",
            "peak_count": peak_count,
            "band_totals": dict(band_totals),
        }
