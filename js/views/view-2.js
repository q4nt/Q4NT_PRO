/* View 2 - Infinite Grid Floor */
backgrounds[1] = function () {
    var geo = new THREE.PlaneGeometry(200, 200, 20, 20);
    geo.rotateX(-Math.PI / 2);
    var mat = new THREE.MeshBasicMaterial({ color: 0xccccdd, wireframe: true, transparent: true, opacity: 0.12 });
    var mesh = new THREE.Mesh(geo, mat);
    mesh.position.y = -15;
    Q4Scene.bgGroup.add(mesh);
    Q4Scene.currentBgAnimate = function(t) { mesh.position.z = (t * 2) % 10; };
};
