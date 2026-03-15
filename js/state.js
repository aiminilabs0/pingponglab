// ════════════════════════════════════════════════════════════
//  Application State
// ════════════════════════════════════════════════════════════

let rubberData = [];
let selectedRubbers = [null, null];
let nextDetailPanel = 1;
let pinnedRubbers = [false, false];
let hasPlotted = false;
let isInternalUpdate = false;
let currentFilteredData = [];
let relayoutTimer = null;
let internalUpdateTimer = null;
let selectedCountry = 'us';
let _countrySwitchFade = false;
let filterPanelOpen = false;
let weightFilterState = {
    dataMin: null,
    dataMax: null,
    selectedMin: null,
    selectedMax: null
};
let hardnessFilterState = {
    dataMin: null,
    dataMax: null,
    selectedMin: null,
    selectedMax: null
};
let controlFilterState = {
    selectedLevels: new Set([1, 2, 3, 4, 5])
};
let top30FilterActive = false;
let top30Set = new Set();
let rubberByAbbr = new Map();
let playersData = {};
let playerNameToCanonicalName = {};

// YouTube embed state
let ytApiReady = false;
let ytPlayers = {};
let ytPlayerIdCounter = 0;
window.onYouTubeIframeAPIReady = () => { ytApiReady = true; };

const rubberDescriptionsCache = {};
const rubberComparisonCache = {};
let comparisonRenderToken = 0;

// Tab system state
let activeTab = null;          // 'desc1' | 'desc2' | 'comparison' | null
let tabContents = { desc1: null, desc2: null, comparison: null };
let tabScrollPositions = { desc1: 0, desc2: 0, comparison: 0 };
