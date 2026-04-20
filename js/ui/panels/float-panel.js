/* ==========================================================================
   Q4NT PRO - Floating Panel Drag & Resize
   ========================================================================== */

document.addEventListener('DOMContentLoaded', () => {
    try {
        const fp = document.getElementById('float-panel');
        const header = document.getElementById('float-panel-header');
        const closeBtn = document.getElementById('float-panel-close');

        if (fp && header && closeBtn) {
            fp.style.willChange = 'left, top, width, height';
            // Close with flick animation
            closeBtn.addEventListener('click', () => {
                fp.classList.add('closing');
                fp.addEventListener('animationend', () => {
                    fp.style.display = 'none';
                    fp.classList.remove('closing');
                }, { once: true });
            });

            // Drag
            let dragging = false, dx = 0, dy = 0;
            header.addEventListener('mousedown', (e) => {
                if (e.target === closeBtn || closeBtn.contains(e.target)) return;
                dragging = true;
                dx = e.clientX - fp.getBoundingClientRect().left;
                dy = e.clientY - fp.getBoundingClientRect().top;
                e.preventDefault();
            });

            // Resize
            let resizing = false, resDir = '', rsX, rsY, rsW, rsH, rsL, rsT;
            let cachedMinW, cachedMinH, cachedMaxW;
            document.querySelectorAll('.float-panel-resize').forEach(handle => {
                handle.addEventListener('mousedown', (e) => {
                    resizing = true;
                    resDir = handle.getAttribute('data-dir');
                    rsX = e.clientX;
                    rsY = e.clientY;
                    const r = fp.getBoundingClientRect();
                    rsW = r.width; rsH = r.height;
                    rsL = r.left;  rsT = r.top;
                    const cs = getComputedStyle(fp);
                    cachedMinW = parseInt(cs.minWidth) || 0;
                    cachedMinH = parseInt(cs.minHeight) || 0;
                    cachedMaxW = parseInt(cs.maxWidth) || window.innerWidth;
                    e.preventDefault();
                    e.stopPropagation();
                });
            });

            window.addEventListener('mousemove', (e) => {
                if (dragging) {
                    const newLeft = Math.max(0, Math.min(window.innerWidth - fp.offsetWidth, e.clientX - dx));
                    const newTop  = Math.max(0, Math.min(window.innerHeight - fp.offsetHeight, e.clientY - dy));
                    fp.style.left = newLeft + 'px';
                    fp.style.top  = newTop  + 'px';
                }
                if (resizing) {
                    const ddx = e.clientX - rsX;
                    const ddy = e.clientY - rsY;

                    if (resDir === 'r' || resDir === 'br') {
                        const newW = Math.min(cachedMaxW, Math.max(cachedMinW, rsW + ddx));
                        fp.style.width = Math.min(newW, window.innerWidth - rsL) + 'px';
                    }
                    if (resDir === 'bl') {
                        const newW = Math.max(cachedMinW, rsW - ddx);
                        const newL = rsL + (rsW - newW);
                        if (newL >= 0) {
                            fp.style.width = newW + 'px';
                            fp.style.left  = newL + 'px';
                        }
                    }
                    if (resDir === 'b' || resDir === 'br' || resDir === 'bl') {
                        const newH = Math.max(cachedMinH, rsH + ddy);
                        fp.style.height = Math.min(newH, window.innerHeight - rsT) + 'px';
                    }
                }
            });

            window.addEventListener('mouseup', () => {
                dragging = false;
                resizing = false;
            });
            console.log('[Q4NT Panels] Floating Panel initialized.');
        }
    } catch (error) {
        console.error('[Q4NT Panels] Floating Panel init error:', error);
    }
});
