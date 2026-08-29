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

Nothing committed but this file. Working tree carries one **temporary** debug
`console.log` in `src/world/train/bridges.ts` (guarded by `LGP_BRIDGE_DEBUG`) and
a scratch `tmp-measure.mts` at the worktree root — both to be deleted, neither
committed.

## Left to do, in order

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
