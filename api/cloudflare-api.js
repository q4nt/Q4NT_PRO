// ===== Cloudflare Radar API Client =====
// Frontend module for querying Cloudflare Radar via the Worker proxy.
// Depends on: core/api-cache.js, core/config.js (Q4Config)

var CloudflareAPI = (function () {

    var _cache = ApiCache.create(5 * 60 * 1000); // 5 minutes

    function getBaseUrl() {
        return (typeof Q4Config !== 'undefined' ? Q4Config.API_BASE : '') || '';
    }

    function request(path, params) {
        return ApiCache.fetchCached(ApiCache.buildUrl(getBaseUrl(), path, params), _cache, 'Cloudflare Radar');
    }

    function trafficTimeseries(opts) {
        var o = opts || {};
        return request('/api/cf/traffic', { location: o.location, dateRange: o.dateRange || '7d', aggInterval: o.aggInterval });
    }

    function trafficTopLocations(opts) {
        var o = opts || {};
        return request('/api/cf/traffic/top', { dateRange: o.dateRange || '7d', limit: o.limit || 10 });
    }

    function dnsTopLocations(domain, opts) {
        var o = opts || {};
        return request('/api/cf/dns/top', { domain: domain, dateRange: o.dateRange || '1d', limit: o.limit || 10 });
    }

    function dnsTimeseries(opts) {
        var o = opts || {};
        return request('/api/cf/dns/timeseries', { location: o.location, dateRange: o.dateRange || '7d' });
    }

    function outages(opts) {
        var o = opts || {};
        return request('/api/cf/outages', { location: o.location, dateRange: o.dateRange || '30d' });
    }

    function internetQuality(opts) {
        var o = opts || {};
        return request('/api/cf/quality', { location: o.location, dateRange: o.dateRange || '7d' });
    }

    function attacks(opts) {
        var o = opts || {};
        return request('/api/cf/attacks', { location: o.location, dateRange: o.dateRange || '7d' });
    }

    function bgpRoutes(opts) {
        var o = opts || {};
        return request('/api/cf/bgp/routes', { location: o.location });
    }

    return {
        trafficTimeseries: trafficTimeseries, trafficTopLocations: trafficTopLocations,
        dnsTopLocations: dnsTopLocations, dnsTimeseries: dnsTimeseries,
        outages: outages, internetQuality: internetQuality,
        attacks: attacks, bgpRoutes: bgpRoutes,
        health: function () { return request('/api/cf/health', {}); },
        clearCache: function () { _cache.clear(); }
    };

})();
if (typeof ApiRegistry !== 'undefined') ApiRegistry.register('cloudflare', CloudflareAPI);
