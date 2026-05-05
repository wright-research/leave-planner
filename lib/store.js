// Tiny pub/sub state store. View code subscribes; mutations notify subscribers.
// In DEMO_MODE all writes stay in memory — reloading the page resets to fixtures.

import { supabase, DEMO_MODE } from './supabase.js';
import { DEMO_BALANCES, DEMO_CALENDAR, DEMO_RELOAD_LOG } from './fixtures.js';

const listeners = new Set();

export const state = {
  balances: null,
  calendarEntries: new Map(),
  reloadLog: [],
  filters: { showHistoric: false },
  loading: true,
};

export function subscribe(fn) {
  listeners.add(fn);
  fn(state);
  return () => listeners.delete(fn);
}

function notify() {
  for (const fn of listeners) fn(state);
}

function todayStr() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// --- Load ---
export async function loadAll() {
  if (DEMO_MODE) {
    state.balances = { ...DEMO_BALANCES };
    state.calendarEntries = new Map(DEMO_CALENDAR.map(r => [r.date, r]));
    state.reloadLog = [...DEMO_RELOAD_LOG];
    state.loading = false;
    notify();
    return;
  }
  const [bal, cal, log] = await Promise.all([
    supabase.from('balances').select('*').eq('id', 1).maybeSingle(),
    supabase.from('calendar_entries').select('*'),
    supabase.from('reload_log').select('*').order('reload_date', { ascending: false }),
  ]);
  // First-run safety: if the balances row doesn't exist yet, seed it with zeros
  // and today's date as the anchor for everything.
  const today = todayStr();
  const seed = {
    id: 1,
    pass_balance: 0, cash_balance: 0, card_as_of: today,
    fund_balance: 0, fund_as_of: today,
    annual_balance: 0, annual_as_of: today,
    sick_balance: 0, sick_as_of: today,
  };
  // Migration safety: if the row pre-dates the as-of columns, default them to
  // today so the projection treats stored values as already current. The user
  // can re-anchor via the Adjust dialog whenever they like.
  state.balances = { ...seed, ...(bal.data ?? {}) };
  for (const k of ['card_as_of', 'fund_as_of', 'annual_as_of', 'sick_as_of']) {
    if (!state.balances[k]) state.balances[k] = today;
  }
  state.calendarEntries = new Map((cal.data ?? []).map(r => [r.date, r]));
  state.reloadLog = log.data ?? [];
  state.loading = false;
  notify();
}

// --- Mutations ---

// Set a new anchor for one or more balances and stamp the corresponding as-of
// date(s) to today. `patch` is a subset of balance fields, e.g.
//   setAnchor({ pass_balance: 12, cash_balance: 88 }) → bumps card_as_of
//   setAnchor({ annual_balance: 117.5 })              → bumps annual_as_of
export async function setAnchor(patch) {
  const today = todayStr();
  const stamped = { ...patch };
  if ('pass_balance' in patch || 'cash_balance' in patch) stamped.card_as_of = today;
  if ('fund_balance' in patch)                            stamped.fund_as_of = today;
  if ('annual_balance' in patch)                          stamped.annual_as_of = today;
  if ('sick_balance' in patch)                            stamped.sick_as_of = today;

  state.balances = { ...state.balances, ...stamped };
  if (!DEMO_MODE) {
    const { error } = await supabase.from('balances').upsert({ id: 1, ...stamped });
    if (error) throw new Error(`Supabase error saving balances: ${error.message}`);
  }
  notify();
}

export async function upsertCalendarEntry(date, patch) {
  const existing = state.calendarEntries.get(date) ?? {
    date, commute_override: null, annual_used: 0, sick_used: 0, kind: null, notes: null,
  };
  const merged = { ...existing, ...patch };
  state.calendarEntries.set(date, merged);
  if (!DEMO_MODE) {
    const { error } = await supabase.from('calendar_entries').upsert(merged);
    if (error) throw new Error(`Supabase error saving calendar entry: ${error.message}`);
  }
  notify();
}

export async function deleteCalendarEntry(date) {
  state.calendarEntries.delete(date);
  if (!DEMO_MODE) {
    const { error } = await supabase.from('calendar_entries').delete().eq('date', date);
    if (error) throw new Error(`Supabase error deleting calendar entry: ${error.message}`);
  }
  notify();
}

export async function logReload({ reload_date, booklets_added, cash_added, fsa_spent, notes }) {
  // Reload events live in reload_log; the projection picks them up automatically
  // when computing today's pass/cash/fund. No direct mutation of balance anchors.
  const entry = { reload_date, booklets_added, cash_added, fsa_spent, notes };
  state.reloadLog.unshift(entry);
  if (!DEMO_MODE) {
    const { error } = await supabase.from('reload_log').insert(entry);
    if (error) throw new Error(`Supabase error saving reload log: ${error.message}`);
  }
  notify();
}

export function setFilter(key, value) {
  state.filters[key] = value;
  notify();
}
