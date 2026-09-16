# HANDOFF — two checks made honest about their coverage (`fix/road-coverage`)

**Branch `fix/road-coverage`, off `feat/sphere-combined` at `903982ba`.
Model: Opus** (Overseer's choice; a replacement must also be Opus). Worktree
`.claude/worktrees/road-brow2`.

Supersedes the previous `HANDOFF-road-brow.md` on `fix/road-brow`, whose brief
— make the cat bus arrive from further away — **Jim withdrew**: *"showing the
bus coming in a couple meters is fine and good, I don't mind that at all."*
The 2 m approach stays. `ArrivalSequence`, `ROLLING_IN`, `BUS_PULLS_AWAY` and
`entranceRoadBrow()` are all **untouched**. Nothing a child sees changed.

## What this branch does

`check:entrance-road` was the red gate on the sphere PR. It was **void, and
correctly said so**: its control found no collision on any of the ten pool
seeds, so its verdict meant nothing. Two independent causes, both fixed here.

### 1. It swept 1.4% of the road and said nothing about it

The sweep ran `+entranceRoadBrow()` to `-entranceRoadBrow()`. The sphere
(#511) removed the ceiling that crushed the road inboard of the ride, so the
road's outset is 19.07 m everywhere and `browAt()`'s predicate — outset past
`RIM_OUTSET_START` (12 m) — is **true at the first station**. The brow
collapsed to one station spacing, so the sweep was **2 m of a 145.7 m road**.

The question this check's own name asks is about the **road** —
`isInEntranceRoad`'s corridor, the exact span `railRace/track.ts` is asked to
keep legs out of — so it now sweeps `entranceRoadExtent()` end to end, and
prints the swept length in metres and as a fraction of the road on every run,
to stderr. **A harness span; the bus still drives its metre.**

### 2. The control's dirty input had stopped being dirty — the real finding

The old control built each park twice, once with
`setEntranceCorridorHonoured(false)`, on the premise that the ride would then
put legs back through the road. **It does not.** Measured on all ten pool
seeds — every strut sampled every 0.25 m and hashed:

```
seed 20260728 real cb5d4c8f493b50c9  control cb5d4c8f493b50c9  nearest 3.016 m
seed 11       real d0ba2b8f90ed90b3  control d0ba2b8f90ed90b3  nearest 3.847 m
seed 24       real 17ab8a466e26311a  control 17ab8a466e26311a  nearest 2.769 m
... identical on all ten ...
```

Since the sphere, the Rail Race does not want to stand in the road with or
without the clause, so the "dirty" park was clean. **`isInEntranceRoad` inside
`groundIsClear` is currently inert** — that is a live fact about the
generator, not just about the check, and it is now printed on every run with
"ASSERTS NOTHING" when the count is zero.

The control is now **the identical sweep with the bus driven onto the ride**:
every station translated by the offset from the closest-approach pose to the
post it came closest to. Same park, same legs, same bus, same arithmetic; the
offset is re-derived from whatever park was just built, so it cannot decay.

### 3. `BUS_MAX_GRADE`'s doc promised an invariant that did not exist

It claimed `invariants.ts` "walks the bus's own arc on the built park".
`theGroundIsTheSphereItClaimsToBe` sampled **radially to the boundary** and
printed that it asserted nothing beyond it — which is exactly where the road
is. The clause now exists, walking the drawn road's own segments a metre at a
time, out to 117.1–118.7 m against a 101.4–107.2 m boundary.

## The numbers, quoted off the screen

`pnpm run check:entrance-road`, **exit 0**:

```
CONTROL (bus driven onto the ride): ... finds 141 post(s) inside the bus
  across 10 seeds — fewest 10 on a seed, worst 3.29 m in.
  Non-zero on every seed, so this sweep can see a collision.
corridor clause: switching it off moves a trestle on 0 of 10 seed(s)
  ASSERTS NOTHING: the clause is inert on every pool seed
SWEPT: 145.7 m of a 145.7 m road (100.0%) ... not the 2.0 m the bus is
  animated along (1.0 m to -1.0 m, 1.4% of the road)

entrance road OK — ... the tightest anywhere is 7.19 m (seed 24)
```

**No posts turned up when the sweep was widened.** The road clears the ride
over its whole length on every pool seed, by 7.19 m to 8.49 m at bus-body
height. (The 2.77–3.87 m in the hash table above is plan distance to the wider
road corridor, ignoring the bus's height band — a different, stricter
question.)

`pnpm run check:swept-bus`, **exit 0**: `SWEPT (on seed 11 ...): 2.0 m of a
144.9 m road (1.4%)` + `COVERS NOTHING ELSE: the remaining 142.9 m (98.6%) ...
is NOT swept here.`

## Red-run transcripts, with the geometry they were proved against

All three gates were broken deliberately and watched go red.

1. **The real-fault gate.** Real `hits` fed the control's offset sweep: exit 1,
   all ten seeds, e.g. *"seed 428: the cat bus sweeps through 23 Rail Race
   trestle leg(s) ... reaching 3.24 m inside one"*.
2. **The void gate.** Control offset zeroed: exit 1, *"the CONTROL found NO
   collision on 10 seed(s)"*. **This mutation found a real bug** — the summary
   line asserted "Non-zero everywhere, so this sweep can see a collision"
   unconditionally, printing it directly above the FAIL saying the opposite.
   Fixed; the sentence is now derived from the numbers.
3. **The new gradient clause.** `BUS_MAX_GRADE` lowered 0.1 → 0.058: 5 of 5
   procgen seeds fail with real numbers — seed 24 at 6.39% at (-66.8, 84.3),
   326 at 6.19% at (-20.1, 91.8), 11 at 6.09%, 131 at 5.90%. **Geometry:** the
   road reaching 115.8–118.7 m from the centre, boundary 101.4–107.2 m. If the
   road's reach or `GROUND_SPHERE_RADIUS` moves, re-derive the mutation
   threshold rather than reusing 0.058.

## Findings for whoever takes the road on

- **`isInEntranceRoad` in `groundIsClear` is inert on every pool seed.** Not
  removed — it costs nothing and would matter again if the ride moved back —
  but nothing today depends on it, and the check says so out loud rather than
  pretending to control on it.
- **`browAt()`'s predicate can no longer be false.** It is not "the sphere has
  no crest"; the road's outset is 19.07 m everywhere, past the 12 m
  `RIM_OUTSET_START`, so it returns the first station. Left alone deliberately:
  changing it changes the bus's arrival, which Jim has ruled is fine as it is.
  If anyone ever *does* rework it, note the grade route is also dead — the
  steepest ground under the road is 6.39% against a 10% budget.

## Housekeeping

- No dev server started, no browser page opened, nothing to kill.
- `git diff --stat origin/feat/sphere-combined...HEAD`: this file plus
  `scripts/check-entrance-road.mts`, `scripts/check-swept-bus.mts`,
  `src/core/constants.ts`, `test/procgen/invariants.ts`. Nothing else.
- PR goes against **`feat/sphere-combined`**, never `main`.
- Two other engineers are on this branch family — the arrival camera on
  `feat/sphere-combined`, `check:coplanar` on `fix/coplanar-sphere`. Stay out
  of their files; rebase rather than resolve by hand.
