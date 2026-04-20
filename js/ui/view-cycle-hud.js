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
        document.getElementById('ui-container').appendChild(stack);
    }
    const hudHTML = `
        <div id="cubeWrapper">
            <button class="cube-side-arrow cube-side-arrow--left" id="cubeNavLeft" title="Previous View">
                <svg viewBox="0 0 24 24" fill="currentColor"><path d="M15.41 7.41L14 6l-6 6 6 6 1.41-1.41L10.83 12z"/></svg>
            </button>
            <div id="cubeContainer">
                <div id="cubeModeIcon">
                    <!-- Icon is injected dynamically -->
                </div>
            </div>
                        <defs>
                            <filter id="ps" x="-15%" y="-15%" width="130%" height="135%">
                                <feDropShadow dx="2" dy="4" stdDeviation="5" flood-color="rgba(0,0,0,0.22)"/>
                            </filter>
                        </defs>
                        <rect x="6"  y="8"  width="68" height="48" rx="11" fill="rgba(140,140,140,0.52)" filter="url(#ps)"/>
                        <rect x="84" y="4"  width="68" height="48" rx="11" fill="rgba(118,118,118,0.48)" filter="url(#ps)"/>
                        <rect x="44" y="38" width="74" height="54" rx="11" fill="rgba(238,238,238,0.96)" filter="url(#ps)"/>
                        <rect x="4"  y="80" width="70" height="50" rx="11" fill="rgba(172,172,172,0.74)" filter="url(#ps)"/>
                        <rect x="84" y="84" width="68" height="48" rx="11" fill="rgba(198,198,198,0.68)" filter="url(#ps)"/>
                    </svg>
            <button class="cube-side-arrow cube-side-arrow--right" id="cubeNavRight" title="Next View">
                <svg viewBox="0 0 24 24" fill="currentColor"><path d="M10 6L8.59 7.41 13.17 12l-4.58 4.59L10 18l6-6z"/></svg>
            </button>
        </div>
        <div id="cubeDepthLabel">
            <span class="cube-label-text">3D Depth View</span>
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
        { label: 'Shapes View',   bg: 0,    flat: false, split: false, shapesOnly: true  },
        { label: 'Node Network',  bg: 20,   flat: false, split: false, shapesOnly: false },
        { label: '2D Grid',       bg: 21,   flat: false, split: false, shapesOnly: false },
        { label: 'Floors View',   bg: 1,    flat: false, split: false, shapesOnly: false },
    ];

    let _depthModeIndex = 0;

    // ---- Mode Icons (SVGs) ----
    const MODE_ICONS = [
        // 0: 3D Depth View (Scattered Panels)
        `<svg viewBox="0 0 160 140" fill="none" xmlns="http://www.w3.org/2000/svg"><defs><filter id="ps" x="-15%" y="-15%" width="130%" height="135%"><feDropShadow dx="2" dy="4" stdDeviation="5" flood-color="rgba(0,0,0,0.22)"/></filter></defs><rect x="6"  y="8"  width="68" height="48" rx="11" fill="rgba(140,140,140,0.52)" filter="url(#ps)"/><rect x="84" y="4"  width="68" height="48" rx="11" fill="rgba(118,118,118,0.48)" filter="url(#ps)"/><rect x="44" y="38" width="74" height="54" rx="11" fill="rgba(238,238,238,0.96)" filter="url(#ps)"/><rect x="4"  y="80" width="70" height="50" rx="11" fill="rgba(172,172,172,0.74)" filter="url(#ps)"/><rect x="84" y="84" width="68" height="48" rx="11" fill="rgba(198,198,198,0.68)" filter="url(#ps)"/></svg>`,
        
        // 1: Shapes View (Cube canvas visible, icon hidden by CSS, use default as placeholder)
        `<svg viewBox="0 0 160 140" fill="none" xmlns="http://www.w3.org/2000/svg"><defs><filter id="ps" x="-15%" y="-15%" width="130%" height="135%"><feDropShadow dx="2" dy="4" stdDeviation="5" flood-color="rgba(0,0,0,0.22)"/></filter></defs><rect x="44" y="38" width="74" height="54" rx="11" fill="rgba(238,238,238,0.96)" filter="url(#ps)"/></svg>`,
        
        // 2: Node Network
        `<svg viewBox="0 0 160 140" fill="none" xmlns="http://www.w3.org/2000/svg"><defs><filter id="ps" x="-15%" y="-15%" width="130%" height="135%"><feDropShadow dx="2" dy="4" stdDeviation="5" flood-color="rgba(0,0,0,0.22)"/></filter></defs><path d="M40 40 L80 70 L120 40" stroke="rgba(172,172,172,0.6)" stroke-width="3"/><path d="M40 100 L80 70 L120 100" stroke="rgba(172,172,172,0.6)" stroke-width="3"/><path d="M40 40 L40 100" stroke="rgba(172,172,172,0.6)" stroke-width="3"/><circle cx="40" cy="40" r="14" fill="rgba(238,238,238,0.96)" filter="url(#ps)"/><circle cx="120" cy="40" r="14" fill="rgba(238,238,238,0.96)" filter="url(#ps)"/><circle cx="80" cy="70" r="14" fill="rgba(238,238,238,0.96)" filter="url(#ps)"/><circle cx="40" cy="100" r="14" fill="rgba(238,238,238,0.96)" filter="url(#ps)"/><circle cx="120" cy="100" r="14" fill="rgba(238,238,238,0.96)" filter="url(#ps)"/></svg>`,
        
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
        if (!window.Q4Scene || !Q4Scene.bgGroup || !Q4Scene.activeViews.length) return null;
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
            if (!window.Q4Scene || !Q4Scene.bgGroup) return;
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
            } else if (window.Q4Scene && Q4Scene.bgGroup) {
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

});
