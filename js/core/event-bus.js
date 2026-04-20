/* ==========================================================================
   Q4NT PRO - Event Bus
   Lightweight pub/sub event system for decoupling data fetching from
   DOM rendering. Replaces direct DOM manipulation inside data-fetching
   functions with event-driven widget updates.

   Usage:
     // Publisher (data layer):
     Q4Events.emit('data:market:update', { symbol: 'SPY', price: 520.30 });

     // Subscriber (UI layer):
     Q4Events.on('data:market:update', function(payload) {
         renderMarketCard(payload);
     });

     // One-time listener:
     Q4Events.once('data:market:update', handler);

     // Unsubscribe:
     Q4Events.off('data:market:update', handler);

   Depends on: nothing (loaded early in boot sequence)
   ========================================================================== */

var Q4Events = (function () {

    var _listeners = {};
    var _history = [];
    var MAX_HISTORY = 50;

    /**
     * Subscribe to an event.
     * @param {string} event - Event name (e.g., 'data:market:update')
     * @param {Function} handler - Callback function
     * @param {Object} [context] - Optional `this` context for handler
     * @returns {{ unsubscribe: Function }} Subscription handle
     */
    function on(event, handler, context) {
        if (typeof handler !== 'function') {
            console.warn('[Q4Events] Handler must be a function for event:', event);
            return { unsubscribe: function () {} };
        }
        if (!_listeners[event]) _listeners[event] = [];
        var entry = { fn: handler, ctx: context || null, once: false };
        _listeners[event].push(entry);
        return {
            unsubscribe: function () { _off(event, entry); }
        };
    }

    /**
     * Subscribe to an event for a single invocation.
     * @param {string} event
     * @param {Function} handler
     * @param {Object} [context]
     */
    function once(event, handler, context) {
        if (!_listeners[event]) _listeners[event] = [];
        _listeners[event].push({ fn: handler, ctx: context || null, once: true });
    }

    /**
     * Unsubscribe a handler from an event.
     * @param {string} event
     * @param {Function} handler
     */
    function off(event, handler) {
        var list = _listeners[event];
        if (!list) return;
        _listeners[event] = list.filter(function (entry) {
            return entry.fn !== handler;
        });
    }

    /**
     * Internal: remove a specific entry (used by subscription handles).
     */
    function _off(event, entry) {
        var list = _listeners[event];
        if (!list) return;
        var idx = list.indexOf(entry);
        if (idx !== -1) list.splice(idx, 1);
    }

    /**
     * Emit an event with a payload.
     * @param {string} event - Event name
     * @param {*} [payload] - Event data
     */
    function emit(event, payload) {
        // Record in history for debugging
        _history.push({
            event: event,
            ts: Date.now(),
            hasPayload: payload !== undefined
        });
        if (_history.length > MAX_HISTORY) _history.shift();

        var list = _listeners[event];
        if (!list || list.length === 0) return;

        // Copy to avoid mutation during iteration
        var snapshot = list.slice();
        for (var i = 0; i < snapshot.length; i++) {
            try {
                snapshot[i].fn.call(snapshot[i].ctx, payload);
            } catch (err) {
                console.error('[Q4Events] Error in handler for "' + event + '":', err);
            }
        }

        // Remove once-listeners
        _listeners[event] = list.filter(function (entry) {
            return !entry.once;
        });
    }

    /**
     * Get all registered event names.
     * @returns {string[]}
     */
    function listEvents() {
        return Object.keys(_listeners);
    }

    /**
     * Get listener count for an event.
     * @param {string} event
     * @returns {number}
     */
    function listenerCount(event) {
        return _listeners[event] ? _listeners[event].length : 0;
    }

    /**
     * Get recent event history (for debugging).
     * @param {number} [count]
     * @returns {Array}
     */
    function history(count) {
        return _history.slice(-(count || MAX_HISTORY));
    }

    /**
     * Remove all listeners for a specific event, or all events.
     * @param {string} [event] - If omitted, clears all listeners
     */
    function clear(event) {
        if (event) {
            delete _listeners[event];
        } else {
            _listeners = {};
        }
    }

    return {
        on: on,
        once: once,
        off: off,
        emit: emit,
        listEvents: listEvents,
        listenerCount: listenerCount,
        history: history,
        clear: clear
    };

})();
