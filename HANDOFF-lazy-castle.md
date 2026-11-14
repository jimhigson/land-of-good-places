# HANDOFF — lazy castle interior (PR #759, draft)

Branch `lazy-castle`, worktree `.claude/worktrees/lazy-castle`. Ports: **6061** branch preview, 6062 main
baseline preview (worktree `.claude/worktrees/lazy-castle-main`, detached at origin/main), 6063 scratch
(dev server / profiling build / combo). All started by `$SP/serve.sh` / `$SP/dev.sh`, killed by their own PIDs.
`$SP` = `/private/tmp/claude-501/-Users-jim-dev-landOfGoodPlaces/63860b08-4a9b-4597-b7cf-7b1677887a9f/scratchpad/lazy-castle`
(harness: `door.mjs` + `probe.js`, `ab-door.sh`, `ab-lift.sh`, `sum-door.mjs`, `sum-lift.mjs`, `shots.mjs`,
`filmstrip.mjs`, `navcount.mjs`, `subtree.mjs`/`longest.mjs` for cpuprofiles). No PR to open: a later stage does.

## Brief (13 Nov, resumed 14 Nov)
1. WebKit: no iris on first castle entry — interior built in the frame that asks the iris to close.
2. NavGrid `ensureLattice → rebuild` freeze ~505 ms after entry.
3. Adopt `DrawnSpaces` (`src/world/DrawnSpaces.ts`).
4. Prefetch from `castleEntranceBand()`; a castle lazy-load test; kidCrowd `toDataURL` fix.
Measure first entry + deck changes before/after; boot time + `check:boot-chunk`.

## Done (pushed)
- 13 Nov: build behind the iris (24b998ed: `changeToInterior` hands `changeToFurnished` only the fetch,
  builds first thing in the midpoint, a build throw refuses the door); `test/lazy/castleDoor.test.ts`;
  kidCrowd `cloneMaterial` (c72e6e7f); prefetch + refusal bubble from `castleEntranceBand()` (5579a745).
- 14 Nov: merged origin/main bb7e9c99 (b57cbc16) and 66bcd7f8 (#779 TS 7.1 / Vite 8.3.8, #780) as
  d30d41a2 — both clean; `scripts` object identical to main's.
- af71b6c3 **crowd far levels shared by content** (`src/core/instancedLod.ts`): `furnishCastle` 104.8 →
  49.1 ms (unminified production build, Chromium CPU profile; `lowDetailGeometry` 58.9 ms → `twinLevels`
  1.5 ms). The banquet's `KidCrowd` prototype is 30 of 44 parts separate objects with byte-identical arrays
  (`$SP/twins.mjs`, real page). Test `test/lazy/crowdLodTwins.test.ts` (shard 5): red on main's file
  `2 failed | 2 passed (4)`, green 4/4. `check:crowd-cull` main = branch: 64 of 97 parts with a far
  level, 85,136 → 59,847 tris, worst vertex 3.30 mm.
- b118b1d5 prefetch asks `castleEntranceBand()` only while `CASTLE_INTERIOR.loaded` is null.

## Measurements (14 Nov, M4 Pro, load 35–110: a VM + other agents; interleaved main/branch)
Production builds (main bb7e9c99 on 6062, branch b118b1d5 on 6061), seed 5, 1280×800@2.
**Door, first entry** (`/spawn?pos=24.52,-18.17&facing=180&seed=5&perf=1`, hold W+D), 5 runs each, min–max (median):
| | Cr main | Cr branch | WK main | WK branch |
|---|---|---|---|---|
| door frame (asks the iris to close) | 8.2–8.4 | 8.3–8.4 | 17–65 (18) | 16–27 (19) |
| frozen before the swap is drawn | 11–12 | 58–68 (62) | 18–20 | 71–79 (75) |
| iris hole then (× diagonal) | 0.25 | 0.25–0.29 | 0.05–0.61 (0.57) | 0–0.38 (0.30) |
| hole on first new-world frame | 0 | 0 | 0–**0.607** (0.02) | 0 (5/5) |
| worst frame close→open+1.5 s | 66.8–87 (68.6) | 70–78 (72) | 163–201 (186) | 169–211 (193) |
| worst frame 1.5–9 s after | 16.4–18.9 | 16.6–18.2 | 32–72 (51) | 33–67 (49) |
The worst-around frame is the mall's first frame (program links, behind the iris) on both builds.
Filmstrip (CDP screencast, `$SP/film/door-before-after.png`): the small-hole frame onto the frozen park is
held 131 ms on main, 182 ms on the branch (another run 71 vs 123) — the build, ~50 ms, is the only difference.
**Combo** (`.claude/worktrees/lazy-castle-combo` = this + perf/first-entry-warmup + perf/undrawn-indoors,
scratch, Game.ts resolved for measuring only): hole 0 on every frame before the reveal, 3/3 Cr and 3/3 WK.
**Lift** (`/castle?deck=0&at=-19,5`, mall→hall→roof→mall, 4 runs each, worst frame per hop, median):
Cr hall 16.1 vs 20.3, roof 48.2 vs 49, mall 13.8 vs 13.8; WK hall 50 vs 38, roof 65 vs 64 (main max 1269,
branch 253: a program link at the press, on both), mall 35 vs 26. Parity: the castle is always built
before she can reach the lift. Lift hops show the new deck through a 0.25 hole on both builds (iris timing).
**Boot** (door runs, Cr): first frame 2185 → 1802 ms (medians), longest task 1631 → 1326, heap 125 → 108 MB;
WK first frame 2820 → 1834. `check:boot-chunk`: boot set 49 chunks 3808 KB → 52 chunks 3614 KB (−194);
lazy 2681 → 2881 KB; castleInterior chunk 200 KB (castle.glb 172 KB was in main's boot set).
**NavGrid** (dev, `NAV_GRID_BUILDS`, `navcount.mjs`): walk-in registers 55 colliders (rev 3151→3206);
shipped: the park lattice 1 patch of 0 cells (0.2 ms), 2 small whole builds (worst 3.8 ms). Control
`patching=false` (pre-#764): worst whole build 167.4 ms — the instrument sees the freeze when it exists.
**DrawnSpaces**: `check:render-budget` (dev, Metal) exit 0 both: castle 276/168,460 (main) vs 278/168,598;
the castle root is 1861 objects from boot on main, 957 until she goes in on the branch; no strays.
**Pixels** (`?clock=5`, 1280×800@1, `shots.mjs`): mall, hall, hearth, roof, outside 0 pixels differ; lift
view ≤ 2/255 (the call button's CSS glow — controls main-vs-main ≤ 1/255, branch-vs-branch ≤ 1/255).
A first run's 73-pixel pet blink in the hall did not reproduce. `$SP/film/decks-before-after.png`.

## Findings for others
- **Painted shut** (perf/first-entry-warmup): main's `irisWipe` runs the midpoint on its close timer with the
  eye still ~0.25 diag (Cr) / up to 0.6 (WK) open. The castle's ~50 ms build is held there; main itself
  shows the swap through a 0.607 hole in WK (1/5) and every lift hop through 0.25. `whenShut` (841e05ee)
  fixes all of it — measured above.
- first-entry-warmup and rides-static-merge conflict in `src/Game.ts` with **main alone** (#777's
  `noteView`/checkClock); lazy-castle merges cleanly with undrawn-indoors and nav-resumable (`git merge-tree`).
- Remaining build cost (~49 ms, unminified): KidCrowd 26.7 (createKid for the prototype and the eye variant
  ~20, visibleTop 5), banquet spawn 9.4, dressCastle 9.5. Sharing KidCrowd's prototype kit between crowds
  would take ~25 ms more; not done (whenShut hides the build entirely).

## Checks (exit codes read directly)
tsc 0 (TS 5.9, then 7.1 after the merge); typecheck:test 0; check:seed-coverage 0; check:boot-chunk 0;
check:hall-solid 0; check:benches 0; check:castle 0 (117 diners, 130 figures, hearth); check:nav-spaces 0;
check:crowd-cull 0; check:render-budget 0; `LGP_SEEDS=5 validate:parks` 0 (accepted in 312 s, af71b6c3);
lazy tests 11/11. Running: full `pnpm run check`, then `test:procgen` (`$SP/full-check.log`, `$SP/procgen.log`).

## Next
- [ ] full check + test:procgen results; merge origin/main again if it moves; final door sanity run
- [ ] remove `.claude/worktrees/lazy-castle-combo` and `lazy-castle-main`; stop 6061/6062
