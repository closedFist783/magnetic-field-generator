// ─── Setup ────────────────────────────────────────────────────────────────────
const video  = document.getElementById('video');
const canvas = document.getElementById('canvas');
const ctx    = canvas.getContext('2d');

const W = 640, H = 480;
canvas.width  = W;
canvas.height = H;

let mode         = 'arrows';
let overlayAlpha = 0.70;
let demoMode     = false;
let dragging     = null;

// Offscreen canvas for heatmap
const offscreen = document.createElement('canvas');

// ─── Poles ────────────────────────────────────────────────────────────────────
// Each pole: { name, charge, hueMin, hueMax, cssColor, x, y, detected }
// Red  hue: 345–15 (wraps), Blue hue: 200–250
const poles = [
  {
    name: 'North', charge: +1,
    hueMin: 345, hueMax: 15,
    cssColor: '#f55',
    x: W * 0.35, y: H * 0.5,
    detected: false
  },
  {
    name: 'South', charge: -1,
    hueMin: 205, hueMax: 255,
    cssColor: '#55f',
    x: W * 0.65, y: H * 0.5,
    detected: false
  }
];

// ─── Webcam ───────────────────────────────────────────────────────────────────
navigator.mediaDevices
  .getUserMedia({ video: { width: W, height: H, facingMode: 'user' } })
  .then(stream => {
    video.srcObject = stream;
    video.play();
    requestAnimationFrame(loop);
  })
  .catch(() => {
    demoMode = true;
    document.getElementById('no-camera-overlay').style.display = 'block';
    requestAnimationFrame(loop);
  });

// ─── Demo-mode drag (mouse) ───────────────────────────────────────────────────
function getCanvasPos(e) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: (e.clientX - rect.left) * (W / rect.width),
    y: (e.clientY - rect.top)  * (H / rect.height)
  };
}

canvas.addEventListener('mousedown', e => {
  if (!demoMode) return;
  const { x, y } = getCanvasPos(e);
  for (const p of poles) {
    if ((x - p.x) ** 2 + (y - p.y) ** 2 < 1200) { dragging = p; return; }
  }
});
canvas.addEventListener('mousemove', e => {
  if (!dragging) return;
  const pos = getCanvasPos(e);
  dragging.x = pos.x;
  dragging.y = pos.y;
});
canvas.addEventListener('mouseup',    () => dragging = null);
canvas.addEventListener('mouseleave', () => dragging = null);

// Touch
canvas.addEventListener('touchstart', e => {
  if (!demoMode) return;
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
  document.querySelectorAll('#controls button').forEach(b => b.classList.remove('active'));
  document.getElementById('btn-' + m).classList.add('active');
}

document.getElementById('alpha-slider').addEventListener('input', e => {
  overlayAlpha = e.target.value / 100;
});

// ─── Main loop ────────────────────────────────────────────────────────────────
function loop() {
  ctx.clearRect(0, 0, W, H);

  if (!demoMode && video.readyState >= 2) {
    // Mirror the video horizontally for natural "mirror" feel
    ctx.save();
    ctx.translate(W, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(video, 0, 0, W, H);
    ctx.restore();

    // Track on the mirrored frame
    const frame = ctx.getImageData(0, 0, W, H);
    for (const p of poles) trackBall(frame, p);
  } else if (demoMode) {
    ctx.fillStyle = '#07070f';
    ctx.fillRect(0, 0, W, H);
    for (const p of poles) p.detected = true;
  }

  updateIndicators();

  const active = poles.filter(p => p.detected);
  if (active.length > 0) drawField(active);

  for (const p of poles) {
    if (p.detected) drawMarker(p);
  }

  requestAnimationFrame(loop);
}

// ─── Color tracking ───────────────────────────────────────────────────────────
function rgbToHsv(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  let h, s = max === 0 ? 0 : d / max, v = max;
  if (d === 0) {
    h = 0;
  } else {
    switch (max) {
      case r: h = ((g - b) / d % 6) * 60; break;
      case g: h = ((b - r) / d + 2) * 60; break;
      case b: h = ((r - g) / d + 4) * 60; break;
    }
    if (h < 0) h += 360;
  }
  return [h, s, v];
}

function inHue(h, min, max) {
  return min > max ? h >= min || h <= max : h >= min && h <= max;
}

function trackBall(frame, pole) {
  const data = frame.data;
  let sx = 0, sy = 0, n = 0;
  // Sample every 3rd pixel
  for (let y = 0; y < H; y += 3) {
    for (let x = 0; x < W; x += 3) {
      const i = (y * W + x) * 4;
      const [h, s, v] = rgbToHsv(data[i], data[i + 1], data[i + 2]);
      if (s > 0.42 && v > 0.28 && inHue(h, pole.hueMin, pole.hueMax)) {
        sx += x; sy += y; n++;
      }
    }
  }
  if (n > 25) {
    pole.x = sx / n;
    pole.y = sy / n;
    pole.detected = true;
  } else {
    pole.detected = false;
  }
}

// ─── Field math ───────────────────────────────────────────────────────────────
function fieldAt(x, y, activePoles) {
  let fx = 0, fy = 0;
  for (const p of activePoles) {
    const dx = x - p.x, dy = y - p.y;
    const r2 = dx * dx + dy * dy;
    if (r2 < 64) continue;
    const r  = Math.sqrt(r2);
    const k  = p.charge / r2;
    fx += k * dx / r;
    fy += k * dy / r;
  }
  return [fx, fy];
}

// ─── Visualization ────────────────────────────────────────────────────────────
function drawField(active) {
  if (mode === 'arrows') drawArrows(active);
  else if (mode === 'lines') drawFieldLines(active);
  else if (mode === 'heat') drawHeatmap(active);
}

// — Arrows —
function drawArrows(active) {
  const step = 28;
  ctx.save();
  ctx.globalAlpha = overlayAlpha;

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
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.moveTo(x2 - hl * Math.cos(angle - 0.45), y2 - hl * Math.sin(angle - 0.45));
      ctx.lineTo(x2, y2);
      ctx.lineTo(x2 - hl * Math.cos(angle + 0.45), y2 - hl * Math.sin(angle + 0.45));
      ctx.stroke();
    }
  }
  ctx.restore();
}

// — Field Lines —
function drawFieldLines(active) {
  const northPoles = active.filter(p => p.charge > 0);
  const nLines     = 18;
  const stepSize   = 5;
  const maxSteps   = 250;

  // If no north poles, seed from south (reversed)
  const seeds    = northPoles.length > 0 ? northPoles : active.filter(p => p.charge < 0);
  const reversed = northPoles.length === 0;

  ctx.save();
  ctx.globalAlpha = overlayAlpha;
  ctx.lineWidth   = 1.6;

  for (const pole of seeds) {
    for (let i = 0; i < nLines; i++) {
      const a = (i / nLines) * Math.PI * 2;
      let x   = pole.x + 20 * Math.cos(a);
      let y   = pole.y + 20 * Math.sin(a);

      const pts = [[x, y]];

      for (let s = 0; s < maxSteps; s++) {
        const [fx, fy] = fieldAt(x, y, active);
        const mag = Math.hypot(fx, fy);
        if (mag < 1e-8) break;

        x += (reversed ? -1 : 1) * (fx / mag) * stepSize;
        y += (reversed ? -1 : 1) * (fy / mag) * stepSize;

        if (x < 0 || x > W || y < 0 || y > H) break;

        pts.push([x, y]);

        const hitSink = active.find(p =>
          p.charge !== pole.charge && Math.hypot(p.x - x, p.y - y) < 18
        );
        if (hitSink) break;
      }

      if (pts.length < 3) continue;

      // Draw with a gradient red→blue
      const grad = ctx.createLinearGradient(
        pts[0][0], pts[0][1],
        pts[pts.length - 1][0], pts[pts.length - 1][1]
      );
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

// — Heatmap —
function drawHeatmap(active) {
  const scale = 5;
  const sw    = Math.ceil(W / scale);
  const sh    = Math.ceil(H / scale);

  offscreen.width  = sw;
  offscreen.height = sh;
  const octx = offscreen.getContext('2d');
  const img  = octx.createImageData(sw, sh);
  const d    = img.data;

  for (let py = 0; py < sh; py++) {
    for (let px = 0; px < sw; px++) {
      const [fx, fy] = fieldAt(px * scale, py * scale, active);
      const mag      = Math.hypot(fx, fy);
      const angle    = Math.atan2(fy, fx);
      const hue      = ((angle + Math.PI) / (2 * Math.PI)) * 360;
      const t        = Math.min(1, Math.log10(mag * 800 + 1) / 4);
      const [r, g, b] = hslToRgb(hue / 360, 0.9, 0.1 + t * 0.55);
      const i = (py * sw + px) * 4;
      d[i] = r; d[i + 1] = g; d[i + 2] = b;
      d[i + 3] = Math.round(overlayAlpha * 210);
    }
  }

  octx.putImageData(img, 0, 0);

  ctx.save();
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(offscreen, 0, 0, W, H);
  ctx.restore();
}

// ─── HSL→RGB ──────────────────────────────────────────────────────────────────
function hslToRgb(h, s, l) {
  const hue2rgb = (p, q, t) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  if (s === 0) return [l, l, l].map(v => Math.round(v * 255));
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  return [
    Math.round(hue2rgb(p, q, h + 1 / 3) * 255),
    Math.round(hue2rgb(p, q, h)         * 255),
    Math.round(hue2rgb(p, q, h - 1 / 3) * 255)
  ];
}

// ─── Pole markers ─────────────────────────────────────────────────────────────
function drawMarker(p) {
  ctx.save();
  ctx.strokeStyle  = p.cssColor;
  ctx.lineWidth    = 2.5;
  ctx.shadowColor  = p.cssColor;
  ctx.shadowBlur   = 12;
  ctx.beginPath();
  ctx.arc(p.x, p.y, 22, 0, Math.PI * 2);
  ctx.stroke();

  ctx.shadowBlur   = 0;
  ctx.fillStyle    = p.cssColor;
  ctx.font         = 'bold 12px Courier New';
  ctx.textAlign    = 'center';
  ctx.fillText(p.charge > 0 ? 'N (+)' : 'S (−)', p.x, p.y - 30);
  ctx.restore();
}

// ─── Indicators ───────────────────────────────────────────────────────────────
function updateIndicators() {
  document.getElementById('dot-north').className = 'dot' + (poles[0].detected ? ' on' : '');
  document.getElementById('dot-south').className = 'dot' + (poles[1].detected ? ' on' : '');
}
