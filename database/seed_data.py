import datetime
import random
import os
import sys

sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from database.models import init_db, get_session, Camera, PlateEvent, Trajectory
from analytics.trajectory import TrajectoryEngine

# Realistic Camera Locations across a Connected Arterial Highway & Corridor
MOCK_CAMERAS = [
    {"id": 1, "name": "CAM-01", "location_name": "Connaught Place Inner Circle", "lat": 28.6328, "lng": 77.2197, "status": "ACTIVE"},
    {"id": 2, "name": "CAM-02", "location_name": "Barakhamba Road Crossing", "lat": 28.6295, "lng": 77.2268, "status": "ACTIVE"},
    {"id": 3, "name": "CAM-03", "location_name": "Mandi House Roundabout", "lat": 28.6247, "lng": 77.2343, "status": "ACTIVE"},
    {"id": 4, "name": "CAM-04", "location_name": "India Gate C-Hexagon", "lat": 28.6129, "lng": 77.2295, "status": "ACTIVE"},
    {"id": 5, "name": "CAM-05", "location_name": "Khan Market Outer Road", "lat": 28.6002, "lng": 77.2274, "status": "ACTIVE"},
    {"id": 6, "name": "CAM-06", "location_name": "AIIMS Flyover North", "lat": 28.5672, "lng": 77.2100, "status": "ACTIVE"},
    {"id": 7, "name": "CAM-07", "location_name": "South Extension Ring Road", "lat": 28.5701, "lng": 77.2215, "status": "ACTIVE"},
    {"id": 8, "name": "CAM-08", "location_name": "Lajpat Nagar Flyover", "lat": 28.5705, "lng": 77.2392, "status": "ACTIVE"},
    {"id": 9, "name": "CAM-09", "location_name": "Ashram Chowk Junction", "lat": 28.5714, "lng": 77.2588, "status": "ACTIVE"},
    {"id": 10, "name": "CAM-10", "location_name": "DND Flyway Toll Plaza", "lat": 28.5684, "lng": 77.2882, "status": "ACTIVE"},
    {"id": 11, "name": "CAM-11", "location_name": "Dhaula Kuan Underpass", "lat": 28.5921, "lng": 77.1610, "status": "ACTIVE"},
    {"id": 12, "name": "CAM-12", "location_name": "IGI Airport Corridor Road", "lat": 28.5562, "lng": 77.0855, "status": "ACTIVE"},
    {"id": 13, "name": "CAM-13", "location_name": "ITO Junction Bridge", "lat": 28.6300, "lng": 77.2480, "status": "MAINTENANCE"}
]

# Vehicle corridors for realistic trajectory journeys
CORRIDORS = [
    # North-to-South Ring Road Route
    [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
    # East-West Arterial Corridor
    [10, 9, 8, 7, 6, 11, 12],
    # Central Loop
    [1, 2, 3, 4, 1],
    # Ring Road Section
    [6, 7, 8, 9, 10],
    # Airport Express Link
    [1, 4, 6, 11, 12],
    # Reverse South-North Link
    [10, 9, 8, 7, 6, 5, 4, 1]
]

SAMPLE_VEHICLES = [
    {"plate": "OD02AB1234", "type": "Car", "corridor": 0, "base_speed": 55.0},
    {"plate": "DL01CA9999", "type": "Car", "corridor": 1, "base_speed": 62.0},
    {"plate": "HR26DQ5521", "type": "Truck", "corridor": 3, "base_speed": 42.0},
    {"plate": "UP16BT8833", "type": "Bus", "corridor": 4, "base_speed": 45.0},
    {"plate": "DL3SCK4419", "type": "Motorcycle", "corridor": 2, "base_speed": 48.0},
    {"plate": "MH02EE8820", "type": "Car", "corridor": 3, "base_speed": 92.0}, # Speed anomaly
    {"plate": "WB12AB1234", "type": "Car", "corridor": 0, "base_speed": 58.0},
    {"plate": "KA05MJ4012", "type": "Car", "corridor": 5, "base_speed": 60.0},
    {"plate": "DL8CAF3021", "type": "Car", "corridor": 4, "base_speed": 52.0},
    {"plate": "HR55AK7710", "type": "Truck", "corridor": 1, "base_speed": 38.0},
    {"plate": "UP14DR1102", "type": "Car", "corridor": 0, "base_speed": 65.0},
    {"plate": "DL2CBB5091", "type": "Car", "corridor": 5, "base_speed": 54.0},
    {"plate": "CH01BL3344", "type": "Car", "corridor": 3, "base_speed": 88.0}, # Speed anomaly
    {"plate": "RJ14CA2201", "type": "Bus", "corridor": 1, "base_speed": 44.0},
    {"plate": "DL9SBE6611", "type": "Motorcycle", "corridor": 2, "base_speed": 50.0},
    {"plate": "TS09FA8080", "type": "Car", "corridor": 4, "base_speed": 58.0},
    {"plate": "GJ01ZZ9090", "type": "Car", "corridor": 0, "base_speed": 61.0},
    {"plate": "TN07CK1212", "type": "Car", "corridor": 5, "base_speed": 57.0},
]

def seed_database(force_refresh: bool = False):
    engine = init_db()
    session = get_session(engine)

    existing_cams = session.query(Camera).count()
    if existing_cams > 0 and not force_refresh:
        print(f"Database already contains {existing_cams} cameras. Skipping initial seed.")
        session.close()
        return

    print("Populating Smart City Camera Network...")
    session.query(Trajectory).delete()
    session.query(PlateEvent).delete()
    session.query(Camera).delete()
    session.commit()

    camera_lookup = {}
    for cam_data in MOCK_CAMERAS:
        cam = Camera(
            id=cam_data["id"],
            name=cam_data["name"],
            location_name=cam_data["location_name"],
            latitude=cam_data["lat"],
            longitude=cam_data["lng"],
            status=cam_data["status"]
        )
        session.add(cam)
        camera_lookup[cam_data["id"]] = cam
    session.commit()
    print(f"Inserted {len(MOCK_CAMERAS)} Surveillance Cameras.")

    print("Generating Chronological Vehicle Sightings & Plate Events...")
    now = datetime.datetime.utcnow()
    # Spread starting times over the past 6 hours
    
    total_events = 0
    for v_idx, veh in enumerate(SAMPLE_VEHICLES):
        corridor = CORRIDORS[veh["corridor"]]
        plate = veh["plate"]
        v_type = veh["type"]
        base_speed = veh["base_speed"]
        
        # Stagger start time
        start_delta_minutes = 300 - (v_idx * 14)
        current_time = now - datetime.timedelta(minutes=start_delta_minutes)
        
        for step, cam_id in enumerate(corridor):
            if cam_id not in camera_lookup or camera_lookup[cam_id].status != "ACTIVE":
                continue
                
            # Randomize speed slightly
            jitter_speed = max(20.0, base_speed + random.uniform(-5.0, 5.0))
            conf = round(random.uniform(0.91, 0.99), 3)
            
            event = PlateEvent(
                camera_id=cam_id,
                plate_text=plate,
                confidence=conf,
                timestamp=current_time,
                vehicle_type=v_type,
                speed_estimate_kmh=round(jitter_speed, 1)
            )
            session.add(event)
            total_events += 1
            
            # Progress time to next camera based on speed and distance
            if base_speed > 70.0:
                transit_minutes = random.randint(1, 2)
            elif base_speed > 50.0:
                transit_minutes = random.randint(3, 5)
            else:
                transit_minutes = random.randint(6, 10)
            current_time += datetime.timedelta(minutes=transit_minutes)

    session.commit()
    print(f"Inserted {total_events} Plate Events across the city.")

    print("Rebuilding Trajectories using TrajectoryEngine...")
    traj_engine = TrajectoryEngine(session)
    rebuilt = traj_engine.rebuild_all_trajectories()
    print(f"Successfully generated {len(rebuilt)} Reconstructed Vehicle Trajectories.")
    
    session.close()

if __name__ == "__main__":
    seed_database(force_refresh=True)
