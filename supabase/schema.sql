-- DepletionSked schema — single-user, magic-link auth, RLS enabled.
-- The anon key is exposed in the client bundle (GitHub Pages), so RLS ensures
-- only the authenticated session owner can read or write any row.
-- Policies use `to authenticated` with `using (true)` — no per-row user_id
-- needed because this is a single-user app.
--
-- Run this once in the Supabase SQL editor. Drops any existing tables first,
-- so it's safe to re-run during early development.

drop table if exists public.reload_log        cascade;
drop table if exists public.calendar_entries  cascade;
drop table if exists public.balances          cascade;

-- 1. Balance anchors. Each *_balance column is the value as of its companion
-- *_as_of date; the displayed "current" value is projected forward from there
-- using the calendar + reload_log + accrual rules. Pass + cash share one anchor
-- (the card has one physical state). FSA, annual, and sick each anchor independently.
create table public.balances (
  id              smallint    primary key default 1 check (id = 1),
  pass_balance    integer     not null default 0  check (pass_balance >= 0),
  cash_balance    numeric     not null default 0  check (cash_balance >= 0),
  card_as_of      date        not null default current_date,
  fund_balance    numeric     not null default 0  check (fund_balance >= 0),
  fund_as_of      date        not null default current_date,
  annual_balance  numeric     not null default 0  check (annual_balance >= 0),
  annual_as_of    date        not null default current_date,
  sick_balance    numeric     not null default 0  check (sick_balance  >= 0),
  sick_as_of      date        not null default current_date,
  updated_at      timestamptz not null default now()
);

-- 2. Calendar overrides — sparse. A date with no row inherits the default rule.
create table public.calendar_entries (
  date              date        primary key,
  commute_override  text        check (commute_override in ('yes', 'no')),
  annual_used       numeric     not null default 0 check (annual_used >= 0),
  sick_used         numeric     not null default 0 check (sick_used   >= 0),
  kind              text        check (kind in ('wfh', 'conference', 'holiday')),
  notes             text,
  updated_at        timestamptz not null default now()
);

-- 3. Reload log — append-only history of MARTA-card reloads. Reloads after the
-- card_as_of date contribute to the projected pass/cash; reloads after fund_as_of
-- subtract from projected FSA. Reloads at or before the anchor are pure history.
create table public.reload_log (
  id              bigserial   primary key,
  reload_date     date        not null,
  booklets_added  integer     not null check (booklets_added >= 0),
  cash_added      numeric     not null check (cash_added     >= 0),
  fsa_spent       numeric     not null check (fsa_spent      >= 0),
  notes           text,
  created_at      timestamptz not null default now()
);

create index reload_log_date_idx on public.reload_log (reload_date desc);

-- RLS: block unauthenticated access. Policies are permissive for any
-- authenticated session — no per-row user_id filter needed (single user).
alter table public.balances         enable row level security;
alter table public.calendar_entries enable row level security;
alter table public.reload_log       enable row level security;

create policy "authenticated full access" on public.balances
  for all to authenticated using (true) with check (true);

create policy "authenticated full access" on public.calendar_entries
  for all to authenticated using (true) with check (true);

create policy "authenticated full access" on public.reload_log
  for all to authenticated using (true) with check (true);
