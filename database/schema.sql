-- Enable PostGIS extension for spatial queries
CREATE EXTENSION IF NOT EXISTS postgis;

-- 1. Cameras Table
CREATE TABLE IF NOT EXISTS cameras (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    location GEOMETRY(Point, 4326) NOT NULL, -- WGS 84 Point
    status VARCHAR(50) DEFAULT 'ACTIVE',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 2. Plate Events Table (Each time a vehicle is fully processed by Phase 3)
CREATE TABLE IF NOT EXISTS plate_events (
    id SERIAL PRIMARY KEY,
    camera_id INTEGER REFERENCES cameras(id),
    plate_text VARCHAR(20) NOT NULL,
    confidence FLOAT NOT NULL,
    timestamp TIMESTAMP NOT NULL,
    vehicle_type VARCHAR(50), -- e.g., Car, Truck, Bike
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create index for fast lookups by plate and time
CREATE INDEX IF NOT EXISTS idx_plate_events_plate_time ON plate_events(plate_text, timestamp);
CREATE INDEX IF NOT EXISTS idx_plate_events_camera ON plate_events(camera_id);

-- 3. Trajectories Table (Aggregated paths across cameras)
CREATE TABLE IF NOT EXISTS trajectories (
    id SERIAL PRIMARY KEY,
    plate_text VARCHAR(20) NOT NULL,
    start_time TIMESTAMP NOT NULL,
    end_time TIMESTAMP NOT NULL,
    path GEOMETRY(LineString, 4326) NOT NULL,
    total_cameras INTEGER NOT NULL,
    distance_km FLOAT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create index for trajectory queries
CREATE INDEX IF NOT EXISTS idx_trajectories_plate ON trajectories(plate_text);
CREATE INDEX IF NOT EXISTS idx_trajectories_time ON trajectories(start_time, end_time);

-- 4. Alerts Table
CREATE TABLE IF NOT EXISTS alerts (
    id SERIAL PRIMARY KEY,
    alert_type VARCHAR(50) NOT NULL,
    severity VARCHAR(20) NOT NULL DEFAULT 'WARNING',
    message TEXT NOT NULL,
    plate_text VARCHAR(20),
    camera_id INTEGER REFERENCES cameras(id),
    metadata_json TEXT DEFAULT '{}',
    acknowledged INTEGER DEFAULT 0,
    acknowledged_at TIMESTAMP,
    timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_alerts_type ON alerts(alert_type);
CREATE INDEX IF NOT EXISTS idx_alerts_plate ON alerts(plate_text);
CREATE INDEX IF NOT EXISTS idx_alerts_timestamp ON alerts(timestamp);

-- 5. Geofence Zones Table
CREATE TABLE IF NOT EXISTS geofence_zones (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    polygon_json TEXT NOT NULL DEFAULT '[]',
    color VARCHAR(20) DEFAULT '#f43f5e',
    zone_type VARCHAR(50) DEFAULT 'restricted',
    active INTEGER DEFAULT 1,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 6. Flagged Vehicles Table
CREATE TABLE IF NOT EXISTS flagged_vehicles (
    id SERIAL PRIMARY KEY,
    plate_text VARCHAR(20) NOT NULL UNIQUE,
    reason TEXT DEFAULT '',
    active INTEGER DEFAULT 1,
    flagged_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_flagged_vehicles_plate ON flagged_vehicles(plate_text);
