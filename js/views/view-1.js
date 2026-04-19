/* View 1 - Default View: Flat Panels mixed with 3D Objects */
backgrounds[0] = function () {
    var bgGroup = Q4Scene.bgGroup;
    var panelColors = [
        { bg: 0xffffff, border: 0xe0e0e0 }, { bg: 0xf8f8f8, border: 0xd0d0d0 },
        { bg: 0x2d3436, border: 0x636e72 }, { bg: 0x00b894, border: 0x00cec9 },
        { bg: 0x6c5ce7, border: 0xa29bfe }, { bg: 0xdfe6e9, border: 0xb2bec3 },
        { bg: 0xff7675, border: 0xd63031 }, { bg: 0x0984e3, border: 0x74b9ff },
        { bg: 0xfdcb6e, border: 0xf39c12 }, { bg: 0x55efc4, border: 0x00b894 },
    ];

    // Premium 3D object palette: color, emissive, metalness, roughness
    var objPalette = [
        { color: 0x00f2fe, emissive: 0x003344, metalness: 0.9, roughness: 0.1 },
        { color: 0xa29bfe, emissive: 0x1a0050, metalness: 0.8, roughness: 0.2 },
        { color: 0x55efc4, emissive: 0x003322, metalness: 0.7, roughness: 0.15 },
        { color: 0xfdcb6e, emissive: 0x331a00, metalness: 0.6, roughness: 0.3 },
        { color: 0xff7675, emissive: 0x330000, metalness: 0.75, roughness: 0.2 },
    ];

    // 3D geometry factories — sized to roughly match PANEL_W x PANEL_H footprint
    var objGeoFactories = [
        function() { return new THREE.BoxGeometry(PANEL_W * 0.6, PANEL_H * 0.6, PANEL_H * 0.6); },
        function() { return new THREE.SphereGeometry(PANEL_H * 0.45, 32, 24); },
        function() { return new THREE.TorusGeometry(PANEL_H * 0.38, PANEL_H * 0.12, 16, 48); },
        function() { return new THREE.OctahedronGeometry(PANEL_H * 0.48); },
        function() { return new THREE.ConeGeometry(PANEL_H * 0.4, PANEL_W * 0.55, 32); },
    ];

    var cornerRadius = 1.2;
    var roundedShape = createRoundedRectShape(PANEL_W, PANEL_H, cornerRadius);
    var sharedGeo = new THREE.ShapeGeometry(roundedShape, 8);
    var sharedEdgeGeo = new THREE.EdgesGeometry(sharedGeo, 15);
    var panelMeshes = [];
    var obj3dMeshes = [];

    for (var i = 0; i < PANEL_POSITIONS.length; i++) {
        var pos = PANEL_POSITIONS[i];
        var mesh;

        if (i % 3 === 2) {
            // --- 3D Object ---
            var objIdx   = Math.floor(i / 3) % objGeoFactories.length;
            var palIdx   = Math.floor(i / 3) % objPalette.length;
            var pal      = objPalette[palIdx];
            var geo3d    = objGeoFactories[objIdx]();
            var mat3d    = new THREE.MeshStandardMaterial({
                color:      pal.color,
                emissive:   pal.emissive,
                metalness:  pal.metalness,
                roughness:  pal.roughness,
                transparent: true,
                opacity:    0.92
            });
            mesh = new THREE.Mesh(geo3d, mat3d);
            mesh.position.set(pos.x, pos.y, pos.z);

            // Wireframe outline
            var wfGeo = new THREE.EdgesGeometry(geo3d, 20);
            var wfMat = new THREE.LineBasicMaterial({ color: pal.color, transparent: true, opacity: 0.35 });
            mesh.add(new THREE.LineSegments(wfGeo, wfMat));

            mesh.userData = {
                homeX: pos.x, homeY: pos.y, homeZ: pos.z,
                seed: Math.random() * Math.PI * 2,
                speed: 0.10 + Math.random() * 0.18,
                amplitude: 0.15 + Math.random() * 0.35,
                baseOpacity: 0.92,
                _isPanel: true,
                _is3dObj: true,
                targetZ: pos.z, targetX: pos.x, targetY: pos.y,
                rotSpeedX: (Math.random() - 0.5) * 0.008,
                rotSpeedY: 0.006 + Math.random() * 0.010,
                rotSpeedZ: (Math.random() - 0.5) * 0.005,
            };
            obj3dMeshes.push(mesh);
        } else {
            // --- Flat Panel ---
            var cs  = panelColors[i % panelColors.length];
            var mat = new THREE.MeshStandardMaterial({
                color: cs.bg, metalness: 0.05, roughness: 0.85,
                transparent: true, opacity: 0.92, side: THREE.DoubleSide
            });
            mesh = new THREE.Mesh(sharedGeo, mat);
            mesh.position.set(pos.x, pos.y, pos.z);
            mesh.rotation.set(0, 0, 0);
            mesh.add(new THREE.LineSegments(sharedEdgeGeo,
                new THREE.LineBasicMaterial({ color: cs.border, transparent: true, opacity: 0.4 })));
            mesh.userData = {
                homeX: pos.x, homeY: pos.y, homeZ: pos.z,
                seed: Math.random() * Math.PI * 2, speed: 0.12 + Math.random() * 0.2,
                amplitude: 0.2 + Math.random() * 0.4, baseY: pos.y, baseOpacity: 0.92,
                _isPanel: true, targetZ: pos.z, targetX: pos.x, targetY: pos.y
            };
        }

        panelMeshes.push(mesh);
        bgGroup.add(mesh);
    }

    // Dragging & Click-to-front raycasting
    var _focusedPanel = null;
    var _draggedPanel = null;
    var _dragStartPos = new THREE.Vector3();

    var onPanelMouseDown = function(e) {
        if (e.button !== 0) return;
        if (e.target.closest && (e.target.closest('.beveled-panel') || e.target.closest('.float-panel') ||
            e.target.closest('.bottom-tab-panel') || e.target.closest('.ai-edge-panel') ||
            e.target.closest('.prompt-container') || e.target.closest('.top-nav-buttons') ||
            e.target.closest('.layout-options-panel') || e.target.closest('.theme-options-panel'))) return;

        _clickStart.x = e.clientX; _clickStart.y = e.clientY;
        
        if (Q4Scene.activeViews.length === 0) return;
        var cam = Q4Scene.activeViews[0].camera;
        var container = document.getElementById('canvas-container');
        var rect = container.getBoundingClientRect();
        _panelMouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
        _panelMouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
        _panelRaycaster.setFromCamera(_panelMouse, cam);
        
        var intersects = _panelRaycaster.intersectObjects(panelMeshes, false);
        if (intersects.length > 0) {
            _draggedPanel = intersects[0].object;
            // Prevent camera panning in scene.js
            if (Q4Scene.activeViews.length > 0 && Q4Scene.activeViews[0].paneState) {
                Q4Scene.activeViews[0].paneState.isDragging = false;
            }
            e.stopPropagation();
        }
    };

    var onPanelClick = function(e) {
        if (_draggedPanel) return; // Don't trigger focus if we were dragging
        var dx = e.clientX - _clickStart.x, dy = e.clientY - _clickStart.y;
        if (Math.sqrt(dx * dx + dy * dy) > CLICK_THRESHOLD) return;
        
        if (e.target.closest && (e.target.closest('.beveled-panel') || e.target.closest('.float-panel') ||
            e.target.closest('.bottom-tab-panel') || e.target.closest('.ai-edge-panel') ||
            e.target.closest('.prompt-container') || e.target.closest('.top-nav-buttons') ||
            e.target.closest('.layout-options-panel') || e.target.closest('.theme-options-panel'))) return;

        
        if (Q4Scene.activeViews.length === 0) return;
        var cam = Q4Scene.activeViews[0].camera;
        var container = document.getElementById('canvas-container');
        var rect = container.getBoundingClientRect();
        _panelMouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
        _panelMouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
        _panelRaycaster.setFromCamera(_panelMouse, cam);
        
        var intersects = _panelRaycaster.intersectObjects(panelMeshes, false);
        if (intersects.length > 0) {
            var hit = intersects[0].object;
            if (_focusedPanel === hit) {
                hit.userData.targetZ = hit.userData.homeZ;
                hit.userData.targetX = hit.userData.homeX;
                hit.userData.targetY = hit.userData.homeY;
                _focusedPanel = null; return;
            }
            if (_focusedPanel) {
                _focusedPanel.userData.targetZ = _focusedPanel.userData.homeZ;
                _focusedPanel.userData.targetX = _focusedPanel.userData.homeX;
                _focusedPanel.userData.targetY = _focusedPanel.userData.homeY;
            }
            hit.userData.targetZ = cam.position.z - 20;
            hit.userData.targetX = cam.position.x;
            hit.userData.targetY = cam.position.y;
            _focusedPanel = hit;
        } else if (_focusedPanel) {
            _focusedPanel.userData.targetZ = _focusedPanel.userData.homeZ;
            _focusedPanel.userData.targetX = _focusedPanel.userData.homeX;
            _focusedPanel.userData.targetY = _focusedPanel.userData.homeY;
            _focusedPanel = null;
        }
    };

    var onPanelMouseUp = function() {
        _draggedPanel = null;
    };

    window.addEventListener('mousedown', onPanelMouseDown, true); // Use capture to intercept before scene.js
    window.addEventListener('click', onPanelClick);
    window.addEventListener('mouseup', onPanelMouseUp);

    bgGroup.userData.cleanup = function() {
        window.removeEventListener('mousedown', onPanelMouseDown, true);
        window.removeEventListener('click', onPanelClick);
        window.removeEventListener('mouseup', onPanelMouseUp);
        window.removeEventListener('mousemove', onPanelMouseMove);
        _focusedPanel = null;
        _draggedPanel = null;
        _hoveredPanel = null;
    };

    // Hover & Drag raycasting
    var _hoveredPanel = null;
    var onPanelMouseMove = function(e) {
        if (Q4Scene.activeViews.length === 0) return;
        var cam = Q4Scene.activeViews[0].camera;
        var container = document.getElementById('canvas-container');
        if (!container) return;
        var rect = container.getBoundingClientRect();
        _panelMouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
        _panelMouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

        if (_draggedPanel) {
            // Project mouse to panel plane
            var vector = new THREE.Vector3(_panelMouse.x, _panelMouse.y, 0.5);
            vector.unproject(cam);
            var dir = vector.sub(cam.position).normalize();
            var distance = (_draggedPanel.position.z - cam.position.z) / dir.z;
            var pos = cam.position.clone().add(dir.multiplyScalar(distance));
            
            _draggedPanel.userData.targetX = pos.x;
            _draggedPanel.userData.targetY = pos.y;
            _draggedPanel.userData.homeX = pos.x;
            _draggedPanel.userData.homeY = pos.y;
            return;
        }

        _panelRaycaster.setFromCamera(_panelMouse, cam);
        var intersects = _panelRaycaster.intersectObjects(panelMeshes, false);
        
        if (intersects.length > 0) {
            var hit = intersects[0].object;
            if (_hoveredPanel !== hit) {
                if (_hoveredPanel && _hoveredPanel !== _focusedPanel) {
                    _hoveredPanel.userData.targetScale = 1.0;
                }
                _hoveredPanel = hit;
                if (_hoveredPanel !== _focusedPanel) {
                    _hoveredPanel.userData.targetScale = 1.08;
                }
            }
        } else {
            if (_hoveredPanel) {
                if (_hoveredPanel !== _focusedPanel) {
                    _hoveredPanel.userData.targetScale = 1.0;
                }
                _hoveredPanel = null;
            }
        }
    };
    window.addEventListener('mousemove', onPanelMouseMove);

    // Mini 3D Cubes (Peppered effect)
    var cubeGeo = new THREE.BoxGeometry(1.2, 1.2, 1.2);
    for (var j = 0; j < 200; j++) {
        var cMat = new THREE.MeshStandardMaterial({
            color: 0x808080,
            transparent: true,
            opacity: Math.random() * 0.3 + 0.1,
            metalness: 0.1,
            roughness: 0.8
        });
        var miniCube = new THREE.Mesh(cubeGeo, cMat);
        miniCube.position.set(
            (Math.random() - 0.5) * 600,
            (Math.random() - 0.5) * 400,
            -(Math.random() * 800 + 50)
        );
        miniCube.rotation.set(0, 0, 0);
        miniCube.userData = { _isCube: true, rotSpeed: 0 };
        bgGroup.add(miniCube);
    }

    // Particles
    var pc = 500, mg = new THREE.BufferGeometry(), pos2 = new Float32Array(pc * 3);
    for (var p = 0; p < pc; p++) {
        pos2[p*3] = (Math.random()-0.5)*1200;
        pos2[p*3+1] = (Math.random()-0.5)*800;
        pos2[p*3+2] = -(Math.random()*1200+20);
    }
    mg.setAttribute('position', new THREE.BufferAttribute(pos2, 3));
    var ps = new THREE.Points(mg, new THREE.PointsMaterial({ color: 0xcccccc, size: 0.8, transparent: true, opacity: 0.2, sizeAttenuation: true }));
    ps.userData._isParticle = true;
    bgGroup.add(ps);

    // Animation
    Q4Scene.currentBgAnimate = function(t) {
        var children = bgGroup.children;
        var camZ = BASE_Z;
        if (Q4Scene.activeViews.length > 0) camZ = Q4Scene.activeViews[0].camera.position.z;
        var fadeStart = 120, fadeEnd = 250;
        for (var i = 0, len = children.length; i < len; i++) {
            var c = children[i];

            // Animate mini cubes
            if (c.userData._isCube) {
                continue;
            }

            if (c.userData._isParticle || !c.userData._isPanel) continue;
            var ls = 0.08;
            c.position.z += (c.userData.targetZ - c.position.z) * ls;
            c.position.x += (c.userData.targetX - c.position.x) * ls;
            var bobY = c.userData.targetY + Math.sin(t * (c.userData.speed||0.15) + (c.userData.seed||0)) * (c.userData.amplitude||0.3);
            c.position.y += (bobY - c.position.y) * ls;


            // Hover scale animation
            var targetS = c.userData.targetScale || 1.0;
            c.scale.x += (targetS - c.scale.x) * 0.2;
            c.scale.y += (targetS - c.scale.y) * 0.2;
            c.scale.z += (targetS - c.scale.z) * 0.2;

            var depth = camZ - c.position.z, dOp = 1;
            if (depth > fadeStart) dOp = Math.max(0, 1 - (depth - fadeStart) / (fadeEnd - fadeStart));
            if (c === _focusedPanel) {
                c.material.opacity = 1.0;
                c.visible = true;
            } else {
                c.material.opacity = (c.userData.baseOpacity || 0.92) * dOp;
                c.visible = c.userData.isHiddenByUser ? false : (dOp > 0.01);
            }
        }
    };
};
