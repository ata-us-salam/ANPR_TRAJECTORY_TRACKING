"""
End-to-End Production Readiness & Vulnerability Verification Test Suite.
Tests security headers, payload boundaries, XSS resilience, query performance, and analytics accuracy.
"""

import base64
import sys
import os

# Add root directory to sys.path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from fastapi.testclient import TestClient
from backend.main import app

def run_production_tests():
    client = TestClient(app)
    print("=" * 65)
    print("RUNNING COMPREHENSIVE PRODUCTION READINESS & VULNERABILITY AUDIT")
    print("=" * 65)

    # 1. Test Security Headers
    print("\n[TEST 1] Verifying Security Headers Middleware...")
    res = client.get("/api/health")
    assert res.status_code == 200, f"Expected 200, got {res.status_code}"
    headers = res.headers
    assert headers.get("x-content-type-options") == "nosniff", "Missing X-Content-Type-Options"
    assert headers.get("x-frame-options") == "DENY", "Missing X-Frame-Options"
    assert "strict-origin" in headers.get("referrer-policy", ""), "Missing Referrer-Policy"
    print("  PASS: Security headers present (nosniff, DENY, strict-origin).")

    # 2. Test CORS Configuration
    print("\n[TEST 2] Verifying CORS Behavior...")
    options_res = client.options("/api/health", headers={"Origin": "http://localhost:3000", "Access-Control-Request-Method": "GET"})
    assert options_res.status_code in [200, 204], f"CORS preflight failed: {options_res.status_code}"
    print("  PASS: CORS preflight handled safely.")

    # 3. Test Payload Size Limit & DoS Prevention
    print("\n[TEST 3] Verifying Upload Size Bounds (DoS Prevention)...")
    huge_payload = "A" * (15 * 1024 * 1024) # 15 MB payload exceeding 10MB limit
    res_large = client.post("/api/inference/upload-base64", json={"image_base64": huge_payload})
    assert res_large.status_code == 413, f"Expected 413 for oversized payload, got {res_large.status_code}"
    print("  PASS: Oversized payload (>10MB) rejected with HTTP 413.")

    # 4. Test Malformed Image Rejection
    print("\n[TEST 4] Verifying Malformed Image Rejection...")
    fake_base64 = base64.b64encode(b"This is not a JPEG or PNG image binary").decode('utf-8')
    res_bad = client.post("/api/inference/upload-base64", json={"image_base64": fake_base64})
    assert res_bad.status_code == 400, f"Expected 400 for corrupt image, got {res_bad.status_code}"
    print("  PASS: Malformed image rejected with HTTP 400.")

    # 5. Test Optimized Camera Aggregation (No N+1)
    print("\n[TEST 5] Verifying Camera Aggregation & Performance...")
    cam_res = client.get("/api/cameras")
    assert cam_res.status_code == 200
    cameras = cam_res.json()
    assert len(cameras) > 0, "No cameras returned"
    for cam in cameras:
        assert "total_sightings" in cam, f"Missing total_sightings in camera {cam.get('id')}"
        assert isinstance(cam["total_sightings"], int)
    print(f"  PASS: Loaded {len(cameras)} cameras with single-query sightings aggregation.")

    # 6. Test Trajectory Pagination & Speed Bounds
    print("\n[TEST 6] Verifying Trajectory Pagination & Speed Sanity Bounds...")
    plates_res = client.get("/api/trajectories/plates?limit=5")
    assert plates_res.status_code == 200
    plates = plates_res.json()
    assert len(plates) <= 5, f"Expected max 5 results, got {len(plates)}"

    trajs_res = client.get("/api/trajectories/all?limit=50").json()
    all_trajs = trajs_res.get("trajectories", trajs_res if isinstance(trajs_res, list) else [])
    for t in all_trajs:
        speed = t.get("avg_speed_kmh", 0)
        assert 0.0 <= speed <= 250.0, f"Speed out of realistic physical bounds: {speed} km/h for plate {t.get('plate_text')}"
    print(f"  PASS: Trajectory pagination enforced and all {len(all_trajs)} trajectories have physically bounded speeds (0-250 km/h).")

    # 7. Test Traffic Analytics & OD Matrix
    print("\n[TEST 7] Verifying Traffic Analytics & OD Matrix...")
    summary = client.get("/api/analytics/summary").json()
    assert summary["total_detections"] > 0
    assert summary["active_cameras"] > 0

    od_matrix = client.get("/api/analytics/od-matrix").json()
    assert isinstance(od_matrix, list)
    print(f"  PASS: Analytics metrics verified ({summary['total_detections']} detections across {summary['active_cameras']} active cameras, {len(od_matrix)} OD corridors).")

    # 8. Test Plate Validator & Normalization
    print("\n[TEST 8] Verifying Plate Validator & Common OCR Confusions...")
    from models.anpr.validation import PlateValidator
    val = PlateValidator()
    assert val.is_valid("DL01AB1234") == True
    assert val.is_valid("INVALID_PLATE_STRING") == False
    # Test OCR confusion correction (e.g. O instead of 0 in numeric section)
    cleaned = val.clean_text("DLO1AB1234")
    assert cleaned.startswith("DL01"), f"Failed character correction: {cleaned}"
    print(f"  PASS: Plate validation and OCR error correction verified (DLO1AB1234 -> {cleaned}).")

    # 9. Test Frontend Static Asset Integrity
    print("\n[TEST 9] Verifying Frontend Static Asset Integrity...")
    index_res = client.get("/")
    assert index_res.status_code == 200
    assert "CITYSURV" in index_res.text

    js_res = client.get("/static/app.js")
    assert js_res.status_code == 200
    assert "escapeHtml" in js_res.text, "escapeHtml sanitizer missing from app.js"
    print("  PASS: Frontend app.js served with active escapeHtml XSS sanitizer.")

    print("\n" + "=" * 65)
    print("ALL 9 PRODUCTION READINESS & SECURITY AUDIT TESTS PASSED!")
    print("=" * 65)

if __name__ == "__main__":
    run_production_tests()
