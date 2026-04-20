// ===== Q4NT Platform Configuration =====
// Central configuration for all frontend modules.
// Provides API base URL, feature flags, and environment detection.
//
// Usage:
//   var base = Q4Config.API_BASE;       // 'http://127.0.0.1:8000'
//   var env  = Q4Config.ENVIRONMENT;    // 'development'
//
// Depends on: nothing (must load first in the boot sequence)

var Q4Config = (function () {

    // ---------------------------------------------------------------------------
    // Environment Detection
    // ---------------------------------------------------------------------------
    var hostname = (typeof window !== 'undefined' && window.location) ? window.location.hostname : '127.0.0.1';
    var isLocalhost = hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '0.0.0.0';
    var environment = isLocalhost ? 'development' : 'production';

    // ---------------------------------------------------------------------------
    // API Base URL
    // ---------------------------------------------------------------------------
    // API_BASE is deterministically set from the environment.
    // In development, the FastAPI server runs on port 8000.
    // In production, this points to the deployed API gateway via dynamic origin detection.
    var API_BASE = '';
    if (typeof window !== 'undefined' && window.location) {
        if (isLocalhost || /^(192\.168\.|10\.|172\.(1[6-9]|2[0-9]|3[0-1])\.)/.test(hostname)) {
            API_BASE = window.location.protocol + '//' + hostname + ':8000';
            environment = 'development';
            isLocalhost = true;
        } else {
            API_BASE = window.location.origin;
        }
    } else {
        API_BASE = 'http://127.0.0.1:8000';
    }

    // ---------------------------------------------------------------------------
    // Feature Flags
    // ---------------------------------------------------------------------------
    var FEATURES = {
        LIVE_DATA:       true,     // Enable live API data fetching
        CACHE_ENABLED:   true,     // Enable in-memory API cache
        DEBUG_LOGGING:   isLocalhost,  // Console logging in dev only
        LAZY_LOAD_TABS:  true,     // Only fetch data when tab is active
        AUTO_REFRESH:    true,     // Enable periodic data refresh
        REFRESH_INTERVAL: 30000,   // Default refresh interval (30s)
    };

    // ---------------------------------------------------------------------------
    // Default Watchlist Symbols
    // ---------------------------------------------------------------------------
    var DEFAULT_WATCHLIST = ['AAPL', 'MSFT', 'NVDA', 'TSLA', 'AMZN', 'GOOG', 'META', 'JPM'];

    // ---------------------------------------------------------------------------
    // API Keys (Removed due to security risk - Use backend proxy instead)
    // ---------------------------------------------------------------------------

    // ---------------------------------------------------------------------------
    // Public Interface
    // ---------------------------------------------------------------------------
    return {
        API_BASE:          API_BASE,
        ENVIRONMENT:       environment,
        IS_DEV:            isLocalhost,
        FEATURES:          FEATURES,
        DEFAULT_WATCHLIST: DEFAULT_WATCHLIST,

        // Debug helper
        dump: function () {
            console.table({
                API_BASE:    API_BASE,
                ENVIRONMENT: environment,
                IS_DEV:      isLocalhost,
                HOSTNAME:    hostname
            });
        }
    };

})();
