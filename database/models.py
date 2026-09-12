import os
import datetime
import json
from sqlalchemy import Column, Integer, String, Float, DateTime, ForeignKey, Text, create_engine
from sqlalchemy.orm import declarative_base, relationship, sessionmaker

Base = declarative_base()

class Camera(Base):
    __tablename__ = 'cameras'
    
    id = Column(Integer, primary_key=True, autoincrement=True)
    name = Column(String(255), nullable=False)
    location_name = Column(String(255), default="City Intersection")
    latitude = Column(Float, nullable=False)
    longitude = Column(Float, nullable=False)
    status = Column(String(50), default='ACTIVE')  # ACTIVE, MAINTENANCE, OFFLINE
    created_at = Column(DateTime, default=datetime.datetime.utcnow)
    
    events = relationship("PlateEvent", back_populates="camera", cascade="all, delete-orphan")

    def to_dict(self):
        return {
            "id": self.id,
            "name": self.name,
            "location_name": self.location_name,
            "latitude": self.latitude,
            "longitude": self.longitude,
            "status": self.status,
            "created_at": self.created_at.isoformat() if self.created_at else None
        }


class PlateEvent(Base):
    __tablename__ = 'plate_events'
    
    id = Column(Integer, primary_key=True, autoincrement=True)
    camera_id = Column(Integer, ForeignKey('cameras.id'), nullable=False, index=True)
    plate_text = Column(String(20), nullable=False, index=True)
    confidence = Column(Float, nullable=False)
    timestamp = Column(DateTime, nullable=False, index=True)
    vehicle_type = Column(String(50), default='Car')  # Car, Truck, Bus, Motorcycle
    speed_estimate_kmh = Column(Float, nullable=True)
    created_at = Column(DateTime, default=datetime.datetime.utcnow)
    
    camera = relationship("Camera", back_populates="events")

    def to_dict(self):
        return {
            "id": self.id,
            "camera_id": self.camera_id,
            "camera_name": self.camera.name if self.camera else None,
            "camera_location": self.camera.location_name if self.camera else None,
            "latitude": self.camera.latitude if self.camera else None,
            "longitude": self.camera.longitude if self.camera else None,
            "plate_text": self.plate_text,
            "confidence": round(self.confidence, 3),
            "timestamp": self.timestamp.isoformat() if self.timestamp else None,
            "vehicle_type": self.vehicle_type,
            "speed_estimate_kmh": round(self.speed_estimate_kmh, 1) if self.speed_estimate_kmh else None
        }


class Trajectory(Base):
    __tablename__ = 'trajectories'
    
    id = Column(Integer, primary_key=True, autoincrement=True)
    plate_text = Column(String(20), nullable=False, index=True)
    start_time = Column(DateTime, nullable=False)
    end_time = Column(DateTime, nullable=False)
    total_cameras = Column(Integer, nullable=False)
    distance_km = Column(Float, default=0.0)
    avg_speed_kmh = Column(Float, default=0.0)
    duration_minutes = Column(Float, default=0.0)
    # JSON encoded list of [lat, lon] or route points
    path_coordinates_json = Column(Text, nullable=False, default="[]")
    # JSON encoded list of camera IDs traversed in order
    camera_sequence_json = Column(Text, nullable=False, default="[]")
    created_at = Column(DateTime, default=datetime.datetime.utcnow)

    @property
    def path_coordinates(self):
        try:
            return json.loads(self.path_coordinates_json)
        except Exception:
            return []

    @path_coordinates.setter
    def path_coordinates(self, val):
        self.path_coordinates_json = json.dumps(val)

    @property
    def camera_sequence(self):
        try:
            return json.loads(self.camera_sequence_json)
        except Exception:
            return []

    @camera_sequence.setter
    def camera_sequence(self, val):
        self.camera_sequence_json = json.dumps(val)

    def to_dict(self):
        return {
            "id": self.id,
            "plate_text": self.plate_text,
            "start_time": self.start_time.isoformat() if self.start_time else None,
            "end_time": self.end_time.isoformat() if self.end_time else None,
            "total_cameras": self.total_cameras,
            "distance_km": round(self.distance_km, 2),
            "avg_speed_kmh": round(self.avg_speed_kmh, 1),
            "duration_minutes": round(self.duration_minutes, 1),
            "path_coordinates": self.path_coordinates,
            "camera_sequence": self.camera_sequence
        }


class Alert(Base):
    __tablename__ = 'alerts'

    id = Column(Integer, primary_key=True, autoincrement=True)
    alert_type = Column(String(50), nullable=False, index=True)  # SPEED_ANOMALY, GEOFENCE_BREACH, FLAGGED_VEHICLE, CAMERA_OFFLINE
    severity = Column(String(20), nullable=False, default='WARNING')  # INFO, WARNING, CRITICAL
    message = Column(Text, nullable=False)
    plate_text = Column(String(20), nullable=True, index=True)
    camera_id = Column(Integer, ForeignKey('cameras.id'), nullable=True)
    metadata_json = Column(Text, default='{}')
    acknowledged = Column(Integer, default=0)  # SQLite boolean: 0=False, 1=True
    acknowledged_at = Column(DateTime, nullable=True)
    timestamp = Column(DateTime, default=datetime.datetime.utcnow, index=True)

    def to_dict(self):
        return {
            "id": self.id,
            "alert_type": self.alert_type,
            "severity": self.severity,
            "message": self.message,
            "plate_text": self.plate_text,
            "camera_id": self.camera_id,
            "metadata": json.loads(self.metadata_json) if self.metadata_json else {},
            "acknowledged": bool(self.acknowledged),
            "acknowledged_at": self.acknowledged_at.isoformat() if self.acknowledged_at else None,
            "timestamp": self.timestamp.isoformat() if self.timestamp else None,
        }


class GeofenceZone(Base):
    __tablename__ = 'geofence_zones'

    id = Column(Integer, primary_key=True, autoincrement=True)
    name = Column(String(255), nullable=False)
    polygon_json = Column(Text, nullable=False, default='[]')  # JSON array of [lat, lng] pairs
    color = Column(String(20), default='#f43f5e')
    zone_type = Column(String(50), default='restricted')  # restricted, monitoring, checkpoint
    active = Column(Integer, default=1)  # SQLite boolean
    created_at = Column(DateTime, default=datetime.datetime.utcnow)

    @property
    def polygon(self):
        try:
            return json.loads(self.polygon_json)
        except Exception:
            return []

    @polygon.setter
    def polygon(self, val):
        self.polygon_json = json.dumps(val)

    def to_dict(self):
        return {
            "id": self.id,
            "name": self.name,
            "polygon": self.polygon,
            "color": self.color,
            "zone_type": self.zone_type,
            "active": bool(self.active),
            "created_at": self.created_at.isoformat() if self.created_at else None,
        }


class FlaggedVehicle(Base):
    __tablename__ = 'flagged_vehicles'

    id = Column(Integer, primary_key=True, autoincrement=True)
    plate_text = Column(String(20), nullable=False, unique=True, index=True)
    reason = Column(Text, default='')
    active = Column(Integer, default=1)  # SQLite boolean
    flagged_at = Column(DateTime, default=datetime.datetime.utcnow)

    def to_dict(self):
        return {
            "id": self.id,
            "plate_text": self.plate_text,
            "reason": self.reason,
            "active": bool(self.active),
            "flagged_at": self.flagged_at.isoformat() if self.flagged_at else None,
        }


# Database connection helpers
DEFAULT_DB_PATH = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "data", "anpr.db"))
DEFAULT_DB_URL = f"sqlite:///{DEFAULT_DB_PATH}"

def get_db_url():
    return os.getenv("DATABASE_URL", DEFAULT_DB_URL)

def get_engine(db_url=None):
    if db_url is None:
        db_url = get_db_url()
    
    # Ensure directory exists for sqlite
    if db_url.startswith("sqlite:///"):
        sqlite_file = db_url.replace("sqlite:///", "")
        os.makedirs(os.path.dirname(os.path.abspath(sqlite_file)), exist_ok=True)
        return create_engine(db_url, connect_args={"check_same_thread": False})
    
    return create_engine(db_url)

def init_db(engine=None):
    if engine is None:
        engine = get_engine()
    Base.metadata.create_all(engine)
    return engine

def get_session(engine=None):
    if engine is None:
        engine = get_engine()
    Session = sessionmaker(bind=engine)
    return Session()
