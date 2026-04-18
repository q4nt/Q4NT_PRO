/* ==========================================================================
   Q4NT PRO - Draggable Panels (Command Panel, Floating Panel, Bottom Tab)
   ========================================================================== */

// === Draggable Command Panel ===
(function initCommandPanel() {
    const cmdPanel = document.querySelector('.panel-bottom');
    const cmdDragHandle = document.querySelector('.cmd-drag-handle');

    // Create drop zone
    const dockDropZone = document.createElement('div');
    dockDropZone.className = 'dock-drop-zone';
    document.getElementById('ui-container')?.appendChild(dockDropZone);

    if (!cmdPanel || !cmdDragHandle) return;

    let isDraggingCmd = false;
    let startX, startY, startLeft, startTop;
    let isHoveringDock = false;

    cmdDragHandle.addEventListener('mousedown', (e) => {
        isDraggingCmd = true;
        startX = e.clientX;
        startY = e.clientY;

        if (cmdPanel.classList.contains('docked-right')) {
            cmdPanel.classList.remove('docked-right');
            cmdPanel.style.transition = 'none';
        }

        if (!cmdPanel.classList.contains('floating')) {
            const rect = cmdPanel.getBoundingClientRect();
            cmdPanel.style.width = rect.width + 'px';
            cmdPanel.style.transform = 'none';
            cmdPanel.style.bottom = 'auto';
            cmdPanel.style.left = rect.left + 'px';
            cmdPanel.style.top = rect.top + 'px';
            cmdPanel.classList.add('floating');
        } else {
            const rect = cmdPanel.getBoundingClientRect();
            cmdPanel.style.left = rect.left + 'px';
            cmdPanel.style.top = rect.top + 'px';
        }

        startLeft = parseFloat(cmdPanel.style.left) || 0;
        startTop = parseFloat(cmdPanel.style.top) || 0;

        document.body.style.cursor = 'grabbing';
        e.preventDefault();
        e.stopPropagation();
    });

    window.addEventListener('mousemove', (e) => {
        if (!isDraggingCmd) return;
        const dx = e.clientX - startX;
        const dy = e.clientY - startY;
        const panelW = cmdPanel.offsetWidth;
        const panelH = cmdPanel.offsetHeight;
        const maxLeft = window.innerWidth - panelW;
        const maxTop = window.innerHeight - panelH;
        const newLeft = Math.max(0, Math.min(maxLeft, startLeft + dx));
        const newTop = Math.max(0, Math.min(maxTop, startTop + dy));
        cmdPanel.style.left = newLeft + 'px';
        cmdPanel.style.top = newTop + 'px';

        if (e.clientX > window.innerWidth - 150) {
            dockDropZone.classList.add('active');
            isHoveringDock = true;
        } else {
            dockDropZone.classList.remove('active');
            isHoveringDock = false;
        }
    }, { capture: true });

    window.addEventListener('mouseup', () => {
        if (isDraggingCmd) {
            isDraggingCmd = false;
            document.body.style.cursor = '';
            cmdPanel.style.transition = '';

            if (isHoveringDock) {
                cmdPanel.classList.add('docked-right');
                dockDropZone.classList.remove('active');
                isHoveringDock = false;
            }
        }
    });
})();

// === Floating Panel Drag & Resize ===
(function initFloatingPanel() {
    const fp = document.getElementById('float-panel');
    const header = document.getElementById('float-panel-header');
    const closeBtn = document.getElementById('float-panel-close');
    if (!fp) return;

    // Close with flick animation
    closeBtn.addEventListener('click', () => {
        fp.classList.add('closing');
        fp.addEventListener('animationend', () => {
            fp.style.display = 'none';
            fp.classList.remove('closing');
        }, { once: true });
    });

    // Drag
    let dragging = false, dx = 0, dy = 0;
    header.addEventListener('mousedown', (e) => {
        if (e.target === closeBtn || closeBtn.contains(e.target)) return;
        dragging = true;
        dx = e.clientX - fp.getBoundingClientRect().left;
        dy = e.clientY - fp.getBoundingClientRect().top;
        e.preventDefault();
    });

    // Resize
    let resizing = false, resDir = '', rsX, rsY, rsW, rsH, rsL, rsT;
    let cachedMinW, cachedMinH, cachedMaxW;
    document.querySelectorAll('.float-panel-resize').forEach(handle => {
        handle.addEventListener('mousedown', (e) => {
            resizing = true;
            resDir = handle.getAttribute('data-dir');
            rsX = e.clientX;
            rsY = e.clientY;
            const r = fp.getBoundingClientRect();
            rsW = r.width; rsH = r.height;
            rsL = r.left;  rsT = r.top;
            // Cache computed styles once at drag start
            const cs = getComputedStyle(fp);
            cachedMinW = parseInt(cs.minWidth);
            cachedMinH = parseInt(cs.minHeight);
            cachedMaxW = parseInt(cs.maxWidth);
            e.preventDefault();
            e.stopPropagation();
        });
    });

    window.addEventListener('mousemove', (e) => {
        if (dragging) {
            const newLeft = Math.max(0, Math.min(window.innerWidth - fp.offsetWidth, e.clientX - dx));
            const newTop  = Math.max(0, Math.min(window.innerHeight - fp.offsetHeight, e.clientY - dy));
            fp.style.left = newLeft + 'px';
            fp.style.top  = newTop  + 'px';
        }
        if (resizing) {
            const ddx = e.clientX - rsX;
            const ddy = e.clientY - rsY;

            if (resDir === 'r' || resDir === 'br') {
                const newW = Math.min(cachedMaxW, Math.max(cachedMinW, rsW + ddx));
                fp.style.width = Math.min(newW, window.innerWidth - rsL) + 'px';
            }
            if (resDir === 'bl') {
                const newW = Math.max(cachedMinW, rsW - ddx);
                const newL = rsL + (rsW - newW);
                if (newL >= 0) {
                    fp.style.width = newW + 'px';
                    fp.style.left  = newL + 'px';
                }
            }
            if (resDir === 'b' || resDir === 'br' || resDir === 'bl') {
                const newH = Math.max(cachedMinH, rsH + ddy);
                fp.style.height = Math.min(newH, window.innerHeight - rsT) + 'px';
            }
        }
    });

    window.addEventListener('mouseup', () => {
        dragging = false;
        resizing = false;
    });
})();

// === Bottom Tab Panel ===
(function initBottomTabPanel() {
    const panel = document.getElementById('bottom-tab-panel');
    const resizeBar = document.getElementById('btp-resize-bar');
    const closeBtn = document.getElementById('btp-close');
    if (!panel) return;

    // Tab switching
    document.querySelectorAll('.btp-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            const target = tab.getAttribute('data-tab');
            document.querySelectorAll('.btp-tab').forEach(t => t.classList.remove('active'));
            document.querySelectorAll('.btp-pane').forEach(p => p.classList.remove('active'));
            tab.classList.add('active');
            const pane = document.querySelector('.btp-pane[data-pane="' + target + '"]');
            if (pane) pane.classList.add('active');
        });
    });

    // Resize
    resizeBar.addEventListener('mousedown', (e) => {
        e.preventDefault();
        resizeBar.classList.add('dragging');
        const startY = e.clientY;
        const startH = panel.getBoundingClientRect().height;
        const minH = parseInt(getComputedStyle(panel).minHeight);
        const maxH = window.innerHeight * 0.7;

        const onMove = (ev) => {
            const newH = Math.max(minH, Math.min(maxH, startH - (ev.clientY - startY)));
            panel.style.height = newH + 'px';
            document.documentElement.style.setProperty('--tab-height', newH + 'px');
            if (typeof Q4Scene !== 'undefined' && Q4Scene.renderer) {
                Q4Scene.renderer.setSize(window.innerWidth, window.innerHeight);
            }
        };

        const onUp = () => {
            resizeBar.classList.remove('dragging');
            window.removeEventListener('mousemove', onMove);
            window.removeEventListener('mouseup', onUp);
        };

        window.addEventListener('mousemove', onMove);
        window.addEventListener('mouseup', onUp);
    });

    // Close
    closeBtn.addEventListener('click', () => {
        panel.style.display = 'none';
        document.documentElement.style.setProperty('--tab-height', '0px');
        if (typeof Q4Scene !== 'undefined' && Q4Scene.renderer) {
            Q4Scene.renderer.setSize(window.innerWidth, window.innerHeight);
        }
    });
})();

// === Debounced Resize Handler ===
(function initResize() {
    let resizeTimer;
    window.addEventListener('resize', () => {
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(() => {
            if (typeof Q4Scene !== 'undefined' && Q4Scene.renderer) {
                Q4Scene.renderer.setSize(window.innerWidth, window.innerHeight);
            }
        }, 100);
    }, { passive: true });
})();
