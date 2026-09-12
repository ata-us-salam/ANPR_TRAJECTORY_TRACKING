"""
Geofence service for managing geographic zones and checking events against them.
Supports polygon-based geofence zones with point-in-polygon checks.
"""

import json
import datetime
from typing import List, Optional
from database.models import get_session, GeofenceZone, PlateEvent, Camera


def _point_in_polygon(lat: float, lng: float, polygon: list) -> bool:
    """
    Ray-casting algorithm to check if a point (lat, lng) is inside a polygon.
    polygon: list of [lat, lng] coordinate pairs defining the polygon vertices.
    """
    n = len(polygon)
    if n < 3:
        return False

    inside = False
    j = n - 1
    for i in range(n):
        yi, xi = polygon[i]
        yj, xj = polygon[j]

        if ((yi > lng) != (yj > lng)) and (lat < (xj - xi) * (lng - yi) / (yj - yi) + xi):
            inside = not inside
        j = i

    return inside


class GeofenceService:
    """Manages geofence zones and event intersection checks."""

    def __init__(self, session=None):
        self.session = session or get_session()

    def create_zone(
        self, name: str, polygon_coords: list, color: str = "#f43f5e", zone_type: str = "restricted"
    ) -> dict:
        """
        Create a new geofence zone.
        polygon_coords: list of [lat, lng] pairs defining the polygon.
        """
        zone = GeofenceZone(
            name=name,
            polygon_json=json.dumps(polygon_coords),
            color=color,
            zone_type=zone_type,
            active=True,
            created_at=datetime.datetime.utcnow(),
        )
        self.session.add(zone)
        self.session.commit()
        return zone.to_dict()

    def get_all_zones(self, active_only: bool = True) -> List[dict]:
        """Get all geofence zones."""
        query = self.session.query(GeofenceZone)
        if active_only:
            query = query.filter(GeofenceZone.active == True)
        return [z.to_dict() for z in query.order_by(GeofenceZone.created_at.desc()).all()]

    def get_zone(self, zone_id: int) -> Optional[dict]:
        """Get a specific geofence zone."""
        zone = self.session.query(GeofenceZone).filter(GeofenceZone.id == zone_id).first()
        return zone.to_dict() if zone else None

    def delete_zone(self, zone_id: int) -> bool:
        """Deactivate a geofence zone."""
        zone = self.session.query(GeofenceZone).filter(GeofenceZone.id == zone_id).first()
        if zone:
            zone.active = False
            self.session.commit()
            return True
        return False

    def get_events_in_zone(self, zone_id: int, limit: int = 100) -> List[dict]:
        """
        Find plate events from cameras that fall within a geofence zone.
        """
        zone = self.session.query(GeofenceZone).filter(GeofenceZone.id == zone_id).first()
        if not zone:
            return []

        polygon = zone.polygon
        if not polygon or len(polygon) < 3:
            return []

        # Find cameras inside the geofence polygon
        cameras = self.session.query(Camera).all()
        camera_ids_in_zone = []
        for cam in cameras:
            if _point_in_polygon(cam.latitude, cam.longitude, polygon):
                camera_ids_in_zone.append(cam.id)

        if not camera_ids_in_zone:
            return []

        # Get events from cameras within the zone
        events = (
            self.session.query(PlateEvent)
            .filter(PlateEvent.camera_id.in_(camera_ids_in_zone))
            .order_by(PlateEvent.timestamp.desc())
            .limit(limit)
            .all()
        )
        return [e.to_dict() for e in events]

    def check_camera_in_zones(self, camera_id: int) -> List[dict]:
        """Check which geofence zones a camera falls within."""
        cam = self.session.query(Camera).filter(Camera.id == camera_id).first()
        if not cam:
            return []

        zones = self.session.query(GeofenceZone).filter(GeofenceZone.active == True).all()
        matching = []
        for zone in zones:
            polygon = zone.polygon
            if polygon and _point_in_polygon(cam.latitude, cam.longitude, polygon):
                matching.append(zone.to_dict())
        return matching
