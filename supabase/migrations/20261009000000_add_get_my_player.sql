-- ============================================================
-- REEL GOLF — Private wallet, step 1 of 2 (security review #47: L3 remainder)
-- ============================================================
-- Signed-in clients currently read their own `coins` straight from `players`,
-- which forces every signed-in user to be able to read EVERY player's coins.
-- This adds an owner-only RPC so the client can stop doing that. It is purely
-- additive: apply it BEFORE shipping the client that calls it, and apply
-- 20261009000001_hide_player_columns_from_authenticated.sql only after that
-- client is live.
--
-- Idempotent.

create or replace function public.get_my_player()
returns table (id uuid, username text, coins int)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select p.id, p.username, p.coins
  from public.players p
  where p.id = auth.uid();
$$;

revoke all on function public.get_my_player() from public, anon;
grant execute on function public.get_my_player() to authenticated;

notify pgrst, 'reload schema';
