// ===== NBA Public CDN API Client =====
// Frontend module fetching from NBA's public CDN endpoints.
// No authentication required. Data refreshes every ~15 seconds during live games.
// Routes through backend typed proxy /api/proxy/nba/ to avoid CORS.
// Depends on: core/api-cache.js

var NbaAPI = (function () {

    // Route through backend typed proxy: /api/proxy/nba/<path>
    var proxyBase = typeof Q4Config !== 'undefined' ? (Q4Config.API_BASE + '/api/proxy/nba') : 'http://127.0.0.1:5052/api/proxy/nba';
    var _cache = ApiCache.create(30 * 1000); // 30-second cache for live data

    // ---- Internal helper ----
    function _get(path) {
        return ApiCache.fetchCached(proxyBase + path, _cache, 'NBA CDN');
    }

    // ===== Today's Scoreboard =====
    // Returns all games for today with scores, status, and game leaders
    function getTodaysScoreboard() {
        return _get('/scoreboard/todaysScoreboard_00.json')
            .then(function (data) {
                return data && data.scoreboard ? data.scoreboard : null;
            });
    }

    // ===== Box Score for a specific game =====
    // gameId example: "0022501016"
    function getBoxScore(gameId) {
        return _get('/boxscore/boxscore_' + gameId + '.json')
            .then(function (data) {
                return data && data.game ? data.game : null;
            });
    }

    // ===== Parse scoreboard into simple game objects =====
    function parseScoreboard(scoreboard) {
        if (!scoreboard || !scoreboard.games) return [];
        return scoreboard.games.map(function (g) {
            var statusText = g.gameStatusText || '';
            var isLive = g.gameStatus === 2;
            var isFinal = g.gameStatus === 3;
            var isScheduled = g.gameStatus === 1;

            // Format status for display
            var displayStatus = statusText;
            if (isLive && g.gameClock) {
                // gameClock is like "PT05M23.00S" -> parse to "Q3 5:23"
                var clockMatch = g.gameClock.match(/PT(\d+)M([\d.]+)S/);
                if (clockMatch) {
                    var mins = parseInt(clockMatch[1], 10);
                    var secs = Math.floor(parseFloat(clockMatch[2]));
                    displayStatus = 'Q' + g.period + ' ' + mins + ':' + (secs < 10 ? '0' : '') + secs;
                }
            } else if (isScheduled) {
                // Use the ET time from gameStatusText (e.g., "7:30 pm ET")
                displayStatus = statusText.replace(/ ET$/i, '').replace(/ et$/i, '').trim();
            }

            return {
                gameId: g.gameId,
                away: g.awayTeam.teamTricode,
                awayScore: g.awayTeam.score,
                home: g.homeTeam.teamTricode,
                homeScore: g.homeTeam.score,
                status: displayStatus,
                isLive: isLive,
                isFinal: isFinal,
                isScheduled: isScheduled,
                period: g.period,
                awayLeader: g.gameLeaders ? g.gameLeaders.awayLeaders : null,
                homeLeader: g.gameLeaders ? g.gameLeaders.homeLeaders : null
            };
        });
    }

    // ===== Parse box score into player stats =====
    function parseBoxScorePlayers(game, teamTricode) {
        if (!game) return [];
        var team = null;
        if (game.homeTeam && game.homeTeam.teamTricode === teamTricode) team = game.homeTeam;
        else if (game.awayTeam && game.awayTeam.teamTricode === teamTricode) team = game.awayTeam;
        if (!team || !team.players) return [];

        return team.players
            .filter(function (p) { return p.status === 'ACTIVE' && p.statistics; })
            .map(function (p) {
                var s = p.statistics;
                // Build initials from name
                var parts = p.name.split(' ');
                var init = parts.length >= 2
                    ? parts[0].charAt(0) + '.' + ' ' + parts[parts.length - 1]
                    : p.name;
                var shortInit = parts.length >= 2
                    ? parts[0].charAt(0) + parts[parts.length - 1].charAt(0)
                    : p.name.substring(0, 2);
                return {
                    init: shortInit.toUpperCase(),
                    name: init,
                    pts: s.points || 0,
                    reb: s.reboundsTotal || 0,
                    ast: s.assists || 0,
                    fg: s.fieldGoalsAttempted > 0
                        ? Math.round((s.fieldGoalsMade / s.fieldGoalsAttempted) * 1000) / 10
                        : 0,
                    min: s.minutesCalculated || ''
                };
            })
            .sort(function (a, b) { return b.pts - a.pts; })
            .slice(0, 5); // Top 5 by points
    }

    return {
        getTodaysScoreboard: getTodaysScoreboard,
        getBoxScore: getBoxScore,
        parseScoreboard: parseScoreboard,
        parseBoxScorePlayers: parseBoxScorePlayers,
        clearCache: function () { _cache.clear(); }
    };

})();
if (typeof ApiRegistry !== 'undefined') ApiRegistry.register('nba', NbaAPI);
