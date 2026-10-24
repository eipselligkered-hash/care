// Pure due-date rules (no DOM). Dates are 'YYYY-MM-DD' strings in local time.
export const CADENCES = ['after_use', 'once', 'monthly', 'quarterly', 'yearly'];
export const CADENCE_LABEL = { after_use: 'After each use', once: 'One-off', monthly: 'Monthly', quarterly: 'Every 3 months', yearly: 'Yearly' };
export const MONTHS = { monthly: 1, quarterly: 3, yearly: 12 };
export const SOON_DAYS = 30;

const pad = (n) => String(n).padStart(2, '0');
const iso = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;
const parts = (s) => s.split('-').map(Number);
const daysIn = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();   // m = 1..12

// calendar months; the 31st becomes the last day of a shorter month (31/01 + 1 month = 28/02 or 29/02)
export function addMonths(day, n) {
  const [y, m, d] = parts(day);
  const t = y * 12 + (m - 1) + n, ny = Math.floor(t / 12), nm = (t % 12) + 1;
  return iso(ny, nm, Math.min(d, daysIn(ny, nm)));
}
export function addDays(day, n) {
  const [y, m, d] = parts(day); const x = new Date(Date.UTC(y, m - 1, d + n));
  return iso(x.getUTCFullYear(), x.getUTCMonth() + 1, x.getUTCDate());
}
export const daysBetween = (a, b) => Math.round((Date.UTC(...parts(b).map((v, i) => (i === 1 ? v - 1 : v))) - Date.UTC(...parts(a).map((v, i) => (i === 1 ? v - 1 : v)))) / 86400000);

export function lastDone(itemId, completions) {
  let last = null;
  for (const c of completions) if (c.item_id === itemId && (!last || c.done_on > last)) last = c.done_on;
  return last;
}

// -> { item, last, next, state, days }
// state: 'reference' (after each use) | 'done' (finished one-off) | 'due' | 'soon' (within 30 days) | 'later' | 'inactive'
// optional items never become 'due': they are 'optional' when they would be due.
export function status(item, completions, today, { soonDays = SOON_DAYS } = {}) {
  const last = lastDone(item.id, completions);
  const base = { item, last, next: null, state: 'later', days: null, optional: !!item.optional };
  if (item.active === false) return { ...base, state: 'inactive' };
  if (item.cadence === 'after_use') return { ...base, state: 'reference' };
  let next;
  if (item.cadence === 'once') {
    if (last) return { ...base, state: 'done' };
    next = item.due_date || today;
  } else {
    const n = MONTHS[item.cadence]; if (!n) return { ...base, state: 'reference' };
    next = last ? addMonths(last, n) : today;      // never done = due now
  }
  const days = daysBetween(today, next);
  let state = days <= 0 ? 'due' : days <= soonDays ? 'soon' : 'later';
  if (item.optional && state === 'due') state = 'optional';
  return { ...base, next, days, state };
}

const byNext = (a, b) => (a.next || '').localeCompare(b.next || '') || (a.item.sort_order ?? 0) - (b.item.sort_order ?? 0) || a.item.title.localeCompare(b.item.title);
// The 'Now' screen: due (soonest first), coming up within 30 days, optional (collapsed, never due)
export function nowView(items, completions, today) {
  const rows = items.map((i) => status(i, completions, today));
  const due = rows.filter((r) => r.state === 'due' && !r.optional).sort(byNext);
  const soon = rows.filter((r) => r.state === 'soon' && !r.optional).sort(byNext);
  const optional = rows.filter((r) => r.optional && ['optional', 'soon', 'later', 'due'].includes(r.state)).sort(byNext);
  return { due, soon, optional };
}
export function groupAll(items, completions, today) {
  const rows = items.map((i) => status(i, completions, today));
  const order = (a, b) => (a.item.sort_order ?? 0) - (b.item.sort_order ?? 0) || a.item.title.localeCompare(b.item.title);
  const groups = CADENCES.map((c) => ({ cadence: c, label: CADENCE_LABEL[c], rows: rows.filter((r) => r.item.cadence === c && r.state !== 'inactive').sort(order) }));
  return { groups, inactive: rows.filter((r) => r.state === 'inactive').sort(order) };
}

// display: 'Sat 24/10/2026' (Irish/UK order)
const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const WDL = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
export function fmtDate(day, { long = false, weekday = true } = {}) {
  if (!day) return '–';
  const [y, m, d] = parts(day); const w = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return `${weekday ? (long ? WDL : WD)[w] + ' ' : ''}${pad(d)}/${pad(m)}/${y}`;
}
// short gentle text for a row (the 'Due' chip is added by the UI)
export function whenText(r) {
  if (r.state === 'reference') return 'After each use';
  if (r.state === 'done') return `Done ${fmtDate(r.last)}`;
  if (r.state === 'inactive') return 'Archived';
  if (r.state === 'optional') return 'Any time it applies';
  const pre = r.optional ? 'From ' : '';
  if (r.state === 'due') return r.days < 0 ? `Since ${fmtDate(r.next)}` : 'Today';
  if (r.days === 1) return `${pre || ''}${pre ? fmtDate(r.next) : 'Tomorrow · ' + fmtDate(r.next)}`;
  return pre ? pre + fmtDate(r.next) : r.days <= SOON_DAYS ? `In ${r.days} days · ${fmtDate(r.next)}` : `Next ${fmtDate(r.next)}`;
}
