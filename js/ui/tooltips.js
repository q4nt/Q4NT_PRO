/* ==========================================================================
   Q4NT PRO - Tooltip Registry
   Applies title attributes to all interactive elements at startup.
   Add new entries here to give any element a tooltip.
   ========================================================================== */

(function initTooltips() {

    // ------------------------------------------------------------------
    // 1. REGISTRY — maps CSS selector → tooltip text
    //    Specificity: later entries override earlier ones for same selector.
    // ------------------------------------------------------------------
    var TOOLTIPS = [

        // === Left Edge Panel ===
        ['.left-console-btn',           'Command Panel (Console)'],

        // === Right Edge Panel ===
        ['.right-alert-btn',            'Alerts'],
        ['.jj-profile-btn',             'User Profile'],
        ['.right-openai-btn',           'OpenAI Configuration'],
        ['.right-detect-btn',           'ML Detection Settings'],
        ['.right-polymarket-btn',       'Polymarket — Prediction Markets'],
        ['.right-alerts-btn',           'Alerts & Notifications'],
        ['.right-cube-btn',             '3D Workspace / View Cycle HUD'],
        ['.theme-toggle-btn',           'Toggle Light / Dark Theme'],
        ['.grid-layout-btn',            'Layout Options'],
        ['.right-share-btn',            'Share Workspace'],
        ['.right-store-btn',            'Q4NT Store'],
        ['.right-plus-btn',             'Add Widget'],
        ['.alpaca-btn',                 'Alpaca Trading Integration'],
        ['.schwab-btn',                 'Charles Schwab Integration'],

        // === Top Panel ===
        ['.minus-btn',                  'Remove Pane'],
        ['.plus-btn',                   'Add Pane'],

        // === Command Panel Header ===
        ['#group-switcher',             'Switch Community Group'],
        ['#chat-alert-btn',             'Notification Settings'],
        ['#chat-settings-btn',          'Channel Settings'],

        // === Channel Tabs ===
        ['[data-channel="general"]',    '# general — General Discussion'],
        ['[data-channel="trading"]',    '# trading — Trading Desk'],
        ['[data-channel="signals"]',    '# signals — Trade Signals'],
        ['[data-channel="alerts"]',     '# alerts — System Alerts'],

        // === Command Panel Prompt ===
        ['.mic-btn',                    'Voice Input'],
        ['.send-btn',                   'Send Message'],
        ['.community-btn',              'Toggle Community / AI Mode'],
        ['.layout-btn',                 'Toolbar Position Cycle'],
        ['.attach-btn',                 'Attach File'],
        ['#add-widget-btn',             'Add Widget to Dashboard'],

        // === Float Panel ===
        ['#float-panel-close',          'Close Panel'],

        // === Bottom Tab Strip (BTP) ===
        ['[data-tab="watchlist"]',      'Market Research — Watchlist'],
        ['[data-tab="console"]',        'Console — Command Output'],
        ['[data-tab="output"]',         'Output Log'],
        ['[data-tab="telemetry"]',      'Telemetry — Live Metrics'],
        ['[data-tab="camera"]',         'Camera — Video / ML Feed'],
        ['[data-tab="canvas"]',         'Canvas — Drawing & Annotation'],

        ['[data-tab="views-floors"]',   'Floors View — Infinite Grid'],
        ['[data-tab="views-focus-plane"]', 'Focus Plane Mode'],
        ['[data-tab="views-glass-press"]', 'Glass Press Mode'],

        ['[data-tab="views-deck-mode"]',   'Deck Mode'],
        ['[data-tab="views-dimension-toggle"]', 'Dimension Toggle'],
        ['[data-tab="row2-home"]',      'Home Feed'],
        ['[data-tab="row2-relevant"]',  'Relevant News'],
        ['[data-tab="row2-trending"]',  'Trending'],
        ['[data-tab="row2-recent"]',    'Recent Activity'],
        ['[data-tab="row2-images"]',    'Images'],
        ['[data-tab="row2-us"]',        'US Markets'],
        ['[data-tab="row2-global"]',    'Global Markets'],
        ['[data-tab="row2-chart"]',     'Chart View'],
        ['[data-tab="row2-strategy"]',  'Strategy Builder'],
        ['[data-tab="row2-list"]',      'List View'],
        ['[data-tab="row2-integrations"]', 'Integrations'],
        ['[data-tab="row2-flow"]',      'Flow — Order Flow'],
        ['[data-tab="row2-predictions"]',  'Predictions — Polymarket'],
        ['[data-tab="row2-product"]',   'Product Updates'],
        ['[data-tab="row2-other"]',     'Other'],
        ['[data-tab="row2-events"]',    'Events Calendar'],
        ['[data-tab="row2-themes-and-skins"]', 'Themes and Skins'],
        ['[data-tab="row2-themes"]',    'Themes'],
        ['[data-tab="row2-skins"]',     'Skins'],
        ['[data-tab="row2-custom"]',    'Custom'],
        ['#btp-minimize-btn',           'Minimize Bottom Panel'],

        // === View Cycle HUD ===
        ['#cubeWrapper',                'View Cycle — 3D Depth Navigation'],
        ['#cubeDepthLabel',             'Current View Mode Label'],

        // === Bottom Right Stack ===
        ['#cubeContainer',              '3D Workspace Cube — Click to Rotate'],
        ['#bottomRightStack',           'View Controls & Music Panel'],

        // === Drawing Toolbar ===
        ['.tool-btn[data-tool="select"]',   'Select / Move Tool'],
        ['.tool-btn[data-tool="pen"]',      'Pen / Freehand Draw'],
        ['.tool-btn[data-tool="line"]',     'Line Tool'],
        ['.tool-btn[data-tool="rect"]',     'Rectangle Tool'],
        ['.tool-btn[data-tool="circle"]',   'Circle / Ellipse Tool'],
        ['.tool-btn[data-tool="text"]',     'Text Annotation'],
        ['.tool-btn[data-tool="eraser"]',   'Eraser'],
        ['.tool-btn[data-tool="arrow"]',    'Arrow Tool'],
        ['.toolbar-position-btn',           'Cycle Toolbar Position (Right / Left / Top)'],
    ];

    // ------------------------------------------------------------------
    // 2. Apply all tooltips
    //    Sets data-tooltip to avoid double (native + custom) tooltips.
    // ------------------------------------------------------------------
    function applyTooltips() {
        // First apply registry tooltips
        TOOLTIPS.forEach(function(pair) {
            var selector = pair[0], text = pair[1];
            try {
                document.querySelectorAll(selector).forEach(function(el) {
                    if (!el.getAttribute('data-tooltip')) el.setAttribute('data-tooltip', text);
                });
            } catch (e) { /* invalid selector — skip */ }
        });

        // Then globally strip all title attributes to prevent native tooltips
        document.querySelectorAll('[title]').forEach(function(el) {
            if (!el.getAttribute('data-tooltip')) {
                el.setAttribute('data-tooltip', el.getAttribute('title'));
            }
            el.removeAttribute('title');
        });
    }

    // ------------------------------------------------------------------
    // 3. Styled CSS tooltip (uses the native `title` via CSS data-attr
    //    pattern) — inject a <style> so titles render as a nice pill
    //    instead of the plain OS tooltip. Falls back to native if JS fails.
    // ------------------------------------------------------------------
    function injectTooltipStyles() {
        if (document.getElementById('q4-tooltip-style')) return;
        var style = document.createElement('style');
        style.id = 'q4-tooltip-style';
        style.textContent = [
            /* Global tooltip via a lightweight JS layer */
            '#q4-tooltip {',
            '  position: fixed;',
            '  z-index: 99999;',
            '  pointer-events: none;',
            '  background: rgba(20,20,30,0.88);',
            '  color: #f0f0f0;',
            '  font: 600 11px/1.4 Inter, system-ui, sans-serif;',
            '  letter-spacing: 0.03em;',
            '  padding: 5px 10px;',
            '  border-radius: 6px;',
            '  box-shadow: 0 4px 16px rgba(0,0,0,0.22);',
            '  white-space: normal;',
            '  max-width: 350px;',
            '  opacity: 0;',
            '  transition: opacity 0.12s ease;',
            '}',
            '#q4-tooltip.visible { opacity: 1; }',
        ].join('\n');
        document.head.appendChild(style);
    }

    // ------------------------------------------------------------------
    // 4. Lightweight JS tooltip layer
    //    Shows a styled dark pill near the cursor, delayed 500ms.
    // ------------------------------------------------------------------
    function initTooltipLayer() {
        var tip  = document.createElement('div');
        tip.id   = 'q4-tooltip';
        document.body.appendChild(tip);

        var timer = null;
        var currentEl = null;

        function show(el, x, y) {
            var text = el.getAttribute('data-tooltip');
            if (!text) return;
            tip.innerHTML = text;
            // Position: prefer below-right, flip if off-screen
            var tx = x + 14, ty = y + 18;
            if (tx + 200 > window.innerWidth)  tx = x - 14 - tip.offsetWidth;
            if (ty + 40  > window.innerHeight) ty = y - 32;
            tip.style.left = tx + 'px';
            tip.style.top  = ty + 'px';
            tip.classList.add('visible');
        }

        function hide() {
            clearTimeout(timer);
            timer = null;
            tip.classList.remove('visible');
            currentEl = null;
        }

        document.addEventListener('mouseover', function(e) {
            var el = e.target;
            // Walk up max 3 levels to find a titled element
            for (var i = 0; i < 3 && el && el !== document.body; i++) {
                // Strip native titles on the fly just in case they were added dynamically
                if (el.hasAttribute('title')) {
                    if (!el.getAttribute('data-tooltip')) {
                        el.setAttribute('data-tooltip', el.getAttribute('title'));
                    }
                    el.removeAttribute('title');
                }
                var text = el.getAttribute('data-tooltip');
                if (text) {
                    if (el === currentEl) return;
                    hide();
                    currentEl = el;
                    var cx = e.clientX, cy = e.clientY;
                    timer = setTimeout(function() { show(el, cx, cy); }, 500);
                    return;
                }
                el = el.parentElement;
            }
            if (currentEl) hide();
        }, true);

        document.addEventListener('mousemove', function(e) {
            if (tip.classList.contains('visible')) {
                var tx = e.clientX + 14, ty = e.clientY + 18;
                if (tx + 200 > window.innerWidth)  tx = e.clientX - 14 - tip.offsetWidth;
                if (ty + 40  > window.innerHeight) ty = e.clientY - 32;
                tip.style.left = tx + 'px';
                tip.style.top  = ty + 'px';
            }
        });

        document.addEventListener('mouseout', function(e) {
            if (!e.relatedTarget || !e.currentTarget.contains(e.relatedTarget)) {
                clearTimeout(timer);
            }
        }, true);

        document.addEventListener('mousedown', hide);
        document.addEventListener('scroll',    hide, true);
    }

    // ------------------------------------------------------------------
    // 5. Boot
    // ------------------------------------------------------------------
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function() {
            applyTooltips();
            injectTooltipStyles();
            initTooltipLayer();
        });
    } else {
        applyTooltips();
        injectTooltipStyles();
        initTooltipLayer();
    }

})();
