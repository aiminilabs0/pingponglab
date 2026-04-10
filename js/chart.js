// ════════════════════════════════════════════════════════════
//  Chart: Axis & Bounds Utilities
// ════════════════════════════════════════════════════════════

function getCurrentAxisRanges() {
    const chartEl = document.getElementById('chart');
    const xa = chartEl?._fullLayout?.xaxis;
    const ya = chartEl?._fullLayout?.yaxis;
    if (!Array.isArray(xa?.range) || !Array.isArray(ya?.range)) return null;
    return { xaxis: [xa.range[0], xa.range[1]], yaxis: [ya.range[0], ya.range[1]] };
  }

function updateHeaderTagline() {
    const ranges = getCurrentAxisRanges();
    const filteredData = currentFilteredData;
    let inViewCount;
    if (ranges) {
        const [x0, x1] = ranges.xaxis;
        const [y0, y1] = ranges.yaxis;
        const minX = Math.min(x0, x1);
        const maxX = Math.max(x0, x1);
        const minY = Math.min(y0, y1);
        const maxY = Math.max(y0, y1);
        inViewCount = filteredData.filter(r =>
            r.x >= minX && r.x <= maxX &&
            r.y >= minY && r.y <= maxY
        ).length;
    } else {
        inViewCount = filteredData.length;
    }
    const headerTagline = document.querySelector('.header-tagline');
    if (headerTagline) {
        headerTagline.innerHTML = `Showing <span class="header-tagline-current-count">${inViewCount}</span> of ${filteredData.length} in this range`;
    }
}


function shouldAutoscaleForFilteredData(filteredData, currentRanges) {
    if (!currentRanges || filteredData.length === 0) return false;
    const [xMin, xMax] = currentRanges.xaxis;
    const [yMin, yMax] = currentRanges.yaxis;
    return filteredData.some(r => r.x < xMin || r.x > xMax || r.y < yMin || r.y > yMax);
}

function getAutoscaleBounds(rubbers) {
    if (!Array.isArray(rubbers) || rubbers.length === 0) return null;
    const xs = rubbers.map(r => r.x);
    const ys = rubbers.map(r => r.y);
    const [minX, maxX] = [Math.min(...xs), Math.max(...xs)];
    const [minY, maxY] = [Math.min(...ys), Math.max(...ys)];
    const padX = Math.max(0.5, (maxX - minX) * 0.05);
    const padY = Math.max(0.5, (maxY - minY) * 0.05);
    return { x: [minX - padX, maxX + padX], y: [minY - padY, maxY + padY] };
}

function viewCoversDataBounds(rubbers, xRange, yRange) {
    const bounds = getAutoscaleBounds(rubbers);
    if (!bounds) return true;
    return xRange[0] <= bounds.x[0] && xRange[1] >= bounds.x[1] &&
           yRange[0] <= bounds.y[0] && yRange[1] >= bounds.y[1];
}

function clampRangeToBounds(range, bounds) {
    return [Math.max(range[0], bounds[0]), Math.min(range[1], bounds[1])];
}
// ════════════════════════════════════════════════════════════
//  Chart: Filtering & Visibility
// ════════════════════════════════════════════════════════════

function getFilteredData() {
    const selectedBrands = new Set(getCheckedValues('brandFilter'));
    const selectedNames = new Set(getCheckedValues('nameFilter'));
    const selectedSheet = new Set(getCheckedValues('sheetFilter'));

    if (!selectedBrands.size || !selectedNames.size ||
        !selectedSheet.size) {
        return [];
    }

    const filterByWeight = isWeightFilterActive();
    const minWeight = weightFilterState.selectedMin;
    const maxWeight = weightFilterState.selectedMax;

    const filterByHardness = isHardnessFilterActive();
    const minHardness = hardnessFilterState.selectedMin;
    const maxHardness = hardnessFilterState.selectedMax;

    const filterByControl = isControlFilterActive();
    const selectedLevels = controlFilterState.selectedLevels;

    return rubberData.filter(rubber =>
        selectedBrands.has(rubber.brand) &&
        selectedNames.has(rubber.abbr) &&
        selectedSheet.has(rubber.sheet) &&
        (!filterByHardness || (Number.isFinite(rubber.normalizedHardness) && rubber.normalizedHardness >= minHardness && rubber.normalizedHardness <= maxHardness)) &&
        (!filterByWeight || (Number.isFinite(rubber.weight) && rubber.weight >= minWeight && rubber.weight <= maxWeight)) &&
        (!filterByControl || selectedLevels.has(rubber.controlLevel)) &&
        (!top30FilterActive || top30Set.has(rubber.fullName))
    );
}

// ── Label-placement with leader lines ──────────────────────
// Computes Plotly annotation objects for every visible rubber.
// Labels that would overlap are pushed outward and connected to their
// data-point with a subtle arrow (leader line).

function computeLabelAnnotations(visibleData, xRange, yRange, plotWidth, plotHeight) {
    if (visibleData.length === 0 || plotWidth <= 0 || plotHeight <= 0) return [];
    const isSingleRubber = visibleData.length === 1;

    const xSpan = xRange[1] - xRange[0];
    const ySpan = yRange[1] - yRange[0];
    if (xSpan <= 0 || ySpan <= 0) return [];

    // Data → pixel helpers
    const toPx = (dx, dy) => ({
        px: ((dx - xRange[0]) / xSpan) * plotWidth,
        py: ((yRange[1] - dy) / ySpan) * plotHeight   // y-axis is inverted in pixel space
    });

    // Estimated label half-dimensions in pixels
    const LABEL_H_WIDTH  = 30;
    const LABEL_H_HEIGHT = 8;

    // Radius (px) within which other data-points count as "neighbours"
    const NEIGHBOR_RADIUS = 80;
    // Minimum distance (px) between a label centre and any data-point
    const POINT_CLEARANCE = 14;

    // Pre-compute pixel positions for every visible rubber
    const allPx = visibleData.map(r => toPx(r.x, r.y));

    // 12 evenly-spaced directions × distance rings candidate slots.
    // For multi-rubber views, skip the closest ring so labels are always
    // displaced into empty space with a leader line.
    const ANGLE_COUNT = 12;
    const DISTANCES = isSingleRubber ? [18, 36, 54] : [36, 54, 72];
    const BASE_ANGLES = Array.from(
        { length: ANGLE_COUNT },
        (_, i) => (2 * Math.PI * i) / ANGLE_COUNT - Math.PI / 2   // start at "up"
    );

    // Build the full candidate pool (angle × distance), each with a pre-computed unit direction
    const BASE_CANDIDATES = [];
    for (const dist of DISTANCES) {
        for (const angle of BASE_ANGLES) {
            BASE_CANDIDATES.push({
                ax: Math.round(Math.cos(angle) * dist),
                ay: Math.round(Math.sin(angle) * dist),
                angle,
                dist
            });
        }
    }

    // Angular difference helper (returns 0..π)
    const angleDiff = (a, b) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));

    // Placed label bounding boxes in pixel space
    const placed = [];

    const selectedSet = new Set(selectedRubbers.filter(Boolean));
    const sorted = [...visibleData].sort((a, b) => {
        const aSelected = selectedSet.has(a) ? 0 : 1;
        const bSelected = selectedSet.has(b) ? 0 : 1;
        if (aSelected !== bSelected) return aSelected - bSelected;
        return (a.priority ?? 999) - (b.priority ?? 999);
    });
    const annotations = [];

    for (const rubber of sorted) {
        const { px, py } = toPx(rubber.x, rubber.y);

        // ── Compute repulsion direction (away from nearby data-points) ──
        let repX = 0;
        let repY = 0;
        let neighborCount = 0;

        for (const pt of allPx) {
            const dx = px - pt.px;
            const dy = py - pt.py;
            const d = Math.sqrt(dx * dx + dy * dy);
            if (d > 0 && d < NEIGHBOR_RADIUS) {
                const w = 1 / d;          // closer neighbours push harder
                repX += dx * w;
                repY += dy * w;
                neighborCount++;
            }
        }

        // Preferred escape angle: direction away from neighbours, default to "up"
        const repAngle = neighborCount > 0
            ? Math.atan2(repY, repX)
            : -Math.PI / 2;

        // Sort candidates: prefer the direction aligned with repulsion, then shorter distance
        const candidates = [...BASE_CANDIDATES].sort((a, b) => {
            const da = angleDiff(a.angle, repAngle);
            const db = angleDiff(b.angle, repAngle);
            // Bucket angular closeness (within ~30° treated as equal) then prefer shorter
            if (Math.abs(da - db) > 0.5) return da - db;
            return a.dist - b.dist;
        });

        let bestIdx = 0;
        for (let ci = 0; ci < candidates.length; ci++) {
            const cx = px + candidates[ci].ax;
            const cy = py + candidates[ci].ay;

            // Check overlap with already-placed labels
            const hitsLabel = placed.some(
                p => Math.abs(cx - p.cx) < LABEL_H_WIDTH * 2 &&
                     Math.abs(cy - p.cy) < LABEL_H_HEIGHT * 2
            );
            if (hitsLabel) continue;

            // Check that the label doesn't land on top of another data-point
            const hitsPoint = allPx.some(pt => {
                if (pt.px === px && pt.py === py) return false; // skip own point
                return Math.abs(cx - pt.px) < POINT_CLEARANCE &&
                       Math.abs(cy - pt.py) < POINT_CLEARANCE;
            });
            if (hitsPoint) continue;

            bestIdx = ci;
            break;
        }

        const chosen = candidates[bestIdx];
        placed.push({ cx: px + chosen.ax, cy: py + chosen.ay });

        annotations.push({
            x: rubber.x,
            y: rubber.y,
            xref: 'x',
            yref: 'y',
            text: tRubber(rubber.abbr),
            showarrow: true,
            arrowhead: 0,
            arrowwidth: 0.75,
            arrowcolor: 'rgba(155,148,132,0.3)',
            ax: chosen.ax,
            ay: chosen.ay,
            font: {
                size: spotlightRubber === rubber ? 16 : 13.5,
                color: spotlightRubber === rubber ? '#d4c16a' : 'rgba(232,224,208,0.75)',
                family: CHART_FONT
            },
            bgcolor: 'transparent',
            borderpad: 0,
            xanchor: 'center',
            yanchor: 'bottom',
            standoff: 6,
            captureevents: false
        });
    }

    return annotations;
}

// Thin overlapping labels by priority (lower priority number = higher importance)
let _prevVisibleRubbers = [];

// Track whether the mobile chart is currently zoomed in (enables pan mode)
let _mobileZoomed = false;

function computeVisibleRubbers(filteredData) {
    if (filteredData.length === 0) { _prevVisibleRubbers = []; return []; }
    // Desktop: keep every rubber point/label visible, even when overlapping.
    if (window.matchMedia('(min-width: 769px)').matches) { _prevVisibleRubbers = []; return filteredData; }

    const chartEl = document.getElementById('chart');
    let xRange, yRange, plotWidth, plotHeight;

    if (chartEl._fullLayout?.xaxis && chartEl._fullLayout?.yaxis) {
        const { xaxis: xa, yaxis: ya, _size: size } = chartEl._fullLayout;
        xRange = [xa.range[0], xa.range[1]];
        yRange = [ya.range[0], ya.range[1]];
        plotWidth = size.w;
        plotHeight = size.h;
    } else {
        // First render — estimate from data bounds and container size
        const xs = filteredData.map(r => r.x);
        const ys = filteredData.map(r => r.y);
        const pad = 2;
        xRange = [Math.min(...xs) - pad, Math.max(...xs) + pad];
        yRange = [Math.min(...ys) - pad, Math.max(...ys) + pad];
        const rect = chartEl.getBoundingClientRect();
        plotWidth = rect.width * 0.82;
        plotHeight = rect.height * 0.82;
    }

    const xSpan = xRange[1] - xRange[0];
    const ySpan = yRange[1] - yRange[0];
    if (xSpan <= 0 || ySpan <= 0) return filteredData;

    const toPixel = (dataX, dataY) => ({
        px: ((dataX - xRange[0]) / xSpan) * plotWidth,
        py: ((dataY - yRange[0]) / ySpan) * plotHeight
    });

    const sorted = [...filteredData].sort((a, b) => a.priority - b.priority);
    const visible = [];
    const occupied = [];
    // Minimum pixel distance thresholds (accounts for dot + text label)
    const MIN_DIST_X = 55;
    const MIN_DIST_Y = 24;

    const selectedSet = new Set(selectedRubbers.filter(Boolean));
    for (const sel of selectedSet) {
        if (!filteredData.includes(sel)) continue;
        const { px, py } = toPixel(sel.x, sel.y);
        visible.push(sel);
        occupied.push({ px, py });
    }

    // Force spotlight rubber visible so it's never thinned out
    if (spotlightRubber && !selectedSet.has(spotlightRubber) && filteredData.includes(spotlightRubber)) {
        const { px, py } = toPixel(spotlightRubber.x, spotlightRubber.y);
        visible.push(spotlightRubber);
        occupied.push({ px, py });
    }

    // Pass 1: Prefer keeping previously visible rubbers so only the
    // spotlight swap causes a change, not the entire set reshuffling.
    const alreadyAdded = new Set(visible);
    for (const rubber of _prevVisibleRubbers) {
        if (alreadyAdded.has(rubber)) continue;
        if (!filteredData.includes(rubber)) continue;
        const { px, py } = toPixel(rubber.x, rubber.y);
        const overlaps = occupied.some(
            occ => Math.abs(px - occ.px) < MIN_DIST_X && Math.abs(py - occ.py) < MIN_DIST_Y
        );
        if (!overlaps) {
            visible.push(rubber);
            occupied.push({ px, py });
            alreadyAdded.add(rubber);
        }
    }

    // Pass 2: Fill remaining slots with priority-sorted newcomers.
    for (const rubber of sorted) {
        if (alreadyAdded.has(rubber)) continue;
        const { px, py } = toPixel(rubber.x, rubber.y);
        const overlaps = occupied.some(
            occ => Math.abs(px - occ.px) < MIN_DIST_X && Math.abs(py - occ.py) < MIN_DIST_Y
        );
        if (!overlaps) {
            visible.push(rubber);
            occupied.push({ px, py });
            alreadyAdded.add(rubber);
        }
    }

    _prevVisibleRubbers = visible;
    return visible;
}
// ════════════════════════════════════════════════════════════
//  Chart: Rendering
// ════════════════════════════════════════════════════════════

let _clickPopupActiveUntil = 0;
let _clickPopupPinned = false;
let _popupPlayerRotateTimer = null;
let _popupPlayerRotateSwapTimeout = null;

function getChartHoverPopupEl() {
    let popup = document.getElementById(HOVER_POPUP_ID);
    if (popup) return popup;
    popup = document.createElement('div');
    popup.id = HOVER_POPUP_ID;
    popup.className = 'chart-hover-popup';
    popup.addEventListener('mouseleave', () => {
        if (_clickPopupPinned) return;
        hideChartHoverPopup({ force: true });
    });
    document.body.appendChild(popup);
    return popup;
}

function formatHardnessPopupLabel(rubber) {
    return rubber?.hardnessLabel || 'N/A';
}

function formatHardnessHtml(rubber) {
    const label = escapeHtml(rubber?.hardnessLabel || 'N/A');
    const labelDE = rubber?.hardnessLabelDE;
    if (!labelDE) return label;
    return `<span class="hardness-native">${label}</span><span class="hardness-de">${escapeHtml(labelDE)}</span>`;
}

function formatThicknessRadarHtml(thicknessLabel) {
    const raw = String(thicknessLabel || 'N/A').trim();
    if (!raw || raw === 'N/A') return 'N/A';

    const entries = raw
        .split(',')
        .map(item => item.trim())
        .filter(Boolean);
    if (entries.length === 0) return 'N/A';

    const rows = [];
    for (let i = 0; i < entries.length; i += 2) {
        rows.push(entries.slice(i, i + 2).map(escapeHtml).join(', '));
    }
    return rows.join('<br>');
}

function getHardnessToneClass(normalizedHardness) {
    const category = getHardnessCategoryLabel(normalizedHardness);
    if (!category) return '';
    return `hardness-tone-${category.toLowerCase()}`;
}

function getWeightToneClass(weight) {
    if (!Number.isFinite(weight)) return '';
    if (weight <= 48) return 'weight-tone-green';
    if (weight <= 51) return 'weight-tone-yellow';
    return 'weight-tone-red';
}

function positionHoverPopup(popup, hoverData, chartEl) {
    const point = hoverData?.points?.[0];
    if (!point || !chartEl) return;

    const eventX = hoverData.event?.clientX;
    const eventY = hoverData.event?.clientY;
    const hasPointerCoords = Number.isFinite(eventX) && Number.isFinite(eventY);

    let anchorX;
    let anchorY;
    if (hasPointerCoords) {
        anchorX = eventX;
        anchorY = eventY;
    } else {
        const rect = chartEl.getBoundingClientRect();
        const xOffset = chartEl._fullLayout?._size?.l ?? 0;
        const yOffset = chartEl._fullLayout?._size?.t ?? 0;
        anchorX = rect.left + xOffset + point.xaxis.l2p(point.x);
        anchorY = rect.top + yOffset + point.yaxis.l2p(point.y);
    }

    popup.style.left = '0px';
    popup.style.top = '0px';
    popup.classList.add('visible');

    const popupRect = popup.getBoundingClientRect();
    const edgePadding = 10;
    let left = anchorX + 14;
    let top = anchorY + 14;

    if (left + popupRect.width > window.innerWidth - edgePadding) {
        left = anchorX - popupRect.width - 14;
    }
    if (top + popupRect.height > window.innerHeight - edgePadding) {
        top = anchorY - popupRect.height - 14;
    }

    left = Math.max(edgePadding, Math.min(left, window.innerWidth - popupRect.width - edgePadding));
    top = Math.max(edgePadding, Math.min(top, window.innerHeight - popupRect.height - edgePadding));

    popup.style.left = `${left}px`;
    popup.style.top = `${top}px`;
}

function hideChartHoverPopup({ force = false } = {}) {
    if (!force && (_clickPopupPinned || Date.now() < _clickPopupActiveUntil)) return;
    _clickPopupPinned = false;
    clearInterval(_popupPlayerRotateTimer);
    _popupPlayerRotateTimer = null;
    clearTimeout(_popupPlayerRotateSwapTimeout);
    _popupPlayerRotateSwapTimeout = null;
    const popup = document.getElementById(HOVER_POPUP_ID);
    if (popup) popup.classList.remove('visible');
}

// ── Main Chart: Dot hover shake effect ──────────────────────────────

let _chartShakeRing = null;

function getChartDotScreenPosition(point, chartEl) {
    const rect = chartEl.getBoundingClientRect();
    const layout = chartEl._fullLayout?._size;
    if (!layout) return null;
    return {
        x: rect.left + layout.l + point.xaxis.l2p(point.x),
        y: rect.top + layout.t + point.yaxis.l2p(point.y)
    };
}

function showChartDotShake(data, chartEl) {
    const point = data?.points?.[0];
    if (!point) return;
    const rubber = point.data.customdata?.[point.pointIndex];
    if (!rubber) return;

    const pos = getChartDotScreenPosition(point, chartEl);
    if (!pos) return;

    const markerSizes = point.data.marker?.size;
    const markerSize = Array.isArray(markerSizes)
        ? markerSizes[point.pointIndex]
        : (markerSizes || 14);

    if (!_chartShakeRing) {
        _chartShakeRing = document.createElement('div');
        _chartShakeRing.className = 'chart-dot-shake-ring';
        document.body.appendChild(_chartShakeRing);
    }

    // Match the marker shape for this rubber's sheet type
    const symbol = getSheetSymbol(rubber.sheet);
    _chartShakeRing.className = 'chart-dot-shake-ring'
        + (symbol === 'square' ? ' shake-ring-square' : '')
        + (symbol === 'diamond' ? ' shake-ring-diamond' : '');

    _chartShakeRing.style.width = markerSize + 'px';
    _chartShakeRing.style.height = markerSize + 'px';
    _chartShakeRing.style.left = pos.x + 'px';
    _chartShakeRing.style.top = pos.y + 'px';
    _chartShakeRing.style.opacity = '1';
}

function hideChartDotShake() {
    if (_chartShakeRing) _chartShakeRing.style.opacity = '0';
}

function showChartHoverPopupFromPlotlyData(data, chartEl, slotLabel) {
    const point = data?.points?.[0];
    const rubber = point?.data?.customdata?.[point.pointIndex];
    if (!point || !rubber) return null;
    const popup = getChartHoverPopupEl();
    popup.innerHTML = buildHoverPopupHtml(rubber, point, slotLabel);
    positionHoverPopup(popup, data, chartEl);

    // Start player name rotation
    clearInterval(_popupPlayerRotateTimer);
    _popupPlayerRotateTimer = null;
    clearTimeout(_popupPlayerRotateSwapTimeout);
    _popupPlayerRotateSwapTimeout = null;
    const rotateEl = popup.querySelector('.chart-hover-player-name-rotate');
    const playerEls = popup.querySelectorAll('.chart-hover-player');
    if (rotateEl && playerEls.length) {
        // Highlight first player initially
        playerEls[0]?.classList.add('is-active');
        try {
            const names = JSON.parse(rotateEl.dataset.names || '[]');
            if (names.length > 1) {
                let idx = 0;
                const FADE_DURATION_MS = 180;
                const ROTATE_INTERVAL_MS = 1200;
                const startRotation = (fromIdx) => {
                    clearInterval(_popupPlayerRotateTimer);
                    clearTimeout(_popupPlayerRotateSwapTimeout);
                    _popupPlayerRotateSwapTimeout = null;
                    idx = fromIdx;
                    _popupPlayerRotateTimer = setInterval(() => {
                        playerEls[idx]?.classList.remove('is-active');
                        idx = (idx + 1) % names.length;
                        rotateEl.classList.remove('visible');
                        _popupPlayerRotateSwapTimeout = setTimeout(() => {
                            rotateEl.textContent = names[idx];
                            // Wait one frame after text swap to avoid ghosting on mobile compositing.
                            requestAnimationFrame(() => rotateEl.classList.add('visible'));
                            playerEls[idx]?.classList.add('is-active');
                            _popupPlayerRotateSwapTimeout = null;
                        }, FADE_DURATION_MS);
                    }, ROTATE_INTERVAL_MS);
                };
                startRotation(0);

                playerEls.forEach((el, i) => {
                    el.addEventListener('mouseenter', () => {
                        clearInterval(_popupPlayerRotateTimer);
                        _popupPlayerRotateTimer = null;
                        clearTimeout(_popupPlayerRotateSwapTimeout);
                        _popupPlayerRotateSwapTimeout = null;
                        playerEls.forEach(p => p.classList.remove('is-active'));
                        el.classList.add('is-active');
                        rotateEl.textContent = names[i] || '';
                        rotateEl.classList.add('visible');
                    });
                    el.addEventListener('mouseleave', () => {
                        startRotation(i);
                    });
                });
            }
        } catch {}
    }

    // Close button
    const closeBtn = popup.querySelector('.chart-hover-close');
    if (closeBtn) {
        closeBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            if (window.innerWidth < 769) {
                spotlightPopupSuppressed = true;
                hideChartHoverPopup({ force: true });
            } else {
                spotlightDismissedByUser = true;
                stopSpotlightRotation();
                stopDesktopSpotlightRotation();
                hideChartHoverPopup({ force: true });
            }
        });
    }

    // Route all YouTube links in the popup through the radar panel embed
    popup.querySelectorAll('.chart-hover-yt-btn, a[data-yt-videoid]').forEach(el => {
        el.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            const videoId = el.dataset.videoid || el.dataset.ytVideoid;
            if (!videoId) return;
            const radarPanel = document.getElementById('radarInfoPanel');
            if (!radarPanel) return;
            const playlist = (el.dataset.ytPlaylist || '').split(',').filter(Boolean);
            const currentIndex = parseInt(el.dataset.ytIndex, 10) || 0;
            toggleYouTubeEmbed(radarPanel, videoId, { playlist, currentIndex });
        });
    });

    popup.querySelectorAll('.chart-hover-buy-btn').forEach(el => {
        el.addEventListener('click', () => {
            trackBuyClickEvent(el.dataset.rubberName || '');
        });
    });

    return rubber;
}

function buildControlLevelIndicatorHtml(controlLevel, { fillFromLeft = false } = {}) {
    if (!Number.isFinite(controlLevel)) return '-';

    const clampedLevel = Math.max(1, Math.min(CONTROL_LEVEL_COUNT, controlLevel));
    const filledBoxes = clampedLevel;
    const boxHtml = Array.from({ length: CONTROL_LEVEL_COUNT }, (_, index) => (
        `<span class="chart-control-box${fillFromLeft ? (index < filledBoxes ? ' is-filled' : '') : (index >= CONTROL_LEVEL_COUNT - filledBoxes ? ' is-filled' : '')}" aria-hidden="true"></span>`
    )).join('');

    return `
        <span class="chart-control-boxes control-level-${clampedLevel}" aria-label="Control level ${clampedLevel}: ${filledBoxes} out of ${CONTROL_LEVEL_COUNT} boxes">${boxHtml}</span>
    `.trim();
}

function buildHoverPopupPlayerHtml(entry) {
    const parsed = parsePlayerEntry(entry);
    if (!parsed) return '';
    const displayName = getLocalizedPlayerName(parsed.name) || parsed.name;
    const safeName = escapeHtml(displayName);
    const playerData = getPlayerDataByName(parsed.name);
    const imageExt = playerData?.image_ext || 'png';
    const emojiSrc = playerEmojiPath(getPlayerImageName(parsed.name), imageExt);
    const imgHtml = `<img class="chart-hover-player-img" src="${emojiSrc}" alt="${safeName}" title="${safeName}" onerror="this.closest('.chart-hover-player').remove()">`;

    const { videoIds, currentIndex } = resolvePlayerVideoSelection(parsed);
    if (videoIds.length) {
        const videoId = videoIds[currentIndex] || videoIds[0];
        const playlist = escapeHtml(videoIds.join(','));
        return `<a class="chart-hover-player" href="#" data-yt-videoid="${escapeHtml(videoId)}" data-yt-playlist="${playlist}" data-yt-index="${currentIndex}">${imgHtml}</a>`;
    }
    return `<span class="chart-hover-player">${imgHtml}</span>`;
}

function buildHoverPopupPlayersHtml(rubber) {
    const allEntries = [
        ...(Array.isArray(rubber.forehandPlayers) ? rubber.forehandPlayers : []),
        ...(Array.isArray(rubber.backhandPlayers) ? rubber.backhandPlayers : []),
    ];
    const seen = new Set();
    const unique = allEntries.filter(e => {
        const parsed = parsePlayerEntry(e);
        if (!parsed || seen.has(parsed.name)) return false;
        seen.add(parsed.name);
        return true;
    });
    if (!unique.length) return '';
    const players = unique.map(buildHoverPopupPlayerHtml).filter(Boolean).join('');
    if (!players) return '';
    const names = unique.map(e => {
        const p = parsePlayerEntry(e);
        if (!p) return '';
        const displayName = escapeHtml(getLocalizedPlayerName(p.name) || p.name);
        const playerData = getPlayerDataByName(p.name);
        const rank = playerData?.ranking;
        return rank ? `#${rank} ${displayName}` : displayName;
    }).filter(Boolean);
    const namesAttr = escapeHtml(JSON.stringify(names));
    return `<div class="chart-hover-players"><div class="chart-hover-player-list">${players}</div><span class="chart-hover-player-name-rotate visible" data-names="${namesAttr}">${names[0] || ''}</span></div>`;
}

function buildHoverPopupHtml(rubber, point, slotLabel) {
    const rubberName = tRubberName(rubber) || rubber.name || rubber.abbr || '-';
    const brandName = tBrand(rubber.brand) || '-';
    const sheet = rubber.sheet || '-';
    const { initial: sheetInitial, remainder: sheetRemainder } = getLocalizedSheetLabelParts(sheet);
    const hardness = formatHardnessPopupLabel(rubber);
    const hardnessToneClass = getHardnessToneClass(rubber?.normalizedHardness);
    const weight = rubber.weightLabel || '-';
    const weightToneClass = getWeightToneClass(rubber?.weight);
    const spin = typeof rubber.spinRank === 'number' ? `#${rubber.spinRank}` : '-';
    const speed = typeof rubber.speedRank === 'number' ? `#${rubber.speedRank}` : '-';
    const control = buildControlLevelIndicatorHtml(rubber?.controlLevel);
    const brandColor = getBrandColor(rubber.brand);
    const bestsellerStar = rubber.bestseller ? '\u2B50 ' : '';

    const slotNum = slotLabel ? slotLabel.replace(/\D/g, '') : '';
    const slotBadge = slotNum
        ? `<span class="chart-hover-slot-badge">${slotNum}</span>`
        : '';

    const countryUrls = rubber.urls?.[selectedCountry] || {};
    const ytMeta = normalizeYouTubeMeta(countryUrls.youtube);
    let ytVideoId = ytMeta?.url ? extractYouTubeVideoId(ytMeta.url) : null;
    let ytIsFallback = false;
    if (!ytVideoId && selectedCountry !== 'en') {
        const enMeta = normalizeYouTubeMeta((rubber.urls?.en || {}).youtube);
        ytVideoId = enMeta?.url ? extractYouTubeVideoId(enMeta.url) : null;
        if (ytVideoId) ytIsFallback = true;
    }
    const ytEnBadge = ytIsFallback ? `<span class="yt-en-badge">EN</span>` : '';
    const ytBtn = ytVideoId
        ? `<button class="chart-hover-yt-btn" data-videoid="${ytVideoId}" aria-label="Play YouTube video"><img src="/images/youtube.ico" alt="">${ytEnBadge}</button>`
        : '';
    const starBtn = rubber.bestseller
        ? `<span class="chart-hover-star-btn" aria-label="Bestseller">&#x2B50;</span>`
        : '';

    let productUrl = countryUrls.product || '';
    if (!productUrl && selectedCountry !== 'en') {
        productUrl = (rubber.urls?.en || {}).product || '';
    }
    const productMeta = getProductStoreMeta(productUrl);
    const priceData = rubber.price?.[selectedCountry] || rubber.price?.en || null;
    const priceSale = priceData?.sale || '';
    const priceRegular = priceData?.regular || '';
    const priceDiscount = priceData?.discount || '';
    const priceHtml = priceSale
        ? `<span class="chart-hover-buy-price-wrap"><span class="chart-hover-buy-price-sale">${escapeHtml(priceSale)}</span></span>`
        : priceRegular
            ? `<span class="chart-hover-buy-price-wrap"><span class="chart-hover-buy-price-sale">${escapeHtml(priceRegular)}</span></span>`
            : '';
    const discountFloatBadge = (priceSale && priceDiscount)
        ? `<span class="chart-hover-buy-discount-badge">${escapeHtml(priceDiscount)}</span>`
        : '';
    const buyBtn = productMeta
        ? `<span class="chart-hover-buy-wrap">${discountFloatBadge}<a class="chart-hover-buy-btn${priceSale && priceDiscount ? ' has-discount' : ''}" href="${escapeHtml(productMeta.url)}" target="_blank" rel="noopener" aria-label="Buy" data-rubber-name="${escapeHtml(rubber.name || rubber.abbr || '')}"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/></svg>${priceHtml}</a></span>`
        : '';

    return `
        <div class="chart-hover-card">
            <div class="chart-hover-accent" style="background:${brandColor}"></div>
            <button class="chart-hover-close" aria-label="Close">&times;</button>
            <div class="chart-hover-head">
                <div class="chart-hover-top">
                    <span class="brand-pill" style="background:${brandColor}18;border-color:${brandColor}55;color:${brandColor}">
                        <span class="brand-dot" style="background:${brandColor}"></span>${escapeHtml(brandName)}
                    </span>
                    ${starBtn}
                </div>
                <div class="rubber-name">${ytBtn}${escapeHtml(rubberName)}${rubber.releaseYearLabel && rubber.releaseYearLabel !== 'N/A' ? ` <span class="rubber-release-year">${escapeHtml(rubber.releaseYearLabel)}</span>` : ''}${buyBtn}${slotBadge}</div>
            </div>
            <div class="chart-hover-hero">
                <div class="chart-hover-hero-col">
                    <span class="chart-hover-hero-label">${tUi('SPIN')}</span>
                    <span class="chart-hover-hero-value">${spin}</span>
                </div>
                <div class="chart-hover-hero-col">
                    <span class="chart-hover-hero-label">${tUi('SPEED')}</span>
                    <span class="chart-hover-hero-value">${speed}</span>
                </div>
            </div>
            <div class="chart-hover-details">
                <div class="chart-hover-detail"><span>${tUi('CONTROL')}</span><strong class="chart-control-indicator">${control}</strong></div>
                <div class="chart-hover-detail"><span>${tUi('CUT_WEIGHT')}<span class="metric-hint" data-hint="${tUi('CUT_WEIGHT_HINT')}"><svg class="metric-hint-icon" width="11" height="11" viewBox="0 0 16 16" fill="currentColor"><path d="M8 0a8 8 0 1 0 0 16A8 8 0 0 0 8 0zm.9 12H7.1V7h1.8v5zM8 5.9a1 1 0 1 1 0-2 1 1 0 0 1 0 2z"/></svg></span></span><strong class="${weightToneClass}">${escapeHtml(weight)}</strong></div>
                <div class="chart-hover-detail"><span>${tUi('TOPSHEET')}</span><span class="chart-sheet-value"><span class="chart-hover-shape ${SHEET_DOT_CLASS[sheet] || 'dot-circle'}"><span>${escapeHtml(sheetInitial)}</span></span>${escapeHtml(sheetRemainder)}</span></div>
                <div class="chart-hover-detail"><span>${tUi('HARDNESS')}</span><strong class="${hardnessToneClass}${rubber.hardnessLabelDE ? ' hardness-duo' : ''}">${formatHardnessHtml(rubber)}</strong></div>
            </div>
            ${buildHoverPopupPlayersHtml(rubber)}
        </div>
    `;
}

let filterAnimTimer = null;
function animateChartUpdate(chartOptions = {}) {
    const chartEl = document.getElementById('chart');
    clearTimeout(filterAnimTimer);
    chartEl.classList.add('chart--filter-fade');
    filterAnimTimer = setTimeout(() => {
        updateChart(chartOptions);
        requestAnimationFrame(() => {
            chartEl.classList.remove('chart--filter-fade');
        });
    }, 150);
}

function updateChart(options = {}) {
    hideChartHoverPopup();
    const filteredData = options._cachedFilteredData || getFilteredData();

    // Skip update when filtered data hasn't changed — avoids flicker during range slider drag.
    // preserveRanges calls (from user pan/zoom) and force calls always proceed.
    if (!options.preserveRanges && !options.force && currentFilteredData.length > 0
        && filteredData.length === currentFilteredData.length
        && filteredData.every((r, i) => r === currentFilteredData[i])) {
        return;
    }

    currentFilteredData = filteredData;
    const visibleData = computeVisibleRubbers(filteredData);

    // Marker sizes mapped to control levels (M&M style — chunky cartoon sizes):
    // Level 5 (most control) → biggest dot, Level 1 (least control) → smallest dot.
    const CONTROL_GUIDE_MARKER_SIZES = [11, 13, 16, 19, 21];

    function getMarkerSize(rubber) {
        const level = rubber.controlLevel;
        if (!Number.isFinite(level)) return CONTROL_GUIDE_MARKER_SIZES[2];
        const idx = Math.max(0, Math.min(CONTROL_LEVEL_COUNT - 1, level - 1));
        return CONTROL_GUIDE_MARKER_SIZES[idx];
    }

    // Group by brand × sheet for trace creation
    const groups = {};
    for (const rubber of visibleData) {
        const key = `${rubber.brand}-${rubber.sheet}`;
        (groups[key] ??= { brand: rubber.brand, sheet: rubber.sheet, rubbers: [] })
            .rubbers.push(rubber);
    }

    const traces = [];

    // Bestseller halo layer (rendered first so it sits behind normal markers)
    const bestsellers = visibleData.filter(r => r.bestseller);
    if (bestsellers.length > 0) {
        traces.push({
            x: bestsellers.map(r => r.x),
            y: bestsellers.map(r => r.y),
            mode: 'markers',
            type: 'scattergl',
            name: 'Bestseller',
            showlegend: false,
            hoverinfo: 'skip',
            marker: {
                size: bestsellers.map(r => getMarkerSize(r) + 14),
                color: 'rgba(212,193,106,0.10)',
                symbol: 'circle',
                line: { width: 2, color: 'rgba(212,193,106,0.45)' }
            }
        });
    }

    // Selection highlight rings for selected rubbers
    for (let i = 0; i < 2; i++) {
        const sel = selectedRubbers[i];
        if (!sel || !filteredData.some(r => r === sel)) continue;
        const brandColor = getBrandColor(sel.brand);
        traces.push({
            x: [sel.x],
            y: [sel.y],
            mode: 'markers',
            type: 'scattergl',
            name: `Selected ${i + 1}`,
            showlegend: false,
            hoverinfo: 'skip',
            marker: {
                size: [getMarkerSize(sel)],
                color: 'rgba(0,0,0,0)',
                symbol: 'circle',
                line: { width: 4, color: 'rgba(255,255,255,0.9)' }
            }
        });
    }

    for (const group of Object.values(groups)) {
        traces.push({
            x: group.rubbers.map(r => r.x),
            y: group.rubbers.map(r => r.y),
            mode: 'markers',
            type: 'scattergl',
            name: `${tBrand(group.brand)} (${group.sheet})`,
            marker: {
                size: group.rubbers.map(getMarkerSize),
                color: getBrandColor(group.brand),
                symbol: getSheetSymbol(group.sheet),
                line: { width: 2.5, color: 'rgba(0,0,0,0.75)' }
            },
            opacity: 1,
            hoverinfo: 'none',
            customdata: group.rubbers
        });
    }

    // Determine axis ranges: autoscale or preserve current view
    let currentRanges = hasPlotted ? getCurrentAxisRanges() : null;
    if (!options.preserveRanges && shouldAutoscaleForFilteredData(filteredData, currentRanges)) {
        currentRanges = null;
    }
    updateHeaderTagline();

    // Compute displaced label annotations with leader lines
    const chartElForLabels = document.getElementById('chart');
    let labelXRange, labelYRange, labelPlotW, labelPlotH;

    if (currentRanges) {
        labelXRange = currentRanges.xaxis;
        labelYRange = currentRanges.yaxis;
    } else {
        // Estimate from data bounds (mirrors getAutoscaleBounds)
        const bounds = getAutoscaleBounds(visibleData);
        labelXRange = bounds ? bounds.x : [0, 1];
        labelYRange = bounds ? bounds.y : [0, 1];
    }

    if (chartElForLabels._fullLayout?._size) {
        labelPlotW = chartElForLabels._fullLayout._size.w;
        labelPlotH = chartElForLabels._fullLayout._size.h;
    } else {
        const rect = chartElForLabels.getBoundingClientRect();
        labelPlotW = rect.width * 0.82;
        labelPlotH = rect.height * 0.82;
    }

    const labelAnnotations = computeLabelAnnotations(
        visibleData, labelXRange, labelYRange, labelPlotW, labelPlotH
    );

    // M&M gloss highlight layer — small white dot offset up-left inside each marker
    // to mimic the specular reflection on a glossy candy shell.
    // Offset is a fixed 4px converted to data units so it stays inside the dot
    // at any window width.
    {
        const axisSpan = Math.max((labelXRange[1] ?? 300) - (labelXRange[0] ?? 0), 1);
        const glossOffset = 4 * (axisSpan / Math.max(labelPlotW, 1));
        traces.push({
            x: visibleData.map(r => r.x - glossOffset),
            y: visibleData.map(r => r.y + glossOffset),
            mode: 'markers',
            type: 'scattergl',
            showlegend: false,
            hoverinfo: 'skip',
            marker: {
                size: visibleData.map(r => Math.max(3, Math.round(getMarkerSize(r) * 0.3))),
                color: 'rgba(255,255,255,0.6)',
                symbol: 'circle',
                line: { width: 0 }
            }
        });
    }

    // Selection badge annotations ("1" / "2" labels near selected rubber dots)
    const selectionBadges = [];
    for (let i = 0; i < 2; i++) {
        const sel = selectedRubbers[i];
        if (!sel || !filteredData.some(r => r === sel)) continue;
        const brandColor = getBrandColor(sel.brand);
        selectionBadges.push({
            x: sel.x,
            y: sel.y,
            xref: 'x',
            yref: 'y',
            text: `<b>${i + 1}</b>`,
            showarrow: false,
            font: { size: 12, color: '#fff', family: CHART_FONT },
            bgcolor: brandColor,
            bordercolor: 'rgba(255,255,255,0.6)',
            borderpad: 2.5,
            borderwidth: 1,
            xshift: 12,
            yshift: -12,
            xanchor: 'center',
            yanchor: 'middle',
            captureevents: false
        });
    }

    const axisBase = {
        zeroline: false,
        showgrid: false,
        gridcolor: 'rgba(62,58,52,0.4)',
        griddash: 'dot',
        gridwidth: 1,
        tickfont: { color: '#9b9484', size: 13 },
        showline: true,
        linecolor: 'rgba(111,104,91,0.5)',
        linewidth: 1.5,
        showticklabels: false,
        tickformat: '.1f'
    };

    // Four quadrant zones in paper coordinates (0–1) so they always fill the full plot area
    // Left Top: Direct Speed
    const directSpeedAnnotation = {
        x: 0.01, y: 0.99,
        xref: 'paper', yref: 'paper',
        xanchor: 'left', yanchor: 'top',
        text: '<b>Direct Speed</b>',
        showarrow: false,
        font: { size: 13, color: 'rgba(100,160,220,0.6)', family: CHART_FONT },
        bgcolor: 'transparent',
        borderpad: 4,
        captureevents: false
    };

    // Right Top: Sweet Spot
    const sweetSpotAnnotation = {
        x: 0.99, y: 0.99,
        xref: 'paper', yref: 'paper',
        xanchor: 'right', yanchor: 'top',
        text: '<b>Sweet Spot</b>',
        showarrow: false,
        font: { size: 13, color: 'rgba(200,100,100,0.6)', family: CHART_FONT },
        bgcolor: 'transparent',
        borderpad: 4,
        captureevents: false
    };

    // Left Bottom: All-Round
    const allRoundAnnotation = {
        x: 0.01, y: 0.49,
        xref: 'paper', yref: 'paper',
        xanchor: 'left', yanchor: 'top',
        text: '<b>All-Round</b>',
        showarrow: false,
        font: { size: 13, color: 'rgba(180,160,100,0.6)', family: CHART_FONT },
        bgcolor: 'transparent',
        borderpad: 4,
        captureevents: false
    };

    // Right Bottom: Safe Spin
    const safeSpinAnnotation = {
        x: 0.99, y: 0.49,
        xref: 'paper', yref: 'paper',
        xanchor: 'right', yanchor: 'top',
        text: '<b>Safe Spin</b>',
        showarrow: false,
        font: { size: 13, color: 'rgba(100,180,120,0.6)', family: CHART_FONT },
        bgcolor: 'transparent',
        borderpad: 4,
        captureevents: false
    };

    const layout = {
        title: '',
        dragmode: IS_TOUCH_DEVICE ? (_mobileZoomed ? 'pan' : false) : 'pan',
        xaxis: {
            ...axisBase,
            title: { text: '' },
            autorange: !currentRanges,
            range: currentRanges?.xaxis
        },
        yaxis: {
            ...axisBase,
            title: { text: '' },
            autorange: !currentRanges,
            range: currentRanges?.yaxis
        },
        hovermode: 'closest',
        plot_bgcolor: 'rgba(0,0,0,0)',
        paper_bgcolor: 'rgba(0,0,0,0)',
        margin: { l: 10, r: 10, t: 2, b: 2 },
        shapes: [{
            // Left Top: Direct Speed
            type: 'rect',
            xref: 'paper', yref: 'paper',
            x0: 0, y0: 0.5, x1: 0.5, y1: 1,
            fillcolor: 'rgba(100,160,220,0.06)',
            line: { color: 'rgba(100,160,220,0.15)', width: 1, dash: 'dot' },
            layer: 'below'
        }, {
            // Right Top: Sweet Spot
            type: 'rect',
            xref: 'paper', yref: 'paper',
            x0: 0.5, y0: 0.5, x1: 1, y1: 1,
            fillcolor: 'rgba(200,100,100,0.06)',
            line: { color: 'rgba(200,100,100,0.15)', width: 1, dash: 'dot' },
            layer: 'below'
        }, {
            // Left Bottom: All-Round
            type: 'rect',
            xref: 'paper', yref: 'paper',
            x0: 0, y0: 0, x1: 0.5, y1: 0.5,
            fillcolor: 'rgba(180,160,100,0.06)',
            line: { color: 'rgba(180,160,100,0.15)', width: 1, dash: 'dot' },
            layer: 'below'
        }, {
            // Right Bottom: Safe Spin
            type: 'rect',
            xref: 'paper', yref: 'paper',
            x0: 0.5, y0: 0, x1: 1, y1: 0.5,
            fillcolor: 'rgba(100,180,120,0.06)',
            line: { color: 'rgba(100,180,120,0.15)', width: 1, dash: 'dot' },
            layer: 'below'
        }],
        annotations: [
            directSpeedAnnotation,
            sweetSpotAnnotation,
            allRoundAnnotation,
            safeSpinAnnotation,
            ...labelAnnotations,
            ...selectionBadges
        ],
        showlegend: false,
        legend: {
            x: 1, y: 1, xanchor: 'right',
            bgcolor: 'rgba(43,41,38,0.9)', bordercolor: '#3e3a34', borderwidth: 1,
            font: { color: '#e8e0d0' }
        },
        hoverlabel: {
            bgcolor: '#3e3a34', bordercolor: '#9b9484',
            font: { color: '#e8e0d0', family: CHART_FONT }
        }
    };

    const config = { responsive: true, displayModeBar: false, displaylogo: false, scrollZoom: false, doubleClick: false };
    const chartEl = document.getElementById('chart');

    // Suppress relayout handler while we programmatically update the chart,
    // so Plotly's own relayout events don't trigger a cascading second render.
    isInternalUpdate = true;
    clearTimeout(relayoutTimer);
    clearTimeout(internalUpdateTimer);

    if (hasPlotted) {
        Plotly.react('chart', traces, layout, config);
    } else {
        Plotly.newPlot('chart', traces, layout, config);
        hasPlotted = true;
    }

    // Re-enable relayout handler for user pan/zoom after Plotly events settle.
    // Must clear-then-set so rapid calls (e.g. range slider drag) keep the guard
    // active until 300 ms after the *last* call, not the first.
    internalUpdateTimer = setTimeout(() => { isInternalUpdate = false; }, 300);

    // Attach Plotly event handlers once
    if (!chartEl._hasClickHandler) {
        chartEl._hasClickHandler = true;
        chartEl.on('plotly_click', data => {
            const point = data.points[0];
            const rubber = point.data.customdata[point.pointIndex];

            // Suppress hideChartHoverPopup during the chart re-render triggered
            // by handleRubberClick → updateChart, and the async plotly_unhover
            // that Plotly.react may fire afterwards.
            _clickPopupActiveUntil = Date.now() + 500;
            _clickPopupPinned = true;
            pauseDesktopSpotlightRotation();

            handleRubberClick(rubber);
            showChartHoverPopupFromPlotlyData(data, chartEl);
        });
    }

    if (!chartEl._hasHoverHandler) {
        chartEl._hasHoverHandler = true;
        chartEl.on('plotly_hover', data => {
            if (IS_TOUCH_DEVICE) return;
            pauseDesktopSpotlightRotation();
            showChartDotShake(data, chartEl);
            if (_clickPopupPinned) return;
            showChartHoverPopupFromPlotlyData(data, chartEl);
        });
        chartEl.on('plotly_unhover', () => {
            hideChartDotShake();
            if (_clickPopupPinned) return;
            hideChartHoverPopup();
            resumeDesktopSpotlightRotation();
        });
    }

    if (!chartEl._hasTapDismissHandler) {
        chartEl._hasTapDismissHandler = true;
        document.addEventListener('click', (event) => {
            const popup = document.getElementById(HOVER_POPUP_ID);
            if (!popup || !popup.classList.contains('visible')) return;
            if (Date.now() < _clickPopupActiveUntil) return;
            if (popup.contains(event.target)) return;
            hideChartHoverPopup({ force: true });
        });
        document.addEventListener('pointerdown', (event) => {
            if (!IS_TOUCH_DEVICE) return;
            if (chartEl.contains(event.target)) return;
            const popup = document.getElementById(HOVER_POPUP_ID);
            if (popup && popup.contains(event.target)) return;
            hideChartHoverPopup({ force: true });
        }, { passive: true });
        window.addEventListener('scroll', () => {
            hideChartHoverPopup({ force: true });
            hideChartDotShake();
        }, { passive: true });
    }

    if (!chartEl._hasRelayoutHandler) {
        chartEl._hasRelayoutHandler = true;
        chartEl.on('plotly_relayout', eventData => {
            if (isInternalUpdate) return;

            const rangeKeys = [
              'xaxis.range[0]', 'xaxis.range', 'yaxis.range[0]',
              'yaxis.range', 'xaxis.autorange', 'yaxis.autorange'
            ];
            if (!rangeKeys.some(k => eventData[k] !== undefined)) return;

            pauseSpotlightRotation();
            updateHeaderTagline();
            clearTimeout(relayoutTimer);
            relayoutTimer = setTimeout(() => {
              updateChart({ preserveRanges: true });
            }, 120);
          });
    }

    // Pinch-to-zoom: intercept two-finger gestures on the chart element
    if (!chartEl._hasPinchHandler) {
        chartEl._hasPinchHandler = true;

        let pinchStartDist = null;
        let pinchStartXRange = null;
        let pinchStartYRange = null;
        let pinchAnchorFx = 0.5;
        let pinchAnchorFy = 0.5;
        let pinchActive = false;
        let pinchFinalRanges = null;

        function getTouchDist(t1, t2) {
            const dx = t1.clientX - t2.clientX;
            const dy = t1.clientY - t2.clientY;
            return Math.sqrt(dx * dx + dy * dy);
        }

        function getTouchMidpoint(t1, t2) {
            return {
                x: (t1.clientX + t2.clientX) / 2,
                y: (t1.clientY + t2.clientY) / 2
            };
        }

        chartEl.addEventListener('touchstart', (e) => {
            if (e.touches.length === 2) {
                e.preventDefault();
                e.stopPropagation();

                // Block relayout-triggered updateChart calls while pinching.
                // Clear ALL pending timers so a previous pinch's delayed callbacks
                // cannot fire and trigger an unwanted autoscale reset.
                pinchActive = true;
                pauseSpotlightRotation();
                pinchFinalRanges = null;
                clearTimeout(relayoutTimer);
                clearTimeout(internalUpdateTimer);
                isInternalUpdate = true;

                pinchStartDist = getTouchDist(e.touches[0], e.touches[1]);

                const layout = chartEl._fullLayout;
                if (!layout || !layout.xaxis || !layout.yaxis) return;
                pinchStartXRange = [...layout.xaxis.range];
                pinchStartYRange = [...layout.yaxis.range];

                // Compute anchor as fraction of the plot area
                const mid = getTouchMidpoint(e.touches[0], e.touches[1]);
                const dragLayer = chartEl.querySelector('.draglayer .xy');
                const pRect = dragLayer ? dragLayer.getBoundingClientRect() : chartEl.getBoundingClientRect();

                pinchAnchorFx = Math.max(0, Math.min(1, (mid.x - pRect.left) / pRect.width));
                pinchAnchorFy = Math.max(0, Math.min(1, 1 - (mid.y - pRect.top) / pRect.height));
            }
        }, { passive: false });

        chartEl.addEventListener('touchmove', (e) => {
            if (e.touches.length !== 2 || pinchStartDist === null) return;
            if (!pinchStartXRange || !pinchStartYRange) return;

            e.preventDefault();
            e.stopPropagation();

            const currentDist = getTouchDist(e.touches[0], e.touches[1]);
            if (currentDist < 1) return;

            // scale < 1 zooms in (fingers spreading), scale > 1 zooms out (pinching)
            const scale = pinchStartDist / currentDist;

            const ranges = computeZoomedRanges({
                xRange: pinchStartXRange,
                yRange: pinchStartYRange,
                scale,
                anchorFx: pinchAnchorFx,
                anchorFy: pinchAnchorFy
            });
            if (ranges) {
                pinchFinalRanges = ranges;
                // Stay in internal-update mode for the entire pinch gesture so
                // Plotly relayout events cannot sneak through and trigger updateChart.
                // isInternalUpdate was set to true in touchstart and will stay true
                // until onPinchEnd's timer fires.
                isInternalUpdate = true;
                clearTimeout(relayoutTimer);
                clearTimeout(internalUpdateTimer);
                applyZoomLayout(chartEl, ranges);
                updateHeaderTagline();
            }
        }, { passive: false });

        const onPinchEnd = (e) => {
            if (e.touches.length < 2 && pinchActive) {
                pinchActive = false;
                const endedRanges = pinchFinalRanges;
                pinchStartDist = null;
                pinchStartXRange = null;
                pinchStartYRange = null;

                // Enable/disable pan on mobile based on whether the view is zoomed in.
                if (IS_TOUCH_DEVICE && endedRanges) {
                    _mobileZoomed = !viewCoversDataBounds(currentFilteredData, endedRanges.xRange, endedRanges.yRange);
                    Plotly.relayout(chartEl, { dragmode: _mobileZoomed ? 'pan' : false });
                }

                // Wait for Plotly's internal relayout events to settle, then
                // re-run updateChart so computeVisibleRubbers recalculates the
                // thinned rubber set for the new zoom level (mobile only).
                clearTimeout(relayoutTimer);
                clearTimeout(internalUpdateTimer);
                internalUpdateTimer = setTimeout(() => {
                    isInternalUpdate = false;
                    updateChart({ preserveRanges: true });
                }, 300);
                pinchFinalRanges = null;
            }
        };

        chartEl.addEventListener('touchend', onPinchEnd, { passive: true });
        chartEl.addEventListener('touchcancel', onPinchEnd, { passive: true });
    }

    // Desktop pinch-to-zoom: trackpad pinch fires wheel events with ctrlKey=true
    if (!chartEl._hasWheelPinchHandler) {
        chartEl._hasWheelPinchHandler = true;

        chartEl.addEventListener('wheel', (e) => {
            // Only intercept trackpad pinch (ctrlKey signals pinch on Mac/Windows)
            if (!e.ctrlKey) return;
            e.preventDefault();
            e.stopPropagation();

            const layout = chartEl._fullLayout;
            if (!layout || !layout.xaxis || !layout.yaxis) return;
            const xRange = [...layout.xaxis.range];
            const yRange = [...layout.yaxis.range];

            // deltaY > 0 = pinch in (zoom out), deltaY < 0 = pinch out (zoom in)
            // Map delta to a scale factor: positive delta → scale > 1 (zoom out)
            const delta = e.deltaY;
            const WHEEL_SENSITIVITY = 0.008;
            const scale = 1 + delta * WHEEL_SENSITIVITY;

            // Compute anchor from cursor position within the plot area
            const dragLayer = chartEl.querySelector('.draglayer .xy');
            const pRect = dragLayer ? dragLayer.getBoundingClientRect() : chartEl.getBoundingClientRect();
            const anchorFx = Math.max(0, Math.min(1, (e.clientX - pRect.left) / pRect.width));
            const anchorFy = Math.max(0, Math.min(1, 1 - (e.clientY - pRect.top) / pRect.height));

            const ranges = computeZoomedRanges({ xRange, yRange, scale, anchorFx, anchorFy });
            if (!ranges) return;

            // Suppress relayout → updateChart for the duration of the wheel gesture
            isInternalUpdate = true;
            clearTimeout(relayoutTimer);
            clearTimeout(internalUpdateTimer);
            applyZoomLayout(chartEl, ranges);
            updateHeaderTagline();

            // Release guard shortly after the last wheel event, then re-run
            // updateChart so computeVisibleRubbers refreshes for the new zoom.
            internalUpdateTimer = setTimeout(() => {
                isInternalUpdate = false;
                updateChart({ preserveRanges: true });
            }, 200);
        }, { passive: false });
    }
}

// ════════════════════════════════════════════════════════════
//  Spotlight Rotation (mobile discovery)
// ════════════════════════════════════════════════════════════

function isChartInView() {
    const rect = document.getElementById('chart')?.getBoundingClientRect();
    return rect && rect.bottom > 0 && rect.top < window.innerHeight;
}

// Only show auto-popups when the user is near the top of the page
function isNearTop() {
    return window.scrollY < 50;
}

function advanceSpotlight() {
    if (spotlightDismissedByUser) return;
    if (_clickPopupPinned) return;
    if (!isChartInView() || !isNearTop()) return;
    if (currentFilteredData.length === 0) {
        spotlightRubber = null;
        return;
    }
    let idx = Math.floor(Math.random() * currentFilteredData.length);
    // Avoid spotlighting the same rubber twice in a row
    if (currentFilteredData.length > 1 && currentFilteredData[idx] === spotlightRubber) {
        idx = (idx + 1) % currentFilteredData.length;
    }
    spotlightRubber = currentFilteredData[idx];
    updateChart({ preserveRanges: true, force: true });
    _pingSpotlightDot(spotlightRubber);
    if (!spotlightPopupSuppressed) {
        hideChartHoverPopup({ force: true });
        _showDesktopSpotlightPopup(spotlightRubber);
        clearTimeout(spotlightDismissTimer);
        spotlightDismissTimer = setTimeout(() => {
            if (!_clickPopupPinned) hideChartHoverPopup({ force: true });
        }, 5000);
    }
}

function _pingSpotlightDot(rubber) {
    const chartEl = document.getElementById('chart');
    const fl = chartEl._fullLayout;
    if (!fl?.xaxis || !fl?.yaxis) return;
    const { xaxis: xa, yaxis: ya, _size: size } = fl;
    const xFrac = (rubber.x - xa.range[0]) / (xa.range[1] - xa.range[0]);
    const yFrac = 1 - (rubber.y - ya.range[0]) / (ya.range[1] - ya.range[0]);
    const left = fl._size.l + xFrac * size.w;
    const top  = fl._size.t + yFrac * size.h;
    const ping = document.createElement('div');
    ping.className = 'chart-spotlight-ping';
    ping.style.left = left + 'px';
    ping.style.top  = top  + 'px';
    chartEl.style.position = 'relative';
    chartEl.appendChild(ping);
    ping.addEventListener('animationend', () => ping.remove(), { once: true });
}

function startSpotlightRotation() {
    if (!window.matchMedia('(max-width: 768px)').matches) return;
    clearInterval(spotlightTimerId);
    spotlightPaused = false;
    spotlightTimerId = setInterval(() => {
        if (document.hidden || spotlightPaused) return;
        advanceSpotlight();
    }, 6000);
}

function stopSpotlightRotation() {
    clearInterval(spotlightTimerId);
    clearTimeout(spotlightDismissTimer);
    spotlightTimerId = null;
    spotlightRubber = null;
}

function pauseSpotlightRotation() {
    spotlightPaused = true;
    spotlightRubber = null;
    clearTimeout(spotlightDismissTimer);
    updateChart({ preserveRanges: true, force: true });
}

function resumeSpotlightRotation() {
    if (!window.matchMedia('(max-width: 768px)').matches) return;
    if (spotlightTimerId) {
        spotlightPaused = false;
        advanceSpotlight();
    } else {
        startSpotlightRotation();
    }
}

// ════════════════════════════════════════════════════════════
//  Desktop Spotlight Rotation
// ════════════════════════════════════════════════════════════

let _prevDesktopSpotlightRubber = null;

function _showDesktopSpotlightPopup(rubber) {
    const chartEl = document.getElementById('chart');
    const fl = chartEl._fullLayout;
    if (!fl?.xaxis || !fl?.yaxis) return;

    // Build a minimal synthetic Plotly data object so positionHoverPopup
    // can use point.xaxis.l2p / yaxis.l2p for anchor coords.
    const syntheticData = {
        points: [{
            x: rubber.x,
            y: rubber.y,
            xaxis: fl.xaxis,
            yaxis: fl.yaxis,
            data: { customdata: [rubber] },
            pointIndex: 0,
        }],
        event: null,
    };
    showChartHoverPopupFromPlotlyData(syntheticData, chartEl);
}

function advanceDesktopSpotlight() {
    if (spotlightDismissedByUser) return;
    if (_clickPopupPinned) return;
    if (!isChartInView() || !isNearTop() || currentFilteredData.length === 0) return;
    let idx = Math.floor(Math.random() * currentFilteredData.length);
    if (currentFilteredData.length > 1 && currentFilteredData[idx] === _prevDesktopSpotlightRubber) {
        idx = (idx + 1) % currentFilteredData.length;
    }
    const rubber = currentFilteredData[idx];
    _prevDesktopSpotlightRubber = rubber;

    hideChartHoverPopup({ force: true });
    _pingSpotlightDot(rubber);
    _showDesktopSpotlightPopup(rubber);

    clearTimeout(desktopSpotlightDismissTimer);
    desktopSpotlightDismissTimer = setTimeout(() => {
        if (!_clickPopupPinned) hideChartHoverPopup({ force: true });
    }, 5000);
}

function startDesktopSpotlightRotation() {
    if (!window.matchMedia('(min-width: 769px)').matches) return;
    clearInterval(desktopSpotlightTimerId);
    desktopSpotlightPaused = false;
    desktopSpotlightTimerId = setInterval(() => {
        if (document.hidden || desktopSpotlightPaused) return;
        advanceDesktopSpotlight();
    }, 6000);
}

function stopDesktopSpotlightRotation() {
    clearInterval(desktopSpotlightTimerId);
    clearTimeout(desktopSpotlightDismissTimer);
    desktopSpotlightTimerId = null;
    _prevDesktopSpotlightRubber = null;
    hideChartHoverPopup({ force: true });
}

function pauseDesktopSpotlightRotation() {
    desktopSpotlightPaused = true;
    clearTimeout(desktopSpotlightDismissTimer);
}

function resumeDesktopSpotlightRotation() {
    if (!window.matchMedia('(min-width: 769px)').matches) return;
    desktopSpotlightPaused = false;
}

function initChart() {
    // Run twice: first to establish initial plot, second to let
    // shouldAutoscaleForFilteredData widen the view if needed
    updateChart();
    updateChart({ force: true });
}


// ════════════════════════════════════════════════════════════
//  Zoom
// ════════════════════════════════════════════════════════════

// Compute new axis ranges after zooming around an anchor point (0–1 fraction).
// Returns null if zoom is blocked (e.g. already zoomed out to data bounds).
function computeZoomedRanges({ xRange, yRange, scale, anchorFx, anchorFy }) {
    const xSpan = xRange[1] - xRange[0];
    const ySpan = yRange[1] - yRange[0];
    if (xSpan <= 0 || ySpan <= 0) return null;

    const autoscaleBounds = getAutoscaleBounds(currentFilteredData);
    if (scale > 1 && autoscaleBounds && viewCoversDataBounds(currentFilteredData, xRange, yRange)) {
        return null;
    }

    const xCenter = xRange[0] + anchorFx * xSpan;
    const yCenter = yRange[0] + anchorFy * ySpan;

    // Clamp scale to prevent over-zoom-in: don't let the visible span
    // drop below a meaningful minimum (e.g. 5% of the full data span).
    let clampedScale = scale;
    const MIN_SCALE = 0.6;
    const MAX_SCALE = 1.8;
    clampedScale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, clampedScale));
    if (autoscaleBounds && scale < 1) {
        const fullXSpan = autoscaleBounds.x[1] - autoscaleBounds.x[0];
        const fullYSpan = autoscaleBounds.y[1] - autoscaleBounds.y[0];
        const MIN_SPAN_FRACTION = 0.05;
        const minXSpan = fullXSpan * MIN_SPAN_FRACTION;
        const minYSpan = fullYSpan * MIN_SPAN_FRACTION;
        const scaleForMinX = xSpan > 0 ? minXSpan / xSpan : scale;
        const scaleForMinY = ySpan > 0 ? minYSpan / ySpan : scale;
        clampedScale = Math.max(scale, scaleForMinX, scaleForMinY);
    }

    const newXSpan = xSpan * clampedScale;
    const newYSpan = ySpan * clampedScale;

    let newXRange = [xCenter - anchorFx * newXSpan, xCenter + (1 - anchorFx) * newXSpan];
    let newYRange = [yCenter - anchorFy * newYSpan, yCenter + (1 - anchorFy) * newYSpan];

    if (clampedScale > 1 && autoscaleBounds) {
        newXRange = clampRangeToBounds(newXRange, autoscaleBounds.x);
        newYRange = clampRangeToBounds(newYRange, autoscaleBounds.y);
    }

    return { xRange: newXRange, yRange: newYRange };
}

function applyZoomLayout(chartEl, ranges) {
    Plotly.relayout(chartEl, {
        'xaxis.range': ranges.xRange,
        'yaxis.range': ranges.yRange,
        'xaxis.autorange': false,
        'yaxis.autorange': false
    });
}

function triggerAutoscale() {
    const chartEl = document.getElementById('chart');
    if (chartEl && hasPlotted) {
        _mobileZoomed = false;
        Plotly.relayout(chartEl, {
            'xaxis.autorange': true,
            'yaxis.autorange': true,
            ...(IS_TOUCH_DEVICE ? { dragmode: false } : {})
        });
    }
}
