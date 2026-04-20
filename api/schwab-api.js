// ===== Charles Schwab Trader API Client =====
// Frontend module for Schwab trading via the Q4NT backend proxy.
// OAuth flow and all API calls route through /api/schwab/* -- credentials
// and tokens are managed server-side. No secrets in the browser.
// Depends on: core/api-cache.js, core/config.js

var SchwabAPI = (function () {

    // All calls go through the backend proxy
    var apiBase = typeof Q4Config !== 'undefined' ? Q4Config.API_BASE : 'http://127.0.0.1:5052';
    var _cache = ApiCache.create(30 * 1000); // 30 seconds

    // ---- Internal helpers (all via backend proxy) ----

    function _get(path, params) {
        var url = ApiCache.buildUrl(apiBase, path, params);
        return ApiCache.fetchCached(url, _cache, 'Schwab API');
    }

    function _post(path, body) {
        return fetch(apiBase + path, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        }).then(function (res) {
            if (!res.ok) {
                return res.json().catch(function () { return {}; }).then(function (err) {
                    throw new Error(err.message || err.error || 'Schwab API error ' + res.status);
                });
            }
            if (res.status === 201 || res.status === 204) return {};
            return res.json();
        });
    }

    // ---- Credential management is now server-side ----
    function setCredentials(key, secret) {
        // Credentials are set via environment variables on the backend.
        // This is a no-op for backward compatibility.
        console.log('[SchwabAPI] setCredentials() is a no-op. Configure SCHWAB_APP_KEY/SECRET in backend .env');
    }

    function setTokens(access, refresh) {
        // Tokens are managed server-side via OAuth flow.
        console.log('[SchwabAPI] setTokens() is a no-op. Use /api/schwab/auth to authenticate.');
    }

    // ---- OAuth Flow (server-side) ----

    function getAuthorizationUrl() {
        // Get the auth URL from the backend (it knows the app key and callback URL)
        return _get('/api/schwab/auth').then(function (data) {
            return data.auth_url || '';
        });
    }

    function exchangeCode(code, redirectUri) {
        // The backend handles this via /api/schwab/callback?code=...
        return _get('/api/schwab/callback', { code: code });
    }

    function refreshAccessToken() {
        // Token refresh is automatic in the backend
        return _get('/api/schwab/status');
    }

    function getStatus() {
        return _get('/api/schwab/status');
    }

    // ===== Accounts =====
    function getAccounts(opts) {
        return _get('/api/schwab/account');
    }

    function getAccount(hashId, opts) {
        return _get('/api/schwab/account');
    }

    function getAccountNumbers() {
        return _get('/api/schwab/account').then(function (data) {
            var accounts = data.accounts || [];
            return accounts.map(function (a) { return a.account_hash; });
        });
    }

    // ===== Orders =====
    function getOrders(hashId, opts) {
        // Backend doesn't expose order listing yet -- return empty
        return Promise.resolve({ orders: [] });
    }

    function createOrder(hashId, orderSpec) {
        return Promise.resolve({ error: 'Schwab order placement not yet proxied through backend' });
    }

    function getOrder(hashId, orderId) {
        return Promise.resolve({});
    }

    function cancelOrder(hashId, orderId) {
        return Promise.resolve({});
    }

    // ===== Transactions =====
    function getTransactions(hashId, opts) {
        return Promise.resolve({ transactions: [] });
    }

    // ===== Market Data: Quotes =====
    function getQuotes(symbols) {
        var symStr = Array.isArray(symbols) ? symbols.join(',') : symbols;
        return _get('/api/schwab/quotes', { symbols: symStr }).then(function (data) {
            return data.quotes || data;
        });
    }

    function getQuote(symbol) {
        return _get('/api/schwab/quotes', { symbols: symbol }).then(function (data) {
            var quotes = data.quotes || {};
            return quotes[symbol] || {};
        });
    }

    // ===== Market Data: Price History =====
    function getPriceHistory(symbol, opts) {
        var o = opts || {};
        return _get('/api/schwab/pricehistory', {
            symbol: symbol,
            period_type: o.periodType || 'month',
            period: o.period || 1,
            frequency_type: o.frequencyType || 'daily',
            frequency: o.frequency || 1
        });
    }

    // ===== Market Data: Movers =====
    function getMovers(indexSymbol, opts) {
        var o = opts || {};
        return _get('/api/schwab/movers', {
            index: indexSymbol,
            direction: o.direction || 'up',
            change_type: o.change_type || 'percent'
        }).then(function (data) {
            return data.movers || data;
        });
    }

    // ===== Market Data: Chains (Options) =====
    function getOptionChain(symbol, opts) {
        var o = opts || {};
        return _get('/api/schwab/chains', {
            symbol: symbol,
            strike_count: o.strikeCount || 10,
            strategy: o.strategy || 'SINGLE'
        });
    }

    // ===== Market Data: Market Hours =====
    function getMarketHours(markets) {
        // Not proxied yet
        return Promise.resolve({});
    }

    // ===== Market Data: Instruments =====
    function searchInstruments(symbol, projection) {
        return Promise.resolve({ instruments: [] });
    }

    return {
        // Auth (server-side)
        setCredentials: setCredentials, setTokens: setTokens,
        getAuthorizationUrl: getAuthorizationUrl,
        exchangeCode: exchangeCode, refreshAccessToken: refreshAccessToken,
        getStatus: getStatus,
        // Accounts
        getAccounts: getAccounts, getAccount: getAccount, getAccountNumbers: getAccountNumbers,
        // Orders
        getOrders: getOrders, getOrder: getOrder,
        createOrder: createOrder, cancelOrder: cancelOrder,
        // Transactions
        getTransactions: getTransactions,
        // Market Data
        getQuote: getQuote, getQuotes: getQuotes,
        getPriceHistory: getPriceHistory, getMovers: getMovers,
        getOptionChain: getOptionChain, getMarketHours: getMarketHours,
        searchInstruments: searchInstruments,
        // Cache
        clearCache: function () { _cache.clear(); }
    };

})();

if (typeof ApiRegistry !== 'undefined') ApiRegistry.register('schwab', SchwabAPI);
