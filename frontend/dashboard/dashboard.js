// Dashboard JavaScript — CITYSURV Command Center
// Heatmaps, Camera Health, Alerts, Flagged Vehicles, Exports

function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#039;');
}

let peakChartInstance = null;
let vehicleDistChartInstance = null;
let dashboardWs = null;

document.addEventListener('DOMContentLoaded', () => {
  loadSystemOverview();
  loadHeatmap();
  loadPeakHours();
  loadCameraHealth();
  loadAlerts();
  loadFlaggedVehicles();
  loadVehicleDistribution();
  initDashboardControls();
  initDashboardWebSocket();

  // Continuous live data synchronization every 5 seconds
  setInterval(() => {
    loadSystemOverview();
    loadHeatmap();
    loadPeakHours();
    loadAlerts();
  }, 5000);

  // Slower refresh for structural metrics every 15 seconds
  setInterval(() => {
    loadCameraHealth();
    loadVehicleDistribution();
  }, 15000);
});

/* ── Live WebSocket Stream Connection ── */
function initDashboardWebSocket() {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${protocol}//${window.location.host}/ws/live`;

  try {
    dashboardWs = new WebSocket(wsUrl);

    dashboardWs.onopen = () => {
      console.log('⚡ Dashboard live telemetry stream connected');
      const badge = document.getElementById('live-status-badge');
      if (badge) {
        badge.innerHTML = '<span style="width:8px; height:8px; background:#10b981; border-radius:50%; display:inline-block; box-shadow:0 0 10px #10b981;"></span>● LIVE TELEMETRY';
        badge.style.color = '#10b981';
        badge.style.borderColor = 'rgba(16,185,129,0.5)';
      }
    };

    dashboardWs.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === 'detection') {
          // Immediately bump KPIs on live sighting
          bumpKPIsOnDetection(msg.data);
        } else if (msg.type === 'alert') {
          loadAlerts();
        }
      } catch (e) {
        console.error('WebSocket message parsing error:', e);
      }
    };

    dashboardWs.onclose = () => {
      console.warn('⚠️ Dashboard WebSocket disconnected. Reconnecting in 3s...');
      const badge = document.getElementById('live-status-badge');
      if (badge) {
        badge.innerHTML = '<span style="width:8px; height:8px; background:#eab308; border-radius:50%; display:inline-block;"></span>○ CONNECTING...';
        badge.style.color = '#eab308';
        badge.style.borderColor = 'rgba(234,179,8,0.5)';
      }
      setTimeout(initDashboardWebSocket, 3000);
    };

    dashboardWs.onerror = (err) => {
      console.error('Dashboard WebSocket error:', err);
    };
  } catch (err) {
    console.error('Failed to initialize Dashboard WebSocket:', err);
  }
}

function bumpKPIsOnDetection(eventData) {
  const totalEl = document.getElementById('kpi-total-events');
  const todayEl = document.getElementById('kpi-today-events');
  if (totalEl) {
    const curr = parseInt(totalEl.textContent.replace(/,/g, '')) || 0;
    totalEl.textContent = (curr + 1).toLocaleString();
    totalEl.classList.add('kpi-bump');
    setTimeout(() => totalEl.classList.remove('kpi-bump'), 600);
  }
  if (todayEl) {
    const curr = parseInt(todayEl.textContent.replace(/,/g, '')) || 0;
    todayEl.textContent = (curr + 1).toLocaleString();
  }
}

/* ── System Overview KPIs ── */
async function loadSystemOverview() {
  try {
    const res = await fetch('/api/analytics/system-overview');
    const data = await res.json();
    document.getElementById('kpi-total-events').textContent = data.total_events_all_time.toLocaleString();
    document.getElementById('kpi-today-events').textContent = data.total_events_today.toLocaleString();
    document.getElementById('kpi-active-cameras').textContent = `${data.active_cameras}/${data.total_cameras}`;
    document.getElementById('kpi-ocr-confidence').textContent = `${data.avg_ocr_confidence}%`;

    // Unique vehicles
    const summaryRes = await fetch('/api/analytics/summary');
    const summaryData = await summaryRes.json();
    document.getElementById('kpi-unique-vehicles').textContent = summaryData.unique_vehicles.toLocaleString();

    // Alert count
    const alertRes = await fetch('/api/alerts/unread-count');
    const alertData = await alertRes.json();
    document.getElementById('kpi-alert-count').textContent = alertData.unread_count;
    document.getElementById('alert-badge').textContent = alertData.unread_count;
  } catch (err) {
    console.error('System overview error:', err);
  }
}

/* ── Heatmap ── */
async function loadHeatmap() {
  try {
    const res = await fetch('/api/analytics/heatmap');
    const data = await res.json();
    renderHeatmap(data);
  } catch (err) {
    console.error('Heatmap error:', err);
  }
}

function renderHeatmap(data) {
  const container = document.getElementById('heatmap-container');
  const { cameras, hours, matrix, max_value } = data;

  let html = '<table class="heatmap-table"><thead><tr><th class="hour-label">Hour</th>';
  cameras.forEach(cam => {
    html += `<th>${escapeHtml(cam)}</th>`;
  });
  html += '</tr></thead><tbody>';

  for (let h = 0; h < 24; h++) {
    html += `<tr><th class="hour-label">${hours[h]}</th>`;
    for (let c = 0; c < cameras.length; c++) {
      const val = matrix[h][c];
      const intensity = max_value > 0 ? val / max_value : 0;
      const bg = getHeatColor(intensity);
      html += `<td class="heatmap-cell" style="background:${bg};" title="${cameras[c]} @ ${hours[h]}: ${val} detections">${val > 0 ? val : ''}</td>`;
    }
    html += '</tr>';
  }
  html += '</tbody></table>';
  container.innerHTML = html;
}

function getHeatColor(intensity) {
  if (intensity <= 0) return 'rgba(255,255,255,0.02)';
  if (intensity < 0.25) return `rgba(16, 185, 129, ${0.2 + intensity * 0.6})`;
  if (intensity < 0.5) return `rgba(56, 189, 248, ${0.3 + intensity * 0.5})`;
  if (intensity < 0.75) return `rgba(245, 158, 11, ${0.4 + intensity * 0.4})`;
  return `rgba(244, 63, 94, ${0.5 + intensity * 0.4})`;
}

/* ── Peak Hours ── */
async function loadPeakHours() {
  try {
    const res = await fetch('/api/analytics/peak-hours');
    const data = await res.json();
    renderPeakHours(data);
  } catch (err) {
    console.error('Peak hours error:', err);
  }
}

function renderPeakHours(data) {
  document.getElementById('peak-hour-time').textContent = data.peak_hour;

  const bandColors = { morning: '#f59e0b', afternoon: '#38bdf8', evening: '#8b5cf6', night: '#64748b' };
  const bandBarsEl = document.getElementById('band-bars');
  const totalAll = Object.values(data.band_totals).reduce((a, b) => a + b, 0) || 1;

  let bandHtml = '';
  for (const [band, count] of Object.entries(data.band_totals)) {
    const pct = Math.round((count / totalAll) * 100);
    bandHtml += `
      <div class="band-bar-row">
        <span class="band-bar-label">${band}</span>
        <div class="band-bar-track">
          <div class="band-bar-fill" style="width:${pct}%; background:${bandColors[band] || '#38bdf8'};"></div>
        </div>
        <span class="band-bar-count">${count}</span>
      </div>
    `;
  }
  bandBarsEl.innerHTML = bandHtml;

  // Peak hour mini chart
  const ctx = document.getElementById('peakHourChart').getContext('2d');
  if (peakChartInstance) peakChartInstance.destroy();

  const hourlyData = data.hourly || [];
  peakChartInstance = new Chart(ctx, {
    type: 'line',
    data: {
      labels: hourlyData.map(h => h.hour),
      datasets: [{
        data: hourlyData.map(h => h.count),
        borderColor: '#00f2fe',
        backgroundColor: 'rgba(0, 242, 254, 0.1)',
        fill: true,
        tension: 0.4,
        pointRadius: 2,
        borderWidth: 2,
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { grid: { color: 'rgba(255,255,255,0.03)' }, ticks: { color: '#64748b', font: { size: 9 } } },
        y: { grid: { color: 'rgba(255,255,255,0.03)' }, ticks: { color: '#64748b', font: { size: 9 } } }
      }
    }
  });
}

/* ── Camera Health ── */
async function loadCameraHealth() {
  try {
    const res = await fetch('/api/analytics/camera-health');
    const data = await res.json();
    renderCameraHealth(data);
  } catch (err) {
    console.error('Camera health error:', err);
  }
}

function renderCameraHealth(cameras) {
  const tbody = document.querySelector('#camera-health-table tbody');
  tbody.innerHTML = '';
  cameras.forEach(cam => {
    const statusClass = cam.status === 'ACTIVE' ? 'active' : cam.status === 'MAINTENANCE' ? 'maintenance' : 'offline';
    const uptimePct = Math.round(cam.uptime_pct);
    const uptimeColor = uptimePct >= 90 ? '#10b981' : uptimePct >= 50 ? '#f59e0b' : '#f43f5e';
    const lastActive = cam.hours_since_last_detection !== null ? `${cam.hours_since_last_detection}h ago` : 'Never';

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td style="font-weight:700; color:#fff;">${escapeHtml(cam.name)}</td>
      <td>${escapeHtml(cam.location_name)}</td>
      <td><span class="status-pill ${statusClass}">${cam.status}</span></td>
      <td>
        <div class="uptime-bar"><div class="uptime-fill" style="width:${uptimePct}%; background:${uptimeColor};"></div></div>
        <span style="font-family:var(--font-mono); font-size:0.75rem;">${uptimePct}%</span>
      </td>
      <td style="font-family:var(--font-mono); font-weight:700;">${cam.detections_24h}</td>
      <td style="font-family:var(--font-mono);">${cam.detection_rate_per_hour}/hr</td>
      <td style="font-size:0.75rem; color:var(--text-dim);">${escapeHtml(lastActive)}</td>
    `;
    tbody.appendChild(tr);
  });
}

/* ── Alerts ── */
async function loadAlerts() {
  try {
    const res = await fetch('/api/alerts');
    const data = await res.json();
    renderAlerts(data.alerts, 'alerts-feed');
    document.getElementById('alert-badge').textContent = data.unread_count;
  } catch (err) {
    console.error('Alerts error:', err);
  }
}

function renderAlerts(alerts, containerId) {
  const container = document.getElementById(containerId);
  if (!alerts || alerts.length === 0) {
    container.innerHTML = '<div style="color:var(--text-dim); padding:20px; text-align:center;">✅ No active alerts. System operating normally.</div>';
    return;
  }

  container.innerHTML = '';
  alerts.forEach(alert => {
    const severityIcons = { CRITICAL: '🔴', WARNING: '🟡', INFO: '🔵' };
    const severityClass = alert.severity.toLowerCase();
    const timeStr = alert.timestamp ? new Date(alert.timestamp).toLocaleTimeString() : '';

    const item = document.createElement('div');
    item.className = `alert-item ${severityClass}`;
    item.innerHTML = `
      <div class="alert-severity-icon">${severityIcons[alert.severity] || '⚪'}</div>
      <div class="alert-content">
        <div class="alert-message">${escapeHtml(alert.message)}</div>
        <div class="alert-meta">
          <span>${escapeHtml(alert.alert_type)}</span>
          <span>${escapeHtml(timeStr)}</span>
          ${alert.plate_text ? `<span style="font-family:var(--font-mono); font-weight:700;">${escapeHtml(alert.plate_text)}</span>` : ''}
        </div>
      </div>
      <button class="alert-ack-btn" data-alert-id="${alert.id}" type="button">✓ Ack</button>
    `;
    container.appendChild(item);
  });

  // Wire acknowledge buttons
  container.querySelectorAll('.alert-ack-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const alertId = btn.getAttribute('data-alert-id');
      try {
        await fetch(`/api/alerts/acknowledge/${alertId}`, { method: 'POST' });
        loadAlerts();
        loadSystemOverview();
      } catch (err) {
        console.error('Acknowledge error:', err);
      }
    });
  });
}

/* ── Flagged Vehicles ── */
async function loadFlaggedVehicles() {
  try {
    const res = await fetch('/api/alerts/flagged-vehicles');
    const vehicles = await res.json();
    renderFlaggedVehicles(vehicles);
  } catch (err) {
    console.error('Flagged vehicles error:', err);
  }
}

function renderFlaggedVehicles(vehicles) {
  const container = document.getElementById('flagged-list');
  if (!vehicles || vehicles.length === 0) {
    container.innerHTML = '<div style="color:var(--text-dim); padding:20px; text-align:center;">No vehicles currently flagged.</div>';
    return;
  }
  container.innerHTML = '';
  vehicles.forEach(v => {
    const item = document.createElement('div');
    item.className = 'flagged-item';
    item.innerHTML = `
      <div>
        <div class="flagged-plate">🚩 ${escapeHtml(v.plate_text)}</div>
        <div class="flagged-reason">${escapeHtml(v.reason)}</div>
      </div>
      <button class="unflag-btn" data-plate="${escapeHtml(v.plate_text)}" type="button">Remove</button>
    `;
    container.appendChild(item);
  });

  container.querySelectorAll('.unflag-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const plate = btn.getAttribute('data-plate');
      try {
        await fetch(`/api/alerts/unflag-vehicle/${plate}`, { method: 'POST' });
        loadFlaggedVehicles();
      } catch (err) {
        console.error('Unflag error:', err);
      }
    });
  });
}

/* ── Vehicle Distribution Chart ── */
async function loadVehicleDistribution() {
  try {
    const res = await fetch('/api/analytics/vehicle-types');
    const data = await res.json();
    const ctx = document.getElementById('vehicleDistChart').getContext('2d');
    if (vehicleDistChartInstance) vehicleDistChartInstance.destroy();

    vehicleDistChartInstance = new Chart(ctx, {
      type: 'doughnut',
      data: {
        labels: data.map(v => v.vehicle_type),
        datasets: [{
          data: data.map(v => v.count),
          backgroundColor: ['#00f2fe', '#4facfe', '#8b5cf6', '#10b981', '#f59e0b'],
          borderColor: '#0f172a',
          borderWidth: 3,
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
  } catch (err) {
    console.error('Vehicle dist error:', err);
  }
}

/* ── Dashboard Controls ── */
function initDashboardControls() {
  // Export CSV
  document.getElementById('export-csv-btn').addEventListener('click', () => {
    window.open('/api/export/events?format=csv', '_blank');
  });

  // Export Report
  document.getElementById('export-report-btn').addEventListener('click', () => {
    window.open('/api/export/report', '_blank');
  });

  // Alert bell -> slide-over
  document.getElementById('alert-bell').addEventListener('click', async () => {
    const panel = document.getElementById('alert-slideover');
    panel.classList.toggle('open');
    if (panel.classList.contains('open')) {
      const res = await fetch('/api/alerts/history?limit=50');
      const alerts = await res.json();
      renderAlerts(alerts, 'slideover-alerts-list');
    }
  });

  document.getElementById('close-slideover').addEventListener('click', () => {
    document.getElementById('alert-slideover').classList.remove('open');
  });

  // Check anomalies button
  document.getElementById('check-anomalies-btn').addEventListener('click', async () => {
    try {
      const res = await fetch('/api/alerts/check-speed-anomalies', { method: 'POST' });
      const data = await res.json();
      loadAlerts();
      loadSystemOverview();
    } catch (err) {
      console.error('Anomaly check error:', err);
    }
  });

  // Acknowledge all
  document.getElementById('ack-all-btn').addEventListener('click', async () => {
    try {
      const res = await fetch('/api/alerts');
      const data = await res.json();
      for (const alert of data.alerts) {
        await fetch(`/api/alerts/acknowledge/${alert.id}`, { method: 'POST' });
      }
      loadAlerts();
      loadSystemOverview();
    } catch (err) {
      console.error('Ack all error:', err);
    }
  });

  // Flag vehicle
  document.getElementById('flag-vehicle-btn').addEventListener('click', async () => {
    const input = document.getElementById('flag-plate-input');
    const plate = input.value.trim().toUpperCase();
    if (!plate) return;
    try {
      await fetch('/api/alerts/flag-vehicle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plate_text: plate, reason: 'Manual watchlist entry' }),
      });
      input.value = '';
      loadFlaggedVehicles();
    } catch (err) {
      console.error('Flag error:', err);
    }
  });
}
