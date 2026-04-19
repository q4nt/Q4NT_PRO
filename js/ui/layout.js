/* ==========================================================================
   Q4NT PRO - Grid Layout & Workspace Split Divider System
   ========================================================================== */

document.addEventListener('DOMContentLoaded', () => {
    try {
        const workspaceGrid = document.getElementById('workspace-grid');
        const gridLayoutBtn = document.querySelector('.grid-layout-btn');
        const layoutOptionsPanel = document.querySelector('.layout-options-panel');

        if (!workspaceGrid) {
            console.warn('[Q4NT Layout] Workspace grid not found.');
            return;
        }

        // === Split Divider System ===
        function spawnDividers(layout) {
            try {
                workspaceGrid.querySelectorAll('.split-divider').forEach(d => d.remove());

                const hasX = ['vertical', 'quad', 'left-sidebar', 'right-sidebar', 'triple-h', 'grid-6h', 'grid-6v', 'grid-9', 'dash-top', 'dash-bottom', 'dash-left', 'dash-right', 'golden-h', 'quad-h', '5-grid'].includes(layout);
                const hasY = ['horizontal', 'quad', 'triple-v', 'grid-6h', 'grid-6v', 'grid-9', 'dash-top', 'dash-bottom', 'dash-left', 'dash-right', 'golden-v', 'quad-v', '5-grid'].includes(layout);

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
            } catch (err) {
                console.error('[Q4NT Layout] Error spawning dividers:', err);
            }
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
                    const numPanes = parseInt(opt.getAttribute('data-panes')) || 1;

                    // Set default splits
                    if (layout === 'left-sidebar') workspaceGrid.style.setProperty('--split-x', '25%');
                    else if (layout === 'right-sidebar') workspaceGrid.style.setProperty('--split-x', '75%');
                    else workspaceGrid.style.setProperty('--split-x', '50%');
                    workspaceGrid.style.setProperty('--split-y', '50%');

                    workspaceGrid.className = 'workspace-grid layout-' + layout;
                    workspaceGrid.innerHTML = '';

                    // Update grid layout button icon to reflect selection
                    const getLayoutSVG = (lyt) => {
                        if (lyt === 'single') return '<rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>';
                        if (lyt === 'horizontal') return '<rect x="3" y="3" width="18" height="8" rx="1" ry="1"></rect><rect x="3" y="13" width="18" height="8" rx="1" ry="1"></rect>';
                        if (lyt === 'vertical') return '<rect x="3" y="3" width="8" height="18" rx="1" ry="1"></rect><rect x="13" y="3" width="8" height="18" rx="1" ry="1"></rect>';
                        if (lyt === 'left-sidebar') return '<rect x="3" y="3" width="5" height="18" rx="1" ry="1"></rect><rect x="10" y="3" width="11" height="18" rx="1" ry="1"></rect>';
                        if (lyt === 'right-sidebar') return '<rect x="3" y="3" width="11" height="18" rx="1" ry="1"></rect><rect x="16" y="3" width="5" height="18" rx="1" ry="1"></rect>';
                        if (lyt === 'triple-h') return '<rect x="3" y="3" width="5" height="18" rx="1" ry="1"></rect><rect x="9.5" y="3" width="5" height="18" rx="1" ry="1"></rect><rect x="16" y="3" width="5" height="18" rx="1" ry="1"></rect>';
                        if (lyt === 'triple-v') return '<rect x="3" y="3" width="18" height="5" rx="1" ry="1"></rect><rect x="3" y="9.5" width="18" height="5" rx="1" ry="1"></rect><rect x="3" y="16" width="18" height="5" rx="1" ry="1"></rect>';
                        return '<rect x="3" y="3" width="8" height="8" rx="1" ry="1"></rect><rect x="13" y="3" width="8" height="8" rx="1" ry="1"></rect><rect x="13" y="13" width="8" height="8" rx="1" ry="1"></rect><rect x="3" y="13" width="8" height="8" rx="1" ry="1"></rect>';
                    };
                    const svgElem = gridLayoutBtn.querySelector('svg');
                    if (svgElem) svgElem.innerHTML = getLayoutSVG(layout);

                    const actualPanes = Math.max(1, numPanes);
                    for (let i = 0; i < actualPanes; i++) {
                        const pane = document.createElement('div');
                        pane.className = 'workspace-pane';
                        workspaceGrid.appendChild(pane);
                    }

                    // Re-init views (from scene.js)
                    if (typeof initViews === 'function') {
                        initViews(document.querySelectorAll('.workspace-pane'));
                    } else {
                        console.warn('[Q4NT Layout] initViews function is not globally defined.');
                    }
                    
                    spawnDividers(layout);
                    layoutOptionsPanel.classList.remove('visible');
                });
            });
            console.log('[Q4NT Layout] Layout system initialized.');
        } else {
            console.warn('[Q4NT Layout] Layout button or options panel not found.');
        }
    } catch (error) {
        console.error('[Q4NT Layout] Critical layout initialization error:', error);
    }
});
