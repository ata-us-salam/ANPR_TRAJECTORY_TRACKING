/**
 * Vehicle Intelligence & Trajectory Replay Controller
 */

let map = null;
let routePolyline = null;
let cameraMarkers = [];
let currentPlate = "OD02AB1234";

document.addEventListener("DOMContentLoaded", () => {
  initMap();
  initListeners();
  loadVehicleProfile(currentPlate);
  initWebSocket();
});

function initMap() {
  const mapElem = document.getElementById("vehicle-map");
  if (!mapElem || typeof L === 'undefined') return;

  if (L.Icon && L.Icon.Default) {
    L.Icon.Default.imagePath = '/static/leaflet/images/';
  }

  map = L.map("vehicle-map", {
    zoomControl: true,
    attributionControl: false
  }).setView([20.2961, 85.8245], 12);

  // High-reliability OpenStreetMap tiles (darkened with cyber surveillance CSS filter)
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: "© OpenStreetMap contributors"
  }).addTo(map);

  [80, 250, 600, 1200].forEach(delay => {
    setTimeout(() => { if (map) map.invalidateSize(); }, delay);
  });
  window.addEventListener("resize", () => { if (map) map.invalidateSize(); });
}

function initListeners() {
  const searchBtn = document.getElementById("search-btn");
  const plateInput = document.getElementById("plate-input");

  searchBtn.addEventListener("click", () => {
    const val = plateInput.value.trim().toUpperCase();
    if (val) {
      currentPlate = val;
      loadVehicleProfile(val);
    }
  });

  plateInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      const val = plateInput.value.trim().toUpperCase();
      if (val) {
        currentPlate = val;
        loadVehicleProfile(val);
      }
    }
  });
}

function searchPlate(plate) {
  document.getElementById("plate-input").value = plate;
  currentPlate = plate;
  loadVehicleProfile(plate);
}

async function loadVehicleProfile(plate) {
  try {
    const resp = await fetch(`/api/vehicles/profile/${encodeURIComponent(plate)}`);
    if (!resp.ok) {
      if (resp.status === 404) {
        alert(`No surveillance records found for plate ${plate}`);
      }
      return;
    }
    const data = await resp.json();
    renderProfile(data);
    renderMapRoute(data.sightings);
    renderTimeline(data.sightings);
    renderAlerts(data.alerts);
  } catch (err) {
    console.error("Error loading vehicle profile:", err);
  }
}

function renderProfile(data) {
  document.getElementById("prof-plate-text").textContent = data.plate_text;
  
  const statusChip = document.getElementById("prof-status-chip");
  const reasonDiv = document.getElementById("prof-flag-reason");

  if (data.is_flagged) {
    statusChip.className = "status-badge-chip status-flagged";
    statusChip.innerHTML = "<span>🚨 BLACKLISTED / WATCHLIST</span>";
    reasonDiv.textContent = `Reason: ${data.flag_reason || "Flagged in City Security Database"}`;
    reasonDiv.style.display = "block";
  } else {
    statusChip.className = "status-badge-chip status-clean";
    statusChip.innerHTML = "<span>✓ CLEAN RECORD</span>";
    reasonDiv.style.display = "none";
  }

  // Corridor estimate
  if (data.sightings && data.sightings.length >= 2) {
    const startLoc = data.sightings[0].location_name || data.sightings[0].camera_name;
    const endLoc = data.sightings[data.sightings.length - 1].location_name || data.sightings[data.sightings.length - 1].camera_name;
    document.getElementById("prof-corridor").textContent = `${startLoc} → ${endLoc}`;
  } else if (data.sightings && data.sightings.length === 1) {
    document.getElementById("prof-corridor").textContent = data.sightings[0].location_name || data.sightings[0].camera_name;
  } else {
    document.getElementById("prof-corridor").textContent = "N/A";
  }

  document.getElementById("prof-vtype").textContent = `${data.vehicle_type} / ${data.make_model || 'Vehicle'}`;
  document.getElementById("prof-color").textContent = `Color: ${data.vehicle_color || 'Unknown'}`;
  document.getElementById("prof-detections").textContent = data.total_detections;
  document.getElementById("prof-checkpoints").textContent = `${data.cameras_visited_count} Cams`;
  document.getElementById("prof-avg-speed").textContent = data.avg_speed_kmh ? `${data.avg_speed_kmh} km/h` : "N/A";
  document.getElementById("prof-peak-speed").textContent = data.max_speed_kmh ? `Peak: ${data.max_speed_kmh} km/h` : "Peak: N/A";

  if (data.sightings && data.sightings.length > 0) {
    const first = data.sightings[0];
    const last = data.sightings[data.sightings.length - 1];

    document.getElementById("prof-first-seen").textContent = formatTimestamp(first.timestamp);
    document.getElementById("prof-first-cam").textContent = first.camera_name;

    document.getElementById("prof-last-seen").textContent = formatTimestamp(last.timestamp);
    document.getElementById("prof-last-cam").textContent = last.camera_name;
  }
}

function renderMapRoute(sightings) {
  // Clear existing markers & polyline
  if (routePolyline) {
    map.removeLayer(routePolyline);
    routePolyline = null;
  }
  cameraMarkers.forEach(m => map.removeLayer(m));
  cameraMarkers = [];

  document.getElementById("map-point-count").textContent = `${sightings.length} checkpoints`;

  if (!sightings || sightings.length === 0) return;

  const latlngs = [];

  sightings.forEach((s, idx) => {
    if (s.latitude && s.longitude) {
      const pos = [s.latitude, s.longitude];
      latlngs.push(pos);

      // Custom sequence marker icon
      const isStart = idx === 0;
      const isEnd = idx === sightings.length - 1;
      const markerColor = isEnd ? "#10b981" : (isStart ? "#f59e0b" : "#38bdf8");

      const iconHtml = `
        <div style="
          background: ${markerColor};
          color: #0f172a;
          width: 28px;
          height: 28px;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 12px;
          font-weight: 900;
          border: 2px solid #ffffff;
          box-shadow: 0 0 12px ${markerColor};
        ">
          ${idx + 1}
        </div>
      `;

      const customIcon = L.divIcon({
        html: iconHtml,
        className: "custom-seq-icon",
        iconSize: [28, 28],
        iconAnchor: [14, 14]
      });

      const marker = L.marker(pos, { icon: customIcon }).addTo(map);
      marker.bindPopup(`
        <div style="font-family:sans-serif; color:#0f172a; min-width:160px;">
          <div style="font-weight:800; font-size:13px; margin-bottom:4px;">Checkpoint #${idx + 1}: ${s.camera_name}</div>
          <div style="font-size:11px; color:#475569; margin-bottom:4px;">${s.location_name}</div>
          <div style="font-size:11px;"><strong>Time:</strong> ${formatTimestamp(s.timestamp)}</div>
          <div style="font-size:11px;"><strong>Speed:</strong> ${s.speed_kmh ? s.speed_kmh + ' km/h' : 'N/A'}</div>
          <div style="font-size:11px;"><strong>Confidence:</strong> ${s.confidence}%</div>
        </div>
      `);

      cameraMarkers.push(marker);
    }
  });

  if (latlngs.length > 1) {
    routePolyline = L.polyline(latlngs, {
      color: "#38bdf8",
      weight: 4,
      opacity: 0.85,
      dashArray: "6, 8"
    }).addTo(map);
    map.fitBounds(routePolyline.getBounds(), { padding: [40, 40] });
    setTimeout(() => { if (map) map.invalidateSize(); }, 100);
  } else if (latlngs.length === 1) {
    map.setView(latlngs[0], 14);
    setTimeout(() => { if (map) map.invalidateSize(); }, 100);
  }
}

function renderTimeline(sightings) {
  const tbody = document.getElementById("timeline-tbody");
  if (!sightings || sightings.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" class="empty-state">No surveillance records logged yet.</td></tr>`;
    return;
  }

  tbody.innerHTML = "";
  // Sort reverse chronological or forward
  sightings.forEach((s, idx) => {
    const tr = document.createElement("tr");

    const isHighSpeed = s.speed_kmh && s.speed_kmh > 75.0;
    const speedBadge = s.speed_kmh 
      ? `<span class="speed-badge ${isHighSpeed ? 'speed-high' : 'speed-normal'}">${s.speed_kmh} km/h</span>`
      : `<span style="color:#64748b;">--</span>`;

    tr.innerHTML = `
      <td><span class="seq-badge">${idx + 1}</span></td>
      <td style="font-family:monospace; font-size:12px;">${formatTimestamp(s.timestamp)}</td>
      <td>
        <div style="font-weight:700; color:#f8fafc;">${s.camera_name}</div>
        <div style="font-size:11px; color:#94a3b8;">${s.location_name}</div>
      </td>
      <td>${speedBadge}</td>
      <td style="font-size:12px; color:#94a3b8;">${s.direction || 'Northbound'}</td>
      <td><span style="font-weight:700; color:#38bdf8;">${s.confidence}%</span></td>
    `;
    tbody.appendChild(tr);
  });
}

function renderAlerts(alerts) {
  const container = document.getElementById("alerts-container");
  if (!alerts || alerts.length === 0) {
    container.innerHTML = `<div class="empty-state">No security infractions or speed alerts recorded for this vehicle.</div>`;
    return;
  }

  container.innerHTML = "";
  alerts.forEach(a => {
    const alertDiv = document.createElement("div");
    alertDiv.style.background = a.severity === "CRITICAL" ? "rgba(239, 68, 68, 0.15)" : "rgba(245, 158, 11, 0.15)";
    alertDiv.style.border = `1px solid ${a.severity === "CRITICAL" ? "rgba(239, 68, 68, 0.4)" : "rgba(245, 158, 11, 0.4)"}`;
    alertDiv.style.borderRadius = "8px";
    alertDiv.style.padding = "12px 16px";
    alertDiv.style.marginBottom = "10px";
    alertDiv.style.display = "flex";
    alertDiv.style.justifyContent = "space-between";
    alertDiv.style.alignItems = "center";

    alertDiv.innerHTML = `
      <div>
        <div style="font-weight:800; font-size:13px; color:${a.severity === "CRITICAL" ? "#f87171" : "#fbbf24"};">
          ${a.severity === "CRITICAL" ? "🚨" : "⚠️"} ${a.alert_type}
        </div>
        <div style="font-size:13px; color:#e2e8f0; margin-top:2px;">${a.message}</div>
      </div>
      <div style="font-size:11px; color:#94a3b8; font-family:monospace;">
        ${formatTimestamp(a.timestamp)}
      </div>
    `;
    container.appendChild(alertDiv);
  });
}

function formatTimestamp(isoStr) {
  if (!isoStr) return "--";
  const d = new Date(isoStr);
  return d.toTimeString().split(" ")[0] + " " + (d.getMonth() + 1) + "/" + d.getDate();
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
      if (msg.type === "detection" && msg.data) {
        if (msg.data.plate_text && msg.data.plate_text.toUpperCase() === currentPlate.toUpperCase()) {
          // Dynamic update of current vehicle profile!
          loadVehicleProfile(currentPlate);
        }
      }
    } catch (e) {}
  };

  ws.onclose = () => {
    setTimeout(initWebSocket, 4000);
  };
}
