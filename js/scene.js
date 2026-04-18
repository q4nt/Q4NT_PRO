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
var _dvState = {
    scrollDepth: 0, targetDepth: 0,
    cameraOffset: { x: 0, y: 0 }, targetCameraOffset: { x: 0, y: 0 },
    isDragging: false, previousMousePosition: { x: 0, y: 0 }
};
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
        var onWheel = function(e) {
            e.preventDefault();
            var oldD = _dvState.targetDepth;
            var newD = Math.max(0, Math.min(1280, oldD + (-e.deltaY * 0.18)));
            _dvState.targetDepth = newD;
            var ad = newD - oldD;
            if (Math.abs(ad) > 0.001) {
                var h = Math.tan((cam.fov * Math.PI / 180) / 2), w = h * cam.aspect;
                var nx = _dvState.targetCameraOffset.x + ((e.clientX / window.innerWidth) * 2 - 1) * w * ad;
                var ny = _dvState.targetCameraOffset.y + (-(e.clientY / window.innerHeight) * 2 + 1) * h * ad;
                var c = _clampCameraOffset(nx, ny);
                _dvState.targetCameraOffset.x = c.x; _dvState.targetCameraOffset.y = c.y;
            }
        };
        pane.addEventListener('wheel', onWheel, { passive: false });
        var onMD = function(e) {
            if (e.button !== 0) return;
            if (e.target.closest && (e.target.closest('.beveled-panel') || e.target.closest('.float-panel') ||
                e.target.closest('.bottom-tab-panel') || e.target.closest('.ai-edge-panel') ||
                e.target.closest('.prompt-container'))) return;
            _dvState.isDragging = true;
            _dvState.previousMousePosition = { x: e.clientX, y: e.clientY };
        };
        var onMM = function(e) {
            if (!_dvState.isDragging) return;
            var c = _clampCameraOffset(
                _dvState.targetCameraOffset.x - (e.clientX - _dvState.previousMousePosition.x) * 0.1,
                _dvState.targetCameraOffset.y + (e.clientY - _dvState.previousMousePosition.y) * 0.1
            );
            _dvState.targetCameraOffset.x = c.x; _dvState.targetCameraOffset.y = c.y;
            _dvState.previousMousePosition.x = e.clientX; _dvState.previousMousePosition.y = e.clientY;
        };
        var onMU = function() { _dvState.isDragging = false; };
        window.addEventListener('mousedown', onMD);
        window.addEventListener('mousemove', onMM);
        window.addEventListener('mouseup', onMU);
        Q4Scene.activeViews.push({
            camera: cam, controls: ctrl, element: pane,
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
    _dvState.scrollDepth = 0; _dvState.targetDepth = 0;
    _dvState.cameraOffset.x = 0; _dvState.cameraOffset.y = 0;
    _dvState.targetCameraOffset.x = 0; _dvState.targetCameraOffset.y = 0;
    _dvState.isDragging = false;
    Q4Scene.activeViews.forEach(function(v) {
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
        renderer.setScissorTest(true);
        var pr = renderer.getPixelRatio(), views = Q4Scene.activeViews, winH = window.innerHeight;
        for (var i = 0; i < views.length; i++) {
            var v = views[i], cam = v.camera;
            if (!_introZoom.done && _introZoom.startTime > 0) {
                var t = Math.min(1, (now - _introZoom.startTime) / _introZoom.duration);
                cam.position.z = _introZoom.startZ + (_introZoom.endZ - _introZoom.startZ) * (1 - Math.pow(1 - t, 3));
                if (t >= 1) _introZoom.done = true;
            } else {
                _dvState.scrollDepth += (_dvState.targetDepth - _dvState.scrollDepth) * 0.12;
                cam.position.z = _introZoom.endZ - _dvState.scrollDepth;
                var pl = _dvState.isDragging ? 0.2 : 0.12;
                _dvState.cameraOffset.x += (_dvState.targetCameraOffset.x - _dvState.cameraOffset.x) * pl;
                _dvState.cameraOffset.y += (_dvState.targetCameraOffset.y - _dvState.cameraOffset.y) * pl;
                cam.position.x = _dvState.cameraOffset.x; cam.position.y = _dvState.cameraOffset.y;
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
