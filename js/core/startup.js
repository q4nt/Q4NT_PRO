/* ==========================================================================
   Q4NT PRO - Application Startup
   Must load AFTER scene.js + all view files + tab files
   ========================================================================== */
document.addEventListener('DOMContentLoaded', () => {
    try {
        console.log('[Q4NT Startup] Initializing workspace panes...');
        const panes = document.querySelectorAll('.workspace-pane');
        if (panes.length > 0) {
            initViews(panes);
        } else {
            console.warn('[Q4NT Startup] No workspace panes found.');
        }

        console.log('[Q4NT Startup] Setting default background...');
        if (typeof setBackground === 'function') {
            setBackground(0);
        } else {
            console.warn('[Q4NT Startup] setBackground function not defined.');
        }

        console.log('[Q4NT Startup] Starting 3D animation loop...');
        if (typeof startAnimationLoop === 'function') {
            startAnimationLoop();
        } else {
            console.warn('[Q4NT Startup] startAnimationLoop function not defined.');
        }
        
        console.log('[Q4NT Startup] Initialization complete.');
    } catch (error) {
        console.error('[Q4NT Startup] Critical initialization error:', error);
    }
});
