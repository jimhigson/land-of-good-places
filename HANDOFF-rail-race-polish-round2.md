# Rail Race polish, round 2 — handoff

Branch `feat/rail-race-polish-round2`, worktree
`.claude/worktrees/rail-race-polish`, from `origin/main` (53ecb2b).

Four independent family asks from the 1 August 2026 playtest, one commit each,
one PR. I own the shared chrome-devtools profile for this task.

## The four

1. **Whole rail goes black on spark stretches**, not just the ground plate
   between the rails, and in sync with `setSparking()`.
2. **Visible supports**: tighter spacing than `TRESTLE_SPACING = 12`, and one
   dropper under *each rail* (not the lane centre line) in that lane's colour.
3. **Race-position HUD**: all four riders along the top edge, ranked, place +
   name, reusing `minigames/portraitStrip.ts`.
4. **Rivals too good**: make them visibly fallible.

## Findings so far (before writing code)

- `sweptRails()` (`src/world/rail/sweptRail.ts`) returns `BufferGeometry[]`
  (left, right) and is shared with the coaster — **do not change its
  contract**. Instead paint the returned geometry's own `color` attribute.
- Mapping a rail vertex back to a route distance is exact and needs no change
  to the sweeper: the ring is a circle, so
  `distance = route.wrap(-atan2(z, x) * NOMINAL_RADIUS)` and
  `lapOffset = route.wrap(distance - route.startDistance)`. The tube's radial
  offset (0.1875 m) perturbs this by under 0.2 m against 15–23 m zones.
  This is better than trusting `TubeGeometry`'s `u` parameter, which is the
  *rail's* arc-length fraction, not the route's.
- `trestleSpots()`'s skip predicates (`isClearCircle`, `distanceToPath`,
  `distanceToRailCorridor`, entry pinch) are per-spot, so a smaller spacing is
  safe — it just yields more candidates, each filtered the same way.
  `test/procgen/invariants.ts`'s `railRaceFliesClear` reads the legs back out
  of the built scene by name (`railRace:trestle-legs`) and re-checks them, so
  it keeps covering the tighter spacing for free.
- **Why rivals feel unbeatable** (measured from the constants, not guessed):
  `band = 1 + clamp(lead * 0.004, ±0.22)`. Terminal speed solves
  `0.01v² + 0.175v = THRUST * band`. Player (band 1) tops out at 30.8 m/s; a
  rival 55 m behind gets band 1.22 → 34.7, clamped by `MAX_SPEED` to 33. So a
  trailing rival is ~7% faster than the player's *best possible* speed and any
  mistake is refunded within seconds. That, not `skill`, is the thing that
  makes them feel perfect.
- The rail race HUD is `src/ui/RaceHud.ts` in `uiRoot` (not the mini-game
  overlay), wired in `Game.ts` ~line 493 via `onRaceMoment`.

## Status

- [x] Worktree + deps
- [x] 1 rails black — committed, verified live (screenshot: solid black block
      of rails; `setSparking` proven to drive the rail buffers ink -> warm -> ink)
- [x] 2 supports — committed, verified live. **Root cause was not spacing.**
- [x] 5 headlamps as real SpotLights (new scope from Jim, mid-task) — committed,
      verified live at night and at noon. +1.1 ms frame time with all 8 lit.
- [x] 4 fallible rivals — committed. Root cause was the rubber band, not skill.
- [x] 3 standings HUD — committed, verified live in portrait and landscape
- [x] Rebased onto origin/main f464373 (duck-bar clearance + player pitch).
      One conflict, in `RailRace.ts`: main added `DUCK_DROP` next to the
      `CATCHUP`/`SWING` constants this branch deletes. Kept `DUCK_DROP`, dropped
      the other two. Build and procgen re-run green after the rebase, and the
      balance guard reports identical numbers.
- [x] PR raised. **Do not merge my own work** — Overseer merges.

## What the two root causes actually were (do not lose these)

**Supports.** Tightening `TRESTLE_SPACING` alone would have fixed nothing. Of
67 candidate spots at 5 m, only **4** survived: 52 rejected by
`collision.isClearCircle`, 7 by the railway, 4 by a path. The old
`trestleSpots()` decided the cross-beam, the droppers *and* the ground leg on
one question — can the ground 8 m below take a post. Fix: `deckSpots()` is
unconditional (a beam 6 m up needs no ground), `footUnder()` is asked
separately about the leg and may shuffle up to 4.6 m radially to find clear
ground. Now 67 bays / 536 droppers / 26 legs.

**Rivals.** The mistakes were already happening; the rubber band refunded them.
Symmetric +/-0.22 band meant a trailing rival's terminal speed was 33 m/s
against the player's 30.8 — permanently faster than her best. Fix: asymmetric
on both swing and ramp rate. Measured with the new `simulateField` +
`check:rail-race` guard.

## Dev server

Mine is port **5417**, `--strictPort`. Kill by PID only. Current PID recorded
in the session; if unknown, `lsof -ti tcp:5417` and check it is `node`, not
Chrome (Chrome shows up there as a client).

## Rules I must not forget

- `npm run build` and check the real exit code, never through `tail`.
- Never `git add -A`; name files.
- Own dev port with `--strictPort`; kill only my own PID.
- `new_page` always `background: true`.
- Do not merge my own PR.
