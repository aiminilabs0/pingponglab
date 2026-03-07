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
        const filtered = getFilteredData();
        updateFilterSummary(filtered.length);
        pushFiltersToUrl();
        const isRangeFilter = filterId === 'hardness' || filterId === 'weight';
        if (isRangeFilter) {
            updateChart({ _cachedFilteredData: filtered });
        } else {
            animateChartUpdate({ _cachedFilteredData: filtered });
        }
    }

    initSheetToggleFilter(() => onFilterChange('sheet'));
    initHardnessRangeFilter(() => onFilterChange('hardness'));
    initWeightRangeFilter(() => onFilterChange('weight'));
    initControlToggleFilter(() => onFilterChange('control'));
    initTop30Filter(() => onFilterChange('top30'));
    buildNameOptionsFromFilters();

    // Filter change listeners (checkbox-based filters only)
    FILTER_IDS.filter(id => id !== 'weight' && id !== 'hardness' && id !== 'control' && id !== 'sheet' && id !== 'top30').forEach(id => {
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

    // Clear all filters → reset to all selected
    document.getElementById('clearAllFilters').addEventListener('click', () => {
        resetFiltersToAll();
        updateFilterSummary();
        pushFiltersToUrl();
        animateChartUpdate();
    });

    updateFilterSummary();
}

function initCountrySelector() {
    const selector = document.getElementById('countrySelector');
    if (!selector) return;

    const isMobileViewport = () => window.matchMedia('(max-width: 768px)').matches;
    const closeCountryMenu = () => selector.classList.remove('is-open');

    function applyCountrySelection(nextCountry) {
        if (!['us', 'eu', 'cn', 'kr'].includes(nextCountry)) return;
        if (nextCountry === selectedCountry) return;

        selectedCountry = nextCountry;
        syncCountrySelectorUI();

        // Pop animation on newly active flag
        const activeBtn = selector.querySelector(`.country-btn[data-country="${nextCountry}"]`);
        if (activeBtn) {
            activeBtn.classList.remove('country-btn--pop');
            void activeBtn.offsetWidth;
            activeBtn.classList.add('country-btn--pop');
            activeBtn.addEventListener('animationend', () => activeBtn.classList.remove('country-btn--pop'), { once: true });
        }

        // Crossfade content pane
        const pane = document.getElementById('contentPane');
        if (pane && (selectedRubbers[0] || selectedRubbers[1])) {
            _countrySwitchFade = true;
            pane.classList.add('content-pane--country-fade');
        }

        pushFiltersToUrl();
        if (selectedRubbers[0]) updateDetailPanel(1, selectedRubbers[0]);
        if (selectedRubbers[1]) updateDetailPanel(2, selectedRubbers[1]);
        updateComparisonBar();
        renderTabs();
    }

    syncCountrySelectorUI();

    selector.addEventListener('click', (e) => {
        const btn = e.target.closest('.country-btn');
        if (!btn) return;
        const isOpen = selector.classList.contains('is-open');

        // Mobile: first tap on active flag opens compact menu.
        if (isMobileViewport() && !isOpen && btn.dataset.country === selectedCountry) {
            selector.classList.add('is-open');
            return;
        }

        // Mobile: tap current flag again in open state closes menu.
        if (isMobileViewport() && isOpen && btn.dataset.country === selectedCountry) {
            closeCountryMenu();
            return;
        }

        applyCountrySelection(btn.dataset.country);
        if (isMobileViewport()) closeCountryMenu();
    });

    document.addEventListener('click', (e) => {
        if (!isMobileViewport()) return;
        if (!selector.classList.contains('is-open')) return;
        if (selector.contains(e.target)) return;
        closeCountryMenu();
    });

    window.addEventListener('resize', () => {
        if (!isMobileViewport()) closeCountryMenu();
    });
}

function initHeaderSearch() {
    const input = document.getElementById('headerSearchInput');
    const results = document.getElementById('headerSearchResults');
    if (!input || !results) return;

    let activeIndex = -1;
    let currentMatches = [];

    function search(query) {
        const q = query.trim().toLowerCase();
        if (!q) { closeResults(); return; }

        currentMatches = rubberData
            .filter(r =>
                r.abbr.toLowerCase().includes(q) ||
                r.fullName.toLowerCase().includes(q)
            )
            .slice(0, 30);

        if (currentMatches.length === 0) {
            results.innerHTML = '<div class="header-search-no-results">No rubbers found</div>';
            results.classList.add('is-open');
            activeIndex = -1;
            return;
        }

        results.innerHTML = currentMatches.map((r, i) =>
            `<div class="header-search-result" data-index="${i}">` +
            `<span class="header-search-result-abbr">${highlightMatch(r.abbr, q)}</span>` +
            `<span class="header-search-result-brand">${r.brand}</span>` +
            `</div>`
        ).join('');
        results.classList.add('is-open');
        activeIndex = -1;
    }

    function highlightMatch(text, query) {
        const idx = text.toLowerCase().indexOf(query);
        if (idx === -1) return escapeHtml(text);
        return escapeHtml(text.slice(0, idx)) +
            '<mark style="background:rgba(218,138,82,0.3);color:inherit;border-radius:2px;padding:0 1px">' +
            escapeHtml(text.slice(idx, idx + query.length)) + '</mark>' +
            escapeHtml(text.slice(idx + query.length));
    }

    function escapeHtml(s) {
        return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    function selectResult(rubber) {
        handleRubberClick(rubber);
        input.value = '';
        closeResults();
        input.blur();
        trackSearchSelectEvent(rubber);
    }

    function closeResults() {
        results.classList.remove('is-open');
        results.innerHTML = '';
        activeIndex = -1;
        currentMatches = [];
    }

    function setActive(index) {
        const items = results.querySelectorAll('.header-search-result');
        items.forEach(el => el.classList.remove('is-active'));
        if (index >= 0 && index < items.length) {
            items[index].classList.add('is-active');
            items[index].scrollIntoView({ block: 'nearest' });
        }
        activeIndex = index;
    }

    input.addEventListener('input', () => search(input.value));

    input.addEventListener('keydown', (e) => {
        const items = results.querySelectorAll('.header-search-result');
        if (!results.classList.contains('is-open') || items.length === 0) {
            if (e.key === 'Escape') { input.blur(); closeResults(); }
            return;
        }

        if (e.key === 'ArrowDown') {
            e.preventDefault();
            setActive(activeIndex < items.length - 1 ? activeIndex + 1 : 0);
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setActive(activeIndex > 0 ? activeIndex - 1 : items.length - 1);
        } else if (e.key === 'Enter') {
            e.preventDefault();
            if (activeIndex >= 0 && currentMatches[activeIndex]) {
                selectResult(currentMatches[activeIndex]);
            } else if (currentMatches.length > 0) {
                selectResult(currentMatches[0]);
            }
        } else if (e.key === 'Escape') {
            closeResults();
            input.blur();
        }
    });

    results.addEventListener('click', (e) => {
        const item = e.target.closest('.header-search-result');
        if (!item) return;
        const idx = parseInt(item.dataset.index, 10);
        if (currentMatches[idx]) selectResult(currentMatches[idx]);
    });

    document.addEventListener('click', (e) => {
        if (!e.target.closest('#headerSearch')) closeResults();
    });
}

function trackSearchSelectEvent(rubber) {
    if (typeof window.gtag !== 'function' || isAnalyticsBlockedUser()) return;
    window.gtag('event', 'search_select', {
        event_category: 'Search',
        event_label: rubber.fullName
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
    const messageInput = document.getElementById('feedbackMessage');
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

    function buildComparisonRequestMessage(leftName, rightName) {
        const left = (leftName || '').trim();
        const right = (rightName || '').trim();
        if (left && right) return `Please add a rubber comparison for "${left}" vs "${right}".`;
        return 'Please add this rubber comparison.';
    }

    function openFeedbackModal(options = {}) {
        const prefillMessage = typeof options.prefillMessage === 'string' ? options.prefillMessage : '';
        closeFilterPanel();
        clearCloseTimer();
        modal.classList.add('open');
        modal.setAttribute('aria-hidden', 'false');
        document.body.style.overflow = 'hidden';
        form.reset();
        showFormState();
        setFeedbackStatus('We\u2019ll get back to you as soon as possible.');
        if (messageInput && prefillMessage.trim()) {
            messageInput.value = prefillMessage;
        }
        setSubmittingState(false);
        setTimeout(() => {
            if (emailInput) {
                try { emailInput.focus({ preventScroll: true }); } catch { emailInput.focus(); }
            }
        }, 50);
    }

    openBtn.addEventListener('click', openFeedbackModal);
    document.addEventListener('click', (e) => {
        const requestBtn = e.target.closest('[data-feedback-request-comparison="true"]');
        if (!requestBtn) return;
        const prefillMessage = buildComparisonRequestMessage(
            requestBtn.dataset.leftRubber,
            requestBtn.dataset.rightRubber
        );
        openFeedbackModal({ prefillMessage });
    });
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

            showConfirmationState('We\u2019ll get back to you as soon as possible.');
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
    trackAppLoadedEvent();

    const chart = document.getElementById('chart');
    if (chart) chart.innerHTML = '<div style="padding: 20px; color: #9b9484;">Loading rubber data\u2026</div>';

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
    initAuth();
    initCountrySelector();
    initHomeLogo();
    initHeaderSearch();
    initFeedbackModal();
    initFilters();

    // Tab click listener
    document.getElementById('contentTabs').addEventListener('click', (e) => {
        const tab = e.target.closest('.content-tab');
        if (!tab || tab.classList.contains('content-tab--active')) return;
        setActiveTab(tab.dataset.tab);
    });

    document.getElementById('contentBody').addEventListener('click', (e) => {
        const voteBtn = e.target.closest('[data-feedback-vote]');
        if (!voteBtn) return;

        trackContentFeedbackVote(voteBtn.dataset.feedbackVote, {
            contentType: voteBtn.dataset.feedbackScope,
            tabId: voteBtn.dataset.feedbackTab,
            rubberName: voteBtn.dataset.feedbackRubberName,
            leftRubber: voteBtn.dataset.feedbackLeftRubber,
            rightRubber: voteBtn.dataset.feedbackRightRubber
        });
    });

    // Pin button click listener (event delegation)
    document.getElementById('radarSection').addEventListener('click', (e) => {
        const btn = e.target.closest('.radar-pin-btn');
        if (!btn) return;
        const idx = parseInt(btn.dataset.panelIndex, 10);
        const other = idx === 0 ? 1 : 0;
        pinnedRubbers[idx] = !pinnedRubbers[idx];
        // Only one side can be pinned at a time
        if (pinnedRubbers[idx]) pinnedRubbers[other] = false;
        updateRadarChart();
        pushFiltersToUrl();
    });

    applyFiltersFromUrl();
    if (!activeTab) {
        renderTabs();
        setActiveTab('desc1');
    }
    updateRadarChart();
    startRadarAutoRotate();
    initRadarDodge();
    initChart();
    // Apply initial autoscale on first load.
    requestAnimationFrame(() => {
        triggerAutoscale();
    });

    // Keep zoom hint state in sync when switching mobile/desktop.
    const zoomHint = document.getElementById('zoomHint');
    const mobileQuery = window.matchMedia('(max-width: 768px)');
    const syncZoomHintVisibility = () => {
        if (!zoomHint) return;
        if (mobileQuery.matches) {
            zoomHint.classList.add('is-visible');
        } else {
            zoomHint.classList.remove('is-visible', 'is-fading');
        }
    };
    syncZoomHintVisibility();
    if (typeof mobileQuery.addEventListener === 'function') {
        mobileQuery.addEventListener('change', syncZoomHintVisibility);
    } else if (typeof mobileQuery.addListener === 'function') {
        mobileQuery.addListener(syncZoomHintVisibility);
    }
}

initializeApp();
