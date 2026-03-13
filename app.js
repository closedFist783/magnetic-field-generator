// ─── Setup ────────────────────────────────────────────────────────────────────
const video  = document.getElementById('video');
const canvas = document.getElementById('canvas');
const ctx    = canvas.getContext('2d');

const W = 640, H = 480;
canvas.width  = W;
canvas.height = H;

const offscreen = document.createElement('canvas');

let appState     = 'init';
let mode         = 'lines';
let demoMode     = false;
let dragging     = null;
let lastFrameTime = performance.now();

// ─── Physics params (read from sliders) ──────────────────────────────────────
const phys = {
  qN: 1.0, qS: 1.0,
  angleN: 0, angleS: Math.PI,
  velMode: true,
  nLines: 16,
  alpha: 0.70,
  decay: 3.0,
  cutoff: 8,
};

// ─── Poles ────────────────────────────────────────────────────────────────────
const poles = [
  {
    name: 'North', charge: +1, cssColor: '#f55', label: 'N',
    x: W * 0.35, y: H * 0.5, detected: false, color: null,
    crosshair: null,
    vx: 0, vy: 0, prevX: W * 0.35, prevY: H * 0.5,
    momentAngle: 0,           // updated each frame
    smoothVx: 0, smoothVy: 0  // smoothed velocity
  },
  {
    name: 'South', charge: -1, cssColor: '#55f', label: 'S',
    x: W * 0.65, y: H * 0.5, detected: false, color: null,
    crosshair: null,
    vx: 0, vy: 0, prevX: W * 0.65, prevY: H * 0.5,
    momentAngle: Math.PI,
    smoothVx: 0, smoothVy: 0
  },
];

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
    for (const p of poles) p.detected = true;
    appState = 'tracking';
    showTrackingUI();
    requestAnimationFrame(loop);
  });

// ─── Calibration UI ───────────────────────────────────────────────────────────
function updateCalibrationUI() {
  const idx = appState === 'cal-0' ? 0 : 1;
  const p   = poles[idx];
  document.getElementById('cal-panel').style.display   = 'flex';
  document.getElementById('cal-title').textContent     = `Step ${idx + 1} of 2`;
  document.getElementById('cal-desc').innerHTML        =
    `Click on your <strong style="color:${p.cssColor}">${p.name} pole</strong> ball in the camera feed.`;
  document.getElementById('cal-swatch').style.background = '#111';
  document.getElementById('cal-swatch').textContent      = '?';
  document.getElementById('btn-cal-confirm').disabled    = true;
  document.getElementById('btn-cal-confirm').textContent = idx === 0 ? 'Next →' : 'Start Tracking →';
}

function showTrackingUI() {
  document.getElementById('cal-panel').style.display   = 'none';
  document.getElementById('tracking-ui').style.display = 'flex';
}

// ─── Click → sample color ─────────────────────────────────────────────────────
canvas.addEventListener('click', e => {
  if (appState !== 'cal-0' && appState !== 'cal-1') return;
  const rect = canvas.getBoundingClientRect();
  const cx   = Math.round((e.clientX - rect.left) * (W / rect.width));
  const cy   = Math.round((e.clientY - rect.top)  * (H / rect.height));

  const sample = sampleRegion(cx, cy, 24);
  if (!sample) return;

  const idx = appState === 'cal-0' ? 0 : 1;
  poles[idx].color = sample;
  poles[idx].crosshair = { x: cx, y: cy };

  document.getElementById('cal-swatch').style.background = `hsl(${sample.hue},80%,50%)`;
  document.getElementById('cal-swatch').textContent      = '';
  updateDebugBar(idx, sample);
  document.getElementById('btn-cal-confirm').disabled = false;
});

document.getElementById('btn-cal-confirm').addEventListener('click', () => {
  if (appState === 'cal-0') { appState = 'cal-1'; updateCalibrationUI(); }
  else                      { appState = 'tracking'; showTrackingUI(); }
});

document.getElementById('btn-cal-redo').addEventListener('click', () => {
  appState = 'cal-0';
  resetPoleState();
  updateCalibrationUI();
});

document.getElementById('btn-recalibrate').addEventListener('click', () => {
  appState = 'cal-0';
  resetPoleState();
  document.getElementById('tracking-ui').style.display = 'none';
  updateCalibrationUI();
});

function resetPoleState() {
  for (let i = 0; i < poles.length; i++) {
    poles[i].color = poles[i].crosshair = null;
    poles[i].detected = false;
    document.getElementById(`dbg-swatch-${i}`).style.background = '#111';
    document.getElementById(`dbg-val-${i}`).textContent = 'not sampled';
    document.getElementById(`dbg-fill-${i}`).style.width = '0';
    document.getElementById(`dbg-bar-${i}`).style.background = '#1a2030';
  }
}

// ─── Physics panel toggle ─────────────────────────────────────────────────────
function togglePhysics() {
  const body  = document.getElementById('physics-body');
  const arrow = document.getElementById('physics-arrow');
  const open  = body.style.display !== 'none';
  body.style.display  = open ? 'none' : 'grid';
  arrow.textContent   = open ? '▶' : '▼';
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

wire('sl-qN',    'lbl-qN',     'qN',    v => v.toFixed(1));
wire('sl-qS',    'lbl-qS',     'qS',    v => v.toFixed(1));
wire('sl-angleN','lbl-angleN', '_aN',   v => { phys.angleN = v * Math.PI / 180; return v + '°'; });
wire('sl-angleS','lbl-angleS', '_aS',   v => { phys.angleS = v * Math.PI / 180; return v + '°'; });
wire('sl-nlines','lbl-nlines', 'nLines',v => Math.round(v));
wire('sl-alpha', 'lbl-alpha',  'alpha', v => { phys.alpha = v / 100; return v + '%'; });
wire('sl-decay', 'lbl-decay',  'decay', v => v.toFixed(1));
wire('sl-cut',   'lbl-cut',    'cutoff',v => v + 'px');

const velCheck = document.getElementById('chk-vel');
velCheck.addEventListener('change', () => {
  phys.velMode = velCheck.checked;
  document.getElementById('row-angleN').style.opacity = phys.velMode ? '0.35' : '1';
  document.getElementById('row-angleS').style.opacity = phys.velMode ? '0.35' : '1';
});
document.getElementById('row-angleN').style.opacity = '0.35';
document.getElementById('row-angleS').style.opacity = '0.35';

// ─── Visualization mode ───────────────────────────────────────────────────────
function setMode(m) {
  mode = m;
  document.querySelectorAll('.btn-mode').forEach(b => b.classList.remove('active'));
  document.getElementById('btn-' + m).classList.add('active');
}

// ─── Demo-mode drag ───────────────────────────────────────────────────────────
function canvasPos(e) {
  const r = canvas.getBoundingClientRect();
  return { x: (e.clientX - r.left) * (W / r.width), y: (e.clientY - r.top) * (H / r.height) };
}
canvas.addEventListener('mousedown', e => {
  if (!demoMode || appState !== 'tracking') return;
  const { x, y } = canvasPos(e);
  for (const p of poles) if ((x-p.x)**2+(y-p.y)**2 < 1200) { dragging = p; return; }
});
canvas.addEventListener('mousemove', e => {
  if (!dragging) return;
  const pos = canvasPos(e); dragging.x = pos.x; dragging.y = pos.y;
});
canvas.addEventListener('mouseup',    () => dragging = null);
canvas.addEventListener('mouseleave', () => dragging = null);
canvas.addEventListener('touchstart', e => {
  if (!demoMode || appState !== 'tracking') return; e.preventDefault();
  const r = canvas.getBoundingClientRect(), t = e.touches[0];
  const x = (t.clientX-r.left)*(W/r.width), y = (t.clientY-r.top)*(H/r.height);
  for (const p of poles) if ((x-p.x)**2+(y-p.y)**2 < 1200) { dragging = p; return; }
}, { passive: false });
canvas.addEventListener('touchmove', e => {
  if (!dragging) return; e.preventDefault();
  const r = canvas.getBoundingClientRect(), t = e.touches[0];
  dragging.x = (t.clientX-r.left)*(W/r.width); dragging.y = (t.clientY-r.top)*(H/r.height);
}, { passive: false });
canvas.addEventListener('touchend', () => dragging = null);

// ─── Main loop ────────────────────────────────────────────────────────────────
function loop(ts) {
  const dt = Math.min((ts - lastFrameTime) / 1000, 0.1);
  lastFrameTime = ts;

  ctx.clearRect(0, 0, W, H);

  if (!demoMode && video.readyState >= 2) {
    ctx.save(); ctx.translate(W, 0); ctx.scale(-1, 1);
    ctx.drawImage(video, 0, 0, W, H); ctx.restore();

    if (appState === 'tracking') {
      const frame = ctx.getImageData(0, 0, W, H);
      for (const p of poles) { if (p.color) trackBall(frame, p, dt); }
    }
  } else if (demoMode) {
    ctx.fillStyle = '#07070f'; ctx.fillRect(0, 0, W, H);
    for (const p of poles) {
      // Derive a gentle demo velocity from drag
      p.smoothVx = p.smoothVx * 0.85 + (p.x - p.prevX) / dt * 0.15;
      p.smoothVy = p.smoothVy * 0.85 + (p.y - p.prevY) / dt * 0.15;
      if (Math.hypot(p.smoothVx, p.smoothVy) > 5) p.momentAngle = Math.atan2(p.smoothVy, p.smoothVx);
      p.prevX = p.x; p.prevY = p.y;
      p.detected = true;
    }
  }

  // Calibration crosshairs
  if (appState === 'cal-0' || appState === 'cal-1') {
    for (const p of poles) if (p.crosshair) drawCrosshair(p.crosshair.x, p.crosshair.y, p.cssColor);
  }

  if (appState === 'tracking') {
    updateIndicators();
    const active = poles.filter(p => p.detected);
    if (active.length > 0) drawField(active);
    for (const p of active) drawMarker(p);
  }

  requestAnimationFrame(loop);
}

// ─── Color tracking / blob clustering ────────────────────────────────────────
function rgbToHsv(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r,g,b), min = Math.min(r,g,b), d = max-min;
  let h, s = max===0 ? 0 : d/max, v = max;
  if (d===0) { h=0; } else {
    switch(max) {
      case r: h=((g-b)/d%6)*60; break;
      case g: h=((b-r)/d+2)*60; break;
      case b: h=((r-g)/d+4)*60; break;
    }
    if (h<0) h+=360;
  }
  return [h,s,v];
}
function inHueTol(h,center,tol) {
  let d = Math.abs(h-center)%360; if(d>180) d=360-d; return d<=tol;
}

const GRID = 8;

// O(n) grid flood-fill tracking — no more O(n²) BFS freeze
function trackBall(frame, pole, dt) {
  const data = frame.data, { hue, hTol, minS, minV } = pole.color;
  const gW = Math.ceil(W / GRID), gH = Math.ceil(H / GRID);
  // 0=empty 1=match 2=visited
  const grid = new Uint8Array(gW * gH);
  let matchCount = 0;

  for (let gy = 0; gy < gH; gy++) {
    for (let gx = 0; gx < gW; gx++) {
      const px = gx * GRID, py = gy * GRID;
      const i  = (py * W + px) * 4;
      const [h, s, v] = rgbToHsv(data[i], data[i+1], data[i+2]);
      if (s >= minS && v >= minV && inHueTol(h, hue, hTol)) {
        grid[gy * gW + gx] = 1;
        matchCount++;
      }
    }
  }

  // Too many matches → probably the background; give up this frame
  if (matchCount < 4 || matchCount > gW * gH * 0.25) {
    pole.detected = matchCount > gW * gH * 0.25 ? false : pole.detected; // hold last pos on noise
    if (matchCount < 4) pole.detected = false;
    return;
  }

  // Grid flood-fill — O(n), each cell visited once
  const clusters = [];
  const stack = [];
  for (let gy = 0; gy < gH; gy++) {
    for (let gx = 0; gx < gW; gx++) {
      if (grid[gy * gW + gx] !== 1) continue;
      stack.length = 0;
      stack.push(gx, gy);
      grid[gy * gW + gx] = 2;
      let sx = 0, sy = 0, size = 0;
      while (stack.length > 0) {
        const cy = stack.pop(), cx = stack.pop();
        sx += cx * GRID; sy += cy * GRID; size++;
        // 4-connected neighbours
        for (const [nx, ny] of [[cx-1,cy],[cx+1,cy],[cx,cy-1],[cx,cy+1]]) {
          if (nx < 0 || nx >= gW || ny < 0 || ny >= gH) continue;
          if (grid[ny * gW + nx] !== 1) continue;
          grid[ny * gW + nx] = 2;
          stack.push(nx, ny);
        }
      }
      if (size >= 3) clusters.push({ x: sx/size, y: sy/size, size });
    }
  }

  if (clusters.length === 0) { pole.detected = false; return; }

  // Pick cluster nearest to last known position (reward size, penalise distance)
  let best = clusters[0], bestScore = Infinity;
  for (const c of clusters) {
    const dist  = Math.hypot(c.x - pole.x, c.y - pole.y);
    const score = dist - c.size * GRID * 0.8;
    if (score < bestScore) { bestScore = score; best = c; }
  }

  // Smooth position
  const a  = pole.detected ? 0.45 : 1.0;
  const nx = pole.x * (1-a) + best.x * a;
  const ny = pole.y * (1-a) + best.y * a;

  // Velocity
  const rawVx = (nx - pole.x) / Math.max(dt, 0.016);
  const rawVy = (ny - pole.y) / Math.max(dt, 0.016);
  pole.smoothVx = pole.smoothVx * 0.8 + rawVx * 0.2;
  pole.smoothVy = pole.smoothVy * 0.8 + rawVy * 0.2;

  pole.x = nx; pole.y = ny; pole.detected = true;

  if (phys.velMode && Math.hypot(pole.smoothVx, pole.smoothVy) > 4) {
    pole.momentAngle = Math.atan2(pole.smoothVy, pole.smoothVx);
  } else if (!phys.velMode) {
    pole.momentAngle = (pole.charge > 0) ? phys.angleN : phys.angleS;
  }
}

// ─── Dipole field math ────────────────────────────────────────────────────────
function fieldAt(x, y, active) {
  let fx=0, fy=0;
  for (const p of active) {
    const dx=x-p.x, dy=y-p.y, r2=dx*dx+dy*dy;
    if (r2 < phys.cutoff**2) continue;
    const r  = Math.sqrt(r2);
    const rn = phys.decay;          // configurable exponent

    // Effective moment = charge sign * strength * unit vector along momentAngle
    const str = (p.charge > 0 ? phys.qN : phys.qS) * p.charge;
    const momentAngle = phys.velMode ? p.momentAngle : (p.charge>0 ? phys.angleN : phys.angleS);
    const mx  = str * Math.cos(momentAngle);
    const my  = str * Math.sin(momentAngle);

    // Dipole field: B = [3(m·r̂)r̂ − m] / r^n
    const rdotr_hat = (mx*dx + my*dy) / r;   // m · r̂  (unnorm)
    const rn_val    = Math.pow(r, rn);
    fx += (3 * rdotr_hat * (dx/r) - mx) / rn_val;
    fy += (3 * rdotr_hat * (dy/r) - my) / rn_val;
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
  const nLines  = phys.nLines;
  const stepSz  = 4;
  const maxStep = 400;
  const arrowEvery = 36; // px between arrowheads

  ctx.save();
  ctx.globalAlpha = phys.alpha;
  ctx.lineWidth   = 1.8;

  for (const pole of active) {
    for (let i = 0; i < nLines; i++) {
      const a   = (i / nLines) * Math.PI * 2;
      let x     = pole.x + 22 * Math.cos(a);
      let y     = pole.y + 22 * Math.sin(a);
      const pts = [{ x, y }];
      let travelSinceArrow = 0;
      const arrowPts = [];

      for (let s = 0; s < maxStep; s++) {
        const [fx, fy] = fieldAt(x, y, active);
        const mag = Math.hypot(fx, fy);
        if (mag < 1e-9) break;
        const nx = fx/mag, ny = fy/mag;

        // Adaptive step: smaller near poles
        const minDist = Math.min(...active.map(p => Math.hypot(x-p.x, y-p.y)));
        const step = Math.max(1.5, Math.min(stepSz, minDist * 0.3));

        x += nx * step;
        y += ny * step;
        if (x<-10||x>W+10||y<-10||y>H+10) break;

        pts.push({ x, y });
        travelSinceArrow += step;

        if (travelSinceArrow >= arrowEvery) {
          arrowPts.push({ x, y, dx: nx, dy: ny });
          travelSinceArrow = 0;
        }

        if (active.some(p => Math.hypot(p.x-x, p.y-y) < 14)) break;
      }

      if (pts.length < 4) continue;

      // Draw line
      const grad = ctx.createLinearGradient(pts[0].x, pts[0].y, pts[pts.length-1].x, pts[pts.length-1].y);
      grad.addColorStop(0,   '#f66');
      grad.addColorStop(0.5, '#adf');
      grad.addColorStop(1,   '#66f');
      ctx.strokeStyle = grad;
      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      for (let k = 1; k < pts.length; k++) ctx.lineTo(pts[k].x, pts[k].y);
      ctx.stroke();

      // Draw arrows along the line
      for (const ap of arrowPts) {
        const angle = Math.atan2(ap.dy, ap.dx);
        const hl = 8;
        ctx.strokeStyle = '#fff';
        ctx.lineWidth   = 1.5;
        ctx.globalAlpha = phys.alpha * 0.9;
        ctx.beginPath();
        ctx.moveTo(ap.x - hl*Math.cos(angle-0.4), ap.y - hl*Math.sin(angle-0.4));
        ctx.lineTo(ap.x, ap.y);
        ctx.lineTo(ap.x - hl*Math.cos(angle+0.4), ap.y - hl*Math.sin(angle+0.4));
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
  for (let y=step/2; y<H; y+=step) for (let x=step/2; x<W; x+=step) {
    const [fx,fy] = fieldAt(x,y,active);
    const mag = Math.hypot(fx,fy);
    if (mag<1e-8) continue;
    const nx=fx/mag, ny=fy/mag;
    const len = Math.min(step*0.78, 400*mag);
    if (len<3) continue;
    const angle = Math.atan2(fy,fx);
    const hue   = ((angle+Math.PI)/(2*Math.PI))*360;
    const bri   = Math.min(88, 48+Math.log10(mag*1000+1)*15);
    const x1=x-nx*len/2, y1=y-ny*len/2, x2=x+nx*len/2, y2=y+ny*len/2;
    const hl=Math.max(5,len*0.3);
    ctx.strokeStyle=`hsl(${hue},95%,${bri}%)`; ctx.lineWidth=1.6;
    ctx.beginPath();
    ctx.moveTo(x1,y1); ctx.lineTo(x2,y2);
    ctx.moveTo(x2-hl*Math.cos(angle-0.45),y2-hl*Math.sin(angle-0.45));
    ctx.lineTo(x2,y2);
    ctx.lineTo(x2-hl*Math.cos(angle+0.45),y2-hl*Math.sin(angle+0.45));
    ctx.stroke();
  }
  ctx.restore();
}

// — Heatmap —
function drawHeatmap(active) {
  const scale=5, sw=Math.ceil(W/scale), sh=Math.ceil(H/scale);
  offscreen.width=sw; offscreen.height=sh;
  const octx=offscreen.getContext('2d'), img=octx.createImageData(sw,sh), d=img.data;
  for (let py=0;py<sh;py++) for (let px=0;px<sw;px++) {
    const [fx,fy]=fieldAt(px*scale,py*scale,active);
    const mag=Math.hypot(fx,fy), angle=Math.atan2(fy,fx);
    const hue=((angle+Math.PI)/(2*Math.PI))*360;
    const t=Math.min(1,Math.log10(mag*800+1)/4);
    const [r,g,b]=hslToRgb(hue/360,0.9,0.1+t*0.55);
    const i=(py*sw+px)*4;
    d[i]=r;d[i+1]=g;d[i+2]=b;d[i+3]=Math.round(phys.alpha*210);
  }
  octx.putImageData(img,0,0);
  ctx.save(); ctx.imageSmoothingEnabled=true; ctx.imageSmoothingQuality='high';
  ctx.drawImage(offscreen,0,0,W,H); ctx.restore();
}

// ─── Utilities ────────────────────────────────────────────────────────────────
function hslToRgb(h,s,l) {
  const f=(p,q,t)=>{if(t<0)t+=1;if(t>1)t-=1;if(t<1/6)return p+(q-p)*6*t;if(t<1/2)return q;if(t<2/3)return p+(q-p)*(2/3-t)*6;return p;};
  if(s===0)return[l,l,l].map(v=>Math.round(v*255));
  const q=l<0.5?l*(1+s):l+s-l*s,p=2*l-q;
  return[Math.round(f(p,q,h+1/3)*255),Math.round(f(p,q,h)*255),Math.round(f(p,q,h-1/3)*255)];
}

function drawMarker(p) {
  ctx.save();
  // Velocity arrow (if moving)
  const spd = Math.hypot(p.smoothVx, p.smoothVy);
  if (spd > 5) {
    const vlen = Math.min(50, spd * 0.15);
    const vx = p.smoothVx/spd, vy = p.smoothVy/spd;
    ctx.strokeStyle = p.cssColor; ctx.lineWidth = 2; ctx.globalAlpha = 0.6;
    ctx.setLineDash([3,3]);
    ctx.beginPath(); ctx.moveTo(p.x,p.y); ctx.lineTo(p.x+vx*vlen,p.y+vy*vlen); ctx.stroke();
    ctx.setLineDash([]);
  }
  // Moment direction indicator
  const ma = phys.velMode ? p.momentAngle : (p.charge>0 ? phys.angleN : phys.angleS);
  ctx.strokeStyle = p.cssColor; ctx.lineWidth = 1.5; ctx.globalAlpha = 0.5;
  ctx.beginPath(); ctx.moveTo(p.x,p.y);
  ctx.lineTo(p.x+Math.cos(ma)*30, p.y+Math.sin(ma)*30); ctx.stroke();

  // Circle + label
  ctx.globalAlpha = 1;
  ctx.strokeStyle = p.cssColor; ctx.lineWidth = 2.5;
  ctx.shadowColor = p.cssColor; ctx.shadowBlur = 12;
  ctx.beginPath(); ctx.arc(p.x, p.y, 20, 0, Math.PI*2); ctx.stroke();
  ctx.shadowBlur = 0; ctx.fillStyle = p.cssColor;
  ctx.font = 'bold 12px Courier New'; ctx.textAlign = 'center';
  ctx.fillText(p.label, p.x, p.y - 28);
  ctx.restore();
}

function drawCrosshair(cx, cy, color) {
  ctx.save();
  ctx.strokeStyle=color; ctx.lineWidth=2; ctx.shadowColor=color; ctx.shadowBlur=8;
  const r=24;
  ctx.beginPath(); ctx.arc(cx,cy,r,0,Math.PI*2); ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(cx-r-8,cy); ctx.lineTo(cx+r+8,cy);
  ctx.moveTo(cx,cy-r-8); ctx.lineTo(cx,cy+r+8);
  ctx.stroke(); ctx.restore();
}

function updateIndicators() {
  document.getElementById('dot-north').className='dot'+(poles[0].detected?' on':'');
  document.getElementById('dot-south').className='dot'+(poles[1].detected?' on':'');
}

// ─── Sampling ─────────────────────────────────────────────────────────────────
function sampleRegion(cx, cy, radius) {
  const x0=Math.max(0,cx-radius),y0=Math.max(0,cy-radius);
  const x1=Math.min(W,cx+radius),y1=Math.min(H,cy+radius);
  const w=x1-x0,h=y1-y0;
  if(w<=0||h<=0) return null;
  let data; try{data=ctx.getImageData(x0,y0,w,h).data;}catch(e){return null;}
  const hues=[],sats=[],vals=[];
  for(let i=0;i<data.length;i+=4){
    const[hh,ss,vv]=rgbToHsv(data[i],data[i+1],data[i+2]);
    hues.push(hh);sats.push(ss);vals.push(vv);
  }
  const avgHue=circularMeanHue(hues);
  const avgSat=sats.reduce((a,b)=>a+b,0)/sats.length;
  const avgVal=vals.reduce((a,b)=>a+b,0)/vals.length;
  console.log(`Sample: hue=${avgHue.toFixed(1)} sat=${(avgSat*100).toFixed(0)}% val=${(avgVal*100).toFixed(0)}%`);
  // Use tighter thresholds: min saturation is at least 0.30, and at least 55% of sample sat
  // This prevents matching desaturated backgrounds (whiteboards, walls)
  return {
    hue: avgHue, hTol: 28,
    minS: Math.max(0.30, avgSat * 0.55),
    minV: Math.max(0.15, avgVal * 0.30),
    avgSat, avgVal,
  };
}

function circularMeanHue(hues) {
  let sx=0,sy=0;
  for(const h of hues){const r=(h/180)*Math.PI;sx+=Math.cos(r);sy+=Math.sin(r);}
  let m=Math.atan2(sy/hues.length,sx/hues.length)*(180/Math.PI);
  return m<0?m+360:m;
}

// ─── Debug bar ────────────────────────────────────────────────────────────────
function updateDebugBar(idx, color) {
  if (!color) return;
  const hue=Math.round(color.hue), tol=color.hTol;
  const sat=Math.round((color.avgSat||color.minS/0.35)*100);
  const val=Math.round((color.avgVal||color.minV/0.25)*100);
  document.getElementById(`dbg-swatch-${idx}`).style.background=`hsl(${hue},${Math.min(100,sat)}%,${Math.round(val/2)}%)`;
  document.getElementById(`dbg-val-${idx}`).textContent=`hue ${hue}° ±${tol}°   sat ${sat}%   val ${val}%`;
  const bar=document.getElementById(`dbg-bar-${idx}`);
  const fill=document.getElementById(`dbg-fill-${idx}`);
  const lo=((hue-tol+360)%360)/360*100;
  fill.style.left=`${lo}%`;fill.style.width=`${Math.min(100,(tol*2)/360*100)}%`;
  fill.style.background=`hsl(${hue},100%,65%)`;fill.style.boxShadow=`0 0 4px hsl(${hue},100%,65%)`;
  bar.style.background='linear-gradient(to right,hsl(0,85%,45%),hsl(30,85%,45%),hsl(60,85%,45%),hsl(90,85%,45%),hsl(120,85%,45%),hsl(150,85%,45%),hsl(180,85%,45%),hsl(210,85%,45%),hsl(240,85%,45%),hsl(270,85%,45%),hsl(300,85%,45%),hsl(330,85%,45%),hsl(360,85%,45%))';
}

function refreshDebugBars() {
  for(let i=0;i<poles.length;i++) if(poles[i].color) updateDebugBar(i,poles[i].color);
}
