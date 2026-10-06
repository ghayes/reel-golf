# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Reel Golf is a mobile browser game combining golf-style driving with fishing. It is a static site (plain HTML/CSS/JS, Canvas 2D, no build step) served by Cloudflare Pages, with a Supabase backend (Auth, Postgres, one Edge Function) for accounts, leaderboard, trophies and a coin shop. Live at `https://app.reel-golf.com`; `www.reel-golf.com` serves the landing page.

Security review findings and their status are tracked in GitHub issue #47. Read it before touching auth, RPCs, grants, headers or anything that renders server data.

## Repo layout

| Path | Purpose |
|---|---|
| `index.html`, `app.js` | Game page markup/CSS, and the UI shell (overlay, login, shop, game-over hook) |
| `game.js` | The game itself: Canvas rendering and the phase state machine (see Architecture) |
| `api.js` | `window.RG_API`: Supabase client, auth (SMS/email OTP), shop catalog, `submitRound`, `purchaseItem` |
| `leaderboard.*`, `trophy-wall.*`, `changelog.*`, `sms-opt-in.*` | Secondary pages, each `page.html` + `page.js` |
| `landing.html`, `privacy.html`, `terms.html` | Static pages |
| `vendor/` | Self-hosted, pinned third-party JS (`supabase-js`). Do not load scripts from CDNs |
| `_headers` | Cloudflare Pages response headers (CSP, HSTS, caching) |
| `functions/_middleware.js` | Cloudflare Pages Function: apex-domain rewrite and redirect only |
| `supabase/migrations/` | **Source of truth for the database.** Timestamped, applied in filename order |
| `supabase/functions/send-sms-sentdm/` | Auth "Send SMS" hook (Sent.dm), verifies Standard Webhooks signatures |
| `scripts/` | `check-sms-hook.mjs` (post-deploy check), `test-sms-hook.ts` (offline hook tests) |
| `backend/*.sql` | Historical baseline only. Stale and unsafe to re-run, see the banner in each file |

Untracked scratch scripts in the repo root (`check_*.js`, `update_*.js`, ...) use the Supabase service-role key; do not commit them. `.env` is gitignored and holds local tokens: never print it or commit it.

## Running / testing

- **Game/UI:** serve the repo with any static server (e.g. `python3 -m http.server`) and play it. A plain server does not apply `_headers`, so the CSP is not enforced locally. To check CSP behaviour, push the branch and use its Cloudflare preview (`https://<branch>.reel-golf.pages.dev`), or serve with the `/*` headers from `_headers` applied and look for CSP violations in the console.
- **SMS hook:** `deno run -A scripts/test-sms-hook.ts` runs the real function code against a mocked Sent.dm with locally signed webhooks (sends nothing). After deploying the function run `node scripts/check-sms-hook.mjs` (expects 401 "Invalid signature" for unsigned/forged requests). A real SMS login is the end-to-end check.
- **Database changes:** dry-run the migration plus assertions in one transaction that ends with a forced exception so nothing persists, impersonating roles with `set_config('request.jwt.claims', ...)`, `set_config('request.jwt.claim.sub', ...)` and `set local role authenticated`. Verify privileges over HTTP with the anon key afterwards.

## Architecture

The game (`game.js`) is a single finite-state machine driven by one `requestAnimationFrame` loop (`frame()` near the bottom of the file), which calls `update(dt)` then `draw()` each tick. All mutable game state lives in one object, `S`, reset per-ball by `nextBall()` and per-round by `newRound()`. `game.js` talks to the rest of the page only through `window.RG_GAME` (`onGameOver`) and `window.RG_API.submitRound`.

**Phase state machine** (`S.phase`), in order:
- `ready` — waiting for input (idle club waggle)
- `charge` — power meter fills while the pointer/space is held (`S.power`)
- `downswing` — brief scripted swing animation; `contact()` fires partway through based on `contactFrac` (computed from swing power) to launch the ball
- `flight` — ballistic trajectory under gravity + wind until the ball hits the water
- `reel` — line-tension minigame: reel in the ball, optionally hook a fish (`S.fish`), manage `S.tension` vs. fish `mode` (`rest`/`run`)
- `landed` — ball reached the dock; points banked (see `landBall()`)
- `snapped` — line broke (overpowered swing, spooled past `MAX_LINE_YD`, tension maxed, or fish broke off); costs a ball (see `snapLine()`)
- `over` — all 3 balls used; shows final stats overlay

Losing all balls (`S.balls`) triggers `gameOver()`, which submits the round (`RG_API.submitRound`), then calls `RG_GAME.onGameOver`, which repopulates the start overlay with final stats and swaps the button to "PLAY AGAIN".

**Key mechanics to know before changing physics/scoring:**
- World space is in "yards" converted to pixels via the `YARD` constant; `DOCK_X` is the tee/dock origin. The camera (`S.cam`) smoothly follows the ball or reeled line position.
- Swing power (`S.power`, 0–104) determines launch speed; power above 85 enters a "red zone" with a ramping chance of snapping the line instead of hitting (`contact()`).
- Two scoring "rings" are randomly placed per ball (`S.rings`, generated in `nextBall()`); landing within a ring's radius doubles the shot (`S.shotMult`).
- Fish are tiered by cast distance (`makeFish()`): PERCH (<60yd, 50 bonus), BASS (<110yd, 150), PIKE (beyond, 400), each with different stamina, pull strength, and run/rest timing. Fish alternate between `rest` (reel to tire it, adds tension) and `run` (release to avoid tension spike) modes.
- `S.tension` (0–100) is the core risk gauge during `reel`: holding while a fish runs spikes it fast; maxing it out snaps the line and loses the fish/ball.
- Points only bank when the ball/line reaches the dock (`S.lineOutYd <= 0` while phase is `reel`), via `landBall()` — distance yardage plus any ring multiplier plus any landed-fish bonus.
- **The server re-validates these rules.** `submit_round` (latest in `20261005000000_harden_round_submission.sql`) hard-codes `MAX_LINE_YD` 225, 3 balls, the species tiers/bonuses above, the maximum score per round (`3 balls * 2 * ceil(best_dist) + sum(fish bonuses)`, which bakes in the **2x** ring multiplier), a 5 s minimum gap and 60 rounds/hour per player, and coins = 1 per 10 points. If you change any of those in `game.js`, change `submit_round` in a new migration in the same PR or legitimate rounds will be rejected.

**Rendering** is all hand-drawn Canvas 2D in `draw()`: parallax pine trees, gradient sky/water, a stick-figure golfer whose club/arm angles are computed live from swing phase (`clubA`), the fishing line as a sagging/vibrating quadratic curve tied to `S.tension`, and a HUD (`drawHUD()`) with score, wind, distance, power/tension meters, and toast messages.

Input is unified across pointer and keyboard: `pointerdown`/`pointerup` on the canvas/window and `Space` keydown/keyup both map to the same `press()`/`release()` handlers, so any change to controls should go through those two functions rather than adding new listeners.

## Backend and security conventions

The browser is untrusted. Everything below exists because of review #47; do not undo it.

- **Clients cannot write game data.** `authenticated` can only INSERT `players(id, username)` and UPDATE `players(username)`. Rounds, catches, trophies, coins and stats change only through the `SECURITY DEFINER` RPCs `submit_round` and `purchase_item` (both `authenticated`-only, `search_path = public`, row-locking the player). Add new writes as validated RPCs, not as table grants or RLS insert/update policies.
- **Explicit grants.** Default privileges for objects created by `postgres` give `anon`/`authenticated` nothing (and functions get no `PUBLIC` EXECUTE). Every new table needs RLS plus an explicit `GRANT`; every new function needs an explicit `GRANT EXECUTE`. `DROP` + `CREATE` of a function resets its grants. This applies to objects created by `postgres` (the SQL editor and migrations); objects created by `supabase_admin` still inherit Supabase's broad defaults for `anon`/`authenticated`, so check grants on anything created that way. `anon` may read only `players(id, username, total_score, best_distance)`; the public pages read the `trophy_wall` view.
- **Migrations:** add a new timestamped file in `supabase/migrations/`, idempotent where possible, never edit an applied migration's behaviour (the old ones are stale on purpose; later files supersede them). They are applied by hand (Supabase Management API with `SUPABASE_ACCESS_TOKEN` from `.env`, or the SQL editor); there is no migration-history table. Do not run `supabase config push` (the local `config.toml` is intentionally partial) and do not re-run `backend/*.sql`.
- **Edge function:** deploy with `supabase functions deploy send-sms-sentdm --no-verify-jwt --use-api` (JWT verification must stay off, the function authenticates Supabase Auth by Standard Webhooks signature and fails closed). Secrets (`SENT_API_KEY`, `SENT_TEMPLATE_ID`, `SEND_SMS_HOOK_SECRET`) live in Supabase, never in the repo.
- **Frontend and CSP** (`_headers`: `script-src 'self'`): no inline `<script>` and no inline `on*=` handlers; put code in a `.js` file. Escape every database/API string put into `innerHTML` (`esc()`), coerce numbers (`num()`), or use `textContent`. Any new third-party origin (scripts, fonts, APIs) must be added to the CSP deliberately; prefer self-hosting pinned files in `vendor/`. Bump the `?v=` query on a script tag when you change that file (HTML and `/*.js` are served `max-age=0, must-revalidate`, but the bump guarantees no browser or edge pairs new HTML with old JS). `esc()` and `num()` are per-file copies (`app.js`, `leaderboard.js`, `trophy-wall.js`); there is no shared module.
- **Cloudflare headers merge:** a path matched by several rules gets comma-joined values for the same header. Use `! Header-Name` in the more specific rule to detach (as done for `/vendor/*` Cache-Control). Check with `curl -sI` on a preview.
- **Auth settings** live in Supabase (not in the repo). Redirect allow-list is `https://app.reel-golf.com/**`, `https://reel-golf.pages.dev/**`, `https://*.reel-golf.pages.dev/**`; never re-add a wildcard that covers third-party hosts.

## Deployment

Merging to `main` deploys the static site via Cloudflare Pages (about 30 seconds); every branch gets a preview at `https://<branch>.reel-golf.pages.dev`. Database migrations and the edge function are deployed separately (above). When a change needs both, apply the order that is safe for old cached clients: for example a new RPC argument means migrate first, then merge the client.

## Change Management & Code Review Workflow

Every code change must go through a collaborative review loop with the `code-reviewer` subagent:
1. **Branch & Implement**: Work on a scoped feature or fix branch (`feat/...`, `fix/...`, `infra/...`).
2. **Open PR**: Push branch and create a Pull Request linked to the relevant issue(s) using `gh pr create`.
3. **Subagent Review**: Invoke the `code-reviewer` subagent to review the PR diff, check project conventions, verify security, and post structured review comments directly to the GitHub PR.
4. **Iterative Collaboration (Max 4 Iterations)**: If the reviewer requests changes (`STATUS: CHANGES REQUESTED`), the coding agent implements the requested fixes, pushes new commits, and asks the reviewer to re-review. This loop can repeat for up to 4 iterations.
5. **Human Review Escalation Gate**: If after 4 review/fix iterations the PR is still not approved (`STATUS: HUMAN REVIEW REQUIRED`), the agents must stop immediately, explain the unresolved issues to the user, and wait for human review and direction.
6. **Green Light**: Once the reviewer determines all criteria are satisfied, the reviewer posts an approval to the PR and issues `STATUS: GREEN LIGHT`. Merging is only performed after the green light is granted. (GitHub does not let an account approve its own PR, so the approval is a PR comment ending in the `STATUS:` line.)
