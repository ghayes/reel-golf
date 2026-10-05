-- ============================================================
-- REEL GOLF — Privilege cleanup + username constraint
-- (security review #47: C2 follow-ups, M3, and rls_auto_enable exposure)
-- ============================================================
-- Safe to re-run (idempotent).

-- ---- 1. Strip non-API table privileges from client roles -------------
-- anon/authenticated held TRUNCATE (bypasses RLS), REFERENCES, TRIGGER and
-- MAINTAIN on every public table via default privileges. The Data API never
-- needs them. SELECT (and the column-level grants from the C2 migration)
-- are untouched.
revoke truncate, references, trigger, maintain
  on all tables in schema public
  from anon, authenticated;

-- ---- 2. Future tables start with no client privileges -----------------
-- New tables created by `postgres` in public no longer auto-grant anything
-- to anon/authenticated; each table needs an explicit GRANT (plus RLS).
alter default privileges for role postgres in schema public
  revoke all on tables from anon, authenticated;
alter default privileges for role postgres in schema public
  revoke all on sequences from anon, authenticated;
alter default privileges for role postgres in schema public
  revoke all on functions from anon, authenticated;

-- ---- 3. rls_auto_enable() is an event-trigger function ----------------
-- It is SECURITY DEFINER and was executable by anon/authenticated (and so
-- visible to PostgREST). Event triggers do not check EXECUTE at fire time,
-- so this does not affect its automatic RLS-enabling behaviour.
revoke execute on function public.rls_auto_enable() from public, anon, authenticated;

-- ---- 4. M3: server-side username rules --------------------------------
-- Mirrors the client check in index.html: 3-20 chars of [A-Za-z0-9_ ].
-- Also forbids leading/trailing spaces, and makes names unique ignoring case
-- so "SunnyAngler343" and "sunnyangler343" cannot coexist (impersonation).
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.players'::regclass and conname = 'players_username_format'
  ) then
    alter table public.players
      add constraint players_username_format check (
        char_length(username) between 3 and 20
        and username ~ '^[A-Za-z0-9_ ]+$'
        and username = btrim(username)
      );
  end if;
end $$;

create unique index if not exists players_username_lower_key
  on public.players (lower(username));

notify pgrst, 'reload schema';
