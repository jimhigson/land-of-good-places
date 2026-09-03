# HANDOFF — place the authored gate arch, then the bus arrival camera

Branch `feat/arch-placement`, worktree `.claude/worktrees/arch-placement`.
Based on `fix/torus-480` (PR #482), with `art/gate-arch-asset` merged in.
**Stacked on both** — do not rebase onto `main` until those land.

Dev server port: **5311** (`vite --port 5311 --strictPort`).

## Two pieces

1. **Place `createGateArch()`** — replace the procedural posts+torus that
   `src/world/entrance/gateArch.ts` builds, in both `Entrance.ts` and
   `BusJourney.ts`, with the authored `.glb`. Collider: two circles r
   `GATE_ARCH_PIER_KEEP_OUT` (0.80) at the feet, nothing else.
2. **Bus arrival camera** — doors → follow her under the arch → rise to the
   normal pseudo-isometric pose.

## Status

- [x] Worktree, install, merge of `art/gate-arch-asset` (clean; script set
      unchanged + `pack/blend/render:gate-arch`)
- [ ] Piece 1
- [ ] Piece 2

## Facts already established (do not re-derive)

- `park-gate-arch` is read by **two** consumers, both via
  `getWorldPosition`/`Box3.setFromObject` on whatever `Object3D` carries the
  name: `scripts/check-park-map.mts` (gate position) and
  `test/procgen/parkFacts.ts` → `theParkGateArchStandsOverItsGateway`.
  A `Group` is fine; it does not have to be a mesh.
- `park-gate-post-0/1` are read only by `parkFacts.ts`. The authored `.glb`
  has **one** `gate-arch-piers` mesh covering both piers, so there is no
  per-side node to inherit the name — the markers must come from
  `buildGateArch`'s own `feet`, the same one owner the colliders read.
- The invariant's `GATE_FOOT_TOLERANCE` (0.6) was sized for the torus's
  0.28 m tube overhang. The authored piers overhang by
  `GATE_ARCH_PIER_KEEP_OUT` (0.80), so the tolerance **must** be re-derived
  from the asset or clause 1 fails for a correct arch.
- **Do not probe on the gate line.** The park boundary keeps a child inside,
  so a `PLAYER_RADIUS` body on z = 60 is blocked whatever the gate does —
  33 of 33 probes, measured by the previous agent. Probe 1.5 m in for "open",
  1.0 m in front of a pier for "solid".
- Issue **#481** is open: on pool seed 288 and sweep seed 18 the boundary
  spline crosses the gate opening. The walkability clause is withheld for it
  and announces the gap on stderr. Not this branch's bug.
