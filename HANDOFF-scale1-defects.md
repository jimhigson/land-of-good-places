# HANDOFF — two scale-1 defects on #620

**Model: Opus 5 (1M context)**, chosen by the Overseer. A replacement must run
the same model (CLAUDE.md).

**Branch**: `eng/scale1-defects`, off `origin/eng/sphere-ground-claims` @
`25773db2`. **PR targets that branch, not `main`.**
**Worktree**: `.claude/worktrees/eng-scale1-defects`.
**Off limits** (another engineer, `af4c943`): `src/world/train/**`,
`src/world/paths.ts`.

## The question I was asked first, settled

**(2) and (3) are independent bugs, not one.** `treesInTheBusRoad` is computed
entirely in plan — `distanceToEntranceCorridor(at.x, at.z)` against a horizontal
reach — and never reads the bus's height or box. Fixing the bus makes **none**
of the 18 evaporate. Read `parkFacts.ts`'s road sweep if you doubt it: the bus
fact and the road fact share nothing.

## 1. The cat bus — 6.03 m, not 9.43 m

`parkFacts.ts` reported an **axis-aligned** box's extent along **world +Y**.
`placeBus` calls `faceOnGround` on purpose, so the bus is tilted, and an AABB
round a tilted body grows while the body does not. Over 145,516 drawn vertices:

| | |
|---|---|
| lean off world +Y | **21.31°** |
| AABB world-Y extent | **9.43 m** ← reported, failed |
| along its own up | **6.03 m** ← the bus |
| own right / forward | 7.30 m / 14.54 m |
| inflation | **1.565×** |

Band is `TALLEST_CHILD_HEIGHT` (2.97) × 1.4–2.6 = **4.16–7.72 m**. 9.43 outside,
6.03 inside.

**Independent control**: 7.30 and 14.54 are *exactly* what `check-swept-bus.mts`
collapsed to when it met this fault from the other side (12.10/13.73/12.00 →
identical 14.54 × 7.30 once yaw came out). Two instruments agreeing is why 6.03
is believable rather than merely smaller.

Failing at scale 2.3355 too (5 occurrences) — a long-standing frame bug scale 1
did not cause.

## 2. The treeline — gated where the trunk stands, drawn where the canopy lands

`makeInstanced` puts every instance through `placeOnSphere`, which re-measures a
part's authored height along the **local** up. A canopy is metres up, so it is
drawn further out than its trunk. The gate tested the trunk's `(x, z)`.

**All 460 surviving instances move outward between plant and draw: median
1.80 m, worst 3.21 m** (drawn (115.1, 44.6) ← planted (112.1, 43.4), purely
radial). The worst offender sat **0.489 m** from the corridor while reaching
**2.86 m** — 2.37 m inside a road the bus drives down — and the gate said clear.

**How it was found**: instrumenting the gate showed it seeing 499 and refusing
39, while the complained-about site was **never seen at plant time at all**.
That killed every "the gate is wrong" theory and pointed at the transform.

Fixed with the same call the occluder 500 lines above already makes; its comment
has read *"at the park's edge that is over a metre sideways"* all along.

## Proof

Red proofs (revert each, watch it fail), with the coverage line as the control:

```
bus → AABB world-Y      "the cat bus is 9.43 m tall"           19 failed
treeline → trunk (x,z)  "18 planted thing(s) stand in the road" 19 failed
    reverted: [bus road cover] 1921 planted swept, 18 inside
    fixed:    [bus road cover] 1881 planted swept,  0 inside
```

Pool-wide, `test:procgen`, mechanically diffed per failure:

| | before `25773db2` | after |
|---|---|---|
| failed | **95** | **85** |
| passed | **553** | **563** |
| total | 648 | **648** (no skips) |

**Exactly 10 lines removed, 0 added** — my two invariants × 5 seeds. Every other
failure count byte-identical. That mattered: the gate change shifts the
treeline's RNG stream, so "it re-scattered and something else got worse" was a
live risk. It did not happen.

## Trap worth inheriting

Writing the vertex sweep with `instanceof Mesh` threw `Cannot access 'Mesh'
before initialization` from a circular-import dead zone, which vitest reports as
**93 skipped, 0 failed** — the quietest way for a suite to stop checking, and
invisible if you read the failure count alone. Duck-typed now, reason in the code.

## Not done here, deliberately

**`check:npc-perch` ("climbable tree 0 has no foliage to measure") is NOT fixed
on this branch, on purpose.** I answered the Overseer's question instead:
**the check is picking the wrong tree — the park has NOT planted a
canopy-less climbable tree.** Proof: dropping `eng/flat-primitives-check`'s
already-written bearing-based matcher into this worktree makes it pass at
scale 1 (42 trees, tallest canopy 6.39 m, exit 0).

So it is already fixed, unmerged, on the other branch. Duplicating it here would
create two copies to conflict on merge. **This is a sequencing decision for the
Overseer**, who has said #620 lands first and `eng/flat-primitives-check` behind
it — which leaves `check:npc-perch` red on #620 in between.

## Remaining 18 on the canonical seed — none mine

Rail Race (duck bars, trestles, sleepers, rings), Sky Cruiser (supports, window,
clearance), the slide, gate arch, tree/bush scatter, railway crossings, coping
stones. The last two are `af4c943`'s.
