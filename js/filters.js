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

// ── Weight range filter helpers ──

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
            <input id="hardnessMinSlider" type="range" min="${bounds.min}" max="${bounds.max}" value="${bounds.min}" step="2.5">
            <input id="hardnessMaxSlider" type="range" min="${bounds.min}" max="${bounds.max}" value="${bounds.max}" step="2.5">
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
//  Control Toggle Filter (5 manual levels)
// ════════════════════════════════════════════════════════════

const CONTROL_LEVEL_COUNT = 5;
const CONTROL_LEVELS = [5, 4, 3, 2, 1];

function hasControlLevelData() {
    return rubberData.some(r => Number.isFinite(r.controlLevel));
}

function resetControlToAllTiers() {
    controlFilterState.selectedLevels = new Set(CONTROL_LEVELS);
    syncControlPillUI();
}

function syncControlPillUI() {
    document.querySelectorAll('#controlFilter .fp-pill').forEach(pill => {
        const level = parseInt(pill.dataset.level, 10);
        const cb = pill.querySelector('input[type="checkbox"]');
        const isActive = controlFilterState.selectedLevels.has(level);
        if (cb) cb.checked = isActive;
        pill.classList.toggle('active', isActive);
    });
}

function isControlFilterActive() {
    return controlFilterState.selectedLevels.size < CONTROL_LEVEL_COUNT;
}

function initControlToggleFilter(onChange) {
    const container = document.getElementById('controlFilter');
    if (!container) return;

    if (!hasControlLevelData()) {
        container.innerHTML = '<div class="filter-instructions">No control level data available.</div>';
        return;
    }

    controlFilterState.selectedLevels = new Set(CONTROL_LEVELS);

    container.innerHTML = '';
    const group = document.createElement('div');
    group.className = 'fp-pill-group';

    const lessLabel = document.createElement('span');
    lessLabel.className = 'control-guide-label';
    lessLabel.textContent = 'Less';
    group.appendChild(lessLabel);

    CONTROL_LEVELS.forEach(level => {
        const pill = document.createElement('label');
        pill.className = `fp-pill control-level-pill control-level-${level} active`;
        pill.dataset.level = level;
        pill.setAttribute('aria-label', `Control level ${level}`);

        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.checked = true;
        cb.value = String(level);
        pill.appendChild(cb);

        group.appendChild(pill);

        cb.addEventListener('change', () => {
            if (cb.checked) {
                controlFilterState.selectedLevels.add(level);
            } else {
                controlFilterState.selectedLevels.delete(level);
            }
            pill.classList.toggle('active', cb.checked);
            onChange();
        });
    });

    const moreLabel = document.createElement('span');
    moreLabel.className = 'control-guide-label';
    moreLabel.textContent = 'More';
    group.appendChild(moreLabel);

    container.appendChild(group);
}

function positionSegSlider(seg) {
    const slider = seg.querySelector('.fp-seg-slider');
    const activeBtn = seg.querySelector('.fp-seg-btn.active');
    if (!slider || !activeBtn) return;
    slider.style.width = activeBtn.offsetWidth + 'px';
    slider.style.transform = `translateX(${activeBtn.offsetLeft}px)`;
}

function initTop30Filter(onChange) {
    const container = document.getElementById('top30Filter');
    if (!container) return;

    container.innerHTML = '';
    const seg = document.createElement('div');
    seg.className = 'fp-seg';

    const slider = document.createElement('div');
    slider.className = 'fp-seg-slider';
    seg.appendChild(slider);

    ['All', 'Top 30'].forEach(label => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'fp-seg-btn';
        btn.dataset.value = label === 'All' ? 'all' : 'top30';
        btn.textContent = label;
        if (label === 'All') btn.classList.add('active');
        btn.addEventListener('click', () => {
            seg.querySelector('.fp-seg-btn.active')?.classList.remove('active');
            btn.classList.add('active');
            positionSegSlider(seg);
            top30FilterActive = btn.dataset.value === 'top30';
            onChange();
        });
        seg.appendChild(btn);
    });

    container.appendChild(seg);
    requestAnimationFrame(() => positionSegSlider(seg));
}

const SHEET_DOT_CLASS = { Tension: 'dot-circle', Chinese: 'dot-square', Hybrid: 'dot-diamond' };
const SHEET_I18N_KEYS = { Tension: 'TENSION', Chinese: 'CHINESE', Hybrid: 'HYBRID' };
const SHEET_INITIAL_BY_LANG = {
    ko: { Tension: '텐', Chinese: '점', Hybrid: '하' },
    cn: { Tension: '经', Chinese: '粘', Hybrid: '混' }
};

function getLocalizedSheetLabelParts(sheet) {
    const sheetI18nKey = SHEET_I18N_KEYS[sheet] || sheet;
    const localizedSheet = tUi(sheetI18nKey);
    const chars = Array.from(localizedSheet);
    const fallbackInitial = chars[0] || '';
    const fallbackRemainder = chars.slice(1).join('');
    const lang = typeof getCurrentLang === 'function' ? getCurrentLang() : 'en';
    const initialOverride = SHEET_INITIAL_BY_LANG[lang]?.[sheet] || null;
    if (initialOverride) {
        const remainder = localizedSheet.startsWith(initialOverride)
            ? localizedSheet.slice(initialOverride.length)
            : fallbackRemainder;
        return {
            key: sheetI18nKey,
            initial: initialOverride,
            remainder
        };
    }

    return {
        key: sheetI18nKey,
        initial: fallbackInitial,
        remainder: fallbackRemainder
    };
}

function refreshSheetToggleFilterLabels() {
    document.querySelectorAll('#sheetFilter .sheet-pill-value').forEach((valueEl) => {
        const sheet = valueEl.dataset.sheet;
        if (!sheet) return;
        const { initial, remainder } = getLocalizedSheetLabelParts(sheet);
        const initialEl = valueEl.querySelector('.chart-hover-shape > span');
        const textEl = valueEl.querySelector('.sheet-pill-text');
        if (initialEl) initialEl.textContent = initial;
        if (textEl) textEl.textContent = remainder;
    });
}

function initSheetToggleFilter(onChange) {
    const container = document.getElementById('sheetFilter');
    if (!container) return;

    container.innerHTML = '';
    const group = document.createElement('div');
    group.className = 'fp-pill-group';

    ['Tension', 'Chinese', 'Hybrid'].forEach(sheet => {
        const pill = document.createElement('label');
        pill.className = 'fp-pill active';

        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.checked = true;
        cb.value = sheet;
        pill.appendChild(cb);

        const sheetValue = document.createElement('span');
        sheetValue.className = 'chart-sheet-value sheet-pill-value';
        sheetValue.dataset.sheet = sheet;

        const { key, initial, remainder } = getLocalizedSheetLabelParts(sheet);
        const shape = document.createElement('span');
        shape.className = `chart-hover-shape ${SHEET_DOT_CLASS[sheet] || 'dot-circle'}`;
        const shapeInitial = document.createElement('span');
        shapeInitial.textContent = initial;
        shape.appendChild(shapeInitial);
        sheetValue.appendChild(shape);

        const sheetLabel = document.createElement('span');
        sheetLabel.className = 'sheet-pill-text';
        sheetLabel.dataset.i18nKey = key;
        sheetLabel.textContent = remainder;
        sheetValue.appendChild(sheetLabel);

        pill.appendChild(sheetValue);
        group.appendChild(pill);

        cb.addEventListener('change', () => {
            pill.classList.toggle('active', cb.checked);
            onChange();
        });
    });

    container.appendChild(group);
    refreshSheetToggleFilterLabels();
}

function filterOptions(container, query) {
    const q = query.trim().toLowerCase();
    container.querySelectorAll('.filter-option').forEach(option => {
        const match = option.textContent.toLowerCase().includes(q) ||
            (option.dataset.search && option.dataset.search.toLowerCase().includes(q));
        option.style.display = match ? 'flex' : 'none';
    });
}

function buildCheckboxOptions(container, values, checkedValues) {
    const isToggleGroup = container.classList.contains('toggle-group');
    const frag = document.createDocumentFragment();

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

        if (item.searchTerms) label.dataset.search = item.searchTerms;

        const text = document.createElement('span');
        text.textContent = labelText;
        if (isToggleGroup) text.classList.add('toggle-pill');
        label.appendChild(text);

        frag.appendChild(label);
    }

    container.innerHTML = '';
    container.appendChild(frag);
}

function buildNameOptionsFromFilters() {
    const nameFilter = document.getElementById('nameFilter');
    const selectedBrands = new Set(getCheckedValues('brandFilter'));
    const selectedSheet = new Set(getCheckedValues('sheetFilter'));
    const previousSelections = new Set(getCheckedValues('nameFilter'));
    const previousNames = new Set(getAllCheckboxValues('nameFilter'));

    if (selectedBrands.size === 0) {
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
    const selectedLevels = controlFilterState.selectedLevels;

    const filtered = rubberData.filter(rubber =>
        selectedBrands.has(rubber.brand) &&
        (selectedSheet.size === 0 || selectedSheet.has(rubber.sheet)) &&
        (!filterByHardness || (Number.isFinite(rubber.normalizedHardness) && rubber.normalizedHardness >= minHardness && rubber.normalizedHardness <= maxHardness)) &&
        (!filterByWeight || (Number.isFinite(rubber.weight) && rubber.weight >= minWeight && rubber.weight <= maxWeight)) &&
        (!filterByControl || selectedLevels.has(rubber.controlLevel)) &&
        (!top30FilterActive || top30Set.has(rubber.fullName))
    );

    const seenNames = new Map();
    for (const r of filtered) {
        if (!seenNames.has(r.abbr)) seenNames.set(r.abbr, r);
    }
    const uniqueNames = [...seenNames.keys()].sort();

    const nameOptions = uniqueNames.map(name => {
        const rubber = seenNames.get(name);
        const terms = [];
        for (const m of Object.values(BRAND_NAMES_I18N)) {
            if (m[rubber.brand]) terms.push(m[rubber.brand]);
        }
        terms.push(...getRubberLocalizedSearchTerms(rubber));
        return {
            value: name,
            label: tRubber(name),
            swatchColor: getBrandColor(rubber.brand),
            searchTerms: terms.length ? terms.join(' ') : undefined
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
    const body = document.getElementById('filterPanelBody');
    const trigger = document.getElementById('filterTrigger');
    if (!body || !trigger) return;

    if (filterPanelOpen) {
        // Force reflow so the transition from max-height:0 works
        void body.offsetHeight;
        body.classList.add('open');
        trigger.setAttribute('aria-expanded', 'true');
    } else {
        body.classList.remove('open');
        trigger.setAttribute('aria-expanded', 'false');
    }
}

function closeFilterPanel() {
    if (!filterPanelOpen) return;
    toggleFilterPanel();
}

function updateFilterSummary(filteredCount) {
    const summary = document.getElementById('filterSummary');
    if (!summary) return;

    const count = filteredCount ?? getFilteredData().length;
    summary.textContent = `(${count} rubbers)`;
}
