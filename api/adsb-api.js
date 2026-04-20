// ===== ADSB.lol API Client =====
// Frontend module for querying live ADS-B flight data from adsb.lol.
// Free, open-source, no API key required. CORS-enabled.
// Depends on: core/api-cache.js

var AdsbAPI = (function () {

    var baseUrl = 'https://api.adsb.lol';
    var _cache = ApiCache.create(30 * 1000); // 30 seconds (live flight data)

    function _clampRadius(r) { return Math.min(r || 100, 250); }

    function setBaseUrl(url) { baseUrl = url.replace(/\/$/, ''); }

    function request(path) {
        return ApiCache.fetchCached(baseUrl + path, _cache, 'ADSB.lol API');
    }

    return {
        setBaseUrl: setBaseUrl,
        military: function () { return request('/v2/mil'); },
        byCallsign: function (callsign) { return request('/v2/callsign/' + encodeURIComponent(callsign)); },
        byType: function (type) { return request('/v2/type/' + encodeURIComponent(type)); },
        byReg: function (reg) { return request('/v2/reg/' + encodeURIComponent(reg)); },
        byHex: function (hex) { return request('/v2/hex/' + encodeURIComponent(hex)); },
        bySquawk: function (code) { return request('/v2/sqk/' + encodeURIComponent(code)); },
        nearby: function (lat, lon, radius) { return request('/v2/point/' + lat + '/' + lon + '/' + _clampRadius(radius)); },
        closest: function (lat, lon, radius) { return request('/v2/closest/' + lat + '/' + lon + '/' + _clampRadius(radius)); },
        pia: function () { return request('/v2/pia'); },
        ladd: function () { return request('/v2/ladd'); },
        airport: function (icao) { return request('/api/0/airport/' + encodeURIComponent(icao)); },
        clearCache: function () { _cache.clear(); }
    };

})();
if (typeof ApiRegistry !== 'undefined') ApiRegistry.register('adsb', AdsbAPI);
