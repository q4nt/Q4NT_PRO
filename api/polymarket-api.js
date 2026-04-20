// ===== Polymarket Prediction Markets API Client =====
// Frontend module for the Polymarket CLOB + Gamma REST APIs.
// CLOB API: https://clob.polymarket.com (order book, prices, trades)
// Gamma API: https://gamma-api.polymarket.com (markets, events metadata)
// Public read endpoints do not require authentication.
// Depends on: core/api-cache.js

var PolymarketAPI = (function () {

    var clobBase = 'https://clob.polymarket.com';
    var gammaBase = 'https://gamma-api.polymarket.com';
    // Route Gamma API calls through the typed backend proxy (/api/proxy/polymarket/)
    var proxyBase = typeof Q4Config !== 'undefined' ? (Q4Config.API_BASE + '/api/proxy/polymarket') : 'http://127.0.0.1:5052/api/proxy/polymarket';
    var apiKey = '';
    var _cache = ApiCache.create(60 * 1000); // 1 minute

    function setApiKey(key) { apiKey = key; }

    // ---- Internal helpers ----

    function _get(base, path, params) {
        var url;
        if (base === gammaBase) {
            // Route through backend typed proxy: /api/proxy/polymarket/<path>?<params>
            var qsParts = [];
            if (params) {
                for (var k in params) {
                    if (params[k] !== undefined && params[k] !== null) {
                        qsParts.push(encodeURIComponent(k) + '=' + encodeURIComponent(params[k]));
                    }
                }
            }
            url = proxyBase + path + (qsParts.length ? '?' + qsParts.join('&') : '');
        } else {
            url = ApiCache.buildUrl(base, path, params);
        }
        var headers = { 'Content-Type': 'application/json' };
        if (apiKey) headers['Authorization'] = 'Bearer ' + apiKey;
        return ApiCache.fetchCachedWithHeaders(url, _cache, headers, 'Polymarket API');
    }

    function _gammaListParams(o) {
        return {
            limit: o.limit || 20, offset: o.offset || 0,
            active: o.active !== undefined ? o.active : true,
            closed: o.closed !== undefined ? o.closed : false,
            order: o.order || 'volume',
            ascending: o.ascending !== undefined ? o.ascending : false,
            tag: o.tag
        };
    }

    // ===== Gamma API: Events =====
    // GET /events (list prediction market events)
    function getEvents(opts) {
        return _get(gammaBase, '/events', _gammaListParams(opts || {}));
    }

    // GET /events/{slug}
    function getEvent(slug) {
        return _get(gammaBase, '/events/' + encodeURIComponent(slug));
    }

    // ===== Gamma API: Markets =====
    // GET /markets (list individual markets within events)
    function getMarkets(opts) {
        return _get(gammaBase, '/markets', _gammaListParams(opts || {}));
    }

    // GET /markets/{conditionId}
    function getMarket(conditionId) {
        return _get(gammaBase, '/markets/' + encodeURIComponent(conditionId));
    }

    // ===== CLOB API: Prices =====
    // GET /prices
    function getPrices(opts) {
        var o = opts || {};
        return _get(clobBase, '/prices', {
            token_id: o.tokenId,
            fidelity: o.fidelity || 1
        });
    }

    // GET /price (single token midpoint)
    function getMidpoint(tokenId) {
        return _get(clobBase, '/price', { token_id: tokenId });
    }

    // ===== CLOB API: Order Book =====
    // GET /book
    function getOrderBook(tokenId) {
        return _get(clobBase, '/book', { token_id: tokenId });
    }

    // ===== CLOB API: Trades =====
    // GET /trades
    function getTrades(opts) {
        var o = opts || {};
        return _get(clobBase, '/trades', {
            market: o.market,
            maker: o.maker,
            limit: o.limit || 50,
            before: o.before,
            after: o.after
        });
    }

    // ===== CLOB API: Markets List (CLOB side) =====
    // GET /markets (returns token IDs + conditions)
    function getClobMarkets(opts) {
        var o = opts || {};
        return _get(clobBase, '/markets', {
            next_cursor: o.nextCursor
        });
    }

    // GET /markets/{conditionId} (CLOB detail)
    function getClobMarket(conditionId) {
        return _get(clobBase, '/markets/' + encodeURIComponent(conditionId));
    }

    // ===== CLOB API: Spread =====
    // GET /spread
    function getSpread(tokenId) {
        return _get(clobBase, '/spread', { token_id: tokenId });
    }

    // ===== CLOB API: Last Trade Price =====
    // GET /last-trade-price
    function getLastTradePrice(tokenId) {
        return _get(clobBase, '/last-trade-price', { token_id: tokenId });
    }

    // ===== Gamma API: Tags (categories) =====
    // GET /tags (market categories)
    function getTags() {
        return _get(gammaBase, '/tags');
    }
    // ===== Proxy API: Search =====
    // GET /api/polymarket/search (proxy backend endpoint)
    function search(query, opts) {
        var o = opts || {};
        var urlBase = typeof Q4Config !== 'undefined' ? Q4Config.API_BASE : 'http://127.0.0.1:5052';
        var url = urlBase + '/api/polymarket/search?q=' + encodeURIComponent(query);
        if (o.limit) url += '&limit=' + o.limit;
        if (o.space) url += '&space=' + o.space;
        
        return ApiCache.fetchCachedWithHeaders(url, _cache, {}, 'Polymarket Search').then(function(data) {
            return data.markets || data.results || [];
        });
    }

    return {
        setApiKey: setApiKey,
        // Gamma: Events & Markets
        getEvents: getEvents, getEvent: getEvent,
        getMarkets: getMarkets, getMarket: getMarket,
        getTags: getTags,
        search: search,
        // CLOB: Prices & Order Book
        getPrices: getPrices, getMidpoint: getMidpoint,
        getOrderBook: getOrderBook, getSpread: getSpread,
        getLastTradePrice: getLastTradePrice,
        // CLOB: Trades & Markets
        getTrades: getTrades,
        getClobMarkets: getClobMarkets, getClobMarket: getClobMarket,
        // Cache
        clearCache: function () { _cache.clear(); }
    };

})();
if (typeof ApiRegistry !== 'undefined') ApiRegistry.register('polymarket', PolymarketAPI);
