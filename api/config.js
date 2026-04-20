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
    var hostname = window.location.hostname || '127.0.0.1';
    var isLocalhost = hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '0.0.0.0';
    var environment = isLocalhost ? 'development' : 'production';

    // ---------------------------------------------------------------------------
    // API Base URL
    // ---------------------------------------------------------------------------
    // In development, the FastAPI server runs on port 8000.
    // In production, this should point to the deployed API gateway.
    var storedBase = localStorage.getItem('q4nt_api_base');
    var API_BASE = storedBase || (isLocalhost ? 'http://127.0.0.1:8000' : '');

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
    // API Keys (read from localStorage, never hardcoded)
    // ---------------------------------------------------------------------------
    function getApiKey(name) {
        return localStorage.getItem('q4nt_key_' + name) || '';
    }

    function setApiKey(name, key) {
        if (key) {
            localStorage.setItem('q4nt_key_' + name, key);
        } else {
            localStorage.removeItem('q4nt_key_' + name);
        }
    }

    // ---------------------------------------------------------------------------
    // Public Interface
    // ---------------------------------------------------------------------------
    return {
        API_BASE:          API_BASE,
        ENVIRONMENT:       environment,
        IS_DEV:            isLocalhost,
        FEATURES:          FEATURES,
        DEFAULT_WATCHLIST: DEFAULT_WATCHLIST,

        // API key management
        getApiKey:  getApiKey,
        setApiKey:  setApiKey,

        // Runtime overrides
        setApiBase: function (url) {
            API_BASE = url.replace(/\/$/, '');
            Q4Config.API_BASE = API_BASE;
            localStorage.setItem('q4nt_api_base', API_BASE);
        },

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
