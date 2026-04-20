/* ==========================================================================
   Q4NT PRO - View Factory
   Consolidates all 22 background views into a single registry pattern.
   Eliminates 23 individual view-*.js files by providing a declarative
   registration API with shared utilities from shared.js.

   Usage:
     ViewFactory.register(0, function() { ... });   // replaces view-1.js
     ViewFactory.get(0)();                           // activates background[0]

   Depends on: js/views/shared.js (PANEL_POSITIONS, createRoundedRectShape, etc.)
   ========================================================================== */

var ViewFactory = (function () {

    // Registry: index -> builder function
    var _registry = {};

    /**
     * Register a view builder function at a given index.
     * @param {number} index - The background index (0-based)
     * @param {Function} builder - The function that populates Q4Scene.bgGroup
     */
    function register(index, builder) {
        if (typeof builder !== 'function') {
            console.warn('[ViewFactory] Invalid builder for index', index);
            return;
        }
        _registry[index] = builder;

        // Sync to the global backgrounds array used by scene.js
        if (typeof backgrounds !== 'undefined') {
            backgrounds[index] = builder;
        }
    }

    /**
     * Get a registered view builder.
     * @param {number} index
     * @returns {Function|null}
     */
    function get(index) {
        return _registry[index] || null;
    }

    /**
     * Check if a view is registered at a given index.
     * @param {number} index
     * @returns {boolean}
     */
    function has(index) {
        return !!_registry[index];
    }

    /**
     * Get all registered view indices.
     * @returns {number[]}
     */
    function list() {
        return Object.keys(_registry).map(Number).sort(function (a, b) { return a - b; });
    }

    /**
     * Get the total count of registered views.
     * @returns {number}
     */
    function count() {
        return Object.keys(_registry).length;
    }

    // -----------------------------------------------------------------------
    // Shared Helpers (extracted from duplicated view code)
    // -----------------------------------------------------------------------

    /**
     * Create a standard floor plane used by multiple views.
     * @param {Object} opts - { color, metalness, roughness, size, y, wireframe, opacity }
     * @returns {THREE.Mesh}
     */
    function createFloorPlane(opts) {
        var o = opts || {};
        var size = o.size || 200;
        var geo = new THREE.PlaneGeometry(size, size, o.segments || 1, o.segments || 1);
        geo.rotateX(-Math.PI / 2);

        var matOpts = {
            color: o.color || 0xccccdd,
            transparent: true,
            opacity: o.opacity !== undefined ? o.opacity : 0.12
        };

        if (o.wireframe) {
            matOpts.wireframe = true;
            var mat = new THREE.MeshBasicMaterial(matOpts);
        } else {
            matOpts.metalness = o.metalness !== undefined ? o.metalness : 0.05;
            matOpts.roughness = o.roughness !== undefined ? o.roughness : 0.85;
            var mat = new THREE.MeshStandardMaterial(matOpts);
        }

        var mesh = new THREE.Mesh(geo, mat);
        mesh.position.y = o.y !== undefined ? o.y : -15;
        return mesh;
    }

    /**
     * Create a standard particle field used by multiple views.
     * @param {Object} opts - { count, spread, depth, color, size, opacity }
     * @returns {THREE.Points}
     */
    function createParticleField(opts) {
        var o = opts || {};
        var pc = o.count || 500;
        var spreadX = o.spreadX || o.spread || 1200;
        var spreadY = o.spreadY || (o.spread ? o.spread * 0.67 : 800);
        var depth = o.depth || 1200;

        var positions = new Float32Array(pc * 3);
        for (var i = 0; i < pc; i++) {
            positions[i * 3]     = (Math.random() - 0.5) * spreadX;
            positions[i * 3 + 1] = (Math.random() - 0.5) * spreadY;
            positions[i * 3 + 2] = -(Math.random() * depth + 20);
        }

        var geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));

        var points = new THREE.Points(geo, new THREE.PointsMaterial({
            color: o.color || 0xcccccc,
            size: o.size || 0.8,
            transparent: true,
            opacity: o.opacity || 0.2,
            sizeAttenuation: true
        }));
        points.userData._isParticle = true;
        return points;
    }

    // -----------------------------------------------------------------------
    // Public Interface
    // -----------------------------------------------------------------------
    return {
        register: register,
        get: get,
        has: has,
        list: list,
        count: count,
        // Shared helpers for view builders
        createFloorPlane: createFloorPlane,
        createParticleField: createParticleField
    };

})();
