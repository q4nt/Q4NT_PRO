/* ==========================================================================
   Q4NT PRO - Consolidated Simple Views
   Registers views 2-20 (excluding 1, 21, 22 which are complex and retain
   their own files). Replaces 19 individual view-*.js files.

   Depends on: js/views/shared.js, js/views/view-factory.js
   ========================================================================== */

(function () {

    // ---- View 2: Infinite Grid Floor ----
    ViewFactory.register(1, function () {
        var mesh = ViewFactory.createFloorPlane({
            color: 0xccccdd, wireframe: true, opacity: 0.12,
            segments: 20
        });
        Q4Scene.bgGroup.add(mesh);
        Q4Scene.currentBgAnimate = null;
    });

    // ---- Views 3-9: F1 Track Circuits ----
    // Each uses createTrackStage from shared.js with a different circuit
    ViewFactory.register(2, createTrackStage(trackPoints[0]));   // View 3
    ViewFactory.register(3, function () {                         // View 4 - Hex Platform
        var geo = new THREE.CylinderGeometry(20, 20, 1, 6);
        var mat = new THREE.MeshStandardMaterial({ color: 0x222222, metalness: 0.8, roughness: 0.2 });
        var mesh = new THREE.Mesh(geo, mat);
        mesh.position.y = -15;
        Q4Scene.bgGroup.add(mesh);
        mesh.add(new THREE.LineSegments(new THREE.EdgesGeometry(geo), new THREE.LineBasicMaterial({ color: 0x556677 })));
        Q4Scene.currentBgAnimate = function(t) { mesh.rotation.y = t * 0.05; };
    });
    ViewFactory.register(4, createTrackStage(trackPoints[1]));   // View 5
    ViewFactory.register(5, createTrackStage(trackPoints[2]));   // View 6
    ViewFactory.register(6, createTrackStage(trackPoints[3]));   // View 7
    ViewFactory.register(7, createTrackStage(trackPoints[4]));   // View 8
    ViewFactory.register(8, createTrackStage(trackPoints[5]));   // View 9

    // ---- View 10: Floor Pulse ----
    ViewFactory.register(9, function () {
        var geo = new THREE.PlaneGeometry(100, 100);
        geo.rotateX(-Math.PI / 2);
        var mat = new THREE.MeshBasicMaterial({ color: 0x223344, transparent: true, opacity: 0 });
        var mesh = new THREE.Mesh(geo, mat);
        mesh.position.y = -15;
        Q4Scene.bgGroup.add(mesh);
        Q4Scene.currentBgAnimate = function(t) { mesh.material.opacity = (Math.sin(t) + 1) * 0.15; };
    });

    // ---- Views 11-13: Empty Stubs (reserved for future use) ----
    ViewFactory.register(10, function () { Q4Scene.currentBgAnimate = null; });
    ViewFactory.register(11, function () { Q4Scene.currentBgAnimate = null; });
    ViewFactory.register(12, function () { Q4Scene.currentBgAnimate = null; });

    // ---- View 14: Glossy Floor ----
    ViewFactory.register(13, function () {
        var mesh = ViewFactory.createFloorPlane({
            color: 0xf0f0f5, metalness: 0.3, roughness: 0.1, opacity: 1.0
        });
        Q4Scene.bgGroup.add(mesh);
    });

    // ---- Views 15-18: Empty Stubs (reserved for future use) ----
    ViewFactory.register(14, function () { Q4Scene.currentBgAnimate = null; });
    ViewFactory.register(15, function () { Q4Scene.currentBgAnimate = null; });
    ViewFactory.register(16, function () { Q4Scene.currentBgAnimate = null; });
    ViewFactory.register(17, function () { Q4Scene.currentBgAnimate = null; });

    // ---- View 19: Monolithic Box Room ----
    ViewFactory.register(18, function () {
        var geo = new THREE.BoxGeometry(100, 50, 100);
        var mat = new THREE.MeshStandardMaterial({ color: 0xf5f5f7, side: THREE.BackSide, roughness: 1 });
        var mesh = new THREE.Mesh(geo, mat);
        mesh.position.y = 10;
        Q4Scene.bgGroup.add(mesh);
    });

    // ---- View 20: Empty Stub ----
    ViewFactory.register(19, function () { Q4Scene.currentBgAnimate = null; });

    console.log('[ViewFactory] Registered', ViewFactory.count(), 'views (simple views 2-20)');

})();
