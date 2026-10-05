-- ============================================================
-- REEL GOLF — Shop hardening (security review #47: M1, M2)
-- ============================================================
-- M1: purchase_item read `coins` without a row lock, so two parallel
--     purchases by the same player could both pass the balance check and
--     drive coins negative. Lock the player row first, and add a CHECK as
--     a database-level backstop.
-- M2: the old seed migration ran `delete from shop_items`, and
--     player_inventory.item_id was ON DELETE CASCADE, so re-seeding wiped
--     every player's purchases. Make the catalog upsert-by-asset_key and
--     make the FK RESTRICT so catalog rows with owners cannot be deleted.
--
-- Safe to re-run (idempotent).

-- ---- M1: coins can never go negative --------------------------------
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.players'::regclass and conname = 'players_coins_nonnegative'
  ) then
    alter table public.players
      add constraint players_coins_nonnegative check (coins >= 0);
  end if;
end $$;

-- ---- M2: stable catalog identity ------------------------------------
alter table public.shop_items alter column asset_key set not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.shop_items'::regclass and conname = 'shop_items_asset_key_key'
  ) then
    alter table public.shop_items
      add constraint shop_items_asset_key_key unique (asset_key);
  end if;
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.shop_items'::regclass and conname = 'shop_items_cost_nonnegative'
  ) then
    alter table public.shop_items
      add constraint shop_items_cost_nonnegative check (cost >= 0);
  end if;
end $$;

-- Deleting a catalog item that players own must now fail, not cascade.
alter table public.player_inventory
  drop constraint if exists player_inventory_item_id_fkey;
alter table public.player_inventory
  add constraint player_inventory_item_id_fkey
  foreign key (item_id) references public.shop_items(id) on delete restrict;

-- Authoritative catalog: upsert by asset_key; ids and purchases are preserved.
insert into public.shop_items (name, description, cost, item_type, asset_key) values
  ('Graphite Rod',   '+10% max drive launch speed',        150, 'ROD',  'graphite_rod'),
  ('Braided Line',   '+20% max line tension tolerance',    200, 'LINE', 'braided_line'),
  ('Super Bait',     'Increases fish bite chance by +25%', 100, 'BAIT', 'super_bait'),
  ('Titanium Reel',  '+20% faster reeling speed',          250, 'REEL', 'titanium_reel'),
  ('Neon Ball',      'Bright neon glow and ball trail',    100, 'SKIN', 'neon_ball')
on conflict (asset_key) do update
  set name        = excluded.name,
      description = excluded.description,
      cost        = excluded.cost,
      item_type   = excluded.item_type;

-- ---- M1: race-free purchase_item ------------------------------------
create or replace function public.purchase_item(p_item_id int)
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

  -- Serialize all of this player's purchases (and round-coin updates):
  -- every later check sees committed state.
  select coins into v_coins from players where id = v_player_id for update;
  if not found then
    raise exception 'Player not found';
  end if;

  if exists (select 1 from player_inventory where player_id = v_player_id and item_id = p_item_id) then
    raise exception 'Item already owned';
  end if;

  select cost into v_cost from shop_items where id = p_item_id;
  if not found then
    raise exception 'Item not found';
  end if;

  if v_coins < v_cost then
    raise exception 'Insufficient coins';
  end if;

  update players set coins = coins - v_cost where id = v_player_id;

  insert into player_inventory (player_id, item_id) values (v_player_id, p_item_id);
end;
$$;

-- Keep the grants from 20261005000000 (CREATE OR REPLACE preserves them,
-- restated here so this file is self-contained).
revoke all on function public.purchase_item(int) from public, anon;
grant execute on function public.purchase_item(int) to authenticated;

notify pgrst, 'reload schema';
