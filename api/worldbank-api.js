// ===== World Bank API Client =====
// Frontend module for querying the World Bank Indicators API (V2).
// Free, no authentication required. CORS-enabled.
// Depends on: core/api-cache.js

var WorldBankAPI = (function () {

    var baseUrl = 'https://api.worldbank.org/v2';
    var _cache = ApiCache.create(10 * 60 * 1000); // 10 minutes

    function setBaseUrl(url) { baseUrl = url.replace(/\/$/, ''); }

    function request(path, params) {
        var p = { format: 'json', per_page: 100 };
        if (params) {
            for (var k in params) {
                if (params[k] !== undefined && params[k] !== null) p[k] = params[k];
            }
        }
        return ApiCache.fetchCached(ApiCache.buildUrl(baseUrl, path, p), _cache, 'World Bank API');
    }

    function indicator(indicatorCode, country, opts) {
        var o = opts || {};
        return request('/country/' + encodeURIComponent(country || 'all') + '/indicator/' + encodeURIComponent(indicatorCode), {
            date: o.date, per_page: o.per_page, page: o.page, mrv: o.mrv
        });
    }

    function countries(opts) {
        var o = opts || {};
        return request('/country', { per_page: o.per_page || 300, page: o.page });
    }

    function indicators(opts) {
        var o = opts || {};
        return request('/indicator', { per_page: o.per_page || 50, page: o.page });
    }

    function searchIndicators(query, opts) {
        var o = opts || {};
        return request('/indicator', { search: query, per_page: o.per_page || 50, page: o.page });
    }

    return {
        setBaseUrl: setBaseUrl,
        indicator: indicator, countries: countries, indicators: indicators, searchIndicators: searchIndicators,
        sources: function () { return request('/source', {}); },
        topics: function () { return request('/topic', {}); },
        gdp: function (country, opts) { return indicator('NY.GDP.MKTP.CD', country, opts); },
        population: function (country, opts) { return indicator('SP.POP.TOTL', country, opts); },
        inflation: function (country, opts) { return indicator('FP.CPI.TOTL.ZG', country, opts); },
        unemployment: function (country, opts) { return indicator('SL.UEM.TOTL.ZS', country, opts); },
        gdpGrowth: function (country, opts) { return indicator('NY.GDP.MKTP.KD.ZG', country, opts); },
        gniPerCapita: function (country, opts) { return indicator('NY.GNP.PCAP.CD', country, opts); },
        clearCache: function () { _cache.clear(); }
    };

})();
if (typeof ApiRegistry !== 'undefined') ApiRegistry.register('worldbank', WorldBankAPI);
