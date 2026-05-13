// App entry point. Loads state, renders views, hooks up events.

import { DEMO_MODE } from './lib/supabase.js';
import {
  state, subscribe, loadAll, setFilter,
  setAnchor, upsertCalendarEntry, deleteCalendarEntry, logReload,
} from './lib/store.js';
import {
  startOfDay, addDays, formatDate, parseDate,
  isCommuteDay, tripsAvailable,
  projectDepletionDates, projectLeave,
  projectCardBalances, projectFundBalance, projectLeaveBalance,
  tripsUsedTodayByTime, isPayPeriodEndSunday,
} from './lib/projections.js';
import { getHoliday } from './lib/holidays.js';
import { LEAVE, COMMUTE_TRIP_TIMES_ET } from './constants.js';

const $ = (sel) => document.querySelector(sel);
const TODAY = startOfDay();

// --- Global "Saved!" toast ---

let toastEl = null;
let toastTimer = null;
function showToast(msg = 'Saved!') {
  if (!toastEl) {
    toastEl = document.createElement('div');
    toastEl.className = 'toast';
    toastEl.setAttribute('role', 'status');
    toastEl.setAttribute('aria-live', 'polite');
    document.body.appendChild(toastEl);
  }
  toastEl.textContent = msg;
  toastEl.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove('show'), 1500);
}

// --- Theme ---

{
  const stored = localStorage.getItem('theme');
  const prefersDark = window.matchMedia?.('(prefers-color-scheme: dark)').matches;
  document.documentElement.dataset.theme = stored ?? (prefersDark ? 'dark' : 'light');
}

$('#theme-toggle').addEventListener('click', () => {
  const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = next;
  localStorage.setItem('theme', next);
});

async function init() {
  if (DEMO_MODE) {
    document.title = 'DepletionSked (demo)';
    const banner = document.createElement('div');
    banner.className = 'demo-banner';
    banner.textContent = 'Demo mode — data is seeded from fixtures and changes do not persist.';
    document.body.prepend(banner);
  }
  await loadAll();
}

// --- Event wiring ---

$('#filter-historic').addEventListener('change', (e) => {
  // Toggling historic re-anchors the view; let the next render re-scroll to today.
  renderAgenda._didInitialScroll = false;
  setFilter('showHistoric', e.target.checked);
});

// Delegated so buttons survive re-renders inside #balances-body.
$('#balances').addEventListener('click', (e) => {
  if (e.target.closest('#log-reload-btn')) {
    const dlg = $('#reload-dialog');
    dlg.querySelector('input[name="reload_date"]').value = formatDate(TODAY);
    dlg.showModal();
    return;
  }
  if (e.target.closest('#adjust-balances-btn')) { openAdjustDialog(); return; }
  if (e.target.closest('#leave-history-btn'))   { openLeaveHistoryDialog(); return; }
});

// --- Adjust balance dialog ---

const ADJUST_FIELDS = [
  { name: 'pass_balance',   label: 'Pass trips',       step: 1,    min: 0, max: 70 },
  { name: 'cash_balance',   label: 'Cash on card ($)', step: 0.5,  min: 0 },
  { name: 'fund_balance',   label: 'FSA balance ($)',  step: 0.01, min: 0 },
  { name: 'annual_balance', label: 'Annual leave (h)', step: 0.25, min: 0, max: LEAVE.annualCap },
  { name: 'sick_balance',   label: 'Sick leave (h)',   step: 0.25, min: 0, max: LEAVE.sickCap },
];

function openAdjustDialog() {
  const today = deriveTodayBalances(state);
  $('#adjust-title').textContent = 'Adjust balances';
  $('#adjust-help').textContent =
    'Update any values that drift from reality. Unchanged fields keep their existing calibration date.';
  $('#adjust-fields').innerHTML = ADJUST_FIELDS.map((f) => {
    const value = Number(today[f.name]).toFixed(f.step >= 1 ? 0 : 2).replace(/\.?0+$/, '') || '0';
    const max = f.max != null ? `max="${f.max}"` : '';
    return `
      <label>
        <span>${f.label}</span>
        <input type="number" name="${f.name}" step="${f.step}" min="${f.min}" ${max} value="${value}" required />
      </label>`;
  }).join('');
  $('#adjust-dialog').showModal();
}

$('#adjust-form').addEventListener('submit', async (e) => {
  if (e.submitter?.value !== 'save') return;
  const fd = new FormData(e.target);
  const today = deriveTodayBalances(state);
  // Only patch fields that actually changed — preserves the existing
  // *_as_of date on untouched fields so projections don't shift.
  const patch = {};
  for (const [k, v] of fd.entries()) {
    const num = Number(v);
    if (Math.abs(num - Number(today[k])) > 1e-6) patch[k] = num;
  }
  if (Object.keys(patch).length === 0) return;
  try {
    await setAnchor(patch);
    showToast('Saved!');
  } catch (err) {
    console.error(err);
    showToast(`Save failed: ${err.message}`);
  }
});

$('#reload-form').addEventListener('submit', async (e) => {
  const action = e.submitter?.value;
  if (action !== 'save') return;
  const fd = new FormData(e.target);
  try {
    await logReload({
      reload_date: fd.get('reload_date'),
      booklets_added: Number(fd.get('booklets_added')),
      cash_added: Number(fd.get('cash_added')),
      fsa_spent: Number(fd.get('fsa_spent')),
      notes: fd.get('notes') || null,
    });
    showToast('Saved!');
    e.target.reset();
  } catch (err) {
    console.error(err);
    showToast(`Save failed: ${err.message}`);
  }
});

// --- Day editor (double-click an agenda row) ---

function deriveStatus(entry, date) {
  if (entry?.kind === 'holiday') return 'holiday';
  if (!entry) return date && getHoliday(date) ? 'holiday' : 'commute';
  if ((entry.annual_used ?? 0) > 0) return 'annual';
  if ((entry.sick_used ?? 0) > 0) return 'sick';
  if (entry.kind === 'conference') return 'conference';
  if (entry.kind === 'wfh') return 'wfh';
  // Legacy/fixture rows that pre-date the kind field: infer from notes.
  if (entry.commute_override === 'no') {
    if (date && getHoliday(date)) return 'holiday';
    if ((entry.notes || '').toLowerCase().includes('conference')) return 'conference';
    return 'wfh';
  }
  if (entry.commute_override === 'yes') return 'commute';
  return 'commute';
}

function deriveDayType(entry) {
  const hrs = (entry?.annual_used || entry?.sick_used) || 0;
  return hrs === 3.75 ? 'half' : 'full';
}

function openDayDialog(dateKey) {
  const dlg = $('#day-dialog');
  const form = dlg.querySelector('form');
  const date = parseDate(dateKey);
  const entry = state.calendarEntries.get(dateKey);

  form.querySelector('#day-dialog-title').textContent =
    `Edit ${date.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}`;
  form.querySelector('input[name="date"]').value = dateKey;

  const status = deriveStatus(entry, date);
  form.querySelectorAll('input[name="status"]').forEach((r) => { r.checked = r.value === status; });

  const dayType = deriveDayType(entry);
  form.querySelectorAll('input[name="dayType"]').forEach((r) => { r.checked = r.value === dayType; });

  // For built-in holidays with no stored entry, surface the holiday name
  // in the notes field so the dialog reflects what's shown on the calendar.
  form.querySelector('input[name="notes"]').value = entry?.notes ?? getHoliday(date) ?? '';
  // End date pre-fills with the focused date so the picker has a sensible anchor.
  form.querySelector('input[name="end"]').value = dateKey;

  form.querySelector('button[value="delete"]').hidden = !entry;
  updateDayDialogState(form);
  dlg.showModal();
}

function updateDayDialogState(form) {
  const status = form.querySelector('input[name="status"]:checked')?.value;
  const dayType = form.querySelector('input[name="dayType"]:checked')?.value;
  const isLeave = status === 'annual' || status === 'sick';
  const showEnd =
    (isLeave && dayType !== 'half') ||
    status === 'wfh' ||
    status === 'conference' ||
    status === 'holiday';

  form.querySelector('#day-type-group').hidden = !isLeave;
  form.querySelector('#day-end-row').hidden = !showEnd;
}

$('#day-form').addEventListener('change', (e) => {
  if (e.target.name === 'status' || e.target.name === 'dayType') {
    updateDayDialogState(e.currentTarget);
  }
});

// Touch devices get single-tap (mobile browsers swallow dblclick into the
// double-tap-to-zoom gesture). Desktop keeps dblclick to avoid accidental
// opens when scanning the calendar.
function handleCalCellActivate(e) {
  const isTouch = matchMedia('(hover: none)').matches;
  if (e.type === 'click' && !isTouch) return;
  if (e.type === 'dblclick' && isTouch) return;
  const cell = e.target.closest('.cal-cell');
  if (!cell?.dataset.date) return;
  openDayDialog(cell.dataset.date);
}
$('#agenda').addEventListener('click', handleCalCellActivate);
$('#agenda').addEventListener('dblclick', handleCalCellActivate);

$('#day-form').addEventListener('submit', async (e) => {
  const action = e.submitter?.value;
  const fd = new FormData(e.target);
  const dateKey = fd.get('date');
  const start = parseDate(dateKey);
  const endStr = fd.get('end');
  const end = endStr ? parseDate(endStr) : start;
  if (!start || end < start) return;

  try {
    if (action === 'delete') {
      for (let d = start; d <= end; d = addDays(d, 1)) {
        await deleteCalendarEntry(formatDate(d));
      }
      return;
    }
    if (action !== 'save') return;

    const status = fd.get('status');
    const dayType = fd.get('dayType');
    const notes = fd.get('notes') || null;
    // Half day = 3.75h on the focused day; Full day(s) = 7.5h per day across range.
    const hoursPerDay = dayType === 'half' ? 3.75 : 7.5;

    // "Default (commute)" stores no override (null) — the default-commute rule
    // resolves it. The other four statuses all force commute off.
    const patch = {
      annual_used:      status === 'annual' ? hoursPerDay : 0,
      sick_used:        status === 'sick'   ? hoursPerDay : 0,
      commute_override: status === 'commute' ? null : 'no',
      kind:
        status === 'wfh'        ? 'wfh' :
        status === 'conference' ? 'conference' :
        status === 'holiday'    ? 'holiday' :
        null,
      notes,
    };

    for (let d = start; d <= end; d = addDays(d, 1)) {
      await upsertCalendarEntry(formatDate(d), patch);
    }
  } catch (err) {
    console.error(err);
    showToast(`Save failed: ${err.message}`);
  }
});

// --- Formatting ---

const fmtMoney = (n) => `$${Number(n).toFixed(2)}`;
const fmtHours = (n) => `${Number(n).toFixed(2)}h`;
const fmtWeeks = (n) => `${Number(n).toFixed(1)} wk`;
const fmtTileDate = (d) => d ? d.toLocaleDateString('en-US', { month: 'long', day: 'numeric' }) : '—';

// --- Renders ---

// Project all five balance anchors forward to today. Returns the same shape
// as a row from `balances`, but with values reflecting "as of today" instead
// of "as of the anchor date." The projection consumes the calendar and the
// reload_log; events at-or-before each anchor are pure history.
function deriveTodayBalances(s) {
  const b = s.balances;
  const card = projectCardBalances({
    passAnchor:  Number(b.pass_balance),
    cashAnchor:  Number(b.cash_balance),
    anchorDate:  parseDate(b.card_as_of),
    targetDate:  TODAY,
    calendarEntries: s.calendarEntries,
    reloadLog:   s.reloadLog,
    todayTrips:  tripsUsedTodayByTime(),
  });
  const fund = projectFundBalance({
    anchor:      Number(b.fund_balance),
    anchorDate:  parseDate(b.fund_as_of),
    targetDate:  TODAY,
    reloadLog:   s.reloadLog,
  });
  const annual = projectLeaveBalance({
    anchor:      Number(b.annual_balance),
    anchorDate:  parseDate(b.annual_as_of),
    targetDate:  TODAY,
    accrualPerPaycheck: LEAVE.annualAccrual,
    usedField:   'annual_used',
    calendarEntries: s.calendarEntries,
  });
  const sick = projectLeaveBalance({
    anchor:      Number(b.sick_balance),
    anchorDate:  parseDate(b.sick_as_of),
    targetDate:  TODAY,
    accrualPerPaycheck: LEAVE.sickAccrual,
    usedField:   'sick_used',
    calendarEntries: s.calendarEntries,
    cap:         LEAVE.sickCap,
  });
  return {
    pass_balance:   card.pass,
    cash_balance:   card.cash,
    fund_balance:   fund,
    annual_balance: annual,
    sick_balance:   sick,
  };
}

function renderSummary(s) {
  if (!s.balances) { $('#summary-body').textContent = 'Loading…'; return; }
  const today = deriveTodayBalances(s);
  const depletions = projectDepletionDates({
    today: TODAY, balances: today, calendarEntries: s.calendarEntries,
  });

  const tripsNow = tripsAvailable(today.pass_balance, today.cash_balance);
  const cashTrips = Math.floor(today.cash_balance / 4);
  const transitNote = `${tripsNow} trips today (${today.pass_balance} pass + ${cashTrips} cash)`;

  const depletionTiles = depletions.map((d, i) => {
    const label = ['First depletion', 'Second depletion'][i];
    if (!d.depletionDate) {
      return `
        <div class="tile tile-empty">
          <div class="tile-label">${label}</div>
          <div class="tile-value"><span class="empty">No depletion in 2yr</span></div>
          <div class="tile-meta">Healthy runway</div>
        </div>`;
    }
    const breakdown = d.reload ? `
      <div class="tile-breakdown">
        <div class="bd-row"><span class="bd-label">FSA at depletion</span><span class="bd-val">${fmtMoney(d.fundAtDepletion)}</span></div>
        <div class="bd-row"><span class="bd-label">Hypothetical reload</span><span class="bd-val bd-neg">&minus;${fmtMoney(d.reload.spent)}</span></div>
        <div class="bd-row bd-total"><span class="bd-label">FSA after reload</span><span class="bd-val">${fmtMoney(d.fundAtDepletion - d.reload.spent)}</span></div>
      </div>` : `
      <div class="tile-breakdown">
        <div class="bd-row"><span class="bd-label">FSA at depletion</span><span class="bd-val">${fmtMoney(d.fundAtDepletion)}</span></div>
      </div>`;
    return `
      <div class="tile">
        <div class="tile-label">${label}</div>
        <div class="tile-value">${fmtTileDate(d.depletionDate)}</div>
        ${breakdown}
      </div>`;
  }).join('');

  $('#summary-body').innerHTML = `
    <div class="proj-section">
      <div class="proj-section-header">
        <h3>Transit depletion</h3>
        <span class="proj-subnote">${transitNote}</span>
      </div>
      <div class="tiles">${depletionTiles}</div>
    </div>
  `;
}

function renderBalances(s) {
  if (!s.balances) return;
  const today = deriveTodayBalances(s);

  // Forward-project AL/SL one year out so the cards can show today → 1yr.
  const al = projectLeave({
    balanceNow: today.annual_balance,
    accrualPerPaycheck: LEAVE.annualAccrual,
    usedField: 'annual_used',
    today: TODAY,
    calendarEntries: s.calendarEntries,
  });
  const sl = projectLeave({
    balanceNow: today.sick_balance,
    accrualPerPaycheck: LEAVE.sickAccrual,
    usedField: 'sick_used',
    today: TODAY,
    calendarEntries: s.calendarEntries,
    cap: LEAVE.sickCap,
  });
  const oneYearLabel = addDays(TODAY, 365).toLocaleDateString('en-US', { month: 'short', year: 'numeric' });

  const CAP_WARN_RATIO = 0.9;
  const alStatus =
    al.balanceIn1Year > LEAVE.annualCap ? 'danger' :
    al.balanceIn1Year >= LEAVE.annualCap * CAP_WARN_RATIO ? 'warn' :
    '';
  const slStatus =
    sl.lost > 0 ? 'danger' :
    sl.balanceIn1Year >= LEAVE.sickCap * CAP_WARN_RATIO ? 'warn' :
    '';
  const projStatusClass = (status) => status ? ` bc-num--${status}` : '';
  const CAP_TOOLTIPS = {
    al: {
      warn:   `Projected to come within 10% of the ${LEAVE.annualCap}h annual leave cap. Plan time off to avoid hitting it.`,
      danger: `Projection exceeds the ${LEAVE.annualCap}h annual leave cap — you'll stop accruing AL once you hit it. Plan to use leave.`,
    },
    sl: {
      warn:   `Projected to come within 10% of the ${LEAVE.sickCap}h sick leave cap.`,
      danger: `Projection exceeds the ${LEAVE.sickCap}h sick leave cap. Excess hours are forfeit (use-it-or-lose-it).`,
    },
  };
  const projWithTip = (numText, status, kind, tipId) => {
    const numHtml = `<span class="bc-num bc-num--proj${projStatusClass(status)}">${numText}</span>`;
    if (!status) return numHtml;
    const tip = CAP_TOOLTIPS[kind][status];
    return `<span class="proj-tip" tabindex="0" aria-describedby="${tipId}">${numHtml}<span class="app-tooltip" role="tooltip" id="${tipId}">${tip}</span></span>`;
  };

  const slSub = sl.lost > 0
    ? `${fmtWeeks(sl.weeksNow)} → ${fmtWeeks(sl.weeksIn1Year)} · <span class="bc-strong">${fmtHours(sl.lost)} lost to cap</span>`
    : `${fmtWeeks(sl.weeksNow)} → ${fmtWeeks(sl.weeksIn1Year)} by ${oneYearLabel}`;
  const alSub = `${fmtWeeks(al.weeksNow)} → ${fmtWeeks(al.weeksIn1Year)} by ${oneYearLabel}`;

  const transit = `
    <div class="balance-card transit-card">
      <div class="bc-transit-body">
        <div class="bc-transit-metrics">
          <div class="bc-transit-section">
            <div class="bc-label"><span class="bc-emoji">🚌</span> Breeze Card</div>
            <div class="bc-values">
              <div class="bc-pair">
                <span class="bc-num">${today.pass_balance}</span>
                <span class="bc-unit">pass trips</span>
                <span class="bc-cash-aside">+ ${fmtMoney(today.cash_balance)} cash</span>
              </div>
            </div>
          </div>
          <div class="bc-transit-section bc-transit-section--fsa">
            <div class="bc-label"><span class="bc-emoji">💳</span> FSA</div>
            <div class="bc-values">
              <div class="bc-pair">
                <span class="bc-num">${fmtMoney(today.fund_balance)}</span>
                <span class="bc-unit bc-fsa-unit">FSA</span>
              </div>
            </div>
          </div>
        </div>
        <div class="bc-transit-action">
          <button id="log-reload-btn" type="button">Log a reload</button>
        </div>
    </div>`;

  const annual = `
    <div class="balance-card leave-card">
      <div class="bc-label"><span class="bc-label-strong">Current AL</span> <span class="bc-label-arrow">→</span> Projected</div>
      <div class="bc-values">
        <div class="bc-pair">
          <span class="bc-num">${fmtHours(today.annual_balance)}</span>
          <span class="bc-arrow">→</span>
          ${projWithTip(fmtHours(al.balanceIn1Year), alStatus, 'al', 'proj-tip-al')}
        </div>
      </div>
      <div class="bc-sub">${alSub}</div>
    </div>`;

  const sick = `
    <div class="balance-card leave-card">
      <div class="bc-label"><span class="bc-label-strong">Current SL</span> <span class="bc-label-arrow">→</span> Projected</div>
      <div class="bc-values">
        <div class="bc-pair">
          <span class="bc-num">${fmtHours(today.sick_balance)}</span>
          <span class="bc-arrow">→</span>
          ${projWithTip(fmtHours(sl.balanceIn1Year), slStatus, 'sl', 'proj-tip-sl')}
        </div>
      </div>
      <div class="bc-sub">${slSub}</div>
    </div>`;

  $('#balances-body').innerHTML = `
    <div class="balance-grid">${transit}<div class="bc-leave-divider"></div>
      <div class="bc-leave-row">${annual}${sick}</div>
      <div class="bc-leave-more"><button id="leave-history-btn" type="button">More info</button></div>
    </div>`;
}

function renderAgenda(s) {
  if (!s.balances) return;
  const { showHistoric } = s.filters;
  // Historic horizon = Jan 1 of last calendar year.
  // Forward horizon = 8 months out (calendar-month math, not 240 days).
  // Snap start to Monday so the grid's first cell aligns with column 1.
  const lastYearStart = new Date(TODAY.getFullYear() - 1, 0, 1);
  let start = showHistoric ? lastYearStart : new Date(TODAY.getFullYear(), TODAY.getMonth(), TODAY.getDate());
  const dow = start.getDay();
  const offsetToMon = dow === 0 ? -6 : 1 - dow;
  start = addDays(start, offsetToMon);
  const end = new Date(TODAY.getFullYear(), TODAY.getMonth() + 8, TODAY.getDate());

  const items = [];
  let lastMonthKey = null;
  for (let d = new Date(start); d <= end; d = addDays(d, 1)) {
    const wd = d.getDay();
    if (wd === 0 || wd === 6) continue;
    const monthKey = `${d.getFullYear()}-${d.getMonth()}`;
    if (monthKey !== lastMonthKey) {
      items.push({ type: 'banner', date: new Date(d) });
      lastMonthKey = monthKey;
    }
    items.push({ type: 'cell', date: new Date(d), key: formatDate(d), weekday: wd });
  }

  const headerHtml = ['MON', 'TUE', 'WED', 'THU', 'FRI']
    .map(d => `<div class="cal-header">${d}</div>`).join('');

  const bodyHtml = items.map((item) => {
    if (item.type === 'banner') {
      const label = item.date.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
      return `<div class="cal-banner">${label}</div>`;
    }
    const { date, key, weekday } = item;
    const entry = s.calendarEntries.get(key);
    const commute = isCommuteDay(date, entry?.commute_override);
    const holidayName = getHoliday(date);
    const isPast = date < TODAY;
    const isToday = date.getTime() === TODAY.getTime();
    const al = entry?.annual_used ?? 0;
    const sl = entry?.sick_used ?? 0;
    const pill = resolvePill({ commute, al, sl, entry, isHoliday: !!holidayName });
    const note = entry?.notes || holidayName || '';
    const noteDot = note ? `<span class="cal-note" title="${escapeAttr(note)}" aria-label="Has note: ${escapeAttr(note)}"></span>` : '';

    const classes = [
      'cal-cell',
      `cal-month-${date.getMonth() % 2 === 0 ? 'even' : 'odd'}`,
      isPast ? 'past' : '',
      isToday ? 'today' : '',
    ].filter(Boolean).join(' ');

    return `<div class="${classes}" data-date="${key}" style="grid-column-start: ${weekday}">
      <div class="cal-day">${date.getDate()}</div>
      <div class="cal-pill-slot">${pill}</div>
      ${noteDot}
    </div>`;
  }).join('');

  $('#agenda').innerHTML = items.length
    ? `<div class="cal-grid">${headerHtml}${bodyHtml}</div>`
    : '<div class="empty">No days to display.</div>';

  // Scroll today into view, but only once per page load — re-renders shouldn't
  // yank the scroll position out from under the user.
  if (!renderAgenda._didInitialScroll) {
    renderAgenda._didInitialScroll = true;
    if (window.innerWidth >= 900) {
      const todayCell = $(`#agenda .cal-cell.today`);
      if (todayCell) todayCell.scrollIntoView({ block: 'center', behavior: 'auto' });
    }
  }
}

function escapeAttr(s) {
  return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

function resolvePill({ commute, al, sl, entry, isHoliday }) {
  if (al > 0)   return `<span class="pill pill-vacation">Vacation${al !== 7.5 ? ` &middot; ${al}h` : ''}</span>`;
  if (sl > 0)   return `<span class="pill pill-sick">Sick${sl !== 7.5 ? ` &middot; ${sl}h` : ''}</span>`;
  if (entry?.kind === 'holiday' || isHoliday) return `<span class="pill pill-holiday">Holiday</span>`;
  if (commute) return `<span class="pill pill-commute">ATL</span>`;
  if (entry?.kind === 'conference') return `<span class="pill pill-conference">Conference</span>`;
  if (entry?.kind === 'wfh')        return `<span class="pill pill-wfh">WFH</span>`;
  // Heuristic fallback for legacy/fixture entries lacking a `kind` field.
  if (entry?.commute_override === 'no' && (entry.notes || '').toLowerCase().includes('conference')) {
    return `<span class="pill pill-conference">Conference</span>`;
  }
  return `<span class="pill pill-wfh">WFH</span>`;
}

function computeLeaveHistory(calendarEntries) {
  const yr = TODAY.getFullYear();
  const ytdStart  = new Date(yr, 0, 1);
  const lastStart = new Date(yr - 1, 0, 1);
  const lastEnd   = new Date(yr - 1, 11, 31);

  const s = {
    ytd:  { alUsed: 0, slUsed: 0, alAccrued: 0, slAccrued: 0 },
    last: { alUsed: 0, slUsed: 0, alAccrued: 0, slAccrued: 0 },
  };

  for (const [key, entry] of calendarEntries) {
    const d = parseDate(key);
    const al = entry.annual_used ?? 0;
    const sl = entry.sick_used ?? 0;
    if (d >= ytdStart && d <= TODAY) { s.ytd.alUsed += al; s.ytd.slUsed += sl; }
    if (d >= lastStart && d <= lastEnd) { s.last.alUsed += al; s.last.slUsed += sl; }
  }

  let d = new Date(ytdStart);
  while (d <= TODAY) {
    if (isPayPeriodEndSunday(d)) { s.ytd.alAccrued += LEAVE.annualAccrual; s.ytd.slAccrued += LEAVE.sickAccrual; }
    d = addDays(d, 1);
  }
  d = new Date(lastStart);
  while (d <= lastEnd) {
    if (isPayPeriodEndSunday(d)) { s.last.alAccrued += LEAVE.annualAccrual; s.last.slAccrued += LEAVE.sickAccrual; }
    d = addDays(d, 1);
  }
  return s;
}

function openLeaveHistoryDialog() {
  const h = computeLeaveHistory(state.calendarEntries);
  const yr = TODAY.getFullYear();
  const fmtH = (n) => `${Number(n).toFixed(2)}h`;
  const fmtUpDate = (d) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

  const section = (title, stats) => `
    <div class="lh-section">
      <div class="lh-title">${title}</div>
      <div class="lh-grid">
        <div></div>
        <div class="lh-col-head">Annual leave</div>
        <div class="lh-col-head">Sick leave</div>
        <div class="lh-row-head">Used</div>
        <div>${fmtH(stats.alUsed)}</div>
        <div>${fmtH(stats.slUsed)}</div>
        <div class="lh-row-head">Accrued</div>
        <div>${fmtH(stats.alAccrued)}</div>
        <div>${fmtH(stats.slAccrued)}</div>
      </div>
    </div>`;

  const ytdLabel = `YTD · Jan 1 – ${fmtUpDate(TODAY)}, ${yr}`;
  const lastLabel = `${yr - 1} · full year`;

  $('#leave-history-body').innerHTML =
    section(ytdLabel, h.ytd) + section(lastLabel, h.last);

  $('#leave-history-dialog').showModal();
}

function renderUpcoming(s) {
  if (!s.balances) return;
  const HORIZON = 90;
  const fmtUpDate = (d) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

  // Collect note runs (consecutive days with the same note merge into a date span)
  const noteRuns = [];
  for (let i = 1; i <= HORIZON; i++) {
    const date = addDays(TODAY, i);
    const note = s.calendarEntries.get(formatDate(date))?.notes?.trim();
    if (!note) continue;
    const prev = noteRuns[noteRuns.length - 1];
    const consecutive = prev && prev.label === note &&
      addDays(prev.endDate, 1).getTime() === date.getTime();
    if (consecutive) { prev.endDate = date; }
    else { noteRuns.push({ date, endDate: date, label: note, kind: 'note' }); }
  }

  // Holidays — skip days already covered by a note run
  const noteCovered = new Set(noteRuns.flatMap(r => {
    const days = [];
    let d = new Date(r.date);
    while (d <= r.endDate) { days.push(formatDate(d)); d = addDays(d, 1); }
    return days;
  }));
  const holidays = [];
  for (let i = 1; i <= HORIZON; i++) {
    const date = addDays(TODAY, i);
    if (noteCovered.has(formatDate(date))) continue;
    const name = getHoliday(date);
    if (name) holidays.push({ date, endDate: date, label: name, kind: 'holiday' });
  }

  // D1 depletion
  const todayBal = deriveTodayBalances(s);
  const depletions = projectDepletionDates({
    today: TODAY, balances: todayBal, calendarEntries: s.calendarEntries,
  });
  const depletion = depletions[0]?.depletionDate
    ? [{ date: depletions[0].depletionDate, endDate: depletions[0].depletionDate,
         label: 'Transit depletion', kind: 'depletion' }]
    : [];

  const items = [...noteRuns, ...holidays, ...depletion]
    .sort((a, b) => a.date - b.date)
    .slice(0, 4);

  const fmtRange = (item) => {
    if (item.endDate.getTime() === item.date.getTime()) return fmtUpDate(item.date);
    if (item.date.getMonth() === item.endDate.getMonth())
      return `${fmtUpDate(item.date)}–${item.endDate.getDate()}`;
    return `${fmtUpDate(item.date)} – ${fmtUpDate(item.endDate)}`;
  };
  const pill = (kind) => {
    if (kind === 'holiday')   return `<span class="pill pill-holiday">Holiday</span>`;
    if (kind === 'depletion') return `<span class="pill pill-depletion">Depletion</span>`;
    return '';
  };

  $('#upcoming-body').innerHTML = items.length === 0
    ? `<div class="upcoming-empty">Nothing notable in the next 90 days.</div>`
    : items.map(item => `
        <div class="upcoming-item">
          <span class="upcoming-date">${fmtRange(item)}</span>
          <span class="upcoming-label">${item.label}</span>
          ${pill(item.kind)}
        </div>`).join('');
}

subscribe((s) => {
  if (s.loading) return;
  renderSummary(s);
  renderBalances(s);
  renderUpcoming(s);
  renderAgenda(s);
});

// Schedule re-renders at each commute trip threshold (8:00am and 4:00pm ET) so the
// displayed Breeze balance updates automatically when the app is left open.
function msUntilETTime(hour, minute) {
  const now = new Date();
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    hour: 'numeric', minute: 'numeric', second: 'numeric', hour12: false,
  }).formatToParts(now);
  const etHour = +parts.find(p => p.type === 'hour').value % 24;
  const etMinute = +parts.find(p => p.type === 'minute').value;
  const etSecond = +parts.find(p => p.type === 'second').value;
  const secondsUntil = (hour * 3600 + minute * 60) - (etHour * 3600 + etMinute * 60 + etSecond);
  return secondsUntil > 0 ? secondsUntil * 1000 : null;
}

function scheduleThresholdRefresh() {
  const { morning, afternoon } = COMMUTE_TRIP_TIMES_ET;
  for (const t of [morning, afternoon]) {
    const ms = msUntilETTime(t.hour, t.minute);
    if (ms !== null) {
      setTimeout(() => {
        renderSummary(state);
        renderBalances(state);
      }, ms);
    }
  }
}

scheduleThresholdRefresh();
init();
