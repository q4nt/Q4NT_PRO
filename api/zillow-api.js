// ===== Zillow API Client =====
// Frontend module for querying the Zillow API via the Cloudflare Worker proxy.
// Depends on: core/api-cache.js

var ZillowAPI = (function () {

    var baseUrl = '';
    var _cache = ApiCache.create(5 * 60 * 1000); // 5 minutes

    function setBaseUrl(url) { baseUrl = url.replace(/\/$/, ''); }

    function request(path, params) {
        return ApiCache.fetchCached(ApiCache.buildUrl(baseUrl, path, params), _cache, 'Zillow API');
    }

    // Shared param builder for search and searchRentals (identical shape)
    function _buildSearchParams(location, opts) {
        var o = opts || {};
        return {
            location: location, page: o.page, home_type: o.home_type, sort: o.sort,
            minPrice: o.minPrice, maxPrice: o.maxPrice, bedsMin: o.bedsMin, bathsMin: o.bathsMin
        };
    }

    function search(location, opts) {
        return request('/api/zillow/search', _buildSearchParams(location, opts));
    }

    function searchRentals(location, opts) {
        return request('/api/zillow/rentals', _buildSearchParams(location, opts));
    }

    return {
        setBaseUrl: setBaseUrl,
        search: search, searchRentals: searchRentals,
        getProperty: function (zpid) { return request('/api/zillow/property', { zpid: zpid }); },
        getImages: function (zpid) { return request('/api/zillow/images', { zpid: zpid }); },
        getSimilar: function (zpid) { return request('/api/zillow/similar', { zpid: zpid }); },
        health: function () { return request('/api/zillow/health', {}); },
        clearCache: function () { _cache.clear(); }
    };

})();
if (typeof ApiRegistry !== 'undefined') ApiRegistry.register('zillow', ZillowAPI);
