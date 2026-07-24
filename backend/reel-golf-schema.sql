-- ============================================================
-- DOCK GOLF — Supabase schema sketch
-- Paste into the Supabase SQL editor (Database → SQL Editor)
-- ============================================================

-- 1. PLAYERS
-- Supabase Auth already creates a private auth.users table when
-- someone signs up. This table is the public profile that sits
-- next to it — one row per player, keyed to their auth id.
create table players (
  id            uuid primary key references auth.users(id) on delete cascade,
  username      text unique not null,
  created_at    timestamptz not null default now(),
  total_score   bigint not null default 0,   -- lifetime sum, for the trophy wall
  best_distance numeric not null default 0,  -- longest single drive, in yards
  balls_played  int not null default 0
);

-- 2. ROUNDS
-- One row per playthrough (a "round" = however many balls you get,
-- e.g. the 3-ball session in the current prototype).
create table rounds (
  id           uuid primary key default gen_random_uuid(),
  player_id    uuid not null references players(id) on delete cascade,
  score        int not null,
  fish_caught  int not null default 0,
  played_at    timestamptz not null default now()
);

-- 3. CATCHES
-- One row per fish actually landed (not every strike — only ones
-- where the fish's stamina hit zero and it made it to the dock).
create table catches (
  id           uuid primary key default gen_random_uuid(),
  player_id    uuid not null references players(id) on delete cascade,
  round_id     uuid not null references rounds(id) on delete cascade,
  species      text not null check (species in ('PERCH','BASS','PIKE')),
  distance_yd  numeric not null,   -- how far out it was hooked
  bonus_points int not null,
  caught_at    timestamptz not null default now()
);

-- 4. TROPHIES
-- trophy_defs is your fixed list of badges. player_trophies is the
-- join table recording who has earned which one, and when.
create table trophy_defs (
  code        text primary key,          -- e.g. 'first_pike'
  name        text not null,             -- "First Pike"
  description text not null,             -- "Land your first pike"
  icon        text                       -- emoji or asset key, e.g. '🐊'
);

create table player_trophies (
  player_id   uuid not null references players(id) on delete cascade,
  trophy_code text not null references trophy_defs(code) on delete cascade,
  earned_at   timestamptz not null default now(),
  primary key (player_id, trophy_code)
);

-- Starter trophy set, tied to things the game can already detect
insert into trophy_defs (code, name, description, icon) values
  ('first_fish',    'First Bite',        'Land your first fish',                       '🐟'),
  ('first_pike',    'Lunker',            'Land your first pike',                       '🐊'),
  ('double_ring',   'Ringer',            'Score a 2× ring shot',                       '🎯'),
  ('long_drive_150','Dock to Deep Water','Hit a drive over 150 yards',                 '⛳'),
  ('snap_five',     'Line Breaker',      'Snap the line five times (we all did it)',   '💥'),
  ('century_score', 'Century Club',      'Score 100+ points in a single round',        '🏆');

-- ============================================================
-- ROW LEVEL SECURITY
-- Supabase turns this on per table. Rule of thumb for a game like
-- this: everyone can READ everyone's public stats (that's what
-- powers the trophy wall / leaderboard), but you can only WRITE
-- your own rows.
-- ============================================================
alter table players         enable row level security;
alter table rounds          enable row level security;
alter table catches         enable row level security;
alter table trophy_defs     enable row level security;
alter table player_trophies enable row level security;

create policy "public read: players"     on players     for select using (true);
create policy "public read: rounds"      on rounds      for select using (true);
create policy "public read: catches"     on catches     for select using (true);
create policy "public read: trophy_defs" on trophy_defs for select using (true);
create policy "public read: trophies"    on player_trophies for select using (true);

create policy "self insert: players" on players
  for insert with check (auth.uid() = id);
create policy "self write: players"  on players
  for update using (auth.uid() = id);
create policy "self insert: rounds"  on rounds
  for insert with check (auth.uid() = player_id);
create policy "self insert: catches" on catches
  for insert with check (auth.uid() = player_id);
create policy "self insert: trophies" on player_trophies
  for insert with check (auth.uid() = player_id);

-- ============================================================
-- TROPHY WALL VIEW
-- One query the frontend can call directly for the wall/leaderboard.
-- ============================================================
create view trophy_wall as
select
  p.username,
  p.total_score,
  p.best_distance,
  count(distinct c.id)                     as total_catches,
  count(distinct c.id) filter (where c.species = 'PIKE') as pikes_landed,
  array_agg(distinct pt.trophy_code)        as trophies
from players p
left join catches c on c.player_id = p.id
left join player_trophies pt on pt.player_id = p.id
group by p.id
order by p.total_score desc;
