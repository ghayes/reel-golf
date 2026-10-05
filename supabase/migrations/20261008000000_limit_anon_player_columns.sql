-- ============================================================
-- REEL GOLF — Limit what anonymous visitors can read from `players`
-- (security review #47: L3)
-- ============================================================
-- `players` was readable in full by anyone with the public anon key,
-- including `coins`, `lifetime_snaps`, `balls_played` and `created_at`. The
-- public pages only need username/score/distance: leaderboard and trophy wall
-- read the `trophy_wall` view (owner-privileged, unaffected by this change) and
-- the trophy history embeds `players(username)`, which joins on `id`.
-- Signed-in clients still read their own wallet (`coins`) as before.
--
-- Idempotent. New columns added to `players` are NOT readable by anon until
-- explicitly granted.

revoke select on public.players from anon;
grant select (id, username, total_score, best_distance) on public.players to anon;
