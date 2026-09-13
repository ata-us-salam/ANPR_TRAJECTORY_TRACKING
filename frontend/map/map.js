// Advanced GIS Map — Geofencing, Route Prediction, Multi-Vehicle Tracking, Camera Coverage

function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#039;');
}

let advMap = null;
let cameraLayer = null;
let coverageLayer = null;
let geofenceLayer = null;
let predictionLayer = null;
let multiTrackLayer = null;
let drawControl = null;
let drawnItems = null;

let camerasData = [];
let trackedPlates = [];
const trajectoryColors = ['#00f2fe', '#f59e0b', '#10b981', '#8b5cf6', '#f43f5e', '#38bdf8'];

document.addEventListener('DOMContentLoaded', () => {
  initAdvMap();
  loadCameras();
  loadGeofences();
  initMapControls();
});

/* ── Map Initialization ── */
function initAdvMap() {
  const defaultCenter = [20.3000, 85.8271];

  advMap = L.map('adv-map', {
    zoomControl: false,
    attributionControl: false,
  }).setView(defaultCenter, 13);

  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '© OpenStreetMap'
  }).addTo(advMap);

  L.control.zoom({ position: 'bottomright' }).addTo(advMap);

  cameraLayer = L.layerGroup().addTo(advMap);
  coverageLayer = L.layerGroup();
  geofenceLayer = L.layerGroup().addTo(advMap);
  predictionLayer = L.layerGroup().addTo(advMap);
  multiTrackLayer = L.layerGroup().addTo(advMap);

  // Leaflet Draw setup for geofence drawing
  drawnItems = new L.FeatureGroup();
  advMap.addLayer(drawnItems);

  drawControl = new L.Control.Draw({
    draw: {
      polygon: {
        shapeOptions: { color: '#f43f5e', fillColor: '#f43f5e', fillOpacity: 0.15, weight: 2 },
        allowIntersection: false,
      },
      polyline: false, rectangle: false, circle: false, circlemarker: false, marker: false,
    },
    edit: { featureGroup: drawnItems },
  });

  // Handle polygon creation
  advMap.on(L.Draw.Event.CREATED, async (e) => {
    const layer = e.layer;
    const coords = layer.getLatLngs()[0].map(ll => [ll.lat, ll.lng]);
    
    const name = prompt('Enter geofence zone name:', 'Restricted Zone');
    if (!name) return;

    try {
      const res = await fetch('/api/geofences', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, polygon: coords, color: '#f43f5e', zone_type: 'restricted' }),
      });
      await res.json();
      loadGeofences();
    } catch (err) {
      console.error('Create geofence error:', err);
    }
  });
}

/* ── Load Cameras ── */
async function loadCameras() {
  try {
    const res = await fetch('/api/cameras');
    camerasData = await res.json();
    renderCameraMarkers();
    if (camerasData.length > 0) {
      const bounds = L.latLngBounds(camerasData.map(c => [c.latitude, c.longitude]));
      advMap.fitBounds(bounds, { padding: [50, 50] });
    }
  } catch (err) {
    console.error('Load cameras error:', err);
  }
}

function renderCameraMarkers() {
  cameraLayer.clearLayers();
  camerasData.forEach(cam => {
    const pinIcon = L.divIcon({
      className: 'custom-pin-container',
      html: `<div class="custom-cam-pin" title="${escapeHtml(cam.name)}: ${escapeHtml(cam.location_name)}">📹</div>`,
      iconSize: [28, 28],
      iconAnchor: [14, 14],
    });

    const marker = L.marker([cam.latitude, cam.longitude], { icon: pinIcon });
    marker.bindPopup(`
      <div style="padding:6px; font-family:var(--font-sans);">
        <div style="font-weight:800; color:#fff; margin-bottom:4px;">${escapeHtml(cam.name)}</div>
        <div style="font-size:0.8rem; color:#94a3b8; margin-bottom:6px;">📍 ${escapeHtml(cam.location_name)}</div>
        <div style="font-size:0.75rem;">
          <span style="color:${cam.status === 'ACTIVE' ? '#10b981' : '#f59e0b'}; font-weight:700;">● ${cam.status}</span>
          <span style="color:#38bdf8; margin-left:8px;">${cam.total_sightings || 0} Detections</span>
        </div>
        <div style="margin-top:8px;">
          <button onclick="predictFromCamera(${cam.id})" style="background:rgba(139,92,246,0.2); border:1px solid rgba(139,92,246,0.4); color:#8b5cf6; padding:4px 10px; border-radius:4px; cursor:pointer; font-size:0.72rem; font-weight:600;">🔮 Predict Routes</button>
        </div>
      </div>
    `);
    cameraLayer.addLayer(marker);
  });
}

/* ── Camera Coverage Circles ── */
function toggleCoverageLayer() {
  if (advMap.hasLayer(coverageLayer)) {
    advMap.removeLayer(coverageLayer);
  } else {
    coverageLayer.clearLayers();
    camerasData.forEach(cam => {
      if (cam.status === 'ACTIVE') {
        const circle = L.circle([cam.latitude, cam.longitude], {
          radius: 600,
          color: '#00f2fe',
          fillColor: '#00f2fe',
          fillOpacity: 0.08,
          weight: 1,
          dashArray: '4, 4',
        });
        circle.bindTooltip(`${escapeHtml(cam.name)} — Coverage Area`, { sticky: true });
        coverageLayer.addLayer(circle);
      }
    });
    advMap.addLayer(coverageLayer);
  }
}

/* ── Geofences ── */
async function loadGeofences() {
  try {
    const res = await fetch('/api/geofences');
    const zones = await res.json();
    renderGeofencesOnMap(zones);
    renderGeofenceList(zones);
  } catch (err) {
    console.error('Load geofences error:', err);
  }
}

function renderGeofencesOnMap(zones) {
  geofenceLayer.clearLayers();
  zones.forEach(zone => {
    if (zone.polygon && zone.polygon.length >= 3) {
      const polygon = L.polygon(zone.polygon, {
        color: zone.color || '#f43f5e',
        fillColor: zone.color || '#f43f5e',
        fillOpacity: 0.12,
        weight: 2,
        className: 'geofence-polygon',
      });
      polygon.bindPopup(`
        <div style="font-family:var(--font-sans); padding:6px;">
          <div style="font-weight:800; color:#fff;">${escapeHtml(zone.name)}</div>
          <div style="font-size:0.75rem; color:#94a3b8;">Type: ${escapeHtml(zone.zone_type)} | ID: ${zone.id}</div>
        </div>
      `);
      geofenceLayer.addLayer(polygon);
    }
  });
}

function renderGeofenceList(zones) {
  const container = document.getElementById('geofence-list');
  if (!zones || zones.length === 0) {
    container.innerHTML = '<div style="font-size:0.72rem; color:var(--text-dim); padding:6px;">No geofence zones defined.</div>';
    return;
  }
  container.innerHTML = '';
  zones.forEach(z => {
    const item = document.createElement('div');
    item.className = 'geofence-item';
    item.innerHTML = `
      <div class="geofence-name">
        <span class="geofence-color-dot" style="background:${z.color || '#f43f5e'};"></span>
        ${escapeHtml(z.name)}
      </div>
      <button class="geofence-delete-btn" data-zone-id="${z.id}" type="button">✕</button>
    `;
    container.appendChild(item);
  });

  container.querySelectorAll('.geofence-delete-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const zoneId = btn.getAttribute('data-zone-id');
      try {
        await fetch(`/api/geofences/${zoneId}`, { method: 'DELETE' });
        loadGeofences();
      } catch (err) {
        console.error('Delete geofence error:', err);
      }
    });
  });
}

/* ── Route Prediction ── */
async function predictFromCamera(cameraId) {
  try {
    const res = await fetch(`/api/analytics/predict-route?camera_id=${cameraId}&steps=5`);
    const data = await res.json();
    renderPredictions(data.predictions || [], cameraId);
  } catch (err) {
    console.error('Predict error:', err);
  }
}

async function predictFromPlate(plate) {
  try {
    const res = await fetch(`/api/analytics/predict-route?plate=${encodeURIComponent(plate)}&steps=4`);
    const data = await res.json();
    
    const results = data.predicted_route || [];
    renderPredictions(results, null, data.last_seen_camera);
    
    const container = document.getElementById('prediction-results');
    if (data.last_seen_camera) {
      const header = document.createElement('div');
      header.style.cssText = 'font-size:0.72rem; color:var(--text-muted); margin-bottom:8px;';
      header.textContent = `Last seen: ${data.last_seen_camera.camera_name} (${data.last_seen_camera.location})`;
      container.insertBefore(header, container.firstChild);
    }
  } catch (err) {
    console.error('Predict for plate error:', err);
  }
}

function renderPredictions(predictions, fromCameraId, lastSeenCamera) {
  predictionLayer.clearLayers();
  const container = document.getElementById('prediction-results');
  
  if (!predictions || predictions.length === 0) {
    container.innerHTML = '<div style="font-size:0.72rem; color:var(--text-dim); padding:6px;">No predictions available. Insufficient trajectory data.</div>';
    return;
  }

  container.innerHTML = '';
  
  // Draw predicted route on map
  const routeCoords = [];
  
  // Add starting point
  if (fromCameraId) {
    const startCam = camerasData.find(c => c.id === fromCameraId);
    if (startCam) routeCoords.push([startCam.latitude, startCam.longitude]);
  } else if (lastSeenCamera) {
    const startCam = camerasData.find(c => c.id === lastSeenCamera.camera_id);
    if (startCam) routeCoords.push([startCam.latitude, startCam.longitude]);
  }

  predictions.forEach((pred, idx) => {
    routeCoords.push([pred.latitude, pred.longitude]);

    // Predicted waypoint marker
    const predIcon = L.divIcon({
      className: 'waypoint-pin-container',
      html: `<div style="background:#8b5cf6; color:#fff; width:22px; height:22px; border-radius:50%; border:2px solid #fff; display:flex; align-items:center; justify-content:center; font-size:11px; font-weight:800; box-shadow:0 0 10px rgba(139,92,246,0.8);">${idx + 1}</div>`,
      iconSize: [22, 22],
      iconAnchor: [11, 11],
    });
    const marker = L.marker([pred.latitude, pred.longitude], { icon: predIcon });
    marker.bindPopup(`
      <div style="font-family:var(--font-sans); padding:4px;">
        <div style="font-weight:700; color:#8b5cf6;">Predicted Step #${pred.step || idx + 1}</div>
        <div style="color:#fff;">${escapeHtml(pred.camera_name)}</div>
        <div style="font-size:0.75rem; color:#94a3b8;">${escapeHtml(pred.location)}</div>
        <div style="font-family:var(--font-mono); font-size:0.8rem; color:#8b5cf6; margin-top:4px;">
          ${Math.round((pred.probability || 0) * 100)}% probability
        </div>
      </div>
    `);
    predictionLayer.addLayer(marker);

    // Sidebar list
    const step = document.createElement('div');
    step.className = 'prediction-step';
    step.innerHTML = `
      <div class="prediction-step-num">${idx + 1}</div>
      <div class="prediction-step-info">
        <div class="prediction-cam-name">${escapeHtml(pred.camera_name)}</div>
        <div class="prediction-cam-loc">${escapeHtml(pred.location)}</div>
      </div>
      <div class="prediction-prob">${Math.round((pred.probability || 0) * 100)}%</div>
    `;
    step.addEventListener('click', () => advMap.setView([pred.latitude, pred.longitude], 15));
    container.appendChild(step);
  });

  // Draw predicted route polyline
  if (routeCoords.length >= 2) {
    const routeLine = L.polyline(routeCoords, {
      color: '#8b5cf6',
      weight: 4,
      opacity: 0.7,
      dashArray: '10, 8',
    });
    predictionLayer.addLayer(routeLine);

    // Glow effect
    const glowLine = L.polyline(routeCoords, {
      color: '#8b5cf6',
      weight: 10,
      opacity: 0.2,
    });
    predictionLayer.addLayer(glowLine);

    advMap.fitBounds(routeLine.getBounds(), { padding: [60, 60] });
  }
}

/* ── Multi-Vehicle Tracking ── */
async function addTrackedVehicle(plate) {
  if (!plate || trackedPlates.includes(plate.toUpperCase())) return;
  
  try {
    const res = await fetch(`/api/trajectories/search?plate=${encodeURIComponent(plate)}`);
    if (!res.ok) {
      alert(`No trajectory found for: ${plate}`);
      return;
    }
    const data = await res.json();
    const trajs = data.trajectories;
    if (!trajs || trajs.length === 0) return;

    trackedPlates.push(plate.toUpperCase());
    const colorIdx = (trackedPlates.length - 1) % trajectoryColors.length;
    const color = trajectoryColors[colorIdx];

    const traj = trajs[0];
    const coords = traj.path_coordinates || [];
    if (coords.length === 0) return;

    const latLngs = coords.map(c => [c.lat, c.lng]);

    // Glow
    const glow = L.polyline(latLngs, { color, weight: 8, opacity: 0.3 });
    multiTrackLayer.addLayer(glow);

    // Core
    const core = L.polyline(latLngs, { color, weight: 3, opacity: 0.9, dashArray: '6, 4' });
    multiTrackLayer.addLayer(core);

    // Start/end markers
    const startIcon = L.divIcon({
      className: '',
      html: `<div style="background:${color}; color:#fff; width:20px; height:20px; border-radius:50%; border:2px solid #fff; display:flex; align-items:center; justify-content:center; font-size:10px; font-weight:800; box-shadow:0 0 8px ${color};">S</div>`,
      iconSize: [20, 20], iconAnchor: [10, 10],
    });
    const endIcon = L.divIcon({
      className: '',
      html: `<div style="background:${color}; color:#fff; width:20px; height:20px; border-radius:50%; border:2px solid #fff; display:flex; align-items:center; justify-content:center; font-size:10px; font-weight:800; box-shadow:0 0 8px ${color};">E</div>`,
      iconSize: [20, 20], iconAnchor: [10, 10],
    });
    multiTrackLayer.addLayer(L.marker(latLngs[0], { icon: startIcon }));
    multiTrackLayer.addLayer(L.marker(latLngs[latLngs.length - 1], { icon: endIcon }));

    renderTrackedList();
    advMap.fitBounds(core.getBounds(), { padding: [60, 60] });
  } catch (err) {
    console.error('Track vehicle error:', err);
  }
}

function removeTrackedVehicle(plate) {
  trackedPlates = trackedPlates.filter(p => p !== plate);
  // Rebuild all tracks
  multiTrackLayer.clearLayers();
  const plates = [...trackedPlates];
  trackedPlates = [];
  plates.forEach(p => addTrackedVehicle(p));
  renderTrackedList();
}

function renderTrackedList() {
  const container = document.getElementById('tracked-vehicles-list');
  if (trackedPlates.length === 0) {
    container.innerHTML = '<div style="font-size:0.72rem; color:var(--text-dim); padding:6px;">No vehicles being tracked.</div>';
    return;
  }
  container.innerHTML = '';
  trackedPlates.forEach((plate, idx) => {
    const color = trajectoryColors[idx % trajectoryColors.length];
    const item = document.createElement('div');
    item.className = 'tracked-vehicle-item';
    item.innerHTML = `
      <div style="display:flex; align-items:center; gap:8px;">
        <span style="width:10px; height:10px; border-radius:50%; background:${color}; flex-shrink:0;"></span>
        <span class="tracked-plate">${escapeHtml(plate)}</span>
      </div>
      <button class="tracked-remove-btn" data-plate="${escapeHtml(plate)}" type="button">✕</button>
    `;
    container.appendChild(item);
  });

  container.querySelectorAll('.tracked-remove-btn').forEach(btn => {
    btn.addEventListener('click', () => removeTrackedVehicle(btn.getAttribute('data-plate')));
  });
}

/* ── Controls Initialization ── */
function initMapControls() {
  // Toggle camera layer
  document.getElementById('toggle-cameras-btn').addEventListener('click', function() {
    this.classList.toggle('active');
    if (advMap.hasLayer(cameraLayer)) {
      advMap.removeLayer(cameraLayer);
    } else {
      advMap.addLayer(cameraLayer);
    }
  });

  // Toggle coverage
  document.getElementById('toggle-coverage-btn').addEventListener('click', function() {
    this.classList.toggle('active');
    toggleCoverageLayer();
  });

  // Toggle geofences
  document.getElementById('toggle-geofences-btn').addEventListener('click', function() {
    this.classList.toggle('active');
    if (advMap.hasLayer(geofenceLayer)) {
      advMap.removeLayer(geofenceLayer);
    } else {
      advMap.addLayer(geofenceLayer);
    }
  });

  // Toggle predictions
  document.getElementById('toggle-predictions-btn').addEventListener('click', function() {
    this.classList.toggle('active');
    if (advMap.hasLayer(predictionLayer)) {
      advMap.removeLayer(predictionLayer);
    } else {
      advMap.addLayer(predictionLayer);
    }
  });

  // Draw geofence button
  document.getElementById('draw-geofence-btn').addEventListener('click', () => {
    if (!advMap.hasControl || !advMap._controlCorners) {
      advMap.addControl(drawControl);
    }
    // Enable polygon drawing
    new L.Draw.Polygon(advMap, drawControl.options.draw.polygon).enable();
  });

  // Predict from plate
  document.getElementById('predict-btn').addEventListener('click', () => {
    const plate = document.getElementById('predict-plate-input').value.trim();
    if (plate) predictFromPlate(plate);
  });

  document.getElementById('predict-plate-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      const plate = e.target.value.trim();
      if (plate) predictFromPlate(plate);
    }
  });

  // Multi-track
  document.getElementById('multi-track-btn').addEventListener('click', () => {
    const plate = document.getElementById('multi-track-input').value.trim();
    if (plate) {
      addTrackedVehicle(plate);
      document.getElementById('multi-track-input').value = '';
    }
  });

  document.getElementById('multi-track-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      const plate = e.target.value.trim();
      if (plate) {
        addTrackedVehicle(plate);
        e.target.value = '';
      }
    }
  });
}
