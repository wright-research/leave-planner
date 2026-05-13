// Constants that rarely change. Edit here when policy changes (e.g., leave accrual
// rate bumps to 5.5 in ~2 years). Not exposed in the UI.

export const TRIP_COSTS = {
  pass: 3.50,   // one-way from a 10-pass booklet
  cash: 4.00,   // one-way from stored cash value
};

export const CARD_CAPS = {
  booklets: 7,     // max booklets the new card can hold
  cashValue: 100,  // max stored cash value in dollars
};

export const BOOKLET_COST = 35;          // price of a 10-pass booklet
export const TRIPS_PER_BOOKLET = 10;
export const MAX_RELOAD_COST =            // full card refill from empty
  CARD_CAPS.booklets * BOOKLET_COST + CARD_CAPS.cashValue;  // 345

export const COMMUTE_DEFAULT_DAYS = [1, 2, 3];  // Mon, Tue, Wed (0 = Sun)
export const TRIPS_PER_COMMUTE_DAY = 2;

export const FSA = {
  paycheckContribution: 16.25,   // per paycheck
  arcContribution: 40,           // monthly, on the 1st
};

// Paycheck cadence: biweekly Fridays, anchored to this date.
export const PAYCHECK_ANCHOR = '2026-01-02';

// Leave accrual cadence: biweekly Sundays (pay period end), anchored to this date.
export const LEAVE_ACCRUAL_ANCHOR = '2026-01-11';

export const LEAVE = {
  annualAccrual: 4.5,   // hours per paycheck
  sickAccrual:   3.0,   // hours per paycheck
  annualCap:     360,   // agency cap on AL hours
  sickCap:       525,   // use-it-or-lose-it; projections clip here
  hoursPerWeek:  37.5,
};

// FSA contribution rule: deposits land on the 1st and 2nd paycheck-Fridays of each
// calendar month. If a month has 3 paycheck-Fridays (happens ~2x/year), skip the 3rd.
export const FSA_PAYCHECKS_PER_MONTH_CAP = 2;

// Time-of-day thresholds (US Eastern, handles DST) used to approximate which Breeze
// trips have actually been tapped on a commute day. Inbound assumed complete at 8:00am;
// outbound at 4:00pm.
export const COMMUTE_TRIP_TIMES_ET = {
  morning:   { hour: 8,  minute: 0 },
  afternoon: { hour: 16, minute: 0 },
};
