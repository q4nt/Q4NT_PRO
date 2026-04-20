// ===== Spotify Web API Client =====
// Frontend module for the Spotify Web API.
// Requires a valid OAuth2 access token (set via SpotifyAPI.setToken()).
// Docs: https://developer.spotify.com/documentation/web-api
// Depends on: core/api-cache.js

var SpotifyAPI = (function () {

    var baseUrl = 'https://api.spotify.com/v1';
    var _token = '';
    var _cache = ApiCache.create(60 * 1000); // 1 minute

    function setToken(token) { _token = token; }
    function getToken() { return _token; }

    // ---- Internal helper ----
    function _get(path, params) {
        if (!_token) return Promise.reject(new Error('SpotifyAPI: No access token set. Call SpotifyAPI.setToken() first.'));
        var url = ApiCache.buildUrl(baseUrl, path, params || {});
        return ApiCache.fetchCachedWithHeaders(url, _cache, { 'Authorization': 'Bearer ' + _token }, 'SpotifyAPI');
    }

    // ===== Search =====
    // GET /search?q={query}&type={type}&limit={limit}
    // type: album, artist, track, playlist, show, episode
    function search(query, type, limit) {
        return _get('/search', { q: query, type: type || 'track', limit: limit || 20 });
    }

    // ===== Browse =====
    // GET /browse/new-releases
    function getNewReleases(limit, country) {
        return _get('/browse/new-releases', { limit: limit || 20, country: country || 'US' });
    }

    // GET /browse/featured-playlists
    function getFeaturedPlaylists(limit, country) {
        return _get('/browse/featured-playlists', { limit: limit || 20, country: country || 'US' });
    }

    // GET /browse/categories
    function getCategories(limit, country) {
        return _get('/browse/categories', { limit: limit || 20, country: country || 'US' });
    }

    // GET /browse/categories/{id}/playlists
    function getCategoryPlaylists(categoryId, limit) {
        return _get('/browse/categories/' + encodeURIComponent(categoryId) + '/playlists', { limit: limit || 20 });
    }

    // ===== Artists =====
    // GET /artists/{id}
    function getArtist(artistId) {
        return _get('/artists/' + encodeURIComponent(artistId));
    }

    // GET /artists/{id}/top-tracks?market={market}
    function getArtistTopTracks(artistId, market) {
        return _get('/artists/' + encodeURIComponent(artistId) + '/top-tracks', { market: market || 'US' });
    }

    // GET /artists/{id}/albums
    function getArtistAlbums(artistId, limit) {
        return _get('/artists/' + encodeURIComponent(artistId) + '/albums', { limit: limit || 20, include_groups: 'album,single' });
    }

    // GET /artists/{id}/related-artists
    function getRelatedArtists(artistId) {
        return _get('/artists/' + encodeURIComponent(artistId) + '/related-artists');
    }

    // ===== Albums =====
    // GET /albums/{id}
    function getAlbum(albumId) {
        return _get('/albums/' + encodeURIComponent(albumId));
    }

    // GET /albums/{id}/tracks
    function getAlbumTracks(albumId, limit) {
        return _get('/albums/' + encodeURIComponent(albumId) + '/tracks', { limit: limit || 50 });
    }

    // ===== Tracks =====
    // GET /tracks/{id}
    function getTrack(trackId) {
        return _get('/tracks/' + encodeURIComponent(trackId));
    }

    // GET /audio-features/{id}
    function getAudioFeatures(trackId) {
        return _get('/audio-features/' + encodeURIComponent(trackId));
    }

    // GET /audio-features?ids={ids}
    function getMultipleAudioFeatures(trackIds) {
        return _get('/audio-features', { ids: trackIds.join(',') });
    }

    // ===== Playlists =====
    // GET /playlists/{id}
    function getPlaylist(playlistId) {
        return _get('/playlists/' + encodeURIComponent(playlistId));
    }

    // GET /playlists/{id}/tracks
    function getPlaylistTracks(playlistId, limit, offset) {
        return _get('/playlists/' + encodeURIComponent(playlistId) + '/tracks', { limit: limit || 50, offset: offset || 0 });
    }

    // ===== Recommendations =====
    // GET /recommendations?seed_artists={}&seed_tracks={}&seed_genres={}
    function getRecommendations(opts) {
        var p = {};
        if (opts.seedArtists) p.seed_artists = opts.seedArtists.join(',');
        if (opts.seedTracks) p.seed_tracks = opts.seedTracks.join(',');
        if (opts.seedGenres) p.seed_genres = opts.seedGenres.join(',');
        p.limit = opts.limit || 20;
        return _get('/recommendations', p);
    }

    // ===== Available Genre Seeds =====
    function getGenreSeeds() {
        return _get('/recommendations/available-genre-seeds');
    }

    return {
        // Auth
        setToken: setToken, getToken: getToken,
        // Search
        search: search,
        // Browse
        getNewReleases: getNewReleases, getFeaturedPlaylists: getFeaturedPlaylists,
        getCategories: getCategories, getCategoryPlaylists: getCategoryPlaylists,
        // Artists
        getArtist: getArtist, getArtistTopTracks: getArtistTopTracks,
        getArtistAlbums: getArtistAlbums, getRelatedArtists: getRelatedArtists,
        // Albums
        getAlbum: getAlbum, getAlbumTracks: getAlbumTracks,
        // Tracks
        getTrack: getTrack, getAudioFeatures: getAudioFeatures,
        getMultipleAudioFeatures: getMultipleAudioFeatures,
        // Playlists
        getPlaylist: getPlaylist, getPlaylistTracks: getPlaylistTracks,
        // Recommendations
        getRecommendations: getRecommendations, getGenreSeeds: getGenreSeeds,
        // Cache
        clearCache: function () { _cache.clear(); }
    };

})();
if (typeof ApiRegistry !== 'undefined') ApiRegistry.register('spotify', SpotifyAPI);
