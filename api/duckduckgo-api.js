// ===== DuckDuckGo Search API Client =====
// Frontend module for web search via DuckDuckGo Instant Answer API.
// No API key required -- DuckDuckGo's API is free and open.
// Depends on: core/api-cache.js

var DuckDuckGoAPI = (function () {

    var _cache = ApiCache.create(5 * 60 * 1000); // 5 minutes

    function instant(query) {
        var url = 'https://api.duckduckgo.com/?q=' + encodeURIComponent(query) +
            '&format=json&no_html=1&skip_disambig=1&no_redirect=1';
        return ApiCache.fetchCached(url, _cache, 'DuckDuckGo');
    }

    function search(query) {
        return instant(query).then(function (data) {
            var results = [];

            if (data.Abstract) {
                results.push({
                    title: data.Heading || query, snippet: data.Abstract,
                    url: data.AbstractURL || '', source: data.AbstractSource || 'DuckDuckGo'
                });
            }

            // Flatten RelatedTopics + nested Topics in a single pass
            var topics = data.RelatedTopics || [];
            for (var i = 0; i < topics.length; i++) {
                var topic = topics[i];
                if (topic.Text) {
                    results.push({ title: topic.Text.substring(0, 80), snippet: topic.Text, url: topic.FirstURL || '', source: 'DuckDuckGo' });
                }
                if (topic.Topics) {
                    for (var j = 0; j < topic.Topics.length; j++) {
                        var sub = topic.Topics[j];
                        if (sub.Text) {
                            results.push({ title: sub.Text.substring(0, 80), snippet: sub.Text, url: sub.FirstURL || '', source: 'DuckDuckGo' });
                        }
                    }
                }
            }

            var infobox = null;
            if (data.Infobox && data.Infobox.content) {
                infobox = {};
                var content = data.Infobox.content;
                for (var k = 0; k < content.length; k++) {
                    if (content[k].label && content[k].value) infobox[content[k].label] = content[k].value;
                }
            }

            return {
                query: query, abstract: data.Abstract || null, heading: data.Heading || null,
                url: data.AbstractURL || null, source: data.AbstractSource || null,
                type: data.Type || null, image: data.Image || null, infobox: infobox,
                results: results, answer: data.Answer || null,
                definition: data.Definition || null, redirect: data.Redirect || null
            };
        });
    }

    return {
        search: search, instant: instant,
        clearCache: function () { _cache.clear(); }
    };

})();
if (typeof ApiRegistry !== 'undefined') ApiRegistry.register('duckduckgo', DuckDuckGoAPI);
