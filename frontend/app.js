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
let cameraMarkers = {}; // Map of camId -> L.marker
let currentTrajectory = null;
let activeAlertCount = 0;

// Default city center (Bhubaneswar ANPR Surveillance Network)
const CITY_CENTER = [20.3000, 85.8271];
const DEFAULT_ZOOM = 13;

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

  // Real-time Telemetry & Alerts
  initWebSocket();
  initAlertsAndExports();
  
  // Refresh recent feed every 30 seconds as fallback
  setInterval(loadRecentFeed, 30000);
});

/* -------------------------------------------------------------
 * 1. Leaflet GIS Map Initialization
 * ----------------------------------------------------------- */
function initMap() {
  map = L.map('map', {
    zoomControl: false,
    attributionControl: false
  }).setView(CITY_CENTER, DEFAULT_ZOOM);

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
  const resetBtn = document.getElementById('reset-map-btn');
  if (resetBtn) {
    resetBtn.addEventListener('click', () => {
      if (camerasData && camerasData.length > 0) {
        const bounds = L.latLngBounds(camerasData.map(c => [c.latitude, c.longitude]));
        map.fitBounds(bounds, { padding: [40, 40] });
      } else {
        map.setView(CITY_CENTER, DEFAULT_ZOOM);
      }
    });
  }

  // Toggle Traffic Insights Flow Layer button
  const trafficBtn = document.getElementById('toggle-traffic-layer-btn');
  if (trafficBtn) {
    trafficBtn.addEventListener('click', toggleTrafficInsightsLayer);
  }

  // Toggle Fullscreen Map / Collapse Sidebar button
  const sidebarBtn = document.getElementById('toggle-sidebar-btn');
  if (sidebarBtn) {
    sidebarBtn.addEventListener('click', () => {
      const sidebar = document.querySelector('.surveillance-sidebar');
      sidebar.classList.toggle('collapsed');
      const isCollapsed = sidebar.classList.contains('collapsed');
      sidebarBtn.classList.toggle('active', isCollapsed);
      sidebarBtn.innerHTML = isCollapsed ? '<span>⛶</span> Show Dashboard' : '<span>⛶</span> Fullscreen Map';
      setTimeout(() => { if (map) map.invalidateSize(); }, 260);
    });
  }

  // Clear trajectory button
  const clearBtn = document.getElementById('clear-trajectory-btn');
  if (clearBtn) {
    clearBtn.addEventListener('click', clearActiveTrajectory);
  }

  // Summary banner close button
  const summaryCloseBtn = document.getElementById('summary-banner-close');
  if (summaryCloseBtn) {
    summaryCloseBtn.addEventListener('click', clearActiveTrajectory);
  }
}

/* -------------------------------------------------------------
 * 2. Camera Nodes & Layer Loading
 * ----------------------------------------------------------- */
async function loadCameras() {
  try {
    const res = await fetch('/api/cameras');
    if (!res.ok) return;
    camerasData = await res.json();
    
    cameraLayerGroup.clearLayers();
    cameraMarkers = {};

    let activeCount = 0;
    const boundsPoints = [];

    camerasData.forEach(cam => {
      if (cam.status === 'ACTIVE') activeCount++;
      boundsPoints.push([cam.latitude, cam.longitude]);

      const pinIcon = L.divIcon({
        className: 'custom-pin-container',
        html: `<div class="custom-cam-pin" id="cam-pin-${cam.id}" title="${escapeHtml(cam.name)}: ${escapeHtml(cam.location_name)}">📹</div>`,
        iconSize: [32, 32],
        iconAnchor: [16, 16]
      });

      const marker = L.marker([cam.latitude, cam.longitude], { icon: pinIcon });
      cameraMarkers[cam.id] = marker;
      
      const popupContent = `
        <div style="padding: 8px; font-family: var(--font-sans); min-width: 210px;">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;">
            <span style="font-weight: 800; font-size: 0.95rem; color: #fff;">
              ${escapeHtml(cam.name)}
            </span>
            <span style="font-size: 0.7rem; font-weight: 700; color: ${cam.status === 'ACTIVE' ? '#10b981' : '#f59e0b'};">
              ● ${escapeHtml(cam.status)}
            </span>
          </div>
          <div style="font-size: 0.8rem; color: #94a3b8; margin-bottom: 6px;">
            📍 ${escapeHtml(cam.location_name)}
          </div>
          <div style="font-size: 0.75rem; color: #64748b; margin-bottom: 8px;">
            Direction: <span style="color:#cbd5e1;">${escapeHtml(cam.direction || 'North → South')}</span>
          </div>
          <div style="display: flex; justify-content: space-between; align-items: center; background: rgba(255,255,255,0.04); padding: 5px 8px; border-radius: 6px; margin-bottom: 8px;">
            <span style="font-size: 0.75rem; color: #94a3b8;">Total Sightings</span>
            <span style="color: #38bdf8; font-weight: 800; font-family: var(--font-mono); font-size: 0.85rem;">
              ${Number(cam.total_sightings || 0).toLocaleString()}
            </span>
          </div>
          <button onclick="switchCameraFeed(${cam.id})" style="width:100%; background:linear-gradient(135deg, #0284c7, #2563eb); color:#fff; border:none; padding:6px 10px; border-radius:6px; font-size:0.75rem; font-weight:700; cursor:pointer;">
            🎥 View Live CCTV Feed
          </button>
        </div>
      `;

      marker.bindPopup(popupContent);
      cameraLayerGroup.addLayer(marker);
    });

    const badge = document.getElementById('active-cameras-badge');
    if (badge) badge.innerText = `${activeCount} Active Cameras`;

    // Populate CCTV camera dropdown if not already populated
    populateCctvCamDropdown();

    // Auto-fit bounds on initial load
    if (boundsPoints.length > 0) {
      const bounds = L.latLngBounds(boundsPoints);
      map.fitBounds(bounds, { padding: [40, 40] });
    }
  } catch (err) {
    console.error('Failed to load cameras:', err);
  }
}

function triggerCameraRadarPing(camId) {
  const pinElem = document.getElementById(`cam-pin-${camId}`);
  if (pinElem) {
    pinElem.classList.add('radar-ping');
    setTimeout(() => {
      pinElem.classList.remove('radar-ping');
    }, 2800);
  }
}

function switchCameraFeed(camId) {
  const tabBtn = document.getElementById('tab-live-anpr-btn');
  if (tabBtn) tabBtn.click();
  
  const select = document.getElementById('cctv-cam-select');
  if (select) {
    select.value = String(camId);
    select.dispatchEvent(new Event('change'));
  }
}

function populateCctvCamDropdown() {
  const select = document.getElementById('cctv-cam-select');
  if (!select || camerasData.length === 0) return;

  const currentVal = select.value;
  select.innerHTML = '';
  camerasData.forEach(cam => {
    const opt = document.createElement('option');
    opt.value = String(cam.id);
    opt.textContent = `${cam.name} ${cam.location_name} (${cam.direction || 'Bidirectional'})`;
    select.appendChild(opt);
  });

  if (currentVal && select.querySelector(`option[value="${currentVal}"]`)) {
    select.value = currentVal;
  }
}

/* -------------------------------------------------------------
 * 3. Traffic Insights & Congestion Heatmap Layer
 * ----------------------------------------------------------- */
async function toggleTrafficInsightsLayer() {
  const btn = document.getElementById('toggle-traffic-layer-btn');
  const legend = document.getElementById('traffic-legend');
  trafficInsightsActive = !trafficInsightsActive;
  
  if (btn) btn.classList.toggle('active', trafficInsightsActive);
  if (legend) legend.style.display = trafficInsightsActive ? 'flex' : 'none';

  if (!trafficInsightsActive) {
    trafficInsightsLayerGroup.clearLayers();
    return;
  }

  try {
    trafficInsightsLayerGroup.clearLayers();

    // 1. Draw camera traffic volume bubbles with multi-layer density halos
    camerasData.forEach(cam => {
      const count = cam.total_sightings || 0;
      let color = '#10b981'; // Normal (< 10)
      let levelName = 'Normal Flow';
      let haloRadius = 450;
      let coreRadius = 220;

      if (count >= 25) {
        color = '#f43f5e'; // Heavy (> 25)
        levelName = 'Heavy Congestion';
        haloRadius = 950;
        coreRadius = 480;
      } else if (count >= 10) {
        color = '#f59e0b'; // Moderate (10 - 25)
        levelName = 'Moderate Volume';
        haloRadius = 650;
        coreRadius = 340;
      }

      // Outer soft radial heat glow
      const halo = L.circle([cam.latitude, cam.longitude], {
        color: color,
        fillColor: color,
        fillOpacity: 0.18,
        weight: 1,
        dashArray: '4, 4',
        radius: haloRadius
      });
      trafficInsightsLayerGroup.addLayer(halo);

      // Core density pulse circle
      const circle = L.circle([cam.latitude, cam.longitude], {
        color: color,
        fillColor: color,
        fillOpacity: 0.45,
        weight: 2.5,
        radius: coreRadius
      });

      circle.bindTooltip(`
        <div style="font-family:var(--font-sans); font-size:0.8rem; font-weight:700; color:${color};">
          🚦 ${escapeHtml(cam.name)}: <b>${count} Sightings</b> (${levelName})
        </div>
      `, { sticky: true });

      trafficInsightsLayerGroup.addLayer(circle);
    });

    // 2. Fetch and draw top Origin-Destination arterial flow corridors with flow arrows
    const odRes = await fetch('/api/analytics/od-matrix');
    if (odRes.ok) {
      const odData = await odRes.json();
      
      odData.forEach((corridor, i) => {
        const origCam = camerasData.find(c => c.name === corridor.origin_name);
        const destCam = camerasData.find(c => c.name === corridor.destination_name);
        
        if (origCam && destCam) {
          const coords = [
            [origCam.latitude, origCam.longitude],
            [destCam.latitude, destCam.longitude]
          ];

          // Glow corridor line
          const glowLine = L.polyline(coords, {
            color: '#00f2fe',
            weight: 6,
            opacity: 0.35,
            lineCap: 'round'
          });
          trafficInsightsLayerGroup.addLayer(glowLine);

          // Core directional animated flow line
          const flowLine = L.polyline(coords, {
            color: '#38bdf8',
            weight: 3.5,
            opacity: 0.9,
            dashArray: '10, 12'
          });

          flowLine.bindPopup(`
            <div style="font-family:var(--font-sans); padding:6px; min-width:200px;">
              <div style="font-weight:800; color:#38bdf8; margin-bottom:4px; font-size:0.9rem;">
                Top Arterial Travel Corridor #${i + 1}
              </div>
              <div style="font-size:0.85rem; color:#fff; margin-bottom:6px;">
                ${escapeHtml(corridor.origin_location)} ➔ ${escapeHtml(corridor.destination_location)}
              </div>
              <div style="background:rgba(255,255,255,0.05); padding:6px; border-radius:6px; font-size:0.75rem; color:#94a3b8; display:flex; flex-direction:column; gap:2px;">
                <span>Volume: <b style="color:#00f2fe;">${corridor.trips_count} tracked vehicles</b></span>
                <span>Avg Duration: <b style="color:#fff;">${corridor.avg_duration_minutes} mins</b></span>
                <span>Corridor Distance: <b style="color:#fff;">${corridor.avg_distance_km} km</b></span>
              </div>
            </div>
          `);

          trafficInsightsLayerGroup.addLayer(flowLine);

          // Flow Direction Midpoint Marker
          const midLat = (origCam.latitude + destCam.latitude) / 2;
          const midLng = (origCam.longitude + destCam.longitude) / 2;
          const arrowIcon = L.divIcon({
            className: 'flow-arrow-marker',
            html: `<div style="background:#0284c7; color:#fff; border-radius:50%; width:18px; height:18px; display:flex; align-items:center; justify-content:center; font-size:10px; font-weight:800; box-shadow:0 0 8px #0284c7;">➔</div>`,
            iconSize: [18, 18],
            iconAnchor: [9, 9]
          });
          const arrowMarker = L.marker([midLat, midLng], { icon: arrowIcon });
          trafficInsightsLayerGroup.addLayer(arrowMarker);
        }
      });
    }
  } catch (err) {
    console.error('Failed to render traffic insights layer:', err);
  }
}

/* -------------------------------------------------------------
 * 4. Distinct Vehicle Trajectory Retrieval & Rendering
 * ----------------------------------------------------------- */
async function trackPlateTrajectory(plateText) {
  if (!plateText || !plateText.trim()) return;
  const cleanedPlate = plateText.trim().toUpperCase().replace(/[\s\-\.]/g, '');

  try {
    const res = await fetch(`/api/trajectories/search?plate=${encodeURIComponent(cleanedPlate)}`);
    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      const suggestions = errData.detail?.available_suggestions || [];
      const msg = suggestions.length > 0 
        ? `No trajectory found for '${plateText}'. Try sample plates: ${suggestions.slice(0, 3).join(', ')}`
        : `No trajectory sightings found for license plate: ${plateText}`;
      showToast('VEHICLE SEARCH', msg, 'WARNING');
      return;
    }

    const data = await res.json();
    const trajectories = data.trajectories;
    if (!trajectories || trajectories.length === 0) {
      showToast('VEHICLE SEARCH', `No journey checkpoints available for: ${plateText}`, 'WARNING');
      return;
    }

    const traj = trajectories[0];
    currentTrajectory = traj;
    
    // Update input to canonical matched plate
    const searchInput = document.getElementById('plate-search-input');
    if (searchInput) searchInput.value = traj.plate_text;

    renderTrajectoryOnMap(traj);
    renderTrajectorySidebar(traj);
    renderTrajectoryBanner(traj);
    showToast('ROUTE TRACKED', `Depicting route for ${traj.plate_text} across ${traj.total_cameras} cameras (${traj.distance_km} km)`, 'INFO');
  } catch (err) {
    console.error('Error fetching trajectory:', err);
    showToast('SEARCH ERROR', `Could not fetch trajectory for: ${plateText}`, 'CRITICAL');
  }
}

function renderTrajectoryOnMap(traj) {
  trajectoryLayerGroup.clearLayers();
  stopTrajectoryPlayback();

  const coords = traj.path_coordinates || [];
  if (coords.length === 0) return;

  const latLngs = coords.map(c => [c.lat, c.lng]);

  // 1. Dual-Layer Polyline: Soft Glowing Halo + Crisp Dashed Track
  const glowPolyline = L.polyline(latLngs, {
    color: '#00f2fe',
    weight: 9,
    opacity: 0.38,
    lineCap: 'round',
    lineJoin: 'round'
  });
  trajectoryLayerGroup.addLayer(glowPolyline);

  const corePolyline = L.polyline(latLngs, {
    color: '#38bdf8',
    weight: 4.5,
    opacity: 0.95,
    dashArray: '10, 6',
    lineCap: 'round',
    lineJoin: 'round'
  });
  trajectoryLayerGroup.addLayer(corePolyline);

  // 2. Add Directional Flow Chevrons along route segments
  for (let i = 0; i < coords.length - 1; i++) {
    const p1 = coords[i];
    const p2 = coords[i + 1];
    const midLat = (p1.lat + p2.lat) / 2;
    const midLng = (p1.lng + p2.lng) / 2;

    const dLng = p2.lng - p1.lng;
    const dLat = p2.lat - p1.lat;
    const angleDeg = Math.round((Math.atan2(dLng, dLat) * 180) / Math.PI);

    const dirIcon = L.divIcon({
      className: 'traj-dir-arrow',
      html: `<div style="transform: rotate(${angleDeg}deg); color:#00f2fe; font-size:14px; font-weight:900; text-shadow:0 0 6px #00f2fe;">▲</div>`,
      iconSize: [16, 16],
      iconAnchor: [8, 8]
    });
    const dirMarker = L.marker([midLat, midLng], { icon: dirIcon, interactive: false });
    trajectoryLayerGroup.addLayer(dirMarker);
  }

  // 3. Highly Distinguishable Waypoints
  coords.forEach((coord, idx) => {
    const isOrigin = (idx === 0);
    const isDestination = (idx === coords.length - 1);
    const timeStr = coord.timestamp ? new Date(coord.timestamp).toLocaleTimeString() : '--:--';

    let markerIcon;

    if (isOrigin) {
      // DISTINCT START / ORIGIN PIN (Neon Green Beacon)
      markerIcon = L.divIcon({
        className: 'traj-origin-container',
        html: `
          <div class="traj-origin-tag">START / ORIGIN</div>
          <div class="traj-origin-pin">🚩</div>
        `,
        iconSize: [70, 56],
        iconAnchor: [35, 50]
      });
    } else if (isDestination) {
      // DISTINCT END / DESTINATION PIN (Vibrant Ruby Red Beacon)
      markerIcon = L.divIcon({
        className: 'traj-dest-container',
        html: `
          <div class="traj-dest-tag">END / DESTINATION</div>
          <div class="traj-dest-pin">🏁</div>
        `,
        iconSize: [80, 56],
        iconAnchor: [40, 50]
      });
    } else {
      // INTERMEDIATE WAYPOINT (Numbered Cyan Badge)
      markerIcon = L.divIcon({
        className: 'waypoint-pin-container',
        html: `<div class="waypoint-pin">${idx + 1}</div>`,
        iconSize: [24, 24],
        iconAnchor: [12, 12]
      });
    }

    const marker = L.marker([coord.lat, coord.lng], { icon: markerIcon, zIndexOffset: isOrigin || isDestination ? 1000 : 500 });
    
    const popupContent = `
      <div style="font-family: var(--font-sans); padding: 6px; min-width: 190px;">
        <div style="font-size: 0.72rem; font-weight: 800; text-transform: uppercase; color: ${isOrigin ? '#10b981' : (isDestination ? '#f43f5e' : '#38bdf8')}; margin-bottom: 2px;">
          ${isOrigin ? '🟢 ORIGIN CHECKPOINT' : (isDestination ? '🔴 DESTINATION CHECKPOINT' : `WAYPOINT #${idx + 1}`)}
        </div>
        <div style="font-weight: 800; font-size: 0.95rem; color: #fff;">${escapeHtml(coord.name)}</div>
        <div style="font-size: 0.78rem; color: #94a3b8; margin-bottom: 6px;">📍 ${escapeHtml(coord.location)}</div>
        <div style="background: rgba(255,255,255,0.05); padding: 4px 8px; border-radius: 4px; font-size: 0.75rem; display: flex; justify-content: space-between;">
          <span style="color: #cbd5e1;">Time: <b>${escapeHtml(timeStr)}</b></span>
          ${coord.speed_kmh ? `<span style="color: #10b981; font-weight:700;">${coord.speed_kmh} km/h</span>` : ''}
        </div>
      </div>
    `;

    marker.bindPopup(popupContent);
    trajectoryLayerGroup.addLayer(marker);
  });

  // Fit map view to the entire trajectory route with generous padding
  map.fitBounds(corePolyline.getBounds(), { padding: [80, 80], maxZoom: 15 });

  // Update floating playback bar
  const playbackBar = document.getElementById('playback-bar');
  if (playbackBar) {
    playbackBar.classList.add('active');
    document.getElementById('playback-plate-display').innerText = traj.plate_text;
    document.getElementById('playback-step-display').innerText = `${coords.length} checkpoints in route (${traj.distance_km} km | ${traj.avg_speed_kmh} km/h)`;
  }
}

function renderTrajectoryBanner(traj) {
  const banner = document.getElementById('trajectory-summary-banner');
  if (!banner) return;

  const coords = traj.path_coordinates || [];
  const originName = coords.length > 0 ? `${coords[0].name} (${coords[0].location})` : 'CAM-001';
  const destName = coords.length > 1 ? `${coords[coords.length - 1].name} (${coords[coords.length - 1].location})` : originName;

  document.getElementById('summary-banner-plate').innerText = traj.plate_text;
  document.getElementById('summary-banner-origin').innerText = originName;
  document.getElementById('summary-banner-dest').innerText = destName;
  document.getElementById('summary-banner-dist').innerText = `${traj.distance_km} km`;
  document.getElementById('summary-banner-speed').innerText = `${traj.avg_speed_kmh} km/h`;
  document.getElementById('summary-banner-cams').innerText = `${traj.total_cameras} Cams`;

  banner.style.display = 'flex';
}

function renderTrajectorySidebar(traj) {
  const panel = document.getElementById('active-trajectory-panel');
  if (!panel) return;
  panel.classList.add('visible');

  document.getElementById('selected-plate-number').innerText = traj.plate_text;
  document.getElementById('traj-distance').innerText = `${traj.distance_km} km`;
  document.getElementById('traj-speed').innerText = `${traj.avg_speed_kmh} km/h`;
  document.getElementById('traj-cameras').innerText = `${traj.total_cameras} Cams`;

  const timeline = document.getElementById('checkpoint-timeline');
  timeline.innerHTML = '';

  const coords = traj.path_coordinates || [];
  coords.forEach((coord, idx) => {
    const isFirst = (idx === 0);
    const isLast = (idx === coords.length - 1);
    const node = document.createElement('div');
    node.className = 'checkpoint-node';
    const timeStr = coord.timestamp ? new Date(coord.timestamp).toLocaleTimeString() : '--:--';
    
    const tag = isFirst ? '<span style="color:#10b981; font-weight:800;">[ORIGIN]</span> ' : (isLast ? '<span style="color:#f43f5e; font-weight:800;">[DEST]</span> ' : '');

    node.innerHTML = `
      <div class="checkpoint-content">
        <div class="checkpoint-cam">${tag}#${idx + 1} ${escapeHtml(coord.name)} - ${escapeHtml(coord.location)}</div>
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

  const panel = document.getElementById('active-trajectory-panel');
  if (panel) panel.classList.remove('visible');

  const banner = document.getElementById('trajectory-summary-banner');
  if (banner) banner.style.display = 'none';

  const playbackBar = document.getElementById('playback-bar');
  if (playbackBar) playbackBar.classList.remove('active');

  const searchInput = document.getElementById('plate-search-input');
  if (searchInput) searchInput.value = '';

  const quickSelect = document.getElementById('quick-plate-select');
  if (quickSelect) quickSelect.value = '';

  currentTrajectory = null;
}

/* -------------------------------------------------------------
 * 5. Animated Trajectory Simulation Playback
 * ----------------------------------------------------------- */
function playTrajectorySimulation() {
  if (!currentTrajectory || !currentTrajectory.path_coordinates) return;
  const coords = currentTrajectory.path_coordinates;
  if (coords.length < 2) return;

  stopTrajectoryPlayback();

  let step = 0;
  const btn = document.getElementById('playback-toggle-btn');
  if (btn) btn.innerText = '⏸';

  const vehicleIcon = L.divIcon({
    className: 'sim-vehicle-icon',
    html: `<div style="background:#10b981; width:20px; height:20px; border-radius:50%; border:3px solid #fff; box-shadow:0 0 20px #10b981; display:flex; align-items:center; justify-content:center; font-size:10px;">🚗</div>`,
    iconSize: [20, 20],
    iconAnchor: [10, 10]
  });

  playbackMarker = L.marker([coords[0].lat, coords[0].lng], { icon: vehicleIcon, zIndexOffset: 2000 }).addTo(map);

  playbackInterval = setInterval(() => {
    if (step >= coords.length) {
      stopTrajectoryPlayback();
      return;
    }

    const current = coords[step];
    playbackMarker.setLatLng([current.lat, current.lng]);
    const stepDisplay = document.getElementById('playback-step-display');
    if (stepDisplay) {
      stepDisplay.innerText = `Checkpoint ${step + 1}/${coords.length}: ${current.name} (${current.speed_kmh || 50} km/h)`;
    }
    
    step++;
  }, 1100);
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
 * 6. Tracked Plates Dropdown & Search Controls
 * ----------------------------------------------------------- */
async function loadTrackedPlatesDropdown() {
  try {
    const res = await fetch('/api/trajectories/plates?limit=50');
    if (!res.ok) return;
    const plates = await res.json();

    const select = document.getElementById('quick-plate-select');
    const datalist = document.getElementById('tracked-plates-datalist');

    if (select) {
      select.innerHTML = '<option value="">Select Tracked Vehicle...</option>';
      plates.forEach(p => {
        const opt = document.createElement('option');
        opt.value = p.plate_text;
        opt.text = `${p.plate_text} (${p.distance_km} km | ${p.total_cameras} cams)`;
        select.appendChild(opt);
      });
    }

    if (datalist) {
      datalist.innerHTML = '';
      plates.forEach(p => {
        const opt = document.createElement('option');
        opt.value = p.plate_text;
        opt.label = `${p.distance_km} km • ${p.total_cameras} checkpoints`;
        datalist.appendChild(opt);
      });
    }
  } catch (err) {
    console.error('Error loading plates dropdown:', err);
  }
}

function initSearchAndControls() {
  const searchInput = document.getElementById('plate-search-input');
  const searchBtn = document.getElementById('search-btn');
  const quickSelect = document.getElementById('quick-plate-select');

  if (searchBtn && searchInput) {
    searchBtn.addEventListener('click', () => {
      const query = searchInput.value.trim();
      if (query) trackPlateTrajectory(query);
    });

    searchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        const query = searchInput.value.trim();
        if (query) trackPlateTrajectory(query);
      }
    });

    // Dynamic autocomplete suggestion query on input
    let debounceTimer = null;
    searchInput.addEventListener('input', () => {
      clearTimeout(debounceTimer);
      const val = searchInput.value.trim();
      if (val.length >= 2) {
        debounceTimer = setTimeout(async () => {
          try {
            const res = await fetch(`/api/trajectories/suggest?q=${encodeURIComponent(val)}`);
            if (res.ok) {
              const suggestions = await res.json();
              const datalist = document.getElementById('tracked-plates-datalist');
              if (datalist && suggestions.length > 0) {
                datalist.innerHTML = '';
                suggestions.forEach(s => {
                  const opt = document.createElement('option');
                  opt.value = s.plate_text;
                  opt.label = `${s.distance_km} km • ${s.total_cameras} cams`;
                  datalist.appendChild(opt);
                });
              }
            }
          } catch (e) {}
        }, 180);
      }
    });
  }

  if (quickSelect && searchInput) {
    quickSelect.addEventListener('change', () => {
      if (quickSelect.value) {
        searchInput.value = quickSelect.value;
        trackPlateTrajectory(quickSelect.value);
      }
    });
  }

  // Playback buttons
  const playBtn = document.getElementById('playback-toggle-btn');
  if (playBtn) {
    playBtn.addEventListener('click', () => {
      if (playbackInterval) {
        stopTrajectoryPlayback();
      } else {
        playTrajectorySimulation();
      }
    });
  }

  const sidebarPlayBtn = document.getElementById('sidebar-playback-btn');
  if (sidebarPlayBtn) {
    sidebarPlayBtn.addEventListener('click', () => {
      playTrajectorySimulation();
    });
  }

  const closePlaybackBtn = document.getElementById('close-playback-btn');
  if (closePlaybackBtn) {
    closePlaybackBtn.addEventListener('click', () => {
      stopTrajectoryPlayback();
      const pBar = document.getElementById('playback-bar');
      if (pBar) pBar.classList.remove('active');
    });
  }
}

/* -------------------------------------------------------------
 * 7. HUD Metrics & Recent Surveillance Feed
 * ----------------------------------------------------------- */
async function loadHudSummary() {
  try {
    const res = await fetch('/api/analytics/summary');
    if (!res.ok) return;
    const data = await res.json();

    const elTotal = document.getElementById('hud-total-detections');
    const elUnique = document.getElementById('hud-unique-vehicles');
    const elCams = document.getElementById('hud-active-cams');
    const elOcr = document.getElementById('hud-ocr-conf');

    if (elTotal) elTotal.innerText = Number(data.total_detections || 0).toLocaleString();
    if (elUnique) elUnique.innerText = Number(data.unique_vehicles || 0).toLocaleString();
    if (elCams) elCams.innerText = `${data.active_cameras || 0}/${data.total_cameras || 0}`;
    if (elOcr) elOcr.innerText = `${data.avg_ocr_confidence || 94.6}%`;
  } catch (err) {
    console.error('Failed to fetch HUD summary:', err);
  }
}

async function loadRecentFeed() {
  try {
    const res = await fetch('/api/events/recent?limit=15');
    if (!res.ok) return;
    const events = await res.json();
    const feedList = document.getElementById('feed-list');
    if (!feedList) return;

    feedList.innerHTML = '';
    events.forEach(event => {
      feedList.appendChild(createFeedItem(event));
    });
  } catch (err) {
    console.error('Failed to load recent feed:', err);
  }
}

function createFeedItem(event) {
  const item = document.createElement('div');
  item.className = 'feed-item';
  
  const iconMap = {
    'Car': '🚗',
    'Truck': '🚚',
    'Bus': '🚌',
    'Motorcycle': '🏍️'
  };
  const vIcon = iconMap[event.vehicle_type] || '🚘';
  const timeStr = event.timestamp ? new Date(event.timestamp).toLocaleTimeString() : new Date().toLocaleTimeString();

  item.innerHTML = `
    <div class="feed-item-left">
      <div class="vehicle-type-icon">${vIcon}</div>
      <div>
        <div class="feed-plate-text">${escapeHtml(event.plate_text)}</div>
        <div class="feed-cam-name">${escapeHtml(event.camera_name || `CAM-${event.camera_id || '01'}`)} (${escapeHtml(event.vehicle_type || 'Car')})</div>
      </div>
    </div>
    <div class="feed-item-right">
      <div class="feed-time">${escapeHtml(timeStr)}</div>
      <div class="confidence-meter">${Math.round((event.confidence || 0.95) * 100)}% Match</div>
    </div>
  `;

  item.addEventListener('click', () => {
    const searchInput = document.getElementById('plate-search-input');
    if (searchInput) searchInput.value = event.plate_text;
    trackPlateTrajectory(event.plate_text);
    if (event.latitude && event.longitude) {
      map.setView([event.latitude, event.longitude], 14);
    }
  });

  return item;
}

function prependLiveEvent(ev) {
  const feedList = document.getElementById('feed-list');
  if (!feedList) return;

  const item = createFeedItem(ev);
  item.style.animation = 'toast-slide-in 0.3s ease';

  if (feedList.firstChild) {
    feedList.insertBefore(item, feedList.firstChild);
    if (feedList.children.length > 20) {
      feedList.removeChild(feedList.lastChild);
    }
  } else {
    feedList.appendChild(item);
  }
}

/* -------------------------------------------------------------
 * 8. Consolidated Navigation Tabs & View Management
 * ----------------------------------------------------------- */
let volumeChartInstance = null;
let vehicleChartInstance = null;

function initTabs() {
  const tabButtons = document.querySelectorAll('.nav-tabs button[data-tab]');
  const views = {
    'gis-view': document.getElementById('gis-view'),
    'live-anpr-view': document.getElementById('live-anpr-view'),
    'inference-view': document.getElementById('inference-view'),
    'analytics-view': document.getElementById('analytics-view')
  };

  tabButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      const targetTab = btn.getAttribute('data-tab');
      if (!targetTab) return;

      // Update button active state
      tabButtons.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');

      // Hide all view containers
      Object.keys(views).forEach(k => {
        const v = views[k];
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
        } else if (targetTab === 'analytics-view') {
          loadAnalyticsView();
        }
      }
    });
  });

  // Camera selector in Live ANPR view
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

async function loadAnalyticsView() {
  try {
    // 1. Hourly Volume Chart
    const volRes = await fetch('/api/analytics/hourly-volume');
    if (volRes.ok) {
      const volData = await volRes.json();
      const hours = volData.map(v => v.hour);
      const counts = volData.map(v => v.count);

      const ctxVol = document.getElementById('trafficVolumeChart')?.getContext('2d');
      if (ctxVol) {
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
            plugins: { legend: { display: false } },
            scales: {
              x: { grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#94a3b8' } },
              y: { grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#94a3b8' } }
            }
          }
        });
      }
    }

    // 2. Vehicle Category Share
    const vRes = await fetch('/api/analytics/vehicle-types');
    if (vRes.ok) {
      const vData = await vRes.json();
      const vLabels = vData.map(v => v.vehicle_type);
      const vCounts = vData.map(v => v.count);

      const ctxVeh = document.getElementById('vehicleDistributionChart')?.getContext('2d');
      if (ctxVeh) {
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
      }
    }

    // 3. OD Matrix Corridors
    const odRes = await fetch('/api/analytics/od-matrix');
    if (odRes.ok) {
      const odData = await odRes.json();
      const odTableBody = document.querySelector('#od-matrix-table tbody');
      if (odTableBody) {
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
      }
    }

    // 4. Speed Anomalies
    const spRes = await fetch('/api/analytics/speed-anomalies');
    if (spRes.ok) {
      const spData = await spRes.json();
      const spList = document.getElementById('speed-anomalies-list');
      if (spList) {
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
      }
    }
  } catch (err) {
    console.error('Error loading analytics view:', err);
  }
}

/* -------------------------------------------------------------
 * 9. Live CCTV Optical Feed & Bounding Box Canvas (Phase 1)
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
    if (ctx.roundRect) {
      ctx.roundRect(boxX + 20 * scale, currY + 10 * scale, boxW - 40 * scale, boxH - 20 * scale, 10 * scale);
    } else {
      ctx.rect(boxX + 20 * scale, currY + 10 * scale, boxW - 40 * scale, boxH - 20 * scale);
    }
    ctx.fill();

    // Windshield
    ctx.fillStyle = 'rgba(15, 23, 42, 0.9)';
    ctx.beginPath();
    if (ctx.roundRect) {
      ctx.roundRect(boxX + 35 * scale, currY + 25 * scale, boxW - 70 * scale, 30 * scale, 6 * scale);
    } else {
      ctx.rect(boxX + 35 * scale, currY + 25 * scale, boxW - 70 * scale, 30 * scale);
    }
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
    <td style="padding:8px 10px; font-weight:700; color:#38bdf8;">${escapeHtml(camName)}</td>
    <td style="padding:8px 10px; color:#e2e8f0;">${escapeHtml(eventData.vehicle_type || 'Car')}</td>
    <td style="padding:8px 10px;">
      <span style="font-family:monospace; font-weight:800; padding:2px 6px; border-radius:4px; ${isFlagged ? 'background:rgba(239,68,68,0.25); color:#fca5a5; border:1px solid #ef4444;' : 'background:rgba(15,23,42,0.8); color:#f59e0b; border:1px solid rgba(245,158,11,0.4);'}">
        ${escapeHtml(eventData.plate_text)}
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

  while (tbody.children.length > 25) {
    tbody.removeChild(tbody.lastChild);
  }
}

/* -------------------------------------------------------------
 * 10. Real-Time WebSocket Telemetry & Alerts
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
        try { wsConnection.close(); } catch (_) {}
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
  if (!data) return;

  if (type === 'detection' || type === 'event') {
    // 1. Prepend detection to sidebar recent surveillance feed
    prependLiveEvent(data);
    
    // 2. Animate detection on Live CCTV Canvas & ANPR Table
    triggerCctvDetection(data);

    // 3. Trigger visual radar ping on camera marker on the GIS map
    if (data.camera_id) {
      triggerCameraRadarPing(data.camera_id);
    }

    // 4. Increment HUD counter
    const hudDetections = document.getElementById('hud-total-detections');
    if (hudDetections) {
      const cur = parseInt(hudDetections.innerText.replace(/,/g, ''), 10) || 0;
      hudDetections.innerText = (cur + 1).toLocaleString();
    }

    // 5. If this vehicle is currently being tracked, dynamically update the trajectory on the map!
    if (currentTrajectory && data.plate_text && currentTrajectory.plate_text === data.plate_text.toUpperCase()) {
      appendLiveCheckpointToTrajectory(data);
    }
  } else if (type === 'alert') {
    incrementAlertBadge();
    prependSlideoverAlert(data);

    // Critical or blacklisted target detection: only show full-screen modal rarely and quietly
    if (data.severity === 'CRITICAL' || data.alert_type === 'FLAGGED_VEHICLE' || (data.plate_text && data.plate_text.toUpperCase() === 'OD02AB1234')) {
      showBlacklistModal(data);
    } else {
      showToast(data.alert_type || 'SECURITY ALERT', data.message, data.severity || 'WARNING');
    }
  } else if (type === 'camera_status') {
    loadCameras();
  }
}

function appendLiveCheckpointToTrajectory(eventData) {
  if (!currentTrajectory) return;
  const cam = camerasData.find(c => c.id === eventData.camera_id);
  if (!cam) return;

  const coords = currentTrajectory.path_coordinates || [];
  // Avoid duplicate consecutive entry for same camera
  if (coords.length > 0 && coords[coords.length - 1].camera_id === cam.id) return;

  const newCheckpoint = {
    lat: cam.latitude,
    lng: cam.longitude,
    name: cam.name,
    location: cam.location_name,
    camera_id: cam.id,
    timestamp: eventData.timestamp || new Date().toISOString(),
    speed_kmh: eventData.speed_estimate_kmh || 55.0
  };

  coords.push(newCheckpoint);
  currentTrajectory.path_coordinates = coords;
  currentTrajectory.total_cameras = coords.length;

  renderTrajectoryOnMap(currentTrajectory);
  renderTrajectorySidebar(currentTrajectory);
  renderTrajectoryBanner(currentTrajectory);
  showToast('LIVE TRACK SIGHTING', `Vehicle ${currentTrajectory.plate_text} detected at ${cam.name} (${cam.location_name})!`, 'INFO');
}

let lastBlacklistModalTime = 0;
const dismissedBlacklistPlates = new Set();

function showBlacklistModal(alertData) {
  const modal = document.getElementById('blacklist-modal');
  if (!modal) return;

  const plate = (alertData.plate_text || 'OD02AB1234').toUpperCase();
  const now = Date.now();

  // Show modal rarely: throttle to once every 15 minutes and suppress if dismissed/tracked
  if (dismissedBlacklistPlates.has(plate) || (now - lastBlacklistModalTime < 15 * 60 * 1000)) {
    showToast(alertData.alert_type || 'SECURITY ALERT', alertData.message, 'WARNING');
    return;
  }
  lastBlacklistModalTime = now;

  const elPlate = document.getElementById('bl-modal-plate');
  const elReason = document.getElementById('bl-modal-reason');
  const elLoc = document.getElementById('bl-modal-loc');

  if (elPlate) elPlate.textContent = plate;
  if (elReason) elReason.textContent = alertData.message || 'Suspected Stolen Vehicle / APB #8821';
  if (elLoc) elLoc.textContent = `Alert: ${alertData.alert_type} • Camera ${alertData.camera_id || 'CAM-001'}`;

  const trackBtn = document.getElementById('bl-modal-track-btn');
  if (trackBtn) {
    trackBtn.onclick = async () => {
      dismissedBlacklistPlates.add(plate);
      closeBlacklistModal();

      // Ensure GIS tab is active
      const gisTabBtn = document.getElementById('tab-gis-btn');
      if (gisTabBtn) gisTabBtn.click();

      const searchInput = document.getElementById('plate-search-input');
      if (searchInput) searchInput.value = plate;

      await trackPlateTrajectory(plate);
      
      // Visually animate playback simulation right away so the user actively sees the vehicle driving across the route
      setTimeout(() => {
        playTrajectorySimulation();
      }, 400);
    };
  }

  modal.style.display = 'flex';
  playAlertTone();
}

function closeBlacklistModal() {
  const modal = document.getElementById('blacklist-modal');
  if (modal) {
    const plateElem = document.getElementById('bl-modal-plate');
    if (plateElem && plateElem.textContent) {
      dismissedBlacklistPlates.add(plateElem.textContent.trim().toUpperCase());
    }
    modal.style.display = 'none';
  }
}

function playAlertTone() {
  // Sound explicitly disabled per user preference (no audio tone played)
}

/* -------------------------------------------------------------
 * 11. Toast Notifications & Alert Slide-Over
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

function initAlertsAndExports() {
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

  fetchAlertCount();
}

async function fetchAlertCount() {
  try {
    const res = await fetch('/api/alerts?acknowledged=false');
    if (!res.ok) return;
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
    if (!res.ok) return;
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
      <span class="alert-type-tag ${escapeHtml(alert.severity || 'WARNING')}">${escapeHtml(alert.alert_type || 'ALERT')}</span>
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
 * 12. AI Inference Sandbox (Image & Video Mode)
 * ----------------------------------------------------------- */
function initInferenceTester() {
  const modeImgBtn = document.getElementById('mode-image-btn');
  const modeVideoBtn = document.getElementById('mode-video-btn');
  const imgContainer = document.getElementById('image-sandbox-container');
  const videoContainer = document.getElementById('video-sandbox-container');

  if (modeImgBtn && modeVideoBtn && imgContainer && videoContainer) {
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

  const sample1Btn = document.getElementById('run-sample-1-btn');
  if (sample1Btn) {
    sample1Btn.addEventListener('click', () => runSampleInference('test_image_2.jpg'));
  }
  const sample2Btn = document.getElementById('run-sample-2-btn');
  if (sample2Btn) {
    sample2Btn.addEventListener('click', () => runSampleInference('test_image_3.jpg'));
  }

  const videoDropzone = document.getElementById('video-dropzone');
  const videoFileInput = document.getElementById('video-file-input');
  if (videoDropzone && videoFileInput) {
    videoDropzone.addEventListener('click', () => videoFileInput.click());
    videoFileInput.addEventListener('change', (e) => {
      if (e.target.files && e.target.files[0]) {
        handleUploadedVideo(e.target.files[0]);
      }
    });
  }

  const sampleVideoBtn = document.getElementById('run-sample-video-btn');
  if (sampleVideoBtn) {
    sampleVideoBtn.addEventListener('click', runSampleVideoInference);
  }
}

async function handleUploadedFile(file) {
  const previewImg = document.getElementById('preview-image');
  const placeholder = document.getElementById('image-placeholder');
  const resultsContainer = document.getElementById('inference-results-content');
  const statusBadge = document.getElementById('inference-status-badge');

  const reader = new FileReader();
  reader.onload = async (e) => {
    previewImg.src = e.target.result;
    previewImg.style.display = 'block';
    placeholder.style.display = 'none';

    statusBadge.style.display = 'inline-block';
    statusBadge.innerText = 'Analyzing...';
    statusBadge.style.background = 'rgba(56, 189, 248, 0.15)';
    statusBadge.style.color = '#38bdf8';
    resultsContainer.innerHTML = '<div style="color:#38bdf8;">⚡ Running YOLOv8 Detection & OCR Recognition...</div>';

    try {
      const arrayBuffer = await file.arrayBuffer();
      const res = await fetch('/api/inference/upload-image', {
        method: 'POST',
        headers: { 'Content-Type': file.type || 'image/jpeg' },
        body: arrayBuffer
      });
      const data = await res.json();
      displayInferenceResults(data);
    } catch (err) {
      resultsContainer.innerHTML = `<div style="color:#f43f5e;">Inference error: ${escapeHtml(err.message)}</div>`;
      statusBadge.innerText = 'Failed';
      statusBadge.style.background = 'rgba(244, 63, 94, 0.15)';
      statusBadge.style.color = '#f43f5e';
    }
  };
  reader.readAsDataURL(file);
}

async function runSampleInference(filename) {
  const previewImg = document.getElementById('preview-image');
  const placeholder = document.getElementById('image-placeholder');
  const resultsContainer = document.getElementById('inference-results-content');
  const statusBadge = document.getElementById('inference-status-badge');

  previewImg.src = `/data/${filename}`;
  previewImg.style.display = 'block';
  placeholder.style.display = 'none';

  statusBadge.style.display = 'inline-block';
  statusBadge.innerText = 'Analyzing Sample...';
  statusBadge.style.background = 'rgba(56, 189, 248, 0.15)';
  statusBadge.style.color = '#38bdf8';
  resultsContainer.innerHTML = '<div style="color:#38bdf8;">⚙️ Processing sample frame through AI inference pipeline...</div>';

  try {
    const res = await fetch(`/api/inference/run-sample?filename=${encodeURIComponent(filename)}`, { method: 'POST' });
    const data = await res.json();
    displayInferenceResults(data);
  } catch (err) {
    resultsContainer.innerHTML = `<div style="color:#f43f5e;">Sample inference error: ${escapeHtml(err.message)}</div>`;
    statusBadge.innerText = 'Failed';
  }
}

function displayInferenceResults(data) {
  const resultsContainer = document.getElementById('inference-results-content');
  const statusBadge = document.getElementById('inference-status-badge');
  const previewImg = document.getElementById('preview-image');
  const placeholder = document.getElementById('image-placeholder');

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

async function handleUploadedVideo(file) {
  const videoPlayer = document.getElementById('cctv-video-player');
  const placeholder = document.getElementById('video-placeholder');
  const resultsContainer = document.getElementById('video-results-content');
  const statusBadge = document.getElementById('video-status-badge');

  const videoUrl = URL.createObjectURL(file);
  videoPlayer.src = videoUrl;
  videoPlayer.style.display = 'block';
  placeholder.style.display = 'none';

  statusBadge.style.display = 'inline-block';
  statusBadge.innerText = 'Processing Video...';
  statusBadge.style.color = '#38bdf8';
  resultsContainer.innerHTML = '<div style="color:#38bdf8;">🎥 Processing CCTV video through Kalman tracker & temporal majority voting...</div>';

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
    resultsContainer.innerHTML = `<div style="color:#f43f5e;">Video error: ${escapeHtml(err.message)}</div>`;
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
  resultsContainer.innerHTML = '<div style="color:#38bdf8;">⚙️ Processing CCTV sample video test_video.mp4...</div>';

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
  html += `<div style="font-size:0.8rem; color:#94a3b8; margin-bottom:12px;">Processed ${data.total_frames || 90} frames • ${tracked.length} vehicle(s) tracked:</div>`;

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
        const gisTabBtn = document.getElementById('tab-gis-btn');
        if (gisTabBtn) gisTabBtn.click();
        const searchInput = document.getElementById('plate-search-input');
        if (searchInput) searchInput.value = plate;
        trackPlateTrajectory(plate);
      }
    });
  });
}
