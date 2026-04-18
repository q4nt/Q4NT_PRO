/* ==========================================================================
   Q4NT PRO - Telemetry Tab Controller
   ========================================================================== */
var TabTelemetry = (function() {
    var pane = document.querySelector('.btp-pane[data-pane="telemetry"]');
    if (!pane) return {};
    var active = false;

    function start() {
        if (active) return;
        active = true;
        pane.textContent = 'Telemetry stream active.';
    }

    function stop() {
        active = false;
        pane.textContent = 'Telemetry stream inactive.';
    }

    function update(data) {
        if (!active) return;
        var entry = document.createElement('div');
        entry.textContent = '[' + new Date().toLocaleTimeString() + '] ' + data;
        entry.style.marginBottom = '1px';
        pane.appendChild(entry);
        pane.scrollTop = pane.scrollHeight;
    }

    return { start: start, stop: stop, update: update, pane: pane };
})();
