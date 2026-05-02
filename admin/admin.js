// Admin page: list every YouTube video referenced by rubber explanations
// (per-locale) and player profiles, with thumbnails that link out to YouTube.

const VIDEO_ID_RE = /(?:v=|youtu\.be\/|\/shorts\/|\/embed\/)([A-Za-z0-9_-]{11})/;
const LOCALES = ['en', 'ko', 'cn'];
const LOCALE_LABEL = { en: 'EN', ko: 'KO', cn: 'CN' };
const MAX_THUMB_ATTEMPTS = ['mqdefault', 'hqdefault', 'default'];

const state = {
    rubbers: [],   // [{ brand, abbr, name, locale, videoId, url, isShort }]
    players: [],   // [{ name, rank, ttblRank, forehand, backhand, videos: [{ url, videoId, isShort }] }]
    activeTab: 'rubbers',
    query: '',
};

const $ = (id) => document.getElementById(id);

function extractVideoId(url) {
    if (typeof url !== 'string') return null;
    const trimmed = url.trim();
    if (!trimmed) return null;
    const m = trimmed.match(VIDEO_ID_RE);
    return m ? m[1] : null;
}

function isShortsUrl(url) {
    return typeof url === 'string' && /\/shorts\//.test(url);
}

function thumbUrl(videoId, variant = 'mqdefault') {
    return `https://img.youtube.com/vi/${videoId}/${variant}.jpg`;
}

function youtubeWatchUrl(videoId) {
    return `https://www.youtube.com/watch?v=${videoId}`;
}

function setStatus(text, isError = false) {
    const el = $('adminStatus');
    if (!el) return;
    el.textContent = text;
    el.classList.toggle('is-error', !!isError);
}

async function fetchJson(url) {
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) throw new Error(`${res.status} ${res.statusText} (${url})`);
    return res.json();
}

async function loadRubbers() {
    const index = await fetchJson('/stats/rubbers/index.json');
    const out = [];
    const results = await Promise.all(index.map(async (path) => {
        try {
            const data = await fetchJson('/' + path);
            return { path, data };
        } catch (err) {
            console.warn('Failed to load rubber', path, err);
            return null;
        }
    }));

    for (const entry of results) {
        if (!entry) continue;
        const { path, data } = entry;
        const parts = path.split('/');
        const brand = parts[1];
        const abbr = (parts[2] || '').replace(/\.json$/, '');
        const name = (data && data.name) || abbr;
        const urls = (data && data.urls) || {};
        const priceData = (data && data.price) || {};
        const rawHistory = Array.isArray(data && data.price_history) ? data.price_history : [];
        const locales = {};
        const pricing = {};
        for (const locale of LOCALES) {
            const url = urls[locale] && urls[locale].youtube;
            const videoId = extractVideoId(url);
            locales[locale] = videoId
                ? { url, videoId, isShort: isShortsUrl(url) }
                : null;

            const p = priceData[locale] || {};
            const productUrl = (urls[locale] && urls[locale].product) || '';
            const regular = (p.regular || '').toString().trim();
            const sale = (p.sale || '').toString().trim();
            const discount = (p.discount || '').toString().trim();

            // Pull every snapshot that includes this locale; keep newest first.
            const history = [];
            for (const snap of rawHistory) {
                if (!snap || typeof snap !== 'object') continue;
                const entry = snap[locale];
                if (!entry) continue;
                const reg = (entry.regular || '').toString().trim();
                const sl = (entry.sale || '').toString().trim();
                const dc = (entry.discount || '').toString().trim();
                if (!reg && !sl) continue;
                history.push({
                    date: snap.date || '',
                    regular: reg,
                    sale: sl,
                    discount: dc,
                });
            }
            history.sort((a, b) => (b.date || '').localeCompare(a.date || ''));

            pricing[locale] = {
                regular,
                sale,
                discount,
                productUrl,
                history,
                hasPrice: !!regular,
            };
        }
        out.push({
            brand,
            abbr,
            name,
            nameI18n: (data && data.name_i18n) || {},
            locales,
            pricing,
        });
    }
    out.sort((a, b) => {
        const byBrand = a.brand.localeCompare(b.brand);
        if (byBrand) return byBrand;
        return a.name.localeCompare(b.name);
    });
    return out;
}

async function loadPlayers() {
    const data = await fetchJson('/players/players.json');
    const out = [];
    for (const [name, info] of Object.entries(data || {})) {
        const youtubes = Array.isArray(info && info.youtubes) ? info.youtubes : [];
        const videos = [];
        const seen = new Set();
        for (const url of youtubes) {
            const videoId = extractVideoId(url);
            if (!videoId || seen.has(videoId)) continue;
            seen.add(videoId);
            videos.push({ url, videoId, isShort: isShortsUrl(url) });
        }
        if (!videos.length) continue;
        out.push({
            name,
            fullName: (info && info.full_name) || name,
            localizedNames: (info && info.localized_names) || {},
            rank: info && typeof info.ranking === 'number' ? info.ranking : null,
            ttblRank: info && typeof info.ttbl_ranking === 'number' ? info.ttbl_ranking : null,
            forehand: (info && info.forehand) || '',
            backhand: (info && info.backhand) || '',
            videos,
        });
    }
    out.sort((a, b) => {
        const ra = a.rank == null ? Number.POSITIVE_INFINITY : a.rank;
        const rb = b.rank == null ? Number.POSITIVE_INFINITY : b.rank;
        if (ra !== rb) return ra - rb;
        return a.name.localeCompare(b.name);
    });
    return out;
}

function attachThumbFallback(img) {
    let attempt = 0;
    img.addEventListener('error', () => {
        attempt += 1;
        if (attempt < MAX_THUMB_ATTEMPTS.length) {
            const videoId = img.dataset.videoId;
            img.src = thumbUrl(videoId, MAX_THUMB_ATTEMPTS[attempt]);
        } else {
            img.classList.add('is-broken');
            const card = img.closest('.admin-thumb');
            if (card && !card.querySelector('.admin-thumb-fallback')) {
                const fb = document.createElement('div');
                fb.className = 'admin-thumb-fallback';
                fb.textContent = 'Thumbnail unavailable';
                card.appendChild(fb);
            }
        }
    });
}

function makeThumbCard({ videoId, url, title, subtitle, locale, isShort, extra }) {
    const a = document.createElement('a');
    a.className = 'admin-card';
    a.href = url || youtubeWatchUrl(videoId);
    a.target = '_blank';
    a.rel = 'noopener noreferrer';

    const thumb = document.createElement('div');
    thumb.className = 'admin-thumb';

    const img = document.createElement('img');
    img.loading = 'lazy';
    img.decoding = 'async';
    img.alt = title;
    img.dataset.videoId = videoId;
    img.src = thumbUrl(videoId);
    attachThumbFallback(img);
    thumb.appendChild(img);

    if (locale) {
        const badge = document.createElement('span');
        badge.className = 'admin-locale-badge';
        badge.textContent = LOCALE_LABEL[locale] || locale.toUpperCase();
        thumb.appendChild(badge);
    }
    if (isShort) {
        const sBadge = document.createElement('span');
        sBadge.className = 'admin-shorts-badge';
        sBadge.textContent = 'Shorts';
        thumb.appendChild(sBadge);
    }
    a.appendChild(thumb);

    const body = document.createElement('div');
    body.className = 'admin-card-body';

    const t = document.createElement('div');
    t.className = 'admin-card-title';
    t.textContent = title;
    body.appendChild(t);

    if (subtitle) {
        const m = document.createElement('div');
        m.className = 'admin-card-meta';
        m.textContent = subtitle;
        body.appendChild(m);
    }
    if (extra) {
        body.appendChild(extra);
    }
    a.appendChild(body);
    return a;
}

function rubberMatchesQuery(rubber, q) {
    if (!q) return true;
    const haystack = [
        rubber.name,
        rubber.brand,
        rubber.abbr,
        ...Object.values(rubber.nameI18n || {}),
    ].filter(Boolean).join(' ').toLowerCase();
    return haystack.includes(q);
}

function makeMissingCard(locale, rubberName) {
    const wrap = document.createElement('div');
    wrap.className = 'admin-card admin-card--missing';
    wrap.setAttribute('aria-disabled', 'true');

    const thumb = document.createElement('div');
    thumb.className = 'admin-thumb';
    const fb = document.createElement('div');
    fb.className = 'admin-thumb-fallback';
    fb.textContent = 'No video';
    thumb.appendChild(fb);

    if (locale) {
        const badge = document.createElement('span');
        badge.className = 'admin-locale-badge';
        badge.textContent = LOCALE_LABEL[locale] || locale.toUpperCase();
        thumb.appendChild(badge);
    }
    wrap.appendChild(thumb);

    const body = document.createElement('div');
    body.className = 'admin-card-body';
    const title = document.createElement('div');
    title.className = 'admin-card-title';
    title.textContent = rubberName;
    body.appendChild(title);
    const meta = document.createElement('div');
    meta.className = 'admin-card-meta admin-card-meta--missing';
    meta.textContent = `Missing ${LOCALE_LABEL[locale] || locale}`;
    body.appendChild(meta);
    wrap.appendChild(body);

    return wrap;
}

function renderRubbers() {
    const list = $('rubbersList');
    const empty = $('rubbersEmpty');
    if (!list || !empty) return;
    list.innerHTML = '';
    const q = state.query;
    const rubbers = state.rubbers.filter(r => rubberMatchesQuery(r, q));
    if (!rubbers.length) {
        empty.hidden = false;
        return;
    }
    empty.hidden = true;

    // Group rubbers by brand; order preserved by sort in loadRubbers().
    const byBrand = new Map();
    for (const rubber of rubbers) {
        if (!byBrand.has(rubber.brand)) byBrand.set(rubber.brand, []);
        byBrand.get(rubber.brand).push(rubber);
    }

    const brands = Array.from(byBrand.keys()).sort((a, b) => a.localeCompare(b));
    const frag = document.createDocumentFragment();
    for (const brand of brands) {
        const brandRubbers = byBrand.get(brand);
        let videoCount = 0;
        let missingCount = 0;
        for (const r of brandRubbers) {
            for (const locale of LOCALES) {
                if (r.locales[locale]) videoCount += 1;
                else missingCount += 1;
            }
        }

        const block = document.createElement('section');
        block.className = 'admin-brand-group';

        const head = document.createElement('div');
        head.className = 'admin-brand-head';

        const nameEl = document.createElement('h2');
        nameEl.className = 'admin-brand-name';
        nameEl.textContent = brand;
        head.appendChild(nameEl);

        const meta = document.createElement('span');
        meta.className = 'admin-brand-meta';
        const parts = [`${brandRubbers.length} rubber${brandRubbers.length === 1 ? '' : 's'}`];
        parts.push(`${videoCount} video${videoCount === 1 ? '' : 's'}`);
        if (missingCount) parts.push(`<em class="admin-brand-meta-missing">${missingCount} missing</em>`);
        meta.innerHTML = parts.join(' · ');
        head.appendChild(meta);

        block.appendChild(head);

        const rubberList = document.createElement('div');
        rubberList.className = 'admin-rubber-list';
        for (const rubber of brandRubbers) {
            const item = document.createElement('div');
            item.className = 'admin-rubber-item';
            const haveAny = LOCALES.some(loc => rubber.locales[loc]);
            if (!haveAny) item.classList.add('admin-rubber-item--empty');

            const label = document.createElement('div');
            label.className = 'admin-rubber-name';
            const titleEl = document.createElement('span');
            titleEl.className = 'admin-rubber-title';
            titleEl.textContent = rubber.name;
            label.appendChild(titleEl);
            const badges = document.createElement('span');
            badges.className = 'admin-rubber-locales';
            for (const locale of LOCALES) {
                const has = !!rubber.locales[locale];
                const b = document.createElement('span');
                b.className = `admin-rubber-locale${has ? '' : ' is-missing'}`;
                b.textContent = LOCALE_LABEL[locale] || locale.toUpperCase();
                badges.appendChild(b);
            }
            label.appendChild(badges);
            item.appendChild(label);

            const row = document.createElement('div');
            row.className = 'admin-brand-row';
            for (const locale of LOCALES) {
                const v = rubber.locales[locale];
                if (v) {
                    row.appendChild(makeThumbCard({
                        videoId: v.videoId,
                        url: v.url,
                        title: rubber.name,
                        subtitle: LOCALE_LABEL[locale] || locale,
                        locale,
                        isShort: v.isShort,
                    }));
                } else {
                    row.appendChild(makeMissingCard(locale, rubber.name));
                }
            }
            item.appendChild(row);
            rubberList.appendChild(item);
        }
        block.appendChild(rubberList);
        frag.appendChild(block);
    }
    list.appendChild(frag);
}

// ── Players grouped by rubber ────────────────────────────────────────────

function parseRubberRef(s) {
    if (typeof s !== 'string') return null;
    const trimmed = s.trim();
    if (!trimmed) return null;
    const i = trimmed.indexOf('/');
    if (i < 0) return null;
    const brand = trimmed.slice(0, i).trim();
    const abbr = trimmed.slice(i + 1).trim();
    if (!brand || !abbr) return null;
    return { brand, abbr, key: `${brand}/${abbr}` };
}

// rubberKey -> Map<playerName, { player, side: 'FH' | 'BH' | 'FH/BH' }>
function buildRubberPlayerIndex(players) {
    const index = new Map();
    function ensure(key) {
        if (!index.has(key)) index.set(key, new Map());
        return index.get(key);
    }
    function add(key, player, side) {
        const map = ensure(key);
        const existing = map.get(player.name);
        if (existing) {
            if (existing.side !== side) existing.side = 'FH/BH';
        } else {
            map.set(player.name, { player, side });
        }
    }
    for (const p of players) {
        const fh = parseRubberRef(p.forehand);
        const bh = parseRubberRef(p.backhand);
        if (fh) add(fh.key, p, 'FH');
        if (bh) add(bh.key, p, 'BH');
    }
    return index;
}

function rubberPlayerMatchesQuery(rubber, users, q) {
    if (!q) return true;
    if (rubberMatchesQuery(rubber, q)) return true;
    for (const { player } of users) {
        const hay = [
            player.name,
            player.fullName,
            ...Object.values(player.localizedNames || {}),
        ].filter(Boolean).join(' ').toLowerCase();
        if (hay.includes(q)) return true;
    }
    return false;
}

function makePlayerVideoRow(player) {
    const row = document.createElement('div');
    row.className = 'admin-player-grid';
    for (const video of player.videos) {
        row.appendChild(makeThumbCard({
            videoId: video.videoId,
            url: video.url,
            title: player.name,
            isShort: video.isShort,
        }));
    }
    return row;
}

function renderPlayerUsageRow(player, side) {
    const item = document.createElement('div');
    item.className = 'admin-rubber-item';

    const label = document.createElement('div');
    label.className = 'admin-rubber-name';

    const titleEl = document.createElement('span');
    titleEl.className = 'admin-rubber-title';
    titleEl.textContent = player.name;
    label.appendChild(titleEl);

    const sideTag = document.createElement('span');
    sideTag.className = `admin-rubber-locale admin-side-tag admin-side-${side.replace('/', '-').toLowerCase()}`;
    sideTag.textContent = side;
    label.appendChild(sideTag);

    if (player.rank != null) {
        const r = document.createElement('span');
        r.className = 'admin-player-rank';
        r.textContent = `#${player.rank}`;
        label.appendChild(r);
    }
    if (player.ttblRank != null) {
        const tr = document.createElement('span');
        tr.className = 'admin-player-rank';
        tr.style.color = 'var(--drac-purple)';
        tr.style.background = 'rgba(157, 127, 245, 0.1)';
        tr.textContent = `TTBL #${player.ttblRank}`;
        label.appendChild(tr);
    }

    const meta = document.createElement('span');
    meta.className = 'admin-brand-meta';
    meta.textContent = `${player.videos.length} video${player.videos.length === 1 ? '' : 's'}`;
    label.appendChild(meta);

    item.appendChild(label);
    item.appendChild(makePlayerVideoRow(player));
    return item;
}

function renderRubberSection(rubber, users) {
    // ``users`` is an array of { player, side }.
    const block = document.createElement('section');
    block.className = 'admin-rubber-card';
    if (!users.length) block.classList.add('admin-rubber-card--empty');

    const head = document.createElement('div');
    head.className = 'admin-rubber-head';

    const nameEl = document.createElement('h3');
    nameEl.className = 'admin-rubber-card-name';
    nameEl.textContent = rubber.name;
    head.appendChild(nameEl);

    const meta = document.createElement('span');
    meta.className = 'admin-brand-meta';
    if (users.length) {
        const videoTotal = users.reduce((acc, u) => acc + u.player.videos.length, 0);
        meta.textContent =
            `${users.length} player${users.length === 1 ? '' : 's'} · ` +
            `${videoTotal} video${videoTotal === 1 ? '' : 's'}`;
    } else {
        meta.innerHTML = '<em class="admin-brand-meta-missing">No players</em>';
    }
    head.appendChild(meta);

    block.appendChild(head);

    if (users.length) {
        const list = document.createElement('div');
        list.className = 'admin-rubber-list';
        for (const { player, side } of users) {
            list.appendChild(renderPlayerUsageRow(player, side));
        }
        block.appendChild(list);
    } else {
        const empty = document.createElement('p');
        empty.className = 'admin-rubber-card-empty';
        empty.textContent = 'No professional players currently use this rubber.';
        block.appendChild(empty);
    }

    return block;
}

function renderPlayers() {
    const list = $('playersList');
    const empty = $('playersEmpty');
    if (!list || !empty) return;
    list.innerHTML = '';

    const usage = buildRubberPlayerIndex(state.players);
    const q = state.query;

    // Group rubbers by brand; same source of truth as the Rubber tab.
    const byBrand = new Map();
    for (const rubber of state.rubbers) {
        const users = Array.from((usage.get(`${rubber.brand}/${rubber.abbr}`) || new Map()).values());
        // Order players by ranking, then by name.
        users.sort((a, b) => {
            const ra = a.player.rank == null ? Number.POSITIVE_INFINITY : a.player.rank;
            const rb = b.player.rank == null ? Number.POSITIVE_INFINITY : b.player.rank;
            if (ra !== rb) return ra - rb;
            return a.player.name.localeCompare(b.player.name);
        });
        if (!rubberPlayerMatchesQuery(rubber, users, q)) continue;
        if (!byBrand.has(rubber.brand)) byBrand.set(rubber.brand, []);
        byBrand.get(rubber.brand).push({ rubber, users });
    }

    // Unknown rubbers — referenced by a player's FH/BH but not in the index.
    const knownKeys = new Set(state.rubbers.map(r => `${r.brand}/${r.abbr}`));
    const unknown = [];
    for (const [key, playerMap] of usage.entries()) {
        if (knownKeys.has(key)) continue;
        const idx = key.indexOf('/');
        const brand = key.slice(0, idx);
        const abbr = key.slice(idx + 1);
        const ghost = { brand, abbr, name: abbr, nameI18n: {}, locales: {} };
        const users = Array.from(playerMap.values()).sort((a, b) => {
            const ra = a.player.rank == null ? Number.POSITIVE_INFINITY : a.player.rank;
            const rb = b.player.rank == null ? Number.POSITIVE_INFINITY : b.player.rank;
            if (ra !== rb) return ra - rb;
            return a.player.name.localeCompare(b.player.name);
        });
        if (rubberPlayerMatchesQuery(ghost, users, q)) {
            unknown.push({ rubber: ghost, users });
        }
    }

    if (!byBrand.size && !unknown.length) {
        empty.hidden = false;
        return;
    }
    empty.hidden = true;

    const frag = document.createDocumentFragment();
    const brands = Array.from(byBrand.keys()).sort((a, b) => a.localeCompare(b));
    for (const brand of brands) {
        const entries = byBrand.get(brand);
        let totalPlayers = 0;
        let totalVideos = 0;
        let missingRubbers = 0;
        for (const e of entries) {
            const seen = new Set();
            for (const u of e.users) {
                seen.add(u.player.name);
                totalVideos += u.player.videos.length;
            }
            totalPlayers += seen.size;
            if (!e.users.length) missingRubbers += 1;
        }

        const block = document.createElement('section');
        block.className = 'admin-brand-group';

        const head = document.createElement('div');
        head.className = 'admin-brand-head';

        const nameEl = document.createElement('h2');
        nameEl.className = 'admin-brand-name';
        nameEl.textContent = brand;
        head.appendChild(nameEl);

        const meta = document.createElement('span');
        meta.className = 'admin-brand-meta';
        const parts = [`${entries.length} rubber${entries.length === 1 ? '' : 's'}`];
        parts.push(`${totalPlayers} player${totalPlayers === 1 ? '' : 's'}`);
        parts.push(`${totalVideos} video${totalVideos === 1 ? '' : 's'}`);
        if (missingRubbers) parts.push(`<em class="admin-brand-meta-missing">${missingRubbers} unused</em>`);
        meta.innerHTML = parts.join(' · ');
        head.appendChild(meta);

        block.appendChild(head);

        const cards = document.createElement('div');
        cards.className = 'admin-rubber-cards';
        for (const { rubber, users } of entries) {
            cards.appendChild(renderRubberSection(rubber, users));
        }
        block.appendChild(cards);
        frag.appendChild(block);
    }

    if (unknown.length) {
        const block = document.createElement('section');
        block.className = 'admin-brand-group admin-brand-group--unknown';

        const head = document.createElement('div');
        head.className = 'admin-brand-head';

        const nameEl = document.createElement('h2');
        nameEl.className = 'admin-brand-name';
        nameEl.textContent = 'Unindexed rubbers';
        head.appendChild(nameEl);

        const meta = document.createElement('span');
        meta.className = 'admin-brand-meta';
        meta.innerHTML =
            `<em class="admin-brand-meta-missing">Referenced by players but missing from the rubber index (${unknown.length})</em>`;
        head.appendChild(meta);

        block.appendChild(head);

        const cards = document.createElement('div');
        cards.className = 'admin-rubber-cards';
        for (const { rubber, users } of unknown) {
            cards.appendChild(renderRubberSection(rubber, users));
        }
        block.appendChild(cards);
        frag.appendChild(block);
    }

    list.appendChild(frag);
}

function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, ch => (
        { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]
    ));
}

// ── Pricing tab ──────────────────────────────────────────────────────────

function renderPriceCell(locale, info) {
    const cell = document.createElement('div');
    cell.className = `admin-price-cell admin-price-cell--${locale}`;
    if (!info.hasPrice) cell.classList.add('admin-price-cell--missing');

    const head = document.createElement('div');
    head.className = 'admin-price-head';
    const localeEl = document.createElement('span');
    localeEl.className = 'admin-rubber-locale';
    if (!info.hasPrice) localeEl.classList.add('is-missing');
    localeEl.textContent = LOCALE_LABEL[locale] || locale.toUpperCase();
    head.appendChild(localeEl);
    if (info.discount) {
        const d = document.createElement('span');
        d.className = 'admin-price-discount';
        d.textContent = info.discount;
        head.appendChild(d);
    }
    cell.appendChild(head);

    if (info.hasPrice) {
        if (info.sale) {
            const sale = document.createElement('div');
            sale.className = 'admin-price-sale';
            sale.textContent = info.sale;
            cell.appendChild(sale);

            const reg = document.createElement('div');
            reg.className = 'admin-price-regular admin-price-regular--struck';
            reg.textContent = info.regular;
            cell.appendChild(reg);
        } else {
            const reg = document.createElement('div');
            reg.className = 'admin-price-regular';
            reg.textContent = info.regular;
            cell.appendChild(reg);
        }
    } else {
        const empty = document.createElement('div');
        empty.className = 'admin-price-empty';
        empty.textContent = 'No price';
        cell.appendChild(empty);
    }

    if (info.productUrl) {
        const link = document.createElement('a');
        link.className = 'admin-price-link';
        link.href = info.productUrl;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        link.textContent = 'Product page →';
        cell.appendChild(link);
    } else if (info.hasPrice) {
        const link = document.createElement('span');
        link.className = 'admin-price-link admin-price-link--missing';
        link.textContent = 'No product link';
        cell.appendChild(link);
    }

    if (info.history && info.history.length) {
        cell.appendChild(renderPriceHistory(info.history, info));
    }

    return cell;
}

// Effective transaction price for a snapshot (or the live price): sale if
// present, otherwise regular. Use this for cross-snapshot comparison so the
// delta reflects what a buyer actually pays at each point in time.
function effectivePrice(entry) {
    if (!entry) return '';
    return (entry.sale && entry.sale.trim())
        ? entry.sale.trim()
        : (entry.regular || '').trim();
}

function parsePriceNumber(s) {
    if (typeof s !== 'string') return null;
    // Strip currency symbols, thousands separators, whitespace; keep digits + decimal.
    const m = s.replace(/[, ]/g, '').match(/-?\d+(?:\.\d+)?/);
    return m ? parseFloat(m[0]) : null;
}

function priceDirection(fromNum, toNum) {
    if (fromNum == null || toNum == null || fromNum === toNum) return null;
    return toNum > fromNum ? 'up' : 'down';
}

function renderPriceHistory(history, currentInfo) {
    const wrap = document.createElement('details');
    wrap.className = 'admin-price-history';
    wrap.open = true;

    const summary = document.createElement('summary');
    summary.className = 'admin-price-history-summary';
    summary.innerHTML =
        `<span class="admin-price-history-label">Price history</span>` +
        `<span class="admin-price-history-count">${history.length}</span>`;
    wrap.appendChild(summary);

    const list = document.createElement('ul');
    list.className = 'admin-price-history-list';

    // ``history`` is sorted newest-first. The element conceptually "newer" than
    // history[0] is the current live price; for history[i>0] it's history[i-1].
    const currentEff = effectivePrice(currentInfo);
    const currentNum = parsePriceNumber(currentEff);

    for (let i = 0; i < history.length; i++) {
        const entry = history[i];
        const prevEff = effectivePrice(entry);
        const prevNum = parsePriceNumber(prevEff);

        const newerEff = i === 0
            ? currentEff
            : effectivePrice(history[i - 1]);
        const newerNum = i === 0
            ? currentNum
            : parsePriceNumber(effectivePrice(history[i - 1]));

        const li = document.createElement('li');
        li.className = 'admin-price-history-item';

        const date = document.createElement('span');
        date.className = 'admin-price-history-date';
        date.textContent = entry.date || '—';
        li.appendChild(date);

        // Show "previous sale  →  current sale" using the actual prices.
        const transition = document.createElement('span');
        transition.className = 'admin-price-history-transition';
        const direction = priceDirection(prevNum, newerNum);
        if (direction) transition.classList.add(`is-${direction}`);

        const prevEl = document.createElement('span');
        prevEl.className = 'admin-price-history-prev';
        prevEl.textContent = prevEff || '—';
        transition.appendChild(prevEl);

        const arrowEl = document.createElement('span');
        arrowEl.className = 'admin-price-history-arrow';
        arrowEl.textContent = direction === 'up' ? '▲' : (direction === 'down' ? '▼' : '→');
        transition.appendChild(arrowEl);

        const currEl = document.createElement('span');
        currEl.className = 'admin-price-history-curr';
        currEl.textContent = newerEff || '—';
        transition.appendChild(currEl);

        li.appendChild(transition);

        list.appendChild(li);
    }
    wrap.appendChild(list);
    return wrap;
}

function renderPricingRow(rubber) {
    const item = document.createElement('div');
    item.className = 'admin-price-row';

    const head = document.createElement('div');
    head.className = 'admin-price-row-head';
    const title = document.createElement('span');
    title.className = 'admin-rubber-title';
    title.textContent = rubber.name;
    head.appendChild(title);
    const badges = document.createElement('span');
    badges.className = 'admin-rubber-locales';
    for (const locale of LOCALES) {
        const has = !!(rubber.pricing && rubber.pricing[locale] && rubber.pricing[locale].hasPrice);
        const b = document.createElement('span');
        b.className = `admin-rubber-locale${has ? '' : ' is-missing'}`;
        b.textContent = LOCALE_LABEL[locale] || locale.toUpperCase();
        badges.appendChild(b);
    }
    head.appendChild(badges);
    item.appendChild(head);

    const grid = document.createElement('div');
    grid.className = 'admin-price-grid';
    for (const locale of LOCALES) {
        const info = (rubber.pricing && rubber.pricing[locale]) || {
            regular: '', sale: '', discount: '', productUrl: '', hasPrice: false,
        };
        grid.appendChild(renderPriceCell(locale, info));
    }
    item.appendChild(grid);

    return item;
}

function renderPricing() {
    const list = $('pricingList');
    const empty = $('pricingEmpty');
    if (!list || !empty) return;
    list.innerHTML = '';
    const q = state.query;
    const rubbers = state.rubbers.filter(r => rubberMatchesQuery(r, q));
    if (!rubbers.length) {
        empty.hidden = false;
        return;
    }
    empty.hidden = true;

    const byBrand = new Map();
    for (const rubber of rubbers) {
        if (!byBrand.has(rubber.brand)) byBrand.set(rubber.brand, []);
        byBrand.get(rubber.brand).push(rubber);
    }

    const brands = Array.from(byBrand.keys()).sort((a, b) => a.localeCompare(b));
    const frag = document.createDocumentFragment();
    for (const brand of brands) {
        const brandRubbers = byBrand.get(brand);
        let priced = 0;
        let missing = 0;
        let historyCount = 0;
        for (const r of brandRubbers) {
            for (const locale of LOCALES) {
                const pi = r.pricing && r.pricing[locale];
                if (pi && pi.hasPrice) priced += 1;
                else missing += 1;
                if (pi && pi.history) historyCount += pi.history.length;
            }
        }

        const block = document.createElement('section');
        block.className = 'admin-brand-group';

        const head = document.createElement('div');
        head.className = 'admin-brand-head';

        const nameEl = document.createElement('h2');
        nameEl.className = 'admin-brand-name';
        nameEl.textContent = brand;
        head.appendChild(nameEl);

        const meta = document.createElement('span');
        meta.className = 'admin-brand-meta';
        const parts = [`${brandRubbers.length} rubber${brandRubbers.length === 1 ? '' : 's'}`];
        parts.push(`${priced} priced`);
        if (missing) parts.push(`<em class="admin-brand-meta-missing">${missing} missing</em>`);
        if (historyCount) parts.push(`${historyCount} history entr${historyCount === 1 ? 'y' : 'ies'}`);
        meta.innerHTML = parts.join(' · ');
        head.appendChild(meta);

        block.appendChild(head);

        const rows = document.createElement('div');
        rows.className = 'admin-price-list';
        for (const rubber of brandRubbers) {
            rows.appendChild(renderPricingRow(rubber));
        }
        block.appendChild(rows);
        frag.appendChild(block);
    }
    list.appendChild(frag);
}

function setActiveTab(tab) {
    state.activeTab = tab;
    document.querySelectorAll('.admin-tab').forEach(btn => {
        const isActive = btn.dataset.tab === tab;
        btn.classList.toggle('is-active', isActive);
        btn.setAttribute('aria-selected', isActive ? 'true' : 'false');
    });
    document.querySelectorAll('.admin-section').forEach(sec => {
        const isActive = sec.id === `section-${tab}`;
        sec.classList.toggle('is-active', isActive);
        sec.hidden = !isActive;
    });
    try { history.replaceState(null, '', `#${tab}`); } catch {}
}

function updateCounts() {
    let videoCount = 0;
    let videoMissing = 0;
    let priceCount = 0;
    let priceMissing = 0;
    for (const r of state.rubbers) {
        for (const locale of LOCALES) {
            if (r.locales[locale]) videoCount += 1;
            else videoMissing += 1;
            if (r.pricing && r.pricing[locale] && r.pricing[locale].hasPrice) priceCount += 1;
            else priceMissing += 1;
        }
    }
    const playerVideoCount = state.players.reduce((acc, p) => acc + p.videos.length, 0);
    const rEl = document.querySelector('[data-count="rubbers"]');
    const pEl = document.querySelector('[data-count="players"]');
    const prEl = document.querySelector('[data-count="pricing"]');
    if (rEl) rEl.textContent = String(videoCount);
    if (pEl) pEl.textContent = String(playerVideoCount);
    if (prEl) prEl.textContent = String(priceCount);
    setStatus(
        `${state.rubbers.length} rubbers · ${videoCount} explanation video${videoCount === 1 ? '' : 's'}` +
        (videoMissing ? ` (${videoMissing} missing)` : '') +
        ` · ${priceCount} price${priceCount === 1 ? '' : 's'}` +
        (priceMissing ? ` (${priceMissing} missing)` : '') +
        ` — ${playerVideoCount} player video${playerVideoCount === 1 ? '' : 's'} ` +
        `across ${state.players.length} player${state.players.length === 1 ? '' : 's'}.`
    );
}

const VALID_TABS = new Set(['rubbers', 'players', 'pricing']);

function bindUi() {
    document.querySelectorAll('.admin-tab').forEach(btn => {
        btn.addEventListener('click', () => setActiveTab(btn.dataset.tab));
    });
    const search = $('adminSearch');
    if (search) {
        search.addEventListener('input', () => {
            state.query = search.value.trim().toLowerCase();
            renderRubbers();
            renderPlayers();
            renderPricing();
        });
    }
    const initial = (location.hash || '').replace(/^#/, '');
    if (VALID_TABS.has(initial)) {
        setActiveTab(initial);
    }
}

async function init() {
    bindUi();
    setStatus('Loading rubber and player data…');
    try {
        const [rubbers, players] = await Promise.all([
            loadRubbers(),
            loadPlayers(),
        ]);
        state.rubbers = rubbers;
        state.players = players;
        updateCounts();
        renderRubbers();
        renderPlayers();
        renderPricing();
    } catch (err) {
        console.error(err);
        setStatus(`Failed to load data: ${err.message || err}`, true);
    }
}

init();
