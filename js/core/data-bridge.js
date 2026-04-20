/* ==========================================================================
   Q4NT PRO - Data Bridge (Refactored)
   Orchestrates lazy data fetching for bottom-panel tabs.
   
   ARCHITECTURE (Phase 3):
   - Data fetching functions emit events via Q4Events instead of directly
     manipulating the DOM.
   - UI rendering is handled by subscriber functions registered below.
   - This decoupling allows data sources to be tested independently
     and enables multiple UI consumers for the same data stream.

   Event Contract:
     Q4Events.emit('data:<tab>:loading', { paneId, widgetIndex })
     Q4Events.emit('data:<tab>:loaded',  { paneId, widgetIndex, data })
     Q4Events.emit('data:<tab>:error',   { paneId, widgetIndex, message })

   Depends on: api/config.js, api/api-cache.js, api/api-registry.js,
               js/core/event-bus.js
   ========================================================================== */

var DataBridge = (function () {

    // Track which tabs have been initialized (prevents duplicate fetches)
    var _initialized = {};

    // Track active refresh intervals per tab
    var _refreshTimers = {};

    // Current active tab
    var _activeTab = null;

    // ---------------------------------------------------------------------------
    // UI Primitives (Skeleton / Loading / Error / Empty)
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
    // Widget Card Builders
    // ---------------------------------------------------------------------------

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
    // Data Fetchers (emit events, do NOT touch the DOM)
    // ---------------------------------------------------------------------------

    function fetchHomeData(tabId) {
        var indices = [
            { title: 'S&P 500', symbol: 'SPY', color: '#1B2A4A' },
            { title: 'NASDAQ', symbol: 'QQQ', color: '#2E7D6F' },
            { title: 'DOW 30', symbol: 'DIA', color: '#C49B3C' },
            { title: 'Russell 2K', symbol: 'IWM', color: '#C4553A' }
        ];

        var polygon = ApiRegistry.get('polygon');
        if (!polygon) {
            indices.forEach(function (idx, i) {
                Q4Events.emit('data:widget:loaded', {
                    tabId: tabId, widgetIndex: i,
                    card: { title: idx.title, value: 'Connect API', subtitle: idx.symbol, color: idx.color, badge: 'OFFLINE' }
                });
            });
            return;
        }

        indices.forEach(function (idx, i) {
            Q4Events.emit('data:widget:loading', { tabId: tabId, widgetIndex: i });

            polygon.prevClose(idx.symbol)
                .then(function (data) {
                    if (data && data.results && data.results.length > 0) {
                        var r = data.results[0];
                        var change = r.c && r.o ? ((r.c - r.o) / r.o * 100).toFixed(2) : 0;
                        Q4Events.emit('data:widget:loaded', {
                            tabId: tabId, widgetIndex: i,
                            card: {
                                title: idx.title, value: '$' + _formatPrice(r.c),
                                change: change + '%', changeDir: change >= 0 ? 'up' : 'down',
                                subtitle: 'Vol: ' + _formatNumber(r.v), color: idx.color, badge: 'LIVE'
                            }
                        });
                    } else {
                        Q4Events.emit('data:widget:loaded', {
                            tabId: tabId, widgetIndex: i,
                            card: { title: idx.title, value: '--', subtitle: 'No data', color: idx.color }
                        });
                    }
                })
                .catch(function () {
                    Q4Events.emit('data:widget:error', {
                        tabId: tabId, widgetIndex: i,
                        card: { title: idx.title, value: '--', subtitle: 'API Error', color: idx.color }
                    });
                });
        });

        // Alpaca portfolio (widget 4)
        var alpaca = ApiRegistry.get('alpaca');
        if (alpaca) {
            Q4Events.emit('data:widget:loading', { tabId: tabId, widgetIndex: 4 });
            alpaca.getAccount()
                .then(function (acct) {
                    if (acct && acct.equity) {
                        var dayPL = acct.equity - (acct.last_equity || acct.equity);
                        Q4Events.emit('data:widget:loaded', {
                            tabId: tabId, widgetIndex: 4,
                            card: {
                                title: 'Portfolio Value',
                                value: '$' + _formatPrice(parseFloat(acct.equity)),
                                change: '$' + _formatPrice(Math.abs(dayPL)),
                                changeDir: dayPL >= 0 ? 'up' : 'down',
                                subtitle: 'Buying Power: $' + _formatPrice(parseFloat(acct.buying_power || 0)),
                                color: '#007AFF', badge: 'ALPACA'
                            }
                        });
                    }
                })
                .catch(function () {
                    Q4Events.emit('data:widget:error', {
                        tabId: tabId, widgetIndex: 4,
                        card: { title: 'Portfolio', value: 'Not Connected', subtitle: 'Connect Alpaca', color: '#007AFF' }
                    });
                });
        }
    }

    function fetchUSData(tabId) {
        var nba = ApiRegistry.get('nba');
        if (nba) {
            Q4Events.emit('data:widget:loading', { tabId: tabId, widgetIndex: 0 });
            nba.getTodaysScoreboard()
                .then(function (scoreboard) {
                    if (!scoreboard) {
                        Q4Events.emit('data:widget:empty', { tabId: tabId, widgetIndex: 0, message: 'No NBA games today' });
                        return;
                    }
                    var games = nba.parseScoreboard(scoreboard);
                    if (games.length === 0) {
                        Q4Events.emit('data:widget:empty', { tabId: tabId, widgetIndex: 0, message: 'No NBA games today' });
                        return;
                    }
                    Q4Events.emit('data:scores:loaded', { tabId: tabId, widgetIndex: 0, games: games.slice(0, 4) });
                })
                .catch(function () {
                    Q4Events.emit('data:widget:error', { tabId: tabId, widgetIndex: 0, message: 'NBA data unavailable' });
                });
        }

        var dk = ApiRegistry.get('draftkings');
        if (dk) {
            Q4Events.emit('data:widget:loading', { tabId: tabId, widgetIndex: 1 });
            dk.getContests('NBA')
                .then(function (data) {
                    if (data && data.Contests && data.Contests.length > 0) {
                        var cards = data.Contests.slice(0, 3).map(function (c) {
                            return {
                                title: c.n || 'Contest',
                                value: '$' + _formatNumber(c.po || 0),
                                subtitle: (c.ec || 0) + ' / ' + (c.m || 0) + ' entries',
                                color: '#2E7D6F', badge: 'DK'
                            };
                        });
                        Q4Events.emit('data:cards:loaded', { tabId: tabId, widgetIndex: 1, cards: cards });
                    } else {
                        Q4Events.emit('data:widget:empty', { tabId: tabId, widgetIndex: 1, message: 'No active contests' });
                    }
                })
                .catch(function () {
                    Q4Events.emit('data:widget:error', { tabId: tabId, widgetIndex: 1, message: 'DraftKings unavailable' });
                });
        }
    }

    function fetchGlobalData(tabId) {
        var wb = ApiRegistry.get('worldbank');
        if (wb) {
            Q4Events.emit('data:widget:loading', { tabId: tabId, widgetIndex: 0 });
            wb.gdp('USA', { mrv: 1 })
                .then(function (data) {
                    if (data && data[1] && data[1].length > 0) {
                        var entry = data[1][0];
                        Q4Events.emit('data:widget:loaded', {
                            tabId: tabId, widgetIndex: 0,
                            card: {
                                title: 'US GDP', value: '$' + _formatNumber(entry.value / 1e12, 2) + 'T',
                                subtitle: 'Year: ' + entry.date, color: '#1B2A4A', badge: 'WORLD BANK'
                            }
                        });
                    }
                })
                .catch(function () {
                    Q4Events.emit('data:widget:error', { tabId: tabId, widgetIndex: 0, message: 'World Bank API unavailable' });
                });
        }

        var adsb = ApiRegistry.get('adsb');
        if (adsb) {
            Q4Events.emit('data:widget:loading', { tabId: tabId, widgetIndex: 1 });
            adsb.military()
                .then(function (data) {
                    var count = data && data.ac ? data.ac.length : 0;
                    Q4Events.emit('data:widget:loaded', {
                        tabId: tabId, widgetIndex: 1,
                        card: { title: 'Military Aircraft', value: count + ' tracked', subtitle: 'Live ADS-B data', color: '#C4553A', badge: 'LIVE' }
                    });
                })
                .catch(function () {
                    Q4Events.emit('data:widget:error', { tabId: tabId, widgetIndex: 1, message: 'ADS-B unavailable' });
                });
        }
    }

    function fetchPredictionsData(tabId) {
        var pm = ApiRegistry.get('polymarket');
        if (!pm) {
            Q4Events.emit('data:widget:empty', { tabId: tabId, widgetIndex: 0, message: 'Polymarket API not loaded' });
            return;
        }

        for (var k = 0; k < 6; k++) {
            Q4Events.emit('data:widget:loading', { tabId: tabId, widgetIndex: k });
        }

        pm.getEvents({ limit: 6, order: 'volume', active: true })
            .then(function (events) {
                var list = Array.isArray(events) ? events : [];
                list.slice(0, 6).forEach(function (evt, i) {
                    var market = evt.markets && evt.markets[0] ? evt.markets[0] : {};
                    Q4Events.emit('data:prediction:loaded', {
                        tabId: tabId, widgetIndex: i,
                        prediction: {
                            question: evt.title || evt.question || 'Prediction Market',
                            probability: market.outcomePrices
                                ? parseFloat(JSON.parse(market.outcomePrices)[0])
                                : (market.bestAsk || 0.5),
                            volume: evt.volume || market.volume || 0
                        }
                    });
                });
            })
            .catch(function () {
                Q4Events.emit('data:widget:error', { tabId: tabId, widgetIndex: 0, message: 'Polymarket unavailable' });
            });
    }

    function fetchIntegrationsData(tabId) {
        var registered = ApiRegistry.list();
        registered.forEach(function (name, i) {
            Q4Events.emit('data:widget:loaded', {
                tabId: tabId, widgetIndex: i,
                card: {
                    title: name.charAt(0).toUpperCase() + name.slice(1),
                    value: 'Connected', subtitle: 'via ApiRegistry', color: '#34C759', badge: 'ACTIVE'
                }
            });
        });

        var available = ['zillow', 'cloudflare', 'duckduckgo', 'openai'];
        for (var j = 0; j < available.length; j++) {
            var apiName = available[j];
            if (registered.indexOf(apiName) === -1) {
                Q4Events.emit('data:widget:loaded', {
                    tabId: tabId, widgetIndex: registered.length + j,
                    card: {
                        title: apiName.charAt(0).toUpperCase() + apiName.slice(1),
                        value: 'Available', subtitle: 'Click to configure', color: '#778DA9', badge: 'READY'
                    }
                });
            }
        }
    }

    // ---------------------------------------------------------------------------
    // UI Renderers (subscribe to events, manage DOM)
    // ---------------------------------------------------------------------------

    function _getWidgetContent(tabId, widgetIndex) {
        var pane = document.querySelector('.btp-pane[data-pane="' + tabId + '"]');
        if (!pane) return null;
        var widgets = Array.prototype.slice.call(pane.querySelectorAll('.q4-widget-content'));
        return widgets[widgetIndex] || null;
    }

    // Subscribe: loading state
    Q4Events.on('data:widget:loading', function (payload) {
        var el = _getWidgetContent(payload.tabId, payload.widgetIndex);
        if (el) showSkeleton(el, 1);
    });

    // Subscribe: single data card
    Q4Events.on('data:widget:loaded', function (payload) {
        var el = _getWidgetContent(payload.tabId, payload.widgetIndex);
        if (!el) return;
        el.innerHTML = '';
        el.appendChild(createDataCard(payload.card));
    });

    // Subscribe: error state
    Q4Events.on('data:widget:error', function (payload) {
        var el = _getWidgetContent(payload.tabId, payload.widgetIndex);
        if (!el) return;
        if (payload.card) {
            el.innerHTML = '';
            el.appendChild(createDataCard(payload.card));
        } else {
            showError(el, payload.message);
        }
    });

    // Subscribe: empty state
    Q4Events.on('data:widget:empty', function (payload) {
        var el = _getWidgetContent(payload.tabId, payload.widgetIndex);
        if (el) showEmpty(el, payload.message);
    });

    // Subscribe: score cards (sports)
    Q4Events.on('data:scores:loaded', function (payload) {
        var el = _getWidgetContent(payload.tabId, payload.widgetIndex);
        if (!el) return;
        el.innerHTML = '';
        var frag = document.createDocumentFragment();
        payload.games.forEach(function (g) { frag.appendChild(createScoreCard(g)); });
        el.appendChild(frag);
    });

    // Subscribe: multiple data cards
    Q4Events.on('data:cards:loaded', function (payload) {
        var el = _getWidgetContent(payload.tabId, payload.widgetIndex);
        if (!el) return;
        el.innerHTML = '';
        var frag = document.createDocumentFragment();
        payload.cards.forEach(function (c) { frag.appendChild(createDataCard(c)); });
        el.appendChild(frag);
    });

    // Subscribe: prediction cards
    Q4Events.on('data:prediction:loaded', function (payload) {
        var el = _getWidgetContent(payload.tabId, payload.widgetIndex);
        if (!el) return;
        el.innerHTML = '';
        el.appendChild(createPredictionCard(payload.prediction));
    });

    // ---------------------------------------------------------------------------
    // Tab Router
    // ---------------------------------------------------------------------------

    var TAB_FETCHERS = {
        'row2-home':         fetchHomeData,
        'row2-us':           fetchUSData,
        'row2-global':       fetchGlobalData,
        'row2-predictions':  fetchPredictionsData,
        'row2-integrations': fetchIntegrationsData,
    };

    function activateTab(tabId) {
        _activeTab = tabId;
        var pane = document.querySelector('.btp-pane[data-pane="' + tabId + '"]');
        if (!pane) return;

        var fetcher = TAB_FETCHERS[tabId];
        if (!fetcher) return;

        if (!_initialized[tabId]) {
            _initialized[tabId] = true;
            fetcher(tabId);

            // Set up auto-refresh if enabled
            if (Q4Config.FEATURES.AUTO_REFRESH && Q4Config.FEATURES.REFRESH_INTERVAL) {
                _refreshTimers[tabId] = setInterval(function () {
                    if (_activeTab === tabId) {
                        fetcher(tabId);
                    }
                }, Q4Config.FEATURES.REFRESH_INTERVAL);
            }
        }
    }

    function refreshActiveTab() {
        if (_activeTab && TAB_FETCHERS[_activeTab]) {
            TAB_FETCHERS[_activeTab](_activeTab);
        }
    }

    // ---------------------------------------------------------------------------
    // Helpers
    // ---------------------------------------------------------------------------

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
    // Init
    // ---------------------------------------------------------------------------

    function _configureProxies() {
        var base = Q4Config.API_BASE;
        if (!base) return;

        fetch(base + '/api/health', { method: 'GET' })
            .then(function (res) { return res.json(); })
            .then(function (data) {
                console.log('[DataBridge] Backend connected:', data.status || 'ok');
                Q4Events.emit('system:backend:connected', data);
            })
            .catch(function () {
                console.warn('[DataBridge] Backend not reachable at', base, '- proxy-dependent APIs will fail gracefully');
                Q4Events.emit('system:backend:disconnected', { url: base });
            });
    }

    function init() {
        _configureProxies();

        document.querySelectorAll('.btp-tab').forEach(function (tab) {
            tab.addEventListener('click', function () {
                var target = this.getAttribute('data-tab');
                if (target) {
                    if (window.requestIdleCallback) {
                        requestIdleCallback(function () { activateTab(target); }, { timeout: 500 });
                    } else {
                        setTimeout(function () { activateTab(target); }, 100);
                    }
                }
            });
        });

        setTimeout(function () {
            activateTab('row2-home');
        }, 1000);

        console.log('[DataBridge] Initialized with event-driven architecture. Registered APIs:', ApiRegistry.list().join(', '));
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
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
