// ===== DraftKings Public API Client =====
// Frontend module for the DraftKings public (unofficial) REST API.
// These endpoints are publicly accessible and do not require authentication.
// Note: Unofficial endpoints may change without notice.
// Depends on: core/api-cache.js

var DraftKingsAPI = (function () {

    var baseUrl = 'https://api.draftkings.com';
    var lobbyUrl = 'https://www.draftkings.com';
    var _cache = ApiCache.create(2 * 60 * 1000); // 2 minutes

    // ---- Internal helper ----

    function _get(base, path, params) {
        var p = params || {};
        p.format = 'json';
        return ApiCache.fetchCached(ApiCache.buildUrl(base, path, p), _cache, 'DraftKings API');
    }

    // ===== Sports =====
    // GET /sites/US-DK/sports/v1/sports
    function getSports() {
        return _get(baseUrl, '/sites/US-DK/sports/v1/sports');
    }

    // ===== Contests =====
    // GET /lobby/getcontests?sport={sportCode}
    // sportCode examples: NBA, NFL, MLB, NHL, PGA, SOC, TEN, MMA, NASCAR
    function getContests(sportCode) {
        return _get(lobbyUrl, '/lobby/getcontests', { sport: sportCode });
    }

    // GET /contests/v1/contests/{contestId}
    function getContest(contestId) {
        return _get(baseUrl, '/contests/v1/contests/' + encodeURIComponent(contestId));
    }

    // ===== Draft Groups =====
    // GET /draftgroups/v1/{draftGroupId}
    function getDraftGroup(draftGroupId) {
        return _get(baseUrl, '/draftgroups/v1/' + encodeURIComponent(draftGroupId));
    }

    // ===== Draftables (Players) =====
    // GET /draftgroups/v1/draftgroups/{draftGroupId}/draftables
    function getDraftables(draftGroupId) {
        return _get(baseUrl, '/draftgroups/v1/draftgroups/' + encodeURIComponent(draftGroupId) + '/draftables');
    }

    // ===== Game Type Rules =====
    // GET /lineups/v1/gametypes/{gameTypeId}/rules
    function getGameTypeRules(gameTypeId) {
        return _get(baseUrl, '/lineups/v1/gametypes/' + encodeURIComponent(gameTypeId) + '/rules');
    }

    // ===== Countries / Regions =====
    // GET /sites/US-DK/sports/v1/sports/{sportId}/regions
    function getRegions(sportId) {
        return _get(baseUrl, '/sites/US-DK/sports/v1/sports/' + encodeURIComponent(sportId) + '/regions');
    }

    // ===== Sportsbook Odds =====
    // GET /sportscontent/dksportscontent/v1/sports/{sportCode}/events
    function getSportEvents(sportCode, opts) {
        var o = opts || {};
        return _get(baseUrl, '/sportscontent/dksportscontent/v1/sports/' + encodeURIComponent(sportCode) + '/events', {
            subcategoryId: o.subcategoryId
        });
    }

    // GET /sportscontent/dksportscontent/v1/events/{eventId}/categories
    function getEventCategories(eventId) {
        return _get(baseUrl, '/sportscontent/dksportscontent/v1/events/' + encodeURIComponent(eventId) + '/categories');
    }

    // GET /sportscontent/dksportscontent/v1/events/{eventId}/categories/{categoryId}/subcategories/{subId}/offers
    function getOffers(eventId, categoryId, subId) {
        return _get(baseUrl, '/sportscontent/dksportscontent/v1/events/' +
            encodeURIComponent(eventId) + '/categories/' +
            encodeURIComponent(categoryId) + '/subcategories/' +
            encodeURIComponent(subId) + '/offers');
    }

    // ===== Leaderboards =====
    // GET /contests/v1/contests/{contestId}/leaderboard
    function getLeaderboard(contestId) {
        return _get(baseUrl, '/contests/v1/contests/' + encodeURIComponent(contestId) + '/leaderboard');
    }

    return {
        // Sports
        getSports: getSports, getRegions: getRegions,
        // Contests
        getContests: getContests, getContest: getContest,
        // Draft Groups & Draftables
        getDraftGroup: getDraftGroup, getDraftables: getDraftables,
        // Game Rules
        getGameTypeRules: getGameTypeRules,
        // Sportsbook
        getSportEvents: getSportEvents, getEventCategories: getEventCategories,
        getOffers: getOffers,
        // Leaderboards
        getLeaderboard: getLeaderboard,
        // Cache
        clearCache: function () { _cache.clear(); }
    };

})();
if (typeof ApiRegistry !== 'undefined') ApiRegistry.register('draftkings', DraftKingsAPI);
