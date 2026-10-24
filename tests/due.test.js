import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addMonths, addDays, daysBetween, status, nowView, groupAll, fmtDate, whenText } from '../src/due.js';

const T = '2026-10-24';
const it = (id, cadence, extra = {}) => ({ id, title: id, cadence, active: true, optional: false, sort_order: 0, ...extra });
const done = (item_id, done_on) => ({ id: `${item_id}-${done_on}`, item_id, done_on });

test('calendar months, end of month clamps', () => {
  assert.equal(addMonths('2026-01-31', 1), '2026-02-28');
  assert.equal(addMonths('2028-01-31', 1), '2028-02-29');
  assert.equal(addMonths('2026-11-15', 3), '2027-02-15');
  assert.equal(addMonths('2025-10-01', 12), '2026-10-01');
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(daysBetween('2026-10-24', '2026-11-23'), 30);
  assert.equal(daysBetween('2026-03-28', '2026-03-30'), 2);   // across the clocks change
});

test('never done recurring = due now; next due = last done + interval', () => {
  assert.equal(status(it('a', 'monthly'), [], T).state, 'due');
  assert.equal(status(it('a', 'monthly'), [], T).next, T);
  const r = status(it('a', 'monthly'), [done('a', '2026-10-10'), done('a', '2026-09-01')], T);
  assert.equal(r.last, '2026-10-10'); assert.equal(r.next, '2026-11-10'); assert.equal(r.state, 'soon'); assert.equal(r.days, 17);
  assert.equal(status(it('y', 'yearly'), [done('y', '2025-09-01')], T).state, 'due');
  assert.equal(status(it('y', 'yearly'), [done('y', '2026-10-24')], T).next, '2027-10-24');
  assert.equal(status(it('y', 'yearly'), [done('y', '2026-10-24')], T).state, 'later');
  assert.equal(status(it('q', 'quarterly'), [done('q', '2026-07-24')], T).state, 'due');   // exactly on the day
  assert.equal(status(it('q', 'quarterly'), [done('q', '2026-07-25')], T).days, 1);
});

test('one-offs: due on their date, finished once done', () => {
  assert.equal(status(it('o', 'once', { due_date: '2026-10-24' }), [], T).state, 'due');
  assert.equal(status(it('o', 'once', { due_date: '2026-10-31' }), [], T).state, 'soon');
  assert.equal(status(it('o', 'once', { due_date: '2026-12-31' }), [], T).state, 'later');
  assert.equal(status(it('o', 'once'), [], T).state, 'due');                   // no date = now
  assert.equal(status(it('o', 'once', { due_date: '2026-10-31' }), [done('o', '2026-10-20')], T).state, 'done');
});

test('optional items are never due; after-use is reference; inactive hidden', () => {
  const o = status(it('p', 'quarterly', { optional: true }), [], T);
  assert.equal(o.state, 'optional'); assert.equal(whenText(o), 'Any time it applies');
  assert.equal(status(it('p', 'quarterly', { optional: true }), [done('p', '2026-10-01')], T).state, 'later');
  assert.equal(status(it('r', 'after_use'), [done('r', '2026-01-01')], T).state, 'reference');
  assert.equal(status(it('x', 'monthly', { active: false }), [], T).state, 'inactive');
});

test('Now view: due, next 30 days, optional apart', () => {
  const items = [it('m', 'monthly'), it('o', 'once', { due_date: '2026-10-31' }), it('l', 'once', { due_date: '2027-01-31' }),
    it('p', 'quarterly', { optional: true }), it('r', 'after_use'), it('y', 'yearly'), it('d', 'once', { due_date: '2026-10-01' })];
  const v = nowView(items, [done('y', '2026-01-01')], T);
  assert.deepEqual(v.due.map((r) => r.item.id), ['d', 'm']);   // soonest first
  assert.deepEqual(v.soon.map((r) => r.item.id), ['o']);
  const w = nowView(items, [], T);
  assert.deepEqual(w.due.map((r) => r.item.id).sort(), ['d', 'm', 'y']);
  assert.deepEqual(w.soon.map((r) => r.item.id), ['o']);
  assert.deepEqual(w.optional.map((r) => r.item.id), ['p']);
  assert.ok(![...w.due, ...w.soon].some((r) => r.item.id === 'r' || r.item.id === 'l'));
  const g = groupAll(items, [], T);
  assert.deepEqual(g.groups.map((x) => x.cadence), ['after_use', 'once', 'monthly', 'quarterly', 'yearly']);
});

test('dates are dd/mm/yyyy', () => {
  assert.equal(fmtDate('2026-10-24'), 'Sat 24/10/2026');
  assert.equal(fmtDate('2026-10-24', { long: true }), 'Saturday 24/10/2026');
  assert.equal(fmtDate('2026-10-31', { weekday: false }), '31/10/2026');
  assert.equal(whenText(status(it('o', 'once', { due_date: '2026-10-31' }), [], T)), 'In 7 days · Sat 31/10/2026');
  assert.equal(whenText(status(it('d', 'once', { due_date: '2026-10-01' }), [], T)), 'Since Thu 01/10/2026');
});
