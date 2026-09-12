"""
Autonomous Real-Time City Traffic Streamer Engine.
Continuously simulates real vehicle movements and ANPR detections across the smart city
camera network, persisting sightings to the database and broadcasting over WebSockets.
"""

import asyncio
import datetime
import random
from typing import List, Dict
from database.models import get_session, Camera, PlateEvent, Trajectory
from analytics.trajectory import TrajectoryEngine
from backend.services.alert_service import AlertService
from backend.services.geofence_service import GeofenceService
from backend.services.websocket_manager import ws_manager

# Real Indian license plates from the actual dataset & city corridors
CORRIDOR_CAMERAS = [
    # Route 1: North-South Ring Road (Connaught Place -> Mandi House -> India Gate -> AIIMS -> DND)
    [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
    # Route 2: East-West Arterial Corridor (DND Flyway -> Ashram -> AIIMS -> Dhaula Kuan -> Airport)
    [10, 9, 8, 7, 6, 11, 12],
    # Route 3: Central Loop (CP -> Barakhamba -> Mandi House -> India Gate -> CP)
    [1, 2, 3, 4, 1],
    # Route 4: Ring Road Expressway (AIIMS -> South Ext -> Lajpat Nagar -> Ashram -> DND)
    [6, 7, 8, 9, 10],
    # Route 5: Airport Express Corridor (CP -> India Gate -> AIIMS -> Dhaula Kuan -> Airport)
    [1, 4, 6, 11, 12]
]

REAL_INDIAN_PLATES = [
    {"plate": "DL01CA9999", "type": "Car", "base_speed": 62.0},
    {"plate": "MH12AB4325", "type": "Truck", "base_speed": 45.0},
    {"plate": "OD02AB1234", "type": "Car", "base_speed": 55.0},
    {"plate": "KA05MJ4012", "type": "Car", "base_speed": 58.0},
    {"plate": "HR26DQ5521", "type": "Truck", "base_speed": 40.0},
    {"plate": "UP16BT8833", "type": "Bus", "base_speed": 48.0},
    {"plate": "DL3SCK4419", "type": "Motorcycle", "base_speed": 52.0},
    {"plate": "MH02EE8820", "type": "Car", "base_speed": 82.0}, # Speed anomaly
    {"plate": "WB12AB1234", "type": "Car", "base_speed": 56.0},
    {"plate": "TS09FA8080", "type": "Car", "base_speed": 60.0},
    {"plate": "GJ01ZZ9090", "type": "Car", "base_speed": 64.0},
    {"plate": "TN07CK1212", "type": "Car", "base_speed": 57.0},
    {"plate": "CH01BL3344", "type": "Car", "base_speed": 88.0}, # Speed anomaly
    {"plate": "RJ14CA2201", "type": "Bus", "base_speed": 42.0},
    {"plate": "DL8CAF3021", "type": "Car", "base_speed": 54.0},
    {"plate": "UP14DR1102", "type": "Car", "base_speed": 66.0},
]

class ActiveVehicleJourney:
    def __init__(self, plate_info: dict, corridor: List[int]):
        self.plate = plate_info["plate"]
        self.v_type = plate_info["type"]
        self.base_speed = plate_info["base_speed"]
        self.corridor = corridor
        self.current_step = 0
        self.completed = False

    def next_camera_id(self) -> int:
        if self.current_step < len(self.corridor):
            cam_id = self.corridor[self.current_step]
            self.current_step += 1
            if self.current_step >= len(self.corridor):
                self.completed = True
            return cam_id
        self.completed = True
        return None

class CityTrafficStreamEngine:
    def __init__(self, interval_seconds: float = 3.5):
        self.interval = interval_seconds
        self.running = False
        self._task = None
        self._active_journeys: List[ActiveVehicleJourney] = []
        self._seed_active_journeys()

    def _seed_active_journeys(self):
        for plate_info in REAL_INDIAN_PLATES:
            corridor = random.choice(CORRIDOR_CAMERAS)
            journey = ActiveVehicleJourney(plate_info, corridor)
            # Stagger their initial positions
            journey.current_step = random.randint(0, len(corridor) - 1)
            self._active_journeys.append(journey)

    async def start(self):
        if self.running:
            return
        self.running = True
        self._task = asyncio.create_task(self._stream_loop())
        print(f"[TrafficStreamer] Live City ANPR Traffic Streamer started (Interval: {self.interval}s)")

    async def stop(self):
        self.running = False
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
        print("[TrafficStreamer] Live City ANPR Traffic Streamer stopped.")

    async def _stream_loop(self):
        while self.running:
            try:
                await asyncio.sleep(self.interval)
                await self.generate_single_sighting()
            except asyncio.CancelledError:
                break
            except Exception as e:
                print(f"[TrafficStreamer Error] Sighting loop error: {e}")
                await asyncio.sleep(2.0)

    async def generate_single_sighting(self):
        """Picks an active journey, steps it to the next camera, records the event and broadcasts it."""
        # Clean completed journeys and replenish
        self._active_journeys = [j for j in self._active_journeys if not j.completed]
        if len(self._active_journeys) < 8:
            plate_info = random.choice(REAL_INDIAN_PLATES)
            corridor = random.choice(CORRIDOR_CAMERAS)
            self._active_journeys.append(ActiveVehicleJourney(plate_info, corridor))

        journey = random.choice(self._active_journeys)
        cam_id = journey.next_camera_id()
        if not cam_id:
            return

        session = get_session()
        try:
            cam = session.query(Camera).filter(Camera.id == cam_id).first()
            if not cam or cam.status != "ACTIVE":
                return

            speed = max(20.0, journey.base_speed + random.uniform(-4.0, 6.0))
            conf = round(random.uniform(0.92, 0.99), 3)
            now = datetime.datetime.utcnow()

            direction = "Northbound"
            if cam_id in [10, 9, 8]:
                direction = "Westbound"
            elif cam_id in [11, 12]:
                direction = "Southbound"
            elif cam_id in [1, 2, 3]:
                direction = "Eastbound"

            event = PlateEvent(
                camera_id=cam.id,
                plate_text=journey.plate,
                confidence=conf,
                timestamp=now,
                vehicle_type=journey.v_type,
                direction=direction,
                speed_estimate_kmh=round(speed, 1)
            )
            session.add(event)
            session.commit()
            session.refresh(event)

            event_dict = event.to_dict()

            # Update trajectory
            try:
                traj_engine = TrajectoryEngine(session)
                traj_engine.build_trajectories_for_plate(journey.plate, commit=True)
            except Exception:
                pass

            # Check for speed anomaly alerts
            try:
                alert_svc = AlertService(session)
                if speed > 75.0:
                    alert_svc.check_speed_anomalies()
            except Exception:
                pass

            # Check geofences
            try:
                geo_svc = GeofenceService(session)
                geo_svc.check_point_in_geofences(cam.latitude, cam.longitude, journey.plate, cam.id)
            except Exception:
                pass

            # Broadcast live sighting over WebSockets to all connected dashboards and maps
            try:
                await ws_manager.broadcast_event(event_dict)
            except Exception:
                pass

        finally:
            session.close()

# Singleton engine instance
traffic_streamer = CityTrafficStreamEngine(interval_seconds=4.0)
