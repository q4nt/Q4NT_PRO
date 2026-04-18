/* View 10 - Floor Pulse */
backgrounds[9] = function () {
    var geo = new THREE.PlaneGeometry(100, 100);
    geo.rotateX(-Math.PI / 2);
    var mat = new THREE.MeshBasicMaterial({ color: 0x223344, transparent: true, opacity: 0 });
    var mesh = new THREE.Mesh(geo, mat);
    mesh.position.y = -15;
    Q4Scene.bgGroup.add(mesh);
    Q4Scene.currentBgAnimate = function(t) { mesh.material.opacity = (Math.sin(t) + 1) * 0.15; };
};
