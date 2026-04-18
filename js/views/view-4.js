/* View 4 - Hex Platform */
backgrounds[3] = function () {
    var geo = new THREE.CylinderGeometry(20, 20, 1, 6);
    var mat = new THREE.MeshStandardMaterial({ color: 0x222222, metalness: 0.8, roughness: 0.2 });
    var mesh = new THREE.Mesh(geo, mat);
    mesh.position.y = -15;
    Q4Scene.bgGroup.add(mesh);
    mesh.add(new THREE.LineSegments(new THREE.EdgesGeometry(geo), new THREE.LineBasicMaterial({ color: 0x556677 })));
    Q4Scene.currentBgAnimate = function(t) { mesh.rotation.y = t * 0.05; };
};
