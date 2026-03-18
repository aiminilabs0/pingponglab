// ════════════════════════════════════════════════════════════
//  Reset
// ════════════════════════════════════════════════════════════

function resetFiltersToAll() {
    ['brandFilter', 'sheetFilter'].forEach(id => {
        const el = document.getElementById(id);
        if (el) setAllChecked(el, true);
    });
    resetHardnessRangeToDataBounds();
    resetWeightRangeToDataBounds();
    resetControlToAllTiers();
    const isMobile = window.matchMedia('(max-width: 768px)').matches;
    top30FilterActive = isMobile;
    const seg = document.querySelector('#top30Filter .fp-seg');
    if (seg) {
        const activeValue = isMobile ? 'top30' : 'all';
        seg.querySelector('.fp-seg-btn.active')?.classList.remove('active');
        seg.querySelector(`.fp-seg-btn[data-value="${activeValue}"]`)?.classList.add('active');
        positionSegSlider(seg);
    }
    const nameFilter = document.getElementById('nameFilter');
    if (nameFilter) {
        nameFilter.innerHTML = '';
        buildNameOptionsFromFilters();
    }
}

function resetYouTubePlayers() {
    Object.keys(ytPlayers).forEach(pid => {
        try { ytPlayers[pid].destroy(); } catch {}
    });
    ytPlayers = {};
    document.querySelectorAll('.youtube-embed-wrapper').forEach(w => w.remove());
    document.querySelectorAll('.yt-mobile-hint').forEach(el => el.remove());
}

function resetAppToInitialState() {
    closeFilterPanel();
    resetYouTubePlayers();
    selectedRubbers = [null, null];
    nextDetailPanel = 1;
    pinnedRubbers = [false, false];

    resetFiltersToAll();
    resetDetailPanels();
    updateRadarChart();
    updateFilterSummary();
    pushFiltersToUrl();

    const chartEl = document.getElementById('chart');
    if (chartEl && hasPlotted) {
        // Rebuild with fresh autoscaled bounds (do not preserve panned/zoomed ranges).
        updateChart({ force: true });
        // Match initial-load behavior: apply Plotly autoscale after first render tick.
        requestAnimationFrame(() => {
            triggerAutoscale();
        });
    } else {
        updateChart();
    }
}
