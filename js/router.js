// ════════════════════════════════════════════════════════════
//  Client-side Router (clean URL path parser)
// ════════════════════════════════════════════════════════════

const VALID_LANGS = ['en', 'cn', 'ko'];

/**
 * Parse the current window.location.pathname into a route descriptor.
 * @returns {{ type: string, lang: string, slug?: string, slugA?: string, slugB?: string }}
 */
function parseRoute() {
    const path = window.location.pathname.replace(/\/index\.html$/, '/');
    const segments = path.split('/').filter(Boolean);

    // / → redirect to /en/
    if (segments.length === 0) {
        return { type: 'redirect', lang: 'en' };
    }

    const lang = segments[0];
    if (!VALID_LANGS.includes(lang)) {
        return { type: 'redirect', lang: 'en' };
    }

    // /{lang}/ → homepage
    if (segments.length === 1) {
        return { type: 'homepage', lang: lang };
    }

    // /{lang}/rubbers/...
    if (segments[1] === 'rubbers') {
        // /{lang}/rubbers/compare/{slugA}-vs-{slugB}
        if (segments[2] === 'compare' && segments[3]) {
            const vsIdx = segments[3].lastIndexOf('-vs-');
            if (vsIdx > 0) {
                const slugA = segments[3].substring(0, vsIdx);
                const slugB = segments[3].substring(vsIdx + 4);
                return { type: 'comparison', lang: lang, slugA: slugA, slugB: slugB };
            }
        }

        // /{lang}/rubbers/{slug}
        if (segments[2] && segments[2] !== 'compare') {
            return { type: 'rubber', lang: lang, slug: segments[2] };
        }
    }

    // Fallback: treat as homepage for this language
    return { type: 'homepage', lang: lang };
}

/**
 * Detect old query-param URLs and redirect to new clean URLs.
 * e.g. ?left=Tenergy-05&page=rubber1&country=kr → /ko/rubbers/tenergy-05
 * @param {Object} slugMap - { abbrToSlug: { abbr: slug } }
 * @returns {boolean} true if a redirect was performed
 */
function checkLegacyUrlRedirect(slugMap) {
    const params = new URLSearchParams(window.location.search);
    const hasLegacyParams = params.has('left') || params.has('right') || params.has('page');
    if (!hasLegacyParams) return false;

    const lang = params.get('country') || 'en';
    if (!VALID_LANGS.includes(lang)) return false;

    const leftAbbr = (params.get('left') || '').replace(/-/g, ' ');
    const rightAbbr = (params.get('right') || '').replace(/-/g, ' ');
    const page = params.get('page') || '';

    const leftSlug = leftAbbr && slugMap && slugMap.abbrToSlug ? slugMap.abbrToSlug[leftAbbr] : null;
    const rightSlug = rightAbbr && slugMap && slugMap.abbrToSlug ? slugMap.abbrToSlug[rightAbbr] : null;

    let newPath = '/' + lang + '/';

    if (page === 'comparison' && leftSlug && rightSlug) {
        const [a, b] = [leftSlug, rightSlug].sort();
        newPath = '/' + lang + '/rubbers/compare/' + a + '-vs-' + b;
    } else if (page === 'rubber2' && rightSlug) {
        newPath = '/' + lang + '/rubbers/' + rightSlug;
    } else if (leftSlug) {
        newPath = '/' + lang + '/rubbers/' + leftSlug;
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
