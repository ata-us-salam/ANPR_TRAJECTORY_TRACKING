/**
 * Smart City Camera Network Registry Controller
 */

let allCameras = [];
let congestionMap = {};

document.addEventListener("DOMContentLoaded", () => {
  loadCameraNetwork();
  initListeners();
  initWebSocket();
});

function initListeners() {
  document.getElementById("cam-search").addEventListener("input", filterCameras);
  document.getElementById("status-filter").addEventListener("change", filterCameras);
}

async function loadCameraNetwork() {
  try {
    const [camsResp, congResp] = await Promise.all([
      fetch("/api/cameras"),
      fetch("/api/analytics/congestion")
    ]);

    if (camsResp.ok) {
      allCameras = await camsResp.json();
    }
    if (congResp.ok) {
      const congList = await congResp.json();
      congestionMap = {};
      congList.forEach(c => {
        congestionMap[c.camera_id] = c;
      });
    }

    renderOverview();
    filterCameras();
  } catch (err) {
    console.error("Error loading camera registry:", err);
  }
}

function renderOverview() {
  const total = allCameras.length;
  const active = allCameras.filter(c => c.status === "ACTIVE").length;
  const coverage = total > 0 ? ((active / total) * 100).toFixed(1) : 0;
  
  let totalPasses = 0;
  Object.values(congestionMap).forEach(c => {
    totalPasses += Math.round(c.hourly_rate * 2);
  });

  document.getElementById("total-cams-val").textContent = total;
  document.getElementById("active-cams-val").textContent = active;
  document.getElementById("coverage-val").textContent = `${coverage}%`;
  document.getElementById("total-passes-val").textContent = totalPasses || (active * 18);
}

function filterCameras() {
  const query = document.getElementById("cam-search").value.trim().toLowerCase();
  const status = document.getElementById("status-filter").value;

  const filtered = allCameras.filter(c => {
    const matchQuery = 
      c.name.toLowerCase().includes(query) ||
      (c.location_name && c.location_name.toLowerCase().includes(query)) ||
      (c.camera_code && c.camera_code.toLowerCase().includes(query));

    const matchStatus = status === "ALL" || c.status === status;
    return matchQuery && matchStatus;
  });

  document.getElementById("cam-count-display").textContent = filtered.length;
  renderCameraCards(filtered);
}

function renderCameraCards(cameras) {
  const grid = document.getElementById("camera-cards-grid");
  grid.innerHTML = "";

  if (cameras.length === 0) {
    grid.innerHTML = `<div style="grid-column:1/-1; padding:40px; text-align:center; color:#64748b;">No cameras matched the search criteria.</div>`;
    return;
  }

  cameras.forEach(cam => {
    const card = document.createElement("div");
    card.className = "cam-card";

    const isLive = cam.status === "ACTIVE";
    const code = cam.camera_code || `CAM-${String(cam.id).padStart(3, '0')}`;
    const cong = congestionMap[cam.id] || { badge: "🟢 LOW", avg_speed_kmh: 50.0, hourly_rate: 12.0 };

    card.innerHTML = `
      <div>
        <div class="cam-card-top">
          <span class="cam-id-badge">${code}</span>
          <span class="cam-status-pill ${isLive ? 'status-online' : 'status-offline'}">
            <span>●</span> ${isLive ? 'LIVE STREAM' : 'OFFLINE'}
          </span>
        </div>

        <div class="cam-name">${cam.name}</div>
        <div class="cam-location">
          <span>📍</span> ${cam.location_name || 'Bhubaneswar Smart City'}
        </div>

        <div class="cam-meta-row">
          <div class="meta-item">
            <span class="meta-lbl">Direction</span>
            <span class="meta-val">${cam.direction || 'North → South'}</span>
          </div>
          <div class="meta-item" style="text-align:right;">
            <span class="meta-lbl">Congestion</span>
            <span class="meta-val">${cong.badge || '🟢 LOW'}</span>
          </div>
        </div>

        <div class="cam-meta-row">
          <div class="meta-item">
            <span class="meta-lbl">GPS Coordinates</span>
            <span class="meta-val" style="font-family:monospace; font-size:11px;">
              ${cam.latitude.toFixed(4)}° N, ${cam.longitude.toFixed(4)}° E
            </span>
          </div>
          <div class="meta-item" style="text-align:right;">
            <span class="meta-lbl">Avg Flow Speed</span>
            <span class="meta-val">${cong.avg_speed_kmh} km/h</span>
          </div>
        </div>
      </div>

      <div class="cam-card-actions">
        <a href="/?cam=${cam.id}" class="cam-btn">
          <span>🎥</span> View Feed
        </a>
        <a href="/map?focus=${cam.id}" class="cam-btn">
          <span>🌐</span> Map GIS
        </a>
      </div>
    `;

    grid.appendChild(card);
  });
}

function initWebSocket() {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  const wsUrl = `${protocol}//${window.location.host}/ws/live`;
  
  let ws = null;
  try {
    ws = new WebSocket(wsUrl);
  } catch (e) {
    return;
  }

  ws.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data);
      if (msg.type === "detection") {
        // Increment pass counter on fly
        const passesElem = document.getElementById("total-passes-val");
        if (passesElem) {
          passesElem.textContent = (parseInt(passesElem.textContent) || 0) + 1;
        }
      }
    } catch (e) {}
  };

  ws.onclose = () => {
    setTimeout(initWebSocket, 4000);
  };
}
