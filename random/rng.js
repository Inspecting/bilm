
const SETTINGS_KEY = 'bilm:rng:settings:v3';
const ROULETTE_STATE_KEY = 'bilm:rng:roulette-state:v3';
const HISTORY_KEY = 'bilm:rng:history:v3';
const PRESETS_KEY = 'bilm:rng:presets:v3';
const ACCESS_KEY = 'bilm-site-unlocked';
const ACCESS_SEED = '1001';
const MAX_HISTORY_ITEMS = 60;
const MAX_PRESET_ITEMS = 20;
const MAX_RECENT_SPINS = 12;

const RED_NUMBERS = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);
const EUROPEAN_ORDER = [0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23, 10, 5, 24, 16, 33, 1, 20, 14, 31, 9, 22, 18, 29, 7, 28, 12, 35, 3, 26];
const AMERICAN_ORDER = [0, 28, 9, 26, 30, 11, 7, 20, 32, 17, 5, 22, 34, 15, 3, 24, 36, 13, 1, '00', 27, 10, 25, 29, 12, 8, 19, 31, 18, 6, 21, 33, 16, 4, 23, 35, 14, 2];

const engineLabelMap = { crypto: 'Crypto secure', seeded: 'Seeded deterministic', math: 'Math.random' };
const modeLabelMap = { roulette: 'Roulette', number: 'Number', list: 'List picker', coin: 'Coin flip', dice: 'Dice' };
const betLabelMap = { red: 'Red', black: 'Black', green: 'Green', odd: 'Odd', even: 'Even', low: '1-18', high: '19-36' };

const defaultSettings = {
  mode: 'roulette',
  engine: 'crypto',
  seed: '',
  roulette: { wheelType: 'european', strategy: 'flat', bias: 'none', colorPayout: 2, greenPayout: 14, spinDuration: 2600, spinLoops: 5, instant: 'auto', sound: 'off', autoSpinCount: 12, autoSpinDelay: 700 },
  number: { min: 1, max: 100, count: 1, decimals: 0, unique: false, sort: 'none' },
  list: { items: 'Blue team\nRed team\nGold team\nGreen team', count: 1, unique: true, useWeights: true },
  coin: { count: 1 },
  dice: { count: 2, sides: 6, modifier: 0 }
};

const defaultRouletteState = {
  balance: 1000,
  betAmount: 10,
  baseBet: 10,
  selectedBet: 'red',
  rotation: 0,
  recent: [],
  stats: { wins: 0, losses: 0, streak: 0, totalBet: 0, totalReturn: 0 }
};

const elements = {
  status: document.getElementById('rngStatus'),
  engineSelect: document.getElementById('engineSelect'),
  seedInput: document.getElementById('seedInput'),
  savePresetBtn: document.getElementById('savePresetBtn'),
  clearHistoryBtn: document.getElementById('clearHistoryBtn'),
  generateBtn: document.getElementById('generateBtn'),
  copyResultBtn: document.getElementById('copyResultBtn'),
  resultHeading: document.getElementById('resultHeading'),
  resultMeta: document.getElementById('resultMeta'),
  resultOutput: document.getElementById('resultOutput'),
  historyList: document.getElementById('historyList'),
  presetList: document.getElementById('presetList'),
  statRuns: document.getElementById('statRuns'),
  statWins: document.getElementById('statWins'),
  statLosses: document.getElementById('statLosses'),
  statStreak: document.getElementById('statStreak'),
  statLastMode: document.getElementById('statLastMode'),
  statEngine: document.getElementById('statEngine'),
  modeTabs: Array.from(document.querySelectorAll('.mode-tab')),
  modePanels: Array.from(document.querySelectorAll('[data-mode-panel]')),
  rouletteWheel: document.getElementById('rouletteWheel'),
  rouletteLastOutcome: document.getElementById('rouletteLastOutcome'),
  rouletteLanding: document.getElementById('rouletteLanding'),
  rouletteRecentStrip: document.getElementById('rouletteRecentStrip'),
  balanceDisplay: document.getElementById('balanceDisplay'),
  balanceInput: document.getElementById('balanceInput'),
  applyBalanceBtn: document.getElementById('applyBalanceBtn'),
  betAmountInput: document.getElementById('betAmountInput'),
  betHalfBtn: document.getElementById('betHalfBtn'),
  betDoubleBtn: document.getElementById('betDoubleBtn'),
  betMaxBtn: document.getElementById('betMaxBtn'),
  betResetBtn: document.getElementById('betResetBtn'),
  betOptions: Array.from(document.querySelectorAll('.bet-option[data-bet]')),
  spinBtn: document.getElementById('spinBtn'),
  autoSpinBtn: document.getElementById('autoSpinBtn'),
  stopAutoBtn: document.getElementById('stopAutoBtn'),
  resetSessionBtn: document.getElementById('resetSessionBtn'),
  wheelTypeSelect: document.getElementById('wheelTypeSelect'),
  rouletteStrategySelect: document.getElementById('rouletteStrategySelect'),
  rouletteBiasSelect: document.getElementById('rouletteBiasSelect'),
  rouletteColorPayoutInput: document.getElementById('rouletteColorPayoutInput'),
  rouletteGreenPayoutInput: document.getElementById('rouletteGreenPayoutInput'),
  spinDurationInput: document.getElementById('spinDurationInput'),
  spinLoopsInput: document.getElementById('spinLoopsInput'),
  instantResultSelect: document.getElementById('instantResultSelect'),
  rouletteSoundSelect: document.getElementById('rouletteSoundSelect'),
  autoSpinCountInput: document.getElementById('autoSpinCountInput'),
  autoSpinDelayInput: document.getElementById('autoSpinDelayInput'),
  rouletteMessage: document.getElementById('rouletteMessage'),
  numberMin: document.getElementById('numberMin'), numberMax: document.getElementById('numberMax'), numberCount: document.getElementById('numberCount'), numberDecimals: document.getElementById('numberDecimals'), numberUnique: document.getElementById('numberUnique'), numberSort: document.getElementById('numberSort'),
  listItems: document.getElementById('listItems'), listCount: document.getElementById('listCount'), listUnique: document.getElementById('listUnique'), listUseWeights: document.getElementById('listUseWeights'),
  coinCount: document.getElementById('coinCount'), diceCount: document.getElementById('diceCount'), diceSides: document.getElementById('diceSides'), diceModifier: document.getElementById('diceModifier')
};

const state = {
  settings: JSON.parse(JSON.stringify(defaultSettings)),
  rouletteState: JSON.parse(JSON.stringify(defaultRouletteState)),
  history: [], presets: [], mode: 'roulette', rngCache: null,
  spinning: false, autoSpinActive: false, lastResult: 'Ready.', audioCtx: null
};

const safeJsonParse = (raw, fallback) => { try { const parsed = JSON.parse(raw); return parsed ?? fallback; } catch { return fallback; } };
const readLocalJson = (key, fallback) => { try { return safeJsonParse(localStorage.getItem(key) || '', fallback); } catch { return fallback; } };
const writeLocalJson = (key, value) => { try { localStorage.setItem(key, JSON.stringify(value)); } catch {} };
const clampNumber = (value, min, max, fallback) => { const numeric = Number(value); if (!Number.isFinite(numeric)) return fallback; return Math.min(max, Math.max(min, numeric)); };
const wait = (ms) => new Promise((resolve) => window.setTimeout(resolve, ms));
const setStatus = (message) => { if (elements.status) elements.status.textContent = message; };
const setRouletteMessage = (message) => { if (elements.rouletteMessage) elements.rouletteMessage.textContent = message; };
const getRandomId = () => (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : `id-${Date.now()}-${Math.random().toString(16).slice(2)}`;
const normalizeNumberBounds = (min, max) => (min <= max ? [min, max] : [max, min]);
const copyText = async (text) => {
  if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(text); return true; }
  const temp = document.createElement('textarea'); temp.value = text; temp.style.position = 'fixed'; temp.style.opacity = '0'; document.body.appendChild(temp); temp.select();
  try { document.execCommand('copy'); return true; } catch { return false; } finally { temp.remove(); }
};

const deepMergeSettings = (base, patch) => ({ ...base, ...patch, roulette: { ...base.roulette, ...(patch?.roulette || {}) }, number: { ...base.number, ...(patch?.number || {}) }, list: { ...base.list, ...(patch?.list || {}) }, coin: { ...base.coin, ...(patch?.coin || {}) }, dice: { ...base.dice, ...(patch?.dice || {}) } });
const deepMergeRouletteState = (base, patch) => ({ ...base, ...patch, recent: Array.isArray(patch?.recent) ? patch.recent.slice(0, MAX_RECENT_SPINS) : [...base.recent], stats: { ...base.stats, ...(patch?.stats || {}) } });

const saveSettings = () => writeLocalJson(SETTINGS_KEY, state.settings);
const saveRouletteState = () => writeLocalJson(ROULETTE_STATE_KEY, state.rouletteState);
const saveHistory = () => writeLocalJson(HISTORY_KEY, state.history.slice(0, MAX_HISTORY_ITEMS));
const savePresets = () => writeLocalJson(PRESETS_KEY, state.presets.slice(0, MAX_PRESET_ITEMS));

const maybeUnlockAccess = () => {
  if (state.settings.seed !== ACCESS_SEED) return;
  try { if (localStorage.getItem(ACCESS_KEY) === 'true') return; localStorage.setItem(ACCESS_KEY, 'true'); } catch { return; }
  setStatus('Access unlocked. Roulette Lab updated.');
};
const xmur3 = (text) => {
  let hash = 1779033703 ^ text.length;
  for (let i = 0; i < text.length; i += 1) { hash = Math.imul(hash ^ text.charCodeAt(i), 3432918353); hash = (hash << 13) | (hash >>> 19); }
  return () => { hash = Math.imul(hash ^ (hash >>> 16), 2246822507); hash = Math.imul(hash ^ (hash >>> 13), 3266489909); return (hash ^= hash >>> 16) >>> 0; };
};

const sfc32 = (a, b, c, d) => () => {
  a >>>= 0; b >>>= 0; c >>>= 0; d >>>= 0;
  let t = (a + b) | 0; a = b ^ (b >>> 9); b = (c + (c << 3)) | 0; c = (c << 21) | (c >>> 11); d = (d + 1) | 0; t = (t + d) | 0; c = (c + t) | 0;
  return (t >>> 0) / 4294967296;
};

const createSeededRandom = (seedText) => { const hash = xmur3(String(seedText || 'bilm-seed')); return sfc32(hash(), hash(), hash(), hash()); };

const getRandomSource = () => {
  const { engine, seed } = state.settings;
  if (state.rngCache && state.rngCache.engine === engine && state.rngCache.seed === seed) return state.rngCache.next;
  let next;
  if (engine === 'seeded') next = createSeededRandom(seed || 'bilm-seed');
  else if (engine === 'crypto' && typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    next = () => { const buffer = new Uint32Array(1); crypto.getRandomValues(buffer); return buffer[0] / 4294967296; };
  } else next = Math.random;
  state.rngCache = { engine, seed, next };
  return next;
};

const randomInt = (min, max) => Math.floor(getRandomSource()() * (max - min + 1)) + min;
const pickWeightedIndex = (items) => {
  const total = items.reduce((sum, item) => sum + item.weight, 0);
  if (total <= 0) return -1;
  const target = getRandomSource()() * total;
  let running = 0;
  for (let i = 0; i < items.length; i += 1) { running += items[i].weight; if (target <= running) return i; }
  return items.length - 1;
};

const getRouletteSegments = () => {
  const type = state.settings.roulette.wheelType;
  const values = type === 'american' ? AMERICAN_ORDER : type === 'european' ? EUROPEAN_ORDER : Array.from({ length: 36 }, (_, i) => i + 1);
  return values.map((entry) => {
    if (entry === 0) return { label: '0', value: 0, color: 'green' };
    if (entry === '00') return { label: '00', value: null, color: 'green' };
    const value = Number(entry);
    return { label: String(value), value, color: RED_NUMBERS.has(value) ? 'red' : 'black' };
  });
};

const hasGreenSegments = () => getRouletteSegments().some((segment) => segment.color === 'green');

const drawRouletteWheel = () => {
  const canvas = elements.rouletteWheel;
  const ctx = canvas?.getContext?.('2d');
  if (!canvas || !ctx) return;
  const segments = getRouletteSegments();
  const count = segments.length;
  const cx = canvas.width / 2;
  const cy = canvas.height / 2;
  const radius = Math.min(cx, cy) - 18;
  const angle = (Math.PI * 2) / count;
  const rotation = state.rouletteState.rotation;

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  segments.forEach((segment, index) => {
    const start = rotation + index * angle;
    const end = start + angle;
    ctx.beginPath(); ctx.moveTo(cx, cy); ctx.arc(cx, cy, radius, start, end); ctx.closePath();
    if (segment.color === 'red') ctx.fillStyle = '#be123c';
    if (segment.color === 'black') ctx.fillStyle = '#0f172a';
    if (segment.color === 'green') ctx.fillStyle = '#047857';
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.2)'; ctx.lineWidth = 1; ctx.stroke();

    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(start + angle / 2);
    ctx.fillStyle = 'rgba(255,255,255,0.92)';
    ctx.font = '12px Poppins, sans-serif';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    ctx.fillText(segment.label, radius - 12, 0);
    ctx.restore();
  });

  ctx.beginPath();
  ctx.arc(cx, cy, radius * 0.24, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(15,23,42,0.92)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.32)';
  ctx.lineWidth = 2;
  ctx.stroke();
};

const updateBetOptionState = () => {
  const greenAvailable = hasGreenSegments();
  elements.betOptions.forEach((button) => {
    const type = button.dataset.bet;
    button.classList.toggle('is-selected', type === state.rouletteState.selectedBet);
    if (type === 'green') {
      button.disabled = !greenAvailable;
      button.title = greenAvailable ? 'Bet on green' : 'Green not available on classic wheel';
    }
  });
  if (!greenAvailable && state.rouletteState.selectedBet === 'green') state.rouletteState.selectedBet = 'red';
};

const renderRouletteRecent = () => {
  if (!elements.rouletteRecentStrip) return;
  elements.rouletteRecentStrip.innerHTML = '';
  if (!state.rouletteState.recent.length) {
    const muted = document.createElement('p'); muted.className = 'muted'; muted.textContent = 'No spins yet.'; elements.rouletteRecentStrip.appendChild(muted); return;
  }
  state.rouletteState.recent.forEach((entry) => {
    const pill = document.createElement('span');
    pill.className = `recent-pill ${entry.color}`;
    pill.textContent = entry.label;
    elements.rouletteRecentStrip.appendChild(pill);
  });
};

const refreshStats = () => {
  if (elements.statRuns) elements.statRuns.textContent = String(state.history.length);
  if (elements.statWins) elements.statWins.textContent = String(state.rouletteState.stats.wins || 0);
  if (elements.statLosses) elements.statLosses.textContent = String(state.rouletteState.stats.losses || 0);
  if (elements.statStreak) elements.statStreak.textContent = String(state.rouletteState.stats.streak || 0);
  if (elements.statLastMode) elements.statLastMode.textContent = state.history[0] ? modeLabelMap[state.history[0].mode] : '-';
  if (elements.statEngine) elements.statEngine.textContent = engineLabelMap[state.settings.engine] || engineLabelMap.crypto;
};

const updateRouletteControlState = () => {
  const rouletteMode = state.mode === 'roulette';
  if (elements.spinBtn) elements.spinBtn.disabled = !rouletteMode || state.spinning;
  if (elements.autoSpinBtn) elements.autoSpinBtn.disabled = !rouletteMode || state.spinning || state.autoSpinActive;
  if (elements.stopAutoBtn) elements.stopAutoBtn.disabled = !rouletteMode || !state.autoSpinActive;
  if (elements.generateBtn) { elements.generateBtn.disabled = state.spinning; elements.generateBtn.textContent = rouletteMode ? 'Spin wheel' : 'Generate'; }
};

const renderRouletteHud = () => {
  if (elements.balanceDisplay) elements.balanceDisplay.textContent = state.rouletteState.balance.toFixed(2);
  if (elements.balanceInput) elements.balanceInput.value = String(Math.floor(state.rouletteState.balance));
  if (elements.betAmountInput) elements.betAmountInput.value = String(Math.floor(state.rouletteState.betAmount));
  updateBetOptionState();
  renderRouletteRecent();
  refreshStats();
  updateRouletteControlState();
};
const setResult = (text, meta) => {
  state.lastResult = String(text || '');
  if (elements.resultOutput) elements.resultOutput.textContent = state.lastResult || 'Ready.';
  if (elements.resultMeta) elements.resultMeta.textContent = String(meta || '');
};

const formatTimestamp = (timestamp) => new Date(timestamp).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

const renderHistory = () => {
  if (!elements.historyList) return;
  elements.historyList.innerHTML = '';
  if (!state.history.length) {
    const muted = document.createElement('p'); muted.className = 'muted'; muted.textContent = 'No results yet.'; elements.historyList.appendChild(muted); return;
  }

  state.history.forEach((entry) => {
    const card = document.createElement('article'); card.className = 'history-item';
    const badge = document.createElement('p'); badge.className = 'history-badge'; badge.textContent = modeLabelMap[entry.mode] || 'Result';
    const value = document.createElement('p'); value.textContent = entry.text;
    const detail = document.createElement('p'); detail.textContent = entry.detail;
    const meta = document.createElement('div'); meta.className = 'history-meta';
    const time = document.createElement('span'); time.className = 'muted'; time.textContent = formatTimestamp(entry.timestamp);
    const copyBtn = document.createElement('button'); copyBtn.type = 'button'; copyBtn.textContent = 'Copy';
    copyBtn.addEventListener('click', async () => setStatus(await copyText(entry.text) ? 'History item copied.' : 'Unable to copy history item.'));
    meta.append(time, copyBtn);
    card.append(badge, value, detail, meta);
    elements.historyList.appendChild(card);
  });
};

const pushHistory = (mode, text, detail) => {
  state.history = [{ id: getRandomId(), mode, text, detail, timestamp: Date.now() }, ...state.history].slice(0, MAX_HISTORY_ITEMS);
  saveHistory();
  renderHistory();
  refreshStats();
};

const renderPresets = () => {
  if (!elements.presetList) return;
  elements.presetList.innerHTML = '';
  if (!state.presets.length) {
    const muted = document.createElement('p'); muted.className = 'muted'; muted.textContent = 'No presets yet.'; elements.presetList.appendChild(muted); return;
  }

  state.presets.forEach((preset) => {
    const card = document.createElement('article'); card.className = 'preset-item';
    const title = document.createElement('h3'); title.textContent = preset.name;
    const detail = document.createElement('p'); detail.textContent = `${modeLabelMap[preset.settings?.mode] || 'Roulette'} · ${engineLabelMap[preset.settings?.engine] || engineLabelMap.crypto}`;
    const actions = document.createElement('div'); actions.className = 'preset-actions';

    const useBtn = document.createElement('button'); useBtn.type = 'button'; useBtn.textContent = 'Use';
    useBtn.addEventListener('click', () => {
      state.settings = deepMergeSettings(defaultSettings, preset.settings || {});
      state.rouletteState = deepMergeRouletteState(defaultRouletteState, preset.rouletteState || {});
      state.rngCache = null;
      applySettingsToInputs();
      saveSettings(); saveRouletteState();
      setStatus(`Preset "${preset.name}" applied.`);
      setRouletteMessage(`Preset "${preset.name}" applied.`);
    });

    const deleteBtn = document.createElement('button'); deleteBtn.type = 'button'; deleteBtn.textContent = 'Delete';
    deleteBtn.addEventListener('click', () => {
      state.presets = state.presets.filter((item) => item.id !== preset.id);
      savePresets();
      renderPresets();
      setStatus(`Preset "${preset.name}" removed.`);
    });

    actions.append(useBtn, deleteBtn);
    card.append(title, detail, actions);
    elements.presetList.appendChild(card);
  });
};

const setMode = (mode, { persist = true } = {}) => {
  const normalized = modeLabelMap[mode] ? mode : 'roulette';
  state.mode = normalized;
  elements.modeTabs.forEach((tab) => {
    const active = tab.dataset.mode === normalized;
    tab.classList.toggle('is-active', active);
    tab.setAttribute('aria-selected', String(active));
  });
  elements.modePanels.forEach((panel) => { panel.hidden = panel.dataset.modePanel !== normalized; });
  if (elements.resultHeading) elements.resultHeading.textContent = normalized === 'roulette' ? 'Round log' : 'Result';
  if (persist) { state.settings.mode = normalized; saveSettings(); }
  updateRouletteControlState();
};

const applySettingsToInputs = () => {
  const settings = state.settings;
  const roulette = settings.roulette;
  if (elements.engineSelect) elements.engineSelect.value = settings.engine;
  if (elements.seedInput) elements.seedInput.value = settings.seed;
  if (elements.wheelTypeSelect) elements.wheelTypeSelect.value = roulette.wheelType;
  if (elements.rouletteStrategySelect) elements.rouletteStrategySelect.value = roulette.strategy;
  if (elements.rouletteBiasSelect) elements.rouletteBiasSelect.value = roulette.bias;
  if (elements.rouletteColorPayoutInput) elements.rouletteColorPayoutInput.value = roulette.colorPayout;
  if (elements.rouletteGreenPayoutInput) elements.rouletteGreenPayoutInput.value = roulette.greenPayout;
  if (elements.spinDurationInput) elements.spinDurationInput.value = roulette.spinDuration;
  if (elements.spinLoopsInput) elements.spinLoopsInput.value = roulette.spinLoops;
  if (elements.instantResultSelect) elements.instantResultSelect.value = roulette.instant;
  if (elements.rouletteSoundSelect) elements.rouletteSoundSelect.value = roulette.sound;
  if (elements.autoSpinCountInput) elements.autoSpinCountInput.value = roulette.autoSpinCount;
  if (elements.autoSpinDelayInput) elements.autoSpinDelayInput.value = roulette.autoSpinDelay;
  if (elements.numberMin) elements.numberMin.value = settings.number.min;
  if (elements.numberMax) elements.numberMax.value = settings.number.max;
  if (elements.numberCount) elements.numberCount.value = settings.number.count;
  if (elements.numberDecimals) elements.numberDecimals.value = settings.number.decimals;
  if (elements.numberUnique) elements.numberUnique.value = settings.number.unique ? 'on' : 'off';
  if (elements.numberSort) elements.numberSort.value = settings.number.sort;
  if (elements.listItems) elements.listItems.value = settings.list.items;
  if (elements.listCount) elements.listCount.value = settings.list.count;
  if (elements.listUnique) elements.listUnique.value = settings.list.unique ? 'on' : 'off';
  if (elements.listUseWeights) elements.listUseWeights.value = settings.list.useWeights ? 'on' : 'off';
  if (elements.coinCount) elements.coinCount.value = settings.coin.count;
  if (elements.diceCount) elements.diceCount.value = settings.dice.count;
  if (elements.diceSides) elements.diceSides.value = settings.dice.sides;
  if (elements.diceModifier) elements.diceModifier.value = settings.dice.modifier;

  renderRouletteHud();
  setMode(settings.mode, { persist: false });
  drawRouletteWheel();
};

const syncSettingsFromInputs = () => {
  const previousEngine = state.settings.engine;
  const previousSeed = state.settings.seed;

  state.settings = {
    ...state.settings,
    engine: ['crypto', 'seeded', 'math'].includes(elements.engineSelect?.value) ? elements.engineSelect.value : 'crypto',
    seed: String(elements.seedInput?.value || '').trim(),
    roulette: {
      wheelType: ['classic', 'european', 'american'].includes(elements.wheelTypeSelect?.value) ? elements.wheelTypeSelect.value : 'european',
      strategy: ['flat', 'martingale', 'reverse-martingale', 'dalembert'].includes(elements.rouletteStrategySelect?.value) ? elements.rouletteStrategySelect.value : 'flat',
      bias: ['none', 'red', 'black', 'green'].includes(elements.rouletteBiasSelect?.value) ? elements.rouletteBiasSelect.value : 'none',
      colorPayout: clampNumber(elements.rouletteColorPayoutInput?.value, 1, 100, 2),
      greenPayout: clampNumber(elements.rouletteGreenPayoutInput?.value, 1, 1000, 14),
      spinDuration: Math.trunc(clampNumber(elements.spinDurationInput?.value, 400, 10000, 2600)),
      spinLoops: Math.trunc(clampNumber(elements.spinLoopsInput?.value, 1, 12, 5)),
      instant: ['auto', 'off', 'on'].includes(elements.instantResultSelect?.value) ? elements.instantResultSelect.value : 'auto',
      sound: ['off', 'on'].includes(elements.rouletteSoundSelect?.value) ? elements.rouletteSoundSelect.value : 'off',
      autoSpinCount: Math.trunc(clampNumber(elements.autoSpinCountInput?.value, 1, 500, 12)),
      autoSpinDelay: Math.trunc(clampNumber(elements.autoSpinDelayInput?.value, 150, 10000, 700))
    },
    number: { min: clampNumber(elements.numberMin?.value, -1_000_000_000, 1_000_000_000, 1), max: clampNumber(elements.numberMax?.value, -1_000_000_000, 1_000_000_000, 100), count: Math.trunc(clampNumber(elements.numberCount?.value, 1, 100, 1)), decimals: Math.trunc(clampNumber(elements.numberDecimals?.value, 0, 6, 0)), unique: elements.numberUnique?.value === 'on', sort: ['none', 'asc', 'desc'].includes(elements.numberSort?.value) ? elements.numberSort.value : 'none' },
    list: { items: String(elements.listItems?.value || ''), count: Math.trunc(clampNumber(elements.listCount?.value, 1, 100, 1)), unique: elements.listUnique?.value === 'on', useWeights: elements.listUseWeights?.value === 'on' },
    coin: { count: Math.trunc(clampNumber(elements.coinCount?.value, 1, 500, 1)) },
    dice: { count: Math.trunc(clampNumber(elements.diceCount?.value, 1, 30, 2)), sides: Math.trunc(clampNumber(elements.diceSides?.value, 2, 1000, 6)), modifier: Math.trunc(clampNumber(elements.diceModifier?.value, -10000, 10000, 0)) }
  };

  if (previousEngine !== state.settings.engine || previousSeed !== state.settings.seed) state.rngCache = null;
  saveSettings();
  maybeUnlockAccess();
  updateBetOptionState();
  drawRouletteWheel();
  refreshStats();
};
const setBetAmount = (value, { setBase = false } = {}) => {
  const balanceCap = Math.max(1, Math.floor(state.rouletteState.balance || 1));
  const normalized = Math.floor(clampNumber(value, 1, balanceCap, state.rouletteState.betAmount || 1));
  state.rouletteState.betAmount = normalized;
  if (setBase) state.rouletteState.baseBet = normalized;
  if (elements.betAmountInput) elements.betAmountInput.value = String(normalized);
};

const syncRouletteInputsToState = ({ setBase = false } = {}) => {
  const parsed = clampNumber(elements.betAmountInput?.value, 1, 1_000_000_000, state.rouletteState.betAmount || 1);
  setBetAmount(parsed, { setBase });
  saveRouletteState();
};

const shouldInstantRoulette = () => {
  const mode = state.settings.roulette.instant;
  if (mode === 'on') return true;
  if (mode === 'off') return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
};

const normalizeAngle = (angle) => { const tau = Math.PI * 2; let result = angle % tau; if (result < 0) result += tau; return result; };
const computeTargetRotation = (index, count) => { const angle = (Math.PI * 2) / count; return -Math.PI / 2 - (index * angle + angle / 2); };

const playTone = (frequency, duration = 0.05, gainAmount = 0.03) => {
  if (state.settings.roulette.sound !== 'on') return;
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    if (!state.audioCtx) state.audioCtx = new Ctx();
    const ctx = state.audioCtx;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine'; osc.frequency.value = frequency; gain.gain.value = gainAmount;
    osc.connect(gain); gain.connect(ctx.destination); osc.start(); osc.stop(ctx.currentTime + duration);
  } catch {}
};

const evaluateRouletteBet = (outcome, type) => {
  if (type === 'red') return outcome.color === 'red';
  if (type === 'black') return outcome.color === 'black';
  if (type === 'green') return outcome.color === 'green';
  if (type === 'even') return Number.isInteger(outcome.value) && outcome.value > 0 && outcome.value % 2 === 0;
  if (type === 'odd') return Number.isInteger(outcome.value) && outcome.value > 0 && outcome.value % 2 === 1;
  if (type === 'low') return Number.isInteger(outcome.value) && outcome.value >= 1 && outcome.value <= 18;
  if (type === 'high') return Number.isInteger(outcome.value) && outcome.value >= 19 && outcome.value <= 36;
  return false;
};

const getRoulettePayout = (type) => type === 'green' ? state.settings.roulette.greenPayout : state.settings.roulette.colorPayout;

const pickRouletteOutcome = () => {
  const bias = state.settings.roulette.bias;
  const segments = getRouletteSegments().map((segment, index) => ({ ...segment, index, weight: 1 }));
  if (bias !== 'none' && segments.some((segment) => segment.color === bias)) {
    segments.forEach((segment) => { if (segment.color === bias) segment.weight = 2; });
  }
  return segments[Math.max(0, pickWeightedIndex(segments))];
};

const animateRouletteSpin = (outcome) => new Promise((resolve) => {
  const count = getRouletteSegments().length;
  if (shouldInstantRoulette()) {
    state.rouletteState.rotation = computeTargetRotation(outcome.index, count) + Math.PI * 2;
    drawRouletteWheel();
    resolve();
    return;
  }

  const start = state.rouletteState.rotation;
  const base = computeTargetRotation(outcome.index, count);
  const loops = Math.trunc(clampNumber(state.settings.roulette.spinLoops, 1, 12, 5));
  const duration = Math.trunc(clampNumber(state.settings.roulette.spinDuration, 400, 10000, 2600));
  let delta = normalizeAngle(base) - normalizeAngle(start);
  if (delta <= 0) delta += Math.PI * 2;
  const target = start + delta + loops * Math.PI * 2;
  const startedAt = performance.now();

  playTone(300, 0.04, 0.025);
  const easeOut = (value) => 1 - ((1 - value) ** 3);

  const frame = (now) => {
    const progress = Math.min(1, (now - startedAt) / duration);
    state.rouletteState.rotation = start + (target - start) * easeOut(progress);
    drawRouletteWheel();
    if (progress < 1) { window.requestAnimationFrame(frame); return; }
    state.rouletteState.rotation = target;
    drawRouletteWheel();
    playTone(720, 0.06, 0.035);
    resolve();
  };
  window.requestAnimationFrame(frame);
});

const applyRouletteStrategy = (won) => {
  const strategy = state.settings.roulette.strategy;
  const base = Math.max(1, Math.floor(state.rouletteState.baseBet || 1));
  const current = Math.max(1, Math.floor(state.rouletteState.betAmount || 1));
  if (strategy === 'flat') state.rouletteState.betAmount = base;
  else if (strategy === 'martingale') state.rouletteState.betAmount = won ? base : current * 2;
  else if (strategy === 'reverse-martingale') state.rouletteState.betAmount = won ? current * 2 : base;
  else state.rouletteState.betAmount = won ? Math.max(base, current - 1) : current + 1;
};

const spinRoulette = async () => {
  if (state.spinning) return false;
  syncRouletteInputsToState();
  const betType = state.rouletteState.selectedBet;
  if (!betType) { setRouletteMessage('Choose a bet first.'); return false; }

  const wager = Math.max(1, Math.floor(state.rouletteState.betAmount || 1));
  if (wager > state.rouletteState.balance) { setRouletteMessage('Bet is higher than balance.'); return false; }

  state.rouletteState.balance -= wager;
  state.spinning = true;
  renderRouletteHud();
  setRouletteMessage('Spinning...');

  const outcome = pickRouletteOutcome();
  await animateRouletteSpin(outcome);

  state.spinning = false;
  const won = evaluateRouletteBet(outcome, betType);
  const payoutMultiplier = getRoulettePayout(betType);
  const payoutValue = won ? wager * payoutMultiplier : 0;
  const net = won ? payoutValue - wager : -wager;

  if (won) {
    state.rouletteState.balance += payoutValue;
    state.rouletteState.stats.wins += 1;
    state.rouletteState.stats.streak = Math.max(1, (state.rouletteState.stats.streak || 0) + 1);
    state.rouletteState.stats.totalReturn += payoutValue;
    setRouletteMessage(`Win! ${outcome.label} ${outcome.color.toUpperCase()} · +$${net.toFixed(2)}`);
  } else {
    state.rouletteState.stats.losses += 1;
    state.rouletteState.stats.streak = Math.min(-1, (state.rouletteState.stats.streak || 0) - 1);
    setRouletteMessage(`Loss on ${betLabelMap[betType] || betType}. ${outcome.label} ${outcome.color.toUpperCase()}.`);
  }
  state.rouletteState.stats.totalBet += wager;

  state.rouletteState.recent = [{ label: outcome.label, color: outcome.color, timestamp: Date.now() }, ...state.rouletteState.recent].slice(0, MAX_RECENT_SPINS);
  if (elements.rouletteLastOutcome) elements.rouletteLastOutcome.textContent = outcome.color.toUpperCase();
  if (elements.rouletteLanding) elements.rouletteLanding.textContent = outcome.label;

  applyRouletteStrategy(won);
  if (state.rouletteState.balance < 1) state.rouletteState.betAmount = 1;
  else if (state.rouletteState.betAmount > state.rouletteState.balance) state.rouletteState.betAmount = Math.max(1, Math.floor(state.rouletteState.balance));

  const text = `${outcome.label} ${outcome.color.toUpperCase()} · ${won ? 'WIN' : 'LOSS'}`;
  const detail = `Bet ${betLabelMap[betType] || betType} $${wager.toFixed(2)} · Net ${net >= 0 ? '+' : ''}$${net.toFixed(2)} · Balance $${state.rouletteState.balance.toFixed(2)}`;
  setResult(text, detail);
  pushHistory('roulette', text, detail);

  saveRouletteState();
  renderRouletteHud();
  return true;
};

const generateNumberMode = () => {
  const s = state.settings.number;
  const [min, max] = normalizeNumberBounds(s.min, s.max);
  let integerMin = min;
  let integerMax = max;
  if (s.decimals === 0) {
    integerMin = Math.ceil(min); integerMax = Math.floor(max);
    if (integerMin > integerMax) throw new Error('No whole numbers exist in this range.');
    if (s.unique && s.count > (integerMax - integerMin + 1)) throw new Error('Unique picks exceed available integer range.');
  }
  const values = []; const seen = new Set(); let attempts = 0;
  while (values.length < s.count && attempts < Math.max(300, s.count * 120)) {
    attempts += 1;
    const raw = s.decimals > 0 ? Number((min + getRandomSource()() * (max - min)).toFixed(s.decimals)) : randomInt(integerMin, integerMax);
    const value = Number(raw.toFixed(s.decimals));
    const key = String(value);
    if (s.unique && seen.has(key)) continue;
    seen.add(key); values.push(value);
  }
  if (values.length < s.count) throw new Error('Not enough unique values for this range and precision.');
  if (s.sort === 'asc') values.sort((a, b) => a - b);
  if (s.sort === 'desc') values.sort((a, b) => b - a);
  return { text: values.map((v) => Number(v).toFixed(s.decimals)).join(', '), detail: `${s.count} draw${s.count === 1 ? '' : 's'} in range ${min} to ${max}` };
};

const generateListMode = () => {
  const s = state.settings.list;
  const items = String(s.items || '').split('\n').map((line) => line.trim()).filter(Boolean).map((line) => {
    if (!s.useWeights) return { label: line, weight: 1 };
    const [labelPart, weightPart] = line.split('|');
    const label = String(labelPart || '').trim();
    if (!label) return null;
    const weightNum = Number(weightPart);
    return { label, weight: Number.isFinite(weightNum) && weightNum > 0 ? weightNum : 1 };
  }).filter(Boolean);

  if (!items.length) throw new Error('Add at least one list item.');
  if (s.unique && s.count > items.length) throw new Error('Unique picks exceed number of list items.');

  const picks = []; let pool = items.map((item) => ({ ...item }));
  for (let i = 0; i < s.count; i += 1) {
    const index = pickWeightedIndex(pool);
    const picked = pool[Math.max(0, index)];
    picks.push(picked.label);
    if (s.unique) pool = [...pool.slice(0, index), ...pool.slice(index + 1)];
  }

  return { text: picks.join(', '), detail: `${s.count} pick${s.count === 1 ? '' : 's'} from ${items.length} item${items.length === 1 ? '' : 's'}` };
};

const generateCoinMode = () => {
  const count = state.settings.coin.count;
  const sequence = Array.from({ length: count }, () => (randomInt(0, 1) === 0 ? 'Heads' : 'Tails'));
  const heads = sequence.filter((entry) => entry === 'Heads').length;
  const tails = count - heads;
  const preview = sequence.slice(0, 30).join(', ');
  const suffix = sequence.length > 30 ? ` (+${sequence.length - 30} more)` : '';
  return { text: `${preview}${suffix}`, detail: `${count} flip${count === 1 ? '' : 's'} · Heads ${heads} · Tails ${tails}` };
};

const generateDiceMode = () => {
  const s = state.settings.dice;
  const rolls = Array.from({ length: s.count }, () => randomInt(1, s.sides));
  const subtotal = rolls.reduce((sum, value) => sum + value, 0);
  const total = subtotal + s.modifier;
  const modifier = s.modifier === 0 ? '' : ` ${s.modifier > 0 ? '+' : '-'} ${Math.abs(s.modifier)}`;
  return { text: `Rolls: [${rolls.join(', ')}]${modifier} = ${total}`, detail: `${s.count}d${s.sides} total ${total}` };
};
const runCurrentAction = async () => {
  syncSettingsFromInputs();
  if (state.mode === 'roulette') {
    await spinRoulette();
    return;
  }

  try {
    const result = state.mode === 'number'
      ? generateNumberMode()
      : state.mode === 'list'
        ? generateListMode()
        : state.mode === 'coin'
          ? generateCoinMode()
          : generateDiceMode();
    setResult(result.text, result.detail);
    pushHistory(state.mode, result.text, result.detail);
    setStatus(`Generated ${modeLabelMap[state.mode].toLowerCase()} result.`);
  } catch (error) {
    const message = String(error?.message || 'Unable to generate result.');
    setResult(message, 'Fix inputs and try again.');
    setStatus(message);
  }
};

const startAutoSpin = async () => {
  if (state.autoSpinActive) return;
  state.autoSpinActive = true;
  renderRouletteHud();
  setRouletteMessage('Auto spin started.');

  const rounds = Math.trunc(clampNumber(state.settings.roulette.autoSpinCount, 1, 500, 12));
  const delay = Math.trunc(clampNumber(state.settings.roulette.autoSpinDelay, 150, 10000, 700));

  for (let i = 0; i < rounds; i += 1) {
    if (!state.autoSpinActive) break;
    if (state.rouletteState.balance < 1) { setRouletteMessage('Balance depleted. Auto spin stopped.'); break; }
    const spun = await spinRoulette();
    if (!spun) break;
    if (!state.autoSpinActive) break;
    await wait(delay);
  }

  state.autoSpinActive = false;
  renderRouletteHud();
};

const stopAutoSpin = () => {
  state.autoSpinActive = false;
  renderRouletteHud();
  setRouletteMessage('Auto spin stopped.');
};

const applyBalance = () => {
  const value = Math.floor(clampNumber(elements.balanceInput?.value, 1, 10_000_000, state.rouletteState.balance || 1000));
  state.rouletteState.balance = value;
  if (state.rouletteState.betAmount > value) state.rouletteState.betAmount = Math.max(1, value);
  if (state.rouletteState.baseBet > value) state.rouletteState.baseBet = Math.max(1, value);
  saveRouletteState();
  renderRouletteHud();
  setRouletteMessage(`Balance set to $${value.toFixed(2)}.`);
};

const savePreset = () => {
  syncSettingsFromInputs();
  const name = window.prompt('Preset name?');
  const trimmed = String(name || '').trim();
  if (!trimmed) return;
  state.presets = [{ id: getRandomId(), name: trimmed.slice(0, 48), createdAt: Date.now(), settings: deepMergeSettings(defaultSettings, state.settings), rouletteState: deepMergeRouletteState(defaultRouletteState, state.rouletteState) }, ...state.presets].slice(0, MAX_PRESET_ITEMS);
  savePresets();
  renderPresets();
  setStatus(`Preset "${trimmed}" saved.`);
};

const clearHistory = () => {
  if (!window.confirm('Clear all history entries?')) return;
  state.history = [];
  saveHistory();
  renderHistory();
  refreshStats();
  setStatus('History cleared.');
};

const resetRouletteSession = () => {
  if (!window.confirm('Reset bankroll, stats, and wheel history for this session?')) return;
  state.rouletteState = JSON.parse(JSON.stringify(defaultRouletteState));
  saveRouletteState();
  drawRouletteWheel();
  renderRouletteHud();
  if (elements.rouletteLastOutcome) elements.rouletteLastOutcome.textContent = '-';
  if (elements.rouletteLanding) elements.rouletteLanding.textContent = '-';
  setRouletteMessage('Session reset.');
  setResult('Session reset.', 'Roulette session reset.');
};

const wireEvents = () => {
  elements.modeTabs.forEach((tab) => tab.addEventListener('click', () => { setMode(tab.dataset.mode, { persist: true }); syncSettingsFromInputs(); setStatus(`${modeLabelMap[state.mode]} mode active.`); }));

  const reactive = [
    elements.engineSelect, elements.seedInput, elements.wheelTypeSelect, elements.rouletteStrategySelect, elements.rouletteBiasSelect, elements.rouletteColorPayoutInput, elements.rouletteGreenPayoutInput, elements.spinDurationInput, elements.spinLoopsInput, elements.instantResultSelect, elements.rouletteSoundSelect, elements.autoSpinCountInput, elements.autoSpinDelayInput,
    elements.numberMin, elements.numberMax, elements.numberCount, elements.numberDecimals, elements.numberUnique, elements.numberSort,
    elements.listItems, elements.listCount, elements.listUnique, elements.listUseWeights,
    elements.coinCount, elements.diceCount, elements.diceSides, elements.diceModifier
  ];
  reactive.forEach((input) => { if (!input) return; input.addEventListener('change', syncSettingsFromInputs); input.addEventListener('input', syncSettingsFromInputs); });

  elements.applyBalanceBtn?.addEventListener('click', applyBalance);
  elements.betAmountInput?.addEventListener('change', () => syncRouletteInputsToState({ setBase: true }));
  elements.betHalfBtn?.addEventListener('click', () => { setBetAmount(Math.floor(state.rouletteState.betAmount / 2), { setBase: true }); saveRouletteState(); renderRouletteHud(); });
  elements.betDoubleBtn?.addEventListener('click', () => { setBetAmount(Math.floor(state.rouletteState.betAmount * 2), { setBase: true }); saveRouletteState(); renderRouletteHud(); });
  elements.betMaxBtn?.addEventListener('click', () => { setBetAmount(Math.floor(Math.max(1, state.rouletteState.balance)), { setBase: true }); saveRouletteState(); renderRouletteHud(); });
  elements.betResetBtn?.addEventListener('click', () => { setBetAmount(Math.max(1, state.rouletteState.baseBet || 1), { setBase: true }); saveRouletteState(); renderRouletteHud(); });

  elements.betOptions.forEach((button) => button.addEventListener('click', () => { state.rouletteState.selectedBet = button.dataset.bet; saveRouletteState(); updateBetOptionState(); setRouletteMessage(`Betting on ${betLabelMap[button.dataset.bet] || button.dataset.bet}.`); }));

  elements.spinBtn?.addEventListener('click', async () => runCurrentAction());
  elements.autoSpinBtn?.addEventListener('click', async () => { syncSettingsFromInputs(); await startAutoSpin(); });
  elements.stopAutoBtn?.addEventListener('click', stopAutoSpin);
  elements.resetSessionBtn?.addEventListener('click', resetRouletteSession);
  elements.generateBtn?.addEventListener('click', async () => runCurrentAction());
  elements.copyResultBtn?.addEventListener('click', async () => setStatus(await copyText(String(state.lastResult || '').trim()) ? 'Result copied.' : 'Unable to copy result.'));
  elements.savePresetBtn?.addEventListener('click', savePreset);
  elements.clearHistoryBtn?.addEventListener('click', clearHistory);

  document.addEventListener('keydown', async (event) => {
    const tag = document.activeElement?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || tag === 'BUTTON') return;
    if (state.mode === 'roulette') {
      const key = event.key.toLowerCase();
      if (key === 'r') { state.rouletteState.selectedBet = 'red'; updateBetOptionState(); saveRouletteState(); setRouletteMessage('Betting on Red.'); }
      if (key === 'b') { state.rouletteState.selectedBet = 'black'; updateBetOptionState(); saveRouletteState(); setRouletteMessage('Betting on Black.'); }
      if (key === 'g' && hasGreenSegments()) { state.rouletteState.selectedBet = 'green'; updateBetOptionState(); saveRouletteState(); setRouletteMessage('Betting on Green.'); }
    }
    if (event.code === 'Space') { event.preventDefault(); await runCurrentAction(); }
  });
};

const hydrate = () => {
  state.settings = deepMergeSettings(defaultSettings, readLocalJson(SETTINGS_KEY, {}));
  state.mode = modeLabelMap[state.settings.mode] ? state.settings.mode : 'roulette';

  state.rouletteState = deepMergeRouletteState(defaultRouletteState, readLocalJson(ROULETTE_STATE_KEY, {}));
  state.rouletteState.balance = clampNumber(state.rouletteState.balance, 1, 10_000_000, 1000);
  state.rouletteState.betAmount = clampNumber(state.rouletteState.betAmount, 1, 10_000_000, 10);
  state.rouletteState.baseBet = clampNumber(state.rouletteState.baseBet, 1, 10_000_000, 10);
  state.rouletteState.rotation = Number(state.rouletteState.rotation || 0) || 0;
  if (!betLabelMap[state.rouletteState.selectedBet]) state.rouletteState.selectedBet = 'red';

  const history = readLocalJson(HISTORY_KEY, []);
  state.history = Array.isArray(history)
    ? history.filter((entry) => entry && typeof entry === 'object').map((entry) => ({ id: String(entry.id || getRandomId()), mode: modeLabelMap[entry.mode] ? entry.mode : 'roulette', text: String(entry.text || ''), detail: String(entry.detail || ''), timestamp: Number(entry.timestamp || Date.now()) })).filter((entry) => entry.text).slice(0, MAX_HISTORY_ITEMS)
    : [];

  const presets = readLocalJson(PRESETS_KEY, []);
  state.presets = Array.isArray(presets)
    ? presets.filter((entry) => entry && typeof entry === 'object').map((entry) => ({ id: String(entry.id || getRandomId()), name: String(entry.name || 'Preset').slice(0, 48), createdAt: Number(entry.createdAt || Date.now()), settings: deepMergeSettings(defaultSettings, entry.settings || {}), rouletteState: deepMergeRouletteState(defaultRouletteState, entry.rouletteState || {}) })).slice(0, MAX_PRESET_ITEMS)
    : [];
};

const init = () => {
  hydrate();
  applySettingsToInputs();
  renderHistory();
  renderPresets();
  refreshStats();
  wireEvents();
  syncSettingsFromInputs();
  setRouletteMessage('Pick a bet and spin.');
  setResult('Ready.', 'Spin to start.');
  setStatus('Ready');
};

init();
