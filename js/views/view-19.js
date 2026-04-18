/* View 19 - Monolithic Box Room */
backgrounds[18] = function () {
    var geo = new THREE.BoxGeometry(100, 50, 100);
    var mat = new THREE.MeshStandardMaterial({ color: 0xf5f5f7, side: THREE.BackSide, roughness: 1 });
    var mesh = new THREE.Mesh(geo, mat);
    mesh.position.y = 10;
    Q4Scene.bgGroup.add(mesh);
};
