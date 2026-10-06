-- ============================================================
-- REEL GOLF — Private wallet, step 2 of 2 (security review #47: L3 remainder)
-- ============================================================
-- Signed-in users get the same column-limited read of `players` as anonymous
-- visitors: id, username, total_score, best_distance. `coins`, `lifetime_snaps`,
-- `balls_played` and `created_at` stay private; a player reads their own wallet
-- through `get_my_player()` (20261009000000). `submit_round`, `purchase_item` and
-- the `trophy_wall` view run with owner privileges and are unaffected.
--
-- Apply only after the client that uses `get_my_player()` is live: an old
-- cached client that still selects `players.coins` would get a permission
-- error (it keeps working, but shows 0 coins until the page is reloaded).
-- Idempotent.

revoke select on public.players from authenticated;
grant select (id, username, total_score, best_distance) on public.players to authenticated;
