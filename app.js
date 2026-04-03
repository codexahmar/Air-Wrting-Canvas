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
let prevMidPoint = null;
let prevVelocity = 0;
let handPresent = false;
let frameCount = 0;
let lastFpsTime = performance.now();
let pinchFrames = 0;

const STROKE_SMOOTHING = 0.35;
const PINCH_START_RATIO = 0.23;
const PINCH_RELEASE_RATIO = 0.31;
const GRAB_HOLD_FRAMES = 6;

// Grab state
const grab = {
    active: false,
    snapshotCanvas: null,
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
function lerpPoint(a, b, t) {
    return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}
function palmWidth(lm, W, H) {
    const knuckleA = { x: (1 - lm[5].x) * W, y: lm[5].y * H };
    const knuckleB = { x: (1 - lm[17].x) * W, y: lm[17].y * H };
    return Math.max(1, dist2(knuckleA, knuckleB));
}

// ── Gesture classifier ────────────────────────────────────
function classifyGesture(lm, W, H) {
    const indexUp = isUp(lm, 8, 6);
    const middleUp = isUp(lm, 12, 10);
    const ringUp = isUp(lm, 16, 14);
    const pinkyUp = isUp(lm, 20, 18);
    const totalUp = [indexUp, middleUp, ringUp, pinkyUp].filter(Boolean).length;

    if (totalUp >= 4) return { mode: 'erase' };

    if (indexUp && !middleUp && !ringUp && !pinkyUp) {
        const itip = indexTip(lm, W, H);
        const ttip = thumbTip(lm, W, H);
        const pinchDist = dist2(itip, ttip);
        const pinchRatio = pinchDist / palmWidth(lm, W, H);
        return {
            mode: 'draw',
            pinchRatio,
            pinchPoint: { x: (itip.x + ttip.x) / 2, y: (itip.y + ttip.y) / 2 },
            drawPoint: itip,
        };
    }

    return { mode: 'idle' };
}

// ── Draw stroke ───────────────────────────────────────────
function drawStroke(fromMid, control, toMid, velocity) {
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
    dCtx.moveTo(fromMid.x, fromMid.y);
    dCtx.quadraticCurveTo(control.x, control.y, toMid.x, toMid.y);
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

    const snapshot = document.createElement('canvas');
    snapshot.width = drawCanvas.width;
    snapshot.height = drawCanvas.height;
    snapshot.getContext('2d').drawImage(drawCanvas, 0, 0);

    grab.snapshotCanvas = snapshot;
    grab.grabHandX = hx; grab.grabHandY = hy;
    grab.offsetX = 0; grab.offsetY = 0;
    grab.active = true;

    // Move the entire drawing as a single object.
    dCtx.clearRect(0, 0, drawCanvas.width, drawCanvas.height);
}

function updateGrab(hx, hy) {
    if (!grab.active) return;
    grab.offsetX = hx - grab.grabHandX;
    grab.offsetY = hy - grab.grabHandY;
}

function releaseGrab() {
    if (!grab.active) return;

    dCtx.drawImage(grab.snapshotCanvas, grab.offsetX, grab.offsetY);
    grab.active = false;
    grab.snapshotCanvas = null;
}

function drawGrabPreview() {
    if (!grab.active || !grab.snapshotCanvas) return;

    lCtx.save();
    lCtx.globalAlpha = 0.88;
    lCtx.drawImage(grab.snapshotCanvas, grab.offsetX, grab.offsetY);
    lCtx.strokeStyle = 'rgba(255,220,0,0.35)';
    lCtx.lineWidth = 1;
    lCtx.setLineDash([6, 4]);
    lCtx.strokeRect(grab.offsetX, grab.offsetY, drawCanvas.width, drawCanvas.height);
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
        prevMidPoint = null;
        prevVelocity = 0;
        pinchFrames = 0;
        if (grab.active) releaseGrab();
        updateHUD('idle');
        return;
    }

    handPresent = true;
    const lm = results.multiHandLandmarks[0];
    const W = drawCanvas.width, H = drawCanvas.height;
    const gestureInfo = classifyGesture(lm, W, H);

    let gesture = gestureInfo.mode;

    if (gestureInfo.mode === 'draw') {
        const canStartGrab = gestureInfo.pinchRatio < PINCH_START_RATIO;
        const canKeepGrab = grab.active && gestureInfo.pinchRatio < PINCH_RELEASE_RATIO;
        if (canStartGrab || canKeepGrab) {
            pinchFrames += 1;
            if (!grab.active && pinchFrames >= GRAB_HOLD_FRAMES) {
                startGrab(gestureInfo.pinchPoint.x, gestureInfo.pinchPoint.y);
            }
            if (grab.active) {
                updateGrab(gestureInfo.pinchPoint.x, gestureInfo.pinchPoint.y);
                gesture = 'grab';
            }
        } else {
            pinchFrames = 0;
            if (grab.active) releaseGrab();
        }
    } else {
        pinchFrames = 0;
    }

    if (pinchFrames > 0 && !grab.active && gesture === 'draw') {
        gesture = 'grab';
    }

    renderLandmarks(lm, gesture);
    updateHUD(gesture);

    if (gesture === 'draw') {
        const rawPoint = gestureInfo.drawPoint;
        const point = prevPoint ? lerpPoint(prevPoint, rawPoint, STROKE_SMOOTHING) : rawPoint;

        if (!prevPoint) {
            prevPoint = point;
            prevMidPoint = point;
        }

        if (prevPoint) {
            const dx = point.x - prevPoint.x, dy = point.y - prevPoint.y;
            const d = Math.sqrt(dx * dx + dy * dy);
            prevVelocity = 0.2 * d + 0.8 * prevVelocity;
            if (d < 90) {
                const mid = { x: (prevPoint.x + point.x) * 0.5, y: (prevPoint.y + point.y) * 0.5 };
                drawStroke(prevMidPoint, prevPoint, mid, prevVelocity);
                prevMidPoint = mid;
            }
        }
        prevPoint = point;

    } else if (gesture === 'erase') {
        if (grab.active) releaseGrab();
        prevPoint = null; prevMidPoint = null; prevVelocity = 0;
        const pc = palmCenter(lm, W, H);
        eraseAt(pc.x, pc.y);

    } else if (gesture === 'grab') {
        prevPoint = null; prevMidPoint = null; prevVelocity = 0;

    } else {
        if (grab.active) releaseGrab();
        prevPoint = null; prevMidPoint = null; prevVelocity = 0;
    }
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