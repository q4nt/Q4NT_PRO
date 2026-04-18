/* ==========================================================================
   Q4NT PRO - Shared View Utilities
   Panel positions, geometry helpers, track data, and F1 track generator.
   ========================================================================== */

// Panel size: 36 x 19 world units (maps to 360px x 210px at 1unit = 10px)
var PANEL_W = 36;
var PANEL_H = 19;

// Exact panel positions from the Q4NT codebase
var PANEL_POSITIONS = [
    { x: -25, y: 15, z: -70 }, { x: 50, y: 40, z: -10 }, { x: -50, y: 0, z: -70 },
    { x: 0, y: -40, z: -130 }, { x: 100, y: 20, z: -60 }, { x: -100, y: -60, z: -200 },
    { x: 100, y: 80, z: -100 }, { x: -100, y: 80, z: -160 }, { x: -90, y: 60, z: -30 },
    { x: 0, y: 0, z: 0 }, { x: 45, y: -65, z: -95 }, { x: -75, y: 40, z: -50 },
    { x: 60, y: -20, z: -170 }, { x: -30, y: 70, z: -220 }, { x: 70, y: 75, z: -60 },
    { x: -60, y: 25, z: -90 }, { x: 85, y: 30, z: -45 }, { x: 110, y: 55, z: -120 },
    { x: -95, y: -25, z: -150 }, { x: 20, y: -50, z: -180 }, { x: 75, y: -35, z: -250 },
    { x: -110, y: -55, z: -300 }, { x: 95, y: -70, z: -350 }, { x: 120, y: -40, z: -80 },
    { x: -120, y: 20, z: -110 }, { x: 0, y: 50, z: -280 }, { x: 80, y: -80, z: -140 },
    { x: -140, y: 60, z: -200 }, { x: 140, y: 0, z: -260 }, { x: -40, y: 60, z: -180 },
    { x: -120, y: -40, z: -320 }, { x: 30, y: 85, z: -40 }, { x: -65, y: -75, z: -160 },
    { x: 130, y: 45, z: -220 }, { x: -150, y: -10, z: -85 }, { x: 55, y: -90, z: -50 },
    { x: -20, y: -30, z: -380 }, { x: 115, y: -60, z: -290 }, { x: -85, y: 50, z: -340 },
    { x: 40, y: 65, z: -120 }, { x: -130, y: -70, z: -240 }, { x: 160, y: 25, z: -150 },
    { x: -45, y: -85, z: -60 }, { x: 70, y: 90, z: -310 }, { x: -160, y: 35, z: -190 },
    { x: 25, y: -70, z: -420 }, { x: 105, y: -15, z: -360 }, { x: -70, y: 95, z: -20 },
    { x: 145, y: -50, z: -210 }, { x: -55, y: -45, z: -460 }, { x: 35, y: 30, z: -35 },
    { x: -35, y: -55, z: -500 }, { x: 155, y: 70, z: -55 }, { x: -170, y: -20, z: -540 },
    { x: 65, y: -95, z: -270 }, { x: -15, y: 45, z: -580 }, { x: 125, y: -75, z: -330 },
    { x: -105, y: 35, z: -620 }, { x: 50, y: 55, z: -400 }, { x: -145, y: -85, z: -660 },
    { x: 170, y: -10, z: -200 }, { x: -80, y: -90, z: -45 }, { x: 90, y: 95, z: -700 },
    { x: -175, y: 50, z: -440 }, { x: 15, y: -80, z: -740 }, { x: 135, y: 10, z: -480 },
    { x: -55, y: 85, z: -15 }, { x: 155, y: -65, z: -520 }, { x: -35, y: -40, z: -780 },
    { x: 45, y: 75, z: -560 }, { x: -125, y: -60, z: -820 }, { x: 180, y: 40, z: -170 },
    { x: -10, y: -95, z: -600 }, { x: 110, y: 80, z: -860 }, { x: -165, y: 15, z: -640 },
    { x: 60, y: -55, z: -900 }, { x: -90, y: 70, z: -380 }, { x: 175, y: -30, z: -680 },
    { x: -50, y: -70, z: -940 }, { x: 85, y: 25, z: -720 }, { x: -140, y: -45, z: -760 },
    { x: 30, y: 90, z: -440 }, { x: -75, y: -15, z: -980 }, { x: 150, y: 60, z: -300 },
    { x: -180, y: -80, z: -800 }, { x: 20, y: 50, z: -840 }, { x: -115, y: 25, z: -880 },
    { x: 100, y: -85, z: -520 }, { x: -25, y: 65, z: -920 }, { x: 165, y: -45, z: -960 },
    { x: -155, y: 80, z: -400 }, { x: 75, y: -30, z: -1000 }, { x: -60, y: -50, z: -1040 },
    { x: 140, y: 35, z: -560 }, { x: -100, y: 10, z: -1080 }, { x: 45, y: -75, z: -1120 },
    { x: -130, y: 55, z: -1000 }, { x: 185, y: -20, z: -480 }, { x: -40, y: 80, z: -1040 },
    { x: 70, y: -45, z: -1200 },
];

// Rounded rectangle shape helper
function createRoundedRectShape(w, h, r) {
    var s = new THREE.Shape(), hw = w / 2, hh = h / 2;
    s.moveTo(-hw + r, -hh);
    s.lineTo(hw - r, -hh); s.quadraticCurveTo(hw, -hh, hw, -hh + r);
    s.lineTo(hw, hh - r); s.quadraticCurveTo(hw, hh, hw - r, hh);
    s.lineTo(-hw + r, hh); s.quadraticCurveTo(-hw, hh, -hw, hh - r);
    s.lineTo(-hw, -hh + r); s.quadraticCurveTo(-hw, -hh, -hw + r, -hh);
    return s;
}

// Click-to-front shared state
var _focusedPanel = null;
var _panelRaycaster = new THREE.Raycaster();
var _panelMouse = new THREE.Vector2();
var _clickStart = { x: 0, y: 0 };
var CLICK_THRESHOLD = 5;

// F1 Track data (15 circuits)
var trackPoints = [
    [[-0.2,1],[0.2,0.9],[0.3,0.3],[0.5,0.1],[0.4,-0.4],[0,-0.8],[-0.3,-0.6],[-0.4,0.2],[-0.3,0.8]],
    [[-0.5,0.8],[-0.1,0.5],[0.3,0.6],[0.7,0.2],[0.4,-0.4],[0,-0.8],[-0.6,-0.5],[-0.8,-0.1],[-0.7,0.5]],
    [[0,1],[0.5,0.8],[0.6,0.2],[0.8,-0.2],[0.4,-0.8],[-0.2,-0.9],[-0.6,-0.4],[-0.8,0.2],[-0.4,0.8]],
    [[0.8,0.2],[0.5,0.6],[0,0.8],[-0.5,0.7],[-0.8,0.2],[-0.6,-0.3],[0,-0.6],[0.6,-0.8],[0.9,-0.3]],
    [[0.5,0.8],[0.8,0.2],[0.5,-0.4],[0,-0.8],[-0.5,-0.6],[0.2,0],[-0.6,0.5],[-0.8,0.8],[0,1]],
    [[-0.5,0.8],[0,0.5],[0.6,0.8],[0.8,0.2],[0.4,-0.4],[-0.2,-0.8],[-0.6,-0.6],[-0.8,-0.1],[-0.7,0.5]],
    [[-0.5,-0.8],[-0.8,-0.2],[-0.6,0.5],[-0.1,0.8],[0.4,0.7],[0.8,0.1],[0.6,-0.5],[0,-0.8]],
    [[-0.6,-0.6],[-0.8,0.4],[0,0.8],[0.6,0.5],[0.8,-0.2],[0.2,-0.5]],
    [[-0.4,0.8],[0.2,0.9],[0.7,0.5],[0.8,-0.2],[0.3,-0.8],[-0.5,-0.7],[-0.8,0],[-0.7,0.5]],
    [[-0.8,0.6],[-0.4,0.8],[0.4,0.7],[0.8,0.2],[0.6,-0.4],[0,-0.8],[-0.6,-0.7],[-0.9,-0.1]],
    [[-0.8,0.2],[-0.6,0.8],[0,0.6],[0.8,0.8],[0.9,-0.4],[0.5,-0.8],[-0.2,-0.6],[-0.6,-0.4]],
    [[-0.6,-0.8],[-0.8,0],[-0.5,0.8],[0.2,0.9],[0.8,0.4],[0.6,-0.5],[0,-0.6],[-0.2,-0.9]],
    [[-0.2,0.9],[0.4,0.8],[0.7,0.3],[0.8,-0.4],[0.5,-0.8],[0.1,-0.6],[-0.4,-0.9],[-0.8,-0.2],[-0.6,0.5]],
    [[-0.5,-0.7],[-0.8,0.1],[-0.4,0.8],[0.2,0.9],[0.8,0.5],[0.6,-0.4],[0.2,-0.8],[-0.2,-0.5]],
    [[-0.8,0.5],[-0.4,0.9],[0.4,0.8],[0.8,0.2],[0.9,-0.6],[0.4,-0.8],[-0.2,-0.7],[-0.6,-0.9],[-0.9,-0.2]]
];

// F1 Track stage generator
function createTrackStage(pointsArray) {
    return function () {
        var bgGroup = Q4Scene.bgGroup, scene = Q4Scene.scene;
        var rotGroup = new THREE.Group(); bgGroup.add(rotGroup);
        var trackGroup = new THREE.Group(); rotGroup.add(trackGroup);
        var vectors = pointsArray.map(function(p) { return new THREE.Vector3(p[0] * 120, 0, p[1] * 120); });
        var curve = new THREE.CatmullRomCurve3(vectors, true, 'centripetal');
        var points = curve.getPoints(400), leftPts = [], rightPts = [];
        for (var i = 0; i < points.length; i++) {
            var pt = points[i], t = (i === points.length - 1) ? 0 : i / (points.length - 1);
            var tan = curve.getTangentAt(t);
            var n = new THREE.Vector3(-tan.z, 0, tan.x).normalize().multiplyScalar(5);
            leftPts.push(new THREE.Vector3(pt.x + n.x, pt.y, pt.z + n.z));
            rightPts.push(new THREE.Vector3(pt.x - n.x, pt.y, pt.z - n.z));
        }
        var laneMat = new THREE.MeshBasicMaterial({ color: 0x555555 });
        var lm = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(leftPts, true), 400, 0.4, 4, true), laneMat);
        lm.scale.y = 0.1; trackGroup.add(lm);
        var rm = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(rightPts, true), 400, 0.4, 4, true), laneMat);
        rm.scale.y = 0.1; trackGroup.add(rm);
        var cm = new THREE.Mesh(new THREE.TubeGeometry(curve, 400, 1.5, 8, true),
            new THREE.MeshBasicMaterial({ color: 0x2288ff, transparent: true, opacity: 0.7 }));
        cm.scale.y = 0.1; trackGroup.add(cm);
        var shape = new THREE.Shape();
        shape.moveTo(0, 4); shape.lineTo(3, -4); shape.lineTo(0, -2); shape.lineTo(-3, -4); shape.lineTo(0, 4);
        var carGeo = new THREE.ExtrudeGeometry(shape, { depth: 1, bevelEnabled: true, bevelSegments: 2, steps: 1, bevelSize: 0.2, bevelThickness: 0.2 });
        carGeo.rotateX(-Math.PI / 2);
        var car = new THREE.Mesh(carGeo, new THREE.MeshStandardMaterial({ color: 0xffffff, metalness: 0.2, roughness: 0.1 }));
        car.position.set(0, -15, 0);
        var carGroup = new THREE.Group(); carGroup.add(car); bgGroup.add(carGroup);
        var oldFog = scene.fog;
        bgGroup.userData.cleanup = function() { scene.fog = oldFog; };
        scene.fog = null;
        rotGroup.position.y = -15;
        Q4Scene.currentBgAnimate = function(t) {
            var s = 0.08, time = (t * s) % 1;
            var p = curve.getPointAt(time), tan = curve.getTangentAt(time);
            trackGroup.position.set(-p.x, -p.y, -p.z);
            rotGroup.rotation.y = -Math.atan2(tan.x, tan.z) + Math.PI;
        };
    };
}
