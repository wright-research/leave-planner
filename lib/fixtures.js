// Seed data for DEMO_MODE. Mirrors the state of the spreadsheet as of 2026-04-22.
// Calendar entries include the full historical log from Jan–Apr 2026 plus the
// forward-looking PTO/holidays already planned in the spreadsheet.
//
// When Supabase is wired up, this file becomes the backfill source for initial
// population, after which it's no longer needed.

// Anchor values + as-of dates. Displayed balances project forward from these
// using the calendar + reload_log + accrual rules. The spreadsheet snapshot
// dates everything at 2026-04-22.
export const DEMO_BALANCES = {
  pass_balance: 20,
  cash_balance: 96,
  card_as_of:   '2026-04-22',
  fund_balance: 221.79,
  fund_as_of:   '2026-04-22',
  annual_balance: 115.25,
  annual_as_of:   '2026-04-22',
  sick_balance: 119.75,
  sick_as_of:   '2026-04-22',
};

// Array of rows matching the `calendar_entries` schema.
export const DEMO_CALENDAR = [
  // January
  { date: '2026-01-22', commute_override: null, annual_used: 0, sick_used: 3.75, notes: null },
  { date: '2026-01-26', commute_override: 'no', annual_used: 0, sick_used: 0, notes: 'Ice day!' },
  { date: '2026-01-27', commute_override: 'no', annual_used: 0, sick_used: 0, notes: 'Ice day, part deux!' },
  // February
  { date: '2026-02-11', commute_override: 'no', annual_used: 0, sick_used: 7.5,  notes: "Jessa's tooth extraction" },
  // March
  { date: '2026-03-03', commute_override: 'no', annual_used: 0, sick_used: 3.75, notes: 'Weber dental' },
  { date: '2026-03-16', commute_override: 'no', annual_used: 0, sick_used: 0,    notes: 'Severe weather' },
  { date: '2026-03-18', commute_override: 'yes', annual_used: 0, sick_used: 0,   notes: null },
  { date: '2026-03-24', commute_override: 'no', annual_used: 0, sick_used: 0, kind: 'conference', notes: 'UGA conference' },
  { date: '2026-03-25', commute_override: 'no', annual_used: 0, sick_used: 0, kind: 'conference', notes: 'UGA conference' },
  // April
  { date: '2026-04-06', commute_override: 'no', annual_used: 7.5, sick_used: 0,  notes: 'SB - 807' },
  { date: '2026-04-07', commute_override: 'no', annual_used: 7.5, sick_used: 0,  notes: 'SB - 807' },
  { date: '2026-04-08', commute_override: 'no', annual_used: 7.5, sick_used: 0,  notes: 'SB - 807' },
  { date: '2026-04-15', commute_override: 'no', annual_used: 0,   sick_used: 0,  notes: 'Sick' },
  // Forward-looking planned PTO / holidays
  { date: '2026-05-25', commute_override: 'no', annual_used: 0, sick_used: 0, kind: 'holiday', notes: 'Memorial Day' },
  { date: '2026-06-29', commute_override: 'no', annual_used: 7.5, sick_used: 0, notes: 'Diz' },
  { date: '2026-06-30', commute_override: 'no', annual_used: 7.5, sick_used: 0, notes: 'Diz' },
  { date: '2026-07-01', commute_override: 'no', annual_used: 7.5, sick_used: 0, notes: 'Diz' },
  { date: '2026-07-13', commute_override: 'no', annual_used: 0, sick_used: 0, kind: 'conference', notes: 'SciPy conference' },
  { date: '2026-07-14', commute_override: 'no', annual_used: 0, sick_used: 0, kind: 'conference', notes: 'SciPy conference' },
  { date: '2026-07-15', commute_override: 'no', annual_used: 0, sick_used: 0, kind: 'conference', notes: 'SciPy conference' },
  { date: '2026-09-07', commute_override: 'no', annual_used: 0, sick_used: 0, kind: 'holiday', notes: 'Labor Day' },
  { date: '2026-11-11', commute_override: 'no', annual_used: 0, sick_used: 0, kind: 'holiday', notes: "Veteran's Day" },
  { date: '2026-11-23', commute_override: 'no', annual_used: 0, sick_used: 0, kind: 'holiday', notes: "T'giving week" },
  { date: '2026-11-24', commute_override: 'no', annual_used: 0, sick_used: 0, kind: 'holiday', notes: "T'giving week" },
  { date: '2026-11-25', commute_override: 'no', annual_used: 0, sick_used: 0, kind: 'holiday', notes: "T'giving week" },
  { date: '2026-12-21', commute_override: 'no', annual_used: 0, sick_used: 0, kind: 'holiday', notes: 'Office closed' },
  { date: '2026-12-22', commute_override: 'no', annual_used: 0, sick_used: 0, kind: 'holiday', notes: 'Office closed' },
  { date: '2026-12-23', commute_override: 'no', annual_used: 0, sick_used: 0, kind: 'holiday', notes: 'Office closed' },
  { date: '2026-12-28', commute_override: 'no', annual_used: 7.5, sick_used: 0, notes: 'Isle of Palms?' },
  { date: '2026-12-29', commute_override: 'no', annual_used: 7.5, sick_used: 0, notes: 'Isle of Palms?' },
  { date: '2026-12-30', commute_override: 'no', annual_used: 0, sick_used: 0, kind: 'wfh', notes: 'Remote work' },
];

export const DEMO_RELOAD_LOG = [];
