(() => {
  const CONFIG_KEY = 'bilm-supabase-config';
  const LAST_SYNC_KEY = 'bilm-cloud-sync-at';
  const PROFILE_TABLE = 'profiles';
  const DATA_TABLE = 'user_data';
  const SYNC_KEYS = new Set([
    'bilm-continue-watching',
    'bilm-favorites',
    'bilm-watch-later',
    'bilm-search-history',
    'bilm-watch-history',
    'bilm-history-page-prefs',
    'bilm-theme-settings'
  ]);
  const SYNC_PREFIXES = ['bilm-tv-progress-'];

  const waitForSupabase = () => {
    if (window.supabase) {
      return Promise.resolve();
    }
    if (window.__bilmSupabaseLoading) {
      return window.__bilmSupabaseLoading;
    }
    window.__bilmSupabaseLoading = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2';
      script.async = true;
      script.onload = () => resolve();
      script.onerror = () => reject(new Error('Failed to load Supabase library.'));
      document.head.appendChild(script);
    });
    return window.__bilmSupabaseLoading;
  };

  const readConfig = () => {
    if (window.BILM_SUPABASE_CONFIG?.url && window.BILM_SUPABASE_CONFIG?.anonKey) {
      return window.BILM_SUPABASE_CONFIG;
    }
    try {
      const raw = localStorage.getItem(CONFIG_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed?.url || !parsed?.anonKey) return null;
      return parsed;
    } catch {
      return null;
    }
  };

  const saveConfig = (config) => {
    if (!config?.url || !config?.anonKey) return;
    const safe = { url: config.url.trim(), anonKey: config.anonKey.trim() };
    localStorage.setItem(CONFIG_KEY, JSON.stringify(safe));
  };

  const initClient = async () => {
    const config = readConfig();
    if (!config) return null;
    await waitForSupabase();
    if (!window.bilmSupabaseClient || window.bilmSupabaseClientUrl !== config.url) {
      window.bilmSupabaseClient = window.supabase.createClient(config.url, config.anonKey);
      window.bilmSupabaseClientUrl = config.url;
    }
    return window.bilmSupabaseClient;
  };

  const signInWithGoogle = async () => {
    const client = await initClient();
    if (!client) return { error: new Error('Supabase is not configured.') };
    return client.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: `${window.location.origin}/bilm/auth/`
      }
    });
  };

  const signOut = async () => {
    const client = await initClient();
    if (!client) return { error: new Error('Supabase is not configured.') };
    return client.auth.signOut();
  };

  const getProfile = async () => {
    const client = await initClient();
    if (!client) return null;
    const { data: userData } = await client.auth.getUser();
    const user = userData?.user;
    if (!user) return null;
    const { data } = await client
      .from(PROFILE_TABLE)
      .select('username, email')
      .eq('id', user.id)
      .maybeSingle();
    return {
      id: user.id,
      email: data?.email || user.email,
      username: data?.username || user.user_metadata?.username || user.email?.split('@')[0]
    };
  };

  const updateUsername = async (username) => {
    const client = await initClient();
    if (!client) return { error: new Error('Supabase is not configured.') };
    const { data: userData } = await client.auth.getUser();
    const user = userData?.user;
    if (!user) return { error: new Error('No active session.') };
    return client.from(PROFILE_TABLE).upsert({
      id: user.id,
      username,
      email: user.email
    });
  };

  const shouldSyncKey = (key) => {
    if (SYNC_KEYS.has(key)) return true;
    return SYNC_PREFIXES.some(prefix => key.startsWith(prefix));
  };

  const safeParse = (raw) => {
    if (raw == null) return null;
    try {
      return JSON.parse(raw);
    } catch {
      return raw;
    }
  };

  const collectLocalData = () => {
    const snapshot = {};
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i);
      if (!key || !shouldSyncKey(key)) continue;
      snapshot[key] = safeParse(localStorage.getItem(key));
    }
    return snapshot;
  };

  const applyLocalData = (snapshot) => {
    if (!snapshot || typeof snapshot !== 'object') return;
    Object.entries(snapshot).forEach(([key, value]) => {
      if (!shouldSyncKey(key)) return;
      if (typeof value === 'string') {
        localStorage.setItem(key, value);
      } else {
        localStorage.setItem(key, JSON.stringify(value));
      }
    });
  };

  const syncNow = async () => {
    if (window.bilmTheme?.getSettings?.().incognito) {
      return { error: new Error('Incognito mode is enabled.') };
    }
    const client = await initClient();
    if (!client) return { error: new Error('Supabase is not configured.') };
    const { data: userData } = await client.auth.getUser();
    const user = userData?.user;
    if (!user) return { error: new Error('No active session.') };

    const { data: remote } = await client
      .from(DATA_TABLE)
      .select('data, updated_at')
      .eq('user_id', user.id)
      .maybeSingle();

    const lastSync = Number(localStorage.getItem(LAST_SYNC_KEY) || 0);
    const remoteUpdatedAt = remote?.updated_at ? Date.parse(remote.updated_at) : 0;

    if (remote?.data && remoteUpdatedAt > lastSync) {
      applyLocalData(remote.data);
    }

    const snapshot = collectLocalData();
    await client.from(DATA_TABLE).upsert({
      user_id: user.id,
      data: snapshot,
      updated_at: new Date().toISOString()
    }, { onConflict: 'user_id' });

    localStorage.setItem(LAST_SYNC_KEY, `${Date.now()}`);
    return { data: snapshot };
  };

  const startAutoSync = () => {
    if (window.__bilmAutoSyncRunning) return;
    window.__bilmAutoSyncRunning = true;

    const runSync = () => {
      syncNow().catch(() => {});
    };

    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') {
        runSync();
      }
    });

    window.addEventListener('beforeunload', () => {
      runSync();
    });

    setInterval(runSync, 60000);
  };

  window.bilmAuth = {
    readConfig,
    saveConfig,
    init: initClient,
    signInWithGoogle,
    signOut,
    getProfile,
    updateUsername,
    syncNow,
    startAutoSync
  };
})();
