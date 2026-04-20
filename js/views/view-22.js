/* View 22 - 2D Grid: 4K dot matrix + draggable/resizable DOM panel overlay */
backgrounds[21] = function () {
    var bgGroup = Q4Scene.bgGroup;

    // ---------------------------------------------------------------
    // DOT GRID  (THREE.Points — single draw call)
    // 25 world-unit spacing  ≈ 25px on screen at default camera Z
    // 4K-scale coverage: 3840 x 2160 "pixels" mapped to world space
    // ---------------------------------------------------------------
    var GRID_Z   = -60;
    var SPACING  = 5;          // ~25 screen-px at camera distance 140
    var GRID_W   = 760;        // ≈ 3840 px equivalent
    var GRID_H   = 430;        // ≈ 2160 px equivalent

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
        { title: 'Watchlist',    w: 220, h: 150, x: 1120,y: 85  },
        { title: 'Flow Desk',    w: 220, h: 150, x: 80,  y: 280 },
        { title: 'Risk View',    w: 220, h: 150, x: 340, y: 260 },
        { title: 'Positions',    w: 220, h: 150, x: 600, y: 280 },
        { title: 'Alpha',        w: 220, h: 150, x: 860, y: 265 },
        { title: 'Sentiment',    w: 220, h: 150, x: 1120,y: 275 },
        { title: 'Orders',       w: 220, h: 150, x: 80,  y: 470 },
        { title: 'Depth',        w: 220, h: 150, x: 340, y: 460 },
        { title: 'P&L',          w: 220, h: 150, x: 600, y: 475 },
        { title: 'Options',      w: 220, h: 150, x: 860, y: 462 },
        { title: 'Macro',        w: 220, h: 150, x: 1120,y: 470 },
        { title: 'Scanner',      w: 220, h: 150, x: 80,  y: 660 },
        { title: 'Calendar',     w: 220, h: 150, x: 340, y: 650 },
        { title: 'News',         w: 220, h: 150, x: 600, y: 665 },
        { title: 'Telemetry',    w: 220, h: 150, x: 860, y: 655 },
        { title: 'ABCD',         w: 220, h: 150, x: 1120,y: 660 },
    ];

    var _container = document.getElementById('ui-container');
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
            'position:fixed',
            'left:'   + def.x + 'px',
            'top:'    + def.y + 'px',
            'width:'  + def.w + 'px',
            'height:' + def.h + 'px',
            'z-index:' + _zTop,
        ].join(';');

        // Header
        var hdr = document.createElement('div');
        hdr.className = 'gv-panel-header';

        var title = document.createElement('span');
        title.className = 'gv-panel-title';
        title.textContent = def.title;

        var close = document.createElement('button');
        close.className = 'gv-close';
        close.innerHTML = '&times;';
        close.addEventListener('click', function() {
            if (el.parentNode) el.parentNode.removeChild(el);
        });

        hdr.appendChild(title);
        hdr.appendChild(close);
        el.appendChild(hdr);

        // Body
        var body = document.createElement('div');
        body.className = 'gv-panel-body';
        el.appendChild(body);

        _makeDraggable(el, hdr);
        _makeResizable(el);

        _container.appendChild(el);
        _panels.push(el);
    });

    // No Three.js panel meshes — dots only in bgGroup
    Q4Scene.currentBgAnimate = null;

    // ---------------------------------------------------------------
    // CLEANUP: remove DOM panels when switching away
    // ---------------------------------------------------------------
    bgGroup.userData.cleanup = function() {
        _panels.forEach(function(el) {
            if (el.parentNode) el.parentNode.removeChild(el);
        });
        _panels = [];
    };
};
