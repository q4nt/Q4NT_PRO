/* ==========================================================================
   Q4NT PRO — Workspace Preview Cube
   Renders the interactive Three.js cube inside #cubeContainer.
   Each face is a canvas-painted replica of a real Q4NT UI panel.
   Previously embedded in SpotifyPillController.init3DCube().
   ========================================================================== */

window.addEventListener('DOMContentLoaded', function initWorkspaceCube() {
    if (!window.THREE) return;

    const container = document.getElementById('cubeContainer');
    if (!container) return;

    // Double-rAF: first tick queues layout, second reads real dimensions.
    requestAnimationFrame(() => requestAnimationFrame(() => {
        const width  = container.clientWidth  || 200;
        const height = container.clientHeight || 150;

        const scene    = new THREE.Scene();
        const camera   = new THREE.PerspectiveCamera(60, width / height, 0.1, 100);
        const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });

        renderer.setSize(width, height);
        renderer.setPixelRatio(window.devicePixelRatio);
        renderer.setClearColor(0x000000, 0);
        renderer.domElement.style.width  = '';
        renderer.domElement.style.height = '';
        container.appendChild(renderer.domElement);

        // ----------------------------------------------------------------
        // Canvas helpers
        // ----------------------------------------------------------------
        const S = 512;

        function roundRect(ctx, x, y, w, h, r, fill, stroke) {
            ctx.beginPath();
            ctx.moveTo(x + r, y);
            ctx.lineTo(x + w - r, y); ctx.quadraticCurveTo(x + w, y, x + w, y + r);
            ctx.lineTo(x + w, y + h - r); ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
            ctx.lineTo(x + r, y + h); ctx.quadraticCurveTo(x, y + h, x, y + h - r);
            ctx.lineTo(x, y + r); ctx.quadraticCurveTo(x, y, x + r, y);
            ctx.closePath();
            if (fill)   { ctx.fillStyle   = fill;   ctx.fill();   }
            if (stroke) { ctx.strokeStyle = stroke; ctx.stroke(); }
        }

        function makeTex(drawFn) {
            const c = document.createElement('canvas');
            c.width = c.height = S;
            drawFn(c.getContext('2d'));
            return new THREE.CanvasTexture(c);
        }

        // ----------------------------------------------------------------
        // Face 0 (+X): Command / Chat panel
        // ----------------------------------------------------------------
        const faceCmdMat = new THREE.MeshBasicMaterial({ map: makeTex((ctx) => {
            ctx.fillStyle = '#f5f5f7'; ctx.fillRect(0, 0, S, S);
            roundRect(ctx, 30, 30, S-60, S-60, 20, 'rgba(255,255,255,0.92)', null);
            const tabs = ['# general','# trading','# signals','# alerts'];
            tabs.forEach((t, i) => {
                const tx = 50 + i * 108, ty = 55, tw = 100, th = 26;
                roundRect(ctx, tx, ty, tw, th, 6, i===0 ? '#007AFF' : 'rgba(0,0,0,0.06)', null);
                ctx.fillStyle = i===0 ? '#fff' : '#555';
                ctx.font = 'bold 14px sans-serif'; ctx.textAlign = 'center';
                ctx.fillText(t, tx + tw/2, ty + 17);
            });
            const msgs = ['Alex_Dev  1:23 PM','QuantGuru  1:25 PM','SarahTrade  1:30 PM','TradingBot  2:01 PM'];
            msgs.forEach((m, i) => {
                const my = 110 + i * 78;
                ctx.beginPath(); ctx.arc(68, my + 18, 16, 0, Math.PI*2);
                ctx.fillStyle = ['#007AFF','#2E7D6F','#C4553A','#C49B3C'][i]; ctx.fill();
                ctx.fillStyle = '#999'; ctx.font = '13px sans-serif'; ctx.textAlign = 'left';
                ctx.fillText(m, 94, my + 14);
                roundRect(ctx, 94, my + 22, 280 - i*20, 16, 4, 'rgba(0,0,0,0.05)', null);
            });
            roundRect(ctx, 44, S-90, S-88, 52, 14, '#1c1c1e', null);
            ctx.fillStyle = 'rgba(255,255,255,0.3)'; ctx.font = '16px sans-serif'; ctx.textAlign = 'left';
            ctx.fillText('Type a message...', 68, S-58);
            roundRect(ctx, S-90, S-82, 36, 36, 8, '#007AFF', null);
            ctx.fillStyle = '#fff'; ctx.font = 'bold 20px sans-serif'; ctx.textAlign = 'center';
            ctx.fillText('>', S-72, S-57);
        }) });

        // ----------------------------------------------------------------
        // Face 1 (-X): Live Tickers — floors-view style
        // ----------------------------------------------------------------
        const faceWatchMat = new THREE.MeshBasicMaterial({ map: makeTex((ctx) => {
            ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, S, S);
            roundRect(ctx, 24, 24, S-48, S-48, 18, '#f8f8fa', null);

            ctx.fillStyle = '#1B2A4A'; ctx.font = 'bold 20px sans-serif'; ctx.textAlign = 'left';
            ctx.fillText('LIVE TICKERS', 50, 82);

            roundRect(ctx, S-118, 62, 72, 26, 13, '#FFECEC', null);
            ctx.fillStyle = '#C4553A'; ctx.font = 'bold 12px sans-serif'; ctx.textAlign = 'center';
            ctx.fillText('LIVE', S - 82, 80);

            ctx.strokeStyle = 'rgba(0,0,0,0.07)'; ctx.lineWidth = 1;
            ctx.beginPath(); ctx.moveTo(50, 96); ctx.lineTo(S-50, 96); ctx.stroke();

            const tickers = [
                { sym:'BTC',  val:'$64,210', chg:'+2.4%', up:true  },
                { sym:'ETH',  val:'$3,450',  chg:'+1.8%', up:true  },
                { sym:'SOL',  val:'$142',    chg:'-0.5%', up:false },
                { sym:'NVDA', val:'$892',    chg:'+3.2%', up:true  },
            ];
            tickers.forEach((t, i) => {
                const ty  = 108 + i * 78;
                const col = t.up ? '#2E7D6F' : '#C4553A';
                roundRect(ctx, 44, ty, S-88, 66, 10, '#ffffff', null);
                ctx.strokeStyle = 'rgba(0,0,0,0.07)'; ctx.lineWidth = 1;
                roundRect(ctx, 44, ty, S-88, 66, 10, null, 'rgba(0,0,0,0.07)');
                ctx.fillStyle = col;
                roundRect(ctx, 44, ty, 5, 66, [10, 0, 0, 10], col, null);
                ctx.fillStyle = '#111827'; ctx.font = 'bold 19px sans-serif'; ctx.textAlign = 'left';
                ctx.fillText(t.sym, 66, ty + 28);
                ctx.fillStyle = col; ctx.font = '14px sans-serif';
                ctx.fillText(t.val + ' (' + t.chg + ')', 66, ty + 50);
            });

            const evY = 108 + 4 * 78 + 10;
            ctx.fillStyle = '#1B2A4A'; ctx.font = 'bold 18px sans-serif'; ctx.textAlign = 'left';
            ctx.fillText('UPCOMING EVENTS', 50, evY);
            ctx.strokeStyle = 'rgba(0,0,0,0.07)'; ctx.lineWidth = 1;
            ctx.beginPath(); ctx.moveTo(50, evY+10); ctx.lineTo(S-50, evY+10); ctx.stroke();

            [{ time:'14:00', label:'FOMC Meeting Minutes' }, { time:'16:30', label:'Earnings: TSLA Release' }]
                .forEach((ev, i) => {
                    const ey = evY + 30 + i * 44;
                    ctx.fillStyle = '#3B82F6'; ctx.fillRect(44, ey, 4, 30);
                    ctx.font = 'bold 14px sans-serif'; ctx.textAlign = 'left';
                    ctx.fillText(ev.time, 58, ey + 20);
                    ctx.fillStyle = '#374151'; ctx.font = '14px sans-serif';
                    ctx.fillText(ev.label, 118, ey + 20);
                });
        }) });

        // ----------------------------------------------------------------
        // Face 2 (+Y): Multi-pane workspace top view
        // ----------------------------------------------------------------
        const faceNavMat = new THREE.MeshBasicMaterial({ map: makeTex((ctx) => {
            ctx.fillStyle = '#1c1c1e'; ctx.fillRect(0, 0, S, S);
            [[0,68,168,440],[172,68,168,440],[344,68,168,440]].forEach(([x,y,w,h], i) => {
                roundRect(ctx, x+4, y+4, w-8, h-8, 10, ['#2a2a2e','#242428','#2e2e32'][i], null);
                roundRect(ctx, x+12, y+18, w-24, 38, 6, 'rgba(255,255,255,0.06)', null);
                ctx.fillStyle = 'rgba(255,255,255,0.22)'; ctx.font = '12px sans-serif'; ctx.textAlign = 'center';
                ctx.fillText(['Panel A','Panel B','Panel C'][i], x + w/2, y + 42);
                ctx.strokeStyle = ['#007AFF','#2E7D6F','#C49B3C'][i]; ctx.lineWidth = 2;
                ctx.beginPath(); ctx.moveTo(x+14, y+h-55);
                for (let p=0; p<8; p++) ctx.lineTo(x+14 + p*(w-28)/7, y+h-55-(Math.sin(p*0.9+i)*28+28));
                ctx.stroke();
            });
            ctx.fillStyle = 'rgba(28,28,30,0.96)'; ctx.fillRect(0, 0, S, 68);
            ctx.fillStyle = 'rgba(255,255,255,0.07)'; ctx.fillRect(0, 66, S, 2);
            ctx.fillStyle = '#007AFF'; ctx.font = 'bold 26px sans-serif'; ctx.textAlign = 'left';
            ctx.fillText('Q4NT', 22, 44);
            [130,190,250,310,370].forEach(px => {
                ctx.beginPath(); ctx.arc(px, 34, 6, 0, Math.PI*2);
                ctx.fillStyle = 'rgba(255,255,255,0.28)'; ctx.fill();
            });
        }) });

        // ----------------------------------------------------------------
        // Face 3 (-Y): Bottom tab strip + candlestick chart
        // ----------------------------------------------------------------
        const faceTabMat = new THREE.MeshBasicMaterial({ map: makeTex((ctx) => {
            ctx.fillStyle = '#1c1c1e'; ctx.fillRect(0, 0, S, S);
            const candles = [
                {o:200,c:240,l:185,h:258},{o:240,c:218,l:210,h:252},
                {o:218,c:262,l:214,h:270},{o:262,c:248,l:240,h:275},
                {o:248,c:288,l:242,h:298},{o:288,c:270,l:260,h:295},
                {o:270,c:312,l:264,h:320},{o:312,c:295,l:288,h:322},
            ];
            candles.forEach((cd, i) => {
                const cx = 44 + i * 56, up = cd.c > cd.o, col = up ? '#2E7D6F' : '#C4553A';
                ctx.strokeStyle = col; ctx.lineWidth = 2;
                ctx.beginPath(); ctx.moveTo(cx, S-cd.h-90); ctx.lineTo(cx, S-cd.l-90); ctx.stroke();
                ctx.fillStyle = col;
                ctx.fillRect(cx-10, S-Math.max(cd.o,cd.c)-90, 20, Math.max(Math.abs(cd.c-cd.o),4));
            });
            roundRect(ctx, 0, S-80, S, 80, 0, 'rgba(240,240,245,0.97)', null);
            ctx.fillStyle = 'rgba(0,0,0,0.08)'; ctx.fillRect(0, S-80, S, 1);
            ['Watchlist','Console','Output','Telemetry','Camera'].forEach((lbl, i) => {
                const tw = S/5, tx = i * tw;
                if (i === 0) roundRect(ctx, tx+4, S-76, tw-8, 72, 6, 'rgba(0,122,255,0.12)', null);
                ctx.fillStyle = i===0 ? '#007AFF' : '#888';
                ctx.font = (i===0?'bold ':'') + '13px sans-serif';
                ctx.textAlign = 'center'; ctx.fillText(lbl, tx + tw/2, S-30);
            });
        }) });

        // ----------------------------------------------------------------
        // Face 4 (+Z): Left edge icon panel
        // ----------------------------------------------------------------
        const faceLeftMat = new THREE.MeshBasicMaterial({ map: makeTex((ctx) => {
            ctx.fillStyle = '#f5f5f7'; ctx.fillRect(0, 0, S, S);
            roundRect(ctx, 140, 0, 232, S, 0, 'rgba(255,255,255,0.92)', null);
            [
                {lbl:'NAV', col:'#007AFF', y:70},
                {lbl:'DASH',col:'#1B2A4A', y:155},
                {lbl:'DIR', col:'#2E7D6F', y:240},
                {lbl:'WEB', col:'#C49B3C', y:325},
            ].forEach(ic => {
                ctx.beginPath(); ctx.arc(256, ic.y, 24, 0, Math.PI*2);
                ctx.fillStyle = ic.col + '28'; ctx.fill();
                ctx.strokeStyle = ic.col; ctx.lineWidth = 2; ctx.stroke();
                ctx.fillStyle = ic.col; ctx.font = 'bold 12px sans-serif'; ctx.textAlign = 'center';
                ctx.fillText(ic.lbl, 256, ic.y + 5);
            });
            ctx.strokeStyle = 'rgba(0,0,0,0.1)'; ctx.lineWidth = 1;
            ctx.beginPath(); ctx.moveTo(196, 400); ctx.lineTo(316, 400); ctx.stroke();
            [{lbl:'>_', col:'#007AFF', y:432},{lbl:'!', col:'#C4553A', y:482}].forEach(ic => {
                ctx.beginPath(); ctx.arc(256, ic.y, 20, 0, Math.PI*2);
                ctx.fillStyle = ic.col + '22'; ctx.fill();
                ctx.strokeStyle = ic.col; ctx.lineWidth = 2; ctx.stroke();
                ctx.fillStyle = ic.col; ctx.font = 'bold 14px monospace'; ctx.textAlign = 'center';
                ctx.fillText(ic.lbl, 256, ic.y + 5);
            });
        }) });

        // ----------------------------------------------------------------
        // Face 5 (-Z): Right edge + layout panel
        // ----------------------------------------------------------------
        const faceRightMat = new THREE.MeshBasicMaterial({ map: makeTex((ctx) => {
            ctx.fillStyle = '#f5f5f7'; ctx.fillRect(0, 0, S, S);
            roundRect(ctx, 140, 0, 232, S, 0, 'rgba(255,255,255,0.92)', null);
            [{lbl:'AI', col:'#007AFF', y:65},{lbl:'DET',col:'#C4553A', y:150},{lbl:'MKT',col:'#2E7D6F', y:235}].forEach(ic => {
                ctx.beginPath(); ctx.arc(256, ic.y, 26, 0, Math.PI*2);
                ctx.fillStyle = ic.col + '22'; ctx.fill();
                ctx.strokeStyle = ic.col; ctx.lineWidth = 2; ctx.stroke();
                ctx.fillStyle = ic.col; ctx.font = 'bold 13px sans-serif'; ctx.textAlign = 'center';
                ctx.fillText(ic.lbl, 256, ic.y + 5);
            });
            ctx.fillStyle = '#1B2A4A'; ctx.font = 'bold 14px sans-serif'; ctx.textAlign = 'center';
            ctx.fillText('Layouts', 256, 296);
            [[0,0],[1,0],[0,1],[1,1]].forEach(([gx,gy]) => {
                roundRect(ctx, 192 + gx*66, 310 + gy*66, 56, 56, 6, 'rgba(0,122,255,0.10)', null);
                roundRect(ctx, 192 + gx*66, 310 + gy*66, 56, 56, 6, null, 'rgba(0,122,255,0.28)');
            });
            [{lbl:'CUBE',col:'#1B2A4A',y:452},{lbl:'THEME',col:'#555',y:490}].forEach(ic => {
                roundRect(ctx, 192, ic.y, 128, 28, 6, ic.col + '18', null);
                ctx.fillStyle = ic.col; ctx.font = 'bold 12px sans-serif'; ctx.textAlign = 'center';
                ctx.fillText(ic.lbl, 256, ic.y + 19);
            });
        }) });

        // ----------------------------------------------------------------
        // Cube mesh
        // ----------------------------------------------------------------
        const geometry     = new THREE.BoxGeometry(2, 2, 2);
        const baseMaterials = [faceCmdMat, faceWatchMat, faceNavMat, faceTabMat, faceLeftMat, faceRightMat];
        const materials     = baseMaterials.slice();
        const solidCube     = new THREE.Mesh(geometry, materials);

        // Face hover overlay — white + blue tint, fully opaque
        const _hoverCanvas    = document.createElement('canvas');
        _hoverCanvas.width    = _hoverCanvas.height = 64;
        const _hCtx           = _hoverCanvas.getContext('2d');
        _hCtx.fillStyle       = '#ffffff'; _hCtx.fillRect(0, 0, 64, 64);
        _hCtx.fillStyle       = 'rgba(59, 130, 246, 0.45)'; _hCtx.fillRect(0, 0, 64, 64);
        const hoverMat        = new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(_hoverCanvas), transparent: false });
        let   hoveredFaceIdx  = -1;
        const raycaster       = new THREE.Raycaster();
        const _mouse          = new THREE.Vector2();

        function _clearHover() {
            if (hoveredFaceIdx === -1) return;
            materials[hoveredFaceIdx] = baseMaterials[hoveredFaceIdx];
            solidCube.material = materials;
            hoveredFaceIdx = -1;
        }
        function _applyHover(faceIdx) {
            if (faceIdx === hoveredFaceIdx) return;
            _clearHover();
            hoveredFaceIdx = faceIdx;
            materials[faceIdx] = hoverMat;
            solidCube.material = materials;
        }

        // Grey cylinder edges
        const edgeMat = new THREE.MeshBasicMaterial({ color: 0x777777 });
        const edgeGeo = new THREE.CylinderGeometry(0.06, 0.06, 2, 10);
        const edgeGroup = new THREE.Group();
        for (const x of [-1, 1]) for (const z of [-1, 1]) {
            const m = new THREE.Mesh(edgeGeo, edgeMat); m.position.set(x, 0, z); edgeGroup.add(m);
        }
        for (const y of [-1, 1]) for (const z of [-1, 1]) {
            const m = new THREE.Mesh(edgeGeo, edgeMat); m.rotation.z = Math.PI/2; m.position.set(0, y, z); edgeGroup.add(m);
        }
        for (const x of [-1, 1]) for (const y of [-1, 1]) {
            const m = new THREE.Mesh(edgeGeo, edgeMat); m.rotation.x = Math.PI/2; m.position.set(x, y, 0); edgeGroup.add(m);
        }

        const cubeGroup = new THREE.Group();
        cubeGroup.add(solidCube);
        cubeGroup.add(edgeGroup);
        scene.add(cubeGroup);
        cubeGroup.rotation.x = 0.5;
        cubeGroup.rotation.y = 0.7;
        camera.position.set(0, 0, 5);
        camera.lookAt(0, 0, 0);

        // ----------------------------------------------------------------
        // Drag-to-rotate via Pointer Capture
        // ----------------------------------------------------------------
        let prevX = 0, prevY = 0, isDragging = false;
        const canvas = renderer.domElement;
        canvas.style.cursor     = 'grab';
        canvas.style.touchAction = 'none';

        canvas.addEventListener('pointerdown', (e) => {
            e.preventDefault(); e.stopPropagation();
            canvas.setPointerCapture(e.pointerId);
            prevX = e.clientX; prevY = e.clientY;
            isDragging = true;
            _clearHover();
            canvas.style.cursor = 'grabbing';
        });

        canvas.addEventListener('pointermove', (e) => {
            if (canvas.hasPointerCapture(e.pointerId)) {
                e.stopPropagation();
                cubeGroup.rotation.y += (e.clientX - prevX) * 0.012;
                cubeGroup.rotation.x += (e.clientY - prevY) * 0.012;
                prevX = e.clientX; prevY = e.clientY;
                return;
            }
            // Hover raycast
            const rect = canvas.getBoundingClientRect();
            _mouse.x =  ((e.clientX - rect.left)  / rect.width)  * 2 - 1;
            _mouse.y = -((e.clientY - rect.top)   / rect.height) * 2 + 1;
            raycaster.setFromCamera(_mouse, camera);
            const hits = raycaster.intersectObject(solidCube, false);
            if (hits.length > 0) _applyHover(hits[0].face.materialIndex);
            else _clearHover();
        });

        canvas.addEventListener('pointerup',     (e) => { canvas.releasePointerCapture(e.pointerId); isDragging = false; canvas.style.cursor = 'grab'; });
        canvas.addEventListener('pointercancel', (e) => { canvas.releasePointerCapture(e.pointerId); isDragging = false; canvas.style.cursor = 'grab'; });
        canvas.addEventListener('pointerleave',  ()  => { _clearHover(); });

        // Block workspace from receiving cube events
        ['mousedown','mousemove','mouseup','wheel','click','pointerdown','pointermove','pointerup','touchstart','touchmove','touchend']
            .forEach(evt => container.addEventListener(evt, e => e.stopPropagation(), { passive: false }));

        // Render loop
        (function animate() { requestAnimationFrame(animate); renderer.render(scene, camera); })();

        // Resize sync
        new ResizeObserver(() => {
            const w = container.clientWidth || 200, h = container.clientHeight || 180;
            renderer.setSize(w, h);
            camera.aspect = w / h;
            camera.updateProjectionMatrix();
        }).observe(container);

    })); // end double-rAF
});
