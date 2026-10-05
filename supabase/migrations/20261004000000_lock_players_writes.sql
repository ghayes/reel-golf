-- ============================================================
-- REEL GOLF — Lock down direct writes to public.players  (#47 C2)
-- ============================================================
-- RLS policies filter ROWS, not COLUMNS. The "self update username" policy only
-- checks auth.uid() = id, so with table-wide UPDATE/INSERT grants any signed-in
-- user could set their own coins, total_score, best_distance, balls_played
-- straight from the browser (PostgREST PATCH/POST on /rest/v1/players).
--
-- Fix: column-level privileges. Clients may only write `username` (and supply
-- `id` when creating their own row). Everything else is changed solely by the
-- SECURITY DEFINER RPCs (submit_round, purchase_item), which run as the table
-- owner and are unaffected by these revokes.
--
-- Safe to re-run.

revoke insert, update on public.players from public, anon, authenticated;

-- Create own row (RLS "self insert: players" still requires auth.uid() = id).
-- coins / total_score / best_distance / balls_played take their column defaults (0).
grant insert (id, username) on public.players to authenticated;

-- Rename self (RLS "self update username: players" still requires auth.uid() = id).
grant update (username) on public.players to authenticated;
