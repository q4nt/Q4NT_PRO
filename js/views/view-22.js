/* View 22 - 2D Grid: 4K dot matrix + draggable/resizable DOM panel overlay */
ViewFactory.register(21, function () {
    var bgGroup = Q4Scene.bgGroup;

    // ---------------------------------------------------------------
    // DOT GRID  (THREE.Points — single draw call)
    // 25 world-unit spacing  ≈ 25px on screen at default camera Z
    // 4K-scale coverage: 3840 x 2160 "pixels" mapped to world space
    // ---------------------------------------------------------------
    var GRID_Z   = -60;
    var SPACING  = 5;          // ~25 screen-px at camera distance 140
    var GRID_W   = 1520;       // ≈ 7680 px equivalent (2x)
    var GRID_H   = 1290;       // ≈ 6480 px equivalent (3x)

    var cols  = Math.round(GRID_W / SPACING) + 1;
    var rows  = Math.round(GRID_H / SPACING) + 1;
    var total = cols * rows;

    // Tiny circular sprite texture
    var _spr = (function() {
        var c = document.createElement('canvas');
        c.width = c.height = 16;
        var cx = c.getContext('2d');
        var g = cx.createRadialGradient(8, 8, 0, 8, 8, 6);
        g.addColorStop(0,   'rgba(160,160,180,0.95)');
        g.addColorStop(0.6, 'rgba(160,160,180,0.60)');
        g.addColorStop(1,   'rgba(160,160,180,0.00)');
        cx.fillStyle = g;
        cx.fillRect(0, 0, 16, 16);
        return new THREE.CanvasTexture(c);
    })();

    var dotPos  = new Float32Array(total * 3);
    var halfW   = (cols - 1) * SPACING / 2;
    var halfH   = (rows - 1) * SPACING / 2;
    var idx     = 0;
    for (var r = 0; r < rows; r++) {
        for (var c = 0; c < cols; c++) {
            dotPos[idx++] = -halfW + c * SPACING;
            dotPos[idx++] = -halfH + r * SPACING;
            dotPos[idx++] = GRID_Z;
        }
    }

    var dotGeo = new THREE.BufferGeometry();
    dotGeo.setAttribute('position', new THREE.BufferAttribute(dotPos, 3));

    var dotMat = new THREE.PointsMaterial({
        map:             _spr,
        size:            0.9,          // smaller — ~4-5px on screen
        sizeAttenuation: true,
        transparent:     true,
        opacity:         0.65,
        depthWrite:      false,
        alphaTest:       0.01
    });

    var dotCloud = new THREE.Points(dotGeo, dotMat);
    dotCloud.userData._isDotGrid = true;
    bgGroup.add(dotCloud);

    // ---------------------------------------------------------------
    // DOM OVERLAY PANELS — draggable & resizable, float-panel style
    // Injected into #ui-container; removed on view exit via cleanup()
    // ---------------------------------------------------------------
    var PANEL_DEFS = [
        { title: 'Market Data',  w: 220, h: 150, x: 80,  y: 80  },
        { title: 'Analytics',    w: 220, h: 150, x: 340, y: 60  },
        { title: 'Signals',      w: 220, h: 150, x: 600, y: 90  },
        { title: 'Portfolio',    w: 220, h: 150, x: 860, y: 70  },
        { title: 'Watchlist',    w: 220, h: 150, x: 1120,y: 85  }
    ];

    var _container = document.getElementById('ui-container');
    
    var _wrapper = document.createElement('div');
    _wrapper.id = 'gv-panel-wrapper';
    _wrapper.style.position = 'fixed';
    _wrapper.style.left = '0';
    _wrapper.style.top = '0';
    _wrapper.style.width = '100vw';
    _wrapper.style.height = '100vh';
    _wrapper.style.pointerEvents = 'none'; // let clicks pass through to 3d canvas
    _wrapper.style.transformOrigin = 'center center';
    _wrapper.style.zIndex = '50';
    _container.appendChild(_wrapper);

    var _panels    = [];

    function _makeDraggable(el, handle) {
        var dragging = false, ox = 0, oy = 0;
        handle.addEventListener('mousedown', function(e) {
            if (e.target.classList.contains('gv-close')) return;
            dragging = true;
            ox = e.clientX - el.getBoundingClientRect().left;
            oy = e.clientY - el.getBoundingClientRect().top;
            el.style.zIndex = ++_zTop;
            e.preventDefault();
        });
        window.addEventListener('mousemove', function(e) {
            if (!dragging) return;
            el.style.left = Math.max(0, e.clientX - ox) + 'px';
            el.style.top  = Math.max(0, e.clientY - oy) + 'px';
        });
        window.addEventListener('mouseup', function() { dragging = false; });
    }

    function _makeResizable(el) {
        var dirs = { r: 'ew', b: 'ns', br: 'nwse' };
        Object.keys(dirs).forEach(function(dir) {
            var h = document.createElement('div');
            h.className = 'gv-resize gv-res-' + dir;
            h.style.cursor = dirs[dir] + '-resize';
            el.appendChild(h);

            var resizing = false, sx, sy, sw, sh, sl, st;
            h.addEventListener('mousedown', function(e) {
                resizing = true;
                sx = e.clientX; sy = e.clientY;
                var r = el.getBoundingClientRect();
                sw = r.width; sh = r.height; sl = r.left; st = r.top;
                e.preventDefault(); e.stopPropagation();
            });
            window.addEventListener('mousemove', function(e) {
                if (!resizing) return;
                if (dir === 'r' || dir === 'br') {
                    el.style.width  = Math.max(160, sw + (e.clientX - sx)) + 'px';
                }
                if (dir === 'b' || dir === 'br') {
                    el.style.height = Math.max(100, sh + (e.clientY - sy)) + 'px';
                }
            });
            window.addEventListener('mouseup', function() { resizing = false; });
        });
    }

    var _zTop = 60;

    PANEL_DEFS.forEach(function(def) {
        var el = document.createElement('div');
        el.className = 'gv-panel';
        el.style.cssText = [
            'position:absolute',
            'left:'   + def.x + 'px',
            'top:'    + def.y + 'px',
            'width:'  + def.w + 'px',
            'height:' + def.h + 'px',
            'pointer-events:auto'
        ].join(';');

        // Header
        var hdr = document.createElement('div');
        hdr.className = 'q4-widget-header gv-panel-header'; // Keep gv-panel-header for dragging

        const closeSvg = '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>';
        const minimizeSvg = '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>';
        const editSvg = '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>';
        const starSvg = '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon></svg>';

        hdr.innerHTML = `
            <span class="q4-widget-title">${def.title}</span>
            <div class="q4-widget-actions">
                <button class="q4-widget-action-btn q4-widget-star" title="Star">${starSvg}</button>
                <button class="q4-widget-action-btn q4-widget-edit" title="Edit">${editSvg}</button>
                <button class="q4-widget-action-btn q4-widget-minimize" title="Minimize">${minimizeSvg}</button>
                <button class="q4-widget-close gv-close" title="Close">${closeSvg}</button>
            </div>
        `;

        var close = hdr.querySelector('.gv-close');
        close.addEventListener('click', function() {
            if (el.parentNode) el.parentNode.removeChild(el);
        });

        // The title and close buttons are already in innerHTML.
        el.appendChild(hdr);

        // Body
        var body = document.createElement('div');
        body.className = 'gv-panel-body';
        el.appendChild(body);

        _makeDraggable(el, hdr);
        _makeResizable(el);

        _wrapper.appendChild(el);
        _panels.push(el);
    });

    Q4Scene.currentBgAnimate = function(t) {
        if (!Q4Scene.activeViews || Q4Scene.activeViews.length === 0) return;
        var cam = Q4Scene.activeViews[0].camera;
        
        // Grid plane is at Z = -60. 
        // Default camera position is Z = 80. Base distance = 140.
        var curDist = cam.position.z - GRID_Z;
        var scale = 140 / curDist;

        var centerVec = new THREE.Vector3(0, 0, GRID_Z);
        centerVec.project(cam);

        var hw = window.innerWidth / 2;
        var hh = window.innerHeight / 2;
        
        var cx = (centerVec.x * 0.5 + 0.5) * window.innerWidth;
        var cy = (-centerVec.y * 0.5 + 0.5) * window.innerHeight;

        var tx = cx - hw;
        var ty = cy - hh;

        _wrapper.style.transform = 'translate(' + tx + 'px, ' + ty + 'px) scale(' + scale + ')';
    };

    // ---------------------------------------------------------------
    // CLEANUP: remove DOM panels when switching away
    // ---------------------------------------------------------------
    bgGroup.userData.cleanup = function() {
        if (_wrapper && _wrapper.parentNode) {
            _wrapper.parentNode.removeChild(_wrapper);
        }
    };
});
