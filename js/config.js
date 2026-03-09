// ════════════════════════════════════════════════════════════
//  Constants & Configuration
// ════════════════════════════════════════════════════════════

function debounce(fn, ms) {
    let timer;
    return (...args) => {
        clearTimeout(timer);
        timer = setTimeout(() => fn(...args), ms);
    };
}

const CACHE_VERSION = 26;
const LAST_MODIFIED = '2026-03-09';
function v(url) { return url + (url.includes('?') ? '&' : '?') + 'v=' + CACHE_VERSION; }

const RUBBER_INDEX_FILE = 'stats/rubbers/index.json';
const RANKING_FILES = {
    spin: 'stats/rubbers/ranking/spin.json',
    speed: 'stats/rubbers/ranking/speed.json',
    control: 'stats/rubbers/ranking/control.json'
};
const PRIORITY_FILE = 'stats/rubbers/ranking/priority.json';
const BESTSELLER_FILE = 'stats/rubbers/ranking/bestseller.json';
const PLAYERS_FILE = 'players/players.json';

const BRAND_COLORS = {
    Butterfly: '#f11b85',
    DHS: '#43d1d9',
    Andro: '#4bad33',
    JOOLA: '#d4da03',
    Xiom: '#FF7F00',
    Tibhar: '#e3000b',
    Nittaku: '#3E49AA',
    Donic: '#5E7DCC',
    Yasaka: '#7e67ff',
    YINHE: '#2596be'
};

const SHEET_MARKERS = {
    Classic: 'circle',
    Chinese: 'square',
    Hybrid: 'diamond'
};

// Country hardness scales — GE is the global standard; JP & CN are equivalent scales.
// GE 40 = JP 33 = CN 35 (soft), GE 47.5 = JP 36 = CN 39 (medium), GE 55 = JP 44 = CN 41 (hard)
const HARDNESS_SCALES = {
    Germany: [40, 47.5, 55],
    Japan:   [33, 36,   44],
    China:   [35, 39,   41]
};

// Piecewise-linear interpolation between two 3-point scales
function interpolateScale(value, fromPts, toPts) {
    for (let i = 0; i < fromPts.length - 1; i++) {
        if (value <= fromPts[i + 1] || i === fromPts.length - 2) {
            const t = (value - fromPts[i]) / (fromPts[i + 1] - fromPts[i]);
            return toPts[i] + t * (toPts[i + 1] - toPts[i]);
        }
    }
    return value;
}

function toGermanScale(value, country) {
    if (!Number.isFinite(value)) return null;
    if (country === 'Germany' || !HARDNESS_SCALES[country]) return value;
    return interpolateScale(value, HARDNESS_SCALES[country], HARDNESS_SCALES.Germany);
}

function fromGermanScale(geValue, country) {
    if (!Number.isFinite(geValue)) return null;
    if (country === 'Germany' || !HARDNESS_SCALES[country]) return geValue;
    return interpolateScale(geValue, HARDNESS_SCALES.Germany, HARDNESS_SCALES[country]);
}

const COUNTRY_TO_LANG = { us: 'en', eu: 'en', cn: 'cn', kr: 'ko' };
const COUNTRY_FLAGS = { Germany: '🇩🇪', Japan: '🇯🇵', China: '🇨🇳' };
const FILTER_IDS = ['brand', 'name', 'sheet', 'hardness', 'weight', 'control', 'top30'];
const DEBUG_MODE = new URLSearchParams(window.location.search).has('debug');

const CHART_FONT = '-apple-system, BlinkMacSystemFont, Segoe UI, Roboto, sans-serif';
const HOVER_POPUP_ID = 'chartHoverPopup';
const IS_TOUCH_DEVICE =
    window.matchMedia('(hover: none)').matches ||
    window.matchMedia('(pointer: coarse)').matches ||
    navigator.maxTouchPoints > 0;

// ════════════════════════════════════════════════════════════
//  Shared Utility Functions
// ════════════════════════════════════════════════════════════

function escapeHtml(value) {
    return String(value ?? '')
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#39;');
}

function getHardnessCategoryLabel(normalizedHardness) {
    if (!Number.isFinite(normalizedHardness)) return null;
    // Boundaries are midpoints between GE anchors: 40 (soft), 47.5 (medium), 55 (hard).
    if (normalizedHardness < 46) return 'Soft';
    if (normalizedHardness < 51) return 'Medium';
    return 'Hard';
}

function extractYouTubeVideoId(url) {
    if (!url) return null;
    try {
        const parsed = new URL(url);
        const host = parsed.hostname.toLowerCase();
        const path = parsed.pathname;

        if (host === 'youtu.be') {
            const id = path.replace(/^\/+/, '').split('/')[0];
            return id || null;
        }

        if (!host.endsWith('youtube.com')) return null;

        if (path === '/watch') {
            const id = parsed.searchParams.get('v');
            return id || null;
        }

        const segments = path.split('/').filter(Boolean);
        if (segments[0] === 'shorts' || segments[0] === 'embed' || segments[0] === 'live') {
            return segments[1] || null;
        }
    } catch {
        // Non-URL input or parse failure; fall back to regex.
    }

    const fallback = String(url).match(/(?:youtube\.com\/(?:watch\?v=|shorts\/|embed\/|live\/)|youtu\.be\/)([\w-]+)/i);
    return fallback ? fallback[1] : null;
}

const getBrandColor = brand => BRAND_COLORS[brand] || '#999999';
const getSheetSymbol = sheet => SHEET_MARKERS[sheet] || 'circle';

function getDeviceTypeForGa() {
    return IS_TOUCH_DEVICE ? 'mobile' : 'desktop';
}

function normalizeGaToken(value) {
    return String(value || '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '')
        .replace(/_+/g, '_');
}

function getCountryTokenForGa() {
    const currentCountry = typeof selectedCountry === 'string' ? selectedCountry : '';
    return normalizeGaToken(currentCountry) || 'unknown';
}

function getLoginNameInputForGa() {
    try {
        const input = document.getElementById('loginNameInput');
        const inputValue = (input?.value || '').trim();
        if (inputValue) return inputValue;
        return (localStorage.getItem('pingponglab_user_id') || '').trim();
    } catch {
        return '';
    }
}

function buildCountryGaEventName(eventToken, nameToken) {
    return `c_${normalizeGaToken(eventToken) || 'unknown'}_${getCountryTokenForGa()}_${normalizeGaToken(nameToken) || 'unknown'}`;
}

function isAnalyticsBlockedUser() {
    try {
        const user = (localStorage.getItem('pingponglab_user_id') || '').trim().toLowerCase();
        return user === 'tiny657';
    } catch {
        return false;
    }
}

// ════════════════════════════════════════════════════════════
//  Analytics
// ════════════════════════════════════════════════════════════

function trackRubberClickEvent(rubber) {
    if (!rubber || typeof window.gtag !== 'function' || isAnalyticsBlockedUser()) return;
    const rubberAbbr = normalizeGaToken(rubber.abbr);
    window.gtag('event', buildCountryGaEventName('click', rubberAbbr), {
        rubber_abbr: rubber.abbr || '',
        device_type: getDeviceTypeForGa(),
        login_name: getLoginNameInputForGa()
    });
}

function trackContentFeedbackVote(vote, context = {}) {
    if (!vote || typeof window.gtag !== 'function' || isAnalyticsBlockedUser()) return;
    const contentType = context.contentType || 'unknown';
    const tabId = context.tabId || activeTab || '';

    let eventName = '';
    if (contentType === 'description') {
        eventName = buildCountryGaEventName(vote === 'good' ? 'good_desc' : 'bad_desc', context.rubberName);
    } else if (contentType === 'comparison') {
        const left = normalizeGaToken(context.leftRubber) || 'unknown';
        const right = normalizeGaToken(context.rightRubber) || 'unknown';
        eventName = buildCountryGaEventName(vote === 'good' ? 'good_comp' : 'bad_comp', `${left}_${right}`);
    } else {
        eventName = buildCountryGaEventName(`feedback_${contentType}`, vote);
    }

    window.gtag('event', eventName, {
        rubber_name: context.rubberName || '',
        device_type: getDeviceTypeForGa(),
        login_name: getLoginNameInputForGa()
    });
}

function trackAppLoadedEvent() {
    if (typeof window.gtag !== 'function' || isAnalyticsBlockedUser()) return;
    const deviceType = getDeviceTypeForGa();
    window.gtag('event', buildCountryGaEventName('device', deviceType), {
        device_type: deviceType,
        login_name: getLoginNameInputForGa()
    });
}

function trackComparisonRequestEvent(leftRubberName, rightRubberName) {
    if (typeof window.gtag !== 'function' || isAnalyticsBlockedUser()) return;
    const left = normalizeGaToken(leftRubberName) || 'unknown';
    const right = normalizeGaToken(rightRubberName) || 'unknown';
    window.gtag('event', `c_request_${left}_${right}`, {
        left_rubber: leftRubberName || '',
        right_rubber: rightRubberName || '',
        device_type: getDeviceTypeForGa(),
        login_name: getLoginNameInputForGa()
    });
}
