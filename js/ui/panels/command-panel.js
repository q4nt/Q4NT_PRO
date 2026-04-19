/* ==========================================================================
   Q4NT PRO - Draggable Command Panel
   ========================================================================== */

document.addEventListener('DOMContentLoaded', () => {
    try {
        const cmdPanel = document.querySelector('.panel-bottom');
        const cmdDragHandle = document.querySelector('.cmd-drag-handle');
        const uiContainer = document.getElementById('ui-container');

        if (cmdPanel && cmdDragHandle && uiContainer) {
            // Create drop zone
            const dockDropZone = document.createElement('div');
            dockDropZone.className = 'dock-drop-zone';
            uiContainer.appendChild(dockDropZone);

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
                const leftBoundary = 50;
                const rightBoundary = 50;
                const maxLeft = window.innerWidth - rightBoundary - panelW;
                const maxTop = window.innerHeight - panelH;
                const newLeft = Math.max(leftBoundary, Math.min(maxLeft, startLeft + dx));
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
            console.log('[Q4NT Panels] Command Panel initialized.');
        }
    } catch (error) {
        console.error('[Q4NT Panels] Command Panel init error:', error);
    }
});
