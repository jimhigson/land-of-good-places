# HANDOFF — the checks and invariants, made radial

**Branch:** `eng/radial-checks`, off `feat/sphere-combined`.
**Worktree:** `.claude/worktrees/eng-radial-checks`.
**Model:** Opus 5 (1M context), chosen by the Overseer. A replacement runs the
same model.
**Area:** §2 of `RADIAL-INVENTORY.md` — the ~32 sites in `scripts/` and
`test/`. Not `src/` game code: four of the rows are check-and-code pairs and
the code half belongs to another engineer.

---

## Two findings that change how the rest of this work is done

### 1. The park-build failure is a regression on this branch, not pre-existing

`RADIAL-INVENTORY.md` §0 says the canonical park cannot build headlessly and
that this *"pre-dates all the sphere work (it reproduces at `db1363ce`)"*.
**It does not.** Measured, each one a real `pnpm run check:park` run:

| commit | exit |
|---|---|
| `origin/main` `49310060` | **0** — "19/19 attractions route from the entrance, 0 rail crossing(s), 245/245 waypoints connected" |
| `db1363ce` — the commit §0 cites | **0** — "245/245 waypoints connected" |
| `6e1ebe9a` | **0** — "240/240 waypoints connected" |
| `789d6088` | **1** |
| `faece133` | **1** |
| `31d0fb2a` (tip) | **1** |

`789d6088` is the breaking commit and **its own message says so**: *"WIP: grow
the park as the sphere shrinks — mechanism works, bridge planner does not …
the rail-crossing planner then fails on 7 of 10 pool seeds"*.

`faece133`'s message claims the opposite — *"Measured, and it is not the sphere
work: the canonical seed throws identically at 1200, 600, 400 and 300, and at
`db1363ce` … verified in a scratch worktree"*. That claim does not reproduce.
`db1363ce` builds the canonical park.

### 2. `LGP_SEED=428` builds the park at the tip — the checks *are* measurable

`parkSeedPool.ts`'s `envPin()` reads `LGP_SEED`, and `HANDOFF-seeds-at-220.md`
records 11, 326 and 428 as the pool seeds that build at 220 m. So:

```
LGP_SEED=428 pnpm run check:hotel
```

runs end to end on the tip. **Anything written off as "asserting nothing"
because `check:park` throws should be re-tried on a seed that builds** — that
is how every measurement in this handoff was taken.

---

## Rows closed

### `scripts/check-hotel.mts:130` — the fall detector (§2.1, §2.4 row 1)

`FLOOR_OF_THE_WORLD = -2` was a bare world `y`. Now an altitude:
`altitudeAt(x, y, z)` outdoors, `worldToLocal(spaceAt(x, z), …).y` indoors.

The indoor half was not in the inventory and matters: the castle's three
floors stand at `BUILDING_BASE_Y` = **−42.97 m**, so two children standing
10.55 m above the mall's floor read `y = −32.42` and were reported as falling.
Any check comparing an indoor `y` against a flat threshold has the same bug;
`spaces.ts`'s `worldToLocal` is the one owner.

Measured, seed 428, `31d0fb2a`, `GROUND_SPHERE_RADIUS` 220:

- **before** — exit 1, **24** problems; 22 park children on grass, deepest
  `Rumi is at y=-68.80 m after 8 s — below -2 m, i.e. falling through the world`
- **after** — exit 0; 31 children, feet **−0.07 m to 1.94 m** above the floor
  each is over, 22 outdoors, furthest **164.3 m** out
- **armed** — shove one outdoor child 5 m along her own local down:
  exit 1, exactly one problem,
  `Ethan is -3.14 m under the ground she is over (world y=-72.12 m, 158.8 m
  from the park's origin)`.
  A **3 m** shove is correctly *not* a fall (`depth -1.13`): an NPC's
  `position` sits ~1.87 m above her feet, so the clause wants ~3.87 m of real
  fall. That was the first mutation tried and it came back green — worth
  knowing before concluding the check is inert.

The summary line now prints the range of feet-above-floor and says the clause
detects a **fall only**; a child floating above her floor is visible in that
range but asserted on nowhere.

### `scripts/check-tap-spacing.mts` — storeys (§2.4 #2)

Storey = **space** + **height above that space's own floor**, not world `y`.
Coverage 166 -> 184 zone-band pairs on seed 428. Proved red with a mutation the
old check could not see (give `stall:skyCruiser` 23 m more pick radius: patched
exit 1 naming it, unpatched exit 0). Announces its skipped-but-close pairs on
stderr every run.

**Done from the script, never from `interact.ts`.** The coordinator relayed a
trap the effects engineer hit and reverted: `interact.ts` cannot import
`world/spaces.ts` — `spaces` -> `building/layout` -> `parkLayout` is
seed-dependent, and `building/layout` -> `tapSpacing` -> back into `interact`.
That pulls the park manifest into `test/procgen`'s static import graph *before
the seed is set*, and `test:procgen` went from `49 failed | 269 passed | 279
skipped` to `132 passed | 465 skipped` — **zero failures and 137 fewer tests
run, with nothing red**. The trap is recorded in `ZONE_HEIGHT_TOLERANCE`'s doc
comment on `eng/radial-fx`.

`src/world/up.ts` is safe to extend this way and is where `heightAboveFloor`
went: it **already** imported both `spaces` and `terrain`, so no new edge was
added to the graph.

### `scripts/check-swept-bus.mts` (§2.4 #3)

Two faults, one cause — `placeBus` adopted `faceOnGround` and the check did not.

- the bus's "own frame" box was taken with `bus.rotation.y = 0`, which leaves
  `faceOnGround`'s pre-multiplied tilt in `rotation.x`/`z`. Now
  `bus.quaternion.identity()`. The tell: one bus model, so the box must be
  identical on every seed. Before: 12.10/13.73/12.00 m long, bottom
  -4.95/-5.21/-5.06. After: **14.54 / 7.30 / 0.02 / 6.15 on all three seeds.**
- the sweep posed the body by yaw alone. Now a stand-in `Object3D` posed with
  `placeBus`'s own two calls, and `worldToLocal` per sample.

Counts unchanged (0/0/0) — the sweep covers **2 m of a 142.8 m road, 1.4%**,
because the sphere collapsed the brow. Baseline **not** re-taken: it is `{}`, it
asserts zero, and the corrected instrument still reads zero on the three seeds
that can be built. Re-taking it against three of sixteen would be a fiction of a
different kind.

### `test/procgen/invariants.ts` — the two bridge rays and three radius rows

Both `new Vector3(0, 1, 0)` rays now fire along `upAt`, re-asked per sample,
with the across-track offset built from the route's 3-D tangent crossed with
that up, and the clearance read as `hit.distance` — a length, which needs no
frame. `railRaceFliesClear`, `theSlideKeepsItsAirFromTheCruiser` and the
deck-soffit clause difference `planetRadiusAt` instead of `y`. `Box3.min.y` has
a radial replacement, `lowestRadius`, which walks an object's own vertices.

**The finding that matters: the train drives into its own bridges.** Three
independent clauses, three techniques, one seed (11), agreeing:

| clause | reading | required |
|---|---|---|
| ray from the rail, bridge-0.0 | **3.69 m** | 3.90 m |
| rail corridor, (-86.0, 26.0) | **3.69 m** | 3.90 m |
| deck soffit, (-86.0, 26.0) | **3.65 m** | 3.90 m |

plus bridge-420.0 at 3.33 m and (-99.0, 138.1) at 2.49 m. **All three clauses
passed before this branch.** Not mine to fix — `bridges.ts` and the rail
corridor belong to the world/rides engineer.

---

## Two rules this work runs under

**Compare PASS counts against the base, not just failures.** The base on
`feat/sphere-combined` `31d0fb2a` is:

```
Test Files  6 failed | 13 passed (19)
     Tests  49 failed | 269 passed | 279 skipped (597)
```

so `failed + passed = 318` is the number of tests that actually *ran*. A change
that drops that number has disabled tests, however green it looks — that is how
the `interact.ts` trap above was caught, and a failure count alone cannot see it.

**The park-build red is being fixed.** The coordinator bisected the `railD 0.0`
throw to `502ec802`, a merge whose two parents are each green alone, and an
engineer is on it. My own bisect (canonical seed, `check:park`) landed on
`789d6088`; the two are compatible if the merge broke some seeds and the
park-growth commit broke the canonical one. Either way: when it lands, headless
park building comes back and several of these checks will assert for the first
time. **Do not baseline anything against a park that does not build.**

---

## Still open in my area

Worked in `RADIAL-INVENTORY.md` §2 order. Nothing below is started unless it
says so.

- `scripts/check-tap-spacing.mts:121,141` — `sameStorey` on world `y`, so
  crowded far-out clusters are silently `continue`d.
- `scripts/check-swept-bus.mts` — baseline is fiction; re-take deliberately.
- `test/procgen/invariants.ts` — ten rows, merge-blocking.
- `test/procgen/parkFacts.ts` — three rows.
- `scripts/check-rail-race.mts`, `check-npc-perch.mts`, `check-climb-wave.mts`,
  `check-entrance-road.mts`, `check-park.mts`, `check-pet-slide.mts`,
  `check-tie-frame.mts`, `playerSim.mts`, and the rest of §2.4.

**Do not edit the code halves** of the four check-and-code pairs
(`Coaster.ts:436`, `RailRace.placeCarts:940`, `TreeClimbing.climbPose:657`);
hand those to the engineer who owns that area.
