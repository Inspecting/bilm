(() => {
  const canvas = document.getElementById('wheel');
  const ctx = canvas.getContext('2d');
  const betInput = document.getElementById('betInput');
  const halfBtn = document.getElementById('halfBtn');
  const doubleBtn = document.getElementById('doubleBtn');
  const maxBtn = document.getElementById('maxBtn');
  const clearBtn = document.getElementById('clearBtn');
  const betRedBtn = document.getElementById('betRed');
  const betBlackBtn = document.getElementById('betBlack');
  const betGreenBtn = document.getElementById('betGreen');
  const spinBtn = document.getElementById('spinBtn');
  const autoSpinBtn = document.getElementById('autoSpinBtn');
  const resetBtn = document.getElementById('resetBtn');
  const messageEl = document.getElementById('message');
  const lastOutcomeEl = document.getElementById('lastOutcome');
  const landingIndexEl = document.getElementById('landingIndex');
  const balanceDisplay = document.getElementById('balanceDisplay');
  const historyEl = document.getElementById('history');
  const statWinsEl = document.getElementById('statWins');
  const statLossesEl = document.getElementById('statLosses');
  const statRateEl = document.getElementById('statRate');
  const statStreakEl = document.getElementById('statStreak');
  const statRoiEl = document.getElementById('statRoi');

  const practiceBalanceInput = document.getElementById('practiceBalanceInput');
  const applyBalanceBtn = document.getElementById('applyBalanceBtn');

  const wheelTypeSelect = document.getElementById('wheelType');
  const payoutInput = document.getElementById('payoutInput');
  const greenPayoutInput = document.getElementById('greenPayoutInput');
  const rngModeSelect = document.getElementById('rngMode');
  const seedInput = document.getElementById('seedInput');
  const biasSelect = document.getElementById('biasSelect');
  const spinDurationInput = document.getElementById('spinDuration');
  const spinLoopsInput = document.getElementById('spinLoops');
  const instantSelect = document.getElementById('instantSelect');
  const soundSelect = document.getElementById('soundSelect');
  const autoSpinCountInput = document.getElementById('autoSpinCount');
  const autoSpinDelayInput = document.getElementById('autoSpinDelay');
  const strategySelect = document.getElementById('strategySelect');
  const colorRedInput = document.getElementById('colorRed');
  const colorBlackInput = document.getElementById('colorBlack');
  const colorGreenInput = document.getElementById('colorGreen');
  const colorAccentInput = document.getElementById('colorAccent');

  const STORAGE_KEY = 'rng-lab-settings';
  const STATE_KEY = 'rng-lab-state';

  let balance = 1000;
  let bet = 10;
  let selectedColor = null;
  let spinning = false;
  let rotation = 0;
  let history = [];
  let stats = {wins:0, losses:0, streak:0, totalBet:0, totalReturn:0};
  let autoSpinActive = false;
  let seededRng = null;

  const defaultSettings = {
    wheelType: 'classic',
    payout: 2,
    greenPayout: 14,
    rngMode: 'secure',
    seed: '',
    bias: 'none',
    spinDuration: 2600,
    spinLoops: 5,
    instant: 'auto',
    sound: 'off',
    autoSpinCount: 10,
    autoSpinDelay: 700,
    strategy: 'flat',
    colors: {
      red: '#e24b4b',
      black: '#111827',
      green: '#18a05e',
      accent: '#ffbf00'
    }
  };

  let settings = {...defaultSettings};

  function loadState(){
    const stored = JSON.parse(localStorage.getItem(STATE_KEY) || '{}');
    if (stored.balance) balance = stored.balance;
    if (stored.bet) bet = stored.bet;
    if (stored.history) history = stored.history;
    if (stored.stats) stats = stored.stats;
  }

  function saveState(){
    localStorage.setItem(STATE_KEY, JSON.stringify({balance, bet, history, stats}));
  }

  function loadSettings(){
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    settings = {...defaultSettings, ...stored, colors: {...defaultSettings.colors, ...(stored.colors || {})}};
  }

  function saveSettings(){
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  }

  function applySettings(){
    wheelTypeSelect.value = settings.wheelType;
    payoutInput.value = settings.payout;
    greenPayoutInput.value = settings.greenPayout;
    rngModeSelect.value = settings.rngMode;
    seedInput.value = settings.seed;
    biasSelect.value = settings.bias;
    spinDurationInput.value = settings.spinDuration;
    spinLoopsInput.value = settings.spinLoops;
    instantSelect.value = settings.instant;
    soundSelect.value = settings.sound;
    autoSpinCountInput.value = settings.autoSpinCount;
    autoSpinDelayInput.value = settings.autoSpinDelay;
    strategySelect.value = settings.strategy;
    colorRedInput.value = settings.colors.red;
    colorBlackInput.value = settings.colors.black;
    colorGreenInput.value = settings.colors.green;
    colorAccentInput.value = settings.colors.accent;

    document.documentElement.style.setProperty('--red', settings.colors.red);
    document.documentElement.style.setProperty('--black', settings.colors.black);
    document.documentElement.style.setProperty('--green', settings.colors.green);
    document.documentElement.style.setProperty('--accent', settings.colors.accent);
  }

  function setMessage(t){ messageEl.textContent = t; }

  function getSegments(){
    const base = Array.from({length: 36}, (_, i) => ({
      color: i % 2 === 0 ? 'red' : 'black',
      label: `${i+1}`
    }));
    if (settings.wheelType === 'classic') return base;
    if (settings.wheelType === 'european') return [{color:'green', label:'0'}, ...base];
    return [{color:'green', label:'0'}, {color:'green', label:'00'}, ...base];
  }

  function getRng(){
    if (settings.rngMode === 'seeded') {
      if (!seededRng || seededRng.seed !== settings.seed) {
        const seed = settings.seed || String(Date.now());
        let h = 1779033703 ^ seed.length;
        for (let i = 0; i < seed.length; i++) {
          h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
          h = (h << 13) | (h >>> 19);
        }
        const a = (h >>> 0) + 0x6D2B79F5;
        let t = a;
        seededRng = {
          seed: settings.seed,
          next: () => {
            t += 0x6D2B79F5;
            let r = t;
            r = Math.imul(r ^ (r >>> 15), r | 1);
            r ^= r + Math.imul(r ^ (r >>> 7), r | 61);
            return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
          }
        };
      }
      return seededRng.next;
    }
    if (settings.rngMode === 'secure') {
      return () => {
        const buf = new Uint32Array(1);
        crypto.getRandomValues(buf);
        return buf[0] / 4294967296;
      };
    }
    return () => Math.random();
  }

  function biasedPick(options){
    if (settings.bias === 'none') {
      return options[Math.floor(rng() * options.length)];
    }
    const favored = settings.bias;
    const pool = options.flatMap(opt => opt.color === favored ? [opt, opt] : [opt]);
    return pool[Math.floor(rng() * pool.length)];
  }

  function computeTargetRotation(index, segCount){
    const anglePer = (Math.PI*2)/segCount;
    const segCenter = index*anglePer + anglePer/2;
    return -Math.PI/2 - segCenter;
  }

  function shouldInstant(){
    if (settings.instant === 'on') return true;
    if (settings.instant === 'off') return false;
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  function playTick(){
    if (settings.sound !== 'on') return;
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = 540;
      gain.gain.value = 0.05;
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.04);
    } catch (err) {
      // Audio blocked
    }
  }

  function drawWheel(){
    const segments = getSegments();
    const segCount = segments.length;
    const cx = canvas.width / 2;
    const cy = canvas.height / 2;
    const radius = 240;
    ctx.clearRect(0,0,canvas.width,canvas.height);
    const anglePer = (Math.PI*2)/segCount;
    segments.forEach((seg, i) => {
      const start = rotation + i*anglePer;
      ctx.beginPath();
      ctx.moveTo(cx,cy);
      ctx.arc(cx,cy,radius,start,start+anglePer);
      ctx.closePath();
      if (seg.color === 'red') ctx.fillStyle = settings.colors.red;
      if (seg.color === 'black') ctx.fillStyle = settings.colors.black;
      if (seg.color === 'green') ctx.fillStyle = settings.colors.green;
      ctx.fill();

      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(start + anglePer/2);
      ctx.fillStyle = 'rgba(255,255,255,0.75)';
      ctx.font = '12px Inter, system-ui';
      ctx.textAlign = 'right';
      ctx.fillText(seg.label, radius - 16, 4);
      ctx.restore();
    });

    ctx.beginPath();
    ctx.moveTo(cx,cy-radius-12);
    ctx.lineTo(cx-12,cy-radius+16);
    ctx.lineTo(cx+12,cy-radius+16);
    ctx.closePath();
    ctx.fillStyle = '#fff';
    ctx.fill();
  }

  function updateHistory(outcome){
    history.unshift(outcome);
    history = history.slice(0, 12);
    historyEl.innerHTML = '';
    history.forEach(item => {
      const span = document.createElement('span');
      span.textContent = item.label;
      span.style.background = item.color === 'red' ? settings.colors.red : (item.color === 'black' ? settings.colors.black : settings.colors.green);
      span.style.color = item.color === 'black' ? '#f1f5f9' : '#081219';
      historyEl.appendChild(span);
    });
  }

  function updateStats(won, betAmount, payout){
    if (!betAmount) {
      statWinsEl.textContent = stats.wins;
      statLossesEl.textContent = stats.losses;
      const total = stats.wins + stats.losses;
      const rate = total ? (stats.wins / total) * 100 : 0;
      const roi = stats.totalBet ? ((stats.totalReturn - stats.totalBet) / stats.totalBet) * 100 : 0;
      statRateEl.textContent = `${rate.toFixed(1)}%`;
      statStreakEl.textContent = stats.streak;
      statRoiEl.textContent = `${roi.toFixed(1)}%`;
      return;
    }
    if (won) {
      stats.wins += 1;
      stats.streak = Math.max(1, stats.streak + 1);
      stats.totalReturn += betAmount * payout;
    } else {
      stats.losses += 1;
      stats.streak = Math.min(-1, stats.streak - 1);
    }
    stats.totalBet += betAmount;
    const total = stats.wins + stats.losses;
    const rate = total ? (stats.wins / total) * 100 : 0;
    const roi = stats.totalBet ? ((stats.totalReturn - stats.totalBet) / stats.totalBet) * 100 : 0;
    statWinsEl.textContent = stats.wins;
    statLossesEl.textContent = stats.losses;
    statRateEl.textContent = `${rate.toFixed(1)}%`;
    statStreakEl.textContent = stats.streak;
    statRoiEl.textContent = `${roi.toFixed(1)}%`;
  }

  function updateUI(){
    balanceDisplay.textContent = balance.toFixed(2);
    betInput.value = bet;
    betRedBtn.classList.toggle('selected', selectedColor==='red');
    betBlackBtn.classList.toggle('selected', selectedColor==='black');
    betGreenBtn.classList.toggle('selected', selectedColor==='green');
    betGreenBtn.disabled = settings.wheelType === 'classic';
    practiceBalanceInput.value = balance;
  }

  function adjustBetAfterSpin(won){
    const strategy = settings.strategy;
    if (strategy === 'flat') return;
    if (strategy === 'martingale') {
      bet = won ? Math.max(1, Math.floor(bet / 2)) : Math.min(balance, bet * 2);
      return;
    }
    if (strategy === 'reverse-martingale') {
      bet = won ? Math.min(balance, bet * 2) : Math.max(1, Math.floor(bet / 2));
      return;
    }
    if (strategy === 'dalembert') {
      bet = won ? Math.max(1, bet - 1) : Math.min(balance, bet + 1);
    }
  }

  function spinToOutcome(outcome, onDone){
    spinning = true;
    const segments = getSegments();
    const segCount = segments.length;
    const chosenIndex = outcome.index;
    const baseTarget = computeTargetRotation(chosenIndex, segCount);
    const loops = Math.max(1, Number(settings.spinLoops) || 1);
    const extraRot = loops * Math.PI*2;
    const target = baseTarget + extraRot;
    const start = rotation;
    const startTime = performance.now();
    const duration = Math.max(300, Number(settings.spinDuration) || 2500);
    function ease(t){return 1-Math.pow(1-t,3);}
    function frame(now){
      const p=Math.min(1,(now-startTime)/duration);
      rotation=start+(target-start)*ease(p);
      drawWheel();
      if (p < 1) {
        if (p > 0.1) playTick();
        requestAnimationFrame(frame);
      } else {
        rotation=target;
        drawWheel();
        spinning=false;
        onDone();
      }
    }
    requestAnimationFrame(frame);
  }

  function pickOutcome(){
    const segments = getSegments();
    const indexed = segments.map((seg, index) => ({...seg, index}));
    return biasedPick(indexed);
  }

  function spin(){
    if (spinning) return;
    if (!selectedColor){setMessage('Select a color first!');return;}
    bet = Math.max(1, Number(betInput.value) || 1);
    if (bet > balance){setMessage('Bet too high!');return;}
    balance -= bet;
    updateUI();
    setMessage('Spinning...');

    const outcome = pickOutcome();
    const instant = shouldInstant();

    const resolve = () => {
      const won = selectedColor === outcome.color;
      const payout = outcome.color === 'green' ? Number(settings.greenPayout) : Number(settings.payout);
      if (won) {
        balance += bet * payout;
        setMessage(`You WON — ${outcome.label} ${outcome.color.toUpperCase()}! +$${(bet * payout).toFixed(2)}`);
      } else {
        setMessage(`You lost — ${outcome.label} ${outcome.color.toUpperCase()}.`);
      }
      lastOutcomeEl.textContent = outcome.color.toUpperCase();
      landingIndexEl.textContent = outcome.label;
      updateHistory(outcome);
      updateStats(won, bet, payout);
      adjustBetAfterSpin(won);
      updateUI();
      saveState();
    };

    if (instant) {
      const segments = getSegments();
      rotation = computeTargetRotation(outcome.index, segments.length) + Math.PI*2;
      drawWheel();
      spinning = false;
      resolve();
      return;
    }

    spinToOutcome(outcome, resolve);
  }

  async function runAutoSpin(){
    if (autoSpinActive) return;
    autoSpinActive = true;
    autoSpinBtn.classList.add('active');
    const spins = Math.max(1, Number(settings.autoSpinCount) || 1);
    const delay = Math.max(100, Number(settings.autoSpinDelay) || 500);
    for (let i = 0; i < spins; i++) {
      if (!autoSpinActive) break;
      if (balance <= 0) {
        setMessage('Balance depleted. Auto spin stopped.');
        break;
      }
      spin();
      await new Promise(resolve => setTimeout(resolve, delay + settings.spinDuration));
    }
    autoSpinActive = false;
    autoSpinBtn.classList.remove('active');
  }

  function stopAutoSpin(){
    autoSpinActive = false;
    autoSpinBtn.classList.remove('active');
  }

  function bindSettings(){
    const handler = () => {
      settings = {
        ...settings,
        wheelType: wheelTypeSelect.value,
        payout: Number(payoutInput.value) || defaultSettings.payout,
        greenPayout: Number(greenPayoutInput.value) || defaultSettings.greenPayout,
        rngMode: rngModeSelect.value,
        seed: seedInput.value,
        bias: biasSelect.value,
        spinDuration: Number(spinDurationInput.value) || defaultSettings.spinDuration,
        spinLoops: Number(spinLoopsInput.value) || defaultSettings.spinLoops,
        instant: instantSelect.value,
        sound: soundSelect.value,
        autoSpinCount: Number(autoSpinCountInput.value) || defaultSettings.autoSpinCount,
        autoSpinDelay: Number(autoSpinDelayInput.value) || defaultSettings.autoSpinDelay,
        strategy: strategySelect.value,
        colors: {
          red: colorRedInput.value,
          black: colorBlackInput.value,
          green: colorGreenInput.value,
          accent: colorAccentInput.value
        }
      };
      saveSettings();
      applySettings();
      drawWheel();
      updateUI();
    };

    [wheelTypeSelect, payoutInput, greenPayoutInput, rngModeSelect, seedInput, biasSelect,
      spinDurationInput, spinLoopsInput, instantSelect, soundSelect, autoSpinCountInput,
      autoSpinDelayInput, strategySelect, colorRedInput, colorBlackInput, colorGreenInput, colorAccentInput]
      .forEach(el => el.addEventListener('change', handler));
  }

  let rng = getRng();

  function refreshRng(){
    rng = getRng();
  }

  spinBtn.onclick = () => {refreshRng(); spin();};
  autoSpinBtn.onclick = () => {refreshRng(); autoSpinActive ? stopAutoSpin() : runAutoSpin();};
  betRedBtn.onclick = () => {selectedColor='red';updateUI();setMessage('Betting on RED');};
  betBlackBtn.onclick = () => {selectedColor='black';updateUI();setMessage('Betting on BLACK');};
  betGreenBtn.onclick = () => {selectedColor='green';updateUI();setMessage('Betting on GREEN');};
  halfBtn.onclick = () => {bet=Math.max(1,Math.floor(bet/2));updateUI();};
  doubleBtn.onclick = () => {bet=Math.min(balance,Math.floor(bet*2));updateUI();};
  maxBtn.onclick = () => {bet=Math.max(1,Math.floor(balance));updateUI();};
  clearBtn.onclick = () => {bet=1;updateUI();};
  resetBtn.onclick = () => {
    balance=1000;bet=10;selectedColor=null;stats={wins:0,losses:0,streak:0,totalBet:0,totalReturn:0};history=[];
    localStorage.removeItem(STATE_KEY);
    updateHistory({label:'—', color:'black'});
    setMessage('Session reset.');
    updateStats(false,0,0);
    updateUI();
  };

  applyBalanceBtn.onclick = () => {
    const val = Math.max(1, Number(practiceBalanceInput.value) || 1000);
    balance = val;
    updateUI();
    setMessage(`Practice balance set to $${balance}`);
    saveState();
  };

  document.addEventListener('keydown', (event) => {
    if (event.target.tagName === 'INPUT' || event.target.tagName === 'SELECT') return;
    if (event.code === 'Space') {
      event.preventDefault();
      spin();
    }
    if (event.key.toLowerCase() === 'r') betRedBtn.click();
    if (event.key.toLowerCase() === 'b') betBlackBtn.click();
    if (event.key.toLowerCase() === 'g') betGreenBtn.click();
  });

  loadSettings();
  loadState();
  applySettings();
  bindSettings();
  refreshRng();
  drawWheel();
  updateHistory({label:'—', color:'black'});
  updateStats(false,0,0);
  updateUI();
})();
