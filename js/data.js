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
        if (lower === 'tension') return 'Tension';
        if (lower === 'chinese') return 'Chinese';
        if (lower === 'hybrid') return 'Hybrid';
    }
    return 'Tension';
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

function playerEmojiPath(name, ext) {
    return '/images/players/' + name.replace(/\s+/g, ' ') + '.' + (ext || 'png');
}

function getPlayerImageName(name) {
    const trimmedName = typeof name === 'string' ? name.trim() : '';
    if (!trimmedName) return '';

    const player = getPlayerDataByName(trimmedName);
    const fullName = typeof player?.full_name === 'string' ? player.full_name.trim() : '';
    return fullName || trimmedName;
}

function normalizePlayerNameKey(value) {
    if (typeof value !== 'string') return '';
    return value.trim().toLowerCase();
}

function getPlayerDataByName(name) {
    if (typeof name !== 'string') return null;
    const trimmed = name.trim();
    if (!trimmed) return null;

    if (playersData[trimmed]) return playersData[trimmed];

    const canonicalName = playerNameToCanonicalName[normalizePlayerNameKey(trimmed)];
    if (!canonicalName) return null;
    return playersData[canonicalName] || null;
}

function getLocalizedPlayerName(name) {
    const parsedName = typeof name === 'string' ? name.trim() : '';
    if (!parsedName) return '';

    const player = getPlayerDataByName(parsedName);
    if (!player) return parsedName;

    const lang = getCurrentLang();
    const localizedNames = player.localized_names && typeof player.localized_names === 'object'
        ? player.localized_names
        : null;
    const localized = localizedNames && typeof localizedNames[lang] === 'string'
        ? localizedNames[lang].trim()
        : '';
    if (localized) return localized;

    const canonicalName = typeof player.canonical_name === 'string' ? player.canonical_name.trim() : '';
    if (canonicalName) return canonicalName;

    return parsedName;
}

function collectPlayerVideoIdsByName(name) {
    const player = getPlayerDataByName(name);
    if (!player || !Array.isArray(player.youtubes)) return [];
    return Array.from(new Set(
        player.youtubes
            .map(extractYouTubeVideoId)
            .filter(Boolean)
    ));
}

function resolvePlayerVideoSelection(parsed) {
    const playerVideoIds = collectPlayerVideoIdsByName(parsed.name);
    const explicitVideoId = parsed.url ? extractYouTubeVideoId(parsed.url) : null;

    if (!playerVideoIds.length) {
        if (!explicitVideoId) return { videoIds: [], currentIndex: 0 };
        return { videoIds: [explicitVideoId], currentIndex: 0 };
    }

    if (!explicitVideoId) {
        return { videoIds: playerVideoIds, currentIndex: 0 };
    }

    const explicitIndex = playerVideoIds.indexOf(explicitVideoId);
    if (explicitIndex >= 0) {
        return { videoIds: playerVideoIds, currentIndex: explicitIndex };
    }

    return {
        videoIds: [explicitVideoId, ...playerVideoIds],
        currentIndex: 0,
    };
}

function renderPlayerEntryHtml(value, { imagePosition = 'after', gifTracker = null } = {}) {
    const parsed = parsePlayerEntry(value);
    if (!parsed) return '';
    const displayName = getLocalizedPlayerName(parsed.name) || parsed.name;
    const safeName = escapeHtml(displayName);
    const playerData = getPlayerDataByName(parsed.name);
    const rawImageExt = playerData?.image_ext;
    let imageExt = rawImageExt;
    if (rawImageExt === 'gif' && gifTracker && typeof gifTracker === 'object') {
        if (gifTracker.hasGif) {
            imageExt = 'png';
        } else {
            gifTracker.hasGif = true;
        }
    }
    const emojiSrc = playerEmojiPath(getPlayerImageName(parsed.name), imageExt);
    const emojiHtml = `<img class="player-emoji" src="${emojiSrc}" alt="" width="48" height="48" onerror="this.remove()">`;

    // Split name into 2 lines at the first space
    const spaceIdx = displayName.indexOf(' ');
    let nameInnerHtml;
    if (spaceIdx !== -1) {
        const line1 = escapeHtml(displayName.substring(0, spaceIdx));
        const line2 = escapeHtml(displayName.substring(spaceIdx + 1));
        nameInnerHtml = `<span class="player-name-line">${line1}</span><span class="player-name-line">${line2}</span>`;
    } else {
        nameInnerHtml = `<span class="player-name-line">${safeName}</span>`;
    }

    const cardInnerHtml = `${emojiHtml}${nameInnerHtml}`;

    const { videoIds, currentIndex } = resolvePlayerVideoSelection(parsed);
    if (videoIds.length) {
        const videoId = videoIds[currentIndex] || videoIds[0];
        const playlist = escapeHtml(videoIds.join(','));
        return `<a class="player-card radar-info-player-link" href="#" data-yt-videoid="${escapeHtml(videoId)}" data-yt-playlist="${playlist}" data-yt-index="${currentIndex}" title="Watch ${safeName} on YouTube" aria-label="Watch ${safeName} on YouTube">${cardInnerHtml}</a>`;
    }
    if (parsed.url) {
        const safeUrl = escapeHtml(parsed.url);
        return `<a class="player-card radar-info-player-link" href="${safeUrl}" target="_blank" rel="noopener noreferrer">${cardInnerHtml}</a>`;
    }
    return `<span class="player-card">${cardInnerHtml}</span>`;
}

function collectPlayerSearchNames(raw) {
    const names = new Set();

    const addPlayerSearchNames = (displayName) => {
        if (!displayName) return;
        names.add(displayName);
        const player = getPlayerDataByName(displayName);
        if (!player) return;

        const canonicalName = typeof player.canonical_name === 'string' ? player.canonical_name.trim() : '';
        if (canonicalName) names.add(canonicalName);

        const fullName = (player.full_name || '').trim();
        if (fullName) names.add(fullName);

        const localizedNames = player.localized_names && typeof player.localized_names === 'object'
            ? player.localized_names
            : null;
        if (localizedNames) {
            Object.values(localizedNames).forEach((localizedValue) => {
                const normalizedLocalized = typeof localizedValue === 'string' ? localizedValue.trim() : '';
                if (normalizedLocalized) names.add(normalizedLocalized);
            });
        }

    };

    const collect = (value) => {
        if (!value) return;
        if (typeof value === 'string') {
            const parsed = parsePlayerEntry(value);
            if (parsed) addPlayerSearchNames(parsed.name);
            return;
        }
        if (Array.isArray(value)) { value.forEach(collect); return; }
        if (typeof value === 'object') { Object.values(value).forEach(collect); }
    };
    collect(raw.player);
    collect(raw.players);
    return Array.from(names);
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
        .join('');
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

function buildLocalizedTextMap(rawMap, fallbackText) {
    const fallback = typeof fallbackText === 'string' ? fallbackText.trim() : '';
    const localized = (rawMap && typeof rawMap === 'object' && !Array.isArray(rawMap)) ? rawMap : {};
    const next = {};
    for (const lang of ['en', 'ko', 'cn']) {
        const candidate = typeof localized[lang] === 'string' ? localized[lang].trim() : '';
        next[lang] = candidate || fallback;
    }
    return next;
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
    try {
        const resp = await fetch(v(PLAYERS_FILE));
        if (!resp.ok) throw new Error(`HTTP ${resp.status} for ${PLAYERS_FILE}`);
        const rawPlayersData = await resp.json();
        const normalizedPlayersData = {};
        const normalizedPlayerNames = {};

        Object.entries(rawPlayersData || {}).forEach(([name, player]) => {
            const canonicalName = typeof name === 'string' ? name.trim() : '';
            if (!canonicalName) return;

            const rawFullName = typeof player?.full_name === 'string' ? player.full_name.trim() : '';
            const allKnownNames = Array.from(new Set([
                canonicalName,
                rawFullName,
            ].filter(Boolean)));

            allKnownNames.forEach(playerName => {
                const key = normalizePlayerNameKey(playerName);
                if (key) normalizedPlayerNames[key] = canonicalName;
            });

            normalizedPlayersData[canonicalName] = {
                ...player,
                canonical_name: canonicalName,
                full_name: rawFullName,
                localized_names: player?.localized_names && typeof player.localized_names === 'object'
                    ? Object.fromEntries(
                        Object.entries(player.localized_names)
                            .map(([lang, value]) => [lang, typeof value === 'string' ? value.trim() : ''])
                            .filter(([, value]) => Boolean(value))
                    )
                    : {},
                youtubes: Array.isArray(player?.youtubes)
                    ? player.youtubes.filter(Boolean)
                    : [],
            };
        });

        playersData = normalizedPlayersData;
        playerNameToCanonicalName = normalizedPlayerNames;
    } catch (error) {
        console.warn('Failed to load players data:', error);
        playersData = {};
        playerNameToCanonicalName = {};
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
            fetch(v('/' + file)).then(r => {
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
        const normalizedH = toGermanScale(hardness, details.country);
        const urls = raw.urls || {};

        const rubber = {
            name: raw.name,
            addr: raw.addr || raw.abbr || raw.name,
            fullName: buildFullName(raw.manufacturer, raw.name),
            abbr: raw.abbr || raw.name,
            localizedName: buildLocalizedTextMap(raw.name_i18n, raw.name),
            localizedAbbr: buildLocalizedTextMap(raw.abbr_i18n, raw.abbr || raw.name),
            brand: raw.manufacturer,
            x: null,
            y: null,
            weight: weightValue,
            hardness: parseRatingNumber(ratings.sponge_hardness),
            manufacturerHardness: hardness,
            normalizedHardness: normalizedH,
            hardnessLabel: Number.isFinite(hardness) ? `${hardness}°${hardnessFlag ? ` ${hardnessFlag}` : ''}` : 'N/A',
            hardnessLabelDE: (details.country === 'Japan' || details.country === 'China') && Number.isFinite(normalizedH)
                ? `${Number.isInteger(normalizedH) ? String(normalizedH) : normalizedH.toFixed(1)}° 🇩🇪`
                : null,
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
                en: { product: urls.en?.product || '', youtube: urls.en?.youtube || '' },
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

    // Build control level lookup from the 5-level category format
    const controlLevelMap = new Map();
    const controlData = rankings.control;
    for (const [key, rubbers] of Object.entries(controlData)) {
        const level = parseInt(key, 10);
        if (!Number.isFinite(level)) continue;
        for (const entry of rubbers) {
            const mapKey = `${(entry.brand || '').trim().toLowerCase()}|${entry.name}`;
            controlLevelMap.set(mapKey, level);
        }
    }

    // ── Override priority with priority ranking ──
    const priorityResp = await fetch(v(PRIORITY_FILE));
    const priorityRanking = priorityResp.ok ? await priorityResp.json() : [];
    const bestsellerResp = await fetch(v(BESTSELLER_FILE));
    const bestsellerRanking = bestsellerResp.ok ? await bestsellerResp.json() : [];

    for (const rubber of data) {
        const spinIdx = findRubberRank(rubber, rankings.spin);
        const speedIdx = findRubberRank(rubber, rankings.speed);

        // Chart axes: higher value = more spin / more speed (rank 0 → highest value)
        rubber.x = spinIdx >= 0 ? spinTotal - spinIdx : null;
        rubber.y = speedIdx >= 0 ? speedTotal - speedIdx : null;

        // Store 1-based ranks for display
        rubber.spinRank = spinIdx >= 0 ? spinIdx + 1 : null;
        rubber.speedRank = speedIdx >= 0 ? speedIdx + 1 : null;

        // Control level from manual 5-level categories (1 = hardest, 5 = easiest)
        const brandKey = (rubber.brand || '').trim().toLowerCase();
        rubber.controlLevel = controlLevelMap.get(`${brandKey}|${rubber.name}`)
            ?? controlLevelMap.get(`${brandKey}|${rubber.abbr}`)
            ?? null;

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
    rubberByAbbr = new Map(rubberData.map(r => [r.abbr, r]));

    const top30Ranking = priorityRanking.slice(0, 30);
    top30Set = new Set();
    for (const rubber of rubberData) {
        if (findRubberRank(rubber, top30Ranking) >= 0) top30Set.add(rubber.fullName);
    }

}
