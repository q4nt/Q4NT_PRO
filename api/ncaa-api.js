// ===== NCAA Sports API Client =====
// Frontend module for NCAA college sports data, proxied through the Q4NT backend.
// The backend routes requests to the henrygd NCAA API (ncaa-api.henrygd.me).
// Server-side caching ensures minimal upstream hits and consistent data for all clients.
// Depends on: core/api-cache.js, core/config.js

var NcaaAPI = (function () {

    var _cache = ApiCache.create(60 * 1000); // 1 minute client-side cache

    // ---- Internal helper ----

    function _get(path, params) {
        var base = Q4Config.API_BASE;
        return ApiCache.fetchCached(ApiCache.buildUrl(base, '/api/ncaa' + path, params), _cache, 'NCAA API');
    }

    // ===== Scoreboard (Live Scores) =====
    // GET /api/ncaa/scoreboard?sport=basketball-men&division=d1&date=YYYY/MM/DD
    function getScoreboard(sport, division, date) {
        var params = {};
        if (sport) params.sport = sport;
        if (division) params.division = division;
        if (date) params.date = date;
        return _get('/scoreboard', params);
    }

    // ===== Standings =====
    // GET /api/ncaa/standings?sport=basketball-men&division=d1
    function getStandings(sport, division) {
        var params = {};
        if (sport) params.sport = sport;
        if (division) params.division = division;
        return _get('/standings', params);
    }

    // ===== Rankings =====
    // GET /api/ncaa/rankings?sport=basketball-men&division=d1
    function getRankings(sport, division) {
        var params = {};
        if (sport) params.sport = sport;
        if (division) params.division = division;
        return _get('/rankings', params);
    }

    // ===== Game Details =====
    // GET /api/ncaa/game/{gameId}/boxscore
    function getBoxScore(gameId) {
        return _get('/game/' + encodeURIComponent(gameId) + '/boxscore');
    }

    // ===== Schedule (specific date) =====
    // Convenience: calls scoreboard with a date param
    function getSchedule(sport, division, year, month, day) {
        var dateStr = year + '/' +
            String(month).padStart(2, '0') + '/' +
            String(day).padStart(2, '0');
        return getScoreboard(sport, division, dateStr);
    }

    return {
        // Scoreboard / Live Scores
        getScoreboard: getScoreboard,
        getSchedule: getSchedule,
        // Standings & Rankings
        getStandings: getStandings,
        getRankings: getRankings,
        // Game Details
        getBoxScore: getBoxScore,
        // Cache
        clearCache: function () { _cache.clear(); }
    };

})();
if (typeof ApiRegistry !== 'undefined') ApiRegistry.register('ncaa', NcaaAPI);
