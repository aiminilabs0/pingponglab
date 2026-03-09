// ════════════════════════════════════════════════════════════
//  Radar Chart
// ════════════════════════════════════════════════════════════

const RADAR_ROTATION_DEG_PER_SEC = 0.5;
let radarRotationDeg = 0;
let radarAutoRotateFrameId = null;
let radarAutoRotateLastTs = null;
let radarRotationSpeedMultiplier = 1;  // increases when panicking

function normalizeRankToScore(rank, total) {
    if (!Number.isFinite(rank) || !Number.isFinite(total) || total <= 0) return 0;
    return ((total - rank + 1) / total) * 100;
}

function normalizeValueToScore(value, min, max) {
    if (!Number.isFinite(value) || !Number.isFinite(min) || !Number.isFinite(max) || max <= min) return 50;
    return ((value - min) / (max - min)) * 100;
}

function getRadarData(rubber) {
    const spinTotal = rubberData.length > 0 ? Math.max(...rubberData.map(r => r.spinRank).filter(Number.isFinite)) : 1;
    const speedTotal = rubberData.length > 0 ? Math.max(...rubberData.map(r => r.speedRank).filter(Number.isFinite)) : 1;
    const controlTotal = rubber.controlTotal || spinTotal;

    const wMin = weightFilterState.dataMin;
    const wMax = weightFilterState.dataMax;
    const hMin = hardnessFilterState.dataMin;
    const hMax = hardnessFilterState.dataMax;

    return {
        speed: normalizeRankToScore(rubber.speedRank, speedTotal),
        spin: normalizeRankToScore(rubber.spinRank, spinTotal),
        control: normalizeRankToScore(rubber.controlRank, controlTotal),
        weight: normalizeValueToScore(rubber.weight, wMin, wMax),
        hardness: normalizeValueToScore(rubber.normalizedHardness, hMin, hMax),
    };
}

function buildRadarTrace(rubber, radarData, { dashed = false } = {}) {
    const brandColor = getBrandColor(rubber.brand);
    const radarLabel = rubber.addr || rubber.name || '';
    const categories = ['Speed', 'Spin', 'Control', 'Cut Weight', 'Hardness'];
    // Remap 0–100 scores into 50–100 so the chart starts visually from the middle ring
    const remap = v => 50 + v * 0.5;
    const values = [radarData.speed, radarData.spin, radarData.control, radarData.weight, radarData.hardness]
        .map(remap);

    return {
        type: 'scatterpolar',
        r: [...values, values[0]],
        theta: [...categories, categories[0]],
        fill: 'toself',
        fillcolor: brandColor + '22',
        line: { color: brandColor, width: 2.5, ...(dashed ? { dash: 'dot' } : {}) },
        marker: { color: brandColor, size: 5 },
        name: `${rubber.brand} ${radarLabel}`,
        hoverinfo: 'skip',
    };
}

function getPlayerYouTubeVideoId(rubber) {
    if (!rubber) return null;
    const collectPlayerYoutubeUrls = (entries) => {
        if (!Array.isArray(entries)) return [];

        const urls = [];
        entries.forEach(entry => {
            const parsed = parsePlayerEntry(entry);
            if (!parsed) return;

            // Keep entry-level links bound to the same player entry.
            if (parsed.url) {
                urls.push(parsed.url);
                return;
            }

            const player = playersData[parsed.name];
            if (player && Array.isArray(player.youtubes) && player.youtubes.length) {
                urls.push(...player.youtubes.filter(Boolean));
            }
        });
        return urls;
    };

    const videoIds = Array.from(new Set([
        ...collectPlayerYoutubeUrls(rubber.forehandPlayers),
        ...collectPlayerYoutubeUrls(rubber.backhandPlayers),
    ]
        .map(extractYouTubeVideoId)
        .filter(Boolean)));

    if (videoIds.length === 0) return null;
    return videoIds[0];
}

function buildRubberHeaderHtml(rubber, panelIndex, dashed) {
    if (!rubber) {
        const placeholderColor = '#9e9689';
        const placeholderRubbers = [
            { displayBrand: 'BRAND', displayName: 'Rubber 1', imageName: 'Tenergy 05' },
            { displayBrand: 'BRAND', displayName: 'Rubber 2', imageName: 'H3 Neo' },
        ];
        const placeholderRubber = placeholderRubbers[panelIndex] || placeholderRubbers[0];
        const placeholderBrand = placeholderRubber.displayBrand;
        const placeholderName = placeholderRubber.displayName;
        const placeholderImageName = encodeURIComponent(placeholderRubber.imageName);
        const lineStyle = panelIndex === 1 ? 'border-top: 2.5px dotted' : 'border-top: 2.5px solid';
        return `
            <div class="radar-comparison-header-side${panelIndex === 1 ? ' radar-comparison-header-side--right' : ''}">
                <div class="radar-info-header">
                    <span class="brand-pill brand-pill--sm" style="background:${placeholderColor}18;border-color:${placeholderColor}55;color:${placeholderColor}">
                        <span class="brand-dot" style="background:${placeholderColor}"></span>${placeholderBrand}
                    </span>
                </div>
                <div class="radar-info-name-row">
                    <div class="rubber-name" style="color:${placeholderColor}">${placeholderName}</div>
                </div>
                <img
                    class="radar-rubber-img radar-rubber-img--placeholder"
                    src="images/rubbers/${placeholderImageName}.jpg"
                    alt="${escapeHtml(placeholderName)}"
                    onerror="this.style.display='none';this.nextElementSibling.style.display='block';"
                >
                <div class="radar-rubber-img-placeholder" style="display:none;"></div>
                <div class="radar-info-line-key" style="${lineStyle} ${placeholderColor}; width: 28px;"></div>
            </div>
        `;
    }
    const brandColor = getBrandColor(rubber.brand);
    const radarLabel = rubber.addr || rubber.name || '-';
    const lineStyle = dashed ? 'border-top: 2.5px dotted' : 'border-top: 2.5px solid';
    const isPinned = pinnedRubbers[panelIndex];
    const pinIcon = isPinned
        ? `<svg class="radar-pin-icon" viewBox="0 0 24 24" width="14" height="14" fill="currentColor" stroke="none"><path d="M16 12V4h1V2H7v2h1v8l-2 2v2h5.2v6h1.6v-6H18v-2l-2-2z"/></svg>`
        : `<svg class="radar-pin-icon" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M16 12V4h1V2H7v2h1v8l-2 2v2h5.2v6h1.6v-6H18v-2l-2-2z"/></svg>`;
    const rubberImgName = encodeURIComponent(rubber.abbr || rubber.name);
    const rubberImgHtml = `<img class="radar-rubber-img" src="images/rubbers/${rubberImgName}.jpg" alt="${escapeHtml(radarLabel)}" onerror="this.style.display='none'">`;
    return `
        <div class="radar-comparison-header-side${panelIndex === 1 ? ' radar-comparison-header-side--right' : ''}">
            <div class="radar-info-header">
                <span class="brand-pill brand-pill--sm" style="background:${brandColor}18;border-color:${brandColor}55;color:${brandColor}">
                    <span class="brand-dot" style="background:${brandColor}"></span>${escapeHtml(rubber.brand)}
                </span>
            </div>
            <div class="radar-info-name-row">
                <div class="rubber-name" style="color:${brandColor}">${escapeHtml(radarLabel)}</div>
                <button class="radar-pin-btn${isPinned ? ' radar-pin-btn--active' : ''}" data-panel-index="${panelIndex}" title="${isPinned ? 'Unpin rubber' : 'Pin rubber'}">${pinIcon}</button>
            </div>
            ${rubberImgHtml}
            <div class="radar-info-line-key" style="${lineStyle} ${brandColor}; width: 28px;"></div>
        </div>
    `;
}

function buildPlayersColumnHtml(rubber, align) {
    if (!rubber) return '<span class="radar-cmp-dash">-</span>';
    const imagePosition = align === 'right' ? 'before' : 'after';
    const toLabel = (entries, fallbackLabel) => {
        if (Array.isArray(entries) && entries.length) {
            return entries
                .map(entry => renderPlayerEntryHtml(entry, { imagePosition }))
                .filter(Boolean)
                .join('<br>');
        }
        return fallbackLabel || '';
    };
    const forehand = toLabel(rubber.forehandPlayers, rubber.forehandPlayerLabel);
    const backhand = toLabel(rubber.backhandPlayers, rubber.backhandPlayerLabel);
    const rows = [
        forehand ? `<div class="radar-info-player-row"><span class="radar-info-side-badge radar-info-side-badge--fh">FH 🏓</span><span class="radar-info-player-names">${forehand}</span></div>` : '',
        backhand ? `<div class="radar-info-player-row"><span class="radar-info-side-badge radar-info-side-badge--bh">BH <span class="radar-info-paddle-black">🏓</span></span><span class="radar-info-player-names">${backhand}</span></div>` : ''
    ].filter(Boolean);
    if (!rows.length) return '<span class="radar-cmp-dash">-</span>';
    return `<div class="radar-info-players radar-info-players--${align}">${rows.join('')}</div>`;
}

function buildRadarComparisonHtml(first, second) {
    if (!first && !second) {
        const dash = '<span class="radar-cmp-dash">-</span>';
        const emptyLabels = ['Speed Rank', 'Spin Rank', 'Control', 'Cut Weight', 'Hardness', 'Release', 'Thickness'];
        const metricRows = emptyLabels.map(label => `
            <div class="radar-cmp-cell radar-cmp-cell--left">${dash}</div>
            <div class="radar-cmp-cell radar-cmp-cell--label">${label}</div>
            <div class="radar-cmp-cell radar-cmp-cell--right">${dash}</div>
        `).join('');
        const playersRow = `
            <div class="radar-cmp-cell radar-cmp-cell--left radar-cmp-cell--players">${dash}</div>
            <div class="radar-cmp-cell radar-cmp-cell--label">Players</div>
            <div class="radar-cmp-cell radar-cmp-cell--right radar-cmp-cell--players">${dash}</div>
        `;
        return `
            <div class="radar-comparison-headers">
                ${buildRubberHeaderHtml(null, 0, false)}
                ${buildRubberHeaderHtml(null, 1, true)}
            </div>
            <div class="radar-comparison-grid">${metricRows}${playersRow}</div>
        `;
    }

    const sameBrand = first && second && getBrandColor(first.brand) === getBrandColor(second.brand);

    // Build header
    const headerHtml = `
        <div class="radar-comparison-headers">
            ${buildRubberHeaderHtml(first, 0, false)}
            ${buildRubberHeaderHtml(second, 1, sameBrand)}
        </div>
    `;

    // Metric helpers
    function val(rubber, getter) {
        if (!rubber) return '<span class="radar-cmp-dash">-</span>';
        return getter(rubber);
    }
    function hasFiniteNumber(value) {
        return Number.isFinite(value);
    }
    function shouldUnderlineLowerRank(rubber, otherRubber, rankKey) {
        const rank = rubber?.[rankKey];
        const otherRank = otherRubber?.[rankKey];
        if (!hasFiniteNumber(rank) || !hasFiniteNumber(otherRank)) return false;
        return rank < otherRank;
    }
    function shouldUnderlineHigherHardness(rubber, otherRubber) {
        const hardness = rubber?.normalizedHardness;
        const otherHardness = otherRubber?.normalizedHardness;
        if (!hasFiniteNumber(hardness) || !hasFiniteNumber(otherHardness)) return false;
        return hardness > otherHardness;
    }
    function shouldUnderlineHigherWeight(rubber, otherRubber) {
        const weight = rubber?.weight;
        const otherWeight = otherRubber?.weight;
        if (!hasFiniteNumber(weight) || !hasFiniteNumber(otherWeight)) return false;
        return weight > otherWeight;
    }

    // Build metric rows
    const metrics = [
        {
            label: 'Speed Rank',
            left: val(first, r => `<strong${shouldUnderlineLowerRank(r, second, 'speedRank') ? ' class="radar-cmp-highlighted"' : ''}>${typeof r.speedRank === 'number' ? '#' + r.speedRank : '-'}</strong>`),
            right: val(second, r => `<strong${shouldUnderlineLowerRank(r, first, 'speedRank') ? ' class="radar-cmp-highlighted"' : ''}>${typeof r.speedRank === 'number' ? '#' + r.speedRank : '-'}</strong>`),
        },
        {
            label: 'Spin Rank',
            left: val(first, r => `<strong${shouldUnderlineLowerRank(r, second, 'spinRank') ? ' class="radar-cmp-highlighted"' : ''}>${typeof r.spinRank === 'number' ? '#' + r.spinRank : '-'}</strong>`),
            right: val(second, r => `<strong${shouldUnderlineLowerRank(r, first, 'spinRank') ? ' class="radar-cmp-highlighted"' : ''}>${typeof r.spinRank === 'number' ? '#' + r.spinRank : '-'}</strong>`),
        },
        {
            label: 'Control',
            left: val(first, r => `<strong class="chart-control-indicator">${buildControlLevelIndicatorHtml(r.controlRank)}</strong>`),
            right: val(second, r => `<strong class="chart-control-indicator">${buildControlLevelIndicatorHtml(r.controlRank, { fillFromLeft: true })}</strong>`),
        },
        {
            label: 'Cut Weight',
            left: val(first, r => `<strong class="${[getWeightToneClass(r.weight), shouldUnderlineHigherWeight(r, second) ? 'radar-cmp-highlighted' : ''].filter(Boolean).join(' ')}">${escapeHtml(r.weightLabel || '-')}</strong>`),
            right: val(second, r => `<strong class="${[getWeightToneClass(r.weight), shouldUnderlineHigherWeight(r, first) ? 'radar-cmp-highlighted' : ''].filter(Boolean).join(' ')}">${escapeHtml(r.weightLabel || '-')}</strong>`),
        },
        {
            label: 'Hardness',
            left: val(first, r => `<strong class="${[getHardnessToneClass(r.normalizedHardness), shouldUnderlineHigherHardness(r, second) ? 'radar-cmp-highlighted' : ''].filter(Boolean).join(' ')}">${escapeHtml(formatHardnessPopupLabel(r))}</strong>`),
            right: val(second, r => `<strong class="${[getHardnessToneClass(r.normalizedHardness), shouldUnderlineHigherHardness(r, first) ? 'radar-cmp-highlighted' : ''].filter(Boolean).join(' ')}">${escapeHtml(formatHardnessPopupLabel(r))}</strong>`),
        },
        {
            label: 'Release',
            left: val(first, r => `<strong>${escapeHtml(r.releaseYearLabel || 'N/A')}</strong>`),
            right: val(second, r => `<strong>${escapeHtml(r.releaseYearLabel || 'N/A')}</strong>`),
        },
        {
            label: 'Thickness',
            left: val(first, r => `<strong>${formatThicknessRadarHtml(r.thicknessLabel)}</strong>`),
            right: val(second, r => `<strong>${formatThicknessRadarHtml(r.thicknessLabel)}</strong>`),
        },
    ];

    const metricRowsHtml = metrics.map(m => `
        <div class="radar-cmp-cell radar-cmp-cell--left">${m.left}</div>
        <div class="radar-cmp-cell radar-cmp-cell--label">${m.label}</div>
        <div class="radar-cmp-cell radar-cmp-cell--right">${m.right}</div>
    `).join('');

    // Players row (special layout)
    const playersRowHtml = `
        <div class="radar-cmp-cell radar-cmp-cell--left radar-cmp-cell--players">${buildPlayersColumnHtml(first, 'right')}</div>
        <div class="radar-cmp-cell radar-cmp-cell--label">Players</div>
        <div class="radar-cmp-cell radar-cmp-cell--right radar-cmp-cell--players">${buildPlayersColumnHtml(second, 'left')}</div>
    `;

    return `
        ${headerHtml}
        <div class="radar-comparison-grid">
            ${metricRowsHtml}
            ${playersRowHtml}
        </div>
    `;
}

function updateRadarChart() {
    const chartEl = document.getElementById('radarChart');
    if (!chartEl) return;
    const infoPanel = document.getElementById('radarInfoPanel');
    const [first, second] = selectedRubbers;
    const isMobile = window.innerWidth <= 768;
    const chartHeight = isMobile ? 260 : 320;

    infoPanel.innerHTML = buildRadarComparisonHtml(first, second);
    const sameBrand = first && second && getBrandColor(first.brand) === getBrandColor(second.brand);
    const radarCategories = ['Speed', 'Spin', 'Control', 'Cut Weight', 'Hardness'];
    const traces = [];

    if (!first && !second) {
        const placeholderColor = 'rgba(158,150,137,0.45)';
        traces.push({
            type: 'scatterpolar',
            r: [70, 62, 68, 64, 66, 70],
            theta: [...radarCategories, radarCategories[0]],
            mode: 'lines',
            line: { color: placeholderColor, width: 2.5 },
            fill: 'toself',
            fillcolor: 'rgba(158,150,137,0.08)',
            hoverinfo: 'skip',
            showlegend: false,
        });
        traces.push({
            type: 'scatterpolar',
            r: [63, 72, 58, 70, 60, 63],
            theta: [...radarCategories, radarCategories[0]],
            mode: 'lines',
            line: { color: placeholderColor, width: 2.5, dash: 'dot' },
            fill: 'toself',
            fillcolor: 'rgba(158,150,137,0.06)',
            hoverinfo: 'skip',
            showlegend: false,
        });
    }
    if (first) traces.push(buildRadarTrace(first, getRadarData(first)));
    if (second) traces.push(buildRadarTrace(second, getRadarData(second), { dashed: sameBrand }));
    const layout = {
        autosize: true,
        height: chartHeight,
        polar: {
            bgcolor: 'rgba(0,0,0,0)',
            radialaxis: {
                visible: true,
                range: [0, 105],
                showticklabels: false,
                gridcolor: 'rgba(158,150,137,0.18)',
                linecolor: 'rgba(0,0,0,0)',
            },
            angularaxis: {
                categoryorder: 'array',
                categoryarray: radarCategories,
                gridcolor: 'rgba(158,150,137,0.18)',
                linecolor: 'rgba(158,150,137,0.25)',
                tickfont: { color: '#e8e0d0', size: isMobile ? 11 : 13 },
                rotation: radarRotationDeg,
            },
        },
        showlegend: false,
        annotations: [],
        paper_bgcolor: 'rgba(0,0,0,0)',
        plot_bgcolor: 'rgba(0,0,0,0)',
        margin: isMobile ? { t: 52, b: 52, l: 90, r: 90 } : { t: 42, b: 38, l: 55, r: 55 },
    };

    const config = {
        displayModeBar: false,
        responsive: true,
        scrollZoom: false,
        doubleClick: false,
        showTips: false,
        staticPlot: true,
    };

    chartEl.style.height = `${chartHeight}px`;
    Plotly.react(chartEl, traces, layout, config);

    // Ensure Plotly re-measures in flex layout after content updates.
    requestAnimationFrame(() => {
        if (!chartEl) return;
        Plotly.Plots.resize(chartEl);
    });
}

function startRadarAutoRotate() {
    if (radarAutoRotateFrameId !== null) return;

    const tick = (timestamp) => {
        if (document.hidden) {
            radarAutoRotateLastTs = timestamp;
            radarAutoRotateFrameId = requestAnimationFrame(tick);
            return;
        }

        if (radarAutoRotateLastTs === null) {
            radarAutoRotateLastTs = timestamp;
        }

        const elapsedSec = (timestamp - radarAutoRotateLastTs) / 1000;
        radarAutoRotateLastTs = timestamp;
        radarRotationDeg = (radarRotationDeg + elapsedSec * RADAR_ROTATION_DEG_PER_SEC * radarRotationSpeedMultiplier) % 360;

        const chartEl = document.getElementById('radarChart');
        if (chartEl?._fullLayout) {
            Plotly.relayout(chartEl, { 'polar.angularaxis.rotation': radarRotationDeg });
        }

        radarAutoRotateFrameId = requestAnimationFrame(tick);
    };

    radarAutoRotateFrameId = requestAnimationFrame(tick);
}

// ════════════════════════════════════════════════════════════
//  Radar Chart – Dodge & Fun Interactions
// ════════════════════════════════════════════════════════════

const RADAR_DODGE = {
    DETECT_RADIUS: 280,
    STRENGTH: 2400,
    FRICTION: 0.85,
    SPRING: 3.5,
    MAX_OFFSET: 140,
    CLICK_IMPULSE: 700,
};

let radarDodgeX = 0, radarDodgeY = 0;
let radarDodgeVx = 0, radarDodgeVy = 0;
let radarDodgeFrameId = null;
let radarDodgeLastTs = null;
let radarIsPanicking = false;
let radarCatchCount = 0;
let radarDodgeMouseX = -9999, radarDodgeMouseY = -9999;

function getRadarChartCenter() {
    const el = document.getElementById('radarChart');
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    return {
        cx: rect.left + rect.width / 2 - radarDodgeX,
        cy: rect.top + rect.height / 2 - radarDodgeY,
    };
}

function showCatchEffect(x, y) {
    const messages = ['!', 'Hey!', 'Stop!', 'No!', '...!', '?!', 'Eek!', 'Nope!', 'Why?!', 'Ow!'];
    const msg = messages[radarCatchCount % messages.length];
    const el = document.createElement('div');
    el.className = 'radar-catch-effect';
    el.textContent = msg;
    el.style.left = x + 'px';
    el.style.top = y + 'px';
    document.body.appendChild(el);
    requestAnimationFrame(() => {
        el.classList.add('radar-catch-effect--fly');
    });
    setTimeout(() => el.remove(), 900);
}

function startRadarDodgePhysics() {
    if (radarDodgeFrameId !== null) return;

    const tick = (timestamp) => {
        if (document.hidden) {
            radarDodgeLastTs = timestamp;
            radarDodgeFrameId = requestAnimationFrame(tick);
            return;
        }
        if (radarDodgeLastTs === null) radarDodgeLastTs = timestamp;
        const dt = Math.min((timestamp - radarDodgeLastTs) / 1000, 0.05);
        radarDodgeLastTs = timestamp;

        const chartEl = document.getElementById('radarChart');
        const center = getRadarChartCenter();
        if (!chartEl || !center) {
            radarDodgeFrameId = requestAnimationFrame(tick);
            return;
        }

        const dx = radarDodgeMouseX - center.cx;
        const dy = radarDodgeMouseY - center.cy;
        const dist = Math.sqrt(dx * dx + dy * dy);

        radarIsPanicking = dist < RADAR_DODGE.DETECT_RADIUS;

        if (radarIsPanicking && dist > 1) {
            const proximity = 1 - dist / RADAR_DODGE.DETECT_RADIUS;
            const force = RADAR_DODGE.STRENGTH * proximity * proximity;
            radarDodgeVx += (-dx / dist) * force * dt;
            radarDodgeVy += (-dy / dist) * force * dt;
        }

        // Spring back to origin
        radarDodgeVx -= radarDodgeX * RADAR_DODGE.SPRING * dt * 60;
        radarDodgeVy -= radarDodgeY * RADAR_DODGE.SPRING * dt * 60;

        // Friction
        const f = Math.pow(RADAR_DODGE.FRICTION, dt * 60);
        radarDodgeVx *= f;
        radarDodgeVy *= f;

        // Integrate position
        radarDodgeX += radarDodgeVx * dt;
        radarDodgeY += radarDodgeVy * dt;

        // Clamp to max offset
        const offsetDist = Math.sqrt(radarDodgeX * radarDodgeX + radarDodgeY * radarDodgeY);
        if (offsetDist > RADAR_DODGE.MAX_OFFSET) {
            const s = RADAR_DODGE.MAX_OFFSET / offsetDist;
            radarDodgeX *= s;
            radarDodgeY *= s;
            const dot = (radarDodgeVx * radarDodgeX + radarDodgeVy * radarDodgeY) / (offsetDist * offsetDist);
            if (dot > 0) {
                radarDodgeVx -= 1.5 * dot * radarDodgeX;
                radarDodgeVy -= 1.5 * dot * radarDodgeY;
            }
        }

        // Keep rotation speed constant (no speed-up on hover/click)
        radarRotationSpeedMultiplier = 1;

        // Apply visual transform to chart only
        const wobble = radarIsPanicking ? Math.sin(timestamp / 40) * 2 : 0;
        const pulse = radarIsPanicking ? 0.975 + Math.sin(timestamp / 80) * 0.012 : 1;
        chartEl.style.transform = `translate(${radarDodgeX + wobble}px, ${radarDodgeY}px) scale(${pulse})`;

        radarDodgeFrameId = requestAnimationFrame(tick);
    };

    radarDodgeFrameId = requestAnimationFrame(tick);
}

function initRadarDodge() {
    const chartEl = document.getElementById('radarChart');
    if (!chartEl) return;

    // Click on chart → strong impulse + catch effect
    chartEl.addEventListener('click', (e) => {
        const center = getRadarChartCenter();
        if (!center) return;

        const cdx = center.cx - e.clientX;
        const cdy = center.cy - e.clientY;
        const angle = Math.atan2(cdy, cdx) + (Math.random() - 0.5) * 1.2;
        radarDodgeVx += Math.cos(angle) * RADAR_DODGE.CLICK_IMPULSE;
        radarDodgeVy += Math.sin(angle) * RADAR_DODGE.CLICK_IMPULSE;

        radarCatchCount++;
        showCatchEffect(e.clientX, e.clientY);
    });

    startRadarDodgePhysics();
}
