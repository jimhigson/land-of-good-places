# The rides ride the sphere — round 2

**Model: Opus** (`claude-opus-5[1m]`), chosen by the Overseer's brief. A
replacement runs the same model.

**Branch:** `eng/rides-sphere`, off `origin/feat/sphere-combined` with
`origin/eng/rides-radial` merged in (clean merge, no conflicts).
**Worktree:** `.claude/worktrees/eng-rides-sphere`. **Port:** not yet started.

## The blocking finding: the park is bigger than the planet

`scripts/measure-ring-off-the-planet.mts`. Controlled against an untouched
`origin/feat/sphere-combined` checkout — identical numbers, so it is not mine
and not the ride code's.

`capHeight(x, z) = sqrt(max(0, R² - r²)) - R` with `R = 220`. **Past `r = 220`
it returns `-220` for every point**, however far out — the planet's south pole.
`upAt` there is one fixed direction. Everything derived from either is wrong,
not merely steep.

| | radius | samples at or past 220 |
|---|---|---|
| park boundary | 142.6 – 228.2 m | 54 of 512 |
| race ring | 145.0 – 238.9 m | 573 of 2880 |
| walk-past ring | 147.5 – 236.4 m | 580 of 2880 |

Every pool seed tried is worse: seed 11 boundary to **112.3%** of the sphere and
ring to 117.1%; seed 326 112.5% / 117.3%; seed 428 109.3% / 114.1%; seed 5
105.2% / 110.0%.

And the twenty metres *before* the edge are a cliff. The control in that script
prints it: the cap falls **2.06 m per metre at 198 m out and 7.02 at 217.8 m**.

**This is not a rides bug and it cannot be fixed in `railRace/`.** Either the
ground sphere's radius grows or the park's reach shrinks; it is the Overseer's
call and it blocks the rim for every subsystem, not just this one.

## Done, measured, pushed

1. **`check:rail-race` could not fail about the framing.** The check's `onLane`
   was a hand-copy of `RaceCamera.ringPoint` that read `route.base` — deleted
   when the ring stopped being level — so every projection was `NaN`, `NaN >= 1`
   is false, and seven assertions printed `NaN%`. **23 FAIL / 7 NaN lines →
   13 FAIL / 0 NaN.** `ringPoint` is now public and the check asks it.
2. **The rig is converted** — rider point leaned via `placeOnSphere`, and
   `rigBasis(s, out, along, up)` is the one owner of the three directions, used
   by `place`, `measureLookahead` and `measureZoomCeiling` so they cannot drift
   apart. `camera.up` is the local up (leaving it at `+Y` is what rolled the
   picture 70° in the earlier attempt — it was roll, not tilt).
3. **`ringPoint` read `baseAt(s)`, which defaults to lane 0**, while offsetting
   sideways to `PLAYER_LANE`. Out at the rim those two lanes' bases differ by
   **21.1 m** of world height (−125.07 vs −146.21). The rig's rider was 31.9 m
   from the drawn child; it is now **2.96 m**, which is the seat height plus the
   undulation and nothing else.

## Where the rig stands right now

Better where it can be, and blocked where it cannot:

- rider's eye facing **0.180 → 0.257** (monitor), **0.124 → 0.331** (phone)
- both "her eye is off the edge of the picture" failures cleared
- **but the stand-off solves to 79.8 m against 22.3 m flat**, because `solve`
  takes a `max` over a `lookahead` table containing stations sampled off the
  planet — a 20.25 m step reading a 57.77 m reach at `s=1070.5`.

So `check:rail-race` is **13 FAIL both before and after**: five of the flat-frame
framing failures cleared and five different ones (px/m, side-scroller direction)
appeared in their place. **Do not read that as a wash.** The five that cleared
are real; the five that appeared are all downstream of the off-the-planet
stations, and none of them can close while the ring runs past the equator.

## Instruments (controls first, all of them)

- `scripts/measure-race-camera.mts` — the rig's position, basis, lookahead
  spread and the gap between the rig's rider and the drawn rail head. Runs a
  hand-built camera projecting a point dead ahead **before** it reports anything
  about the rig, because a `NaN` projection and a plausibly-wrong one read the
  same in a failure message.
- `scripts/measure-ring-off-the-planet.mts` — the finding above. Prints
  `capHeight` and its slope at five known radii as its control.

## Not started

The coaster underground (2.6 m, 86–100 m out), the ginormous slide (untouched,
zero sphere helpers in nine files; `Building.ts:875` adds the chute un-leaned),
the ferris gondola. **`eng/rides-radial-slide-wip` is still DO NOT MERGE** — it
halves the pass count (`0 failed | 132 passed | 465 SKIPPED`) and the root cause
was never found.
