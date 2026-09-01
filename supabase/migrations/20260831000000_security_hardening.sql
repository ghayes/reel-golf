-- ============================================================
-- REEL GOLF — Security & RLS Hardening Migration
-- ============================================================

-- 1. ENSURE SHOP TABLES & COLUMNS EXIST
alter table players add column if not exists coins int not null default 0;

create table if not exists shop_items (
  id          serial primary key,
  name        text not null,
  description text,
  cost        int not null,
  item_type   text not null, -- 'ROD', 'BAIT', 'SKIN'
  asset_key   text           -- reference to game asset
);

create table if not exists player_inventory (
  player_id   uuid not null references players(id) on delete cascade,
  item_id     int not null references shop_items(id) on delete cascade,
  purchased_at timestamptz not null default now(),
  primary key (player_id, item_id)
);

-- 2. TROPHY DEFS UPDATE
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

-- 3. HARDEN PLAYER & INVENTORY RLS POLICIES
alter table players         enable row level security;
alter table rounds          enable row level security;
alter table catches         enable row level security;
alter table trophy_defs     enable row level security;
alter table player_trophies enable row level security;
alter table shop_items      enable row level security;
alter table player_inventory enable row level security;

drop policy if exists "public read: players" on players;
drop policy if exists "public read: rounds" on rounds;
drop policy if exists "public read: catches" on catches;
drop policy if exists "public read: trophy_defs" on trophy_defs;
drop policy if exists "public read: trophies" on player_trophies;
drop policy if exists "public read: shop_items" on shop_items;
drop policy if exists "self read: inventory" on player_inventory;

drop policy if exists "self insert: players" on players;
drop policy if exists "self write: players" on players;
drop policy if exists "self update username: players" on players;
drop policy if exists "self insert: rounds" on rounds;
drop policy if exists "self insert: catches" on catches;
drop policy if exists "self insert: trophies" on player_trophies;
drop policy if exists "self insert: inventory" on player_inventory;

create policy "public read: players"     on players     for select using (true);
create policy "public read: rounds"      on rounds      for select using (true);
create policy "public read: catches"     on catches     for select using (true);
create policy "public read: trophy_defs" on trophy_defs for select using (true);
create policy "public read: trophies"    on player_trophies for select using (true);
create policy "public read: shop_items"  on shop_items  for select using (true);
create policy "self read: inventory"    on player_inventory for select using (auth.uid() = player_id);

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

-- Note: Direct client INSERT on player_inventory is intentionally omitted to prevent
-- players from bypassing purchase_item() RPC to acquire items for free.

-- 4. SECURE SUBMIT ROUND RPC
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

  -- Update cumulative player stats atomically
  update players
  set
    total_score = total_score + p_score,
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

-- 5. HARDENED PURCHASE RPC
create or replace function purchase_item(p_item_id int)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
    v_cost int;
    v_player_id uuid;
    v_coins int;
begin
    v_player_id := auth.uid();
    if v_player_id is null then
        raise exception 'Not authenticated';
    end if;

    -- Check if player already owns the item
    if exists (select 1 from player_inventory where player_id = v_player_id and item_id = p_item_id) then
        raise exception 'Item already owned';
    end if;

    -- Get the cost of the item
    select cost into v_cost from shop_items where id = p_item_id;
    if not found then
        raise exception 'Item not found';
    end if;

    -- Check player coins
    select coins into v_coins from players where id = v_player_id;
    if v_coins is null or v_coins < v_cost then
        raise exception 'Insufficient coins';
    end if;

    -- Deduct coins
    update players
    set coins = coins - v_cost
    where id = v_player_id;

    -- Grant the item
    insert into player_inventory (player_id, item_id)
    values (v_player_id, p_item_id);
end;
$$;

-- 6. TROPHY WALL VIEW UPDATE
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
