/* ==========================================================================
   Q4NT PRO - Views Tabs (1-20) Controller
   Replaces the old top number buttons with grouped bottom tabs.
   ========================================================================== */
(function() {
    var VIEW_META = [
        { n: 1, title: 'Default View: Panels' },
        { n: 2, title: 'Infinite Grid Floor' },
        { n: 3, title: 'F1 Track (Circuit 1)' },
        { n: 4, title: 'Hex Platform' },
        { n: 5, title: 'F1 Track (Circuit 2)' },
        { n: 6, title: 'F1 Track (Circuit 3)' },
        { n: 7, title: 'F1 Track (Circuit 4)' },
        { n: 8, title: 'F1 Track (Circuit 5)' },
        { n: 9, title: 'F1 Track (Circuit 6)' },
        { n: 10, title: 'Floor Pulse' },
        { n: 11, title: 'F1 Track (Circuit 7)' },
        { n: 12, title: 'F1 Track (Circuit 8)' },
        { n: 13, title: 'F1 Track (Circuit 9)' },
        { n: 14, title: 'Glossy Floor' },
        { n: 15, title: 'F1 Track (Circuit 10)' },
        { n: 16, title: 'F1 Track (Circuit 11)' },
        { n: 17, title: 'F1 Track (Circuit 12)' },
        { n: 18, title: 'F1 Track (Circuit 13)' },
        { n: 19, title: 'Monolithic Box Room' },
        { n: 20, title: 'F1 Track (Circuit 14)' },
    ];

    // Category mapping: background index = view number - 1
    var GROUPS = [
        { pane: 'views-3d', label: '3D VIEWS', sub: 'Spaces and platforms', items: [1, 4, 19] },
        { pane: 'views-f1', label: 'F1 TRACKS', sub: 'Circuits 1-14', items: [3, 5, 6, 7, 8, 9, 11, 12, 13, 15, 16, 17, 18, 20] },
        { pane: 'views-floors', label: 'FLOORS', sub: 'Grid and floor effects', items: [2, 10, 14] },
    ];

    var lastSelectedByPane = {
        'views-3d': 0,   // View 1
        'views-f1': 2,   // View 3 (Circuit 1)
        'views-floors': 1, // View 2
    };

    function _activeIndex() {
        if (typeof Q4Scene !== 'undefined' && typeof Q4Scene.activeBackgroundIndex === 'number') {
            return Q4Scene.activeBackgroundIndex;
        }
        return null;
    }

    function switchToBackground(idx) {
        if (typeof setBackground === 'function' && typeof idx === 'number' && idx >= 0) {
            setBackground(idx);
        }
        updateActiveButtons();
    }

    function updateActiveButtons() {
        var ai = _activeIndex();
        document.querySelectorAll('.q4-view-btn').forEach(function(btn) {
            var bg = parseInt(btn.getAttribute('data-bg') || '-1', 10);
            btn.classList.toggle('active', (ai !== null && bg === ai));
        });
    }

    function renderGroup(group) {
        var pane = document.querySelector('.btp-pane[data-pane="' + group.pane + '"]');
        if (!pane) return;

        var items = VIEW_META.filter(function(v) { return group.items.indexOf(v.n) >= 0; });
        var cards = items.map(function(v) {
            var bgIndex = v.n - 1;
            return (
                '<button class="q4-view-btn" type="button" data-bg="' + bgIndex + '">' +
                    '<span class="q4-view-num">' + v.n + '</span>' +
                    '<span class="q4-view-title">' + v.title + '</span>' +
                '</button>'
            );
        }).join('');

        pane.innerHTML =
            '<div class="q4-view-wrap">' +
                '<div class="q4-view-head">' +
                    '<span class="q4-view-head-title">' + group.label + '</span>' +
                    '<span class="q4-view-head-sub">' + (group.sub || '') + '</span>' +
                '</div>' +
                '<div class="q4-view-grid">' + cards + '</div>' +
            '</div>';

        pane.querySelectorAll('.q4-view-btn').forEach(function(btn) {
            btn.addEventListener('click', function() {
                var idx = parseInt(btn.getAttribute('data-bg') || '-1', 10);
                if (idx >= 0) {
                    lastSelectedByPane[group.pane] = idx;
                    switchToBackground(idx);
                }
            });
        });
    }

    GROUPS.forEach(renderGroup);
    updateActiveButtons();

    // Make tapping the category tab actually switch the scene immediately.
    document.querySelectorAll('.btp-tab[data-tab="views-3d"], .btp-tab[data-tab="views-f1"], .btp-tab[data-tab="views-floors"]').forEach(function(tab) {
        tab.addEventListener('click', function() {
            var pane = tab.getAttribute('data-tab');
            var idx = (pane && typeof lastSelectedByPane[pane] === 'number') ? lastSelectedByPane[pane] : 0;
            switchToBackground(idx);
        });
    });

    window.addEventListener('q4:backgroundChanged', function() {
        updateActiveButtons();
    }, { passive: true });
})();
