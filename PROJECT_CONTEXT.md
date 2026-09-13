# 🏛️ CITYSURV — Complete Project Context & Architecture Reference

> **CRITICAL AGENT DIRECTIVE**: Read this document thoroughly before proposing or executing any code modifications. This file serves as the canonical source of truth for repository architecture, runtime parameters, data structures, resolved issues, and behavioral constraints. Do NOT deviate from the patterns documented here.

---

## 1. System Overview & Core Purpose
**CITYSURV** is an intelligent multi-camera **Automatic Number Plate Recognition (ANPR)** and **Vehicle Trajectory Tracking & GIS Surveillance System**.
- **Location Context**: Centered on the smart city corridor of **Bhubaneswar, Odisha, India** (`[20.3000, 85.8271]`).
- **Core Pipeline**: Decoupled multi-stage computer vision and analytics system:
  1. Vehicle detection via YOLOv8 (`models/detection/vehicle_detector.py`).
  2. Custom license plate detection via fine-tuned YOLOv8 (`models/detection/weights/license_plate_detector.pt`).
  3. Preprocessing via OpenCV (`models/anpr/preprocessing.py`) using CLAHE, bilateral filtering, and Otsu binarization.
  4. OCR text extraction via EasyOCR (`models/anpr/ocr_reader.py`).
  5. Indian RTO plate syntax validation & error correction (`models/anpr/validation.py`).
  6. Trajectory reconstruction, speed anomaly calculations, OD matrix analysis, and real-time GIS mapping.

---

## 2. Technology Stack & Dependencies
- **Runtime Environment**: Windows OS, Python 3.10+ (tested on Python 3.13).
- **Web Framework**: FastAPI (`backend/main.py`) + Uvicorn ASGI server running on `http://127.0.0.1:8000`.
- **Database**: SQLite (`data/anpr.db`) operated through SQLAlchemy ORM with **WAL Mode** enabled.
- **Frontend**: Vanilla ES6+ JavaScript (`frontend/app.js`), semantic HTML5 (`frontend/index.html`), custom dark/glassmorphic CSS (`frontend/style.css`), and Leaflet.js (`1.9.4`) with Leaflet PolylineDecorator.
- **Computer Vision & ML**:
  - `ultralytics` (YOLOv8)
  - `torch` & `torchvision`
  - `opencv-python` (used for image decoding, binarization, filtering, and video frame extraction)
  - `easyocr` (OCR engine)

---

## 3. Database Layer & Engine Optimization
### A. Connection Caching & WAL Mode (`database/models.py`)
- **Connection Optimization**: Global caching of SQLAlchemy `Engine` (`_GLOBAL_ENGINE`) and `sessionmaker` (`_GLOBAL_SESSIONMAKER`) prevents connection exhaustion and latency spikes.
- **SQLite Concurrency Settings**:
  ```python
  @event.listens_for(engine, "connect")
  def set_sqlite_pragma(dbapi_connection, connection_record):
      cursor = dbapi_connection.cursor()
      cursor.execute("PRAGMA journal_mode=WAL;")
      cursor.execute("PRAGMA synchronous=NORMAL;")
      cursor.execute("PRAGMA busy_timeout=10000;")
      cursor.close()
  ```
- **File Exclusions**: SQLite temporary journal files (`*.db-shm`, `*.db-wal`, `*.sqlite3`) are explicitly ignored in `.gitignore`.

### B. Core Data Models
1. `Camera`:
   - Attributes: `id`, `name`, `latitude`, `longitude`, `location_name`, `direction`, `status`, `ip_address`, `last_ping`.
2. `PlateEvent`:
   - Attributes: `id`, `plate_text`, `camera_id`, `timestamp`, `confidence`, `vehicle_type`, `speed_estimate_kmh`, `direction`, `image_path`.
3. `FlaggedVehicle`:
   - Attributes: `id`, `plate_text`, `reason`, `severity`, `added_at`, `active`.
4. `Alert`:
   - Attributes: `id`, `alert_type`, `severity`, `plate_text`, `camera_id`, `message`, `timestamp`, `acknowledged`.
5. `GeofenceZone`:
   - Attributes: `id`, `name`, `zone_type`, `coordinates_json`, `created_at`.

---

## 4. Backend API Specifications & Routing

| Endpoint | Method | Description | Key Query Params / Payload |
| :--- | :---: | :--- | :--- |
| `/api/health` | GET | Health check with DB status & version | None |
| `/api/cameras` | GET | Camera list with single-query sightings count | None |
| `/api/cameras/{id}` | GET | Specific camera metadata | `id` |
| `/api/events` | GET | Paginated sightings query | `plate`, `camera_id`, `page`, `page_size` |
| `/api/events/recent` | GET | Latest 20 sightings | None |
| `/api/events` | POST | Ingest new sighting event | JSON body (`PlateEventCreate`) |
| `/api/trajectories` | GET | Paginated list of reconstructed journeys | `page`, `page_size` |
| `/api/trajectories/plates` | GET | List of all unique tracked plates | `limit`, `offset` |
| `/api/trajectories/suggest` | GET | Real-time autocomplete suggestions | `q` (search string), `limit=10` |
| `/api/trajectories/search` | GET | Full multi-hop trajectory for a plate | `plate` |
| `/api/analytics/summary` | GET | High-level system KPIs & uptime | None |
| `/api/analytics/heatmap` | GET | 24-hour hour × camera density matrix | None (SQL `GROUP BY`) |
| `/api/analytics/traffic-volume`| GET | Hourly volume curve & vehicle distribution | None (SQL `GROUP BY`) |
| `/api/analytics/od-matrix` | GET | Origin-Destination travel volume pairs | `limit` |
| `/api/analytics/predict-route` | GET | Markov-chain next camera prediction | `plate` |
| `/api/alerts` | GET | Alert feed with severity filters | `severity`, `alert_type` |
| `/api/geofences` | GET/POST | List or create spatial polygon geofences | GeoJSON coordinates |
| `/ws/live` | WebSocket | Push notifications for sightings & alerts | Stream of `{type: 'sighting'\|'alert', data: {...}}` |

---

## 5. Background Automation Services
1. **Traffic Streamer (`backend/services/traffic_streamer.py`)**:
   - Runs asynchronously during the FastAPI lifespan.
   - Generates realistic vehicle sightings along connected camera corridors at 4-second intervals.
   - Pushes telemetry via `websocket_manager.broadcast()`.
2. **Alert Evaluator (`backend/services/alert_service.py`)**:
   - Evaluates speed anomalies (>75 km/h).
   - Evaluates blacklisted/flagged vehicle matches against `FlaggedVehicle`.
   - **Backend Alert Throttling**: Checks for existing alerts within the last 10 minutes (`ten_mins_ago`) for the same vehicle plate before writing to the database or triggering critical alerts.

---

## 6. Frontend State & Behavioral Rules (`frontend/app.js`)

### A. Sound & Audio Rules
- **Sound Alert Explicitly Silenced**: `playAlertTone()` has all Web Audio oscillator synthesizers disabled. All alert triggers must remain silent.

### B. Security Modal & Notification Throttling
- **Throttling Interval**: `showBlacklistModal()` enforces a minimum cooldown of **15 minutes** between full-screen modals.
- **Session Suppression**: When a user clicks **"Dismiss"** or **"Track Vehicle Trajectory"**, the plate is added to `dismissedBlacklistPlates = new Set()`. The full-screen alert modal will **never pop back up** for that plate during the session.

### C. Trajectory Tracking & Animation
- **Search Logic**:
  - Automatically trims, normalizes, and matches plates.
  - Linked to HTML5 `<datalist id="tracked-plates-datalist">` populated dynamically from `/api/trajectories/suggest`.
- **Visual Distinction on Map**:
  - **Start / Origin**: Emerald beacon marker with `START / ORIGIN 🚩` badge and origin timestamp.
  - **End / Destination**: Ruby beacon marker with `END / DESTINATION 🏁` badge and destination timestamp.
  - **Waypoints**: Numbered circular checkpoint badges (`#2`, `#3`, etc.).
  - **Chevrons**: Directional orientation arrows along route polyline segments.
  - **Vehicle Playback Simulation**: `playTrajectorySimulation()` moves a car marker along the polyline in real-time.
- **Dynamic Checkpoint Appending**:
  - When a vehicle is actively tracked and a new sighting arrives via WebSocket, `appendLiveCheckpointToTrajectory(eventData)` extends the route polyline in real-time and triggers a camera radar ping.

### D. Traffic Flow Layer & CCTV Stream
- **Traffic Density**: Computes traffic bubbles (Green <10, Orange 10–25, Red >25) and displays the OD corridor arrows with a bottom-left legend.
- **Live ANPR Stream**: The "Live ANPR Stream" tab (`#live-anpr-view`) renders an animated perspective canvas with vehicle bounding boxes and live-updating OCR sighting cards.

---

## 7. Known Gotchas & Resolved Pitfalls
1. **Map Coordinates**: Do NOT center on New Delhi (`28.60, 77.22`). All seeded cameras and events are in **Bhubaneswar, Odisha** (`[20.3000, 85.8271]`).
2. **SQLite Locking**: Always use `SessionLocal = get_session_maker()` and close sessions cleanly. Never instantiate `create_engine()` inside request handlers.
3. **N+1 Sighting Queries**: Camera sighting counts are calculated in a single query via `SELECT camera_id, COUNT(*) FROM plate_events GROUP BY camera_id`.
4. **Modal Loop**: Never trigger `showBlacklistModal()` directly on every WebSocket message without checking `dismissedBlacklistPlates` and `lastBlacklistModalTime`.

---

## 8. Verification & Test Commands
To verify the entire system after any modifications, run:
```bash
# Production readiness, security headers & query optimizations (9/9 checks)
python tests/test_production_readiness.py

# Full feature integration test suite (6/6 phases)
python tests/test_enhanced_features.py
```
