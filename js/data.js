// ════════════════════════════════════════════════════════════
//  Data Parsing & Normalization
// ════════════════════════════════════════════════════════════

function parseRatingNumber(value) {
    if (typeof value === 'number') return value;
    if (typeof value !== 'string') return null;
    const match = value.match(/[\d.]+/);
    if (!match) return null;
    const parsed = Number.parseFloat(match[0]);
    return Number.isFinite(parsed) ? parsed : null;
}

function normalizeSheet(value) {
    if (typeof value === 'string') {
        const lower = value.trim().toLowerCase();
        if (lower === 'classic') return 'Classic';
        if (lower === 'chinese') return 'Chinese';
        if (lower === 'hybrid') return 'Hybrid';
    }
    return 'Classic';
}

function parsePlayerEntry(value) {
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    if (!trimmed) return null;

    // Supports: "Player Name (https://...)"
    const linkedEntry = trimmed.match(/^(.*?)\s*\((https?:\/\/[^\s)]+)\)\s*$/i);
    if (!linkedEntry) {
        return { name: trimmed, url: '' };
    }

    const [, rawName, rawUrl] = linkedEntry;
    const name = (rawName || '').trim();
    const url = (rawUrl || '').trim();
    if (!name) return { name: trimmed, url: '' };
    return { name, url };
}

function playerEmojiPath(name) {
    return 'images/players/' + name.replace(/\s+/g, ' ') + '.png';
}

function renderPlayerEntryHtml(value, { imagePosition = 'after' } = {}) {
    const parsed = parsePlayerEntry(value);
    if (!parsed) return '';
    const safeName = escapeHtml(parsed.name);
    const emojiSrc = playerEmojiPath(parsed.name);
    const emojiHtml = `<img class="player-emoji" src="${emojiSrc}" alt="" width="20" height="20" onerror="this.remove()">`;
    const withEmoji = (nameOrLinkHtml) => (
        imagePosition === 'before'
            ? `${emojiHtml} ${nameOrLinkHtml}`
            : `${nameOrLinkHtml} ${emojiHtml}`
    );

    let url = parsed.url;
    if (!url) {
        const player = playersData[parsed.name];
        if (player && Array.isArray(player.youtubes) && player.youtubes.length) {
            url = player.youtubes[Math.floor(Math.random() * player.youtubes.length)];
        }
    }

    if (!url) return withEmoji(safeName);

    const videoId = extractYouTubeVideoId(url);
    if (videoId) {
        return withEmoji(`<a class="radar-info-player-link" href="#" data-yt-videoid="${escapeHtml(videoId)}" title="Watch ${safeName} on YouTube" aria-label="Watch ${safeName} on YouTube">${safeName}</a>`);
    }

    const safeUrl = escapeHtml(url);
    return withEmoji(`<a class="radar-info-player-link" href="${safeUrl}" target="_blank" rel="noopener noreferrer">${safeName}</a>`);
}

function collectPlayerSearchNames(raw) {
    const names = [];
    const collect = (value) => {
        if (!value) return;
        if (typeof value === 'string') {
            const parsed = parsePlayerEntry(value);
            if (parsed) names.push(parsed.name);
            return;
        }
        if (Array.isArray(value)) { value.forEach(collect); return; }
        if (typeof value === 'object') { Object.values(value).forEach(collect); }
    };
    collect(raw.player);
    collect(raw.players);
    return names;
}

function formatPlayerLabel(raw) {
    const uniquePlayers = new Set();

    const collectPlayer = (value) => {
        if (typeof value !== 'string') return;
        const trimmed = value.trim();
        if (trimmed) uniquePlayers.add(trimmed);
    };

    const collectPlayersFromValue = (value) => {
        if (!value) return;
        if (typeof value === 'string') {
            collectPlayer(value);
            return;
        }
        if (Array.isArray(value)) {
            value.forEach(collectPlayersFromValue);
            return;
        }
        if (typeof value === 'object') {
            Object.values(value).forEach(collectPlayersFromValue);
        }
    };

    collectPlayersFromValue(raw.player);
    collectPlayersFromValue(raw.players);

    if (uniquePlayers.size === 0) return '';
    return Array.from(uniquePlayers)
        .map(renderPlayerEntryHtml)
        .filter(Boolean)
        .join('<br>');
}

function formatPlayersBySide(raw) {
    const toEntries = (value) => {
        if (!value) return '';

        const uniquePlayers = new Set();
        const collectPlayer = (entry) => {
            if (typeof entry !== 'string') return;
            const trimmed = entry.trim();
            if (trimmed) uniquePlayers.add(trimmed);
        };
        const collectPlayersFromValue = (entry) => {
            if (!entry) return;
            if (typeof entry === 'string') {
                collectPlayer(entry);
                return;
            }
            if (Array.isArray(entry)) {
                entry.forEach(collectPlayersFromValue);
                return;
            }
            if (typeof entry === 'object') {
                Object.values(entry).forEach(collectPlayersFromValue);
            }
        };

        collectPlayersFromValue(value);
        return Array.from(uniquePlayers);
    };

    const players = raw && typeof raw.players === 'object' ? raw.players : null;
    return {
        forehandPlayers: toEntries(players?.forehand),
        backhandPlayers: toEntries(players?.backhand),
    };
}

function formatThicknessLabel(value) {
    if (Array.isArray(value)) {
        const entries = value
            .map(item => (item == null ? '' : String(item).trim()))
            .filter(Boolean);
        return entries.length ? entries.join(', ') : 'N/A';
    }
    if (value == null) return 'N/A';
    const normalized = String(value).trim();
    return normalized || 'N/A';
}

function buildFullName(brand, name) {
    const b = (brand || '').trim();
    const n = (name || '').trim();
    if (!b) return n;
    if (n.toLowerCase().startsWith(b.toLowerCase())) return n;
    return `${b} ${n}`.trim();
}

// ════════════════════════════════════════════════════════════
//  Description Markdown
// ════════════════════════════════════════════════════════════

function buildDescriptionMarkdown(raw) {
    const details = raw.manufacturer_details || {};
    const lines = [
        raw.price ? `**Price:** ${raw.price}` : null,
        details.sheet ? `**Sheet:** ${details.sheet}` : null,
        details.hardness !== undefined ? `**Hardness:** ${details.hardness}° ${COUNTRY_FLAGS[details.country]}` : null,
        details.weight !== undefined ? `**Cut Weight:** ${details.weight}g` : null,
        details.thickness ? `**Thickness:** ${Array.isArray(details.thickness) ? details.thickness.join(', ') : details.thickness}` : null
    ].filter(Boolean);
    return lines.join('\n');
}

// ════════════════════════════════════════════════════════════
//  Ranking Data
// ════════════════════════════════════════════════════════════

async function loadRankings() {
    const results = await Promise.all(
        Object.entries(RANKING_FILES).map(([key, url]) =>
            fetch(v(url)).then(r => {
                if (!r.ok) throw new Error(`HTTP ${r.status} for ${url}`);
                return r.json();
            }).then(data => [key, data])
        )
    );
    return Object.fromEntries(results);
}

// Find a rubber's 0-based position in a ranking array.
// Tries matching the ranking entry name against both rubber.name and rubber.abbr.
function findRubberRank(rubber, rankingArray) {
    const rubberBrand = (rubber.brand || '').trim().toLowerCase();
    const rubberNameNorm = rubber.name;
    const rubberAbbrNorm = rubber.abbr;

    for (let i = 0; i < rankingArray.length; i++) {
        const entry = rankingArray[i];
        const entryBrand = (entry.brand || '').trim().toLowerCase();
        if (entryBrand !== rubberBrand) continue;

        const entryNameNorm = entry.name;
        if (entryNameNorm === rubberNameNorm || entryNameNorm === rubberAbbrNorm) return i;
    }
    return -1;
}

// ════════════════════════════════════════════════════════════
//  Data Loading
// ════════════════════════════════════════════════════════════

async function loadPlayersData() {
    const pickRandomItems = (items, count) => {
        if (!Array.isArray(items)) return [];
        if (items.length <= count) return [...items];

        const pool = [...items];
        for (let i = pool.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [pool[i], pool[j]] = [pool[j], pool[i]];
        }
        return pool.slice(0, count);
    };

    try {
        const resp = await fetch(v(PLAYERS_FILE));
        if (!resp.ok) throw new Error(`HTTP ${resp.status} for ${PLAYERS_FILE}`);
        const rawPlayersData = await resp.json();
        const trimmedPlayersData = {};

        Object.entries(rawPlayersData || {}).forEach(([name, player]) => {
            const youtubes = Array.isArray(player?.youtubes)
                ? player.youtubes.filter(Boolean)
                : [];
            trimmedPlayersData[name] = {
                ...player,
                youtubes: pickRandomItems(youtubes, 2),
            };
        });

        playersData = trimmedPlayersData;
    } catch (error) {
        console.warn('Failed to load players data:', error);
        playersData = {};
    }
}

async function loadRubberData() {
    const indexResp = await fetch(v(RUBBER_INDEX_FILE));
    if (!indexResp.ok) {
        throw new Error(`HTTP ${indexResp.status} for ${RUBBER_INDEX_FILE}`);
    }

    const rubberFiles = await indexResp.json();
    if (!Array.isArray(rubberFiles)) {
        throw new Error(`${RUBBER_INDEX_FILE} must contain an array of file paths`);
    }

    const results = await Promise.allSettled(
        rubberFiles.map(file =>
            fetch(v(file)).then(r => {
                if (!r.ok) throw new Error(`HTTP ${r.status} for ${file}`);
                return r.json();
            })
        )
    );

    const rawItems = results.flatMap(result => {
        if (result.status !== 'fulfilled') {
            console.warn('Skipping rubber data file:', result.reason);
            return [];
        }
        // Backward compatible with old per-brand array files.
        if (Array.isArray(result.value)) {
            return result.value;
        }
        if (result.value && typeof result.value === 'object') {
            return [result.value];
        }
        return [];
    });

    const data = [];
    const descriptionMap = {};
    for (const raw of rawItems) {
        // Exclude entries explicitly flagged as disabled in source JSON.
        if (raw?.disabled !== undefined) continue;

        const ratings = raw.user_ratings || {};
        const details = raw.manufacturer_details || {};
        const hardness = parseRatingNumber(details.hardness);
        const weightValue = parseRatingNumber(details.weight);
        const releaseYear = parseRatingNumber(details.release_year);
        const hardnessFlag = COUNTRY_FLAGS[details.country] || '';
        const urls = raw.urls || {};

        const rubber = {
            name: raw.name,
            addr: raw.addr || raw.abbr || raw.name,
            fullName: buildFullName(raw.manufacturer, raw.name),
            abbr: raw.abbr || raw.name,
            brand: raw.manufacturer,
            x: null,
            y: null,
            weight: weightValue,
            hardness: parseRatingNumber(ratings.sponge_hardness),
            manufacturerHardness: hardness,
            normalizedHardness: toGermanScale(hardness, details.country),
            hardnessLabel: Number.isFinite(hardness) ? `${hardness}°${hardnessFlag ? ` ${hardnessFlag}` : ''}` : 'N/A',
            weightLabel: Number.isFinite(weightValue) ? `${weightValue}g` : 'N/A',
            releaseYearLabel: Number.isFinite(releaseYear) ? String(Math.round(releaseYear)) : 'N/A',
            thicknessLabel: formatThicknessLabel(details.thickness),
            playerLabel: formatPlayerLabel(raw),
            playerSearchNames: collectPlayerSearchNames(raw),
            ...formatPlayersBySide(raw),
            control: parseRatingNumber(ratings.control),
            sheet: normalizeSheet(details.sheet),
            priority: 999, // will be overridden by priority ranking
            bestseller: false, // will be overridden by bestseller ranking
            urls: {
                us: { product: urls.us?.product || '', youtube: urls.us?.youtube || '' },
                eu: { product: urls.eu?.product || '', youtube: urls.eu?.youtube || '' },
                kr: { product: urls.kr?.product || '', youtube: urls.kr?.youtube || '' },
                cn: { product: urls.cn?.product || '', youtube: urls.cn?.youtube || '' }
            }
        };

        data.push(rubber);
        descriptionMap[rubber.name] = buildDescriptionMarkdown(raw);
    }

    // ── Override chart positions with ranking data ──
    const rankings = await loadRankings();
    const spinTotal = rankings.spin.length;
    const speedTotal = rankings.speed.length;
    const controlTotal = rankings.control.length;

    // ── Override priority with priority ranking ──
    const priorityResp = await fetch(v(PRIORITY_FILE));
    const priorityRanking = priorityResp.ok ? await priorityResp.json() : [];
    const bestsellerResp = await fetch(v(BESTSELLER_FILE));
    const bestsellerRanking = bestsellerResp.ok ? await bestsellerResp.json() : [];

    for (const rubber of data) {
        const spinIdx = findRubberRank(rubber, rankings.spin);
        const speedIdx = findRubberRank(rubber, rankings.speed);
        const controlIdx = findRubberRank(rubber, rankings.control);

        // Chart axes: higher value = more spin / more speed (rank 0 → highest value)
        rubber.x = spinIdx >= 0 ? spinTotal - spinIdx : null;
        rubber.y = speedIdx >= 0 ? speedTotal - speedIdx : null;

        // Store 1-based ranks for display
        rubber.spinRank = spinIdx >= 0 ? spinIdx + 1 : null;
        rubber.speedRank = speedIdx >= 0 ? speedIdx + 1 : null;
        rubber.controlRank = controlIdx >= 0 ? controlIdx + 1 : null;
        rubber.controlTotal = controlTotal;

        // Display order: bestseller first, then priority ranking.
        const popIdx = findRubberRank(rubber, priorityRanking);
        const bestsellerIdx = findRubberRank(rubber, bestsellerRanking);
        rubber.bestseller = bestsellerIdx >= 0;

        if (rubber.bestseller) {
            rubber.priority = bestsellerIdx + 1;
        } else if (popIdx >= 0) {
            rubber.priority = bestsellerRanking.length + popIdx + 1;
        }
    }

    // Only show rubbers that appear in both spin and speed rankings
    rubberData = data.filter(r => r.x !== null && r.y !== null);

    const top30Ranking = priorityRanking.slice(0, 30);
    top30Set = new Set();
    for (const rubber of rubberData) {
        if (findRubberRank(rubber, top30Ranking) >= 0) top30Set.add(rubber.fullName);
    }

}
