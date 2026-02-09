// Rubber data (loaded from /rubbers/*.json)
let rubberData = [];
let descriptions = {};

const rubberFiles = [
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

function parseRatingNumber(value) {
    if (typeof value === 'number') return value;
    if (typeof value !== 'string') return null;
    const match = value.match(/[\d.]+/);
    if (!match) return null;
    const parsed = Number.parseFloat(match[0]);
    return Number.isFinite(parsed) ? parsed : null;
}

function buildManufacturerRatingRanges(rawItems) {
    const ranges = {};
    rawItems.forEach(raw => {
        const manufacturer = raw.manufacturer;
        const ratings = raw.manufacturer_ratings || {};
        if (!manufacturer || typeof ratings !== 'object') {
            return;
        }

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
    });
    return ranges;
}

function normalizeManufacturerRating(value, range) {
    if (!Number.isFinite(value) || !range) {
        return null;
    }
    const max = range.max;
    if (!Number.isFinite(max) || max <= 0) {
        return null;
    }
    return (value / max) * 10;
}

function normalizeTopsheet(value) {
    if (typeof value === 'string') {
        const trimmed = value.trim();
        const lower = trimmed.toLowerCase();
        if (lower === 'classic') return 'Classic';
        if (lower === 'chinese') return 'Chinese';
        if (lower === 'hybrid') return 'Hybrid';
    }
    return 'Classic';
}

const HARDNESS_AVERAGES = {
    Germany: 47.5,
    Japan: 36,
    China: 39
};
const HARDNESS_MEDIUM_RANGE = 2;

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

function buildDescriptionMarkdown(raw, debugInfo) {
    const details = raw.manufacturer_details || {};
    const lines = [
        `# ${raw.manufacturer} ${raw.name}`,
        `**Brand:** ${raw.manufacturer}`,
        raw.price ? `**Price:** ${raw.price}` : null,
        details.country ? `**Country:** ${details.country}` : null,
        details.topsheet ? `**Topsheet:** ${details.topsheet}` : null,
        details.hardness !== undefined ? `**Sponge Hardness:** ${details.hardness}°` : null,
        details.weight !== undefined ? `**Weight:** ${details.weight}g` : null,
        details.thickness ? `**Thickness:** ${Array.isArray(details.thickness) ? details.thickness.join(', ') : details.thickness}` : null
    ].filter(Boolean);
    if (debugInfo) {
        const fmt = value => (Number.isFinite(value) ? value.toFixed(2) : 'n/a');
        const fmtRange = range => {
            if (!range || !Number.isFinite(range.min) || !Number.isFinite(range.max)) return 'n/a';
            return `${range.min.toFixed(2)} → ${range.max.toFixed(2)}`;
        };
        lines.push(
            '',
            '---',
            '**Debug: speed/spin calculation**',
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

function buildFullName(brand, name) {
    const brandName = (brand || '').trim();
    const rubberName = (name || '').trim();
    if (!brandName) return rubberName;
    const lowerBrand = brandName.toLowerCase();
    const lowerName = rubberName.toLowerCase();
    if (lowerName.startsWith(lowerBrand)) {
        return rubberName;
    }
    return `${brandName} ${rubberName}`.trim();
}

function loadJsonFile(url) {
    return new Promise(function(resolve, reject) {
        const xhr = new XMLHttpRequest();
        xhr.open('GET', url, true);
        xhr.onload = function() {
            if (xhr.status === 200 || xhr.status === 0) {
                try {
                    resolve(JSON.parse(xhr.responseText));
                } catch (e) {
                    reject(new Error('Invalid JSON in ' + url));
                }
            } else {
                reject(new Error('HTTP ' + xhr.status + ' for ' + url));
            }
        };
        xhr.onerror = function() {
            reject(new Error('Network error loading ' + url));
        };
        xhr.send();
    });
}

const DEBUG_MODE = new URLSearchParams(window.location.search).has('debug');

async function loadRubberData() {
    const results = await Promise.allSettled(
        rubberFiles.map(function(file) { return loadJsonFile(file); })
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
    const USER_WEIGHT = 0.85;
    const MANUFACTURER_WEIGHT = 0.15;

    rawItems.forEach(raw => {
        const ratings = raw.user_ratings || {};
        const userSpin = parseRatingNumber(ratings.spin);
        const userSpeed = parseRatingNumber(ratings.speed);
        if (!Number.isFinite(userSpin) || !Number.isFinite(userSpeed)) {
            return;
        }

        const overall = parseRatingNumber(ratings.overall);
        const control = parseRatingNumber(ratings.control);
        const manufacturerRatings = raw.manufacturer_ratings || {};
        const manufacturerRange = manufacturerRanges[raw.manufacturer] || null;
        const manufacturerSpinRaw = parseRatingNumber(manufacturerRatings.spin);
        const manufacturerSpeedRaw = parseRatingNumber(manufacturerRatings.speed);
        const manufacturerSpin = normalizeManufacturerRating(
            manufacturerSpinRaw,
            manufacturerRange ? manufacturerRange.spin : null
        );
        const manufacturerSpeed = normalizeManufacturerRating(
            manufacturerSpeedRaw,
            manufacturerRange ? manufacturerRange.speed : null
        );
        const spin = Number.isFinite(manufacturerSpin)
            ? (userSpin * USER_WEIGHT + manufacturerSpin * MANUFACTURER_WEIGHT)
            : userSpin;
        const speed = Number.isFinite(manufacturerSpeed)
            ? (userSpeed * USER_WEIGHT + manufacturerSpeed * MANUFACTURER_WEIGHT)
            : userSpeed;

        const manufacturerDetails = raw.manufacturer_details || {};
        const manufacturerTopsheet = manufacturerDetails.topsheet;
        const manufacturerHardness = parseRatingNumber(manufacturerDetails.hardness);
        const manufacturerCountry = manufacturerDetails.country;
        const weightValue = parseRatingNumber(manufacturerDetails.weight);
        const fullName = buildFullName(raw.manufacturer, raw.name);
        const urls = raw.urls || {};
        const rubber = {
            name: raw.name,
            fullName: fullName,
            abbr: raw.abbr || raw.name,
            brand: raw.manufacturer,
            x: spin,
            y: speed,
            weight: weightValue,
            weightCategory: normalizeWeightCategory(weightValue),
            hardness: parseRatingNumber(ratings.sponge_hardness),
            hardnessCategory: normalizeHardnessCategory(manufacturerHardness, manufacturerCountry),
            control: control,
            topsheet: normalizeTopsheet(manufacturerTopsheet),
            priority: Number.isFinite(raw.priority) ? raw.priority : 50,
            bestseller: raw.bestseller === true,
            urls: {
                us: {
                    product: (urls.us && urls.us.product) || '',
                    youtube: (urls.us && urls.us.youtube) || ''
                },
                kr: {
                    product: (urls.kr && urls.kr.product) || '',
                    youtube: (urls.kr && urls.kr.youtube) || ''
                },
                cn: {
                    product: (urls.cn && urls.cn.product) || '',
                    youtube: (urls.cn && urls.cn.youtube) || ''
                }
            }
        };

        const debugInfo = DEBUG_MODE ? {
            userSpin,
            userSpeed,
            manufacturerSpinRaw,
            manufacturerSpeedRaw,
            manufacturerSpinNormalized: manufacturerSpin,
            manufacturerSpeedNormalized: manufacturerSpeed,
            manufacturerSpinRange: manufacturerRange ? manufacturerRange.spin : null,
            manufacturerSpeedRange: manufacturerRange ? manufacturerRange.speed : null,
            spinFinal: spin,
            speedFinal: speed,
            userWeight: USER_WEIGHT,
            manufacturerWeight: MANUFACTURER_WEIGHT
        } : null;

        data.push(rubber);
        descriptionMap[rubber.name] = buildDescriptionMarkdown(raw, debugInfo);
    });

    rubberData = data;
    descriptions = descriptionMap;
}

// Brand colors
const brandColors = {
    "Butterfly": "#E41A1C",
    "DHS": "#377EB8",
    "Andro": "#4DAF4A",
    "JOOLA": "#984EA3",
    "Xiom": "#FF7F00",
    "Tibhar": "#A65628",
    "Nittaku": "#F781BF",
    "Donic": "#999999",
    "Yasaka": "#FFFF33"
};

// Topsheet markers
const topsheetMarkers = {
    "Classic": "circle",
    "Chinese": "square",
    "Hybrid": "diamond"
};

let selectedRubbers = [null, null];
let nextDetailPanel = 1;
let hasPlotted = false;
let isInternalUpdate = false;
let currentFilteredData = [];
let relayoutTimer = null;
let selectedCountry = 'us';

function getCurrentAxisRanges() {
    const chart = document.getElementById('chart');
    if (!chart || !chart.layout || !chart.layout.xaxis || !chart.layout.yaxis) {
        return null;
    }
    const { xaxis, yaxis } = chart.layout;
    if (!Array.isArray(xaxis.range) || !Array.isArray(yaxis.range)) {
        return null;
    }
    return {
        xaxis: [...xaxis.range],
        yaxis: [...yaxis.range]
    };
}

function shouldAutoscaleForFilteredData(filteredData, currentRanges) {
    if (!currentRanges || filteredData.length === 0) {
        return false;
    }
    const xMin = currentRanges.xaxis[0];
    const xMax = currentRanges.xaxis[1];
    const yMin = currentRanges.yaxis[0];
    const yMax = currentRanges.yaxis[1];

    return filteredData.some(rubber =>
        rubber.x < xMin || rubber.x > xMax || rubber.y < yMin || rubber.y > yMax
    );
}

function getControlValue(rubber) {
    if (typeof rubber.control === 'number') {
        return rubber.control;
    }
    const description = descriptions[rubber.name];
    if (!description) {
        return null;
    }
    const match = description.match(/\*\*Control:\*\*\s*([0-9.]+)/);
    if (!match) {
        return null;
    }
    const value = Number.parseFloat(match[1]);
    return Number.isFinite(value) ? value : null;
}

function buildCheckboxOptions(container, values, checkedValues) {
    container.innerHTML = '';
    const isToggleGroup = container.classList.contains('toggle-group');
    values.forEach(item => {
        const value = typeof item === 'string' ? item : item.value;
        const labelText = typeof item === 'string' ? item : item.label;
        const swatchColor = typeof item === 'string' ? null : item.swatchColor;
        const shapeSymbol = typeof item === 'string' ? null : item.shapeSymbol;

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
        if (isToggleGroup) {
            text.classList.add('toggle-pill');
        }
        label.appendChild(text);
        container.appendChild(label);
    });
}

function setAllChecked(container, checked) {
    Array.from(container.querySelectorAll('input[type="checkbox"]')).forEach(cb => {
        cb.checked = checked;
    });
}

function filterOptions(container, query) {
    const q = query.trim().toLowerCase();
    Array.from(container.querySelectorAll('.filter-option')).forEach(option => {
        const text = option.textContent.toLowerCase();
        option.style.display = text.includes(q) ? 'flex' : 'none';
    });
}

function getCheckedValues(containerId) {
    return Array.from(document.querySelectorAll(`#${containerId} input[type="checkbox"]:checked`))
        .map(cb => cb.value);
}

function buildNameOptionsFromBrands() {
    const nameFilter = document.getElementById('nameFilter');
    const selectedBrands = getCheckedValues('brandFilter');
    const previousSelections = new Set(getCheckedValues('nameFilter'));
    const previousNames = new Set(
        Array.from(nameFilter.querySelectorAll('input[type="checkbox"]')).map(cb => cb.value)
    );

    if (selectedBrands.length === 0) {
        nameFilter.innerHTML = '<div class="filter-instructions">Select a brand first.</div>';
        return;
    }

    const names = rubberData
        .filter(rubber => selectedBrands.includes(rubber.brand))
        .map(rubber => rubber.fullName);
    const uniqueNames = [...new Set(names)].sort();
    const nameOptions = uniqueNames.map(name => {
        const rubber = rubberData.find(item => item.fullName === name);
        const brand = rubber ? rubber.brand : null;
        return {
            value: name,
            label: name,
            swatchColor: brand ? getBrandColor(brand) : null
        };
    });

    buildCheckboxOptions(
        nameFilter,
        nameOptions,
        new Set(
            uniqueNames.filter(name => {
                if (previousSelections.has(name)) return true;
                if (previousNames.has(name)) return false;
                return true;
            })
        )
    );
}

function getBrandColor(brand) {
    return brandColors[brand] || '#999999';
}

function getTopsheetSymbol(topsheet) {
    return topsheetMarkers[topsheet] || 'circle';
}

function getAutoscaleBounds(rubbers) {
    if (!Array.isArray(rubbers) || rubbers.length === 0) {
        return null;
    }
    const xs = rubbers.map(rubber => rubber.x);
    const ys = rubbers.map(rubber => rubber.y);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    const padX = Math.max(0.5, (maxX - minX) * 0.05);
    const padY = Math.max(0.5, (maxY - minY) * 0.05);
    return {
        x: [minX - padX, maxX + padX],
        y: [minY - padY, maxY + padY]
    };
}

function viewCoversDataBounds(rubbers, xRange, yRange) {
    const bounds = getAutoscaleBounds(rubbers);
    if (!bounds) return true;
    return (
        xRange[0] <= bounds.x[0] &&
        xRange[1] >= bounds.x[1] &&
        yRange[0] <= bounds.y[0] &&
        yRange[1] >= bounds.y[1]
    );
}

function clampRangeToBounds(range, bounds) {
    return [
        Math.max(range[0], bounds[0]),
        Math.min(range[1], bounds[1])
    ];
}

// ── Dropdown open/close logic ──
let openFilterId = null;

function openDropdown(filterId) {
    closeAllDropdowns();
    const chip = document.getElementById(filterId + 'Chip');
    const dropdown = document.getElementById(filterId + 'Dropdown');
    if (!chip || !dropdown) return;
    chip.classList.add('active');
    dropdown.classList.add('open');
    document.getElementById('filterBackdrop').classList.add('visible');
    openFilterId = filterId;
    // Focus search input if it exists
    const search = dropdown.querySelector('.dropdown-search');
    if (search) {
        setTimeout(() => {
            try {
                search.focus({ preventScroll: true });
            } catch (err) {
                search.focus();
            }
        }, 60);
    }
}

function closeAllDropdowns() {
    document.querySelectorAll('.filter-chip').forEach(c => c.classList.remove('active'));
    document.querySelectorAll('.filter-dropdown').forEach(d => d.classList.remove('open'));
    document.getElementById('filterBackdrop').classList.remove('visible');
    openFilterId = null;
}

function toggleDropdown(filterId) {
    if (openFilterId === filterId) {
        closeAllDropdowns();
    } else {
        openDropdown(filterId);
    }
}

// ── Badge updaters ──
function updateBadge(filterId, checkedCount, totalCount) {
    const badge = document.getElementById(filterId + 'Badge');
    if (!badge) return;
    if (checkedCount === totalCount) {
        badge.textContent = 'All';
        badge.classList.add('all-selected');
    } else if (checkedCount === 0) {
        badge.textContent = '0';
        badge.classList.remove('all-selected');
    } else {
        badge.textContent = checkedCount;
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
    ['brand', 'name', 'topsheet', 'hardness', 'weight'].forEach(refreshBadge);
}

function zoomChart(scale) {
    const chartEl = document.getElementById('chart');
    if (!chartEl || !chartEl._fullLayout) return;
    const xa = chartEl._fullLayout.xaxis;
    const ya = chartEl._fullLayout.yaxis;
    if (!xa || !ya || !Array.isArray(xa.range) || !Array.isArray(ya.range)) return;

    const xRange = [xa.range[0], xa.range[1]];
    const yRange = [ya.range[0], ya.range[1]];
    const xSpan = xRange[1] - xRange[0];
    const ySpan = yRange[1] - yRange[0];
    if (xSpan <= 0 || ySpan <= 0) return;
    const autoscaleBounds = getAutoscaleBounds(currentFilteredData);
    if (scale > 1 && autoscaleBounds && viewCoversDataBounds(currentFilteredData, xRange, yRange)) {
        return;
    }

    const xCenter = (xRange[0] + xRange[1]) / 2;
    const yCenter = (yRange[0] + yRange[1]) / 2;
    const newXSpan = xSpan * scale;
    const newYSpan = ySpan * scale;

    let nextXRange = [xCenter - newXSpan / 2, xCenter + newXSpan / 2];
    let nextYRange = [yCenter - newYSpan / 2, yCenter + newYSpan / 2];
    if (scale > 1 && autoscaleBounds) {
        nextXRange = clampRangeToBounds(nextXRange, autoscaleBounds.x);
        nextYRange = clampRangeToBounds(nextYRange, autoscaleBounds.y);
    }

    Plotly.relayout(chartEl, {
        'xaxis.range': nextXRange,
        'yaxis.range': nextYRange,
        'xaxis.autorange': false,
        'yaxis.autorange': false
    });
}

// ── URL filter state sync ──
function pushFiltersToUrl() {
    const params = new URLSearchParams();

    // Preserve debug param if present
    if (DEBUG_MODE) params.set('debug', '');

    // Brand
    const brandFilter = document.getElementById('brandFilter');
    const allBrands = Array.from(brandFilter.querySelectorAll('input[type="checkbox"]'));
    const checkedBrands = allBrands.filter(cb => cb.checked).map(cb => cb.value);
    if (checkedBrands.length > 0 && checkedBrands.length < allBrands.length) {
        params.set('brands', checkedBrands.join(','));
    }

    // Rubbers (names)
    const nameFilter = document.getElementById('nameFilter');
    const allNames = Array.from(nameFilter.querySelectorAll('input[type="checkbox"]'));
    const checkedNames = allNames.filter(cb => cb.checked).map(cb => cb.value);
    if (allNames.length > 0 && checkedNames.length > 0 && checkedNames.length < allNames.length) {
        params.set('rubbers', checkedNames.join(','));
    }

    // Topsheet
    const topsheetFilter = document.getElementById('topsheetFilter');
    const allTopsheet = Array.from(topsheetFilter.querySelectorAll('input[type="checkbox"]'));
    const checkedTopsheet = allTopsheet.filter(cb => cb.checked).map(cb => cb.value);
    if (checkedTopsheet.length > 0 && checkedTopsheet.length < allTopsheet.length) {
        params.set('topsheet', checkedTopsheet.join(','));
    }

    // Hardness
    const hardnessFilter = document.getElementById('hardnessFilter');
    const allHardness = Array.from(hardnessFilter.querySelectorAll('input[type="checkbox"]'));
    const checkedHardness = allHardness.filter(cb => cb.checked).map(cb => cb.value);
    if (checkedHardness.length > 0 && checkedHardness.length < allHardness.length) {
        params.set('hardness', checkedHardness.join(','));
    }

    // Weight
    const weightFilter = document.getElementById('weightFilter');
    const allWeights = Array.from(weightFilter.querySelectorAll('input[type="checkbox"]'));
    const checkedWeights = allWeights.filter(cb => cb.checked).map(cb => cb.value);
    if (checkedWeights.length > 0 && checkedWeights.length < allWeights.length) {
        params.set('weight', checkedWeights.join(','));
    }

    // Country
    if (selectedCountry !== 'us') {
        params.set('country', selectedCountry);
    }

    // Selected rubbers (detail panels)
    if (selectedRubbers[0]) {
        params.set('left', selectedRubbers[0].fullName);
    }
    if (selectedRubbers[1]) {
        params.set('right', selectedRubbers[1].fullName);
    }

    const queryString = params.toString();
    const newUrl = window.location.pathname + (queryString ? '?' + queryString : '');
    history.replaceState(null, '', newUrl);
}

function applyFiltersFromUrl() {
    const params = new URLSearchParams(window.location.search);
    let hasFilterParams = params.has('brands') || params.has('rubbers') ||
        params.has('topsheet') || params.has('hardness') || params.has('weight') || params.has('country');
    if (!hasFilterParams) return;

    // Country
    if (params.has('country')) {
        const country = params.get('country');
        if (['us', 'kr', 'cn'].includes(country)) {
            selectedCountry = country;
            const selector = document.getElementById('countrySelector');
            selector.querySelectorAll('.country-btn').forEach(b => {
                b.classList.toggle('active', b.dataset.country === country);
            });
        }
    }

    // Brand
    if (params.has('brands')) {
        const brands = params.get('brands').split(',').filter(Boolean);
        const brandFilter = document.getElementById('brandFilter');
        Array.from(brandFilter.querySelectorAll('input[type="checkbox"]')).forEach(cb => {
            cb.checked = brands.includes(cb.value);
        });
        // Rebuild name options after brand change
        buildNameOptionsFromBrands();
    }

    // Rubbers (names)
    if (params.has('rubbers')) {
        const rubbers = params.get('rubbers').split(',').filter(Boolean);
        const nameFilter = document.getElementById('nameFilter');
        Array.from(nameFilter.querySelectorAll('input[type="checkbox"]')).forEach(cb => {
            cb.checked = rubbers.includes(cb.value);
        });
    }

    // Topsheet
    if (params.has('topsheet')) {
        const topsheets = params.get('topsheet').split(',').filter(Boolean);
        const topsheetFilter = document.getElementById('topsheetFilter');
        Array.from(topsheetFilter.querySelectorAll('input[type="checkbox"]')).forEach(cb => {
            cb.checked = topsheets.includes(cb.value);
        });
    }

    // Hardness
    if (params.has('hardness')) {
        const hardnesses = params.get('hardness').split(',').filter(Boolean);
        const hardnessFilter = document.getElementById('hardnessFilter');
        Array.from(hardnessFilter.querySelectorAll('input[type="checkbox"]')).forEach(cb => {
            cb.checked = hardnesses.includes(cb.value);
        });
    }

    // Weight
    if (params.has('weight')) {
        const weights = params.get('weight').split(',').filter(Boolean);
        const weightFilter = document.getElementById('weightFilter');
        Array.from(weightFilter.querySelectorAll('input[type="checkbox"]')).forEach(cb => {
            cb.checked = weights.includes(cb.value);
        });
    }

    // Selected rubbers (detail panels)
    if (params.has('left')) {
        const leftName = params.get('left');
        const leftRubber = rubberData.find(r => r.fullName === leftName);
        if (leftRubber) {
            selectedRubbers[0] = leftRubber;
            updateDetailPanel(1, leftRubber);
        }
    }
    if (params.has('right')) {
        const rightName = params.get('right');
        const rightRubber = rubberData.find(r => r.fullName === rightName);
        if (rightRubber) {
            selectedRubbers[1] = rightRubber;
            updateDetailPanel(2, rightRubber);
            nextDetailPanel = 1;
        }
    }
    // If only left was set, next click goes to right panel
    if (params.has('left') && !params.has('right')) {
        nextDetailPanel = 2;
    }

    updateComparisonBar();
    refreshAllBadges();
    renderActiveTags();
}

// ── Active tags (removable pills below filter bar) ──
function renderActiveTags() {
    const container = document.getElementById('activeTags');
    container.innerHTML = '';

    // Only show tags for brands that are NOT all-selected
    const brandFilter = document.getElementById('brandFilter');
    const brandAll = brandFilter.querySelectorAll('input[type="checkbox"]');
    const brandChecked = brandFilter.querySelectorAll('input[type="checkbox"]:checked');
    if (brandChecked.length < brandAll.length && brandChecked.length > 0) {
        brandChecked.forEach(cb => {
            const tag = document.createElement('span');
            tag.className = 'active-tag';
            const dot = document.createElement('span');
            dot.className = 'tag-dot';
            dot.style.backgroundColor = getBrandColor(cb.value);
            tag.appendChild(dot);
            tag.appendChild(document.createTextNode(cb.value));
            const removeBtn = document.createElement('button');
            removeBtn.className = 'tag-remove';
            removeBtn.innerHTML = '&times;';
            removeBtn.onclick = (e) => {
                e.stopPropagation();
                cb.checked = false;
                cb.dispatchEvent(new Event('change', { bubbles: true }));
            };
            tag.appendChild(removeBtn);
            container.appendChild(tag);
        });
    }

    // Show deselected topsheet / hardness as negative tags? No — show selected non-all.
    ['topsheet', 'hardness', 'weight'].forEach(filterId => {
        const filterEl = document.getElementById(filterId + 'Filter');
        const all = filterEl.querySelectorAll('input[type="checkbox"]');
        const checked = filterEl.querySelectorAll('input[type="checkbox"]:checked');
        if (checked.length < all.length && checked.length > 0) {
            checked.forEach(cb => {
                const tag = document.createElement('span');
                tag.className = 'active-tag';
                tag.appendChild(document.createTextNode(cb.value));
                const removeBtn = document.createElement('button');
                removeBtn.className = 'tag-remove';
                removeBtn.innerHTML = '&times;';
                removeBtn.onclick = (e) => {
                    e.stopPropagation();
                    cb.checked = false;
                    cb.dispatchEvent(new Event('change', { bubbles: true }));
                };
                tag.appendChild(removeBtn);
                container.appendChild(tag);
            });
        }
    });
}

// Initialize filters
function initFilters() {
    const brands = [...new Set(rubberData.map(r => r.brand))].sort();
    const topsheetValues = ["Classic", "Chinese", "Hybrid"];
    const hardnessValues = ["Soft", "Medium", "Hard"];
    const hardnessEmoji = { "Soft": "🟢", "Medium": "🟡", "Hard": "🔴" };
    const weightValues = ["Light", "Medium", "Heavy"];
    const brandOptions = brands.map(brand => ({
        value: brand,
        label: brand,
        swatchColor: getBrandColor(brand)
    }));
    const topsheetOptions = topsheetValues.map(topsheet => ({
        value: topsheet,
        label: topsheet,
        shapeSymbol: getTopsheetSymbol(topsheet)
    }));
    const hardnessOptions = hardnessValues.map(hardness => ({
        value: hardness,
        label: `${hardnessEmoji[hardness] || ''} ${hardness}`
    }));
    const weightOptions = weightValues.map(weight => ({
        value: weight,
        label: weight
    }));

    const brandFilter = document.getElementById('brandFilter');
    const nameFilter = document.getElementById('nameFilter');
    const topsheetFilter = document.getElementById('topsheetFilter');
    const hardnessFilter = document.getElementById('hardnessFilter');
    const weightFilter = document.getElementById('weightFilter');

    buildCheckboxOptions(brandFilter, brandOptions);
    buildCheckboxOptions(topsheetFilter, topsheetOptions);
    buildCheckboxOptions(hardnessFilter, hardnessOptions);
    buildCheckboxOptions(weightFilter, weightOptions);
    buildNameOptionsFromBrands();

    function onFilterChange(filterId) {
        if (filterId === 'brand') {
            buildNameOptionsFromBrands();
        }
        refreshAllBadges();
        renderActiveTags();
        pushFiltersToUrl();
        updateChart();
    }

    brandFilter.addEventListener('change', () => onFilterChange('brand'));
    nameFilter.addEventListener('change', () => onFilterChange('name'));
    topsheetFilter.addEventListener('change', () => onFilterChange('topsheet'));
    hardnessFilter.addEventListener('change', () => onFilterChange('hardness'));
    weightFilter.addEventListener('change', () => onFilterChange('weight'));

    document.getElementById('brandSearch').addEventListener('input', (e) => {
        filterOptions(brandFilter, e.target.value);
    });
    document.getElementById('nameSearch').addEventListener('input', (e) => {
        filterOptions(nameFilter, e.target.value);
    });

    // All/None buttons inside dropdown headers
    document.querySelectorAll('.dd-actions button').forEach(button => {
        button.addEventListener('click', (e) => {
            e.stopPropagation();
            const filter = button.dataset.filter;
            const action = button.dataset.action;
            const container = document.getElementById(`${filter}Filter`);
            setAllChecked(container, action === 'all');
            onFilterChange(filter);
        });
    });

    // Close buttons inside dropdown headers
    document.querySelectorAll('.dropdown-close').forEach(button => {
        button.addEventListener('click', (e) => {
            e.stopPropagation();
            closeAllDropdowns();
        });
    });

    // Chip click → toggle dropdown
    document.querySelectorAll('.filter-chip').forEach(chip => {
        chip.addEventListener('click', (e) => {
            // Don't toggle if clicking inside the dropdown itself
            if (e.target.closest('.filter-dropdown')) return;
            const filterId = chip.dataset.filter;
            toggleDropdown(filterId);
        });
    });

    // Backdrop closes dropdowns
    document.getElementById('filterBackdrop').addEventListener('click', closeAllDropdowns);

    // Escape key closes
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') closeAllDropdowns();
    });

    // Prevent dropdown search clicks from closing
    document.querySelectorAll('.dropdown-search').forEach(input => {
        input.addEventListener('click', (e) => e.stopPropagation());
    });

    // Autoscale button
    document.getElementById('autoscaleBtn').addEventListener('click', () => {
        const chartEl = document.getElementById('chart');
        if (chartEl && hasPlotted) {
            Plotly.relayout(chartEl, {
                'xaxis.autorange': true,
                'yaxis.autorange': true
            });
        }
    });

    // Zoom buttons
    document.getElementById('zoomInBtn').addEventListener('click', () => {
        zoomChart(0.85);
    });
    document.getElementById('zoomOutBtn').addEventListener('click', () => {
        zoomChart(1.15);
    });

    // Clear all filters → reset to all selected
    document.getElementById('clearAllFilters').addEventListener('click', () => {
        [brandFilter, topsheetFilter, hardnessFilter, weightFilter].forEach(c => setAllChecked(c, true));
        buildNameOptionsFromBrands();
        refreshAllBadges();
        renderActiveTags();
        pushFiltersToUrl();
        updateChart();
    });

    // Initial badge state
    refreshAllBadges();
    renderActiveTags();
}

// Get filtered data
function getFilteredData() {
    const selectedBrands = getCheckedValues('brandFilter');
    const selectedNames = getCheckedValues('nameFilter');
    const selectedTopsheet = getCheckedValues('topsheetFilter');
    const selectedHardness = getCheckedValues('hardnessFilter');
    const selectedWeights = getCheckedValues('weightFilter');
    const weightFilterEl = document.getElementById('weightFilter');
    const allWeights = weightFilterEl ? Array.from(weightFilterEl.querySelectorAll('input[type="checkbox"]')).map(cb => cb.value) : [];
    const shouldFilterWeights = selectedWeights.length > 0 && selectedWeights.length < allWeights.length;

    if (
        selectedBrands.length === 0 ||
        selectedNames.length === 0 ||
        selectedTopsheet.length === 0 ||
        selectedHardness.length === 0 ||
        selectedWeights.length === 0
    ) {
        return [];
    }

    return rubberData.filter(rubber => {
        if (selectedBrands.length > 0 && !selectedBrands.includes(rubber.brand)) return false;
        if (selectedNames.length > 0 && !selectedNames.includes(rubber.fullName)) return false;
        if (selectedTopsheet.length > 0 && !selectedTopsheet.includes(rubber.topsheet)) return false;
        if (selectedHardness.length > 0 && !selectedHardness.includes(rubber.hardnessCategory)) return false;
        if (shouldFilterWeights) {
            if (!rubber.weightCategory) return false;
            if (!selectedWeights.includes(rubber.weightCategory)) return false;
        }
        return true;
    });
}

// Compute which rubbers to display based on overlap & priority
function computeVisibleRubbers(filteredData) {
    if (filteredData.length === 0) return [];

    const chartEl = document.getElementById('chart');
    let xRange, yRange, plotWidth, plotHeight;

    if (chartEl._fullLayout && chartEl._fullLayout.xaxis && chartEl._fullLayout.yaxis) {
        const xa = chartEl._fullLayout.xaxis;
        const ya = chartEl._fullLayout.yaxis;
        xRange = [xa.range[0], xa.range[1]];
        yRange = [ya.range[0], ya.range[1]];
        const size = chartEl._fullLayout._size;
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

    function toPixel(dataX, dataY) {
        const px = ((dataX - xRange[0]) / xSpan) * plotWidth;
        const py = ((dataY - yRange[0]) / ySpan) * plotHeight;
        return { px, py };
    }

    // Sort by priority ascending — lower priority number = higher importance, placed first
    const sorted = [...filteredData].sort((a, b) => a.priority - b.priority);
    const visible = [];
    const occupied = []; // pixel positions already taken

    // Minimum pixel distance thresholds (accounts for dot + text label)
    const MIN_DIST_X = 55;
    const MIN_DIST_Y = 24;

    for (const rubber of sorted) {
        const { px, py } = toPixel(rubber.x, rubber.y);

        let overlaps = false;
        for (const occ of occupied) {
            if (Math.abs(px - occ.px) < MIN_DIST_X && Math.abs(py - occ.py) < MIN_DIST_Y) {
                overlaps = true;
                break;
            }
        }

        if (!overlaps) {
            visible.push(rubber);
            occupied.push({ px, py });
        }
    }

    return visible;
}

// Initialize chart with Plotly
function initChart() {
    updateChart();
    // Do NOT use preserveRanges here — let shouldAutoscaleForFilteredData
    // widen the view when data falls outside the initial autoranged bounds,
    // exactly as the Reset button does.
    updateChart();
}

// Update chart
function updateChart(options) {
    const settings = options || {};
    const filteredData = getFilteredData();
    currentFilteredData = filteredData;
    const visibleData = computeVisibleRubbers(filteredData);
    const controlValues = filteredData
        .map(getControlValue)
        .filter(value => Number.isFinite(value));
    const minControl = controlValues.length > 0 ? Math.min(...controlValues) : null;
    const maxControl = controlValues.length > 0 ? Math.max(...controlValues) : null;
    const minMarkerSize = 10;
    const maxMarkerSize = 15;

    function getMarkerSize(rubber) {
        const control = getControlValue(rubber);
        if (!Number.isFinite(control) || minControl === null || maxControl === null) {
            return 12;
        }
        if (maxControl === minControl) {
            return (minMarkerSize + maxMarkerSize) / 2;
        }
        const t = (control - minControl) / (maxControl - minControl);
        return minMarkerSize + t * (maxMarkerSize - minMarkerSize);
    }
    
    // Group data by brand and topsheet
    const traces = [];
    const groups = {};
    
    visibleData.forEach(rubber => {
        const key = `${rubber.brand}-${rubber.topsheet}`;
        if (!groups[key]) {
            groups[key] = {
                brand: rubber.brand,
                topsheet: rubber.topsheet,
                rubbers: []
            };
        }
        groups[key].rubbers.push(rubber);
    });

    // Bestseller halo trace (rendered first so it sits behind normal markers)
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
                line: {
                    width: 2,
                    color: 'rgba(212,193,106,0.5)'
                }
            }
        });
    }

    // Create traces for each group
    Object.values(groups).forEach(group => {
        const trace = {
            x: group.rubbers.map(r => r.x),
            y: group.rubbers.map(r => r.y),
            mode: 'markers+text',
            type: 'scatter',
            name: `${group.brand} (${group.topsheet})`,
            marker: {
                size: group.rubbers.map(r => getMarkerSize(r)),
                color: getBrandColor(group.brand),
                symbol: getTopsheetSymbol(group.topsheet),
                line: {
                    width: 1,
                    color: '#2b2926'
                }
            },
            text: group.rubbers.map(r => r.abbr),
            textposition: 'top center',
            textfont: {
                size: 11,
                color: '#e8e0d0',
                family: '-apple-system, BlinkMacSystemFont, Segoe UI, Roboto, sans-serif'
            },
            hovertemplate: '<b>%{customdata.name}</b><br>' +
                'Brand: ' + group.brand + '<br>' +
                'Spin: %{x:.2f}<br>' +
                'Speed: %{y:.2f}<br>' +
                'Topsheet: ' + group.topsheet +
                '<extra></extra>',
            customdata: group.rubbers
        };
        traces.push(trace);
    });

    let currentRanges = hasPlotted ? getCurrentAxisRanges() : null;
    if (!settings.preserveRanges && shouldAutoscaleForFilteredData(filteredData, currentRanges)) {
        currentRanges = null;
    }
    const chartEl = document.getElementById('chart');
    const layout = {
        title: '',
        dragmode: 'pan',
        xaxis: {
            title: { text: '' },
            autorange: currentRanges ? false : true,
            range: currentRanges ? currentRanges.xaxis : undefined,
            zeroline: false,
            gridcolor: '#3e3a34',
            tickfont: { color: '#9b9484' },
            linecolor: '#3e3a34',
            showticklabels: false,
            tickformat: '.1f'
        },
        yaxis: {
            title: { text: '' },
            autorange: currentRanges ? false : true,
            range: currentRanges ? currentRanges.yaxis : undefined,
            zeroline: false,
            gridcolor: '#3e3a34',
            tickfont: { color: '#9b9484' },
            linecolor: '#3e3a34',
            showticklabels: false,
            tickformat: '.1f'
        },
        hovermode: 'closest',
        plot_bgcolor: '#2b2926',
        paper_bgcolor: '#2b2926',
        margin: { l: 10, r: 10, t: 10, b: 10 },
        annotations: [
            {
                x: 0.995,
                y: 0.01,
                xref: 'paper',
                yref: 'paper',
                text: '🔄 Spin →',
                showarrow: false,
                xanchor: 'right',
                yanchor: 'bottom',
                font: { color: '#d4c16a', size: 13, family: '-apple-system, BlinkMacSystemFont, Segoe UI, Roboto, sans-serif' }
            },
            {
                x: 0.005,
                y: 1.00,
                xref: 'paper',
                yref: 'paper',
                text: '⚡ Speed ↑',
                showarrow: false,
                xanchor: 'left',
                yanchor: 'top',
                font: { color: '#d4c16a', size: 13, family: '-apple-system, BlinkMacSystemFont, Segoe UI, Roboto, sans-serif' }
            }
        ],
        showlegend: false,
        legend: {
            x: 1,
            y: 1,
            xanchor: 'right',
            bgcolor: 'rgba(43,41,38,0.9)',
            bordercolor: '#3e3a34',
            borderwidth: 1,
            font: { color: '#e8e0d0' }
        },
        hoverlabel: {
            bgcolor: '#3e3a34',
            bordercolor: '#9b9484',
            font: { color: '#e8e0d0', family: '-apple-system, BlinkMacSystemFont, sans-serif' }
        }
    };

    const config = {
        responsive: true,
        displayModeBar: false,
        displaylogo: false,
        scrollZoom: false
    };

    if (hasPlotted) {
        Plotly.react('chart', traces, layout, config);
    } else {
        Plotly.newPlot('chart', traces, layout, config);
        hasPlotted = true;
    }

    // Add click handler (once)
    if (!chartEl._hasClickHandler) {
        chartEl._hasClickHandler = true;
        chartEl.on('plotly_click', function(data) {
            const point = data.points[0];
            const pointIndex = point.pointIndex;
            const rubber = point.data.customdata[pointIndex];
            handleRubberClick(rubber);
        });
    }

    // Add relayout handler (once) to recalculate visibility on zoom/pan
    if (!chartEl._hasRelayoutHandler) {
        chartEl._hasRelayoutHandler = true;
        chartEl.on('plotly_relayout', function(eventData) {
            if (isInternalUpdate) return;
            const rangesChanged =
                eventData['xaxis.range[0]'] !== undefined ||
                eventData['xaxis.range'] !== undefined ||
                eventData['yaxis.range[0]'] !== undefined ||
                eventData['yaxis.range'] !== undefined ||
                eventData['xaxis.autorange'] !== undefined ||
                eventData['yaxis.autorange'] !== undefined;
            if (rangesChanged) {
                clearTimeout(relayoutTimer);
                relayoutTimer = setTimeout(function() {
                    isInternalUpdate = true;
                    updateChart({ preserveRanges: true });
                    setTimeout(function() { isInternalUpdate = false; }, 300);
                }, 120);
            }
        });
    }
}

// Handle rubber click
function handleRubberClick(rubber) {
    const panelNum = nextDetailPanel;
    nextDetailPanel = panelNum === 1 ? 2 : 1;

    if (panelNum === 1) {
        selectedRubbers[0] = rubber;
        updateDetailPanel(1, rubber);
    } else {
        selectedRubbers[1] = rubber;
        updateDetailPanel(2, rubber);
    }

    updateComparisonBar();
    pushFiltersToUrl();
}

// Extract YouTube video ID from a URL
function extractYouTubeVideoId(url) {
    if (!url) return null;
    const match = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([\w-]+)/);
    return match ? match[1] : null;
}

// YouTube IFrame API readiness
let ytApiReady = false;
let ytPlayers = {};
let ytPlayerIdCounter = 0;
window.onYouTubeIframeAPIReady = function() {
    ytApiReady = true;
};

// Toggle embedded YouTube player in a detail panel
function toggleYouTubeEmbed(link, videoId) {
    const container = link.closest('.rubber-links');
    let embedWrapper = container.querySelector('.youtube-embed-wrapper');
    if (embedWrapper) {
        // Destroy player & clean up
        const pid = embedWrapper.dataset.playerId;
        if (pid && ytPlayers[pid]) {
            try { ytPlayers[pid].destroy(); } catch(e) {}
            delete ytPlayers[pid];
        }
        embedWrapper.remove();
        link.textContent = '▶ YouTube Review';
        return;
    }

    embedWrapper = document.createElement('div');
    embedWrapper.className = 'youtube-embed-wrapper';
    embedWrapper.style.cssText = 'margin-top: 10px; position: relative; padding-bottom: 56.25%; height: 0; overflow: hidden; border-radius: 8px;';

    // Close button for landscape pseudo-fullscreen
    const closeBtn = document.createElement('button');
    closeBtn.className = 'landscape-fs-close';
    closeBtn.textContent = '✕';
    closeBtn.onclick = function() { embedWrapper.classList.remove('landscape-fs'); };
    embedWrapper.appendChild(closeBtn);

    const playerDiv = document.createElement('div');
    const playerId = 'yt-player-' + (++ytPlayerIdCounter);
    playerDiv.id = playerId;
    playerDiv.style.cssText = 'position: absolute; top: 0; left: 0; width: 100%; height: 100%;';
    embedWrapper.appendChild(playerDiv);
    embedWrapper.dataset.playerId = playerId;

    container.appendChild(embedWrapper);

    if (ytApiReady && typeof YT !== 'undefined' && YT.Player) {
        // Use IFrame API — playVideo() called in onReady is allowed
        // because this whole chain started from a user tap
        ytPlayers[playerId] = new YT.Player(playerId, {
            videoId: videoId,
            playerVars: {
                autoplay: 1,
                playsinline: 1,
                rel: 0
            },
            events: {
                onReady: function(event) {
                    event.target.playVideo();
                }
            }
        });
    } else {
        // Fallback: plain iframe (muted autoplay so it works on mobile)
        playerDiv.outerHTML = `<iframe src="https://www.youtube.com/embed/${videoId}?autoplay=1&mute=1&playsinline=1&rel=0" style="position: absolute; top: 0; left: 0; width: 100%; height: 100%; border: none; border-radius: 8px;" allow="autoplay; encrypted-media; fullscreen" allowfullscreen></iframe>`;
    }

    link.textContent = '⏹ Close Video';
}

// Landscape pseudo-fullscreen (CSS-based, no user gesture required)
function handleOrientationFullscreen() {
    const isLandscape = window.innerWidth > window.innerHeight;
    const wrapper = document.querySelector('.youtube-embed-wrapper');
    if (!wrapper) return;

    if (isLandscape) {
        wrapper.classList.add('landscape-fs');
    } else {
        wrapper.classList.remove('landscape-fs');
    }
}

if (screen.orientation) {
    screen.orientation.addEventListener('change', function() {
        // Small delay to let dimensions settle after rotation
        setTimeout(handleOrientationFullscreen, 150);
    });
}
window.addEventListener('orientationchange', function() {
    setTimeout(handleOrientationFullscreen, 150);
});

// Build URL links HTML for a rubber based on selected country
function buildUrlLinksHtml(rubber) {
    if (!rubber || !rubber.urls) return '';
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

// Update detail panel
function updateDetailPanel(panelNum, rubber) {
    const panel = document.getElementById(`detail${panelNum}`);
    const markdown = descriptions[rubber.name] || `# ${rubber.name}\n\nNo description available.`;
    const html = marked.parse(markdown);
    const bestsellerBadge = rubber.bestseller
        ? '<span class="bestseller-badge">★ Bestseller</span>'
        : '';
    const linksHtml = buildUrlLinksHtml(rubber);
    panel.innerHTML = html + bestsellerBadge + linksHtml;
}

// Clear detail panel
function clearDetailPanel(panelNum) {
    const panel = document.getElementById(`detail${panelNum}`);
    panel.innerHTML = `<h3>Select another rubber</h3><div class="content">Click on another dot to compare</div>`;
}

// Show/hide comparison
function updateComparisonBar() {
    const bar = document.getElementById('comparisonBar');
    const left = selectedRubbers[0];
    const right = selectedRubbers[1];
    if (left && right) {
        bar.textContent = `${left.name} vs ${right.name}`;
        bar.style.display = 'block';
        return;
    }
    bar.style.display = 'none';
}

// Trackpad pinch-to-zoom (blocks regular scroll zoom)
(function() {
    const chartEl = document.getElementById('chart');

    chartEl.addEventListener('wheel', function(e) {
        // ctrlKey is true for trackpad pinch gestures
        if (!e.ctrlKey) return; // ignore regular scroll — do nothing

        e.preventDefault();

        const gd = chartEl;
        if (!gd._fullLayout) return;

        const xa = gd._fullLayout.xaxis;
        const ya = gd._fullLayout.yaxis;
        const plotArea = gd._fullLayout._size;
        const rect = gd.getBoundingClientRect();

        const plotLeft = rect.left + plotArea.l;
        const plotTop = rect.top + plotArea.t;
        const plotWidth = plotArea.w;
        const plotHeight = plotArea.h;

        // Fraction of cursor within plot area
        const fx = Math.max(0, Math.min(1, (e.clientX - plotLeft) / plotWidth));
        const fy = Math.max(0, Math.min(1, 1 - (e.clientY - plotTop) / plotHeight));

        // Zoom factor: positive deltaY = zoom out, negative = zoom in
        const zoomSpeed = 0.01;
        const scale = 1 + e.deltaY * zoomSpeed;

        const xRange = [xa.range[0], xa.range[1]];
        const yRange = [ya.range[0], ya.range[1]];
        const xSpan = xRange[1] - xRange[0];
        const ySpan = yRange[1] - yRange[0];

        const newXSpan = xSpan * scale;
        const newYSpan = ySpan * scale;
        const autoscaleBounds = getAutoscaleBounds(currentFilteredData);
        if (scale > 1 && autoscaleBounds && viewCoversDataBounds(currentFilteredData, xRange, yRange)) {
            return;
        }

        const xCenter = xRange[0] + fx * xSpan;
        const yCenter = yRange[0] + fy * ySpan;

        let newXRange = [
            xCenter - fx * newXSpan,
            xCenter + (1 - fx) * newXSpan
        ];
        let newYRange = [
            yCenter - fy * newYSpan,
            yCenter + (1 - fy) * newYSpan
        ];
        if (scale > 1 && autoscaleBounds) {
            newXRange = clampRangeToBounds(newXRange, autoscaleBounds.x);
            newYRange = clampRangeToBounds(newYRange, autoscaleBounds.y);
        }

        Plotly.relayout(chartEl, {
            'xaxis.range': newXRange,
            'yaxis.range': newYRange,
            'xaxis.autorange': false,
            'yaxis.autorange': false
        });
    }, { passive: false });
})();

// Pinch-to-zoom for mobile (throttled with rAF for smooth performance)
(function() {
    const chartEl = document.getElementById('chart');
    let pinchStartDist = null;
    let pinchStartRanges = null;
    let pinchCenter = null;
    let rafId = null;          // requestAnimationFrame handle
    let pendingLayout = null;  // latest computed ranges waiting for rAF

    function getTouchDist(t1, t2) {
        const dx = t1.clientX - t2.clientX;
        const dy = t1.clientY - t2.clientY;
        return Math.sqrt(dx * dx + dy * dy);
    }

    function getTouchCenter(t1, t2) {
        return {
            x: (t1.clientX + t2.clientX) / 2,
            y: (t1.clientY + t2.clientY) / 2
        };
    }

    function getPlotFraction(clientX, clientY) {
        const gd = chartEl;
        const plotArea = gd._fullLayout._size;
        const rect = gd.getBoundingClientRect();

        const plotLeft = rect.left + plotArea.l;
        const plotTop = rect.top + plotArea.t;
        const plotWidth = plotArea.w;
        const plotHeight = plotArea.h;

        const fx = (clientX - plotLeft) / plotWidth;
        const fy = 1 - (clientY - plotTop) / plotHeight; // invert y
        return { fx: Math.max(0, Math.min(1, fx)), fy: Math.max(0, Math.min(1, fy)) };
    }

    function flushLayout() {
        rafId = null;
        if (!pendingLayout) return;
        Plotly.relayout(chartEl, pendingLayout);
        pendingLayout = null;
    }

    function scheduleLayout(layout) {
        pendingLayout = layout;
        if (!rafId) {
            rafId = requestAnimationFrame(flushLayout);
        }
    }

    chartEl.addEventListener('touchstart', function(e) {
        if (e.touches.length === 2) {
            e.preventDefault();
            const t1 = e.touches[0];
            const t2 = e.touches[1];
            pinchStartDist = getTouchDist(t1, t2);
            pinchCenter = getTouchCenter(t1, t2);

            const gd = chartEl;
            if (gd._fullLayout) {
                const xa = gd._fullLayout.xaxis;
                const ya = gd._fullLayout.yaxis;
                pinchStartRanges = {
                    x: [xa.range[0], xa.range[1]],
                    y: [ya.range[0], ya.range[1]]
                };
            }
        }
    }, { passive: false });

    chartEl.addEventListener('touchmove', function(e) {
        if (e.touches.length === 2 && pinchStartDist && pinchStartRanges) {
            e.preventDefault();
            const t1 = e.touches[0];
            const t2 = e.touches[1];
            const currentDist = getTouchDist(t1, t2);

            // zoom factor: >1 means zooming out, <1 means zooming in
            const scale = pinchStartDist / currentDist;

            // Use the live midpoint of the two fingers so panning feels natural
            const liveCenter = getTouchCenter(t1, t2);
            const frac = getPlotFraction(liveCenter.x, liveCenter.y);

            const xRange = pinchStartRanges.x;
            const yRange = pinchStartRanges.y;
            const xSpan = xRange[1] - xRange[0];
            const ySpan = yRange[1] - yRange[0];

            const newXSpan = xSpan * scale;
            const newYSpan = ySpan * scale;
            const autoscaleBounds = getAutoscaleBounds(currentFilteredData);
            if (scale > 1 && autoscaleBounds && viewCoversDataBounds(currentFilteredData, xRange, yRange)) {
                return;
            }

            // Keep the pinch center point fixed
            const xCenter = xRange[0] + frac.fx * xSpan;
            const yCenter = yRange[0] + frac.fy * ySpan;

            let newXRange = [
                xCenter - frac.fx * newXSpan,
                xCenter + (1 - frac.fx) * newXSpan
            ];
            let newYRange = [
                yCenter - frac.fy * newYSpan,
                yCenter + (1 - frac.fy) * newYSpan
            ];
            if (scale > 1 && autoscaleBounds) {
                newXRange = clampRangeToBounds(newXRange, autoscaleBounds.x);
                newYRange = clampRangeToBounds(newYRange, autoscaleBounds.y);
            }

            // Schedule the relayout for the next animation frame instead of
            // calling it synchronously on every touchmove event.
            scheduleLayout({
                'xaxis.range': newXRange,
                'yaxis.range': newYRange,
                'xaxis.autorange': false,
                'yaxis.autorange': false
            });
        }
    }, { passive: false });

    chartEl.addEventListener('touchend', function(e) {
        if (e.touches.length < 2) {
            // Flush any pending update immediately so the final state is accurate
            if (rafId) {
                cancelAnimationFrame(rafId);
                rafId = null;
            }
            if (pendingLayout) {
                Plotly.relayout(chartEl, pendingLayout);
                pendingLayout = null;
            }
            pinchStartDist = null;
            pinchStartRanges = null;
            pinchCenter = null;
        }
    });
})();

// Initialize
window.addEventListener('resize', function() {
    Plotly.Plots.resize('chart');
    if (hasPlotted) {
        updateChart({ preserveRanges: true });
    }
});

// Country selector logic
function initCountrySelector() {
    const selector = document.getElementById('countrySelector');
    selector.addEventListener('click', (e) => {
        const btn = e.target.closest('.country-btn');
        if (!btn) return;
        const country = btn.dataset.country;
        if (country === selectedCountry) return;
        selectedCountry = country;
        selector.querySelectorAll('.country-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        pushFiltersToUrl();
        // Re-render detail panels if rubbers are selected
        if (selectedRubbers[0]) updateDetailPanel(1, selectedRubbers[0]);
        if (selectedRubbers[1]) updateDetailPanel(2, selectedRubbers[1]);
    });
}

async function initializeApp() {
    const chart = document.getElementById('chart');
    if (chart) {
        chart.innerHTML = '<div style="padding: 20px; color: #9b9484;">Loading rubber data…</div>';
    }

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
        if (chart) {
            chart.innerHTML = '<div style="padding: 20px; color: #cf5555; line-height: 1.6;">' + msg + '</div>';
        }
        return;
    }

    if (chart) {
        chart.innerHTML = '';
    }
    initCountrySelector();
    initFilters();
    applyFiltersFromUrl();
    initChart();
}

initializeApp();
