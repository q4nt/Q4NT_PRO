/* View 21 - Node Network: command-panel-styled cards connected by proximity edges */
ViewFactory.register(20, function () {
    var bgGroup = Q4Scene.bgGroup;

    var NODE_COUNT   = 30;
    var CARD_W       = 36;
    var CARD_H       = 13;   // thinner
    var CONNECT_DIST = 140;

    // Accent palette — matches channel accent colors
    var ACCENTS = [0x00f2fe, 0xa29bfe, 0x55efc4, 0xfd79a8, 0xfdcb6e, 0x74b9ff];

    // Channel/group sets for card variety
    var CHANNELS = [
        ['# general', '# trading', '# signals'],
        ['# alerts',  '# macro',   '# options'],
        ['# general', '# signals', '# flow'],
        ['# trading', '# alerts',  '# quant'],
    ];
    var GROUPS = ['Community', 'Quant Research', 'Alpha Hunters', 'Risk Desk'];
    var USERS  = ['Alex_Dev', 'QuantGuru', 'SarahTrade', 'TradingBot', 'MarcoFX',
                  'SignalBot', 'AlertBot', 'RiskDesk', 'AlphaHunter', 'DataPilot'];
    var MSGS = [
        'NVDA broke ATH. Options flow heavy.',
        'DXY rolling over — long EUR/USD.',
        'Websocket reconnect on volatility API.',
        'FOMC minutes release in 15 minutes.',
        'BTC entry: $63,800 | TP: $67,000',
        'Check the new momentum signals.',
        'Patch pushed to main branch.',
        'Sizing into calls at $910 strike.',
        'Risk-off detected across EM assets.',
        'RSI divergence on QQQ, watch this.',
    ];

    // ---- Canvas texture builder: command panel style ----
    function makeCardTex(accentHex, groupIdx, msgOffset) {
        var S = 512, H = 208;  // shorter canvas = thinner card
        var cv = document.createElement('canvas');
        cv.width = S; cv.height = H;
        var ctx = cv.getContext('2d');

        // Drop shadow (drawn before background)
        ctx.shadowColor   = 'rgba(0,0,0,0.14)';
        ctx.shadowBlur    = 22;
        ctx.shadowOffsetY = 6;

        // Solid white background with rounded corners
        var R = 20;
        ctx.beginPath();
        ctx.moveTo(R, 4); ctx.lineTo(S - R, 4);
        ctx.quadraticCurveTo(S - 2, 4, S - 2, R + 4);
        ctx.lineTo(S - 2, H - R); ctx.quadraticCurveTo(S - 2, H - 2, S - R, H - 2);
        ctx.lineTo(R, H - 2); ctx.quadraticCurveTo(2, H - 2, 2, H - R);
        ctx.lineTo(2, R + 4); ctx.quadraticCurveTo(2, 4, R, 4);
        ctx.closePath();
        ctx.fillStyle = '#ffffff';
        ctx.fill();

        // Reset shadow
        ctx.shadowColor = 'transparent'; ctx.shadowBlur = 0; ctx.shadowOffsetY = 0;

        // Subtle border
        ctx.strokeStyle = 'rgba(0,0,0,0.08)';
        ctx.lineWidth   = 1.5;
        ctx.stroke();

        return new THREE.CanvasTexture(cv);
    }

    // --- Node positions ---
    var nodeData = [];
    for (var i = 0; i < NODE_COUNT; i++) {
        nodeData.push({
            x:     (Math.random() - 0.5) * 340,
            y:     (Math.random() - 0.5) * 220,
            z:     -(Math.random() * 380 + 20),
            color: ACCENTS[i % ACCENTS.length],
            accentHex: ['#00f2fe','#a29bfe','#55efc4','#fd79a8','#fdcb6e','#74b9ff'][i % 6],
            groupIdx:  i % 4,
            msgOffset: (i * 3) % MSGS.length,
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
                    color:       0x999999,   // grey lines to match light card style
                    transparent: true,
                    opacity:     strength * 0.30
                });
                var line = new THREE.Line(geo, mat);
                line.userData._isEdge = true;
                bgGroup.add(line);
                edgeMeshes.push({ line: line, iIdx: i, jIdx: j, mat: mat, baseOpa: strength * 0.40 });
            }
        }
    }

    // --- Card geometry (shared rounded rect) ---
    var cardShape   = createRoundedRectShape(CARD_W, CARD_H, 2.4);
    var cardGeo     = new THREE.ShapeGeometry(cardShape, 8);
    var cardEdgeGeo = new THREE.EdgesGeometry(cardGeo, 15);

    // --- Node cards with command-panel canvas texture ---
    var cardMeshes = [];
    nodeData.forEach(function(nd) {
        var tex     = makeCardTex(nd.accentHex, nd.groupIdx, nd.msgOffset);
        var faceMat = new THREE.MeshBasicMaterial({
            map:         tex,
            transparent: false,   // fully opaque — solid white
            side:        THREE.DoubleSide
        });
        var card = new THREE.Mesh(cardGeo, faceMat);
        card.position.set(nd.x, nd.y, nd.z);

        // No accent border — shadow is baked into the canvas texture
        card.userData = {
            _isPanel: true, _isNodeCard: true,
            homeX: nd.x, homeY: nd.y, homeZ: nd.z,
            targetX: nd.x, targetY: nd.y, targetZ: nd.z,
            seed: nd.seed, speed: nd.speed, amp: nd.amp,
            baseOpacity: nd.baseOpacity
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

    // --- Animation ---
    Q4Scene.currentBgAnimate = function(t) {
        var camZ      = Q4Scene.activeViews.length ? Q4Scene.activeViews[0].camera.position.z : 80;
        var fadeStart = 120, fadeEnd = 280;

        cardMeshes.forEach(function(entry) {
            var mesh = entry.mesh, nd = entry.nd;
            var bobY = nd.y + Math.sin(t * nd.speed + nd.seed) * nd.amp;
            mesh.position.y += (bobY - mesh.position.y) * 0.04;

            var depth = camZ - mesh.position.z;
            var dOp   = depth > fadeStart ? Math.max(0, 1 - (depth - fadeStart) / (fadeEnd - fadeStart)) : 1;
            mesh.material.opacity = nd.baseOpacity * dOp;
            mesh.visible          = dOp > 0.01;
        });

        // Pulse connection lines
        edgeMeshes.forEach(function(e) {
            var pulse = 0.7 + 0.3 * Math.sin(t * 0.4 + e.iIdx * 0.3);
            e.mat.opacity = e.baseOpa * pulse;
        });
    };
});
