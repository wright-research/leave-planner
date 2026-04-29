// Federal/agency holidays observed by the user's employer.
// Computed per year, cached. A holiday day:
//   - is treated as not-a-commute-day (no transit consumed)
//   - shows the Vacation pill in the agenda
//   - does NOT deplete annual leave (no AL hours are written)
//
// Weekend rule: if a fixed-date holiday lands on Saturday, observe the prior
// Friday; on Sunday, observe the following Monday.
//
// Christmas: a five-day Mon–Fri block "surrounding" Dec 25. If Dec 25 is on a
// weekday, it's the workweek containing Dec 25. If Saturday, the workweek
// ending Fri Dec 24. If Sunday, the workweek starting Mon Dec 26.

function addDays(d, n) {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}

function nthWeekdayOf(year, month, weekday, n) {
  const first = new Date(year, month - 1, 1);
  const offset = (weekday - first.getDay() + 7) % 7;
  return new Date(year, month - 1, 1 + offset + (n - 1) * 7);
}

function lastWeekdayOf(year, month, weekday) {
  const lastDay = new Date(year, month, 0).getDate();
  const last = new Date(year, month - 1, lastDay);
  const offset = (last.getDay() - weekday + 7) % 7;
  return new Date(year, month - 1, lastDay - offset);
}

function observed(d) {
  const wd = d.getDay();
  if (wd === 6) return addDays(d, -1); // Sat -> prior Fri
  if (wd === 0) return addDays(d, 1);  // Sun -> next Mon
  return d;
}

function christmasWeek(year) {
  const dec25 = new Date(year, 11, 25);
  const wd = dec25.getDay();
  let monday;
  if (wd >= 1 && wd <= 5)      monday = addDays(dec25, -(wd - 1)); // workweek containing Dec 25
  else if (wd === 6)           monday = addDays(dec25, -5);        // Dec 25 Sat → prior Mon-Fri
  else /* wd === 0 */          monday = addDays(dec25, 1);         // Dec 25 Sun → next Mon-Fri
  return [0, 1, 2, 3, 4].map((i) => addDays(monday, i));
}

function fmt(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

const cache = new Map();

function buildYear(year) {
  const map = new Map();
  const add = (d, name) => map.set(fmt(d), name);

  add(observed(new Date(year, 0, 1)), "New Year's Day");
  add(nthWeekdayOf(year, 1, 1, 3), 'MLK Day');
  add(lastWeekdayOf(year, 5, 1), 'Memorial Day');
  add(observed(new Date(year, 5, 19)), 'Juneteenth');
  add(observed(new Date(year, 6, 4)), 'Independence Day');
  add(nthWeekdayOf(year, 9, 1, 1), 'Labor Day');
  const thx = nthWeekdayOf(year, 11, 4, 4);
  add(thx, 'Thanksgiving');
  add(addDays(thx, 1), 'Day after Thanksgiving');
  for (const d of christmasWeek(year)) add(d, 'Christmas week');

  // Cross-year edge: if next year's Jan 1 falls on a Saturday, the observed
  // New Year's lands on Dec 31 of THIS year.
  const nextJan1 = new Date(year + 1, 0, 1);
  if (nextJan1.getDay() === 6) add(addDays(nextJan1, -1), "New Year's Day (observed)");

  return map;
}

function holidaysFor(year) {
  if (!cache.has(year)) cache.set(year, buildYear(year));
  return cache.get(year);
}

export function getHoliday(date) {
  return holidaysFor(date.getFullYear()).get(fmt(date)) ?? null;
}

export function isHoliday(date) {
  return getHoliday(date) !== null;
}
