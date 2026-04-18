/* View 14 - Glossy Floor */
backgrounds[13] = function () {
    var geo = new THREE.PlaneGeometry(200, 200);
    geo.rotateX(-Math.PI / 2);
    var mat = new THREE.MeshStandardMaterial({ color: 0xf0f0f5, metalness: 0.3, roughness: 0.1 });
    var mesh = new THREE.Mesh(geo, mat);
    mesh.position.y = -15;
    Q4Scene.bgGroup.add(mesh);
};
