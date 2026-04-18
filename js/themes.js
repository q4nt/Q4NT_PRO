/* ==========================================================================
   Q4NT PRO - Theme Switching Logic
   Default is white/light. Dark theme via body.dark-theme class.
   ========================================================================== */

(function initThemes() {
    const themeToggleBtn = document.querySelector('.theme-toggle-btn');
    const themeOptionsPanel = document.querySelector('.theme-options-panel');
    const layoutOptionsPanel = document.querySelector('.layout-options-panel');

    if (!themeToggleBtn || !themeOptionsPanel) return;

    // Toggle theme panel
    themeToggleBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        layoutOptionsPanel?.classList.remove('visible');
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

            // Reset all theme classes
            document.body.classList.remove('dark-theme', 'light-theme', 'blue-theme', 'green-theme');

            // Apply selected theme
            if (theme === 'dark')  document.body.classList.add('dark-theme');
            if (theme === 'light') document.body.classList.add('light-theme');
            if (theme === 'blue')  document.body.classList.add('blue-theme');
            if (theme === 'green') document.body.classList.add('green-theme');

            // Update renderer clear color to match
            if (typeof Q4Scene !== 'undefined' && Q4Scene.renderer) {
                Q4Scene.renderer.setClearColor(themeColors[theme] || 0xf5f5f7);

                // Update fog
                if (Q4Scene.scene && Q4Scene.scene.fog) {
                    Q4Scene.scene.fog.color.set(themeColors[theme] || 0xf5f5f7);
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
})();
