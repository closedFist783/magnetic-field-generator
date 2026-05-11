// ─── Setup ────────────────────────────────────────────────────────────────────
const video  = document.getElementById('video');
const canvas = document.getElementById('canvas');
const ctx    = canvas.getContext('2d');

const W = 640, H = 480;
canvas.width  = W;
canvas.height = H;

const offscreen = document.createElement('canvas');

// States: capture | place-0 | place-1 | tracking
let appState   = 'capture';
let savedImage = null;   // ImageBitmap of the captured/uploaded photo
let mode       = 'lines';
let dragging   = null;
let hoverPos   = null;
let showBg     = true;

// ─── Physics params ───────────────────────────────────────────────────────────
const phys = {
  nLines: 16,
  alpha: 0.70,
  decay: 3.0,
  cutoff: 8,
};

// ─── Poles (moving point charges) ────────────────────────────────────────────
const poles = [
  { name: 'North', charge: +1, cssColor: '#f55', label: 'N', x: W * 0.35, y: H * 0.5, speed: 1.0, velAngle: 0 },
  { name: 'South', charge: -1, cssColor: '#55f', label: 'S', x: W * 0.65, y: H * 0.5, speed: 1.0, velAngle: Math.PI },
];

// ─── Camera init ──────────────────────────────────────────────────────────────
navigator.mediaDevices
  .getUserMedia({ video: { width: { ideal: W }, height: { ideal: H } } })
  .then(stream => {
    video.srcObject = stream;
    video.play();
    document.getElementById('btn-capture').disabled = false;
  })
  .catch(() => {
    // No camera — upload only mode
    document.getElementById('btn-capture').disabled = true;
    ctx.fillStyle = '#07070f'; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#2a3a4a';
    ctx.font = '13px Courier New'; ctx.textAlign = 'center';
    ctx.fillText('No camera found — use Upload Image', W / 2, H / 2);
  });

// ─── Capture button ───────────────────────────────────────────────────────────
document.getElementById('btn-capture').addEventListener('click', () => {
  if (video.readyState < 2) return;
  // Draw the current video frame to canvas (mirror it back to normal)
  ctx.save(); ctx.translate(W, 0); ctx.scale(-1, 1);
  ctx.drawImage(video, 0, 0, W, H); ctx.restore();
  freezeAndPlace();
});

// ─── Upload button ────────────────────────────────────────────────────────────
document.getElementById('btn-upload').addEventListener('click', () => {
  document.getElementById('file-input').click();
});

document.getElementById('file-input').addEventListener('change', e => {
  const file = e.target.files[0]; if (!file) return;
  const url = URL.createObjectURL(file);
  const img = new Image();
  img.onload = () => {
    // Scale to fill W×H preserving aspect ratio (letterbox)
    const scale = Math.min(W / img.width, H / img.height);
    const dw = Math.round(img.width  * scale);
    const dh = Math.round(img.height * scale);
    const ox = Math.round((W - dw) / 2);
    const oy = Math.round((H - dh) / 2);
    ctx.fillStyle = '#07070f'; ctx.fillRect(0, 0, W, H);
    ctx.drawImage(img, ox, oy, dw, dh);
    URL.revokeObjectURL(url);
    freezeAndPlace();
  };
  img.src = url;
  e.target.value = '';
});

// ─── Freeze frame → go to placement ──────────────────────────────────────────
function freezeAndPlace() {
  createImageBitmap(canvas).then(bmp => {
    savedImage = bmp;
    // Stop camera stream — don't need it anymore
    if (video.srcObject) {
      video.srcObject.getTracks().forEach(t => t.stop());
      video.srcObject = null;
    }
    appState = 'place-0';
    document.getElementById('capture-panel').style.display = 'none';
    document.getElementById('place-panel').style.display   = 'flex';
    updatePlaceUI();
  });
}

function updatePlaceUI() {
  const idx = appState === 'place-0' ? 0 : 1;
  const p   = poles[idx];
  document.getElementById('place-title').textContent = `Step ${idx + 1} of 2 — Place ${p.name} Pole`;
  document.getElementById('place-desc').innerHTML =
    `Click the center of the <strong style="color:${p.cssColor}">${p.name}</strong> sphere in the image.`;
}

// ─── Canvas click — placement ─────────────────────────────────────────────────
canvas.addEventListener('click', e => {
  if (appState !== 'place-0' && appState !== 'place-1') return;
  const { x, y } = canvasPos(e);
  const idx = appState === 'place-0' ? 0 : 1;
  poles[idx].x = x;
  poles[idx].y = y;

  if (appState === 'place-0') {
    appState = 'place-1';
    updatePlaceUI();
  } else {
    appState = 'tracking';
    document.getElementById('place-panel').style.display   = 'none';
    document.getElementById('tracking-ui').style.display   = 'flex';
    updatePosLabels();
  }
});

// ─── Hover — show crosshair cursor during placement, drag during tracking ─────
canvas.addEventListener('mousemove', e => {
  hoverPos = canvasPos(e);
  if (dragging) {
    dragging.x = hoverPos.x;
    dragging.y = hoverPos.y;
    updatePosLabels();
  }
});
canvas.addEventListener('mouseleave', () => { hoverPos = null; dragging = null; });

canvas.addEventListener('mousedown', e => {
  if (appState !== 'tracking') return;
  const { x, y } = canvasPos(e);
  for (const p of poles) if ((x - p.x) ** 2 + (y - p.y) ** 2 < 900) { dragging = p; return; }
});
canvas.addEventListener('mouseup', () => { dragging = null; });

// Touch support
canvas.addEventListener('touchstart', e => {
  e.preventDefault();
  if (appState === 'place-0' || appState === 'place-1') {
    // Trigger placement click
    const t = e.touches[0];
    canvas.dispatchEvent(new MouseEvent('click', { clientX: t.clientX, clientY: t.clientY }));
    return;
  }
  if (appState !== 'tracking') return;
  const pos = touchPos(e);
  for (const p of poles) if ((pos.x - p.x) ** 2 + (pos.y - p.y) ** 2 < 900) { dragging = p; return; }
}, { passive: false });
canvas.addEventListener('touchmove', e => {
  if (!dragging) return; e.preventDefault();
  const pos = touchPos(e);
  dragging.x = pos.x; dragging.y = pos.y;
  updatePosLabels();
}, { passive: false });
canvas.addEventListener('touchend', () => { dragging = null; });

// ─── Buttons ──────────────────────────────────────────────────────────────────
document.getElementById('btn-place-redo').addEventListener('click', retakePhoto);
document.getElementById('btn-retake').addEventListener('click', retakePhoto);
document.getElementById('btn-bg-toggle').addEventListener('click', () => {
  showBg = !showBg;
  document.getElementById('btn-bg-toggle').textContent = showBg ? '🖼 Hide Image' : '🖼 Show Image';
  document.getElementById('btn-bg-toggle').classList.toggle('active', !showBg);
});

document.getElementById('btn-replace').addEventListener('click', () => {
  appState = 'place-0';
  document.getElementById('tracking-ui').style.display = 'none';
  document.getElementById('place-panel').style.display = 'flex';
  updatePlaceUI();
});

function retakePhoto() {
  savedImage = null;
  appState   = 'capture';
  document.getElementById('tracking-ui').style.display = 'none';
  document.getElementById('place-panel').style.display = 'none';
  document.getElementById('capture-panel').style.display = 'flex';
  // Restart camera
  navigator.mediaDevices
    .getUserMedia({ video: { width: { ideal: W }, height: { ideal: H } } })
    .then(stream => {
      video.srcObject = stream; video.play();
      document.getElementById('btn-capture').disabled = false;
    })
    .catch(() => {
      document.getElementById('btn-capture').disabled = true;
    });
}

// ─── Physics panel toggle ─────────────────────────────────────────────────────
function togglePhysics() {
  const body  = document.getElementById('physics-body');
  const arrow = document.getElementById('physics-arrow');
  const open  = body.style.display !== 'none';
  body.style.display = open ? 'none' : 'grid';
  arrow.textContent  = open ? '▶' : '▼';
}

// ─── Slider wiring ────────────────────────────────────────────────────────────
function wire(id, lblId, key, fmt) {
  const el = document.getElementById(id);
  const update = () => {
    phys[key] = parseFloat(el.value);
    if (lblId) document.getElementById(lblId).textContent = fmt(phys[key]);
  };
  el.addEventListener('input', update);
  update();
}

// Particle velocity sliders — wire directly to poles array
(function() {
  const wP = (id, lbl, pole, key, transform, fmt) => {
    const el = document.getElementById(id);
    const upd = () => {
      const v = parseFloat(el.value);
      pole[key] = transform ? transform(v) : v;
      if (lbl) document.getElementById(lbl).textContent = fmt(v);
    };
    el.addEventListener('input', upd); upd();
  };
  wP('sl-speedN','lbl-speedN', poles[0], 'speed',    null,               v => v.toFixed(1));
  wP('sl-speedS','lbl-speedS', poles[1], 'speed',    null,               v => v.toFixed(1));
  wP('sl-dirN',  'lbl-dirN',   poles[0], 'velAngle', v => v*Math.PI/180, v => Math.round(v)+'°');
  wP('sl-dirS',  'lbl-dirS',   poles[1], 'velAngle', v => v*Math.PI/180, v => Math.round(v)+'°');
})();

wire('sl-nlines','lbl-nlines', 'nLines',v => Math.round(v));
wire('sl-alpha', 'lbl-alpha',  'alpha', v => { phys.alpha = v / 100; return v + '%'; });
wire('sl-decay', 'lbl-decay',  'decay', v => v.toFixed(1));
wire('sl-cut',   'lbl-cut',    'cutoff',v => v + 'px');

// ─── Visualization mode ───────────────────────────────────────────────────────
function setMode(m) {
  mode = m;
  document.querySelectorAll('.btn-mode').forEach(b => b.classList.remove('active'));
  document.getElementById('btn-' + m).classList.add('active');
}

// ─── Utilities ────────────────────────────────────────────────────────────────
function canvasPos(e) {
  const r = canvas.getBoundingClientRect();
  return {
    x: (e.clientX - r.left) * (W / r.width),
    y: (e.clientY - r.top)  * (H / r.height),
  };
}
function touchPos(e) {
  const r = canvas.getBoundingClientRect(), t = e.touches[0];
  return {
    x: (t.clientX - r.left) * (W / r.width),
    y: (t.clientY - r.top)  * (H / r.height),
  };
}
function updatePosLabels() {
  document.getElementById('pos-north').textContent = `(${Math.round(poles[0].x)}, ${Math.round(poles[0].y)})`;
  document.getElementById('pos-south').textContent = `(${Math.round(poles[1].x)}, ${Math.round(poles[1].y)})`;
}

// ─── Main loop ────────────────────────────────────────────────────────────────
function loop() {
  ctx.clearRect(0, 0, W, H);

  if (appState === 'capture') {
    // Live camera preview
    if (video.readyState >= 2) {
      ctx.save(); ctx.translate(W, 0); ctx.scale(-1, 1);
      ctx.drawImage(video, 0, 0, W, H); ctx.restore();
    }
  } else if (savedImage) {
    // Static frozen image
    if (showBg) {
      ctx.drawImage(savedImage, 0, 0, W, H);
    } else {
      ctx.fillStyle = '#07070f'; ctx.fillRect(0, 0, W, H);
    }

    if (appState === 'place-0' || appState === 'place-1') {
      // Draw already-confirmed pole (step 1 done)
      if (appState === 'place-1') drawMarker(poles[0]);
      // Crosshair cursor
      if (hoverPos) {
        const idx = appState === 'place-0' ? 0 : 1;
        drawCrosshair(hoverPos.x, hoverPos.y, poles[idx].cssColor);
      }
    }

    if (appState === 'tracking') {
      drawField(poles);
      for (const p of poles) drawMarker(p);
    }
  }

  requestAnimationFrame(loop);
}

// Start loop
requestAnimationFrame(loop);

// ─── Biot-Savart field math (moving point charges) ───────────────────────────
// B_z = q * (vx*dy - vy*dx) / r^decay   (z-component, Biot-Savart)
function bzAt(x, y, active) {
  let bz = 0;
  for (const p of active) {
    if (p.speed === 0) continue;
    const dx = x - p.x, dy = y - p.y, r2 = dx*dx + dy*dy;
    if (r2 < phys.cutoff**2) continue;
    const rn = Math.pow(Math.sqrt(r2), phys.decay);
    const vx = p.charge * p.speed * Math.cos(p.velAngle);
    const vy = p.charge * p.speed * Math.sin(p.velAngle);
    bz += (vx * dy - vy * dx) / rn;
  }
  return bz;
}

// 2D iso-contour flow of B_z: tangent = (-∂Bz/∂y, ∂Bz/∂x)
// Used for field-line tracing and vector arrows
function fieldAt(x, y, active) {
  let fx = 0, fy = 0;
  for (const p of active) {
    if (p.speed === 0) continue;
    const dx = x - p.x, dy = y - p.y, r2 = dx*dx + dy*dy;
    if (r2 < phys.cutoff**2) continue;
    const r   = Math.sqrt(r2);
    const rn2 = Math.pow(r, phys.decay + 2);
    const vx  = p.charge * p.speed * Math.cos(p.velAngle);
    const vy  = p.charge * p.speed * Math.sin(p.velAngle);
    const cross = vx * dy - vy * dx;
    // -∂Bz/∂y = (-vx·r² + decay·cross·dy) / r^(decay+2)
    //  ∂Bz/∂x = (-vy·r² - decay·cross·dx) / r^(decay+2)
    fx += (-vx * r2 + phys.decay * cross * dy) / rn2;
    fy += (-vy * r2 - phys.decay * cross * dx) / rn2;
  }
  return [fx, fy];
}

// ─── Visualization ────────────────────────────────────────────────────────────
function drawField(active) {
  if      (mode === 'lines')  drawFieldLines(active);
  else if (mode === 'arrows') drawArrows(active);
  else if (mode === 'heat')   drawHeatmap(active);
}

// — Field lines with arrows —
function drawFieldLines(active) {
  const stepSz     = 4;
  const maxStep    = 400;
  const arrowEvery = 36;

  ctx.save();
  ctx.globalAlpha = phys.alpha;
  ctx.lineWidth   = 1.8;

  for (const pole of active) {
    for (let i = 0; i < phys.nLines; i++) {
      const a = (i / phys.nLines) * Math.PI * 2;
      let x   = pole.x + 22 * Math.cos(a);
      let y   = pole.y + 22 * Math.sin(a);
      const pts = [{ x, y }];
      let travelSinceArrow = 0;
      const arrowPts = [];

      for (let s = 0; s < maxStep; s++) {
        const [fx, fy] = fieldAt(x, y, active);
        const mag = Math.hypot(fx, fy);
        if (mag < 1e-9) break;
        const nx = fx / mag, ny = fy / mag;

        const minDist = Math.min(...active.map(p => Math.hypot(x - p.x, y - p.y)));
        const step = Math.max(1.5, Math.min(stepSz, minDist * 0.3));

        x += nx * step; y += ny * step;
        if (x < -10 || x > W + 10 || y < -10 || y > H + 10) break;

        pts.push({ x, y });
        travelSinceArrow += step;
        if (travelSinceArrow >= arrowEvery) {
          arrowPts.push({ x, y, dx: nx, dy: ny });
          travelSinceArrow = 0;
        }
        if (active.some(p => Math.hypot(p.x - x, p.y - y) < 14)) break;
      }

      if (pts.length < 4) continue;

      const grad = ctx.createLinearGradient(pts[0].x, pts[0].y, pts[pts.length - 1].x, pts[pts.length - 1].y);
      grad.addColorStop(0,   '#f66');
      grad.addColorStop(0.5, '#adf');
      grad.addColorStop(1,   '#66f');
      ctx.strokeStyle = grad;
      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      for (let k = 1; k < pts.length; k++) ctx.lineTo(pts[k].x, pts[k].y);
      ctx.stroke();

      for (const ap of arrowPts) {
        const angle = Math.atan2(ap.dy, ap.dx);
        const hl = 8;
        ctx.strokeStyle = '#fff';
        ctx.lineWidth   = 1.5;
        ctx.globalAlpha = phys.alpha * 0.9;
        ctx.beginPath();
        ctx.moveTo(ap.x - hl * Math.cos(angle - 0.4), ap.y - hl * Math.sin(angle - 0.4));
        ctx.lineTo(ap.x, ap.y);
        ctx.lineTo(ap.x - hl * Math.cos(angle + 0.4), ap.y - hl * Math.sin(angle + 0.4));
        ctx.stroke();
        ctx.lineWidth = 1.8;
        ctx.globalAlpha = phys.alpha;
      }
    }
  }
  ctx.restore();
}

// — Vector arrows —
function drawArrows(active) {
  const step = 28;
  ctx.save(); ctx.globalAlpha = phys.alpha;
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
      const hl = Math.max(5, len * 0.3);
      ctx.strokeStyle = `hsl(${hue},95%,${bri}%)`; ctx.lineWidth = 1.6;
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

// — Heatmap — signed B_z: blue = out of screen, red = into screen
function drawHeatmap(active) {
  const scale = 5, sw = Math.ceil(W / scale), sh = Math.ceil(H / scale);
  offscreen.width = sw; offscreen.height = sh;
  const octx = offscreen.getContext('2d');
  const img  = octx.createImageData(sw, sh);
  const d    = img.data;
  for (let py = 0; py < sh; py++) {
    for (let px = 0; px < sw; px++) {
      const bz = bzAt(px * scale, py * scale, active);
      const t  = Math.min(1, Math.log10(Math.abs(bz) * 800 + 1) / 4);
      let r, g, b;
      if (bz >= 0) {
        r = Math.round(30 * t); g = Math.round(80 * t); b = Math.round(255 * t);
      } else {
        r = Math.round(255 * t); g = Math.round(60 * t); b = Math.round(30 * t);
      }
      const i = (py * sw + px) * 4;
      d[i] = r; d[i + 1] = g; d[i + 2] = b; d[i + 3] = Math.round(phys.alpha * 210);
    }
  }
  octx.putImageData(img, 0, 0);
  ctx.save(); ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(offscreen, 0, 0, W, H); ctx.restore();
}

// ─── Markers & crosshairs ─────────────────────────────────────────────────────
function drawMarker(p) {
  ctx.save();
  // Velocity arrow (only when moving)
  if (p.speed > 0) {
    const arrowLen = 12 + p.speed * 5;
    const ex = p.x + Math.cos(p.velAngle) * arrowLen;
    const ey = p.y + Math.sin(p.velAngle) * arrowLen;
    const hl = 7;
    ctx.strokeStyle = p.cssColor; ctx.lineWidth = 2; ctx.globalAlpha = 0.8;
    ctx.shadowColor = p.cssColor; ctx.shadowBlur = 6;
    ctx.beginPath();
    ctx.moveTo(p.x, p.y); ctx.lineTo(ex, ey);
    ctx.moveTo(ex - hl*Math.cos(p.velAngle-0.4), ey - hl*Math.sin(p.velAngle-0.4));
    ctx.lineTo(ex, ey);
    ctx.lineTo(ex - hl*Math.cos(p.velAngle+0.4), ey - hl*Math.sin(p.velAngle+0.4));
    ctx.stroke();
    ctx.shadowBlur = 0;
  }
  // Ring
  ctx.globalAlpha = 1;
  ctx.strokeStyle = p.cssColor; ctx.lineWidth = 2.5;
  ctx.shadowColor = p.cssColor; ctx.shadowBlur = 12;
  ctx.beginPath(); ctx.arc(p.x, p.y, 20, 0, Math.PI * 2); ctx.stroke();
  ctx.shadowBlur = 0;
  // Label
  ctx.fillStyle = p.cssColor;
  ctx.font = 'bold 12px Courier New'; ctx.textAlign = 'center';
  ctx.fillText(p.label, p.x, p.y - 28);
  ctx.restore();
}

function drawCrosshair(cx, cy, color) {
  ctx.save();
  ctx.strokeStyle = color; ctx.lineWidth = 2;
  ctx.shadowColor = color; ctx.shadowBlur = 8;
  const r = 24;
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(cx - r - 8, cy); ctx.lineTo(cx + r + 8, cy);
  ctx.moveTo(cx, cy - r - 8); ctx.lineTo(cx, cy + r + 8);
  ctx.stroke(); ctx.restore();
}

// ─── Color util ───────────────────────────────────────────────────────────────
function hslToRgb(h, s, l) {
  const f = (p, q, t) => {
    if (t < 0) t += 1; if (t > 1) t -= 1;
    if (t < 1/6) return p + (q - p) * 6 * t;
    if (t < 1/2) return q;
    if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
    return p;
  };
  if (s === 0) return [l, l, l].map(v => Math.round(v * 255));
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
  return [
    Math.round(f(p, q, h + 1/3) * 255),
    Math.round(f(p, q, h)       * 255),
    Math.round(f(p, q, h - 1/3) * 255),
  ];
}
