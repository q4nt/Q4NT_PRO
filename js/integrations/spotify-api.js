/**
 * Q4NT PRO — Spotify Pill Controller
 * Handles the music pill box UI, audio playback, and track management.
 *
 * Non-music concerns previously in this file have been extracted:
 *   - View Cycle HUD (depth mode navigation) -> js/ui/view-cycle-hud.js
 *   - Workspace Preview Cube (Three.js cube)  -> js/ui/workspace-cube.js
 */

class SpotifyPillController {
    constructor() {
        this.audio             = new Audio();
        this.isPlaying         = false;
        this.currentTrackIndex = 0;
        this.trackList         = [];
        this.unlocked          = false;

        // DOM refs — set after HTML injection
        this.pillBox    = null;
        this.mainBtn    = null;
        this.trackName  = null;
        this.artistName = null;

        this.init();
    }

    async init() {
        this._injectHTML();
        this._attachPlaybackListeners();
        this._attachUnlockListeners();
        await this._fetchTracks();
        this._updateUI();
    }

    // ------------------------------------------------------------------
    // DOM: inject the bottom-right stack (cubeWrapper + pillBox)
    // The cube Three.js renderer and view-cycle HUD are initialised
    // separately by workspace-cube.js and view-cycle-hud.js.
    // ------------------------------------------------------------------
    _injectHTML() {
        let stack = document.getElementById('bottomRightStack');
        if (!stack) {
            stack = document.createElement('div');
            stack.id = 'bottomRightStack';
            let container = document.getElementById('ui-container') || document.body;
            container.appendChild(stack);
        }

        const pillHTML = `
            <div id="spotifyPillBox">
                <div class="sp-main-btn" title="Play / Pause">
                    <svg class="play-icon"  viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
                    <svg class="pause-icon" viewBox="0 0 24 24" fill="currentColor" style="display:none;"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>
                </div>
                <div class="sp-info">
                    <div class="sp-track-name">Free Bird</div>
                    <div class="sp-artist-name">Lynyrd Skynyrd</div>
                </div>
                <div class="sp-eq-container">
                    <div class="eq-bar"></div>
                    <div class="eq-bar"></div>
                    <div class="eq-bar"></div>
                    <div class="eq-bar"></div>
                </div>
                <div class="sp-controls-expanded">
                    <button class="sp-sub-btn prev-btn" title="Previous Track">
                        <svg viewBox="0 0 24 24" fill="currentColor"><path d="M6 6h2v12H6zm3.5 6l8.5 6V6z"/></svg>
                    </button>
                    <button class="sp-sub-btn next-btn" title="Next Track">
                        <svg viewBox="0 0 24 24" fill="currentColor"><path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z"/></svg>
                    </button>
                </div>
            </div>
        `;

        stack.insertAdjacentHTML('beforeend', pillHTML);

        this.pillBox    = document.getElementById('spotifyPillBox');
        this.mainBtn    = this.pillBox.querySelector('.sp-main-btn');
        this.trackName  = this.pillBox.querySelector('.sp-track-name');
        this.artistName = this.pillBox.querySelector('.sp-artist-name');
    }

    // ------------------------------------------------------------------
    // Playback controls
    // ------------------------------------------------------------------
    _attachPlaybackListeners() {
        this.mainBtn.onclick = (e) => { e.stopPropagation(); this.togglePlay(); };

        this.pillBox.querySelector('.next-btn').onclick = (e) => { e.stopPropagation(); this.nextTrack(); };
        this.pillBox.querySelector('.prev-btn').onclick = (e) => { e.stopPropagation(); this.prevTrack(); };

        this.audio.onended = () => this.nextTrack();
    }

    _attachUnlockListeners() {
        const unlock = () => {
            if (this.unlocked) return;
            this.unlocked = true;
            this.audio.play().then(() => {
                if (!this.isPlaying) this.audio.pause();
            }).catch(() => {});
            document.removeEventListener('pointerdown', unlock);
            document.removeEventListener('keydown',     unlock);
            this.pillBox.removeEventListener('pointerenter', unlock);
        };
        document.addEventListener('pointerdown',  unlock, { once: true });
        document.addEventListener('keydown',      unlock, { once: true });
        this.pillBox.addEventListener('pointerenter', unlock, { once: true });
    }

    // ------------------------------------------------------------------
    // Track management
    // ------------------------------------------------------------------
    async _fetchTracks() {
        try {
            const apiBase = (typeof Q4Config !== 'undefined' && Q4Config.API_BASE) ? Q4Config.API_BASE : 'http://localhost:8000';
            const res  = await fetch(`${apiBase}/api/spotify/search?q=Free Bird`);
            const data = await res.json();
            this.trackList = data.tracks.items;
            if (this.trackList.length > 0) this._loadTrack(0);
        } catch (err) {
            console.error('[SpotifyPill] Track fetch failed:', err);
            this.trackName.innerText = 'Error Loading';
        }
    }

    _loadTrack(index) {
        const track = this.trackList[index];
        if (!track) return;
        this.currentTrackIndex  = index;
        this.audio.src          = track.preview_url;
        this.trackName.innerText  = track.name;
        this.artistName.innerText = track.artists.map(a => a.name).join(', ');
        if (this.isPlaying) this.audio.play();
    }

    togglePlay() {
        if (this.isPlaying) {
            this.audio.pause();
            this.isPlaying = false;
        } else {
            this.audio.play();
            this.isPlaying = true;
        }
        this._updateUI();
    }

    nextTrack() {
        let idx = this.currentTrackIndex + 1;
        if (idx >= this.trackList.length) idx = 0;
        this._loadTrack(idx);
    }

    prevTrack() {
        let idx = this.currentTrackIndex - 1;
        if (idx < 0) idx = this.trackList.length - 1;
        this._loadTrack(idx);
    }

    _updateUI() {
        const playing = this.isPlaying;
        this.pillBox.classList.toggle('playing', playing);
        this.mainBtn.querySelector('.play-icon').style.display  = playing ? 'none'  : 'block';
        this.mainBtn.querySelector('.pause-icon').style.display = playing ? 'block' : 'none';
    }
}

// Boot
window.addEventListener('DOMContentLoaded', () => {
    window.spotifyPill = new SpotifyPillController();
});
