// ─── Canvas / video setup ────────────────────────────────────────────────────
const video  = document.getElementById('video');
const canvas = document.getElementById('canvas');
const ctx    = canvas.getContext('2d');

const W = 640, H = 480;
canvas.width  = W;
canvas.height = H;

// Offscreen canvas for heatmap
const offscreen = document.createElement('canvas');

// ─── State ────────────────────────────────────────────────────────────────────
// 'init' → 'cal-0' → 'cal-1' → 'tracking'
let appState     = 'init';
let mode         = 'arrows';
let overlayAlpha = 0.70;
let demoMode     = false;
let dragging     = null;

// ─── Poles ────────────────────────────────────────────────────────────────────
const poles = [
  { name: 'North', charge: +1, label: 'N (+)', cssColor: '#f55', x: W * 0.35, y: H * 0.5, detected: false, color: null },
  { name: 'South', charge: -1, label: 'S (−)', cssColor: '#55f', x: W * 0.65, y: H * 0.5, detected: false, color: null },
];

// color: { hue, hTol, minS, minV }  — learned during calibration

// ─── Webcam ───────────────────────────────────────────────────────────────────
navigator.mediaDevices
  .getUserMedia({ video: { width: W, height: H, facingMode: 'user' } })
  .then(stream => {
    video.srcObject = stream;
    video.play();
    document.getElementById('color-debug').style.display = 'flex';
    appState = 'cal-0';
    updateCalibrationUI();
    requestAnimationFrame(loop);
  })
  .catch(() => {
    demoMode = true;
    document.getElementById('no-camera-overlay').style.display = 'block';
    // Demo mode: skip calibration, use default positions
    for (const p of poles) p.detected = true;
    appState = 'tracking';
    showTrackingUI();
    requestAnimationFrame(loop);
  });

// ─── Calibration UI ───────────────────────────────────────────────────────────
function updateCalibrationUI() {
  const idx = appState === 'cal-0' ? 0 : 1;
  const p   = poles[idx];
  document.getElementById('cal-panel').style.display = 'flex';
  document.getElementById('cal-title').textContent   = `Step ${idx + 1} of 2`;
  document.getElementById('cal-desc').innerHTML      =
    `Click on your <strong style="color:${p.cssColor}">${p.name} pole</strong> ball in the camera feed.`;
  document.getElementById('cal-swatch').style.background = '#111';
  document.getElementById('cal-swatch').textContent      = '?';
  document.getElementById('btn-cal-confirm').disabled    = true;
  document.getElementById('btn-cal-confirm').textContent = idx === 0 ? 'Next →' : 'Start Tracking →';
}

function showTrackingUI() {
  document.getElementById('cal-panel').style.display    = 'none';
  document.getElementById('tracking-ui').style.display  = 'flex';
}

// ─── Canvas click → sample color ─────────────────────────────────────────────
canvas.addEventListener('click', e => {
  if (appState !== 'cal-0' && appState !== 'cal-1') return;

  const rect = canvas.getBoundingClientRect();
  const cx   = Math.round((e.clientX - rect.left)  * (W / rect.width));
  const cy   = Math.round((e.clientY - rect.top)   * (H / rect.height));

  const sample = sampleRegion(cx, cy, 24);
  if (!sample) return;

  const idx = appState === 'cal-0' ? 0 : 1;
  poles[idx].color = sample;

  // Show swatch in cal panel
  const sw = document.getElementById('cal-swatch');
  sw.style.background = `hsl(${sample.hue},80%,50%)`;
  sw.textContent      = '';

  // Update debug bar
  updateDebugBar(idx, sample);

  // Store crosshair position so the loop keeps redrawing it
  poles[idx].crosshair = { x: cx, y: cy };

  document.getElementById('btn-cal-confirm').disabled = false;
});

document.getElementById('btn-cal-confirm').addEventListener('click', () => {
  if (appState === 'cal-0') {
    appState = 'cal-1';
    updateCalibrationUI();
  } else if (appState === 'cal-1') {
    appState = 'tracking';
    showTrackingUI();
  }
});

document.getElementById('btn-cal-redo').addEventListener('click', () => {
  appState = 'cal-0';
  for (const p of poles) p.color = null;
  updateCalibrationUI();
});

// ─── Sample a region's average HSV ───────────────────────────────────────────
// Reads directly from the already-rendered main canvas — no temp canvas needed.
function sampleRegion(cx, cy, radius) {
  const x0 = Math.max(0, cx - radius), y0 = Math.max(0, cy - radius);
  const x1 = Math.min(W, cx + radius), y1 = Math.min(H, cy + radius);
  const w  = x1 - x0, h = y1 - y0;
  if (w <= 0 || h <= 0) return null;

  let data;
  try { data = ctx.getImageData(x0, y0, w, h).data; }
  catch (e) { console.error('getImageData failed:', e); return null; }

  // Collect all pixels (no saturation gate — just collect everything)
  const hues = [], sats = [], vals = [];
  for (let i = 0; i < data.length; i += 4) {
    const [hh, ss, vv] = rgbToHsv(data[i], data[i + 1], data[i + 2]);
    hues.push(hh); sats.push(ss); vals.push(vv);
  }

  const avgHue = circularMeanHue(hues);
  const avgSat = sats.reduce((a, b) => a + b, 0) / sats.length;
  const avgVal = vals.reduce((a, b) => a + b, 0) / vals.length;

  // Log for debugging
  console.log(`Sampled hue=${avgHue.toFixed(1)}° sat=${(avgSat*100).toFixed(0)}% val=${(avgVal*100).toFixed(0)}%`);

  return {
    hue:  avgHue,
    hTol: 30,
    minS: Math.max(0.15, avgSat * 0.35),
    minV: Math.max(0.10, avgVal * 0.25),
    // Store raw for display
    avgSat, avgVal,
  };
}

function circularMeanHue(hues) {
  // Convert to radians, average as unit vectors
  let sx = 0, sy = 0;
  for (const h of hues) {
    const r = (h / 180) * Math.PI;
    sx += Math.cos(r); sy += Math.sin(r);
  }
  let mean = Math.atan2(sy / hues.length, sx / hues.length) * (180 / Math.PI);
  if (mean < 0) mean += 360;
  return mean;
}

function drawCrosshair(cx, cy, color) {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth   = 2;
  ctx.shadowColor = color;
  ctx.shadowBlur  = 8;
  const r = 24;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(cx - r - 8, cy); ctx.lineTo(cx + r + 8, cy);
  ctx.moveTo(cx, cy - r - 8); ctx.lineTo(cx, cy + r + 8);
  ctx.stroke();
  ctx.restore();
}

// ─── Demo-mode drag ───────────────────────────────────────────────────────────
function getCanvasPos(e) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: (e.clientX - rect.left) * (W / rect.width),
    y: (e.clientY - rect.top)  * (H / rect.height)
  };
}

canvas.addEventListener('mousedown', e => {
  if (!demoMode || appState !== 'tracking') return;
  const { x, y } = getCanvasPos(e);
  for (const p of poles) {
    if ((x - p.x) ** 2 + (y - p.y) ** 2 < 1200) { dragging = p; return; }
  }
});
canvas.addEventListener('mousemove', e => {
  if (!dragging) return;
  const pos = getCanvasPos(e);
  dragging.x = pos.x; dragging.y = pos.y;
});
canvas.addEventListener('mouseup',    () => dragging = null);
canvas.addEventListener('mouseleave', () => dragging = null);

canvas.addEventListener('touchstart', e => {
  if (!demoMode || appState !== 'tracking') return;
  e.preventDefault();
  const rect = canvas.getBoundingClientRect();
  const t = e.touches[0];
  const x = (t.clientX - rect.left) * (W / rect.width);
  const y = (t.clientY - rect.top)  * (H / rect.height);
  for (const p of poles) {
    if ((x - p.x) ** 2 + (y - p.y) ** 2 < 1200) { dragging = p; return; }
  }
}, { passive: false });
canvas.addEventListener('touchmove', e => {
  if (!dragging) return;
  e.preventDefault();
  const rect = canvas.getBoundingClientRect();
  const t = e.touches[0];
  dragging.x = (t.clientX - rect.left) * (W / rect.width);
  dragging.y = (t.clientY - rect.top)  * (H / rect.height);
}, { passive: false });
canvas.addEventListener('touchend', () => dragging = null);

// ─── Controls ─────────────────────────────────────────────────────────────────
function setMode(m) {
  mode = m;
  document.querySelectorAll('.btn-mode').forEach(b => b.classList.remove('active'));
  document.getElementById('btn-' + m).classList.add('active');
}

document.getElementById('alpha-slider').addEventListener('input', e => {
  overlayAlpha = e.target.value / 100;
});

document.getElementById('btn-recalibrate').addEventListener('click', () => {
  appState = 'cal-0';
  for (let i = 0; i < poles.length; i++) {
    poles[i].color = null;
    poles[i].detected = false;
    poles[i].crosshair = null;
    document.getElementById(`dbg-swatch-${i}`).style.background = '#111';
    document.getElementById(`dbg-val-${i}`).textContent = 'not sampled';
    document.getElementById(`dbg-fill-${i}`).style.width = '0';
    document.getElementById(`dbg-bar-${i}`).style.background = '#1a2030';
  }
  document.getElementById('tracking-ui').style.display = 'none';
  updateCalibrationUI();
});

// ─── Main loop ────────────────────────────────────────────────────────────────
function loop() {
  ctx.clearRect(0, 0, W, H);

  if (!demoMode && video.readyState >= 2) {
    ctx.save();
    ctx.translate(W, 0); ctx.scale(-1, 1);
    ctx.drawImage(video, 0, 0, W, H);
    ctx.restore();

    if (appState === 'tracking') {
      const frame = ctx.getImageData(0, 0, W, H);
      for (const p of poles) {
        if (p.color) trackBall(frame, p);
      }
    }
  } else if (demoMode) {
    ctx.fillStyle = '#07070f';
    ctx.fillRect(0, 0, W, H);
    for (const p of poles) p.detected = true;
  }

  // During calibration: keep crosshairs visible over the live feed
  if (appState === 'cal-0' || appState === 'cal-1') {
    for (const p of poles) {
      if (p.crosshair) drawCrosshair(p.crosshair.x, p.crosshair.y, p.cssColor);
    }
  }

  if (appState === 'tracking') {
    updateIndicators();
    refreshDebugBars();
    const active = poles.filter(p => p.detected);
    if (active.length > 0) drawField(active);
    for (const p of poles) {
      if (p.detected) drawMarker(p);
    }
  }

  requestAnimationFrame(loop);
}

// ─── Color tracking ───────────────────────────────────────────────────────────
function rgbToHsv(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  let h, s = max === 0 ? 0 : d / max, v = max;
  if (d === 0) { h = 0; }
  else {
    switch (max) {
      case r: h = ((g - b) / d % 6) * 60; break;
      case g: h = ((b - r) / d + 2) * 60; break;
      case b: h = ((r - g) / d + 4) * 60; break;
    }
    if (h < 0) h += 360;
  }
  return [h, s, v];
}

function inHueTol(h, center, tol) {
  let diff = Math.abs(h - center) % 360;
  if (diff > 180) diff = 360 - diff;
  return diff <= tol;
}

// ─── Blob-based tracking ──────────────────────────────────────────────────────
// Finds all pixel clusters matching a pole's color, then picks the cluster
// nearest to the pole's last known position — so two same-color balls
// track independently.

const GRID = 8; // sample every Npx for performance

function trackBall(frame, pole) {
  const data = frame.data;
  const { hue, hTol, minS, minV } = pole.color;

  // 1. Collect matching grid cells
  const pts = [];
  for (let y = 0; y < H; y += GRID) {
    for (let x = 0; x < W; x += GRID) {
      const i = (y * W + x) * 4;
      const [h, s, v] = rgbToHsv(data[i], data[i + 1], data[i + 2]);
      if (s >= minS && v >= minV && inHueTol(h, hue, hTol)) {
        pts.push({ x, y });
      }
    }
  }

  if (pts.length < 4) { pole.detected = false; return; }

  // 2. Cluster by proximity (BFS, merge cells within ~3 grid-steps)
  const clusters = clusterPts(pts, GRID * 4);
  if (clusters.length === 0) { pole.detected = false; return; }

  // 3. Pick the cluster nearest to last known position
  //    (weighted: prefer large clusters, penalise distance)
  let best = clusters[0];
  let bestScore = Infinity;
  for (const c of clusters) {
    if (c.size < 3) continue;                          // ignore tiny specks
    const dist = Math.hypot(c.x - pole.x, c.y - pole.y);
    const score = dist - c.size * GRID * 0.8;          // reward big blobs
    if (score < bestScore) { bestScore = score; best = c; }
  }

  // 4. Smooth position with exponential moving average
  const alpha = pole.detected ? 0.45 : 1.0;
  pole.x = pole.x * (1 - alpha) + best.x * alpha;
  pole.y = pole.y * (1 - alpha) + best.y * alpha;
  pole.detected = true;
}

function clusterPts(pts, maxDist) {
  const used = new Uint8Array(pts.length);
  const clusters = [];
  const maxD2 = maxDist * maxDist;

  for (let i = 0; i < pts.length; i++) {
    if (used[i]) continue;
    const members = [i];
    used[i] = 1;
    // BFS
    for (let qi = 0; qi < members.length; qi++) {
      const ci = members[qi];
      for (let j = 0; j < pts.length; j++) {
        if (used[j]) continue;
        const dx = pts[j].x - pts[ci].x, dy = pts[j].y - pts[ci].y;
        if (dx * dx + dy * dy <= maxD2) { used[j] = 1; members.push(j); }
      }
    }
    // Centroid
    let sx = 0, sy = 0;
    for (const idx of members) { sx += pts[idx].x; sy += pts[idx].y; }
    clusters.push({ x: sx / members.length, y: sy / members.length, size: members.length });
  }
  return clusters;
}

// ─── Field math ───────────────────────────────────────────────────────────────
function fieldAt(x, y, activePoles) {
  let fx = 0, fy = 0;
  for (const p of activePoles) {
    const dx = x - p.x, dy = y - p.y;
    const r2 = dx * dx + dy * dy;
    if (r2 < 64) continue;
    const r = Math.sqrt(r2);
    const k = p.charge / r2;
    fx += k * dx / r; fy += k * dy / r;
  }
  return [fx, fy];
}

// ─── Visualization ────────────────────────────────────────────────────────────
function drawField(active) {
  if (mode === 'arrows') drawArrows(active);
  else if (mode === 'lines') drawFieldLines(active);
  else if (mode === 'heat') drawHeatmap(active);
}

function drawArrows(active) {
  const step = 28;
  ctx.save(); ctx.globalAlpha = overlayAlpha;
  for (let y = step / 2; y < H; y += step) {
    for (let x = step / 2; x < W; x += step) {
      const [fx, fy] = fieldAt(x, y, active);
      const mag = Math.hypot(fx, fy);
      if (mag < 1e-8) continue;
      const nx = fx / mag, ny = fy / mag;
      const len = Math.min(step * 0.78, 400 * mag);
      if (len < 3) continue;
      const angle = Math.atan2(fy, fx);
      const hue   = ((angle + Math.PI) / (2 * Math.PI)) * 360;
      const bri   = Math.min(88, 48 + Math.log10(mag * 1000 + 1) * 15);
      const x1 = x - nx * len / 2, y1 = y - ny * len / 2;
      const x2 = x + nx * len / 2, y2 = y + ny * len / 2;
      const hl  = Math.max(5, len * 0.28);
      ctx.strokeStyle = `hsl(${hue},95%,${bri}%)`;
      ctx.lineWidth   = 1.6;
      ctx.beginPath();
      ctx.moveTo(x1, y1); ctx.lineTo(x2, y2);
      ctx.moveTo(x2 - hl * Math.cos(angle - 0.45), y2 - hl * Math.sin(angle - 0.45));
      ctx.lineTo(x2, y2);
      ctx.lineTo(x2 - hl * Math.cos(angle + 0.45), y2 - hl * Math.sin(angle + 0.45));
      ctx.stroke();
    }
  }
  ctx.restore();
}

function drawFieldLines(active) {
  const northPoles = active.filter(p => p.charge > 0);
  const nLines = 18, stepSize = 5, maxSteps = 250;
  const seeds    = northPoles.length > 0 ? northPoles : active.filter(p => p.charge < 0);
  const reversed = northPoles.length === 0;
  ctx.save(); ctx.globalAlpha = overlayAlpha; ctx.lineWidth = 1.6;
  for (const pole of seeds) {
    for (let i = 0; i < nLines; i++) {
      const a = (i / nLines) * Math.PI * 2;
      let x = pole.x + 20 * Math.cos(a);
      let y = pole.y + 20 * Math.sin(a);
      const pts = [[x, y]];
      for (let s = 0; s < maxSteps; s++) {
        const [fx, fy] = fieldAt(x, y, active);
        const mag = Math.hypot(fx, fy);
        if (mag < 1e-8) break;
        x += (reversed ? -1 : 1) * (fx / mag) * stepSize;
        y += (reversed ? -1 : 1) * (fy / mag) * stepSize;
        if (x < 0 || x > W || y < 0 || y > H) break;
        pts.push([x, y]);
        const hitSink = active.find(p => p.charge !== pole.charge && Math.hypot(p.x - x, p.y - y) < 18);
        if (hitSink) break;
      }
      if (pts.length < 3) continue;
      const grad = ctx.createLinearGradient(pts[0][0], pts[0][1], pts[pts.length-1][0], pts[pts.length-1][1]);
      grad.addColorStop(0,   reversed ? '#55f' : '#f55');
      grad.addColorStop(0.5, '#aaf');
      grad.addColorStop(1,   reversed ? '#f55' : '#55f');
      ctx.strokeStyle = grad;
      ctx.beginPath();
      ctx.moveTo(pts[0][0], pts[0][1]);
      for (let k = 1; k < pts.length; k++) ctx.lineTo(pts[k][0], pts[k][1]);
      ctx.stroke();
    }
  }
  ctx.restore();
}

function drawHeatmap(active) {
  const scale = 5;
  const sw = Math.ceil(W / scale), sh = Math.ceil(H / scale);
  offscreen.width = sw; offscreen.height = sh;
  const octx = offscreen.getContext('2d');
  const img  = octx.createImageData(sw, sh);
  const d    = img.data;
  for (let py = 0; py < sh; py++) {
    for (let px = 0; px < sw; px++) {
      const [fx, fy] = fieldAt(px * scale, py * scale, active);
      const mag   = Math.hypot(fx, fy);
      const angle = Math.atan2(fy, fx);
      const hue   = ((angle + Math.PI) / (2 * Math.PI)) * 360;
      const t     = Math.min(1, Math.log10(mag * 800 + 1) / 4);
      const [r, g, b] = hslToRgb(hue / 360, 0.9, 0.1 + t * 0.55);
      const i = (py * sw + px) * 4;
      d[i] = r; d[i+1] = g; d[i+2] = b; d[i+3] = Math.round(overlayAlpha * 210);
    }
  }
  octx.putImageData(img, 0, 0);
  ctx.save();
  ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(offscreen, 0, 0, W, H);
  ctx.restore();
}

function hslToRgb(h, s, l) {
  const hue2rgb = (p, q, t) => {
    if (t < 0) t += 1; if (t > 1) t -= 1;
    if (t < 1/6) return p + (q-p)*6*t;
    if (t < 1/2) return q;
    if (t < 2/3) return p + (q-p)*(2/3-t)*6;
    return p;
  };
  if (s === 0) return [l,l,l].map(v => Math.round(v*255));
  const q = l < 0.5 ? l*(1+s) : l+s-l*s, p = 2*l-q;
  return [
    Math.round(hue2rgb(p, q, h+1/3)*255),
    Math.round(hue2rgb(p, q, h    )*255),
    Math.round(hue2rgb(p, q, h-1/3)*255),
  ];
}

// ─── Debug bar ────────────────────────────────────────────────────────────────
function updateDebugBar(idx, color) {
  if (!color) return;
  const hue  = Math.round(color.hue);
  const tol  = color.hTol;
  const sat  = Math.round((color.avgSat || color.minS / 0.35) * 100);
  const val  = Math.round((color.avgVal || color.minV / 0.25) * 100);
  const minS = Math.round(color.minS * 100);
  const minV = Math.round(color.minV * 100);

  // Swatch uses the actual average hue+sat+val so it matches what was clicked
  document.getElementById(`dbg-swatch-${idx}`).style.background =
    `hsl(${hue}, ${Math.min(100, sat)}%, ${Math.round(val / 2)}%)`;

  document.getElementById(`dbg-val-${idx}`).textContent =
    `hue ${hue}° ±${tol}°   sat ${sat}% (min ${minS}%)   val ${val}% (min ${minV}%)`;

  // Hue range bar
  const bar  = document.getElementById(`dbg-bar-${idx}`);
  const fill = document.getElementById(`dbg-fill-${idx}`);
  const lo   = ((hue - tol + 360) % 360) / 360 * 100;
  const width = Math.min(100, (tol * 2) / 360 * 100);
  fill.style.left       = `${lo}%`;
  fill.style.width      = `${width}%`;
  fill.style.background = `hsl(${hue}, 100%, 65%)`;
  fill.style.boxShadow  = `0 0 4px hsl(${hue},100%,65%)`;

  bar.style.background =
    'linear-gradient(to right,' +
    'hsl(0,85%,45%),hsl(30,85%,45%),hsl(60,85%,45%),' +
    'hsl(90,85%,45%),hsl(120,85%,45%),hsl(150,85%,45%),' +
    'hsl(180,85%,45%),hsl(210,85%,45%),hsl(240,85%,45%),' +
    'hsl(270,85%,45%),hsl(300,85%,45%),hsl(330,85%,45%),hsl(360,85%,45%))';
}

// Keep debug bar live during tracking so you can see if it drifts
function refreshDebugBars() {
  for (let i = 0; i < poles.length; i++) {
    if (poles[i].color) updateDebugBar(i, poles[i].color);
  }
}

function drawMarker(p) {
  ctx.save();
  ctx.strokeStyle = p.cssColor; ctx.lineWidth = 2.5;
  ctx.shadowColor = p.cssColor; ctx.shadowBlur = 12;
  ctx.beginPath(); ctx.arc(p.x, p.y, 22, 0, Math.PI * 2); ctx.stroke();
  ctx.shadowBlur = 0; ctx.fillStyle = p.cssColor;
  ctx.font = 'bold 12px Courier New'; ctx.textAlign = 'center';
  ctx.fillText(p.label, p.x, p.y - 30);
  ctx.restore();
}

function updateIndicators() {
  document.getElementById('dot-north').className = 'dot' + (poles[0].detected ? ' on' : '');
  document.getElementById('dot-south').className = 'dot' + (poles[1].detected ? ' on' : '');
}
