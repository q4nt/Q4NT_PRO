/* ==========================================================================
   Q4NT PRO - Bottom Tab Panel Logic
   ========================================================================== */

document.addEventListener('DOMContentLoaded', () => {
    try {
        const panel = document.getElementById('bottom-tab-panel');
        const resizeBar = document.getElementById('btp-resize-bar');
        
        if (panel && resizeBar) {
            // Tab switching
            document.querySelectorAll('.btp-tab').forEach(tab => {
                tab.addEventListener('click', () => {
                    const target = tab.getAttribute('data-tab');
                    document.querySelectorAll('.btp-tab').forEach(t => t.classList.remove('active'));
                    document.querySelectorAll('.btp-pane').forEach(p => p.classList.remove('active'));
                    tab.classList.add('active');
                    const pane = document.querySelector('.btp-pane[data-pane="' + target + '"]');
                    if (pane) pane.classList.add('active');

                    // Toggle floating watchlist drawer
                    const drawer = document.getElementById('watchlist-drawer');
                    if (drawer) {
                        if (target === 'watchlist') {
                            drawer.classList.toggle('visible');
                        } else {
                            drawer.classList.remove('visible');
                        }
                    }
                });
            });

            // Close drawer on clicking outside
            document.addEventListener('mousedown', (e) => {
                const drawer = document.getElementById('watchlist-drawer');
                if (drawer && drawer.classList.contains('visible')) {
                    if (!drawer.contains(e.target) && !e.target.closest('.btp-tab[data-tab="watchlist"]')) {
                        drawer.classList.remove('visible');
                    }
                }
            });

            // Tab Expand/Collapse
            const expandBtn = document.getElementById('add-widget-btn');
            if (expandBtn) {
                expandBtn.addEventListener('click', () => {
                    panel.classList.toggle('expanded-tabs');
                    const isExpanded = panel.classList.contains('expanded-tabs');
                    
                    // Show or hide row 2 directly to bypass CSS caching
                    if (isExpanded) {
                        const row2 = document.getElementById('btp-tab-strip-2');
                        if (row2) row2.style.display = 'flex';
                        
                        // Adjust height if necessary
                        const currentHeight = panel.getBoundingClientRect().height;
                        if (currentHeight < 250) {
                            panel.style.height = '250px';
                            document.documentElement.style.setProperty('--tab-height', '250px');
                        }
                    } else {
                        // Hide row 2 directly
                        const row2 = document.getElementById('btp-tab-strip-2');
                        if (row2) row2.style.display = 'none';
                        
                        // Reduce height back to 37px if it was just fitting the expanded tabs
                        const currentHeight = panel.getBoundingClientRect().height;
                        if (currentHeight <= 250) {
                            panel.style.height = '37px';
                            document.documentElement.style.setProperty('--tab-height', '37px');
                        }
                    }
                    
                    if (typeof Q4Scene !== 'undefined' && Q4Scene.renderer) {
                        setTimeout(() => {
                            Q4Scene.renderer.setSize(window.innerWidth, window.innerHeight);
                        }, 250); // wait for transition
                    }
                });
            }

            // Resize
            resizeBar.addEventListener('mousedown', (e) => {
                e.preventDefault();
                resizeBar.classList.add('dragging');
                const startY = e.clientY;
                const startH = panel.getBoundingClientRect().height;
                const minH = parseInt(getComputedStyle(panel).minHeight) || 0;
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

            console.log('[Q4NT Panels] Bottom Tab Panel initialized.');
        }
    } catch (error) {
        console.error('[Q4NT Panels] Bottom Tab Panel init error:', error);
    }

    // === Debounced Resize Handler ===
    try {
        let resizeTimer;
        window.addEventListener('resize', () => {
            clearTimeout(resizeTimer);
            resizeTimer = setTimeout(() => {
                if (typeof Q4Scene !== 'undefined' && Q4Scene.renderer) {
                    Q4Scene.renderer.setSize(window.innerWidth, window.innerHeight);
                }
            }, 100);
        }, { passive: true });
        console.log('[Q4NT Panels] Resize handler initialized.');
    } catch (error) {
        console.error('[Q4NT Panels] Resize handler error:', error);
    }
});
