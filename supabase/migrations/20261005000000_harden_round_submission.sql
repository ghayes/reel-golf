-- ============================================================
-- REEL GOLF — Lock round/catch/trophy writes + validate submit_round  (#47 H1, H2)
-- ============================================================
-- H1: authenticated users could INSERT straight into rounds / catches /
--     player_trophies (RLS only checked auth.uid() = player_id). Fake rows
--     and any trophy could be minted from the browser. After this migration
--     those tables are written only by the SECURITY DEFINER RPC submit_round.
--
-- H2: submit_round trusted every argument. It now validates against the
--     game's actual rules (see constants below), derives fish_caught from the
--     catches, tracks snaps server-side, rate-limits per player, and is no
--     longer executable by anon.
--
-- DEPLOY ORDER: apply this migration BEFORE shipping the client that sends
-- p_round_snaps. Older clients (6 named args) keep working: p_lifetime_snaps
-- is still accepted but ignored.
--
-- Limits: this bounds what a tampered client can claim; it cannot prove a round
-- was actually played (that would need server-side game verification).
--
-- Safe to re-run.

-- ---------- H1 ----------
drop policy if exists "self insert: rounds"   on public.rounds;
drop policy if exists "self insert: catches"  on public.catches;
drop policy if exists "self insert: trophies" on public.player_trophies;

revoke insert, update, delete on public.rounds          from public, anon, authenticated;
revoke insert, update, delete on public.catches         from public, anon, authenticated;
revoke insert, update, delete on public.player_trophies from public, anon, authenticated;

-- ---------- H2 ----------
-- Server-side snap counter (replaces the client-supplied localStorage count).
-- Not granted to clients, so only submit_round can change it.
alter table public.players add column if not exists lifetime_snaps int not null default 0;

drop function if exists public.submit_round(integer, numeric, integer, jsonb, boolean, integer);
drop function if exists public.submit_round(integer, numeric, integer, jsonb, boolean, integer, integer);

create function public.submit_round(
  p_score          integer,
  p_best_dist      numeric,
  p_fish_caught    integer,
  p_catches        jsonb   default '[]'::jsonb,
  p_ring2x         boolean default false,
  p_lifetime_snaps integer default 0,   -- DEPRECATED: ignored (kept so older clients still call it)
  p_round_snaps    integer default 0
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  -- Game rules mirrored from game.js. Keep in sync if the game changes.
  c_balls        constant int     := 3;      -- balls per round
  c_max_line_yd  constant numeric := 225;    -- MAX_LINE_YD: longer casts snap, so never score
  c_min_gap      constant interval := interval '20 seconds';  -- shortest real round seen: ~93s
  c_hourly_max   constant int     := 60;

  v_player_id    uuid := auth.uid();
  v_ring2x       boolean := coalesce(p_ring2x, false);
  v_round_snaps  int := coalesce(p_round_snaps, 0);
  v_round_id     uuid;
  v_catch        jsonb;
  v_n            int;
  v_species      text;
  v_dist         numeric;
  v_bonus        int;
  v_expected     int;
  v_tier_ok      boolean;
  v_bonus_sum    int := 0;
  v_last         timestamptz;
  v_recent       int;
  v_snaps_total  int;
  v_trophies     text[] := '{}';
  v_code         text;
begin
  if v_player_id is null then
    raise exception 'Not authenticated';
  end if;

  if p_score is null or p_best_dist is null or p_fish_caught is null or p_catches is null then
    raise exception 'Invalid round';
  end if;

  -- Serialise per player so concurrent calls cannot slip past the rate limit.
  perform 1 from public.players where id = v_player_id for update;
  if not found then
    raise exception 'No player profile';
  end if;

  select max(played_at), count(*) filter (where played_at > now() - interval '1 hour')
    into v_last, v_recent
    from public.rounds where player_id = v_player_id;
  if v_last is not null and v_last > now() - c_min_gap then
    raise exception 'Too many rounds submitted; slow down';
  end if;
  if v_recent >= c_hourly_max then
    raise exception 'Hourly round limit reached';
  end if;

  -- Scalar bounds
  if p_score < 0 or p_best_dist < 0 or p_best_dist > c_max_line_yd then
    raise exception 'Invalid round';
  end if;

  if jsonb_typeof(p_catches) <> 'array' then
    raise exception 'Invalid round';
  end if;
  v_n := jsonb_array_length(p_catches);
  -- At most one catch per ball, and fish_caught must equal the catches provided.
  if v_n > c_balls or v_n <> p_fish_caught then
    raise exception 'Invalid round';
  end if;

  -- Every ball is either landed or snapped; a catch needs a landed ball.
  if v_round_snaps < 0 or v_round_snaps > c_balls - v_n then
    raise exception 'Invalid round';
  end if;
  -- Any points (or a ring bonus) need at least one landed ball.
  if (p_score > 0 or v_ring2x) and v_round_snaps > c_balls - 1 then
    raise exception 'Invalid round';
  end if;
  if v_ring2x and p_score = 0 then
    raise exception 'Invalid round';
  end if;

  -- Validate each catch against the game's fish tiers (makeFish in game.js).
  for v_catch in select * from jsonb_array_elements(p_catches) loop
    if jsonb_typeof(v_catch) <> 'object' then
      raise exception 'Invalid round';
    end if;
    begin
      v_species := v_catch->>'species';
      v_dist    := (v_catch->>'distance_yd')::numeric;
      v_bonus   := (v_catch->>'bonus_points')::int;
    exception when others then
      raise exception 'Invalid round';
    end;
    if v_species is null or v_dist is null or v_bonus is null then
      raise exception 'Invalid round';
    end if;

    -- distance_yd is Math.round(distYd) in the client, so tier edges are inclusive.
    case v_species
      when 'PERCH' then v_expected := 50;  v_tier_ok := v_dist <= 60;
      when 'BASS'  then v_expected := 150; v_tier_ok := v_dist >= 60 and v_dist <= 110;
      when 'PIKE'  then v_expected := 400; v_tier_ok := v_dist >= 110;
      else raise exception 'Invalid round';
    end case;

    if not v_tier_ok
       or v_bonus <> v_expected
       or v_dist <> round(v_dist)
       or v_dist < 0 or v_dist > c_max_line_yd
       or v_dist > ceil(p_best_dist)          -- a catch cannot be farther than the best cast
    then
      raise exception 'Invalid round';
    end if;

    v_bonus_sum := v_bonus_sum + v_bonus;
  end loop;

  -- Max score: every ball lands at the best distance with the 2x ring, plus fish bonuses.
  if p_score > c_balls * 2 * ceil(p_best_dist) + v_bonus_sum then
    raise exception 'Invalid round';
  end if;

  -- ---------- all checks passed: write ----------
  update public.players
  set
    total_score   = total_score + p_score,
    coins         = coalesce(coins, 0) + greatest(0, p_score / 10),  -- 1 coin per 10 points
    best_distance = greatest(best_distance, p_best_dist),
    balls_played  = balls_played + c_balls,
    lifetime_snaps = lifetime_snaps + v_round_snaps
  where id = v_player_id
  returning lifetime_snaps into v_snaps_total;

  insert into public.rounds (player_id, score, fish_caught)
  values (v_player_id, p_score, v_n)
  returning id into v_round_id;

  for v_catch in select * from jsonb_array_elements(p_catches) loop
    insert into public.catches (player_id, round_id, species, distance_yd, bonus_points)
    values (
      v_player_id,
      v_round_id,
      v_catch->>'species',
      (v_catch->>'distance_yd')::numeric,
      (v_catch->>'bonus_points')::int
    );
  end loop;

  -- Trophies are derived only from validated data.
  if v_n > 0 then v_trophies := array_append(v_trophies, 'first_fish'); end if;
  if exists (select 1 from jsonb_array_elements(p_catches) c where c->>'species' = 'PIKE') then
    v_trophies := array_append(v_trophies, 'first_pike');
  end if;
  if v_ring2x then v_trophies := array_append(v_trophies, 'double_ring'); end if;
  if p_best_dist >= 150 then v_trophies := array_append(v_trophies, 'long_drive_150'); end if;
  if p_score >= 100 then v_trophies := array_append(v_trophies, 'century_score'); end if;
  if p_score >= 1000 then v_trophies := array_append(v_trophies, 'thousand_score'); end if;
  if v_snaps_total >= 5 then v_trophies := array_append(v_trophies, 'snap_five'); end if;

  foreach v_code in array v_trophies loop
    insert into public.player_trophies (player_id, trophy_code)
    values (v_player_id, v_code)
    on conflict (player_id, trophy_code) do nothing;
  end loop;

  return v_round_id;
end;
$$;

-- Signed-in players only (CREATE FUNCTION grants EXECUTE to PUBLIC/anon by default).
revoke all on function public.submit_round(integer, numeric, integer, jsonb, boolean, integer, integer) from public, anon;
grant execute on function public.submit_round(integer, numeric, integer, jsonb, boolean, integer, integer) to authenticated;

revoke all on function public.purchase_item(integer) from public, anon;
grant execute on function public.purchase_item(integer) to authenticated;

notify pgrst, 'reload schema';
