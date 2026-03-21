const SETTINGS_KEY = 'bilm:rng:settings:v2';
const HISTORY_KEY = 'bilm:rng:history:v2';
const PRESETS_KEY = 'bilm:rng:presets:v2';
const ACCESS_KEY = 'bilm-site-unlocked';
const ACCESS_SEED = '1001';
const MAX_HISTORY_ITEMS = 40;
const MAX_PRESET_ITEMS = 20;

const engineLabelMap = {
  crypto: 'Crypto secure',
  seeded: 'Seeded deterministic',
  math: 'Math.random'
};

const modeLabelMap = {
  number: 'Number',
  list: 'List picker',
  coin: 'Coin flip',
  dice: 'Dice'
};

const defaultSettings = {
  mode: 'number',
  engine: 'crypto',
  seed: '',
  number: {
    min: 1,
    max: 100,
    count: 1,
    decimals: 0,
    unique: false,
    sort: 'none'
  },
  list: {
    items: 'Blue team\nRed team\nGold team\nGreen team',
    count: 1,
    unique: true,
    useWeights: true
  },
  coin: {
    count: 1
  },
  dice: {
    count: 2,
    sides: 6,
    modifier: 0
  }
};

const elements = {
  status: document.getElementById('rngStatus'),
  engineSelect: document.getElementById('engineSelect'),
  seedInput: document.getElementById('seedInput'),
  savePresetBtn: document.getElementById('savePresetBtn'),
  clearHistoryBtn: document.getElementById('clearHistoryBtn'),
  generateBtn: document.getElementById('generateBtn'),
  copyResultBtn: document.getElementById('copyResultBtn'),
  resultMeta: document.getElementById('resultMeta'),
  resultOutput: document.getElementById('resultOutput'),
  historyList: document.getElementById('historyList'),
  presetList: document.getElementById('presetList'),
  statRuns: document.getElementById('statRuns'),
  statLastMode: document.getElementById('statLastMode'),
  statEngine: document.getElementById('statEngine'),
  modeTabs: Array.from(document.querySelectorAll('.mode-tab')),
  modePanels: Array.from(document.querySelectorAll('[data-mode-panel]')),
  numberMin: document.getElementById('numberMin'),
  numberMax: document.getElementById('numberMax'),
  numberCount: document.getElementById('numberCount'),
  numberDecimals: document.getElementById('numberDecimals'),
  numberUnique: document.getElementById('numberUnique'),
  numberSort: document.getElementById('numberSort'),
  listItems: document.getElementById('listItems'),
  listCount: document.getElementById('listCount'),
  listUnique: document.getElementById('listUnique'),
  listUseWeights: document.getElementById('listUseWeights'),
  coinCount: document.getElementById('coinCount'),
  diceCount: document.getElementById('diceCount'),
  diceSides: document.getElementById('diceSides'),
  diceModifier: document.getElementById('diceModifier')
};

const state = {
  settings: JSON.parse(JSON.stringify(defaultSettings)),
  history: [],
  presets: [],
  mode: defaultSettings.mode,
  rngCache: null,
  lastResult: ''
};

const safeJsonParse = (raw, fallback) => {
  try {
    const parsed = JSON.parse(raw);
    return parsed ?? fallback;
  } catch {
    return fallback;
  }
};

const readLocalJson = (key, fallback) => {
  try {
    return safeJsonParse(localStorage.getItem(key) || '', fallback);
  } catch {
    return fallback;
  }
};

const writeLocalJson = (key, value) => {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Ignore storage write failures.
  }
};

const clampNumber = (value, min, max, fallback) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.min(max, Math.max(min, numeric));
};

const deepMergeSettings = (base, patch) => ({
  ...base,
  ...patch,
  number: { ...base.number, ...(patch?.number || {}) },
  list: { ...base.list, ...(patch?.list || {}) },
  coin: { ...base.coin, ...(patch?.coin || {}) },
  dice: { ...base.dice, ...(patch?.dice || {}) }
});

const getRandomId = () => (typeof crypto !== 'undefined' && crypto.randomUUID)
  ? crypto.randomUUID()
  : `id-${Date.now()}-${Math.random().toString(16).slice(2)}`;

const copyText = async (text) => {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return true;
  }
  const temp = document.createElement('textarea');
  temp.value = text;
  temp.style.position = 'fixed';
  temp.style.opacity = '0';
  document.body.appendChild(temp);
  temp.select();
  try {
    document.execCommand('copy');
    return true;
  } catch {
    return false;
  } finally {
    temp.remove();
  }
};

const setStatus = (message) => {
  if (elements.status) elements.status.textContent = message;
};

const saveSettings = () => {
  writeLocalJson(SETTINGS_KEY, state.settings);
};

const saveHistory = () => {
  writeLocalJson(HISTORY_KEY, state.history.slice(0, MAX_HISTORY_ITEMS));
};

const savePresets = () => {
  writeLocalJson(PRESETS_KEY, state.presets.slice(0, MAX_PRESET_ITEMS));
};

const setMode = (mode, { persist = true } = {}) => {
  const normalized = modeLabelMap[mode] ? mode : 'number';
  state.mode = normalized;

  elements.modeTabs.forEach((tab) => {
    const isActive = tab.dataset.mode === normalized;
    tab.classList.toggle('is-active', isActive);
    tab.setAttribute('aria-selected', String(isActive));
  });

  elements.modePanels.forEach((panel) => {
    panel.hidden = panel.dataset.modePanel !== normalized;
  });

  if (persist) {
    state.settings.mode = normalized;
    saveSettings();
  }
};

const applySettingsToInputs = () => {
  const settings = state.settings;
  elements.engineSelect.value = settings.engine;
  elements.seedInput.value = settings.seed;
  elements.numberMin.value = settings.number.min;
  elements.numberMax.value = settings.number.max;
  elements.numberCount.value = settings.number.count;
  elements.numberDecimals.value = settings.number.decimals;
  elements.numberUnique.value = settings.number.unique ? 'on' : 'off';
  elements.numberSort.value = settings.number.sort;
  elements.listItems.value = settings.list.items;
  elements.listCount.value = settings.list.count;
  elements.listUnique.value = settings.list.unique ? 'on' : 'off';
  elements.listUseWeights.value = settings.list.useWeights ? 'on' : 'off';
  elements.coinCount.value = settings.coin.count;
  elements.diceCount.value = settings.dice.count;
  elements.diceSides.value = settings.dice.sides;
  elements.diceModifier.value = settings.dice.modifier;
  setMode(settings.mode, { persist: false });
};

const syncSettingsFromInputs = () => {
  const previousEngine = state.settings.engine;
  const previousSeed = state.settings.seed;

  state.settings = {
    ...state.settings,
    engine: ['crypto', 'seeded', 'math'].includes(elements.engineSelect.value) ? elements.engineSelect.value : 'crypto',
    seed: String(elements.seedInput.value || '').trim(),
    number: {
      min: clampNumber(elements.numberMin.value, -1_000_000_000, 1_000_000_000, 1),
      max: clampNumber(elements.numberMax.value, -1_000_000_000, 1_000_000_000, 100),
      count: Math.trunc(clampNumber(elements.numberCount.value, 1, 100, 1)),
      decimals: Math.trunc(clampNumber(elements.numberDecimals.value, 0, 6, 0)),
      unique: elements.numberUnique.value === 'on',
      sort: ['none', 'asc', 'desc'].includes(elements.numberSort.value) ? elements.numberSort.value : 'none'
    },
    list: {
      items: String(elements.listItems.value || ''),
      count: Math.trunc(clampNumber(elements.listCount.value, 1, 100, 1)),
      unique: elements.listUnique.value === 'on',
      useWeights: elements.listUseWeights.value === 'on'
    },
    coin: {
      count: Math.trunc(clampNumber(elements.coinCount.value, 1, 500, 1))
    },
    dice: {
      count: Math.trunc(clampNumber(elements.diceCount.value, 1, 30, 2)),
      sides: Math.trunc(clampNumber(elements.diceSides.value, 2, 1000, 6)),
      modifier: Math.trunc(clampNumber(elements.diceModifier.value, -10000, 10000, 0))
    }
  };

  if (previousEngine !== state.settings.engine || previousSeed !== state.settings.seed) {
    state.rngCache = null;
  }

  saveSettings();
  refreshStats();
  maybeUnlockAccess();
};

const xmur3 = (text) => {
  let hash = 1779033703 ^ text.length;
  for (let i = 0; i < text.length; i += 1) {
    hash = Math.imul(hash ^ text.charCodeAt(i), 3432918353);
    hash = (hash << 13) | (hash >>> 19);
  }
  return () => {
    hash = Math.imul(hash ^ (hash >>> 16), 2246822507);
    hash = Math.imul(hash ^ (hash >>> 13), 3266489909);
    return (hash ^= hash >>> 16) >>> 0;
  };
};

const sfc32 = (a, b, c, d) => () => {
  a >>>= 0;
  b >>>= 0;
  c >>>= 0;
  d >>>= 0;
  let t = (a + b) | 0;
  a = b ^ (b >>> 9);
  b = (c + (c << 3)) | 0;
  c = (c << 21) | (c >>> 11);
  d = (d + 1) | 0;
  t = (t + d) | 0;
  c = (c + t) | 0;
  return (t >>> 0) / 4294967296;
};

const createSeededRandom = (seedText) => {
  const seed = String(seedText || 'bilm-seed');
  const hash = xmur3(seed);
  return sfc32(hash(), hash(), hash(), hash());
};

const getRandomSource = () => {
  const engine = state.settings.engine;
  const seed = state.settings.seed;

  if (state.rngCache && state.rngCache.engine === engine && state.rngCache.seed === seed) {
    return state.rngCache.next;
  }

  let next;
  if (engine === 'seeded') {
    next = createSeededRandom(seed || 'bilm-seed');
  } else if (engine === 'crypto' && typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    next = () => {
      const buffer = new Uint32Array(1);
      crypto.getRandomValues(buffer);
      return buffer[0] / 4294967296;
    };
  } else {
    next = Math.random;
  }

  state.rngCache = { engine, seed, next };
  return next;
};

const randomInt = (min, max) => {
  const next = getRandomSource();
  return Math.floor(next() * (max - min + 1)) + min;
};

const pickWeightedIndex = (items) => {
  const total = items.reduce((sum, item) => sum + item.weight, 0);
  if (total <= 0) return -1;
  const next = getRandomSource();
  const target = next() * total;
  let running = 0;
  for (let i = 0; i < items.length; i += 1) {
    running += items[i].weight;
    if (target <= running) return i;
  }
  return items.length - 1;
};

const formatTimestamp = (timestamp) => {
  const date = new Date(timestamp);
  return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
};

const maybeUnlockAccess = () => {
  if (state.settings.seed !== ACCESS_SEED) return;
  try {
    if (localStorage.getItem(ACCESS_KEY) === 'true') return;
    localStorage.setItem(ACCESS_KEY, 'true');
  } catch {
    return;
  }
  setStatus('Access unlocked. Random Lab updated.');
};

const normalizeNumberBounds = (min, max) => (min <= max ? [min, max] : [max, min]);

const generateNumberMode = () => {
  const settings = state.settings.number;
  const [min, max] = normalizeNumberBounds(settings.min, settings.max);
  const count = settings.count;
  const decimals = settings.decimals;
  const unique = settings.unique;
  const sort = settings.sort;

  let integerMin = min;
  let integerMax = max;
  if (decimals === 0) {
    integerMin = Math.ceil(min);
    integerMax = Math.floor(max);
    if (integerMin > integerMax) {
      throw new Error('No whole numbers exist in this range.');
    }
    if (unique && count > (integerMax - integerMin + 1)) {
      throw new Error('Unique picks exceed available integer range.');
    }
  }

  const values = [];
  const seen = new Set();
  let attempts = 0;
  const maxAttempts = Math.max(300, count * 120);
  const next = getRandomSource();

  while (values.length < count && attempts < maxAttempts) {
    attempts += 1;
    const rawValue = decimals > 0
      ? Number((min + next() * (max - min)).toFixed(decimals))
      : randomInt(integerMin, integerMax);
    const value = Number(rawValue.toFixed(decimals));
    const key = String(value);
    if (unique && seen.has(key)) continue;
    seen.add(key);
    values.push(value);
  }

  if (values.length < count) {
    throw new Error('Not enough unique values for this range and precision.');
  }

  if (sort === 'asc') values.sort((a, b) => a - b);
  if (sort === 'desc') values.sort((a, b) => b - a);

  const formatValue = (value) => Number(value).toFixed(decimals);
  const text = values.map(formatValue).join(', ');
  const detail = `${count} draw${count === 1 ? '' : 's'} in range ${min} to ${max}${decimals > 0 ? ` (${decimals} decimals)` : ''}`;

  return { text, detail };
};

const parseListItems = () => {
  const useWeights = state.settings.list.useWeights;
  const rawLines = String(state.settings.list.items || '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  return rawLines.map((line) => {
    if (!useWeights) return { label: line, weight: 1 };
    const [labelPart, weightPart] = line.split('|');
    const label = String(labelPart || '').trim();
    if (!label) return null;
    const parsedWeight = Number(weightPart);
    const weight = Number.isFinite(parsedWeight) && parsedWeight > 0 ? parsedWeight : 1;
    return { label, weight };
  }).filter(Boolean);
};

const generateListMode = () => {
  const settings = state.settings.list;
  const items = parseListItems();
  const count = settings.count;
  const unique = settings.unique;

  if (!items.length) {
    throw new Error('Add at least one list item.');
  }
  if (unique && count > items.length) {
    throw new Error('Unique picks exceed number of list items.');
  }

  const picks = [];
  let pool = items.map((item) => ({ ...item }));

  for (let i = 0; i < count; i += 1) {
    const index = pickWeightedIndex(pool);
    if (index < 0) throw new Error('Unable to pick from weighted list.');
    const picked = pool[index];
    picks.push(picked.label);
    if (unique) {
      pool = [...pool.slice(0, index), ...pool.slice(index + 1)];
    }
  }

  return {
    text: picks.join(', '),
    detail: `${count} pick${count === 1 ? '' : 's'} from ${items.length} item${items.length === 1 ? '' : 's'}`
  };
};

const generateCoinMode = () => {
  const count = state.settings.coin.count;
  const sequence = Array.from({ length: count }, () => (randomInt(0, 1) === 0 ? 'Heads' : 'Tails'));
  const heads = sequence.filter((item) => item === 'Heads').length;
  const tails = sequence.length - heads;

  const preview = sequence.slice(0, 24).join(', ');
  const suffix = sequence.length > 24 ? ` (+${sequence.length - 24} more)` : '';

  return {
    text: `${preview}${suffix}`,
    detail: `${count} flip${count === 1 ? '' : 's'} · Heads ${heads} · Tails ${tails}`
  };
};

const generateDiceMode = () => {
  const settings = state.settings.dice;
  const rolls = Array.from({ length: settings.count }, () => randomInt(1, settings.sides));
  const subtotal = rolls.reduce((sum, value) => sum + value, 0);
  const total = subtotal + settings.modifier;
  const modifierText = settings.modifier === 0 ? '' : ` ${settings.modifier > 0 ? '+' : '-'} ${Math.abs(settings.modifier)}`;

  return {
    text: `Rolls: [${rolls.join(', ')}]${modifierText} = ${total}`,
    detail: `${settings.count}d${settings.sides} total ${total}`
  };
};

const runCurrentMode = () => {
  if (state.mode === 'number') return generateNumberMode();
  if (state.mode === 'list') return generateListMode();
  if (state.mode === 'coin') return generateCoinMode();
  if (state.mode === 'dice') return generateDiceMode();
  throw new Error('Unsupported mode');
};

const pushHistory = (result) => {
  const entry = {
    id: getRandomId(),
    mode: state.mode,
    text: result.text,
    detail: result.detail,
    timestamp: Date.now()
  };
  state.history = [entry, ...state.history].slice(0, MAX_HISTORY_ITEMS);
  saveHistory();
};

const refreshStats = () => {
  if (elements.statRuns) elements.statRuns.textContent = String(state.history.length);
  if (elements.statLastMode) {
    elements.statLastMode.textContent = state.history[0] ? modeLabelMap[state.history[0].mode] : '-';
  }
  if (elements.statEngine) {
    elements.statEngine.textContent = engineLabelMap[state.settings.engine] || engineLabelMap.crypto;
  }
};

const renderHistory = () => {
  if (!elements.historyList) return;
  elements.historyList.innerHTML = '';

  if (!state.history.length) {
    const muted = document.createElement('p');
    muted.className = 'muted';
    muted.textContent = 'No results yet.';
    elements.historyList.appendChild(muted);
    return;
  }

  state.history.forEach((entry) => {
    const card = document.createElement('article');
    card.className = 'history-item';

    const badge = document.createElement('p');
    badge.className = 'history-badge';
    badge.textContent = modeLabelMap[entry.mode] || 'Result';

    const value = document.createElement('p');
    value.textContent = entry.text;

    const detail = document.createElement('p');
    detail.textContent = entry.detail;

    const meta = document.createElement('div');
    meta.className = 'history-meta';

    const time = document.createElement('span');
    time.className = 'muted';
    time.textContent = formatTimestamp(entry.timestamp);

    const copyBtn = document.createElement('button');
    copyBtn.type = 'button';
    copyBtn.textContent = 'Copy';
    copyBtn.addEventListener('click', async () => {
      const ok = await copyText(entry.text);
      setStatus(ok ? 'History item copied.' : 'Unable to copy history item.');
    });

    meta.append(time, copyBtn);
    card.append(badge, value, detail, meta);
    elements.historyList.appendChild(card);
  });
};

const renderPresets = () => {
  if (!elements.presetList) return;
  elements.presetList.innerHTML = '';

  if (!state.presets.length) {
    const muted = document.createElement('p');
    muted.className = 'muted';
    muted.textContent = 'No presets yet.';
    elements.presetList.appendChild(muted);
    return;
  }

  state.presets.forEach((preset) => {
    const card = document.createElement('article');
    card.className = 'preset-item';

    const title = document.createElement('h3');
    title.textContent = preset.name;

    const detail = document.createElement('p');
    const modeName = modeLabelMap[preset.settings?.mode] || 'Number';
    const engineName = engineLabelMap[preset.settings?.engine] || engineLabelMap.crypto;
    detail.textContent = `${modeName} · ${engineName}`;

    const actions = document.createElement('div');
    actions.className = 'preset-actions';

    const useBtn = document.createElement('button');
    useBtn.type = 'button';
    useBtn.textContent = 'Use';
    useBtn.addEventListener('click', () => {
      state.settings = deepMergeSettings(defaultSettings, preset.settings || {});
      state.rngCache = null;
      applySettingsToInputs();
      saveSettings();
      refreshStats();
      maybeUnlockAccess();
      setStatus(`Preset "${preset.name}" applied.`);
    });

    const deleteBtn = document.createElement('button');
    deleteBtn.type = 'button';
    deleteBtn.textContent = 'Delete';
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

const renderResult = (result) => {
  if (elements.resultOutput) elements.resultOutput.textContent = result.text;
  if (elements.resultMeta) elements.resultMeta.textContent = result.detail;
  state.lastResult = result.text;
};

const generate = () => {
  syncSettingsFromInputs();
  try {
    const result = runCurrentMode();
    renderResult(result);
    pushHistory(result);
    renderHistory();
    refreshStats();
    setStatus(`Generated ${modeLabelMap[state.mode].toLowerCase()} result.`);
  } catch (error) {
    const message = String(error?.message || 'Unable to generate result.');
    if (elements.resultOutput) elements.resultOutput.textContent = message;
    if (elements.resultMeta) elements.resultMeta.textContent = 'Fix inputs and try again.';
    setStatus(message);
  }
};

const savePreset = () => {
  syncSettingsFromInputs();
  const name = window.prompt('Preset name?');
  const trimmed = String(name || '').trim();
  if (!trimmed) return;

  const entry = {
    id: getRandomId(),
    name: trimmed.slice(0, 48),
    createdAt: Date.now(),
    settings: deepMergeSettings(defaultSettings, state.settings)
  };
  state.presets = [entry, ...state.presets].slice(0, MAX_PRESET_ITEMS);
  savePresets();
  renderPresets();
  setStatus(`Preset "${entry.name}" saved.`);
};

const clearHistory = () => {
  if (!window.confirm('Clear all RNG history?')) return;
  state.history = [];
  saveHistory();
  renderHistory();
  refreshStats();
  setStatus('History cleared.');
};

const copyCurrentResult = async () => {
  const text = String(state.lastResult || '').trim();
  if (!text) {
    setStatus('Generate a result first.');
    return;
  }
  const ok = await copyText(text);
  setStatus(ok ? 'Result copied.' : 'Unable to copy result.');
};

const wireEvents = () => {
  elements.modeTabs.forEach((tab) => {
    tab.addEventListener('click', () => {
      setMode(tab.dataset.mode, { persist: true });
      syncSettingsFromInputs();
    });
  });

  const reactiveInputs = [
    elements.engineSelect,
    elements.seedInput,
    elements.numberMin,
    elements.numberMax,
    elements.numberCount,
    elements.numberDecimals,
    elements.numberUnique,
    elements.numberSort,
    elements.listItems,
    elements.listCount,
    elements.listUnique,
    elements.listUseWeights,
    elements.coinCount,
    elements.diceCount,
    elements.diceSides,
    elements.diceModifier
  ];

  reactiveInputs.forEach((input) => {
    if (!input) return;
    input.addEventListener('change', syncSettingsFromInputs);
    input.addEventListener('input', syncSettingsFromInputs);
  });

  elements.generateBtn?.addEventListener('click', generate);
  elements.copyResultBtn?.addEventListener('click', copyCurrentResult);
  elements.savePresetBtn?.addEventListener('click', savePreset);
  elements.clearHistoryBtn?.addEventListener('click', clearHistory);

  document.addEventListener('keydown', (event) => {
    if (event.code !== 'Space') return;
    const tag = document.activeElement?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || tag === 'BUTTON') return;
    event.preventDefault();
    generate();
  });
};

const hydrate = () => {
  const settings = readLocalJson(SETTINGS_KEY, {});
  state.settings = deepMergeSettings(defaultSettings, settings);
  state.mode = modeLabelMap[state.settings.mode] ? state.settings.mode : 'number';

  const history = readLocalJson(HISTORY_KEY, []);
  state.history = Array.isArray(history)
    ? history
      .filter((entry) => entry && typeof entry === 'object')
      .map((entry) => ({
        id: String(entry.id || getRandomId()),
        mode: modeLabelMap[entry.mode] ? entry.mode : 'number',
        text: String(entry.text || ''),
        detail: String(entry.detail || ''),
        timestamp: Number(entry.timestamp || Date.now())
      }))
      .filter((entry) => entry.text)
      .slice(0, MAX_HISTORY_ITEMS)
    : [];

  const presets = readLocalJson(PRESETS_KEY, []);
  state.presets = Array.isArray(presets)
    ? presets
      .filter((entry) => entry && typeof entry === 'object')
      .map((entry) => ({
        id: String(entry.id || getRandomId()),
        name: String(entry.name || 'Preset'),
        createdAt: Number(entry.createdAt || Date.now()),
        settings: deepMergeSettings(defaultSettings, entry.settings || {})
      }))
      .slice(0, MAX_PRESET_ITEMS)
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
  setStatus('Ready');
};

init();
