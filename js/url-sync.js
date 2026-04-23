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

// ── Document title ──

function updateDocumentTitle() {
    const left = selectedRubbers[0];
    const right = selectedRubbers[1];

    if (activeTab === 'comparison' && left && right) {
        document.title = left.abbr + ' vs ' + right.abbr + ' | PingPongLab';
    } else if (activeTab === 'desc2' && right) {
        document.title = right.abbr + ' | PingPongLab';
    } else if (left) {
        document.title = left.abbr + ' | PingPongLab';
    } else if (typeof window !== 'undefined' && window.__SEO_PAGE__ && window.__SEO_PAGE__.title) {
        // SEO landing pages (e.g. /en/top-10-…): keep the server-rendered title
        // while no rubber is selected so crawlers / social shares see it.
        document.title = window.__SEO_PAGE__.title;
    } else {
        document.title = 'PingPongLab | Best Rubber';
    }
}

// ── Path construction ──

/**
 * True when the active SEO landing page's preset rubber selection exactly
 * matches the current `#nameFilter` checkbox state. Used so we can keep the
 * pretty SEO URL (no `?rubbers=…`) while the user hasn't diverged from the
 * preset, and fall back to the standard homepage path + query once they do.
 */
function seoPagePresetMatchesCurrentSelection() {
    if (typeof window === 'undefined' || !window.__SEO_PAGE__) return false;
    const preset = window.__SEO_PAGE__;
    if (!Array.isArray(preset.rubbers) || preset.rubbers.length === 0) return false;
    const checked = getCheckedValues('nameFilter');
    if (checked.length !== preset.rubbers.length) return false;
    const presetSet = new Set(preset.rubbers);
    return checked.every(v => presetSet.has(v));
}

/**
 * Build the path portion of the current URL from app state.
 * Returns e.g. "/en/", "/en/rubbers/tenergy-05", "/ko/rubbers/compare/a-vs-b"
 */
function buildCurrentPath() {
    const country = selectedCountry || 'en';
    const left = selectedRubbers[0];
    const right = selectedRubbers[1];

    if (left && right && SLUG_MAP) {
        const slugA = SLUG_MAP.abbrToSlug[left.abbr];
        const slugB = SLUG_MAP.abbrToSlug[right.abbr];
        if (slugA && slugB) {
            const [a, b] = [slugA, slugB].sort();
            return '/' + country + '/rubbers/compare/' + a + '-vs-' + b;
        }
    }

    // Determine the "active" rubber based on current tab (only one rubber selected)
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

    // Preserve the SEO landing page URL while no rubber is selected and the
    // user's filter state still matches the preset (so filter tweaks don't
    // rewrite the pretty URL to /{country}/?rubbers=…). Only valid while we
    // stay in the SEO page's original country — country switches navigate
    // away via a full reload (see initCountrySelector).
    const seo = window.__SEO_PAGE__;
    if (seo && seo.slug && (!seo.country || seo.country === country) && seoPagePresetMatchesCurrentSelection()) {
        return '/' + country + '/' + seo.slug;
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
    // Skip serializing rubbers when the selection matches the SEO preset —
    // the preset is restored from window.__SEO_PAGE__ on reload, so the URL
    // stays clean (e.g. /en/top-10-…) without a redundant ?rubbers=… tail.
    const onSeoPage = seoPagePresetMatchesCurrentSelection();
    if (!onSeoPage && checkedRubbers.length > 0 && checkedRubbers.length < allRubbers.length) {
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
    const hash = window.location.hash || '';
    history.replaceState(null, '', path + (qs ? '?' + qs : '') + hash);
}

/**
 * Navigate to a new path via pushState (creates history entry for back/forward).
 * Used for rubber clicks, country switches, and tab changes that change the page identity.
 */
function navigateToPath(path) {
    const qs = buildFilterQueryString();
    const hash = window.location.hash || '';
    const fullUrl = path + (qs ? '?' + qs : '') + hash;
    history.pushState(null, '', fullUrl);
}

function syncCountrySelectorUI() {
    document.querySelectorAll('#countrySelector .country-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.country === selectedCountry);
    });
    positionCountryPill();
}

function applyFiltersFromUrl() {
    const params = new URLSearchParams(window.location.search);
    const filterKeys = ['brands', 'rubbers', 'sheet', 'hardness', 'weight', 'control', 'top30', 'pin'];
    const hasAnyFilter = filterKeys.some(key => params.has(key));

    // SEO landing pages inject a preset rubber list via window.__SEO_PAGE__.
    // Apply it only when the URL doesn't already specify one so user-shared
    // filter URLs keep taking precedence.
    if (!hasAnyFilter && typeof window !== 'undefined' && window.__SEO_PAGE__) {
        const preset = window.__SEO_PAGE__;
        if (Array.isArray(preset.rubbers) && preset.rubbers.length > 0) {
            params.set('rubbers', preset.rubbers.map(n => n.replace(/ /g, '-')).join(','));
        }
    }

    if (![...params.keys()].some(k => filterKeys.includes(k))) return;

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
