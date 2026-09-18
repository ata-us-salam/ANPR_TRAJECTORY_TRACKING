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

# Bhubaneswar Smart City Corridors across Connected Arterials
CORRIDOR_CAMERAS = [
    # Corridor 0: Rasulgarh -> Vani Vihar -> Acharya Vihar -> Jaydev Vihar
    [1, 2, 3, 4],
    # Corridor 1: Baramunda -> Jaydev Vihar -> Acharya Vihar -> Vani Vihar -> Rasulgarh
    [12, 4, 3, 2, 1],
    # Corridor 2: Master Canteen -> Kalpana -> Khandagiri -> Baramunda
    [6, 7, 5, 12],
    # Corridor 3: Chandrasekharpur -> Patia -> KIIT -> Infocity
    [8, 9, 10, 11],
    # Corridor 4: Khandagiri -> Baramunda -> Jaydev Vihar -> Patia
    [5, 12, 4, 8, 9, 10],
    # Corridor 5: Reverse Infocity -> Patia -> Jaydev Vihar -> Rasulgarh
    [11, 10, 9, 8, 4, 3, 1],
    # Corridor 6: Kalpana -> Master Canteen -> Acharya Vihar -> Jaydev Vihar
    [7, 6, 3, 4],
    # Corridor 7: Jaydev Vihar -> Chandrasekharpur -> Patia -> KIIT
    [4, 8, 9, 10]
]

# Dedicated ambient fleet for live simulation to ensure tracked vehicles retain distinct, clean trajectories
STREAM_COMMUTER_PLATES = [
    {"plate": "OD02TR1011", "type": "Car", "color": "Silver", "make": "Sedan"},
    {"plate": "OD02CV4455", "type": "Car", "color": "White", "make": "SUV"},
    {"plate": "OD33AB8899", "type": "Bus", "color": "Blue", "make": "City Bus"},
    {"plate": "OD14TK2200", "type": "Truck", "color": "Yellow", "make": "Heavy Truck"},
    {"plate": "OD05MC3311", "type": "Motorcycle", "color": "Black", "make": "Bike"},
    {"plate": "OD02PX7788", "type": "Car", "color": "Red", "make": "Sedan"},
    {"plate": "OD02KL5566", "type": "Car", "color": "Grey", "make": "Sedan"},
    {"plate": "OD07BB9001", "type": "Car", "color": "White", "make": "Hatchback"},
    {"plate": "OD10ZZ4040", "type": "Car", "color": "Blue", "make": "Sedan"},
    {"plate": "OD02MN3131", "type": "Car", "color": "Black", "make": "SUV"},
    {"plate": "OD33CC1212", "type": "Bus", "color": "Green", "make": "Bus"},
    {"plate": "OD05BK8800", "type": "Motorcycle", "color": "Red", "make": "Bike"},
    {"plate": "OD14HT9911", "type": "Truck", "color": "Brown", "make": "Truck"},
]

# Camera junction speed profiles for realistic traffic flow
JUNCTION_SPEED_PROFILES = {
    1: (18.0, 26.0),  # Rasulgarh: Heavy chokepoint crawl
    2: (34.0, 43.0),  # Vani Vihar
    3: (39.0, 48.0),  # Acharya Vihar
    4: (22.0, 31.0),  # Jaydev Vihar: Heavy congestion
    5: (58.0, 68.0),  # Khandagiri: Express bypass
    6: (28.0, 36.0),  # Master Canteen: Downtown core
    7: (43.0, 52.0),  # Kalpana: Heritage link
    8: (48.0, 58.0),  # Chandrasekharpur: Boulevard
    9: (38.0, 46.0),  # Patia Square: Tech corridor
    10: (32.0, 40.0), # KIIT Square: Campus zone
    11: (62.0, 72.0), # Infocity: High-speed expressway
    12: (30.0, 38.0), # Baramunda: Bus terminal
}

class ActiveVehicleJourney:
    def __init__(self, plate_info: dict, corridor: List[int]):
        self.plate = plate_info["plate"]
        self.v_type = plate_info["type"]
        self.color = plate_info.get("color", "White")
        self.make = plate_info.get("make", "Sedan")
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
        for plate_info in STREAM_COMMUTER_PLATES[:8]:
            corridor = random.choice(CORRIDOR_CAMERAS)
            journey = ActiveVehicleJourney(plate_info, corridor)
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
        # Clean completed journeys and replenish with fresh distinct commuters
        self._active_journeys = [j for j in self._active_journeys if not j.completed]
        if len(self._active_journeys) < 6:
            plate_info = random.choice(STREAM_COMMUTER_PLATES)
            corridor = random.choice(CORRIDOR_CAMERAS)
            self._active_journeys.append(ActiveVehicleJourney(plate_info, corridor))

        if not self._active_journeys:
            return

        journey = random.choice(self._active_journeys)
        cam_id = journey.next_camera_id()
        if not cam_id:
            return

        session = get_session()
        try:
            cam = session.query(Camera).filter(Camera.id == cam_id).first()
            if not cam or cam.status != "ACTIVE":
                return

            min_sp, max_sp = JUNCTION_SPEED_PROFILES.get(cam.id, (35.0, 50.0))
            type_mod = -3.0 if journey.v_type in ["Truck", "Bus"] else 0.0
            speed = max(16.0, random.uniform(min_sp, max_sp) + type_mod)
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
                vehicle_color=journey.color,
                make_model=journey.make,
                direction=cam.direction or direction,
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

            # Alert checks
            alert_svc = AlertService(session)

            # 1. Blacklist Match Alert
            try:
                bl_alert = alert_svc.check_blacklist_match(journey.plate, cam.id, cam.name)
                if bl_alert:
                    await ws_manager.broadcast_alert(bl_alert)
            except Exception:
                pass

            # 2. Suspicious Speed / Route Anomaly Alert
            try:
                sp_alert = alert_svc.check_suspicious_route(journey.plate, cam.id, speed)
                if sp_alert:
                    await ws_manager.broadcast_alert(sp_alert)
                elif speed > 75.0:
                    speed_alerts = alert_svc.check_speed_anomalies()
                    for sa in speed_alerts:
                        await ws_manager.broadcast_alert(sa)
            except Exception:
                pass

            # 3. Check geofences
            try:
                geo_svc = GeofenceService(session)
                geo_alerts = geo_svc.check_point_in_geofences(cam.latitude, cam.longitude, journey.plate, cam.id)
                if geo_alerts:
                    for ga in geo_alerts:
                        await ws_manager.broadcast_alert(ga)
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
