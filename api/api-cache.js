// ===== Q4NT API Cache Layer =====
// In-memory TTL cache with fetch wrappers for all API clients.
// Prevents redundant network requests and provides URL building utilities.
//
// Usage:
//   var cache = ApiCache.create(60000);  // 1 minute TTL
//   var url   = ApiCache.buildUrl('https://api.example.com', '/v1/data', { limit: 10 });
//   ApiCache.fetchCached(url, cache, 'Example API').then(function(data) { ... });
//
// Depends on: nothing (loaded early in boot sequence, before API clients)

var ApiCache = (function () {

    // ---------------------------------------------------------------------------
    // Cache Factory
    // ---------------------------------------------------------------------------

    /**
     * Create a new cache instance with the given TTL.
     * @param {number} ttlMs - Time-to-live in milliseconds
     * @returns {{ get: Function, set: Function, has: Function, clear: Function }}
     */
    function create(ttlMs) {
        var _store = {};
        var _ttl = ttlMs || 60000;

        return {
            /**
             * Get a cached value if it exists and hasn't expired.
             * @param {string} key
             * @returns {*|null}
             */
            get: function (key) {
                var entry = _store[key];
                if (!entry) return null;
                if (Date.now() - entry.ts > _ttl) {
                    delete _store[key];
                    return null;
                }
                return entry.data;
            },

            /**
             * Store a value in the cache.
             * @param {string} key
             * @param {*} data
             */
            set: function (key, data) {
                _store[key] = { data: data, ts: Date.now() };

                // Eviction: keep cache under 200 entries to prevent memory leaks
                var keys = Object.keys(_store);
                if (keys.length > 200) {
                    // Remove oldest 50 entries
                    keys.sort(function (a, b) { return _store[a].ts - _store[b].ts; });
                    for (var i = 0; i < 50; i++) {
                        delete _store[keys[i]];
                    }
                }
            },

            /**
             * Check if a non-expired entry exists.
             * @param {string} key
             * @returns {boolean}
             */
            has: function (key) {
                var entry = _store[key];
                if (!entry) return false;
                if (Date.now() - entry.ts > _ttl) {
                    delete _store[key];
                    return false;
                }
                return true;
            },

            /**
             * Clear all cached entries.
             */
            clear: function () {
                _store = {};
            },

            /**
             * Get cache statistics.
             * @returns {{ size: number, ttlMs: number }}
             */
            stats: function () {
                return { size: Object.keys(_store).length, ttlMs: _ttl };
            }
        };
    }

    // ---------------------------------------------------------------------------
    // URL Builder
    // ---------------------------------------------------------------------------

    /**
     * Build a full URL from base, path, and query parameters.
     * Filters out undefined/null param values.
     * @param {string} base - Base URL (e.g., 'https://api.example.com')
     * @param {string} path - Path segment (e.g., '/v1/data')
     * @param {Object} [params] - Query parameters
     * @returns {string} Full URL
     */
    function buildUrl(base, path, params) {
        var url = base.replace(/\/$/, '') + path;
        if (params) {
            var parts = [];
            for (var k in params) {
                if (params.hasOwnProperty(k) && params[k] !== undefined && params[k] !== null && params[k] !== '') {
                    parts.push(encodeURIComponent(k) + '=' + encodeURIComponent(params[k]));
                }
            }
            if (parts.length > 0) {
                url += (url.indexOf('?') === -1 ? '?' : '&') + parts.join('&');
            }
        }
        return url;
    }

    // ---------------------------------------------------------------------------
    // Fetch Wrappers
    // ---------------------------------------------------------------------------

    // In-flight request deduplication map
    var _inflight = {};

    /**
     * Fetch with caching and request deduplication.
     * @param {string} url - Full URL to fetch
     * @param {{ get: Function, set: Function }} cache - Cache instance from create()
     * @param {string} [label] - Label for debug logging
     * @returns {Promise<*>} Parsed JSON response
     */
    function fetchCached(url, cache, label) {
        // 1. Check cache
        var cached = cache.get(url);
        if (cached !== null) {
            if (_shouldLog()) {
                console.log('[ApiCache] HIT (' + (label || '') + '): ' + _truncUrl(url));
            }
            return Promise.resolve(cached);
        }

        // 2. Check in-flight (deduplicate concurrent identical requests)
        if (_inflight[url]) {
            return _inflight[url];
        }

        // 3. Fetch from network
        if (_shouldLog()) {
            console.log('[ApiCache] MISS (' + (label || '') + '): ' + _truncUrl(url));
        }

        var promise = fetch(url)
            .then(function (res) {
                if (!res.ok) {
                    throw new Error((label || 'API') + ' error: HTTP ' + res.status);
                }
                return res.json();
            })
            .then(function (data) {
                cache.set(url, data);
                delete _inflight[url];
                return data;
            })
            .catch(function (err) {
                delete _inflight[url];
                if (_shouldLog()) {
                    console.warn('[ApiCache] FAIL (' + (label || '') + '):', err.message);
                }
                throw err;
            });

        _inflight[url] = promise;
        return promise;
    }

    /**
     * Fetch with caching and custom headers (for APIs requiring auth).
     * @param {string} url
     * @param {{ get: Function, set: Function }} cache
     * @param {Object} headers - Additional headers
     * @param {string} [label]
     * @returns {Promise<*>}
     */
    function fetchCachedWithHeaders(url, cache, headers, label) {
        var cached = cache.get(url);
        if (cached !== null) {
            return Promise.resolve(cached);
        }

        if (_inflight[url]) {
            return _inflight[url];
        }

        var promise = fetch(url, { headers: headers || {} })
            .then(function (res) {
                if (!res.ok) {
                    throw new Error((label || 'API') + ' error: HTTP ' + res.status);
                }
                return res.json();
            })
            .then(function (data) {
                cache.set(url, data);
                delete _inflight[url];
                return data;
            })
            .catch(function (err) {
                delete _inflight[url];
                if (_shouldLog()) {
                    console.warn('[ApiCache] FAIL (' + (label || '') + '):', err.message);
                }
                throw err;
            });

        _inflight[url] = promise;
        return promise;
    }

    // ---------------------------------------------------------------------------
    // Helpers
    // ---------------------------------------------------------------------------

    function _shouldLog() {
        return typeof Q4Config !== 'undefined' && Q4Config.FEATURES && Q4Config.FEATURES.DEBUG_LOGGING;
    }

    function _truncUrl(url) {
        return url.length > 80 ? url.substring(0, 77) + '...' : url;
    }

    // ---------------------------------------------------------------------------
    // Public Interface
    // ---------------------------------------------------------------------------
    return {
        create:                 create,
        buildUrl:               buildUrl,
        fetchCached:            fetchCached,
        fetchCachedWithHeaders: fetchCachedWithHeaders
    };

})();
