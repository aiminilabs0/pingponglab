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
    if (top30FilterActive) params.set('top30', '1');

    if (selectedCountry !== 'us') params.set('country', selectedCountry);
    if (selectedRubbers[0]) params.set('left', selectedRubbers[0].fullName);
    if (selectedRubbers[1]) params.set('right', selectedRubbers[1].fullName);
    if (activeTab === 'desc1') params.set('page', 'rubber1');
    else if (activeTab === 'desc2') params.set('page', 'rubber2');
    else if (activeTab === 'comparison') params.set('page', 'comparison');
    if (pinnedRubbers[0]) params.set('pin', 'left');
    else if (pinnedRubbers[1]) params.set('pin', 'right');

    const qs = params.toString();
    history.replaceState(null, '', window.location.pathname + (qs ? '?' + qs : ''));
}

function syncCountrySelectorUI() {
    document.querySelectorAll('#countrySelector .country-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.country === selectedCountry);
    });
}

function applyFiltersFromUrl() {
    const params = new URLSearchParams(window.location.search);
    const filterKeys = ['brands', 'rubbers', 'sheet', 'hardness', 'weight', 'control', 'top30', 'country', 'left', 'right', 'page', 'pin'];
    if (!filterKeys.some(key => params.has(key))) return;

    // Country
    if (params.has('country')) {
        const country = params.get('country');
        if (['us', 'eu', 'kr', 'cn'].includes(country)) {
            selectedCountry = country;
            applyLocalizedStaticText();
            syncCountrySelectorUI();
        }
    }

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

    // Restore pin state
    if (params.has('pin')) {
        const pin = params.get('pin');
        if (pin === 'left' && selectedRubbers[0]) pinnedRubbers[0] = true;
        else if (pin === 'right' && selectedRubbers[1]) pinnedRubbers[1] = true;
    }

    updateRadarChart();
    updateComparisonBar();
    renderTabs();
    let requestedTab = null;
    if (params.has('page')) {
        const page = params.get('page');
        if (page === 'rubber1') requestedTab = 'desc1';
        else if (page === 'rubber2') requestedTab = 'desc2';
        else if (page === 'comparison') requestedTab = 'comparison';
    }
    const canOpenRequestedTab =
        (requestedTab === 'desc1' && selectedRubbers[0]) ||
        (requestedTab === 'desc2' && selectedRubbers[1]) ||
        (requestedTab === 'comparison' && selectedRubbers[0] && selectedRubbers[1]);
    const initialTab = canOpenRequestedTab ? requestedTab : lastRestoredTab;
    if (initialTab) setActiveTab(initialTab);
    updateFilterSummary();
}
