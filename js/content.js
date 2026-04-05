// ════════════════════════════════════════════════════════════
//  Detail Panels & Comparison
// ════════════════════════════════════════════════════════════

const YOUTUBE_ICON = '/images/youtube.ico';
const YOUTUBE_DEFAULT_TITLE = 'YouTube Review';

const PRODUCT_STORE_MAP = [
    { domain: 'amazon.com',   icon: '/images/product/amazon.ico',  label: 'Amazon'  },
    { domain: 'coupang.com',  icon: '/images/product/coupang.ico', label: 'Coupang' },
    { domain: 'taobao.com',   icon: '/images/product/taobao.ico',  label: 'Taobao'  },
];
const PRODUCT_DEFAULT_STORE = { icon: null, label: 'Buy' };

function getProductStoreMeta(url) {
    if (!url) return null;
    url = url.trim();
    if (!url) return null;
    try {
        const hostname = new URL(url).hostname.replace(/^www\./, '');
        const match = PRODUCT_STORE_MAP.find(s => hostname === s.domain || hostname.endsWith('.' + s.domain));
        const { icon, label } = match || PRODUCT_DEFAULT_STORE;
        return { url, icon, label };
    } catch {
        return null;
    }
}
const youtubeMetaCache = new Map();

function normalizeYouTubeMeta(rawYoutubeValue) {
    if (!rawYoutubeValue) return null;

    if (typeof rawYoutubeValue === 'string') {
        const url = rawYoutubeValue.trim();
        if (!url) return null;
        return { url, title: YOUTUBE_DEFAULT_TITLE, icon: YOUTUBE_ICON };
    }

    if (typeof rawYoutubeValue === 'object') {
        const url = typeof rawYoutubeValue.url === 'string' ? rawYoutubeValue.url.trim() : '';
        if (!url) return null;
        const title = typeof rawYoutubeValue.title === 'string' && rawYoutubeValue.title.trim()
            ? rawYoutubeValue.title.trim()
            : YOUTUBE_DEFAULT_TITLE;
        return { url, title, icon: YOUTUBE_ICON };
    }

    return null;
}

function getYouTubeWatchUrl(url) {
    const videoId = extractYouTubeVideoId(url);
    if (!videoId) return null;
    return `https://www.youtube.com/watch?v=${videoId}`;
}

async function fetchYouTubeMetaFromProviders(url) {
    const watchUrl = getYouTubeWatchUrl(url);
    if (!watchUrl) return null;

    const providers = [
        `https://www.youtube.com/oembed?url=${encodeURIComponent(watchUrl)}&format=json`,
        `https://noembed.com/embed?url=${encodeURIComponent(watchUrl)}`
    ];

    for (const providerUrl of providers) {
        try {
            const resp = await fetch(providerUrl);
            if (!resp.ok) continue;
            const data = await resp.json();
            const title = (typeof data.title === 'string' && data.title.trim()) || '';
            if (title) return { title };
        } catch {
            // Try next metadata provider.
        }
    }

    return null;
}

async function enrichYouTubeMeta(youtubeMeta) {
    if (!youtubeMeta?.url) return youtubeMeta;

    const hasCustomTitle = youtubeMeta.title && youtubeMeta.title !== YOUTUBE_DEFAULT_TITLE;
    if (hasCustomTitle) return youtubeMeta;

    if (!youtubeMetaCache.has(youtubeMeta.url)) {
        youtubeMetaCache.set(youtubeMeta.url, fetchYouTubeMetaFromProviders(youtubeMeta.url));
    }
    const fetched = await youtubeMetaCache.get(youtubeMeta.url);
    if (!fetched) return youtubeMeta;

    return {
        ...youtubeMeta,
        title: fetched.title || youtubeMeta.title
    };
}

async function buildTitleLinkIconsHtml(rubber) {
    if (!rubber?.urls) return '';
    const countryUrls = rubber.urls[selectedCountry] || {};
    const parts = [];

    let ytMeta = normalizeYouTubeMeta(countryUrls.youtube);
    let ytIsFallback = false;
    if (!ytMeta && selectedCountry !== 'en') {
        ytMeta = normalizeYouTubeMeta((rubber.urls.en || {}).youtube);
        if (ytMeta) ytIsFallback = true;
    }
    const youtubeMeta = await enrichYouTubeMeta(ytMeta);
    if (youtubeMeta) {
        const safeTitle = escapeHtml(youtubeMeta.title);
        const safeIcon = escapeHtml(youtubeMeta.icon);
        const safeUrl = escapeHtml(youtubeMeta.url);
        const videoId = extractYouTubeVideoId(youtubeMeta.url);
        const enBadge = ytIsFallback ? `<span class="yt-en-badge">EN</span>` : '';
        if (videoId) {
            parts.push(
                `<a class="rubber-title-icon-link" href="#" data-yt-videoid="${videoId}" title="${safeTitle}" aria-label="${safeTitle}">` +
                `<img src="${safeIcon}" class="rubber-title-icon" alt="">${enBadge}` +
                `</a>`
            );
        } else {
            parts.push(
                `<a class="rubber-title-icon-link" href="${safeUrl}" target="_blank" rel="noopener" title="${safeTitle}" aria-label="${safeTitle}">` +
                `<img src="${safeIcon}" class="rubber-title-icon" alt="">${enBadge}` +
                `</a>`
            );
        }
    }

    let productUrl = countryUrls.product || '';
    if (!productUrl && selectedCountry !== 'en') {
        productUrl = (rubber.urls.en || {}).product || '';
    }
    const productMeta = getProductStoreMeta(productUrl);
    if (productMeta) {
        const safeTitle = escapeHtml(`Buy on ${productMeta.label}`);
        const iconHtml = productMeta.icon
            ? `<img src="${escapeHtml(productMeta.icon)}" class="rubber-title-icon" alt="">`
            : `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/></svg>`;
        parts.push(
            `<a class="rubber-title-icon-link rubber-title-icon-link--product" href="${escapeHtml(productMeta.url)}" target="_blank" rel="noopener" title="${safeTitle}" aria-label="${safeTitle}">` +
            `${iconHtml}<span class="rubber-title-link-label">${escapeHtml(productMeta.label)}</span>` +
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
        const resp = await fetch(v(
            `/rubbers_description/${encodeURIComponent(brand)}/${encodeURIComponent(lang)}/${encodeURIComponent(abbr)}`
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
            const localizedPath = `/rubbers_comparison/${encodeURIComponent(lang)}/${encodeURIComponent(n1)}/${encodeURIComponent(n2)}`;
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
    const localizedName = tRubberAbbr(rubber) || rubber.abbr || rubber.name || '';
    return `<span class="content-tab-dot" style="background:${color}"></span>${escapeHtml(localizedName)}`;
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
    html += `<button class="content-tab content-tab--share" id="shareBtn" type="button" aria-label="${escapeHtml(tUi('SHARE'))}">` +
        `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/><polyline points="16 6 12 2 8 6"/><line x1="12" y1="2" x2="12" y2="15"/></svg>` +
        `<span class="share-btn-label">${escapeHtml(tUi('SHARE'))}</span>` +
        `</button>`;
    tabBar.innerHTML = html;
    highlightActiveTab();
}

function highlightActiveTab() {
    const tabBar = document.getElementById('contentTabs');
    tabBar.querySelectorAll('.content-tab').forEach(btn => {
        const tabKey = btn.dataset.tab;
        const isActive = tabKey === activeTab;
        const hasContent = tabContents[tabKey] != null;
        btn.classList.toggle('content-tab--active', isActive);
        btn.classList.toggle('content-tab--empty', !hasContent);
        // Clear previous inline styles
        btn.style.background = '';
        btn.style.borderImage = '';
        btn.style.borderBottomColor = '';
        btn.style.borderBottomStyle = '';
        btn.style.borderBottomWidth = '';
        if (isActive && btn.classList.contains('content-tab--share')) {
            // Share button keeps its own styling
        } else if (isActive && !btn.classList.contains('content-tab--vs')) {
            const idx = tabKey === 'desc1' ? 0 : 1;
            const rubber = selectedRubbers[idx];
            const color = rubber ? getBrandColor(rubber.brand) : null;
            if (color) {
                btn.style.background = color + '22';
            }
        } else if (isActive && btn.classList.contains('content-tab--vs')) {
            const colorL = selectedRubbers[0] ? getBrandColor(selectedRubbers[0].brand) : 'rgba(155,148,132,0.3)';
            const colorR = selectedRubbers[1] ? getBrandColor(selectedRubbers[1].brand) : 'rgba(155,148,132,0.3)';
            btn.style.background = `linear-gradient(135deg, ${colorL}22, ${colorR}22)`;
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
    if (typeof updateDocumentTitle === 'function') updateDocumentTitle();
}

// ── Detail panel / comparison functions ──

async function updateDetailPanel(panelNum, rubber) {
    const tabKey = `desc${panelNum}`;
    const brandColor = getBrandColor(rubber.brand);
    const localizedBrand = tBrand(rubber.brand) || rubber.brand || '';
    const localizedRubber = tRubberName(rubber) || rubber.name || rubber.abbr || '';
    const [detailMarkdown, iconsHtml] = await Promise.all([
        fetchRubberDescriptionMarkdown(rubber.brand, rubber.abbr),
        buildTitleLinkIconsHtml(rubber),
    ]);
    const headerHtml =
        `<div class="rubber-title-header">` +
            `<div class="rubber-title-top">` +
                `<span class="brand-pill" style="background:${brandColor}18;border-color:${brandColor}55;color:${brandColor}">` +
                    `<span class="brand-dot" style="background:${brandColor}"></span>` +
                    `${escapeHtml(localizedBrand)}` +
                `</span>` +
            `</div>` +
            `<div class="rubber-title-row">` +
                `<h1 class="rubber-name">${rubber.bestseller ? '\u2B50 ' : ''}${escapeHtml(localizedRubber)}</h1>` +
                (iconsHtml ? `<div class="rubber-title-icons">${iconsHtml}</div>` : '') +
            `</div>` +
        `</div>`;

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
    resumeSpotlightRotation();
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
    activeTab = `desc${panelNum}`;

    // Navigate to the rubber's clean URL
    if (SLUG_MAP) {
        const slug = SLUG_MAP.abbrToSlug[rubber.abbr];
        if (slug) {
            navigateToPath('/' + (selectedCountry || 'en') + '/rubbers/' + slug);
        }
    }

    setActiveTab(`desc${panelNum}`);
    return panelNum;
}

function buildComparisonTitleHtml(leftRubber, rightRubber) {
    const leftColor = getBrandColor(leftRubber?.brand);
    const rightColor = getBrandColor(rightRubber?.brand);
    const leftBrand = escapeHtml(tBrand(leftRubber?.brand) || leftRubber?.brand || '');
    const leftName  = escapeHtml(tRubberName(leftRubber) || leftRubber?.name || leftRubber?.abbr || '');
    const rightBrand = escapeHtml(tBrand(rightRubber?.brand) || rightRubber?.brand || '');
    const rightName  = escapeHtml(tRubberName(rightRubber) || rightRubber?.name || rightRubber?.abbr || '');

    return `
        <div class="comp-title-side">
            <span class="brand-pill" style="background:${leftColor}18;border-color:${leftColor}55;color:${leftColor}">
                <span class="brand-dot" style="background:${leftColor}"></span>${leftBrand}
            </span>
            <span class="rubber-name">${leftName}</span>
        </div>
        <div class="comp-title-vs">vs</div>
        <div class="comp-title-side comp-title-side-right">
            <span class="brand-pill" style="background:${rightColor}18;border-color:${rightColor}55;color:${rightColor}">
                <span class="brand-dot" style="background:${rightColor}"></span>${rightBrand}
            </span>
            <span class="rubber-name">${rightName}</span>
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

function getShareUrl() {
    const left = selectedRubbers[0];
    const right = selectedRubbers[1];
    const country = selectedCountry || 'en';
    const origin = window.location.origin;

    if (left && right && SLUG_MAP) {
        const slugA = SLUG_MAP.abbrToSlug[left.abbr];
        const slugB = SLUG_MAP.abbrToSlug[right.abbr];
        if (slugA && slugB) {
            const [a, b] = [slugA, slugB].sort();
            return origin + '/' + country + '/rubbers/compare/' + a + '-vs-' + b;
        }
    }

    return window.location.href;
}

async function handleShareClick() {
    const url = getShareUrl();

    try {
        await navigator.clipboard.writeText(url);
    } catch {
        // Fallback for older browsers
        const textarea = document.createElement('textarea');
        textarea.value = url;
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        document.body.removeChild(textarea);
    }

    // Show "copied" feedback on the button
    const btn = document.getElementById('shareBtn');
    if (btn) {
        btn.classList.add('content-tab--share-copied');
        const label = btn.querySelector('.share-btn-label');
        const origText = label?.textContent;
        if (label) label.textContent = tUi('SHARE_COPIED');
        setTimeout(() => {
            btn.classList.remove('content-tab--share-copied');
            if (label) label.textContent = origText;
        }, 1500);
    }

    showShareToast(tUi('SHARE_COPIED'), url);
}

let shareToastTimer = null;
function showShareToast(message, url) {
    let backdrop = document.getElementById('shareBackdrop');
    if (!backdrop) {
        backdrop = document.createElement('div');
        backdrop.id = 'shareBackdrop';
        backdrop.className = 'share-backdrop';
        backdrop.innerHTML =
            '<div class="share-card" role="status" aria-live="polite">' +
                '<div class="share-card__icon">&#10003;</div>' +
                '<div class="share-card__title"></div>' +
                '<div class="share-card__url-wrap">' +
                    '<a class="share-card__link" target="_blank" rel="noopener noreferrer"></a>' +
                '</div>' +
            '</div>';
        document.body.appendChild(backdrop);
        backdrop.addEventListener('click', (e) => {
            if (e.target === backdrop) dismissShareToast();
        });
    }
    const titleEl = backdrop.querySelector('.share-card__title');
    const linkEl = backdrop.querySelector('.share-card__link');
    if (titleEl) titleEl.textContent = message;
    if (linkEl) { linkEl.textContent = url; linkEl.href = url; }
    backdrop.classList.add('is-visible');
    if (shareToastTimer) clearTimeout(shareToastTimer);
    shareToastTimer = setTimeout(dismissShareToast, 3200);
}
function dismissShareToast() {
    const b = document.getElementById('shareBackdrop');
    if (b) b.classList.remove('is-visible');
    if (shareToastTimer) { clearTimeout(shareToastTimer); shareToastTimer = null; }
}
