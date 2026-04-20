// ===== Alpaca Trading & Market Data API Client =====
// Frontend module for Alpaca trading via the Q4NT backend proxy.
// All calls route through /api/alpaca/* -- credentials are stored server-side.
// No broker secrets are sent from the browser.
// Depends on: core/api-cache.js, core/config.js

var AlpacaAPI = (function () {

    // All calls go through the backend proxy
    var apiBase = typeof Q4Config !== 'undefined' ? Q4Config.API_BASE : 'http://127.0.0.1:5052';
    var _cache = ApiCache.create(30 * 1000); // 30 seconds

    // ---- Internal request helpers (all via backend proxy) ----

    function _get(path, params) {
        var url = ApiCache.buildUrl(apiBase, path, params);
        return ApiCache.fetchCached(url, _cache, 'Alpaca API');
    }

    function _post(path, body) {
        return fetch(apiBase + path, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        }).then(function (res) {
            if (!res.ok) {
                return res.json().catch(function () { return {}; }).then(function (err) {
                    throw new Error(err.message || err.error || 'Alpaca API error ' + res.status);
                });
            }
            return res.json();
        });
    }

    function _del(path) {
        return fetch(apiBase + path, { method: 'DELETE' })
            .then(function (res) {
                if (!res.ok) throw new Error('Alpaca API error ' + res.status);
                if (res.status === 204) return {};
                return res.json();
            });
    }

    // ===== Connection =====
    // POST /api/alpaca/test-connection (sends credentials to backend for storage)
    function setCredentials(key, secret, isPaper) {
        var baseUrl = isPaper === false
            ? 'https://api.alpaca.markets'
            : 'https://paper-api.alpaca.markets';
        return _post('/api/alpaca/test-connection', {
            api_key: key,
            api_secret: secret,
            base_url: baseUrl
        });
    }

    // setPaper is now handled server-side via test-connection
    function setPaper(isPaper) {
        // No-op: paper/live is set during setCredentials()
    }

    // ===== Account =====
    function getAccount() {
        return _get('/api/alpaca/account');
    }

    // ===== Positions =====
    function getPositions() {
        return _get('/api/alpaca/positions').then(function (data) {
            return data.positions || data;
        });
    }

    function getPosition(symbolOrId) {
        return _get('/api/alpaca/positions', { symbol: symbolOrId }).then(function (data) {
            var positions = data.positions || [];
            return positions.length > 0 ? positions[0] : null;
        });
    }

    function closeAllPositions() {
        return _del('/api/alpaca/positions');
    }

    function closePosition(symbolOrId) {
        return _del('/api/alpaca/positions/' + encodeURIComponent(symbolOrId));
    }

    // ===== Orders =====
    function getOrders(opts) {
        var o = opts || {};
        return _get('/api/alpaca/orders', {
            status: o.status || 'open',
            limit: o.limit || 20
        }).then(function (data) {
            return data.orders || data;
        });
    }

    function getOrder(orderId) {
        return _get('/api/alpaca/orders/' + encodeURIComponent(orderId));
    }

    function createOrder(symbol, qty, side, type, timeInForce, opts) {
        var o = opts || {};
        var body = {
            symbol: symbol,
            qty: parseFloat(qty),
            side: side,
            type: type,
            time_in_force: timeInForce || 'day'
        };
        if (o.limit_price) body.limit_price = parseFloat(o.limit_price);
        if (o.stop_price) body.stop_price = parseFloat(o.stop_price);
        return _post('/api/alpaca/orders', body);
    }

    function cancelOrder(orderId) {
        return _del('/api/alpaca/orders/' + encodeURIComponent(orderId));
    }

    function cancelAllOrders() {
        return _del('/api/alpaca/orders');
    }

    // ===== Portfolio History =====
    function getPortfolioHistory(opts) {
        var o = opts || {};
        return _get('/api/alpaca/portfolio/history', {
            period: o.period || '1M',
            timeframe: o.timeframe || '1D'
        });
    }

    // ===== Assets =====
    function getAssets(opts) {
        // Not proxied yet -- return empty for now
        return Promise.resolve([]);
    }

    function getAsset(symbol) {
        return _get('/api/alpaca/assets/' + encodeURIComponent(symbol));
    }

    // ===== Market Data =====
    // Market data calls go through backend proxy (which uses server-side Alpaca credentials)
    function getBars(symbol, timeframe, opts) {
        // Market data bars not proxied yet -- return empty
        return Promise.resolve({ bars: [] });
    }

    function getLatestQuote(symbol) {
        return Promise.resolve({});
    }

    function getLatestTrade(symbol) {
        return Promise.resolve({});
    }

    function getSnapshot(symbol) {
        return Promise.resolve({});
    }

    function getSnapshots(symbols) {
        return Promise.resolve({});
    }

    // ===== Clock & Calendar =====
    function getClock() {
        return _get('/api/alpaca/market/clock');
    }

    function getCalendar(opts) {
        // Not proxied yet
        return Promise.resolve([]);
    }

    // ===== Watchlists =====
    function getWatchlists() {
        return Promise.resolve([]);
    }

    return {
        setCredentials: setCredentials,
        setPaper: setPaper,
        // Account
        getAccount: getAccount,
        // Positions
        getPositions: getPositions, getPosition: getPosition,
        closeAllPositions: closeAllPositions, closePosition: closePosition,
        // Orders
        getOrders: getOrders, getOrder: getOrder, createOrder: createOrder,
        cancelOrder: cancelOrder, cancelAllOrders: cancelAllOrders,
        // Portfolio
        getPortfolioHistory: getPortfolioHistory,
        // Assets
        getAssets: getAssets, getAsset: getAsset,
        // Market Data
        getBars: getBars, getLatestQuote: getLatestQuote, getLatestTrade: getLatestTrade,
        getSnapshot: getSnapshot, getSnapshots: getSnapshots,
        // Clock / Calendar
        getClock: getClock, getCalendar: getCalendar,
        // Watchlists
        getWatchlists: getWatchlists,
        // Cache
        clearCache: function () { _cache.clear(); }
    };

})();

if (typeof ApiRegistry !== 'undefined') ApiRegistry.register('alpaca', AlpacaAPI);
