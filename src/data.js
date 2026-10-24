// Data layer: MockBackend (localStorage, empty, this device only) and SupabaseBackend (vendored supabase-js, email code / link, RLS).
// Both expose: init(), user, signIn(email), verifyCode(email, code), signOut(), load() -> {items, completions},
//              addCompletion(itemId, doneOn), removeCompletion(id), addItem(item), updateItem(id, patch), onChange(cb)
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : 'id-' + Date.now() + '-' + Math.random().toString(16).slice(2));
const ITEMS = 'care_items', DONE = 'care_completions', AUTH_KEY = 'care-auth';

export class MockBackend {
  constructor(key = 'care.mock.v1') { this.key = key; this.kind = 'mock'; this.user = { email: 'local mock (this device only)' }; this.cbs = []; }
  async init() {
    try { this.db = JSON.parse(localStorage.getItem(this.key) || 'null'); } catch { this.db = null; }
    this.db ||= { items: [], completions: [] }; this.save();
    window.addEventListener('storage', (e) => { if (e.key === this.key && e.newValue) { this.db = JSON.parse(e.newValue); this.cbs.forEach((f) => f()); } });
    return true;
  }
  save() { localStorage.setItem(this.key, JSON.stringify(this.db)); }
  async signIn() {} async verifyCode() {} async signOut() {}
  async load() { return structuredClone(this.db); }
  async addCompletion(item_id, done_on, note = null) { const c = { id: uid(), item_id, done_on, note, created_at: new Date().toISOString() }; this.db.completions.push(c); this.save(); return c; }
  async removeCompletion(id) { this.db.completions = this.db.completions.filter((c) => c.id !== id); this.save(); }
  async addItem(item) { const t = { id: uid(), active: true, optional: false, sort_order: 0, created_at: new Date().toISOString(), ...item }; this.db.items.push(t); this.save(); return t; }
  async updateItem(id, patch) { const t = this.db.items.find((x) => x.id === id); if (!t) throw new Error('Item not found'); Object.assign(t, patch); this.save(); return t; }
  onChange(cb) { this.cbs.push(cb); }
  reset() { localStorage.removeItem(this.key); }
}

export class SupabaseBackend {
  constructor(url, anonKey) { this.url = url; this.anonKey = anonKey; this.kind = 'supabase'; this.user = null; }
  async init() {
    const { createClient } = await loadSupabase();
    // own storage key, so signing in or out here doesn't affect other apps on the same site
    this.sb = createClient(this.url, this.anonKey, { auth: { persistSession: true, detectSessionInUrl: true, flowType: 'pkce', storageKey: AUTH_KEY } });
    const h = new URLSearchParams(location.hash.slice(1));
    if (h.get('access_token') && h.get('refresh_token')) {
      await this.sb.auth.setSession({ access_token: h.get('access_token'), refresh_token: h.get('refresh_token') });
      history.replaceState(null, '', location.pathname + location.search);
    }
    const { data, error } = await this.sb.auth.getSession();
    this.user = data.session?.user || null;
    if (!this.user && error) this.user = savedSessionUser();   // offline with an expired token: carry on with cached data
    this.sb.auth.onAuthStateChange((_e, s) => { const was = !!this.user; this.user = s?.user || null; if (was !== !!this.user) location.reload(); });
    return !!this.user;
  }
  async signIn(email) {
    const { error } = await this.sb.auth.signInWithOtp({ email, options: { emailRedirectTo: location.origin + location.pathname, shouldCreateUser: true } });
    if (error) throw error;
  }
  async verifyCode(email, token) { const { error } = await this.sb.auth.verifyOtp({ email, token, type: 'email' }); if (error) throw error; }
  async signOut() { await this.sb.auth.signOut(); }
  async q(p) { const { data, error } = await p; if (error) throw error; return data; }
  async load() {
    const [items, completions] = await Promise.all([
      this.q(this.sb.from(ITEMS).select('*').order('sort_order')),
      this.q(this.sb.from(DONE).select('*').order('done_on')),
    ]);
    return { items, completions };
  }
  async addCompletion(item_id, done_on, note = null) { return this.q(this.sb.from(DONE).insert({ owner_id: this.user?.id, item_id, done_on, note }).select().single()); }
  async removeCompletion(id) { await this.q(this.sb.from(DONE).delete().eq('id', id)); }
  // care_items.category arrives with a database update; until then save without it (and say so)
  async withCategory(row, fn) {
    try { return await this.q(fn(row)); } catch (err) {
      if (!('category' in row) || !/category/.test(err.message || '') || !/column|schema cache/i.test(err.message || '')) throw err;
      const { category, ...rest } = row; const res = await this.q(fn(rest)); return { ...res, categorySkipped: true };
    }
  }
  async addItem(item) { return this.withCategory({ id: uid(), owner_id: this.user?.id, active: true, ...item }, (r) => this.sb.from(ITEMS).insert(r).select().single()); }
  async updateItem(id, patch) { return this.withCategory(patch, (r) => this.sb.from(ITEMS).update(r).eq('id', id).select().single()); }
  onChange(cb) {
    const ch = this.sb.channel('care');
    [ITEMS, DONE].forEach((table) => ch.on('postgres_changes', { event: '*', schema: 'public', table }, () => cb()));
    ch.subscribe();
  }
}

function loadSupabase() {
  if (window.supabase?.createClient) return Promise.resolve(window.supabase);
  return new Promise((ok, ko) => {
    const s = document.createElement('script'); s.src = new URL('../vendor/supabase.js?v=2', import.meta.url).href;
    s.onload = () => (window.supabase?.createClient ? ok(window.supabase) : ko(new Error('supabase-js did not load')));
    s.onerror = () => ko(new Error('Could not load supabase-js (offline?)'));
    document.head.appendChild(s);
  });
}
function savedSessionUser() {
  try { const v = JSON.parse(localStorage.getItem(AUTH_KEY) || 'null'); return v?.user || v?.currentSession?.user || null; } catch { return null; }
}

export function makeBackend(cfg = window.CARE_CONFIG || {}) {
  const filled = cfg.supabaseUrl && !cfg.supabaseUrl.includes('YOUR-') && cfg.supabaseAnonKey && !cfg.supabaseAnonKey.includes('YOUR-');
  const mode = new URLSearchParams(location.search).get('backend') || cfg.backend || 'auto';
  if (mode === 'supabase' || (mode === 'auto' && filled)) return new SupabaseBackend(cfg.supabaseUrl, cfg.supabaseAnonKey);
  return new MockBackend();
}
