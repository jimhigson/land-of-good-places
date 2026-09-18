# Handoff — park-wide procgen invariant failures (#667)

Branch `fix/park-invariants` off `feat/procgen-on-sphere`, worktree
`.claude/worktrees/park-invariants`. PR against `feat/procgen-on-sphere`.
Do not merge. One heavy suite at a time; kill node by PID.

**Another engineer owns the rail-race trestle / duck-bar / ring-geometry
failures.** Do not touch `duckBars*`, `railRaceTrestles*`,
`railRaceSleepers*`, `railRaceRings*`, `finishRainbow*`.

## Baseline, quoted off the screen

`pnpm run test:procgen` at `ae20b9fc` (branch head as created):
`Test Files 5 failed | 17 passed (22)`, `Tests 55 failed | 636 passed (691)`.
Full name list: `scratchpad/names-head.txt`.

My slice, 19 of those 55:

| invariant | seeds | note |
|---|---|---|
| the park gate arch stands over its gateway | all 5 | headroom ray vacuous |
| every support meets the track it carries | all 5 | Sky Cruiser pylon |
| the Sky Cruiser stands on its own supports | all 5 | same pylon |
| no two close destinations … disproportionate paved detour | 11, 131 | |
| every modelled coping stone sits on the wall it caps | 11, 131 | ~0.03 m |
| the ginormous slide does not clip the castle towers | 24, 326 | |
| the ginormous slide clears the garden on the castle roof | 131 | 0.22 m |
| no drawn path ends in mid-air on a bridge | canonical | spur-exit-railRace |
| built the park it was asked for (bushes 159 < 180) | 11 | |

## Root cause found so far

**The unifying disease is the sphere.** The base
(`feat/sphere-combined`) moved the park onto a planet of radius 220 m
(`src/world/geo/`), so **world +Y is not up** anywhere but the exact park
centre. Every one of these instruments still measures along world +Y.

### 1. The gate arch — the vacuous headroom, proved

`scripts/gate-arch-measure.mts` cast its headroom rays along
`new Vector3(0, 1, 0)`. Measured on the canonical seed
(`scripts/_probe-arch.mts`, untracked):

```
arch world pos 0.000, -8.540, 60.000
local up at arch 0.0000, 0.9620, 0.2730   (15.84 deg off world +Y)
world +Y: 0/13 rays hit, nearest overhead Infinity m along the ray
local up: 13/13 rays hit, nearest overhead 3.552 m along the ray
```

So the arch **is** there and **is** 3.55 m over a child's toes. Every ray
missed it by leaning; `lowestOverheadY` was `Infinity`; the
`headroom < TALLEST_CHILD_HEIGHT` clause under it could never fire.

**What the vacuous clause was excusing: nothing, on these five seeds.** The
real headroom is 3.55 m against a `TALLEST_CHILD_HEIGHT` of ~1.5 m, so the
gate was in fact fine — but the clause had stopped being able to say so, and
would equally have passed an arch lowered to a child's knees. It has been
vacuous since the sphere landed (`667e743e` / `cb76ac1c` on
`feat/sphere-combined`), i.e. for the whole life of that branch.

## Status

- [x] worktree, install, baseline run (55 failed | 636 passed)
- [x] gate arch — headroom rays along the planet's up; headroom computed once
- [x] sky cruiser pylons (both invariants) — drawn tops unleant to the flat frame
- [x] slide vs castle towers — `CASTLE_TOWERS` moved onto `CASTLE_FRAME`;
      invariant measures each turret's own axis; solver judges the built curve
- [ ] detour ratios (seeds 11, 131)
- [ ] a path ends on a bridge (canonical)
- [ ] bridge coping (seeds 11, 131)
- [ ] slide vs roof garden (seed 131)
- [ ] bushes on seed 11 (159 < 180)

Now at `Tests 38 failed | 653 passed (691)`; 17 of my 19 gone, none new.
Remaining 38 = 36 rail-race (another engineer's) + my 5 kinds below, minus
overlap — see the name lists in the scratchpad (`n1.txt` baseline, `n3.txt` now).

## The one thing worth carrying forward

**Every failure so far has been the sphere, in one of two shapes**: a
measurement taken along world `+Y` where the park's up is radial, or a
plan-frame description compared against a drawn one. `unplaceFromSphere` and
`worldToCastle` are the two inverses that exist for it. Before assuming a red
invariant means broken geometry, ask which frame each side of the comparison is
in — but *measure* the answer, because on the towers the frames were genuinely
inconsistent and the geometry genuinely wrong.

Probes (untracked, in this worktree): `scripts/_probe-arch.mts`,
`_probe-pylons.mts`, `_probe-slide-castle.mts`.
