// Pure functions. Deterministic and side-effect-free so they're easy to test.
// All dates are Date objects at local midnight. Calendar keys are 'YYYY-MM-DD'.

import {
  TRIP_COSTS, CARD_CAPS, BOOKLET_COST, TRIPS_PER_BOOKLET,
  MAX_RELOAD_COST, COMMUTE_DEFAULT_DAYS, TRIPS_PER_COMMUTE_DAY,
  FSA, FSA_PAYCHECKS_PER_MONTH_CAP, PAYCHECK_ANCHOR, LEAVE_ACCRUAL_ANCHOR, LEAVE,
  COMMUTE_TRIP_TIMES_ET,
} from '../constants.js';
import { isHoliday } from './holidays.js';

const MS_PER_DAY = 86400000;
const ANCHOR = parseDate(PAYCHECK_ANCHOR);
const LEAVE_ANCHOR = parseDate(LEAVE_ACCRUAL_ANCHOR);

// --- Date helpers ---

export function parseDate(s) {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function formatDate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function addDays(d, n) {
  const r = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  r.setDate(r.getDate() + n);
  return r;
}

export function daysBetween(a, b) {
  return Math.round((b - a) / MS_PER_DAY);
}

export function startOfDay(d = new Date()) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

// Returns how many Breeze trips are assumed consumed so far today based on US Eastern time.
// 0 before 8:00am, 1 from 8:00am–3:59pm, 2 from 4:00pm onward.
export function tripsUsedTodayByTime(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    hour: 'numeric', minute: 'numeric', hour12: false,
  }).formatToParts(now);
  const hour = +parts.find(p => p.type === 'hour').value % 24;
  const minute = +parts.find(p => p.type === 'minute').value;
  const total = hour * 60 + minute;
  const { morning, afternoon } = COMMUTE_TRIP_TIMES_ET;
  if (total < morning.hour * 60 + morning.minute) return 0;
  if (total < afternoon.hour * 60 + afternoon.minute) return 1;
  return 2;
}

// --- Calendar rules ---

export function isDefaultCommuteDay(date) {
  return COMMUTE_DEFAULT_DAYS.includes(date.getDay());
}

export function isCommuteDay(date, override) {
  if (override === 'yes') return true;
  if (override === 'no') return false;
  if (isHoliday(date)) return false;
  return isDefaultCommuteDay(date);
}

export function isPaycheckFriday(date) {
  if (date.getDay() !== 5) return false;
  return daysBetween(ANCHOR, date) % 14 === 0;
}

export function isPayPeriodEndSunday(date) {
  if (date.getDay() !== 0) return false;
  return daysBetween(LEAVE_ANCHOR, date) % 14 === 0;
}

function paycheckFridaysInMonth(year, month0) {
  let d = new Date(year, month0, 1);
  while (!isPaycheckFriday(d)) d = addDays(d, 1);
  const fridays = [];
  while (d.getMonth() === month0) {
    fridays.push(d);
    d = addDays(d, 14);
  }
  return fridays;
}

export function isFsaContributionDay(date) {
  if (!isPaycheckFriday(date)) return false;
  const fridays = paycheckFridaysInMonth(date.getFullYear(), date.getMonth());
  const idx = fridays.findIndex(f => f.getTime() === date.getTime());
  return idx >= 0 && idx < FSA_PAYCHECKS_PER_MONTH_CAP;
}

export function fsaDepositForDate(date) {
  let sum = 0;
  if (date.getDate() === 1) sum += FSA.arcContribution;
  if (isFsaContributionDay(date)) sum += FSA.paycheckContribution;
  return sum;
}

export function leaveAccrualForDate(date) {
  if (!isPayPeriodEndSunday(date)) return { annual: 0, sick: 0 };
  return { annual: LEAVE.annualAccrual, sick: LEAVE.sickAccrual };
}

// --- Anchored balance projections ---
//
// Each balance carries an anchor (value + as-of date). The displayed "today"
// value is computed by walking forward from the anchor day-by-day, applying
// the same rules used by the depletion/leave projections. Reloads and calendar
// entries dated at-or-before the anchor are pure history; only events strictly
// after the anchor flow into the projection.

function buildReloadsByDate(reloadLog, afterDate, throughDate) {
  const map = new Map();
  for (const r of reloadLog || []) {
    const d = parseDate(r.reload_date);
    if (d > afterDate && d <= throughDate) {
      const key = formatDate(d);
      const list = map.get(key) || [];
      list.push(r);
      map.set(key, list);
    }
  }
  return map;
}

// Walk pass + cash together — they're coupled by trip consumption (pass first,
// then cash). Returns { pass, cash } at the target date, both clamped at 0.
export function projectCardBalances({
  passAnchor, cashAnchor, anchorDate, targetDate, calendarEntries, reloadLog,
  todayTrips = TRIPS_PER_COMMUTE_DAY,
}) {
  let pass = passAnchor;
  let cash = cashAnchor;
  const days = daysBetween(anchorDate, targetDate);
  if (days <= 0) return { pass, cash };

  const reloads = buildReloadsByDate(reloadLog, anchorDate, targetDate);

  for (let i = 1; i <= days; i++) {
    const date = addDays(anchorDate, i);
    const key = formatDate(date);

    for (const r of reloads.get(key) || []) {
      pass += r.booklets_added * TRIPS_PER_BOOKLET;
      cash += Number(r.cash_added);
    }

    const entry = calendarEntries.get(key);
    if (isCommuteDay(date, entry?.commute_override)) {
      const trips = date.getTime() === targetDate.getTime() ? todayTrips : TRIPS_PER_COMMUTE_DAY;
      const passUsed = Math.min(pass, trips);
      pass -= passUsed;
      const cashCost = (trips - passUsed) * TRIP_COSTS.cash;
      cash = Math.max(0, cash - cashCost);
    }
  }
  return { pass, cash };
}

export function projectFundBalance({
  anchor, anchorDate, targetDate, reloadLog,
}) {
  let fund = anchor;
  const days = daysBetween(anchorDate, targetDate);
  if (days <= 0) return fund;

  const reloads = buildReloadsByDate(reloadLog, anchorDate, targetDate);

  for (let i = 1; i <= days; i++) {
    const date = addDays(anchorDate, i);
    const key = formatDate(date);
    fund += fsaDepositForDate(date);
    for (const r of reloads.get(key) || []) {
      fund -= Number(r.fsa_spent);
    }
  }
  return Math.max(0, fund);
}

export function projectLeaveBalance({
  anchor, anchorDate, targetDate, accrualPerPaycheck, usedField, calendarEntries, cap = null,
}) {
  let balance = anchor;
  const days = daysBetween(anchorDate, targetDate);
  if (days > 0) {
    for (let i = 1; i <= days; i++) {
      const date = addDays(anchorDate, i);
      if (isPayPeriodEndSunday(date)) balance += accrualPerPaycheck;
      const used = calendarEntries.get(formatDate(date))?.[usedField] ?? 0;
      if (used > 0) balance -= used;
    }
  }
  return cap != null ? Math.min(balance, cap) : balance;
}

// --- Transit depletion ---

export function tripsAvailable(passBalance, cashBalance) {
  return passBalance + Math.floor(cashBalance / TRIP_COSTS.cash);
}

export function computeReload(fsaAvailable) {
  const cap = Math.min(fsaAvailable, MAX_RELOAD_COST);
  const booklets = Math.min(CARD_CAPS.booklets, Math.floor(cap / BOOKLET_COST));
  const cashAdded = Math.min(CARD_CAPS.cashValue, cap - booklets * BOOKLET_COST);
  return {
    booklets,
    cashAdded,
    spent: booklets * BOOKLET_COST + cashAdded,
    tripsAdded: booklets * TRIPS_PER_BOOKLET,
  };
}

// Walk forward from the day after `startDate`. Input balances reflect end-of-`startDate`.
// Returns { depletionDate, fundAtDepletion } or { depletionDate: null, fundAtDepletion } if never depleted.
export function walkDepletion({
  startDate,
  passBalance,
  cashBalance,
  fundBalance,
  calendarEntries,
  maxDays = 730,
}) {
  let pass = passBalance;
  let cash = cashBalance;
  let fund = fundBalance;

  for (let i = 1; i <= maxDays; i++) {
    const date = addDays(startDate, i);
    const entry = calendarEntries.get(formatDate(date));

    fund += fsaDepositForDate(date);

    const trips = isCommuteDay(date, entry?.commute_override) ? TRIPS_PER_COMMUTE_DAY : 0;
    if (trips > 0) {
      if (tripsAvailable(pass, cash) < trips) {
        return { depletionDate: date, fundAtDepletion: fund };
      }
      const passUsed = Math.min(pass, trips);
      pass -= passUsed;
      cash -= (trips - passUsed) * TRIP_COSTS.cash;
    }
  }
  return { depletionDate: null, fundAtDepletion: fund };
}

// Compute up to two depletion dates, each assuming a hypothetical max reload at the prior.
// Returns [{ depletionDate, fundAtDepletion, reload }, ...] — length up to 2.
export function projectDepletionDates({ today, balances, calendarEntries }) {
  const results = [];
  let startDate = today;
  let pass = balances.pass_balance;
  let cash = balances.cash_balance;
  let fund = balances.fund_balance;

  for (let cycle = 1; cycle <= 2; cycle++) {
    const r = walkDepletion({
      startDate, passBalance: pass, cashBalance: cash, fundBalance: fund, calendarEntries,
    });
    if (!r.depletionDate) {
      results.push({ depletionDate: null, fundAtDepletion: r.fundAtDepletion, reload: null });
      break;
    }
    const reload = computeReload(r.fundAtDepletion);
    results.push({ depletionDate: r.depletionDate, fundAtDepletion: r.fundAtDepletion, reload });

    // Prepare next cycle.
    startDate = r.depletionDate;
    pass = reload.tripsAdded;
    cash = reload.cashAdded;
    fund = r.fundAtDepletion - reload.spent;
  }
  return results;
}

// --- Leave ---

export function projectLeave({ balanceNow, accrualPerPaycheck, usedField, today, calendarEntries, cap = null, horizonDays = 365 }) {
  let balance = balanceNow;
  let accrued = 0;
  let used = 0;
  for (let i = 1; i <= horizonDays; i++) {
    const date = addDays(today, i);
    if (isPayPeriodEndSunday(date)) {
      balance += accrualPerPaycheck;
      accrued += accrualPerPaycheck;
    }
    const entry = calendarEntries.get(formatDate(date));
    const hours = entry?.[usedField] ?? 0;
    if (hours > 0) {
      balance -= hours;
      used += hours;
    }
  }
  const lost = cap != null && balance > cap ? balance - cap : 0;
  const balanceIn1Year = cap != null ? Math.min(balance, cap) : balance;
  return {
    balanceNow,
    balanceIn1Year,
    accrued,
    used,
    lost,
    weeksNow: balanceNow / LEAVE.hoursPerWeek,
    weeksIn1Year: balanceIn1Year / LEAVE.hoursPerWeek,
  };
}
