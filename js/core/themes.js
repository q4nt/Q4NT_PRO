/* ==========================================================================
   Q4NT PRO - Theme Switching Logic
   Default is white/light. Dark theme via body.dark-theme class.
   ========================================================================== */

document.addEventListener('DOMContentLoaded', () => {
    try {
        const themeToggleBtn = document.querySelector('.theme-toggle-btn');
        const themeOptionsPanel = document.querySelector('.theme-options-panel');
        const layoutOptionsPanel = document.querySelector('.layout-options-panel');

        if (themeToggleBtn && themeOptionsPanel) {
            // Toggle theme panel
            themeToggleBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                if (layoutOptionsPanel) {
                    layoutOptionsPanel.classList.remove('visible');
                }
                themeOptionsPanel.classList.toggle('visible');
            });

            // Theme color map
            const themeColors = {
                dark:  0x050505,
                light: 0xf5f5f7,
                blue:  0x001122,
                green: 0x001a0d
            };

            // Theme selection
            document.querySelectorAll('.theme-option').forEach(opt => {
                opt.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const theme = opt.getAttribute('data-theme');

                    // Reset all theme classes on both html and body
                    const allThemes = ['dark-theme', 'light-theme', 'blue-theme', 'green-theme'];
                    document.body.classList.remove(...allThemes);
                    document.documentElement.classList.remove(...allThemes);

                    // Apply selected theme
                    if (['dark', 'light', 'blue', 'green'].includes(theme)) {
                        document.body.classList.add(`${theme}-theme`);
                        document.documentElement.classList.add(`${theme}-theme`);
                    }

                    // Update renderer clear color to match
                    if (typeof Q4Scene !== 'undefined' && Q4Scene.renderer && Q4Scene.scene) {
                        const hexColor = themeColors[theme] || 0xf5f5f7;
                        Q4Scene.renderer.setClearColor(hexColor);

                        // Update fog
                        if (Q4Scene.scene.fog) {
                            Q4Scene.scene.fog.color.set(hexColor);
                        }
                    }

                    themeOptionsPanel.classList.remove('visible');
                });
            });

            // Close theme panel on outside click
            document.addEventListener('click', (e) => {
                if (!e.target.closest('.theme-toggle-btn') && !e.target.closest('.theme-options-panel')) {
                    themeOptionsPanel.classList.remove('visible');
                }
            });
            console.log('[Q4NT Themes] Theme switcher initialized.');
        } else {
            console.warn('[Q4NT Themes] Theme toggler or options panel not found.');
        }
    } catch (error) {
        console.error('[Q4NT Themes] Error initializing themes:', error);
    }
});
