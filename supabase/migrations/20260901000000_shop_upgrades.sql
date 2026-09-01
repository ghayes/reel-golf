-- ============================================================
-- REEL GOLF — Shop & Upgrades System Migration
-- ============================================================

-- 1. Ensure submit_round awards coins based on round score
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

  -- Update cumulative player stats atomically including earned coins
  update players
  set
    total_score = total_score + p_score,
    coins = coalesce(coins, 0) + p_score,
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

-- 2. Seed shop catalog items (upsert by asset_key)
delete from shop_items;

insert into shop_items (name, description, cost, item_type, asset_key) values
  ('Graphite Rod', '+10% max drive launch speed', 150, 'ROD', 'graphite_rod'),
  ('Braided Line', '+20% max line tension tolerance', 200, 'LINE', 'braided_line'),
  ('Super Bait', 'Increases fish bite chance by +25%', 100, 'BAIT', 'super_bait'),
  ('Titanium Reel', '+20% faster reeling speed', 250, 'REEL', 'titanium_reel'),
  ('Neon Ball', 'Bright neon glow and ball trail', 100, 'SKIN', 'neon_ball');

-- 3. Table & routine permissions for client roles
grant select on public.shop_items to anon, authenticated;
grant select on public.player_inventory to authenticated;
grant execute on function public.purchase_item(int) to authenticated;
grant execute on function public.submit_round(int, numeric, int, jsonb, boolean, int) to authenticated, anon;
