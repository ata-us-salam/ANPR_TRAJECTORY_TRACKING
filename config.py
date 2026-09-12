"""
Centralized configuration management for the ANPR Trajectory Tracking system.
Reads from environment variables with sensible defaults for local development.
"""

import os
from dotenv import load_dotenv

load_dotenv()

# ── Base Paths ──
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(BASE_DIR, "data")
FRONTEND_DIR = os.path.join(BASE_DIR, "frontend")

# ── Database ──
DATABASE_URL = os.getenv("DATABASE_URL", f"sqlite:///{os.path.join(DATA_DIR, 'anpr.db')}")

# ── Server ──
HOST = os.getenv("HOST", "0.0.0.0")
PORT = int(os.getenv("PORT", "8000"))
DEBUG = os.getenv("DEBUG", "true").lower() == "true"

# ── CORS ──
CORS_ORIGINS = os.getenv("CORS_ORIGINS", "*").split(",")

# ── Upload Limits ──
MAX_IMAGE_UPLOAD_MB = int(os.getenv("MAX_IMAGE_UPLOAD_MB", "10"))
MAX_VIDEO_UPLOAD_MB = int(os.getenv("MAX_VIDEO_UPLOAD_MB", "50"))
MAX_IMAGE_UPLOAD_BYTES = MAX_IMAGE_UPLOAD_MB * 1024 * 1024
MAX_VIDEO_UPLOAD_BYTES = MAX_VIDEO_UPLOAD_MB * 1024 * 1024

# ── WebSocket ──
WS_HEARTBEAT_INTERVAL = int(os.getenv("WS_HEARTBEAT_INTERVAL", "30"))
WS_MAX_CONNECTIONS = int(os.getenv("WS_MAX_CONNECTIONS", "100"))

# ── Alert Thresholds ──
SPEED_ANOMALY_THRESHOLD_KMH = float(os.getenv("SPEED_ANOMALY_THRESHOLD_KMH", "75.0"))
GEOFENCE_CHECK_INTERVAL = int(os.getenv("GEOFENCE_CHECK_INTERVAL", "10"))

# ── Video Pipeline ──
VIDEO_TARGET_FPS = int(os.getenv("VIDEO_TARGET_FPS", "5"))

# ── Export ──
EXPORT_DIR = os.path.join(DATA_DIR, "exports")
os.makedirs(EXPORT_DIR, exist_ok=True)
