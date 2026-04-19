/**
 * Spotify Pill Box API Wrapper & Controller
 * Q4NT PRO Implementation - High Fidelity Design
 */

class SpotifyPillController {
    constructor() {
        this.audio = new Audio();
        this.isPlaying = false;
        this.currentTrackIndex = 0;
        this.trackList = [];
        this.unlocked = false;
        
        // DOM Elements
        this.pillBox = null;
        this.mainBtn = null;
        this.trackName = null;
        this.artistName = null;

        this.init();
    }

    async init() {
        this.createHTMLElements();
        this.attachEventListeners();
        this.attachUnlockListeners();
        await this.fetchTracks();
        this.updateUI();
    }

    createHTMLElements() {
        const pillHTML = `
            <div id="spotifyPillBox">
                <div class="sp-main-btn">
                    <svg class="play-icon" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
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
                <!-- Expanded Controls on Hover -->
                <div class="sp-controls-expanded">
                    <button class="sp-sub-btn prev-btn" title="Previous">
                        <svg viewBox="0 0 24 24" fill="currentColor"><path d="M6 6h2v12H6zm3.5 6l8.5 6V6z"/></svg>
                    </button>
                    <button class="sp-sub-btn next-btn" title="Next">
                        <svg viewBox="0 0 24 24" fill="currentColor"><path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z"/></svg>
                    </button>
                </div>
            </div>
        `;
        document.getElementById('ui-container').insertAdjacentHTML('beforeend', pillHTML);

        this.pillBox = document.getElementById('spotifyPillBox');
        this.mainBtn = this.pillBox.querySelector('.sp-main-btn');
        this.trackName = this.pillBox.querySelector('.sp-track-name');
        this.artistName = this.pillBox.querySelector('.sp-artist-name');
    }

    attachEventListeners() {
        this.mainBtn.onclick = (e) => {
            e.stopPropagation();
            this.togglePlay();
        };

        this.pillBox.querySelector('.next-btn').onclick = (e) => {
            e.stopPropagation();
            this.nextTrack();
        };

        this.pillBox.querySelector('.prev-btn').onclick = (e) => {
            e.stopPropagation();
            this.prevTrack();
        };

        this.audio.onended = () => {
            this.nextTrack();
        };

        // Click on info to open expanded controls? 
        // For now, hover handles expansion in CSS.
    }

    attachUnlockListeners() {
        const unlock = () => {
            if (this.unlocked) return;
            this.unlocked = true;
            this.audio.play().then(() => {
                if (!this.isPlaying) this.audio.pause();
            }).catch(() => {});
            
            document.removeEventListener('pointerdown', unlock);
            document.removeEventListener('keydown', unlock);
            this.pillBox.removeEventListener('pointerenter', unlock);
        };

        document.addEventListener('pointerdown', unlock, { once: true });
        document.addEventListener('keydown', unlock, { once: true });
        this.pillBox.addEventListener('pointerenter', unlock, { once: true });
    }

    async fetchTracks() {
        try {
            const API_ORIGIN = 'http://localhost:8000';
            const response = await fetch(`${API_ORIGIN}/api/spotify/search?q=Free Bird`);
            const data = await response.json();
            this.trackList = data.tracks.items;
            if (this.trackList.length > 0) {
                this.loadTrack(0);
            }
        } catch (error) {
            console.error('Error fetching Spotify tracks:', error);
            this.trackName.innerText = "Error Loading";
        }
    }

    loadTrack(index) {
        const track = this.trackList[index];
        if (!track) return;

        this.currentTrackIndex = index;
        this.audio.src = track.preview_url;
        this.trackName.innerText = track.name;
        this.artistName.innerText = track.artists.map(a => a.name).join(', ');
        
        if (this.isPlaying) {
            this.audio.play();
        }
    }

    togglePlay() {
        if (this.isPlaying) {
            this.audio.pause();
            this.isPlaying = false;
        } else {
            this.audio.play();
            this.isPlaying = true;
        }
        this.updateUI();
    }

    nextTrack() {
        let nextIndex = this.currentTrackIndex + 1;
        if (nextIndex >= this.trackList.length) nextIndex = 0;
        this.loadTrack(nextIndex);
    }

    prevTrack() {
        let prevIndex = this.currentTrackIndex - 1;
        if (prevIndex < 0) prevIndex = this.trackList.length - 1;
        this.loadTrack(prevIndex);
    }

    updateUI() {
        if (this.isPlaying) {
            this.pillBox.classList.add('playing');
            this.mainBtn.querySelector('.play-icon').style.display = 'none';
            this.mainBtn.querySelector('.pause-icon').style.display = 'block';
        } else {
            this.pillBox.classList.remove('playing');
            this.mainBtn.querySelector('.play-icon').style.display = 'block';
            this.mainBtn.querySelector('.pause-icon').style.display = 'none';
        }
    }
}

// Initialize on load
window.addEventListener('DOMContentLoaded', () => {
    window.spotifyPill = new SpotifyPillController();
});
