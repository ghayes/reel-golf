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
  ('century_score', 'Century Club',      'Score 100+ points in a single round',        '🏆'),
  ('thousand_score','Grand Slam',        'Score 1000+ points in a single round',       '👑')
on conflict (code) do update set
  name = excluded.name,
  description = excluded.description,
  icon = excluded.icon;

-- ============================================================
-- ROW LEVEL SECURITY
-- Everyone can READ public stats (trophy wall / leaderboard).
-- Writes are restricted or executed via secure RPCs.
-- ============================================================
alter table players         enable row level security;
alter table rounds          enable row level security;
alter table catches         enable row level security;
alter table trophy_defs     enable row level security;
alter table player_trophies enable row level security;

drop policy if exists "public read: players" on players;
drop policy if exists "public read: rounds" on rounds;
drop policy if exists "public read: catches" on catches;
drop policy if exists "public read: trophy_defs" on trophy_defs;
drop policy if exists "public read: trophies" on player_trophies;

drop policy if exists "self insert: players" on players;
drop policy if exists "self write: players" on players;
drop policy if exists "self update username: players" on players;
drop policy if exists "self insert: rounds" on rounds;
drop policy if exists "self insert: catches" on catches;
drop policy if exists "self insert: trophies" on player_trophies;

create policy "public read: players"     on players     for select using (true);
create policy "public read: rounds"      on rounds      for select using (true);
create policy "public read: catches"     on catches     for select using (true);
create policy "public read: trophy_defs" on trophy_defs for select using (true);
create policy "public read: trophies"    on player_trophies for select using (true);

create policy "self insert: players" on players
  for insert with check (auth.uid() = id);

-- Restrict direct player updates to username changes only
create policy "self update username: players" on players
  for update using (auth.uid() = id)
  with check (auth.uid() = id);

create policy "self insert: rounds"  on rounds
  for insert with check (auth.uid() = player_id);
create policy "self insert: catches" on catches
  for insert with check (auth.uid() = player_id);
create policy "self insert: trophies" on player_trophies
  for insert with check (auth.uid() = player_id);

-- ============================================================
-- SECURE SUBMIT ROUND RPC
-- Server-side validation and atomic stat update.
-- ============================================================
create or replace function submit_round(
  p_score int,
  p_best_dist numeric,
  p_fish_caught int,
  p_catches jsonb default '[]'::jsonb,
  p_ring2x boolean default false,
  p_lifetime_snaps int default 0
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_player_id uuid;
  v_round_id uuid;
  v_catch jsonb;
  v_trophies text[] := '{}';
  v_code text;
begin
  v_player_id := auth.uid();
  if v_player_id is null then
    raise exception 'Not authenticated';
  end if;

  -- Update cumulative player stats atomically (1 coin per 10 points)
  update players
  set
    total_score = total_score + p_score,
    coins = coalesce(coins, 0) + greatest(0, p_score / 10),
    best_distance = greatest(best_distance, p_best_dist),
    balls_played = balls_played + 3
  where id = v_player_id;

  -- Create round record
  insert into rounds (player_id, score, fish_caught)
  values (v_player_id, p_score, p_fish_caught)
  returning id into v_round_id;

  -- Insert catches if present
  if jsonb_array_length(p_catches) > 0 then
    for v_catch in select * from jsonb_array_elements(p_catches) loop
      insert into catches (player_id, round_id, species, distance_yd, bonus_points)
      values (
        v_player_id,
        v_round_id,
        v_catch->>'species',
        (v_catch->>'distance_yd')::numeric,
        (v_catch->>'bonus_points')::int
      );
    end loop;
  end if;

  -- Trophy eligibility checks
  if p_fish_caught > 0 then v_trophies := array_append(v_trophies, 'first_fish'); end if;
  if exists (select 1 from jsonb_array_elements(p_catches) c where c->>'species' = 'PIKE') then
    v_trophies := array_append(v_trophies, 'first_pike');
  end if;
  if p_ring2x then v_trophies := array_append(v_trophies, 'double_ring'); end if;
  if p_best_dist >= 150 then v_trophies := array_append(v_trophies, 'long_drive_150'); end if;
  if p_score >= 100 then v_trophies := array_append(v_trophies, 'century_score'); end if;
  if p_score >= 1000 then v_trophies := array_append(v_trophies, 'thousand_score'); end if;
  if p_lifetime_snaps >= 5 then v_trophies := array_append(v_trophies, 'snap_five'); end if;

  -- Award trophies safely
  foreach v_code in array v_trophies loop
    insert into player_trophies (player_id, trophy_code)
    values (v_player_id, v_code)
    on conflict (player_id, trophy_code) do nothing;
  end loop;

  return v_round_id;
end;
$$;

-- ============================================================
-- TROPHY WALL VIEW
-- One query the frontend can call directly for the wall/leaderboard.
-- ============================================================
create or replace view trophy_wall as
select
  p.username,
  p.total_score,
  p.best_distance,
  count(distinct c.id)                     as total_catches,
  count(distinct c.id) filter (where c.species = 'PIKE') as pikes_landed,
  coalesce(array_agg(distinct pt.trophy_code) filter (where pt.trophy_code is not null), '{}') as trophies
from players p
left join catches c on c.player_id = p.id
left join player_trophies pt on pt.player_id = p.id
group by p.id
order by p.total_score desc;
