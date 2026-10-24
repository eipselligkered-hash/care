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

// ---------- categories (names come from the data; display order = lowest sort_order in each category; no category = 'Other', last)
export const CAT_OTHER = 'Other';
export const catOf = (item) => (typeof item.category === 'string' && item.category.trim()) || CAT_OTHER;
export function categoryOrder(items) {
  const m = new Map();
  for (const i of items) { const c = catOf(i), s = i.sort_order ?? 0; if (!m.has(c) || s < m.get(c)) m.set(c, s); }
  return [...m.keys()].sort((a, b) => (a === CAT_OTHER) - (b === CAT_OTHER) || m.get(a) - m.get(b) || a.localeCompare(b));
}
export const ALL_CADENCE_ORDER = ['after_use', 'monthly', 'quarterly', 'yearly', 'once'];
export const CADENCE_CHIP = { once: 'One-off', monthly: 'Monthly', quarterly: '3-monthly', yearly: 'Yearly', after_use: 'After use' };

// Now: categories that have something due or coming up (due first, then by date); optional items kept apart
export function nowByCategory(items, completions, today) {
  const v = nowView(items, completions, today);
  const rows = [...v.due, ...v.soon];
  const cats = categoryOrder(items.filter((i) => i.active !== false))
    .map((category) => ({ category, rows: rows.filter((r) => catOf(r.item) === category).sort(byNext) }))
    .filter((g) => g.rows.length);
  return { cats, optional: v.optional, due: v.due.length, soon: v.soon.length };
}
// All: category first, then cadence (after each use, monthly, every 3 months, yearly, one-offs); archived apart
export function allByCategory(items, completions, today) {
  const rows = items.map((i) => status(i, completions, today));
  const order = (a, b) => (a.item.sort_order ?? 0) - (b.item.sort_order ?? 0) || a.item.title.localeCompare(b.item.title);
  const live = rows.filter((r) => r.state !== 'inactive');
  const cats = categoryOrder(live.map((r) => r.item)).map((category) => {
    const mine = live.filter((r) => catOf(r.item) === category);
    return { category, count: mine.length, cadences: ALL_CADENCE_ORDER.map((c) => ({ cadence: c, label: CADENCE_LABEL[c], rows: mine.filter((r) => r.item.cadence === c).sort(order) })).filter((g) => g.rows.length) };
  });
  return { cats, inactive: rows.filter((r) => r.state === 'inactive').sort(order) };
}
// one small, soft chip for the due state: 'Due', 'Due 31/10', 'Next 01/11/2027', 'Optional', 'Done 24/10'
export const fmtShort = (day) => (day ? `${day.slice(8, 10)}/${day.slice(5, 7)}` : '');
export function dueChip(r) {
  switch (r.state) {
    case 'due': return { cls: 'due', text: 'Due' };
    case 'soon': return r.optional ? { cls: 'opt', text: `Optional · ${fmtShort(r.next)}` } : { cls: 'soon', text: `Due ${fmtShort(r.next)}` };
    case 'later': return r.optional ? { cls: 'opt', text: `Optional · ${fmtDate(r.next, { weekday: false })}` } : { cls: 'later', text: `Next ${fmtDate(r.next, { weekday: false })}` };
    case 'optional': return { cls: 'opt', text: 'Optional' };
    case 'done': return { cls: 'done', text: `Done ${fmtShort(r.last)}` };
    case 'inactive': return { cls: 'later', text: 'Archived' };
    default: return null;
  }
}
