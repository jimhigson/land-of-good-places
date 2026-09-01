# Handoff — hoppable walls cost something to cross (#448-adjacent)

Branch `feat/hoppable-walls-cost`, worktree `.claude/worktrees/hop-penalty`.
Dev server port **5497**.

## The job (Jim's ruling)

> "Make the fountain wall hoppable, but give hoppable walls a high penalty so
> the route finding goes around them unless they are a much better path — for
> example the destination is the water in the fountain itself."

Two halves: (1) the fountain rim becomes `autoHoppable`; (2) `NavGrid` stops
being binary blocked/clear so a hoppable band costs *more* than the distance
walked through it, rather than being free.

**This PR must not make #448 look fixed.** Once the rim is hoppable the `plaza`
junction sitting dead centre in the fountain becomes reachable and #448's
symptom disappears while the placement defect remains. State it plainly in the
PR body. The placement fix is the next job, not this one.

## Findings so far (all measured)

### F1 — `paving.ts` / `OFF_PATH_COST_MULTIPLIER` is not on `main`

The brief points at it as prior art for keeping a weighted A* admissible. It
does not exist on `origin/main` — it belongs to the unmerged
`check:path-preference` work (#421/#416). So there is no in-repo precedent to
copy; the admissibility argument has to be made here from scratch.

The shape it describes is still the right one, and is what I am building:
**a multiplier on distance walked**, not a flat toll. Every edge then costs at
least its own geometric length, so the octile heuristic stays a lower bound and
A* stays admissible. A flat per-crossing toll cannot make that promise.

### F2 — the fountain rim at 1.1 m is NOT hoppable today, and marking it
`autoHoppable` alone changes nothing

`Fountain.RIM_TOP_HEIGHT = 1.1`, rim segments are `halfThickness = 0.32`.

- `MAX_AUTO_HOP_HEIGHT = 1.0`, so `autoHopClears(1.1, apex)` is **false**.
- Therefore `NavGrid` stamps it regardless of the flag, `Player`'s auto-hop
  never fires at it, and `checkHoppableColliders` does not even complain
  (its `inspect` returns early on `!autoHopClears`). The flag would be inert.
- `measuredHopCeiling(2*(0.32+0.62)) = measuredHopCeiling(1.88) = 1.010 m`.

Measured with `scripts/measure-hop-clearance.mts`'s own rig at the rim's real
thickness (0.32) — 210 attempts over 20/30/60/90/120 fps × walk/sprint ×
0/20/40° approach × 7 frame phases, at `topHeight = 1.10`:

```
clean 182   popped 28   stuck 0
worst clean-for-every-phase ceiling at halfThickness 0.32: 1.045 m
worst clean-or-popped:                                     1.259 m
```

So 1.1 m is above the honest clean ceiling (1.045) — the 28 "popped" are the
wall going solid under her mid-footprint and ejecting her, which a route must
never plan on. It is *nearly* flyable, and only at low fps / oblique approach
does it fail.

**Consequence:** the rim's collider top must come down to `MAX_AUTO_HOP_HEIGHT`
(1.0) for the ruling to be buildable at all. That is a collider-only change and
it does not touch the mesh: the visible stone crest is the torus at
`y = 1.05 ± 0.22`, i.e. **1.27 m**, so the collider already sits 0.17 m below
what you can see, and 1.0 makes that 0.27 m. Nothing moves on screen.

## Plan

1. ✅ F1/F2 probes.
2. Measure the real detour around each hoppable wall in the built park
   (`NavGrid` with `hopApex = 0` stamps every hoppable collider solid — no code
   change needed to get the "hops are solid" baseline).
3. Derive the multiplier from that distribution; implement cell cost in
   `NavGrid`.
4. Fountain rim: `autoHoppable: true`, `RIM_TOP_HEIGHT` 1.1 → 1.0.
5. Route deltas across the five seeds (canonical 20260728, 2, 5, 11, 18) via
   `LGP_SEED`.
6. `pnpm run check`, `test:procgen` (497), `build`; browser QA on 5497.
