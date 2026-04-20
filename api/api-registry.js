// ===== Q4NT API Client Registry =====
// Central registry for API clients. Replaces scattered
// `typeof AlpacaAPI !== 'undefined'` checks with clean lookups.
//
// Usage:
//   ApiRegistry.register('alpaca', AlpacaAPI);
//   ApiRegistry.register('schwab', SchwabAPI);
//
//   var alpaca = ApiRegistry.get('alpaca');
//   if (alpaca) { alpaca.getAccount().then(...); }
//
//   // Or with fallback:
//   ApiRegistry.call('alpaca', 'getAccount').then(...);
//
// Depends on: nothing (loaded early in boot sequence)

var ApiRegistry = (function () {

    var _clients = {};  // { name: clientObject }

    /**
     * Register an API client.
     * @param {string} name - Client identifier (e.g., 'alpaca', 'schwab', 'polymarket')
     * @param {Object} client - The API client object
     */
    function register(name, client) {
        if (!name || !client) {
            console.warn('[ApiRegistry] Invalid registration: name and client required');
            return;
        }
        _clients[name] = client;
    }

    /**
     * Get a registered API client.
     * @param {string} name
     * @returns {Object|null} The client object, or null if not registered
     */
    function get(name) {
        return _clients[name] || null;
    }

    /**
     * Check if a client is registered.
     * @param {string} name
     * @returns {boolean}
     */
    function has(name) {
        return !!_clients[name];
    }

    /**
     * Call a method on a registered client with automatic fallback.
     * Returns a rejected promise if the client or method doesn't exist.
     * @param {string} clientName
     * @param {string} methodName
     * @param {...*} args - Arguments passed to the method
     * @returns {Promise}
     */
    function call(clientName, methodName) {
        var client = _clients[clientName];
        if (!client) {
            return Promise.resolve({ error: clientName + ' API not loaded.' });
        }
        if (typeof client[methodName] !== 'function') {
            return Promise.resolve({ error: clientName + '.' + methodName + ' is not a function.' });
        }
        var args = Array.prototype.slice.call(arguments, 2);
        try {
            var result = client[methodName].apply(client, args);
            // Ensure we always return a promise
            if (result && typeof result.then === 'function') {
                return result;
            }
            return Promise.resolve(result);
        } catch (e) {
            return Promise.reject(e);
        }
    }

    /**
     * Get all registered client names.
     * @returns {string[]}
     */
    function list() {
        return Object.keys(_clients);
    }

    /**
     * Remove a registered client.
     * @param {string} name
     */
    function remove(name) {
        delete _clients[name];
    }

    return {
        register: register,
        get: get,
        has: has,
        call: call,
        list: list,
        remove: remove
    };

})();
