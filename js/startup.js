/* ==========================================================================
   Q4NT PRO - Application Startup
   Must load AFTER scene.js + all view files + tab files
   ========================================================================== */
initViews(document.querySelectorAll('.workspace-pane'));
setBackground(0);
startAnimationLoop();
