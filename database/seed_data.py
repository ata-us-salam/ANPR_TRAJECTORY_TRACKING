import datetime
import random
import os
import sys

sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from database.models import init_db, get_session, Camera, PlateEvent, Trajectory, FlaggedVehicle, Alert
from analytics.trajectory import TrajectoryEngine

# Bhubaneswar Smart City Surveillance Camera Network Registry
MOCK_CAMERAS = [
    {"id": 1, "name": "CAM-001", "location_name": "Rasulgarh Junction", "lat": 20.2917, "lng": 85.8643, "direction": "North → South", "status": "ACTIVE"},
    {"id": 2, "name": "CAM-002", "location_name": "Vani Vihar Square", "lat": 20.3018, "lng": 85.8491, "direction": "East → West", "status": "ACTIVE"},
    {"id": 3, "name": "CAM-003", "location_name": "Acharya Vihar", "lat": 20.2982, "lng": 85.8362, "direction": "North → South", "status": "ACTIVE"},
    {"id": 4, "name": "CAM-004", "location_name": "Jaydev Vihar", "lat": 20.3015, "lng": 85.8239, "direction": "East → West", "status": "ACTIVE"},
    {"id": 5, "name": "CAM-005", "location_name": "Khandagiri Square", "lat": 20.2586, "lng": 85.7865, "direction": "South → West", "status": "ACTIVE"},
    {"id": 6, "name": "CAM-006", "location_name": "Master Canteen Square", "lat": 20.2676, "lng": 85.8427, "direction": "Central Loop", "status": "ACTIVE"},
    {"id": 7, "name": "CAM-007", "location_name": "Kalpana Square", "lat": 20.2562, "lng": 85.8441, "direction": "South → North", "status": "ACTIVE"},
    {"id": 8, "name": "CAM-008", "location_name": "Chandrasekharpur", "lat": 20.3248, "lng": 85.8172, "direction": "South → North", "status": "ACTIVE"},
    {"id": 9, "name": "CAM-009", "location_name": "Patia Square", "lat": 20.3547, "lng": 85.8178, "direction": "South → North", "status": "ACTIVE"},
    {"id": 10, "name": "CAM-010", "location_name": "KIIT Square", "lat": 20.3562, "lng": 85.8190, "direction": "West → East", "status": "ACTIVE"},
    {"id": 11, "name": "CAM-011", "location_name": "Infocity Junction", "lat": 20.3585, "lng": 85.8115, "direction": "North → West", "status": "ACTIVE"},
    {"id": 12, "name": "CAM-012", "location_name": "Baramunda Bus Stand", "lat": 20.2798, "lng": 85.7925, "direction": "West → North", "status": "ACTIVE"},
    {"id": 13, "name": "CAM-013", "location_name": "Cuttack-Puri Road (Ravi Talkies)", "lat": 20.2505, "lng": 85.8475, "direction": "South → East", "status": "MAINTENANCE"}
]

# Real City Corridors across Bhubaneswar Arterial Network
CORRIDORS = [
    # Corridor 0: Rasulgarh -> Acharya Vihar -> Jaydev Vihar -> Patia -> Infocity (Flagship SIH Path)
    [1, 2, 3, 4, 8, 9, 10, 11],
    # Corridor 1: Baramunda -> Jaydev Vihar -> Acharya Vihar -> Vani Vihar -> Rasulgarh
    [12, 4, 3, 2, 1],
    # Corridor 2: Master Canteen -> Kalpana -> Khandagiri -> Baramunda
    [6, 7, 5, 12],
    # Corridor 3: North Corridor: Chandrasekharpur -> Patia -> KIIT -> Infocity
    [8, 9, 10, 11],
    # Corridor 4: South-North Trunk: Khandagiri -> Baramunda -> Jaydev Vihar -> Patia
    [5, 12, 4, 8, 9, 10],
    # Corridor 5: Reverse Infocity -> Patia -> Jaydev Vihar -> Rasulgarh
    [11, 10, 9, 8, 4, 3, 1]
]

SAMPLE_VEHICLES = [
    # Target vehicle from problem statement
    {"plate": "OD02AB1234", "type": "Car", "color": "Silver", "make": "Sedan", "corridor": 0, "base_speed": 58.0},
    {"plate": "OD05XY9087", "type": "Motorcycle", "color": "Black", "make": "Bike", "corridor": 2, "base_speed": 52.0},
    {"plate": "OD02CA9999", "type": "Car", "color": "White", "make": "SUV", "corridor": 1, "base_speed": 64.0},
    {"plate": "OD33BT8833", "type": "Bus", "color": "Blue", "make": "City Bus", "corridor": 4, "base_speed": 42.0},
    {"plate": "OD14AK7710", "type": "Truck", "color": "Yellow", "make": "Heavy Truck", "corridor": 1, "base_speed": 38.0},
    {"plate": "OD02EE8820", "type": "Car", "color": "Red", "make": "Sedan", "corridor": 3, "base_speed": 88.0}, # Speed anomaly
    {"plate": "DL01CA9999", "type": "Car", "color": "White", "make": "Sedan", "corridor": 1, "base_speed": 62.0},
    {"plate": "MH12AB4325", "type": "Truck", "color": "Dark Gray", "make": "Truck", "corridor": 3, "base_speed": 44.0},
    {"plate": "WB12AB1234", "type": "Car", "color": "Silver", "make": "Hatchback", "corridor": 0, "base_speed": 56.0},
    {"plate": "KA05MJ4012", "type": "Car", "color": "Black", "make": "SUV", "corridor": 5, "base_speed": 60.0},
    {"plate": "HR26DQ5521", "type": "Truck", "color": "Brown", "make": "Truck", "corridor": 1, "base_speed": 40.0},
    {"plate": "UP16BT8833", "type": "Bus", "color": "Green", "make": "Bus", "corridor": 4, "base_speed": 46.0},
    {"plate": "CH01BL3344", "type": "Car", "color": "White", "make": "Sedan", "corridor": 3, "base_speed": 92.0}, # Speed anomaly
    {"plate": "TS09FA8080", "type": "Car", "color": "Blue", "make": "Sedan", "corridor": 4, "base_speed": 59.0},
    {"plate": "GJ01ZZ9090", "type": "Car", "color": "White", "make": "Sedan", "corridor": 0, "base_speed": 65.0},
    {"plate": "TN07CK1212", "type": "Car", "color": "Red", "make": "Sedan", "corridor": 5, "base_speed": 57.0},
    {"plate": "DL3SCK4419", "type": "Motorcycle", "color": "Black", "make": "Bike", "corridor": 2, "base_speed": 50.0},
    {"plate": "UP14DR1102", "type": "Car", "color": "Silver", "make": "Sedan", "corridor": 0, "base_speed": 63.0}
]

def seed_database(force_refresh: bool = False):
    engine = init_db()
    session = get_session(engine)

    existing_cams = session.query(Camera).count()
    if existing_cams > 0 and not force_refresh:
        print(f"Database already contains {existing_cams} cameras. Skipping initial seed.")
        session.close()
        return

    print("Populating Smart City Camera Network (Bhubaneswar)...")
    session.query(Alert).delete()
    session.query(Trajectory).delete()
    session.query(PlateEvent).delete()
    session.query(Camera).delete()
    session.query(FlaggedVehicle).delete()
    session.commit()

    camera_lookup = {}
    for cam_data in MOCK_CAMERAS:
        cam = Camera(
            id=cam_data["id"],
            name=cam_data["name"],
            location_name=cam_data["location_name"],
            latitude=cam_data["lat"],
            longitude=cam_data["lng"],
            direction=cam_data.get("direction", "North → South"),
            status=cam_data["status"]
        )
        session.add(cam)
        camera_lookup[cam_data["id"]] = cam
    session.commit()
    print(f"Inserted {len(MOCK_CAMERAS)} Surveillance Cameras.")

    # Seed Blacklist / Watchlist Vehicles
    blacklisted = [
        {"plate": "OD02AB1234", "reason": "Reported Stolen / Wanted in Armed Robbery Case (SIH Alert)"},
        {"plate": "CH01BL3344", "reason": "Repeat Speed Violator / Hit & Run Suspect"}
    ]
    for bv in blacklisted:
        session.add(FlaggedVehicle(
            plate_text=bv["plate"],
            reason=bv["reason"],
            active=1,
            flagged_at=datetime.datetime.utcnow() - datetime.timedelta(hours=24)
        ))
    session.commit()
    print("Seeded Blacklisted Watchlist Vehicles.")

    print("Generating Chronological Vehicle Sightings & Plate Events...")
    now = datetime.datetime.utcnow()
    total_events = 0

    for v_idx, veh in enumerate(SAMPLE_VEHICLES):
        corridor = CORRIDORS[veh["corridor"]]
        plate = veh["plate"]
        v_type = veh["type"]
        v_color = veh.get("color", "White")
        v_make = veh.get("make", "Sedan")
        base_speed = veh["base_speed"]
        
        # Stagger start time over last 6 hours
        start_delta_minutes = 280 - (v_idx * 14)
        current_time = now - datetime.timedelta(minutes=start_delta_minutes)
        
        for step, cam_id in enumerate(corridor):
            if cam_id not in camera_lookup or camera_lookup[cam_id].status != "ACTIVE":
                continue
                
            jitter_speed = max(20.0, base_speed + random.uniform(-4.0, 5.0))
            conf = round(random.uniform(0.92, 0.99), 3)
            cam = camera_lookup[cam_id]
            
            event = PlateEvent(
                camera_id=cam_id,
                plate_text=plate,
                confidence=conf,
                timestamp=current_time,
                vehicle_type=v_type,
                vehicle_color=v_color,
                make_model=v_make,
                direction=cam.direction or "Northbound",
                speed_estimate_kmh=round(jitter_speed, 1)
            )
            session.add(event)
            total_events += 1
            
            # Stagger time to next camera
            if base_speed > 70.0:
                transit_minutes = random.randint(1, 2)
            elif base_speed > 50.0:
                transit_minutes = random.randint(3, 5)
            else:
                transit_minutes = random.randint(6, 10)
            current_time += datetime.timedelta(minutes=transit_minutes)

    session.commit()
    print(f"Inserted {total_events} Plate Events across Bhubaneswar.")

    print("Rebuilding Trajectories using TrajectoryEngine...")
    traj_engine = TrajectoryEngine(session)
    rebuilt = traj_engine.rebuild_all_trajectories()
    print(f"Successfully generated {len(rebuilt)} Reconstructed Vehicle Trajectories.")

    # Generate initial alerts for speed anomalies and blacklisted detections
    try:
        from backend.services.alert_service import AlertService
        alert_svc = AlertService(session)
        speed_alerts = alert_svc.check_speed_anomalies(threshold_kmh=75.0)
        print(f"Generated {len(speed_alerts)} Speed Anomaly Alert(s).")
        
        # Also check blacklist sightings
        for bv in blacklisted:
            recent_ev = session.query(PlateEvent).filter(PlateEvent.plate_text == bv["plate"]).order_by(PlateEvent.timestamp.desc()).first()
            if recent_ev:
                alert_svc.create_alert(
                    alert_type="FLAGGED_VEHICLE",
                    severity="CRITICAL",
                    message=f"🚨 BLACKLISTED VEHICLE DETECTED - Plate: {bv['plate']}, Camera: {recent_ev.camera.name} ({recent_ev.camera.location_name}), Time: {recent_ev.timestamp.strftime('%H:%M:%S')}, Reason: {bv['reason']}",
                    plate_text=bv["plate"],
                    camera_id=recent_ev.camera_id
                )
        print("Generated initial Blacklist Alert.")
    except Exception as ae:
        print(f"Alert generation error: {ae}")

    session.close()

if __name__ == "__main__":
    seed_database(force_refresh=True)
