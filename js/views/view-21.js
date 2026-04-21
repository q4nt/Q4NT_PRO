/* View 21 - Node Network: command-panel-styled cards connected by proximity edges */
ViewFactory.register(20, function () {
    var bgGroup = Q4Scene.bgGroup;

    var NODE_COUNT   = 30;
    var CARD_W       = 36;
    var CARD_H       = 13;   // thinner
    var CONNECT_DIST = 140;

    // Accent palette
    var ACCENTS = [0x00f2fe, 0xa29bfe, 0x55efc4, 0xfd79a8, 0xfdcb6e, 0x74b9ff];

    var MSGS = [
        { text: 'SPY to $550 by EOY?', pct: 68 },
        { text: 'BTC breaks $100k in Q3?', pct: 42 },
        { text: 'Fed cuts rates in Sept?', pct: 85 },
        { text: 'NVDA earnings > est?', pct: 91 },
        { text: 'ETH spot ETF apv?', pct: 15 },
        { text: 'TSLA deliveries beat?', pct: 54 },
        { text: 'US avoids recession?', pct: 72 },
        { text: 'AAPL launches AI?', pct: 33 },
        { text: 'Gold hits $3000?', pct: 61 },
        { text: 'OpenAI IPO in 2026?', pct: 28 }
    ];

    // ---- Canvas texture builder: mock bet card ----
    function makeCardTex(accentHex, msgObj) {
        var S = 540, H = 195; 
        var cv = document.createElement('canvas');
        cv.width = S; cv.height = H;
        var ctx = cv.getContext('2d');

        // Solid dark background with perfectly matched rounded corners
        var b = 2; // Inset to prevent clipping
        var R = 36; // Exact match for geometry corner radius
        ctx.beginPath();
        ctx.moveTo(R, b); 
        ctx.lineTo(S - R, b); 
        ctx.quadraticCurveTo(S - b, b, S - b, R);
        ctx.lineTo(S - b, H - R); 
        ctx.quadraticCurveTo(S - b, H - b, S - R, H - b);
        ctx.lineTo(R, H - b); 
        ctx.quadraticCurveTo(b, H - b, b, H - R);
        ctx.lineTo(b, R); 
        ctx.quadraticCurveTo(b, b, R, b);
        ctx.closePath();
        ctx.fillStyle = '#15151a';
        ctx.fill();

        // Accent border
        ctx.strokeStyle = accentHex;
        ctx.lineWidth = 2;
        ctx.stroke();

        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 38px Inter, sans-serif';
        ctx.fillText(msgObj.text, 35, 70);

        // Progress bar
        ctx.fillStyle = '#333344';
        ctx.fillRect(35, 100, S - 70, 28);
        
        ctx.fillStyle = accentHex;
        ctx.fillRect(35, 100, (S - 70) * (msgObj.pct / 100), 28);

        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 30px Inter, sans-serif';
        ctx.fillText(msgObj.pct + '% Yes', 35, 170);

        var tex = new THREE.CanvasTexture(cv);
        tex.minFilter = THREE.LinearFilter;
        tex.repeat.set(1 / CARD_W, 1 / CARD_H);
        tex.offset.set(0.5, 0.5);
        return tex;
    }

    // --- Node positions ---
    var nodeData = [];
    for (var i = 0; i < NODE_COUNT; i++) {
        nodeData.push({
            idx:   i,
            x:     (Math.random() - 0.5) * 340,
            y:     (Math.random() - 0.5) * 220,
            z:     -(Math.random() * 380 + 20),
            color: ACCENTS[i % ACCENTS.length],
            accentHex: ['#00f2fe','#a29bfe','#55efc4','#fd79a8','#fdcb6e','#74b9ff'][i % 6],
            msgObj: MSGS[i % MSGS.length],
            seed:  Math.random() * Math.PI * 2,
            speed: 0.06 + Math.random() * 0.10,
            amp:   0.4  + Math.random() * 0.7,
            baseOpacity: 0.93
        });
    }

    // --- Connection lines ---
    var edgeMeshes = [];
    for (var i = 0; i < NODE_COUNT; i++) {
        for (var j = i + 1; j < NODE_COUNT; j++) {
            var a = nodeData[i], b = nodeData[j];
            var dx = a.x - b.x, dy = a.y - b.y, dz = a.z - b.z;
            var dist = Math.sqrt(dx*dx + dy*dy + dz*dz);
            if (dist < CONNECT_DIST) {
                var strength = 1 - (dist / CONNECT_DIST);
                var pts = [
                    new THREE.Vector3(a.x, a.y, a.z),
                    new THREE.Vector3(b.x, b.y, b.z)
                ];
                var geo = new THREE.BufferGeometry().setFromPoints(pts);
                var mat = new THREE.LineBasicMaterial({
                    color:       0x555566,
                    transparent: true,
                    opacity:     strength * 0.50
                });
                var line = new THREE.Line(geo, mat);
                line.userData._isEdge = true;
                bgGroup.add(line);
                edgeMeshes.push({ line: line, iIdx: i, jIdx: j, mat: mat, baseOpa: strength * 0.50 });
            }
        }
    }

    // --- Card geometry (shared rounded rect) ---
    var cardShape   = createRoundedRectShape(CARD_W, CARD_H, 2.4);
    var cardGeo     = new THREE.ShapeGeometry(cardShape, 8);

    // --- Node cards with command-panel canvas texture ---
    var cardMeshes = [];
    nodeData.forEach(function(nd) {
        var tex     = makeCardTex(nd.accentHex, nd.msgObj);
        var faceMat = new THREE.MeshBasicMaterial({
            map:         tex,
            transparent: true,
            side:        THREE.DoubleSide
        });
        var card = new THREE.Mesh(cardGeo, faceMat);
        card.position.set(nd.x, nd.y, nd.z);

        card.userData = {
            _isPanel: true, _isNodeCard: true, nd: nd,
            homeX: nd.x, homeY: nd.y, homeZ: nd.z,
            targetX: nd.x, targetY: nd.y, targetZ: nd.z,
            seed: nd.seed, speed: nd.speed, amp: nd.amp,
            baseOpacity: nd.baseOpacity, targetScale: 1.0
        };

        bgGroup.add(card);
        cardMeshes.push({ mesh: card, nd: nd });
    });

    // --- Background particles ---
    var PC = 600, pPos = new Float32Array(PC * 3);
    for (var k = 0; k < PC; k++) {
        pPos[k*3]   = (Math.random() - 0.5) * 1000;
        pPos[k*3+1] = (Math.random() - 0.5) * 700;
        pPos[k*3+2] = -(Math.random() * 900 + 20);
    }
    var pGeo = new THREE.BufferGeometry();
    pGeo.setAttribute('position', new THREE.BufferAttribute(pPos, 3));
    bgGroup.add(new THREE.Points(pGeo, new THREE.PointsMaterial({
        color: 0x4444aa, size: 0.7, transparent: true, opacity: 0.25, sizeAttenuation: true
    })));

    // --- Raycasting & Interaction ---
    var MAX_CLICK_DISTANCE = 400; 
    var _panelMouse = new THREE.Vector2();
    var _panelRaycaster = new THREE.Raycaster();
    var _focusedNodes = [];
    var _hoveredPanel = null;

    var resetFocus = function() {
        cardMeshes.forEach(function(c) {
            c.mesh.userData.targetZ = c.mesh.userData.homeZ;
            c.mesh.userData.targetX = c.mesh.userData.homeX;
            c.mesh.userData.targetY = c.mesh.userData.homeY;
        });
        _focusedNodes = [];
    };

    var onPanelClick = function(e) {
        if (e.target.closest && (e.target.closest('.beveled-panel') || e.target.closest('.top-nav-buttons') || e.target.closest('.prompt-container'))) return;
        if (Q4Scene.activeViews.length === 0) return;
        var cam = Q4Scene.activeViews[0].camera;
        var container = document.getElementById('canvas-container');
        if (!container) return;
        var rect = container.getBoundingClientRect();
        _panelMouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
        _panelMouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
        _panelRaycaster.setFromCamera(_panelMouse, cam);
        
        var intersects = _panelRaycaster.intersectObjects(bgGroup.children, false);
        var hitObj = intersects.find(function(x) { return x.object.userData._isNodeCard; });
        
        if (hitObj && hitObj.distance <= MAX_CLICK_DISTANCE) {
            var hitMesh = hitObj.object;
            if (_focusedNodes.includes(hitMesh) && _focusedNodes[0] === hitMesh) {
                resetFocus();
            } else {
                resetFocus();
                hitMesh.userData.targetZ = cam.position.z - 40;
                hitMesh.userData.targetX = cam.position.x;
                hitMesh.userData.targetY = cam.position.y;
                _focusedNodes.push(hitMesh);
                
                var hitNd = hitMesh.userData.nd;
                edgeMeshes.forEach(function(edge) {
                    var otherIdx = -1;
                    if (edge.iIdx === hitNd.idx) otherIdx = edge.jIdx;
                    else if (edge.jIdx === hitNd.idx) otherIdx = edge.iIdx;
                    
                    if (otherIdx !== -1) {
                        var other = cardMeshes[otherIdx].mesh;
                        other.userData.targetZ = cam.position.z - 60;
                        var angle = Math.random() * Math.PI * 2;
                        var r = 30 + Math.random() * 20;
                        other.userData.targetX = cam.position.x + Math.cos(angle) * r;
                        other.userData.targetY = cam.position.y + Math.sin(angle) * r;
                        _focusedNodes.push(other);
                    }
                });
            }
        } else {
            resetFocus();
        }
    };

    var onPanelMouseMove = function(e) {
        if (Q4Scene.activeViews.length === 0) return;
        var cam = Q4Scene.activeViews[0].camera;
        var container = document.getElementById('canvas-container');
        if (!container) return;
        var rect = container.getBoundingClientRect();
        _panelMouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
        _panelMouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
        _panelRaycaster.setFromCamera(_panelMouse, cam);

        var intersects = _panelRaycaster.intersectObjects(bgGroup.children, false);
        var hitObj = intersects.find(function(x) { return x.object.userData._isNodeCard; });
        
        if (hitObj && hitObj.distance <= MAX_CLICK_DISTANCE) {
            var hitMesh = hitObj.object;
            if (_hoveredPanel !== hitMesh) {
                if (_hoveredPanel && !_focusedNodes.includes(_hoveredPanel)) {
                    _hoveredPanel.userData.targetScale = 1.0;
                }
                _hoveredPanel = hitMesh;
                if (!_focusedNodes.includes(_hoveredPanel)) {
                    _hoveredPanel.userData.targetScale = 1.15;
                }
            }
            container.style.cursor = 'pointer';
        } else {
            if (_hoveredPanel) {
                if (!_focusedNodes.includes(_hoveredPanel)) {
                    _hoveredPanel.userData.targetScale = 1.0;
                }
                _hoveredPanel = null;
            }
            container.style.cursor = 'default';
        }
    };

    window.addEventListener('click', onPanelClick);
    window.addEventListener('mousemove', onPanelMouseMove);

    bgGroup.userData.cleanup = function() {
        window.removeEventListener('click', onPanelClick);
        window.removeEventListener('mousemove', onPanelMouseMove);
        _focusedNodes = [];
        _hoveredPanel = null;
        var container = document.getElementById('canvas-container');
        if (container) container.style.cursor = 'default';
    };

    // --- Animation ---
    Q4Scene.currentBgAnimate = function(t) {
        var camZ      = Q4Scene.activeViews.length ? Q4Scene.activeViews[0].camera.position.z : 80;
        var fadeStart = 120, fadeEnd = 280;

        cardMeshes.forEach(function(entry) {
            var mesh = entry.mesh, nd = entry.nd;
            
            // Movement interpolation
            var ls = 0.08;
            mesh.position.z += (mesh.userData.targetZ - mesh.position.z) * ls;
            mesh.position.x += (mesh.userData.targetX - mesh.position.x) * ls;
            var bobY = mesh.userData.targetY + Math.sin(t * nd.speed + nd.seed) * nd.amp;
            mesh.position.y += (bobY - mesh.position.y) * ls;

            // Scale interpolation
            var targetS = mesh.userData.targetScale || 1.0;
            if (_focusedNodes.includes(mesh) && _focusedNodes[0] === mesh) targetS = 1.25;
            else if (_focusedNodes.includes(mesh)) targetS = 1.1;
            mesh.scale.x += (targetS - mesh.scale.x) * 0.2;
            mesh.scale.y += (targetS - mesh.scale.y) * 0.2;
            mesh.scale.z += (targetS - mesh.scale.z) * 0.2;

            var depth = camZ - mesh.position.z;
            var dOp   = depth > fadeStart ? Math.max(0, 1 - (depth - fadeStart) / (fadeEnd - fadeStart)) : 1;
            
            if (_focusedNodes.length > 0) {
                if (_focusedNodes.includes(mesh)) {
                    mesh.material.opacity = 1.0;
                    mesh.visible = true;
                } else {
                    mesh.material.opacity = nd.baseOpacity * dOp * 0.3; // dim unfocused
                    mesh.visible = dOp > 0.01;
                }
            } else {
                mesh.material.opacity = nd.baseOpacity * dOp;
                mesh.visible = dOp > 0.01;
            }
        });

        // Pulse connection lines
        edgeMeshes.forEach(function(e) {
            var iMesh = cardMeshes[e.iIdx].mesh;
            var jMesh = cardMeshes[e.jIdx].mesh;
            
            // Update line positions based on node positions
            var positions = e.line.geometry.attributes.position.array;
            positions[0] = iMesh.position.x;
            positions[1] = iMesh.position.y;
            positions[2] = iMesh.position.z;
            positions[3] = jMesh.position.x;
            positions[4] = jMesh.position.y;
            positions[5] = jMesh.position.z;
            e.line.geometry.attributes.position.needsUpdate = true;
            
            var pulse = 0.7 + 0.3 * Math.sin(t * 0.4 + e.iIdx * 0.3);
            
            if (_focusedNodes.length > 0) {
                if (_focusedNodes.includes(iMesh) && _focusedNodes.includes(jMesh)) {
                    e.mat.opacity = 1.0;
                    e.mat.color.setHex(0xffffff);
                } else {
                    e.mat.opacity = e.baseOpa * pulse * 0.1;
                    e.mat.color.setHex(0x555566);
                }
            } else {
                e.mat.opacity = e.baseOpa * pulse;
                e.mat.color.setHex(0x555566);
            }
        });
    };
});
