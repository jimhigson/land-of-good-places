# The rides ride the sphere — round 2

**Model: Opus** (`claude-opus-5[1m]`), chosen by the Overseer's brief. A
replacement runs the same model.

**Branch:** `eng/rides-sphere`. **Worktree:** `.claude/worktrees/eng-rides-sphere`.
Base is `origin/feat/sphere-combined` with `origin/eng/rides-radial` and
`origin/eng/sphere-ground-claims` (PR #620, the scale-1 park) merged in — both
clean, no conflicts. **No dev server or browser page is left running.**

## The rail race is rideable and the camera is right

Screenshots (in the session scratchpad, deliberately NOT committed — CLAUDE.md
keeps binaries out of branch history). Seed canonical, port 5487, level 3:

- `rail-race-leaned.jpeg` — the level-select shot. Park as backdrop,
  ferris wheel, castle, four lanes, rider left of centre.
- `rail-race-racing.jpeg` — **mid-race, lap 1 of 2.** Side-on, four
  lanes running left to right, three duck bars visible ahead on the right, the
  boundary wall and grass behind, horizon level. Her face is turned to the lens.

The previous round's QA of this same ride: *"the camera is INSIDE THE HILLSIDE
... the screen is a wall of dark green with the rider and all four lanes hidden
behind terrain."* That is fixed.

## What was wrong, in the order it was found

**1. `check:rail-race` could not fail about the framing — 7 assertions on `NaN`.**
The check's `onLane` was a hand-copy of `RaceCamera.ringPoint` carrying a comment
promising it stayed in step. It did not: when the ring stopped being level
`route.base` became `route.baseAt(s)`, and the copy went on reading
`route.base` — `undefined`. Every projection was `NaN`, `NaN >= 1` is false, so
the visible-road walk ran its full 140 m and reported "140.0 m of track ahead" at
every window shape while seven assertions printed `NaN%` and passed.
`ringPoint` is now public and the check asks it.

**2. The rig aimed 31.9 m from the drawn child**, and part of that was
`ringPoint` reading `baseAt(s)` — which **defaults to lane 0** — while offsetting
sideways to `PLAYER_LANE`. Out at the rim those two lanes' bases differ by
**21.1 m** of world height. Now `baseAt(s, PLAYER_LANE)`, and the rig's rider
sits **2.96 m** from the drawn rail head: the seat height and the undulation and
nothing else.

**3. The rig is converted as one change**, which is why the two previous attempts
had to be reverted. `rigBasis(s, out, along, up)` is the single owner of the
three directions — one `tiltToSphere` at the rider's **flat** column applied to
all three, so they stay orthonormal and the rig stays a rigid body — and
`place`, `measureLookahead` and `measureZoomCeiling` all ask it.

**`camera.up` left at world `+Y` is ROLL, not tilt.** That is what produced the
earlier attempt's "view tipping 69.9° down into a map", and nobody had diagnosed
it. `lookAt` builds orientation against `camera.up`; over ground leaning θ, a
`+Y` up rolls the picture by θ. A side-scroller's horizon is the local horizon.

**4. `check:rail-race` asked five questions in the wrong plane.** The view's
bearing, the rider's travel, "into the park", the tilt and the left-to-right
test were all flattened by setting a `y` to zero — the *world* horizontal, which
is the ground's tangent plane at the middle of the park and nowhere else. A rig
tilted the intended 20.1° towards its own track measured **6.6°** against world
`+Y`. The check now reads all five in `rig.rigBasis`, and the tilt comes back as
**20.1° at both window shapes** — `Math.atan(11 / 30)` to the decimal, read off
the built projection. That agreement is the evidence; the old reading agreed
with nothing.

**Proved still able to fail** on this geometry (scale-1 park, canonical seed,
the rig as committed): `TILT` mutated to `atan(40/30)` is caught at both shapes,
"the camera tilts 53.1° down".

### The numbers

    check:rail-race   23 FAIL (7 NaN, incapable of failing)
                  ->  13 FAIL (real numbers, flat rig, 2.33x park)
                  ->   8 FAIL (leaned rig, scale-1 park)
                  ->   6 FAIL (check reading in the rider's frame)

    stand-off, crawl       24.2 m ->  27.1 m
    rider across, monitor  34.0%  (asked for 34.0)
    rider across, phone    10.0%  (asked for 10.0)
    track ahead            20.0 m ->  24.0 m (AHEAD promises 20.25)
    tilt, monitor/phone     6.6 / 7.7 deg -> 20.1 / 20.1
    into the park          0.962 / 0.908 -> 0.976 / 0.927
    left-to-right          0.949 / 0.896 -> 0.961 / 0.903

**The honest control**, same scale-1 park, rig unleaned instead of leaned:
**7 failures** against the leaned rig's 8-before/6-after. So the check's count
alone does not make the case. The lean's own win is child-visible and survives
both: on a phone the rider's sad face was **0.306 off the edge of the picture**
— not drawn at all — and is now 0.008 inside it.

**Remaining 6, none of them the camera**: lane-climb fairness (13.758 m, and
genuinely sphere-shaped — the four lanes sit at four radii now), three rider-pose
failures against the cart's tub, two face-turn margins.

## Withdrawn: the park is NOT bigger than the planet

I escalated this and the Overseer routed it correctly. The numbers (boundary
142.6–228.2 m, 54 of 512 vertices past the 220 m sphere) were the **2.3355x**
park that `PARK_REFERENCE_SPHERE_RADIUS = 1200` produced. Merging
`eng/sphere-ground-claims`:

| | 2.33x | scale 1 |
|---|---|---|
| park boundary | 142.6 – 228.2 m | 59.7 – 101.4 m |
| past the sphere | 54 of 512 | **0 of 512** |
| race ring | 145.0 – 238.9 m | 62.1 – 112.0 m |
| past the sphere | 573 of 2880 | **0 of 2880** |
| steepest ground | off the chart | 0.52 m per metre |

0 of 2880 on seeds 11, 326, 428 and 5 as well.
`scripts/measure-ring-off-the-planet.mts` is kept: `capHeight`'s `max(0, ...)`
returns `-220` for **every** radius past 220, silently, and that clamp is worth
an instrument even now that nothing trips it.

## OPEN, and it is not mine to fix: `eng/rides-radial` silences 93 tests

`test:procgen`, this machine, same command:

| | failed | passed | skipped |
|---|---|---|---|
| `eng/sphere-ground-claims` | 95 | 553 | **0** |
| this branch | 66 | **489** | **93** |

Total 648 both ways. **The falling failure count is the lie and the pass count
is the tell** — 93 tests stopped running, 74 of which were passing.

Isolated to one merge and one seed, by running `seed-24.test.ts` alone on a
detached worktree:

    eng/sphere-ground-claims          19 failed | 74 passed | 0 skipped
    + eng/rides-radial                93 skipped — `new World` throws

    Error: rail crossings: the drawn paths cross the railway at railD 26.8
    (28.1, -20.0), which snaps to no proven bridge site. Every crossing must
    be a bridge (Jim, 2 Sep 2026); find the router that drew this leg.

This is the castle carve in `eng/rides-radial` (`coaster/route.ts`,
`cruiserWindow.ts`) moving the coaster profile, moving the layout, and tipping
seed 24 into the crossing throw — **the same failure mode that branch's own
handoff recorded for seed 428.** The throw is in `train/crossings.ts` and the
path router, which I was told to stay out of. It needs the train/bridges
engineer, or the carve needs re-measuring at scale 1 (it was measured at 2.33x,
where the castle span's ground fell 14.6 m; at scale 1 it falls far less and the
carve may no longer earn its cost).

## Instruments — controls first, every one

- `scripts/measure-race-camera.mts` — rig position, basis, lookahead spread, and
  the gap between the rig's rider and the drawn rail head. Projects a point dead
  ahead through a hand-built camera **first**, because a `NaN` projection and a
  plausibly-wrong one read identically in a failure message. That control is what
  found finding 1.
- `scripts/measure-ring-off-the-planet.mts` — prints `capHeight` and its slope at
  five known radii, including two past the clamp, before asserting anything.

## Not started

Coaster underground (2.6 m at 86–100 m out) — **re-measure at scale 1 before
working it**; the reading is from the 2.33x park. The ginormous slide (untouched;
zero sphere helpers in nine files, `Building.ts:875` adds the chute un-leaned
into a group where every other plot leans). The ferris gondola.
**`eng/rides-radial-slide-wip` is still DO NOT MERGE** — it halves the pass count
(`0 failed | 132 passed | 465 SKIPPED`), which is the same disease as the 93
skips above, and its root cause was never found.
