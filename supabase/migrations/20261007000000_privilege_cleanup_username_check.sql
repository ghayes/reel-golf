-- ============================================================
-- REEL GOLF — Privilege cleanup + username constraint
-- (security review #47: C2 follow-ups, M3, and rls_auto_enable exposure)
-- ============================================================
-- Safe to re-run (idempotent).

-- ---- 1. Strip non-API table privileges from client roles -------------
-- anon/authenticated held TRUNCATE (bypasses RLS), REFERENCES, TRIGGER and
-- MAINTAIN on every public table via default privileges. The Data API never
-- needs them. SELECT (and the column-level grants from the C2 migration)
-- are untouched. MAINTAIN only exists on PostgreSQL 17+, so it is revoked
-- conditionally.
revoke truncate, references, trigger
  on all tables in schema public
  from anon, authenticated;

do $$
begin
  if current_setting('server_version_num')::int >= 170000 then
    execute 'revoke maintain on all tables in schema public from anon, authenticated';
  end if;
end $$;

-- ---- 2. Future objects start with no client privileges -----------------
-- New tables/sequences/functions created by `postgres` no longer auto-grant
-- anything to anon/authenticated; each needs an explicit GRANT (plus RLS for
-- tables, which the ensure_rls event trigger already enables).
alter default privileges for role postgres in schema public
  revoke all on tables from anon, authenticated;
alter default privileges for role postgres in schema public
  revoke all on sequences from anon, authenticated;
alter default privileges for role postgres in schema public
  revoke all on functions from anon, authenticated;
-- Postgres grants EXECUTE on new functions to PUBLIC by default. A
-- schema-scoped default ACL can only add to that built-in default, so the
-- PUBLIC grant must be removed with a global (not IN SCHEMA) default.
-- Affects only functions created from now on by `postgres`; existing
-- functions keep their grants. New SECURITY DEFINER RPCs must be granted
-- explicitly (as submit_round / purchase_item already are).
alter default privileges for role postgres
  revoke execute on functions from public;

-- ---- 3. rls_auto_enable() is an event-trigger function ----------------
-- Provisioned by Supabase (not created by any migration in this repo), so
-- guard for projects/local stacks where it does not exist. It is SECURITY
-- DEFINER and was executable by anon/authenticated (and so visible to
-- PostgREST). Event triggers do not check EXECUTE at fire time, so this does
-- not affect its automatic RLS-enabling behaviour.
do $$
begin
  if to_regprocedure('public.rls_auto_enable()') is not null then
    execute 'revoke execute on function public.rls_auto_enable() from public, anon, authenticated';
  end if;
end $$;

-- ---- 4. M3: server-side username rules --------------------------------
-- Mirrors the client check in index.html: 3-20 chars of [A-Za-z0-9_ ].
-- Also forbids leading/trailing spaces and runs of spaces (HTML collapses
-- them, so "A  B" would look identical to "A B"), and makes names unique
-- ignoring case so "SunnyAngler343" and "sunnyangler343" cannot coexist
-- (impersonation).
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
        and username !~ '  '
      );
  end if;
end $$;

create unique index if not exists players_username_lower_key
  on public.players (lower(username));

notify pgrst, 'reload schema';
