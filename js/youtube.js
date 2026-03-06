// ════════════════════════════════════════════════════════════
//  YouTube Embed
// ════════════════════════════════════════════════════════════

function toggleYouTubeEmbed(iconLink, videoId) {
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
        const pid = embedWrapper.dataset.playerId;
        if (pid && ytPlayers[pid]) {
            try { ytPlayers[pid].destroy(); } catch {}
            delete ytPlayers[pid];
        }
        embedWrapper.remove();
        embedContainer.querySelectorAll('.yt-mobile-hint').forEach(el => el.remove());
        embedContainer.querySelectorAll('a[data-yt-videoid].yt-active').forEach(el => el.classList.remove('yt-active'));
        if (existingVideoId === videoId) return;
    }

    // Insert embed wrapper near the section header/metrics.
    const titleHeader = panel.querySelector('.rubber-title-header');
    const metricsBlock = panel.querySelector('.radar-info-metrics') || panel.querySelector('.radar-comparison-grid');
    embedWrapper = document.createElement('div');
    embedWrapper.className = 'youtube-embed-wrapper';
    embedWrapper.style.cssText = 'position:relative;aspect-ratio:16/9;overflow:hidden;';
    embedWrapper.dataset.videoId = videoId;
    if (isRadarPanel) embedWrapper.classList.add('youtube-embed-wrapper--radar');

    // Close button for landscape pseudo-fullscreen
    const closeBtn = document.createElement('button');
    closeBtn.className = 'landscape-fs-close';
    closeBtn.textContent = '✕';
    closeBtn.onclick = () => embedWrapper.classList.remove('landscape-fs');
    embedWrapper.appendChild(closeBtn);

    const playerDiv = document.createElement('div');
    const playerId = 'yt-player-' + (++ytPlayerIdCounter);
    playerDiv.id = playerId;
    playerDiv.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;';
    embedWrapper.appendChild(playerDiv);
    embedWrapper.dataset.playerId = playerId;

    const hint = document.createElement('div');
    hint.className = 'yt-mobile-hint';
    hint.textContent = '↻ Rotate for full screen';

    if (radarSection) {
        radarSection.appendChild(embedWrapper);
        radarSection.appendChild(hint);
    } else if (titleHeader && titleHeader.nextSibling) {
        panel.insertBefore(embedWrapper, titleHeader.nextSibling);
        embedWrapper.after(hint);
    } else {
        panel.appendChild(embedWrapper);
        panel.appendChild(hint);
    }

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

// Event delegation: YouTube title icon clicks toggle the embed below the title header.
document.addEventListener('click', (e) => {
    const link = e.target.closest('a[data-yt-videoid]');
    if (!link) return;
    e.preventDefault();
    const videoId = link.dataset.ytVideoid;
    if (!videoId) return;
    toggleYouTubeEmbed(link, videoId);
});
