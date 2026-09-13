/**
 * Security Alerts & Blacklist Operations Controller
 */

let alertsList = [];
let flaggedList = [];

document.addEventListener("DOMContentLoaded", () => {
  loadAlerts();
  loadFlaggedVehicles();
  initListeners();
  initWebSocket();
});

function initListeners() {
  document.getElementById("flag-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const plate = document.getElementById("flag-plate-input").value.trim().toUpperCase();
    const reason = document.getElementById("flag-reason-input").value.trim();

    if (!plate || !reason) return;

    try {
      const resp = await fetch("/api/alerts/flag", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plate_text: plate, reason: reason })
      });
      if (resp.ok) {
        document.getElementById("flag-plate-input").value = "";
        document.getElementById("flag-reason-input").value = "";
        loadFlaggedVehicles();
        playChime(660);
      }
    } catch (err) {
      console.error("Error flagging vehicle:", err);
    }
  });

  document.getElementById("ack-all-btn").addEventListener("click", async () => {
    try {
      const resp = await fetch("/api/alerts/ack-all", { method: "POST" });
      if (resp.ok) {
        loadAlerts();
      }
    } catch (err) {
      console.error("Error acking all alerts:", err);
    }
  });
}

async function loadAlerts() {
  try {
    const resp = await fetch("/api/alerts/active");
    if (resp.ok) {
      alertsList = await resp.json();
      renderAlerts();
    }
  } catch (err) {
    console.error("Error loading alerts:", err);
  }
}

async function loadFlaggedVehicles() {
  try {
    const resp = await fetch("/api/alerts/flagged");
    if (resp.ok) {
      flaggedList = await resp.json();
      renderFlagged();
    }
  } catch (err) {
    console.error("Error loading flagged vehicles:", err);
  }
}

function renderFlagged() {
  const container = document.getElementById("flagged-list-container");
  document.getElementById("flag-count-badge").textContent = `${flaggedList.length} active`;

  if (!flaggedList || flaggedList.length === 0) {
    container.innerHTML = `<div style="padding:20px; text-align:center; color:#64748b; font-size:13px;">No active targets on watchlist.</div>`;
    return;
  }

  container.innerHTML = "";
  flaggedList.forEach(fv => {
    const item = document.createElement("div");
    item.className = "flagged-item";
    item.innerHTML = `
      <div>
        <div class="flagged-plate">${fv.plate_text}</div>
        <div style="font-size:11px; color:#cbd5e1; margin-top:2px;">${fv.reason}</div>
      </div>
      <div style="display:flex; gap:6px; align-items:center;">
        <a href="/vehicles?plate=${fv.plate_text}" class="unflag-btn" style="text-decoration:none; color:#38bdf8;">Track</a>
        <button class="unflag-btn" onclick="unflagVehicle('${fv.plate_text}')">Unflag</button>
      </div>
    `;
    container.appendChild(item);
  });
}

async function unflagVehicle(plate) {
  try {
    const resp = await fetch(`/api/alerts/flag/${encodeURIComponent(plate)}`, {
      method: "DELETE"
    });
    if (resp.ok) {
      loadFlaggedVehicles();
    }
  } catch (err) {
    console.error("Error unflagging vehicle:", err);
  }
}

function renderAlerts() {
  const container = document.getElementById("alert-stream-container");
  document.getElementById("unread-count").textContent = alertsList.length;

  if (!alertsList || alertsList.length === 0) {
    container.innerHTML = `<div style="padding:40px; text-align:center; color:#64748b;">No active unacknowledged alerts. Grid normal.</div>`;
    return;
  }

  container.innerHTML = "";
  alertsList.forEach(a => {
    const isCritical = a.severity === "CRITICAL";
    const item = document.createElement("div");
    item.className = `alert-stream-item ${isCritical ? 'alert-critical' : 'alert-warning'}`;

    item.innerHTML = `
      <div style="flex:1;">
        <div class="alert-badge-tag ${isCritical ? 'tag-critical' : 'tag-warning'}">
          ${isCritical ? '🚨 CRITICAL' : '⚠️ WARNING'} • ${a.alert_type}
        </div>
        <div style="font-size:14px; font-weight:700; color:#f8fafc; margin-bottom:4px;">
          ${a.message}
        </div>
        <div style="font-size:11px; color:#94a3b8; font-family:monospace;">
          Logged: ${formatTimestamp(a.timestamp)} ${a.plate_text ? `• Target: ${a.plate_text}` : ''}
        </div>
      </div>
      <div style="display:flex; flex-direction:column; gap:6px; align-items:flex-end;">
        ${a.plate_text ? `<a href="/vehicles?plate=${a.plate_text}" class="ack-btn" style="text-decoration:none; text-align:center;">Replay Route</a>` : ''}
        <button class="ack-btn" onclick="acknowledgeAlert(${a.id})">Acknowledge</button>
      </div>
    `;
    container.appendChild(item);
  });
}

async function acknowledgeAlert(alertId) {
  try {
    const resp = await fetch(`/api/alerts/${alertId}/ack`, { method: "POST" });
    if (resp.ok) {
      loadAlerts();
    }
  } catch (err) {
    console.error("Error acknowledging alert:", err);
  }
}

function formatTimestamp(isoStr) {
  if (!isoStr) return "--";
  const d = new Date(isoStr);
  return d.toTimeString().split(" ")[0] + " (" + (d.getMonth() + 1) + "/" + d.getDate() + ")";
}

function playChime(freq = 880) {
  try {
    const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(freq, audioCtx.currentTime);
    gain.gain.setValueAtTime(0.1, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.35);
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start();
    osc.stop(audioCtx.currentTime + 0.35);
  } catch (e) {}
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
      if (msg.type === "alert" && msg.data) {
        alertsList.unshift(msg.data);
        renderAlerts();
        playChime(msg.data.severity === "CRITICAL" ? 440 : 880);
      }
    } catch (e) {}
  };

  ws.onclose = () => {
    setTimeout(initWebSocket, 4000);
  };
}
