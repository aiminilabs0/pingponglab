// ════════════════════════════════════════════════════════════
//  Detail Panels & Comparison
// ════════════════════════════════════════════════════════════

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
    return parts.join('');
}


async function fetchRubberDescriptionMarkdown(brand, abbr) {
    const lang = COUNTRY_TO_LANG[selectedCountry] || 'en';
    const cacheKey = `${brand}/${lang}/${abbr}`;
    if (cacheKey in rubberDescriptionsCache) return rubberDescriptionsCache[cacheKey];
    try {
        const resp = await fetch(v(
            `rubbers_description/${encodeURIComponent(brand)}/${encodeURIComponent(lang)}/${encodeURIComponent(abbr)}`
        ));
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
    const leftName = (leftRubber?.abbr || '').trim();
    const rightName = (rightRubber?.abbr || '').trim();
    return [leftName, rightName].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
}

async function fetchRubberComparisonMarkdown(leftRubber, rightRubber) {
    const [nameA, nameB] = getAlphabeticalComparisonNames(leftRubber, rightRubber);
    if (!nameA || !nameB) return null;
    const lang = COUNTRY_TO_LANG[selectedCountry] || 'en';

    const cacheKey = `${lang}/${nameA}_${nameB}`;
    if (cacheKey in rubberComparisonCache) return rubberComparisonCache[cacheKey];

    const orderings = [
        [nameA, nameB],
        [nameB, nameA],
    ];

    try {
        for (const [n1, n2] of orderings) {
            const localizedPath = `rubbers_comparison/${encodeURIComponent(lang)}/${encodeURIComponent(n1)}/${encodeURIComponent(n2)}`;
            const resp = await fetch(v(localizedPath));
            if (resp.ok) {
                const text = await resp.text();
                rubberComparisonCache[cacheKey] = text;
                return text;
            }
        }
        rubberComparisonCache[cacheKey] = null;
        return null;
    } catch {
        rubberComparisonCache[cacheKey] = null;
        return null;
    }
}

// ── Tab system functions ──

function buildTabButtonContent(rubber) {
    const color = getBrandColor(rubber.brand);
    return `<span class="content-tab-dot" style="background:${color}"></span>${escapeHtml(rubber.abbr || rubber.name)}`;
}

function buildEmptyPanePlaceholder(tabId) {
    const searchIcon = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="opacity:.5;vertical-align:-2px;margin-right:4px"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>';
    if (tabId === 'comparison') {
        return '<span class="content-pane-placeholder">' + searchIcon + 'Select two rubbers to compare</span>';
    }
    const label = tabId === 'desc1' ? 'first' : 'second';
    return '<span class="content-pane-placeholder">' + searchIcon + 'Select a ' + label + ' rubber</span>';
}

function renderTabs() {
    const tabBar = document.getElementById('contentTabs');
    const r1 = selectedRubbers[0];
    const r2 = selectedRubbers[1];
    const tab1Label = r1 ? buildTabButtonContent(r1) : `<span class="content-tab-dot" style="background:var(--drac-comment)"></span>${tUi('RUBBER_1')}`;
    const tab2Label = r2 ? buildTabButtonContent(r2) : `<span class="content-tab-dot" style="background:var(--drac-comment)"></span>${tUi('RUBBER_2')}`;
    const vsLabel = '🆚 VS';
    let html = '';
    html += `<button class="content-tab" data-tab="desc1">${tab1Label}</button>`;
    html += `<button class="content-tab" data-tab="desc2">${tab2Label}</button>`;
    html += `<button class="content-tab content-tab--vs" data-tab="comparison">${vsLabel}</button>`;
    tabBar.innerHTML = html;
    highlightActiveTab();
}

function highlightActiveTab() {
    const tabBar = document.getElementById('contentTabs');
    const hasSameBrandSelection = (() => {
        const [first, second] = selectedRubbers;
        if (!first?.brand || !second?.brand) return false;
        return first.brand.trim().toLowerCase() === second.brand.trim().toLowerCase();
    })();
    tabBar.querySelectorAll('.content-tab').forEach(btn => {
        const tabKey = btn.dataset.tab;
        const isActive = tabKey === activeTab;
        const hasContent = tabContents[tabKey] != null;
        btn.classList.toggle('content-tab--active', isActive);
        btn.classList.toggle('content-tab--empty', !hasContent);
        if (isActive && !btn.classList.contains('content-tab--vs')) {
            const idx = tabKey === 'desc1' ? 0 : 1;
            const rubber = selectedRubbers[idx];
            const color = rubber ? getBrandColor(rubber.brand) : 'var(--drac-comment)';
            btn.style.borderBottomColor = color;
            btn.style.borderBottomStyle = (tabKey === 'desc2' && hasSameBrandSelection) ? 'dashed' : 'solid';
        } else if (isActive && btn.classList.contains('content-tab--vs')) {
            const colorL = selectedRubbers[0] ? getBrandColor(selectedRubbers[0].brand) : '';
            const colorR = selectedRubbers[1] ? getBrandColor(selectedRubbers[1].brand) : '';
            btn.style.borderImage = `linear-gradient(to right, ${colorL}, ${colorR}) 1`;
            btn.style.borderBottomWidth = '2px';
            btn.style.borderBottomStyle = 'solid';
        } else {
            btn.style.borderImage = '';
            btn.style.borderBottomColor = 'transparent';
            btn.style.borderBottomStyle = 'solid';
        }
    });
}

function setActiveTab(tabId) {
    const pane = document.getElementById('contentPane');

    // Save scroll position of outgoing tab
    if (activeTab && tabContents[activeTab] != null) {
        const scrollEl = pane.querySelector('.content-pane-scroll');
        tabScrollPositions[activeTab] = scrollEl ? scrollEl.scrollTop : 0;
    }

    // Clean up YouTube embeds before swapping content
    resetYouTubePlayers();

    activeTab = tabId;

    if (tabId && tabContents[tabId] != null) {
        pane.classList.remove('content-pane--empty');
        pane.innerHTML = tabContents[tabId];
        // Restore scroll position
        requestAnimationFrame(() => {
            const scrollEl = pane.querySelector('.content-pane-scroll');
            if (scrollEl) scrollEl.scrollTop = tabScrollPositions[tabId] || 0;
        });
    } else {
        pane.classList.add('content-pane--empty');
        pane.innerHTML = buildEmptyPanePlaceholder(tabId);
    }

    // Fade in content pane after country switch
    if (_countrySwitchFade) {
        _countrySwitchFade = false;
        requestAnimationFrame(() => pane.classList.remove('content-pane--country-fade'));
    }

    highlightActiveTab();
    pushFiltersToUrl();
}

// ── Detail panel / comparison functions ──

async function updateDetailPanel(panelNum, rubber) {
    const tabKey = `desc${panelNum}`;
    const brandColor = getBrandColor(rubber.brand);
    const titleIconsHtml = buildTitleLinkIconsHtml(rubber);
    const headerHtml =
        `<div class="rubber-title-header">` +
            `<div class="rubber-title-top">` +
                `<span class="brand-pill" style="background:${brandColor}18;border-color:${brandColor}55;color:${brandColor}">` +
                    `<span class="brand-dot" style="background:${brandColor}"></span>` +
                    `${escapeHtml(rubber.brand)}` +
                `</span>` +
                (rubber.bestseller ? `<span class="bestseller-badge">★ Bestseller</span>` : '') +
            `</div>` +
            `<div class="rubber-title-row">` +
                `<h1 class="rubber-name" style="color:${brandColor}">${escapeHtml(rubber.name)}</h1>` +
                (titleIconsHtml ? `<div class="rubber-title-icons">${titleIconsHtml}</div>` : '') +
            `</div>` +
        `</div>`;

    const detailMarkdown = await fetchRubberDescriptionMarkdown(rubber.brand, rubber.abbr);

    if (detailMarkdown) {
        const feedbackButtonsHtml = buildContentFeedbackButtonsHtml({
            voteScope: 'description',
            tabId: tabKey,
            rubberName: rubber.name || rubber.abbr || '',
            ariaSubject: 'this description'
        });
        const html = marked.parse(detailMarkdown);
        tabContents[tabKey] = headerHtml + `<div class="content-pane-scroll md-description">${html}${feedbackButtonsHtml}</div>`;
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
    renderTabs();
    setActiveTab('desc1');
}

function handleRubberClick(rubber) {
    let panelNum;
    if (pinnedRubbers[0] && !pinnedRubbers[1]) {
        // Left is pinned — always replace right
        panelNum = 2;
    } else if (!pinnedRubbers[0] && pinnedRubbers[1]) {
        // Right is pinned — always replace left
        panelNum = 1;
    } else {
        // Neither or both pinned — use default alternating behaviour
        panelNum = nextDetailPanel;
    }
    nextDetailPanel = panelNum === 1 ? 2 : 1;
    selectedRubbers[panelNum - 1] = rubber;
    updateDetailPanel(panelNum, rubber);
    updateRadarChart();
    updateComparisonBar();
    updateChart({ preserveRanges: true, force: true });
    renderTabs();
    setActiveTab(`desc${panelNum}`);
    pushFiltersToUrl();
    return panelNum;
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
            <span class="brand-pill" style="background:${leftColor}18;border-color:${leftColor}55;color:${leftColor}">
                <span class="brand-dot" style="background:${leftColor}"></span>${leftBrand}
            </span>
            <span class="rubber-name" style="color:${leftColor}">${leftName}</span>
        </div>
        <div class="comp-title-vs">vs</div>
        <div class="comp-title-side comp-title-side-right">
            <span class="brand-pill" style="background:${rightColor}18;border-color:${rightColor}55;color:${rightColor}">
                <span class="brand-dot" style="background:${rightColor}"></span>${rightBrand}
            </span>
            <span class="rubber-name" style="color:${rightColor}">${rightName}</span>
        </div>
    `;
}

function buildContentFeedbackButtonsHtml(context = {}) {
    const voteScope = escapeHtml(context.voteScope || 'content');
    const tabId = escapeHtml(context.tabId || '');
    const rubberName = escapeHtml(context.rubberName || '');
    const leftRubber = escapeHtml(context.leftRubber || '');
    const rightRubber = escapeHtml(context.rightRubber || '');
    const ariaSubject = context.ariaSubject || 'this content';

    return (
        `<div class="content-feedback-actions" data-feedback-scope="${voteScope}">` +
            `<button type="button" class="content-feedback-btn content-feedback-btn--good" data-feedback-vote="good" data-feedback-scope="${voteScope}" data-feedback-tab="${tabId}" data-feedback-rubber-name="${rubberName}" data-feedback-left-rubber="${leftRubber}" data-feedback-right-rubber="${rightRubber}" aria-label="Mark ${ariaSubject} as good">👍</button>` +
            `<button type="button" class="content-feedback-btn content-feedback-btn--bad" data-feedback-vote="bad" data-feedback-scope="${voteScope}" data-feedback-tab="${tabId}" data-feedback-rubber-name="${rubberName}" data-feedback-left-rubber="${leftRubber}" data-feedback-right-rubber="${rightRubber}" aria-label="Mark ${ariaSubject} as bad">👎</button>` +
        `</div>`
    );
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
            const comparisonFeedbackButtonsHtml = buildContentFeedbackButtonsHtml({
                voteScope: 'comparison',
                tabId: 'comparison',
                leftRubber: left.name || left.abbr || '',
                rightRubber: right.name || right.abbr || '',
                ariaSubject: 'this comparison'
            });
            tabContents.comparison =
                `<div class="comparison-title">${compTitleHtml}</div>` +
                `<div class="content-pane-scroll md-comparison">${marked.parse(markdown)}${comparisonFeedbackButtonsHtml}</div>`;
        } else {
            const leftName = escapeHtml(left.name || left.abbr || '');
            const rightName = escapeHtml(right.name || right.abbr || '');
            tabContents.comparison =
                `<div class="comparison-title">${compTitleHtml}</div>` +
                `<div class="content-pane-scroll">` +
                    `<div class="comparison-status-msg-wrap">` +
                        `<p class="comparison-status-msg">No comparison available.</p>` +
                        `<button type="button" class="comparison-feedback-btn" data-feedback-request-comparison="true" data-left-rubber="${leftName}" data-right-rubber="${rightName}">Request a Comparison</button>` +
                    `</div>` +
                `</div>`;
        }
        renderTabs();
        if (activeTab === 'comparison') setActiveTab('comparison');
    } else {
        comparisonRenderToken++;
        tabContents.comparison = null;
        renderTabs();
    }
}
