/* ==========================================================================
   Q4NT PRO - Auto Theme Switcher
   Calculates precise sunrise/sunset via geolocation + NOAA solar algorithm.
   Caches coords in localStorage so the inline head script can apply the
   correct theme before first paint on subsequent loads.
   ========================================================================== */

(function () {

    // -------------------------------------------------------------------------
    // NOAA Solar Algorithm (simplified for sunrise/sunset hour calculation)
    // Returns { sunrise, sunset } as fractional hours in LOCAL time (0-24)
    // -------------------------------------------------------------------------
    function calcSunTimes(lat, lon, date) {
        const rad = Math.PI / 180;
        const dayOfYear = Math.floor((date - new Date(date.getFullYear(), 0, 0)) / 86400000);
        const lonHour = lon / 15;

        function calc(isSunrise) {
            const t = dayOfYear + ((isSunrise ? 6 : 18) - lonHour) / 24;
            const M = (0.9856 * t) - 3.289;
            let L = M + (1.916 * Math.sin(M * rad)) + (0.020 * Math.sin(2 * M * rad)) + 282.634;
            L = ((L % 360) + 360) % 360;

            let RA = Math.atan(0.91764 * Math.tan(L * rad)) / rad;
            RA = ((RA % 360) + 360) % 360;
            const Lquad = Math.floor(L / 90) * 90;
            const RAquad = Math.floor(RA / 90) * 90;
            RA = (RA + (Lquad - RAquad)) / 15;

            const sinDec = 0.39782 * Math.sin(L * rad);
            const cosDec = Math.cos(Math.asin(sinDec));
            const cosH = (Math.cos(90.833 * rad) - (sinDec * Math.sin(lat * rad))) / (cosDec * Math.cos(lat * rad));

            if (cosH > 1) return isSunrise ? null : 0;   // always night
            if (cosH < -1) return isSunrise ? 0 : 24;    // always day

            const H = isSunrise
                ? (360 - Math.acos(cosH) / rad) / 15
                : (Math.acos(cosH) / rad) / 15;

            const T = H + RA - (0.06571 * t) - 6.622;
            const UTh = ((T - lonHour) % 24 + 24) % 24;
            // Convert UTC to local fractional hour
            const offsetHours = -date.getTimezoneOffset() / 60;
            return ((UTh + offsetHours) % 24 + 24) % 24;
        }

        return {
            sunrise: calc(true),
            sunset: calc(false)
        };
    }

    // -------------------------------------------------------------------------
    // Apply the correct theme to <body> and sync to <html> for consistency
    // -------------------------------------------------------------------------
    function applyTheme(isDark) {
        const themes = ['dark-theme', 'light-theme', 'blue-theme', 'green-theme'];
        document.body.classList.remove(...themes);
        document.documentElement.classList.remove(...themes);

        const theme = isDark ? 'dark-theme' : 'light-theme';
        document.body.classList.add(theme);
        document.documentElement.classList.add(theme);

        // Drive the Three.js renderer background to match
        const rendererColor = isDark ? 0x000000 : 0xf5f5f7;
        function setRendererColor() {
            if (typeof Q4Scene !== 'undefined' && Q4Scene.renderer) {
                Q4Scene.renderer.setClearColor(rendererColor);
            } else {
                // Renderer not ready yet — retry after scene initializes
                setTimeout(setRendererColor, 300);
            }
        }
        setRendererColor();

        localStorage.setItem('q4nt_applied_theme', theme);
        console.log(`[Q4NT AutoTheme] Applied: ${theme} (isDark=${isDark})`);
    }

    // -------------------------------------------------------------------------
    // Schedule a re-check exactly at the next sunrise or sunset crossover
    // -------------------------------------------------------------------------
    function scheduleNextCheck(sunriseH, sunsetH) {
        const now = new Date();
        const currentH = now.getHours() + now.getMinutes() / 60 + now.getSeconds() / 3600;
        const isDark = currentH < sunriseH || currentH >= sunsetH;

        // Next event is the next threshold we haven't crossed yet
        const nextEventH = isDark
            ? (currentH < sunriseH ? sunriseH : sunriseH + 24)  // wait for sunrise
            : sunsetH;                                             // wait for sunset

        const msUntilNext = (nextEventH - currentH) * 3600 * 1000;
        console.log(`[Q4NT AutoTheme] Next theme switch in ${Math.round(msUntilNext / 60000)} min`);

        setTimeout(() => {
            runWithCoords(
                parseFloat(localStorage.getItem('q4nt_lat')),
                parseFloat(localStorage.getItem('q4nt_lon'))
            );
        }, msUntilNext + 1000); // +1s buffer past crossover
    }

    // -------------------------------------------------------------------------
    // Core logic: compute sun times, apply theme, schedule next switch
    // -------------------------------------------------------------------------
    function runWithCoords(lat, lon) {
        const now = new Date();
        const { sunrise, sunset } = calcSunTimes(lat, lon, now);
        const currentH = now.getHours() + now.getMinutes() / 60;
        const isDark = currentH < sunrise || currentH >= sunset;

        // Cache computed times for diagnostics
        localStorage.setItem('q4nt_sunrise', sunrise.toFixed(4));
        localStorage.setItem('q4nt_sunset', sunset.toFixed(4));

        console.log(
            `[Q4NT AutoTheme] Lat=${lat.toFixed(2)} Lon=${lon.toFixed(2)} | ` +
            `Sunrise=${toHHMM(sunrise)} Sunset=${toHHMM(sunset)} | ` +
            `Now=${toHHMM(currentH)} -> ${isDark ? 'DARK' : 'LIGHT'}`
        );

        applyTheme(isDark);
        scheduleNextCheck(sunrise, sunset);
    }

    function toHHMM(h) {
        const hh = Math.floor(h);
        const mm = Math.round((h - hh) * 60);
        return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
    }

    // -------------------------------------------------------------------------
    // Geolocation: use cached coords instantly, refresh in background
    // -------------------------------------------------------------------------
    function init() {
        const cachedLat = parseFloat(localStorage.getItem('q4nt_lat'));
        const cachedLon = parseFloat(localStorage.getItem('q4nt_lon'));

        // Run immediately with cached coords if available (already applied by head script)
        if (!isNaN(cachedLat) && !isNaN(cachedLon)) {
            runWithCoords(cachedLat, cachedLon);
        }

        // Refresh coords in background (no alert, no block)
        if ('geolocation' in navigator && window.location.protocol !== 'file:') {
            navigator.geolocation.getCurrentPosition(
                (pos) => {
                    const lat = pos.coords.latitude;
                    const lon = pos.coords.longitude;
                    localStorage.setItem('q4nt_lat', lat);
                    localStorage.setItem('q4nt_lon', lon);
                    // Re-run with fresh coords to correct any drift
                    runWithCoords(lat, lon);
                },
                (err) => {
                    console.warn('[Q4NT AutoTheme] Geolocation fallback.', err.message);
                    // Fall back to default coords if nothing cached
                    if (isNaN(cachedLat)) {
                        runWithCoords(40.7128, -74.006); // NYC fallback
                    }
                },
                { timeout: 8000, maximumAge: 3600000 } // accept a cached fix up to 1hr old
            );
        } else if (isNaN(cachedLat)) {
            runWithCoords(40.7128, -74.006); // NYC fallback
        }
    }

    // Run after body is available (DOMContentLoaded is reliable here since
    // this script loads at the end of <body>)
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

})();
