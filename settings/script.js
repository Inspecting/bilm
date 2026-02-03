  const accentPresets = ['#a855f7', '#c084fc', '#7c3aed', '#ec4899', '#38bdf8'];
  const accentPicker = document.getElementById('accentPicker');
  const backgroundSelect = document.getElementById('backgroundSelect');
  const motionToggle = document.getElementById('motionToggle');
  const particleToggle = document.getElementById('particleToggle');
  const serverSelect = document.getElementById('serverSelect');
  const resetThemeBtn = document.getElementById('resetThemeBtn');
  const resetDataBtn = document.getElementById('resetDataBtn');
  const presetsContainer = document.getElementById('accentPresets');
  const supportedServers = ['vidsrc', 'godrive', 'multiembed'];

  function applySettings(partial) {
    const current = window.bilmTheme?.getSettings?.() || {};
    window.bilmTheme?.setSettings?.({ ...current, ...partial });
  }

  function syncUI() {
    const settings = window.bilmTheme?.getSettings?.() || {};
    accentPicker.value = settings.accent || '#a855f7';
    backgroundSelect.value = settings.background || 'deep';
    motionToggle.checked = settings.motion !== false;
    particleToggle.checked = settings.particles !== false;
    const preferredServer = settings.defaultServer || 'vidsrc';
    serverSelect.value = supportedServers.includes(preferredServer) ? preferredServer : 'vidsrc';
  }

  accentPresets.forEach(color => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'preset-btn';
    btn.style.background = color;
    btn.setAttribute('aria-label', `Set accent to ${color}`);
    btn.addEventListener('click', () => {
      accentPicker.value = color;
      applySettings({ accent: color });
    });
    presetsContainer.appendChild(btn);
  });

  accentPicker.addEventListener('input', (event) => {
    applySettings({ accent: event.target.value });
  });

  backgroundSelect.addEventListener('change', (event) => {
    applySettings({ background: event.target.value });
  });

  motionToggle.addEventListener('change', (event) => {
    applySettings({ motion: event.target.checked });
  });

  particleToggle.addEventListener('change', (event) => {
    applySettings({ particles: event.target.checked });
  });

  serverSelect.addEventListener('change', (event) => {
    applySettings({ defaultServer: event.target.value });
  });

  resetThemeBtn.addEventListener('click', () => {
    if (!confirm('Reset theme to the default purple style?')) return;
    window.bilmTheme?.resetTheme?.();
    syncUI();
  });

  resetDataBtn.addEventListener('click', () => {
    const confirmReset = confirm('⚠️ This will erase all saved site data on your device. Continue?');
    if (!confirmReset) return;

    try {
      localStorage.clear();
      sessionStorage.clear();

      document.cookie.split(';').forEach(cookie => {
        const eqPos = cookie.indexOf('=');
        const name = eqPos > -1 ? cookie.slice(0, eqPos).trim() : cookie.trim();
        document.cookie = `${name}=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=/`;
      });

      alert('✅ Site data cleared. Reloading fresh.');
      location.reload();
    } catch (err) {
      console.error('Error clearing data:', err);
      alert('❌ Something went wrong while clearing data.');
    }
  });

  window.addEventListener('DOMContentLoaded', syncUI);
  window.addEventListener('bilm:theme-changed', syncUI);
