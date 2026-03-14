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

const CACHE_VERSION = 66;
function v(url) { return url + (url.includes('?') ? '&' : '?') + 'v=' + CACHE_VERSION; }

const RUBBER_INDEX_FILE = '/stats/rubbers/index.json';
const RANKING_FILES = {
    spin: '/stats/rubbers/ranking/spin.json',
    speed: '/stats/rubbers/ranking/speed.json',
    control: '/stats/rubbers/ranking/control.json'
};
const PRIORITY_FILE = '/stats/rubbers/ranking/priority.json';
const BESTSELLER_FILE = '/stats/rubbers/ranking/bestseller.json';
const PLAYERS_FILE = '/players/players.json';

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
    Tension: 'circle',
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

let SLUG_MAP = null; // Loaded at startup from /js/slug-map.json

function findRubberBySlug(slug) {
    if (!slug || !SLUG_MAP) return null;
    const abbr = fromSlug(slug, SLUG_MAP);
    if (!abbr) return null;
    return rubberData.find(r => r.abbr === abbr) || null;
}

const COUNTRY_TO_LANG = { us: 'en', cn: 'cn', kr: 'ko' };
const COUNTRY_FLAGS = { Germany: '🇩🇪', Japan: '🇯🇵', China: '🇨🇳' };
const FILTER_IDS = ['brand', 'name', 'sheet', 'hardness', 'weight', 'control', 'top30'];
const DEBUG_MODE = new URLSearchParams(window.location.search).has('debug');

const UI_TEXT = {
    en: {
        FILTERS: 'Filters',
        POPULARITY: 'Popularity',
        WEIGHT: 'Weight',
        WEGIHT: 'Weight',
        HARDNESS: 'Hardness',
        TOPSHEET: 'Topsheet',
        TENSION: 'Tension',
        CHINESE: 'Chinese',
        HYBRID: 'Hybrid',
        CONTROL: 'Control',
        EASY: 'Easy',
        MED: 'Med',
        HARD: 'Hard',
        BRAND: 'Brand',
        RUBBER: 'Rubber',
        SPEED: 'Speed',
        SPIN: 'Spin',
        SPEED_RANKING: 'Speed Ranking',
        SPIN_RANKING: 'Spin Ranking',
        CUT_WEIGHT: 'Cut Weight',
        SPEED_RANK: 'Speed Rank',
        SPIN_RANK: 'Spin Rank',
        RELEASE: 'Release',
        THICKNESS: 'Thickness',
        PLAYERS: 'Pro Players',
        FEEDBACK_BUTTON: 'Feedback',
        FEEDBACK_BUTTON_TITLE: 'Send feedback',
        FEEDBACK_CLOSE_ARIA: 'Close feedback form',
        FEEDBACK_TITLE_SHARE: 'Share feedback',
        FEEDBACK_TITLE_SENT: 'Feedback sent',
        FEEDBACK_INTRO: 'We\'ll get back to you as soon as possible.',
        FEEDBACK_EMAIL_LABEL: 'Email (optional)',
        FEEDBACK_MESSAGE_LABEL: 'Message',
        FEEDBACK_EMAIL_PLACEHOLDER: 'you@example.com',
        FEEDBACK_MESSAGE_PLACEHOLDER: 'Share your feedback or suggestions.',
        FEEDBACK_SUBMIT: 'Send feedback',
        FEEDBACK_SUBMITTING: 'Sending...',
        FEEDBACK_STATUS_PROMPT: 'Share your feedback. Add your email if you’d like a reply.',
        FEEDBACK_STATUS_SENDING: 'Sending your feedback...',
        FEEDBACK_STATUS_FAILED: 'Could not send feedback. Please try again.',
        FEEDBACK_CONFIRMATION: 'Thank you for your feedback.',
        FEEDBACK_COMPARISON_TOAST: 'We\'ll add the comparison soon. Thank you!',
        FEEDBACK_REQUEST_SENT_TOAST: 'Request sent.',
        CONTENT_FEEDBACK_GOOD_TOAST: 'Thanks! Glad this was helpful.',
        CONTENT_FEEDBACK_BAD_TOAST: 'Thanks! We will use your feedback to improve this.',
        RUBBER_1: 'Rubber 1',
        RUBBER_2: 'Rubber 2'
    },
    ko: {
        FILTERS: '필터',
        POPULARITY: '인기',
        WEIGHT: '무게',
        WEGIHT: '무게',
        HARDNESS: '경도',
        TOPSHEET: '탑시트',
        TENSION: '텐션',
        CHINESE: '점착러버',
        HYBRID: '하이브리드',
        CONTROL: '컨트롤',
        EASY: '쉬움',
        MED: '중간',
        HARD: '어려움',
        BRAND: '브랜드',
        RUBBER: '러버',
        SPEED: '스피드',
        SPIN: '스핀',
        SPEED_RANKING: '스피드 랭킹',
        SPIN_RANKING: '스핀 랭킹',
        CUT_WEIGHT: '컷팅 후 무게',
        SPEED_RANK: '스피드 랭킹',
        SPIN_RANK: '스핀 랭킹',
        RELEASE: '출시',
        THICKNESS: '두께',
        PLAYERS: '프로선수',
        FEEDBACK_BUTTON: '피드백 보내기',
        FEEDBACK_BUTTON_TITLE: '피드백 보내기',
        FEEDBACK_CLOSE_ARIA: '피드백 창 닫기',
        FEEDBACK_TITLE_SHARE: '피드백 보내기',
        FEEDBACK_TITLE_SENT: '피드백 전송 완료',
        FEEDBACK_INTRO: '가능한 한 빨리 답변드릴게요.',
        FEEDBACK_EMAIL_LABEL: '이메일 (선택)',
        FEEDBACK_EMAIL_NOTE: '답변을 원하시면 이메일을 남겨주세요.',
        FEEDBACK_MESSAGE_LABEL: '메시지',
        FEEDBACK_EMAIL_PLACEHOLDER: 'you@example.com',
        FEEDBACK_MESSAGE_PLACEHOLDER: '피드백이나 제안을 남겨주세요.',
        FEEDBACK_SUBMIT: '피드백 보내기',
        FEEDBACK_SUBMITTING: '전송 중...',
        FEEDBACK_STATUS_PROMPT: '피드백을 남겨주세요. 답변을 원하시면 이메일을 함께 적어주세요.',
        FEEDBACK_STATUS_SENDING: '피드백을 전송하는 중...',
        FEEDBACK_STATUS_FAILED: '피드백 전송에 실패했습니다. 다시 시도해주세요.',
        FEEDBACK_CONFIRMATION: '피드백 감사합니다.',
        FEEDBACK_COMPARISON_TOAST: '비교 내용을 곧 추가할게요. 감사합니다!',
        FEEDBACK_REQUEST_SENT_TOAST: '요청이 전송되었습니다.',
        CONTENT_FEEDBACK_GOOD_TOAST: '피드백 감사합니다!',
        CONTENT_FEEDBACK_BAD_TOAST: '감사합니다! 해당 내용을 다시 검토해 볼께요.',
        RUBBER_1: '러버 1',
        RUBBER_2: '러버 2'
    },
    cn: {
        FILTERS: '筛选',
        POPULARITY: '人气',
        WEIGHT: '重量',
        WEGIHT: '重量',
        HARDNESS: '硬度',
        TOPSHEET: '胶面',
        TENSION: '经典',
        CHINESE: '粘性',
        HYBRID: '混合',
        CONTROL: '控制',
        EASY: '容易',
        MED: '中等',
        HARD: '困难',
        BRAND: '品牌',
        RUBBER: '胶皮',
        SPEED: '速度',
        SPIN: '旋转',
        SPEED_RANKING: '速度排名',
        SPIN_RANKING: '旋转排名',
        CUT_WEIGHT: '裁切重量',
        SPEED_RANK: '速度排名',
        SPIN_RANK: '旋转排名',
        RELEASE: '发售',
        THICKNESS: '厚度',
        PLAYERS: '职业选手',
        FEEDBACK_BUTTON: '反馈',
        FEEDBACK_BUTTON_TITLE: '发送反馈',
        FEEDBACK_CLOSE_ARIA: '关闭反馈窗口',
        FEEDBACK_TITLE_SHARE: '提交反馈',
        FEEDBACK_TITLE_SENT: '反馈已发送',
        FEEDBACK_INTRO: '我们会尽快回复您。',
        FEEDBACK_EMAIL_LABEL: '邮箱（可选）',
        FEEDBACK_EMAIL_NOTE: '如需回复，请留下邮箱。',
        FEEDBACK_MESSAGE_LABEL: '留言',
        FEEDBACK_EMAIL_PLACEHOLDER: 'you@example.com',
        FEEDBACK_MESSAGE_PLACEHOLDER: '欢迎分享你的反馈或建议。',
        FEEDBACK_SUBMIT: '发送反馈',
        FEEDBACK_SUBMITTING: '发送中...',
        FEEDBACK_STATUS_PROMPT: '欢迎反馈。若希望收到回复，请填写邮箱。',
        FEEDBACK_STATUS_SENDING: '正在发送你的反馈...',
        FEEDBACK_STATUS_FAILED: '反馈发送失败，请稍后重试。',
        FEEDBACK_CONFIRMATION: '感谢你的反馈。',
        FEEDBACK_COMPARISON_TOAST: '我们会尽快补充该对比，感谢你的建议！',
        FEEDBACK_REQUEST_SENT_TOAST: '请求已发送。',
        CONTENT_FEEDBACK_GOOD_TOAST: '感谢！很高兴这对你有帮助。',
        CONTENT_FEEDBACK_BAD_TOAST: '感谢反馈！我们会继续改进。',
        RUBBER_1: '胶皮 1',
        RUBBER_2: '胶皮 2'
    }
};

function getCurrentLang() {
    return COUNTRY_TO_LANG[selectedCountry] || 'en';
}

function tUi(key) {
    const lang = getCurrentLang();
    const localized = UI_TEXT[lang]?.[key];
    if (localized) return localized;
    return UI_TEXT.en[key] || key;
}

const BRAND_NAMES_I18N = {
    ko: {
        Butterfly: '버터플라이',
        DHS: 'DHS',
        Andro: '안드로',
        JOOLA: '줄라',
        Xiom: '엑시옴',
        Tibhar: '티바',
        Nittaku: '닛타쿠',
        Donic: '도닉',
        Yasaka: '야사카',
        YINHE: '은하'
    },
    cn: {
        Butterfly: '蝴蝶',
        DHS: '红双喜',
        Andro: '安德罗',
        JOOLA: '尤拉',
        Xiom: '骄猛',
        Tibhar: '挺拔',
        Nittaku: '尼塔库',
        Donic: '多尼克',
        Yasaka: '亚萨卡',
        YINHE: '银河'
    }
};

const RUBBER_NAMES_I18N = {
    ko: {
        // Andro
        'R42': 'R42',
        'R47': 'R47',
        'R48': 'R48',
        'R50': 'R50',
        'R53': 'R53',
        'C48': 'C48',
        'C53': 'C53',
        'NUZN 45': '뉴존 45',
        'NUZN 48': '뉴존 48',
        'NUZN 50': '뉴존 50',
        'NUZN 55': '뉴존 55',
        // Butterfly
        'Tenergy 05': '테너지 05',
        'Tenergy 05 FX': '테너지 05 FX',
        'Tenergy 05H': '테너지 05H',
        'Tenergy 19': '테너지 19',
        'Tenergy 64': '테너지 64',
        'Tenergy 80': '테너지 80',
        'Dignics 05': '디그닉스 05',
        'Dignics 09C': '디그닉스 09C',
        'Dignics 64': '디그닉스 64',
        'Dignics 80': '디그닉스 80',
        'Rozena': '로제나',
        'Zyre 03': '자이어 03',
        // DHS
        'H3 Neo': '네오 허리케인3',
        'H8-80': '허리케인8-80',
        'Gold Arc 8': '금궁8',
        // Donic
        'Acuda S1': '아쿠다 S1',
        'Acuda S2': '아쿠다 S2',
        'Baracuda': '바라쿠다',
        'Bluefire M1': '블루파이어 M1',
        'Bluefire M2': '블루파이어 M2',
        'Bluefire M3': '블루파이어 M3',
        'BlueGrip C2': '블루그립 C2',
        'BlueGrip J1': '블루그립 J1',
        'BlueGrip J2': '블루그립 J2',
        'BlueGrip J3': '블루그립 J3',
        'Bluestar A1': '블루스타 A1',
        'Bluestorm Pro AM': '블루스톰 프로 AM',
        'Bluestorm Z1': '블루스톰 Z1',
        'Bluestorm Z2': '블루스톰 Z2',
        'Bluestorm Z3': '블루스톰 Z3',
        // JOOLA
        'Dynaryz ACC': '다이나리즈 ACC',
        'Dynaryz AGR': '다이나리즈 AGR',
        'Dynaryz CMD': '다이나리즈 CMD',
        'Dynaryz Inferno': '다이나리즈 인페르노',
        'Dynaryz ZGR': '다이나리즈 ZGR',
        'Dynaryz ZGX': '다이나리즈 ZGX',
        'Tronix ACC': '트로닉스 ACC',
        'Tronix CMD': '트로닉스 CMD',
        'Tronix ZGR': '트로닉스 ZGR',
        // Nittaku
        'C-1': 'C-1',
        'G-1': 'G-1',
        'S-1': 'S-1',
        'Genextion': '제넥션',
        // Tibhar
        'EL-P': 'EL-P',
        'EL-S': 'EL-S',
        'FX-P': 'FX-P',
        'FX-S': 'FX-S',
        'K3': 'K3',
        'MK': 'MK',
        'MX-D': 'MX-D',
        'MX-K': 'MX-K',
        'MX-P 50': 'MX-P 50',
        'MX-P': 'MX-P',
        'MX-S': 'MX-S',
        // Xiom
        'J&H C52.5': '지킬앤하이드 C52.5',
        'J&H C55.0': '지킬앤하이드 C55.0',
        'J&H C57.5': '지킬앤하이드 C57.5',
        'J&H V47.5': '지킬앤하이드 V47.5',
        'J&H X47.5': '지킬앤하이드 X47.5',
        'J&H Z52.5': '지킬앤하이드 Z52.5',
        'Omega 7 Guang': '오메가 7 광',
        'Omega 7 Pro': '오메가 7 프로',
        'Omega 8 China': '오메가 8 차이나',
        'Omega 8 Hybrid': '오메가 8 하이브리드',
        'Omega 8 Pro': '오메가 8 프로',
        'Vega Europe': '베가 유럽',
        'Vega Pro': '베가 프로',
        'Vega X': '베가 텐',
        // Yasaka
        'Rakza 7 Soft': '라크자 7 소프트',
        'Rakza 7': '라크자 7',
        'Rakza 9': '라크자 9',
        'Rakza X': '라크자 X',
        'Rakza XX': '라크자 XX',
        'Rakza Z': '라크자 Z',
        // YINHE
        'Mercury 2': '머큐리 2'
    },
    cn: {
        // Andro
        'R42': 'R42',
        'R47': 'R47',
        'R48': 'R48',
        'R50': 'R50',
        'R53': 'R53',
        'C48': 'C48',
        'C53': 'C53',
        'NUZN 45': 'NUZN 45',
        'NUZN 48': 'NUZN 48',
        'NUZN 50': 'NUZN 50',
        'NUZN 55': 'NUZN 55',
        // Butterfly
        'Tenergy 05': '能量05',
        'Tenergy 05 FX': '能量05 FX',
        'Tenergy 05H': '能量05H',
        'Tenergy 19': '能量19',
        'Tenergy 64': '能量64',
        'Tenergy 80': '能量80',
        'Dignics 05': '迪格尼斯05',
        'Dignics 09C': '迪格尼斯09C',
        'Dignics 64': '迪格尼斯64',
        'Dignics 80': '迪格尼斯80',
        'Rozena': '罗泽纳',
        'Zyre 03': 'Zyre 03',
        // DHS
        'H3 Neo': '狂飙3 Neo',
        'H8-80': '狂飙8-80',
        'Gold Arc 8': '金弓8',
        // Donic
        'Acuda S1': '阿库达S1',
        'Acuda S2': '阿库达S2',
        'Baracuda': '巴拉库达',
        'Bluefire M1': '蓝火M1',
        'Bluefire M2': '蓝火M2',
        'Bluefire M3': '蓝火M3',
        'BlueGrip C2': '蓝握C2',
        'BlueGrip J1': '蓝握J1',
        'BlueGrip J2': '蓝握J2',
        'BlueGrip J3': '蓝握J3',
        'Bluestar A1': '蓝星A1',
        'Bluestorm Pro AM': '蓝色风暴Pro AM',
        'Bluestorm Z1': '蓝色风暴Z1',
        'Bluestorm Z2': '蓝色风暴Z2',
        'Bluestorm Z3': '蓝色风暴Z3',
        // JOOLA
        'Dynaryz ACC': '黛纳瑞兹ACC',
        'Dynaryz AGR': '黛纳瑞兹AGR',
        'Dynaryz CMD': '黛纳瑞兹CMD',
        'Dynaryz Inferno': '黛纳瑞兹Inferno',
        'Dynaryz ZGR': '黛纳瑞兹ZGR',
        'Dynaryz ZGX': '黛纳瑞兹ZGX',
        'Tronix ACC': '特罗尼斯ACC',
        'Tronix CMD': '特罗尼斯CMD',
        'Tronix ZGR': '特罗尼斯ZGR',
        // Nittaku
        'C-1': 'C-1',
        'G-1': 'G-1',
        'S-1': 'S-1',
        'Genextion': '杰ネクション',
        // Tibhar
        'EL-P': 'EL-P',
        'EL-S': 'EL-S',
        'FX-P': 'FX-P',
        'FX-S': 'FX-S',
        'K3': 'K3',
        'MK': 'MK',
        'MX-D': 'MX-D',
        'MX-K': 'MX-K',
        'MX-P 50': 'MX-P 50',
        'MX-P': 'MX-P',
        'MX-S': 'MX-S',
        // Xiom
        'J&H C52.5': '杰奇与海德C52.5',
        'J&H C55.0': '杰奇与海德C55.0',
        'J&H C57.5': '杰奇与海德C57.5',
        'J&H V47.5': '杰奇与海德V47.5',
        'J&H X47.5': '杰奇与海德X47.5',
        'J&H Z52.5': '杰奇与海德Z52.5',
        'Omega 7 Guang': '欧米茄7 光',
        'Omega 7 Pro': '欧米茄7 Pro',
        'Omega 8 China': '欧米茄8 粘性',
        'Omega 8 Hybrid': '欧米茄8 混合',
        'Omega 8 Pro': '欧米茄8 Pro',
        'Vega Europe': '维佳 欧洲',
        'Vega Pro': '维佳Pro',
        'Vega X': '维佳X',
        // Yasaka
        'Rakza 7 Soft': '力克萨7 Soft',
        'Rakza 7': '力克萨7',
        'Rakza 9': '力克萨9',
        'Rakza X': '力克萨X',
        'Rakza XX': '力克萨XX',
        'Rakza Z': '力克萨Z',
        // YINHE
        'Mercury 2': '水星2'
    }
};

function tBrand(brand) {
    const lang = getCurrentLang();
    return BRAND_NAMES_I18N[lang]?.[brand] || brand;
}

function tRubber(abbr) {
    const lang = getCurrentLang();
    return RUBBER_NAMES_I18N[lang]?.[abbr] || abbr;
}

function applyLocalizedStaticText() {
    document.querySelectorAll('[data-i18n-key]').forEach((el) => {
        const key = el.dataset.i18nKey;
        if (!key) return;
        el.textContent = tUi(key);
    });
    const setText = (id, key) => {
        const el = document.getElementById(id);
        if (el) el.textContent = tUi(key);
    };
    const setAttr = (id, attr, key) => {
        const el = document.getElementById(id);
        if (el) el.setAttribute(attr, tUi(key));
    };

    setAttr('feedbackOpenBtn', 'title', 'FEEDBACK_BUTTON_TITLE');
    setAttr('feedbackCloseBtn', 'aria-label', 'FEEDBACK_CLOSE_ARIA');
    setText('feedbackTitle', 'FEEDBACK_TITLE_SHARE');
    setText('feedbackIntro', 'FEEDBACK_INTRO');
    setText('feedbackEmailLabel', 'FEEDBACK_EMAIL_LABEL');
    setText('feedbackEmailNote', 'FEEDBACK_EMAIL_NOTE');
    setText('feedbackMessageLabel', 'FEEDBACK_MESSAGE_LABEL');
    setText('feedbackSubmitBtn', 'FEEDBACK_SUBMIT');
    setText('feedbackConfirmationMessage', 'FEEDBACK_CONFIRMATION');
    setAttr('feedbackEmail', 'placeholder', 'FEEDBACK_EMAIL_PLACEHOLDER');
    setAttr('feedbackMessage', 'placeholder', 'FEEDBACK_MESSAGE_PLACEHOLDER');
}

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
