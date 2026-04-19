/**
 * command-processor.js
 * 
 * Handles UI interactions for the command panel, sending inputs to the main server
 * to be processed by the orchestrator, validator, and regex agents.
 * 
 * v2.0 - Dynamic API origin, feedback UI with suggestion chips,
 *         navigate_view support, and toggle_panel / opacity intents.
 */

document.addEventListener('DOMContentLoaded', () => {
    const promptInput = document.querySelector('.prompt-input');
    const sendBtn = document.querySelector('.send-btn');
    const messagesContainer = document.querySelector('.community-messages-container');

    // Dynamic origin for multi-instance support (no hardcoded localhost)
    const API_ORIGIN = window.location.origin.includes('file://')
        ? 'http://localhost:8000'
        : window.location.origin;

    if (!promptInput || !sendBtn) {
        console.warn('Command Processor: Could not find prompt input or send button.');
        return;
    }

    // ------------------------------------------------------------------
    // Message Rendering
    // ------------------------------------------------------------------
    const appendMessageToUI = (entry) => {
        if (!messagesContainer) return;

        const msgDiv = document.createElement('div');
        msgDiv.className = 'community-message';

        const dateObj = new Date(entry.timestamp);
        const timeString = isNaN(dateObj) ? 'Just now' : dateObj.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

        msgDiv.innerHTML = `
            <img class="cm-avatar" src="https://ui-avatars.com/api/?name=You&background=007AFF&color=fff" alt="Avatar">
            <div class="cm-content">
                <div class="cm-header"><span class="cm-name">You</span><span class="cm-time">${timeString}</span></div>
                <div class="cm-text">${entry.command}</div>
            </div>
        `;
        messagesContainer.appendChild(msgDiv);
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
    };

    const renderCommandHistory = async () => {
        if (!messagesContainer) return;
        try {
            const response = await fetch(`${API_ORIGIN}/api/command/history`);
            if (!response.ok) throw new Error(`History error: ${response.status}`);
            const history = await response.json();
            messagesContainer.innerHTML = '';
            history.forEach(appendMessageToUI);
        } catch (error) {
            console.error('Failed to load command history:', error);
        }
    };

    // Load history initially
    renderCommandHistory();

    // ------------------------------------------------------------------
    // Feedback / System Messages
    // ------------------------------------------------------------------
    const showFeedbackMessage = (message, suggestions) => {
        if (!messagesContainer) return;

        const msgDiv = document.createElement('div');
        msgDiv.className = 'community-message system-feedback';

        const suggestionsHTML = suggestions && suggestions.length
            ? `<div class="cm-suggestions">${suggestions.map(s =>
                `<button class="suggestion-chip">${s}</button>`
            ).join('')}</div>`
            : '';

        msgDiv.innerHTML = `
            <img class="cm-avatar" src="https://ui-avatars.com/api/?name=Q4&background=6c5ce7&color=fff" alt="System">
            <div class="cm-content">
                <div class="cm-header"><span class="cm-name" style="color:#6c5ce7;">Q4NT</span><span class="cm-time">Just now</span></div>
                <div class="cm-text">${message}</div>
                ${suggestionsHTML}
            </div>
        `;
        messagesContainer.appendChild(msgDiv);
        messagesContainer.scrollTop = messagesContainer.scrollHeight;

        // Make suggestion chips clickable
        msgDiv.querySelectorAll('.suggestion-chip').forEach(chip => {
            chip.addEventListener('click', () => {
                promptInput.value = chip.textContent;
                processCommand();
            });
        });
    };

    const showSuccessMessage = (text) => {
        if (!messagesContainer) return;
        const msgDiv = document.createElement('div');
        msgDiv.className = 'community-message system-success';
        msgDiv.innerHTML = `
            <img class="cm-avatar" src="https://ui-avatars.com/api/?name=Q4&background=00b894&color=fff" alt="System">
            <div class="cm-content">
                <div class="cm-header"><span class="cm-name" style="color:#00b894;">Q4NT</span><span class="cm-time">Just now</span></div>
                <div class="cm-text">${text}</div>
            </div>
        `;
        messagesContainer.appendChild(msgDiv);
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
    };

    // ------------------------------------------------------------------
    // Command Processing
    // ------------------------------------------------------------------
    const processCommand = async () => {
        const commandText = promptInput.value.trim();
        if (!commandText) return;

        // Clear input early for better UX
        promptInput.value = '';
        console.log(`Sending command to orchestrator: ${commandText}`);

        let thinkingIndicator = null;
        let qaStatusPanel = null;
        const isQuestion = commandText.endsWith('?') || /^(what|how|why|when|who|where|can|could|should|would|is|are|do|does)\b/i.test(commandText);

        if (isQuestion) {
            qaStatusPanel = document.createElement('div');
            qaStatusPanel.className = 'qa-status-panel';
            qaStatusPanel.innerHTML = `<span class="qa-spinner" style="display:inline-block;width:12px;height:12px;border:2px solid #fff;border-top-color:transparent;border-radius:50%;animation:spin 1s linear infinite;"></span> Agent is getting your answer...`;
            
            if (!document.getElementById('qa-spinner-style')) {
                const style = document.createElement('style');
                style.id = 'qa-spinner-style';
                style.innerHTML = `@keyframes spin { to { transform: rotate(360deg); } }`;
                document.head.appendChild(style);
            }
            
            const panelBottom = document.querySelector('.panel-bottom');
            if (panelBottom) {
                panelBottom.appendChild(qaStatusPanel);
            }
        } else {
            if (messagesContainer) {
                thinkingIndicator = document.createElement('div');
                thinkingIndicator.className = 'community-message system-thinking';
                thinkingIndicator.innerHTML = `
                    <img class="cm-avatar" src="https://ui-avatars.com/api/?name=Q4&background=6c5ce7&color=fff" alt="System">
                    <div class="cm-content">
                        <div class="cm-header"><span class="cm-name" style="color:#6c5ce7;">Q4NT</span></div>
                        <div class="cm-text"><i>Thinking...</i></div>
                    </div>
                `;
                messagesContainer.appendChild(thinkingIndicator);
                messagesContainer.scrollTop = messagesContainer.scrollHeight;
            }
        }

        const buildDeepContext = () => {
            const getRGBAsHex = (rgb) => {
                if (!rgb) return 'N/A';
                const match = rgb.match(/^rgba?\((\d+),\s*(\d+),\s*(\d+)/);
                if (!match) return rgb;
                const r = parseInt(match[1]).toString(16).padStart(2, '0');
                const g = parseInt(match[2]).toString(16).padStart(2, '0');
                const b = parseInt(match[3]).toString(16).padStart(2, '0');
                return `#${r}${g}${b}`;
            };

            const extractPanelData = (el, type) => {
                const rect = el.getBoundingClientRect();
                const style = window.getComputedStyle(el);
                return {
                    id: el.id || 'N/A',
                    type: type,
                    classes: Array.from(el.classList).join(' '),
                    visible: el.style.display !== 'none' && rect.width > 0,
                    size: { width: Math.round(rect.width), height: Math.round(rect.height) },
                    position: { top: Math.round(rect.top), left: Math.round(rect.left) },
                    style: {
                        bgColor: getRGBAsHex(style.backgroundColor),
                        color: getRGBAsHex(style.color),
                        zIndex: style.zIndex,
                        opacity: style.opacity
                    },
                    textContent: (el.innerText || '').substring(0, 1500).replace(/\s+/g, ' ').trim()
                };
            };

            const uiPanels = [];
            document.querySelectorAll('.beveled-panel, .ai-edge-panel, .bottom-tab-panel, .float-panel, #spotifyPillBox').forEach(el => {
                uiPanels.push(extractPanelData(el, 'UIPanel'));
            });

            const activeTabs = [];
            document.querySelectorAll('.btp-tab.active').forEach(tab => {
                activeTabs.push(tab.textContent.trim());
            });

            const bgPanels = [];
            const bg3DPrimitives = [];
            if (typeof Q4Scene !== 'undefined' && Q4Scene.bgGroup) {
                Q4Scene.bgGroup.children.forEach((child, index) => {
                    if (child.userData) {
                        const matColor = child.material && child.material.color ? '#' + child.material.color.getHexString() : 'unknown';
                        const objData = {
                            id: `bg_obj_${index}`,
                            type: child.geometry ? child.geometry.type : 'Unknown',
                            color: matColor,
                            visible: child.visible,
                            position: {
                                x: Math.round(child.position.x),
                                y: Math.round(child.position.y),
                                z: Math.round(child.position.z)
                            }
                        };
                        
                        if (child.userData._is3dObj) bg3DPrimitives.push(objData);
                        else if (child.userData._isPanel) bgPanels.push(objData);
                    }
                });
            }

            return {
                theme: document.body.className.match(/\b(\w+-theme)\b/)?.[1] || 'unknown',
                currentLayout: document.body.className.match(/\blayout-([\w-]+)\b/)?.[1] || 'single',
                activeViewIndex: typeof Q4Scene !== 'undefined' ? Q4Scene.activeBackgroundIndex : null,
                activeTabs: activeTabs,
                uiPanels: uiPanels,
                backgroundPanels: bgPanels,
                background3DPrimitives: bg3DPrimitives,
                summary: {
                    totalUIPanels: uiPanels.length,
                    visibleUIPanels: uiPanels.filter(p => p.visible).length,
                    totalBgPanels: bgPanels.length,
                    totalBgPrimitives: bg3DPrimitives.length
                }
            };
        };

        const context = buildDeepContext();

        try {
            const response = await fetch(`${API_ORIGIN}/api/command`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ command: commandText, context: context })
            });

            if (thinkingIndicator) thinkingIndicator.remove();
            if (qaStatusPanel) qaStatusPanel.remove();

            if (!response.ok) {
                throw new Error(`Server error: ${response.status}`);
            }

            const data = await response.json();
            handleServerResponse(data, commandText);

            // Refresh history
            renderCommandHistory();
        } catch (error) {
            if (thinkingIndicator) thinkingIndicator.remove();
            if (qaStatusPanel) qaStatusPanel.remove();
            console.error('Command Processor Error:', error);
            showFeedbackMessage(
                `Connection error: Could not reach the server. Is it running on port 8000?`,
                null
            );
        }
    };

    // ------------------------------------------------------------------
    // UI Update Application
    // ------------------------------------------------------------------
    const applyUIUpdate = (details) => {
        const { intent, value } = details;
        switch (intent) {
            case 'change_theme':
                document.body.classList.remove('dark-theme', 'light-theme', 'blue-theme', 'green-theme');
                document.documentElement.classList.remove('dark-theme', 'light-theme', 'blue-theme', 'green-theme');
                if (['dark', 'light', 'blue', 'green'].includes(value)) {
                    document.body.classList.add(`${value}-theme`);
                    document.documentElement.classList.add(`${value}-theme`);
                }

                // Update renderer if Q4Scene is available
                if (typeof Q4Scene !== 'undefined' && Q4Scene.renderer && Q4Scene.scene) {
                    const themeColors = { dark: 0x050505, light: 0xf5f5f7, blue: 0x001122, green: 0x001a0d };
                    const hexColor = themeColors[value] || 0xf5f5f7;
                    Q4Scene.renderer.setClearColor(hexColor);
                    if (Q4Scene.scene.fog) {
                        Q4Scene.scene.fog.color.set(hexColor);
                    }
                }
                showSuccessMessage(`Theme switched to <strong>${value}</strong>.`);
                break;

            case 'change_theme_color':
                document.documentElement.style.setProperty('--primary-color', value);
                document.documentElement.style.setProperty('--ai-blue', value);
                document.documentElement.style.setProperty('--accent-glow', value);
                showSuccessMessage(`Accent color set to <strong>${value}</strong>.`);
                break;

            case 'change_font_color':
                document.documentElement.style.setProperty('--text-primary', value);
                document.body.style.color = value;
                showSuccessMessage(`Font color set to <strong>${value}</strong>.`);
                break;

            case 'change_font_size':
                document.documentElement.style.fontSize = value;
                document.body.style.fontSize = value;
                showSuccessMessage(`Font size set to <strong>${value}</strong>.`);
                break;

            case 'change_opacity': {
                const opacityValue = parseInt(value, 10) / 100;
                document.querySelectorAll('.ai-edge-panel, .bottom-tab-panel, .top-toolbar, .command-panel-container').forEach(el => {
                    el.style.opacity = opacityValue;
                });
                showSuccessMessage(`Panel opacity set to <strong>${value}%</strong>.`);
                break;
            }

            case 'remove_panel':
                applyPanelVisibility(value, 'none');
                showSuccessMessage(`<strong>${value}</strong> panel hidden.`);
                break;

            case 'restore_panel':
                applyPanelVisibility(value, '');
                showSuccessMessage(`<strong>${value}</strong> panel restored.`);
                break;

            case 'toggle_panel': {
                const panel = getPanelElement(value);
                if (panel) {
                    const isHidden = panel.style.display === 'none' || getComputedStyle(panel).display === 'none';
                    panel.style.display = isHidden ? '' : 'none';
                    showSuccessMessage(`<strong>${value}</strong> panel ${isHidden ? 'shown' : 'hidden'}.`);
                }
                break;
            }

            case 'arrange_panels': {
                const layoutOpt = document.querySelector(`.layout-option[data-layout="${value}"]`);
                if (layoutOpt) {
                    layoutOpt.click();
                    showSuccessMessage(`Layout changed to <strong>${value}</strong>.`);
                } else {
                    console.warn(`Layout option ${value} not found.`);
                }
                break;
            }

            case 'navigate_view': {
                const valueLower = value.toLowerCase();
                const match = valueLower.match(/^(v|view|view-)(\d+)$/);
                if (match) {
                    const idx = parseInt(match[2], 10) - 1;
                    if (idx >= 0 && idx < 20 && typeof setBackground === 'function') {
                        setBackground(idx);
                        showSuccessMessage(`Navigated to view <strong>${value}</strong>.`);
                        break;
                    }
                }

                const viewMap = {
                    'chart': '.nav-chart, [data-view="chart"]',
                    'map': '.nav-map, [data-view="map"]',
                    'globe': '.nav-globe, [data-view="globe"]',
                    'terrain': '.nav-terrain, [data-view="terrain"]',
                    'report': '.nav-report, [data-view="report"]',
                    'canvas': '.nav-canvas, [data-view="canvas"]',
                    'workspace': '.nav-workspace, [data-view="workspace"]',
                    'dashboard': '.nav-dashboard, [data-view="dashboard"]',
                    '3d': '.nav-3d, [data-view="3d"]',
                    'f1': '.btp-tab[data-tab="views-f1"]'
                };
                const selector = viewMap[valueLower];
                if (selector) {
                    const navBtn = document.querySelector(selector);
                    if (navBtn) {
                        navBtn.click();
                        showSuccessMessage(`Navigated to <strong>${value}</strong> view.`);
                    } else {
                        showFeedbackMessage(`View "${value}" navigation trigger not found in the DOM.`, null);
                    }
                } else if (!match) {
                     showFeedbackMessage(`View "${value}" is not a known alias.`, null);
                }
                break;
            }

            case 'toggle_3d_objects': {
                if (typeof Q4Scene !== 'undefined' && Q4Scene.bgGroup) {
                    const isVisible = (value !== 'hide');
                    let has3dObjects = false;
                    Q4Scene.bgGroup.children.forEach(child => {
                        if (child.userData && child.userData._is3dObj) {
                            child.visible = isVisible;
                            child.userData.isHiddenByUser = !isVisible;
                            has3dObjects = true;
                        }
                    });
                    
                    if (!has3dObjects) {
                        Q4Scene.bgGroup.visible = isVisible;
                    }
                    showSuccessMessage(`3D Objects ${isVisible ? 'shown' : 'hidden'}.`);
                } else {
                     showFeedbackMessage(`Cannot control 3D objects right now.`, null);
                }
                break;
            }

            case 'modify_bg_objects': {
                if (typeof Q4Scene !== 'undefined' && Q4Scene.bgGroup) {
                    const ids = details.target_ids || [];
                    const action = details.action;
                    let count = 0;
                    Q4Scene.bgGroup.children.forEach((child, index) => {
                        const childId = `bg_obj_${index}`;
                        if (ids.includes(childId)) {
                            count++;
                            if (action === 'hide') {
                                child.visible = false;
                                child.userData.isHiddenByUser = true;
                            } else if (action === 'show') {
                                child.visible = true;
                                child.userData.isHiddenByUser = false;
                            } else if (action === 'move' && details.target_position) {
                                if (details.target_position.x !== undefined) child.userData.targetX = details.target_position.x;
                                if (details.target_position.y !== undefined) child.userData.targetY = details.target_position.y;
                                if (details.target_position.z !== undefined) child.userData.targetZ = details.target_position.z;
                                if (details.target_position.x !== undefined) child.userData.homeX = details.target_position.x;
                                if (details.target_position.y !== undefined) child.userData.homeY = details.target_position.y;
                                if (details.target_position.z !== undefined) child.userData.homeZ = details.target_position.z;
                            }
                        }
                    });
                    showSuccessMessage(`Modified ${count} background object(s).`);
                } else {
                    showFeedbackMessage(`Cannot control background objects right now.`, null);
                }
                break;
            }

            case 'set_zindex': {
                document.querySelectorAll('.workspace-pane, .beveled-panel, .float-panel, .bottom-tab-panel').forEach(el => {
                    el.style.zIndex = value;
                });
                showSuccessMessage(`Panel Z-Index normalized to <strong>${value}</strong>.`);
                break;
            }

            case 'create_panel':
                if (value === 'floating') {
                    const template = document.getElementById('float-panel');
                    if (template) {
                        const newPanel = template.cloneNode(true);
                        newPanel.id = 'float-panel-' + Date.now();
                        newPanel.style.display = 'block';
                        // Random position near center
                        const randomX = window.innerWidth / 2 - 150 + (Math.random() * 100 - 50);
                        const randomY = window.innerHeight / 2 - 100 + (Math.random() * 100 - 50);
                        newPanel.style.left = randomX + 'px';
                        newPanel.style.top = randomY + 'px';

                        const title = newPanel.querySelector('.float-panel-title');
                        if (title) title.textContent = 'New Panel';

                        document.body.appendChild(newPanel);

                        // Rebind drag & close logic
                        const header = newPanel.querySelector('.float-panel-header');
                        const closeBtn = newPanel.querySelector('.float-panel-close');

                        if (header && closeBtn) {
                            closeBtn.addEventListener('click', () => {
                                newPanel.classList.add('closing');
                                newPanel.addEventListener('animationend', () => {
                                    newPanel.remove();
                                }, { once: true });
                            });

                            let dragging = false, dx = 0, dy = 0;
                            header.addEventListener('mousedown', (e) => {
                                if (e.target === closeBtn || closeBtn.contains(e.target)) return;
                                dragging = true;
                                dx = e.clientX - newPanel.getBoundingClientRect().left;
                                dy = e.clientY - newPanel.getBoundingClientRect().top;
                                e.preventDefault();
                            });

                            window.addEventListener('mousemove', (e) => {
                                if (dragging) {
                                    const newLeft = Math.max(0, Math.min(window.innerWidth - newPanel.offsetWidth, e.clientX - dx));
                                    const newTop  = Math.max(0, Math.min(window.innerHeight - newPanel.offsetHeight, e.clientY - dy));
                                    newPanel.style.left = newLeft + 'px';
                                    newPanel.style.top  = newTop  + 'px';
                                }
                            });

                            window.addEventListener('mouseup', () => {
                                dragging = false;
                            });
                        }

                        // Rebind resize logic
                        let resizing = false, resDir = '', rsX, rsY, rsW, rsH, rsL, rsT;
                        let cachedMinW, cachedMinH, cachedMaxW;
                        newPanel.querySelectorAll('.float-panel-resize').forEach(handle => {
                            handle.addEventListener('mousedown', (e) => {
                                resizing = true;
                                resDir = handle.getAttribute('data-dir');
                                rsX = e.clientX;
                                rsY = e.clientY;
                                const r = newPanel.getBoundingClientRect();
                                rsW = r.width; rsH = r.height;
                                rsL = r.left;  rsT = r.top;
                                const cs = getComputedStyle(newPanel);
                                cachedMinW = parseInt(cs.minWidth) || 0;
                                cachedMinH = parseInt(cs.minHeight) || 0;
                                cachedMaxW = parseInt(cs.maxWidth) || window.innerWidth;
                                e.preventDefault();
                                e.stopPropagation();
                            });
                        });

                        window.addEventListener('mousemove', (e) => {
                            if (resizing) {
                                const ddx = e.clientX - rsX;
                                const ddy = e.clientY - rsY;

                                if (resDir === 'r' || resDir === 'br') {
                                    const newW = Math.min(cachedMaxW, Math.max(cachedMinW, rsW + ddx));
                                    newPanel.style.width = Math.min(newW, window.innerWidth - rsL) + 'px';
                                }
                                if (resDir === 'bl') {
                                    const newW = Math.max(cachedMinW, rsW - ddx);
                                    const newL = rsL + (rsW - newW);
                                    if (newL >= 0) {
                                        newPanel.style.width = newW + 'px';
                                        newPanel.style.left  = newL + 'px';
                                    }
                                }
                                if (resDir === 'b' || resDir === 'br' || resDir === 'bl') {
                                    const newH = Math.max(cachedMinH, rsH + ddy);
                                    newPanel.style.height = Math.min(newH, window.innerHeight - rsT) + 'px';
                                }
                            }
                        });

                        window.addEventListener('mouseup', () => {
                            resizing = false;
                        });

                        showSuccessMessage('Created new floating panel.');
                    }
                }
                break;

            default:
                console.log(`Unhandled intent: ${intent}`, value);
        }
    };

    // ------------------------------------------------------------------
    // Panel Helpers
    // ------------------------------------------------------------------
    const PANEL_SELECTOR_MAP = {
        'left':    '.ai-edge-panel.left-edge',
        'right':   '.ai-edge-panel.right-edge',
        'top':     '.top-toolbar',
        'bottom':  '.bottom-tab-panel',
        'command': '.command-panel-container',
    };

    const getPanelElement = (panelName) => {
        const selector = PANEL_SELECTOR_MAP[panelName];
        return selector ? document.querySelector(selector) : null;
    };

    const applyPanelVisibility = (panelName, displayValue) => {
        if (panelName === 'all') {
            Object.values(PANEL_SELECTOR_MAP).forEach(selector => {
                const el = document.querySelector(selector);
                if (el) el.style.display = displayValue;
            });
            return;
        }
        const el = getPanelElement(panelName);
        if (el) el.style.display = displayValue;
    };

    // ------------------------------------------------------------------
    // Server Response Handler
    // ------------------------------------------------------------------
    const handleServerResponse = (data, originalCommand) => {
        if (!data) return;

        // Unrecognized command -> show suggestions
        if (data.status === 'unrecognized') {
            showFeedbackMessage(data.message || 'Command not recognized.', data.suggestions);
            return;
        }

        // Validation error -> show the error
        if (data.status === 'validation_error') {
            showFeedbackMessage(data.message || 'Validation failed.', null);
            return;
        }

        // Success or Answered -> execute actions
        if (data.actions && Array.isArray(data.actions)) {
            data.actions.forEach(action => {
                switch (action.type) {
                    case 'log':
                        console.log('Orchestrator:', action.message);
                        break;
                    case 'ui_update':
                        console.log('UI Update:', action.details);
                        applyUIUpdate(action.details);
                        break;
                    case 'feedback':
                        showFeedbackMessage(action.message, action.suggestions || null);
                        break;
                    case 'chat_message':
                        const qaContainer = document.getElementById('qa-messages-container');
                        if (qaContainer) {
                            qaContainer.innerHTML = ''; // Clear previous answers
                            const ansDiv = document.createElement('div');
                            ansDiv.style.marginBottom = '12px';
                            ansDiv.style.display = 'flex';
                            ansDiv.style.flexDirection = 'column';
                            
                            // --- Header ---
                            const headerDiv = document.createElement('div');
                            headerDiv.style.display = 'flex';
                            headerDiv.style.justifyContent = 'flex-end';
                            headerDiv.style.padding = '4px 0'; // Thinner header
                            headerDiv.style.borderBottom = '1px solid rgba(255, 255, 255, 0.1)';
                            
                            const closeBtn = document.createElement('button');
                            closeBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="14" height="14"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>';
                            closeBtn.style.background = 'none';
                            closeBtn.style.border = 'none';
                            closeBtn.style.color = '#ccc';
                            closeBtn.style.cursor = 'pointer';
                            closeBtn.style.padding = '0'; // Thinner button
                            closeBtn.style.display = 'flex';
                            closeBtn.style.alignItems = 'center';
                            closeBtn.style.justifyContent = 'center';
                            closeBtn.title = 'Close';
                            
                            closeBtn.addEventListener('click', () => {
                                const cmdPanel = document.querySelector('.panel-bottom');
                                if (cmdPanel && cmdPanel.classList.contains('qa-expanded')) {
                                    cmdPanel.classList.remove('qa-expanded');
                                    const collapsedH = 100;
                                    const newTop = cmdPanel.getBoundingClientRect().top + (cmdPanel.getBoundingClientRect().height - collapsedH);
                                    cmdPanel.style.height = '';
                                    cmdPanel.style.top = newTop + 'px';
                                    cmdPanel.style.bottom = 'auto';
                                }
                            });
                            
                            headerDiv.appendChild(closeBtn);
                            
                            // --- Content ---
                            const textDiv = document.createElement('div');
                            textDiv.innerHTML = action.message;
                            textDiv.style.padding = '8px 0'; // Reduced vertical padding
                            textDiv.style.fontSize = '13px'; // Size 13px
                            textDiv.style.fontWeight = 'normal'; // Not bold
                            textDiv.style.lineHeight = '1.4';
                            
                            // --- Footer ---
                            const footerDiv = document.createElement('div');
                            footerDiv.style.display = 'flex';
                            footerDiv.style.padding = '8px 0 0 0'; // Padding top only to reduce space
                            footerDiv.style.borderTop = '1px solid rgba(255, 255, 255, 0.1)';
                            
                            const learnBtn = document.createElement('button');
                            learnBtn.textContent = 'Learn More';
                            learnBtn.className = 'nav-btn'; // reuse existing button style
                            learnBtn.style.padding = '4px 12px';
                            learnBtn.style.width = 'auto';
                            learnBtn.style.height = 'auto';
                            
                            footerDiv.appendChild(learnBtn);
                            
                            ansDiv.appendChild(headerDiv);
                            ansDiv.appendChild(textDiv);
                            ansDiv.appendChild(footerDiv);
                            qaContainer.appendChild(ansDiv);
                            qaContainer.scrollTop = qaContainer.scrollHeight;
                        }
                        // Auto-expand the command panel to show the answer
                        const cmdPanel = document.querySelector('.panel-bottom');
                        if (cmdPanel) {
                            if (!cmdPanel.classList.contains('community-expanded') && !cmdPanel.classList.contains('qa-expanded')) {
                                cmdPanel.classList.add('qa-expanded');
                                
                                let contentH = 150; // default fallback
                                if (qaContainer) {
                                    qaContainer.style.display = 'flex';
                                    contentH = qaContainer.scrollHeight;
                                    qaContainer.style.display = '';
                                }
                                
                                const expandedH = Math.min(Math.max(contentH + 130, 160), 500);
                                const rect = cmdPanel.getBoundingClientRect();
                                const newTop = rect.top - (expandedH - rect.height);
                                
                                cmdPanel.style.height = expandedH + 'px';
                                cmdPanel.style.top = newTop + 'px';
                                cmdPanel.style.bottom = 'auto';
                            }
                        }
                        break;
                    default:
                        console.warn('Unknown action type from server:', action.type);
                }
            });
        }
    };

    // ------------------------------------------------------------------
    // Event Listeners
    // ------------------------------------------------------------------
    sendBtn.addEventListener('click', processCommand);

    promptInput.addEventListener('keydown', (e) => {
        // Submit on Enter without Shift
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            processCommand();
        }
    });
});
