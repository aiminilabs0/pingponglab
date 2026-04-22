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

const CACHE_VERSION = 116;
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
    YINHE: '#2596be',
    Nexy: '#9C27B0'
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

const COUNTRY_TO_LANG = { en: 'en', cn: 'cn', ko: 'ko' };
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
        SPEED_HINT: 'Speed Ranking # = 30% Rally Speed + 30% Catapult + 40% Max Speed',
        SPIN: 'Spin',
        SPIN_HINT: 'Spin Ranking # = 40% Serve Grip + 40% Opening Loop Spin + 20% Short-Game Spin',
        USER_GUIDE: 'User Guide',
        CUT_WEIGHT: 'Cut Weight',
        CUT_WEIGHT_HINT: 'Based on Max thickness, Shakehand 157 × 150 mm',
        CONTROL_HINT: '5 = more controllable, 1 = less controllable',
        TOPSHEET_HINT: 'Tension = springy & fast, Chinese = spinny & controlled, Hybrid = between the two',
        HARDNESS_HINT: 'Measured in degrees (°). Harder = more speed & spin potential, Softer = more control & forgiveness',
        RELEASE: 'Release',
        THICKNESS: 'Thickness',
        PRICE: 'Price',
        PLAYERS: 'Players',
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
        FEEDBACK_STATUS_PROMPT: 'Please include your email if you\'d like a response.',
        FEEDBACK_STATUS_SENDING: 'Sending your feedback...',
        FEEDBACK_STATUS_FAILED: 'Could not send feedback. Please try again.',
        FEEDBACK_CONFIRMATION: 'Thank you for your feedback.',
        FEEDBACK_COMPARISON_TOAST: 'We\'ll add the comparison soon. Thank you!',
        FEEDBACK_REQUEST_SENT_TOAST: 'Request sent.',
        CONTENT_FEEDBACK_GOOD_TOAST: 'Thanks! Glad this was helpful.',
        CONTENT_FEEDBACK_BAD_TOAST: 'Thanks! We will use your feedback to improve this.',
        CONTENT_FEEDBACK_REASON_PLACEHOLDER: 'What was wrong or could be improved?',
        CONTENT_FEEDBACK_REASON_SUBMIT: 'Send',
        CONTENT_FEEDBACK_REASON_SENDING: 'Sending...',
        RUBBER_1: 'Rubber 1',
        RUBBER_2: 'Rubber 2',
        FOREHAND: 'Forehand',
        BACKHAND: 'Backhand',
        SHARE: 'Share',
        SHARE_COPIED: 'Link copied!',
        COPY: 'Copy',
        COPY_TEXT_COPIED: 'Copied!',
        NO_COMPARISON: 'No comparison available yet',
        NO_COMPARISON_SUB: 'We haven\'t reviewed this matchup yet. Request it and we\'ll notify you when it\'s ready.',
        REQUEST_COMPARISON: 'Request a Comparison',
        COMP_REQ_TITLE: 'Get notified',
        COMP_REQ_SUB_BEFORE: 'We\'ll email you when ',
        COMP_REQ_SUB_AFTER: ' is ready.',
        COMP_REQ_EMAIL_LABEL: 'Email',
        COMP_REQ_SUBMIT: 'Notify me',
        COMP_REQ_SUBMITTING: 'Sending...',
        COMP_REQ_CONFIRMATION: 'We\'ll let you know when it\'s ready.',
        COMP_REQ_FAILED: 'Could not send request. Please try again.'
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
        SPEED_HINT: '스피드 랭킹 # = 30% 랠리 속도 + 30% 반발력 + 40% 최대 스피드',
        SPIN: '스핀',
        SPIN_HINT: '스핀 랭킹 # = 40% 서브스핀 + 40% 루프 스핀 + 20% 숏게임',
        USER_GUIDE: '사용법',
        CUT_WEIGHT: '컷무게',
        CUT_WEIGHT_HINT: '최대 두께 기준, 쉐이크핸드 157 × 150 mm',
        CONTROL_HINT: '5 = 컨트롤 좋음, 1 = 컨트롤 어려움',
        TOPSHEET_HINT: '텐션 = 탄력적이고 빠름, 점착 = 스핀 강하고 컨트롤 좋음, 하이브리드 = 그 사이',
        HARDNESS_HINT: '도(°) 단위로 측정. 딱딱할수록 스피드·스핀 가능성 높음, 부드러울수록 컨트롤·관용성 높음',
        RELEASE: '출시',
        THICKNESS: '두께',
        PRICE: '가격',
        PLAYERS: '선수',
        FEEDBACK_BUTTON: '피드백',
        FEEDBACK_BUTTON_TITLE: '피드백',
        FEEDBACK_CLOSE_ARIA: '피드백 창 닫기',
        FEEDBACK_TITLE_SHARE: '피드백',
        FEEDBACK_TITLE_SENT: '피드백 전송 완료',
        FEEDBACK_INTRO: '가능한 한 빨리 답변드릴게요.',
        FEEDBACK_EMAIL_LABEL: '이메일 (선택)',
        FEEDBACK_EMAIL_NOTE: '답변을 원하시면 이메일을 남겨주세요.',
        FEEDBACK_MESSAGE_LABEL: '메시지',
        FEEDBACK_EMAIL_PLACEHOLDER: 'you@example.com',
        FEEDBACK_MESSAGE_PLACEHOLDER: '피드백이나 제안을 남겨주세요.',
        FEEDBACK_SUBMIT: '보내기',
        FEEDBACK_SUBMITTING: '전송 중...',
        FEEDBACK_STATUS_PROMPT: '이메일 주소를 함께 남겨주시면 답장 드리겠습니다',
        FEEDBACK_STATUS_SENDING: '피드백을 전송하는 중...',
        FEEDBACK_STATUS_FAILED: '피드백 전송에 실패했습니다. 다시 시도해주세요.',
        FEEDBACK_CONFIRMATION: '피드백 감사합니다.',
        FEEDBACK_COMPARISON_TOAST: '비교 내용을 곧 추가할게요. 감사합니다!',
        FEEDBACK_REQUEST_SENT_TOAST: '요청이 전송되었습니다.',
        CONTENT_FEEDBACK_GOOD_TOAST: '피드백 감사합니다!',
        CONTENT_FEEDBACK_BAD_TOAST: '감사합니다! 해당 내용을 다시 검토해 볼께요.',
        CONTENT_FEEDBACK_REASON_PLACEHOLDER: '어떤 점이 부족하거나 개선이 필요한가요?',
        CONTENT_FEEDBACK_REASON_SUBMIT: '전송',
        CONTENT_FEEDBACK_REASON_SENDING: '전송 중...',
        RUBBER_1: '러버 1',
        RUBBER_2: '러버 2',
        FOREHAND: '포핸드',
        BACKHAND: '백핸드',
        SHARE: '공유',
        SHARE_COPIED: '링크가 복사되었습니다!',
        COPY: '복사',
        COPY_TEXT_COPIED: '복사됨!',
        NO_COMPARISON: '아직 비교 정보가 없습니다',
        NO_COMPARISON_SUB: '아직 이 조합을 검토하지 않았어요. 요청하시면 준비되면 알려드릴게요.',
        REQUEST_COMPARISON: '비교 요청하기',
        COMP_REQ_TITLE: '알림 받기',
        COMP_REQ_SUB_BEFORE: '',
        COMP_REQ_SUB_AFTER: ' 비교가 준비되면 이메일로 알려드릴게요.',
        COMP_REQ_EMAIL_LABEL: '이메일',
        COMP_REQ_SUBMIT: '알림 받기',
        COMP_REQ_SUBMITTING: '전송 중...',
        COMP_REQ_CONFIRMATION: '준비되면 알려드릴게요.',
        COMP_REQ_FAILED: '요청 전송에 실패했습니다. 다시 시도해주세요.'
    },
    cn: {
        FILTERS: '筛选',
        POPULARITY: '人气',
        WEIGHT: '重量',
        WEGIHT: '重量',
        HARDNESS: '硬度',
        TOPSHEET: '胶面',
        TENSION: '张力',
        CHINESE: '中式粘性',
        HYBRID: '混合型',
        CONTROL: '控制',
        EASY: '容易',
        MED: '中等',
        HARD: '困难',
        BRAND: '品牌',
        RUBBER: '胶皮',
        SPEED: '速度',
        SPEED_HINT: '速度排名 # = 30% 相持速度 + 30% 弹性 + 40% 最高速度',
        SPIN: '旋转',
        SPIN_HINT: '旋转排名 # = 40% 发球旋转 + 40% 起板旋转 + 20% 短球控制',
        USER_GUIDE: '使用指南',
        CUT_WEIGHT: '裁切后重量',
        CUT_WEIGHT_HINT: '以最大厚度为基准，横拍 157 × 150 mm',
        CONTROL_HINT: '5 = 更容易控制，1 = 较难控制',
        TOPSHEET_HINT: '张力型 = 弹性强且快速，中式粘性 = 旋转强且可控，混合型 = 介于两者之间',
        HARDNESS_HINT: '以度（°）为单位测量。越硬 = 速度与旋转潜力越高，越软 = 控制力与容错性越高',
        RELEASE: '发售时间',
        THICKNESS: '厚度',
        PRICE: '价格',
        PLAYERS: '选手',
        FEEDBACK_BUTTON: '反馈',
        FEEDBACK_BUTTON_TITLE: '发送反馈',
        FEEDBACK_CLOSE_ARIA: '关闭反馈窗口',
        FEEDBACK_TITLE_SHARE: '提交反馈',
        FEEDBACK_TITLE_SENT: '反馈已发送',
        FEEDBACK_INTRO: '我们会尽快回复您。',
        FEEDBACK_EMAIL_LABEL: '邮箱（可选）',
        FEEDBACK_EMAIL_NOTE: '如果您希望收到回复，请留下您的电子邮箱地址。',
        FEEDBACK_MESSAGE_LABEL: '留言',
        FEEDBACK_EMAIL_PLACEHOLDER: 'you@example.com',
        FEEDBACK_MESSAGE_PLACEHOLDER: '欢迎留下您的反馈或建议。',
        FEEDBACK_SUBMIT: '发送',
        FEEDBACK_SUBMITTING: '发送中...',
        FEEDBACK_STATUS_PROMPT: '如果您希望收到回复，请填写您的邮箱地址。',
        FEEDBACK_STATUS_SENDING: '正在发送您的反馈...',
        FEEDBACK_STATUS_FAILED: '反馈发送失败，请稍后重试。',
        FEEDBACK_CONFIRMATION: '感谢您的反馈。',
        FEEDBACK_COMPARISON_TOAST: '我们会尽快补充该对比内容，感谢您的建议！',
        FEEDBACK_REQUEST_SENT_TOAST: '请求已发送。',
        CONTENT_FEEDBACK_GOOD_TOAST: '感谢您的反馈！',
        CONTENT_FEEDBACK_BAD_TOAST: '感谢您的反馈！我们会重新检查并继续改进。',
        CONTENT_FEEDBACK_REASON_PLACEHOLDER: '您觉得哪里不足，或有哪些地方需要改进？',
        CONTENT_FEEDBACK_REASON_SUBMIT: '发送',
        CONTENT_FEEDBACK_REASON_SENDING: '发送中...',
        RUBBER_1: '胶皮 1',
        RUBBER_2: '胶皮 2',
        FOREHAND: '正手',
        BACKHAND: '反手',
        SHARE: '分享',
        SHARE_COPIED: '链接已复制！',
        COPY: '复制',
        COPY_TEXT_COPIED: '已复制！',
        NO_COMPARISON: '暂无对比内容',
        NO_COMPARISON_SUB: '我们还没有评测这个组合。提交请求后，准备好时我们会通知您。',
        REQUEST_COMPARISON: '请求添加对比',
        COMP_REQ_TITLE: '获取通知',
        COMP_REQ_SUB_BEFORE: '当 ',
        COMP_REQ_SUB_AFTER: ' 的对比准备好后，我们会通过邮件通知您。',
        COMP_REQ_EMAIL_LABEL: '邮箱',
        COMP_REQ_SUBMIT: '通知我',
        COMP_REQ_SUBMITTING: '发送中...',
        COMP_REQ_CONFIRMATION: '准备好后我们会通知您。',
        COMP_REQ_FAILED: '请求发送失败，请稍后重试。'
    }
};

function getCurrentLang() {
    return COUNTRY_TO_LANG[selectedCountry] || 'en';
}

function tUi(key) {
    if (key === 'USER_GUIDE') return UI_TEXT.en.USER_GUIDE;
    const lang = getCurrentLang();
    const bundle = UI_TEXT[lang];
    if (bundle && Object.prototype.hasOwnProperty.call(bundle, key)) {
        return bundle[key];
    }
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
        YINHE: '은하',
        Nexy: '넥시'
    },
    cn: {
        Butterfly: '蝴蝶',
        DHS: '红双喜',
        Andro: '岸度',
        JOOLA: '优拉',
        Xiom: '骄猛',
        Tibhar: '挺拔',
        Nittaku: '尼塔库',
        Donic: '多尼克',
        Yasaka: '亚萨卡',
        YINHE: '银河',
        Nexy: '耐仕'
    }
};



function tBrand(brand) {
    const lang = getCurrentLang();
    return BRAND_NAMES_I18N[lang]?.[brand] || brand;
}

function getRubberLocalizedSearchTerms(rubber) {
    if (!rubber || typeof rubber !== 'object') return [];
    const terms = new Set();
    const addValue = (value) => {
        if (typeof value !== 'string') return;
        const normalized = value.trim();
        if (normalized) terms.add(normalized);
    };
    addValue(rubber.abbr);
    addValue(rubber.name);
    const maps = [rubber.localizedAbbr, rubber.localizedName];
    maps.forEach((map) => {
        if (!map || typeof map !== 'object') return;
        Object.values(map).forEach(addValue);
    });
    return Array.from(terms);
}

function tRubber(rubberOrAbbr) {
    const lang = getCurrentLang();
    const rubber = (rubberOrAbbr && typeof rubberOrAbbr === 'object')
        ? rubberOrAbbr
        : rubberByAbbr.get(rubberOrAbbr);
    if (!rubber) return typeof rubberOrAbbr === 'string' ? rubberOrAbbr : '';

    const localizedAbbr = rubber.localizedAbbr && typeof rubber.localizedAbbr === 'object'
        ? rubber.localizedAbbr
        : null;
    const localizedName = rubber.localizedName && typeof rubber.localizedName === 'object'
        ? rubber.localizedName
        : null;
    return localizedAbbr?.[lang] || localizedName?.[lang] || localizedAbbr?.en || localizedName?.en || rubber.abbr || rubber.name || '';
}

function tRubberAbbr(rubberOrAbbr) {
    const lang = getCurrentLang();
    const rubber = (rubberOrAbbr && typeof rubberOrAbbr === 'object')
        ? rubberOrAbbr
        : rubberByAbbr.get(rubberOrAbbr);
    if (!rubber) return typeof rubberOrAbbr === 'string' ? rubberOrAbbr : '';

    const localizedAbbr = rubber.localizedAbbr && typeof rubber.localizedAbbr === 'object'
        ? rubber.localizedAbbr
        : null;
    const localizedName = rubber.localizedName && typeof rubber.localizedName === 'object'
        ? rubber.localizedName
        : null;
    return localizedAbbr?.[lang] || localizedAbbr?.en || rubber.abbr || localizedName?.[lang] || localizedName?.en || rubber.name || '';
}

function tRubberName(rubberOrAbbr) {
    const lang = getCurrentLang();
    const rubber = (rubberOrAbbr && typeof rubberOrAbbr === 'object')
        ? rubberOrAbbr
        : rubberByAbbr.get(rubberOrAbbr);
    if (!rubber) return typeof rubberOrAbbr === 'string' ? rubberOrAbbr : '';

    const localizedName = rubber.localizedName && typeof rubber.localizedName === 'object'
        ? rubber.localizedName
        : null;
    const localizedAbbr = rubber.localizedAbbr && typeof rubber.localizedAbbr === 'object'
        ? rubber.localizedAbbr
        : null;
    return localizedName?.[lang] || localizedName?.en || rubber.name || localizedAbbr?.[lang] || localizedAbbr?.en || rubber.abbr || '';
}

function applyLocalizedStaticText() {
    document.querySelectorAll('[data-i18n-key]').forEach((el) => {
        const key = el.dataset.i18nKey;
        if (!key) return;
        el.textContent = tUi(key);
    });
    if (typeof refreshSheetToggleFilterLabels === 'function') {
        refreshSheetToggleFilterLabels();
    }
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

    // Inject metric-hint icons into chart axis labels
    const hintIconSvg = '<svg class="metric-hint-icon" width="11" height="11" viewBox="0 0 16 16" fill="currentColor"><path d="M8 0a8 8 0 1 0 0 16A8 8 0 0 0 8 0zm.9 12H7.1V7h1.8v5zM8 5.9a1 1 0 1 1 0-2 1 1 0 0 1 0 2z"/></svg>';
    function injectAxisHint(containerSel, hintKey) {
        const container = document.querySelector(containerSel);
        if (!container) return;
        const hintText = tUi(hintKey);
        container.dataset.hint = hintText;
        let hint = container.querySelector('.metric-hint');
        if (!hint) {
            hint = document.createElement('span');
            hint.className = 'metric-hint';
            hint.innerHTML = hintIconSvg;
            container.appendChild(hint);
        }
        hint.dataset.hint = hintText;
    }
    injectAxisHint('.chart-speed-outside > span', 'SPEED_HINT');
    injectAxisHint('.chart-spin-label', 'SPIN_HINT');
}

const CHART_FONT = 'Comic Neue, -apple-system, BlinkMacSystemFont, Segoe UI, Roboto, sans-serif';
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
const GA_MEASUREMENT_ID = 'G-F2QMQTQXMK';

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
    return '';
}

function buildCountryGaEventName(eventToken, nameToken) {
    return `c_${normalizeGaToken(eventToken) || 'unknown'}_${getCountryTokenForGa()}_${normalizeGaToken(nameToken) || 'unknown'}`;
}

function isAnalyticsBlockedUser() {
    const host = String(window.location.hostname || '').toLowerCase();
    if (host === 'localhost' || host === '127.0.0.1' || host === '::1') {
        return true;
    }
    try {
        return localStorage.getItem('admin') !== null;
    } catch {
        return false;
    }
}

function ensureAnalyticsInitialized() {
    if (isAnalyticsBlockedUser()) return;
    window.dataLayer = window.dataLayer || [];

    if (typeof window.gtag !== 'function') {
        window.gtag = function gtag() {
            window.dataLayer.push(arguments);
        };
    }

    if (!window.__gaBootstrapScriptInjected) {
        const script = document.createElement('script');
        script.async = true;
        script.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(GA_MEASUREMENT_ID)}`;
        document.head.appendChild(script);
        window.__gaBootstrapScriptInjected = true;
    }

    if (!window.__gaConfigured) {
        window.gtag('js', new Date());
        window.gtag('config', GA_MEASUREMENT_ID);
        window.__gaConfigured = true;
    }
}

// ════════════════════════════════════════════════════════════
//  Analytics
// ════════════════════════════════════════════════════════════

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


function trackBuyClickEvent(rubberName) {
    if (typeof window.gtag !== 'function' || isAnalyticsBlockedUser()) return;
    const eventName = buildCountryGaEventName('buy', rubberName);
    window.gtag('event', eventName, {
        rubber_name: rubberName || '',
        device_type: getDeviceTypeForGa(),
        login_name: getLoginNameInputForGa()
    });
}
