// Security Sanitizer to prevent XSS vulnerabilities
function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

let map = null;
let cameraLayerGroup = null;
let trajectoryLayerGroup = null;
let trafficInsightsLayerGroup = null;
let trafficInsightsActive = false;
let playbackMarker = null;
let playbackInterval = null;
let camerasData = [];
let currentTrajectory = null;

// Initialize on DOM load
document.addEventListener('DOMContentLoaded', () => {
  initMap();
  initTabs();
  initSearchAndControls();
  initInferenceTester();
  
  // Load Initial Data
  loadCameras();
  loadTrackedPlatesDropdown();
  loadHudSummary();
  loadRecentFeed();

  // Phase 8: Real-time Telemetry & Alerts
  initWebSocket();
  initAlertsAndExports();
  
  // Refresh recent feed every 30 seconds as fallback
  setInterval(loadRecentFeed, 30000);
});

/* -------------------------------------------------------------
 * 1. Leaflet GIS Map Initialization
 * ----------------------------------------------------------- */
function initMap() {
  const defaultCenter = [28.60, 77.22];
  const defaultZoom = 12;

  map = L.map('map', {
    zoomControl: false,
    attributionControl: false
  }).setView(defaultCenter, defaultZoom);

  // OpenStreetMap tiles
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '© OpenStreetMap contributors'
  }).addTo(map);

  L.control.zoom({ position: 'bottomright' }).addTo(map);

  cameraLayerGroup = L.layerGroup().addTo(map);
  trajectoryLayerGroup = L.layerGroup().addTo(map);
  trafficInsightsLayerGroup = L.layerGroup().addTo(map);

  // Recenter map button
  document.getElementById('reset-map-btn').addEventListener('click', () => {
    map.setView(defaultCenter, defaultZoom);
  });

  // Toggle Traffic Insights Flow Layer button
  document.getElementById('toggle-traffic-layer-btn').addEventListener('click', toggleTrafficInsightsLayer);

  // Toggle Fullscreen Map / Collapse Sidebar button
  document.getElementById('toggle-sidebar-btn').addEventListener('click', () => {
    const sidebar = document.querySelector('.surveillance-sidebar');
    const btn = document.getElementById('toggle-sidebar-btn');
    sidebar.classList.toggle('collapsed');
    const isCollapsed = sidebar.classList.contains('collapsed');
    btn.classList.toggle('active', isCollapsed);
    btn.innerHTML = isCollapsed ? '<span>⛶</span> Show Dashboard' : '<span>⛶</span> Fullscreen Map';
    setTimeout(() => { if (map) map.invalidateSize(); }, 260);
  });

  // Clear trajectory button
  document.getElementById('clear-trajectory-btn').addEventListener('click', () => {
    clearActiveTrajectory();
  });
}

/* -------------------------------------------------------------
 * 2. Camera Nodes & Layer Loading
 * ----------------------------------------------------------- */
async function loadCameras() {
  try {
    const res = await fetch('/api/cameras');
    camerasData = await res.json();
    
    cameraLayerGroup.clearLayers();

    let activeCount = 0;
    camerasData.forEach(cam => {
      if (cam.status === 'ACTIVE') activeCount++;
      
      const pinIcon = L.divIcon({
        className: 'custom-pin-container',
        html: `<div class="custom-cam-pin" title="${escapeHtml(cam.name)}: ${escapeHtml(cam.location_name)}">📹</div>`,
        iconSize: [28, 28],
        iconAnchor: [14, 14]
      });

      const marker = L.marker([cam.latitude, cam.longitude], { icon: pinIcon });
      
      const popupContent = `
        <div style="padding: 6px; font-family: var(--font-sans);">
          <div style="font-weight: 800; font-size: 0.95rem; color: #fff; margin-bottom: 4px;">
            ${escapeHtml(cam.name)}
          </div>
          <div style="font-size: 0.8rem; color: #94a3b8; margin-bottom: 8px;">
            📍 ${escapeHtml(cam.location_name)}
          </div>
          <div style="display: flex; gap: 8px; font-size: 0.75rem;">
            <span style="color: ${cam.status === 'ACTIVE' ? '#10b981' : '#f59e0b'}; font-weight: 700;">
              ● ${escapeHtml(cam.status)}
            </span>
            <span style="color: #38bdf8;">
              ${Number(cam.total_sightings || 0)} Detections
            </span>
          </div>
        </div>
      `;

      marker.bindPopup(popupContent);
      cameraLayerGroup.addLayer(marker);
    });

    document.getElementById('active-cameras-badge').innerText = `${activeCount} Active Cameras`;
  } catch (err) {
    console.error('Failed to load cameras:', err);
  }
}

async function toggleTrafficInsightsLayer() {
  const btn = document.getElementById('toggle-traffic-layer-btn');
  const legend = document.getElementById('traffic-legend');
  trafficInsightsActive = !trafficInsightsActive;
  btn.classList.toggle('active', trafficInsightsActive);
  legend.style.display = trafficInsightsActive ? 'flex' : 'none';

  if (!trafficInsightsActive) {
    trafficInsightsLayerGroup.clearLayers();
    return;
  }

  try {
    // 1. Draw camera traffic volume bubbles
    camerasData.forEach(cam => {
      const count = cam.total_sightings || 0;
      let color = '#10b981'; // Normal (<10)
      let radiusMeters = 350;
      if (count >= 20) {
        color = '#f43f5e'; // High (>20)
        radiusMeters = 800;
      } else if (count >= 10) {
        color = '#f59e0b'; // Moderate (10-20)
        radiusMeters = 550;
      }

      const circle = L.circle([cam.latitude, cam.longitude], {
        color: color,
        fillColor: color,
        fillOpacity: 0.35,
        weight: 2,
        radius: radiusMeters
      });

      circle.bindTooltip(`
        <div style="font-family:var(--font-sans); font-size:0.8rem; font-weight:700; color:${color};">
          🚦 ${escapeHtml(cam.name)}: ${count} Sightings
        </div>
      `, { sticky: true });

      trafficInsightsLayerGroup.addLayer(circle);
    });

    // 2. Fetch and draw top OD arterial flow corridors
    const odRes = await fetch('/api/analytics/od-matrix');
    const odData = await odRes.json();
    
    odData.forEach(corridor => {
      const origCam = camerasData.find(c => c.name === corridor.origin_name);
      const destCam = camerasData.find(c => c.name === corridor.destination_name);
      if (origCam && destCam) {
        const flowLine = L.polyline([
          [origCam.latitude, origCam.longitude],
          [destCam.latitude, destCam.longitude]
        ], {
          color: '#00f2fe',
          weight: 4,
          opacity: 0.8,
          dashArray: '8, 12'
        });

        flowLine.bindPopup(`
          <div style="font-family:var(--font-sans); padding:6px;">
            <div style="font-weight:800; color:#38bdf8; margin-bottom:4px;">Arterial Corridor Transit</div>
            <div style="font-size:0.82rem; color:#fff;">${escapeHtml(corridor.origin_location)} ➔ ${escapeHtml(corridor.destination_location)}</div>
            <div style="font-size:0.75rem; color:#94a3b8; margin-top:6px;">
              Volume: <b>${corridor.trips_count} vehicles</b> | Avg Time: <b>${corridor.avg_duration_minutes}m</b> | Distance: <b>${corridor.avg_distance_km}km</b>
            </div>
          </div>
        `);

        trafficInsightsLayerGroup.addLayer(flowLine);
      }
    });
  } catch (err) {
    console.error('Failed to render traffic insights layer:', err);
  }
}

/* -------------------------------------------------------------
 * 3. Vehicle Trajectory Retrieval & Path Rendering
 * ----------------------------------------------------------- */
async function trackPlateTrajectory(plateText) {
  if (!plateText || !plateText.trim()) return;
  const plate = plateText.trim().toUpperCase();

  try {
    const res = await fetch(`/api/trajectories/search?plate=${encodeURIComponent(plate)}`);
    if (!res.ok) {
      alert(`No trajectory sightings found for vehicle plate: ${plate}`);
      return;
    }

    const data = await res.json();
    const trajectories = data.trajectories;
    if (!trajectories || trajectories.length === 0) {
      alert(`No trajectory path available for: ${plate}`);
      return;
    }

    const traj = trajectories[0];
    currentTrajectory = traj;
    renderTrajectoryOnMap(traj);
    renderTrajectorySidebar(traj);
  } catch (err) {
    console.error('Error fetching trajectory:', err);
    alert(`Could not fetch trajectory for: ${plate}`);
  }
}

function renderTrajectoryOnMap(traj) {
  trajectoryLayerGroup.clearLayers();
  stopTrajectoryPlayback();

  const coords = traj.path_coordinates || [];
  if (coords.length === 0) return;

  const latLngs = coords.map(c => [c.lat, c.lng]);

  // Glow halo polyline
  const glowPolyline = L.polyline(latLngs, {
    color: '#00f2fe',
    weight: 8,
    opacity: 0.35,
    lineCap: 'round',
    lineJoin: 'round'
  });
  trajectoryLayerGroup.addLayer(glowPolyline);

  // Core sharp polyline
  const corePolyline = L.polyline(latLngs, {
    color: '#38bdf8',
    weight: 4,
    opacity: 0.95,
    dashArray: '8, 4',
    lineCap: 'round',
    lineJoin: 'round'
  });
  trajectoryLayerGroup.addLayer(corePolyline);

  // Numbered Waypoint Markers
  coords.forEach((coord, idx) => {
    const waypointIcon = L.divIcon({
      className: 'waypoint-pin-container',
      html: `<div class="waypoint-pin">${idx + 1}</div>`,
      iconSize: [22, 22],
      iconAnchor: [11, 11]
    });

    const marker = L.marker([coord.lat, coord.lng], { icon: waypointIcon });
    const timeStr = coord.timestamp ? new Date(coord.timestamp).toLocaleTimeString() : '';
    marker.bindPopup(`
      <div style="font-family: var(--font-sans); padding: 4px;">
        <div style="font-weight: 700; color: #38bdf8;">Waypoint #${idx + 1}: ${coord.name}</div>
        <div style="font-size: 0.78rem; color: #94a3b8;">${coord.location}</div>
        <div style="font-size: 0.75rem; color: #fff; margin-top: 4px;">Time: ${timeStr}</div>
        ${coord.speed_kmh ? `<div style="font-size: 0.75rem; color: #10b981;">Speed: ${coord.speed_kmh} km/h</div>` : ''}
      </div>
    `);
    trajectoryLayerGroup.addLayer(marker);
  });

  // Fit map view to the polyline route with padding
  map.fitBounds(corePolyline.getBounds(), { padding: [60, 60] });

  // Update playback bar
  document.getElementById('playback-bar').classList.add('active');
  document.getElementById('playback-plate-display').innerText = traj.plate_text;
  document.getElementById('playback-step-display').innerText = `${coords.length} checkpoints in journey (${traj.distance_km} km)`;
}

function renderTrajectorySidebar(traj) {
  const panel = document.getElementById('active-trajectory-panel');
  panel.classList.add('visible');

  document.getElementById('selected-plate-number').innerText = traj.plate_text;
  document.getElementById('traj-distance').innerText = `${traj.distance_km} km`;
  document.getElementById('traj-speed').innerText = `${traj.avg_speed_kmh} km/h`;
  document.getElementById('traj-cameras').innerText = `${traj.total_cameras} Cams`;

  const timeline = document.getElementById('checkpoint-timeline');
  timeline.innerHTML = '';

  const coords = traj.path_coordinates || [];
  coords.forEach((coord, idx) => {
    const node = document.createElement('div');
    node.className = 'checkpoint-node';
    const timeStr = coord.timestamp ? new Date(coord.timestamp).toLocaleTimeString() : '--:--';
    
    node.innerHTML = `
      <div class="checkpoint-content">
        <div class="checkpoint-cam">#${idx + 1} ${escapeHtml(coord.name)} - ${escapeHtml(coord.location)}</div>
        <div class="checkpoint-meta">
          <span>🕒 ${escapeHtml(timeStr)}</span>
          <span>⚡ ${coord.speed_kmh ? Number(coord.speed_kmh) + ' km/h' : 'Recorded'}</span>
        </div>
      </div>
    `;

    node.addEventListener('click', () => {
      map.setView([coord.lat, coord.lng], 15);
    });

    timeline.appendChild(node);
  });
}

function clearActiveTrajectory() {
  trajectoryLayerGroup.clearLayers();
  stopTrajectoryPlayback();
  document.getElementById('active-trajectory-panel').classList.remove('visible');
  document.getElementById('playback-bar').classList.remove('active');
  document.getElementById('plate-search-input').value = '';
  document.getElementById('quick-plate-select').value = '';
  currentTrajectory = null;
}

/* -------------------------------------------------------------
 * 4. Animated Trajectory Simulation Playback
 * ----------------------------------------------------------- */
function playTrajectorySimulation() {
  if (!currentTrajectory || !currentTrajectory.path_coordinates) return;
  const coords = currentTrajectory.path_coordinates;
  if (coords.length < 2) return;

  stopTrajectoryPlayback();

  let step = 0;
  const btn = document.getElementById('playback-toggle-btn');
  btn.innerText = '⏸';

  // Vehicle tracker icon
  const vehicleIcon = L.divIcon({
    className: 'sim-vehicle-icon',
    html: `<div style="background:#10b981; width:16px; height:16px; border-radius:50%; border:3px solid #fff; box-shadow:0 0 15px #10b981;"></div>`,
    iconSize: [16, 16],
    iconAnchor: [8, 8]
  });

  playbackMarker = L.marker([coords[0].lat, coords[0].lng], { icon: vehicleIcon }).addTo(map);

  playbackInterval = setInterval(() => {
    if (step >= coords.length) {
      stopTrajectoryPlayback();
      return;
    }

    const current = coords[step];
    playbackMarker.setLatLng([current.lat, current.lng]);
    document.getElementById('playback-step-display').innerText = 
      `Checkpoint ${step + 1}/${coords.length}: ${current.name} (${current.speed_kmh || 50} km/h)`;
    
    step++;
  }, 1200);
}

function stopTrajectoryPlayback() {
  if (playbackInterval) {
    clearInterval(playbackInterval);
    playbackInterval = null;
  }
  if (playbackMarker) {
    map.removeLayer(playbackMarker);
    playbackMarker = null;
  }
  const btn = document.getElementById('playback-toggle-btn');
  if (btn) btn.innerText = '▶';
}

/* -------------------------------------------------------------
 * 5. Tracked Plates Dropdown & Search Controls
 * ----------------------------------------------------------- */
async function loadTrackedPlatesDropdown() {
  try {
    const res = await fetch('/api/trajectories/plates');
    const plates = await res.json();
    const select = document.getElementById('quick-plate-select');
    select.innerHTML = '<option value="">Select Tracked Vehicle...</option>';

    plates.forEach(p => {
      const opt = document.createElement('option');
      opt.value = p.plate_text;
      opt.text = `${p.plate_text} (${p.distance_km} km | ${p.total_cameras} cams)`;
      select.appendChild(opt);
    });
  } catch (err) {
    console.error('Error loading plates dropdown:', err);
  }
}

function initSearchAndControls() {
  const searchInput = document.getElementById('plate-search-input');
  const searchBtn = document.getElementById('search-btn');
  const quickSelect = document.getElementById('quick-plate-select');

  searchBtn.addEventListener('click', () => {
    const query = searchInput.value.trim();
    if (query) trackPlateTrajectory(query);
  });

  searchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      const query = searchInput.value.trim();
      if (query) trackPlateTrajectory(query);
    }
  });

  quickSelect.addEventListener('change', () => {
    if (quickSelect.value) {
      searchInput.value = quickSelect.value;
      trackPlateTrajectory(quickSelect.value);
    }
  });

  // Playback buttons
  const playBtn = document.getElementById('playback-toggle-btn');
  playBtn.addEventListener('click', () => {
    if (playbackInterval) {
      stopTrajectoryPlayback();
    } else {
      playTrajectorySimulation();
    }
  });

  document.getElementById('sidebar-playback-btn').addEventListener('click', () => {
    playTrajectorySimulation();
  });

  document.getElementById('close-playback-btn').addEventListener('click', () => {
    stopTrajectoryPlayback();
    document.getElementById('playback-bar').classList.remove('active');
  });
}

/* -------------------------------------------------------------
 * 6. HUD Metrics & Recent Surveillance Feed
 * ----------------------------------------------------------- */
async function loadHudSummary() {
  try {
    const res = await fetch('/api/analytics/summary');
    const data = await res.json();

    document.getElementById('hud-total-detections').innerText = data.total_detections.toLocaleString();
    document.getElementById('hud-unique-vehicles').innerText = data.unique_vehicles.toLocaleString();
    document.getElementById('hud-active-cams').innerText = `${data.active_cameras}/${data.total_cameras}`;
    document.getElementById('hud-ocr-conf').innerText = `${data.avg_ocr_confidence}%`;
  } catch (err) {
    console.error('Failed to fetch HUD summary:', err);
  }
}

async function loadRecentFeed() {
  try {
    const res = await fetch('/api/events/recent?limit=12');
    const events = await res.json();
    const feedList = document.getElementById('feed-list');
    feedList.innerHTML = '';

    events.forEach(event => {
      const item = document.createElement('div');
      item.className = 'feed-item';
      
      const iconMap = {
        'Car': '🚗',
        'Truck': '🚚',
        'Bus': '🚌',
        'Motorcycle': '🏍️'
      };
      const vIcon = iconMap[event.vehicle_type] || '🚘';
      const timeStr = event.timestamp ? new Date(event.timestamp).toLocaleTimeString() : '';

      item.innerHTML = `
        <div class="feed-item-left">
          <div class="vehicle-type-icon">${vIcon}</div>
          <div>
            <div class="feed-plate-text">${escapeHtml(event.plate_text)}</div>
            <div class="feed-cam-name">${escapeHtml(event.camera_name || 'CAM')} (${escapeHtml(event.vehicle_type)})</div>
          </div>
        </div>
        <div class="feed-item-right">
          <div class="feed-time">${escapeHtml(timeStr)}</div>
          <div class="confidence-meter">${Math.round(event.confidence * 100)}% Match</div>
        </div>
      `;

      item.addEventListener('click', () => {
        document.getElementById('plate-search-input').value = event.plate_text;
        trackPlateTrajectory(event.plate_text);
        if (event.latitude && event.longitude) {
          map.setView([event.latitude, event.longitude], 14);
        }
      });

      feedList.appendChild(item);
    });
  } catch (err) {
    console.error('Failed to load recent feed:', err);
  }
}

/* -------------------------------------------------------------
 * 7. Navigation Tabs & Analytics View
 * ----------------------------------------------------------- */
let volumeChartInstance = null;
let vehicleChartInstance = null;

function initTabs() {
  const tabs = document.querySelectorAll('.tab-btn');
  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      tabs.forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.view-container').forEach(v => v.classList.remove('active'));

      tab.classList.add('active');
      const targetView = document.getElementById(tab.getAttribute('data-tab'));
      if (targetView) targetView.classList.add('active');

      if (tab.getAttribute('data-tab') === 'gis-view') {
        setTimeout(() => map.invalidateSize(), 200);
      } else if (tab.getAttribute('data-tab') === 'analytics-view') {
        loadAnalyticsView();
      }
    });
  });
}

async function loadAnalyticsView() {
  try {
    // 1. Hourly Volume Chart
    const volRes = await fetch('/api/analytics/hourly-volume');
    const volData = await volRes.json();

    const hours = volData.map(v => v.hour);
    const counts = volData.map(v => v.count);

    const ctxVol = document.getElementById('trafficVolumeChart').getContext('2d');
    if (volumeChartInstance) volumeChartInstance.destroy();

    volumeChartInstance = new Chart(ctxVol, {
      type: 'bar',
      data: {
        labels: hours,
        datasets: [{
          label: 'Vehicle Sightings',
          data: counts,
          backgroundColor: 'rgba(56, 189, 248, 0.45)',
          borderColor: '#38bdf8',
          borderWidth: 1.5,
          borderRadius: 4
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false }
        },
        scales: {
          x: { grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#94a3b8' } },
          y: { grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#94a3b8' } }
        }
      }
    });

    // 2. Vehicle Category Share
    const vRes = await fetch('/api/analytics/vehicle-types');
    const vData = await vRes.json();

    const vLabels = vData.map(v => v.vehicle_type);
    const vCounts = vData.map(v => v.count);

    const ctxVeh = document.getElementById('vehicleDistributionChart').getContext('2d');
    if (vehicleChartInstance) vehicleChartInstance.destroy();

    vehicleChartInstance = new Chart(ctxVeh, {
      type: 'doughnut',
      data: {
        labels: vLabels,
        datasets: [{
          data: vCounts,
          backgroundColor: ['#00f2fe', '#4facfe', '#8b5cf6', '#10b981', '#f59e0b'],
          borderColor: '#0f172a',
          borderWidth: 3
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { position: 'bottom', labels: { color: '#94a3b8', boxWidth: 12 } }
        }
      }
    });

    // 3. OD Matrix Corridors
    const odRes = await fetch('/api/analytics/od-matrix');
    const odData = await odRes.json();
    const odTableBody = document.querySelector('#od-matrix-table tbody');
    odTableBody.innerHTML = '';

    odData.forEach(row => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td style="font-weight:600; color:#fff;">${escapeHtml(row.origin_name)} (${escapeHtml(row.origin_location)})</td>
        <td style="font-weight:600; color:#38bdf8;">${escapeHtml(row.destination_name)} (${escapeHtml(row.destination_location)})</td>
        <td><span class="confidence-meter">${Number(row.trips_count)} vehicles</span></td>
        <td>${Number(row.avg_duration_minutes)} min</td>
        <td>${Number(row.avg_distance_km)} km</td>
      `;
      odTableBody.appendChild(tr);
    });

    // 4. Speed Anomalies
    const spRes = await fetch('/api/analytics/speed-anomalies');
    const spData = await spRes.json();
    const spList = document.getElementById('speed-anomalies-list');
    spList.innerHTML = '';

    if (spData.length === 0) {
      spList.innerHTML = '<div style="color:var(--text-dim); padding:10px;">No vehicles currently flagged for speed violations.</div>';
    } else {
      spData.forEach(item => {
        const div = document.createElement('div');
        div.style.cssText = 'background:rgba(244,63,94,0.08); border:1px solid rgba(244,63,94,0.25); border-radius:8px; padding:10px; margin-bottom:8px; display:flex; justify-content:space-between; align-items:center;';
        div.innerHTML = `
          <div>
            <div style="font-family:var(--font-mono); font-weight:700; color:#fff;">${escapeHtml(item.plate_text)}</div>
            <div style="font-size:0.72rem; color:#94a3b8;">${Number(item.distance_km)} km across ${Number(item.total_cameras)} cameras</div>
          </div>
          <div style="text-align:right;">
            <div style="color:#f43f5e; font-weight:800; font-size:1rem; font-family:var(--font-mono);">${Number(item.avg_speed_kmh)} km/h</div>
            <div style="font-size:0.65rem; color:#f87171;">EXCEEDS LIMIT</div>
          </div>
        `;
        spList.appendChild(div);
      });
    }

  } catch (err) {
    console.error('Error loading analytics view:', err);
  }
}

/* -------------------------------------------------------------
 * 8. Live AI Model Pipeline Testing & Upload Sandbox (Images & CCTV Video)
 * ----------------------------------------------------------- */
function initInferenceTester() {
  // Mode switcher (Image vs Video)
  const modeImgBtn = document.getElementById('mode-image-btn');
  const modeVideoBtn = document.getElementById('mode-video-btn');
  const imgContainer = document.getElementById('image-sandbox-container');
  const videoContainer = document.getElementById('video-sandbox-container');

  if (modeImgBtn && modeVideoBtn) {
    modeImgBtn.addEventListener('click', () => {
      modeImgBtn.classList.add('active');
      modeVideoBtn.classList.remove('active');
      imgContainer.style.display = 'block';
      videoContainer.style.display = 'none';
    });

    modeVideoBtn.addEventListener('click', () => {
      modeVideoBtn.classList.add('active');
      modeImgBtn.classList.remove('active');
      imgContainer.style.display = 'none';
      videoContainer.style.display = 'block';
    });
  }

  // 1. IMAGE DROPZONE & INPUT
  const dropzone = document.getElementById('image-dropzone');
  const fileInput = document.getElementById('file-input');

  if (dropzone && fileInput) {
    dropzone.addEventListener('click', () => fileInput.click());

    dropzone.addEventListener('dragover', (e) => {
      e.preventDefault();
      dropzone.style.borderColor = '#00f2fe';
    });

    dropzone.addEventListener('dragleave', () => {
      dropzone.style.borderColor = 'rgba(56, 189, 248, 0.35)';
    });

    dropzone.addEventListener('drop', (e) => {
      e.preventDefault();
      dropzone.style.borderColor = 'rgba(56, 189, 248, 0.35)';
      if (e.dataTransfer.files && e.dataTransfer.files[0]) {
        handleUploadedFile(e.dataTransfer.files[0]);
      }
    });

    fileInput.addEventListener('change', (e) => {
      if (e.target.files && e.target.files[0]) {
        handleUploadedFile(e.target.files[0]);
      }
    });
  }

  // Demo Sample Image Buttons
  const sample1Btn = document.getElementById('run-sample-1-btn');
  if (sample1Btn) {
    sample1Btn.addEventListener('click', () => runSampleInference('test_image_2.jpg'));
  }
  const sample2Btn = document.getElementById('run-sample-2-btn');
  if (sample2Btn) {
    sample2Btn.addEventListener('click', () => runSampleInference('sample_car.jpg'));
  }

  // 2. VIDEO DROPZONE & INPUT
  const videoDropzone = document.getElementById('video-dropzone');
  const videoFileInput = document.getElementById('video-file-input');
  const sampleVideoBtn = document.getElementById('run-sample-video-btn');

  if (videoDropzone && videoFileInput) {
    videoDropzone.addEventListener('click', () => videoFileInput.click());

    videoDropzone.addEventListener('dragover', (e) => {
      e.preventDefault();
      videoDropzone.style.borderColor = '#00f2fe';
    });

    videoDropzone.addEventListener('dragleave', () => {
      videoDropzone.style.borderColor = 'rgba(56, 189, 248, 0.35)';
    });

    videoDropzone.addEventListener('drop', (e) => {
      e.preventDefault();
      videoDropzone.style.borderColor = 'rgba(56, 189, 248, 0.35)';
      if (e.dataTransfer.files && e.dataTransfer.files[0]) {
        handleUploadedVideo(e.dataTransfer.files[0]);
      }
    });

    videoFileInput.addEventListener('change', (e) => {
      if (e.target.files && e.target.files[0]) {
        handleUploadedVideo(e.target.files[0]);
      }
    });
  }

  if (sampleVideoBtn) {
    sampleVideoBtn.addEventListener('click', runSampleVideoInference);
  }
}

async function runSampleInference(sampleFilename) {
  const resultsContainer = document.getElementById('inference-results-content');
  const statusBadge = document.getElementById('inference-status-badge');
  const previewImg = document.getElementById('inference-preview-img');
  const placeholder = document.getElementById('preview-placeholder');

  resultsContainer.innerHTML = '<div style="color:#38bdf8;">⚙️ Running AI Detector & OCR on sample...</div>';
  statusBadge.style.display = 'inline-block';
  statusBadge.innerText = 'Processing...';

  try {
    const res = await fetch(`/api/inference/run-sample?sample_name=${sampleFilename}`, { method: 'POST' });
    const data = await res.json();

    displayInferenceResults(data, `/data/${sampleFilename}`);
  } catch (err) {
    resultsContainer.innerHTML = `<div style="color:#f43f5e;">Inference error: ${escapeHtml(err.message)}</div>`;
    statusBadge.innerText = 'Failed';
  }
}

function handleUploadedFile(file) {
  const reader = new FileReader();
  reader.onload = async (e) => {
    const base64Data = e.target.result;
    
    const resultsContainer = document.getElementById('inference-results-content');
    const statusBadge = document.getElementById('inference-status-badge');
    resultsContainer.innerHTML = '<div style="color:#38bdf8;">⚙️ Processing upload through AI model pipeline...</div>';
    statusBadge.style.display = 'inline-block';
    statusBadge.innerText = 'Processing...';

    try {
      const res = await fetch('/api/inference/upload-base64', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          image_base64: base64Data,
          filename: file.name
        })
      });
      const data = await res.json();
      displayInferenceResults(data, base64Data);
    } catch (err) {
      resultsContainer.innerHTML = `<div style="color:#f43f5e;">Upload error: ${escapeHtml(err.message)}</div>`;
      statusBadge.innerText = 'Failed';
    }
  };
  reader.readAsDataURL(file);
}

function displayInferenceResults(data, imageSrc) {
  const resultsContainer = document.getElementById('inference-results-content');
  const statusBadge = document.getElementById('inference-status-badge');
  const previewImg = document.getElementById('inference-preview-img');
  const placeholder = document.getElementById('preview-placeholder');

  // Show preview
  previewImg.src = imageSrc;
  previewImg.style.display = 'block';
  placeholder.style.display = 'none';

  statusBadge.innerText = 'Success';
  statusBadge.style.background = 'rgba(16, 185, 129, 0.15)';
  statusBadge.style.color = '#10b981';

  const detections = data.results || [];
  if (detections.length === 0) {
    resultsContainer.innerHTML = `
      <div style="padding: 20px; text-align: center;">
        <div style="font-size: 24px; margin-bottom: 8px;">ℹ️</div>
        <div>No vehicles or license plates localized in this frame.</div>
      </div>
    `;
    return;
  }

  let html = `<div style="text-align:left; width:100%;">`;
  detections.forEach((det, idx) => {
    const isValid = det.is_valid;
    html += `
      <div style="background: rgba(255,255,255,0.03); border: 1px solid var(--border-subtle); border-radius: 10px; padding: 14px; margin-bottom: 12px;">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
          <span style="font-size:0.8rem; color:#94a3b8; font-weight:700;">Detection #${idx + 1}</span>
          <span class="confidence-meter">${Math.round(det.confidence * 100)}% Confidence</span>
        </div>
        <div style="display:flex; align-items:center; gap:12px; margin-bottom:10px;">
          <div class="plate-box" style="padding: 2px 8px;">
            <div class="plate-number" style="font-size:1.1rem;">${escapeHtml(det.text || 'UNKNOWN')}</div>
          </div>
          <span style="font-size:0.75rem; font-weight:700; color: ${isValid ? '#10b981' : '#f59e0b'};">
            ${isValid ? '✓ Valid Indian Format' : '⚠️ Unverified Format'}
          </span>
        </div>
        <div style="font-family:var(--font-mono); font-size:0.75rem; color:#64748b;">
          Bounding Box: [${det.bbox.map(n => Math.round(n)).join(', ')}]
        </div>
      </div>
    `;
  });
  html += `</div>`;

  resultsContainer.innerHTML = html;
}

/* -------------------------------------------------------------
 * 9. CCTV Video Footage Upload & Temporal Majority Voting
 * ----------------------------------------------------------- */
async function handleUploadedVideo(file) {
  const videoPlayer = document.getElementById('cctv-video-player');
  const placeholder = document.getElementById('video-placeholder');
  const resultsContainer = document.getElementById('video-results-content');
  const statusBadge = document.getElementById('video-status-badge');

  // Preview local video in player
  const videoUrl = URL.createObjectURL(file);
  videoPlayer.src = videoUrl;
  videoPlayer.style.display = 'block';
  placeholder.style.display = 'none';

  statusBadge.style.display = 'inline-block';
  statusBadge.innerText = 'Processing Video...';
  statusBadge.style.color = '#38bdf8';
  resultsContainer.innerHTML = '<div style="color:#38bdf8;">🎥 Uploading & processing video through Kalman tracker & temporal majority voting engine...<br><span style="font-size:0.75rem; color:#94a3b8;">Analyzing frames, detecting vehicles, voting on license plates...</span></div>';

  try {
    const arrayBuffer = await file.arrayBuffer();
    const res = await fetch('/api/inference/upload-video', {
      method: 'POST',
      headers: { 'Content-Type': 'video/mp4' },
      body: arrayBuffer
    });
    const data = await res.json();
    displayVideoInferenceResults(data, videoUrl);
  } catch (err) {
    resultsContainer.innerHTML = `<div style="color:#f43f5e;">CCTV video analysis error: ${escapeHtml(err.message)}</div>`;
    statusBadge.innerText = 'Failed';
  }
}

async function runSampleVideoInference() {
  const videoPlayer = document.getElementById('cctv-video-player');
  const placeholder = document.getElementById('video-placeholder');
  const resultsContainer = document.getElementById('video-results-content');
  const statusBadge = document.getElementById('video-status-badge');

  const videoUrl = '/data/test_video.mp4';
  videoPlayer.src = videoUrl;
  videoPlayer.style.display = 'block';
  placeholder.style.display = 'none';

  statusBadge.style.display = 'inline-block';
  statusBadge.innerText = 'Running Sample...';
  statusBadge.style.color = '#38bdf8';
  resultsContainer.innerHTML = '<div style="color:#38bdf8;">⚙️ Processing CCTV sample video test_video.mp4...<br><span style="font-size:0.75rem; color:#94a3b8;">Tracking vehicles and resolving OCR jitter via temporal voting...</span></div>';

  try {
    const res = await fetch('/api/inference/run-sample-video', { method: 'POST' });
    const data = await res.json();
    displayVideoInferenceResults(data, videoUrl);
  } catch (err) {
    resultsContainer.innerHTML = `<div style="color:#f43f5e;">Sample video error: ${escapeHtml(err.message)}</div>`;
    statusBadge.innerText = 'Failed';
  }
}

function displayVideoInferenceResults(data, videoUrl) {
  const resultsContainer = document.getElementById('video-results-content');
  const statusBadge = document.getElementById('video-status-badge');

  statusBadge.innerText = 'Success';
  statusBadge.style.background = 'rgba(16, 185, 129, 0.15)';
  statusBadge.style.color = '#10b981';

  const tracked = data.results || [];
  if (tracked.length === 0) {
    resultsContainer.innerHTML = '<div style="padding:20px; color:var(--text-dim);">No moving vehicle license plates tracked in this video footage.</div>';
    return;
  }

  let html = `<div style="text-align:left; width:100%;">`;
  html += `<div style="font-size:0.8rem; color:#94a3b8; margin-bottom:12px;">Processed ${data.total_frames || 90} frames (${data.duration_sec || 3.0}s footage) • ${tracked.length} vehicle(s) tracked:</div>`;

  tracked.forEach((t) => {
    const isValid = t.valid;
    html += `
      <div style="background: rgba(255,255,255,0.03); border: 1px solid var(--border-subtle); border-radius: 10px; padding: 14px; margin-bottom: 12px;">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
          <span style="font-size:0.8rem; color:#38bdf8; font-weight:700;">Vehicle Track #${t.track_id}</span>
          <span class="confidence-meter">${Math.round((t.confidence || 0.8) * 100)}% Aggregated Conf</span>
        </div>
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;">
          <div style="display:flex; align-items:center; gap:10px;">
            <div class="plate-box" style="padding: 2px 8px;">
              <div class="plate-number" style="font-size:1.15rem;">${escapeHtml(t.plate_text)}</div>
            </div>
            <span style="font-size:0.75rem; font-weight:700; color: ${isValid ? '#10b981' : '#f59e0b'};">
              ${isValid ? '✓ Valid Indian Registration' : '⚠️ Non-standard'}
            </span>
          </div>
          <button class="map-action-btn track-from-video-btn" data-plate="${escapeHtml(t.plate_text)}" type="button" style="padding:6px 12px;">
            <span>🗺️</span> Track on Map
          </button>
        </div>
        <div style="font-family:var(--font-mono); font-size:0.75rem; color:#64748b;">
          Temporal Voting: ${t.reads_count} / ${t.total_track_frames} frames confirmed match
        </div>
      </div>
    `;
  });
  html += `</div>`;

  resultsContainer.innerHTML = html;

  // Wire "Track on Map" buttons
  document.querySelectorAll('.track-from-video-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const plate = btn.getAttribute('data-plate');
      if (plate) {
        // Switch to GIS Map tab
        const gisTabBtn = document.getElementById('tab-gis-btn');
        if (gisTabBtn) gisTabBtn.click();
        // Track the vehicle
        document.getElementById('plate-search-input').value = plate;
        trackPlateTrajectory(plate);
      }
    });
  });
}

/* -------------------------------------------------------------
 * 10. Phase 8: WebSocket Real-Time Telemetry & Alert Handling
 * ----------------------------------------------------------- */
let wsConnection = null;
let wsReconnectTimer = null;

function initWebSocket() {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${protocol}//${window.location.host}/ws/live`;

  function connect() {
    try {
      wsConnection = new WebSocket(wsUrl);

      wsConnection.onopen = () => {
        console.log('⚡ WebSocket telemetry connected:', wsUrl);
        if (wsReconnectTimer) {
          clearTimeout(wsReconnectTimer);
          wsReconnectTimer = null;
        }
      };

      wsConnection.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          handleWebSocketMessage(msg);
        } catch (e) {
          console.error('WebSocket message parse error:', e);
        }
      };

      wsConnection.onclose = () => {
        console.warn('⚠️ WebSocket disconnected. Reconnecting in 3s...');
        wsReconnectTimer = setTimeout(connect, 3000);
      };

      wsConnection.onerror = (err) => {
        console.error('WebSocket error:', err);
        wsConnection.close();
      };
    } catch (e) {
      console.error('Failed to create WebSocket:', e);
      wsReconnectTimer = setTimeout(connect, 5000);
    }
  }

  connect();
}

function handleWebSocketMessage(msg) {
  const type = msg.type;
  const data = msg.data;

  if (type === 'detection' || type === 'event') {
    // 1. Prepend detection to recent surveillance feed
    prependLiveEvent(data);
    
    // 2. Increment HUD counter
    const hudDetections = document.getElementById('hud-total-detections');
    if (hudDetections) {
      const cur = parseInt(hudDetections.innerText.replace(/,/g, ''), 10) || 0;
      hudDetections.innerText = (cur + 1).toLocaleString();
    }
  } else if (type === 'alert') {
    // Show toast notification
    showToast(data.alert_type || 'SECURITY ALERT', data.message, data.severity || 'WARNING');
    // Increment alert bell counter
    incrementAlertBadge();
    // Prepend to slideover if open or cached
    prependSlideoverAlert(data);
  } else if (type === 'camera_status') {
    // Reload cameras to reflect health change
    loadCameras();
  }
}

function prependLiveEvent(ev) {
  const feedList = document.getElementById('feed-list');
  if (!feedList) return;

  const item = document.createElement('div');
  item.className = 'feed-item';
  item.style.animation = 'toast-slide-in 0.3s ease';

  const iconMap = { 'Car': '🚗', 'Truck': '🚚', 'Bus': '🚌', 'Motorcycle': '🏍️' };
  const vIcon = iconMap[ev.vehicle_type] || '🚘';
  const timeStr = ev.timestamp ? new Date(ev.timestamp).toLocaleTimeString() : new Date().toLocaleTimeString();

  item.innerHTML = `
    <div class="feed-item-left">
      <div class="vehicle-type-icon">${vIcon}</div>
      <div>
        <div class="feed-plate-text">${escapeHtml(ev.plate_text)}</div>
        <div class="feed-cam-name">${escapeHtml(ev.camera_name || 'CAM')} (${escapeHtml(ev.vehicle_type || 'Vehicle')})</div>
      </div>
    </div>
    <div class="feed-item-right">
      <div class="feed-time">${escapeHtml(timeStr)}</div>
      <div class="confidence-meter">${Math.round((ev.confidence || 0.95) * 100)}% Match</div>
    </div>
  `;

  item.addEventListener('click', () => {
    document.getElementById('plate-search-input').value = ev.plate_text;
    trackPlateTrajectory(ev.plate_text);
    if (ev.latitude && ev.longitude) {
      map.setView([ev.latitude, ev.longitude], 14);
    }
  });

  if (feedList.firstChild) {
    feedList.insertBefore(item, feedList.firstChild);
    if (feedList.children.length > 15) {
      feedList.removeChild(feedList.lastChild);
    }
  } else {
    feedList.appendChild(item);
  }
}

/* -------------------------------------------------------------
 * 11. Toast Notification Display System
 * ----------------------------------------------------------- */
function showToast(title, message, severity = 'INFO') {
  const container = document.getElementById('toast-container');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = `toast toast-severity-${severity}`;

  const iconMap = {
    'CRITICAL': '🚨',
    'WARNING': '⚠️',
    'INFO': 'ℹ️'
  };
  const icon = iconMap[severity] || '🔔';

  toast.innerHTML = `
    <div class="toast-icon">${icon}</div>
    <div class="toast-body">
      <div class="toast-title">${escapeHtml(title)}</div>
      <div class="toast-message">${escapeHtml(message)}</div>
    </div>
    <button class="toast-close" type="button">✕</button>
  `;

  const closeBtn = toast.querySelector('.toast-close');
  closeBtn.addEventListener('click', () => {
    toast.classList.add('toast-hiding');
    setTimeout(() => toast.remove(), 300);
  });

  container.appendChild(toast);

  // Auto-dismiss after 6 seconds
  setTimeout(() => {
    if (toast.parentNode) {
      toast.classList.add('toast-hiding');
      setTimeout(() => toast.remove(), 300);
    }
  }, 6000);
}

/* -------------------------------------------------------------
 * 12. Alert Slide-Over & Export Menu Controls
 * ----------------------------------------------------------- */
function initAlertsAndExports() {
  // Export Dropdown
  const exportBtn = document.getElementById('export-toggle-btn');
  const exportMenu = document.getElementById('export-menu');

  if (exportBtn && exportMenu) {
    exportBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      exportMenu.classList.toggle('show');
    });

    document.addEventListener('click', (e) => {
      if (!exportBtn.contains(e.target) && !exportMenu.contains(e.target)) {
        exportMenu.classList.remove('show');
      }
    });
  }

  // Alert Slide-Over
  const alertBell = document.getElementById('main-alert-bell');
  const slideover = document.getElementById('main-alert-slideover');
  const closeSlideover = document.getElementById('main-close-slideover');

  if (alertBell && slideover) {
    alertBell.addEventListener('click', () => {
      slideover.classList.add('open');
      loadSlideoverAlerts();
    });
  }

  if (closeSlideover && slideover) {
    closeSlideover.addEventListener('click', () => {
      slideover.classList.remove('open');
    });
  }

  // Initial alert count badge load
  fetchAlertCount();
}

let activeAlertCount = 0;

async function fetchAlertCount() {
  try {
    const res = await fetch('/api/alerts?acknowledged=false');
    const alerts = await res.json();
    setAlertBadgeCount(alerts.length);
  } catch (e) {
    console.error('Failed to load alert count:', e);
  }
}

function setAlertBadgeCount(count) {
  activeAlertCount = count;
  const badge = document.getElementById('main-alert-badge');
  if (!badge) return;

  badge.innerText = count;
  if (count > 0) {
    badge.classList.add('pulse');
  } else {
    badge.classList.remove('pulse');
  }
}

function incrementAlertBadge() {
  setAlertBadgeCount(activeAlertCount + 1);
}

async function loadSlideoverAlerts() {
  const container = document.getElementById('main-slideover-alerts-list');
  if (!container) return;

  container.innerHTML = '<div style="color:var(--text-dim); text-align:center; padding:20px;">Loading alerts...</div>';

  try {
    const res = await fetch('/api/alerts?limit=25');
    const alerts = await res.json();

    if (alerts.length === 0) {
      container.innerHTML = '<div style="color:var(--text-dim); text-align:center; padding:20px;">No alerts recorded. System normal.</div>';
      return;
    }

    container.innerHTML = '';
    alerts.forEach(alert => {
      container.appendChild(createSlideoverAlertCard(alert));
    });
  } catch (e) {
    container.innerHTML = `<div style="color:#f43f5e; padding:10px;">Failed to load alerts: ${escapeHtml(e.message)}</div>`;
  }
}

function prependSlideoverAlert(alert) {
  const container = document.getElementById('main-slideover-alerts-list');
  if (!container) return;

  const card = createSlideoverAlertCard(alert);
  if (container.firstChild) {
    container.insertBefore(card, container.firstChild);
  } else {
    container.appendChild(card);
  }
}

function createSlideoverAlertCard(alert) {
  const card = document.createElement('div');
  card.className = 'slideover-alert-card';

  const timeStr = alert.timestamp ? new Date(alert.timestamp).toLocaleTimeString() : 'Just now';
  const ackHtml = alert.acknowledged 
    ? `<span style="color:var(--accent-neon-green); font-size:0.7rem; font-weight:700;">✓ Acknowledged</span>`
    : `<button class="slideover-ack-btn" data-id="${alert.id}" type="button">Acknowledge</button>`;

  card.innerHTML = `
    <div class="slideover-alert-top">
      <span class="alert-type-tag ${escapeHtml(alert.severity)}">${escapeHtml(alert.alert_type)}</span>
      <span style="font-size:0.7rem; color:var(--text-dim);">${timeStr}</span>
    </div>
    <div class="slideover-alert-msg">${escapeHtml(alert.message)}</div>
    <div class="slideover-alert-meta">
      <span>Plate: <b>${escapeHtml(alert.plate_text || 'N/A')}</b></span>
      ${ackHtml}
    </div>
  `;

  const ackBtn = card.querySelector('.slideover-ack-btn');
  if (ackBtn) {
    ackBtn.addEventListener('click', async () => {
      try {
        const res = await fetch(`/api/alerts/${alert.id}/acknowledge`, { method: 'POST' });
        if (res.ok) {
          ackBtn.replaceWith(document.createRange().createContextualFragment(
            `<span style="color:var(--accent-neon-green); font-size:0.7rem; font-weight:700;">✓ Acknowledged</span>`
          ));
          if (activeAlertCount > 0) {
            setAlertBadgeCount(activeAlertCount - 1);
          }
        }
      } catch (err) {
        console.error('Failed to acknowledge alert:', err);
      }
    });
  }

  return card;
}

/* -------------------------------------------------------------
 * 13. Navigation Tabs Management
 * ----------------------------------------------------------- */
function initTabs() {
  const tabButtons = document.querySelectorAll('.nav-tabs button[data-tab]');
  const views = {
    'gis-view': document.getElementById('gis-view'),
    'live-anpr-view': document.getElementById('live-anpr-view'),
    'inference-view': document.getElementById('inference-view')
  };

  tabButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      const targetTab = btn.getAttribute('data-tab');
      if (!targetTab) return;

      // Update button active state
      tabButtons.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');

      // Hide all views
      Object.values(views).forEach(v => {
        if (v) {
          v.classList.remove('active');
          v.style.display = 'none';
        }
      });

      // Show selected view
      const activeView = views[targetTab];
      if (activeView) {
        activeView.classList.add('active');
        if (targetTab === 'gis-view') {
          activeView.style.display = 'flex';
          setTimeout(() => { if (map) map.invalidateSize(); }, 200);
        } else {
          activeView.style.display = 'block';
        }

        if (targetTab === 'live-anpr-view') {
          initLiveCctvPipeline();
          loadLiveAnprTable();
        }
      }
    });
  });

  // Camera selector switch
  const camSelect = document.getElementById('cctv-cam-select');
  if (camSelect) {
    camSelect.addEventListener('change', () => {
      const opt = camSelect.options[camSelect.selectedIndex];
      const titleElem = document.getElementById('cctv-cam-title');
      if (titleElem && opt) {
        titleElem.textContent = opt.text.toUpperCase();
      }
    });
  }
}

/* -------------------------------------------------------------
 * 14. Phase 1: Live CCTV Optical Feed & Bounding Box Canvas
 * ----------------------------------------------------------- */
let cctvCanvas = null;
let cctvCtx = null;
let cctvAnimationActive = false;
let currentDetections = [];
let laneOffset = 0;

function initLiveCctvPipeline() {
  cctvCanvas = document.getElementById('live-cctv-canvas');
  if (!cctvCanvas) return;
  cctvCtx = cctvCanvas.getContext('2d');

  if (!cctvAnimationActive) {
    cctvAnimationActive = true;
    requestAnimationFrame(renderCctvFrame);
  }
}

function renderCctvFrame() {
  if (!cctvCanvas || !cctvCtx) return;
  const ctx = cctvCtx;
  const w = cctvCanvas.width;
  const h = cctvCanvas.height;

  // 1. Asphalt Road Background
  ctx.fillStyle = '#0f172a';
  ctx.fillRect(0, 0, w, h);

  // Road Perspective Surface
  ctx.fillStyle = '#1e293b';
  ctx.beginPath();
  ctx.moveTo(w * 0.25, 0);
  ctx.lineTo(w * 0.75, 0);
  ctx.lineTo(w * 0.95, h);
  ctx.lineTo(w * 0.05, h);
  ctx.closePath();
  ctx.fill();

  // Road Shoulders
  ctx.strokeStyle = '#3b82f6';
  ctx.lineWidth = 2;
  ctx.stroke();

  // Lane Dividers (animated motion)
  laneOffset = (laneOffset + 3.5) % 40;
  ctx.strokeStyle = '#f59e0b';
  ctx.lineWidth = 3;
  ctx.setLineDash([20, 20]);
  ctx.lineDashOffset = -laneOffset;

  // Center Dash
  ctx.beginPath();
  ctx.moveTo(w * 0.5, 0);
  ctx.lineTo(w * 0.5, h);
  ctx.stroke();

  // Quarter Dashes
  ctx.setLineDash([15, 25]);
  ctx.beginPath();
  ctx.moveTo(w * 0.38, 0);
  ctx.lineTo(w * 0.28, h);
  ctx.moveTo(w * 0.62, 0);
  ctx.lineTo(w * 0.72, h);
  ctx.stroke();
  ctx.setLineDash([]);

  // Time HUD Overlay Update
  const timeHud = document.getElementById('cctv-time-hud');
  if (timeHud) {
    const now = new Date();
    timeHud.textContent = now.toISOString().replace('T', ' ').substring(0, 19) + ' UTC';
  }

  // 2. Render Active Detections & Bounding Boxes
  const now = Date.now();
  currentDetections = currentDetections.filter(d => now - d.startTime < 4500);

  // If no recent detection, generate a subtle scanning pulse
  if (currentDetections.length === 0) {
    const scanY = (now / 15) % h;
    ctx.strokeStyle = 'rgba(56, 189, 248, 0.4)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(w * 0.1, scanY);
    ctx.lineTo(w * 0.9, scanY);
    ctx.stroke();
  }

  currentDetections.forEach(det => {
    const elapsed = now - det.startTime;
    const progress = Math.min(elapsed / 4000, 1.0);

    // Vehicle Position animates from top to bottom
    const startY = h * 0.2;
    const endY = h * 0.65;
    const currY = startY + (endY - startY) * progress;
    const scale = 0.6 + progress * 0.5;

    const boxW = 200 * scale;
    const boxH = 120 * scale;
    const boxX = (w - boxW) / 2 + (det.laneOffset || 0);

    // Vehicle Body Representation
    ctx.fillStyle = det.vehicleColor || '#334155';
    ctx.beginPath();
    ctx.roundRect(boxX + 20 * scale, currY + 10 * scale, boxW - 40 * scale, boxH - 20 * scale, 10 * scale);
    ctx.fill();

    // Windshield
    ctx.fillStyle = 'rgba(15, 23, 42, 0.9)';
    ctx.beginPath();
    ctx.roundRect(boxX + 35 * scale, currY + 25 * scale, boxW - 70 * scale, 30 * scale, 6 * scale);
    ctx.fill();

    // Vehicle Bounding Box (Vibrant Green)
    ctx.strokeStyle = '#10b981';
    ctx.lineWidth = 2.5;
    ctx.strokeRect(boxX, currY, boxW, boxH);

    // Vehicle Label Tag (Top-Left of Box)
    ctx.fillStyle = '#10b981';
    ctx.fillRect(boxX, currY - 20, 140 * scale, 20);
    ctx.fillStyle = '#0f172a';
    ctx.font = `bold ${Math.round(11 * scale)}px sans-serif`;
    ctx.fillText(`${det.vehicleType || 'Car'}: ${(det.confidence || 0.95) * 100}%`, boxX + 6, currY - 5);

    // License Plate Bounding Box (Gold / Amber)
    const plateW = 90 * scale;
    const plateH = 24 * scale;
    const plateX = boxX + (boxW - plateW) / 2;
    const plateY = currY + boxH - 28 * scale;

    ctx.fillStyle = '#0f172a';
    ctx.fillRect(plateX, plateY, plateW, plateH);
    ctx.strokeStyle = '#f59e0b';
    ctx.lineWidth = 2;
    ctx.strokeRect(plateX, plateY, plateW, plateH);

    // Plate String OCR Label
    ctx.fillStyle = '#f59e0b';
    ctx.font = `bold ${Math.round(11 * scale)}px monospace`;
    ctx.textAlign = 'center';
    ctx.fillText(det.plateText, plateX + plateW / 2, plateY + plateH - 6);
    ctx.textAlign = 'start';
  });

  requestAnimationFrame(renderCctvFrame);
}

function triggerCctvDetection(eventData) {
  const det = {
    startTime: Date.now(),
    plateText: eventData.plate_text,
    vehicleType: eventData.vehicle_type || 'Car',
    confidence: eventData.confidence || 0.95,
    speed: eventData.speed_estimate_kmh || 55.0,
    vehicleColor: eventData.vehicle_color === 'Silver' ? '#94a3b8' : 
                 (eventData.vehicle_color === 'Black' ? '#0f172a' :
                 (eventData.vehicle_color === 'Red' ? '#dc2626' : 
                 (eventData.vehicle_color === 'Blue' ? '#2563eb' : '#cbd5e1'))),
    laneOffset: (Math.random() - 0.5) * 80
  };

  currentDetections.unshift(det);
  if (currentDetections.length > 3) currentDetections.pop();

  // Add to Phase 1 Table
  appendLiveAnprRow(eventData);
}

async function loadLiveAnprTable() {
  try {
    const res = await fetch('/api/events?limit=15');
    if (res.ok) {
      const data = await res.json();
      const events = data.events || data;
      const tbody = document.getElementById('live-anpr-table-body');
      if (tbody) {
        tbody.innerHTML = '';
        events.forEach(e => appendLiveAnprRow(e));
      }
    }
  } catch (err) {
    console.error('Error loading ANPR table:', err);
  }
}

function appendLiveAnprRow(eventData) {
  const tbody = document.getElementById('live-anpr-table-body');
  if (!tbody) return;

  const tr = document.createElement('tr');
  tr.style.borderBottom = '1px solid rgba(148, 163, 184, 0.1)';
  tr.style.transition = 'background 0.2s';

  const timeStr = eventData.timestamp 
    ? new Date(eventData.timestamp).toTimeString().split(' ')[0] 
    : new Date().toTimeString().split(' ')[0];

  const camName = eventData.camera_name || `CAM-${String(eventData.camera_id || 1).padStart(3, '0')}`;
  const confPct = Math.round((eventData.confidence || 0.95) * 100);
  const isFlagged = eventData.plate_text === 'OD02AB1234';

  tr.innerHTML = `
    <td style="padding:8px 10px; font-family:monospace; color:#cbd5e1;">${timeStr}</td>
    <td style="padding:8px 10px; font-weight:700; color:#38bdf8;">${camName}</td>
    <td style="padding:8px 10px; color:#e2e8f0;">${eventData.vehicle_type || 'Car'}</td>
    <td style="padding:8px 10px;">
      <span style="font-family:monospace; font-weight:800; padding:2px 6px; border-radius:4px; ${isFlagged ? 'background:rgba(239,68,68,0.25); color:#fca5a5; border:1px solid #ef4444;' : 'background:rgba(15,23,42,0.8); color:#f59e0b; border:1px solid rgba(245,158,11,0.4);'}">
        ${eventData.plate_text}
      </span>
    </td>
    <td style="padding:8px 10px; font-weight:700; color:#10b981;">${confPct}%</td>
    <td style="padding:8px 10px; color:#94a3b8;">${eventData.speed_estimate_kmh ? eventData.speed_estimate_kmh + ' km/h' : '52 km/h'}</td>
  `;

  if (tbody.firstChild) {
    tbody.insertBefore(tr, tbody.firstChild);
  } else {
    tbody.appendChild(tr);
  }

  // Cap at 25 rows
  while (tbody.children.length > 25) {
    tbody.removeChild(tbody.lastChild);
  }
}

/* -------------------------------------------------------------
 * 15. WebSocket & Real-Time Alert Modal Handling (Phase 6)
 * ----------------------------------------------------------- */
function initWebSocket() {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
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

      if (msg.type === 'detection' && msg.data) {
        // Trigger live CCTV Canvas and Table
        triggerCctvDetection(msg.data);

        // Update HUD Counters
        const totalHud = document.getElementById('hud-total-detections');
        if (totalHud) {
          totalHud.textContent = (parseInt(totalHud.textContent) || 0) + 1;
        }

        // Add to sidebar recent sightings feed
        const feedList = document.getElementById('feed-list');
        if (feedList) {
          const item = createFeedItem(msg.data);
          if (feedList.firstChild) {
            feedList.insertBefore(item, feedList.firstChild);
          } else {
            feedList.appendChild(item);
          }
          if (feedList.children.length > 15) {
            feedList.removeChild(feedList.lastChild);
          }
        }
      } else if (msg.type === 'alert' && msg.data) {
        incrementAlertBadge();
        prependSlideoverAlert(msg.data);

        // Check if critical blacklisted vehicle
        if (msg.data.severity === 'CRITICAL' || msg.data.alert_type === 'FLAGGED_VEHICLE' || (msg.data.plate_text && msg.data.plate_text.toUpperCase() === 'OD02AB1234')) {
          showBlacklistModal(msg.data);
        } else {
          showToast(msg.data.alert_type, msg.data.message, msg.data.severity);
        }
      }
    } catch (e) {}
  };

  ws.onclose = () => {
    setTimeout(initWebSocket, 4000);
  };
}

function showBlacklistModal(alertData) {
  const modal = document.getElementById('blacklist-modal');
  if (!modal) return;

  const plate = alertData.plate_text || 'OD02AB1234';
  document.getElementById('bl-modal-plate').textContent = plate;
  document.getElementById('bl-modal-reason').textContent = alertData.message || 'Suspected Stolen Vehicle / APB #8821';
  document.getElementById('bl-modal-loc').textContent = `Alert Type: ${alertData.alert_type} • Sighted by Smart Surveillance`;

  const trackBtn = document.getElementById('bl-modal-track-btn');
  if (trackBtn) {
    trackBtn.onclick = () => {
      window.location.href = `/vehicles?plate=${encodeURIComponent(plate)}`;
    };
  }

  modal.style.display = 'flex';
  playAlertTone();
}

function closeBlacklistModal() {
  const modal = document.getElementById('blacklist-modal');
  if (modal) modal.style.display = 'none';
}

function playAlertTone() {
  try {
    const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(520, audioCtx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(880, audioCtx.currentTime + 0.4);
    gain.gain.setValueAtTime(0.2, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.6);
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start();
    osc.stop(audioCtx.currentTime + 0.6);
  } catch (e) {}
}


