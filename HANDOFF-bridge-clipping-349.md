# HANDOFF — issue #349, path geometry clipping through the entrance bridge

Branch: `bridge-paving-clip` (worktree `.claude/worktrees/bridge-paving-clip`, off `origin/main` @ `311ad89`).

## The report

Jim, playing `main` at `311ad89` (just after the entrance-bridge PR #348):
*"on entering the park and walking straight to the first bridge, there is some
weird item clipping into the bridge"* — screenshot on issue #349. Sandy/cream
**path-coloured** geometry projecting out through the bridge's stone masonry
below deck level: a flat wedge out of the near spandrel beside the arch, and a
thinner sliver the other side of the arch mouth.

## Root cause — found, measured, not yet fixed

**The paving-lift test is wider than the masonry the bridge actually builds, and
nothing connects the two numbers.**

- `bridges.ts` → `buildOneBridge` → `Bridge.pavingHeightAt` lifts a path vertex
  when `footprint.covers(x, z, roadHalf - walkHalf + PATH_KERB_OVERHANG +
  PATH_CARRIER_SLACK)`. `covers()`'s own across extent is `walkHalf`, so the
  lift reaches **`roadHalf + 0.425 + 0.25` = `roadHalf + 0.675`** across.
- `buildShellGeometry` sweeps the masonry to **`halfAcross = roadHalf +
  BRIDGE_WALL_THICKNESS` = `roadHalf + 0.3`** (`bridgeFootprint.ts:762`).
- So up to **0.375 m** of lifted paving hangs past the outside face of the
  parapet, at the hump's own height, with nothing under it. The quad joining it
  to the un-lifted terrain vertex beside it is the wedge in the screenshot.
- Underneath that: `roadHalf` is `crossing.pathHalfWidth`, the **path surface's**
  half-width, but the drawn path is `pathHalfWidth + PATH_KERB_OVERHANG` wide
  (`pathGraph.ts` `buildPaths` draws the cream kerb `PATH_KERB_OVERHANG` proud
  each side). The bridge is built 0.425 m per side too narrow to carry the path
  it is carrying, so the kerb was never going to land on stone.

CLAUDE.md's "two definitions of one thing, kept in step by hand": the ribbon and
the masonry each decide separately where the paving ends.

## Measurements (canonical seed, built park, `scripts/park-harness.mts`)

Per built bridge: every lifted paving vertex, plan-projected against the union of
the bridge shell's own triangles.

```
bridge-172.0  roadHalf=1.600 halfAcross=1.900 shift=0.000
              lifted=164  outside masonry plan=58  worst=0.371 m
              worst vertex (-20.45, 4.35, 38.71), 4.08 m above the terrain
bridge-266.0  roadHalf=1.300 halfAcross=1.600 shift=0.000
              lifted=108  outside masonry plan=54  worst=0.125 m
```

0.371 ≈ the 0.375 m ceiling the arithmetic above predicts; 0.125 =
`PATH_KERB_OVERHANG − BRIDGE_WALL_THICKNESS` exactly (the kerb's own outer edge).
`shift` is 0 on both bridges here, so the lateral search shift is *not* a
contributor on this seed — do not chase it first.

## Changed so far

Rebased onto `origin/main` @ `e71f80a` (clean; main had only moved by a CLAUDE.md
commit). Worktree is now `.claude/worktrees/eng-349`.

The previous agent's temporary `LGP_BRIDGE_DEBUG` `console.log` and its
`tmp-measure.mts` were **never committed**, so they did not survive onto the
branch — nothing to delete. `git diff origin/main...HEAD` is this file alone.

## Measurement reproduced (2026-08-29) — and the measure itself corrected

The handoff's figures reproduce **exactly**, but only once the measure asks the
right question. Measuring "every vertex `pavingHeightAt` claims, against the
shell's plan triangles" gives `worst = 1.269 / 1.334 m` — and those worst
vertices sit at `y ≈ 0.01`, at the **ramp feet**, where `heightAt` has clamped
the hump back down to the terrain. Paving lying on the ground past the end of
the masonry is not the bug and is not visible; `pavingHeightAt`'s `covers()`
margin pads the *along* extent as well as the across one, which is where that
1.3 m comes from.

Restrict to vertices genuinely lifted clear of the ground
(`y - terrainHeight(x, z) > 0.1`) and the handoff's numbers come back:

```
bridge-172.0  floating outside masonry = 56, worst 0.371 m
              at (-20.45, 4.35, 38.71), 4.11 m over terrain
bridge-266.0  floating outside masonry = 54, worst 0.125 m
              at (-1.06, 0.11, -12.52)
```

**So the invariant to write is "paving a bridge has lifted clear of the ground
has masonry under it", not "…is inside the plan footprint".** The second version
fails on harmless ramp-foot paving and would have to be fudged to go green —
exactly the shape of assertion CLAUDE.md warns about.

## Done (2026-08-29)

**The fix** (`d8bc1c5`). `bridgeRoadHalfFor(crossing)` in `bridgeFootprint.ts` is
now the single owner of the road's width — `pathHalfWidth + PATH_KERB_OVERHANG`,
the *drawn* paving including its kerb. `halfAcross`, `walkHalfFor` and the deck
search all measure off it. In `bridges.ts`, `pavingHeightAt`'s across limit is
`Math.min(roadHalf + PATH_CARRIER_SLACK, halfAcross)` — the `min` is what makes
the stone the single authority, so the two numbers cannot drift apart again
however the constants move.

`PATH_KERB_OVERHANG` is no longer imported by `bridges.ts` at all, which is the
structural point: the module that lifts the paving no longer does its own
kerb arithmetic.

**Measurement, built canonical park** — floating paving outside its own bridge's
masonry plan:

| bridge | before | after |
| --- | --- | --- |
| `bridge-172.0` | 56 vertices, worst 0.371 m | **0, worst 0** |
| `bridge-266.0` | 54 vertices, worst 0.125 m | **0, worst 0** |

**The invariant** (`36e0f5f`, `3f32667`): `bridgePavingIsCarriedByItsOwnMasonry`
in `invariants.ts`, fed by `BridgePavingFact` in `parkFacts.ts` (the measurement
lives in the fact because it needs `terrainHeight`, which only a dynamic import
may reach). Guards the vacuous case where no bridge lifts any paving at all.

Broken deliberately (re-widening the lift test off the clamp) it says:

```
bridge-172.0 lifts 8 of its 162 carried paving vertices past its own masonry:
the worst (path-surface) sits 0.361 m outside the stone in plan at (-21.2, 43.2),
2.87 m above the ground under it — that paving is hanging in mid-air past the
parapet, and it is what clips through the masonry
```

**Five seeds**: `npm run test:procgen` → 448 passed / 14 files, exit 0.

**No seed lost a bridge** to the 0.85 m of extra width (the handoff's flagged
risk). Bridges built, before → after, identical on every seed:

| seed | crossings | bridges | fallbacks |
| --- | --- | --- | --- |
| canonical | 2 | 2 → 2 | 0 → 0 |
| 2 | 4 | 3 → 3 | 1 → 1 |
| 5 | 4 | 3 → 3 | 1 → 1 |
| 11 | 4 | 2 → 2 | 2 → 2 |
| 18 | 3 | 3 → 3 | 0 → 0 |

Note `npm install` was needed in the worktree: the shared checkout's
`node_modules` has no `vitest` and no `playwright-core`.

**Left**: full `npm run build`, headless before/after screenshots (port 5341),
PR.

## Left to do, in order (original)

1. Give the ribbon and the masonry one owner for where the paving ends. Intended
   shape: the bridge's road is the **drawn paving's** half-width
   (`pathHalfWidth + PATH_KERB_OVERHANG`, one helper, used by both
   `planConservative` and `planReal`), and `pavingHeightAt`'s across limit is
   hard-clamped to the masonry's own `halfAcross` so the stone is the single
   authority on the outer edge. Do **not** just shrink `PATH_KERB_OVERHANG`.
2. Re-run the measurement above; every bridge must report `worst = 0`.
3. Add the invariant in `test/procgen/invariants.ts` + its fact in
   `test/procgen/parkFacts.ts`: paving carried by a bridge does not extend
   beyond that bridge's own masonry plan footprint. Break it deliberately, quote
   the red message.
4. Five seeds (`npm run test:procgen`). Widening the road makes the search ask
   for 0.85 m more width — **check no seed loses a bridge to a level-crossing
   fallback**; `plannedBridgeSiteDistances` promises one at each planned site.
5. `npx tsc --noEmit`, full `npm run build` (unpiped exit code), real-browser
   before/after screenshots from Jim's viewpoint, PR.

## Reproducing / where to look

- Production build + `vite preview --port <yours> --strictPort`, private window.
- Canonical seed. The first bridge walking in from the gate is
  **`bridge-172.0`**, crown at y≈4.41, worst protrusion near
  **(-20.45, 38.71)**. `/view?camPos=...&camDir=...` puts the camera on it
  without walking — aim slightly above and to the side, looking down the deck.
- Headless: `scripts/with-node node --no-warnings --import
  ./scripts/ts-extension-resolver-register.mjs <measure script>`.

## Tried and rejected

- **Clamping the lift test to `halfAcross` alone (leaving the road narrow).**
  The drawn kerb's outer edge sits at `roadHalf + 0.425`, i.e. 0.125 m *outside*
  `halfAcross`, so its outermost vertices would stay on the terrain while their
  neighbours rise 4 m — the kerb tears down the length of the bridge. That tear
  is the exact failure `PATH_CARRIER_SLACK` was added to stop; re-introducing it
  is a regression, not a fix. The road has to get wider, not the test narrower.
