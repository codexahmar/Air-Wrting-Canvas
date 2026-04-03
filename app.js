// ============================================================
//  NEON HAND — Air Canvas  |  app.js  v3
//
//  Gestures:
//   ☝️  Index only              → DRAW
//   🤌  Index + Thumb pinch     → GRAB (pick up & move content)
//   ✋  Palm open (4+ fingers)  → ERASE (palm-centre circle eraser)
//   ✊  Fist / no hand          → IDLE
// ============================================================

const video = document.getElementById('video');
const drawCanvas = document.getElementById('drawCanvas');
const landmarkCanvas = document.getElementById('landmarkCanvas');
const dCtx = drawCanvas.getContext('2d');
const lCtx = landmarkCanvas.getContext('2d');

// HUD refs
const statusDot = document.getElementById('statusDot');
const statusText = document.getElementById('statusText');
const modeValue = document.getElementById('modeValue');
const fpsEl = document.getElementById('fps');
const loaderEl = document.getElementById('loader');
const loaderFill = document.getElementById('loaderFill');
const loaderStatus = document.getElementById('loaderStatus');
const brushSlider = document.getElementById('brushSlider');
const brushSizeNum = document.getElementById('brushSizeNum');
const brushTypeName = document.getElementById('brushTypeName');
const gestureItems = {
    draw: document.getElementById('g-draw'),
    erase: document.getElementById('g-clear'),
    grab: document.getElementById('g-grab'),
    idle: document.getElementById('g-idle'),
};

// ── Colour map ────────────────────────────────────────────
const COLOR_MAP = {
    blue: { stroke: '#00d4ff', skeleton: 'rgba(0,212,255,0.5)', dot: '#00d4ff' },
    purple: { stroke: '#b400ff', skeleton: 'rgba(180,0,255,0.5)', dot: '#b400ff' },
    pink: { stroke: '#ff006e', skeleton: 'rgba(255,0,110,0.5)', dot: '#ff006e' },
    green: { stroke: '#00ff88', skeleton: 'rgba(0,255,136,0.5)', dot: '#00ff88' },
};

// ── Brush profiles ────────────────────────────────────────
function getBrushProfile(v) {
    if (v <= 6) {
        const t = (v - 1) / 5;
        return { name: 'PENCIL', lineWidth: 0.5 + t * 1.5, alpha: 0.55 + t * 0.2, lineCap: 'round' };
    } else if (v <= 13) {
        const t = (v - 7) / 6;
        return { name: 'PEN', lineWidth: 2.5 + t * 4, alpha: 1.0, lineCap: 'round' };
    } else {
        const t = (v - 14) / 6;
        return { name: 'MARKER', lineWidth: 8 + t * 20, alpha: 0.82, lineCap: 'square' };
    }
}

// Eraser radius grows with brush size
function getEraserRadius(v) { return 20 + v * 2.5; }

// ── State ─────────────────────────────────────────────────
let currentColor = 'blue';
let sliderVal = 4;
let prevPoint = null;
let prevVelocity = 0;
let currentMode = 'idle';
let handPresent = false;
let frameCount = 0;
let lastFpsTime = performance.now();
let prevGesture = 'idle';

// Grab state
const GRAB_REGION = 160;
const grab = {
    active: false,
    snapshot: null,
    regionX: 0, regionY: 0,
    regionW: 0, regionH: 0,
    grabHandX: 0, grabHandY: 0,
    offsetX: 0, offsetY: 0,
};

// ── Canvas resize ─────────────────────────────────────────
function resize() {
    const W = window.innerWidth, H = window.innerHeight;
    const tmp = document.createElement('canvas');
    tmp.width = W; tmp.height = H;
    tmp.getContext('2d').drawImage(drawCanvas, 0, 0);
    drawCanvas.width = W; drawCanvas.height = H;
    landmarkCanvas.width = W; landmarkCanvas.height = H;
    dCtx.drawImage(tmp, 0, 0);
}
window.addEventListener('resize', resize);
resize();

// ── Colour palette ────────────────────────────────────────
document.querySelectorAll('.colorBtn').forEach(btn => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('.colorBtn').forEach(b => b.classList.remove('selected'));
        btn.classList.add('selected');
        currentColor = btn.dataset.color;
    });
});

// ── Brush slider ──────────────────────────────────────────
brushSlider.addEventListener('input', () => {
    sliderVal = parseInt(brushSlider.value);
    brushSizeNum.textContent = sliderVal;
    brushTypeName.textContent = getBrushProfile(sliderVal).name;
});
brushTypeName.textContent = getBrushProfile(sliderVal).name;
brushSizeNum.textContent = sliderVal;

// ── Coord helpers ─────────────────────────────────────────
const isUp = (lm, tip, pip) => lm[tip].y < lm[pip].y;

function palmCenter(lm, W, H) {
    const ids = [0, 5, 9, 13, 17];
    return {
        x: ids.reduce((s, i) => s + (1 - lm[i].x) * W, 0) / ids.length,
        y: ids.reduce((s, i) => s + lm[i].y * H, 0) / ids.length,
    };
}
function indexTip(lm, W, H) { return { x: (1 - lm[8].x) * W, y: lm[8].y * H }; }
function thumbTip(lm, W, H) { return { x: (1 - lm[4].x) * W, y: lm[4].y * H }; }
function dist2(a, b) { return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2); }

// ── Gesture classifier ────────────────────────────────────
function classifyGesture(lm, W, H) {
    const indexUp = isUp(lm, 8, 6);
    const middleUp = isUp(lm, 12, 10);
    const ringUp = isUp(lm, 16, 14);
    const pinkyUp = isUp(lm, 20, 18);
    const totalUp = [indexUp, middleUp, ringUp, pinkyUp].filter(Boolean).length;

    if (indexUp && !middleUp && !ringUp && !pinkyUp) {
        const pinchDist = dist2(indexTip(lm, W, H), thumbTip(lm, W, H));
        return pinchDist < 50 ? 'grab' : 'draw';
    }
    if (totalUp >= 4) return 'erase';
    return 'idle';
}

// ── Draw stroke ───────────────────────────────────────────
function drawStroke(x1, y1, x2, y2, velocity) {
    const col = COLOR_MAP[currentColor];
    const profile = getBrushProfile(sliderVal);
    const lw = Math.max(0.4, profile.lineWidth * (1 - Math.min(velocity / 25, 1) * 0.25));
    dCtx.save();
    dCtx.globalAlpha = profile.alpha;
    dCtx.lineCap = profile.lineCap;
    dCtx.lineJoin = 'round';
    dCtx.strokeStyle = col.stroke;
    dCtx.lineWidth = lw;
    dCtx.shadowBlur = 0;
    dCtx.shadowColor = 'transparent';
    dCtx.beginPath();
    dCtx.moveTo(x1, y1);
    dCtx.lineTo(x2, y2);
    dCtx.stroke();
    dCtx.restore();
}

// ── Palm eraser — destination-out circle ─────────────────
function eraseAt(cx, cy) {
    const r = getEraserRadius(sliderVal);
    dCtx.save();
    dCtx.globalCompositeOperation = 'destination-out';
    dCtx.globalAlpha = 1;
    dCtx.beginPath();
    dCtx.arc(cx, cy, r, 0, Math.PI * 2);
    dCtx.fill();
    dCtx.restore();
}

// ── Grab functions ────────────────────────────────────────
function startGrab(hx, hy) {
    if (grab.active) return;
    const rx = Math.max(0, hx - GRAB_REGION);
    const ry = Math.max(0, hy - GRAB_REGION);
    const rw = Math.min(drawCanvas.width - rx, GRAB_REGION * 2);
    const rh = Math.min(drawCanvas.height - ry, GRAB_REGION * 2);

    grab.snapshot = dCtx.getImageData(rx, ry, rw, rh);
    grab.regionX = rx; grab.regionY = ry;
    grab.regionW = rw; grab.regionH = rh;
    grab.grabHandX = hx; grab.grabHandY = hy;
    grab.offsetX = 0; grab.offsetY = 0;
    grab.active = true;

    // Cut content from canvas
    dCtx.clearRect(rx, ry, rw, rh);
}

function updateGrab(hx, hy) {
    if (!grab.active) return;
    grab.offsetX = hx - grab.grabHandX;
    grab.offsetY = hy - grab.grabHandY;
}

function releaseGrab() {
    if (!grab.active) return;
    // Stamp at new position
    const off = document.createElement('canvas');
    off.width = grab.regionW; off.height = grab.regionH;
    off.getContext('2d').putImageData(grab.snapshot, 0, 0);
    dCtx.drawImage(off, grab.regionX + grab.offsetX, grab.regionY + grab.offsetY);
    grab.active = false; grab.snapshot = null;
}

function drawGrabPreview() {
    if (!grab.active || !grab.snapshot) return;
    const nx = grab.regionX + grab.offsetX;
    const ny = grab.regionY + grab.offsetY;
    const off = document.createElement('canvas');
    off.width = grab.regionW; off.height = grab.regionH;
    off.getContext('2d').putImageData(grab.snapshot, 0, 0);
    lCtx.save();
    lCtx.globalAlpha = 0.88;
    lCtx.drawImage(off, nx, ny);
    // Dashed bounding box
    lCtx.strokeStyle = 'rgba(255,220,0,0.7)';
    lCtx.lineWidth = 1.5;
    lCtx.setLineDash([6, 4]);
    lCtx.strokeRect(nx, ny, grab.regionW, grab.regionH);
    lCtx.setLineDash([]);
    lCtx.restore();
}

// ── Render skeleton + mode overlays ──────────────────────
function renderLandmarks(lm, gesture) {
    lCtx.clearRect(0, 0, landmarkCanvas.width, landmarkCanvas.height);
    const W = landmarkCanvas.width, H = landmarkCanvas.height;
    const col = COLOR_MAP[currentColor];
    const px = i => (1 - lm[i].x) * W;
    const py = i => lm[i].y * H;

    const skelColor = {
        draw: col.skeleton,
        erase: 'rgba(255,80,80,0.5)',
        grab: 'rgba(255,220,0,0.5)',
        idle: 'rgba(255,255,255,0.18)',
    }[gesture] || 'rgba(255,255,255,0.18)';

    const connections = [
        [0, 1], [1, 2], [2, 3], [3, 4],
        [0, 5], [5, 6], [6, 7], [7, 8],
        [5, 9], [9, 10], [10, 11], [11, 12],
        [9, 13], [13, 14], [14, 15], [15, 16],
        [13, 17], [17, 18], [18, 19], [19, 20], [0, 17]
    ];

    lCtx.save();
    lCtx.shadowBlur = 0;
    lCtx.lineWidth = 1;
    lCtx.strokeStyle = skelColor;
    connections.forEach(([a, b]) => {
        lCtx.beginPath(); lCtx.moveTo(px(a), py(a)); lCtx.lineTo(px(b), py(b)); lCtx.stroke();
    });

    lm.forEach((_, i) => {
        const isKey = [0, 4, 8, 12, 16, 20].includes(i);
        lCtx.beginPath();
        lCtx.arc(px(i), py(i), isKey ? 4.5 : 2, 0, Math.PI * 2);
        lCtx.fillStyle = isKey ? col.dot : 'rgba(255,255,255,0.4)';
        lCtx.fill();
    });

    // DRAW — pulsing cursor ring on index tip
    if (gesture === 'draw') {
        const r = 9 + Math.sin(Date.now() / 500) * 3;
        lCtx.beginPath();
        lCtx.arc(px(8), py(8), r, 0, Math.PI * 2);
        lCtx.strokeStyle = col.dot;
        lCtx.lineWidth = 1.5;
        lCtx.globalAlpha = 0.8;
        lCtx.stroke();
    }

    // ERASE — eraser circle at palm centre
    if (gesture === 'erase') {
        const pc = palmCenter(lm, W, H);
        const r = getEraserRadius(sliderVal);
        // Soft fill
        lCtx.beginPath(); lCtx.arc(pc.x, pc.y, r, 0, Math.PI * 2);
        lCtx.fillStyle = 'rgba(255,60,60,0.1)'; lCtx.globalAlpha = 1; lCtx.fill();
        // Dashed ring
        lCtx.beginPath(); lCtx.arc(pc.x, pc.y, r, 0, Math.PI * 2);
        lCtx.strokeStyle = 'rgba(255,80,80,0.9)'; lCtx.lineWidth = 2;
        lCtx.setLineDash([5, 3]); lCtx.stroke(); lCtx.setLineDash([]);
        // Centre dot
        lCtx.beginPath(); lCtx.arc(pc.x, pc.y, 4, 0, Math.PI * 2);
        lCtx.fillStyle = 'rgba(255,100,100,0.95)'; lCtx.fill();
        // Crosshair
        lCtx.strokeStyle = 'rgba(255,100,100,0.6)'; lCtx.lineWidth = 1;
        lCtx.beginPath();
        lCtx.moveTo(pc.x - r, pc.y); lCtx.lineTo(pc.x + r, pc.y);
        lCtx.moveTo(pc.x, pc.y - r); lCtx.lineTo(pc.x, pc.y + r);
        lCtx.stroke();
    }

    // GRAB — pinch indicator + floating preview
    if (gesture === 'grab') {
        const itip = indexTip(lm, W, H), ttip = thumbTip(lm, W, H);
        const mx = (itip.x + ttip.x) / 2, my = (itip.y + ttip.y) / 2;
        // Line between fingertips
        lCtx.beginPath(); lCtx.moveTo(itip.x, itip.y); lCtx.lineTo(ttip.x, ttip.y);
        lCtx.strokeStyle = 'rgba(255,220,0,0.8)'; lCtx.lineWidth = 2; lCtx.stroke();
        // Glow dot at midpoint
        lCtx.beginPath(); lCtx.arc(mx, my, 10, 0, Math.PI * 2);
        lCtx.fillStyle = 'rgba(255,220,0,0.3)'; lCtx.fill();
        lCtx.beginPath(); lCtx.arc(mx, my, 4, 0, Math.PI * 2);
        lCtx.fillStyle = 'rgba(255,220,0,0.95)'; lCtx.fill();
        // Capture region preview (before grab starts)
        if (!grab.active) {
            lCtx.strokeStyle = 'rgba(255,220,0,0.35)'; lCtx.lineWidth = 1;
            lCtx.setLineDash([5, 4]);
            lCtx.strokeRect(mx - GRAB_REGION, my - GRAB_REGION, GRAB_REGION * 2, GRAB_REGION * 2);
            lCtx.setLineDash([]);
        }
        drawGrabPreview();
    }

    lCtx.restore();
}

// ── HUD ───────────────────────────────────────────────────
function updateHUD(gesture) {
    const map = {
        draw: { text: 'Drawing', cls: 'draw', dot: 'drawing', status: 'DRAWING' },
        erase: { text: 'Erasing', cls: 'erase', dot: 'clearing', status: 'ERASING' },
        grab: { text: 'Grabbing', cls: 'grab', dot: 'grabbing', status: 'GRABBING' },
        idle: {
            text: handPresent ? 'Paused' : 'No Hand',
            cls: 'idle', dot: handPresent ? 'active' : '',
            status: handPresent ? 'HAND DETECTED' : 'SEARCHING'
        },
    };
    const m = map[gesture] || map.idle;
    modeValue.textContent = m.text;
    modeValue.className = m.cls;
    statusDot.className = m.dot;
    statusText.textContent = m.status;
    Object.keys(gestureItems).forEach(k => gestureItems[k]?.classList.remove('active'));
    gestureItems[gesture]?.classList.add('active');
    if (!gestureItems[gesture]) gestureItems.idle?.classList.add('active');
}

// ── FPS ───────────────────────────────────────────────────
function tickFPS() {
    frameCount++;
    const now = performance.now(), delta = now - lastFpsTime;
    if (delta >= 1000) {
        fpsEl.textContent = Math.round(frameCount * 1000 / delta) + ' FPS';
        frameCount = 0; lastFpsTime = now;
    }
}

// ── MediaPipe results ─────────────────────────────────────
function onResults(results) {
    tickFPS();
    lCtx.clearRect(0, 0, landmarkCanvas.width, landmarkCanvas.height);

    if (!results.multiHandLandmarks?.length) {
        handPresent = false;
        prevPoint = null;
        if (grab.active) releaseGrab();
        updateHUD('idle');
        return;
    }

    handPresent = true;
    const lm = results.multiHandLandmarks[0];
    const W = drawCanvas.width, H = drawCanvas.height;
    const gesture = classifyGesture(lm, W, H);
    currentMode = gesture;

    renderLandmarks(lm, gesture);
    updateHUD(gesture);

    if (gesture === 'draw') {
        if (grab.active) releaseGrab();
        const { x, y } = indexTip(lm, W, H);
        if (prevPoint) {
            const dx = x - prevPoint.x, dy = y - prevPoint.y;
            const d = Math.sqrt(dx * dx + dy * dy);
            prevVelocity = 0.2 * d + 0.8 * prevVelocity;
            if (d < 80) drawStroke(prevPoint.x, prevPoint.y, x, y, prevVelocity);
        }
        prevPoint = { x, y };

    } else if (gesture === 'erase') {
        if (grab.active) releaseGrab();
        prevPoint = null; prevVelocity = 0;
        const pc = palmCenter(lm, W, H);
        eraseAt(pc.x, pc.y);

    } else if (gesture === 'grab') {
        prevPoint = null; prevVelocity = 0;
        const itip = indexTip(lm, W, H), ttip = thumbTip(lm, W, H);
        const hx = (itip.x + ttip.x) / 2, hy = (itip.y + ttip.y) / 2;
        if (prevGesture !== 'grab') startGrab(hx, hy);
        else updateGrab(hx, hy);

    } else {
        if (grab.active) releaseGrab();
        prevPoint = null; prevVelocity = 0;
    }

    prevGesture = gesture;
}

// ── MediaPipe init ────────────────────────────────────────
function initMediaPipe() {
    const hands = new Hands({ locateFile: f => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${f}` });
    hands.setOptions({ maxNumHands: 1, modelComplexity: 1, minDetectionConfidence: 0.75, minTrackingConfidence: 0.65 });
    hands.onResults(onResults);
    new Camera(video, {
        onFrame: async () => { await hands.send({ image: video }); },
        width: 1280, height: 720,
    }).start();
}

// ── Boot ──────────────────────────────────────────────────
async function boot() {
    const steps = [
        { pct: 20, msg: 'Loading MediaPipe Hands...' },
        { pct: 45, msg: 'Requesting Camera Access...' },
        { pct: 70, msg: 'Initializing Canvas Engine...' },
        { pct: 90, msg: 'Calibrating Gesture Models...' },
        { pct: 100, msg: 'Ready.' },
    ];
    for (const s of steps) {
        loaderFill.style.width = s.pct + '%';
        loaderStatus.textContent = s.msg;
        await new Promise(r => setTimeout(r, 360));
    }
    await new Promise(r => setTimeout(r, 280));
    loaderEl.classList.add('hidden');
    initMediaPipe();
}
boot();

// ── Keyboard shortcuts ────────────────────────────────────
document.addEventListener('keydown', e => {
    if ((e.key === 'c' || e.key === 'C') && !grab.active)
        dCtx.clearRect(0, 0, drawCanvas.width, drawCanvas.height);
    if (e.key === 'Escape' && grab.active) releaseGrab();
    if (e.key === '1') document.querySelector('[data-color="blue"]').click();
    if (e.key === '2') document.querySelector('[data-color="purple"]').click();
    if (e.key === '3') document.querySelector('[data-color="pink"]').click();
    if (e.key === '4') document.querySelector('[data-color="green"]').click();
});