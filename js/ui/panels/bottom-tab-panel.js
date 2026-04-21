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
                    const wasActive = tab.classList.contains('active');
                    
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

                    // Toggle floating canvas drawer
                    const canvasDrawer = document.getElementById('canvas-drawer');
                    if (canvasDrawer) {
                        if (target === 'canvas') {
                            canvasDrawer.classList.toggle('visible');
                        } else {
                            canvasDrawer.classList.remove('visible');
                        }
                    }

                    // Handle Home sub-tabs collapse logic
                    const homeSubTabs = ['row2-home', 'row2-relevant', 'row2-trending', 'row2-recent', 'row2-images', 'row2-other'];
                    const homeSubContainer = document.getElementById('home-sub-tabs');
                    if (homeSubContainer) {
                        if (target === 'row2-home' && wasActive) {
                            // Toggle sub-tabs if Home is clicked while already active
                            homeSubContainer.style.display = homeSubContainer.style.display === 'none' ? 'flex' : 'none';
                        } else if (target && target.startsWith('row2-')) {
                            if (homeSubTabs.includes(target)) {
                                homeSubContainer.style.display = 'flex';
                            } else {
                                homeSubContainer.style.display = 'none';
                            }
                        }
                    }

                    // Handle Themes sub-tabs collapse logic
                    const themesSubTabs = ['row2-themes-and-skins', 'row2-themes', 'row2-skins', 'row2-custom'];
                    const themesSubContainer = document.getElementById('themes-sub-tabs');
                    if (themesSubContainer) {
                        if (target === 'row2-themes-and-skins' && wasActive) {
                            themesSubContainer.style.display = themesSubContainer.style.display === 'none' ? 'flex' : 'none';
                        } else if (target && target.startsWith('row2-')) {
                            if (themesSubTabs.includes(target)) {
                                themesSubContainer.style.display = 'flex';
                            } else {
                                themesSubContainer.style.display = 'none';
                            }
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

                const cDrawer = document.getElementById('canvas-drawer');
                if (cDrawer && cDrawer.classList.contains('visible')) {
                    if (!cDrawer.contains(e.target) && !e.target.closest('.btp-tab[data-tab="canvas"]')) {
                        cDrawer.classList.remove('visible');
                    }
                }
            });

            // Tab Expand/Collapse (Add Widget button)
            const expandBtn = document.getElementById('add-widget-btn');
            
            // Helper to toggle add-widget-btn icon
            const updateAddWidgetIcon = (isExpanded) => {
                if (expandBtn) {
                    const iconPath = expandBtn.querySelector('svg path');
                    if (iconPath) {
                        if (isExpanded) {
                            iconPath.setAttribute('d', 'M5 12h14'); // minus
                        } else {
                            iconPath.setAttribute('d', 'M12 5v14M5 12h14'); // plus
                        }
                    }
                }
            };

            if (expandBtn) {
                expandBtn.addEventListener('click', () => {
                    panel.classList.toggle('expanded-tabs');
                    const isExpanded = panel.classList.contains('expanded-tabs');
                    updateAddWidgetIcon(isExpanded);
                    
                    // Show or hide row 2 directly to bypass CSS caching
                    if (isExpanded) {
                        const row2 = document.getElementById('btp-tab-strip-2');
                        if (row2) row2.style.display = 'flex';
                        
                        // Auto-select Home tab when expanding via Add Widget
                        const homeTab = document.querySelector('.btp-tab[data-tab="row2-home"]');
                        if (homeTab) homeTab.click();
                        
                        // Adjust height if necessary
                        const currentHeight = panel.getBoundingClientRect().height;
                        if (currentHeight < 300) {
                            panel.style.height = '300px';
                            document.documentElement.style.setProperty('--tab-height', '300px');
                        }
                    } else {
                        // Hide row 2 directly
                        const row2 = document.getElementById('btp-tab-strip-2');
                        if (row2) row2.style.display = 'none';
                        
                        // Reduce height back to 37px if it was just fitting the expanded tabs
                        const currentHeight = panel.getBoundingClientRect().height;
                        if (currentHeight <= 300) {
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

            // Market Research drawer item click -> open watchlist pane (no row 2)
            const bindDrawerItemClicks = () => {
                const drawers = [
                    document.getElementById('watchlist-drawer'),
                    document.getElementById('float-panel')
                ];
                drawers.forEach(drawer => {
                    if (!drawer) return;
                    drawer.addEventListener('click', (e) => {
                        const item = e.target.closest('.mr-item');
                        if (!item) return;

                        // Call the updateWatchlist method
                        const labelEl = item.querySelector('.mr-label');
                        if (labelEl && typeof TabWatchlist !== 'undefined' && TabWatchlist.updateWatchlist) {
                            TabWatchlist.updateWatchlist(labelEl.innerText);
                        }

                        // 1. Activate watchlist tab
                        document.querySelectorAll('.btp-tab').forEach(t => t.classList.remove('active'));
                        document.querySelectorAll('.btp-pane').forEach(p => p.classList.remove('active'));
                        const watchlistTab = document.querySelector('.btp-tab[data-tab="watchlist"]');
                        const watchlistPane = document.querySelector('.btp-pane[data-pane="watchlist"]');
                        if (watchlistTab) watchlistTab.classList.add('active');
                        if (watchlistPane) watchlistPane.classList.add('active');

                        // 2. Hide row 2 tabs — this should NOT be a dashboard-style view
                        const row2 = document.getElementById('btp-tab-strip-2');
                        if (row2) row2.style.display = 'none';
                        panel.classList.remove('expanded-tabs');
                        updateAddWidgetIcon(false);

                        // 3. Expand panel to show content
                        const currentHeight = panel.getBoundingClientRect().height;
                        if (currentHeight < 200) {
                            panel.style.height = '300px';
                            document.documentElement.style.setProperty('--tab-height', '300px');
                        }

                        // 4. Close the drawer
                        drawer.classList.remove('visible');
                        if (drawer.id === 'float-panel') {
                            drawer.style.display = 'none';
                        }

                        // 5. Resize renderer
                        if (typeof Q4Scene !== 'undefined' && Q4Scene.renderer) {
                            setTimeout(() => {
                                Q4Scene.renderer.setSize(window.innerWidth, window.innerHeight);
                            }, 250);
                        }
                    });
                });
            };
            bindDrawerItemClicks();
            
            // Minimize button handler
            const minimizeBtn = document.getElementById('btp-minimize-btn');
            if (minimizeBtn) {
                minimizeBtn.addEventListener('click', () => {
                    panel.classList.remove('expanded-tabs');
                    updateAddWidgetIcon(false);
                    const row2 = document.getElementById('btp-tab-strip-2');
                    if (row2) row2.style.display = 'none';
                    
                    // Reset to default height
                    panel.style.height = '37px';
                    document.documentElement.style.setProperty('--tab-height', '37px');
                    
                    if (typeof Q4Scene !== 'undefined' && Q4Scene.renderer) {
                        setTimeout(() => {
                            Q4Scene.renderer.setSize(window.innerWidth, window.innerHeight);
                        }, 250);
                    }
                });
            }

            // Resize
            resizeBar.addEventListener('mousedown', (e) => {
                e.preventDefault();
                resizeBar.classList.add('dragging');
                panel.classList.add('dragging'); // Disable CSS transitions during drag
                
                const startY = e.clientY;
                const startH = panel.getBoundingClientRect().height;
                const minH = parseInt(getComputedStyle(panel).minHeight) || 37;
                const maxH = window.innerHeight * 0.9;
                
                let rafId = null;
                let lastRendererUpdate = 0;

                const onMove = (ev) => {
                    if (rafId) return;
                    
                    rafId = requestAnimationFrame(() => {
                        const newH = Math.max(minH, Math.min(maxH, startH - (ev.clientY - startY)));
                        panel.style.height = newH + 'px';
                        document.documentElement.style.setProperty('--tab-height', newH + 'px');
                        
                        // Throttle renderer update (expensive)
                        const now = Date.now();
                        if (now - lastRendererUpdate > 50) { // Max 20fps for heavy 3D resize
                            if (typeof Q4Scene !== 'undefined' && Q4Scene.renderer) {
                                Q4Scene.renderer.setSize(window.innerWidth, window.innerHeight);
                            }
                            lastRendererUpdate = now;
                        }
                        rafId = null;
                    });
                };

                const onUp = () => {
                    resizeBar.classList.remove('dragging');
                    panel.classList.remove('dragging');
                    if (rafId) cancelAnimationFrame(rafId);
                    
                    // Final precise renderer sync
                    if (typeof Q4Scene !== 'undefined' && Q4Scene.renderer) {
                        Q4Scene.renderer.setSize(window.innerWidth, window.innerHeight);
                    }
                    
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
