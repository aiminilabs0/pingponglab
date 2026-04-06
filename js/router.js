// ════════════════════════════════════════════════════════════
//  Client-side Router (clean URL path parser)
// ════════════════════════════════════════════════════════════

const VALID_COUNTRIES = ['en', 'cn', 'ko'];

function detectPreferredCountry() {
    try {
        const stored = localStorage.getItem('pingponglab_selected_country');
        if (VALID_COUNTRIES.includes(stored)) return stored;
    } catch {}

    const lang = (navigator.language || '').toLowerCase();
    if (lang.startsWith('ko')) return 'ko';
    if (lang.startsWith('zh')) return 'cn';

    return 'en';
}

/**
 * Parse the current window.location.pathname into a route descriptor.
 * @returns {{ type: string, country: string, slug?: string, slugA?: string, slugB?: string }}
 */
function parseRoute() {
    const path = window.location.pathname.replace(/\/index\.html$/, '/');
    const segments = path.split('/').filter(Boolean);

    if (segments.length === 0) {
        return { type: 'redirect', country: detectPreferredCountry() };
    }

    const country = segments[0];
    if (!VALID_COUNTRIES.includes(country)) {
        return { type: 'redirect', country: detectPreferredCountry() };
    }

    // /{country}/ → homepage
    if (segments.length === 1) {
        return { type: 'homepage', country: country };
    }

    // /{country}/rubbers/...
    if (segments[1] === 'rubbers') {
        // /{country}/rubbers/compare/{slugA}-vs-{slugB}
        if (segments[2] === 'compare' && segments[3]) {
            const vsIdx = segments[3].lastIndexOf('-vs-');
            if (vsIdx > 0) {
                const slugA = segments[3].substring(0, vsIdx);
                const slugB = segments[3].substring(vsIdx + 4);
                return { type: 'comparison', country: country, slugA: slugA, slugB: slugB };
            }
        }

        // /{country}/rubbers/{slug}
        if (segments[2] && segments[2] !== 'compare') {
            return { type: 'rubber', country: country, slug: segments[2] };
        }
    }

    // Fallback: treat as homepage for this country
    return { type: 'homepage', country: country };
}

/**
 * Detect old query-param URLs and redirect to new clean URLs.
 * e.g. ?left=Tenergy-05&page=rubber1&country=ko → /ko/rubbers/tenergy-05
 * @param {Object} slugMap - { abbrToSlug: { abbr: slug } }
 * @returns {boolean} true if a redirect was performed
 */
function checkLegacyUrlRedirect(slugMap) {
    const params = new URLSearchParams(window.location.search);
    const hasLegacyParams = params.has('left') || params.has('right') || params.has('page');
    if (!hasLegacyParams) return false;

    const country = params.get('country') || 'en';
    if (!VALID_COUNTRIES.includes(country)) return false;

    const leftAbbr = (params.get('left') || '').replace(/-/g, ' ');
    const rightAbbr = (params.get('right') || '').replace(/-/g, ' ');
    const page = params.get('page') || '';

    const leftSlug = leftAbbr && slugMap && slugMap.abbrToSlug ? slugMap.abbrToSlug[leftAbbr] : null;
    const rightSlug = rightAbbr && slugMap && slugMap.abbrToSlug ? slugMap.abbrToSlug[rightAbbr] : null;

    let newPath = '/' + country + '/';

    if (page === 'comparison' && leftSlug && rightSlug) {
        const [a, b] = [leftSlug, rightSlug].sort();
        newPath = '/' + country + '/rubbers/compare/' + a + '-vs-' + b;
    } else if (page === 'rubber2' && rightSlug) {
        newPath = '/' + country + '/rubbers/' + rightSlug;
    } else if (leftSlug) {
        newPath = '/' + country + '/rubbers/' + leftSlug;
    }

    // Preserve filter-only params (not left/right/page/country)
    const filterParams = new URLSearchParams();
    for (const [key, value] of params.entries()) {
        if (!['left', 'right', 'page', 'country', 'pin'].includes(key)) {
            filterParams.set(key, value);
        }
    }
    const qs = filterParams.toString();
    const fullUrl = newPath + (qs ? '?' + qs : '');

    window.location.replace(fullUrl);
    return true;
}
