/* ==========================================================================
   Q4NT PRO — View Cycle HUD
   Manages the #cubeWrapper depth-mode navigation (7 modes), the
   #cubeDepthLabel, and the side-arrow controls.
   Previously embedded in SpotifyPillController.createHTMLElements().
   ========================================================================== */

window.addEventListener('DOMContentLoaded', function initViewCycleHUD() {

    // ---- Inject HTML ----
    let stack = document.getElementById('bottomRightStack');
    if (!stack) {
        stack = document.createElement('div');
        stack.id = 'bottomRightStack';
        let container = document.getElementById('ui-container') || document.body;
        container.appendChild(stack);
    }
    const hudHTML = `
        <div id="cubeDepthLabel">
            <span class="cube-label-text">3D Depth View</span>
        </div>
        <div id="cubeWrapper">
            <button class="cube-side-arrow cube-side-arrow--left" id="cubeNavLeft" title="Previous View">
                <svg viewBox="0 0 24 24" fill="currentColor"><path d="M15.41 7.41L14 6l-6 6 6 6 1.41-1.41L10.83 12z"/></svg>
            </button>
            <div id="cubeContainer">
                <div id="cubeModeIcon">
                    <!-- Icon is injected dynamically -->
                </div>
            </div>
            <button class="cube-side-arrow cube-side-arrow--right" id="cubeNavRight" title="Next View">
                <svg viewBox="0 0 24 24" fill="currentColor"><path d="M10 6L8.59 7.41 13.17 12l-4.58 4.59L10 18l6-6z"/></svg>
            </button>
        </div>
    `;
    stack.insertAdjacentHTML('afterbegin', hudHTML);

    // ---- Depth mode definitions ----
    // Mode 0: 3D Depth View   -> setBackground(0)
    // Mode 1: Shapes View     -> 3D objects only
    // Mode 2: Node Network    -> setBackground(20)
    // Mode 3: 2D Grid         -> setBackground(21)
    // Mode 4: Floors View     -> setBackground(1)
    const DEPTH_MODES = [
        { label: '3D Depth View', bg: 0,    flat: false, split: false, shapesOnly: false },
        { label: 'Node Network',  bg: 20,   flat: false, split: false, shapesOnly: false },
        { label: 'Shapes View',   bg: 0,    flat: false, split: false, shapesOnly: true  },
        { label: '2D Grid',       bg: 21,   flat: false, split: false, shapesOnly: false },
        { label: 'Floors View',   bg: 1,    flat: false, split: false, shapesOnly: false },
    ];

    let _depthModeIndex = 0;

    // ---- Mode Icons (SVGs) ----
    const MODE_ICONS = [
        // 0: 3D Depth View (Scattered Panels)
        `<svg viewBox="0 0 160 140" fill="none" xmlns="http://www.w3.org/2000/svg"><defs><filter id="ps" x="-15%" y="-15%" width="130%" height="135%"><feDropShadow dx="2" dy="4" stdDeviation="5" flood-color="rgba(0,0,0,0.22)"/></filter><filter id="ps-sm" x="-15%" y="-15%" width="130%" height="135%"><feDropShadow dx="1" dy="2" stdDeviation="2" flood-color="rgba(0,0,0,0.3)"/></filter></defs><rect id="shape-layout-1" class="depth-shape" style="cursor:pointer;" x="6" y="8" width="68" height="48" rx="11" fill="rgba(140,140,140,0.52)" filter="url(#ps)"/><circle id="shape-layout-2" class="depth-shape" style="cursor:pointer;" cx="118" cy="28" r="24" fill="rgba(118,118,118,0.48)" filter="url(#ps)"/><g id="shape-layout-3" class="depth-shape" style="cursor:pointer;"><rect x="44" y="38" width="74" height="54" rx="11" fill="rgba(238,238,238,0.96)" filter="url(#ps)"/><rect x="52" y="44" width="22" height="16" rx="3" fill="rgba(180,180,180,0.8)" filter="url(#ps-sm)"/><rect x="84" y="62" width="26" height="20" rx="3" fill="rgba(200,200,200,0.9)" filter="url(#ps-sm)"/><rect x="66" y="50" width="20" height="26" rx="3" fill="rgba(255,255,255,1)" filter="url(#ps-sm)"/></g><g id="shape-layout-4" class="depth-shape" style="cursor:pointer;"><rect x="4" y="80" width="70" height="50" rx="11" fill="rgba(172,172,172,0.74)" filter="url(#ps)"/><circle cx="39" cy="105" r="14" fill="rgba(220,220,220,0.9)" filter="url(#ps)"/></g><g id="shape-layout-5" class="depth-shape" style="cursor:pointer;"><rect x="84" y="84" width="68" height="48" rx="11" fill="rgba(198,198,198,0.68)" filter="url(#ps)"/><rect x="90" y="90" width="14" height="36" rx="2" fill="rgba(150,150,150,0.5)"/><rect x="108" y="90" width="38" height="16" rx="2" fill="rgba(150,150,150,0.5)"/><rect x="108" y="110" width="38" height="16" rx="2" fill="rgba(150,150,150,0.5)"/></g></svg>`,
        
        // 1: Node Network
        `<svg viewBox="0 0 160 140" fill="none" xmlns="http://www.w3.org/2000/svg"><defs><filter id="ps" x="-15%" y="-15%" width="130%" height="135%"><feDropShadow dx="2" dy="4" stdDeviation="5" flood-color="rgba(0,0,0,0.22)"/></filter></defs><path d="M40 40 L80 70 L120 40" stroke="rgba(172,172,172,0.6)" stroke-width="3"/><path d="M40 100 L80 70 L120 100" stroke="rgba(172,172,172,0.6)" stroke-width="3"/><path d="M40 40 L40 100" stroke="rgba(172,172,172,0.6)" stroke-width="3"/><circle cx="40" cy="40" r="14" fill="rgba(238,238,238,0.96)" filter="url(#ps)"/><circle cx="120" cy="40" r="14" fill="rgba(238,238,238,0.96)" filter="url(#ps)"/><circle cx="80" cy="70" r="14" fill="rgba(238,238,238,0.96)" filter="url(#ps)"/><circle cx="40" cy="100" r="14" fill="rgba(238,238,238,0.96)" filter="url(#ps)"/><circle cx="120" cy="100" r="14" fill="rgba(238,238,238,0.96)" filter="url(#ps)"/></svg>`,
        
        // 2: Shapes View (Cube canvas visible, icon hidden by CSS, use default as placeholder)
        `<svg viewBox="0 0 160 140" fill="none" xmlns="http://www.w3.org/2000/svg"><defs><filter id="ps" x="-15%" y="-15%" width="130%" height="135%"><feDropShadow dx="2" dy="4" stdDeviation="5" flood-color="rgba(0,0,0,0.22)"/></filter></defs><circle cx="80" cy="70" r="36" fill="rgba(238,238,238,0.96)" filter="url(#ps)"/></svg>`,
        
        // 3: 2D Grid
        `<svg viewBox="0 0 160 140" fill="none" xmlns="http://www.w3.org/2000/svg"><defs><filter id="ps" x="-15%" y="-15%" width="130%" height="135%"><feDropShadow dx="2" dy="4" stdDeviation="5" flood-color="rgba(0,0,0,0.22)"/></filter></defs><rect x="18" y="20" width="34" height="26" rx="6" fill="rgba(172,172,172,0.7)" filter="url(#ps)"/><rect x="63" y="20" width="34" height="26" rx="6" fill="rgba(200,200,200,0.8)" filter="url(#ps)"/><rect x="108" y="20" width="34" height="26" rx="6" fill="rgba(172,172,172,0.7)" filter="url(#ps)"/><rect x="18" y="57" width="34" height="26" rx="6" fill="rgba(200,200,200,0.8)" filter="url(#ps)"/><rect x="63" y="57" width="34" height="26" rx="6" fill="rgba(238,238,238,0.96)" filter="url(#ps)"/><rect x="108" y="57" width="34" height="26" rx="6" fill="rgba(200,200,200,0.8)" filter="url(#ps)"/><rect x="18" y="94" width="34" height="26" rx="6" fill="rgba(172,172,172,0.7)" filter="url(#ps)"/><rect x="63" y="94" width="34" height="26" rx="6" fill="rgba(200,200,200,0.8)" filter="url(#ps)"/><rect x="108" y="94" width="34" height="26" rx="6" fill="rgba(172,172,172,0.7)" filter="url(#ps)"/></svg>`,
        
        // 4: Floors View
        `<svg viewBox="0 0 160 140" fill="none" xmlns="http://www.w3.org/2000/svg"><defs><filter id="ps" x="-15%" y="-15%" width="130%" height="135%"><feDropShadow dx="2" dy="4" stdDeviation="5" flood-color="rgba(0,0,0,0.22)"/></filter></defs><path d="M20 100 L80 130 L140 100 L80 70 Z" fill="rgba(172,172,172,0.8)" filter="url(#ps)"/><path d="M20 60 L80 90 L140 60 L80 30 Z" fill="rgba(238,238,238,0.96)" filter="url(#ps)"/></svg>`
    ];

    // ---- DOM refs ----
    const _labelText  = document.querySelector('#cubeDepthLabel .cube-label-text');
    const _arrowLeft  = document.getElementById('cubeNavLeft');
    const _arrowRight = document.getElementById('cubeNavRight');
    const _cubeWrapper = document.getElementById('cubeWrapper');

    // ---- Helpers ----
    function _ensurePanels() {
        if (typeof Q4Scene === 'undefined' || !Q4Scene.bgGroup || !Q4Scene.activeViews.length) return null;
        const hasPanels = Q4Scene.bgGroup.children.some(c => c.userData && c.userData._isPanel);
        if (!hasPanels && typeof setBackground === 'function') setBackground(0);
        return Q4Scene.bgGroup.children.filter(c => c.userData && c.userData._isPanel);
    }

    function _freezeRotation(mesh) {
        if (!mesh.userData._is3dObj) return;
        mesh.userData._savedRotX = mesh.userData.rotSpeedX;
        mesh.userData._savedRotY = mesh.userData.rotSpeedY;
        mesh.userData._savedRotZ = mesh.userData.rotSpeedZ;
        mesh.userData.rotSpeedX  = 0;
        mesh.userData.rotSpeedY  = 0;
        mesh.userData.rotSpeedZ  = 0;
    }

    function _applyDepthMode(index) {
        _depthModeIndex = ((index % DEPTH_MODES.length) + DEPTH_MODES.length) % DEPTH_MODES.length;
        const mode = DEPTH_MODES[_depthModeIndex];

        // Swap icon: shapes view shows 3D cube via CSS, but we update the SVG anyway
        const modeIconContainer = document.getElementById('cubeModeIcon');
        if (modeIconContainer && MODE_ICONS[_depthModeIndex]) {
            modeIconContainer.innerHTML = MODE_ICONS[_depthModeIndex];
        }

        if (_cubeWrapper) _cubeWrapper.dataset.viewMode = mode.shapesOnly ? 'shapes' : 'panels';

        if (mode.shapesOnly) {
            // ---- SHAPES VIEW ----
            if (typeof setBackground === 'function') setBackground(0);
            if (typeof Q4Scene === 'undefined' || !Q4Scene.bgGroup) return;
            Q4Scene.bgGroup.children.forEach(c => {
                if (!c.userData || !c.userData._isPanel) return;
                if (!c.userData._is3dObj) {
                    c.userData._flatHidden    = true;
                    c.userData.isHiddenByUser = true;
                }
            });

        } else {
            // ---- RESTORE / BG MODE ----
            if (mode.bg !== null && typeof setBackground === 'function') {
                setBackground(mode.bg);
            } else if (typeof Q4Scene !== 'undefined' && Q4Scene.bgGroup) {
                Q4Scene.bgGroup.children.forEach(c => {
                    if (!c.userData || !c.userData._isPanel) return;
                    if (c.userData._flatHidden) {
                        c.userData._flatHidden    = false;
                        c.userData.isHiddenByUser = false;
                    }
                    c.userData.targetX = c.userData.homeX;
                    c.userData.targetY = c.userData.homeY;
                    c.userData.targetZ = c.userData.homeZ;
                    if (c.userData._is3dObj) {
                        c.userData.rotSpeedX = c.userData._savedRotX || (Math.random() - 0.5) * 0.008;
                        c.userData.rotSpeedY = c.userData._savedRotY || 0.006 + Math.random() * 0.010;
                        c.userData.rotSpeedZ = c.userData._savedRotZ || (Math.random() - 0.5) * 0.005;
                    }
                });
            }
        }

        if (_labelText) _labelText.textContent = mode.label;
    }

    // Expose so external code can trigger a mode change programmatically
    window.Q4ViewCycle = { applyMode: _applyDepthMode, getModeIndex: function() { return _depthModeIndex; } };

    // ---- Arrow click listeners ----
    if (_arrowLeft)  _arrowLeft.addEventListener('click',  e => { e.stopPropagation(); _applyDepthMode(_depthModeIndex - 1); });
    if (_arrowRight) _arrowRight.addEventListener('click', e => { e.stopPropagation(); _applyDepthMode(_depthModeIndex + 1); });

    // ---- Auto-collapse side arrows after 3s idle ----
    if (_cubeWrapper) {
        let _hideTimer = null;
        _cubeWrapper.addEventListener('mouseenter', () => {
            clearTimeout(_hideTimer);
            _cubeWrapper.classList.add('cube-arrows-visible');
        });
        _cubeWrapper.addEventListener('mouseleave', () => {
            clearTimeout(_hideTimer);
            _hideTimer = setTimeout(() => _cubeWrapper.classList.remove('cube-arrows-visible'), 3000);
        });
    }

    // Set initial icon
    const initialModeContainer = document.getElementById('cubeModeIcon');
    if (initialModeContainer && MODE_ICONS[_depthModeIndex]) {
        initialModeContainer.innerHTML = MODE_ICONS[_depthModeIndex];
    }

    function _attachIconClickListener() {
        const modeIcon = document.getElementById('cubeModeIcon');
        if (!modeIcon) return;
        const svg = modeIcon.querySelector('svg');
        if (!svg) return;
        svg.addEventListener('click', function(e) {
            e.stopPropagation();
            const shapeTarget = e.target.closest('[id^="shape-layout-"]');
            if (shapeTarget && shapeTarget.id) {
                _applyShapeLayout(shapeTarget.id);
            }
        });
    }
    _attachIconClickListener();

    function _initRandomShapes() {
        if (!window._random3dShapesToggle) {
            var PANEL_W = 36, PANEL_H = 19;
            window._random3dShapesToggle = [
                new THREE.BoxGeometry(PANEL_W * 0.6, PANEL_H * 0.6, PANEL_H * 0.6),
                new THREE.SphereGeometry(PANEL_H * 0.45, 32, 24),
                new THREE.TorusGeometry(PANEL_H * 0.38, PANEL_H * 0.12, 16, 48),
                new THREE.OctahedronGeometry(PANEL_H * 0.48),
                new THREE.ConeGeometry(PANEL_H * 0.4, PANEL_W * 0.55, 32)
            ];

            var objPalette = [
                { color: 0x00f2fe, emissive: 0x003344, metalness: 0.9, roughness: 0.1 },
                { color: 0xa29bfe, emissive: 0x1a0050, metalness: 0.8, roughness: 0.2 },
                { color: 0x55efc4, emissive: 0x003322, metalness: 0.7, roughness: 0.15 },
                { color: 0xfdcb6e, emissive: 0x331a00, metalness: 0.6, roughness: 0.3 },
                { color: 0xff7675, emissive: 0x330000, metalness: 0.75, roughness: 0.2 },
            ];

            window._random3dMatsToggle = objPalette.map(pal => new THREE.MeshStandardMaterial({
                color: pal.color, emissive: pal.emissive, metalness: pal.metalness,
                roughness: pal.roughness, transparent: true, opacity: 0.92
            }));
        }
    }

    function _applyShapeLayout(layoutId) {
        console.log('[Q4NT HUD] _applyShapeLayout fired:', layoutId);
        if (typeof Q4Scene === 'undefined' || !Q4Scene.bgGroup) {
            console.warn('[Q4NT HUD] Q4Scene or bgGroup not ready');
            return;
        }

        // Only target flat panels (_isPanel true, but NOT natively _is3dObj from scene init)
        const allPanels = Q4Scene.bgGroup.children.filter(c => c.userData && c.userData._isPanel);
        const panels = allPanels.filter(c => !c.userData._nativeIs3dObj);
        console.log('[Q4NT HUD] panels found:', allPanels.length, 'flat panels:', panels.length);
        if (!panels.length) return;

        _initRandomShapes();
        let shapeIdx = 0;

        const restoreToFlat = () => {
            panels.forEach(c => {
                if (c.userData._originalGeo) {
                    c.geometry = c.userData._originalGeo;
                    c.material = c.userData._originalMat;
                    if (c.userData._originalRotation) {
                        c.rotation.copy(c.userData._originalRotation);
                    } else {
                        c.rotation.set(0, 0, 0);
                    }
                }
                c.children.forEach(child => { if (child instanceof THREE.LineSegments) child.visible = true; });
                c.userData._is3dObj = false;
            });
        };

        if (layoutId === 'shape-layout-1') {
            // Layout 1 (Top-Left): Horizontal Line Layout
            restoreToFlat();
            const startX = -180;
            const spacing = 90;
            panels.forEach((c, idx) => {
                c.userData.targetX = startX + (idx * spacing);
                c.userData.targetY = 20;
                c.userData.targetZ = -120;
            });
        } 
        else if (layoutId === 'shape-layout-2') {
            // Layout 2 (Top-Right): 3D Shapes Mode
            panels.forEach(c => {
                if (!c.userData._is3dObj) {
                    if (!c.userData._originalGeo) c.userData._originalGeo = c.geometry;
                    if (!c.userData._originalMat) c.userData._originalMat = c.material;
                    if (!c.userData._originalRotation) c.userData._originalRotation = c.rotation.clone();
                    
                    c.geometry = window._random3dShapesToggle[shapeIdx % window._random3dShapesToggle.length];
                    c.material = window._random3dMatsToggle[shapeIdx % window._random3dMatsToggle.length];
                    c.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI);
                    c.children.forEach(child => { if (child instanceof THREE.LineSegments) child.visible = false; });
                    c.userData._is3dObj = true;
                }
                shapeIdx++;
            });
        } 
        else if (layoutId === 'shape-layout-3') {
            // Layout 3 (Center): Scattered Depth Layout
            restoreToFlat();
            panels.forEach(c => {
                c.userData.targetX = c.userData.homeX + (Math.random() - 0.5) * 60;
                c.userData.targetY = c.userData.homeY + (Math.random() - 0.5) * 60;
                c.userData.targetZ = c.userData.homeZ + (Math.random() - 0.5) * 450;
            });
        } 
        else if (layoutId === 'shape-layout-4') {
            // Layout 4 (Bottom-Left): Restore Default Layout
            restoreToFlat();
            panels.forEach(c => {
                c.userData.targetX = c.userData.homeX;
                c.userData.targetY = c.userData.homeY;
                c.userData.targetZ = c.userData.homeZ;
            });
        } 
        else if (layoutId === 'shape-layout-5') {
            // Layout 5 (Bottom-Right): Dashboard Layout
            restoreToFlat();
            panels.forEach((c, idx) => {
                c.userData.targetZ = -100;
                if (idx === 0) {
                    // Left Sidebar
                    c.userData.targetX = -130;
                    c.userData.targetY = 10;
                } else if (idx === 1) {
                    // Top Right Widget
                    c.userData.targetX = 60;
                    c.userData.targetY = 70;
                } else if (idx === 2) {
                    // Mid Right Widget
                    c.userData.targetX = 60;
                    c.userData.targetY = 10;
                } else if (idx === 3) {
                    // Bottom Right Widget
                    c.userData.targetX = 60;
                    c.userData.targetY = -50;
                } else {
                    // Overflow
                    c.userData.targetX = 140;
                    c.userData.targetY = 10;
                }
            });
        }
    }

    // cubeWrapper click — left for arrow nav, icon clicks handled directly on the SVG
    if (_cubeWrapper) {
        _cubeWrapper.addEventListener('click', function(e) {
            // If a shape-layout element was clicked, let the SVG handler deal with it
            if (e.target.closest && e.target.closest('[id^="shape-layout-"]')) return;
        });
    }

});
