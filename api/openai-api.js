// ===== OpenAI API Client =====
// Frontend module for querying OpenAI via the Cloudflare Worker proxy.
// The API key is stored server-side -- this module never touches it.
// Depends on: core/api-cache.js, core/config.js (Q4Config)

var OpenAIAPI = (function () {

    var _cache = ApiCache.create(5 * 60 * 1000); // 5 minutes (models list only)

    function getBaseUrl() {
        return (typeof Q4Config !== 'undefined' ? Q4Config.API_BASE : '') || '';
    }

    function getModel() {
        return (typeof Q4Config !== 'undefined' ? Q4Config.OPENAI_MODEL : '') || 'gpt-5-mini';
    }

    function chat(messages, opts) {
        var o = opts || {};
        var base = getBaseUrl();
        var body = {
            messages: messages,
            model: o.model || getModel(),
            max_completion_tokens: o.max_completion_tokens || o.max_tokens || 2048
        };
        if (o.tools) body.tools = o.tools;
        if (o.tool_choice) body.tool_choice = o.tool_choice;

        return fetch(base + '/api/openai/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        }).then(function (res) {
            if (!res.ok) {
                return res.json().then(function (err) {
                    throw new Error(err.error || 'OpenAI proxy error ' + res.status);
                });
            }
            return res.json().then(function (data) {
                // Server may return {error: "..."} with HTTP 200 (e.g. missing API key)
                if (data.error && !data.choices) {
                    throw new Error(typeof data.error === 'string' ? data.error : (data.error.message || 'OpenAI proxy error'));
                }
                return data;
            });
        });
    }

    function ask(prompt, opts) {
        var o = opts || {};
        var messages = o.systemPrompt
            ? [{ role: 'system', content: o.systemPrompt }, { role: 'user', content: prompt }]
            : [{ role: 'user', content: prompt }];
        return chat(messages, o).then(function (data) {
            if (data.choices && data.choices[0] && data.choices[0].message) {
                return data.choices[0].message.content;
            }
            throw new Error('Unexpected response format');
        });
    }

    function models() {
        return ApiCache.fetchCached(getBaseUrl() + '/api/openai/models', _cache, 'OpenAI');
    }

    function health() {
        return fetch(getBaseUrl() + '/api/openai/health').then(function (res) { return res.json(); });
    }

    function runPipeline(opts) {
        var o = opts || {};
        var base = getBaseUrl();
        var body = {
            video_id: o.video_id || '',
            url: o.url || '',
            instructions: o.instructions || 'Summarize the key points of this video',
            model: o.model || getModel(),
            temperature: o.temperature || 0.7,
            max_completion_tokens: o.max_completion_tokens || o.max_tokens || 2048
        };
        return fetch(base + '/api/pipeline/run', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        }).then(function (res) {
            return res.json();
        }).then(function (data) {
            if (data.error) throw new Error(data.error);
            return data;
        });
    }

    function fetchTranscript(videoId) {
        var base = getBaseUrl();
        // Use long timeout (5 min) to allow for Whisper audio transcription fallback
        var controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
        var timeoutId = controller ? setTimeout(function () { controller.abort(); }, 300000) : null;
        var fetchOpts = {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ video_id: videoId })
        };
        if (controller) fetchOpts.signal = controller.signal;
        return fetch(base + '/api/youtube/transcript', fetchOpts).then(function (res) {
            if (timeoutId) clearTimeout(timeoutId);
            return res.json();
        }).then(function (data) {
            if (data.error) throw new Error(data.error);
            return data;
        }).catch(function (err) {
            if (timeoutId) clearTimeout(timeoutId);
            if (err.name === 'AbortError') throw new Error('Transcript fetch timed out (5 min limit)');
            throw err;
        });
    }

    function interpretChunk(opts) {
        var o = opts || {};
        var base = getBaseUrl();
        return fetch(base + '/api/pipeline/interpret-chunk', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                chunk: o.chunk || '',
                instructions: o.instructions || '',
                model: o.model || getModel(),
                temperature: o.temperature || 0.7,
                context: o.context || '',
                timestamp: o.timestamp || '',
                alert_condition: o.alert_condition || ''
            })
        }).then(function (res) {
            return res.json();
        }).then(function (data) {
            if (data.error) throw new Error(data.error);
            return data;
        });
    }

    // Start live transcription via SSE (3-second batches)
    // Returns { abort: Function } to stop the stream
    function startLiveTranscribe(videoId, chunkSeconds, onChunk, onError, onStatus) {
        var base = getBaseUrl();
        var controller = new AbortController();
        var aborted = false;

        fetch(base + '/api/youtube/live-transcribe', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ video_id: videoId, chunk_seconds: chunkSeconds || 3 }),
            signal: controller.signal
        }).then(function (response) {
            if (!response.ok) throw new Error('Server error: ' + response.status);
            var reader = response.body.getReader();
            var decoder = new TextDecoder();
            var buffer = '';

            function pump() {
                return reader.read().then(function (result) {
                    if (result.done || aborted) return;
                    buffer += decoder.decode(result.value, { stream: true });
                    // Parse SSE lines
                    var lines = buffer.split('\n');
                    buffer = lines.pop(); // Keep incomplete line
                    for (var i = 0; i < lines.length; i++) {
                        var line = lines[i].trim();
                        if (line.indexOf('data: ') === 0) {
                            try {
                                var data = JSON.parse(line.substring(6));
                                if (data.error) {
                                    if (onError) onError(data.error);
                                } else if (data.status) {
                                    if (onStatus) onStatus(data.status, data.message);
                                } else if (data.text) {
                                    if (onChunk) onChunk(data.text, data.timestamp, data.chunk);
                                }
                            } catch (e) { /* skip malformed */ }
                        }
                    }
                    return pump();
                });
            }
            return pump();
        }).catch(function (err) {
            if (!aborted && onError) onError(err.message || 'Stream failed');
        });

        return {
            abort: function () {
                aborted = true;
                try { controller.abort(); } catch (e) {}
            }
        };
    }

    return {
        chat: chat, ask: ask, models: models, health: health,
        runPipeline: runPipeline, fetchTranscript: fetchTranscript,
        interpretChunk: interpretChunk, startLiveTranscribe: startLiveTranscribe,
        clearCache: function () { _cache.clear(); }
    };

})();
if (typeof ApiRegistry !== 'undefined') ApiRegistry.register('openai', OpenAIAPI);
