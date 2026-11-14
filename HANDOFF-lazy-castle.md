# HANDOFF — lazy castle interior (PR #759, draft)

Branch `lazy-castle`, worktree `.claude/worktrees/lazy-castle`. Ports: **6061** branch preview, 6062 main
baseline preview (worktree `.claude/worktrees/lazy-castle-main`, detached at origin/main), 6063 scratch.
All started by `$SP/serve.sh` / `$SP/dev.sh`, killed by their own PIDs.
`$SP` = `/private/tmp/claude-501/-Users-jim-dev-landOfGoodPlaces/63860b08-4a9b-4597-b7cf-7b1677887a9f/scratchpad/lazy-castle`
(harness: `door.mjs` + `probe.js`, `ab-door.sh`, `ab-lift.sh`, `sum-door.mjs`, `sum-lift.mjs`, `shots.mjs`/`shots2.mjs`,
`filmstrip.mjs`/`filmstrip2.mjs`, `navcount.mjs`, `subtree.mjs`/`longest.mjs` for cpuprofiles). No PR to open.

## Brief (13 Nov, resumed 14 Nov) — status
1. WebKit: no iris on first entry → **fixed**: built in the iris midpoint, never the door frame; the swap is
   covered in both engines. Residual: the ~60 ms build is held behind a *partly* closed iris (see below) until
   perf/first-entry-warmup's `whenShut` lands — measured with it: fully shut.
2. NavGrid ~505 ms freeze → **gone** (since #764), measured with a control.
3. `DrawnSpaces` → adopted by construction (furnishings go under `interiorRoot`, registered as `castle`;
   banquet gated on `isDrawn`); `check:render-budget` census green, no strays.
4. `castleEntranceBand` prefetch + refusal, `test/lazy/castleDoor.test.ts`, kidCrowd `cloneMaterial` → done.

## Commits (pushed)
- 13 Nov: 24b998ed build behind the iris; castleDoor test; c72e6e7f kidCrowd `cloneMaterial`; 5579a745 band.
- 14 Nov: b57cbc16 merge main bb7e9c99; **af71b6c3 crowd far levels shared by content**
  (`src/core/instancedLod.ts`, test `test/lazy/crowdLodTwins.test.ts`); b118b1d5 prefetch asked only while
  the chunk is missing; d30d41a2 merge main 66bcd7f8 (#779 TS 7.1 / Vite 8.3.8, #780) — both merges clean,
  `scripts` object identical to main's.

## The far-level fix (af71b6c3)
`furnishCastle` 104.8 → 49.1 ms (unminified production build, Chromium CPU profile): `lowDetailGeometry` was
58.9 ms because the banquet's `KidCrowd` builds its own prototype — 30 of its 44 parts separate objects with
byte-identical arrays (`$SP/twins.mjs`, real page) — and the cache was keyed by object. Now matched by
content (exact element comparison, weak refs); "no second level" stored as `null` so each twin gets its own
source back. Test red on main's file: `Tests 2 failed | 2 passed (4)`; green 4/4. `check:crowd-cull` main =
branch: 64 of 97 parts with a far level, 85,136 → 59,847 tris, worst vertex 3.30 mm (bound 6).

## Measurements (14 Nov, M4 Pro, load 33–110 from a VM + other agents; main/branch interleaved)
**Door, first entry after a page load** — `/spawn?pos=24.52,-18.17&facing=180&seed=5&perf=1`, hold W+D,
production builds, 1280×800@2. Final set: main 66bcd7f8 vs branch f053417f, 3 runs each (an earlier set,
main bb7e9c99 vs branch af71b6c3, 5 runs each, agrees). min–max (median), ms:
| | Cr main | Cr branch | WK main | WK branch |
|---|---|---|---|---|
| door frame (asks the iris to close) | 8.3–8.4 | 8.3–8.4 | 16–27 (20) | 16–23 (17) |
| frozen before the swap is drawn | 11–12 | 58–61 (61) | 17–20 | 77–92 (78) |
| iris hole at that freeze (× diagonal, probe) | 0.25 | 0.25 | 0–0.61 | 0.61–0.90 |
| hole on the first new-world frame | 0 | 0 | 0–0.106 | 0–0.021 |
| worst frame close→open+1.5 s | 69.5–74.7 | 68.8–74.6 | 159–244 | 164–227 |
| worst frame 1.5–9 s after | 18.2–24 | 16.6–71.1 (18.6) | 29–59 | 38–51 |
The worst-around frame is the mall's first frame (program links behind the iris) on both builds.
**What is painted** (Chromium CDP screencast, `$SP/film/door-before-after-final-small.png`): main holds the
nearly shut iris (hole ~0.12) 69 ms; the branch holds a half-closed iris (hole ~0.55) on the old park for
138 ms (the ~58 ms build plus the same first-frame cost), then the same mall. Visible on the first entry
only. Earlier set (af71b6c3): 131 vs 182 ms, both at the small hole.
**Combo** (`.claude/worktrees/lazy-castle-combo` = this + perf/first-entry-warmup + perf/undrawn-indoors,
scratch, never pushed; Game.ts resolved for measuring only): hole 0 on every frame before the reveal, 3/3
Chromium, 3/3 WebKit — with `whenShut` the build is behind a painted-shut iris.
**Preview** `https://pr-759-f053417-land-of-good-places.blockstack.workers.dev` (HTTP 200): door frame 8.3
(Cr) / 31 (WK), freeze 62 / 69, first new-world hole 0 / 0; `/castle?deck=1` loads furnished.
**Lift** (`/castle?deck=0&at=-19,5`, mall→hall→roof→mall, main bb7e9c99 vs af71b6c3, 4 runs each, worst frame
per hop, median): Cr hall 16.1 vs 20.3, roof 48.2 vs 49, mall 13.8 vs 13.8; WK hall 50 vs 38, roof 65 vs 64,
mall 35 vs 26. Parity. Both builds: a program link at the roof hop's press (WK up to 1269 main / 253
branch) and the new deck shown through a 0.25 hole on the first frame (iris timing).
**Boot** (final set, Cr, `/spawn`): first frame 2190 → 1834 ms (medians), longest task 1643 → 1345, JS heap
125 → 105 MB; WK first frame 2714 → 1954. `check:boot-chunk`: boot set 49 chunks 3808 KB → 52 chunks
3614 KB (−194 KB); lazy 2681 → 2881 KB; `castleInterior` chunk 200 KB (castle.glb 172 KB was in main's boot).
**NavGrid** (dev, `NAV_GRID_BUILDS`, `navcount.mjs`): walking in registers 55 colliders (rev 3151→3206);
shipped: the park lattice gets 1 patch of 0 cells (0.2 ms), 2 small whole builds (worst 3.8 ms). Control
`patching=false` (pre-#764): worst whole build 167.4 ms — the instrument sees the freeze when it exists.
**DrawnSpaces / render budget** (dev, Metal, both exit 0): castle 276 draws / 168,460 tris (main) vs 278 /
168,598; park 590 / 889,112 vs 591 / 889,128. The castle root is 1861 objects from boot on main, 957 until
she goes in on the branch; out of the graph everywhere else; no strays.
**Pixels** (`?clock=5`, 1280×800@1): mall, hall, hearth, roof, outside: 0 pixels differ; lift view ≤ 2/255
(the call button's CSS glow; controls main-vs-main ≤ 1/255). The companion pet's blink differs between
loads of the *same* build (73 px; main 1 of 9 shots, branch 1 of 9) — `faceLife.ts`'s shared seeded
stream; not this branch's. `$SP/film/decks-before-after.png`.

## Findings for others
- **perf/first-entry-warmup**: merge it before or with this. Main's `irisWipe` runs the midpoint on its close
  timer with the eye still 0.25 (Cr) / up to 0.9 (WK) of the diagonal open; this branch's build is held
  there, main itself shows the swap through a hole in WK and every lift hop through 0.25. `whenShut` fixes all.
- first-entry-warmup and rides-static-merge conflict in `src/Game.ts` with **main alone** (#777); lazy-castle
  merges cleanly with undrawn-indoors and nav-resumable (`git merge-tree`).
- Remaining build (~49 ms unminified): KidCrowd 26.7 (createKid for prototype ~9 and eye variant ~11,
  visibleTop/setHairStyle ~5), banquet spawn 9.4, dressCastle 9.5. A module-level memo of the eye-variant
  face maps would take ~11 ms (and the duplicate face textures) off; sharing the whole prototype kit ~25.

## Checks (exit codes read directly)
tsc 0 (TS 5.9, then 7.1); typecheck:test 0; check:seed-coverage 0; check:boot-chunk 0; check:hall-solid 0;
check:benches 0; check:castle 0 (117 diners, 130 figures, hearth); check:nav-spaces 0; check:crowd-cull 0;
check:render-budget 0; `LGP_SEEDS=5 validate:parks` 0 (accepted, 312 s); lazy tests 11/11.
CI run 43604860347 on f053417f: success — all 12 check shards, 6 procgen shards, 16 "Park N still accepted",
coplanar, walk reach, PR preview. Local full `pnpm run check` + `test:procgen`: `$SP/full-check.log`,
`$SP/procgen.log`.
