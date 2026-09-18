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

- [x] worktree, install, baseline run
- [ ] gate arch
- [ ] sky cruiser pylons
- [ ] detour ratios
- [ ] path ends on bridge
- [ ] bushes on seed 11
- [ ] bridge coping
- [ ] slide vs roof garden / towers
