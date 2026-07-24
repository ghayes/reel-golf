# Reel Golf — Project Handoff

> **Naming update (2026-07-22):** a prior session flagged a possible
> trademark conflict with "Reel Golf" (an existing registered trademark,
> REELGolf) and renamed the product to "Dock Golf." That rename has since
> been reverted — the domains `reel-golf.com` and `reel-golf.app` have been
> purchased and the project is staying **Reel Golf**. The Supabase org/project
> have also been renamed accordingly ("Reel-Golf Game" / "Reel-Golf On The
> Dock"). Any remaining "Dock Golf" references below are historical.

## Concept
A mobile-first browser game blending golf swing mechanics with a fishing
reel-back phase. Inspired by a real dock story: someone tied a golf ball to a
fishing line, hit it off the end of a dock, and reeled it back in — with fish
occasionally striking the ball on the way in (never actually landed, in real
life). The core tension is push-your-luck: swing too hard and the line
snaps, reel too aggressively during a fish fight and it breaks off.

## Goal
Solo side project aimed at modest, ongoing monthly income — not a big studio
launch. Priorities: low/no ongoing cost, low content-maintenance burden
(explicitly no battle pass or live-service commitments), organic/word-of-mouth
growth rather than paid UA.

## Strategy decided
- **Web-first (HTML5 canvas), then wrap for app stores later.** Rationale:
  zero distribution cost, instantly shareable link for playtesting, and the
  same codebase can later be wrapped native (2026 mobile trend data showed
  downloads roughly flat but IAP revenue up ~10%, and indie success now comes
  from shareable/organic moments rather than outspending on ads).
- **Monetization plan (not yet implemented):** rewarded video ads (e.g.
  watch an ad to recover a snapped ball), cosmetic purchases (rods/lures/dock
  skins), and a one-time "remove ads" purchase. Explicitly avoiding battle
  passes / ongoing content commitments.
- **Hosting path:** GitHub Pages first (free, live now) → itch.io next
  (better discovery, payment options, still low-effort) → app store wrapper
  later once the core loop is validated.

## Current status
- **Live prototype:** https://ghayes.github.io/reel-golf
- Single-file HTML5 canvas game, no build step, no dependencies.
- Repo: `ghayes/reel-golf` on GitHub Pages (file served as `index.html` at
  repo root — confirm exact repo structure when picking this up).
- Backend (Supabase) has been **designed but not wired up yet** — see below.

## Gameplay implemented in the prototype
- **Dusk lakeside visual style**, parallax pine treeline, water gradient,
  glitter effect, yard markers along the shore.
- **Golfer animation:** address pose with idle waggle → backswing that
  tracks how long the player holds (charge power) → an accelerating
  downswing timed so the club face reaches the ball at a computed contact
  frame → follow-through. Arms articulate from the shoulder, slight body
  lean during the swing.
- **Swing/power phase:** hold to charge a power meter, release to swing.
  Meter has a red zone near the top (roughly 85–100%); landing power in the
  red carries an escalating chance the line snaps outright on contact.
  Overcharging past 100% also risks a snap ("OVERWOUND").
- **Ball flight:** simple projectile physics with per-shot random wind
  (affects drift). Distance measured in yards from the dock.
- **Rings:** two floating target rings spawn at random distances each ball;
  landing within a ring's radius grants a 2× score multiplier on that shot.
- **Reel-back / fish fight phase:**
  - A tension meter fills while holding (reeling in) and drains while
    released. Tension maxing out snaps the line.
  - While reeling, there's a per-second chance of hooking a fish. Fish tier
    is determined by how far out the ball landed: **PERCH** (short, easy,
    low bonus), **BASS** (mid), **PIKE** (long, hardest, biggest bonus).
  - Hooked fish alternate **rest** (reel freely, tires them out) and **run**
    (takes line back out, spikes tension if you keep holding — the player
    needs to let go and bleed tension off during a run instead).
  - Fish can also **drop the ball** — tuned to a low baseline chance (~1%/sec)
    so it's an occasional twist rather than the default outcome, with a much
    higher drop chance (~18%/sec) if tension is allowed to go slack
    (below ~25), so the player is rewarded for keeping steady tension.
  - Landing the ball banks the yardage score (× ring multiplier, if any)
    plus a fish bonus if one was successfully played out to zero stamina.
  - A **"SNAP!"** rubber-stamp animation plays on any line-break outcome
    (overwound, swung too hard, reeled too hot, spooled, fish broke off).
- **Round structure:** 3 balls per round, game-over screen shows final
  score, longest drive, and fish landed, with a replay button.

### Tuning history (useful context if things feel off again)
- Initial fish drop rate (30% base / 5% slack) made every fish escape —
  tuned down to ~1% base / ~18% on slack line.
- Launch speed was tuned up once so full-power swings can reach the
  furthest ring (~150+ yd).
- If fish still feel too hard/easy to land, the tunable knobs are: per-tier
  `stamina`, `pull`, `runT`/`restT` in the `makeFish()` function, and the
  `dropRate` constants in the reel-phase update logic.

## Backend: designed, not yet wired up
A Supabase (Postgres) schema has been fully sketched (see accompanying
`reel-golf-schema.sql` if included in the repo, otherwise recreate from this
spec):

- **`players`** — public profile keyed to `auth.users.id`: username,
  lifetime `total_score`, `best_distance`, `balls_played`.
- **`rounds`** — one row per playthrough: score, fish_caught, played_at.
- **`catches`** — one row per fish actually landed: species
  (`PERCH`/`BASS`/`PIKE`), distance_yd, bonus_points, caught_at.
- **`trophy_defs`** — fixed badge list, seeded with six starter trophies:
  First Bite, Lunker (first pike), Ringer (2× ring shot), Dock to Deep Water
  (150+ yd drive), Line Breaker (5 snaps), Century Club (100+ pts in a round).
- **`player_trophies`** — join table of which player earned which trophy and
  when.
- **`trophy_wall` view** — single query joining the above for a public
  leaderboard/trophy-wall page (username, total_score, best_distance,
  total_catches, pikes_landed, trophies array).
- **RLS policies** — public read on all four tables (needed for the trophy
  wall/leaderboard to be visible to everyone), insert/update restricted to
  the authenticated player's own rows (`auth.uid() = player_id`).

Reasoning for Supabase over Firebase/PlayFab: relational SQL fits this data
naturally (players → rounds → catches → trophies all join cleanly), the
free tier is generous for a small side project, and it avoids the vendor
lock-in of a proprietary game-backend data model. Supabase is explicitly
not a realtime multiplayer game server — fine here since Dock Golf has no
head-to-head multiplayer requirement.

## Next steps (not yet started)
1. **Wire the client to Supabase:**
   - Add Supabase JS client + auth (sign-in, likely anonymous or email —
     decide UX for a casual mobile game; anonymous-with-optional-upgrade is
     common for this genre).
   - On round completion, insert a `rounds` row and any `catches` rows.
   - On qualifying events, insert `player_trophies` rows (first pike, 5
     snaps, 100+ score, etc. — conditions map directly to existing game
     state like `S.fishCaught`, `S.score`, `S.shotMult`).
   - Build a simple trophy-wall page/view querying the `trophy_wall` view.
2. **Playtesting:** the GitHub Pages link is live and ready to send to
   friends; no blockers there. Feedback should focus on swing/reel feel and
   fish difficulty balance.
3. **Consider itch.io** as the next hosting step once basic backend/auth is
   in, for better discovery and optional payments.
4. **Monetization implementation** (rewarded ads, cosmetics, remove-ads) —
   deliberately deferred until the core loop and backend are validated.
5. **Eventual app-store wrapper** around the same HTML5 codebase.

## Files referenced in this conversation
- `reel-golf.html` — the full single-file game prototype (canvas + JS),
  currently deployed as the live GitHub Pages site.
- `reel-golf-schema.sql` — the Supabase schema described above, ready to run
  in the Supabase SQL editor.

Both were generated in a prior session's sandbox (`/mnt/user-data/outputs/`)
and should be pulled from the `ghayes/reel-golf` GitHub repo directly rather
than regenerated from scratch.

## Rebrand TODO — resolved (2026-07-22)
The Dock Golf rename has been reverted; the project is staying **Reel Golf**,
domains `reel-golf.com`/`reel-golf.app` are purchased, and this doc, the
in-game title/logo, `CLAUDE.md`, and `README.md` have been updated back to
that name. Still open:
- Local folder name and GitHub repo (`ghayes/reel-golf`) — already match,
  no change needed.
- Live GitHub Pages URL (`https://ghayes.github.io/reel-golf`) — fine as-is;
  custom domain via `reel-golf.com`/`.app` is a separate DNS step (see below).
- Any future itch.io page slug should use "reel-golf".
