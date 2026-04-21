// ════════════════════════════════════════════════════════════
//  Initialization
// ════════════════════════════════════════════════════════════

function initFilters() {
    const brands = [...new Set(rubberData.map(r => r.brand))].sort();

    buildCheckboxOptions(
        document.getElementById('brandFilter'),
        brands.map(b => ({ value: b, label: tBrand(b), swatchColor: getBrandColor(b) }))
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

function positionCountryPill(selectorEl) {
    const sel = selectorEl || document.getElementById('countrySelector');
    if (!sel) return;
    const activeBtn = sel.querySelector('.country-btn.active');
    if (!activeBtn) return;
    sel.style.setProperty('--pill-x', activeBtn.offsetLeft);
    sel.style.setProperty('--pill-w', activeBtn.offsetWidth);
}

function initCountrySelector() {
    const selector = document.getElementById('countrySelector');
    if (!selector) return;

    const COUNTRY_STORAGE_KEY = 'pingponglab_selected_country';
    const allowedCountries = ['en', 'cn', 'ko'];
    const persistCountry = (country) => {
        try {
            localStorage.setItem(COUNTRY_STORAGE_KEY, country);
        } catch {}
    };

    persistCountry(selectedCountry);

    const isMobileViewport = () => window.matchMedia('(max-width: 768px)').matches;
    const closeCountryMenu = () => selector.classList.remove('is-open');

    function applyCountrySelection(nextCountry) {
        if (!allowedCountries.includes(nextCountry)) return;
        if (nextCountry === selectedCountry) return;

        selectedCountry = nextCountry;
        persistCountry(nextCountry);
        applyLocalizedStaticText();

        applyRubberLocaleFilter();
        pruneInvalidRubberSelections();

        // Rebuild filter labels with translated brand/rubber names
        const brandFilter = document.getElementById('brandFilter');
        const brandChecked = new Set(getCheckedValues('brandFilter'));
        const brands = [...new Set(rubberData.map(r => r.brand))].sort();
        buildCheckboxOptions(brandFilter, brands.map(b => ({ value: b, label: tBrand(b), swatchColor: getBrandColor(b) })), brandChecked);
        buildNameOptionsFromFilters();

        // Re-render chart with translated labels
        updateChart({ preserveRanges: true, force: true });

        syncCountrySelectorUI();
        requestAnimationFrame(() => positionCountryPill(selector));

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

        // Navigate to new country path (replaces country prefix)
        const newPath = buildCurrentPath();
        navigateToPath(newPath);
        if (selectedRubbers[0]) updateDetailPanel(1, selectedRubbers[0]);
        if (selectedRubbers[1]) updateDetailPanel(2, selectedRubbers[1]);
        updateComparisonBar();
        renderTabs();
        updateRadarChart();
    }

    syncCountrySelectorUI();
    requestAnimationFrame(() => positionCountryPill(selector));
    applyLocalizedStaticText();

    selector.addEventListener('click', (e) => {
        const btn = e.target.closest('.country-btn');
        if (!btn) return;
        const isOpen = selector.classList.contains('is-open');

        // Mobile: first tap on active flag opens compact menu.
        if (isMobileViewport() && !isOpen && btn.dataset.country === selectedCountry) {
            selector.classList.add('is-open');
            requestAnimationFrame(() => positionCountryPill(selector));
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
        positionCountryPill(selector);
    });
}

function initHeaderSearch() {
    const input = document.getElementById('headerSearchInput');
    const results = document.getElementById('headerSearchResults');
    if (!input || !results) return;

    let activeIndex = -1;
    let currentMatches = [];

    function getHeaderSearchPool() {
        if (typeof getFilteredData !== 'function') return rubberData;
        const filtered = getFilteredData();
        return Array.isArray(filtered) && filtered.length > 0 ? filtered : rubberData;
    }

    function collectMatchedPlayersBySide(rubber, query) {
        const matchesByPlayer = new Map();
        const playerMatchesQuery = (name) => {
            if (typeof name !== 'string') return false;
            const trimmed = name.trim();
            if (!trimmed) return false;
            if (trimmed.toLowerCase().includes(query)) return true;

            const player = getPlayerDataByName(trimmed);
            if (!player) return false;

            const candidates = [];
            if (typeof player.canonical_name === 'string') candidates.push(player.canonical_name);
            if (typeof player.full_name === 'string') candidates.push(player.full_name);
            if (player.localized_names && typeof player.localized_names === 'object') {
                Object.values(player.localized_names).forEach((localizedName) => {
                    if (typeof localizedName === 'string') candidates.push(localizedName);
                });
            }
            return candidates.some(candidate => candidate.trim().toLowerCase().includes(query));
        };

        const addMatches = (players, side) => {
            if (!Array.isArray(players)) return;
            players.forEach((name) => {
                if (typeof name !== 'string') return;
                const trimmed = name.trim();
                if (!trimmed) return;
                if (playerMatchesQuery(trimmed)) {
                    const key = trimmed.toLowerCase();
                    const existing = matchesByPlayer.get(key) || {
                        name: trimmed,
                        forehand: false,
                        backhand: false
                    };
                    if (side === 'forehand') existing.forehand = true;
                    if (side === 'backhand') existing.backhand = true;
                    matchesByPlayer.set(key, existing);
                }
            });
        };
        addMatches(rubber.forehandPlayers, 'forehand');
        addMatches(rubber.backhandPlayers, 'backhand');
        return Array.from(matchesByPlayer.values());
    }

    function search(query) {
        const q = query.trim().toLowerCase();
        if (!q) { closeResults(); return; }

        const matches = [];
        getHeaderSearchPool().forEach((r) => {
            const nameMatch = r.abbr.toLowerCase().includes(q) || r.fullName.toLowerCase().includes(q);
            const brandMatch = Object.values(BRAND_NAMES_I18N).some(m => m[r.brand]?.toLowerCase().includes(q));
            const localizedNameMatch = getRubberLocalizedSearchTerms(r).some(name => name.toLowerCase().includes(q));
            const playerNameMatch = r.playerSearchNames.some(name => name.toLowerCase().includes(q));

            if (nameMatch || brandMatch || localizedNameMatch) {
                matches.push({ rubber: r, matchedPlayer: '', matchedSide: '' });
                return;
            }

            const sidePlayerMatches = collectMatchedPlayersBySide(r, q);
            sidePlayerMatches.forEach((playerMatch) => {
                matches.push({
                    rubber: r,
                    matchedPlayer: playerMatch.name,
                    matchedSides: {
                        forehand: playerMatch.forehand,
                        backhand: playerMatch.backhand
                    }
                });
            });

            if (playerNameMatch && sidePlayerMatches.length === 0) {
                matches.push({ rubber: r, matchedPlayer: '', matchedSide: '' });
            }
        });

        currentMatches = matches.slice(0, 30);

        if (currentMatches.length === 0) {
            results.innerHTML = '<div class="header-search-no-results">No rubbers found</div>';
            results.classList.add('is-open');
            activeIndex = -1;
            return;
        }

        results.innerHTML = currentMatches.map((entry, i) => {
            const r = entry.rubber;
            const matchedPlayer = entry.matchedPlayer;
            const matchedSides = entry.matchedSides || {};
            const sideBadgeHtml = [
                matchedSides.forehand
                    ? '<span class="header-search-side-badge header-search-side-badge--fh">🏓</span>'
                    : '',
                matchedSides.backhand
                    ? '<span class="header-search-side-badge header-search-side-badge--bh"><span class="header-search-paddle-black">🏓</span></span>'
                    : ''
            ].filter(Boolean).join(' ');
            const matchedPlayerLabel = matchedPlayer
                ? (getLocalizedPlayerName(matchedPlayer) || matchedPlayer)
                : '';

            const brandColor = getBrandColor(r.brand);
            return `<div class="header-search-result" data-index="${i}" style="border-left-color:${brandColor}">` +
                `<span class="header-search-result-abbr">${highlightMatch(tRubberAbbr(r), q)}</span>` +
                `<span class="header-search-result-brand" style="color:${brandColor}">${tBrand(r.brand)}</span>` +
                (matchedPlayerLabel
                    ? `<span class="header-search-result-player">${highlightMatch(matchedPlayerLabel, q)}${sideBadgeHtml ? ` ${sideBadgeHtml}` : ''}</span>`
                    : '') +
                `</div>`;
        }).join('');
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

    function selectResult(match) {
        const rubber = match?.rubber || match;
        if (!rubber) return;
        handleRubberClick(rubber);
        input.value = '';
        closeResults();
        input.blur();
        trackSearchSelectEvent(rubber);

        // Show the hover popup on the selected dot
        const chartEl = document.getElementById('chart');
        const fl = chartEl?._fullLayout;
        if (fl?.xaxis && fl?.yaxis) {
            _clickPopupActiveUntil = Date.now() + 500;
            _clickPopupPinned = true;
            const syntheticData = {
                points: [{
                    x: rubber.x,
                    y: rubber.y,
                    xaxis: fl.xaxis,
                    yaxis: fl.yaxis,
                    data: { customdata: [rubber] },
                    pointIndex: 0,
                }],
                event: null,
            };
            showChartHoverPopupFromPlotlyData(syntheticData, chartEl);
        }
    }

    function closeResults() {
        results.classList.remove('is-open');
        results.innerHTML = '';
        activeIndex = -1;
        currentMatches = [];
        clearSearchSpotlight();
        document.getElementById('headerBestsellerBtn')?.classList.remove('is-active');
    }

    let _searchSpotlightActive = false;

    function highlightRubberDot(rubber) {
        if (!rubber) return;
        const isMobile = window.matchMedia('(max-width: 768px)').matches;
        if (isMobile) {
            spotlightRubber = rubber;
            _searchSpotlightActive = true;
            updateChart({ preserveRanges: true, force: true });
        }
        const chartEl = document.getElementById('chart');
        const fl = chartEl?._fullLayout;
        if (!fl?.xaxis || !fl?.yaxis) return;
        showChartDotShake({
            points: [{
                x: rubber.x,
                y: rubber.y,
                xaxis: fl.xaxis,
                yaxis: fl.yaxis,
                data: { customdata: [rubber], marker: {} },
                pointIndex: 0,
            }]
        }, chartEl);
    }

    function clearSearchSpotlight() {
        if (_searchSpotlightActive) {
            _searchSpotlightActive = false;
            spotlightRubber = null;
            updateChart({ preserveRanges: true, force: true });
        }
        hideChartDotShake();
    }

    function setActive(index) {
        const items = results.querySelectorAll('.header-search-result');
        items.forEach(el => el.classList.remove('is-active'));
        if (index >= 0 && index < items.length) {
            items[index].classList.add('is-active');
            items[index].scrollIntoView({ block: 'nearest' });
            const match = currentMatches[index];
            highlightRubberDot(match?.rubber || match);
        } else {
            clearSearchSpotlight();
        }
        activeIndex = index;
    }

    input.addEventListener('input', () => {
        document.getElementById('headerBestsellerBtn')?.classList.remove('is-active');
        search(input.value);
    });

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

    let _lastTouchTime = 0;

    results.addEventListener('touchstart', () => {
        _lastTouchTime = Date.now();
    }, { passive: true });

    results.addEventListener('mouseover', (e) => {
        if (Date.now() - _lastTouchTime < 500) return;
        const item = e.target.closest('.header-search-result');
        if (!item) return;
        const idx = parseInt(item.dataset.index, 10);
        const match = currentMatches[idx];
        highlightRubberDot(match?.rubber || match);
    });

    results.addEventListener('mouseleave', () => {
        if (Date.now() - _lastTouchTime < 500) return;
        clearSearchSpotlight();
    });

    document.addEventListener('click', (e) => {
        if (!e.target.closest('#headerSearch') && !e.target.closest('#headerBestsellerBtn')) closeResults();
    });

    // ── Bestseller button ──
    const bestsellerBtn = document.getElementById('headerBestsellerBtn');
    if (bestsellerBtn) {
        let bestsellerLeaveTimer = null;

        function openBestsellerList() {
            clearTimeout(bestsellerLeaveTimer);
            if (bestsellerBtn.classList.contains('is-active')) return;

            const country = (typeof selectedCountry === 'string' && selectedCountry) || 'en';

            const top10 = rubberData
                .filter(r => r.bestseller && r.bestseller[country] != null && r.bestseller[country] <= 10)
                .sort((a, b) => a.bestseller[country] - b.bestseller[country])
                .slice(0, 10)
                .map(r => ({ rubber: r, rank: r.bestseller[country] }));

            const header = '<div class="header-search-list-header">Top 10 Bestsellers</div>';

            if (top10.length === 0) {
                results.innerHTML = header + '<div class="header-search-no-results">No bestseller data</div>';
                results.classList.add('is-open');
                bestsellerBtn.classList.add('is-active');
                activeIndex = -1;
                currentMatches = [];
                return;
            }

            currentMatches = top10.map(item => ({ rubber: item.rubber, matchedPlayer: '', matchedSides: {} }));
            results.innerHTML = header + top10.map((item, i) => {
                const r = item.rubber;
                const brandColor = getBrandColor(r.brand);
                return `<div class="header-search-result" data-index="${i}" style="border-left-color:${brandColor}">` +
                    `<span class="header-search-result-rank">#${item.rank}</span>` +
                    `<span class="header-search-result-abbr">${escapeHtml(tRubberAbbr(r))}</span>` +
                    `<span class="header-search-result-brand" style="color:${brandColor}">${tBrand(r.brand)}</span>` +
                    `</div>`;
            }).join('');
            results.classList.add('is-open');
            bestsellerBtn.classList.add('is-active');
            activeIndex = -1;
            input.value = '';
        }

        function scheduleBestsellerClose() {
            bestsellerLeaveTimer = setTimeout(() => {
                if (!bestsellerBtn.matches(':hover') && !results.matches(':hover')) {
                    bestsellerBtn.classList.remove('is-active');
                    closeResults();
                }
            }, 150);
        }

        bestsellerBtn.addEventListener('mouseenter', openBestsellerList);
        bestsellerBtn.addEventListener('mouseleave', scheduleBestsellerClose);
        results.addEventListener('mouseenter', () => clearTimeout(bestsellerLeaveTimer));
        results.addEventListener('mouseleave', scheduleBestsellerClose);

        bestsellerBtn.addEventListener('click', () => {
            if (bestsellerBtn.classList.contains('is-active')) {
                bestsellerBtn.classList.remove('is-active');
                closeResults();
            } else {
                openBestsellerList();
            }
        });
    }
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
    function handleLogoClick() {
        resetAppToInitialState();
        navigateToPath('/' + (selectedCountry || 'en') + '/');
    }
    logo.addEventListener('click', handleLogoClick);
    logo.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            handleLogoClick();
        }
    });
}


function initMascotEmotes() {
    const mascot = document.getElementById('homeLogo');
    if (!mascot) return;

    const emotes = [
        { cls: 'mascot-emote-wink', duration: 500 },
        { cls: 'mascot-emote-dance', duration: 1800 },
        { cls: 'mascot-emote-wave', duration: 1500 },
        { cls: 'mascot-emote-look', duration: 2000 },
        { cls: 'mascot-emote-bounce', duration: 600 },
    ];

    let prevIdx = -1;

    function playRandomEmote() {
        if (document.hidden) {
            setTimeout(playRandomEmote, 3000);
            return;
        }
        let idx = Math.floor(Math.random() * emotes.length);
        if (emotes.length > 1 && idx === prevIdx) {
            idx = (idx + 1) % emotes.length;
        }
        prevIdx = idx;
        const emote = emotes[idx];
        mascot.classList.add(emote.cls);
        setTimeout(() => {
            mascot.classList.remove(emote.cls);
            setTimeout(playRandomEmote, 5000 + Math.random() * 8000);
        }, emote.duration);
    }

    setTimeout(playRandomEmote, 3000 + Math.random() * 4000);
}

function initEndMascotEmotes(mascot) {
    if (!mascot) return;

    const emotes = [
        { cls: 'mascot-emote-wink', duration: 500 },
        { cls: 'mascot-emote-dance', duration: 1800 },
        { cls: 'mascot-emote-wave', duration: 1500 },
        { cls: 'mascot-emote-look', duration: 2000 },
        { cls: 'mascot-emote-bounce', duration: 600 },
    ];

    let prevIdx = -1;
    let timer = null;

    function playRandomEmote() {
        if (!mascot.isConnected) return;
        if (document.hidden) { timer = setTimeout(playRandomEmote, 3000); return; }
        let idx = Math.floor(Math.random() * emotes.length);
        if (emotes.length > 1 && idx === prevIdx) idx = (idx + 1) % emotes.length;
        prevIdx = idx;
        const emote = emotes[idx];
        mascot.classList.add(emote.cls);
        timer = setTimeout(() => {
            if (!mascot.isConnected) return;
            mascot.classList.remove(emote.cls);
            timer = setTimeout(playRandomEmote, 4000 + Math.random() * 6000);
        }, emote.duration);
    }

    timer = setTimeout(playRandomEmote, 2000 + Math.random() * 3000);
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
            submitBtn.textContent = isSubmitting ? tUi('FEEDBACK_SUBMITTING') : tUi('FEEDBACK_SUBMIT');
        }
    }

    function showFormState() {
        if (title) title.textContent = tUi('FEEDBACK_TITLE_SHARE');
        if (intro) intro.hidden = false;
        form.hidden = false;
        if (confirmation) confirmation.hidden = true;
    }

    function showConfirmationState(message) {
        if (title) title.textContent = tUi('FEEDBACK_TITLE_SENT');
        if (intro) intro.hidden = true;
        form.hidden = true;
        if (confirmationMessage) confirmationMessage.textContent = message || tUi('FEEDBACK_CONFIRMATION');
        if (confirmation) confirmation.hidden = false;
    }

    function closeFeedbackModal() {
        clearCloseTimer();
        modal.classList.remove('open');
        modal.setAttribute('aria-hidden', 'true');
        document.body.style.overflow = '';
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
        setFeedbackStatus(tUi('FEEDBACK_STATUS_PROMPT'));
        if (messageInput && prefillMessage.trim()) {
            messageInput.value = prefillMessage;
        }
        setSubmittingState(false);
        setTimeout(() => {
            if (messageInput) {
                try {
                    messageInput.focus({ preventScroll: true });
                } catch {
                    messageInput.focus();
                }
                if (typeof messageInput.setSelectionRange === 'function') {
                    const pos = messageInput.value.length;
                    messageInput.setSelectionRange(pos, pos);
                }
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
        setFeedbackStatus(tUi('FEEDBACK_STATUS_SENDING'), '#b8b3a7');

        try {
            const response = await fetch(form.action, {
                method: 'POST',
                body: new FormData(form),
                headers: { Accept: 'application/json' }
            });
            const result = await response.json().catch(() => ({}));

            if (!response.ok || result.success === false) {
                throw new Error(result.message || tUi('FEEDBACK_STATUS_FAILED'));
            }

            showConfirmationState(tUi('FEEDBACK_CONFIRMATION'));
            form.reset();
            closeTimer = setTimeout(() => {
                closeFeedbackModal();
            }, 3000);
        } catch (error) {
            console.error('Feedback submission failed:', error);
            showFormState();
            setFeedbackStatus(tUi('FEEDBACK_STATUS_FAILED'), '#cf5555');
        } finally {
            setSubmittingState(false);
        }
    });
}

function initComparisonRequestModal() {
    function ensureModal() {
        let modal = document.getElementById('comparisonRequestModal');
        if (modal) return modal;
        modal = document.createElement('div');
        modal.className = 'comparison-request-modal';
        modal.id = 'comparisonRequestModal';
        modal.setAttribute('aria-hidden', 'true');
        modal.innerHTML =
            '<div class="comparison-request-modal-card" role="dialog" aria-modal="true" aria-labelledby="compReqTitle">' +
                '<button type="button" class="feedback-modal-close" id="compReqCloseBtn" aria-label="Close">\u00d7</button>' +
                '<div class="comparison-request-modal-header">' +
                    '<div class="comparison-request-modal-icon" aria-hidden="true">' +
                        '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>' +
                    '</div>' +
                    '<h2 id="compReqTitle">Get notified</h2>' +
                '</div>' +
                '<p class="comparison-request-modal-sub" id="compReqSub"></p>' +
                '<form class="comparison-request-form" id="compReqForm" action="https://api.web3forms.com/submit" method="POST">' +
                    '<input type="hidden" name="access_key" value="209c243c-c02d-4523-8587-1fe225a6cad3">' +
                    '<input type="hidden" name="subject" id="compReqSubject" value="Comparison request">' +
                    '<input type="hidden" name="message" id="compReqMessage" value="">' +
                    '<input type="checkbox" name="botcheck" class="feedback-botcheck" tabindex="-1" autocomplete="off">' +
                    '<label for="compReqEmail" id="compReqEmailLabel">Email</label>' +
                    '<input id="compReqEmail" type="email" name="email" autocomplete="email" required placeholder="you@example.com">' +
                    '<button type="submit" id="compReqSubmitBtn">Notify me</button>' +
                '</form>' +
                '<div class="comparison-request-confirmation" id="compReqConfirmation" hidden>' +
                    '<p class="feedback-confirmation-icon" aria-hidden="true">\u2713</p>' +
                    '<p class="feedback-confirmation-message" id="compReqConfirmationMsg"></p>' +
                '</div>' +
            '</div>';
        document.body.appendChild(modal);
        return modal;
    }

    let modal = null;
    let closeTimer = null;

    function clearTimer() {
        if (closeTimer) { clearTimeout(closeTimer); closeTimer = null; }
    }

    function closeModal() {
        clearTimer();
        if (modal) {
            modal.classList.remove('open');
            modal.setAttribute('aria-hidden', 'true');
        }
        document.body.style.overflow = '';
    }

    function openModal(leftRubber, rightRubber) {
        clearTimer();
        modal = ensureModal();
        const matchup = `${leftRubber} vs ${rightRubber}`;

        const titleEl = document.getElementById('compReqTitle');
        const subEl = document.getElementById('compReqSub');
        const emailLabel = document.getElementById('compReqEmailLabel');
        const subjectInput = document.getElementById('compReqSubject');
        const messageInput = document.getElementById('compReqMessage');
        const emailInput = document.getElementById('compReqEmail');
        const submitBtn = document.getElementById('compReqSubmitBtn');
        const form = document.getElementById('compReqForm');
        const confirmation = document.getElementById('compReqConfirmation');

        if (titleEl) titleEl.textContent = tUi('COMP_REQ_TITLE');
        if (subEl) {
            subEl.innerHTML = tUi('COMP_REQ_SUB_BEFORE') +
                '<strong>' + escapeHtml(matchup) + '</strong>' +
                tUi('COMP_REQ_SUB_AFTER');
        }
        if (emailLabel) emailLabel.textContent = tUi('COMP_REQ_EMAIL_LABEL');
        if (subjectInput) subjectInput.value = `Comparison request: ${matchup}`;
        if (messageInput) messageInput.value = `User requested comparison: ${matchup}`;

        if (form) { form.reset(); form.hidden = false; }
        if (confirmation) confirmation.hidden = true;
        if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.textContent = tUi('COMP_REQ_SUBMIT');
        }

        modal.classList.add('open');
        modal.setAttribute('aria-hidden', 'false');
        document.body.style.overflow = 'hidden';

        setTimeout(() => {
            if (emailInput) {
                try { emailInput.focus({ preventScroll: true }); }
                catch { emailInput.focus(); }
            }
        }, 50);
    }

    document.addEventListener('click', (e) => {
        // Close button
        if (e.target.closest('#compReqCloseBtn')) { closeModal(); return; }
        // Backdrop click
        if (modal && e.target === modal) { closeModal(); return; }
        // Request comparison button
        const requestBtn = e.target.closest('[data-feedback-request-comparison="true"]');
        if (!requestBtn) return;
        const leftRubber = requestBtn.dataset.leftRubber || '';
        const rightRubber = requestBtn.dataset.rightRubber || '';
        openModal(leftRubber, rightRubber);
    });

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && modal && modal.classList.contains('open')) closeModal();
    });

    document.addEventListener('submit', async (e) => {
        const form = e.target.closest('#compReqForm');
        if (!form) return;
        e.preventDefault();
        const submitBtn = document.getElementById('compReqSubmitBtn');
        if (submitBtn) {
            submitBtn.disabled = true;
            submitBtn.textContent = tUi('COMP_REQ_SUBMITTING');
        }

        try {
            const response = await fetch(form.action, {
                method: 'POST',
                body: new FormData(form),
                headers: { Accept: 'application/json' }
            });
            const result = await response.json().catch(() => ({}));

            if (!response.ok || result.success === false) {
                throw new Error(result.message || tUi('COMP_REQ_FAILED'));
            }

            form.hidden = true;
            const confirmationMsg = document.getElementById('compReqConfirmationMsg');
            const confirmation = document.getElementById('compReqConfirmation');
            if (confirmationMsg) confirmationMsg.textContent = tUi('COMP_REQ_CONFIRMATION');
            if (confirmation) confirmation.hidden = false;
            closeTimer = setTimeout(closeModal, 3000);
        } catch (error) {
            console.error('Comparison request submission failed:', error);
            if (submitBtn) {
                submitBtn.disabled = false;
                submitBtn.textContent = tUi('COMP_REQ_SUBMIT');
            }
        }
    });
}

window.addEventListener('resize', () => {
    Plotly.Plots.resize('chart');
    if (hasPlotted) updateChart({ preserveRanges: true });
    resetMascotWalker();
});

/**
 * Apply a parsed route to the app state (auto-select rubbers, open tabs).
 */
function applyRoute(route) {
    if (!route || !SLUG_MAP) return;

    if (route.type === 'rubber') {
        const rubber = findRubberBySlug(route.slug);
        if (rubber) {
            selectedRubbers[0] = rubber;
            updateDetailPanel(1, rubber);
            nextDetailPanel = 2;
            updateRadarChart();
            updateComparisonBar();
            renderTabs();
            setActiveTab('desc1');
        }
    } else if (route.type === 'comparison') {
        const rubberA = findRubberBySlug(route.slugA);
        const rubberB = findRubberBySlug(route.slugB);
        if (rubberA && rubberB) {
            selectedRubbers[0] = rubberA;
            selectedRubbers[1] = rubberB;
            updateDetailPanel(1, rubberA);
            updateDetailPanel(2, rubberB);
            nextDetailPanel = 1;
            updateRadarChart();
            updateComparisonBar();
            renderTabs();
            setActiveTab('comparison');
        } else if (rubberA) {
            selectedRubbers[0] = rubberA;
            updateDetailPanel(1, rubberA);
            nextDetailPanel = 2;
            updateRadarChart();
            updateComparisonBar();
            renderTabs();
            setActiveTab('desc1');
        }
    }

    if (typeof updateDocumentTitle === 'function') updateDocumentTitle();
}

async function initializeApp() {
    ensureAnalyticsInitialized();

    const chart = document.getElementById('chart');
    if (chart) chart.innerHTML = '<div style="padding: 20px; color: #9b9484;">Loading rubber data\u2026</div>';

    // Load slug map
    try {
        const slugMapResp = await fetch(v('/js/slug-map.json'));
        if (slugMapResp.ok) {
            SLUG_MAP = await slugMapResp.json();
        }
    } catch (e) {
        console.warn('Could not load slug map:', e);
    }

    // Check for legacy URL redirect (before loading data to avoid flash)
    if (SLUG_MAP && checkLegacyUrlRedirect(SLUG_MAP)) return;

    // Parse route from current URL
    const route = parseRoute();

    // Handle root redirect
    if (route.type === 'redirect') {
        window.location.replace('/' + route.country + '/');
        return;
    }

    // Set country from route
    if (route.country && ['en', 'cn', 'ko'].includes(route.country)) {
        selectedCountry = route.country;
    }

    try {
        await loadPlayersData();
        await loadRubberData();
    } catch (error) {
        console.error('Failed to load data:', error);
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
    applyLocalizedStaticText();
    initHomeLogo();
    initMascotEmotes();
    initHeaderSearch();
    initFeedbackModal();
    initComparisonRequestModal();
    initFilters();

    // Tab click listener
    document.getElementById('contentTabs').addEventListener('click', (e) => {
        // Share button
        if (e.target.closest('.content-tab--share')) {
            handleShareClick();
            return;
        }
        const tab = e.target.closest('.content-tab');
        if (!tab || tab.classList.contains('content-tab--active')) return;
        const tabId = tab.dataset.tab;
        const hashMap = { desc1: '#1', desc2: '#2' };
        const hash = hashMap[tabId] || '';
        history.replaceState(null, '', window.location.pathname + window.location.search + hash);
        setActiveTab(tabId);
    });

    let contentFeedbackToastTimer = null;
    function ensureContentFeedbackToast() {
        let toast = document.getElementById('contentFeedbackToast');
        if (toast) return toast;
        toast = document.createElement('div');
        toast.id = 'contentFeedbackToast';
        toast.className = 'comparison-request-toast';
        toast.setAttribute('role', 'status');
        toast.setAttribute('aria-live', 'polite');
        document.body.appendChild(toast);
        return toast;
    }

    function showContentFeedbackToast(vote) {
        const toast = ensureContentFeedbackToast();
        toast.textContent = vote === 'good'
            ? tUi('CONTENT_FEEDBACK_GOOD_TOAST')
            : tUi('CONTENT_FEEDBACK_BAD_TOAST');
        toast.classList.add('is-visible');
        if (contentFeedbackToastTimer) clearTimeout(contentFeedbackToastTimer);
        contentFeedbackToastTimer = setTimeout(() => {
            toast.classList.remove('is-visible');
        }, 1800);
    }

    function hideVoteButtons(actionsContainer) {
        actionsContainer.querySelectorAll('.content-feedback-btn').forEach(btn => btn.remove());
    }

    function showBadFeedbackReasonForm(voteBtn) {
        const actionsContainer = voteBtn.closest('.content-feedback-actions');
        if (!actionsContainer || actionsContainer.querySelector('.content-feedback-reason-form')) return;

        hideVoteButtons(actionsContainer);

        const context = {
            contentType: voteBtn.dataset.feedbackScope || '',
            tabId: voteBtn.dataset.feedbackTab || '',
            rubberName: voteBtn.dataset.feedbackRubberName || '',
            leftRubber: voteBtn.dataset.feedbackLeftRubber || '',
            rightRubber: voteBtn.dataset.feedbackRightRubber || ''
        };

        const form = document.createElement('form');
        form.className = 'content-feedback-reason-form';
        form.innerHTML =
            `<label class="content-feedback-reason-label">${tUi('FEEDBACK_EMAIL_LABEL')}</label>` +
            `<input type="email" class="content-feedback-reason-email" placeholder="${tUi('FEEDBACK_EMAIL_PLACEHOLDER')}" autocomplete="email">` +
            `<label class="content-feedback-reason-label">Reason</label>` +
            `<textarea class="content-feedback-reason-input" rows="2" placeholder="${tUi('CONTENT_FEEDBACK_REASON_PLACEHOLDER')}" required></textarea>` +
            `<button type="submit" class="content-feedback-reason-submit">${tUi('CONTENT_FEEDBACK_REASON_SUBMIT')}</button>`;

        actionsContainer.appendChild(form);
        const textarea = form.querySelector('textarea');
        setTimeout(() => textarea.focus(), 30);

        form.addEventListener('submit', async (ev) => {
            ev.preventDefault();
            const reason = textarea.value.trim();
            if (!reason) return;

            const submitBtn = form.querySelector('button[type="submit"]');
            submitBtn.disabled = true;
            submitBtn.textContent = tUi('CONTENT_FEEDBACK_REASON_SENDING');

            let subjectParts = ['Bad feedback'];
            if (context.contentType) subjectParts.push(context.contentType);
            if (context.rubberName) subjectParts.push(context.rubberName);
            if (context.leftRubber && context.rightRubber) subjectParts.push(`${context.leftRubber} vs ${context.rightRubber}`);

            const email = form.querySelector('.content-feedback-reason-email').value.trim();

            const body = new FormData();
            body.append('access_key', '209c243c-c02d-4523-8587-1fe225a6cad3');
            body.append('subject', subjectParts.join(' | '));
            body.append('message', reason);
            if (email) body.append('email', email);
            body.append('from_name', 'Content Feedback (bad)');

            try {
                const resp = await fetch('https://api.web3forms.com/submit', {
                    method: 'POST',
                    body,
                    headers: { Accept: 'application/json' }
                });
                if (!resp.ok) throw new Error('send failed');
                form.remove();
                showContentFeedbackToast('bad');
            } catch {
                submitBtn.disabled = false;
                submitBtn.textContent = tUi('CONTENT_FEEDBACK_REASON_SUBMIT');
                showContentFeedbackToast('bad');
            }
        });
    }

    document.getElementById('contentBody').addEventListener('click', (e) => {
        const buyLink = e.target.closest('.rubber-title-icon-link--product');
        if (buyLink) {
            trackBuyClickEvent(buyLink.dataset.rubberName || '');
            return;
        }

        const voteBtn = e.target.closest('[data-feedback-vote]');
        if (!voteBtn) return;

        const vote = voteBtn.dataset.feedbackVote;

        if (vote === 'bad') {
            showBadFeedbackReasonForm(voteBtn);
            return;
        }

        const actionsContainer = voteBtn.closest('.content-feedback-actions');
        trackContentFeedbackVote(vote, {
            contentType: voteBtn.dataset.feedbackScope,
            tabId: voteBtn.dataset.feedbackTab,
            rubberName: voteBtn.dataset.feedbackRubberName,
            leftRubber: voteBtn.dataset.feedbackLeftRubber,
            rightRubber: voteBtn.dataset.feedbackRightRubber
        });
        if (actionsContainer) hideVoteButtons(actionsContainer);
        showContentFeedbackToast(vote);
    });

    // Pin button click listener (event delegation)
    document.getElementById('radarSection').addEventListener('click', (e) => {
        const buyLink = e.target.closest('.rubber-title-icon-link--product');
        if (buyLink) {
            trackBuyClickEvent(buyLink.dataset.rubberName || '');
            return;
        }
        const btn = e.target.closest('.radar-pin-btn');
        if (!btn) return;
        const idx = parseInt(btn.dataset.panelIndex, 10);
        const other = idx === 0 ? 1 : 0;
        pinnedRubbers[idx] = !pinnedRubbers[idx];
        // Only one side can be pinned at a time
        if (pinnedRubbers[idx]) pinnedRubbers[other] = false;
        // Update hint text to reflect current state
        document.querySelectorAll('.radar-pin-btn').forEach(b => {
            const i = parseInt(b.dataset.panelIndex, 10);
            b.dataset.hint = pinnedRubbers[i] ? 'Pinned' : 'Unpinned';
        });
        updateRadarChart();
        pushFiltersToUrl();
    });

    // Capture the hash fragment before any setActiveTab/pushFiltersToUrl strips it.
    const initialHash = window.location.hash.slice(1).toLowerCase();

    applyFiltersFromUrl();
    applyRoute(route);
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
        // Wait for Plotly autoscale + content card to fully lay out before scrolling.
        if (initialHash) {
            setTimeout(() => applyHashFragment(initialHash), 250);
        } else if (selectedRubbers[0] && selectedRubbers[1]) {
            // No hash but both rubbers selected → scroll to comparison
            setTimeout(() => {
                const el = document.getElementById('contentCard');
                if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }, 250);
        }
    });

    initMascotWalker();


    // Alternate JP/CN hardness labels with their German equivalents every 2 s
    setInterval(() => document.body.classList.toggle('show-hardness-de'), 2000);

    // Handle browser back/forward
    window.addEventListener('popstate', () => {
        const newRoute = parseRoute();
        if (newRoute.type === 'redirect') {
            window.location.replace('/' + newRoute.country + '/');
            return;
        }
        // Update country if changed
        if (newRoute.country && newRoute.country !== selectedCountry) {
            selectedCountry = newRoute.country;
            applyLocalizedStaticText();
            applyRubberLocaleFilter();
            pruneInvalidRubberSelections();
            syncCountrySelectorUI();
            const brandFilter = document.getElementById('brandFilter');
            const brandChecked = new Set(getCheckedValues('brandFilter'));
            const brands = [...new Set(rubberData.map(r => r.brand))].sort();
            buildCheckboxOptions(brandFilter, brands.map(b => ({ value: b, label: tBrand(b), swatchColor: getBrandColor(b) })), brandChecked);
            buildNameOptionsFromFilters();
            updateChart({ preserveRanges: true, force: true });
        }
        // Reset selections and apply route
        selectedRubbers = [null, null];
        nextDetailPanel = 1;
        pinnedRubbers = [false, false];
        resetDetailPanels();
        applyRoute(newRoute);
        if (!activeTab) {
            renderTabs();
            setActiveTab('desc1');
        }
        updateChart({ preserveRanges: true, force: true });

        const newHash = window.location.hash.slice(1).toLowerCase();
        if (newHash) applyHashFragment(newHash);
    });
}

function applyHashFragment(hash) {
    if (hash === 'radar') {
        const el = document.getElementById('radarSection');
        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
        return;
    }
    const tabMap = { '1': 'desc1', '2': 'desc2' };
    const tabId = tabMap[hash];
    if (tabId) {
        setActiveTab(tabId);
        const el = document.getElementById('contentCard');
        if (el) {
            requestAnimationFrame(() => {
                el.scrollIntoView({ behavior: 'smooth', block: 'start' });
            });
        }
    }
}

initializeApp();
