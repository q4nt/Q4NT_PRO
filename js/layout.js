/* ==========================================================================
   Q4NT PRO - Grid Layout & Workspace Split Divider System
   ========================================================================== */

(function initLayout() {
    const workspaceGrid = document.getElementById('workspace-grid');
    const gridLayoutBtn = document.querySelector('.grid-layout-btn');
    const layoutOptionsPanel = document.querySelector('.layout-options-panel');

    if (!workspaceGrid) return;

    // === Split Divider System ===
    function spawnDividers(layout) {
        workspaceGrid.querySelectorAll('.split-divider').forEach(d => d.remove());

        const hasX = ['vertical', 'quad', 'left-sidebar', 'right-sidebar'].includes(layout);
        const hasY = ['horizontal', 'quad'].includes(layout);

        function makeDivider(axis) {
            const div = document.createElement('div');
            div.className = 'split-divider split-divider-' + axis;
            const grip = document.createElement('div');
            grip.className = 'split-divider-grip';
            div.appendChild(grip);
            workspaceGrid.appendChild(div);

            div.addEventListener('mousedown', (e) => {
                e.preventDefault();
                e.stopPropagation();
                div.classList.add('dragging');
                workspaceGrid.classList.add('dragging');

                // Ensure pane labels
                workspaceGrid.querySelectorAll('.workspace-pane').forEach(pane => {
                    if (!pane.querySelector('.pane-dim-label')) {
                        const lbl = document.createElement('div');
                        lbl.className = 'pane-dim-label';
                        pane.appendChild(lbl);
                    }
                });

                function updateDimLabels() {
                    workspaceGrid.querySelectorAll('.workspace-pane').forEach(pane => {
                        const r = pane.getBoundingClientRect();
                        const lbl = pane.querySelector('.pane-dim-label');
                        if (lbl) {
                            lbl.textContent = Math.round(r.width) + ' x ' + Math.round(r.height);
                            lbl.classList.add('visible');
                        }
                    });
                }

                const onMove = (ev) => {
                    const rect = workspaceGrid.getBoundingClientRect();
                    if (axis === 'x') {
                        const pct = Math.max(5, Math.min(95, (ev.clientX - rect.left) / rect.width * 100));
                        workspaceGrid.style.setProperty('--split-x', pct + '%');
                    } else {
                        const pct = Math.max(5, Math.min(95, (ev.clientY - rect.top) / rect.height * 100));
                        workspaceGrid.style.setProperty('--split-y', pct + '%');
                    }
                    updateDimLabels();
                };

                const onUp = () => {
                    div.classList.remove('dragging');
                    workspaceGrid.classList.remove('dragging');
                    workspaceGrid.querySelectorAll('.pane-dim-label').forEach(l => l.classList.remove('visible'));
                    window.removeEventListener('mousemove', onMove);
                    window.removeEventListener('mouseup', onUp);
                };

                window.addEventListener('mousemove', onMove);
                window.addEventListener('mouseup', onUp);
            });
        }

        if (hasX) makeDivider('x');
        if (hasY) makeDivider('y');
    }

    // === Grid Layout Button ===
    if (gridLayoutBtn && layoutOptionsPanel) {
        gridLayoutBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            layoutOptionsPanel.classList.toggle('visible');
        });

        document.addEventListener('click', (e) => {
            if (!e.target.closest('.grid-layout-btn') && !e.target.closest('.layout-options-panel')) {
                layoutOptionsPanel.classList.remove('visible');
            }
        });

        // Handle Layout Selection
        document.querySelectorAll('.layout-option').forEach(opt => {
            opt.addEventListener('click', () => {
                const layout = opt.getAttribute('data-layout');
                const numPanes = parseInt(opt.getAttribute('data-panes'));

                // Set default splits
                if (layout === 'left-sidebar') workspaceGrid.style.setProperty('--split-x', '25%');
                else if (layout === 'right-sidebar') workspaceGrid.style.setProperty('--split-x', '75%');
                else workspaceGrid.style.setProperty('--split-x', '50%');
                workspaceGrid.style.setProperty('--split-y', '50%');

                workspaceGrid.className = 'workspace-grid layout-' + layout;
                workspaceGrid.innerHTML = '';

                const actualPanes = Math.max(1, numPanes);
                for (let i = 0; i < actualPanes; i++) {
                    const pane = document.createElement('div');
                    pane.className = 'workspace-pane';
                    workspaceGrid.appendChild(pane);
                }

                // Re-init views (from scene.js)
                if (typeof initViews === 'function') {
                    initViews(document.querySelectorAll('.workspace-pane'));
                }
                spawnDividers(layout);

                layoutOptionsPanel.classList.remove('visible');
            });
        });
    }
})();
