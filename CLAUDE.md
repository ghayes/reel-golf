# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Reel Golf is a single-file mobile browser game combining golf-style driving with fishing. Everything — markup, CSS, and game logic — lives in one file: `index.html`. There is no build step, no package.json, and no dependencies beyond a Google Fonts import (`Staatliches`) and the browser's Canvas 2D API.

## Running / testing

There is no build or test tooling. To work on the game, just open `index.html` directly in a browser (or serve it with any static file server) and play it — there's no other way to verify behavior. Since the whole game is one `<script>` IIFE, use the browser console for ad-hoc debugging.

## Architecture

The game is a single finite-state machine driven by one `requestAnimationFrame` loop (`frame()` at the bottom of the script), which calls `update(dt)` then `draw()` each tick. All mutable game state lives in one global object, `S`, reset per-ball by `nextBall()` and per-round by `newRound()`.

**Phase state machine** (`S.phase`), in order:
- `ready` — waiting for input (idle club waggle)
- `charge` — power meter fills while the pointer/space is held (`S.power`)
- `downswing` — brief scripted swing animation; `contact()` fires partway through based on `contactFrac` (computed from swing power) to launch the ball
- `flight` — ballistic trajectory under gravity + wind until the ball hits the water
- `reel` — line-tension minigame: reel in the ball, optionally hook a fish (`S.fish`), manage `S.tension` vs. fish `mode` (`rest`/`run`)
- `landed` — ball reached the dock; points banked (see `landBall()`)
- `snapped` — line broke (overpowered swing, spooled past `MAX_LINE_YD`, tension maxed, or fish broke off); costs a ball (see `snapLine()`)
- `over` — all 3 balls used; shows final stats overlay

Losing all balls (`S.balls`) triggers `gameOver()`, which repopulates the start overlay with final stats and swaps the button to "PLAY AGAIN".

**Key mechanics to know before changing physics/scoring:**
- World space is in "yards" converted to pixels via the `YARD` constant; `DOCK_X` is the tee/dock origin. The camera (`S.cam`) smoothly follows the ball or reeled line position.
- Swing power (`S.power`, 0–104) determines launch speed; power above 85 enters a "red zone" with a ramping chance of snapping the line instead of hitting (`contact()`).
- Two scoring "rings" are randomly placed per ball (`S.rings`, generated in `nextBall()`); landing within a ring's radius doubles the shot (`S.shotMult`).
- Fish are tiered by cast distance (`makeFish()`): PERCH (<60yd), BASS (<110yd), PIKE (beyond), each with different bonus points, stamina, pull strength, and run/rest timing. Fish alternate between `rest` (reel to tire it, adds tension) and `run` (release to avoid tension spike) modes.
- `S.tension` (0–100) is the core risk gauge during `reel`: holding while a fish runs spikes it fast; maxing it out snaps the line and loses the fish/ball.
- Points only bank when the ball/line reaches the dock (`S.lineOutYd <= 0` while phase is `reel`), via `landBall()` — distance yardage plus any ring multiplier plus any landed-fish bonus.

**Rendering** is all hand-drawn Canvas 2D in `draw()`: parallax pine trees, gradient sky/water, a stick-figure golfer whose club/arm angles are computed live from swing phase (`clubA`), the fishing line as a sagging/vibrating quadratic curve tied to `S.tension`, and a HUD (`drawHUD()`) with score, wind, distance, power/tension meters, and toast messages.

Input is unified across pointer and keyboard: `pointerdown`/`pointerup` on the canvas/window and `Space` keydown/keyup both map to the same `press()`/`release()` handlers, so any change to controls should go through those two functions rather than adding new listeners.
