/* ==========================================================================
   Q4NT PRO - Console Tab Controller
   ========================================================================== */
var TabConsole = (function() {
    var pane = document.querySelector('.btp-pane[data-pane="console"]');
    if (!pane) return {};

    function log(msg) {
        var line = document.createElement('div');
        line.textContent = '> ' + msg;
        line.style.marginBottom = '2px';
        pane.appendChild(line);
        pane.scrollTop = pane.scrollHeight;
    }

    function clear() {
        pane.innerHTML = '';
    }

    // Initial messages
    log('Q4NT workspace initialized.');
    log('Renderer: Three.js r128');
    log('Views: 1 active');

    return { log: log, clear: clear, pane: pane };
})();
