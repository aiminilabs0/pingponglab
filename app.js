// ════════════════════════════════════════════════════════════
//  Constants & Configuration
// ════════════════════════════════════════════════════════════

const RUBBER_INDEX_FILE = 'stats/rubbers/index.json';
const RANKING_FILES = {
    spin: 'stats/rubbers/ranking/spin.json',
    speed: 'stats/rubbers/ranking/speed.json',
    control: 'stats/rubbers/ranking/control.json'
};
const POPULARITY_FILE = 'stats/rubbers/ranking/priority.json';
const BESTSELLER_FILE = 'stats/rubbers/ranking/bestseller.json';

const BRAND_COLORS = {
    Butterfly: '#E41A1C',
    DHS: '#377EB8',
    Andro: '#4DAF4A',
    JOOLA: '#984EA3',
    Xiom: '#FF7F00',
    Tibhar: '#A65628',
    Nittaku: '#F781BF',
    Donic: '#999999',
    Yasaka: '#FFFF33'
};

const TOPSHEET_MARKERS = {
    Classic: 'circle',
    Chinese: 'square',
    Hybrid: 'diamond'
};

// Country hardness scales — GE is the global standard; JP & CN are equivalent scales.
// GE 40 = JP 33 = CN 35 (soft), GE 47.5 = JP 36 = CN 39 (medium), GE 55 = JP 44 = CN 41 (hard)
const HARDNESS_SCALES = {
    Germany: [40, 47.5, 55],
    Japan:   [33, 36,   44],
    China:   [35, 39,   41]
};

// Piecewise-linear interpolation between two 3-point scales
function interpolateScale(value, fromPts, toPts) {
    for (let i = 0; i < fromPts.length - 1; i++) {
        if (value <= fromPts[i + 1] || i === fromPts.length - 2) {
            const t = (value - fromPts[i]) / (fromPts[i + 1] - fromPts[i]);
            return toPts[i] + t * (toPts[i + 1] - toPts[i]);
        }
    }
    return value;
}

function toGermanScale(value, country) {
    if (!Number.isFinite(value)) return null;
    if (country === 'Germany' || !HARDNESS_SCALES[country]) return value;
    return interpolateScale(value, HARDNESS_SCALES[country], HARDNESS_SCALES.Germany);
}

function fromGermanScale(geValue, country) {
    if (!Number.isFinite(geValue)) return null;
    if (country === 'Germany' || !HARDNESS_SCALES[country]) return geValue;
    return interpolateScale(geValue, HARDNESS_SCALES.Germany, HARDNESS_SCALES[country]);
}

const COUNTRY_TO_LANG = { us: 'en', eu: 'en', cn: 'cn', kr: 'ko' };
const FILTER_IDS = ['brand', 'name', 'topsheet', 'hardness', 'weight'];
const DEBUG_MODE = new URLSearchParams(window.location.search).has('debug');

// ════════════════════════════════════════════════════════════
//  Application State
// ════════════════════════════════════════════════════════════

let rubberData = [];
let descriptions = {};
let selectedRubbers = [null, null];
let nextDetailPanel = 1;
let hasPlotted = false;
let isInternalUpdate = false;
let currentFilteredData = [];
let relayoutTimer = null;
let internalUpdateTimer = null;
let selectedCountry = 'us';
let openFilterId = null;
let weightFilterState = {
    dataMin: null,
    dataMax: null,
    selectedMin: null,
    selectedMax: null
};
let hardnessFilterState = {
    dataMin: null,
    dataMax: null,
    selectedMin: null,
    selectedMax: null
};

// YouTube embed state
let ytApiReady = false;
let ytPlayers = {};
let ytPlayerIdCounter = 0;
window.onYouTubeIframeAPIReady = () => { ytApiReady = true; };

const rubberDetailsCache = {};

// ════════════════════════════════════════════════════════════
//  Data Parsing & Normalization
// ════════════════════════════════════════════════════════════

function parseRatingNumber(value) {
    if (typeof value === 'number') return value;
    if (typeof value !== 'string') return null;
    const match = value.match(/[\d.]+/);
    if (!match) return null;
    const parsed = Number.parseFloat(match[0]);
    return Number.isFinite(parsed) ? parsed : null;
}

function normalizeTopsheet(value) {
    if (typeof value === 'string') {
        const lower = value.trim().toLowerCase();
        if (lower === 'classic') return 'Classic';
        if (lower === 'chinese') return 'Chinese';
        if (lower === 'hybrid') return 'Hybrid';
    }
    return 'Classic';
}

function buildFullName(brand, name) {
    const b = (brand || '').trim();
    const n = (name || '').trim();
    if (!b) return n;
    if (n.toLowerCase().startsWith(b.toLowerCase())) return n;
    return `${b} ${n}`.trim();
}

// ════════════════════════════════════════════════════════════
//  Description Markdown
// ════════════════════════════════════════════════════════════

function buildDescriptionMarkdown(raw) {
    const details = raw.manufacturer_details || {};
    const lines = [
        raw.price ? `**Price:** ${raw.price}` : null,
        details.topsheet ? `**Topsheet:** ${details.topsheet}` : null,
        details.hardness !== undefined ? `**Hardness:** ${details.hardness}° ${COUNTRY_FLAGS[details.country]}` : null,
        details.weight !== undefined ? `**Weight:** ${details.weight}g` : null,
        details.thickness ? `**Thickness:** ${Array.isArray(details.thickness) ? details.thickness.join(', ') : details.thickness}` : null
    ].filter(Boolean);
    return lines.join('\n');
}

// ════════════════════════════════════════════════════════════
//  Ranking Data
// ════════════════════════════════════════════════════════════
async function loadRankings() {
    const results = await Promise.all(
        Object.entries(RANKING_FILES).map(([key, url]) =>
            fetch(url).then(r => {
                if (!r.ok) throw new Error(`HTTP ${r.status} for ${url}`);
                return r.json();
            }).then(data => [key, data])
        )
    );
    return Object.fromEntries(results);
}

// Find a rubber's 0-based position in a ranking array.
// Tries matching the ranking entry name against both rubber.name and rubber.abbr.
function findRubberRank(rubber, rankingArray) {
    const rubberBrand = (rubber.brand || '').trim().toLowerCase();
    const rubberNameNorm = rubber.name;
    const rubberAbbrNorm = rubber.abbr;

    for (let i = 0; i < rankingArray.length; i++) {
        const entry = rankingArray[i];
        const entryBrand = (entry.brand || '').trim().toLowerCase();
        if (entryBrand !== rubberBrand) continue;

        const entryNameNorm = entry.name;
        if (entryNameNorm === rubberNameNorm || entryNameNorm === rubberAbbrNorm) return i;
    }
    return -1;
}

// ════════════════════════════════════════════════════════════
//  Data Loading
// ════════════════════════════════════════════════════════════

async function loadRubberData() {
    const indexResp = await fetch(RUBBER_INDEX_FILE);
    if (!indexResp.ok) {
        throw new Error(`HTTP ${indexResp.status} for ${RUBBER_INDEX_FILE}`);
    }

    const rubberFiles = await indexResp.json();
    if (!Array.isArray(rubberFiles)) {
        throw new Error(`${RUBBER_INDEX_FILE} must contain an array of file paths`);
    }

    const results = await Promise.allSettled(
        rubberFiles.map(file =>
            fetch(file).then(r => {
                if (!r.ok) throw new Error(`HTTP ${r.status} for ${file}`);
                return r.json();
            })
        )
    );

    const rawItems = results.flatMap(result => {
        if (result.status !== 'fulfilled') {
            console.warn('Skipping rubber data file:', result.reason);
            return [];
        }
        // Backward compatible with old per-brand array files.
        if (Array.isArray(result.value)) {
            return result.value;
        }
        if (result.value && typeof result.value === 'object') {
            return [result.value];
        }
        return [];
    });

    const data = [];
    const descriptionMap = {};
    for (const raw of rawItems) {
        // Exclude entries explicitly flagged as disabled in source JSON.
        if (raw?.disabled !== undefined) continue;

        const ratings = raw.user_ratings || {};
        const details = raw.manufacturer_details || {};
        const hardness = parseRatingNumber(details.hardness);
        const weightValue = parseRatingNumber(details.weight);
        const hardnessFlag = COUNTRY_FLAGS[details.country] || '';
        const urls = raw.urls || {};

        const rubber = {
            name: raw.name,
            fullName: buildFullName(raw.manufacturer, raw.name),
            abbr: raw.abbr || raw.name,
            brand: raw.manufacturer,
            x: null,
            y: null,
            weight: weightValue,
            hardness: parseRatingNumber(ratings.sponge_hardness),
            manufacturerHardness: hardness,
            normalizedHardness: toGermanScale(hardness, details.country),
            hardnessLabel: Number.isFinite(hardness) ? `${hardness}°${hardnessFlag ? ` ${hardnessFlag}` : ''}` : 'N/A',
            weightLabel: Number.isFinite(weightValue) ? `${weightValue}g` : 'N/A',
            control: parseRatingNumber(ratings.control),
            topsheet: normalizeTopsheet(details.topsheet),
            priority: 999, // will be overridden by popularity ranking
            bestseller: false, // will be overridden by bestseller ranking
            urls: {
                us: { product: urls.us?.product || '', youtube: urls.us?.youtube || '' },
                eu: { product: urls.eu?.product || '', youtube: urls.eu?.youtube || '' },
                kr: { product: urls.kr?.product || '', youtube: urls.kr?.youtube || '' },
                cn: { product: urls.cn?.product || '', youtube: urls.cn?.youtube || '' }
            }
        };

        data.push(rubber);
        descriptionMap[rubber.name] = buildDescriptionMarkdown(raw);
    }

    // ── Override chart positions with ranking data ──
    const rankings = await loadRankings();
    const spinTotal = rankings.spin.length;
    const speedTotal = rankings.speed.length;
    const controlTotal = rankings.control.length;

    // ── Override priority with popularity ranking ──
    const popularityResp = await fetch(POPULARITY_FILE);
    const popularityRanking = popularityResp.ok ? await popularityResp.json() : [];
    const bestsellerResp = await fetch(BESTSELLER_FILE);
    const bestsellerRanking = bestsellerResp.ok ? await bestsellerResp.json() : [];

    for (const rubber of data) {
        const spinIdx = findRubberRank(rubber, rankings.spin);
        const speedIdx = findRubberRank(rubber, rankings.speed);
        const controlIdx = findRubberRank(rubber, rankings.control);

        // Chart axes: higher value = more spin / more speed (rank 0 → highest value)
        rubber.x = spinIdx >= 0 ? spinTotal - spinIdx : null;
        rubber.y = speedIdx >= 0 ? speedTotal - speedIdx : null;

        // Store 1-based ranks for display
        rubber.spinRank = spinIdx >= 0 ? spinIdx + 1 : null;
        rubber.speedRank = speedIdx >= 0 ? speedIdx + 1 : null;
        rubber.controlRank = controlIdx >= 0 ? controlIdx + 1 : null;
        rubber.controlTotal = controlTotal;

        // Priority from popularity ranking (lower = more important)
        const popIdx = findRubberRank(rubber, popularityRanking);
        if (popIdx >= 0) rubber.priority = popIdx + 1;
        rubber.bestseller = findRubberRank(rubber, bestsellerRanking) >= 0;
    }

    // Only show rubbers that appear in both spin and speed rankings
    rubberData = data.filter(r => r.x !== null && r.y !== null);
    descriptions = descriptionMap;
}

// ════════════════════════════════════════════════════════════
//  Lookup Helpers
// ════════════════════════════════════════════════════════════

const getBrandColor = brand => BRAND_COLORS[brand] || '#999999';
const getTopsheetSymbol = topsheet => TOPSHEET_MARKERS[topsheet] || 'circle';

// ════════════════════════════════════════════════════════════
//  DOM / Filter Helpers
// ════════════════════════════════════════════════════════════

function getCheckedValues(containerId) {
    return Array.from(document.querySelectorAll(`#${containerId} input[type="checkbox"]:checked`))
        .map(cb => cb.value);
}

function getAllCheckboxValues(containerId) {
    return Array.from(document.querySelectorAll(`#${containerId} input[type="checkbox"]`))
        .map(cb => cb.value);
}

function setAllChecked(container, checked) {
    container.querySelectorAll('input[type="checkbox"]').forEach(cb => { cb.checked = checked; });
}

function getWeightBoundsFromData() {
    const weights = rubberData.map(r => r.weight).filter(Number.isFinite);
    if (!weights.length) return null;
    return {
        min: Math.min(...weights),
        max: Math.max(...weights)
    };
}

function formatWeightValue(value) {
    if (!Number.isFinite(value)) return '';
    return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function getWeightRangeInputs() {
    return {
        minInput: document.getElementById('weightMinSlider'),
        maxInput: document.getElementById('weightMaxSlider')
    };
}

function updateWeightSliderTrack() {
    const { dataMin, dataMax, selectedMin, selectedMax } = weightFilterState;
    const track = document.getElementById('weightSliderTrack');
    const minLabel = document.getElementById('weightMinLabel');
    const maxLabel = document.getElementById('weightMaxLabel');
    if (!track || !Number.isFinite(dataMin) || !Number.isFinite(dataMax)) return;
    const sliderMin = dataMin;
    const sliderMax = dataMax;
    const span = sliderMax - sliderMin;
    if (span <= 0) return;
    const leftPct = ((selectedMin - sliderMin) / span) * 100;
    const rightPct = ((sliderMax - selectedMax) / span) * 100;
    track.style.left = `${leftPct}%`;
    track.style.right = `${rightPct}%`;
    if (minLabel) minLabel.textContent = `${formatWeightValue(selectedMin)}g`;
    if (maxLabel) maxLabel.textContent = `${formatWeightValue(selectedMax)}g`;
}

function setWeightRange(minValue, maxValue) {
    const { dataMin, dataMax } = weightFilterState;
    if (!Number.isFinite(dataMin) || !Number.isFinite(dataMax)) return;

    const safeMin = Number.isFinite(minValue) ? minValue : dataMin;
    const safeMax = Number.isFinite(maxValue) ? maxValue : dataMax;
    const clampedMin = Math.max(dataMin, Math.min(dataMax, safeMin));
    const clampedMax = Math.max(dataMin, Math.min(dataMax, safeMax));
    const selectedMin = Math.min(clampedMin, clampedMax);
    const selectedMax = Math.max(clampedMin, clampedMax);

    weightFilterState.selectedMin = selectedMin;
    weightFilterState.selectedMax = selectedMax;

    const { minInput, maxInput } = getWeightRangeInputs();
    if (minInput) minInput.value = selectedMin;
    if (maxInput) maxInput.value = selectedMax;
    updateWeightSliderTrack();
}

function resetWeightRangeToDataBounds() {
    setWeightRange(weightFilterState.dataMin, weightFilterState.dataMax);
}

function syncWeightRangeFromInputs() {
    const { minInput, maxInput } = getWeightRangeInputs();
    if (!minInput || !maxInput) return false;
    const minVal = Number.parseFloat(minInput.value);
    const maxVal = Number.parseFloat(maxInput.value);
    // Prevent thumbs from crossing
    if (minVal > maxVal) {
        minInput.value = maxVal;
        maxInput.value = minVal;
    }
    setWeightRange(
        Math.min(minVal, maxVal),
        Math.max(minVal, maxVal)
    );
    return true;
}

function isWeightFilterActive() {
    const { dataMin, dataMax, selectedMin, selectedMax } = weightFilterState;
    if (![dataMin, dataMax, selectedMin, selectedMax].every(Number.isFinite)) return false;
    return selectedMin > dataMin || selectedMax < dataMax;
}

function initWeightRangeFilter(onChange) {
    const container = document.getElementById('weightFilter');
    if (!container) return;

    const bounds = getWeightBoundsFromData();
    if (!bounds) {
        container.innerHTML = '<div class="filter-instructions">No weight data available.</div>';
        return;
    }

    weightFilterState.dataMin = bounds.min;
    weightFilterState.dataMax = bounds.max;
    weightFilterState.selectedMin = bounds.min;
    weightFilterState.selectedMax = bounds.max;

    container.classList.add('weight-range-filter');
    container.innerHTML = `
        <div class="weight-range-labels">
            <span id="weightMinLabel">${formatWeightValue(bounds.min)}g</span>
            <span id="weightMaxLabel">${formatWeightValue(bounds.max)}g</span>
        </div>
        <div class="weight-slider-container">
            <div class="weight-slider-rail"></div>
            <div class="weight-slider-track" id="weightSliderTrack"></div>
            <input id="weightMinSlider" type="range" min="${bounds.min}" max="${bounds.max}" value="${bounds.min}" step="1">
            <input id="weightMaxSlider" type="range" min="${bounds.min}" max="${bounds.max}" value="${bounds.max}" step="1">
        </div>
        <div class="weight-range-hint">${formatWeightValue(bounds.min)}g — ${formatWeightValue(bounds.max)}g</div>
    `;

    updateWeightSliderTrack();

    const { minInput, maxInput } = getWeightRangeInputs();
    [minInput, maxInput].forEach(input => {
        if (!input) return;
        input.addEventListener('input', () => {
            syncWeightRangeFromInputs();
            onChange();
        });
    });

    document.getElementById('weightResetBtn')?.addEventListener('click', (e) => {
        e.stopPropagation();
        resetWeightRangeToDataBounds();
        onChange();
    });
}

// ── Hardness range filter helpers ──

function getHardnessBoundsFromData() {
    const vals = rubberData.map(r => r.normalizedHardness).filter(Number.isFinite);
    if (!vals.length) return null;
    return { min: Math.min(...vals), max: Math.max(...vals) };
}

function formatHardnessValue(value) {
    if (!Number.isFinite(value)) return '';
    return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function getHardnessRangeInputs() {
    return {
        minInput: document.getElementById('hardnessMinSlider'),
        maxInput: document.getElementById('hardnessMaxSlider')
    };
}

function updateHardnessSliderTrack() {
    const { dataMin, dataMax, selectedMin, selectedMax } = hardnessFilterState;
    const track = document.getElementById('hardnessSliderTrack');
    if (!track || !Number.isFinite(dataMin) || !Number.isFinite(dataMax)) return;
    const sliderMin = dataMin;
    const sliderMax = dataMax;
    const span = sliderMax - sliderMin;
    if (span <= 0) return;
    const leftPct = ((selectedMin - sliderMin) / span) * 100;
    const rightPct = ((sliderMax - selectedMax) / span) * 100;
    track.style.left = `${leftPct}%`;
    track.style.right = `${rightPct}%`;

    // Update all 3 scale labels (GE slider value → JP & CN equivalents)
    for (const [country, scale] of Object.entries(HARDNESS_SCALES)) {
        const key = country.slice(0, 2).toUpperCase(); // GE, JP, CN
        const minEl = document.getElementById(`hardness${key}Min`);
        const maxEl = document.getElementById(`hardness${key}Max`);
        const minVal = fromGermanScale(selectedMin, country);
        const maxVal = fromGermanScale(selectedMax, country);
        if (minEl) minEl.textContent = formatHardnessValue(minVal) + '°';
        if (maxEl) maxEl.textContent = formatHardnessValue(maxVal) + '°';
    }
}

function setHardnessRange(minValue, maxValue) {
    const { dataMin, dataMax } = hardnessFilterState;
    if (!Number.isFinite(dataMin) || !Number.isFinite(dataMax)) return;
    const safeMin = Number.isFinite(minValue) ? minValue : dataMin;
    const safeMax = Number.isFinite(maxValue) ? maxValue : dataMax;
    const clampedMin = Math.max(dataMin, Math.min(dataMax, safeMin));
    const clampedMax = Math.max(dataMin, Math.min(dataMax, safeMax));
    const selectedMin = Math.min(clampedMin, clampedMax);
    const selectedMax = Math.max(clampedMin, clampedMax);

    hardnessFilterState.selectedMin = selectedMin;
    hardnessFilterState.selectedMax = selectedMax;

    const { minInput, maxInput } = getHardnessRangeInputs();
    if (minInput) minInput.value = selectedMin;
    if (maxInput) maxInput.value = selectedMax;
    updateHardnessSliderTrack();
}

function resetHardnessRangeToDataBounds() {
    setHardnessRange(hardnessFilterState.dataMin, hardnessFilterState.dataMax);
}

function syncHardnessRangeFromInputs() {
    const { minInput, maxInput } = getHardnessRangeInputs();
    if (!minInput || !maxInput) return false;
    const minVal = Number.parseFloat(minInput.value);
    const maxVal = Number.parseFloat(maxInput.value);
    if (minVal > maxVal) {
        minInput.value = maxVal;
        maxInput.value = minVal;
    }
    setHardnessRange(Math.min(minVal, maxVal), Math.max(minVal, maxVal));
    return true;
}

function isHardnessFilterActive() {
    const { dataMin, dataMax, selectedMin, selectedMax } = hardnessFilterState;
    if (![dataMin, dataMax, selectedMin, selectedMax].every(Number.isFinite)) return false;
    return selectedMin > dataMin || selectedMax < dataMax;
}

const COUNTRY_FLAGS = { Germany: '🇩🇪', Japan: '🇯🇵', China: '🇨🇳' };

function buildHardnessScaleLabels(dataMin, dataMax) {
    const rows = [];
    for (const [country, scale] of Object.entries(HARDNESS_SCALES)) {
        const key = country.slice(0, 2).toUpperCase();
        const flag = COUNTRY_FLAGS[country] || key;
        const minVal = fromGermanScale(dataMin, country);
        const maxVal = fromGermanScale(dataMax, country);
        rows.push(
            `<div class="hardness-scale-row">` +
            `<span class="hsr-flag">${flag}</span>` +
            `<span class="hsr-val" id="hardness${key}Min">${formatHardnessValue(minVal)}°</span>` +
            `<span class="hsr-spacer"></span>` +
            `<span class="hsr-val" id="hardness${key}Max">${formatHardnessValue(maxVal)}°</span>` +
            `</div>`
        );
    }
    return rows.join('');
}

function initHardnessRangeFilter(onChange) {
    const container = document.getElementById('hardnessFilter');
    if (!container) return;

    const bounds = getHardnessBoundsFromData();
    if (!bounds) {
        container.innerHTML = '<div class="filter-instructions">No hardness data available.</div>';
        return;
    }

    hardnessFilterState.dataMin = bounds.min;
    hardnessFilterState.dataMax = bounds.max;
    hardnessFilterState.selectedMin = bounds.min;
    hardnessFilterState.selectedMax = bounds.max;

    container.classList.add('hardness-range-filter');
    container.innerHTML = `
        <div class="hardness-scale-labels">
            ${buildHardnessScaleLabels(bounds.min, bounds.max)}
        </div>
        <div class="hardness-slider-container">
            <div class="hardness-slider-rail"></div>
            <div class="hardness-slider-track" id="hardnessSliderTrack"></div>
            <input id="hardnessMinSlider" type="range" min="${bounds.min}" max="${bounds.max}" value="${bounds.min}" step="0.5">
            <input id="hardnessMaxSlider" type="range" min="${bounds.min}" max="${bounds.max}" value="${bounds.max}" step="0.5">
        </div>
        <div class="hardness-range-labels">
            <span>Soft</span>
            <span>Hard</span>
        </div>
    `;

    updateHardnessSliderTrack();

    const { minInput, maxInput } = getHardnessRangeInputs();
    [minInput, maxInput].forEach(input => {
        if (!input) return;
        input.addEventListener('input', () => {
            syncHardnessRangeFromInputs();
            onChange();
        });
    });

    document.getElementById('hardnessResetBtn')?.addEventListener('click', (e) => {
        e.stopPropagation();
        resetHardnessRangeToDataBounds();
        onChange();
    });
}

function filterOptions(container, query) {
    const q = query.trim().toLowerCase();
    container.querySelectorAll('.filter-option').forEach(option => {
        option.style.display = option.textContent.toLowerCase().includes(q) ? 'flex' : 'none';
    });
}

function buildCheckboxOptions(container, values, checkedValues) {
    container.innerHTML = '';
    const isToggleGroup = container.classList.contains('toggle-group');

    for (const item of values) {
        const value = typeof item === 'string' ? item : item.value;
        const labelText = typeof item === 'string' ? item : item.label;
        const swatchColor = item.swatchColor ?? null;
        const shapeSymbol = item.shapeSymbol ?? null;

        const label = document.createElement('label');
        label.className = 'filter-option';

        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.value = value;
        checkbox.checked = checkedValues ? checkedValues.has(value) : true;
        label.appendChild(checkbox);

        const indicator = document.createElement('span');
        indicator.className = 'custom-check';
        if (swatchColor) {
            indicator.classList.add('color-check');
            indicator.style.setProperty('--swatch-color', swatchColor);
            indicator.style.backgroundColor = swatchColor;
        }
        if (shapeSymbol) {
            indicator.classList.add('shape-check', shapeSymbol);
        }
        label.appendChild(indicator);

        const text = document.createElement('span');
        text.textContent = labelText;
        if (isToggleGroup) text.classList.add('toggle-pill');
        label.appendChild(text);

        container.appendChild(label);
    }
}

function buildNameOptionsFromBrands() {
    const nameFilter = document.getElementById('nameFilter');
    const selectedBrands = getCheckedValues('brandFilter');
    const previousSelections = new Set(getCheckedValues('nameFilter'));
    const previousNames = new Set(getAllCheckboxValues('nameFilter'));

    if (selectedBrands.length === 0) {
        nameFilter.innerHTML = '<div class="filter-instructions">Select a brand first.</div>';
        return;
    }

    const uniqueNames = [...new Set(
        rubberData
            .filter(r => selectedBrands.includes(r.brand))
            .map(r => r.fullName)
    )].sort();

    const nameOptions = uniqueNames.map(name => {
        const rubber = rubberData.find(r => r.fullName === name);
        return {
            value: name,
            label: name,
            swatchColor: rubber ? getBrandColor(rubber.brand) : null
        };
    });

    buildCheckboxOptions(
        nameFilter,
        nameOptions,
        new Set(uniqueNames.filter(name => {
            if (previousSelections.has(name)) return true;
            if (previousNames.has(name)) return false;
            return true;
        }))
    );
}

// ════════════════════════════════════════════════════════════
//  Dropdown Management
// ════════════════════════════════════════════════════════════

function closeAllDropdowns() {
    document.querySelectorAll('.filter-chip').forEach(c => c.classList.remove('active'));
    document.querySelectorAll('.filter-dropdown').forEach(d => d.classList.remove('open'));
    document.getElementById('filterBackdrop').classList.remove('visible');
    openFilterId = null;
}

function openDropdown(filterId) {
    closeAllDropdowns();
    const chip = document.getElementById(filterId + 'Chip');
    const dropdown = document.getElementById(filterId + 'Dropdown');
    if (!chip || !dropdown) return;

    chip.classList.add('active');
    dropdown.classList.add('open');
    document.getElementById('filterBackdrop').classList.add('visible');
    openFilterId = filterId;

    const search = dropdown.querySelector('.dropdown-search');
    if (search) {
        setTimeout(() => {
            try { search.focus({ preventScroll: true }); } catch { search.focus(); }
        }, 60);
    }
}

function toggleDropdown(filterId) {
    if (openFilterId === filterId) {
        closeAllDropdowns();
        return;
    }
    openDropdown(filterId);
}

// ════════════════════════════════════════════════════════════
//  Badges & Active Tags
// ════════════════════════════════════════════════════════════

function updateBadge(filterId, checkedCount, totalCount) {
    const badge = document.getElementById(filterId + 'Badge');
    if (!badge) return;
    if (checkedCount === totalCount) {
        badge.textContent = 'All';
        badge.classList.add('all-selected');
    } else {
        badge.textContent = checkedCount || '0';
        badge.classList.remove('all-selected');
    }
}

function refreshBadge(filterId) {
    if (filterId === 'weight') {
        const badge = document.getElementById('weightBadge');
        if (!badge) return;
        if (!isWeightFilterActive()) {
            badge.textContent = 'All';
            badge.classList.add('all-selected');
        } else {
            badge.textContent = `${formatWeightValue(weightFilterState.selectedMin)}-${formatWeightValue(weightFilterState.selectedMax)}g`;
            badge.classList.remove('all-selected');
        }
        return;
    }

    if (filterId === 'hardness') {
        const badge = document.getElementById('hardnessBadge');
        if (!badge) return;
        if (!isHardnessFilterActive()) {
            badge.textContent = 'All';
            badge.classList.add('all-selected');
        } else {
            badge.textContent = `${formatHardnessValue(hardnessFilterState.selectedMin)}-${formatHardnessValue(hardnessFilterState.selectedMax)}°`;
            badge.classList.remove('all-selected');
        }
        return;
    }

    const container = document.getElementById(filterId + 'Filter');
    if (!container) return;
    const all = container.querySelectorAll('input[type="checkbox"]');
    const checked = container.querySelectorAll('input[type="checkbox"]:checked');
    updateBadge(filterId, checked.length, all.length);
}

function refreshAllBadges() {
    FILTER_IDS.forEach(refreshBadge);
}

function createRemovableTag(labelContent, checkbox, colorDot) {
    const tag = document.createElement('span');
    tag.className = 'active-tag';

    if (colorDot) {
        const dot = document.createElement('span');
        dot.className = 'tag-dot';
        dot.style.backgroundColor = colorDot;
        tag.appendChild(dot);
    }

    tag.appendChild(document.createTextNode(labelContent));

    const removeBtn = document.createElement('button');
    removeBtn.className = 'tag-remove';
    removeBtn.innerHTML = '&times;';
    removeBtn.onclick = (e) => {
        e.stopPropagation();
        checkbox.checked = false;
        checkbox.dispatchEvent(new Event('change', { bubbles: true }));
    };
    tag.appendChild(removeBtn);
    return tag;
}

function createActionTag(labelContent, onRemove, colorDot) {
    const tag = document.createElement('span');
    tag.className = 'active-tag';

    if (colorDot) {
        const dot = document.createElement('span');
        dot.className = 'tag-dot';
        dot.style.backgroundColor = colorDot;
        tag.appendChild(dot);
    }

    tag.appendChild(document.createTextNode(labelContent));

    const removeBtn = document.createElement('button');
    removeBtn.className = 'tag-remove';
    removeBtn.innerHTML = '&times;';
    removeBtn.onclick = (e) => {
        e.stopPropagation();
        onRemove();
    };
    tag.appendChild(removeBtn);
    return tag;
}

function renderActiveTags() {
    const container = document.getElementById('activeTags');
    container.innerHTML = '';

    // Brand tags with color dots (only when partially selected)
    const brandFilter = document.getElementById('brandFilter');
    const brandAll = brandFilter.querySelectorAll('input[type="checkbox"]');
    const brandChecked = brandFilter.querySelectorAll('input[type="checkbox"]:checked');
    if (brandChecked.length > 0 && brandChecked.length < brandAll.length) {
        brandChecked.forEach(cb => {
            container.appendChild(createRemovableTag(cb.value, cb, getBrandColor(cb.value)));
        });
    }

    // Tags for other partially-selected checkbox filter groups
    ['topsheet'].forEach(filterId => {
        const filterEl = document.getElementById(filterId + 'Filter');
        const all = filterEl.querySelectorAll('input[type="checkbox"]');
        const checked = filterEl.querySelectorAll('input[type="checkbox"]:checked');
        if (checked.length > 0 && checked.length < all.length) {
            checked.forEach(cb => {
                container.appendChild(createRemovableTag(cb.value, cb));
            });
        }
    });

    if (isHardnessFilterActive()) {
        const label = `Hardness ${formatHardnessValue(hardnessFilterState.selectedMin)}-${formatHardnessValue(hardnessFilterState.selectedMax)}°`;
        container.appendChild(createActionTag(label, () => {
            resetHardnessRangeToDataBounds();
            refreshAllBadges();
            renderActiveTags();
            pushFiltersToUrl();
            updateChart();
        }));
    }

    if (isWeightFilterActive()) {
        const label = `Weight ${formatWeightValue(weightFilterState.selectedMin)}-${formatWeightValue(weightFilterState.selectedMax)}g`;
        container.appendChild(createActionTag(label, () => {
            resetWeightRangeToDataBounds();
            refreshAllBadges();
            renderActiveTags();
            pushFiltersToUrl();
            updateChart();
        }));
    }
}

// ════════════════════════════════════════════════════════════
//  URL State Sync
// ════════════════════════════════════════════════════════════

// Serialize partial checkbox selection to a URL param (skips when all or none selected)
function serializeFilterParam(params, paramName, containerId) {
    const all = getAllCheckboxValues(containerId);
    const checked = getCheckedValues(containerId);
    if (checked.length > 0 && checked.length < all.length) {
        params.set(paramName, checked.join(','));
    }
}

// Restore checkbox state from a URL param
function deserializeFilterParam(params, paramName, containerId) {
    if (!params.has(paramName)) return;
    const values = params.get(paramName).split(',').filter(Boolean);
    document.querySelectorAll(`#${containerId} input[type="checkbox"]`).forEach(cb => {
        cb.checked = values.includes(cb.value);
    });
}

function serializeHardnessRangeParam(params) {
    if (!isHardnessFilterActive()) return;
    params.set('hardness', `${formatHardnessValue(hardnessFilterState.selectedMin)}-${formatHardnessValue(hardnessFilterState.selectedMax)}`);
}

function deserializeHardnessRangeParam(params) {
    if (!params.has('hardness')) return;
    const range = params.get('hardness').trim();
    const [minRaw, maxRaw] = range.split('-');
    const min = Number.parseFloat(minRaw);
    const max = Number.parseFloat(maxRaw);
    if (!Number.isFinite(min) || !Number.isFinite(max)) return;
    setHardnessRange(min, max);
}

function serializeWeightRangeParam(params) {
    if (!isWeightFilterActive()) return;
    params.set('weight', `${formatWeightValue(weightFilterState.selectedMin)}-${formatWeightValue(weightFilterState.selectedMax)}`);
}

function deserializeWeightRangeParam(params) {
    if (!params.has('weight')) return;
    const range = params.get('weight').trim();
    const [minRaw, maxRaw] = range.split('-');
    const min = Number.parseFloat(minRaw);
    const max = Number.parseFloat(maxRaw);
    if (!Number.isFinite(min) || !Number.isFinite(max)) return;
    setWeightRange(min, max);
}

function pushFiltersToUrl() {
    const params = new URLSearchParams();
    if (DEBUG_MODE) params.set('debug', '');

    serializeFilterParam(params, 'brands', 'brandFilter');
    serializeFilterParam(params, 'rubbers', 'nameFilter');
    serializeFilterParam(params, 'topsheet', 'topsheetFilter');
    serializeHardnessRangeParam(params);
    serializeWeightRangeParam(params);

    if (selectedCountry !== 'us') params.set('country', selectedCountry);
    if (selectedRubbers[0]) params.set('left', selectedRubbers[0].fullName);
    if (selectedRubbers[1]) params.set('right', selectedRubbers[1].fullName);

    const qs = params.toString();
    history.replaceState(null, '', window.location.pathname + (qs ? '?' + qs : ''));
}

function applyFiltersFromUrl() {
    const params = new URLSearchParams(window.location.search);
    const filterKeys = ['brands', 'rubbers', 'topsheet', 'hardness', 'weight', 'country'];
    if (!filterKeys.some(key => params.has(key))) return;

    // Country
    if (params.has('country')) {
        const country = params.get('country');
        if (['us', 'eu', 'kr', 'cn'].includes(country)) {
            selectedCountry = country;
            document.querySelectorAll('#countrySelector .country-btn').forEach(b => {
                b.classList.toggle('active', b.dataset.country === country);
            });
        }
    }

    // Brands (must rebuild name options afterward)
    if (params.has('brands')) {
        deserializeFilterParam(params, 'brands', 'brandFilter');
        buildNameOptionsFromBrands();
    }

    deserializeFilterParam(params, 'rubbers', 'nameFilter');
    deserializeFilterParam(params, 'topsheet', 'topsheetFilter');
    deserializeHardnessRangeParam(params);
    deserializeWeightRangeParam(params);

    // Restore selected rubber detail panels
    if (params.has('left')) {
        const leftRubber = rubberData.find(r => r.fullName === params.get('left'));
        if (leftRubber) {
            selectedRubbers[0] = leftRubber;
            updateDetailPanel(1, leftRubber);
        }
    }
    if (params.has('right')) {
        const rightRubber = rubberData.find(r => r.fullName === params.get('right'));
        if (rightRubber) {
            selectedRubbers[1] = rightRubber;
            updateDetailPanel(2, rightRubber);
            nextDetailPanel = 1;
        }
    }
    if (params.has('left') && !params.has('right')) {
        nextDetailPanel = 2;
    }

    updateComparisonBar();
    refreshAllBadges();
    renderActiveTags();
}

// ════════════════════════════════════════════════════════════
//  Chart: Axis & Bounds Utilities
// ════════════════════════════════════════════════════════════

function getCurrentAxisRanges() {
    const chart = document.getElementById('chart');
    const { xaxis, yaxis } = chart?.layout ?? {};
    if (!Array.isArray(xaxis?.range) || !Array.isArray(yaxis?.range)) return null;
    return { xaxis: [...xaxis.range], yaxis: [...yaxis.range] };
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
    const selectedBrands = getCheckedValues('brandFilter');
    const selectedNames = getCheckedValues('nameFilter');
    const selectedTopsheet = getCheckedValues('topsheetFilter');

    if (!selectedBrands.length || !selectedNames.length ||
        !selectedTopsheet.length) {
        return [];
    }

    const filterByWeight = isWeightFilterActive();
    const minWeight = weightFilterState.selectedMin;
    const maxWeight = weightFilterState.selectedMax;

    const filterByHardness = isHardnessFilterActive();
    const minHardness = hardnessFilterState.selectedMin;
    const maxHardness = hardnessFilterState.selectedMax;

    return rubberData.filter(rubber =>
        selectedBrands.includes(rubber.brand) &&
        selectedNames.includes(rubber.fullName) &&
        selectedTopsheet.includes(rubber.topsheet) &&
        (!filterByHardness || (Number.isFinite(rubber.normalizedHardness) && rubber.normalizedHardness >= minHardness && rubber.normalizedHardness <= maxHardness)) &&
        (!filterByWeight || (Number.isFinite(rubber.weight) && rubber.weight >= minWeight && rubber.weight <= maxWeight))
    );
}

// Thin overlapping labels by priority (lower priority number = higher importance)
function computeVisibleRubbers(filteredData) {
    if (filteredData.length === 0) return [];

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

    for (const rubber of sorted) {
        const { px, py } = toPixel(rubber.x, rubber.y);
        const overlaps = occupied.some(
            occ => Math.abs(px - occ.px) < MIN_DIST_X && Math.abs(py - occ.py) < MIN_DIST_Y
        );
        if (!overlaps) {
            visible.push(rubber);
            occupied.push({ px, py });
        }
    }

    return visible;
}

// ════════════════════════════════════════════════════════════
//  Chart: Rendering
// ════════════════════════════════════════════════════════════

const CHART_FONT = '-apple-system, BlinkMacSystemFont, Segoe UI, Roboto, sans-serif';
const HOVER_POPUP_ID = 'chartHoverPopup';
const IS_TOUCH_DEVICE =
    window.matchMedia('(hover: none)').matches ||
    window.matchMedia('(pointer: coarse)').matches ||
    navigator.maxTouchPoints > 0;
let activeTappedRubberKey = null;

function getChartHoverPopupEl() {
    let popup = document.getElementById(HOVER_POPUP_ID);
    if (popup) return popup;
    popup = document.createElement('div');
    popup.id = HOVER_POPUP_ID;
    popup.className = 'chart-hover-popup';
    document.body.appendChild(popup);
    return popup;
}

function escapeHtml(value) {
    return String(value ?? '')
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#39;');
}

function getHardnessCategoryLabel(normalizedHardness) {
    if (!Number.isFinite(normalizedHardness)) return null;
    // Boundaries are midpoints between GE anchors: 40 (soft), 47.5 (medium), 55 (hard).
    if (normalizedHardness < 46) return 'Soft';
    if (normalizedHardness < 51) return 'Medium';
    return 'Hard';
}

function formatHardnessPopupLabel(rubber) {
    return rubber?.hardnessLabel || 'N/A';
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

function hideChartHoverPopup() {
    activeTappedRubberKey = null;
    const popup = document.getElementById(HOVER_POPUP_ID);
    if (popup) popup.classList.remove('visible');
}

function getRubberPopupKey(rubber) {
    if (!rubber) return null;
    return `${rubber.brand || ''}::${rubber.fullName || rubber.name || ''}`;
}

function showChartHoverPopupFromPlotlyData(data, chartEl) {
    const point = data?.points?.[0];
    const rubber = point?.data?.customdata?.[point.pointIndex];
    if (!point || !rubber) return null;
    const popup = getChartHoverPopupEl();
    popup.innerHTML = buildHoverPopupHtml(rubber, point);
    positionHoverPopup(popup, data, chartEl);
    return rubber;
}

function buildHoverPopupHtml(rubber, point) {
    const rubberName = rubber.name || rubber.fullName || '-';
    const brandName = rubber.brand || '-';
    const topsheet = rubber.topsheet || '-';
    const hardness = formatHardnessPopupLabel(rubber);
    const hardnessToneClass = getHardnessToneClass(rubber?.normalizedHardness);
    const weight = rubber.weightLabel || '-';
    const weightToneClass = getWeightToneClass(rubber?.weight);
    const spin = typeof rubber.spinRank === 'number' ? `#${rubber.spinRank}` : '-';
    const speed = typeof rubber.speedRank === 'number' ? `#${rubber.speedRank}` : '-';
    const control = typeof rubber.controlRank === 'number' ? `#${rubber.controlRank}` : '-';
    const brandColor = getBrandColor(brandName);
    const bestsellerTag = rubber.bestseller
        ? '<span class="chart-hover-pill chart-hover-pill-bestseller">Bestseller</span>'
        : '';

    return `
        <div class="chart-hover-card">
            <div class="chart-hover-head">
                <span class="chart-hover-brand-dot" style="background:${brandColor};"></span>
                <div class="chart-hover-title-wrap">
                    <div class="chart-hover-title">${escapeHtml(rubberName)}</div>
                    <div class="chart-hover-subtitle">${escapeHtml(brandName)}</div>
                </div>
                ${bestsellerTag}
            </div>
            <div class="chart-hover-metrics">
                <div class="chart-hover-metric"><span>Spin Rank</span><strong>${spin}</strong></div>
                <div class="chart-hover-metric"><span>Speed Rank</span><strong>${speed}</strong></div>
                <div class="chart-hover-metric"><span>Control Rank</span><strong>${control}</strong></div>
                <div class="chart-hover-metric"><span>Weight</span><strong class="${weightToneClass}">${escapeHtml(weight)}</strong></div>
                <div class="chart-hover-metric"><span>Topsheet</span><strong>${escapeHtml(topsheet)}</strong></div>
                <div class="chart-hover-metric"><span>Hardness</span><strong class="${hardnessToneClass}">${escapeHtml(hardness)}</strong></div>
            </div>
        </div>
    `;
}

function updateChart(options = {}) {
    hideChartHoverPopup();
    const filteredData = getFilteredData();

    // Skip update when filtered data hasn't changed — avoids flicker during range slider drag.
    // preserveRanges calls (from user pan/zoom) and force calls always proceed.
    if (!options.preserveRanges && !options.force && currentFilteredData.length > 0
        && filteredData.length === currentFilteredData.length
        && filteredData.every((r, i) => r === currentFilteredData[i])) {
        return;
    }

    currentFilteredData = filteredData;
    const visibleData = computeVisibleRubbers(filteredData);

    // 3 discrete marker sizes based on control ranking
    // Rank 1 (most controllable) → biggest, last rank → smallest
    const MARKER_BIG = 15;
    const MARKER_MED = 13;
    const MARKER_SMALL = 11;

    function getMarkerSize(rubber) {
        const rank = rubber.controlRank;
        const total = rubber.controlTotal;
        if (typeof rank !== 'number' || typeof total !== 'number') return MARKER_MED;
        const third = total / 3;
        if (rank <= third) return MARKER_BIG;
        if (rank <= third * 2) return MARKER_MED;
        return MARKER_SMALL;
    }

    // Group by brand × topsheet for trace creation
    const groups = {};
    for (const rubber of visibleData) {
        const key = `${rubber.brand}-${rubber.topsheet}`;
        (groups[key] ??= { brand: rubber.brand, topsheet: rubber.topsheet, rubbers: [] })
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
            type: 'scatter',
            name: 'Bestseller',
            showlegend: false,
            hoverinfo: 'skip',
            marker: {
                size: bestsellers.map(r => getMarkerSize(r) + 12),
                color: 'rgba(212,193,106,0.18)',
                symbol: 'circle',
                line: { width: 2, color: 'rgba(212,193,106,0.5)' }
            }
        });
    }

    for (const group of Object.values(groups)) {
        traces.push({
            x: group.rubbers.map(r => r.x),
            y: group.rubbers.map(r => r.y),
            mode: 'markers+text',
            type: 'scatter',
            name: `${group.brand} (${group.topsheet})`,
            marker: {
                size: group.rubbers.map(getMarkerSize),
                color: getBrandColor(group.brand),
                symbol: getTopsheetSymbol(group.topsheet),
                line: { width: 1, color: '#2b2926' }
            },
            text: group.rubbers.map(r => r.abbr),
            textposition: 'top center',
            textfont: { size: 11, color: '#e8e0d0', family: CHART_FONT },
            hoverinfo: 'none',
            customdata: group.rubbers
        });
    }
    
    // Determine axis ranges: autoscale or preserve current view
    let currentRanges = hasPlotted ? getCurrentAxisRanges() : null;
    if (!options.preserveRanges && shouldAutoscaleForFilteredData(filteredData, currentRanges)) {
        currentRanges = null;
    }

    const axisBase = {
        zeroline: false,
        gridcolor: '#3e3a34',
        tickfont: { color: '#9b9484' },
        linecolor: '#3e3a34',
        showticklabels: false,
        tickformat: '.1f'
    };

    const layout = {
        title: '',
        dragmode: 'pan',
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
        plot_bgcolor: '#2b2926',
        paper_bgcolor: '#2b2926',
        margin: { l: 10, r: 10, t: 10, b: 10 },
        annotations: [
            {
                x: 0.995, y: 0.01, xref: 'paper', yref: 'paper',
                text: '🔄 Spin →', showarrow: false,
                xanchor: 'right', yanchor: 'bottom',
                font: { color: '#d4c16a', size: 13, family: CHART_FONT }
            },
            {
                x: 0.005, y: 1.00, xref: 'paper', yref: 'paper',
                text: '⚡ Speed ↑', showarrow: false,
                xanchor: 'left', yanchor: 'top',
                font: { color: '#d4c16a', size: 13, family: CHART_FONT }
            }
        ],
        showlegend: false,
        legend: {
            x: 1, y: 1, xanchor: 'right',
            bgcolor: 'rgba(43,41,38,0.9)', bordercolor: '#3e3a34', borderwidth: 1,
            font: { color: '#e8e0d0' }
        },
        hoverlabel: {
            bgcolor: '#3e3a34', bordercolor: '#9b9484',
            font: { color: '#e8e0d0', family: '-apple-system, BlinkMacSystemFont, sans-serif' }
        }
    };

    const config = { responsive: true, displayModeBar: false, displaylogo: false, scrollZoom: false };
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
            handleRubberClick(rubber);

            // Mobile has no true hover; tapping a point should open the popup.
            if (IS_TOUCH_DEVICE) {
                const nextKey = getRubberPopupKey(rubber);
                if (activeTappedRubberKey && activeTappedRubberKey === nextKey) {
                    hideChartHoverPopup();
                    return;
                }
                const shownRubber = showChartHoverPopupFromPlotlyData(data, chartEl);
                activeTappedRubberKey = getRubberPopupKey(shownRubber);
            }
        });
    }

    if (!chartEl._hasHoverHandler) {
        chartEl._hasHoverHandler = true;
        chartEl.on('plotly_hover', data => {
            if (IS_TOUCH_DEVICE) return;
            showChartHoverPopupFromPlotlyData(data, chartEl);
        });
        chartEl.on('plotly_unhover', hideChartHoverPopup);
    }

    if (!chartEl._hasTapDismissHandler) {
        chartEl._hasTapDismissHandler = true;
        document.addEventListener('pointerdown', (event) => {
            if (!IS_TOUCH_DEVICE) return;
            if (chartEl.contains(event.target)) return;
            hideChartHoverPopup();
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
            clearTimeout(relayoutTimer);
            relayoutTimer = setTimeout(() => {
                updateChart({ preserveRanges: true });
            }, 120);
        });
    }
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
    const newXSpan = xSpan * scale;
    const newYSpan = ySpan * scale;

    let newXRange = [xCenter - anchorFx * newXSpan, xCenter + (1 - anchorFx) * newXSpan];
    let newYRange = [yCenter - anchorFy * newYSpan, yCenter + (1 - anchorFy) * newYSpan];

    if (scale > 1 && autoscaleBounds) {
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

function zoomChart(scale) {
    const chartEl = document.getElementById('chart');
    if (!chartEl?._fullLayout) return;
    const { xaxis: xa, yaxis: ya } = chartEl._fullLayout;
    if (!xa || !ya || !Array.isArray(xa.range) || !Array.isArray(ya.range)) return;

    const ranges = computeZoomedRanges({
        xRange: [xa.range[0], xa.range[1]],
        yRange: [ya.range[0], ya.range[1]],
        scale,
        anchorFx: 0.5,
        anchorFy: 0.5
    });
    if (ranges) applyZoomLayout(chartEl, ranges);
}

function triggerAutoscale() {
    const chartEl = document.getElementById('chart');
    if (chartEl && hasPlotted) {
        Plotly.relayout(chartEl, { 'xaxis.autorange': true, 'yaxis.autorange': true });
    }
}

// ════════════════════════════════════════════════════════════
//  Detail Panels & Comparison
// ════════════════════════════════════════════════════════════

function extractYouTubeVideoId(url) {
    if (!url) return null;
    const match = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([\w-]+)/);
    return match ? match[1] : null;
}

function buildUrlLinksHtml(rubber) {
    if (!rubber?.urls) return '';
    const countryUrls = rubber.urls[selectedCountry] || {};
    const parts = [];

    if (countryUrls.youtube) {
        const videoId = extractYouTubeVideoId(countryUrls.youtube);
        if (videoId) {
            parts.push(`<a href="#" onclick="event.preventDefault(); toggleYouTubeEmbed(this, '${videoId}');">▶ YouTube Review</a>`);
        } else {
            parts.push(`<a href="${countryUrls.youtube}" target="_blank" rel="noopener">▶ YouTube Review</a>`);
        }
    }
    if (countryUrls.product) {
        parts.push(`<a href="${countryUrls.product}" target="_blank" rel="noopener">🛒 Buy Product</a>`);
    }
    if (parts.length === 0) return '';
    return '<hr><div class="rubber-links">' + parts.join('&nbsp;&nbsp;·&nbsp;&nbsp;') + '</div>';
}

async function fetchRubberDetailMarkdown(brand, abbr) {
    const lang = COUNTRY_TO_LANG[selectedCountry] || 'en';
    const cacheKey = `${brand}/${lang}/${abbr}`;
    if (cacheKey in rubberDetailsCache) return rubberDetailsCache[cacheKey];
    try {
        const resp = await fetch(
            `rubbers_details/${encodeURIComponent(brand)}/${encodeURIComponent(lang)}/${encodeURIComponent(abbr)}`
        );
        if (!resp.ok) { rubberDetailsCache[cacheKey] = null; return null; }
        const text = await resp.text();
        rubberDetailsCache[cacheKey] = text;
        return text;
    } catch {
        rubberDetailsCache[cacheKey] = null;
        return null;
    }
}

async function updateDetailPanel(panelNum, rubber) {
    const panel = document.getElementById(`detail${panelNum}`);
    const detailMarkdown = await fetchRubberDetailMarkdown(rubber.brand, rubber.abbr);
    const markdown = detailMarkdown || descriptions[rubber.name] || `# ${rubber.name}\n\nNo description available.`;
    const html = marked.parse(markdown);
    const bestsellerBadge = rubber.bestseller ? ' <span class="bestseller-badge">★ Bestseller</span>' : '';
    const brandColor = getBrandColor(rubber.brand);
    panel.innerHTML =
        `<h1 class="rubber-title" style="color:${brandColor}">${rubber.brand} ${rubber.name}${bestsellerBadge}</h1>` +
        html + buildUrlLinksHtml(rubber);
}

function resetDetailPanels() {
    const panel1 = document.getElementById('detail1');
    const panel2 = document.getElementById('detail2');
    if (panel1) panel1.innerHTML = '<h3>Select a rubber</h3><div class="content">Click on any rubber to see details</div>';
    if (panel2) panel2.innerHTML = '<h3>Select another rubber</h3><div class="content">Click on another rubber to compare</div>';
}

function handleRubberClick(rubber) {
    const panelNum = nextDetailPanel;
    nextDetailPanel = panelNum === 1 ? 2 : 1;
    selectedRubbers[panelNum - 1] = rubber;
    updateDetailPanel(panelNum, rubber);
    updateComparisonBar();
    pushFiltersToUrl();
}

function updateComparisonBar() {
    const bar = document.getElementById('comparisonBar');
    const [left, right] = selectedRubbers;
    if (left && right) {
        bar.textContent = `${left.name} vs ${right.name}`;
        bar.style.display = 'block';
    } else {
        bar.style.display = 'none';
    }
}

// ════════════════════════════════════════════════════════════
//  YouTube Embed
// ════════════════════════════════════════════════════════════

function toggleYouTubeEmbed(link, videoId) {
    const container = link.closest('.rubber-links');
    let embedWrapper = container.querySelector('.youtube-embed-wrapper');

    if (embedWrapper) {
        const pid = embedWrapper.dataset.playerId;
        if (pid && ytPlayers[pid]) {
            try { ytPlayers[pid].destroy(); } catch {}
            delete ytPlayers[pid];
        }
        embedWrapper.remove();
        link.textContent = '▶ YouTube Review';
        return;
    }

    embedWrapper = document.createElement('div');
    embedWrapper.className = 'youtube-embed-wrapper';
    embedWrapper.style.cssText = 'margin-top:10px;position:relative;padding-bottom:56.25%;height:0;overflow:hidden;border-radius:8px;';

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
    container.appendChild(embedWrapper);

    if (ytApiReady && typeof YT !== 'undefined' && YT.Player) {
        // IFrame API — user tap allows autoplay with sound in most browsers.
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
        // Fallback: plain iframe starts unmuted.
        playerDiv.outerHTML =
            `<iframe src="https://www.youtube.com/embed/${videoId}?autoplay=1&mute=0&playsinline=1&rel=0" ` +
            `style="position:absolute;top:0;left:0;width:100%;height:100%;border:none;border-radius:8px;" ` +
            `allow="autoplay; encrypted-media; fullscreen" allowfullscreen></iframe>`;
    }

    link.textContent = '⏹ Close Video';
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

// ════════════════════════════════════════════════════════════
//  Trackpad & Mobile Pinch-to-Zoom
// ════════════════════════════════════════════════════════════

// Returns fractional position (0–1) within the Plotly plot area
function getPlotFraction(chartEl, clientX, clientY) {
    const { _size: plotArea } = chartEl._fullLayout;
    const rect = chartEl.getBoundingClientRect();
    return {
        fx: Math.max(0, Math.min(1, (clientX - rect.left - plotArea.l) / plotArea.w)),
        fy: Math.max(0, Math.min(1, 1 - (clientY - rect.top - plotArea.t) / plotArea.h))
    };
}

// Trackpad pinch-to-zoom (blocks regular scroll zoom)
(function initTrackpadZoom() {
    const chartEl = document.getElementById('chart');

    chartEl.addEventListener('wheel', (e) => {
        if (!e.ctrlKey) return; // ctrlKey is true for trackpad pinch gestures
        e.preventDefault();
        if (!chartEl._fullLayout) return;

        const { xaxis: xa, yaxis: ya } = chartEl._fullLayout;
        const { fx, fy } = getPlotFraction(chartEl, e.clientX, e.clientY);
        const scale = 1 + e.deltaY * 0.01;

        const ranges = computeZoomedRanges({
            xRange: [xa.range[0], xa.range[1]],
            yRange: [ya.range[0], ya.range[1]],
            scale,
            anchorFx: fx,
            anchorFy: fy
        });
        if (ranges) applyZoomLayout(chartEl, ranges);
    }, { passive: false });
})();

// Mobile pinch-to-zoom — smooth CSS-transform during gesture, single Plotly relayout on release.
// Prevents page-level zoom / swipe and accidental navigation after gesture ends.
(function initMobilePinchZoom() {
    const chartEl = document.getElementById('chart');
    let pinchStartDist = null;
    let pinchStartRanges = null;
    let pinchStartCenter = null;  // screen-space center at pinch start
    let dataAnchor = null;        // data-space point under initial pinch center
    let rafId = null;
    let pendingLayout = null;

    const getTouchDist = (t1, t2) => {
        const dx = t1.clientX - t2.clientX;
        const dy = t1.clientY - t2.clientY;
        return Math.sqrt(dx * dx + dy * dy);
    };

    const getTouchCenter = (t1, t2) => ({
        x: (t1.clientX + t2.clientX) / 2,
        y: (t1.clientY + t2.clientY) / 2
    });

    function flushLayout() {
        rafId = null;
        if (!pendingLayout) return;
        Plotly.relayout(chartEl, pendingLayout);
        pendingLayout = null;
    }

    function scheduleLayout(layout) {
        pendingLayout = layout;
        if (!rafId) rafId = requestAnimationFrame(flushLayout);
    }

    chartEl.addEventListener('touchstart', (e) => {
        if (e.touches.length !== 2) return;
        hideChartHoverPopup();
        e.preventDefault();
        const [t1, t2] = e.touches;
        pinchStartDist = getTouchDist(t1, t2);
        pinchStartCenter = getTouchCenter(t1, t2);

        if (!chartEl._fullLayout) return;
        const { xaxis: xa, yaxis: ya } = chartEl._fullLayout;
        const xRange = [xa.range[0], xa.range[1]];
        const yRange = [ya.range[0], ya.range[1]];
        pinchStartRanges = {
            x: xRange, y: yRange,
            xSpan: xRange[1] - xRange[0],
            ySpan: yRange[1] - yRange[0]
        };

        // Convert initial pinch center to data-space anchor
        const frac = getPlotFraction(chartEl, pinchStartCenter.x, pinchStartCenter.y);
        dataAnchor = {
            x: xRange[0] + frac.fx * pinchStartRanges.xSpan,
            y: yRange[0] + frac.fy * pinchStartRanges.ySpan,
            fx: frac.fx,
            fy: frac.fy
        };
    }, { passive: false });

    chartEl.addEventListener('touchmove', (e) => {
        if (e.touches.length !== 2 || !pinchStartDist || !pinchStartRanges || !dataAnchor) return;
        e.preventDefault();
        const [t1, t2] = e.touches;

        const currentDist = getTouchDist(t1, t2);
        const currentCenter = getTouchCenter(t1, t2);
        
        // Calculate scale: distance ratio (inverse because closer fingers = zoom in)
        const scale = pinchStartDist / currentDist;
        const newXSpan = pinchStartRanges.xSpan * scale;
        const newYSpan = pinchStartRanges.ySpan * scale;

        const autoscaleBounds = getAutoscaleBounds(currentFilteredData);
        if (scale > 1 && autoscaleBounds &&
            viewCoversDataBounds(currentFilteredData, pinchStartRanges.x, pinchStartRanges.y)) {
            return;
        }

        // Calculate pan offset: how much the center moved in screen space
        const centerDx = currentCenter.x - pinchStartCenter.x;
        const centerDy = currentCenter.y - pinchStartCenter.y;
        
        // Convert screen-space pan to data-space offset
        const { _size: plotArea } = chartEl._fullLayout;
        const dataDx = -(centerDx / plotArea.w) * newXSpan;
        const dataDy = (centerDy / plotArea.h) * newYSpan;

        // New range centered on anchor point, adjusted for both zoom and pan
        let newXRange = [
            dataAnchor.x - dataAnchor.fx * newXSpan + dataDx,
            dataAnchor.x + (1 - dataAnchor.fx) * newXSpan + dataDx
        ];
        let newYRange = [
            dataAnchor.y - dataAnchor.fy * newYSpan + dataDy,
            dataAnchor.y + (1 - dataAnchor.fy) * newYSpan + dataDy
        ];

        if (scale > 1 && autoscaleBounds) {
            newXRange = clampRangeToBounds(newXRange, autoscaleBounds.x);
            newYRange = clampRangeToBounds(newYRange, autoscaleBounds.y);
        }

        scheduleLayout({
            'xaxis.range': newXRange,
            'yaxis.range': newYRange,
            'xaxis.autorange': false,
            'yaxis.autorange': false
        });
    }, { passive: false });

    chartEl.addEventListener('touchend', (e) => {
        if (e.touches.length >= 2) return;
        // Flush any pending update so the final state is accurate
        if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
        if (pendingLayout) { Plotly.relayout(chartEl, pendingLayout); pendingLayout = null; }
        pinchStartDist = null;
        pinchStartRanges = null;
        pinchStartCenter = null;
        dataAnchor = null;
    });
})();

// ════════════════════════════════════════════════════════════
//  Reset
// ════════════════════════════════════════════════════════════

function resetFiltersToAll() {
    ['brandFilter', 'topsheetFilter'].forEach(id => {
        const el = document.getElementById(id);
        if (el) setAllChecked(el, true);
    });
    resetHardnessRangeToDataBounds();
    resetWeightRangeToDataBounds();
    const nameFilter = document.getElementById('nameFilter');
    if (nameFilter) {
        nameFilter.innerHTML = '';
        buildNameOptionsFromBrands();
    }
}

function resetYouTubePlayers() {
    Object.keys(ytPlayers).forEach(pid => {
        try { ytPlayers[pid].destroy(); } catch {}
    });
    ytPlayers = {};
    document.querySelectorAll('.youtube-embed-wrapper').forEach(w => w.remove());
}

function resetAppToInitialState() {
    closeAllDropdowns();
    resetYouTubePlayers();
    selectedRubbers = [null, null];
    nextDetailPanel = 1;

    selectedCountry = 'us';
    document.querySelectorAll('#countrySelector .country-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.country === 'us');
    });

    resetFiltersToAll();
    resetDetailPanels();
    updateComparisonBar();
    renderActiveTags();
    refreshAllBadges();
    pushFiltersToUrl();

    const chartEl = document.getElementById('chart');
    if (chartEl && hasPlotted) {
        Plotly.relayout(chartEl, { 'xaxis.autorange': true, 'yaxis.autorange': true });
        updateChart({ preserveRanges: true });
    } else {
        updateChart();
    }
}

// ════════════════════════════════════════════════════════════
//  Initialization
// ════════════════════════════════════════════════════════════

function initFilters() {
    const brands = [...new Set(rubberData.map(r => r.brand))].sort();

    buildCheckboxOptions(
        document.getElementById('brandFilter'),
        brands.map(b => ({ value: b, label: b, swatchColor: getBrandColor(b) }))
    );
    buildCheckboxOptions(
        document.getElementById('topsheetFilter'),
        ['Classic', 'Chinese', 'Hybrid'].map(t => ({ value: t, label: t, shapeSymbol: getTopsheetSymbol(t) }))
    );

    function onFilterChange(filterId) {
        if (filterId === 'brand') buildNameOptionsFromBrands();
        refreshAllBadges();
        renderActiveTags();
        pushFiltersToUrl();
        updateChart();
    }

    initHardnessRangeFilter(() => onFilterChange('hardness'));
    initWeightRangeFilter(() => onFilterChange('weight'));
    buildNameOptionsFromBrands();

    // Filter change listeners (checkbox-based filters only)
    FILTER_IDS.filter(id => id !== 'weight' && id !== 'hardness').forEach(id => {
        document.getElementById(id + 'Filter').addEventListener('change', () => onFilterChange(id));
    });

    // Search inputs
    document.getElementById('brandSearch').addEventListener('input', e =>
        filterOptions(document.getElementById('brandFilter'), e.target.value)
    );
    document.getElementById('nameSearch').addEventListener('input', e =>
        filterOptions(document.getElementById('nameFilter'), e.target.value)
    );

    // All/None buttons inside dropdown headers
    document.querySelectorAll('.dd-actions button').forEach(button => {
        button.addEventListener('click', (e) => {
            e.stopPropagation();
            const filterId = button.dataset.filter;
            const filterEl = document.getElementById(`${filterId}Filter`);
            if (!filterId || !filterEl) return;
            setAllChecked(filterEl, button.dataset.action === 'all');
            onFilterChange(filterId);
        });
    });

    // Dropdown close buttons
    document.querySelectorAll('.dropdown-close').forEach(btn => {
        btn.addEventListener('click', (e) => { e.stopPropagation(); closeAllDropdowns(); });
    });

    // Chip click → toggle dropdown
    document.querySelectorAll('.filter-chip').forEach(chip => {
        chip.addEventListener('click', (e) => {
            if (e.target.closest('.filter-dropdown')) return;
            toggleDropdown(chip.dataset.filter);
        });
    });

    // Close on backdrop click or Escape key
    document.getElementById('filterBackdrop').addEventListener('click', closeAllDropdowns);
    document.addEventListener('keydown', e => { if (e.key === 'Escape') closeAllDropdowns(); });

    // Prevent dropdown search clicks from closing
    document.querySelectorAll('.dropdown-search').forEach(input => {
        input.addEventListener('click', e => e.stopPropagation());
    });

    // Zoom controls
    document.getElementById('autoscaleBtn').addEventListener('click', () => {
        triggerAutoscale();
    });
    document.getElementById('zoomInBtn').addEventListener('click', () => zoomChart(0.85));
    document.getElementById('zoomOutBtn').addEventListener('click', () => zoomChart(1.15));

    // Clear all filters → reset to all selected
    document.getElementById('clearAllFilters').addEventListener('click', () => {
        ['brandFilter', 'topsheetFilter'].forEach(id =>
            setAllChecked(document.getElementById(id), true)
        );
        resetHardnessRangeToDataBounds();
        resetWeightRangeToDataBounds();
        buildNameOptionsFromBrands();
        refreshAllBadges();
        renderActiveTags();
        pushFiltersToUrl();
        updateChart();
    });

    refreshAllBadges();
    renderActiveTags();
}

function initCountrySelector() {
    document.getElementById('countrySelector').addEventListener('click', (e) => {
        const btn = e.target.closest('.country-btn');
        if (!btn || btn.dataset.country === selectedCountry) return;
        selectedCountry = btn.dataset.country;
        document.querySelectorAll('#countrySelector .country-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        pushFiltersToUrl();
        if (selectedRubbers[0]) updateDetailPanel(1, selectedRubbers[0]);
        if (selectedRubbers[1]) updateDetailPanel(2, selectedRubbers[1]);
    });
}

function initHomeLogo() {
    const logo = document.getElementById('homeLogo');
    if (!logo) return;
    logo.addEventListener('click', resetAppToInitialState);
    logo.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            resetAppToInitialState();
        }
    });
}

function initFeedbackModal() {
    const openBtn = document.getElementById('feedbackOpenBtn');
    const closeBtn = document.getElementById('feedbackCloseBtn');
    const modal = document.getElementById('feedbackModal');
    const form = modal ? modal.querySelector('.feedback-form') : null;
    const title = document.getElementById('feedbackTitle');
    const intro = modal ? modal.querySelector('.feedback-intro') : null;
    const confirmation = document.getElementById('feedbackConfirmation');
    const confirmationMessage = document.getElementById('feedbackConfirmationMessage');
    const emailInput = document.getElementById('feedbackEmail');
    if (!openBtn || !closeBtn || !modal || !form) return;

    let closeTimer = null;

    function clearCloseTimer() {
        if (closeTimer) {
            clearTimeout(closeTimer);
            closeTimer = null;
        }
    }

    function setFeedbackStatus(message, color) {
        if (intro) {
            intro.textContent = message;
            intro.style.color = color || '#b8b3a7';
        }
    }

    function setSubmittingState(isSubmitting) {
        const submitBtn = form.querySelector('button[type="submit"]');
        if (submitBtn) {
            submitBtn.disabled = isSubmitting;
            submitBtn.textContent = isSubmitting ? 'Sending...' : 'Send feedback';
        }
    }

    function showFormState() {
        if (title) title.textContent = 'Share feedback';
        if (intro) intro.hidden = false;
        form.hidden = false;
        if (confirmation) confirmation.hidden = true;
    }

    function showConfirmationState(message) {
        if (title) title.textContent = 'Feedback sent';
        if (intro) intro.hidden = true;
        form.hidden = true;
        if (confirmationMessage) confirmationMessage.textContent = message || 'Thank you for your feedback.';
        if (confirmation) confirmation.hidden = false;
    }

    function closeFeedbackModal() {
        clearCloseTimer();
        modal.classList.remove('open');
        modal.setAttribute('aria-hidden', 'true');
        document.body.style.overflow = '';
    }

    function openFeedbackModal() {
        closeAllDropdowns();
        clearCloseTimer();
        modal.classList.add('open');
        modal.setAttribute('aria-hidden', 'false');
        document.body.style.overflow = 'hidden';
        showFormState();
        setFeedbackStatus('We’ll get back to you as soon as possible.');
        setSubmittingState(false);
        setTimeout(() => {
            if (emailInput) {
                try { emailInput.focus({ preventScroll: true }); } catch { emailInput.focus(); }
            }
        }, 50);
    }

    openBtn.addEventListener('click', openFeedbackModal);
    closeBtn.addEventListener('click', closeFeedbackModal);
    modal.addEventListener('click', (e) => {
        if (e.target === modal) closeFeedbackModal();
    });
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && modal.classList.contains('open')) closeFeedbackModal();
    });

    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        setSubmittingState(true);
        setFeedbackStatus('Sending your feedback...', '#b8b3a7');

        try {
            const response = await fetch(form.action, {
                method: 'POST',
                body: new FormData(form),
                headers: { Accept: 'application/json' }
            });
            const result = await response.json().catch(() => ({}));

            if (!response.ok || result.success === false) {
                throw new Error(result.message || 'Failed to send feedback.');
            }

            showConfirmationState('We’ll get back to you as soon as possible.');
            form.reset();
            closeTimer = setTimeout(() => {
                closeFeedbackModal();
            }, 3000);
        } catch (error) {
            console.error('Feedback submission failed:', error);
            showFormState();
            setFeedbackStatus('Could not send feedback. Please try again.', '#cf5555');
        } finally {
            setSubmittingState(false);
        }
    });
}

window.addEventListener('resize', () => {
    Plotly.Plots.resize('chart');
    if (hasPlotted) updateChart({ preserveRanges: true });
});

// ════════════════════════════════════════════════════════════
//  Back-to-top FAB (helps mobile users scroll past inner panels)
// ════════════════════════════════════════════════════════════

(function initScrollFabs() {
    const upBtn = document.getElementById('backToTop');
    const downBtn = document.getElementById('backToBottom');
    if (!upBtn || !downBtn) return;
    let ticking = false;

    function updateFabVisibility() {
        const doc = document.documentElement;
        const scrollTop = window.scrollY;
        const viewportBottom = scrollTop + window.innerHeight;
        const maxScroll = doc.scrollHeight;
        const nearBottom = viewportBottom >= maxScroll - 120;

        upBtn.classList.toggle('visible', scrollTop > 300);
        downBtn.classList.toggle('visible', !nearBottom);
    }

    window.addEventListener('scroll', () => {
        if (!ticking) {
            ticking = true;
            requestAnimationFrame(() => {
                updateFabVisibility();
                ticking = false;
            });
        }
    }, { passive: true });

    upBtn.addEventListener('click', () => {
        window.scrollTo({ top: 0, behavior: 'smooth' });
    });

    downBtn.addEventListener('click', () => {
        window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'smooth' });
    });

    updateFabVisibility();
})();

async function initializeApp() {
    const chart = document.getElementById('chart');
    if (chart) chart.innerHTML = '<div style="padding: 20px; color: #9b9484;">Loading rubber data…</div>';

    try {
        await loadRubberData();
    } catch (error) {
        console.error('Failed to load rubber data:', error);
    }

    if (rubberData.length === 0) {
        const isFileProtocol = window.location.protocol === 'file:';
        const msg = isFileProtocol
            ? 'Could not load rubber data from JSON files.<br><br>' +
              'Opening this page via <code>file://</code> blocks file loading in most browsers.<br>' +
              'Start a local server instead:<br>' +
              '<pre style="margin-top:8px;background:#1c1a17;padding:8px;border-radius:4px;color:#e8e0d0;">cd ' +
              window.location.pathname.replace(/\/[^/]*$/, '') +
              '\npython3 -m http.server</pre>' +
              'Then open <a href="http://localhost:8000">http://localhost:8000</a>'
            : 'Failed to load rubber data. Check the browser console for details.';
        if (chart) chart.innerHTML = `<div style="padding: 20px; color: #cf5555; line-height: 1.6;">${msg}</div>`;
        return;
    }

    if (chart) chart.innerHTML = '';
    initCountrySelector();
    initHomeLogo();
    initFeedbackModal();
    initFilters();
    applyFiltersFromUrl();
    initChart();
    // Trigger the same behavior as clicking the Fit button on first load.
    requestAnimationFrame(() => {
        document.getElementById('autoscaleBtn')?.click();
    });
}

initializeApp();
