/* ==========================================================================
   Q4NT PRO - Detached Panels Logic
   Handles dragging widgets out of the bottom tab bar and onto the UI.
   ========================================================================== */

window.DetachedPanels = (function() {
    let activePanel = null;
    let offset = { x: 0, y: 0 };

    function createDetachedPanel(title, x, y) {
        const fp = document.createElement('div');
        fp.className = 'float-panel detached q4-widget-panel';
        fp.style.display = 'flex';
        fp.style.position = 'fixed';
        fp.style.left = (x - 150) + 'px';
        fp.style.top = (y - 20) + 'px';
        fp.style.width = '320px';
        fp.style.height = '240px';
        fp.style.zIndex = '10000';

        const closeSvg = '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>';
        const minimizeSvg = '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>';
        const editSvg = '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>';
        const starSvg = '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon></svg>';

        const header = document.createElement('div');
        header.className = 'float-panel-header q4-widget-header';
        header.innerHTML = `
            <span class="q4-widget-title">${title}</span>
            <div class="q4-widget-actions">
                <button class="q4-widget-action-btn q4-widget-star" title="Star">${starSvg}</button>
                <button class="q4-widget-action-btn q4-widget-edit" title="Edit">${editSvg}</button>
                <button class="q4-widget-action-btn q4-widget-minimize" title="Minimize">${minimizeSvg}</button>
                <button class="q4-widget-close" title="Close">${closeSvg}</button>
            </div>
        `;

        const closeBtn = header.querySelector('.q4-widget-close');

        const body = document.createElement('div');
        body.className = 'float-panel-body q4-widget-content';
        body.innerHTML = `
            <div style="padding: 20px; display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100%;">
            </div>
        `;

        // Resize handles
        const resR = document.createElement('div'); resR.className = 'float-panel-resize fp-res-r'; resR.dataset.dir = 'r';
        const resB = document.createElement('div'); resB.className = 'float-panel-resize fp-res-b'; resB.dataset.dir = 'b';
        const resBR = document.createElement('div'); resBR.className = 'float-panel-resize fp-res-br'; resBR.dataset.dir = 'br';

        fp.appendChild(header);
        fp.appendChild(body);
        fp.appendChild(resR);
        fp.appendChild(resB);
        fp.appendChild(resBR);

        document.getElementById('ui-container').appendChild(fp);

        // Logic
        closeBtn.onclick = () => {
            fp.classList.add('closing');
            fp.addEventListener('animationend', () => fp.remove(), { once: true });
        };

        header.onmousedown = (e) => {
            // Skip if clicking any button in the header
            if (e.target.closest('button')) return;
            activePanel = fp;
            offset.x = e.clientX - fp.offsetLeft;
            offset.y = e.clientY - fp.offsetTop;
            fp.style.zIndex = '10001';
            e.preventDefault();
        };

        // Reuse resize logic from float-panel.js pattern
        [resR, resB, resBR].forEach(handle => {
            handle.onmousedown = (e) => {
                const startX = e.clientX;
                const startY = e.clientY;
                const startW = fp.offsetWidth;
                const startH = fp.offsetHeight;
                const dir = handle.dataset.dir;

                const onMove = (ev) => {
                    if (dir === 'r' || dir === 'br') fp.style.width = (startW + (ev.clientX - startX)) + 'px';
                    if (dir === 'b' || dir === 'br') fp.style.height = (startH + (ev.clientY - startY)) + 'px';
                };
                const onUp = () => {
                    window.removeEventListener('mousemove', onMove);
                    window.removeEventListener('mouseup', onUp);
                };
                window.addEventListener('mousemove', onMove);
                window.addEventListener('mouseup', onUp);
                e.preventDefault();
                e.stopPropagation();
            };
        });

        return fp;
    }

    window.addEventListener('mousemove', (e) => {
        if (activePanel) {
            activePanel.style.left = (e.clientX - offset.x) + 'px';
            activePanel.style.top = (e.clientY - offset.y) + 'px';
        }
    });

    window.addEventListener('mouseup', () => {
        if (activePanel) {
            activePanel.style.zIndex = '10000';
            activePanel = null;
        }
    });

    return {
        spawn: createDetachedPanel
    };
})();
