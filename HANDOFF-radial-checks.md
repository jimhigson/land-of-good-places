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
