// ════════════════════════════════════════════════════════════
//  URL State Sync (path-based clean URLs + query-param filters)
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
    params.set('control', [...controlFilterState.selectedLevels].sort().join(','));
}

function deserializeControlRangeParam(params) {
    if (!params.has('control')) return;
    const levels = params.get('control').split(',')
        .map(Number)
        .filter(n => CONTROL_LEVELS.includes(n));
    if (levels.length === 0) return;
    controlFilterState.selectedLevels = new Set(levels);
    syncControlPillUI();
}

// ── Path construction ──

/**
 * Build the path portion of the current URL from app state.
 * Returns e.g. "/us/", "/us/rubbers/tenergy-05", "/kr/rubbers/compare/a-vs-b"
 */
function buildCurrentPath() {
    const country = selectedCountry || 'en';
    const left = selectedRubbers[0];
    const right = selectedRubbers[1];

    if (activeTab === 'comparison' && left && right && SLUG_MAP) {
        const slugA = SLUG_MAP.abbrToSlug[left.abbr];
        const slugB = SLUG_MAP.abbrToSlug[right.abbr];
        if (slugA && slugB) {
            const [a, b] = [slugA, slugB].sort();
            return '/' + country + '/rubbers/compare/' + a + '-vs-' + b;
        }
    }

    // Determine the "active" rubber based on current tab
    let activeRubber = null;
    if (activeTab === 'desc2' && right) {
        activeRubber = right;
    } else if (left) {
        activeRubber = left;
    }

    if (activeRubber && SLUG_MAP) {
        const slug = SLUG_MAP.abbrToSlug[activeRubber.abbr];
        if (slug) {
            return '/' + country + '/rubbers/' + slug;
        }
    }

    return '/' + country + '/';
}

/**
 * Build query string from current filter state (filters only, no rubber selection / page).
 */
function buildFilterQueryString() {
    const params = new URLSearchParams();
    if (DEBUG_MODE) params.set('debug', '');

    serializeFilterParam(params, 'brands', 'brandFilter');
    const allRubbers = getAllCheckboxValues('nameFilter');
    const checkedRubbers = getCheckedValues('nameFilter');
    if (checkedRubbers.length > 0 && checkedRubbers.length < allRubbers.length) {
        params.set('rubbers', checkedRubbers.map(n => n.replace(/ /g, '-')).join(','));
    }
    serializeFilterParam(params, 'sheet', 'sheetFilter');
    serializeHardnessRangeParam(params);
    serializeWeightRangeParam(params);
    serializeControlRangeParam(params);
    if (top30FilterActive) params.set('top30', '1');
    if (pinnedRubbers[0]) params.set('pin', 'left');
    else if (pinnedRubbers[1]) params.set('pin', 'right');

    return params.toString();
}

/**
 * Update the browser URL to reflect the current path + filter state.
 * Uses replaceState so it doesn't create a new history entry (for filter tweaks).
 */
function pushFiltersToUrl() {
    const path = buildCurrentPath();
    const qs = buildFilterQueryString();
    history.replaceState(null, '', path + (qs ? '?' + qs : ''));
}

/**
 * Navigate to a new path via pushState (creates history entry for back/forward).
 * Used for rubber clicks, country switches, and tab changes that change the page identity.
 */
function navigateToPath(path) {
    const qs = buildFilterQueryString();
    const fullUrl = path + (qs ? '?' + qs : '');
    history.pushState(null, '', fullUrl);
}

function syncCountrySelectorUI() {
    document.querySelectorAll('#countrySelector .country-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.country === selectedCountry);
    });
}

function applyFiltersFromUrl() {
    const params = new URLSearchParams(window.location.search);
    const filterKeys = ['brands', 'rubbers', 'sheet', 'hardness', 'weight', 'control', 'top30', 'pin'];
    if (!filterKeys.some(key => params.has(key))) return;

    // Deserialize all filters that affect rubber options first
    if (params.has('brands')) deserializeFilterParam(params, 'brands', 'brandFilter');
    deserializeFilterParam(params, 'sheet', 'sheetFilter');
    deserializeHardnessRangeParam(params);
    deserializeWeightRangeParam(params);
    deserializeControlRangeParam(params);
    if (params.has('top30')) {
        top30FilterActive = true;
        const seg = document.querySelector('#top30Filter .fp-seg');
        if (seg) {
            seg.querySelector('.fp-seg-btn.active')?.classList.remove('active');
            seg.querySelector('.fp-seg-btn[data-value="top30"]')?.classList.add('active');
            positionSegSlider(seg);
        }
    }

    // Rebuild rubber options from all filters, then restore rubber selections
    buildNameOptionsFromFilters();
    // Rubber names: match dash-encoded URL values against abbr checkboxes
    if (params.has('rubbers')) {
        const urlValues = params.get('rubbers').split(',').filter(Boolean);
        document.querySelectorAll('#nameFilter input[type="checkbox"]').forEach(cb => {
            cb.checked = urlValues.includes(cb.value.replace(/ /g, '-'));
            const pill = cb.closest('.fp-pill');
            if (pill) pill.classList.toggle('active', cb.checked);
        });
    }

    // Restore pin state
    if (params.has('pin')) {
        const pin = params.get('pin');
        if (pin === 'left' && selectedRubbers[0]) pinnedRubbers[0] = true;
        else if (pin === 'right' && selectedRubbers[1]) pinnedRubbers[1] = true;
    }

    updateFilterSummary();
}
