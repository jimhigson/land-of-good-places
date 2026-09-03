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

## Piece 1 measurements (canonical + all 16 pool seeds)

Placed arch, measured on the real built park:

```
arch spans 10.20 m along X   (2 x (4.3 + 0.80))
headroom  3.60 m             (needs TALLEST_CHILD_HEIGHT 2.97)
clear opening 7.00 m
piers solid within 1.42 m    (PLAYER_RADIUS 0.62 + keep-out 0.80)
```

The 3.60 m is **raycast up through the opening**, and it independently
reproduces the asset's own `TALLEST_CHILD_HEIGHT + 0.630` = 3.60. Two
different measurements of the same thing agreeing is the reason to believe
either.

### The old headroom clause was measuring the wrong thing

`probe-gate-pool.mts` clause 4 was `box.min.y - ground`. That was right only
because the old gate's *crossbar* was a separate mesh from its posts. The
authored arch is one asset whose piers reach the paving, so the same
expression reported **0.00 m of headroom under a gate you can walk through**.
Now raycast upward from a child's toes — see `scripts/gate-arch-measure.mts`.
Downward rays are useless here: toon materials are `FrontSide`, so a ray from
the sky cannot see an underside at all.

### The 0.80 keep-out costs nothing — controlled, not assumed

Same probe points, only the collider radius changed:

| pier collider radius | pool seeds failing |
|---|---|
| 0.80 (`GATE_ARCH_PIER_KEEP_OUT`, this branch) | 24, 288, 326, 451 |
| 0.55 (`fix/torus-480`'s value) — **control** | 24, 288, 326, 451 |

**Identical sets.** The four failures are the boundary spline crossing the
gateway — **issue #481, not this branch**. They show up here and not in the
previous agent's 15/16 because that probe only swept +/-2.04 m of the opening
and this one sweeps the full 7.00 m clear width.

### One probe point was a coin flip, not a measurement

The first sweep failed 5 seeds asymmetrically (24, 128 on the left; 326, 451
on the right). The outermost probe sat at exactly
`GATE_ARCH_CLEAR_WIDTH / 2 - PLAYER_RADIUS` = 2.88 m, where a child is
*tangent* to a pier: overlap zero, so whether `resolve` moves her is the last
bit of a float. `OPEN_PROBE_MARGIN` (0.2 m) makes it a question again.
