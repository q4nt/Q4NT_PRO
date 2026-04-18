/* ==========================================================================
   Q4NT PRO - User Controls & Panel Interactions
   ========================================================================== */

(function initControls() {
    // === Panel Double-Click Lock ===
    document.querySelectorAll('.beveled-panel').forEach(panel => {
        panel.addEventListener('dblclick', () => {
            panel.classList.toggle('locked');
            if (panel.classList.contains('toolbar-left')) {
                document.querySelector('.ai-edge-left')?.classList.toggle('locked', panel.classList.contains('locked'));
            }
            if (panel.classList.contains('toolbar-right')) {
                document.querySelector('.ai-edge-right')?.classList.toggle('locked', panel.classList.contains('locked'));
            }
        });
    });

    // Forward double-clicks from edge triggers
    document.querySelector('.trigger-top')?.addEventListener('dblclick', () => {
        document.querySelector('.panel-top').classList.toggle('locked');
    });

    document.querySelector('.ai-edge-left')?.addEventListener('dblclick', (e) => {
        if (e.target.closest('.vertical-icon') || e.target.closest('.edge-btn')) return;
        const tb = document.querySelector('.toolbar-left');
        tb.classList.toggle('locked');
        e.currentTarget.classList.toggle('locked', tb.classList.contains('locked'));
    });

    document.querySelector('.ai-edge-right')?.addEventListener('dblclick', (e) => {
        if (e.target.closest('.vertical-icon') || e.target.closest('.edge-btn') || e.target.closest('.right-bottom-tools') || e.target.closest('.right-top-tools')) return;
        const tb = document.querySelector('.toolbar-right');
        tb.classList.toggle('locked');
        e.currentTarget.classList.toggle('locked', tb.classList.contains('locked'));
    });

    // === Edge Panel Hover Sync ===
    document.querySelector('.toolbar-left')?.addEventListener('mouseenter', () => {
        document.querySelector('.ai-edge-left')?.classList.add('hovered');
    });
    document.querySelector('.toolbar-left')?.addEventListener('mouseleave', () => {
        document.querySelector('.ai-edge-left')?.classList.remove('hovered');
    });
    document.querySelector('.toolbar-right')?.addEventListener('mouseenter', () => {
        document.querySelector('.ai-edge-right')?.classList.add('hovered');
    });
    document.querySelector('.toolbar-right')?.addEventListener('mouseleave', () => {
        document.querySelector('.ai-edge-right')?.classList.remove('hovered');
    });

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

    // === Layout Toggle Button (4-state toolbar cycle) ===
    const layoutBtn = document.querySelector('.layout-btn');
    const toolbarLeft = document.querySelector('.toolbar-left');
    const toolbarRight = document.querySelector('.toolbar-right');
    const rectLeft = layoutBtn?.querySelector('.layout-bg-left');
    const rectRight = layoutBtn?.querySelector('.layout-bg-right');

    let layoutState = 0;
    let layoutHoldTimer;
    let layoutIsHolding = false;

    const applyLayoutState = () => {
        const edgeL = document.querySelector('.ai-edge-left');
        const edgeR = document.querySelector('.ai-edge-right');

        if (layoutState === 0) {
            toolbarLeft?.classList.remove('visible');
            toolbarRight?.classList.remove('visible');
            edgeL?.classList.remove('visible');
            edgeR?.classList.remove('visible');
            if (rectLeft) rectLeft.style.fill = 'transparent';
            if (rectRight) rectRight.style.fill = 'transparent';
            if (layoutBtn) layoutBtn.style.color = '';
        } else if (layoutState === 1) {
            toolbarLeft?.classList.add('visible');
            toolbarRight?.classList.add('visible');
            edgeL?.classList.add('visible');
            edgeR?.classList.add('visible');
            if (rectLeft) rectLeft.style.fill = '#00f2fe';
            if (rectRight) rectRight.style.fill = '#00f2fe';
            if (layoutBtn) layoutBtn.style.color = '#00f2fe';
        } else if (layoutState === 2) {
            toolbarLeft?.classList.add('visible');
            toolbarRight?.classList.remove('visible');
            edgeL?.classList.add('visible');
            edgeR?.classList.remove('visible');
            if (rectLeft) rectLeft.style.fill = '#00f2fe';
            if (rectRight) rectRight.style.fill = 'transparent';
            if (layoutBtn) layoutBtn.style.color = '#00f2fe';
        } else if (layoutState === 3) {
            toolbarLeft?.classList.remove('visible');
            toolbarRight?.classList.add('visible');
            edgeL?.classList.remove('visible');
            edgeR?.classList.add('visible');
            if (rectLeft) rectLeft.style.fill = 'transparent';
            if (rectRight) rectRight.style.fill = '#00f2fe';
            if (layoutBtn) layoutBtn.style.color = '#00f2fe';
        }
    };

    layoutBtn?.addEventListener('mousedown', () => {
        layoutIsHolding = false;
        layoutHoldTimer = setTimeout(() => {
            layoutIsHolding = true;
            layoutState = 0;
            applyLayoutState();
        }, 500);
    });

    layoutBtn?.addEventListener('mouseup', () => {
        clearTimeout(layoutHoldTimer);
        if (!layoutIsHolding) {
            if (layoutState === 0) layoutState = 1;
            else if (layoutState === 1) layoutState = 2;
            else if (layoutState === 2) layoutState = 3;
            else if (layoutState === 3) layoutState = 1;
            applyLayoutState();
        }
    });

    layoutBtn?.addEventListener('mouseleave', () => {
        clearTimeout(layoutHoldTimer);
    });
})();
