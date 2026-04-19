/* ==========================================================================
   Q4NT PRO - Dashboard Tab Controller (Row 2)
   Generates 20 high-fidelity widget panels for each dashboard sub-tab.
   ========================================================================== */

(function() {
    function generatePanels(pane) {
        if (!pane) return;
        const paneId = pane.getAttribute('data-pane') || 'unknown';

        if (pane.querySelector('.home-panels-container')) return;

        console.log(`[Q4NT Dashboard] Populating: ${paneId}`);
        pane.innerHTML = '';

        const container = document.createElement('div');
        container.className = 'home-panels-container';
        
        pane.appendChild(container);

        const tabTitle = paneId.replace('row2-', '').toUpperCase();
        const closeSvg = '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>';
        const minimizeSvg = '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>';
        const editSvg = '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>';
        const starSvg = '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon></svg>';

        for (let i = 1; i <= 20; i++) {
            const panel = document.createElement('div');
            panel.className = 'q4-widget-panel';
            const title = `${tabTitle} ${i}`;
            
            panel.innerHTML = `
                <div class="q4-widget-header">
                    <span class="q4-widget-title">${title}</span>
                    <div class="q4-widget-actions">
                        <button class="q4-widget-action-btn q4-widget-star" title="Star">${starSvg}</button>
                        <button class="q4-widget-action-btn q4-widget-edit" title="Edit">${editSvg}</button>
                        <button class="q4-widget-action-btn q4-widget-minimize" title="Minimize">${minimizeSvg}</button>
                        <button class="q4-widget-close" title="Close">${closeSvg}</button>
                    </div>
                </div>
                <div class="q4-widget-content"></div>
            `;

            // Drag-to-detach Logic
            panel.addEventListener('mousedown', (e) => {
                if (e.target.closest('.q4-widget-actions')) return;
                if (e.button !== 0) return; // Only left click
                const startX = e.clientX;
                const startY = e.clientY;
                let isDragging = false;
                let ghost = null;

                const onMove = (ev) => {
                    const dist = Math.sqrt(Math.pow(ev.clientX - startX, 2) + Math.pow(ev.clientY - startY, 2));

                    // Require a meaningful drag distance before activating
                    if (dist > 30 && !isDragging) {
                        isDragging = true;
                        // Create a ghost preview that follows the cursor
                        ghost = document.createElement('div');
                        ghost.className = 'q4-drag-ghost';
                        ghost.textContent = title;
                        ghost.style.cssText = `
                            position: fixed;
                            z-index: 99999;
                            pointer-events: none;
                            background: rgba(10, 10, 10, 0.85);
                            color: #a0a0a0;
                            border: 1px solid rgba(255, 255, 255, 0.15);
                            border-radius: 10px;
                            padding: 10px 20px;
                            font-size: 11px;
                            font-weight: 700;
                            letter-spacing: 0.5px;
                            text-transform: uppercase;
                            font-family: 'Inter', sans-serif;
                            box-shadow: 0 12px 40px rgba(0,0,0,0.5);
                            backdrop-filter: blur(8px);
                            transition: opacity 0.15s;
                        `;
                        document.body.appendChild(ghost);
                        // Dim the source panel while dragging
                        panel.style.opacity = '0.3';
                    }

                    if (isDragging && ghost) {
                        ghost.style.left = (ev.clientX - 60) + 'px';
                        ghost.style.top = (ev.clientY - 18) + 'px';
                    }
                };

                const onUp = (ev) => {
                    window.removeEventListener('mousemove', onMove);
                    window.removeEventListener('mouseup', onUp);

                    // Restore source panel opacity
                    panel.style.opacity = '1';

                    // Remove ghost
                    if (ghost) {
                        ghost.remove();
                        ghost = null;
                    }

                    // Only spawn if the user actually dragged
                    if (isDragging && window.DetachedPanels) {
                        window.DetachedPanels.spawn(title, ev.clientX, ev.clientY);
                    }
                };

                window.addEventListener('mousemove', onMove);
                window.addEventListener('mouseup', onUp);
                e.preventDefault();
            });

            container.appendChild(panel);
        }
    }

    function init() {
        const row2Panes = document.querySelectorAll('.btp-pane[data-pane^="row2-"]');
        if (row2Panes.length === 0) {
            setTimeout(init, 500);
            return;
        }
        row2Panes.forEach(generatePanels);
        document.body.setAttribute('data-dashboard-status', 'ready');
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
    
    window.addEventListener('load', init);
    
    const observer = new MutationObserver((mutations) => {
        mutations.forEach((mutation) => {
            if (mutation.attributeName === 'class') {
                const target = mutation.target;
                if (target.classList.contains('active') && target.getAttribute('data-pane').startsWith('row2-')) {
                    generatePanels(target);
                }
            }
        });
    });

    document.querySelectorAll('.btp-pane[data-pane^="row2-"]').forEach(pane => {
        observer.observe(pane, { attributes: true });
    });

})();
