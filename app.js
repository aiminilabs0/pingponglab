// ════════════════════════════════════════════════════════════
//  Constants & Configuration
// ════════════════════════════════════════════════════════════

function debounce(fn, ms) {
    let timer;
    return (...args) => {
        clearTimeout(timer);
        timer = setTimeout(() => fn(...args), ms);
    };
}

const RUBBER_INDEX_FILE = 'stats/rubbers/index.json';
const RANKING_FILES = {
    spin: 'stats/rubbers/ranking/spin.json',
    speed: 'stats/rubbers/ranking/speed.json',
    control: 'stats/rubbers/ranking/control.json'
};
const PRIORITY_FILE = 'stats/rubbers/ranking/priority.json';
const BESTSELLER_FILE = 'stats/rubbers/ranking/bestseller.json';

const BRAND_COLORS = {
    Butterfly: '#f11b85',
    DHS: '#43d1d9',
    Andro: '#4bad33',
    JOOLA: '#d4da03',
    Xiom: '#FF7F00',
    Tibhar: '#e3000b',
    Nittaku: '#3E49AA',
    Donic: '#5E7DCC',
    Yasaka: '#7e67ff'
};

const SHEET_MARKERS = {
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
const FILTER_IDS = ['brand', 'name', 'sheet', 'hardness', 'weight', 'control'];
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
let filterPanelOpen = false;
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
let controlFilterState = {
    rankMin: null,
    rankMax: null,
    selectedTiers: new Set(['Easy', 'Med', 'Hard'])
};

// YouTube embed state
let ytApiReady = false;
let ytPlayers = {};
let ytPlayerIdCounter = 0;
window.onYouTubeIframeAPIReady = () => { ytApiReady = true; };

const rubberDescriptionsCache = {};
const rubberComparisonCache = {};
let comparisonRenderToken = 0;

// Tab system state
let activeTab = null;          // 'desc1' | 'desc2' | 'comparison' | null
let tabContents = { desc1: null, desc2: null, comparison: null };
let tabScrollPositions = { desc1: 0, desc2: 0, comparison: 0 };

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

function normalizeSheet(value) {
    if (typeof value === 'string') {
        const lower = value.trim().toLowerCase();
        if (lower === 'classic') return 'Classic';
        if (lower === 'chinese') return 'Chinese';
        if (lower === 'hybrid') return 'Hybrid';
    }
    return 'Classic';
}

function formatPlayerLabel(raw) {
    const uniquePlayers = new Set();

    const collectPlayer = (value) => {
        if (typeof value !== 'string') return;
        const trimmed = value.trim();
        if (trimmed) uniquePlayers.add(trimmed);
    };

    const collectPlayersFromValue = (value) => {
        if (!value) return;
        if (typeof value === 'string') {
            collectPlayer(value);
            return;
        }
        if (Array.isArray(value)) {
            value.forEach(collectPlayersFromValue);
            return;
        }
        if (typeof value === 'object') {
            Object.values(value).forEach(collectPlayersFromValue);
        }
    };

    collectPlayersFromValue(raw.player);
    collectPlayersFromValue(raw.players);

    if (uniquePlayers.size === 0) return 'N/A';
    const names = Array.from(uniquePlayers);
    if (names.length <= 2) return names.join(', ');
    return `${names.slice(0, 2).join(', ')} +${names.length - 2}`;
}

function formatThicknessLabel(value) {
    if (Array.isArray(value)) {
        const entries = value
            .map(item => (item == null ? '' : String(item).trim()))
            .filter(Boolean);
        return entries.length ? entries.join(', ') : 'N/A';
    }
    if (value == null) return 'N/A';
    const normalized = String(value).trim();
    return normalized || 'N/A';
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
        details.sheet ? `**Sheet:** ${details.sheet}` : null,
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
        const releaseYear = parseRatingNumber(details.release_year);
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
            releaseYearLabel: Number.isFinite(releaseYear) ? String(Math.round(releaseYear)) : 'N/A',
            thicknessLabel: formatThicknessLabel(details.thickness),
            playerLabel: formatPlayerLabel(raw),
            control: parseRatingNumber(ratings.control),
            sheet: normalizeSheet(details.sheet),
            priority: 999, // will be overridden by priority ranking
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

    // ── Override priority with priority ranking ──
    const priorityResp = await fetch(PRIORITY_FILE);
    const priorityRanking = priorityResp.ok ? await priorityResp.json() : [];
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

        // Display order: bestseller first, then priority ranking.
        const popIdx = findRubberRank(rubber, priorityRanking);
        const bestsellerIdx = findRubberRank(rubber, bestsellerRanking);
        rubber.bestseller = bestsellerIdx >= 0;

        if (rubber.bestseller) {
            rubber.priority = bestsellerIdx + 1;
        } else if (popIdx >= 0) {
            rubber.priority = bestsellerRanking.length + popIdx + 1;
        }
    }

    // Only show rubbers that appear in both spin and speed rankings
    rubberData = data.filter(r => r.x !== null && r.y !== null);
    descriptions = descriptionMap;
}

// ════════════════════════════════════════════════════════════
//  Lookup Helpers
// ════════════════════════════════════════════════════════════

const getBrandColor = brand => BRAND_COLORS[brand] || '#999999';
const getSheetSymbol = sheet => SHEET_MARKERS[sheet] || 'circle';

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
    container.querySelectorAll('input[type="checkbox"]').forEach(cb => {
        cb.checked = checked;
        const pill = cb.closest('.fp-pill');
        if (pill) pill.classList.toggle('active', checked);
    });
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

function getWeightTone(weight) {
    if (!Number.isFinite(weight)) return '';
    if (weight <= 48) return 'green';
    if (weight <= 51) return 'yellow';
    return 'red';
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
    if (minLabel) {
        minLabel.textContent = `${formatWeightValue(selectedMin)}g`;
        minLabel.dataset.tone = getWeightTone(selectedMin);
    }
    if (maxLabel) {
        maxLabel.textContent = `${formatWeightValue(selectedMax)}g`;
        maxLabel.dataset.tone = getWeightTone(selectedMax);
    }
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
    // Clamp without mutating .value (avoids spurious input events on mobile)
    setWeightRange(Math.min(minVal, maxVal), Math.max(minVal, maxVal));
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
    `;

    updateWeightSliderTrack();

    const debouncedChange = debounce(onChange, 40);
    const { minInput, maxInput } = getWeightRangeInputs();
    [minInput, maxInput].forEach(input => {
        if (!input) return;
        input.addEventListener('input', () => {
            syncWeightRangeFromInputs();
            debouncedChange();
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
        if (minEl) {
            minEl.textContent = formatHardnessValue(minVal) + '°';
            minEl.dataset.tone = getHardnessCategoryLabel(selectedMin) || '';
        }
        if (maxEl) {
            maxEl.textContent = formatHardnessValue(maxVal) + '°';
            maxEl.dataset.tone = getHardnessCategoryLabel(selectedMax) || '';
        }
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
    `;

    updateHardnessSliderTrack();

    const debouncedChange = debounce(onChange, 40);
    const { minInput, maxInput } = getHardnessRangeInputs();
    [minInput, maxInput].forEach(input => {
        if (!input) return;
        input.addEventListener('input', () => {
            syncHardnessRangeFromInputs();
            debouncedChange();
        });
    });

    document.getElementById('hardnessResetBtn')?.addEventListener('click', (e) => {
        e.stopPropagation();
        resetHardnessRangeToDataBounds();
        onChange();
    });
}

// ════════════════════════════════════════════════════════════
//  Control Toggle Filter (3 tiers: Easy / Med / Hard)
// ════════════════════════════════════════════════════════════

const CONTROL_LEVEL_COUNT = 5;
const CONTROL_TIERS = ['Easy', 'Med', 'Hard'];

function getControlBoundsFromData() {
    const ranks = rubberData
        .map(r => r.controlRank)
        .filter(rank => Number.isFinite(rank));

    if (ranks.length === 0) return null;

    return {
        min: Math.min(...ranks),
        max: Math.max(...ranks)
    };
}

function getControlTierFromRank(rank) {
    const { rankMin, rankMax } = controlFilterState;
    if (![rank, rankMin, rankMax].every(Number.isFinite)) return null;

    const totalRanks = rankMax - rankMin + 1;
    if (totalRanks <= 0) return null;

    const zeroBasedRank = Math.max(0, Math.min(totalRanks - 1, rank - rankMin));
    const pct = zeroBasedRank / totalRanks;

    // Easy = top 40% of control ranks, Med = middle 20%, Hard = bottom 40%
    if (pct < 0.4) return 'Easy';
    if (pct < 0.8) return 'Med';
    return 'Hard';
}

// Keep the old 5-level function for the hover popup indicator
function getControlLevelFromRank(rank) {
    const { rankMin, rankMax } = controlFilterState;
    if (![rank, rankMin, rankMax].every(Number.isFinite)) return null;

    const totalRanks = rankMax - rankMin + 1;
    if (totalRanks <= 0) return null;

    const zeroBasedRank = Math.max(0, Math.min(totalRanks - 1, rank - rankMin));
    const bucketBestFirst = Math.min(
        CONTROL_LEVEL_COUNT - 1,
        Math.floor((zeroBasedRank * CONTROL_LEVEL_COUNT) / totalRanks)
    );

    return bucketBestFirst + 1;
}

function resetControlToAllTiers() {
    controlFilterState.selectedTiers = new Set(['Easy', 'Med', 'Hard']);
    syncControlPillUI();
}

function syncControlPillUI() {
    document.querySelectorAll('#controlFilter .fp-pill').forEach(pill => {
        const tier = pill.dataset.tier;
        const cb = pill.querySelector('input[type="checkbox"]');
        const isActive = controlFilterState.selectedTiers.has(tier);
        if (cb) cb.checked = isActive;
        pill.classList.toggle('active', isActive);
    });
}

function isControlFilterActive() {
    return controlFilterState.selectedTiers.size < 3;
}

function initControlToggleFilter(onChange) {
    const container = document.getElementById('controlFilter');
    if (!container) return;

    const bounds = getControlBoundsFromData();
    if (!bounds) {
        container.innerHTML = '<div class="filter-instructions">No control ranking data available.</div>';
        return;
    }

    controlFilterState.rankMin = bounds.min;
    controlFilterState.rankMax = bounds.max;
    controlFilterState.selectedTiers = new Set(['Easy', 'Med', 'Hard']);

    container.innerHTML = '';
    const group = document.createElement('div');
    group.className = 'fp-pill-group';

    CONTROL_TIERS.forEach(tier => {
        const pill = document.createElement('label');
        pill.className = `fp-pill ${tier.toLowerCase()} active`;
        pill.dataset.tier = tier;

        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.checked = true;
        cb.value = tier;
        pill.appendChild(cb);

        const dot = document.createElement('span');
        dot.className = 'fp-pill-dot';
        pill.appendChild(dot);

        pill.appendChild(document.createTextNode(tier));
        group.appendChild(pill);

        cb.addEventListener('change', () => {
            if (cb.checked) {
                controlFilterState.selectedTiers.add(tier);
            } else {
                controlFilterState.selectedTiers.delete(tier);
            }
            pill.classList.toggle('active', cb.checked);
            onChange();
        });
    });

    container.appendChild(group);
}

const SHEET_DOT_CLASS = { Classic: 'dot-circle', Chinese: 'dot-square', Hybrid: 'dot-diamond' };

function initSheetToggleFilter(onChange) {
    const container = document.getElementById('sheetFilter');
    if (!container) return;

    container.innerHTML = '';
    const group = document.createElement('div');
    group.className = 'fp-pill-group';

    ['Classic', 'Chinese', 'Hybrid'].forEach(sheet => {
        const pill = document.createElement('label');
        pill.className = 'fp-pill active';

        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.checked = true;
        cb.value = sheet;
        pill.appendChild(cb);

        const dot = document.createElement('span');
        dot.className = `fp-pill-dot ${SHEET_DOT_CLASS[sheet] || 'dot-circle'}`;
        pill.appendChild(dot);

        pill.appendChild(document.createTextNode(sheet));
        group.appendChild(pill);

        cb.addEventListener('change', () => {
            pill.classList.toggle('active', cb.checked);
            onChange();
        });
    });

    container.appendChild(group);
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

function buildNameOptionsFromFilters() {
    const nameFilter = document.getElementById('nameFilter');
    const selectedBrands = getCheckedValues('brandFilter');
    const selectedSheet = getCheckedValues('sheetFilter');
    const previousSelections = new Set(getCheckedValues('nameFilter'));
    const previousNames = new Set(getAllCheckboxValues('nameFilter'));

    if (selectedBrands.length === 0) {
        nameFilter.innerHTML = '<div class="filter-instructions">Select a brand first.</div>';
        return;
    }

    const filterByWeight = isWeightFilterActive();
    const minWeight = weightFilterState.selectedMin;
    const maxWeight = weightFilterState.selectedMax;

    const filterByHardness = isHardnessFilterActive();
    const minHardness = hardnessFilterState.selectedMin;
    const maxHardness = hardnessFilterState.selectedMax;

    const filterByControl = isControlFilterActive();
    const selectedTiers = controlFilterState.selectedTiers;

    const filtered = rubberData.filter(rubber =>
        selectedBrands.includes(rubber.brand) &&
        (selectedSheet.length === 0 || selectedSheet.includes(rubber.sheet)) &&
        (!filterByHardness || (Number.isFinite(rubber.normalizedHardness) && rubber.normalizedHardness >= minHardness && rubber.normalizedHardness <= maxHardness)) &&
        (!filterByWeight || (Number.isFinite(rubber.weight) && rubber.weight >= minWeight && rubber.weight <= maxWeight)) &&
        (!filterByControl || (() => {
            const tier = getControlTierFromRank(rubber.controlRank);
            return tier !== null && selectedTiers.has(tier);
        })())
    );

    const uniqueNames = [...new Set(filtered.map(r => r.fullName))].sort();

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
//  Filter Panel Management
// ════════════════════════════════════════════════════════════

function toggleFilterPanel() {
    filterPanelOpen = !filterPanelOpen;
    const panel = document.getElementById('filterPanel');
    const trigger = document.getElementById('filterTrigger');
    if (!panel || !trigger) return;

    if (filterPanelOpen) {
        panel.removeAttribute('hidden');
        // Force reflow so the transition from max-height:0 works
        void panel.offsetHeight;
        panel.classList.add('open');
        trigger.setAttribute('aria-expanded', 'true');
    } else {
        panel.classList.remove('open');
        trigger.setAttribute('aria-expanded', 'false');
        panel.addEventListener('transitionend', function onEnd() {
            panel.removeEventListener('transitionend', onEnd);
            if (!filterPanelOpen) panel.setAttribute('hidden', '');
        });
    }
}

function closeFilterPanel() {
    if (!filterPanelOpen) return;
    toggleFilterPanel();
}

function updateFilterSummary() {
    const summary = document.getElementById('filterSummary');
    if (!summary) return;

    let count = 0;
    // Check checkbox-based filters for partial selection
    ['brandFilter', 'sheetFilter'].forEach(id => {
        const el = document.getElementById(id);
        if (!el) return;
        const all = el.querySelectorAll('input[type="checkbox"]');
        const checked = el.querySelectorAll('input[type="checkbox"]:checked');
        if (checked.length > 0 && checked.length < all.length) count++;
    });
    if (isWeightFilterActive()) count++;
    if (isHardnessFilterActive()) count++;
    if (isControlFilterActive()) count++;

    summary.textContent = count > 0 ? `(${count} active)` : '';
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
        const pill = cb.closest('.fp-pill');
        if (pill) pill.classList.toggle('active', cb.checked);
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

function serializeControlRangeParam(params) {
    if (!isControlFilterActive()) return;
    params.set('control', [...controlFilterState.selectedTiers].join(','));
}

function deserializeControlRangeParam(params) {
    if (!params.has('control')) return;
    const tiers = params.get('control').split(',').filter(t => CONTROL_TIERS.includes(t));
    if (tiers.length === 0) return;
    controlFilterState.selectedTiers = new Set(tiers);
    syncControlPillUI();
}

function pushFiltersToUrl() {
    const params = new URLSearchParams();
    if (DEBUG_MODE) params.set('debug', '');

    serializeFilterParam(params, 'brands', 'brandFilter');
    serializeFilterParam(params, 'rubbers', 'nameFilter');
    serializeFilterParam(params, 'sheet', 'sheetFilter');
    serializeHardnessRangeParam(params);
    serializeWeightRangeParam(params);
    serializeControlRangeParam(params);

    if (selectedCountry !== 'us') params.set('country', selectedCountry);
    if (selectedRubbers[0]) params.set('left', selectedRubbers[0].fullName);
    if (selectedRubbers[1]) params.set('right', selectedRubbers[1].fullName);

    const qs = params.toString();
    history.replaceState(null, '', window.location.pathname + (qs ? '?' + qs : ''));
}

function applyFiltersFromUrl() {
    const params = new URLSearchParams(window.location.search);
    const filterKeys = ['brands', 'rubbers', 'sheet', 'hardness', 'weight', 'control', 'country', 'left', 'right'];
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

    // Deserialize all filters that affect rubber options first
    if (params.has('brands')) deserializeFilterParam(params, 'brands', 'brandFilter');
    deserializeFilterParam(params, 'sheet', 'sheetFilter');
    deserializeHardnessRangeParam(params);
    deserializeWeightRangeParam(params);
    deserializeControlRangeParam(params);

    // Rebuild rubber options from all filters, then restore rubber selections
    buildNameOptionsFromFilters();
    deserializeFilterParam(params, 'rubbers', 'nameFilter');

    // Restore selected rubber detail panels
    let lastRestoredTab = null;
    if (params.has('left')) {
        const leftRubber = rubberData.find(r => r.fullName === params.get('left'));
        if (leftRubber) {
            selectedRubbers[0] = leftRubber;
            updateDetailPanel(1, leftRubber);
            lastRestoredTab = 'desc1';
        }
    }
    if (params.has('right')) {
        const rightRubber = rubberData.find(r => r.fullName === params.get('right'));
        if (rightRubber) {
            selectedRubbers[1] = rightRubber;
            updateDetailPanel(2, rightRubber);
            nextDetailPanel = 1;
            lastRestoredTab = 'desc2';
        }
    }
    if (params.has('left') && !params.has('right')) {
        nextDetailPanel = 2;
    }

    updateRadarChart();
    updateComparisonBar();
    renderTabs();
    if (lastRestoredTab) setActiveTab(lastRestoredTab);
    updateFilterSummary();
}

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
    const selectedSheet = getCheckedValues('sheetFilter');

    if (!selectedBrands.length || !selectedNames.length ||
        !selectedSheet.length) {
        return [];
    }

    const filterByWeight = isWeightFilterActive();
    const minWeight = weightFilterState.selectedMin;
    const maxWeight = weightFilterState.selectedMax;

    const filterByHardness = isHardnessFilterActive();
    const minHardness = hardnessFilterState.selectedMin;
    const maxHardness = hardnessFilterState.selectedMax;

    const filterByControl = isControlFilterActive();
    const selectedTiers = controlFilterState.selectedTiers;

    return rubberData.filter(rubber =>
        selectedBrands.includes(rubber.brand) &&
        selectedNames.includes(rubber.fullName) &&
        selectedSheet.includes(rubber.sheet) &&
        (!filterByHardness || (Number.isFinite(rubber.normalizedHardness) && rubber.normalizedHardness >= minHardness && rubber.normalizedHardness <= maxHardness)) &&
        (!filterByWeight || (Number.isFinite(rubber.weight) && rubber.weight >= minWeight && rubber.weight <= maxWeight)) &&
        (!filterByControl || (() => {
            const tier = getControlTierFromRank(rubber.controlRank);
            return tier !== null && selectedTiers.has(tier);
        })())
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

function buildControlLevelIndicatorHtml(rank) {
    const controlLevel = getControlLevelFromRank(rank);
    if (!Number.isFinite(controlLevel)) return '-';

    const clampedLevel = Math.max(1, Math.min(CONTROL_LEVEL_COUNT, Math.round(controlLevel)));
    const filledBoxes = CONTROL_LEVEL_COUNT - clampedLevel + 1;
    const boxHtml = Array.from({ length: CONTROL_LEVEL_COUNT }, (_, index) => (
        `<span class="chart-control-box${index >= CONTROL_LEVEL_COUNT - filledBoxes ? ' is-filled' : ''}" aria-hidden="true"></span>`
    )).join('');

    return `
        <span class="chart-control-boxes control-level-${clampedLevel}" aria-label="Control level L${clampedLevel}: ${filledBoxes} out of ${CONTROL_LEVEL_COUNT} boxes">${boxHtml}</span>
    `.trim();
}

function buildHoverPopupHtml(rubber, point) {
    const rubberName = rubber.name || rubber.fullName || '-';
    const brandName = rubber.brand || '-';
    const sheet = rubber.sheet || '-';
    const hardness = formatHardnessPopupLabel(rubber);
    const hardnessToneClass = getHardnessToneClass(rubber?.normalizedHardness);
    const weight = rubber.weightLabel || '-';
    const weightToneClass = getWeightToneClass(rubber?.weight);
    const spin = typeof rubber.spinRank === 'number' ? `#${rubber.spinRank}` : '-';
    const speed = typeof rubber.speedRank === 'number' ? `#${rubber.speedRank}` : '-';
    const control = buildControlLevelIndicatorHtml(rubber?.controlRank);
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
                <div class="chart-hover-metric"><span>Control</span><strong class="chart-control-indicator">${control}</strong></div>
                <div class="chart-hover-metric"><span>Weight</span><strong class="${weightToneClass}">${escapeHtml(weight)}</strong></div>
                <div class="chart-hover-metric"><span>Sheet</span><strong>${escapeHtml(sheet)}</strong></div>
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

    // 7 discrete marker sizes based on control ranking
    // Rank 1 (most controllable) → biggest (20), last rank → smallest (8)
    const MARKER_SIZES = [20, 18, 16, 14, 12, 10, 8];

    function getMarkerSize(rubber) {
        const rank = rubber.controlRank;
        const total = rubber.controlTotal;
        if (typeof rank !== 'number' || typeof total !== 'number') return 14; // default medium
        
        const seventh = total / 7;
        for (let i = 0; i < 7; i++) {
            if (rank <= seventh * (i + 1)) {
                return MARKER_SIZES[i]; // Lower rank (better control) gets bigger marker
            }
        }
        return MARKER_SIZES[6]; // fallback to smallest
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
            type: 'scattergl',
            name: `${group.brand} (${group.sheet})`,
            marker: {
                size: group.rubbers.map(getMarkerSize),
                color: getBrandColor(group.brand),
                symbol: getSheetSymbol(group.sheet),
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
    const inViewCount = (() => {
        if (!currentRanges?.xaxis || !currentRanges?.yaxis) return filteredData.length;
        const [x0, x1] = currentRanges.xaxis;
        const [y0, y1] = currentRanges.yaxis;
        const minX = Math.min(x0, x1);
        const maxX = Math.max(x0, x1);
        const minY = Math.min(y0, y1);
        const maxY = Math.max(y0, y1);
        return filteredData.filter(r =>
            r.x >= minX && r.x <= maxX &&
            r.y >= minY && r.y <= maxY
        ).length;
    })();

    const headerTagline = document.querySelector('.header-tagline');
    if (headerTagline) {
        headerTagline.textContent = `Showing ${inViewCount} Rubbers`;
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
        margin: { l: 10, r: 10, t: 30, b: 30 },
        annotations: [
            {
                x: 0.995, y: -0.04, xref: 'paper', yref: 'paper',
                text: '🔄 Spin →', showarrow: false,
                xanchor: 'right', yanchor: 'bottom',
                font: { color: '#d4c16a', size: 13, family: CHART_FONT }
            },
            {
                x: 0.005, y: 1.04, xref: 'paper', yref: 'paper',
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
                e.stopPropagation();

                // Block relayout-triggered updateChart calls while pinching.
                // Clear ALL pending timers so a previous pinch's delayed callbacks
                // cannot fire and trigger an unwanted autoscale reset.
                pinchActive = true;
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
        }, { passive: true });

        chartEl.addEventListener('touchmove', (e) => {
            if (e.touches.length !== 2 || pinchStartDist === null) return;
            if (!pinchStartXRange || !pinchStartYRange) return;

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
            }
        }, { passive: true });

        const onPinchEnd = (e) => {
            if (e.touches.length < 2 && pinchActive) {
                pinchActive = false;
                pinchStartDist = null;
                pinchStartXRange = null;
                pinchStartYRange = null;

                // Do NOT call updateChart / Plotly.react here after pinch ends.
                // Calling react() re-renders the chart and scattergl internally
                // recalculates autorange, which resets the zoomed view.
                // applyZoomLayout() during touchmove already set the correct axis
                // ranges directly on the chart via Plotly.relayout — those persist.
                // We just need to wait for Plotly's internal relayout events to
                // settle, then release the guard.
                clearTimeout(relayoutTimer);
                clearTimeout(internalUpdateTimer);
                internalUpdateTimer = setTimeout(() => { isInternalUpdate = false; }, 300);
                pinchFinalRanges = null;
            }
        };

        chartEl.addEventListener('touchend', onPinchEnd, { passive: true });
        chartEl.addEventListener('touchcancel', onPinchEnd, { passive: true });
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

    // Clamp scale to prevent over-zoom-in: don't let the visible span
    // drop below a meaningful minimum (e.g. 5% of the full data span).
    let clampedScale = scale;
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

const PRODUCT_ICON = {
    us: 'images/product/amazon.ico',
    eu: 'images/product/sale.ico',
    cn: 'images/product/taobao.ico',
    kr: 'images/product/coupang.ico'
};
const YOUTUBE_ICON = 'images/youtube.ico';

function buildTitleLinkIconsHtml(rubber) {
    if (!rubber?.urls) return '';
    const countryUrls = rubber.urls[selectedCountry] || {};
    const parts = [];

    if (countryUrls.youtube) {
        const videoId = extractYouTubeVideoId(countryUrls.youtube);
        if (videoId) {
            parts.push(
                `<a class="rubber-title-icon-link" href="#" data-yt-videoid="${videoId}" title="YouTube Review" aria-label="YouTube Review">` +
                `<img src="${YOUTUBE_ICON}" class="rubber-title-icon" alt="YouTube">` +
                `</a>`
            );
        } else {
            parts.push(
                `<a class="rubber-title-icon-link" href="${countryUrls.youtube}" target="_blank" rel="noopener" title="YouTube Review" aria-label="YouTube Review">` +
                `<img src="${YOUTUBE_ICON}" class="rubber-title-icon" alt="YouTube">` +
                `</a>`
            );
        }
    }
    // TODO: enable later
    if (false) { // if (countryUrls.product) {
        const icon = PRODUCT_ICON[selectedCountry] || PRODUCT_ICON.us;
        parts.push(
            `<a class="rubber-title-icon-link" href="${countryUrls.product}" target="_blank" rel="noopener" title="Buy Product" aria-label="Buy Product">` +
            `<img src="${icon}" class="rubber-title-icon" alt="Buy">` +
            `</a>`
        );
    }
    return parts.join('');
}


async function fetchRubberDescriptionMarkdown(brand, abbr) {
    const lang = COUNTRY_TO_LANG[selectedCountry] || 'en';
    const cacheKey = `${brand}/${lang}/${abbr}`;
    if (cacheKey in rubberDescriptionsCache) return rubberDescriptionsCache[cacheKey];
    try {
        const resp = await fetch(
            `rubbers_description/${encodeURIComponent(brand)}/${encodeURIComponent(lang)}/${encodeURIComponent(abbr)}`
        );
        if (!resp.ok) { rubberDescriptionsCache[cacheKey] = null; return null; }
        const text = await resp.text();
        rubberDescriptionsCache[cacheKey] = text;
        return text;
    } catch {
        rubberDescriptionsCache[cacheKey] = null;
        return null;
    }
}

function getAlphabeticalComparisonNames(leftRubber, rightRubber) {
    const leftName = (leftRubber?.name || '').trim();
    const rightName = (rightRubber?.name || '').trim();
    return [leftName, rightName].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
}

function buildComparisonTitleStyle(leftRubber, rightRubber) {
    const leftColor = getBrandColor(leftRubber?.brand);
    const rightColor = getBrandColor(rightRubber?.brand);

    if (leftColor === rightColor) {
        return `style="color:${leftColor}"`;
    }

    // Use both rubber brand colors when comparing different brands.
    return `style="color:${leftColor};background:linear-gradient(90deg,${leftColor} 0%,${rightColor} 100%);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;"`;
}

async function fetchRubberComparisonMarkdown(leftRubber, rightRubber) {
    const [nameA, nameB] = getAlphabeticalComparisonNames(leftRubber, rightRubber);
    if (!nameA || !nameB) return null;
    const lang = COUNTRY_TO_LANG[selectedCountry] || 'en';

    const cacheKey = `${lang}/${nameA}_${nameB}`;
    if (cacheKey in rubberComparisonCache) return rubberComparisonCache[cacheKey];

    try {
        const localizedPath = `rubbers_comparison/${encodeURIComponent(lang)}/${encodeURIComponent(nameA)}_${encodeURIComponent(nameB)}`;
        let resp = await fetch(localizedPath);
        if (!resp.ok) {
            // Backward compatibility for legacy files outside language directories.
            const legacyPath = `rubbers_comparison/${encodeURIComponent(nameA)}_${encodeURIComponent(nameB)}`;
            resp = await fetch(legacyPath);
        }
        if (!resp.ok) {
            rubberComparisonCache[cacheKey] = null;
            return null;
        }
        const text = await resp.text();
        rubberComparisonCache[cacheKey] = text;
        return text;
    } catch {
        rubberComparisonCache[cacheKey] = null;
        return null;
    }
}

// ── Tab system functions ──

function buildTabButtonContent(rubber) {
    const color = getBrandColor(rubber.brand);
    return `<span class="content-tab-dot" style="background:${color}"></span>${escapeHtml(rubber.name)}`;
}

function renderTabs() {
    const tabBar = document.getElementById('contentTabs');
    let html = '';
    if (selectedRubbers[0]) {
        html += `<button class="content-tab" data-tab="desc1">${buildTabButtonContent(selectedRubbers[0])}</button>`;
    }
    if (selectedRubbers[1]) {
        html += `<button class="content-tab" data-tab="desc2">${buildTabButtonContent(selectedRubbers[1])}</button>`;
    }
    if (selectedRubbers[0] && selectedRubbers[1]) {
        html += `<button class="content-tab content-tab--vs" data-tab="comparison">Comparison</button>`;
    }
    tabBar.innerHTML = html;
    highlightActiveTab();
}

function highlightActiveTab() {
    const tabBar = document.getElementById('contentTabs');
    tabBar.querySelectorAll('.content-tab').forEach(btn => {
        const isActive = btn.dataset.tab === activeTab;
        btn.classList.toggle('content-tab--active', isActive);
        if (isActive && !btn.classList.contains('content-tab--vs')) {
            // Find the rubber for this tab and use its brand color
            const idx = btn.dataset.tab === 'desc1' ? 0 : 1;
            const rubber = selectedRubbers[idx];
            const color = rubber ? getBrandColor(rubber.brand) : '';
            btn.style.borderBottomColor = color;
        } else if (isActive && btn.classList.contains('content-tab--vs')) {
            // Comparison tab active color is handled by CSS
            btn.style.borderBottomColor = '';
        } else {
            btn.style.borderBottomColor = 'transparent';
        }
    });
}

function setActiveTab(tabId) {
    const pane = document.getElementById('contentPane');
    const contentBody = document.getElementById('contentBody');

    // Save scroll position of outgoing tab
    if (activeTab && tabContents[activeTab] != null) {
        tabScrollPositions[activeTab] = contentBody.scrollTop || 0;
    }

    // Clean up YouTube embeds before swapping content
    resetYouTubePlayers();

    activeTab = tabId;

    if (tabId && tabContents[tabId] != null) {
        pane.classList.remove('content-pane--empty');
        pane.innerHTML = tabContents[tabId];
        // Restore scroll position
        requestAnimationFrame(() => {
            contentBody.scrollTop = tabScrollPositions[tabId] || 0;
        });
    } else {
        pane.classList.add('content-pane--empty');
        pane.innerHTML = '<span class="content-pane-placeholder">Select a rubber to see its description</span>';
    }

    highlightActiveTab();
}

// ── Detail panel / comparison functions ──

async function updateDetailPanel(panelNum, rubber) {
    const tabKey = `desc${panelNum}`;
    const brandColor = getBrandColor(rubber.brand);
    const titleIconsHtml = buildTitleLinkIconsHtml(rubber);
    const headerHtml =
        `<div class="rubber-title-header">` +
            `<div class="rubber-title-top">` +
                `<span class="rubber-brand-pill" style="background:${brandColor}18;border-color:${brandColor}55;color:${brandColor}">` +
                    `<span class="rubber-brand-dot" style="background:${brandColor}"></span>` +
                    `${escapeHtml(rubber.brand)}` +
                `</span>` +
                (rubber.bestseller ? `<span class="bestseller-badge">★ Bestseller</span>` : '') +
            `</div>` +
            `<div class="rubber-title-row">` +
                `<h1 class="rubber-title" style="color:${brandColor}">${escapeHtml(rubber.name)}</h1>` +
                (titleIconsHtml ? `<div class="rubber-title-icons">${titleIconsHtml}</div>` : '') +
            `</div>` +
        `</div>`;

    const detailMarkdown = await fetchRubberDescriptionMarkdown(rubber.brand, rubber.abbr);

    if (detailMarkdown) {
        const html = marked.parse(detailMarkdown);
        tabContents[tabKey] = headerHtml + `<div class="content-pane-scroll">${html}</div>`;
    } else {
        tabContents[tabKey] = headerHtml + '<div class="content-pane-scroll"><p class="comparison-status-msg">No description available.</p></div>';
    }

    // If this tab is currently active, refresh the pane
    if (activeTab === tabKey) {
        setActiveTab(tabKey);
    }
}

function resetDetailPanels() {
    tabContents = { desc1: null, desc2: null, comparison: null };
    tabScrollPositions = { desc1: 0, desc2: 0, comparison: 0 };
    activeTab = null;
    const pane = document.getElementById('contentPane');
    if (pane) {
        pane.classList.add('content-pane--empty');
        pane.innerHTML = '<span class="content-pane-placeholder">Select a rubber to see its description</span>';
    }
    renderTabs();
}

function handleRubberClick(rubber) {
    const panelNum = nextDetailPanel;
    nextDetailPanel = panelNum === 1 ? 2 : 1;
    selectedRubbers[panelNum - 1] = rubber;
    updateDetailPanel(panelNum, rubber);
    updateRadarChart();
    updateComparisonBar();
    renderTabs();
    setActiveTab(`desc${panelNum}`);
    pushFiltersToUrl();
}

function buildComparisonTitleHtml(leftRubber, rightRubber) {
    const leftColor = getBrandColor(leftRubber?.brand);
    const rightColor = getBrandColor(rightRubber?.brand);
    const leftBrand = escapeHtml(leftRubber?.brand || '');
    const leftName  = escapeHtml(leftRubber?.name  || '');
    const rightBrand = escapeHtml(rightRubber?.brand || '');
    const rightName  = escapeHtml(rightRubber?.name  || '');

    return `
        <div class="comp-title-side">
            <span class="comp-brand-pill" style="background:${leftColor}18;border-color:${leftColor}55;color:${leftColor}">
                <span class="comp-brand-dot" style="background:${leftColor}"></span>${leftBrand}
            </span>
            <span class="comp-rubber-name" style="color:${leftColor}">${leftName}</span>
        </div>
        <div class="comp-title-vs">vs</div>
        <div class="comp-title-side comp-title-side-right">
            <span class="comp-brand-pill" style="background:${rightColor}18;border-color:${rightColor}55;color:${rightColor}">
                <span class="comp-brand-dot" style="background:${rightColor}"></span>${rightBrand}
            </span>
            <span class="comp-rubber-name" style="color:${rightColor}">${rightName}</span>
        </div>
    `;
}

async function updateComparisonBar() {
    const [left, right] = selectedRubbers;
    if (left && right) {
        const renderToken = ++comparisonRenderToken;
        const compTitleHtml = buildComparisonTitleHtml(left, right);
        // Set initial comparison content (title only)
        tabContents.comparison = `<div class="comparison-title">${compTitleHtml}</div>` +
            `<div class="content-pane-scroll"><p class="comparison-status-msg">Loading comparison…</p></div>`;
        renderTabs();
        if (activeTab === 'comparison') setActiveTab('comparison');

        const markdown = await fetchRubberComparisonMarkdown(left, right);
        if (renderToken !== comparisonRenderToken) return;

        if (markdown) {
            tabContents.comparison =
                `<div class="comparison-title">${compTitleHtml}</div>` +
                `<div class="content-pane-scroll">${marked.parse(markdown)}</div>`;
        } else {
            tabContents.comparison =
                `<div class="comparison-title">${compTitleHtml}</div>` +
                `<div class="content-pane-scroll"><p class="comparison-status-msg">No comparison available.</p></div>`;
        }
        renderTabs();
        if (activeTab === 'comparison') setActiveTab('comparison');
    } else {
        comparisonRenderToken++;
        tabContents.comparison = null;
        renderTabs();
    }
}

// ════════════════════════════════════════════════════════════
//  Radar Chart
// ════════════════════════════════════════════════════════════

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
    const categories = ['Speed\n(faster)', 'Spin\n(spinnier)', 'Control\n(more control)', 'Weight\n(heavier)', 'Hardness\n(harder)'];
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
        name: `${rubber.brand} ${rubber.name}`,
        hoverinfo: 'skip',
    };
}

function buildRadarInfoHtml(rubber, { dashed = false } = {}) {
    const brandColor = getBrandColor(rubber.brand);
    const spin = typeof rubber.spinRank === 'number' ? `#${rubber.spinRank}` : '-';
    const speed = typeof rubber.speedRank === 'number' ? `#${rubber.speedRank}` : '-';
    const control = buildControlLevelIndicatorHtml(rubber.controlRank);
    const weight = rubber.weightLabel || '-';
    const weightToneClass = getWeightToneClass(rubber.weight);
    const hardness = formatHardnessPopupLabel(rubber);
    const hardnessToneClass = getHardnessToneClass(rubber.normalizedHardness);
    const releaseYear = rubber.releaseYearLabel || 'N/A';
    const thickness = rubber.thicknessLabel || 'N/A';
    const player = rubber.playerLabel || 'N/A';
    const lineStyle = dashed ? 'border-top: 2.5px dotted' : 'border-top: 2.5px solid';

    return `
        <span class="radar-info-brand-pill" style="background:${brandColor}18;border-color:${brandColor}55;color:${brandColor}">
            <span class="radar-info-brand-dot" style="background:${brandColor}"></span>${escapeHtml(rubber.brand)}
        </span>
        <div class="radar-info-name" style="color:${brandColor}">${escapeHtml(rubber.name)}</div>
        <div class="radar-info-line-key" style="${lineStyle} ${brandColor}; width: 28px;"></div>
        <div class="radar-info-metrics">
            <div class="radar-info-metric"><span>Speed</span><strong>${speed}</strong></div>
            <div class="radar-info-metric"><span>Spin</span><strong>${spin}</strong></div>
            <div class="radar-info-metric"><span>Control</span><strong class="chart-control-indicator">${control}</strong></div>
            <div class="radar-info-metric"><span>Weight</span><strong class="${weightToneClass}">${escapeHtml(weight)}</strong></div>
            <div class="radar-info-metric"><span>Hardness</span><strong class="${hardnessToneClass}">${escapeHtml(hardness)}</strong></div>
            <div class="radar-info-metric"><span>Release</span><strong>${escapeHtml(releaseYear)}</strong></div>
            <div class="radar-info-metric"><span>Thickness</span><strong>${escapeHtml(thickness)}</strong></div>
            <div class="radar-info-metric"><span>Player</span><strong>${escapeHtml(player)}</strong></div>
        </div>
    `;
}

function updateRadarChart() {
    const chartEl = document.getElementById('radarChart');
    if (!chartEl) return;
    const firstPanel = document.getElementById('radarInfoFirst');
    const secondPanel = document.getElementById('radarInfoSecond');
    const [first, second] = selectedRubbers;
    const isMobile = window.innerWidth <= 768;
    const chartHeight = 260;

    const sameBrand = first && second && getBrandColor(first.brand) === getBrandColor(second.brand);
    firstPanel.innerHTML = first ? buildRadarInfoHtml(first) : '';
    secondPanel.innerHTML = second ? buildRadarInfoHtml(second, { dashed: sameBrand }) : '';
    const radarCategories = ['Speed\n(faster)', 'Spin\n(spinnier)', 'Control\n(more control)', 'Weight\n(heavier)', 'Hardness\n(harder)'];
    const traces = [];

    if (!first && !second) {
        // Invisible trace to force Plotly to render the polar grid
        traces.push({
            type: 'scatterpolar',
            r: radarCategories.map(() => 0),
            theta: radarCategories,
            mode: 'none',
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
                tickfont: { color: '#e8e0d0', size: isMobile ? 9 : 11 },
            },
        },
        showlegend: false,
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
    };

    chartEl.style.height = `${chartHeight}px`;
    Plotly.react(chartEl, traces, layout, config);

    // Ensure Plotly re-measures in flex layout after content updates.
    requestAnimationFrame(() => {
        if (!chartEl) return;
        Plotly.Plots.resize(chartEl);
    });
}

// ════════════════════════════════════════════════════════════
//  YouTube Embed
// ════════════════════════════════════════════════════════════

function toggleYouTubeEmbed(iconLink, videoId) {
    const panel = iconLink.closest('.content-pane');
    if (!panel) return;

    // Toggle off if embed already exists in this panel
    let embedWrapper = panel.querySelector('.youtube-embed-wrapper');
    if (embedWrapper) {
        const pid = embedWrapper.dataset.playerId;
        if (pid && ytPlayers[pid]) {
            try { ytPlayers[pid].destroy(); } catch {}
            delete ytPlayers[pid];
        }
        embedWrapper.remove();
        iconLink.classList.remove('yt-active');
        return;
    }

    // Insert embed wrapper immediately after the title header
    const titleHeader = panel.querySelector('.rubber-title-header');
    embedWrapper = document.createElement('div');
    embedWrapper.className = 'youtube-embed-wrapper';
    embedWrapper.style.cssText = 'position:relative;padding-bottom:56.25%;height:0;overflow:hidden;';

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

    if (titleHeader && titleHeader.nextSibling) {
        panel.insertBefore(embedWrapper, titleHeader.nextSibling);
    } else {
        panel.appendChild(embedWrapper);
    }

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

// ════════════════════════════════════════════════════════════
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
}

function resetAppToInitialState() {
    closeFilterPanel();
    resetYouTubePlayers();
    selectedRubbers = [null, null];
    nextDetailPanel = 1;

    selectedCountry = 'us';
    document.querySelectorAll('#countrySelector .country-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.country === 'us');
    });

    resetFiltersToAll();
    resetDetailPanels();
    updateRadarChart();
    updateFilterSummary();
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

    function onFilterChange(filterId) {
        if (filterId !== 'name') buildNameOptionsFromFilters();
        updateFilterSummary();
        pushFiltersToUrl();
        updateChart();
    }

    initSheetToggleFilter(() => onFilterChange('sheet'));
    initHardnessRangeFilter(() => onFilterChange('hardness'));
    initWeightRangeFilter(() => onFilterChange('weight'));
    initControlToggleFilter(() => onFilterChange('control'));
    buildNameOptionsFromFilters();

    // Filter change listeners (checkbox-based filters only)
    FILTER_IDS.filter(id => id !== 'weight' && id !== 'hardness' && id !== 'control' && id !== 'sheet').forEach(id => {
        document.getElementById(id + 'Filter').addEventListener('change', () => onFilterChange(id));
    });

    // Search inputs
    document.getElementById('nameSearch').addEventListener('input', e =>
        filterOptions(document.getElementById('nameFilter'), e.target.value)
    );

    // All/None buttons inside filter panel sections
    document.querySelectorAll('.fp-section-actions button').forEach(button => {
        button.addEventListener('click', (e) => {
            e.stopPropagation();
            const filterId = button.dataset.filter;
            const filterEl = document.getElementById(`${filterId}Filter`);
            if (!filterId || !filterEl) return;
            setAllChecked(filterEl, button.dataset.action === 'all');
            onFilterChange(filterId);
        });
    });

    // Filter panel trigger
    document.getElementById('filterTrigger').addEventListener('click', toggleFilterPanel);

    // Rubber section toggle (mobile)
    document.getElementById('rubberSectionToggle').addEventListener('click', () => {
        const header = document.getElementById('rubberSectionToggle');
        const content = document.getElementById('rubberContent');
        header.classList.toggle('is-open');
        content.classList.toggle('is-open');
    });

    // Close panel on Escape key
    document.addEventListener('keydown', e => { if (e.key === 'Escape') closeFilterPanel(); });

    // Zoom controls
    document.getElementById('autoscaleBtn').addEventListener('click', () => {
        triggerAutoscale();
    });
    const ZOOM_IN = 0.6;
    document.getElementById('zoomInBtn').addEventListener('click', () => zoomChart(ZOOM_IN));
    document.getElementById('zoomOutBtn').addEventListener('click', () => zoomChart(1 / ZOOM_IN));

    // Clear all filters → reset to all selected
    document.getElementById('clearAllFilters').addEventListener('click', () => {
        resetFiltersToAll();
        updateFilterSummary();
        pushFiltersToUrl();
        updateChart();
    });

    updateFilterSummary();
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
        updateComparisonBar();
        renderTabs();
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
        closeFilterPanel();
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

    // Tab click listener
    document.getElementById('contentTabs').addEventListener('click', (e) => {
        const tab = e.target.closest('.content-tab');
        if (!tab || tab.classList.contains('content-tab--active')) return;
        setActiveTab(tab.dataset.tab);
    });

    applyFiltersFromUrl();
    updateRadarChart();
    initChart();
    // Trigger the same behavior as clicking the Fit button on first load.
    requestAnimationFrame(() => {
        document.getElementById('autoscaleBtn')?.click();
    });
}

initializeApp();