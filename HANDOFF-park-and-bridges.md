# HANDOFF — park layout + bridges as one joint solve (issues #269/#116, PRs #286/#330)

Branch: `park-and-bridges` (worktree `.claude/worktrees/park-and-bridges`),
based on `origin/grid-aligned-park` with `origin/bridge-backtrack` and
`origin/main` merged in. Jim's ruling: design the park around the bridge
constraints — streets, plots AND railway crossings are one joint solve, not
bridges squeezed in afterwards.

## Settled design decisions (Jim's, do not re-litigate)

1. Grid pitch 12 m.
2. Route-on-grid with loop-closing, HIGH connectivity (no 259 m path for a
   15 m crow-flight pair).
3. Rounded corners, 1.5–2 m fillets; square junctions otherwise.
4. Buildings and streets solved JOINTLY (round-robin with rollback) — and
   bridges are part of that same joint solve now.
5. Statue circle: exactly 4 connections at compass points, true circle.
6. Diagonals: genuine minority exception only.
7. One entrance/exit node per attraction, strictly in front.
8. Pavement reaches attraction doors with 0 m gap.
Plus: riders sit; `BRIDGE_RISE` = 4.25 m (real commits on bridge-backtrack,
`src/world/train/clearance.ts`) — reuse, don't redo.

## State (updated every commit)

- **Done**: merged `origin/bridge-backtrack` (both riders sit, BRIDGE_RISE
  4.25, bridge backtracking search, invariants) and `origin/main` into
  `park-and-bridges`. Conflicts: import-only in `test/procgen/invariants.ts`
  (kept both sides' imports, dropped `SEAT_Y` — riders-sit removed its use).
  Cross-branch break fixed: `paths.ts` imported `FENCE_OFFSET` from
  `train/fence`; bridge-backtrack moved it to `train/clearance`. tsc clean.
- **Measured on merged tree (canonical seed)**: bridges built 0/7,
  `check:park` fails `poi.stranded: 35` (was 29 on grid-aligned-park alone,
  5 on bridge-backtrack seed 2). All 7 crossings fall back to level
  crossings.
- **Root-cause in progress for poi.stranded**: the stranded nodes form
  pockets east of the park (x 42–67, z 29–60; x 55–59, z −22…−44; north
  strip x 17–42, z 54–60) — beyond the railway, connected internally but cut
  from the main graph. Direct probe of the cut edges finds them blocked by
  the **rail fence's own walls standing inside what should be an open
  level-crossing gap**: crossing at railDistance 330.1 (halfGap 7.24 →
  open [322.9, 337.3]) has fence flank walls at railD 322–333 and the
  centre-line TRACK_CLEARANCE wall likewise (site 2: crossing railD 116.7,
  gap [108.2, 125.2], cap found at 125.1 but blocked chord passes the gap
  edge/cap). Suspect: fence's open-interval unwrap/merge logic vs these
  crossing positions, OR fence built from different crossing list than
  `ParkTrain.fallbackCrossings`. Instrumentation added locally
  (`LGP_DEBUG_FENCE`, uncommitted) — NOTE: `quietly()` in park-harness
  swallows console.warn, use `process.stdout.write` for debug prints.
- Debug helpers (uncommitted, not for merge): `scripts/debug-park.mts`,
  `scripts/debug-stranded.mts`, `scripts/debug-crossings.mts`,
  `scripts/debug-fence.mts`.

## Plan

1. Root-cause + fix the fence-vs-crossing mismatch (this is likely most of
   poi.stranded, and it is exactly the "two definitions of one thing"
   disease).
2. Make bridge feasibility a first-class constraint in the joint solve:
   when paths choose where to cross the railway, the solver must verify a
   real bridge (ramp clearance vs everything placed/reserved so far) fits
   there, and backtrack to a different crossing point / street shape if
   not; level crossing only as rare last resort.
3. Get real bridges on a majority of crossings on canonical, seed 2,
   seed 18. Report real numbers.
4. Extend `test/procgen/invariants.ts` red-then-green for whatever changes.
5. Full verify: tsc, `npm run build` (unpiped exit code), `test:procgen`
   all 5 seeds, real-browser QA with screenshots (top-down grid + walk two
   bridges).

## Numbers to beat / reproduce

- `scripts/with-node npm run check:park` — canonical: `poi.stranded: 35`.
- Bridges: 0/7 canonical, 0/7 seed 2 (`LGP_SEED=2`), 0/5 seed 18.
- `scripts/with-node node --no-warnings --import ./scripts/ts-extension-resolver-register.mjs scripts/debug-crossings.mts`
  prints crossings/bridges/fallbacks from the real built ParkTrain.
