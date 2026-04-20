/* ==========================================================================
   Q4NT PRO - Three.js Scene Engine (Core)
   Background definitions are in js/views/view-*.js
   ========================================================================== */

// === Shared State ===
const Q4Scene = {
    scene: null, renderer: null, bgGroup: null,
    activeViews: [], currentBgAnimate: null,
    clock: null, _animFrameId: null,
};

// === Initialization ===
(function initScene() {
    const container = document.getElementById('canvas-container');
    if (!container) return;
    const scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0xf5f5f7, 0.0004);
    Q4Scene.scene = scene;
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(0xf5f5f7);
    container.appendChild(renderer.domElement);
    Q4Scene.renderer = renderer;
    const bgGroup = new THREE.Group();
    scene.add(bgGroup);
    Q4Scene.bgGroup = bgGroup;
    scene.add(new THREE.PointLight(0xffffff, 0.8).translateX(20).translateY(30).translateZ(20));
    const pl2 = new THREE.PointLight(0xf0f0ff, 0.4);
    pl2.position.set(-30, 20, -10); scene.add(pl2);
    scene.add(new THREE.AmbientLight(0xffffff, 0.7));
    Q4Scene.clock = new THREE.Clock();
})();

// === Default View State Machine ===
// Global states moved to per-pane initialization
var _panelBounds = { minX: -180, maxX: 185, minY: -100, maxY: 95, valid: true };
var _introZoom = { startZ: 300, endZ: 80, duration: 1500, startTime: -1, done: false };
var BASE_Z = 80;

function _clampCameraOffset(tx, ty) {
    var p = 40;
    return {
        x: Math.max(_panelBounds.minX - p, Math.min(_panelBounds.maxX + p, tx)),
        y: Math.max(_panelBounds.minY - p, Math.min(_panelBounds.maxY + p, ty))
    };
}

// === View Management ===
function initViews(paneElements) {
    Q4Scene.activeViews.forEach(function(v) { if (v._cleanup) v._cleanup(); });
    Q4Scene.activeViews = [];
    paneElements.forEach(function(pane) {
        pane.querySelectorAll('.pane-view-toggle').forEach(function(b) { b.remove(); });
        var cam = new THREE.PerspectiveCamera(75, pane.clientWidth / pane.clientHeight || 1, 0.1, 2000);
        cam.position.set(0, 0, _introZoom.startZ);
        cam.lookAt(0, 0, cam.position.z - 80);
        var ctrl = new THREE.OrbitControls(cam, pane);
        ctrl.enabled = false;
        var paneState = {
            scrollDepth: 0, targetDepth: 0,
            cameraOffset: { x: 0, y: 0 }, targetCameraOffset: { x: 0, y: 0 },
            isDragging: false, previousMousePosition: { x: 0, y: 0 }
        };

        var onWheel = function(e) {
            e.preventDefault();
            var oldD = paneState.targetDepth;
            // In 2D Grid view (bg 21): clamp so camera never passes the dot grid plane at Z=-60
            // BASE_Z=80, GRID_Z=-60 → max depth = 80-(-60)-2 = 138
            var maxDepth = (Q4Scene.activeBackgroundIndex === 21) ? 138 : 1280;
            var newD = Math.max(0, Math.min(maxDepth, oldD + (-e.deltaY * 0.18)));
            paneState.targetDepth = newD;
            var ad = newD - oldD;
            if (Math.abs(ad) > 0.001) {
                var h = Math.tan((cam.fov * Math.PI / 180) / 2), w = h * cam.aspect;
                var nx = paneState.targetCameraOffset.x + ((e.clientX / window.innerWidth) * 2 - 1) * w * ad;
                var ny = paneState.targetCameraOffset.y + (-(e.clientY / window.innerHeight) * 2 + 1) * h * ad;
                var c = _clampCameraOffset(nx, ny);
                paneState.targetCameraOffset.x = c.x; paneState.targetCameraOffset.y = c.y;
            }
        };
        pane.addEventListener('wheel', onWheel, { passive: false });
        var onMD = function(e) {
            if (e.button !== 0) return;
            if (e.target.closest && (e.target.closest('.beveled-panel') || e.target.closest('.float-panel') ||
                e.target.closest('.bottom-tab-panel') || e.target.closest('.ai-edge-panel') ||
                e.target.closest('.prompt-container') || e.target.closest('#cubeContainer') ||
                e.target.closest('#bottomRightStack') || e.target.closest('.gv-panel'))) return;
            // Only start drag if clicking inside this specific pane
            var rect = pane.getBoundingClientRect();
            if (e.clientX >= rect.left && e.clientX <= rect.right && e.clientY >= rect.top && e.clientY <= rect.bottom) {
                paneState.isDragging = true;
                paneState.previousMousePosition = { x: e.clientX, y: e.clientY };
            }
        };
        var onMM = function(e) {
            if (!paneState.isDragging) return;
            var c = _clampCameraOffset(
                paneState.targetCameraOffset.x - (e.clientX - paneState.previousMousePosition.x) * 0.1,
                paneState.targetCameraOffset.y + (e.clientY - paneState.previousMousePosition.y) * 0.1
            );
            paneState.targetCameraOffset.x = c.x; paneState.targetCameraOffset.y = c.y;
            paneState.previousMousePosition.x = e.clientX; paneState.previousMousePosition.y = e.clientY;
        };
        var onMU = function() { paneState.isDragging = false; };
        window.addEventListener('mousedown', onMD);
        window.addEventListener('mousemove', onMM);
        window.addEventListener('mouseup', onMU);
        Q4Scene.activeViews.push({
            camera: cam, controls: ctrl, element: pane, paneState: paneState,
            _cleanup: function() {
                pane.removeEventListener('wheel', onWheel);
                window.removeEventListener('mousedown', onMD);
                window.removeEventListener('mousemove', onMM);
                window.removeEventListener('mouseup', onMU);
                ctrl.dispose();
            }
        });
        pane.addEventListener('mousedown', function() {
            document.querySelectorAll('.workspace-pane').forEach(function(p) { p.classList.remove('active-pane'); });
            pane.classList.add('active-pane');
        });
    });
    _introZoom.startTime = performance.now();
    _introZoom.done = false;
}

// === Background System ===
function clearBackground() {
    var bg = Q4Scene.bgGroup;
    if (bg.userData.cleanup) { bg.userData.cleanup(); bg.userData.cleanup = null; }
    while (bg.children.length > 0) {
        var o = bg.children[0];
        if (o.geometry) o.geometry.dispose();
        if (o.material) { if (Array.isArray(o.material)) o.material.forEach(function(m){m.dispose();}); else o.material.dispose(); }
        bg.remove(o);
    }
    bg.rotation.set(0, 0, 0);
    Q4Scene.currentBgAnimate = null;
}

// Background registry - populated by js/views/view-*.js files
const backgrounds = new Array(20);

function setBackground(index) {
    clearBackground();
    if (backgrounds[index]) backgrounds[index]();
    var fp = document.getElementById('float-panel');
    if (fp) fp.style.display = (index === 1) ? 'flex' : 'none';
    Q4Scene.activeBackgroundIndex = index;
    try {
        window.dispatchEvent(new CustomEvent('q4:backgroundChanged', { detail: { index: index } }));
    } catch (e) {
        // Older environments: fall back to a plain Event.
        window.dispatchEvent(new Event('q4:backgroundChanged'));
    }
    Q4Scene.activeViews.forEach(function(v) {
        if (v.paneState) {
            v.paneState.scrollDepth = 0; v.paneState.targetDepth = 0;
            v.paneState.cameraOffset.x = 0; v.paneState.cameraOffset.y = 0;
            v.paneState.targetCameraOffset.x = 0; v.paneState.targetCameraOffset.y = 0;
            v.paneState.isDragging = false;
        }
        v.camera.position.set(0, 0, _introZoom.endZ);
        v.camera.lookAt(0, 0, v.camera.position.z - 80);
    });
}

// Nav Button Bindings
document.querySelectorAll('.nav-btn').forEach(function(btn, idx) {
    btn.addEventListener('click', function() {
        setBackground(idx);
        document.querySelectorAll('.nav-btn').forEach(function(b) { b.style.borderColor = ''; b.style.background = ''; });
        btn.style.borderColor = 'rgba(0,0,0,0.3)'; btn.style.background = 'rgba(0,0,0,0.06)';
    });
});

// === Animation Loop ===
function startAnimationLoop() {
    var renderer = Q4Scene.renderer, scene = Q4Scene.scene, clock = Q4Scene.clock;
    function animate() {
        Q4Scene._animFrameId = requestAnimationFrame(animate);
        var et = clock.getElapsedTime(), now = performance.now();
        if (Q4Scene.currentBgAnimate) Q4Scene.currentBgAnimate(et);
        
        // --- Weather Easter Egg Animation Hook ---
        if (typeof window._weatherAnimate === 'function') {
            window._weatherAnimate();
        }
        
        renderer.setScissorTest(true);
        var pr = renderer.getPixelRatio(), views = Q4Scene.activeViews, winH = window.innerHeight;
        for (var i = 0; i < views.length; i++) {
            var v = views[i], cam = v.camera;
            if (!_introZoom.done && _introZoom.startTime > 0) {
                var t = Math.min(1, (now - _introZoom.startTime) / _introZoom.duration);
                cam.position.z = _introZoom.startZ + (_introZoom.endZ - _introZoom.startZ) * (1 - Math.pow(1 - t, 3));
                if (t >= 1) _introZoom.done = true;
            } else {
                if (v.paneState) {
                    var st = v.paneState;
                    st.scrollDepth += (st.targetDepth - st.scrollDepth) * 0.12;
                    cam.position.z = _introZoom.endZ - st.scrollDepth;
                    // In 2D Grid view: lock pan — grid stays fixed, only zoom allowed
                    if (Q4Scene.activeBackgroundIndex !== 21) {
                        var pl = st.isDragging ? 0.2 : 0.12;
                        st.cameraOffset.x += (st.targetCameraOffset.x - st.cameraOffset.x) * pl;
                        st.cameraOffset.y += (st.targetCameraOffset.y - st.cameraOffset.y) * pl;
                        cam.position.x = st.cameraOffset.x; cam.position.y = st.cameraOffset.y;
                    } else {
                        // Reset any accumulated offset so camera stays centred on grid
                        st.cameraOffset.x = 0; st.cameraOffset.y = 0;
                        st.targetCameraOffset.x = 0; st.targetCameraOffset.y = 0;
                        cam.position.x = 0; cam.position.y = 0;
                    }
                }
            }
            cam.lookAt(cam.position.x, cam.position.y, cam.position.z - 80);
            v.controls.target.set(cam.position.x, cam.position.y, cam.position.z - 80);
            var r = v.element.getBoundingClientRect();
            if (r.width === 0 || r.height === 0) continue;
            renderer.setViewport(r.left * pr, (winH - r.bottom) * pr, r.width * pr, r.height * pr);
            renderer.setScissor(r.left * pr, (winH - r.bottom) * pr, r.width * pr, r.height * pr);
            cam.aspect = r.width / r.height; cam.updateProjectionMatrix();
            renderer.render(scene, cam);
        }
    }
    animate();
}

function updateTabHeight(h) {
    document.documentElement.style.setProperty('--tab-height', h + 'px');
    window.dispatchEvent(new Event('resize'));
}

// ==========================================================================
// Weather Easter Egg Engine
// Ported from workspace.js (DEV) to Q4NT PRO scene architecture.
// ==========================================================================

window._weatherMeshes = [];
window._snowingMode = false;
window._rainingMode = false;

// Helpers
function seededRnd(seed) {
  let s = seed;
  return function() {
    s = (s * 1664525 + 1013904223) & 0xffffffff;
    return (s >>> 0) / 0xffffffff;
  };
}

// Procedural Snowflake Texture
function makeFlakeTex(size, seed) {
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  const ctx = cv.getContext('2d');
  ctx.clearRect(0, 0, size, size);

  const cx = size / 2, cy = size / 2, R = size / 2 - 4;
  const r = seededRnd(seed || Math.random() * 999999 | 0);

  const numArms       = [6, 6, 6, 8, 12][Math.floor(r() * 5)];
  const numBranches   = 2 + Math.floor(r() * 4);
  const branchAngle   = (Math.PI / 6) + r() * (Math.PI / 3);
  const branchTaper   = 0.18 + r() * 0.18;
  const hasTipDiamond = r() > 0.3;
  const hasTipFork    = r() > 0.25;
  const hasInnerHex   = r() > 0.4;
  const hasInnerRing  = r() > 0.35;
  const hasSecondaryBranches = r() > 0.45;
  const centerStyle   = Math.floor(r() * 4);
  const armTaper      = 0.85 + r() * 0.15;
  const hasMidNode    = r() > 0.5;
  const tipStyle      = Math.floor(r() * 3);

  function drawArm(len, angle) {
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(angle);
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, -len); ctx.stroke();
    if (hasMidNode) {
      ctx.beginPath(); ctx.arc(0, -len * 0.5, len * 0.04, 0, Math.PI * 2); ctx.stroke();
    }
    for (let k = 1; k <= numBranches; k++) {
      const t  = k / (numBranches + 1);
      const y  = -len * t;
      const bL = len * branchTaper * (1 - t * 0.45) * armTaper;
      [-1, 1].forEach(side => {
        const bx = Math.sin(branchAngle) * bL * side;
        const by = -Math.cos(branchAngle) * bL;
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(bx, y + by); ctx.stroke();
        if (hasSecondaryBranches && k <= 2) {
          const sbL = bL * 0.35;
          ctx.beginPath(); ctx.moveTo(bx * 0.5, y + by * 0.5);
          ctx.lineTo(bx * 0.5 + side * sbL * 0.7, y + by * 0.5 - sbL * 0.7); ctx.stroke();
        }
        const tipR = r();
        if (tipR < 0.33) {
          ctx.beginPath(); ctx.moveTo(bx, y+by); ctx.lineTo(bx+side*bL*0.2, y+by-bL*0.2); ctx.stroke();
        } else if (tipR < 0.66) {
          const dd = bL * 0.13;
          ctx.beginPath(); ctx.moveTo(bx, y+by-dd); ctx.lineTo(bx+side*dd, y+by);
          ctx.lineTo(bx, y+by+dd*0.6); ctx.lineTo(bx-side*dd, y+by);
          ctx.closePath(); ctx.stroke();
        } else {
          ctx.beginPath(); ctx.arc(bx, y+by, bL*0.07, 0, Math.PI*2); ctx.stroke();
        }
      });
    }
    const f = len * 0.13;
    if (tipStyle === 0 || hasTipFork) {
      ctx.beginPath(); ctx.moveTo(0,-len); ctx.lineTo( f,-len+f); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0,-len); ctx.lineTo(-f,-len+f); ctx.stroke();
    }
    if (tipStyle === 1 || hasTipDiamond) {
      ctx.beginPath(); ctx.moveTo(0, -len-f*0.55); ctx.lineTo(f*0.5,-len);
      ctx.lineTo(0, -len+f*0.55); ctx.lineTo(-f*0.5,-len);
      ctx.closePath(); ctx.stroke();
    }
    if (tipStyle === 2) {
      ctx.beginPath(); ctx.moveTo(0,-len); ctx.lineTo(0,-len-f*0.7); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0,-len); ctx.lineTo( f,-len+f*0.5); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0,-len); ctx.lineTo(-f,-len+f*0.5); ctx.stroke();
    }
    ctx.restore();
  }

  const isDark = document.documentElement.classList.contains('dark-theme');
  ctx.strokeStyle = isDark ? 'rgba(255,255,255,0.88)' : 'rgba(50,80,140,0.88)';
  ctx.lineWidth   = Math.max(1.5, size * 0.014);
  ctx.lineCap     = 'round';
  ctx.lineJoin    = 'round';

  const armOffset = r() * (Math.PI / numArms);
  for (let i = 0; i < numArms; i++) {
    drawArm(R * 0.9, (Math.PI * 2 / numArms) * i + armOffset - Math.PI / 2);
  }

  ctx.save(); ctx.translate(cx, cy);
  if (centerStyle === 0) {
    ctx.beginPath();
    for (let i = 0; i < 6; i++) {
      const a = (Math.PI/3)*i;
      i===0 ? ctx.moveTo(Math.cos(a)*R*0.13, Math.sin(a)*R*0.13) : ctx.lineTo(Math.cos(a)*R*0.13, Math.sin(a)*R*0.13);
    }
    ctx.closePath(); ctx.stroke();
  } else if (centerStyle === 1) {
    ctx.beginPath(); ctx.arc(0, 0, R*0.12, 0, Math.PI*2); ctx.stroke();
  } else if (centerStyle === 2) {
    for (let i = 0; i < 6; i++) {
      const a = (Math.PI/3)*i;
      ctx.beginPath(); ctx.moveTo(0,0);
      ctx.lineTo(Math.cos(a)*R*0.18, Math.sin(a)*R*0.18); ctx.stroke();
    }
  } else {
    ctx.beginPath(); ctx.arc(0,0,R*0.08,0,Math.PI*2); ctx.stroke();
    ctx.beginPath(); ctx.arc(0,0,R*0.16,0,Math.PI*2); ctx.stroke();
  }

  if (hasInnerRing) {
    ctx.beginPath();
    for (let i = 0; i < 6; i++) {
      const a = (Math.PI/3)*i + Math.PI/6;
      i===0 ? ctx.moveTo(Math.cos(a)*R*0.23, Math.sin(a)*R*0.23) : ctx.lineTo(Math.cos(a)*R*0.23, Math.sin(a)*R*0.23);
    }
    ctx.closePath(); ctx.stroke();
  }
  ctx.restore();

  const grd = ctx.createRadialGradient(cx,cy,0, cx,cy,R*0.1);
  if (isDark) {
      grd.addColorStop(0, 'rgba(255,255,255,0.95)');
      grd.addColorStop(1, 'rgba(255,255,255,0)');
  } else {
      grd.addColorStop(0, 'rgba(50,80,140,0.95)');
      grd.addColorStop(1, 'rgba(50,80,140,0)');
  }
  ctx.beginPath(); ctx.arc(cx, cy, R*0.1, 0, Math.PI*2);
  ctx.fillStyle = grd; ctx.fill();

  return cv;
}

// Procedural Dollar Texture
function makeDollarTex(size, seed) {
    var cv = document.createElement('canvas');
    cv.width = cv.height = size;
    var ctx = cv.getContext('2d');
    ctx.clearRect(0, 0, size, size);

    var rng = seededRnd(seed || Math.random() * 999999 | 0);
    var greens = [
        'rgba(0,230,64,0.92)',
        'rgba(34,197,94,0.92)',
        'rgba(16,185,129,0.90)',
        'rgba(74,222,128,0.92)',
        'rgba(0,255,100,0.88)'
    ];
    var color = greens[Math.floor(rng() * greens.length)];

    var fontSize = Math.round(size * (0.55 + rng() * 0.15));
    ctx.font = 'bold ' + fontSize + 'px "Inter", "Segoe UI", Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = color;
    ctx.shadowColor = 'rgba(0,200,60,0.4)';
    ctx.shadowBlur = size * 0.08;
    ctx.fillText('$', size / 2, size / 2);

    ctx.shadowBlur = size * 0.18;
    ctx.shadowColor = 'rgba(0,255,80,0.25)';
    ctx.fillText('$', size / 2, size / 2);

    return cv;
}

// Animation Loop for Weather
window._weatherAnimate = function() {
    if (!window._snowingMode && !window._rainingMode) return;
    if (!Q4Scene.activeViews || Q4Scene.activeViews.length === 0) return;
    
    // Use the first view's camera as the primary reference for depth/vWidth
    var mainView = Q4Scene.activeViews[0];
    var camera = mainView.camera;
    
    // Ledge detection: use the bottom-tab-panel's top edge so it pans with the tab bar.
    // Fall back to .panel-bottom (command panel) if the tab panel is not present.
    var _btLedgeScreenY = -1;
    var _btEl = document.getElementById('bottom-tab-panel') || document.querySelector('.bottom-tab-panel') || document.querySelector('.panel-bottom');
    if (_btEl) {
        _btLedgeScreenY = _btEl.getBoundingClientRect().top;
    }

    if (window._snowingMode) {
        window._snowFrame = (window._snowFrame || 0) + 1;
        if (--window._gustTimer < 0) {
            window._gustTarget = (Math.random() * 0.05 - 0.025) * 10;
            window._gustTimer = 180 + Math.random() * 240;
        }
        window._gustX = (window._gustX || 0);
        window._gustX += (window._gustTarget - window._gustX) * 0.005;
        var wind = window._gustX + (window._snowMouseX || 0) * 0.5 + Math.sin(window._snowFrame * 0.01) * 0.1;

        for (var i = 0; i < window._weatherMeshes.length; i++) {
            var sp = window._weatherMeshes[i];
            if (sp && sp.userData && sp.userData.isSnowflake) {
                var d = sp.userData;
                if (d._landed) {
                    d._landTimer--;
                    // Re-project NDC -> world every frame so the flake "sticks" to the
                    // tab bar as the user pans or zooms the scene.
                    if (d._ndcX !== undefined) {
                        var lockVec = new THREE.Vector3(d._ndcX, d._ndcY, d._ndcZ);
                        lockVec.unproject(camera);
                        sp.position.copy(lockVec);
                        d.x = lockVec.x; d.y = lockVec.y; d.z = lockVec.z;
                    }
                    // Mouse proximity blow-off: if the cursor enters ~7% screen radius, scatter the flake.
                    if (window._snowMouseX !== undefined && window._snowMouseY !== undefined && d._ndcX !== undefined) {
                        var _mdx = window._snowMouseX - d._ndcX;
                        var _mdy = window._snowMouseY - d._ndcY;
                        if (_mdx*_mdx + _mdy*_mdy < 0.005) {
                            d._landTimer = 0;
                        }
                    }
                    if (d._landTimer <= 0) {
                        d._landed = false; d._isFading = true;
                        // Blow away from the mouse position in NDC space.
                        var _mxRef = (window._snowMouseX !== undefined) ? window._snowMouseX : 0;
                        d.vx = (d._ndcX > _mxRef ? 1 : -1) * (1.5 + Math.random() * 2.5);
                        d.vy = (Math.random() * 0.6 + 0.4);
                    }
                    continue;
                }
                var swayX = Math.sin(window._snowFrame * 0.014 + d.phase) * d.swayA * 1.5;
                if (d._isFading) { d.baseOpa -= 0.015; d.size *= 0.98; if (d.baseOpa <= 0) d.y = -99999; }
                d.x += (d.vx + wind + swayX);
                d.y += d.vy;
                d.rot += d.rspd;
                sp.material.rotation = d.rot;
                sp.position.set(d.x, d.y, d.z);
                // Depth normalization: spawn range is 50-450 units behind camera.
                // Using /500 keeps near particles at ~0.9 opacity and far ones at ~0.1.
                var dist = Math.abs(d.z - camera.position.z);
                var nDepth = THREE.MathUtils.clamp(1 - dist / 500, 0.12, 1);
                sp.scale.setScalar(d.size * nDepth);
                sp.material.opacity = Math.max(0, d.baseOpa * Math.max(0.4, nDepth));

                if (_btLedgeScreenY > 0 && nDepth > 0.3) {
                    var _proj = sp.position.clone().project(camera);
                    var _screenY = (-_proj.y * 0.5 + 0.5) * window.innerHeight;
                    if (_screenY >= _btLedgeScreenY - 4 && _screenY <= _btLedgeScreenY + 8 && d.vy < 0) {
                        if (Math.random() < 0.15 && !d._isClone) {
                            var cloneSp = new THREE.Sprite(sp.material.clone());
                            cloneSp.position.copy(sp.position); cloneSp.scale.copy(sp.scale);
                            var cloneD = Object.assign({}, d);
                            cloneD._landed = true; cloneD._isClone = true;
                            cloneD._landTimer = 600 + Math.floor(Math.random() * 1800);
                            cloneD.vy = 0; cloneD.vx = 0;
                            cloneD._ndcX = _proj.x; cloneD._ndcY = _proj.y; cloneD._ndcZ = _proj.z;
                            cloneSp.userData = cloneD;
                            Q4Scene.scene.add(cloneSp);
                            window._weatherMeshes.push(cloneSp);
                            d.y = camera.position.y - 300; 
                            continue;
                        }
                    }
                }
                var distZ = Math.max(1, camera.position.z - d.z);
                var vHeight = 2 * distZ * Math.tan((camera.fov || 45) * Math.PI / 360);
                var vWidth = vHeight * (camera.aspect || 1);
                if (d.y < camera.position.y - vHeight/2 - 20) {
                    if (d._isClone) { Q4Scene.scene.remove(sp); if (sp.material) sp.material.dispose(); window._weatherMeshes.splice(i, 1); i--; continue; }
                    d.y = camera.position.y + vHeight/2 + Math.random() * 50;
                    d.x = camera.position.x + (Math.random() - 0.5) * vWidth;
                    d._landed = false; d._ndcX = undefined;
                }
                if (d.x > camera.position.x + vWidth/2 + 20) d.x = camera.position.x - vWidth/2;
                if (d.x < camera.position.x - vWidth/2 - 20) d.x = camera.position.x + vWidth/2;
            }
        }
    }

    if (window._rainingMode) {
        window._rainFrame = (window._rainFrame || 0) + 1;
        if (--window._rainGustTimer < 0) {
            window._rainGustTarget = (Math.random() * 0.02 - 0.01) * 10;
            window._rainGustTimer = 120 + Math.random() * 160;
        }
        window._rainGustX = (window._rainGustX || 0) + (window._rainGustTarget - (window._rainGustX || 0)) * 0.005;
        var rwind = window._rainGustX + (window._rainMouseX || 0) * 0.3 + Math.sin(window._rainFrame * 0.008) * 0.06;

        for (var ri = 0; ri < window._weatherMeshes.length; ri++) {
            var rsp = window._weatherMeshes[ri];
            if (rsp && rsp.userData && rsp.userData.isRainDrop) {
                var rd = rsp.userData;
                if (rd._landed) {
                    rd._landTimer--;
                    // Re-project NDC -> world every frame so the dollar "sticks" to the
                    // tab bar as the user pans or zooms the scene.
                    if (rd._ndcX !== undefined) {
                        var lockVec = new THREE.Vector3(rd._ndcX, rd._ndcY, rd._ndcZ);
                        lockVec.unproject(camera);
                        rsp.position.copy(lockVec);
                        rd.x = lockVec.x; rd.y = lockVec.y; rd.z = lockVec.z;
                    }
                    // Mouse proximity blow-off: if the cursor enters ~7% screen radius, scatter the dollar.
                    if (window._rainMouseX !== undefined && window._rainMouseY !== undefined && rd._ndcX !== undefined) {
                        var _rmdx = window._rainMouseX - rd._ndcX;
                        var _rmdy = window._rainMouseY - rd._ndcY;
                        if (_rmdx*_rmdx + _rmdy*_rmdy < 0.005) {
                            rd._landTimer = 0;
                        }
                    }
                    if (rd._landTimer <= 0) {
                        rd._landed = false; rd._isFading = true;
                        // Blow away from the mouse position in NDC space.
                        var _rmxRef = (window._rainMouseX !== undefined) ? window._rainMouseX : 0;
                        rd.vx = (rd._ndcX > _rmxRef ? 1 : -1) * (1.5 + Math.random() * 2.5);
                        rd.vy = (Math.random() * 0.6 + 0.4);
                    }
                    continue;
                }
                var rswayX = Math.sin(window._rainFrame * 0.018 + rd.phase) * rd.swayA * 0.8;
                if (rd._isFading) { rd.baseOpa -= 0.015; rd.size *= 0.98; if (rd.baseOpa <= 0) rd.y = -99999; }
                rd.x += (rd.vx + rwind + rswayX);
                rd.y += rd.vy;
                rd.rot += rd.rspd;
                rsp.material.rotation = rd.rot;
                rsp.position.set(rd.x, rd.y, rd.z);
                // Depth normalization matching the 50-450 unit spawn range.
                var rdist = Math.abs(rd.z - camera.position.z);
                var rnDepth = THREE.MathUtils.clamp(1 - rdist / 500, 0.12, 1);
                rsp.scale.setScalar(rd.size * rnDepth);
                rsp.material.opacity = Math.max(0, rd.baseOpa * Math.max(0.45, rnDepth));

                if (_btLedgeScreenY > 0 && rnDepth > 0.3) {
                    var _rproj = rsp.position.clone().project(camera);
                    var _rscreenY = (-_rproj.y * 0.5 + 0.5) * window.innerHeight;
                    if (_rscreenY >= _btLedgeScreenY - 4 && _rscreenY <= _btLedgeScreenY + 8 && rd.vy < 0) {
                        if (Math.random() < 0.15 && !rd._isClone) {
                            var cloneRsp = new THREE.Sprite(rsp.material.clone());
                            cloneRsp.position.copy(rsp.position); cloneRsp.scale.copy(rsp.scale);
                            var cloneRd = Object.assign({}, rd);
                            cloneRd._landed = true; cloneRd._isClone = true;
                            cloneRd._landTimer = 600 + Math.floor(Math.random() * 1800);
                            cloneRd.vy = 0; cloneRd.vx = 0;
                            cloneRd._ndcX = _rproj.x; cloneRd._ndcY = _rproj.y; cloneRd._ndcZ = _rproj.z;
                            cloneRsp.userData = cloneRd;
                            Q4Scene.scene.add(cloneRsp);
                            window._weatherMeshes.push(cloneRsp);
                            rd.y = camera.position.y - 300;
                            continue;
                        }
                    }
                }
                var rdistZ = Math.max(1, camera.position.z - rd.z);
                var rvHeight = 2 * rdistZ * Math.tan((camera.fov || 45) * Math.PI / 360);
                var rvWidth = rvHeight * (camera.aspect || 1);
                if (rd.y < camera.position.y - rvHeight/2 - 20) {
                    if (rd._isClone) { Q4Scene.scene.remove(rsp); if (rsp.material) rsp.material.dispose(); window._weatherMeshes.splice(ri, 1); ri--; continue; }
                    rd.y = camera.position.y + rvHeight/2 + Math.random() * 50;
                    rd.x = camera.position.x + (Math.random() - 0.5) * rvWidth;
                    rd._landed = false; rd._ndcX = undefined;
                }
                if (rd.x > camera.position.x + rvWidth/2 + 20) rd.x = camera.position.x - rvWidth/2;
                if (rd.x < camera.position.x - rvWidth/2 - 20) rd.x = camera.position.x + rvWidth/2;
            }
        }
    }
};

// Mouse Drift Tracking
window.addEventListener('mousemove', function(e) {
    if (window._snowingMode) {
        window._snowMouseX = (e.clientX / window.innerWidth) * 2 - 1;
        window._snowMouseY = -(e.clientY / window.innerHeight) * 2 + 1;
    }
    if (window._rainingMode) {
        window._rainMouseX = (e.clientX / window.innerWidth) * 2 - 1;
        window._rainMouseY = -(e.clientY / window.innerHeight) * 2 + 1;
    }
});

// Triggers
window._triggerMakeItSnow = function() {
    if (!Q4Scene.scene) return;
    if (window._rainingMode) window._stopMakeItRain();
    if (!window._snowTexPool) {
        window._snowTexPool = [];
        for (let i = 0; i < 50; i++) {
            window._snowTexPool.push(new THREE.CanvasTexture(makeFlakeTex(256, i * 7919 + 13)));
        }
    }
    window._stopMakeItSnow();
    const camera = Q4Scene.activeViews[0].camera;
    for (var i = 0; i < 800; i++) {
        var distZ = 50 + Math.random() * 400;
        var vHeight = 2 * distZ * Math.tan((camera.fov || 45) * Math.PI / 360);
        var vWidth = vHeight * (camera.aspect || 1);
        var d = {
            x: camera.position.x + (Math.random() - 0.5) * vWidth,
            y: camera.position.y + (Math.random() - 0.5) * vHeight,
            z: camera.position.z - distZ,
            vx: (Math.random() * 0.022 - 0.011) * 6,
            vy: -(Math.random() * 0.043 + 0.022) * 10,
            rot: Math.random() * Math.PI*2,
            rspd: Math.random() * 0.032 - 0.016,
            size: ((Math.random() * 0.156 + 0.054) * 45) * 0.3,
            baseOpa: Math.random() * 0.28 + 0.72,
            phase: Math.random() * Math.PI*2,
            swayA: (Math.random() * 0.007 + 0.002) * 10,
            isSnowflake: true
        };
        const mat = new THREE.SpriteMaterial({
            map: window._snowTexPool[Math.floor(Math.random() * window._snowTexPool.length)],
            transparent: true, opacity: d.baseOpa, depthWrite: false
        });
        const sp = new THREE.Sprite(mat);
        sp.scale.setScalar(d.size); sp.position.set(d.x, d.y, d.z); sp.userData = d;
        Q4Scene.scene.add(sp);
        window._weatherMeshes.push(sp);
    }
    window._snowingMode = true;
    window._snowFrame = 0; window._gustTimer = 0;
};

window._stopMakeItSnow = function() {
    window._snowingMode = false;
    for (var i = 0; i < window._weatherMeshes.length; i++) {
        var m = window._weatherMeshes[i];
        if (m && m.userData.isSnowflake) {
            Q4Scene.scene.remove(m);
            if (m.material) m.material.dispose();
            window._weatherMeshes.splice(i, 1); i--;
        }
    }
};

window._triggerMakeItRain = function() {
    if (!Q4Scene.scene) return;
    if (window._snowingMode) window._stopMakeItSnow();
    if (!window._rainTexPool) {
        window._rainTexPool = [];
        for (var i = 0; i < 30; i++) {
            window._rainTexPool.push(new THREE.CanvasTexture(makeDollarTex(256, i * 6271 + 37)));
        }
    }
    window._stopMakeItRain();
    const camera = Q4Scene.activeViews[0].camera;
    for (var i = 0; i < 600; i++) {
        var distZ = 50 + Math.random() * 400;
        var vHeight = 2 * distZ * Math.tan((camera.fov || 45) * Math.PI / 360);
        var vWidth = vHeight * (camera.aspect || 1);
        var d = {
            x: camera.position.x + (Math.random() - 0.5) * vWidth,
            y: camera.position.y + (Math.random() - 0.5) * vHeight,
            z: camera.position.z - distZ,
            vx: (Math.random() * 0.018 - 0.009) * 10,
            vy: -(Math.random() * 0.06 + 0.035) * 20,
            rot: Math.random() * Math.PI * 2,
            rspd: Math.random() * 0.02 - 0.01,
            size: ((Math.random() * 0.12 + 0.05) * 45) * 0.35,
            baseOpa: Math.random() * 0.25 + 0.75,
            phase: Math.random() * Math.PI * 2,
            swayA: (Math.random() * 0.005 + 0.001) * 10,
            isRainDrop: true
        };
        var mat = new THREE.SpriteMaterial({
            map: window._rainTexPool[Math.floor(Math.random() * window._rainTexPool.length)],
            transparent: true, opacity: d.baseOpa, depthWrite: false
        });
        var sp = new THREE.Sprite(mat);
        sp.scale.setScalar(d.size); sp.position.set(d.x, d.y, d.z); sp.userData = d;
        Q4Scene.scene.add(sp);
        window._weatherMeshes.push(sp);
    }
    window._rainingMode = true;
    window._rainFrame = 0; window._rainGustTimer = 0;
};

window._stopMakeItRain = function() {
    window._rainingMode = false;
    for (var i = 0; i < window._weatherMeshes.length; i++) {
        var m = window._weatherMeshes[i];
        if (m && m.userData.isRainDrop) {
            Q4Scene.scene.remove(m);
            if (m.material) m.material.dispose();
            window._weatherMeshes.splice(i, 1); i--;
        }
    }
};

