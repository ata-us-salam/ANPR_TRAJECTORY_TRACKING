import os
import sys
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse

# Suppress spurious WinError 10054 on Windows ProactorEventLoop when clients disconnect/refresh
if sys.platform == "win32":
    from functools import wraps
    try:
        from asyncio.proactor_events import _ProactorBasePipeTransport
        def _silence_conn_lost(func):
            @wraps(func)
            def wrapper(self, *args, **kwargs):
                try:
                    return func(self, *args, **kwargs)
                except (ConnectionResetError, OSError):
                    pass
            return wrapper
        _ProactorBasePipeTransport._call_connection_lost = _silence_conn_lost(
            _ProactorBasePipeTransport._call_connection_lost
        )
    except Exception:
        pass

# Ensure root workspace directory is in sys.path
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if BASE_DIR not in sys.path:
    sys.path.insert(0, BASE_DIR)

from database.models import init_db, get_session, Camera
from database.seed_data import seed_database
from backend.api.cameras import router as cameras_router
from backend.api.events import router as events_router
from backend.api.trajectories import router as trajectories_router
from backend.api.analytics import router as analytics_router
from backend.api.inference_api import router as inference_router
from backend.api.alerts import router as alerts_router
from backend.api.export import router as export_router
from backend.api.geofence import router as geofence_router
from backend.api.websocket import router as websocket_router
from backend.api.vehicles import router as vehicles_router


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifecycle: initialize database and seed data on startup."""
    init_db()
    session = get_session()
    cam_count = session.query(Camera).count()
    session.close()
    if cam_count == 0:
        print("[Startup] Seeding initial city surveillance data...")
        seed_database(force_refresh=True)

    # Generate initial speed anomaly alerts
    try:
        from backend.services.alert_service import AlertService
        alert_session = get_session()
        alert_svc = AlertService(alert_session)
        new_alerts = alert_svc.check_speed_anomalies()
        alert_session.close()
        if new_alerts:
            print(f"[Startup] Generated {len(new_alerts)} speed anomaly alert(s).")
    except Exception as e:
        print(f"[Startup] Alert generation skipped: {e}")

    # Start Autonomous Live City ANPR Traffic Streamer
    try:
        from backend.services.traffic_streamer import traffic_streamer
        await traffic_streamer.start()
    except Exception as e:
        print(f"[Startup] Traffic streamer start error: {e}")

    yield

    # Gracefully stop traffic streamer on server shutdown
    try:
        from backend.services.traffic_streamer import traffic_streamer
        await traffic_streamer.stop()
    except Exception:
        pass

app = FastAPI(
    title="City-Wide ANPR Trajectory Tracking & Traffic Surveillance System",
    description="Intelligent multi-camera ANPR tracking, vehicle trajectory reconstruction, and GIS analytics dashboard.",
    version="2.0.0",
    lifespan=lifespan,
)

# CORS Configuration: restrict or read from environment for production safety
CORS_ORIGINS = os.getenv("CORS_ORIGINS", "*").split(",")

app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_credentials=False if "*" in CORS_ORIGINS else True,
    allow_methods=["GET", "POST", "DELETE", "OPTIONS"],
    allow_headers=["*"],
)

# Security headers middleware
@app.middleware("http")
async def add_security_headers(request, call_next):
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["X-XSS-Protection"] = "1; mode=block"
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    return response

# Register API routers
app.include_router(cameras_router, prefix="/api")
app.include_router(events_router, prefix="/api")
app.include_router(trajectories_router, prefix="/api")
app.include_router(analytics_router, prefix="/api")
app.include_router(inference_router, prefix="/api")
app.include_router(alerts_router, prefix="/api")
app.include_router(export_router, prefix="/api")
app.include_router(geofence_router, prefix="/api")
app.include_router(vehicles_router, prefix="/api")

# WebSocket router (mounted at root level, paths are /ws/*)
app.include_router(websocket_router)

# Serve Frontend static assets
FRONTEND_DIR = os.path.join(BASE_DIR, "frontend")

@app.get("/api/health")
def health_check():
    return {
        "status": "healthy",
        "service": "ANPR Trajectory Tracking API",
        "version": "2.0.0"
    }

# Mount static frontend directory
DATA_DIR = os.path.join(BASE_DIR, "data")
if os.path.exists(DATA_DIR):
    app.mount("/data", StaticFiles(directory=DATA_DIR), name="data")

if os.path.exists(FRONTEND_DIR):
    app.mount("/static", StaticFiles(directory=FRONTEND_DIR), name="static")

    # Serve dashboard sub-page
    @app.get("/dashboard")
    def serve_dashboard():
        dashboard_file = os.path.join(FRONTEND_DIR, "dashboard", "index.html")
        if os.path.exists(dashboard_file):
            return FileResponse(dashboard_file)
        return {"message": "Dashboard page not yet created."}

    # Serve advanced map sub-page
    @app.get("/map")
    def serve_map():
        map_file = os.path.join(FRONTEND_DIR, "map", "index.html")
        if os.path.exists(map_file):
            return FileResponse(map_file)
        return {"message": "Advanced map page not yet created."}

    # Serve dedicated vehicles intelligence portal
    @app.get("/vehicles")
    def serve_vehicles():
        vehicles_file = os.path.join(FRONTEND_DIR, "vehicles", "index.html")
        if os.path.exists(vehicles_file):
            return FileResponse(vehicles_file)
        return {"message": "Vehicles portal not yet created."}

    # Serve dedicated camera registry portal
    @app.get("/cameras")
    def serve_cameras():
        cameras_file = os.path.join(FRONTEND_DIR, "cameras", "index.html")
        if os.path.exists(cameras_file):
            return FileResponse(cameras_file)
        return {"message": "Cameras page not yet created."}

    # Serve dedicated alert stream portal
    @app.get("/alerts")
    def serve_alerts():
        alerts_file = os.path.join(FRONTEND_DIR, "alerts", "index.html")
        if os.path.exists(alerts_file):
            return FileResponse(alerts_file)
        return {"message": "Alerts page not yet created."}

    @app.get("/")
    def serve_frontend_index():
        index_file = os.path.join(FRONTEND_DIR, "index.html")
        if os.path.exists(index_file):
            return FileResponse(index_file)
        return {"message": "Frontend index.html not yet created."}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("backend.main:app", host="0.0.0.0", port=8000, reload=True)
