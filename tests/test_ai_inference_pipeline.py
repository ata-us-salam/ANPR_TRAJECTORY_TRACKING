import os
import sys
import requests

BASE_URL = "http://127.0.0.1:8000"

def test_ai_inference():
    print("=" * 60)
    print("TESTING LIVE AI INFERENCE PIPELINE & ENDPOINTS")
    print("=" * 60)

    # 1. Health check
    res = requests.get(f"{BASE_URL}/api/health")
    assert res.status_code == 200, f"Health check failed: {res.text}"
    print("[PASS] Health Check OK")

    # 2. Sample 1 (test_image_2.jpg)
    res = requests.post(f"{BASE_URL}/api/inference/run-sample?filename=test_image_2.jpg")
    assert res.status_code == 200, f"Sample 1 failed: {res.text}"
    data = res.json()
    print(f"[PASS] Sample 1: success={data.get('success')}, detections={data.get('detections_count')}")
    if data.get('annotated_image'):
        print(f"       Annotated Image Base64 length: {len(data['annotated_image'])}")
    if data.get('results'):
        for r in data['results']:
            print(f"       Plate: {r.get('text')} | Conf: {r.get('confidence')} | Type: {r.get('vehicle_type')} | Color: {r.get('vehicle_color')} | RTO: {r.get('rto_details', {}).get('state_name')}")

    # 3. Sample 2 (sample_car.jpg)
    res = requests.post(f"{BASE_URL}/api/inference/run-sample?filename=sample_car.jpg")
    assert res.status_code == 200, f"Sample 2 failed: {res.text}"
    data = res.json()
    print(f"[PASS] Sample 2: success={data.get('success')}, detections={data.get('detections_count')}")
    if data.get('annotated_image'):
        print(f"       Annotated Image Base64 length: {len(data['annotated_image'])}")
    if data.get('results'):
        for r in data['results']:
            print(f"       Plate: {r.get('text')} | Conf: {r.get('confidence')} | Type: {r.get('vehicle_type')} | Color: {r.get('vehicle_color')} | RTO: {r.get('rto_details', {}).get('state_name')}")

    # 4. Upload Image (Raw Binary)
    test_img_path = os.path.join(os.path.dirname(__file__), "..", "data", "test_image_2.jpg")
    with open(test_img_path, "rb") as f:
        img_bytes = f.read()

    res = requests.post(
        f"{BASE_URL}/api/inference/upload-image",
        headers={"Content-Type": "image/jpeg"},
        data=img_bytes
    )
    assert res.status_code == 200, f"Upload Image failed: {res.text}"
    data = res.json()
    print(f"[PASS] Upload Raw Image: success={data.get('success')}, detections={data.get('detections_count')}")
    assert "annotated_image" in data and data["annotated_image"].startswith("data:image/jpeg;base64,")
    print("[PASS] Visual HUD bounding box annotation confirmed in payload.")

    # 5. Run Sample Video
    res = requests.post(f"{BASE_URL}/api/inference/run-sample-video")
    assert res.status_code == 200, f"Run Sample Video failed: {res.text}"
    data = res.json()
    print(f"[PASS] Run Sample Video: success={data.get('success')}, tracked={data.get('tracked_vehicles_count')}")
    if data.get('results'):
        for v in data['results']:
            print(f"       Track #{v.get('track_id')} | Plate: {v.get('plate_text')} | Speed: {v.get('estimated_speed_kmh')} km/h | State: {v.get('rto_details', {}).get('state_name')}")

    # 6. Upload Video (Short user clip or test video)
    test_video_path = os.path.join(os.path.dirname(__file__), "..", "data", "test_video.mp4")
    with open(test_video_path, "rb") as f:
        vid_bytes = f.read()

    res = requests.post(
        f"{BASE_URL}/api/inference/upload-video",
        headers={"Content-Type": "video/mp4"},
        data=vid_bytes
    )
    assert res.status_code == 200, f"Upload Video failed: {res.text}"
    data = res.json()
    print(f"[PASS] Upload Video: success={data.get('success')}, tracked={data.get('tracked_vehicles_count')}")

    print("\nALL LIVE AI INFERENCE PIPELINE TESTS PASSED SUCCESSFULLY!")

if __name__ == "__main__":
    test_ai_inference()
