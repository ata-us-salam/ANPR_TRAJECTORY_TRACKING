# 🚗 CITYSURV — City-Wide ANPR Trajectory Tracking & GIS Surveillance System

[![Python 3.10+](https://img.shields.io/badge/Python-3.10%2B-blue.svg)](https://www.python.org/)
[![FastAPI](https://img.shields.io/badge/FastAPI-v0.100%2B-009688.svg)](https://fastapi.tiangolo.com/)
[![YOLOv8](https://img.shields.io/badge/YOLOv8-Ultralytics-00ffff.svg)](https://docs.ultralytics.com/)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![Status: Production Ready](https://img.shields.io/badge/Status-Production%20Ready-brightgreen.svg)](#)

A high-performance, intelligent multi-camera **Automatic Number Plate Recognition (ANPR)** and **Vehicle Trajectory Tracking System** designed for modern smart city traffic surveillance.

CITYSURV localizes vehicle license plates using a fine-tuned **YOLOv8** model, extracts registration numbers using an decoupled **OCR engine**, persists structured chronological sighting events, and reconstructs vehicle travel paths across camera networks to calculate **Origin-Destination (OD) matrices**, **travel times**, **traffic congestion heatmaps**, and **speed anomaly alerts**.

---

## 📸 System Previews

| Live GIS Camera Network & Vehicle Tracking | Command Center Analytics Dashboard |
| :---: | :---: |
| Real-time camera feeds, live WebSocket telemetry, quick trajectory search | 24-Hour detection heatmap, peak-hour analysis, camera uptime matrix |

---

## 🏛️ Decoupled Architecture

CITYSURV strictly enforces the separation of concerns between visual plate localization, character recognition, and journey analytics:

```
                  Camera Video / Image Stream
                              │
                              ▼
               [Vehicle Detector (YOLOv8 nano)]
                              │ (Vehicle BBox Crop)
                              ▼
            [License Plate Detector (YOLOv8 Custom)]
                     │ ONLY outputs:
                     │ • class: license_plate
                     │ • confidence: float
                     │ • bbox: [x1, y1, x2, y2]
                              │
                              ▼
                 [Plate Cropper & Enhancer]
                              │ (Contrast & Adaptive Thresholding)
                              ▼
                        [OCR Engine]
                              │ (Character Recognition)
                              ▼
                       [Plate Validator]
                              │ (Indian RTO Regex & Syntax Clean)
                              ▼
                    [Structured DB Sighting]
               {
                 "plate": "MH12AB9999",
                 "camera_id": "CAM-03",
                 "timestamp": "2026-09-12T20:45:00",
                 "latitude": 28.6247,
                 "longitude": 77.2343,
                 "direction": "Northbound",
                 "confidence": 0.97
               }
                              │
                              ▼
             [Multi-Camera Trajectory Engine]
   CAM-01 (10:02) ──→ CAM-04 (10:10) ──→ CAM-07 (10:15)
                              │
       ┌──────────────────────┼──────────────────────┐
       ▼                      ▼                      ▼
  Origin-Destination   Traffic Heatmaps      Automated Alerts
      (OD Matrix)      & Volume Analytics   (Speed & Geofence)
```

---

## 🌟 Key Features

* **Fine-Tuned YOLOv8 Plate Detector:**
  * Trained on over 1,000 real Indian vehicle images across states (Delhi, Maharashtra, Karnataka, Tamil Nadu, Uttar Pradesh, Haryana, Gujarat, etc.).
  * **98.0% Precision**, **95.9% Recall**, **96.6% mAP@50**, and **~29.9 ms** inference latency on standard CPU.
* **Autonomous Real-Time Traffic Streaming:**
  * Continuous background simulation engine generating realistic vehicle sightings along connected city arterial corridors.
  * Instant live WebSocket telemetry pushes to all connected browser clients (`ws://localhost:8000/ws/live`).
* **Multi-Camera Trajectory Reconstruction:**
  * Chronologically chains detections of the same license plate into complete routes.
  * Calculates segment distance (km), transit duration (minutes), and average travel speed (km/h).
* **Interactive GIS Map Visualization:**
  * Built with Leaflet.js with custom dark/neon cartography.
  * Real-time camera checkpoint status (Active, Maintenance, Offline).
  * Animated route playback with origin, waypoints, and destination pins.
  * Spatial polygon geofence zones with automated entry/exit breach detection.
* **Command Center Intelligence Dashboard:**
  * **24-Hour Detection Heatmap:** Matrix plotting hourly traffic density per camera node.
  * **Peak Hour Analysis:** Time-band traffic volume distribution curve.
  * **Origin-Destination (OD) Matrix:** Most frequented travel corridors across the city.
  * **Camera Uptime & Health Matrix:** Detection counts and operational statuses.
* **Security & Watchlist Alerts:**
  * Real-time speed anomaly detection (>75 km/h) with alert escalation.
  * Flagged vehicle watchlist management (stolen, wanted, or suspicious plates).
* **Data Export:**
  * Export sightings and trajectories to CSV, JSON, or printable executive HTML summary reports.

---

## 📂 Project Structure

```text
ANPR_TRAJECTORY_TRACKING/
├── analytics/                      # Analytical and mathematical engines
│   ├── heatmap.py                  # 24-hour hour x camera density matrix
│   ├── od_matrix.py                # Origin-Destination flow aggregation
│   ├── route_prediction.py         # Markov-chain next-camera prediction
│   ├── traffic_volume.py           # Hourly volumes & vehicle distribution
│   └── trajectory.py               # Journey reconstruction & speed math
├── backend/                        # FastAPI server & endpoints
│   ├── api/                        # REST API routers
│   │   ├── alerts.py               # Speed anomalies & flagged vehicles
│   │   ├── analytics.py            # Dashboard metrics & OD matrix
│   │   ├── cameras.py              # Camera network endpoints
│   │   ├── events.py               # Sighting events ingestion & search
│   │   ├── export.py               # CSV/JSON/Report exports
│   │   ├── geofence.py             # Geofence boundary polygon checks
│   │   ├── inference_api.py        # Image & CCTV video upload inference
│   │   ├── trajectories.py         # Journey search & pagination
│   │   └── websocket.py            # WebSocket event streaming
│   ├── services/                   # Business logic services
│   │   ├── alert_service.py        # Alert rules & threshold evaluator
│   │   ├── camera_service.py       # Camera health & aggregations
│   │   ├── export_service.py       # Exporters (CSV, JSON, HTML)
│   │   ├── geofence_service.py     # Ray-casting point-in-polygon checks
│   │   ├── traffic_streamer.py     # Autonomous background traffic engine
│   │   └── websocket_manager.py    # Multi-channel client connection manager
│   └── main.py                     # FastAPI application entrypoint & lifespan
├── database/                       # Storage layer (SQLite / PostgreSQL)
│   ├── models.py                   # SQLAlchemy ORM models & auto-migrations
│   ├── schema.sql                  # PostgreSQL / PostGIS reference schema
│   └── seed_data.py                # Default camera network & sample history
├── dataset/                        # Real Indian number plate datasets
│   ├── data.yaml                   # YOLOv8 dataset configuration
│   ├── images/ (train/val)         # Normalized training & validation images
│   └── labels/ (train/val)         # YOLO normalized bounding-box annotations
├── frontend/                       # Static web interface
│   ├── index.html                  # Main GIS surveillance map & live stream
│   ├── style.css                   # Premium dark/glassmorphic stylesheet
│   ├── app.js                      # Main application logic & WebSocket client
│   ├── map/                        # Advanced GIS trajectory & geofence sub-app
│   └── dashboard/                  # Command Center analytics dashboard sub-app
├── models/                         # Computer vision models
│   ├── anpr/                       # OCR preprocessing, reading & validation
│   ├── detection/                  # YOLO vehicle & plate detectors
│   │   └── weights/                # Fine-tuned model weights (.pt)
│   └── tracking/                   # SimpleTracker & temporal majority voting
├── pipeline/                       # Video frame sampling & inference pipelines
├── tests/                          # Automated production readiness tests
│   ├── test_enhanced_features.py   # Full integration test suite
│   └── test_production_readiness.py# Security headers, DoS limits, queries
├── config.py                       # Centralized configuration & environment
├── prepare_dataset.py              # VOC XML to YOLO converter & splitter
├── requirements.txt                # Python dependencies
├── train_plate_detector.py         # YOLOv8 fine-tuning training script
└── yolov8n.pt                      # Base YOLOv8 nano backbone
```

---

## 🚀 Quick Start Guide

### 1. Prerequisites
* **Python:** 3.10 or higher
* **Git:** Installed and configured

### 2. Clone Repository
```bash
git clone https://github.com/prathmeshnanda2007-sudo/ANPR_TRAJECTORY_TRACKING.git
cd ANPR_TRAJECTORY_TRACKING
```

### 3. Set Up Virtual Environment & Dependencies
```bash
# Create virtual environment
python -m venv venv

# Activate virtual environment
# Windows:
.\venv\Scripts\activate
# Linux/macOS:
source venv/bin/activate

# Install dependencies
pip install -r requirements.txt
```

### 4. Launch Application Server
```bash
python -m backend.main
```
*(or `uvicorn backend.main:app --host 127.0.0.1 --port 8000 --reload`)*

---

## 🌐 Web Interfaces & Portals

Once the server is running, open your browser:

| Interface | URL | Description |
| :--- | :--- | :--- |
| **Live Surveillance Map** | [`http://localhost:8000/`](http://localhost:8000/) | Live camera checkpoints, incoming plate feed, quick search. |
| **Advanced Trajectory Map** | [`http://localhost:8000/map`](http://localhost:8000/map) | Multi-hop trajectory routes, geofence manager, route prediction. |
| **Command Center Dashboard** | [`http://localhost:8000/dashboard`](http://localhost:8000/dashboard) | 24-Hour detection heatmap, peak hours, OD matrix, live alerts. |
| **Interactive API Documentation** | [`http://localhost:8000/docs`](http://localhost:8000/docs) | Swagger UI for exploring and executing all REST API endpoints. |

---

## 📡 REST API Reference

CITYSURV exposes a comprehensive set of RESTful endpoints:

### Camera Management
* `GET /api/cameras` — List all surveillance cameras with sighting counts and statuses.
* `GET /api/cameras/{id}` — Get single camera details.

### Sighting Events
* `GET /api/events` — Query plate sightings with filters (`plate`, `camera_id`, `vehicle_type`, pagination).
* `GET /api/events/recent` — Retrieve the most recent sightings across the city.
* `POST /api/events` — Ingest a new vehicle plate sighting event.
* `POST /api/inference/simulate-event` — Quick simulation endpoint to inject test sightings.

### Vehicle Trajectories
* `GET /api/trajectories` — List reconstructed vehicle trajectories (paginated).
* `GET /api/trajectories/plates` — List all unique vehicles available for trajectory tracking.
* `GET /api/trajectories/search?plate=MH12AB9999` — Retrieve complete chronological multi-camera journey for a license plate.

### Traffic Analytics
* `GET /api/analytics/metrics` — Overall system KPIs (total detections, unique vehicles, today's events).
* `GET /api/analytics/heatmap` — 24-hour Hour $\times$ Camera detection matrix.
* `GET /api/analytics/peak-hours` — Hourly traffic volume curve and peak-hour analysis.
* `GET /api/analytics/od-matrix` — Origin-Destination matrix between camera pairs.
* `GET /api/analytics/predict-route?plate=...` — Predict next camera checkpoints based on transition probabilities.

### Alerts & Geofencing
* `GET /api/alerts` — List real-time alerts (speed anomalies, geofence breaches, watchlists).
* `GET /api/geofences` — List active spatial polygon geofence zones.
* `POST /api/geofences` — Create a new geofence zone.

---

## 🧪 Testing & Validation

Execute the built-in test suites to verify system health, security headers, query optimization, and feature integrity:

```bash
# Production readiness & security audit (9/9 checks)
python tests/test_production_readiness.py

# Enhanced features & integration test suite (8/8 checks)
python tests/test_enhanced_features.py
```

---

## 🛠️ Model Training & Custom Datasets

To retrain or fine-tune the YOLOv8 license plate detector on your own images:

1. **Prepare Dataset:**
   Place Pascal VOC XML annotations and images into `dataset/` and run:
   ```bash
   python prepare_dataset.py
   ```
2. **Train YOLOv8:**
   ```bash
   python train_plate_detector.py --epochs 20 --batch 16 --imgsz 512
   ```
   The best weights will be automatically evaluated and exported to `models/detection/weights/license_plate_detector.pt`.

---

## 📄 License
This project is open-source and distributed under the [MIT License](LICENSE).
