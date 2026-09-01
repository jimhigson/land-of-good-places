# Handoff — hoppable walls cost something to cross

Branch `feat/hoppable-walls-cost`, worktree `.claude/worktrees/hop-penalty`.
Comparison worktree at `origin/main`: `.claude/worktrees/hop-penalty-base`
(detached; remove it when done). Dev server port **5497**.

## The job (Jim's ruling)

> "Make the fountain wall hoppable, but give hoppable walls a high penalty so
> the route finding goes around them unless they are a much better path — for
> example the destination is the water in the fountain itself."

#448 is closed — Jim ruled the junction-placement thing is nothing — so there
is nothing owed about masking it.

## Done

- `NavGrid`: `hopBand` alongside `blocked`; an edge into a band costs
  `HOP_COST_MULTIPLIER` (6.4) times the distance, and may change height by the
  hop's own reach rather than a walking step. The string-pull may no longer
  straighten across a band.
- `Fountain`: 28 rim segments `autoHoppable`, `RIM_TOP_HEIGHT` 1.1 → 1.0.
- Three instruments: `measure-hop-detours.mts`, `measure-fountain-rim-step.mts`,
  `measure-route-drift.mts`.

## Findings (all measured)

### F1 — `paving.ts` / `OFF_PATH_COST_MULTIPLIER` is not on `main`

The brief points at it as prior art for keeping a weighted A\* admissible. It
does not exist on `origin/main` — it belongs to the unmerged
`check:path-preference` work (#421/#416). The shape it describes is still the
right one and is what was built: **a multiplier on distance walked**, never a
flat toll. Every edge then costs at least its own geometric length, so the
octile heuristic stays a lower bound and A\* stays admissible.

### F2 — the rim at 1.1 m was not honestly hoppable, and the flag alone is inert

`MAX_AUTO_HOP_HEIGHT` is 1.0, so `autoHopClears(1.1, apex)` is false: `NavGrid`
would have gone on stamping the rim solid, `Player`'s lookahead would never
have fired, and `checkHoppableColliders` would not even have complained (its
`inspect` returns early on `!autoHopClears`).

Measured on the rim's own 0.32 m half-thickness with `measure-hop-clearance`'s
rig — 210 attempts, 20–120 fps × walk/sprint × 0/20/40° × 7 frame phases:

```
at topHeight 1.10:  clean 182   popped 28   stuck 0
worst clean-for-every-phase ceiling at halfThickness 0.32:  1.045 m
measuredHopCeiling(2*(0.32+0.62)) = measuredHopCeiling(1.88) = 1.010 m
```

So 1.0. Invisible: the visible stone crest is the torus at `y = 1.05 ± 0.22`,
i.e. 1.27 m, so the collider already sat 0.17 m below it and now sits 0.27 m.

### F3 — the water is 0.63–0.66 m up, against a 0.62 m walking step

**Corrected 1 Sep** — the first version of this finding generalised the
canonical seed into a claim about the park, and the revert test caught it.

`Fountain.groundLevel` lifts the ground inside the rim to
`waterLevel - WADE_SINK`, and `World.attachPlayer` composes that onto the
player's sampler — the sampler `NavGrid` builds its lattice from. Measured
(`measure-fountain-rim-step.mts`): the step into the water is **0.631 m** on
the canonical seed and **0.658 m** on seed 11, against `BUILDING_STEP_UP` 0.62.

Fixed by the level rule inside a band being the hop's own reach
(`MAX_AUTO_HOP_HEIGHT`, asked of `Collision.ts`, not restated) — because
getting over a hoppable wall *is* a jump. **Not** by moving `BUILDING_STEP_UP`.

**How load-bearing that is, measured rather than assumed.** With the rule
removed: the canonical seed and seeds 2, 5 and 18 still get into the water, on
whichever bearing the terrain round the rim runs highest; **seed 11 does not
get in at all** — 0.658 m of step over ground that varies by 5 mm all the way
round. So the fountain would have worked in front of Jim and been broken on a
fifth of the parks CI builds. `check:fountain-hop` therefore sweeps all five
seeds; on the canonical seed alone it sat green over this exact revert.

### F4 — the multiplier, 6.4, derived

`measure-hop-detours.mts --sweep`. For every hoppable collider in the built
park it stands two points either side and asks what a walker with **no jump at
all** must do (a `NavGrid` built with `hopApex = 0` — same class, no flag, no
third copy of the hop rule). How much longer that is than the straight line
through the wall is the detour. Pooled, five CI seeds, 73 crossings:

```
p0 3.34  p25 4.77  p50 5.67  p75 7.59  p90 10.32  p95 14.02  p100 21.76
```

Median fattened band 1.92 m. Pricing a median crossing at the p90 detour:
`1 + 10.32/1.92 = 6.38` → **6.4**. Checked at both ends: at M=2 not one of the
73 goes round; by M=16 all of them do (blocked in all but name). At 6.4, 86%
go round.

Measured against the **straight line**, not against a routed crossing — else
the number derives itself and drifts on every re-run.

### F5 — route drift, five seeds, 400 routes each, before vs after

`measure-route-drift.mts`, run on `origin/main` and on the branch:

| seed | identical | waypoints only | length moved | mean move | total length |
|---|---|---|---|---|---|
| 20260728 | 192 | 7 | 201 | +0.49 m | 33993.8 → 34093.0 (+0.29%) |
| 2 | 190 | 2 | 208 | +1.39 m | 34995.4 → 35284.6 (+0.83%) |
| 5 | 225 | 10 | 165 | +1.18 m | 56486.4 → 56681.4 (+0.35%) |
| 11 | 239 | 3 | 158 | +0.53 m | 33292.6 → 33377.0 (+0.25%) |
| 18 | 163 | 5 | 232 | +0.50 m | 42247.7 → 42362.8 (+0.27%) |

Roughly half of all routes are **identical to the centimetre**. The half that
moved got a mean half-metre to 1.4 m longer: the router walking round a garden
wall it used to vault. Nothing got shorter in aggregate and nothing lost a
destination — 8 routes across the five seeds went the other way, from "gave up"
to **reached**, and two of the canonical seed's are the fountain itself:

```
170  (-12.1, 10.2) -> (0.8, 8.5)    6.64 nearest  ->  16.19 reached   (out of the water)
193  (-22.9, 2.6)  -> (-9.7, 10.1) 16.09 nearest  ->  16.97 reached   (into the water)
```

Waypoints are up 5–8%: a crossing is emitted as planned rather than
string-pulled, which is the point.

### F6 — watched running, port 5497, canonical seed

Deep link `/spawn?pos=-9.07,16&facing=180`, then `tapNavigator.navigateTo`,
watching `player.position` every frame:

| leg | ended | closest to fountain centre | entered water | highest feet |
|---|---|---|---|---|
| walk past to the far side | 0.33 m from target | **5.24 m** | **no** | 0.168 m |
| walk into the water | 0.48 m from centre, y 0.744 | 0.48 m | yes | **1.244 m** |
| and back out again | 0.34 m from target, y 0.149 | 0.25 m | yes | **1.998 m** |

She goes round when passing, hops in when sent in (feet 1.24 m, over the 1.0 m
rim), and hops back out (1.998 m = the same 1.25 m hop off the 0.744 m water).
No console errors. Also measured: over 20 s the closest any of the park's 31
children ever got to the fountain centre was **4.99 m** — nobody paddles.

## Gates

- `pnpm run check` exit 0 (twice, before the new gate); re-running with it.
- `pnpm run build` exit 0.
- `pnpm run test:procgen` exit 0, **497 passed**.

## Left to do

- Confirm the final `check` run, raise the PR. **Do not merge.**
- Remove both worktrees and kill the 5497 dev server by PID.
