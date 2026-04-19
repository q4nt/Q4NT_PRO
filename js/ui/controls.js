/* ==========================================================================
   Q4NT PRO - User Controls & Panel Interactions
   ========================================================================== */

document.addEventListener('DOMContentLoaded', () => {
    try {
        console.log('[Q4NT Controls] Initializing user controls...');

        // === Panel Double-Click Lock ===
        const toggleSidePanel = (side) => {
            const tb = document.querySelector(`.toolbar-${side}`);
            const edge = document.querySelector(`.ai-edge-${side}`);
            const rect = document.querySelector(`.layout-bg-${side}`);
            if (!tb || !edge) return;
            
            const isExpanded = tb.classList.contains('locked') || tb.classList.contains('visible') || 
                               edge.classList.contains('locked') || edge.classList.contains('visible');
                               
            if (isExpanded) {
                tb.classList.remove('locked', 'visible');
                edge.classList.remove('locked', 'visible');
                if (rect) rect.style.fill = 'transparent';
            } else {
                tb.classList.add('locked');
                edge.classList.add('locked');
                if (rect) rect.style.fill = '#00f2fe';
            }
        };

        document.querySelectorAll('.beveled-panel').forEach(panel => {
            panel.addEventListener('dblclick', () => {
                if (panel.classList.contains('toolbar-left')) {
                    toggleSidePanel('left');
                } else if (panel.classList.contains('toolbar-right')) {
                    toggleSidePanel('right');
                } else {
                    panel.classList.toggle('locked');
                }
            });
        });

        // Forward double-clicks from edge triggers
        document.querySelector('.trigger-top')?.addEventListener('dblclick', () => {
            document.querySelector('.panel-top')?.classList.toggle('locked');
        });

        document.querySelector('.ai-edge-left')?.addEventListener('dblclick', (e) => {
            if (e.target.closest('.vertical-icon') || e.target.closest('.edge-btn')) return;
            toggleSidePanel('left');
        });

        document.querySelector('.ai-edge-right')?.addEventListener('dblclick', (e) => {
            if (e.target.closest('.vertical-icon') || e.target.closest('.edge-btn') || 
                e.target.closest('.right-bottom-tools') || e.target.closest('.right-top-tools')) return;
            toggleSidePanel('right');
        });

        // === Edge Panel Hover Sync ===
        const bindHoverSync = (sourceSelector, targetSelector) => {
            const source = document.querySelector(sourceSelector);
            const target = document.querySelector(targetSelector);
            if (!source || !target) return;
            
            source.addEventListener('mouseenter', () => target.classList.add('hovered'));
            source.addEventListener('mouseleave', () => target.classList.remove('hovered'));
        };

        bindHoverSync('.toolbar-left', '.ai-edge-left');
        bindHoverSync('.toolbar-right', '.ai-edge-right');

        // === Top Panel Plus/Minus ===
        const plusBtn = document.querySelector('.plus-btn');
        const minusBtn = document.querySelector('.minus-btn');
        if (plusBtn && minusBtn) {
            plusBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                minusBtn.classList.add('visible');
            });
            minusBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                minusBtn.classList.remove('visible');
            });
        }

        // === Right Top Plus Button (Extend Tab Bar) ===
        const rightPlusBtn = document.querySelector('.right-plus-btn');
        if (rightPlusBtn) {
            rightPlusBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                const panel = document.getElementById('bottom-tab-panel');
                if (panel) {
                    panel.style.display = 'block';
                    const currentH = parseInt(getComputedStyle(panel).height) || 0;
                    const targetH = window.innerHeight * 0.5;
                    let newH = targetH;
                    
                    if (Math.abs(currentH - targetH) < 10) {
                        newH = 37;
                    }
                    
                    panel.style.height = newH + 'px';
                    panel.style.transition = 'height 0.3s ease';
                    document.documentElement.style.setProperty('--tab-height', newH + 'px');
                    
                    setTimeout(() => {
                        panel.style.transition = '';
                        if (typeof Q4Scene !== 'undefined' && Q4Scene.renderer) {
                            Q4Scene.renderer.setSize(window.innerWidth, window.innerHeight);
                        }
                    }, 300);
                }
            });
        }

        // === 3D Cube Button (Right Panel) ===
        const rightCubeBtn = document.querySelector('.right-cube-btn');
        if (rightCubeBtn) {
            rightCubeBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                if (typeof Q4Scene !== 'undefined' && Q4Scene.bgGroup) {
                    Q4Scene.bgGroup.visible = !Q4Scene.bgGroup.visible;
                }
            });
        }

        // === Generic Command Panel Expander ===
        const toggleCmdPanel = (targetClass, btnEl) => {
            const cmdPanel = document.querySelector('.panel-bottom');
            if (!cmdPanel) return;

            const isExpanding = !cmdPanel.classList.contains(targetClass);
            const allStates = ['community-expanded', 'qa-expanded', 'openai-expanded', 'detect-expanded'];
            
            // If another state is active, we don't animate height, just swap class
            const isAnyExpanded = allStates.some(cls => cmdPanel.classList.contains(cls));

            allStates.forEach(cls => cmdPanel.classList.remove(cls));
            
            const btns = [document.querySelector('.community-btn'), document.querySelector('.right-openai-btn'), document.querySelector('.right-detect-btn')];
            btns.forEach(b => { if (b) b.classList.remove('active'); });

            const rect = cmdPanel.getBoundingClientRect();
            const collapsedH = 100;
            const expandedH  = 380;

            if (isExpanding) {
                if (!isAnyExpanded) {
                    const newTop = rect.top - (expandedH - rect.height);
                    cmdPanel.style.height = expandedH + 'px';
                    cmdPanel.style.top    = newTop + 'px';
                    cmdPanel.style.bottom = 'auto';
                }
                cmdPanel.classList.add(targetClass);
                if (btnEl) btnEl.classList.add('active');
            } else {
                const newTop = rect.top + (rect.height - collapsedH);
                cmdPanel.style.height = '';
                cmdPanel.style.top    = newTop + 'px';
                cmdPanel.style.bottom = 'auto';
            }
        };

        const communityBtn = document.querySelector('.community-btn');
        if (communityBtn) {
            communityBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                toggleCmdPanel('community-expanded', communityBtn);
            });
        }

        const openaiBtn = document.querySelector('.right-openai-btn');
        if (openaiBtn) {
            openaiBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                toggleCmdPanel('openai-expanded', openaiBtn);
            });
        }

        const detectBtn = document.querySelector('.right-detect-btn');
        if (detectBtn) {
            detectBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                toggleCmdPanel('detect-expanded', detectBtn);
            });
        }

        // === Channel Tabs ===
        document.querySelectorAll('.channel-tab').forEach(tab => {
            tab.addEventListener('click', (e) => {
                e.stopPropagation();
                const channel = tab.dataset.channel;

                // Switch active tab
                document.querySelectorAll('.channel-tab').forEach(t => t.classList.remove('active'));
                tab.classList.add('active');

                // Switch active message pane
                document.querySelectorAll('.community-messages-container').forEach(pane => {
                    pane.classList.toggle('active', pane.dataset.pane === channel);
                });
            });
        });

        // === Group Switcher Dropdown ===
        const groupSwitcher = document.getElementById('group-switcher');
        const groupDropdown = document.getElementById('group-dropdown');

        if (groupSwitcher && groupDropdown) {
            groupSwitcher.addEventListener('click', (e) => {
                e.stopPropagation();
                const isOpen = groupDropdown.classList.toggle('open');
                groupSwitcher.classList.toggle('open', isOpen);
            });

            groupDropdown.querySelectorAll('.group-option').forEach(option => {
                option.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const groupName = option.dataset.group;

                    // Update active state
                    groupDropdown.querySelectorAll('.group-option').forEach(o => o.classList.remove('active'));
                    option.classList.add('active');

                    // Update button label
                    const nameEl = groupSwitcher.querySelector('.group-name');
                    if (nameEl) nameEl.textContent = groupName;

                    // Close dropdown
                    groupDropdown.classList.remove('open');
                    groupSwitcher.classList.remove('open');
                });
            });

            // Close dropdown when clicking outside
            document.addEventListener('click', () => {
                groupDropdown.classList.remove('open');
                groupSwitcher.classList.remove('open');
            });
        }

        // === Global View Toggle (Cube) ===
        const globalViewToggle = document.getElementById('global-view-toggle');
        if (globalViewToggle) {
            globalViewToggle.addEventListener('click', (e) => {
                e.stopPropagation();
                globalViewToggle.classList.toggle('mode-2d');
            });
        }

        // === Layout Toggle Button (4-state toolbar cycle) ===
        const layoutBtn = document.querySelector('.layout-btn');
        if (layoutBtn) {
            const toolbarLeft = document.querySelector('.toolbar-left');
            const toolbarRight = document.querySelector('.toolbar-right');
            const rectLeft = layoutBtn.querySelector('.layout-bg-left');
            const rectRight = layoutBtn.querySelector('.layout-bg-right');

            let layoutState = 0;
            let layoutHoldTimer;
            let layoutIsHolding = false;

            const applyLayoutState = () => {
                const edgeL = document.querySelector('.ai-edge-left');
                const edgeR = document.querySelector('.ai-edge-right');

                // Helper to toggle visibility classes and fill colors safely
                const setSideState = (tb, edge, isVisible, rect) => {
                    if (tb) tb.classList.toggle('visible', isVisible);
                    if (edge) edge.classList.toggle('visible', isVisible);
                    if (rect) rect.style.fill = isVisible ? '#00f2fe' : 'transparent';
                };

                if (layoutState === 0) {
                    setSideState(toolbarLeft, edgeL, false, rectLeft);
                    setSideState(toolbarRight, edgeR, false, rectRight);
                } else if (layoutState === 1) {
                    setSideState(toolbarLeft, edgeL, true, rectLeft);
                    setSideState(toolbarRight, edgeR, true, rectRight);
                } else if (layoutState === 2) {
                    setSideState(toolbarLeft, edgeL, true, rectLeft);
                    setSideState(toolbarRight, edgeR, false, rectRight);
                } else if (layoutState === 3) {
                    setSideState(toolbarLeft, edgeL, false, rectLeft);
                    setSideState(toolbarRight, edgeR, true, rectRight);
                }
            };

            layoutBtn.addEventListener('mousedown', () => {
                layoutIsHolding = false;
                layoutHoldTimer = setTimeout(() => {
                    layoutIsHolding = true;
                    layoutState = 0;
                    applyLayoutState();
                }, 500);
            });

            layoutBtn.addEventListener('mouseup', () => {
                clearTimeout(layoutHoldTimer);
                if (!layoutIsHolding) {
                    layoutState = (layoutState + 1) % 4;
                    applyLayoutState();
                }
            });

            layoutBtn.addEventListener('mouseleave', () => {
                clearTimeout(layoutHoldTimer);
            });
        }
        
        console.log('[Q4NT Controls] Initialization successful.');
    } catch (error) {
        console.error('[Q4NT Controls] Error during initialization:', error);
    }
});
