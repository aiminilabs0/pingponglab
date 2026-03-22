// ════════════════════════════════════════════════════════════
//  YouTube Embed
// ════════════════════════════════════════════════════════════

function parsePlaylistFromLink(link, fallbackVideoId) {
    const rawPlaylist = (link.dataset.ytPlaylist || '').trim();
    if (!rawPlaylist) return { playlist: [], currentIndex: 0 };

    const playlist = Array.from(new Set(
        rawPlaylist
            .split(',')
            .map(id => id.trim())
            .filter(Boolean)
    ));
    if (!playlist.length) return { playlist: [], currentIndex: 0 };

    if (fallbackVideoId && !playlist.includes(fallbackVideoId)) {
        playlist.unshift(fallbackVideoId);
    }

    let currentIndex = Number.parseInt(link.dataset.ytIndex || '', 10);
    if (!Number.isInteger(currentIndex) || currentIndex < 0 || currentIndex >= playlist.length) {
        currentIndex = fallbackVideoId ? playlist.indexOf(fallbackVideoId) : 0;
    }
    if (currentIndex < 0) currentIndex = 0;

    return { playlist, currentIndex };
}

function readEmbedPlaylistState(embedWrapper) {
    const playlist = (embedWrapper.dataset.playlist || '')
        .split(',')
        .map(id => id.trim())
        .filter(Boolean);
    const currentIndex = Number.parseInt(embedWrapper.dataset.currentIndex || '0', 10);
    return {
        playlist,
        currentIndex: Number.isInteger(currentIndex) ? currentIndex : 0,
    };
}

function writeEmbedPlaylistState(embedWrapper, playlist, currentIndex) {
    embedWrapper.dataset.playlist = playlist.join(',');
    embedWrapper.dataset.currentIndex = String(currentIndex);
}

function updateEmbedPagerUi(embedWrapper) {
    const pageEl = embedWrapper.querySelector('.yt-embed-page');
    if (!pageEl) return;
    const prevBtn = embedWrapper.querySelector('.yt-embed-nav-btn[data-direction="prev"]');
    const nextBtn = embedWrapper.querySelector('.yt-embed-nav-btn[data-direction="next"]');
    const { playlist, currentIndex } = readEmbedPlaylistState(embedWrapper);
    if (!playlist.length) return;
    pageEl.textContent = `${currentIndex + 1} / ${playlist.length}`;
    if (prevBtn) prevBtn.disabled = currentIndex <= 0;
    if (nextBtn) nextBtn.disabled = currentIndex >= playlist.length - 1;
}

function updateEmbedVideo(embedWrapper, videoId) {
    if (!videoId) return;
    embedWrapper.dataset.videoId = videoId;
    const playerId = embedWrapper.dataset.playerId;
    const player = playerId ? ytPlayers[playerId] : null;
    if (player && typeof player.loadVideoById === 'function') {
        player.loadVideoById(videoId);
        return;
    }

    const iframe = embedWrapper.querySelector('iframe');
    if (iframe) {
        iframe.src = `https://www.youtube.com/embed/${videoId}?autoplay=1&mute=0&playsinline=1&rel=0`;
    }
}

function closeYouTubeEmbed(embedWrapper) {
    if (!embedWrapper) return;
    const playerId = embedWrapper.dataset.playerId;
    if (playerId && ytPlayers[playerId]) {
        try { ytPlayers[playerId].destroy(); } catch {}
        delete ytPlayers[playerId];
    }

    const scope =
        embedWrapper.closest('.radar-section') ||
        embedWrapper.closest('.content-pane') ||
        embedWrapper.parentElement;

    embedWrapper.remove();
    if (!scope || !scope.querySelectorAll) return;
    scope.querySelectorAll('.yt-mobile-hint').forEach(el => el.remove());
    scope.querySelectorAll('a[data-yt-videoid].yt-active').forEach(el => el.classList.remove('yt-active'));
}

function createEmbedPager(embedWrapper) {
    const { playlist } = readEmbedPlaylistState(embedWrapper);
    if (!playlist.length) return;

    const pager = document.createElement('div');
    pager.className = 'yt-embed-nav';
    pager.innerHTML = `
        <button type="button" class="yt-embed-nav-btn" data-direction="prev" aria-label="Previous video"><</button>
        <span class="yt-embed-page"></span>
        <button type="button" class="yt-embed-nav-btn" data-direction="next" aria-label="Next video">></button>
    `;
    embedWrapper.appendChild(pager);
    updateEmbedPagerUi(embedWrapper);
}

function scrollEmbedToCenter(embedWrapper) {
    if (!embedWrapper || typeof embedWrapper.scrollIntoView !== 'function') return;
    requestAnimationFrame(() => {
        embedWrapper.scrollIntoView({
            behavior: 'smooth',
            block: 'center',
            inline: 'nearest',
        });
    });
}

function toggleYouTubeEmbed(iconLink, videoId, { playlist = [], currentIndex = 0 } = {}) {
    const panel = iconLink.closest('.content-pane') || iconLink.closest('.radar-info-combined');
    if (!panel || !videoId) return;
    const isRadarPanel = panel.classList.contains('radar-info-combined');
    const radarSection = isRadarPanel ? panel.closest('.radar-section') : null;

    // For radar panels, embed lives in .radar-section (full-width); otherwise in the panel.
    const embedContainer = radarSection || panel;

    // Toggle existing embed in this container; clicking same video closes it.
    let embedWrapper = embedContainer.querySelector('.youtube-embed-wrapper');
    if (embedWrapper) {
        const existingVideoId = embedWrapper.dataset.videoId;
        const existingPlaylist = embedWrapper.dataset.playlist || '';
        const requestedPlaylist = Array.isArray(playlist) ? playlist.join(',') : '';
        closeYouTubeEmbed(embedWrapper);
        if (existingVideoId === videoId && existingPlaylist === requestedPlaylist) return;
    }

    // Insert embed wrapper in a way that preserves description visibility.
    const titleHeader = panel.querySelector('.rubber-title-header');
    const scrollContainer = panel.querySelector('.content-pane-scroll');
    const metricsBlock = panel.querySelector('.radar-info-metrics') || panel.querySelector('.radar-comparison-grid');
    embedWrapper = document.createElement('div');
    embedWrapper.className = 'youtube-embed-wrapper';
    embedWrapper.style.cssText = 'position:relative;aspect-ratio:16/9;overflow:hidden;';
    embedWrapper.dataset.videoId = videoId;
    writeEmbedPlaylistState(embedWrapper, playlist, currentIndex);
    if (isRadarPanel) embedWrapper.classList.add('youtube-embed-wrapper--radar');

    // Close button to stop and dismiss the embed.
    const closeBtn = document.createElement('button');
    closeBtn.className = 'landscape-fs-close';
    closeBtn.textContent = '✕';
    closeBtn.setAttribute('aria-label', 'Close video');
    closeBtn.onclick = () => closeYouTubeEmbed(embedWrapper);
    embedWrapper.appendChild(closeBtn);

    const playerDiv = document.createElement('div');
    const playerId = 'yt-player-' + (++ytPlayerIdCounter);
    playerDiv.id = playerId;
    playerDiv.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;';
    embedWrapper.appendChild(playerDiv);
    embedWrapper.dataset.playerId = playerId;
    createEmbedPager(embedWrapper);

    const shouldShowMobileHint = window.matchMedia('(max-width: 768px)').matches &&
        ('ontouchstart' in window || navigator.maxTouchPoints > 0);
    let hint = null;
    if (shouldShowMobileHint) {
        hint = document.createElement('div');
        hint.className = 'yt-mobile-hint';
        hint.textContent = '↻ Rotate for full screen';
    }

    if (radarSection) {
        radarSection.appendChild(embedWrapper);
        if (hint) radarSection.appendChild(hint);
    } else if (scrollContainer) {
        // Keep explanation text in the same scroll context as the video.
        scrollContainer.insertBefore(embedWrapper, scrollContainer.firstChild);
        if (hint) embedWrapper.after(hint);
    } else if (titleHeader && titleHeader.nextSibling) {
        panel.insertBefore(embedWrapper, titleHeader.nextSibling);
        if (hint) embedWrapper.after(hint);
    } else {
        panel.appendChild(embedWrapper);
        if (hint) panel.appendChild(hint);
    }
    scrollEmbedToCenter(embedWrapper);

    embedContainer.querySelectorAll('a[data-yt-videoid].yt-active').forEach(el => el.classList.remove('yt-active'));
    iconLink.classList.add('yt-active');

    if (ytApiReady && typeof YT !== 'undefined' && YT.Player) {
        ytPlayers[playerId] = new YT.Player(playerId, {
            videoId,
            playerVars: { autoplay: 1, playsinline: 1, rel: 0, mute: 0 },
            events: {
                onReady: e => {
                    e.target.unMute();
                    e.target.playVideo();
                }
            }
        });
    } else {
        playerDiv.outerHTML =
            `<iframe src="https://www.youtube.com/embed/${videoId}?autoplay=1&mute=0&playsinline=1&rel=0" ` +
            `style="position:absolute;top:0;left:0;width:100%;height:100%;border:none;" ` +
            `allow="autoplay; encrypted-media; fullscreen" allowfullscreen></iframe>`;
    }
}

// Landscape pseudo-fullscreen for embedded videos (CSS-based, no user gesture required)
function handleOrientationFullscreen() {
    const wrapper = document.querySelector('.youtube-embed-wrapper');
    if (!wrapper) return;
    wrapper.classList.toggle('landscape-fs', window.innerWidth > window.innerHeight);
}

if (screen.orientation) {
    screen.orientation.addEventListener('change', () => setTimeout(handleOrientationFullscreen, 150));
}
window.addEventListener('orientationchange', () => setTimeout(handleOrientationFullscreen, 150));

// User Guide embed toggle
function toggleUserGuideEmbed(btn) {
    const videoId = btn.dataset.ytGuide;
    if (!videoId) return;

    const chartBleed = btn.closest('.chart-bleed');
    if (!chartBleed) return;

    let embed = chartBleed.querySelector('.user-guide-embed');
    if (embed) {
        const playerId = embed.dataset.playerId;
        if (playerId && ytPlayers[playerId]) {
            try { ytPlayers[playerId].destroy(); } catch {}
            delete ytPlayers[playerId];
        }
        embed.remove();
        btn.classList.remove('yt-active');
        return;
    }

    embed = document.createElement('div');
    embed.className = 'user-guide-embed';

    const closeBtn = document.createElement('button');
    closeBtn.className = 'landscape-fs-close';
    closeBtn.textContent = '✕';
    closeBtn.setAttribute('aria-label', 'Close video');
    closeBtn.onclick = () => {
        const pid = embed.dataset.playerId;
        if (pid && ytPlayers[pid]) {
            try { ytPlayers[pid].destroy(); } catch {}
            delete ytPlayers[pid];
        }
        embed.remove();
        btn.classList.remove('yt-active');
    };
    embed.appendChild(closeBtn);

    const playerDiv = document.createElement('div');
    const playerId = 'yt-player-' + (++ytPlayerIdCounter);
    playerDiv.id = playerId;
    playerDiv.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;';
    embed.appendChild(playerDiv);
    embed.dataset.playerId = playerId;

    const chartEl = chartBleed.querySelector('#chart');
    chartBleed.insertBefore(embed, chartEl);
    btn.classList.add('yt-active');

    if (ytApiReady && typeof YT !== 'undefined' && YT.Player) {
        ytPlayers[playerId] = new YT.Player(playerId, {
            videoId,
            playerVars: { autoplay: 1, playsinline: 1, rel: 0, mute: 0 },
            events: {
                onReady: e => {
                    e.target.unMute();
                    e.target.playVideo();
                }
            }
        });
    } else {
        playerDiv.outerHTML =
            `<iframe src="https://www.youtube.com/embed/${videoId}?autoplay=1&mute=0&playsinline=1&rel=0" ` +
            `style="position:absolute;top:0;left:0;width:100%;height:100%;border:none;" ` +
            `allow="autoplay; encrypted-media; fullscreen" allowfullscreen></iframe>`;
    }

    scrollEmbedToCenter(embed);
}

// Event delegation: YouTube title icon clicks toggle the embed below the title header.
document.addEventListener('click', (e) => {
    const guideBtn = e.target.closest('.user-guide-btn');
    if (guideBtn) {
        e.preventDefault();
        toggleUserGuideEmbed(guideBtn);
        return;
    }

    const navBtn = e.target.closest('.yt-embed-nav-btn');
    if (navBtn) {
        e.preventDefault();
        if (navBtn.disabled) return;
        const embedWrapper = navBtn.closest('.youtube-embed-wrapper');
        if (!embedWrapper) return;
        const { playlist, currentIndex } = readEmbedPlaylistState(embedWrapper);
        if (!playlist.length) return;
        const delta = navBtn.dataset.direction === 'prev' ? -1 : 1;
        const maxIndex = playlist.length - 1;
        const nextIndex = Math.min(maxIndex, Math.max(0, currentIndex + delta));
        if (nextIndex === currentIndex) return;
        writeEmbedPlaylistState(embedWrapper, playlist, nextIndex);
        updateEmbedPagerUi(embedWrapper);
        updateEmbedVideo(embedWrapper, playlist[nextIndex]);
        return;
    }

    const link = e.target.closest('a[data-yt-videoid]');
    if (!link) return;
    e.preventDefault();
    const videoId = link.dataset.ytVideoid;
    if (!videoId) return;
    const { playlist, currentIndex } = parsePlaylistFromLink(link, videoId);
    toggleYouTubeEmbed(link, videoId, { playlist, currentIndex });
});
