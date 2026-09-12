"""
Integration and Unit Test Suite for ANPR Enhancement Features:
- Camera Health API
- Alerts Management & Anomaly Detection
- Geofence CRUD & Spatial Point Checking
- Flagged Vehicle Watchlist
- Route Prediction (Markov Chain)
- Heatmap & Peak-Hours Analytics
- Export Service (CSV, JSON, Markdown Report)
- Frontend Pages & Static Routing
- WebSocket Live Feed
"""

import os
import sys
import json

# Add root directory to sys.path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from fastapi.testclient import TestClient
from backend.main import app

from database.models import init_db

def run_tests():
    init_db()
    client = TestClient(app)
    print("=" * 65)
    print("RUNNING ENHANCED FEATURES INTEGRATION TEST SUITE")
    print("=" * 65)

    # 1. Camera Health
    print("\n[TEST 1] Testing Camera Health Matrix...")
    res = client.get("/api/cameras/health")
    assert res.status_code == 200, f"Expected 200, got {res.status_code}: {res.text}"
    health_data = res.json()
    assert isinstance(health_data, list)
    assert len(health_data) > 0
    first_cam = health_data[0]
    assert "uptime_pct" in first_cam
    assert "detections_24h" in first_cam
    assert "detection_rate_per_hour" in first_cam
    print(f"  PASS: Camera health matrix returned {len(health_data)} cameras.")

    # 2. Heatmap & Peak Hours
    print("\n[TEST 2] Testing Heatmap & Peak Hours Analytics...")
    hm_res = client.get("/api/analytics/heatmap")
    assert hm_res.status_code == 200
    hm_data = hm_res.json()
    assert "matrix" in hm_data
    assert "hours" in hm_data
    assert "cameras" in hm_data
    assert len(hm_data["hours"]) == 24
    print(f"  PASS: Heatmap 24h matrix returned ({len(hm_data['cameras'])} cameras).")

    pk_res = client.get("/api/analytics/peak-hours")
    assert pk_res.status_code == 200
    pk_data = pk_res.json()
    assert "peak_hour" in pk_data
    assert "band_totals" in pk_data
    print(f"  PASS: Peak-hours analytics returned (Peak hour: {pk_data['peak_hour']}).")

    # 3. Route Prediction
    print("\n[TEST 3] Testing Route Prediction Engine...")
    # First get a known plate
    plates_res = client.get("/api/trajectories/plates?limit=1")
    assert plates_res.status_code == 200
    plates = plates_res.json()
    if plates:
        test_plate = plates[0]["plate_text"]
        pred_res = client.get(f"/api/analytics/predict-route?plate={test_plate}&steps=3")
        assert pred_res.status_code == 200
        pred_data = pred_res.json()
        assert "plate_text" in pred_data
        assert "last_seen_camera" in pred_data
        assert "predicted_route" in pred_data
        assert isinstance(pred_data["predicted_route"], list)
        print(f"  PASS: Route prediction computed for plate {test_plate} with {len(pred_data['predicted_route'])} steps.")

    # 4. Geofence Management & Point Checking
    print("\n[TEST 4] Testing Geofence Zones & Spatial Point Checking...")
    new_zone = {
        "name": "Connaught Place Security Zone",
        "polygon": [
            [28.632, 77.218],
            [28.635, 77.222],
            [28.631, 77.224],
            [28.629, 77.219]
        ],
        "color": "#f43f5e",
        "zone_type": "restricted"
    }
    create_res = client.post("/api/geofences", json=new_zone)
    assert create_res.status_code in [200, 201]
    created = create_res.json()
    zone_id = created["id"]
    assert created["name"] == new_zone["name"]

    # Check point inside polygon
    check_in = client.post("/api/geofences/check-point", json={"latitude": 28.632, "longitude": 77.220, "plate_text": "DL01TEST01"})
    assert check_in.status_code == 200

    # List zones
    list_res = client.get("/api/geofences")
    assert list_res.status_code == 200
    assert any(z["id"] == zone_id for z in list_res.json())

    # Delete zone
    del_res = client.delete(f"/api/geofences/{zone_id}")
    assert del_res.status_code == 200
    print("  PASS: Geofence creation, listing, checking, and deletion verified.")

    # 5. Alerts & Watchlist
    print("\n[TEST 5] Testing Alerts & Flagged Vehicle Watchlist...")
    # Add flagged vehicle
    flag_res = client.post("/api/alerts/flagged", json={"plate_text": "TESTPLATE99", "reason": "Suspected stolen vehicle"})
    assert flag_res.status_code in [200, 201]

    # Create alert
    alert_res = client.post("/api/alerts", json={
        "alert_type": "FLAGGED_VEHICLE",
        "severity": "CRITICAL",
        "message": "Flagged vehicle TESTPLATE99 spotted",
        "plate_text": "TESTPLATE99"
    })
    assert alert_res.status_code in [200, 201]
    alert_id = alert_res.json()["id"]

    # Acknowledge alert
    ack_res = client.post(f"/api/alerts/{alert_id}/acknowledge")
    assert ack_res.status_code == 200
    assert ack_res.json()["acknowledged"] == True

    # Scan anomalies
    scan_res = client.post("/api/alerts/check-anomalies")
    assert scan_res.status_code == 200
    assert "alerts_created" in scan_res.json()

    # Remove flagged vehicle
    unflag_res = client.delete("/api/alerts/flagged/TESTPLATE99")
    assert unflag_res.status_code == 200
    print("  PASS: Flagged vehicle management and alert lifecycle verified.")

    # 6. Export API
    print("\n[TEST 6] Testing Export Service (CSV, JSON, Full Report)...")
    csv_res = client.get("/api/export/events?format=csv&limit=10")
    assert csv_res.status_code == 200
    assert "text/csv" in csv_res.headers.get("content-type", "")
    assert "Plate Text" in csv_res.text or "plate" in csv_res.text.lower()

    json_res = client.get("/api/export/events?format=json&limit=10")
    assert json_res.status_code == 200
    assert "application/json" in json_res.headers.get("content-type", "")

    traj_csv_res = client.get("/api/export/trajectories?format=csv&limit=10")
    assert traj_csv_res.status_code == 200
    assert "text/csv" in traj_csv_res.headers.get("content-type", "")

    report_res = client.get("/api/export/report")
    assert report_res.status_code == 200
    assert "CITYSURV ANPR Surveillance Report" in report_res.text
    print("  PASS: CSV, JSON, and HTML report exports generated successfully.")

    # 7. Frontend Static Pages
    print("\n[TEST 7] Testing Frontend Page Serving...")
    dash_res = client.get("/dashboard")
    assert dash_res.status_code == 200
    assert "Dashboard — CITYSURV" in dash_res.text

    map_res = client.get("/map")
    assert map_res.status_code == 200
    assert "Advanced GIS Map" in map_res.text

    css_res = client.get("/static/dashboard/dashboard.css")
    assert css_res.status_code == 200
    assert len(css_res.text) > 100

    js_res = client.get("/static/map/map.js")
    assert js_res.status_code == 200
    assert "escapeHtml" in js_res.text
    print("  PASS: /dashboard and /map served with their CSS/JS assets.")

    # 8. WebSocket Endpoint
    print("\n[TEST 8] Testing WebSocket /ws/live Connection...")
    with client.websocket_connect("/ws/live") as websocket:
        # Check that connection opened cleanly
        websocket.send_text("ping")
        # Connection established without exception
    print("  PASS: WebSocket /ws/live connected and verified.")

    print("\n" + "=" * 65)
    print("ALL ENHANCED FEATURES TESTS PASSED SUCCESSFULLY!")
    print("=" * 65)

if __name__ == "__main__":
    run_tests()
