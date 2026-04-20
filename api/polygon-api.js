// ===== Polygon.io / Massive.com API Client =====
// Frontend module for querying the Polygon.io (Massive.com) REST API.
// Requires an API key from https://massive.com (free tier: 5 req/min).
// Depends on: core/api-cache.js

var PolygonAPI = (function () {

    // All requests route through the backend proxy — credentials are injected server-side.
    // Direct calls to api.polygon.io are never made from the browser.
    var baseUrl = typeof Q4Config !== 'undefined'
        ? (Q4Config.API_BASE + '/api/polygon')
        : 'http://127.0.0.1:8000/api/polygon';
    var _cache = ApiCache.create(60 * 1000); // 1 minute

    function request(path, params) {
        var p = params || {};
        var url = ApiCache.buildUrl(baseUrl, path, p);
        return ApiCache.fetchCached(url, _cache, 'Polygon API');
    }

    function aggregates(ticker, multiplier, timespan, from, to, opts) {
        var o = opts || {};
        return request('/v2/aggs/ticker/' + encodeURIComponent(ticker) +
            '/range/' + multiplier + '/' + timespan + '/' + from + '/' + to, {
            adjusted: o.adjusted !== undefined ? o.adjusted : 'true',
            sort: o.sort || 'asc',
            limit: o.limit || 5000
        });
    }

    function prevClose(ticker) {
        return request('/v2/aggs/ticker/' + encodeURIComponent(ticker) + '/prev', { adjusted: 'true' });
    }

    function tickerDetails(ticker) {
        return request('/v3/reference/tickers/' + encodeURIComponent(ticker), {});
    }

    function tickerSearch(query, opts) {
        var o = opts || {};
        return request('/v3/reference/tickers', {
            search: query, type: o.type, market: o.market || 'stocks',
            active: 'true', limit: o.limit || 20
        });
    }

    function snapshotAll() {
        return request('/v2/snapshot/locale/us/markets/stocks/tickers', {});
    }

    function snapshot(ticker) {
        return request('/v2/snapshot/locale/us/markets/stocks/tickers/' + encodeURIComponent(ticker), {});
    }

    function news(ticker, opts) {
        var o = opts || {};
        var params = { limit: o.limit || 10, order: o.order || 'desc', sort: o.sort || 'published_utc' };
        if (ticker) params.ticker = ticker;
        return request('/v2/reference/news', params);
    }

    function health() {
        return request('/v1/marketstatus/now', {});
    }

    // ===== Stocks Starter: Technical Indicators =====
    // GET /v1/indicators/sma/{ticker}, /ema/{ticker}, /rsi/{ticker}, /macd/{ticker}
    function technicalIndicator(ticker, indicator, opts) {
        var o = opts || {};
        var params = {
            timespan: o.timespan || 'day',
            adjusted: o.adjusted !== undefined ? o.adjusted : 'true',
            window: o.window || 14,
            series_type: o.series_type || 'close',
            order: o.order || 'desc',
            limit: o.limit || 50
        };
        // MACD has extra params
        if (indicator === 'macd') {
            params.short_window = o.short_window || 12;
            params.long_window = o.long_window || 26;
            params.signal_window = o.signal_window || 9;
            delete params.window;
        }
        return request('/v1/indicators/' + indicator + '/' + encodeURIComponent(ticker), params);
    }

    // ===== Stocks Starter: Financials (Fundamentals) =====
    // GET /vX/reference/financials
    function financials(ticker, opts) {
        var o = opts || {};
        return request('/vX/reference/financials', {
            ticker: ticker,
            timeframe: o.timeframe || 'quarterly',
            limit: o.limit || 4,
            order: o.order || 'desc',
            sort: o.sort || 'filing_date'
        });
    }

    // ===== Stocks Starter: Dividends =====
    // GET /v3/reference/dividends
    function dividends(ticker, opts) {
        var o = opts || {};
        return request('/v3/reference/dividends', {
            ticker: ticker,
            limit: o.limit || 10,
            order: o.order || 'desc',
            sort: o.sort || 'ex_dividend_date'
        });
    }

    // ===== Stocks Starter: Stock Splits =====
    // GET /v3/reference/splits
    function splits(ticker, opts) {
        var o = opts || {};
        return request('/v3/reference/splits', {
            ticker: ticker,
            limit: o.limit || 10,
            order: o.order || 'desc',
            sort: o.sort || 'execution_date'
        });
    }

    // ===== Stocks Starter: Trades =====
    // GET /v3/trades/{ticker}
    function trades(ticker, opts) {
        var o = opts || {};
        var params = { limit: o.limit || 50, order: o.order || 'desc', sort: o.sort || 'timestamp' };
        if (o.timestamp_gte) params['timestamp.gte'] = o.timestamp_gte;
        if (o.timestamp_lte) params['timestamp.lte'] = o.timestamp_lte;
        return request('/v3/trades/' + encodeURIComponent(ticker), params);
    }

    // ===== Stocks Starter: Quotes =====
    // GET /v3/quotes/{ticker}
    function quotes(ticker, opts) {
        var o = opts || {};
        var params = { limit: o.limit || 50, order: o.order || 'desc', sort: o.sort || 'timestamp' };
        if (o.timestamp_gte) params['timestamp.gte'] = o.timestamp_gte;
        if (o.timestamp_lte) params['timestamp.lte'] = o.timestamp_lte;
        return request('/v3/quotes/' + encodeURIComponent(ticker), params);
    }

    // ===== Market Holidays =====
    // GET /v1/marketstatus/upcoming
    function marketHolidays() {
        return request('/v1/marketstatus/upcoming', {});
    }

    return {
        aggregates: aggregates, prevClose: prevClose, tickerDetails: tickerDetails,
        tickerSearch: tickerSearch, snapshotAll: snapshotAll, snapshot: snapshot,
        news: news, health: health,
        technicalIndicator: technicalIndicator,
        financials: financials, dividends: dividends, splits: splits,
        trades: trades, quotes: quotes, marketHolidays: marketHolidays,
        clearCache: function () { _cache.clear(); }
    };

})();
if (typeof ApiRegistry !== 'undefined') ApiRegistry.register('polygon', PolygonAPI);
