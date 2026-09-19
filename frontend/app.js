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
let activeCameraId = 1;

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

  // Check URL parameters for direct tab navigation (e.g. ?tab=live-anpr&cam=3)
  handleUrlRouting();

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
  const mapElem = document.getElementById('map');
  if (!mapElem || typeof L === 'undefined') return;

  if (L.Icon && L.Icon.Default) {
    L.Icon.Default.imagePath = '/static/leaflet/images/';
  }

  map = L.map('map', {
    zoomControl: false,
    attributionControl: false
  }).setView(CITY_CENTER, DEFAULT_ZOOM);

  // High-reliability OpenStreetMap tiles (styled with dark surveillance filter in CSS)
  const osmLayer = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '© OpenStreetMap contributors'
  });

  osmLayer.addTo(map);

  L.control.zoom({ position: 'bottomright' }).addTo(map);

  cameraLayerGroup = L.layerGroup().addTo(map);
  trajectoryLayerGroup = L.layerGroup().addTo(map);
  trafficInsightsLayerGroup = L.layerGroup().addTo(map);

  // Multi-pass size invalidation to guarantee full tile rasterization on all viewports
  [80, 250, 600, 1200].forEach(delay => {
    setTimeout(() => {
      if (map) {
        map.invalidateSize();
        if (camerasData && camerasData.length > 0) {
          const bounds = L.latLngBounds(camerasData.map(c => [c.latitude, c.longitude]));
          map.fitBounds(bounds, { padding: [40, 40] });
        }
      }
    }, delay);
  });

  window.addEventListener('resize', () => {
    if (map) map.invalidateSize();
  });

  // Recenter map button
  const resetBtn = document.getElementById('reset-map-btn');
  if (resetBtn) {
    resetBtn.addEventListener('click', () => {
      if (map) map.invalidateSize();
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
    if (boundsPoints.length > 0 && map) {
      map.invalidateSize();
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
  
  switchActiveCamera(camId);
}

function populateCctvCamDropdown() {
  const select = document.getElementById('cctv-cam-select');
  if (!select || camerasData.length === 0) return;

  const currentVal = String(cctvVideoMode ? (select.value || 'custom-video') : (activeCameraId || select.value || '1'));
  select.innerHTML = '';
  camerasData.forEach(cam => {
    const opt = document.createElement('option');
    opt.value = String(cam.id);
    opt.textContent = `${cam.name} ${cam.location_name} (${cam.direction || 'Bidirectional'})`;
    select.appendChild(opt);
  });

  const customOpt = document.createElement('option');
  customOpt.value = 'custom-video';
  customOpt.textContent = '📹 Custom Uploaded Video Feed';
  select.appendChild(customOpt);

  const sampleOpt = document.createElement('option');
  sampleOpt.value = 'sample-video';
  sampleOpt.textContent = '🎬 Sample CCTV Video (test_video.mp4)';
  select.appendChild(sampleOpt);

  if (select.querySelector(`option[value="${currentVal}"]`)) {
    select.value = currentVal;
  }
  if (!cctvVideoMode) {
    updateCctvHud(activeCameraId);
  }
}

function handleUrlRouting() {
  const urlParams = new URLSearchParams(window.location.search);
  const targetTab = urlParams.get('tab');
  const targetCam = urlParams.get('cam');

  if (targetTab === 'live-anpr' || targetCam) {
    const liveAnprBtn = document.getElementById('tab-live-anpr-btn');
    if (liveAnprBtn) {
      liveAnprBtn.click();
    }
    if (targetCam) {
      const camId = parseInt(targetCam, 10);
      if (!isNaN(camId)) {
        activeCameraId = camId;
        switchActiveCamera(camId);
      }
    }
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
  // Ensure GIS Map tab is active
  const gisTabBtn = document.getElementById('tab-gis-btn');
  if (gisTabBtn && !gisTabBtn.classList.contains('active')) {
    gisTabBtn.click();
  }

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
          [30, 100, 250, 500].forEach(d => {
            setTimeout(() => {
              if (map) {
                map.invalidateSize();
                if (currentTrajectory && currentTrajectory.path_coordinates?.length > 0) {
                  const b = L.latLngBounds(currentTrajectory.path_coordinates.map(c => [c.lat, c.lng]));
                  map.fitBounds(b, { padding: [60, 60], maxZoom: 15 });
                } else if (camerasData && camerasData.length > 0) {
                  const b = L.latLngBounds(camerasData.map(c => [c.latitude, c.longitude]));
                  map.fitBounds(b, { padding: [40, 40] });
                }
              }
            }, d);
          });
        } else {
          activeView.style.display = 'block';
        }

        if (targetTab === 'live-anpr-view') {
          initLiveCctvPipeline();
          updateCctvHud(activeCameraId);
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
      if (camSelect.value === 'sample-video') {
        startCctvVideoFeed('/data/test_video.mp4', 'Sample CCTV Video (test_video.mp4)');
      } else if (camSelect.value === 'custom-video') {
        const fileInput = document.getElementById('cctv-video-file-input');
        if (fileInput) fileInput.click();
      } else {
        const camId = parseInt(camSelect.value, 10);
        if (!isNaN(camId)) {
          stopCctvVideoFeed(false);
          switchActiveCamera(camId);
        }
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
const CAMERA_PROFILES = {
  1: {
    id: 1,
    name: "CAM-001",
    location: "Rasulgarh Junction",
    corridor: "NH-16 Confluence / Flyover Chokepoint",
    direction: "North → South",
    gps: "20.2917° N, 85.8643° E",
    lanes: 3,
    avgSpeed: "21.8 km/h",
    speedFactor: 1.6,
    roadColor: "#111827",
    shoulderColor: "#38bdf8",
    shoulderType: "guardrail",
    markingColor: "#f59e0b",
    ambientTint: "rgba(245, 158, 11, 0.04)",
    perspective: "overhead",
    feature: "flyover-shadow",
    vehicleTypes: ["Truck", "Car", "Auto-Rickshaw", "Car", "Truck", "Motorcycle"]
  },
  2: {
    id: 2,
    name: "CAM-002",
    location: "Vani Vihar Square",
    corridor: "Utkal University Gateway",
    direction: "East → West",
    gps: "20.3018° N, 85.8491° E",
    lanes: 3,
    avgSpeed: "37.3 km/h",
    speedFactor: 3.2,
    roadColor: "#162032",
    shoulderColor: "#22c55e",
    shoulderType: "green-verge",
    markingColor: "#ffffff",
    ambientTint: "rgba(56, 189, 248, 0.05)",
    perspective: "angled-right",
    feature: "double-yellow-center",
    vehicleTypes: ["Car", "Motorcycle", "Car", "Bus", "SUV", "Auto-Rickshaw"]
  },
  3: {
    id: 3,
    name: "CAM-003",
    location: "Acharya Vihar",
    corridor: "Science Park Arterial Link",
    direction: "North → South",
    gps: "20.2982° N, 85.8362° E",
    lanes: 3,
    avgSpeed: "43.6 km/h",
    speedFactor: 3.9,
    roadColor: "#141e2e",
    shoulderColor: "#eab308",
    shoulderType: "curb-striped",
    markingColor: "#ffffff",
    ambientTint: "rgba(255, 255, 255, 0.03)",
    perspective: "straight",
    feature: "center-median-island",
    vehicleTypes: ["Car", "SUV", "Motorcycle", "Car", "SUV"]
  },
  4: {
    id: 4,
    name: "CAM-004",
    location: "Jaydev Vihar",
    corridor: "Commercial Hub Crossroads",
    direction: "East → West",
    gps: "20.3015° N, 85.8239° E",
    lanes: 3,
    avgSpeed: "26.2 km/h",
    speedFactor: 2.1,
    roadColor: "#1a2336",
    shoulderColor: "#ef4444",
    shoulderType: "caution-hazard",
    markingColor: "#f59e0b",
    ambientTint: "rgba(239, 68, 68, 0.04)",
    perspective: "angled-left",
    feature: "intersection-box",
    vehicleTypes: ["Auto-Rickshaw", "Car", "Bus", "Motorcycle", "Truck", "Auto-Rickshaw"]
  },
  5: {
    id: 5,
    name: "CAM-005",
    location: "Khandagiri Square",
    corridor: "National Express Bypass",
    direction: "South → West",
    gps: "20.2586° N, 85.7865° E",
    lanes: 4,
    avgSpeed: "63.4 km/h",
    speedFactor: 5.6,
    roadColor: "#0f172a",
    shoulderColor: "#94a3b8",
    shoulderType: "guardrail",
    markingColor: "#38bdf8",
    ambientTint: "rgba(59, 130, 246, 0.06)",
    perspective: "wide-highway",
    feature: "overhead-gantry",
    vehicleTypes: ["Truck", "Car", "SUV", "Truck", "Car", "SUV"]
  },
  6: {
    id: 6,
    name: "CAM-006",
    location: "Master Canteen Square",
    corridor: "Central Railway Station Downtown Loop",
    direction: "Central Loop",
    gps: "20.2676° N, 85.8427° E",
    lanes: 3,
    avgSpeed: "31.0 km/h",
    speedFactor: 2.6,
    roadColor: "#1f1b2b",
    shoulderColor: "#b45309",
    shoulderType: "brick-sidewalk",
    markingColor: "#ffffff",
    ambientTint: "rgba(251, 146, 60, 0.07)",
    perspective: "roundabout-curve",
    feature: "zebra-crossing",
    vehicleTypes: ["Auto-Rickshaw", "Car", "Motorcycle", "Auto-Rickshaw", "Car", "Motorcycle"]
  },
  7: {
    id: 7,
    name: "CAM-007",
    location: "Kalpana Square",
    corridor: "Old Town Heritage Artery",
    direction: "South → North",
    gps: "20.2562° N, 85.8441° E",
    lanes: 2,
    avgSpeed: "47.1 km/h",
    speedFactor: 4.1,
    roadColor: "#1e1b22",
    shoulderColor: "#a8a29e",
    shoulderType: "curb-striped",
    markingColor: "#facc15",
    ambientTint: "rgba(245, 158, 11, 0.05)",
    perspective: "straight-2lane",
    feature: "heritage-streetlamps",
    vehicleTypes: ["Motorcycle", "Car", "Auto-Rickshaw", "Car", "Motorcycle"]
  },
  8: {
    id: 8,
    name: "CAM-008",
    location: "Chandrasekharpur",
    corridor: "Dual Carriageway Boulevard",
    direction: "South → North",
    gps: "20.3248° N, 85.8172° E",
    lanes: 4,
    avgSpeed: "52.8 km/h",
    speedFactor: 4.7,
    roadColor: "#101a2c",
    shoulderColor: "#10b981",
    shoulderType: "green-verge",
    markingColor: "#ffffff",
    ambientTint: "rgba(6, 182, 212, 0.05)",
    perspective: "dual-carriageway",
    feature: "center-median-island",
    vehicleTypes: ["SUV", "Car", "Motorcycle", "Car", "SUV", "Auto-Rickshaw"]
  },
  9: {
    id: 9,
    name: "CAM-009",
    location: "Patia Square",
    corridor: "Tech Spine Corridor",
    direction: "South → North",
    gps: "20.3547° N, 85.8178° E",
    lanes: 3,
    avgSpeed: "42.1 km/h",
    speedFactor: 3.7,
    roadColor: "#121d30",
    shoulderColor: "#06b6d4",
    shoulderType: "tech-neon-curb",
    markingColor: "#22d3ee",
    ambientTint: "rgba(14, 165, 233, 0.06)",
    perspective: "straight",
    feature: "overhead-gantry",
    vehicleTypes: ["Car", "SUV", "Motorcycle", "Car", "SUV"]
  },
  10: {
    id: 10,
    name: "CAM-010",
    location: "KIIT Square",
    corridor: "University Campus Crossing",
    direction: "West → East",
    gps: "20.3562° N, 85.8190° E",
    lanes: 3,
    avgSpeed: "35.0 km/h",
    speedFactor: 2.9,
    roadColor: "#172033",
    shoulderColor: "#38bdf8",
    shoulderType: "curb-striped",
    markingColor: "#ffffff",
    ambientTint: "rgba(241, 245, 249, 0.06)",
    perspective: "angled-right",
    feature: "zebra-crossing",
    vehicleTypes: ["Motorcycle", "Car", "Auto-Rickshaw", "Motorcycle", "Car", "Auto-Rickshaw"]
  },
  11: {
    id: 11,
    name: "CAM-011",
    location: "Infocity Junction",
    corridor: "Silicon IT Expressway",
    direction: "North → West",
    gps: "20.3585° N, 85.8115° E",
    lanes: 4,
    avgSpeed: "67.4 km/h",
    speedFactor: 6.2,
    roadColor: "#091024",
    shoulderColor: "#38bdf8",
    shoulderType: "guardrail",
    markingColor: "#60a5fa",
    ambientTint: "rgba(56, 189, 248, 0.08)",
    perspective: "wide-highway",
    feature: "overhead-gantry",
    vehicleTypes: ["SUV", "Car", "Truck", "SUV", "Car", "Truck"]
  },
  12: {
    id: 12,
    name: "CAM-012",
    location: "Baramunda Bus Stand",
    corridor: "Interstate Transit Terminal Gateway",
    direction: "West → North",
    gps: "20.2798° N, 85.7925° E",
    lanes: 3,
    avgSpeed: "33.2 km/h",
    speedFactor: 2.8,
    roadColor: "#181d26",
    shoulderColor: "#eab308",
    shoulderType: "curb-striped",
    markingColor: "#facc15",
    ambientTint: "rgba(234, 179, 8, 0.05)",
    perspective: "bus-terminal-bay",
    feature: "dedicated-bus-bay",
    vehicleTypes: ["Bus", "Auto-Rickshaw", "Bus", "Car", "Auto-Rickshaw", "Car"]
  },
  13: {
    id: 13,
    name: "CAM-013",
    location: "Cuttack-Puri Road (Ravi Talkies)",
    corridor: "Heritage Commercial Road",
    direction: "South → East",
    gps: "20.2505° N, 85.8475° E",
    lanes: 2,
    avgSpeed: "24.5 km/h",
    speedFactor: 2.1,
    roadColor: "#1d1916",
    shoulderColor: "#f97316",
    shoulderType: "caution-hazard",
    markingColor: "#fb923c",
    ambientTint: "rgba(249, 115, 22, 0.07)",
    perspective: "straight-2lane",
    feature: "maintenance-hazard-stripes",
    vehicleTypes: ["Auto-Rickshaw", "Motorcycle", "Car", "Auto-Rickshaw", "Motorcycle"]
  }
};

const ODISHA_PLATES_POOL = [
  'OD02AB1234', 'OD33H5678', 'OD05K9912', 'OD07BB9001', 'OD14TK2200',
  'OD02PX7788', 'OD02TR1011', 'OD05MC3311', 'OD10ZZ4040', 'OD14HT9911',
  'OD02CV4455', 'OD05BK8800', 'OD02AZ4421', 'OD33M8823', 'OD02BW9090'
];

const VEHICLE_BODY_COLORS = [
  '#f8fafc', '#0f172a', '#94a3b8', '#dc2626', '#1e40af', '#059669', '#d97706', '#475569'
];

let cctvCanvas = null;
let cctvCtx = null;
let cctvAnimationActive = false;
let laneOffset = 0;
let simulatedVehicles = [];
let camSwitchTransition = {
  active: false,
  startTime: 0,
  duration: 340,
  toCamId: 1
};

// Video Stream Live ANPR State
let cctvVideoMode = false;
let cctvVideoElem = null;
let cctvVideoInferenceActive = false;
let cctvVideoLastInferenceTime = 0;
let cctvControlsConfigured = false;
let offscreenCanvas = null;
let offscreenCtx = null;
let cctvFrameCounter = 0;

/* ═══════════════════════════════════════════════════════════
 *  MULTI-VEHICLE TRACKER WITH TEMPORAL MAJORITY VOTING
 *  ─────────────────────────────────────────────────────────
 *  Tracks vehicles across frames using IoU matching.
 *  Accumulates every plate OCR read per tracked vehicle.
 *  Weights reads by (confidence × plate_area × vehicle_area)
 *  so the CLOSEST frames (biggest bbox = nearest camera)
 *  dominate the vote.
 *  Uses positional-character majority voting to build the
 *  consensus plate text from noisy per-frame OCR results.
 * ═══════════════════════════════════════════════════════════ */
const vehicleTracker = {
  tracks: {},       // trackId -> track object
  nextId: 1,
  reportedPlates: {},  // plateText -> lastReportTime (sidebar dedup)

  reset() {
    this.tracks = {};
    this.nextId = 1;
    this.reportedPlates = {};
    this.latestPlates = [];
  },

  // Intersection-over-Union for two boxes {x1,y1,x2,y2}
  iou(a, b) {
    const ix1 = Math.max(a.x1, b.x1);
    const iy1 = Math.max(a.y1, b.y1);
    const ix2 = Math.min(a.x2, b.x2);
    const iy2 = Math.min(a.y2, b.y2);
    const iw = Math.max(0, ix2 - ix1);
    const ih = Math.max(0, iy2 - iy1);
    const interArea = iw * ih;
    if (interArea === 0) return 0;
    const aArea = (a.x2 - a.x1) * (a.y2 - a.y1);
    const bArea = (b.x2 - b.x1) * (b.y2 - b.y1);
    return interArea / (aArea + bArea - interArea);
  },

  // Box area helper (used as proximity weight — larger = closer to camera)
  boxArea(b) {
    if (!b) return 0;
    return Math.max(0, (b.x2 - b.x1) * (b.y2 - b.y1));
  },

  // Centroid distance helper
  centroidDist(a, b) {
    if (!a || !b) return 9999;
    const acx = (a.x1 + a.x2) / 2, acy = (a.y1 + a.y2) / 2;
    const bcx = (b.x1 + b.x2) / 2, bcy = (b.y1 + b.y2) / 2;
    return Math.sqrt((acx - bcx) ** 2 + (acy - bcy) ** 2);
  },

  /* ─── Per-frame update ───────────────────────────────── */
  update(detectedVehicles, detectedPlates, frameIdx) {
    this.latestPlates = detectedPlates || [];
    const IOU_MATCH_THRESH = 0.08;   // Accommodates fast vehicle shifts between ~400ms inference intervals
    const CENTROID_MATCH_PX = 140;   // Fallback centroid match
    const TRACK_MAX_AGE = 18;        // Keep tracks alive across brief occlusions (~9 seconds)

    // 1. Build association matrix: existing tracks × new detections
    const trackIds = Object.keys(this.tracks);
    const matched = new Set();
    const matchedTracks = new Set();

    const pairs = [];
    for (const tid of trackIds) {
      const t = this.tracks[tid];
      for (let di = 0; di < detectedVehicles.length; di++) {
        const d = detectedVehicles[di];
        const iouScore = this.iou(t.bbox, d);
        const dist = this.centroidDist(t.bbox, d);
        const score = iouScore >= IOU_MATCH_THRESH ? (1.0 + iouScore) :
                      dist < CENTROID_MATCH_PX ? (1.0 - dist / CENTROID_MATCH_PX) : 0;
        if (score > 0) pairs.push({ tid, di, score });
      }
    }
    pairs.sort((a, b) => b.score - a.score);

    for (const p of pairs) {
      if (matchedTracks.has(p.tid) || matched.has(p.di)) continue;
      matchedTracks.add(p.tid);
      matched.add(p.di);

      const track = this.tracks[p.tid];
      const det = detectedVehicles[p.di];
      track.bbox = { x1: det.x1, y1: det.y1, x2: det.x2, y2: det.y2 };
      track.type = det.type || track.type;
      track.color = det.color || track.color;
      track.confidence = det.confidence;
      track.age = 0;
      track.framesSeen++;
      track.lastFrameIdx = frameIdx;
    }

    // 2. Create new tracks for unmatched detections
    for (let di = 0; di < detectedVehicles.length; di++) {
      if (matched.has(di)) continue;
      const det = detectedVehicles[di];
      const area = this.boxArea(det);
      if (area < 64) continue;
      const tid = this.nextId++;
      this.tracks[tid] = {
        id: tid,
        bbox: { ...det },
        type: det.type || 'Car',
        color: det.color || 'Vehicle',
        confidence: det.confidence,
        age: 0,
        framesSeen: 1,
        lastFrameIdx: frameIdx,
        plateReads: [],
        votedPlate: null,
        votedConf: 0,
        votedValid: false,
        reportedToSidebar: false,
        bestPlateBox: null,
        latestPlateText: null,
        latestPlateConf: 0,
        latestPlateValid: false,
        maxVehicleArea: area,
        closestRead: null,
      };
    }

    // 3. Associate all detected plates with tracks (or create synthetic tracks)
    for (const plate of (detectedPlates || [])) {
      const plateBox = { x1: plate.x1, y1: plate.y1, x2: plate.x2, y2: plate.y2 };
      const plateArea = this.boxArea(plateBox);
      const pcx = (plate.x1 + plate.x2) / 2;
      const pcy = (plate.y1 + plate.y2) / 2;

      let bestTid = null;
      let bestScore = 0;

      for (const tid of Object.keys(this.tracks)) {
        const t = this.tracks[tid];
        const inside = pcx >= t.bbox.x1 && pcx <= t.bbox.x2 &&
                       pcy >= t.bbox.y1 && pcy <= t.bbox.y2;
        const iouScore = this.iou(t.bbox, plateBox);
        const dist = this.centroidDist(t.bbox, plateBox);
        const score = inside ? (2.0 + iouScore) :
                      (dist < 150 ? (1.0 - dist / 150) : iouScore);
        if (score > bestScore) {
          bestScore = score;
          bestTid = tid;
        }
      }

      // If no track matched, synthesize a track around this plate so it's always tracked
      if (!bestTid || bestScore < 0.1) {
        const tid = this.nextId++;
        const pw = plate.x2 - plate.x1;
        const ph = plate.y2 - plate.y1;
        const padW = pw * 1.5;
        const padH = ph * 2.5;
        const synthBbox = {
          x1: Math.max(0, plate.x1 - padW),
          y1: Math.max(0, plate.y1 - padH),
          x2: plate.x2 + padW,
          y2: plate.y2 + padH
        };
        this.tracks[tid] = {
          id: tid,
          bbox: synthBbox,
          type: plate.vehicleType || 'Vehicle',
          color: 'Vehicle',
          confidence: 0.90,
          age: 0,
          framesSeen: 1,
          lastFrameIdx: frameIdx,
          plateReads: [],
          votedPlate: null,
          votedConf: 0,
          votedValid: false,
          reportedToSidebar: false,
          bestPlateBox: plateBox,
          latestPlateText: plate.text,
          latestPlateConf: plate.confidence,
          latestPlateValid: plate.isValid,
          maxVehicleArea: this.boxArea(synthBbox),
          closestRead: null,
        };
        bestTid = tid;
      }

      const track = this.tracks[bestTid];
      track.bestPlateBox = plateBox;
      track.latestPlateText = plate.text;
      track.latestPlateConf = plate.confidence;
      track.latestPlateValid = plate.isValid;

      const vehicleArea = this.boxArea(track.bbox);
      // Track nearest-to-camera position (largest vehicle area)
      if (vehicleArea > (track.maxVehicleArea || 0)) {
        track.maxVehicleArea = vehicleArea;
        if (plate.text && plate.text !== 'UNREADABLE' && plate.text !== 'UNKNOWN') {
          track.closestRead = {
            text: plate.text,
            confidence: plate.confidence,
            isValid: plate.isValid,
            vehicleArea: vehicleArea,
            frameIdx: frameIdx
          };
        }
      }

      // Record readable OCR reads for temporal voting
      if (plate.text && plate.text !== 'UNREADABLE' && plate.text !== 'UNKNOWN' && plate.text.length >= 4) {
        track.plateReads.push({
          text: plate.text,
          confidence: plate.confidence,
          isValid: plate.isValid,
          plateArea: plateArea,
          vehicleArea: vehicleArea,
          vehicleType: plate.vehicleType || track.type,
          frameIdx: frameIdx
        });

        if (track.plateReads.length > 30) {
          track.plateReads = track.plateReads.slice(-30);
        }

        this._runTemporalVoting(track);
      }
    }

    // 4. Age out unmatched tracks
    for (const tid of trackIds) {
      if (!matchedTracks.has(tid)) {
        this.tracks[tid].age++;
        if (this.tracks[tid].age > TRACK_MAX_AGE) {
          this._flushTrack(this.tracks[tid]);
          delete this.tracks[tid];
        }
      }
    }
  },

  /* ─── Positional-character temporal majority voting ──── */
  _runTemporalVoting(track) {
    const reads = track.plateReads;
    if (reads.length === 0) return;

    // Single valid/confident read — immediately adopt it
    if (reads.length === 1) {
      const r = reads[0];
      if (r.isValid || r.confidence >= 0.55 || r.text.length >= 6) {
        track.votedPlate = r.text;
        track.votedConf = r.confidence;
        track.votedValid = r.isValid;
        this._reportToSidebar(track);
      }
      return;
    }

    // Multi-frame positional character voting
    const validReads = reads.filter(r => r.text && r.text !== 'UNREADABLE' && r.text.length >= 4);
    if (validReads.length === 0) return;

    // Consensus plate length (mode of lengths)
    const lenCounts = {};
    validReads.forEach(r => {
      const len = r.text.length;
      lenCounts[len] = (lenCounts[len] || 0) + 1;
    });
    let consensusLen = 10, maxLenCount = 0;
    for (const [len, count] of Object.entries(lenCounts)) {
      if (count > maxLenCount) {
        maxLenCount = count;
        consensusLen = parseInt(len, 10);
      }
    }

    const sameLen = validReads.filter(r => Math.abs(r.text.length - consensusLen) <= 1);
    if (sameLen.length === 0) return;

    // Weight: confidence × (1 + proximity_factor) × validity_factor
    // Closeness to camera (vehicleArea) gives higher confidence weight
    const maxArea = 640 * 480;
    const result = [];
    let totalWeight = 0;

    for (let pos = 0; pos < consensusLen; pos++) {
      const charVotes = {};

      for (const read of sameLen) {
        const ch = pos < read.text.length ? read.text[pos] : '';
        if (!ch) continue;

        const areaFactor = Math.sqrt(Math.min(1.0, (read.vehicleArea || 10000) / maxArea));
        const confFactor = read.confidence || 0.8;
        const validBonus = read.isValid ? 1.8 : 1.0;
        const weight = confFactor * (1.0 + areaFactor) * validBonus;

        charVotes[ch] = (charVotes[ch] || 0) + weight;
      }

      let bestChar = '?';
      let bestWeight = 0;
      for (const [ch, wt] of Object.entries(charVotes)) {
        if (wt > bestWeight) {
          bestWeight = wt;
          bestChar = ch;
        }
      }
      result.push(bestChar);
      totalWeight += bestWeight;
    }

    const votedText = result.join('');
    if (votedText && votedText.length >= 4 && !votedText.includes('?')) {
      track.votedPlate = votedText;
      const avgWeight = totalWeight / Math.max(1, consensusLen);
      track.votedConf = Math.min(0.99, avgWeight / Math.max(1, sameLen.length) * 1.5);
      track.votedValid = /^[A-Z]{2}\d{2}[A-Z]{0,3}\d{4}$/.test(votedText) || sameLen.some(r => r.isValid && r.text === votedText);
      this._reportToSidebar(track);
    }
  },

  /* ─── Flush unreported track on deletion ─────────────── */
  _flushTrack(track) {
    if (!track.reportedToSidebar && (track.votedPlate || track.closestRead)) {
      this._reportToSidebar(track);
    }
  },

  /* ─── Sidebar reporting with dedup ───────────────────── */
  _reportToSidebar(track) {
    const textToReport = track.votedPlate || (track.closestRead ? track.closestRead.text : null) || (track.latestPlateText && track.latestPlateText !== 'UNREADABLE' ? track.latestPlateText : null);
    if (!textToReport || textToReport === 'UNREADABLE' || textToReport === 'UNKNOWN' || textToReport.length < 4) return;

    const now = Date.now();
    const lastSeen = this.reportedPlates[textToReport] || 0;
    if (now - lastSeen < 3500) return; // 3.5s dedup window

    this.reportedPlates[textToReport] = now;
    track.reportedToSidebar = true;
    track._lastReportedText = textToReport;

    const speed = Math.floor(Math.random() * 16 + 42);
    const conf = track.votedConf || (track.closestRead ? track.closestRead.confidence : 0.88);

    appendLiveAnprRow({
      timestamp: new Date().toISOString(),
      camera_id: 'OPTICAL',
      camera_name: 'LIVE ANPR STREAM',
      vehicle_type: track.type || 'Car',
      plate_text: textToReport,
      confidence: conf,
      speed_estimate_kmh: speed
    });
  },

  /* ─── Return all currently active tracks for rendering ── */
  getActiveTracks() {
    return Object.values(this.tracks);
  }
};

/* ═══════════════════════════════════════════════════════════ */

function initLiveCctvPipeline() {
  cctvCanvas = document.getElementById('live-cctv-canvas');
  if (!cctvCanvas) return;
  cctvCtx = cctvCanvas.getContext('2d');
  cctvVideoElem = document.getElementById('cctv-stream-video-elem');

  setupCctvVideoControls();

  if (simulatedVehicles.length === 0) {
    initSimulatedVehiclesForCamera(activeCameraId);
  }

  if (!cctvAnimationActive) {
    cctvAnimationActive = true;
    requestAnimationFrame(renderCctvFrame);
  }
}

function setupCctvVideoControls() {
  if (cctvControlsConfigured) return;
  cctvControlsConfigured = true;

  const uploadBtn = document.getElementById('cctv-upload-video-btn');
  const fileInput = document.getElementById('cctv-video-file-input');
  const sampleBtn = document.getElementById('cctv-sample-video-btn');
  const stopBtn = document.getElementById('cctv-stop-video-btn');
  const canvasContainer = document.getElementById('cctv-canvas-container') || cctvCanvas?.parentElement;
  const dropzoneHint = document.getElementById('cctv-dropzone-hint');

  if (uploadBtn && fileInput) {
    uploadBtn.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', (e) => {
      if (e.target.files && e.target.files[0]) {
        const file = e.target.files[0];
        const url = URL.createObjectURL(file);
        startCctvVideoFeed(url, file.name);
      }
    });
  }

  if (sampleBtn) {
    sampleBtn.addEventListener('click', () => {
      startCctvVideoFeed('/data/test_video.mp4', 'Sample Traffic Video (test_video.mp4)');
    });
  }

  if (stopBtn) {
    stopBtn.addEventListener('click', () => {
      stopCctvVideoFeed(true);
    });
  }

  // Drag and Drop support on canvas container
  if (canvasContainer) {
    ['dragenter', 'dragover'].forEach(eventName => {
      canvasContainer.addEventListener(eventName, (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (dropzoneHint) dropzoneHint.style.display = 'flex';
      }, false);
    });

    ['dragleave', 'drop'].forEach(eventName => {
      canvasContainer.addEventListener(eventName, (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (dropzoneHint) dropzoneHint.style.display = 'none';
      }, false);
    });

    canvasContainer.addEventListener('drop', (e) => {
      const dt = e.dataTransfer;
      const files = dt && dt.files;
      if (files && files.length > 0) {
        const file = files[0];
        if (file.type.startsWith('video/') || file.name.match(/\.(mp4|avi|mov|mkv|webm)$/i)) {
          const url = URL.createObjectURL(file);
          startCctvVideoFeed(url, file.name);
        }
      }
    });
  }
}

function startCctvVideoFeed(videoSrc, label = 'Video Feed') {
  if (!cctvVideoElem) {
    cctvVideoElem = document.getElementById('cctv-stream-video-elem');
  }
  if (!cctvVideoElem) return;

  // Ensure live-anpr-view tab is active (do NOT navigate away to Live AI Tester)
  const tabLiveBtn = document.getElementById('tab-live-anpr-btn');
  if (tabLiveBtn && !tabLiveBtn.classList.contains('active')) {
    tabLiveBtn.click();
  }

  cctvVideoMode = true;
  cctvVideoLastInferenceTime = 0;
  cctvFrameCounter = 0;
  vehicleTracker.reset();

  // Dynamically calibrate canvas size to video aspect ratio
  const updateCanvasSize = () => {
    if (cctvVideoElem.videoWidth && cctvVideoElem.videoHeight && cctvCanvas) {
      const asp = cctvVideoElem.videoHeight / cctvVideoElem.videoWidth;
      cctvCanvas.width = 640;
      cctvCanvas.height = Math.max(300, Math.min(500, Math.round(640 * asp)));
    }
  };
  cctvVideoElem.onloadedmetadata = updateCanvasSize;
  cctvVideoElem.onloadeddata = updateCanvasSize;

  cctvVideoElem.src = videoSrc;
  cctvVideoElem.loop = true;
  cctvVideoElem.muted = true;
  cctvVideoElem.playsInline = true;

  const playPromise = cctvVideoElem.play();
  if (playPromise !== undefined) {
    playPromise.then(() => {
      updateCanvasSize();
    }).catch(err => {
      console.warn('Autoplay failed, attempting muted fallback:', err);
      cctvVideoElem.muted = true;
      cctvVideoElem.play().catch(e => console.error('Video play error:', e));
    });
  }

  // Update UI Elements
  const stopBtn = document.getElementById('cctv-stop-video-btn');
  if (stopBtn) stopBtn.style.display = 'inline-flex';

  const statusBadge = document.getElementById('cctv-status-badge');
  if (statusBadge) {
    statusBadge.textContent = '● OPTICAL VIDEO FEED (LIVE)';
    statusBadge.style.color = '#34d399';
  }
  const statusDot = document.getElementById('cctv-status-dot');
  if (statusDot) {
    statusDot.style.background = '#10b981';
    statusDot.style.boxShadow = '0 0 8px #10b981';
  }

  const aiPill = document.getElementById('cctv-ai-processing-pill');
  if (aiPill) aiPill.style.display = 'inline-flex';

  const titleElem = document.getElementById('cctv-cam-title');
  if (titleElem) {
    titleElem.textContent = `OPTICAL STREAM // ${label.toUpperCase()}`;
  }
  const metaElem = document.getElementById('cctv-cam-meta');
  if (metaElem) {
    metaElem.textContent = 'INPUT VIDEO FEED • REAL-TIME YOLOV8 + PADDLEOCR';
  }
  const corridorElem = document.getElementById('cctv-cam-corridor');
  if (corridorElem) {
    corridorElem.textContent = 'ZONE: MULTI-OBJECT OPTICAL RECOGNITION';
  }
  const engineHud = document.getElementById('cctv-engine-hud');
  if (engineHud) {
    engineHud.textContent = 'AI ENGINE: YOLOv8-N + PADDLEOCR • 1080p HD LIVE';
  }

  // Sync dropdown
  const camSelect = document.getElementById('cctv-cam-select');
  if (camSelect) {
    if (videoSrc.includes('test_video.mp4')) {
      camSelect.value = 'sample-video';
    } else {
      const customOpt = camSelect.querySelector('option[value="custom-video"]');
      if (customOpt) customOpt.disabled = false;
      camSelect.value = 'custom-video';
    }
  }

  console.log(`🎥 Live ANPR Video stream started: ${label}`);
}

function stopCctvVideoFeed(reInitSim = true) {
  cctvVideoMode = false;
  if (cctvVideoElem) {
    cctvVideoElem.pause();
    cctvVideoElem.removeAttribute('src');
    cctvVideoElem.load();
  }

  vehicleTracker.reset();

  const stopBtn = document.getElementById('cctv-stop-video-btn');
  if (stopBtn) stopBtn.style.display = 'none';

  const statusBadge = document.getElementById('cctv-status-badge');
  if (statusBadge) {
    statusBadge.textContent = '● LIVE CCTV REC';
    statusBadge.style.color = '#f87171';
  }
  const statusDot = document.getElementById('cctv-status-dot');
  if (statusDot) {
    statusDot.style.background = '#ef4444';
    statusDot.style.boxShadow = '0 0 8px #ef4444';
  }

  const aiPill = document.getElementById('cctv-ai-processing-pill');
  if (aiPill) aiPill.style.display = 'none';

  if (reInitSim) {
    switchActiveCamera(activeCameraId || 1);
  }
}

async function runVideoFrameInference(videoElem) {
  if (cctvVideoInferenceActive || !cctvVideoMode) return;
  if (!videoElem || !videoElem.videoWidth || !videoElem.videoHeight) return;

  cctvVideoInferenceActive = true;
  cctvVideoLastInferenceTime = Date.now();
  cctvFrameCounter++;

  try {
    if (!offscreenCanvas) {
      offscreenCanvas = document.createElement('canvas');
      offscreenCtx = offscreenCanvas.getContext('2d');
    }

    const targetW = 640;
    const targetH = Math.round(videoElem.videoHeight * (640 / videoElem.videoWidth)) || 480;
    if (offscreenCanvas.width !== targetW || offscreenCanvas.height !== targetH) {
      offscreenCanvas.width = targetW;
      offscreenCanvas.height = targetH;
    }

    offscreenCtx.drawImage(videoElem, 0, 0, targetW, targetH);
    const b64 = offscreenCanvas.toDataURL('image/jpeg', 0.82);

    const res = await fetch('/api/inference/upload-base64', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        image_base64: b64,
        filename: 'cctv_live_frame.jpg'
      })
    });

    if (res.ok) {
      const data = await res.json();
      handleVideoInferenceResponse(data, targetW, targetH);
    }
  } catch (err) {
    console.warn('Live CCTV frame inference error:', err);
  } finally {
    cctvVideoInferenceActive = false;
  }
}

function handleVideoInferenceResponse(data, frameW, frameH) {
  if (!cctvVideoMode || !cctvCanvas) return;

  const canvasW = cctvCanvas.width;
  const canvasH = cctvCanvas.height;
  const scaleX = canvasW / frameW;
  const scaleY = canvasH / frameH;

  const rawVehicles = data.vehicles || [];
  const rawResults = data.results || [];

  console.log(`[ANPR F#${cctvFrameCounter}] Backend: ${rawVehicles.length} vehicles, ${rawResults.length} plates`);

  const mappedVehicles = rawVehicles.map(v => {
    const bbox = v.bbox || [0, 0, 0, 0];
    return {
      x1: bbox[0] * scaleX,
      y1: bbox[1] * scaleY,
      x2: bbox[2] * scaleX,
      y2: bbox[3] * scaleY,
      type: v.vehicle_type || 'Vehicle',
      color: v.vehicle_color || 'Vehicle',
      confidence: v.confidence || 0.9
    };
  });

  const mappedPlates = rawResults.map(p => {
    const bbox = p.plate_bbox || p.bbox || [0, 0, 0, 0];
    const vbox = p.vehicle_bbox || [0, 0, canvasW, canvasH];
    return {
      x1: bbox[0] * scaleX,
      y1: bbox[1] * scaleY,
      x2: bbox[2] * scaleX,
      y2: bbox[3] * scaleY,
      vx1: vbox[0] * scaleX,
      vy1: vbox[1] * scaleY,
      vx2: vbox[2] * scaleX,
      vy2: vbox[3] * scaleY,
      text: p.text || 'UNKNOWN',
      confidence: p.confidence || 0.88,
      isValid: p.is_valid,
      vehicleType: p.vehicle_type || 'Vehicle',
      rto: p.rto_details || {}
    };
  });

  // Feed everything into the multi-vehicle tracker
  vehicleTracker.update(mappedVehicles, mappedPlates, cctvFrameCounter);

  // Update tracker stats display
  const fpsCounter = document.getElementById('cctv-fps-counter');
  if (fpsCounter) {
    const allTracks = vehicleTracker.getActiveTracks();
    const withPlates = allTracks.filter(t => t.votedPlate).length;
    fpsCounter.textContent = `${allTracks.length} tracked • ${withPlates} identified • F#${cctvFrameCounter}`;
  }

  // Debug: log active tracks
  const activeTracks = vehicleTracker.getActiveTracks();
  if (activeTracks.length > 0) {
    console.log(`[ANPR] Active tracks: ${activeTracks.length}`, activeTracks.map(t => ({
      id: t.id, bbox: t.bbox, area: Math.round((t.bbox.x2-t.bbox.x1)*(t.bbox.y2-t.bbox.y1)),
      reads: t.plateReads.length, voted: t.votedPlate
    })));
  }
}

function renderVideoDetectionsOverlay(ctx, w, h) {
  const allTracks = vehicleTracker.getActiveTracks();
  const hasLatestPlates = vehicleTracker.latestPlates && vehicleTracker.latestPlates.length > 0;
  if (allTracks.length === 0 && !hasLatestPlates) return;

  // Sort by vehicle bbox area DESCENDING (largest = closest to camera)
  const sorted = allTracks
    .map(t => ({ track: t, area: (t.bbox.x2 - t.bbox.x1) * (t.bbox.y2 - t.bbox.y1) }))
    .sort((a, b) => b.area - a.area)
    .slice(0, 10);

  const renderedPlateKeys = new Set();

  for (let i = 0; i < sorted.length; i++) {
    const { track } = sorted[i];
    const b = track.bbox;
    const bw = b.x2 - b.x1;
    const bh = b.y2 - b.y1;
    if (bw < 8 || bh < 8) continue;

    ctx.save();

    // ─── 1. Vehicle Bounding Box (Cyan Tactical HUD) ───
    ctx.strokeStyle = 'rgba(0, 242, 254, 0.85)';
    ctx.lineWidth = 2;
    ctx.strokeRect(b.x1, b.y1, bw, bh);

    // Corner tracking brackets
    const cLen = Math.min(18, bw * 0.2, bh * 0.2);
    ctx.strokeStyle = '#38bdf8';
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(b.x1, b.y1 + cLen); ctx.lineTo(b.x1, b.y1); ctx.lineTo(b.x1 + cLen, b.y1); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(b.x2 - cLen, b.y1); ctx.lineTo(b.x2, b.y1); ctx.lineTo(b.x2, b.y1 + cLen); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(b.x1, b.y2 - cLen); ctx.lineTo(b.x1, b.y2); ctx.lineTo(b.x1 + cLen, b.y2); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(b.x2 - cLen, b.y2); ctx.lineTo(b.x2, b.y2); ctx.lineTo(b.x2, b.y2 - cLen); ctx.stroke();

    // ─── 2. Compact Vehicle Label (#ID + Type + NEAREST) ───
    const vType = track.type || 'Vehicle';
    const isNearest = i === 0 && sorted.length > 1;
    const labelText = `[#${track.id}] ${vType}${isNearest ? ' ★ NEAREST' : ''}`;
    ctx.font = 'bold 10px monospace';
    const labelW = ctx.measureText(labelText).width + 10;
    const labelH = 15;
    const labelY = Math.max(labelH + 2, b.y1);

    ctx.fillStyle = isNearest ? 'rgba(16, 185, 129, 0.92)' : 'rgba(15, 23, 42, 0.88)';
    ctx.fillRect(b.x1, labelY - labelH, labelW, labelH);
    ctx.fillStyle = isNearest ? '#ffffff' : '#38bdf8';
    ctx.fillText(labelText, b.x1 + 5, labelY - 4);

    // ─── 3. License Plate Bounding Box (Always drawn if plate localized) ───
    const p = track.bestPlateBox;
    if (p) {
      const pw = p.x2 - p.x1;
      const ph = p.y2 - p.y1;
      if (pw > 6 && ph > 4) {
        renderedPlateKeys.add(`${Math.round(p.x1)},${Math.round(p.y1)}`);
        const hasVoted = track.votedPlate && track.votedPlate !== 'UNREADABLE';
        const hasRead = track.latestPlateText && track.latestPlateText !== 'UNREADABLE';

        const isGood = hasVoted ? track.votedValid : (hasRead ? track.latestPlateValid : false);
        const boxColor = isGood ? '#10b981' : (hasVoted || hasRead ? '#f59e0b' : '#38bdf8');
        const textColor = isGood ? '#34d399' : (hasVoted || hasRead ? '#fbbf24' : '#7dd3fc');

        // Draw Plate Bounding Box with neon glow
        ctx.shadowColor = boxColor;
        ctx.shadowBlur = 6;
        ctx.strokeStyle = boxColor;
        ctx.lineWidth = 2.5;
        ctx.strokeRect(p.x1, p.y1, pw, ph);
        ctx.shadowBlur = 0;

        // Plate Tag text
        let tagStr = '';
        if (hasVoted) {
          const conf = Math.round((track.votedConf || 0.9) * 100);
          tagStr = `${track.votedPlate} [${conf}%]`;
        } else if (hasRead) {
          const conf = Math.round((track.latestPlateConf || 0.85) * 100);
          tagStr = `${track.latestPlateText} [${conf}%]`;
        } else {
          tagStr = 'SCANNING PLATE...';
        }

        ctx.font = 'bold 10px monospace';
        const tWidth = ctx.measureText(tagStr).width;
        const indW = 18;
        const tagW = tWidth + indW + 12;
        const tagH = 17;

        let tagY = p.y2 + 2;
        if (tagY + tagH > h - 4) tagY = Math.max(2, p.y1 - tagH - 2);

        ctx.fillStyle = 'rgba(15, 23, 42, 0.95)';
        ctx.fillRect(p.x1, tagY, tagW, tagH);
        ctx.strokeStyle = boxColor;
        ctx.lineWidth = 1;
        ctx.strokeRect(p.x1, tagY, tagW, tagH);

        // IND flag
        ctx.fillStyle = '#1e3a8a';
        ctx.fillRect(p.x1, tagY, indW, tagH);
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 7px sans-serif';
        ctx.fillText('IND', p.x1 + 2, tagY + 11);

        ctx.fillStyle = textColor;
        ctx.font = 'bold 10px monospace';
        ctx.fillText(tagStr, p.x1 + indW + 4, tagY + 12);
      }
    }

    ctx.restore();
  }

  // ─── 4. Render Standalone Detected Plates ───
  if (vehicleTracker.latestPlates && vehicleTracker.latestPlates.length > 0) {
    for (const p of vehicleTracker.latestPlates) {
      const key = `${Math.round(p.x1)},${Math.round(p.y1)}`;
      if (renderedPlateKeys.has(key)) continue;
      const pw = p.x2 - p.x1;
      const ph = p.y2 - p.y1;
      if (pw < 6 || ph < 4) continue;

      ctx.save();
      ctx.strokeStyle = '#10b981';
      ctx.lineWidth = 2.5;
      ctx.strokeRect(p.x1, p.y1, pw, ph);

      const pText = (p.text && p.text !== 'UNREADABLE' && p.text !== 'UNKNOWN') ? p.text : 'PLATE';
      ctx.fillStyle = 'rgba(15, 23, 42, 0.92)';
      ctx.font = 'bold 10px monospace';
      const tw = ctx.measureText(pText).width;
      ctx.fillRect(p.x1, Math.max(0, p.y1 - 16), tw + 10, 16);
      ctx.strokeStyle = '#10b981';
      ctx.strokeRect(p.x1, Math.max(0, p.y1 - 16), tw + 10, 16);
      ctx.fillStyle = '#34d399';
      ctx.fillText(pText, p.x1 + 5, Math.max(12, p.y1 - 4));
      ctx.restore();
    }
  }
}

function switchActiveCamera(camId) {
  if (cctvVideoMode) {
    stopCctvVideoFeed(false);
  }
  const targetId = parseInt(camId, 10) || 1;
  activeCameraId = targetId;

  // Sync dropdown if needed
  const select = document.getElementById('cctv-cam-select');
  if (select && select.value !== String(targetId)) {
    select.value = String(targetId);
  }

  // Trigger smooth CCTV switcher glitch transition
  camSwitchTransition.active = true;
  camSwitchTransition.startTime = Date.now();
  camSwitchTransition.toCamId = targetId;

  // Re-seed simulated traffic for the new camera's characteristics
  initSimulatedVehiclesForCamera(targetId);

  // Update HUD text elements
  updateCctvHud(targetId);
}

function updateCctvHud(camId) {
  const profile = CAMERA_PROFILES[camId] || CAMERA_PROFILES[1];
  
  const titleElem = document.getElementById('cctv-cam-title');
  if (titleElem) {
    titleElem.textContent = `${profile.name} // ${profile.location.toUpperCase()}`;
  }

  const metaElem = document.getElementById('cctv-cam-meta');
  if (metaElem) {
    metaElem.textContent = `DIR: ${profile.direction.toUpperCase()} • GPS: ${profile.gps}`;
  }

  const corridorElem = document.getElementById('cctv-cam-corridor');
  if (corridorElem) {
    corridorElem.textContent = `ZONE: ${profile.corridor.toUpperCase()} • FLOW: ${profile.avgSpeed}`;
  }
}

function initSimulatedVehiclesForCamera(camId) {
  const profile = CAMERA_PROFILES[camId] || CAMERA_PROFILES[1];
  const lanes = profile.lanes || 3;
  simulatedVehicles = [];

  // Generate 3 staggered vehicles on screen
  const initialProgress = [0.18, 0.52, 0.86];
  initialProgress.forEach((p, idx) => {
    const lane = idx % lanes;
    const vType = profile.vehicleTypes[idx % profile.vehicleTypes.length] || 'Car';
    const isCommercial = vType === 'Auto-Rickshaw' || vType === 'Truck' || vType === 'Bus';
    const plate = ODISHA_PLATES_POOL[(camId * 3 + idx) % ODISHA_PLATES_POOL.length];
    const color = isCommercial && vType === 'Auto-Rickshaw' 
      ? '#15803d' 
      : VEHICLE_BODY_COLORS[(camId + idx * 2) % VEHICLE_BODY_COLORS.length];

    simulatedVehicles.push({
      progress: p,
      lane: lane,
      type: vType,
      color: color,
      plateText: plate,
      speed: Math.round(parseFloat(profile.avgSpeed) + (Math.random() * 8 - 4)),
      confidence: 0.94 + Math.random() * 0.05,
      isCommercial: isCommercial
    });
  });
}

function renderCctvFrame() {
  if (!cctvCanvas || !cctvCtx) return;
  const ctx = cctvCtx;
  const w = cctvCanvas.width;
  const h = cctvCanvas.height;

  // If running in live video feed mode, draw video frames and AI detection overlays
  if (cctvVideoMode) {
    if (cctvVideoElem && cctvVideoElem.readyState >= 2) {
      ctx.drawImage(cctvVideoElem, 0, 0, w, h);

      const now = Date.now();
      if (!cctvVideoInferenceActive && (now - cctvVideoLastInferenceTime > 300)) {
        runVideoFrameInference(cctvVideoElem);
      }

      renderVideoDetectionsOverlay(ctx, w, h);

      ctx.fillStyle = 'rgba(2, 6, 23, 0.04)';
      ctx.fillRect(0, 0, w, h);
    } else {
      // Sleek optical feed connecting banner
      ctx.fillStyle = '#020617';
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = '#38bdf8';
      ctx.font = 'bold 13px monospace';
      ctx.textAlign = 'center';
      ctx.fillText('OPTICAL VIDEO FEED CONNECTING...', w / 2, h / 2 - 8);
      ctx.fillStyle = '#94a3b8';
      ctx.font = '10px monospace';
      ctx.fillText('Synchronizing frame decoder & AI models...', w / 2, h / 2 + 14);
      ctx.textAlign = 'start';
    }

    const timeHud = document.getElementById('cctv-time-hud');
    if (timeHud) {
      const d = new Date();
      timeHud.textContent = d.toISOString().replace('T', ' ').substring(0, 19) + ' UTC';
    }

    requestAnimationFrame(renderCctvFrame);
    return;
  }

  const profile = CAMERA_PROFILES[activeCameraId] || CAMERA_PROFILES[1];

  // 1. Scene Background (Dark Surveillance Field)
  ctx.fillStyle = '#020617';
  ctx.fillRect(0, 0, w, h);

  // Horizon & Perspective Boundaries
  const topY = h * 0.14;
  const botY = h * 1.0;
  let topL, topR, botL, botR;

  if (profile.perspective === 'wide-highway') {
    topL = w * 0.18; topR = w * 0.82;
    botL = w * 0.02; botR = w * 0.98;
  } else if (profile.perspective === 'straight-2lane') {
    topL = w * 0.32; topR = w * 0.68;
    botL = w * 0.12; botR = w * 0.88;
  } else if (profile.perspective === 'angled-right') {
    topL = w * 0.28; topR = w * 0.78;
    botL = w * 0.08; botR = w * 0.98;
  } else if (profile.perspective === 'angled-left') {
    topL = w * 0.22; topR = w * 0.72;
    botL = w * 0.02; botR = w * 0.92;
  } else if (profile.perspective === 'roundabout-curve') {
    topL = w * 0.26; topR = w * 0.76;
    botL = w * 0.04; botR = w * 0.96;
  } else {
    topL = w * 0.25; topR = w * 0.75;
    botL = w * 0.05; botR = w * 0.95;
  }

  // 2. Road Surface Polygon
  ctx.fillStyle = profile.roadColor || '#111827';
  ctx.beginPath();
  ctx.moveTo(topL, topY);
  ctx.lineTo(topR, topY);
  ctx.lineTo(botR, botY);
  ctx.lineTo(botL, botY);
  ctx.closePath();
  ctx.fill();

  // 3. Road Shoulders / Curbs / Barriers
  if (profile.shoulderType === 'guardrail') {
    // Left Barrier
    ctx.strokeStyle = profile.shoulderColor || '#94a3b8';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(topL, topY);
    ctx.lineTo(botL, botY);
    ctx.stroke();
    // Right Barrier
    ctx.beginPath();
    ctx.moveTo(topR, topY);
    ctx.lineTo(botR, botY);
    ctx.stroke();
  } else if (profile.shoulderType === 'green-verge') {
    // Left Green Verge
    ctx.fillStyle = '#14532d';
    ctx.beginPath();
    ctx.moveTo(0, topY);
    ctx.lineTo(topL, topY);
    ctx.lineTo(botL, botY);
    ctx.lineTo(0, botY);
    ctx.closePath();
    ctx.fill();
    // Right Green Verge
    ctx.beginPath();
    ctx.moveTo(topR, topY);
    ctx.lineTo(w, topY);
    ctx.lineTo(w, botY);
    ctx.lineTo(botR, botY);
    ctx.closePath();
    ctx.fill();
    // Edge curb line
    ctx.strokeStyle = '#22c55e';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(topL, topY); ctx.lineTo(botL, botY);
    ctx.moveTo(topR, topY); ctx.lineTo(botR, botY);
    ctx.stroke();
  } else if (profile.shoulderType === 'brick-sidewalk') {
    // Red-brick sidewalk
    ctx.fillStyle = '#78350f';
    ctx.fillRect(0, topY, topL, botY - topY);
    ctx.fillRect(topR, topY, w - topR, botY - topY);
    ctx.strokeStyle = '#f59e0b';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(topL, topY); ctx.lineTo(botL, botY);
    ctx.moveTo(topR, topY); ctx.lineTo(botR, botY);
    ctx.stroke();
  } else if (profile.shoulderType === 'caution-hazard') {
    // Diagonal hazard stripes along shoulders
    ctx.strokeStyle = '#ef4444';
    ctx.lineWidth = 5;
    ctx.setLineDash([12, 12]);
    ctx.beginPath();
    ctx.moveTo(topL, topY); ctx.lineTo(botL, botY);
    ctx.moveTo(topR, topY); ctx.lineTo(botR, botY);
    ctx.stroke();
    ctx.setLineDash([]);
  } else {
    // Standard striped curb
    ctx.strokeStyle = profile.shoulderColor || '#eab308';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(topL, topY); ctx.lineTo(botL, botY);
    ctx.moveTo(topR, topY); ctx.lineTo(botR, botY);
    ctx.stroke();
  }

  // 4. Distinct Location Road Features
  if (profile.feature === 'zebra-crossing') {
    // Bold white pedestrian crosswalk zebra bars across road
    const zebraY = h * 0.72;
    const zebraH = 26;
    const pZ = (zebraY - topY) / (botY - topY);
    const zL = topL + (botL - topL) * pZ;
    const zR = topR + (botR - topR) * pZ;
    const barCount = 10;
    const step = (zR - zL) / barCount;
    ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
    for (let i = 0; i < barCount; i += 2) {
      ctx.fillRect(zL + i * step, zebraY, step * 0.9, zebraH);
    }
  } else if (profile.feature === 'center-median-island') {
    // Raised green divider strip down the center
    const medTopW = 12;
    const medBotW = 28;
    const medCenterX_top = (topL + topR) / 2;
    const medCenterX_bot = (botL + botR) / 2;
    ctx.fillStyle = '#166534';
    ctx.beginPath();
    ctx.moveTo(medCenterX_top - medTopW / 2, topY);
    ctx.lineTo(medCenterX_top + medTopW / 2, topY);
    ctx.lineTo(medCenterX_bot + medBotW / 2, botY);
    ctx.lineTo(medCenterX_bot - medBotW / 2, botY);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = '#e2e8f0';
    ctx.lineWidth = 2;
    ctx.stroke();
  } else if (profile.feature === 'dedicated-bus-bay') {
    // Yellow hatched Bus transit lane marking on Lane 0
    const p0 = 0.5;
    const l0 = topL + (botL - topL) * p0;
    const r0 = l0 + ((topR + (botR - topR) * p0) - l0) / profile.lanes;
    ctx.strokeStyle = '#eab308';
    ctx.lineWidth = 2.5;
    ctx.setLineDash([10, 10]);
    ctx.beginPath();
    ctx.moveTo(topL + (topR - topL) / profile.lanes, topY);
    ctx.lineTo(botL + (botR - botL) / profile.lanes, botY);
    ctx.stroke();
    ctx.setLineDash([]);
    // Text on road surface
    ctx.save();
    ctx.fillStyle = '#eab308';
    ctx.font = 'bold 12px monospace';
    ctx.fillText('BUS TRANSIT ONLY', botL + 15, botY - 20);
    ctx.restore();
  } else if (profile.feature === 'double-yellow-center') {
    // Double solid yellow center divider
    const cTop = (topL + topR) / 2;
    const cBot = (botL + botR) / 2;
    ctx.strokeStyle = '#eab308';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(cTop - 3, topY); ctx.lineTo(cBot - 4, botY);
    ctx.moveTo(cTop + 3, topY); ctx.lineTo(cBot + 4, botY);
    ctx.stroke();
  }

  // 5. Animated Lane Dividers
  laneOffset = (laneOffset + profile.speedFactor) % 40;
  ctx.strokeStyle = profile.markingColor || '#ffffff';
  ctx.lineWidth = 2.5;
  ctx.setLineDash([18, 22]);
  ctx.lineDashOffset = -laneOffset;

  const lanes = profile.lanes || 3;
  for (let l = 1; l < lanes; l++) {
    // Skip if median island occupies center
    if (profile.feature === 'center-median-island' && l === Math.floor(lanes / 2)) continue;
    const frac = l / lanes;
    const x1 = topL + (topR - topL) * frac;
    const x2 = botL + (botR - botL) * frac;
    ctx.beginPath();
    ctx.moveTo(x1, topY);
    ctx.lineTo(x2, botY);
    ctx.stroke();
  }
  ctx.setLineDash([]);

  // 6. Overhead Surveillance Gantry Bar (if present)
  if (profile.feature === 'overhead-gantry') {
    ctx.fillStyle = 'rgba(15, 23, 42, 0.92)';
    ctx.fillRect(0, 0, w, 12);
    ctx.strokeStyle = '#38bdf8';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(0, 0, w, 12);
    // Camera Optical Pods with Green LEDs
    for (let g = 0; g < lanes; g++) {
      const gx = w * 0.28 + g * (w * 0.55 / (lanes - 1 || 1));
      ctx.fillStyle = '#334155';
      ctx.fillRect(gx - 8, 12, 16, 10);
      ctx.fillStyle = '#10b981';
      ctx.beginPath();
      ctx.arc(gx, 17, 2.5, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // 7. Continuous Realistic Traffic Vehicles & Optical Tracking
  simulatedVehicles.forEach(v => {
    // Advance vehicle position based on camera flow speed
    v.progress += profile.speedFactor * 0.0035;

    // Recycle vehicle when it exits bottom of frame
    if (v.progress > 1.12) {
      v.progress = -0.15 - Math.random() * 0.25;
      v.lane = Math.floor(Math.random() * lanes);
      v.type = profile.vehicleTypes[Math.floor(Math.random() * profile.vehicleTypes.length)] || 'Car';
      v.isCommercial = v.type === 'Auto-Rickshaw' || v.type === 'Truck' || v.type === 'Bus';
      v.color = v.isCommercial && v.type === 'Auto-Rickshaw' 
        ? '#15803d' 
        : VEHICLE_BODY_COLORS[Math.floor(Math.random() * VEHICLE_BODY_COLORS.length)];
      v.plateText = ODISHA_PLATES_POOL[Math.floor(Math.random() * ODISHA_PLATES_POOL.length)];
      v.speed = Math.round(parseFloat(profile.avgSpeed) + (Math.random() * 8 - 4));
      v.confidence = 0.93 + Math.random() * 0.06;
    }

    // Only render if within vertical visible range
    if (v.progress < 0.05 || v.progress > 1.1) return;

    const p = v.progress;
    const currY = topY + (botY - topY) * p;
    const roadLeftAtP = topL + (botL - topL) * p;
    const roadRightAtP = topR + (botR - topR) * p;
    const laneW = (roadRightAtP - roadLeftAtP) / lanes;
    const laneCenterX = roadLeftAtP + laneW * (v.lane + 0.5);

    const scale = 0.4 + p * 0.75;
    let boxW, boxH;

    if (v.type === 'Auto-Rickshaw') {
      boxW = 85 * scale; boxH = 70 * scale;
    } else if (v.type === 'Motorcycle') {
      boxW = 45 * scale; boxH = 60 * scale;
    } else if (v.type === 'Truck') {
      boxW = 150 * scale; boxH = 120 * scale;
    } else if (v.type === 'Bus') {
      boxW = 155 * scale; boxH = 125 * scale;
    } else if (v.type === 'SUV') {
      boxW = 125 * scale; boxH = 90 * scale;
    } else {
      boxW = 110 * scale; boxH = 80 * scale; // Car
    }

    const boxX = laneCenterX - boxW / 2;
    const boxY = currY - boxH / 2;

    // Vehicle Shadow
    ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
    ctx.beginPath();
    ctx.ellipse(laneCenterX, currY + boxH * 0.42, boxW * 0.46, boxH * 0.16, 0, 0, Math.PI * 2);
    ctx.fill();

    // Render Vehicle Geometry
    if (v.type === 'Auto-Rickshaw') {
      // Indian Auto-Rickshaw (Yellow curved canopy roof, green body)
      ctx.fillStyle = '#15803d'; // Green lower body
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(boxX + 6 * scale, boxY + 16 * scale, boxW - 12 * scale, boxH - 24 * scale, 8 * scale);
      else ctx.rect(boxX + 6 * scale, boxY + 16 * scale, boxW - 12 * scale, boxH - 24 * scale);
      ctx.fill();

      // Yellow Canopy Roof
      ctx.fillStyle = '#eab308';
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(boxX + 4 * scale, boxY + 4 * scale, boxW - 8 * scale, boxH * 0.45, 10 * scale);
      else ctx.rect(boxX + 4 * scale, boxY + 4 * scale, boxW - 8 * scale, boxH * 0.45);
      ctx.fill();

      // Rear window & passenger space
      ctx.fillStyle = '#0f172a';
      ctx.fillRect(boxX + 16 * scale, boxY + boxH * 0.35, boxW - 32 * scale, 12 * scale);

      // Tail lights
      ctx.fillStyle = '#ef4444';
      ctx.fillRect(boxX + 10 * scale, boxY + boxH - 12 * scale, 8 * scale, 5 * scale);
      ctx.fillRect(boxX + boxW - 18 * scale, boxY + boxH - 12 * scale, 8 * scale, 5 * scale);

    } else if (v.type === 'Truck') {
      // Multi-axle commercial transport truck
      ctx.fillStyle = v.color || '#334155';
      ctx.fillRect(boxX + 6 * scale, boxY + 14 * scale, boxW - 12 * scale, boxH - 24 * scale);
      // Container ribs
      ctx.strokeStyle = 'rgba(0,0,0,0.35)';
      ctx.lineWidth = 1.5;
      for (let i = 1; i < 4; i++) {
        ctx.beginPath();
        ctx.moveTo(boxX + 6 * scale + (boxW - 12 * scale) * (i / 4), boxY + 14 * scale);
        ctx.lineTo(boxX + 6 * scale + (boxW - 12 * scale) * (i / 4), boxY + boxH - 10 * scale);
        ctx.stroke();
      }
      // Mudflaps & Dual Red Taillights
      ctx.fillStyle = '#0f172a';
      ctx.fillRect(boxX + 4 * scale, boxY + boxH - 8 * scale, 22 * scale, 6 * scale);
      ctx.fillRect(boxX + boxW - 26 * scale, boxY + boxH - 8 * scale, 22 * scale, 6 * scale);
      ctx.fillStyle = '#ef4444';
      ctx.fillRect(boxX + 8 * scale, boxY + boxH - 14 * scale, 12 * scale, 5 * scale);
      ctx.fillRect(boxX + boxW - 20 * scale, boxY + boxH - 14 * scale, 12 * scale, 5 * scale);

    } else if (v.type === 'Bus') {
      // Smart City Transit Bus
      ctx.fillStyle = '#0284c7'; // Transit blue
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(boxX + 4 * scale, boxY + 6 * scale, boxW - 8 * scale, boxH - 14 * scale, 8 * scale);
      else ctx.rect(boxX + 4 * scale, boxY + 6 * scale, boxW - 8 * scale, boxH - 14 * scale);
      ctx.fill();
      // Rear panoramic glass
      ctx.fillStyle = '#0f172a';
      ctx.fillRect(boxX + 14 * scale, boxY + 22 * scale, boxW - 28 * scale, 26 * scale);
      // Destination Header
      ctx.fillStyle = '#f59e0b';
      ctx.font = `bold ${Math.round(8 * scale)}px monospace`;
      ctx.textAlign = 'center';
      ctx.fillText('ODISHA TRANSIT', laneCenterX, boxY + 16 * scale);
      ctx.textAlign = 'start';

    } else if (v.type === 'Motorcycle') {
      // Two-wheeler motorcycle with rider
      // Wheels
      ctx.fillStyle = '#0f172a';
      ctx.fillRect(boxX + 16 * scale, boxY + boxH - 16 * scale, 12 * scale, 14 * scale);
      // Rider Torso
      ctx.fillStyle = '#1e3a8a';
      ctx.beginPath();
      ctx.ellipse(laneCenterX, boxY + 28 * scale, 12 * scale, 16 * scale, 0, 0, Math.PI * 2);
      ctx.fill();
      // Rider Helmet
      ctx.fillStyle = '#f59e0b';
      ctx.beginPath();
      ctx.arc(laneCenterX, boxY + 12 * scale, 9 * scale, 0, Math.PI * 2);
      ctx.fill();
      // Taillight
      ctx.fillStyle = '#ef4444';
      ctx.fillRect(laneCenterX - 4 * scale, boxY + boxH - 8 * scale, 8 * scale, 4 * scale);

    } else {
      // Standard Car or SUV
      ctx.fillStyle = v.color || '#334155';
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(boxX + 8 * scale, boxY + 10 * scale, boxW - 16 * scale, boxH - 18 * scale, 8 * scale);
      else ctx.rect(boxX + 8 * scale, boxY + 10 * scale, boxW - 16 * scale, boxH - 18 * scale);
      ctx.fill();

      // Rear Windshield
      ctx.fillStyle = 'rgba(15, 23, 42, 0.95)';
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(boxX + 18 * scale, boxY + 20 * scale, boxW - 36 * scale, 22 * scale, 4 * scale);
      else ctx.rect(boxX + 18 * scale, boxY + 20 * scale, boxW - 36 * scale, 22 * scale);
      ctx.fill();

      // Red Taillights
      ctx.fillStyle = '#ef4444';
      ctx.fillRect(boxX + 10 * scale, boxY + boxH - 14 * scale, 14 * scale, 5 * scale);
      ctx.fillRect(boxX + boxW - 24 * scale, boxY + boxH - 14 * scale, 14 * scale, 5 * scale);
    }

    // License Plate (HSRP Indian Format)
    const plateW = Math.min(80 * scale, boxW * 0.65);
    const plateH = 20 * scale;
    const plateX = laneCenterX - plateW / 2;
    const plateY = boxY + boxH - plateH - 2 * scale;

    // Plate background (Yellow for commercial, White for private)
    ctx.fillStyle = v.isCommercial ? '#facc15' : '#ffffff';
    ctx.fillRect(plateX, plateY, plateW, plateH);
    ctx.strokeStyle = '#000000';
    ctx.lineWidth = 1;
    ctx.strokeRect(plateX, plateY, plateW, plateH);

    // Blue IND Flag on left
    const indW = 12 * scale;
    ctx.fillStyle = '#1e3a8a';
    ctx.fillRect(plateX, plateY, indW, plateH);
    ctx.fillStyle = '#ffffff';
    ctx.font = `bold ${Math.max(5, Math.round(6 * scale))}px sans-serif`;
    ctx.fillText('IND', plateX + 1.5, plateY + plateH * 0.68);

    // Plate Registration Number
    ctx.fillStyle = '#000000';
    ctx.font = `bold ${Math.max(7, Math.round(9.5 * scale))}px monospace`;
    ctx.textAlign = 'center';
    ctx.fillText(v.plateText, plateX + indW + (plateW - indW) / 2, plateY + plateH * 0.72);
    ctx.textAlign = 'start';

    // 8. Optical Detection Locking (When in ANPR Zone: p >= 0.28 && p <= 0.95)
    if (p >= 0.28 && p <= 0.95) {
      // YOLO Emerald Green Bounding Box
      ctx.strokeStyle = '#10b981';
      ctx.lineWidth = 2;
      ctx.strokeRect(boxX, boxY, boxW, boxH);

      // Corner Brackets for Computer Vision Tracking Look
      const cLen = 10 * scale;
      ctx.lineWidth = 3;
      // Top-Left
      ctx.beginPath(); ctx.moveTo(boxX, boxY + cLen); ctx.lineTo(boxX, boxY); ctx.lineTo(boxX + cLen, boxY); ctx.stroke();
      // Top-Right
      ctx.beginPath(); ctx.moveTo(boxX + boxW - cLen, boxY); ctx.lineTo(boxX + boxW, boxY); ctx.lineTo(boxX + boxW, boxY + cLen); ctx.stroke();
      // Bottom-Left
      ctx.beginPath(); ctx.moveTo(boxX, boxY + boxH - cLen); ctx.lineTo(boxX, boxY + boxH); ctx.lineTo(boxX + cLen, boxY + boxH); ctx.stroke();
      // Bottom-Right
      ctx.beginPath(); ctx.moveTo(boxX + boxW - cLen, boxY + boxH); ctx.lineTo(boxX + boxW, boxY + boxH); ctx.lineTo(boxX + boxW, boxY + boxH - cLen); ctx.stroke();

      // YOLO Classification Badge
      const badgeW = Math.max(110 * scale, 95);
      const badgeH = 18;
      ctx.fillStyle = '#10b981';
      ctx.fillRect(boxX, boxY - badgeH, badgeW, badgeH);
      ctx.fillStyle = '#020617';
      ctx.font = 'bold 9.5px sans-serif';
      ctx.fillText(`${v.type}: ${Math.round(v.confidence * 100)}% • ${v.speed} km/h`, boxX + 4, boxY - 5);

      // License Plate Gold OCR Box
      ctx.strokeStyle = '#f59e0b';
      ctx.lineWidth = 2;
      ctx.strokeRect(plateX - 2, plateY - 2, plateW + 4, plateH + 4);
    }
  });

  // 9. Camera Switch Optical Transition FX (Glitch / Signal Lock)
  if (camSwitchTransition.active) {
    const elapsed = Date.now() - camSwitchTransition.startTime;
    const dur = camSwitchTransition.duration;
    if (elapsed < dur) {
      const prog = elapsed / dur;
      // Scanning synchronization bar sweeping down
      const scanBarY = prog * h;
      ctx.fillStyle = 'rgba(56, 189, 248, 0.25)';
      ctx.fillRect(0, scanBarY - 12, w, 24);

      // Glitch scanline displacement
      ctx.fillStyle = 'rgba(15, 23, 42, 0.55)';
      ctx.fillRect(0, 0, w, h);

      // Camera Switch Centered Notification
      ctx.fillStyle = 'rgba(15, 23, 42, 0.9)';
      ctx.fillRect(w * 0.12, h * 0.40, w * 0.76, 54);
      ctx.strokeStyle = '#38bdf8';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(w * 0.12, h * 0.40, w * 0.76, 54);

      ctx.fillStyle = '#38bdf8';
      ctx.font = 'bold 12px monospace';
      ctx.textAlign = 'center';
      ctx.fillText(`⚡ PTZ OPTICAL FEED RE-LOCK: ${profile.name}`, w / 2, h * 0.40 + 22);
      ctx.fillStyle = '#10b981';
      ctx.font = '10px monospace';
      ctx.fillText(`${profile.location.toUpperCase()} // 1080p60 STREAM ACTIVE`, w / 2, h * 0.40 + 40);
      ctx.textAlign = 'start';
    } else {
      camSwitchTransition.active = false;
    }
  }

  // 10. Atmospheric Optical Tint & Vignette
  if (profile.ambientTint) {
    ctx.fillStyle = profile.ambientTint;
    ctx.fillRect(0, 0, w, h);
  }

  // Time HUD Overlay Update
  const timeHud = document.getElementById('cctv-time-hud');
  if (timeHud) {
    const now = new Date();
    timeHud.textContent = now.toISOString().replace('T', ' ').substring(0, 19) + ' UTC';
  }

  requestAnimationFrame(renderCctvFrame);
}

function triggerCctvDetection(eventData) {
  const vType = eventData.vehicle_type || 'Car';
  const isCommercial = vType === 'Auto-Rickshaw' || vType === 'Truck' || vType === 'Bus';
  const profile = CAMERA_PROFILES[activeCameraId] || CAMERA_PROFILES[1];

  // Inject this vehicle directly into the active camera feed in detection zone!
  const newVehicle = {
    progress: 0.38,
    lane: Math.floor(Math.random() * (profile.lanes || 3)),
    type: vType,
    color: eventData.vehicle_color === 'Silver' ? '#94a3b8' : 
           (eventData.vehicle_color === 'Black' ? '#0f172a' :
           (eventData.vehicle_color === 'Red' ? '#dc2626' : 
           (eventData.vehicle_color === 'Blue' ? '#1e40af' : '#f8fafc'))),
    plateText: eventData.plate_text || 'OD02AB1234',
    speed: Math.round(eventData.speed_estimate_kmh || 45.0),
    confidence: eventData.confidence || 0.96,
    isCommercial: isCommercial
  };

  simulatedVehicles.unshift(newVehicle);
  if (simulatedVehicles.length > 5) simulatedVehicles.pop();

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
  tr.style.transition = 'background 0.6s ease';
  tr.style.background = 'rgba(56, 189, 248, 0.22)';
  setTimeout(() => {
    tr.style.background = 'transparent';
  }, 1200);

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
    sample2Btn.addEventListener('click', () => runSampleInference('sample_car.jpg'));
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

function getPreviewElements() {
  const previewImg = document.getElementById('inference-preview-img') || document.getElementById('preview-image');
  const placeholder = document.getElementById('preview-placeholder') || document.getElementById('image-placeholder');
  const resultsContainer = document.getElementById('inference-results-content');
  const statusBadge = document.getElementById('inference-status-badge');
  return { previewImg, placeholder, resultsContainer, statusBadge };
}

async function handleUploadedFile(file) {
  const { previewImg, placeholder, resultsContainer, statusBadge } = getPreviewElements();

  const reader = new FileReader();
  reader.onload = async (e) => {
    if (previewImg) {
      previewImg.src = e.target.result;
      previewImg.style.display = 'block';
    }
    if (placeholder) placeholder.style.display = 'none';

    if (statusBadge) {
      statusBadge.style.display = 'inline-block';
      statusBadge.innerText = 'Analyzing...';
      statusBadge.style.background = 'rgba(56, 189, 248, 0.15)';
      statusBadge.style.color = '#38bdf8';
    }
    if (resultsContainer) {
      resultsContainer.innerHTML = '<div style="color:#38bdf8; padding:20px;">⚡ Running YOLOv8 Detection & OCR Recognition...</div>';
    }

    try {
      const arrayBuffer = await file.arrayBuffer();
      const res = await fetch('/api/inference/upload-image', {
        method: 'POST',
        headers: { 'Content-Type': file.type || 'image/jpeg' },
        body: arrayBuffer
      });
      if (!res.ok) {
        const errText = await res.text();
        throw new Error(`HTTP ${res.status}: ${errText}`);
      }
      const data = await res.json();
      displayInferenceResults(data);
    } catch (err) {
      if (resultsContainer) {
        resultsContainer.innerHTML = `<div style="color:#f43f5e; padding:15px;">Inference error: ${escapeHtml(err.message)}</div>`;
      }
      if (statusBadge) {
        statusBadge.innerText = 'Failed';
        statusBadge.style.background = 'rgba(244, 63, 94, 0.15)';
        statusBadge.style.color = '#f43f5e';
      }
    }
  };
  reader.readAsDataURL(file);
}

async function runSampleInference(filename) {
  const { previewImg, placeholder, resultsContainer, statusBadge } = getPreviewElements();

  if (previewImg) {
    previewImg.src = `/data/${filename}`;
    previewImg.style.display = 'block';
  }
  if (placeholder) placeholder.style.display = 'none';

  if (statusBadge) {
    statusBadge.style.display = 'inline-block';
    statusBadge.innerText = 'Analyzing Sample...';
    statusBadge.style.background = 'rgba(56, 189, 248, 0.15)';
    statusBadge.style.color = '#38bdf8';
  }
  if (resultsContainer) {
    resultsContainer.innerHTML = '<div style="color:#38bdf8; padding:20px;">⚙️ Processing sample frame through AI inference pipeline...</div>';
  }

  try {
    const res = await fetch(`/api/inference/run-sample?filename=${encodeURIComponent(filename)}`, { method: 'POST' });
    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`HTTP ${res.status}: ${errText}`);
    }
    const data = await res.json();
    displayInferenceResults(data);
  } catch (err) {
    if (resultsContainer) {
      resultsContainer.innerHTML = `<div style="color:#f43f5e; padding:15px;">Sample inference error: ${escapeHtml(err.message)}</div>`;
    }
    if (statusBadge) {
      statusBadge.innerText = 'Failed';
      statusBadge.style.background = 'rgba(244, 63, 94, 0.15)';
      statusBadge.style.color = '#f43f5e';
    }
  }
}

function displayInferenceResults(data) {
  const { previewImg, placeholder, resultsContainer, statusBadge } = getPreviewElements();

  if (previewImg) {
    if (data.annotated_image) {
      previewImg.src = data.annotated_image;
    }
    previewImg.style.display = 'block';
  }
  if (placeholder) placeholder.style.display = 'none';

  if (statusBadge) {
    statusBadge.innerText = 'Success';
    statusBadge.style.background = 'rgba(16, 185, 129, 0.15)';
    statusBadge.style.color = '#10b981';
  }

  const detections = data.results || data.detections || [];
  if (detections.length === 0) {
    if (resultsContainer) {
      resultsContainer.innerHTML = `
        <div style="padding: 20px; text-align: center;">
          <div style="font-size: 24px; margin-bottom: 8px;">ℹ️</div>
          <div>No vehicles or license plates localized in this frame.</div>
        </div>
      `;
    }
    return;
  }

  let html = `<div style="text-align:left; width:100%; max-height:480px; overflow-y:auto; padding-right:4px;">`;
  detections.forEach((det, idx) => {
    const isValid = det.is_valid;
    const rto = det.rto_details || {};
    const vType = det.vehicle_type || "Vehicle";
    const vColor = det.vehicle_color || "Detected";

    html += `
      <div style="background: rgba(255,255,255,0.03); border: 1px solid var(--border-subtle); border-radius: 10px; padding: 14px; margin-bottom: 12px;">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
          <span style="font-size:0.8rem; color:#94a3b8; font-weight:700;">Detection #${idx + 1} • <span style="color:#38bdf8;">${escapeHtml(vType)} (${escapeHtml(vColor)})</span></span>
          <span class="confidence-meter">${Math.round(det.confidence * 100)}% Confidence</span>
        </div>
        
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px; flex-wrap:wrap; gap:8px;">
          <div style="display:flex; align-items:center; gap:10px;">
            <div class="plate-box" style="padding: 3px 10px;">
              <div class="plate-flag" style="margin-right:6px;">
                <div class="plate-flag-band"></div>
                <div class="plate-flag-ind" style="font-size:7px;">IND</div>
                <div class="plate-flag-band"></div>
              </div>
              <div class="plate-number" style="font-size:1.2rem; letter-spacing:1px;">${escapeHtml(det.text || 'UNKNOWN')}</div>
            </div>
            <span style="font-size:0.75rem; font-weight:700; color: ${isValid ? '#10b981' : '#f59e0b'};">
              ${isValid ? '✓ Valid Indian Format' : '⚠️ Unverified Format'}
            </span>
          </div>
          <button class="map-action-btn track-from-image-btn" data-plate="${escapeHtml(det.text)}" type="button" style="padding:5px 12px; font-size:0.75rem;">
            <span>🗺️</span> Track Trajectory
          </button>
        </div>

        <div style="display:grid; grid-template-columns: repeat(auto-fit, minmax(130px, 1fr)); gap:8px; margin-bottom:8px; font-size:0.75rem;">
          <div style="background:rgba(15,23,42,0.6); padding:6px 10px; border-radius:6px;">
            <span style="color:#64748b;">State:</span> <strong style="color:#f8fafc;">${escapeHtml(rto.state_name || 'India')}</strong>
          </div>
          <div style="background:rgba(15,23,42,0.6); padding:6px 10px; border-radius:6px;">
            <span style="color:#64748b;">RTO Jurisdiction:</span> <strong style="color:#38bdf8;">${escapeHtml(rto.rto_jurisdiction || 'Regional Transport')}</strong>
          </div>
          <div style="background:rgba(15,23,42,0.6); padding:6px 10px; border-radius:6px;">
            <span style="color:#64748b;">Color:</span> <strong style="color:#fbbf24;">${escapeHtml(vColor)}</strong>
          </div>
        </div>

        <div style="font-family:var(--font-mono); font-size:0.72rem; color:#64748b;">
          Plate BBox: [${(det.bbox || []).map(n => Math.round(n)).join(', ')}]
        </div>
      </div>
    `;
  });
  html += `</div>`;

  if (resultsContainer) {
    resultsContainer.innerHTML = html;

    resultsContainer.querySelectorAll('.track-from-image-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const plate = btn.getAttribute('data-plate');
        if (plate && plate !== 'UNKNOWN') {
          const gisTabBtn = document.getElementById('tab-gis-btn');
          if (gisTabBtn) gisTabBtn.click();
          const searchInput = document.getElementById('plate-search-input');
          if (searchInput) searchInput.value = plate;
          trackPlateTrajectory(plate);
        }
      });
    });
  }
}

async function handleUploadedVideo(file) {
  const videoPlayer = document.getElementById('cctv-video-player');
  const placeholder = document.getElementById('video-placeholder');
  const resultsContainer = document.getElementById('video-results-content');
  const statusBadge = document.getElementById('video-status-badge');

  const videoUrl = URL.createObjectURL(file);
  if (videoPlayer) {
    videoPlayer.src = videoUrl;
    videoPlayer.style.display = 'block';
  }
  if (placeholder) placeholder.style.display = 'none';

  if (statusBadge) {
    statusBadge.style.display = 'inline-block';
    statusBadge.innerText = 'Processing Video...';
    statusBadge.style.color = '#38bdf8';
    statusBadge.style.background = 'rgba(56, 189, 248, 0.15)';
  }
  if (resultsContainer) {
    resultsContainer.innerHTML = '<div style="color:#38bdf8; padding:20px;">🎥 Processing CCTV video through Multi-Object Tracker & Temporal Majority Voting...<br><span style="font-size:0.8rem; color:#94a3b8;">Extracting vehicle trajectories, velocities, and Indian plates...</span></div>';
  }

  try {
    const arrayBuffer = await file.arrayBuffer();
    const res = await fetch('/api/inference/upload-video', {
      method: 'POST',
      headers: { 'Content-Type': 'video/mp4' },
      body: arrayBuffer
    });
    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`HTTP ${res.status}: ${errText}`);
    }
    const data = await res.json();
    displayVideoInferenceResults(data, videoUrl);
  } catch (err) {
    if (resultsContainer) {
      resultsContainer.innerHTML = `<div style="color:#f43f5e; padding:15px;">Video processing error: ${escapeHtml(err.message)}</div>`;
    }
    if (statusBadge) {
      statusBadge.innerText = 'Failed';
      statusBadge.style.background = 'rgba(244, 63, 94, 0.15)';
      statusBadge.style.color = '#f43f5e';
    }
  }
}

async function runSampleVideoInference() {
  const videoPlayer = document.getElementById('cctv-video-player');
  const placeholder = document.getElementById('video-placeholder');
  const resultsContainer = document.getElementById('video-results-content');
  const statusBadge = document.getElementById('video-status-badge');

  const videoUrl = '/data/test_video.mp4';
  if (videoPlayer) {
    videoPlayer.src = videoUrl;
    videoPlayer.style.display = 'block';
  }
  if (placeholder) placeholder.style.display = 'none';

  if (statusBadge) {
    statusBadge.style.display = 'inline-block';
    statusBadge.innerText = 'Running Sample...';
    statusBadge.style.color = '#38bdf8';
    statusBadge.style.background = 'rgba(56, 189, 248, 0.15)';
  }
  if (resultsContainer) {
    resultsContainer.innerHTML = '<div style="color:#38bdf8; padding:20px;">⚙️ Processing CCTV sample video test_video.mp4...</div>';
  }

  try {
    const res = await fetch('/api/inference/run-sample-video', { method: 'POST' });
    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`HTTP ${res.status}: ${errText}`);
    }
    const data = await res.json();
    displayVideoInferenceResults(data, videoUrl);
  } catch (err) {
    if (resultsContainer) {
      resultsContainer.innerHTML = `<div style="color:#f43f5e; padding:15px;">Sample video error: ${escapeHtml(err.message)}</div>`;
    }
    if (statusBadge) {
      statusBadge.innerText = 'Failed';
      statusBadge.style.background = 'rgba(244, 63, 94, 0.15)';
      statusBadge.style.color = '#f43f5e';
    }
  }
}

function displayVideoInferenceResults(data, videoUrl) {
  const resultsContainer = document.getElementById('video-results-content');
  const statusBadge = document.getElementById('video-status-badge');

  if (statusBadge) {
    statusBadge.innerText = 'Success';
    statusBadge.style.background = 'rgba(16, 185, 129, 0.15)';
    statusBadge.style.color = '#10b981';
  }

  const tracked = data.results || [];
  if (tracked.length === 0) {
    if (resultsContainer) {
      resultsContainer.innerHTML = '<div style="padding:20px; color:var(--text-dim);">No moving vehicle license plates tracked in this video footage.</div>';
    }
    return;
  }

  let html = `<div style="text-align:left; width:100%; max-height:480px; overflow-y:auto; padding-right:4px;">`;
  html += `<div style="font-size:0.8rem; color:#94a3b8; margin-bottom:12px;">Processed ${data.total_frames || 'surveillance'} frames • ${tracked.length} vehicle(s) tracked:</div>`;

  tracked.forEach((t) => {
    const isValid = t.valid;
    const rto = t.rto_details || {};
    const speed = t.estimated_speed_kmh || 42.0;

    html += `
      <div style="background: rgba(255,255,255,0.03); border: 1px solid var(--border-subtle); border-radius: 10px; padding: 14px; margin-bottom: 12px;">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
          <span style="font-size:0.8rem; color:#38bdf8; font-weight:700;">Track #${t.track_id} • <span style="color:#e2e8f0;">${escapeHtml(t.vehicle_type || 'Car')} (${escapeHtml(t.vehicle_color || 'Vehicle')})</span></span>
          <span class="confidence-meter">${Math.round((t.confidence || 0.85) * 100)}% Confidence</span>
        </div>
        
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px; flex-wrap:wrap; gap:8px;">
          <div style="display:flex; align-items:center; gap:10px;">
            <div class="plate-box" style="padding: 3px 10px;">
              <div class="plate-flag" style="margin-right:6px;">
                <div class="plate-flag-band"></div>
                <div class="plate-flag-ind" style="font-size:7px;">IND</div>
                <div class="plate-flag-band"></div>
              </div>
              <div class="plate-number" style="font-size:1.15rem; letter-spacing:1px;">${escapeHtml(t.plate_text)}</div>
            </div>
            <span style="font-size:0.75rem; font-weight:700; color: ${isValid ? '#10b981' : '#f59e0b'};">
              ${isValid ? '✓ Valid Indian Registration' : '⚠️ Non-standard'}
            </span>
          </div>
          <button class="map-action-btn track-from-video-btn" data-plate="${escapeHtml(t.plate_text)}" type="button" style="padding:6px 12px; font-size:0.75rem;">
            <span>🗺️</span> Track on Map
          </button>
        </div>

        <div style="display:grid; grid-template-columns: repeat(auto-fit, minmax(130px, 1fr)); gap:8px; margin-bottom:8px; font-size:0.75rem;">
          <div style="background:rgba(15,23,42,0.6); padding:6px 10px; border-radius:6px;">
            <span style="color:#64748b;">Est. Speed:</span> <strong style="color:#34d399;">${speed} km/h</strong>
          </div>
          <div style="background:rgba(15,23,42,0.6); padding:6px 10px; border-radius:6px;">
            <span style="color:#64748b;">State:</span> <strong style="color:#f8fafc;">${escapeHtml(rto.state_name || 'India')}</strong>
          </div>
          <div style="background:rgba(15,23,42,0.6); padding:6px 10px; border-radius:6px;">
            <span style="color:#64748b;">RTO Jurisdiction:</span> <strong style="color:#38bdf8;">${escapeHtml(rto.rto_jurisdiction || 'Regional Transport')}</strong>
          </div>
        </div>

        <div style="font-family:var(--font-mono); font-size:0.72rem; color:#64748b;">
          Temporal Voting: ${t.reads_count} / ${t.total_track_frames} frames confirmed match • Track points: ${t.trajectory_points_count || 1}
        </div>
      </div>
    `;
  });
  html += `</div>`;

  if (resultsContainer) {
    resultsContainer.innerHTML = html;

    // Wire "Track on Map" buttons
    resultsContainer.querySelectorAll('.track-from-video-btn').forEach(btn => {
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
}
