# HANDOFF: humpback bridge rework (Jim's 2026-08-23 feedback, PR #286 branch)

Branch `bridge-geometry-fix`, off `origin/grid-aligned-park`, merges back to
that branch. All five of Jim's complaints addressed:

1. **Width = path width.** `LevelCrossing.pathHalfWidth` (read off
   `paths.ts`'s own paving samples) is the one owner; the bridge search no
   longer sizes off `halfGap` and no longer searches widths at all.
2. **No steps.** Flat-deck-plus-treads replaced by one smooth hump
   (smootherstep profile, zero slope at crown and feet). Walkable as ONE
   height-varying `MovingPlatform` — `building/surfaces.ts` grew optional
   `surfaceYAt(x, z)`.
3. **Follows the path's curve.** `LevelCrossing.spine` records the drawn
   centreline through the crossing; `train/bridgeSpine.ts`'s `SpineFrame`
   is the curved local frame everything (search, meshes, colliders,
   heights, fence seam, invariants) shares.
4. **Real arched stone tunnel.** Masonry shell in `pinkStoneTexture` with
   flat full-clearance crown (the mesh still named `deck` — invariants
   measure its soffit), quarter-round haunches, abutments, stone parapets
   with `stonePinkLight` coping.
5. **Rail corridor genuinely clear.** The old support beams stood across
   the track; nothing of the new bridge enters the swept corridor. New
   invariant `bridgesMatchTheirPathAndKeepTheRailClear` raycasts up from
   the track bed and also measures standable width vs the path — proven
   red on the old geometry (9.0 m standable on a 2.6 m path; beams 0.02 m
   over the track bed), green on the new.

## Landmines already stepped on (do not re-step)

- **The spine must never cross a `pathCentreline()` route seam.**
  `PathSample.run` (new field) is the authority; walking by stride alone
  hair-pinned onto an adjacent route on seed 2 and the parapets crossed
  their own roadway.
- **Parapets taper out below `BUILDING_STEP_UP` of hump height** — full
  walls to the feet strand whole path-junction pockets (39 waypoints on
  canonical, first build).
- **Do NOT cap ramp runs at `SpineFrame.trustedReach`** — tried, reverted,
  documented in `bridgeFootprint.ts`'s searchDeck: ramps have always been
  allowed to land on lawn past their path's turn; the cap starved seed 2 to
  zero bridges.
- **`MIN_TURN_RADIUS` is 3 m, not 6** — 6 trimmed the legitimate
  Catmull-Rom bow near ramp feet and also cost seed 2 its bridges.
- The fence seam pins to `bridge.heightAt` (local surface), not `deckY`.

## Verified

- `tsc --noEmit` (src + test) clean.
- `npm run test:procgen`: 423/423 across all 5 seeds, exit 0.
- `npm run check:park`: 19/19 attractions, 0 rail crossings, 220/220
  waypoints (the branch's pre-existing stranded waypoint included), all
  six invariants — exit 0.
- Real-browser QA (playwright + swiftshader, dev server :5391):
  screenshots in PR comment — side views (smooth hump, no steps), train
  staged through the arch (no clipping, daylight over the funnel),
  tap-to-move walk over the bridge with the recorded height profile.

## If picking this up

Deep links for QA: `/view?camPos=-6.6,4.5,32.1&camDir=-15.5,-2,4.1`
(bridge A side, canonical seed), `/spawn?pos=-17.9,20.6&facing=345` (path
before bridge A's south foot). Screenshot capture in headless Chromium:
playwright's `page.screenshot` times out on the WebGL page — use a CDP
session's `Page.captureScreenshot` instead; launch with
`--enable-unsafe-swiftshader`. Sim time crawls headless (1-2 fps): stage
the train via `window.game.world.train.distance = <railDistance>` +
`placeCars()` under a `timeOfDay` freeze rather than waiting for a lap.
