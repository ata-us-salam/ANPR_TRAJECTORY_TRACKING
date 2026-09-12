"""
WebSocket endpoints for real-time live feed and alert notifications.
"""

from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from backend.services.websocket_manager import ws_manager

router = APIRouter(tags=["WebSocket"])


@router.websocket("/ws/live")
async def websocket_live(websocket: WebSocket):
    """
    Unified WebSocket endpoint for real-time telemetry, detections, and alerts.
    """
    await ws_manager.connect(websocket, "live")
    try:
        while True:
            data = await websocket.receive_text()
            if data == "ping":
                await websocket.send_text('{"type":"pong"}')
    except WebSocketDisconnect:
        await ws_manager.disconnect(websocket, "live")
    except Exception:
        await ws_manager.disconnect(websocket, "live")


@router.websocket("/ws/live-feed")
async def websocket_live_feed(websocket: WebSocket):
    """
    WebSocket endpoint for real-time plate event streaming.
    Clients connect here to receive push-based updates instead of polling.
    """
    await ws_manager.connect(websocket, "live-feed")
    try:
        while True:
            # Keep connection alive; listen for client messages (e.g., pings)
            data = await websocket.receive_text()
            if data == "ping":
                await websocket.send_text('{"type":"pong"}')
    except WebSocketDisconnect:
        await ws_manager.disconnect(websocket, "live-feed")
    except Exception:
        await ws_manager.disconnect(websocket, "live-feed")


@router.websocket("/ws/alerts")
async def websocket_alerts(websocket: WebSocket):
    """
    WebSocket endpoint for real-time alert notifications.
    Clients receive speed anomalies, geofence breaches, flagged vehicle alerts.
    """
    await ws_manager.connect(websocket, "alerts")
    try:
        while True:
            data = await websocket.receive_text()
            if data == "ping":
                await websocket.send_text('{"type":"pong"}')
    except WebSocketDisconnect:
        await ws_manager.disconnect(websocket, "alerts")
    except Exception:
        await ws_manager.disconnect(websocket, "alerts")


@router.get("/api/ws/status")
def websocket_status():
    """Returns the current WebSocket connection status."""
    return {
        "live_feed_connections": ws_manager.get_connection_count("live-feed"),
        "alert_connections": ws_manager.get_connection_count("alerts"),
        "total_connections": ws_manager.get_connection_count(),
    }
