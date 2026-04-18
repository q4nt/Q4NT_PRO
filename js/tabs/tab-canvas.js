/* ==========================================================================
   Q4NT PRO - Canvas Tab Controller
   ========================================================================== */
var TabCanvas = (function() {
    var pane = document.querySelector('.btp-pane[data-pane="canvas"]');
    
    if (pane) {
        pane.innerHTML = `
            <div style="padding: 10px; font-family: 'Inter', sans-serif; display: flex; flex-direction: column; height: 100%;">
                <div style="display: flex; gap: 15px; margin-bottom: 12px; border-bottom: 1px solid rgba(0,0,0,0.05); padding-bottom: 8px;">
                    <span style="font-weight: 600; font-size: 0.8rem; color: var(--text-main);">CANVAS ORCHESTRATOR</span>
                    <div style="display: flex; gap: 8px;">
                        <div style="width: 12px; height: 12px; background: #007AFF; border-radius: 2px;"></div>
                        <div style="width: 12px; height: 12px; background: #5ac8fa; border-radius: 2px;"></div>
                        <div style="width: 12px; height: 12px; background: #34C759; border-radius: 2px;"></div>
                    </div>
                </div>
                <div style="flex-grow: 1; border: 1px dashed rgba(0,0,0,0.1); border-radius: 4px; display: flex; align-items: center; justify-content: center; background: rgba(0,0,0,0.01);">
                    <div style="text-align: center;">
                        <div style="font-size: 0.75rem; color: var(--text-dim); margin-bottom: 8px;">Drag objects here to start compositing</div>
                        <button style="padding: 6px 16px; background: var(--text-main); color: white; border: none; border-radius: 4px; font-size: 0.7rem; cursor: pointer;">NEW CANVAS</button>
                    </div>
                </div>
            </div>
        `;
    }

    return { pane: pane };
})();
