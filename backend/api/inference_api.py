import os
import base64
import tempfile
import datetime
import asyncio
from typing import Optional, Dict, Any
from pydantic import BaseModel
from fastapi import APIRouter, HTTPException, Request, Query
from pipeline.inference import SingleImagePipeline, VideoPipeline

router = APIRouter(prefix="/inference", tags=["Live AI Inference"])

# Lazy-loaded pipeline instances
_pipeline_instance = None
_video_pipeline_instance = None

def get_pipeline():
    global _pipeline_instance
    if _pipeline_instance is None:
        _pipeline_instance = SingleImagePipeline()
    return _pipeline_instance

def get_video_pipeline(target_fps=3):
    global _video_pipeline_instance
    if _video_pipeline_instance is None:
        _video_pipeline_instance = VideoPipeline(image_pipeline=get_pipeline(), target_fps=target_fps)
    return _video_pipeline_instance

class Base64ImageRequest(BaseModel):
    image_base64: str
    filename: Optional[str] = "uploaded_image.jpg"

MAX_UPLOAD_SIZE_BYTES = 10 * 1024 * 1024  # 10 MB limit for images
MAX_VIDEO_SIZE_BYTES = 200 * 1024 * 1024  # 200 MB limit for CCTV videos

def _record_sighting_in_db(plate_text: str, confidence: float, vehicle_type: str, vehicle_color: str = "Silver / Grey", speed_kmh: float = 48.0):
    """
    Safely registers a sighting into the database so the uploaded image/video vehicle
    is immediately trackable across the GIS map and Vehicle Intelligence portal.
    """
    try:
        from database.models import get_session, PlateEvent, Camera
        session = get_session()
        camera = session.query(Camera).filter(Camera.status == "active").first() or session.query(Camera).first()
        cam_id = camera.id if camera else 1

        event = PlateEvent(
            camera_id=cam_id,
            plate_text=plate_text,
            confidence=float(confidence),
            timestamp=datetime.datetime.utcnow(),
            vehicle_type=vehicle_type or "Car",
            vehicle_color=vehicle_color or "Silver / Grey",
            direction="Northbound",
            speed_estimate_kmh=float(speed_kmh)
        )
        session.add(event)
        session.commit()
        session.close()
    except Exception as e:
        print(f"[Inference DB Sync Warning] {e}")


@router.post("/run-sample")
async def run_sample_inference(
    sample_name: Optional[str] = None,
    filename: Optional[str] = None
):
    """Runs the AI pipeline on one of the bundled sample images in data/."""
    target_name = filename or sample_name or "test_image_2.jpg"
    
    # Common mappings
    if target_name in ["test_image_3.jpg", "sample_car"]:
        target_name = "sample_car.jpg"
    if target_name in ["test_image_1.jpg", "test_image"]:
        target_name = "test_image_2.jpg"

    valid_samples = {
        "test_image_2.jpg": os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "data", "test_image_2.jpg")),
        "sample_car.jpg": os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "data", "sample_car.jpg"))
    }
    
    if target_name not in valid_samples:
        raise HTTPException(status_code=400, detail=f"Sample must be one of: {list(valid_samples.keys())}")
        
    img_path = valid_samples[target_name]
    if not os.path.exists(img_path):
        raise HTTPException(status_code=404, detail=f"Sample file {target_name} not found on disk.")
        
    try:
        pipeline = get_pipeline()
        pipeline_output = await asyncio.to_thread(pipeline.run, img_path)
        
        # Handle dict response
        if isinstance(pipeline_output, dict):
            detections = pipeline_output.get("results", [])
            annotated_image = pipeline_output.get("annotated_image", None)
        else:
            detections = pipeline_output or []
            annotated_image = None

        # Record valid detections to DB
        for det in detections:
            if det.get("is_valid") and det.get("text"):
                _record_sighting_in_db(
                    plate_text=det["text"],
                    confidence=det.get("confidence", 0.9),
                    vehicle_type=det.get("vehicle_type", "Car")
                )

        return {
            "success": True,
            "filename": target_name,
            "detections_count": len(detections),
            "results": detections,
            "annotated_image": annotated_image
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Inference execution error: {str(e)}")


@router.post("/upload-image")
@router.post("/upload-raw")
async def upload_image_and_infer(request: Request):
    """
    Processes raw binary image payload with size limits and format checks.
    Extracts vehicle class, color, plate bounding box, PaddleOCR reading, and RTO info.
    """
    content_length = request.headers.get("content-length")
    if content_length and int(content_length) > MAX_UPLOAD_SIZE_BYTES:
        raise HTTPException(status_code=413, detail=f"Request payload exceeds {MAX_UPLOAD_SIZE_BYTES // (1024*1024)} MB limit.")

    img_bytes = await request.body()
    if not img_bytes:
        raise HTTPException(status_code=400, detail="Empty request body.")

    if len(img_bytes) > MAX_UPLOAD_SIZE_BYTES:
        raise HTTPException(status_code=413, detail="Request body exceeds upload limit.")

    import cv2
    import numpy as np
    nparr = np.frombuffer(img_bytes, np.uint8)
    img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
    if img is None or img.size == 0:
        raise HTTPException(status_code=400, detail="Uploaded binary data is not a valid, decodable image.")

    tmp_path = None
    try:
        with tempfile.NamedTemporaryFile(delete=False, suffix=".jpg") as tmp:
            tmp.write(img_bytes)
            tmp_path = tmp.name

        pipeline = get_pipeline()
        pipeline_output = await asyncio.to_thread(pipeline.run, tmp_path)

        if isinstance(pipeline_output, dict):
            detections = pipeline_output.get("results", [])
            annotated_image = pipeline_output.get("annotated_image", None)
        else:
            detections = pipeline_output or []
            annotated_image = None

        for det in detections:
            if det.get("is_valid") and det.get("text"):
                _record_sighting_in_db(
                    plate_text=det["text"],
                    confidence=det.get("confidence", 0.9),
                    vehicle_type=det.get("vehicle_type", "Car")
                )

        return {
            "success": True,
            "filename": "uploaded_vehicle.jpg",
            "detections_count": len(detections),
            "results": detections,
            "annotated_image": annotated_image
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Inference error: {str(e)}")
    finally:
        if tmp_path and os.path.exists(tmp_path):
            try:
                os.remove(tmp_path)
            except Exception:
                pass


@router.post("/upload-base64")
async def upload_base64_and_infer(req: Base64ImageRequest):
    """Processes base64 encoded image through the ANPR AI pipeline with strict payload validation."""
    if not req.image_base64:
        raise HTTPException(status_code=400, detail="Empty image payload.")
        
    if len(req.image_base64) > int(MAX_UPLOAD_SIZE_BYTES * 1.4):
        raise HTTPException(status_code=413, detail="Payload exceeds maximum allowed upload size.")

    try:
        data = req.image_base64
        if "," in data:
            data = data.split(",", 1)[1]
        img_bytes = base64.b64decode(data)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Invalid base64 payload: {str(e)}")

    if len(img_bytes) > MAX_UPLOAD_SIZE_BYTES:
        raise HTTPException(status_code=413, detail="Decoded image exceeds maximum allowed size.")

    import cv2
    import numpy as np
    nparr = np.frombuffer(img_bytes, np.uint8)
    img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
    if img is None or img.size == 0:
        raise HTTPException(status_code=400, detail="Uploaded file is not a valid, decodable image.")

    tmp_path = None
    try:
        with tempfile.NamedTemporaryFile(delete=False, suffix=".jpg") as tmp:
            tmp.write(img_bytes)
            tmp_path = tmp.name

        pipeline = get_pipeline()
        pipeline_output = await asyncio.to_thread(pipeline.run, tmp_path)

        if isinstance(pipeline_output, dict):
            detections = pipeline_output.get("results", [])
            annotated_image = pipeline_output.get("annotated_image", None)
            vehicles = pipeline_output.get("vehicles", [])
        else:
            detections = pipeline_output or []
            annotated_image = None
            vehicles = []

        for det in detections:
            if det.get("is_valid") and det.get("text"):
                _record_sighting_in_db(
                    plate_text=det["text"],
                    confidence=det.get("confidence", 0.9),
                    vehicle_type=det.get("vehicle_type", "Car")
                )

        return {
            "success": True,
            "filename": os.path.basename(req.filename) if req.filename else "uploaded_image.jpg",
            "detections_count": len(detections),
            "results": detections,
            "vehicles": vehicles,
            "annotated_image": annotated_image
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Inference error: {str(e)}")
    finally:
        if tmp_path and os.path.exists(tmp_path):
            try:
                os.remove(tmp_path)
            except Exception:
                pass


@router.post("/run-sample-video")
async def run_sample_video_inference():
    """Runs video tracking on the bundled test_video.mp4 sample."""
    sample_path = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "data", "test_video.mp4"))
    if not os.path.exists(sample_path):
        raise HTTPException(status_code=404, detail="test_video.mp4 not found on disk.")
    try:
        pipeline = get_video_pipeline(target_fps=4)
        results = await asyncio.to_thread(pipeline.run, sample_path)
        
        for item in results:
            if item.get("valid") and item.get("plate_text"):
                _record_sighting_in_db(
                    plate_text=item["plate_text"],
                    confidence=item.get("confidence", 0.9),
                    vehicle_type=item.get("vehicle_type", "Car"),
                    speed_kmh=item.get("estimated_speed_kmh", 45.0)
                )

        return {
            "success": True,
            "filename": "test_video.mp4",
            "duration_sec": 3.0,
            "tracked_vehicles_count": len(results),
            "results": results
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Video pipeline error: {str(e)}")


@router.post("/upload-video")
async def upload_video_and_infer(request: Request):
    """
    Processes uploaded CCTV video footage through multi-frame tracking and temporal majority voting.
    Supports clips up to 200 MB.
    """
    content_length = request.headers.get("content-length")
    if content_length and int(content_length) > MAX_VIDEO_SIZE_BYTES:
        raise HTTPException(status_code=413, detail="Video payload exceeds 200 MB limit.")

    video_bytes = await request.body()
    if not video_bytes or len(video_bytes) < 500:
        raise HTTPException(status_code=400, detail="Empty or invalid video payload.")

    if len(video_bytes) > MAX_VIDEO_SIZE_BYTES:
        raise HTTPException(status_code=413, detail="Video exceeds 200 MB limit.")

    tmp_path = None
    try:
        with tempfile.NamedTemporaryFile(delete=False, suffix=".mp4") as tmp:
            tmp.write(video_bytes)
            tmp_path = tmp.name

        import cv2
        cap = cv2.VideoCapture(tmp_path)
        if not cap.isOpened():
            raise HTTPException(status_code=400, detail="Unable to decode video. Please upload a standard MP4, AVI, or WebM CCTV clip.")
        total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
        fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
        duration_sec = total_frames / fps if fps > 0 else 0.0
        cap.release()

        pipeline = get_video_pipeline(target_fps=4)
        final_plates = await asyncio.to_thread(pipeline.run, tmp_path)

        for item in final_plates:
            if item.get("valid") and item.get("plate_text"):
                _record_sighting_in_db(
                    plate_text=item["plate_text"],
                    confidence=item.get("confidence", 0.9),
                    vehicle_type=item.get("vehicle_type", "Car"),
                    speed_kmh=item.get("estimated_speed_kmh", 45.0)
                )

        return {
            "success": True,
            "filename": "uploaded_cctv_footage.mp4",
            "total_frames": total_frames,
            "duration_sec": round(duration_sec, 2),
            "tracked_vehicles_count": len(final_plates),
            "results": final_plates
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"CCTV Video pipeline execution error: {str(e)}")
    finally:
        if tmp_path and os.path.exists(tmp_path):
            try:
                os.remove(tmp_path)
            except Exception:
                pass


@router.post("/simulate-event")
def simulate_sighting_event(payload: dict):
    """
    Simulates a live ANPR sighting detection directly into the event stream and database.
    """
    from backend.api.events import create_plate_event, NewPlateEventRequest
    req = NewPlateEventRequest(
        camera_id=payload.get("camera_id", 1),
        plate_text=payload.get("plate_text", "MH12AB9999"),
        confidence=float(payload.get("confidence", 0.95)),
        vehicle_type=payload.get("vehicle_type", "Car"),
        direction=payload.get("direction", "Northbound"),
        speed_estimate_kmh=payload.get("speed_estimate_kmh")
    )
    return create_plate_event(req)
