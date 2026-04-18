/* ==========================================================================
   Q4NT PRO - Output Tab Controller
   ========================================================================== */
var TabOutput = (function() {
    var pane = document.querySelector('.btp-pane[data-pane="output"]');
    if (!pane) return {};

    function write(content) {
        var entry = document.createElement('div');
        entry.textContent = content;
        entry.style.marginBottom = '2px';
        pane.appendChild(entry);
        pane.scrollTop = pane.scrollHeight;
    }

    function clear() {
        pane.innerHTML = '';
    }

    return { write: write, clear: clear, pane: pane };
})();
