/* ==========================================================================
   Q4NT PRO - Data Bridge
   Orchestrates lazy data fetching and rendering for bottom-panel tabs.
   Maps each tab to its relevant API sources, handles loading states,
   and manages periodic refresh cycles.

   Depends on: api/config.js, api/api-cache.js, api/api-registry.js
   ========================================================================== */

var DataBridge = (function () {

    // Track which tabs have been initialized (prevents duplicate fetches)
    var _initialized = {};

    // Track active refresh intervals per tab
    var _refreshTimers = {};

    // Current active tab
    var _activeTab = null;

    // ---------------------------------------------------------------------------
    // Skeleton / Loading State
    // ---------------------------------------------------------------------------

    function showSkeleton(container, count) {
        if (!container) return;
        var frag = document.createDocumentFragment();
        for (var i = 0; i < (count || 4); i++) {
            var sk = document.createElement('div');
            sk.className = 'db-skeleton';
            sk.innerHTML =
                '<div class="db-skeleton-header"></div>' +
                '<div class="db-skeleton-line"></div>' +
                '<div class="db-skeleton-line short"></div>';
            frag.appendChild(sk);
        }
        container.innerHTML = '';
        container.appendChild(frag);
    }

    function showError(container, message) {
        if (!container) return;
        container.innerHTML =
            '<div class="db-error">' +
            '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><line x1="15" y1="9" x2="9" y2="15"></line><line x1="9" y1="9" x2="15" y2="15"></line></svg>' +
            '<span>' + (message || 'Failed to load data') + '</span>' +
            '</div>';
    }

    function showEmpty(container, message) {
        if (!container) return;
        container.innerHTML =
            '<div class="db-empty">' +
            '<span>' + (message || 'No data available') + '</span>' +
            '</div>';
    }

    // ---------------------------------------------------------------------------
    // Widget Card Builder
    // ---------------------------------------------------------------------------

    /**
     * Create a high-fidelity data card for a widget panel.
     * @param {Object} opts - { title, value, subtitle, change, changeDir, icon, color }
     * @returns {HTMLElement}
     */
    function createDataCard(opts) {
        var card = document.createElement('div');
        card.className = 'db-data-card';

        var changeClass = opts.changeDir === 'up' ? 'up' : (opts.changeDir === 'down' ? 'down' : '');
        var changeSymbol = opts.changeDir === 'up' ? '+' : (opts.changeDir === 'down' ? '' : '');
        var accentColor = opts.color || 'var(--accent, #007AFF)';

        card.innerHTML =
            '<div class="db-card-header">' +
            '  <span class="db-card-title">' + (opts.title || '') + '</span>' +
            (opts.badge ? '<span class="db-card-badge" style="background:' + accentColor + '">' + opts.badge + '</span>' : '') +
            '</div>' +
            '<div class="db-card-value" style="color:' + accentColor + '">' + (opts.value || '--') + '</div>' +
            (opts.change !== undefined ?
                '<div class="db-card-change ' + changeClass + '">' + changeSymbol + opts.change + '</div>' : '') +
            (opts.subtitle ?
                '<div class="db-card-subtitle">' + opts.subtitle + '</div>' : '');

        return card;
    }

    /**
     * Create a score card for sports data.
     */
    function createScoreCard(game) {
        var card = document.createElement('div');
        card.className = 'db-score-card';

        var statusClass = game.isLive ? 'live' : (game.isFinal ? 'final' : 'scheduled');

        card.innerHTML =
            '<div class="db-score-status ' + statusClass + '">' + (game.status || '') + '</div>' +
            '<div class="db-score-teams">' +
            '  <div class="db-score-team">' +
            '    <span class="db-team-name">' + (game.away || '') + '</span>' +
            '    <span class="db-team-score">' + (game.awayScore || '0') + '</span>' +
            '  </div>' +
            '  <div class="db-score-team">' +
            '    <span class="db-team-name">' + (game.home || '') + '</span>' +
            '    <span class="db-team-score">' + (game.homeScore || '0') + '</span>' +
            '  </div>' +
            '</div>';

        return card;
    }

    /**
     * Create a prediction market card.
     */
    function createPredictionCard(market) {
        var card = document.createElement('div');
        card.className = 'db-prediction-card';

        var prob = market.probability !== undefined ? Math.round(market.probability * 100) : '--';
        var probColor = prob > 70 ? '#34C759' : (prob < 30 ? '#FF3B30' : '#FF9500');

        card.innerHTML =
            '<div class="db-pred-question">' + (market.question || market.title || '') + '</div>' +
            '<div class="db-pred-bar-container">' +
            '  <div class="db-pred-bar" style="width:' + prob + '%; background:' + probColor + '"></div>' +
            '</div>' +
            '<div class="db-pred-footer">' +
            '  <span class="db-pred-prob">' + prob + '% Yes</span>' +
            (market.volume ? '<span class="db-pred-vol">$' + _formatNumber(market.volume) + ' vol</span>' : '') +
            '</div>';

        return card;
    }

    // ---------------------------------------------------------------------------
    // Tab Data Loaders
    // ---------------------------------------------------------------------------

    /**
     * Load data for the Home tab - market overview cards.
     */
    function loadHomeTab(pane) {
        var content = _getWidgetContents(pane);
        if (!content.length) return;

        // Populate first 4 widgets with market index cards
        var indices = [
            { title: 'S&P 500', symbol: 'SPY', color: '#1B2A4A' },
            { title: 'NASDAQ', symbol: 'QQQ', color: '#2E7D6F' },
            { title: 'DOW 30', symbol: 'DIA', color: '#C49B3C' },
            { title: 'Russell 2K', symbol: 'IWM', color: '#C4553A' }
        ];

        var polygon = ApiRegistry.get('polygon');
        if (!polygon) {
            // No Polygon API available - show placeholder cards
            indices.forEach(function (idx, i) {
                if (content[i]) {
                    content[i].appendChild(createDataCard({
                        title: idx.title,
                        value: 'Connect API',
                        subtitle: idx.symbol,
                        color: idx.color,
                        badge: 'OFFLINE'
                    }));
                }
            });
            return;
        }

        indices.forEach(function (idx, i) {
            if (!content[i]) return;
            showSkeleton(content[i], 1);

            polygon.prevClose(idx.symbol)
                .then(function (data) {
                    content[i].innerHTML = '';
                    if (data && data.results && data.results.length > 0) {
                        var r = data.results[0];
                        var change = r.c && r.o ? ((r.c - r.o) / r.o * 100).toFixed(2) : 0;
                        content[i].appendChild(createDataCard({
                            title: idx.title,
                            value: '$' + _formatPrice(r.c),
                            change: change + '%',
                            changeDir: change >= 0 ? 'up' : 'down',
                            subtitle: 'Vol: ' + _formatNumber(r.v),
                            color: idx.color,
                            badge: 'LIVE'
                        }));
                    } else {
                        content[i].appendChild(createDataCard({
                            title: idx.title, value: '--', subtitle: 'No data', color: idx.color
                        }));
                    }
                })
                .catch(function () {
                    content[i].innerHTML = '';
                    content[i].appendChild(createDataCard({
                        title: idx.title, value: '--', subtitle: 'API Error', color: idx.color
                    }));
                });
        });

        // Widgets 5-8: Alpaca account info
        var alpaca = ApiRegistry.get('alpaca');
        if (alpaca && content[4]) {
            showSkeleton(content[4], 1);
            alpaca.getAccount()
                .then(function (acct) {
                    content[4].innerHTML = '';
                    if (acct && acct.equity) {
                        var dayPL = acct.equity - (acct.last_equity || acct.equity);
                        content[4].appendChild(createDataCard({
                            title: 'Portfolio Value',
                            value: '$' + _formatPrice(parseFloat(acct.equity)),
                            change: '$' + _formatPrice(Math.abs(dayPL)),
                            changeDir: dayPL >= 0 ? 'up' : 'down',
                            subtitle: 'Buying Power: $' + _formatPrice(parseFloat(acct.buying_power || 0)),
                            color: '#007AFF',
                            badge: 'ALPACA'
                        }));
                    }
                })
                .catch(function () {
                    content[4].innerHTML = '';
                    content[4].appendChild(createDataCard({
                        title: 'Portfolio', value: 'Not Connected', subtitle: 'Connect Alpaca', color: '#007AFF'
                    }));
                });
        }
    }

    /**
     * Load data for the US tab - US markets + sports.
     */
    function loadUSTab(pane) {
        var content = _getWidgetContents(pane);
        if (!content.length) return;

        // NBA Scores
        var nba = ApiRegistry.get('nba');
        if (nba && content[0]) {
            showSkeleton(content[0], 1);
            nba.getTodaysScoreboard()
                .then(function (scoreboard) {
                    content[0].innerHTML = '';
                    if (!scoreboard) {
                        showEmpty(content[0], 'No NBA games today');
                        return;
                    }
                    var games = nba.parseScoreboard(scoreboard);
                    if (games.length === 0) {
                        showEmpty(content[0], 'No NBA games today');
                        return;
                    }
                    var frag = document.createDocumentFragment();
                    games.slice(0, 4).forEach(function (g) {
                        frag.appendChild(createScoreCard(g));
                    });
                    content[0].appendChild(frag);
                })
                .catch(function () {
                    showError(content[0], 'NBA data unavailable');
                });
        }

        // DraftKings upcoming
        var dk = ApiRegistry.get('draftkings');
        if (dk && content[1]) {
            showSkeleton(content[1], 1);
            dk.getContests('NBA')
                .then(function (data) {
                    content[1].innerHTML = '';
                    if (data && data.Contests && data.Contests.length > 0) {
                        var frag = document.createDocumentFragment();
                        data.Contests.slice(0, 3).forEach(function (c) {
                            frag.appendChild(createDataCard({
                                title: c.n || 'Contest',
                                value: '$' + _formatNumber(c.po || 0),
                                subtitle: (c.ec || 0) + ' / ' + (c.m || 0) + ' entries',
                                color: '#2E7D6F',
                                badge: 'DK'
                            }));
                        });
                        content[1].appendChild(frag);
                    } else {
                        showEmpty(content[1], 'No active contests');
                    }
                })
                .catch(function () {
                    showError(content[1], 'DraftKings unavailable');
                });
        }
    }

    /**
     * Load data for the Global tab.
     */
    function loadGlobalTab(pane) {
        var content = _getWidgetContents(pane);
        if (!content.length) return;

        // World Bank GDP data
        var wb = ApiRegistry.get('worldbank');
        if (wb && content[0]) {
            showSkeleton(content[0], 1);
            wb.gdp('USA', { mrv: 1 })
                .then(function (data) {
                    content[0].innerHTML = '';
                    if (data && data[1] && data[1].length > 0) {
                        var entry = data[1][0];
                        content[0].appendChild(createDataCard({
                            title: 'US GDP',
                            value: '$' + _formatNumber(entry.value / 1e12, 2) + 'T',
                            subtitle: 'Year: ' + entry.date,
                            color: '#1B2A4A',
                            badge: 'WORLD BANK'
                        }));
                    }
                })
                .catch(function () {
                    showError(content[0], 'World Bank API unavailable');
                });
        }

        // ADS-B military flights
        var adsb = ApiRegistry.get('adsb');
        if (adsb && content[1]) {
            showSkeleton(content[1], 1);
            adsb.military()
                .then(function (data) {
                    content[1].innerHTML = '';
                    var count = data && data.ac ? data.ac.length : 0;
                    content[1].appendChild(createDataCard({
                        title: 'Military Aircraft',
                        value: count + ' tracked',
                        subtitle: 'Live ADS-B data',
                        color: '#C4553A',
                        badge: 'LIVE'
                    }));
                })
                .catch(function () {
                    showError(content[1], 'ADS-B unavailable');
                });
        }
    }

    /**
     * Load data for the Predictions tab.
     */
    function loadPredictionsTab(pane) {
        var content = _getWidgetContents(pane);
        if (!content.length) return;

        var pm = ApiRegistry.get('polymarket');
        if (!pm) {
            if (content[0]) showEmpty(content[0], 'Polymarket API not loaded');
            return;
        }

        // Fetch top prediction markets
        content.slice(0, 6).forEach(function (el) { showSkeleton(el, 1); });

        pm.getEvents({ limit: 6, order: 'volume', active: true })
            .then(function (events) {
                var list = Array.isArray(events) ? events : [];
                list.slice(0, 6).forEach(function (evt, i) {
                    if (!content[i]) return;
                    content[i].innerHTML = '';

                    var market = evt.markets && evt.markets[0] ? evt.markets[0] : {};
                    content[i].appendChild(createPredictionCard({
                        question: evt.title || evt.question || 'Prediction Market',
                        probability: market.outcomePrices
                            ? parseFloat(JSON.parse(market.outcomePrices)[0])
                            : (market.bestAsk || 0.5),
                        volume: evt.volume || market.volume || 0
                    }));
                });
            })
            .catch(function () {
                if (content[0]) showError(content[0], 'Polymarket unavailable');
            });
    }

    /**
     * Load data for the Integrations tab - connection status for all APIs.
     */
    function loadIntegrationsTab(pane) {
        var content = _getWidgetContents(pane);
        if (!content.length) return;

        var registered = ApiRegistry.list();
        registered.forEach(function (name, i) {
            if (!content[i]) return;
            content[i].innerHTML = '';
            content[i].appendChild(createDataCard({
                title: name.charAt(0).toUpperCase() + name.slice(1),
                value: 'Connected',
                subtitle: 'via ApiRegistry',
                color: '#34C759',
                badge: 'ACTIVE'
            }));
        });

        // Fill remaining with "available to connect" placeholders
        var available = ['zillow', 'cloudflare', 'duckduckgo', 'openai'];
        for (var j = registered.length; j < content.length && j - registered.length < available.length; j++) {
            var apiName = available[j - registered.length];
            if (registered.indexOf(apiName) === -1) {
                content[j].innerHTML = '';
                content[j].appendChild(createDataCard({
                    title: apiName.charAt(0).toUpperCase() + apiName.slice(1),
                    value: 'Available',
                    subtitle: 'Click to configure',
                    color: '#778DA9',
                    badge: 'READY'
                }));
            }
        }
    }

    // ---------------------------------------------------------------------------
    // Tab Router
    // ---------------------------------------------------------------------------

    var TAB_LOADERS = {
        'row2-home':         loadHomeTab,
        'row2-us':           loadUSTab,
        'row2-global':       loadGlobalTab,
        'row2-predictions':  loadPredictionsTab,
        'row2-integrations': loadIntegrationsTab,
    };

    /**
     * Called when a tab becomes active. Loads data if not already initialized.
     * @param {string} tabId - The data-pane value (e.g., 'row2-home')
     */
    function activateTab(tabId) {
        _activeTab = tabId;
        var pane = document.querySelector('.btp-pane[data-pane="' + tabId + '"]');
        if (!pane) return;

        var loader = TAB_LOADERS[tabId];
        if (!loader) return;

        // Only load once per session (unless refresh is triggered)
        if (!_initialized[tabId]) {
            _initialized[tabId] = true;
            loader(pane);

            // Set up auto-refresh if enabled
            if (Q4Config.FEATURES.AUTO_REFRESH && Q4Config.FEATURES.REFRESH_INTERVAL) {
                _refreshTimers[tabId] = setInterval(function () {
                    if (_activeTab === tabId) {
                        loader(pane);
                    }
                }, Q4Config.FEATURES.REFRESH_INTERVAL);
            }
        }
    }

    /**
     * Force refresh data for the currently active tab.
     */
    function refreshActiveTab() {
        if (_activeTab && TAB_LOADERS[_activeTab]) {
            var pane = document.querySelector('.btp-pane[data-pane="' + _activeTab + '"]');
            if (pane) TAB_LOADERS[_activeTab](pane);
        }
    }

    // ---------------------------------------------------------------------------
    // Helpers
    // ---------------------------------------------------------------------------

    function _getWidgetContents(pane) {
        if (!pane) return [];
        return Array.prototype.slice.call(pane.querySelectorAll('.q4-widget-content'));
    }

    function _formatPrice(num) {
        if (num === undefined || num === null || isNaN(num)) return '--';
        return parseFloat(num).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }

    function _formatNumber(num, decimals) {
        if (num === undefined || num === null || isNaN(num)) return '--';
        var d = decimals !== undefined ? decimals : 0;
        if (num >= 1e12) return (num / 1e12).toFixed(d || 1) + 'T';
        if (num >= 1e9)  return (num / 1e9).toFixed(d || 1) + 'B';
        if (num >= 1e6)  return (num / 1e6).toFixed(d || 1) + 'M';
        if (num >= 1e3)  return (num / 1e3).toFixed(d || 1) + 'K';
        return num.toFixed(d);
    }

    // ---------------------------------------------------------------------------
    // Init: Listen for tab activations
    // ---------------------------------------------------------------------------

    function init() {
        // Configure APIs that need proxy mode
        _configureProxies();

        // Hook into existing tab click events
        document.querySelectorAll('.btp-tab').forEach(function (tab) {
            tab.addEventListener('click', function () {
                var target = this.getAttribute('data-tab');
                if (target) {
                    // Use requestIdleCallback for non-blocking data load
                    if (window.requestIdleCallback) {
                        requestIdleCallback(function () { activateTab(target); }, { timeout: 500 });
                    } else {
                        setTimeout(function () { activateTab(target); }, 100);
                    }
                }
            });
        });

        // Auto-load the default active tab (row2-home)
        setTimeout(function () {
            activateTab('row2-home');
        }, 1000);

        console.log('[DataBridge] Initialized. Registered APIs:', ApiRegistry.list().join(', '));
    }

    /**
     * Auto-configure APIs that need backend proxy routing.
     * Switches Polygon from direct API access to proxied mode
     * so the API key stays server-side.
     */
    function _configureProxies() {
        var base = Q4Config.API_BASE;
        if (!base) return;

        // Polygon: Switch to proxy mode if Q4Config has a valid API_BASE
        var polygon = ApiRegistry.get('polygon');
        if (polygon && polygon.setProxyMode) {
            polygon.setProxyMode(base + '/api/polygon');
            console.log('[DataBridge] Polygon API set to proxy mode:', base + '/api/polygon');
        }

        // Probe backend health (non-blocking)
        fetch(base + '/api/health', { method: 'GET' })
            .then(function (res) { return res.json(); })
            .then(function (data) {
                console.log('[DataBridge] Backend connected:', data.status || 'ok');
            })
            .catch(function () {
                console.warn('[DataBridge] Backend not reachable at', base, '- proxy-dependent APIs will fail gracefully');
            });
    }

    // Boot
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        // If DOM is already ready, delay slightly to let dashboard panels render first
        setTimeout(init, 500);
    }

    // ---------------------------------------------------------------------------
    // Public Interface
    // ---------------------------------------------------------------------------
    return {
        activateTab:      activateTab,
        refreshActiveTab: refreshActiveTab,
        createDataCard:   createDataCard,
        createScoreCard:  createScoreCard,
        createPredictionCard: createPredictionCard,
        showSkeleton:     showSkeleton,
        showError:        showError,
        showEmpty:        showEmpty
    };

})();
