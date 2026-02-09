// ════════════════════════════════════════════════════════════
//  Constants & Configuration
// ════════════════════════════════════════════════════════════

const RUBBER_FILES = [
    'rubbers/Andro.json',
    'rubbers/Butterfly.json',
    'rubbers/DHS.json',
    'rubbers/Donic.json',
    'rubbers/JOOLA.json',
    'rubbers/Nittaku.json',
    'rubbers/Tibhar.json',
    'rubbers/Xiom.json',
    'rubbers/Yasaka.json'
];

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

const HARDNESS_AVERAGES = { Germany: 47.5, Japan: 36, China: 39 };
const HARDNESS_MEDIUM_RANGE = 2;

// Blended rating weights: user reviews dominate, manufacturer data supplements
const USER_WEIGHT = 0.85;
const MANUFACTURER_WEIGHT = 0.15;

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
let selectedCountry = 'us';
let openFilterId = null;

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

// Compute per-manufacturer min/max for speed & spin to normalize across different rating scales
function buildManufacturerRatingRanges(rawItems) {
    const ranges = {};
    for (const raw of rawItems) {
        const { manufacturer, manufacturer_ratings: ratings } = raw;
        if (!manufacturer || typeof ratings !== 'object') continue;

        const speed = parseRatingNumber(ratings.speed);
        const spin = parseRatingNumber(ratings.spin);
        if (!ranges[manufacturer]) {
            ranges[manufacturer] = {
                speed: { min: Infinity, max: -Infinity },
                spin: { min: Infinity, max: -Infinity }
            };
        }
        const range = ranges[manufacturer];
        if (Number.isFinite(speed)) {
            range.speed.min = Math.min(range.speed.min, speed);
            range.speed.max = Math.max(range.speed.max, speed);
        }
        if (Number.isFinite(spin)) {
            range.spin.min = Math.min(range.spin.min, spin);
            range.spin.max = Math.max(range.spin.max, spin);
        }
    }
    return ranges;
}

function normalizeManufacturerRating(value, range) {
    if (!Number.isFinite(value) || !range) return null;
    const { max } = range;
    if (!Number.isFinite(max) || max <= 0) return null;
    return (value / max) * 10;
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

function normalizeHardnessCategory(hardnessValue, country) {
    if (!Number.isFinite(hardnessValue)) return null;
    const average = HARDNESS_AVERAGES[country];
    if (!Number.isFinite(average)) return null;
    if (hardnessValue <= average - HARDNESS_MEDIUM_RANGE) return 'Soft';
    if (hardnessValue >= average + HARDNESS_MEDIUM_RANGE) return 'Hard';
    return 'Medium';
}

function normalizeWeightCategory(weightValue) {
    if (!Number.isFinite(weightValue)) return null;
    if (weightValue < 48) return 'Light';
    if (weightValue <= 50) return 'Medium';
    return 'Heavy';
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

function buildDescriptionMarkdown(raw, debugInfo) {
    const details = raw.manufacturer_details || {};
    const lines = [
        `**Brand:** ${raw.manufacturer}`,
        raw.price ? `**Price:** ${raw.price}` : null,
        details.country ? `**Country:** ${details.country}` : null,
        details.topsheet ? `**Topsheet:** ${details.topsheet}` : null,
        details.hardness !== undefined ? `**Sponge Hardness:** ${details.hardness}°` : null,
        details.weight !== undefined ? `**Weight:** ${details.weight}g` : null,
        details.thickness ? `**Thickness:** ${Array.isArray(details.thickness) ? details.thickness.join(', ') : details.thickness}` : null
    ].filter(Boolean);

    if (debugInfo) {
        const fmt = v => (Number.isFinite(v) ? v.toFixed(2) : 'n/a');
        const fmtRange = r => {
            if (!r || !Number.isFinite(r.min) || !Number.isFinite(r.max)) return 'n/a';
            return `${r.min.toFixed(2)} → ${r.max.toFixed(2)}`;
        };
        lines.push(
            '', '---', '**Debug: speed/spin calculation**',
            `User spin: ${fmt(debugInfo.userSpin)}`,
            `User speed: ${fmt(debugInfo.userSpeed)}`,
            `Manufacturer spin (raw): ${fmt(debugInfo.manufacturerSpinRaw)}`,
            `Manufacturer speed (raw): ${fmt(debugInfo.manufacturerSpeedRaw)}`,
            `Manufacturer spin range: ${fmtRange(debugInfo.manufacturerSpinRange)}`,
            `Manufacturer speed range: ${fmtRange(debugInfo.manufacturerSpeedRange)}`,
            `Manufacturer spin (normalized): ${fmt(debugInfo.manufacturerSpinNormalized)}`,
            `Manufacturer speed (normalized): ${fmt(debugInfo.manufacturerSpeedNormalized)}`,
            `Weights: user ${fmt(debugInfo.userWeight)}, manufacturer ${fmt(debugInfo.manufacturerWeight)}`,
            `Final spin: ${fmt(debugInfo.spinFinal)}`,
            `Final speed: ${fmt(debugInfo.speedFinal)}`
        );
    }
    return lines.join('\n');
}

// ════════════════════════════════════════════════════════════
//  Data Loading
// ════════════════════════════════════════════════════════════

async function loadRubberData() {
    const results = await Promise.allSettled(
        RUBBER_FILES.map(file =>
            fetch(file).then(r => {
                if (!r.ok) throw new Error(`HTTP ${r.status} for ${file}`);
                return r.json();
            })
        )
    );

    const rawItems = results.flatMap(result => {
        if (result.status === 'fulfilled' && Array.isArray(result.value)) {
            return result.value;
        }
        console.warn('Skipping rubber data file:', result.reason);
        return [];
    });

    const data = [];
    const descriptionMap = {};
    const manufacturerRanges = buildManufacturerRatingRanges(rawItems);

    for (const raw of rawItems) {
        const ratings = raw.user_ratings || {};
        const userSpin = parseRatingNumber(ratings.spin);
        const userSpeed = parseRatingNumber(ratings.speed);
        if (!Number.isFinite(userSpin) || !Number.isFinite(userSpeed)) continue;

        const mfgRatings = raw.manufacturer_ratings || {};
        const mfgRange = manufacturerRanges[raw.manufacturer] || null;
        const mfgSpinRaw = parseRatingNumber(mfgRatings.spin);
        const mfgSpeedRaw = parseRatingNumber(mfgRatings.speed);
        const mfgSpin = normalizeManufacturerRating(mfgSpinRaw, mfgRange?.spin ?? null);
        const mfgSpeed = normalizeManufacturerRating(mfgSpeedRaw, mfgRange?.speed ?? null);

        // Blend user and manufacturer ratings when manufacturer data is available
        const spin = Number.isFinite(mfgSpin)
            ? userSpin * USER_WEIGHT + mfgSpin * MANUFACTURER_WEIGHT
            : userSpin;
        const speed = Number.isFinite(mfgSpeed)
            ? userSpeed * USER_WEIGHT + mfgSpeed * MANUFACTURER_WEIGHT
            : userSpeed;

        const details = raw.manufacturer_details || {};
        const hardness = parseRatingNumber(details.hardness);
        const weightValue = parseRatingNumber(details.weight);
        const urls = raw.urls || {};

        const rubber = {
            name: raw.name,
            fullName: buildFullName(raw.manufacturer, raw.name),
            abbr: raw.abbr || raw.name,
            brand: raw.manufacturer,
            x: spin,
            y: speed,
            weight: weightValue,
            weightCategory: normalizeWeightCategory(weightValue),
            hardness: parseRatingNumber(ratings.sponge_hardness),
            hardnessCategory: normalizeHardnessCategory(hardness, details.country),
            control: parseRatingNumber(ratings.control),
            topsheet: normalizeTopsheet(details.topsheet),
            priority: Number.isFinite(raw.priority) ? raw.priority : 50,
            bestseller: raw.bestseller === true,
            urls: {
                us: { product: urls.us?.product || '', youtube: urls.us?.youtube || '' },
                eu: { product: urls.eu?.product || '', youtube: urls.eu?.youtube || '' },
                kr: { product: urls.kr?.product || '', youtube: urls.kr?.youtube || '' },
                cn: { product: urls.cn?.product || '', youtube: urls.cn?.youtube || '' }
            }
        };

        const debugInfo = DEBUG_MODE ? {
            userSpin, userSpeed,
            manufacturerSpinRaw: mfgSpinRaw,
            manufacturerSpeedRaw: mfgSpeedRaw,
            manufacturerSpinNormalized: mfgSpin,
            manufacturerSpeedNormalized: mfgSpeed,
            manufacturerSpinRange: mfgRange?.spin ?? null,
            manufacturerSpeedRange: mfgRange?.speed ?? null,
            spinFinal: spin,
            speedFinal: speed,
            userWeight: USER_WEIGHT,
            manufacturerWeight: MANUFACTURER_WEIGHT
        } : null;

        data.push(rubber);
        descriptionMap[rubber.name] = buildDescriptionMarkdown(raw, debugInfo);
    }

    rubberData = data;
    descriptions = descriptionMap;
}

// ════════════════════════════════════════════════════════════
//  Lookup Helpers
// ════════════════════════════════════════════════════════════

const getBrandColor = brand => BRAND_COLORS[brand] || '#999999';
const getTopsheetSymbol = topsheet => TOPSHEET_MARKERS[topsheet] || 'circle';

function getControlValue(rubber) {
    return typeof rubber.control === 'number' ? rubber.control : null;
}

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
    openFilterId === filterId ? closeAllDropdowns() : openDropdown(filterId);
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

    // Tags for other partially-selected filter groups
    ['topsheet', 'hardness', 'weight'].forEach(filterId => {
        const filterEl = document.getElementById(filterId + 'Filter');
        const all = filterEl.querySelectorAll('input[type="checkbox"]');
        const checked = filterEl.querySelectorAll('input[type="checkbox"]:checked');
        if (checked.length > 0 && checked.length < all.length) {
            checked.forEach(cb => {
                container.appendChild(createRemovableTag(cb.value, cb));
            });
        }
    });
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

function pushFiltersToUrl() {
    const params = new URLSearchParams();
    if (DEBUG_MODE) params.set('debug', '');

    serializeFilterParam(params, 'brands', 'brandFilter');
    serializeFilterParam(params, 'rubbers', 'nameFilter');
    serializeFilterParam(params, 'topsheet', 'topsheetFilter');
    serializeFilterParam(params, 'hardness', 'hardnessFilter');
    serializeFilterParam(params, 'weight', 'weightFilter');

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
    deserializeFilterParam(params, 'hardness', 'hardnessFilter');
    deserializeFilterParam(params, 'weight', 'weightFilter');

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
    const selectedHardness = getCheckedValues('hardnessFilter');
    const selectedWeights = getCheckedValues('weightFilter');

    if (!selectedBrands.length || !selectedNames.length ||
        !selectedTopsheet.length || !selectedHardness.length || !selectedWeights.length) {
        return [];
    }

    // Only apply weight filter when not all weights are selected
    const allWeights = getAllCheckboxValues('weightFilter');
    const filterByWeight = selectedWeights.length < allWeights.length;

    return rubberData.filter(rubber =>
        selectedBrands.includes(rubber.brand) &&
        selectedNames.includes(rubber.fullName) &&
        selectedTopsheet.includes(rubber.topsheet) &&
        selectedHardness.includes(rubber.hardnessCategory) &&
        (!filterByWeight || (rubber.weightCategory && selectedWeights.includes(rubber.weightCategory)))
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

function updateChart(options = {}) {
    const filteredData = getFilteredData();
    currentFilteredData = filteredData;
    const visibleData = computeVisibleRubbers(filteredData);

    // Scale marker size by control rating
    const controlValues = filteredData.map(getControlValue).filter(Number.isFinite);
    const minControl = controlValues.length ? Math.min(...controlValues) : null;
    const maxControl = controlValues.length ? Math.max(...controlValues) : null;
    const MIN_MARKER = 10;
    const MAX_MARKER = 15;

    function getMarkerSize(rubber) {
        const control = getControlValue(rubber);
        if (!Number.isFinite(control) || minControl === null || maxControl === null) return 12;
        if (maxControl === minControl) return (MIN_MARKER + MAX_MARKER) / 2;
        const t = (control - minControl) / (maxControl - minControl);
        return MIN_MARKER + t * (MAX_MARKER - MIN_MARKER);
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
            hovertemplate:
                `<b>%{customdata.name}</b><br>Brand: ${group.brand}<br>` +
                `Spin: %{x:.2f}<br>Speed: %{y:.2f}<br>Topsheet: ${group.topsheet}<extra></extra>`,
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

    if (hasPlotted) {
        Plotly.react('chart', traces, layout, config);
    } else {
        Plotly.newPlot('chart', traces, layout, config);
        hasPlotted = true;
    }

    // Attach Plotly event handlers once
    if (!chartEl._hasClickHandler) {
        chartEl._hasClickHandler = true;
        chartEl.on('plotly_click', data => {
            const point = data.points[0];
            handleRubberClick(point.data.customdata[point.pointIndex]);
        });
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
                isInternalUpdate = true;
                updateChart({ preserveRanges: true });
                setTimeout(() => { isInternalUpdate = false; }, 300);
            }, 120);
        });
    }
}

function initChart() {
    // Run twice: first to establish initial plot, second to let
    // shouldAutoscaleForFilteredData widen the view if needed
    updateChart();
    updateChart();
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

async function fetchRubberDetailMarkdown(brand, name) {
    const lang = COUNTRY_TO_LANG[selectedCountry] || 'en';
    const cacheKey = `${brand}/${lang}/${name}`;
    if (cacheKey in rubberDetailsCache) return rubberDetailsCache[cacheKey];
    try {
        const resp = await fetch(
            `rubbers_details/${encodeURIComponent(brand)}/${encodeURIComponent(lang)}/${encodeURIComponent(name)}`
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
    const detailMarkdown = await fetchRubberDetailMarkdown(rubber.brand, rubber.name);
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
        // IFrame API — playVideo() in onReady is allowed because this chain started from a user tap
        ytPlayers[playerId] = new YT.Player(playerId, {
            videoId,
            playerVars: { autoplay: 1, playsinline: 1, rel: 0 },
            events: { onReady: e => e.target.playVideo() }
        });
    } else {
        // Fallback: plain iframe (muted autoplay for mobile compatibility)
        playerDiv.outerHTML =
            `<iframe src="https://www.youtube.com/embed/${videoId}?autoplay=1&mute=1&playsinline=1&rel=0" ` +
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

// Mobile pinch-to-zoom (throttled with rAF for smooth performance)
(function initMobilePinchZoom() {
    const chartEl = document.getElementById('chart');
    let pinchStartDist = null;
    let pinchStartRanges = null;
    let dataAnchor = null;   // data-space point under initial pinch center
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
        e.preventDefault();
        const [t1, t2] = e.touches;
        pinchStartDist = getTouchDist(t1, t2);

        if (!chartEl._fullLayout) return;
        const { xaxis: xa, yaxis: ya } = chartEl._fullLayout;
        const xRange = [xa.range[0], xa.range[1]];
        const yRange = [ya.range[0], ya.range[1]];
        pinchStartRanges = {
            x: xRange, y: yRange,
            xSpan: xRange[1] - xRange[0],
            ySpan: yRange[1] - yRange[0]
        };

        // Convert initial pinch center to data-space anchor (this point follows the fingers)
        const center = getTouchCenter(t1, t2);
        const frac = getPlotFraction(chartEl, center.x, center.y);
        dataAnchor = {
            x: xRange[0] + frac.fx * pinchStartRanges.xSpan,
            y: yRange[0] + frac.fy * pinchStartRanges.ySpan
        };
    }, { passive: false });

    chartEl.addEventListener('touchmove', (e) => {
        if (e.touches.length !== 2 || !pinchStartDist || !pinchStartRanges || !dataAnchor) return;
        e.preventDefault();
        const [t1, t2] = e.touches;

        // scale > 1 → zooming out, scale < 1 → zooming in
        const scale = pinchStartDist / getTouchDist(t1, t2);
        const newXSpan = pinchStartRanges.xSpan * scale;
        const newYSpan = pinchStartRanges.ySpan * scale;

        const autoscaleBounds = getAutoscaleBounds(currentFilteredData);
        if (scale > 1 && autoscaleBounds &&
            viewCoversDataBounds(currentFilteredData, pinchStartRanges.x, pinchStartRanges.y)) {
            return;
        }

        // Position the view so the data-space anchor appears at the current finger position
        const liveCenter = getTouchCenter(t1, t2);
        const liveFrac = getPlotFraction(chartEl, liveCenter.x, liveCenter.y);

        let newXRange = [dataAnchor.x - liveFrac.fx * newXSpan, dataAnchor.x + (1 - liveFrac.fx) * newXSpan];
        let newYRange = [dataAnchor.y - liveFrac.fy * newYSpan, dataAnchor.y + (1 - liveFrac.fy) * newYSpan];

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
        dataAnchor = null;
    });
})();

// ════════════════════════════════════════════════════════════
//  Reset
// ════════════════════════════════════════════════════════════

function resetFiltersToAll() {
    ['brandFilter', 'topsheetFilter', 'hardnessFilter', 'weightFilter'].forEach(id => {
        const el = document.getElementById(id);
        if (el) setAllChecked(el, true);
    });
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
    const hardnessEmoji = { Soft: '🟢', Medium: '🟡', Hard: '🔴' };

    buildCheckboxOptions(
        document.getElementById('brandFilter'),
        brands.map(b => ({ value: b, label: b, swatchColor: getBrandColor(b) }))
    );
    buildCheckboxOptions(
        document.getElementById('topsheetFilter'),
        ['Classic', 'Chinese', 'Hybrid'].map(t => ({ value: t, label: t, shapeSymbol: getTopsheetSymbol(t) }))
    );
    buildCheckboxOptions(
        document.getElementById('hardnessFilter'),
        ['Soft', 'Medium', 'Hard'].map(h => ({ value: h, label: `${hardnessEmoji[h]} ${h}` }))
    );
    buildCheckboxOptions(
        document.getElementById('weightFilter'),
        ['Light', 'Medium', 'Heavy'].map(w => ({ value: w, label: w }))
    );
    buildNameOptionsFromBrands();

    function onFilterChange(filterId) {
        if (filterId === 'brand') buildNameOptionsFromBrands();
        refreshAllBadges();
        renderActiveTags();
        pushFiltersToUrl();
        updateChart();
    }

    // Filter change listeners
    FILTER_IDS.forEach(id => {
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
            setAllChecked(document.getElementById(`${button.dataset.filter}Filter`), button.dataset.action === 'all');
            onFilterChange(button.dataset.filter);
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
        const chartEl = document.getElementById('chart');
        if (chartEl && hasPlotted) {
            Plotly.relayout(chartEl, { 'xaxis.autorange': true, 'yaxis.autorange': true });
        }
    });
    document.getElementById('zoomInBtn').addEventListener('click', () => zoomChart(0.85));
    document.getElementById('zoomOutBtn').addEventListener('click', () => zoomChart(1.15));

    // Clear all filters → reset to all selected
    document.getElementById('clearAllFilters').addEventListener('click', () => {
        ['brandFilter', 'topsheetFilter', 'hardnessFilter', 'weightFilter'].forEach(id =>
            setAllChecked(document.getElementById(id), true)
        );
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
}

initializeApp();
