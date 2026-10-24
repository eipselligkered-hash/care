import { status, fmtDate, whenText, CADENCES, CADENCE_LABEL, CADENCE_CHIP, SOON_DAYS, nowByCategory, allByCategory, dueChip, catOf, categoryOrder, CAT_OTHER } from './due.js?v=2';
import { makeBackend } from './data.js?v=2';

const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const params = new URLSearchParams(location.search);
const localToday = () => params.get('today') || new Date().toLocaleDateString('en-CA');   // YYYY-MM-DD, device time zone
const DASH = 'https://supabase.com/dashboard/project/rwbiizjwvyssdyxjuqan';

const be = makeBackend();
const state = { tab: params.get('tab') === 'all' ? 'all' : 'now', db: null, conn: '' };

// ---------- loading, offline cache, connection problems
let loadSeq = 0;
async function refresh() {
  const n = ++loadSeq; let db;
  try {
    if (be.kind !== 'mock' && !navigator.onLine) throw new Error('offline');
    db = await Promise.race([be.load(), new Promise((_, ko) => setTimeout(() => ko(new Error('Timed out reaching the database')), 15000))]);
  } catch (err) {
    if (n === loadSeq) { state.conn = connProblem(err); if (state.db) render(); else renderUnreachable(); }
    throw err;
  }
  if (n !== loadSeq) return;
  state.db = db; state.conn = ''; saveCache(db); render();
}
const isNetErr = (err) => !navigator.onLine || /failed to fetch|networkerror|load failed|network|offline|fetch/i.test(String(err?.message || err));
const connProblem = (err) => (!navigator.onLine ? 'offline' : /jwt|token|not authenticated|auth session/i.test(String(err?.message || err)) ? 'auth' : 'unreachable');
const errMsg = (err) => (isNetErr(err) ? 'You’re offline or the database can’t be reached – not saved. Try again later.' : `Couldn’t save – ${err?.message || err}`);
const offlineNow = () => be.kind !== 'mock' && !navigator.onLine;
function connMessage() {
  if (state.conn === 'offline') return `<b>You’re offline</b> – showing what was saved on this device. Changes can’t be saved until you’re back online.`;
  if (state.conn === 'auth') return `<b>Your sign-in has expired.</b> <button type="button" class="link" data-relogin>Sign in again</button>`;
  return `<b>Can’t reach the database</b> – it may be paused (the free plan pauses after a week unused). Restore it at <a href="${DASH}" target="_blank" rel="noopener">supabase.com</a>, then tap Retry.`;
}
const connBanner = () => (state.conn && state.conn !== 'updating' ? `<div class="banner conn" role="alert"><span>${connMessage()}</span><button type="button" class="ghost" data-retry>Retry</button></div>` : '');
function renderUnreachable() {
  if (!state.conn || state.conn === 'updating') state.conn = navigator.onLine ? 'unreachable' : 'offline';
  $('#today').textContent = fmtDate(localToday(), { long: true });
  $('#view').innerHTML = `<div class="card conn-card" role="alert"><p>${connMessage()}</p><button type="button" class="primary wide" data-retry>Retry</button></div>`;
}
const cacheKey = () => (be.kind === 'supabase' && be.user?.id ? `care.cache.v1.${be.user.id}` : null);
function saveCache(db) { const k = cacheKey(); if (k) try { localStorage.setItem(k, JSON.stringify({ saved_at: new Date().toISOString(), db })); } catch { /* full */ } }
function readCache() { const k = cacheKey(); try { return k ? JSON.parse(localStorage.getItem(k) || 'null') : null; } catch { return null; } }
const clearCaches = () => Object.keys(localStorage).filter((k) => k.startsWith('care.cache.')).forEach((k) => localStorage.removeItem(k));
async function retry() {
  if (!be.ready) return location.reload();
  state.conn = 'updating'; if (state.db) render(); else $('#view').innerHTML = '<p class="empty">Loading…</p>';
  refresh().catch(console.error);
}
const fail = (err) => { console.error(err); if (state.db) render(); toast(errMsg(err)); refresh().catch(() => {}); };
const safe = (fn) => async (...a) => { try { return await fn(...a); } catch (err) { fail(err); } };
const itemOf = (id) => state.db?.items.find((x) => x.id === id);

// ---------- actions
const busy = new Set();
async function markDone(id, day) {
  const it = itemOf(id); if (!it || busy.has(id)) return;
  if (offlineNow()) return fail(new Error('offline'));
  if (state.db.completions.some((c) => c.item_id === id && c.done_on === day)) { render(); return toast(`Already done ${fmtDate(day)}`); }
  busy.add(id);
  try {
    const c = await be.addCompletion(id, day);
    await refresh();
    toast(`Done${day === localToday() ? '' : ' ' + fmtDate(day)} – ${it.title}`, async () => { await be.removeCompletion(c.id); await refresh(); toast('Undone'); });
    if ($('#item-sheet').open) openItem(id);
  } catch (err) { fail(err); } finally { busy.delete(id); }
}
const undoCompletion = safe(async (cid, id) => {
  if (offlineNow()) throw new Error('offline');
  await be.removeCompletion(cid); await refresh(); toast('Undone'); if ($('#item-sheet').open) openItem(id);
});

let toastTimer;
function toast(msg, undo) {
  const t = $('#toast'); clearTimeout(toastTimer);
  t.innerHTML = `<span>${esc(msg)}</span>${undo ? '<button id="undo">Undo</button>' : ''}`;
  t.hidden = false;
  if (undo) $('#undo').onclick = async () => { t.hidden = true; await safe(undo)(); };
  toastTimer = setTimeout(() => (t.hidden = true), 6000);
}

// ---------- rendering
const chipHtml = (c) => (c ? `<span class="chip c-${c.cls}">${esc(c.text)}</span>` : '');
const cadChip = (it) => (it.cadence !== 'after_use' ? `<span class="chip c-cad">${esc(CADENCE_CHIP[it.cadence])}</span>` : '');
const chip = (r) => chipHtml(dueChip(r));
function row(r, { tick = true } = {}) {
  const canTick = tick && !['done', 'reference', 'inactive'].includes(r.state);
  return `<div class="item ${r.state === 'done' || r.state === 'inactive' ? 'muted-row' : ''}" data-id="${esc(r.item.id)}">
    ${canTick ? `<button class="tick" data-act="done" aria-label="Done today: ${esc(r.item.title)}">✓</button>` : ''}
    <div class="body" role="button" tabindex="0"><div class="name">${esc(r.item.title)}</div>
      <div class="meta">${chip(r)}${cadChip(r.item)}</div></div></div>`;
}
const list = (rows, o) => `<div class="list">${rows.map((r) => row(r, o)).join('')}</div>`;
const refList = (rows) => `<div class="ref"><ul>${rows.map((r) =>
  `<li data-id="${esc(r.item.id)}" role="button" tabindex="0"><b>${esc(r.item.title)}</b>${r.item.details ? `<span>${esc(r.item.details)}</span>` : ''}</li>`).join('')}</ul></div>`;
// open/closed state of every fold is remembered on this device (categories default open, the rest closed)
const foldState = (() => { try { return JSON.parse(localStorage.getItem('care.folds') || '{}'); } catch { return {}; } })();
const fold = (key, title, note, body, { open = false, cls = '' } = {}) =>
  `<details class="fold ${cls}" data-fold="${esc(key)}" ${(foldState[key] ?? open) ? 'open' : ''}><summary><span>${esc(title)}</span><small>${esc(note)}</small></summary>${body}</details>`;

function renderNow() {
  const v = nowByCategory(state.db.items, state.db.completions, localToday());
  let h = `<p class="summary-line">${v.due ? `${v.due} due` : 'Nothing due'}${v.soon ? ` · ${v.soon} in the next ${SOON_DAYS} days` : ''}</p>`;
  if (!v.cats.length) h += `<p class="calm">Nothing due or coming up. All good.</p>`;
  for (const c of v.cats) h += fold(`now:${c.category}`, c.category, String(c.rows.length), list(c.rows), { open: true, cls: 'cat' });
  if (v.optional.length) h += fold('now:optional', 'Optional', `${v.optional.length} · only if it applies`, list(v.optional), { cls: 'cat quiet' });
  return h;
}
function renderAll() {
  const g = allByCategory(state.db.items, state.db.completions, localToday());
  let h = `<div class="toolbar"><button class="ghost" data-add>+ Add item</button></div>`;
  for (const c of g.cats) {
    const body = c.cadences.map((k) => `<h3 class="cad">${esc(k.label)}${k.cadence === 'after_use' ? ' <small>notes</small>' : k.rows.every((r) => r.optional) ? ' <small>optional</small>' : ''}</h3>`
      + (k.cadence === 'after_use' ? refList(k.rows) : list(k.rows))).join('');
    h += fold(`all:${c.category}`, c.category, String(c.count), body, { open: true, cls: 'cat' });
  }
  if (g.inactive.length) h += fold('all:archived', 'Archived', String(g.inactive.length), list(g.inactive, { tick: false }), { cls: 'cat quiet' });
  if (!state.db.items.length) h += `<p class="empty">No items yet. Tap + Add item.</p>`;
  return h;
}
function render() {
  const today = localToday();
  $('#today').textContent = fmtDate(today, { long: true }) + (be.kind === 'mock' ? ' · local mock' : '') + (state.conn === 'updating' ? ' · updating…' : '');
  $('#account').textContent = '⚙';
  document.querySelectorAll('.tabs button').forEach((b) => b.setAttribute('aria-selected', b.dataset.tab === state.tab));
  const y = scrollY;
  $('#view').innerHTML = connBanner() + (state.tab === 'all' ? renderAll() : renderNow());
  document.querySelectorAll('#view details.fold').forEach((d) => d.addEventListener('toggle', () => { foldState[d.dataset.fold] = d.open; localStorage.setItem('care.folds', JSON.stringify(foldState)); }));
  scrollTo(0, y);
}

// ---------- sign-in (email code, or the link in the same email)
function renderLogin(msg = '', sentTo = '') {
  $('#today').textContent = fmtDate(localToday(), { long: true });
  $('#view').innerHTML = `<div class="card login"><h2>Sign in</h2><p class="muted">We’ll email you a sign-in code – no password needed.</p>
    <form id="login"><input type="email" id="email" required placeholder="you@example.com" autocomplete="email" value="${esc(sentTo)}"><button class="${sentTo ? 'ghost wide' : 'primary'}">${sentTo ? 'Send again' : 'Send sign-in email'}</button></form>
    ${sentTo ? `<form id="code-form"><label class="field">Code from the email <input id="code" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6,10}" maxlength="10" required placeholder="6-digit code"></label>
      <button class="primary wide">Sign in</button></form><p class="muted small">Or open the link in the email on this device.</p>` : ''}
    <p class="${/Could not|wrong|expired|invalid/i.test(msg) ? 'err' : ''}">${esc(msg)}</p></div>`;
  $('#login').onsubmit = async (e) => {
    e.preventDefault(); const email = $('#email').value.trim();
    try { await be.signIn(email); renderLogin(`Email sent to ${email}.`, email); $('#code')?.focus(); } catch (err) { renderLogin('Could not send: ' + err.message, sentTo); }
  };
  const cf = $('#code-form');
  if (cf) cf.onsubmit = async (e) => {
    e.preventDefault(); const code = $('#code').value.replace(/\s+/g, '');
    try { await be.verifyCode(sentTo, code); location.reload(); }
    catch (err) { renderLogin(/expired|invalid/i.test(err.message) ? 'That code is wrong or has expired – check the latest email, or send a new one.' : 'Could not sign in: ' + err.message, sentTo); }
  };
}

// ---------- item sheet
const linkify = (s) => esc(s).replace(/https?:\/\/[^\s<]+[^\s<.,;)]/g, (u) => `<a href="${u}" target="_blank" rel="noopener noreferrer">${u.replace(/^https?:\/\/(www\.)?/, '')}</a>`).replace(/\n/g, '<br>');
function openItem(id) {
  const it = itemOf(id); if (!it) return;
  const today = localToday(), r = status(it, state.db.completions, today), d = $('#item-sheet');
  const hist = state.db.completions.filter((c) => c.item_id === id).sort((a, b) => b.done_on.localeCompare(a.done_on)).slice(0, 5);
  const tickable = !['reference', 'inactive'].includes(r.state);
  d.innerHTML = `<div class="sheet-head"><h2>${esc(it.title)}</h2><button type="button" class="x" data-close aria-label="Close">✕</button></div>
    <div class="big-meta">${chip(r)}<span class="chip c-cad">${esc(CADENCE_LABEL[it.cadence] || '')}</span><span class="chip c-cat">${esc(catOf(it))}</span>${!['reference', 'done'].includes(r.state) ? `<span>${esc(whenText(r))}</span>` : ''}
      ${it.cadence === 'once' && it.due_date ? `<span>Date ${fmtDate(it.due_date)}</span>` : ''}</div>
    ${it.details ? `<div class="howto">${linkify(it.details)}</div>` : ''}
    ${tickable ? `<div class="row-btns"><button type="button" class="primary" data-done-today>✓ Done today</button></div>
      <div class="pick"><label class="field">Pick a date <input type="date" id="pick-date" value="${today}" max="${today}"></label><button type="button" class="ghost" data-done-pick>Save</button></div>` : ''}
    ${it.cadence !== 'after_use' ? `<h3>Last done</h3>${hist.length ? `<ul class="hist">${hist.map((c) => `<li><span>${fmtDate(c.done_on)}</span><button type="button" class="link" data-undo="${esc(c.id)}">Undo</button></li>`).join('')}</ul>` : '<p class="muted small">Not yet.</p>'}` : ''}
    <button type="button" class="ghost wide" data-edit>✎ Edit</button>`;
  d.onclick = (e) => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.close !== undefined) return d.close();
    if (b.dataset.doneToday !== undefined) return markDone(id, localToday());
    if (b.dataset.donePick !== undefined) { const v = $('#pick-date', d).value; if (!v) return toast('Pick a date'); if (v > localToday()) return toast('That date is in the future'); return markDone(id, v); }
    if (b.dataset.undo) return undoCompletion(b.dataset.undo, id);
    if (b.dataset.edit !== undefined) { d.close(); return openEdit(it); }
  };
  if (!d.open) d.showModal();
}

// ---------- add / edit
function catPicker(it) {
  const cats = categoryOrder(state.db.items).filter((c) => c !== CAT_OTHER), cur = it.category?.trim() || '';
  return `<label class="field">Category <select id="e-cat">${cats.map((c) => `<option value="${esc(c)}" ${c === cur ? 'selected' : ''}>${esc(c)}</option>`).join('')}
      <option value="" ${cur ? '' : 'selected'}>${CAT_OTHER} (none)</option><option value="__new">+ New category…</option></select></label>
    <label class="field" id="e-cat-new-wrap">New category <input id="e-cat-new" maxlength="60"></label>`;
}
function openEdit(it) {
  const d = $('#edit-sheet'), isNew = !it; it ||= { title: '', details: '', cadence: 'monthly', optional: false, due_date: null, active: true };
  d.innerHTML = `<form id="edit-form" novalidate><div class="sheet-head"><h2>${isNew ? 'Add item' : 'Edit item'}</h2><button type="button" class="x" data-close aria-label="Close">✕</button></div>
    <label class="field">Title <input id="e-title" required maxlength="200" value="${esc(it.title)}"></label>
    <label class="field">Details <textarea id="e-details" rows="3">${esc(it.details || '')}</textarea></label>
    ${catPicker(it)}
    <label class="field">How often <select id="e-cadence">${CADENCES.map((c) => `<option value="${c}" ${c === it.cadence ? 'selected' : ''}>${CADENCE_LABEL[c]}</option>`).join('')}</select></label>
    <label class="field" id="e-due-wrap">Date (one-off) <input type="date" id="e-due" value="${esc(it.due_date || '')}"></label>
    <label class="toggle"><input type="checkbox" id="e-opt" ${it.optional ? 'checked' : ''}> Optional (never shown as due)</label>
    ${isNew ? '' : `<label class="toggle"><input type="checkbox" id="e-active" ${it.active !== false ? 'checked' : ''}> Active (untick to archive)</label>`}
    <p class="err" id="e-err"></p>
    <div class="row-btns"><button type="button" class="ghost" data-close>Cancel</button><button class="primary">Save</button></div></form>`;
  const cad = $('#e-cadence', d), dueWrap = $('#e-due-wrap', d);
  const sync = () => { dueWrap.hidden = cad.value !== 'once'; }; cad.onchange = sync; sync();
  const cs = $('#e-cat', d), cn = $('#e-cat-new-wrap', d); cs.onchange = () => { cn.hidden = cs.value !== '__new'; if (!cn.hidden) $('#e-cat-new', d).focus(); }; cs.onchange();
  d.querySelectorAll('[data-close]').forEach((b) => (b.onclick = () => d.close()));
  $('#edit-form', d).onsubmit = async (e) => {
    e.preventDefault();
    const title = $('#e-title', d).value.trim(); if (!title) { $('#e-err', d).textContent = 'Give it a title.'; return; }
    const catSel = $('#e-cat', d), category = catSel.value === '__new' ? $('#e-cat-new', d).value.trim() || null : catSel.value || null;
    const patch = { category, title, details: $('#e-details', d).value.trim() || null, cadence: cad.value, optional: $('#e-opt', d).checked,
      due_date: cad.value === 'once' ? $('#e-due', d).value || null : null };
    if (!isNew) patch.active = $('#e-active', d).checked;
    if (offlineNow()) { $('#e-err', d).textContent = errMsg(new Error('offline')); return; }
    // keep the category order stable: a new or moved item goes to the end of its category (a new category goes last)
    if (isNew || catOf(it) !== catOf(patch)) {
      const inCat = state.db.items.filter((x) => x.id !== it.id && catOf(x) === catOf(patch)).map((x) => x.sort_order || 0);
      patch.sort_order = Math.max(0, ...(inCat.length ? inCat : state.db.items.map((x) => x.sort_order || 0))) + 10;
    }
    let res;
    try { res = isNew ? await be.addItem(patch) : await be.updateItem(it.id, patch); }
    catch (err) { $('#e-err', d).textContent = errMsg(err); return; }
    d.close(); await refresh().catch(() => {});
    toast(res?.categorySkipped ? 'Saved – the category needs the database update first' : isNew ? 'Added' : 'Saved');
  };
  d.showModal(); if (isNew) $('#e-title', d).focus();
}

// ---------- settings
async function downloadBackup() {
  let db = state.db, note = '';
  try { db = await be.load(); } catch { note = ' (from the copy on this device – offline)'; }
  const data = { app: 'care', format: 1, exported_at: new Date().toISOString(), account: be.user?.email || null, items: db.items, completions: db.completions };
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 1)], { type: 'application/json' }));
  a.download = `care-backup-${new Date().toLocaleDateString('en-CA')}.json`; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  toast(`Backup saved: ${a.download}${note}`);
}
function openSettings() {
  const d = $('#settings');
  d.innerHTML = `<div class="sheet-head"><h2>Settings</h2><button type="button" class="x" data-close aria-label="Close">✕</button></div>
    <h3>Backup</h3><p class="muted small">A file with all your items and dates. Keep it somewhere private.</p>
    <button type="button" class="ghost wide" id="backup" ${state.db ? '' : 'disabled'}>⬇ Download backup</button>
    <h3>Account</h3><p class="muted small">${be.kind === 'mock' ? 'Local mock data (this device only).' : `Signed in as ${esc(be.user?.email || '')}`}</p>
    <button type="button" class="ghost wide" id="acct">${be.kind === 'mock' ? 'Reset mock data' : 'Sign out'}</button>
    <p class="muted small">Add to Home Screen: Safari → Share → Add to Home Screen; Chrome → ⋮ → Install app.</p>`;
  $('[data-close]', d).onclick = () => d.close();
  $('#backup', d).onclick = downloadBackup;
  $('#acct', d).onclick = async () => {
    if (be.kind === 'mock') { if (confirm('Reset the local mock data?')) { be.reset(); location.reload(); } return; }
    if (confirm('Sign out on this device?')) { clearCaches(); await be.signOut().catch(() => {}); location.reload(); }
  };
  if (!d.open) d.showModal();
}

// ---------- events
const view = $('#view');
view.addEventListener('click', async (e) => {
  const b = e.target.closest('button');
  if (b?.dataset.retry !== undefined) return retry();
  if (b?.dataset.relogin !== undefined) { clearCaches(); await be.signOut().catch(() => {}); return location.reload(); }
  if (!state.db) return;
  if (b?.dataset.add !== undefined) return openEdit(null);
  const host = e.target.closest('[data-id]'); if (!host) return;
  if (b?.dataset.act === 'done') { b.classList.add('done'); return markDone(host.dataset.id, localToday()); }
  if (!b || b.closest('.body')) return openItem(host.dataset.id);
});
view.addEventListener('keydown', (e) => { if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('[role=button]')) { e.preventDefault(); e.target.click(); } });
document.querySelectorAll('.tabs button').forEach((b) => (b.onclick = () => { state.tab = b.dataset.tab; $('#toast').hidden = true; if (state.db) render(); scrollTo(0, 0); }));
$('#account').onclick = () => openSettings();

(async () => {
  try {
    const ok = await be.init();
    be.ready = true;
    if (!ok) return renderLogin();
    const cached = readCache();
    if (cached?.db) { state.db = cached.db; state.conn = 'updating'; render(); }
    let rt; be.onChange(() => { clearTimeout(rt); rt = setTimeout(() => refresh().catch(console.error), 250); });
    document.addEventListener('visibilitychange', () => { if (!document.hidden && state.db) refresh().catch(console.error); });
    window.addEventListener('online', () => { if (state.conn) retry(); });
    window.addEventListener('offline', () => { if (state.db && be.kind !== 'mock') { state.conn = 'offline'; render(); } });
    await refresh().catch(console.error);
  } catch (err) { console.error(err); state.conn = connProblem(err); renderUnreachable(); }
  finally {
    if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).then((r) => r.update()).catch(() => {});
  }
})();
