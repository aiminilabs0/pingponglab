// ════════════════════════════════════════════════════════════
//  Slug Utilities (shared between browser & Node.js)
// ════════════════════════════════════════════════════════════

/**
 * Convert a rubber name to a URL slug.
 * e.g. "Hybrid K3" → "hybrid-k3", "Jekyll & Hyde C52.5" → "jekyll-hyde-c52.5"
 */
function toSlug(name) {
    return String(name)
        .toLowerCase()
        .replace(/&/g, '')
        .replace(/\s+/g, '-')
        .replace(/-{2,}/g, '-')
        .replace(/^-+|-+$/g, '');
}

/**
 * Look up a rubber abbreviation from a slug using the provided slug map.
 * @param {string} slug - URL slug
 * @param {Object} slugMap - { slugToAbbr: { slug: abbr }, abbrToSlug: { abbr: slug } }
 * @returns {string|null} rubber abbreviation or null
 */
function fromSlug(slug, slugMap) {
    if (!slugMap || !slugMap.slugToAbbr) return null;
    return slugMap.slugToAbbr[slug] || null;
}

// Node.js compatibility
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { toSlug, fromSlug };
}
