/* ==========================================================================
   Q4NT PRO - Camera Tab Controller
   ========================================================================== */
var TabCamera = (function() {
    var pane = document.querySelector('.btp-pane[data-pane="camera"]');
    if (!pane) return {};
    var _rafId = null;

    function startLiveUpdate() {
        if (_rafId) return;
        function tick() {
            if (typeof Q4Scene !== 'undefined' && Q4Scene.activeViews.length > 0) {
                var cam = Q4Scene.activeViews[0].camera;
                pane.textContent = 'Camera: Perspective | FOV: ' + cam.fov +
                    ' | Pos: (' + cam.position.x.toFixed(1) + ', ' +
                    cam.position.y.toFixed(1) + ', ' +
                    cam.position.z.toFixed(1) + ')' +
                    ' | Aspect: ' + cam.aspect.toFixed(2);
            }
            _rafId = requestAnimationFrame(tick);
        }
        tick();
    }

    function stopLiveUpdate() {
        if (_rafId) { cancelAnimationFrame(_rafId); _rafId = null; }
    }

    // Auto-start when tab becomes active
    var observer = new MutationObserver(function() {
        if (pane.classList.contains('active')) startLiveUpdate();
        else stopLiveUpdate();
    });
    observer.observe(pane, { attributes: true, attributeFilter: ['class'] });

    return { startLiveUpdate: startLiveUpdate, stopLiveUpdate: stopLiveUpdate, pane: pane };
})();
