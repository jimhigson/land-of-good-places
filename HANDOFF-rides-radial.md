# The rides ride the sphere — CLOSED

**Stopped 14 September 2026 on the Overseer's ruling**: Jim judged the
instance-by-instance radial conversion to be *"trying to fit the new world into
the old code"*, and an architect is designing a proper spherical domain. This
work is kept in case it is wanted again. Nothing here is abandoned mid-edit:
every branch is pushed, `tsc` and `build` are green on the work branch, and the
one change that regressed anything is on a branch of its own, labelled.

**Model: Opus** (`claude-opus-5[1m]`), chosen by the Overseer's brief. A
replacement runs the same model.

**Branches**
- `eng/rides-radial` — everything that is good and measured. `tsc` 0, `build` 0.
- `eng/rides-radial-slide-wip` — **DO NOT MERGE.** The slide conversion. Right
  as far as it goes and it regresses the park build; see the end of this file.

---

## The one sentence that mattered most

**`drawnOnSphere` solves flat and draws leaned, so the solvers were right and
the *consumers* were wrong.**

Both inventories listed `coaster/route.ts` and `slide/solve.ts` as medium-high
bugs, and the Overseer's brief to me repeated it. They are not bugs.
`sweptRail.ts:54-72` already said so: a ride is solved in the flat authoring
frame and drawn leaned, and because `placeOnSphere` is locally a rotation it
*preserves* a height-above-ground and a gradient exactly. Verified rather than
taken on trust — over the whole cruiser loop the flat `clearanceAt` and the drawn
`altitudeAt` agree to **0.01 m at every sample**.

About twenty rows of effort were redirected by that reading. It is in
`RADIAL-INVENTORY.md` as correction 5 (the lead landed it), and **the new
architecture must preserve that distinction rather than flatten it.**

**The boundary, from the lead, which is the edge to not walk off:**
`placeOnSphere` preserves a height *in the same column*; it is not a global
isometry. A vertical gap between two points in **different** columns is still
genuinely wrong — `theSlideClearsTheCruiser` and `railRaceFliesClear` are both
that shape and correction 5 does **not** clear them.

## What was fixed, with before/after

| | before | after |
|---|---|---|
| Cruiser cart off its own rails | **9.103 m** worst | 0.167 m, 100% of circuit ridden |
| Rail-race cart-up vs rider-up | **90.00°** | 3.210° — 0.020 m of hand swing vs a 0.55 m tub half-width |
| Cruiser route clearance, seed 11 | **−2.96 m** | +1.10 m |
| Cruiser route clearance, seed 326 | **−10.55 m** | +1.09 m |
| Cruiser strikes, seeds 11 / 326 | 8 / 8 | 2 / 1 |
| Slide trough bank (on the WIP branch) | **30.45°** | 0.00° |

**The root cause under both QA regressions**, and it was not the one in the
brief: every ride drew its track leaned and placed its *vehicle* flat.
`rideFrame` in `sweptRail.ts` (approved by the lead) is the orientation half of
`drawnOnSphere`, taking its lean about the **flat** point's column so a cart and
the rails under it lean by exactly the same amount.

**The castle carve was a second, separate bug** and is the real reason the
cruiser passed through `castle-wall-lower`: it pinned **one absolute world `y`**
across a span where the ground falls **14.6 m**, putting the ride **10.55 m
underground**. `castleAltitude()` in `cruiserWindow.ts` is the new owner of "how
high above the ground castle-local `y` actually is". Before, the car went through
the plinth, solid wall and the courtyard floor; after, it threads the window and
brushes the surround.

Also converted: `ParkTrain` carriages (plus three stale `rotation.y` heading
readers, now `planYawOf`), and the ferris gondola, which climbed 340 m straight
up world `+Y` from a wheel standing on a sphere.

## Seen in a browser — seed 326, port 5491

- **Sky Cruiser: confirmed.** First-person from the cart, the rails converge
  symmetrically ahead with the ties square across them. At 9-10 m off, they
  would not have been in shot. `/private/tmp/qa-sky-cruiser-on-rails.jpeg`
- **Rail Race: the camera is INSIDE THE HILLSIDE.** The race runs and the
  standings are right, and the screen is a wall of dark green with the rider and
  all four lanes hidden behind terrain. Child-visible, and pre-existing.
  `/private/tmp/qa-rail-race-cart.jpeg`
- **Rail Race with the rig converted: night and day.** Camera out of the hill,
  four lanes left to right, rider left of centre per `RIDER_SCREEN_X`, park as
  the backdrop. `/private/tmp/qa-rail-race-AFTER-rig-leaned.jpeg`
- **Slide, before and after:** `/private/tmp/qa-slide-AFTER-leaned.jpeg`. The
  difference is real but subtle at that angle and I claim no more from the
  frames than that; the 30.45° → 0.00° is the honest evidence.

## Why the rail-race camera was left alone — someone will be tempted again

Converting it blind took `check:rail-race` from **25 failures to 34**: the rider
crossing the screen the wrong way, the rig trailing her, the view tipping 69.9°
down into a map. **Its own check is red with `NaN`s on the base**, so nobody
could have told me whether I had broken it. And it is the side-on shot the family
tuned by eye.

When I did convert it and look, the shot was far better — but
`raceCameraNeverRunsBackwards` went red with **real numbers**: a **116.9 m
stand-off** where the rig wants about 30, at 167 of 10578 probes. `this.out` is a
rotation and preserves length; what does not survive is
`RaceCamera.measureZoomCeiling`, which solves the ring's carrying capacity in the
**flat** frame and is then applied to a leaned rig. **So the next pass converts
the ceiling with the rig, in one change, and re-judges in a browser.** Only the
`far` plane fix (400 → 3200, the opposite limb of a 220 m sphere is past 400 m)
is on the work branch.

## Unresolved, and not mine

- **The coaster runs up to 2.6 m underground between 86 and 100 m out**,
  byte-identical on the base. Same family as the castle carve. (On seeds 11 and
  326 the carve fix clears it; the seed-428 instance was measured by another
  engineer and is recorded here because it was asked for.)
- **`Building.ts:875` adds the slide chute un-leaned** into a group where every
  other plot leans. Still true on the work branch — the fix is the WIP branch.
- **`check:rail-race` is red with 25 failures on the base**, several reporting
  `NaN%`, and reports the arm at 2.042 m identically before and after my fix. It
  builds its own rotation-less cart and then calls the real `setRidePose`, so it
  reproduces the exact split it exists to measure.
- **`check:cruiser-clearance`** was honestly red before I started.
- **`check:pet-slide`** is red on the base (350 frames where the chase solve
  gives up) and marginally worse with the slide WIP (370).
- **The `railD 0.0` crossing throw**: the lead bisected it to `502ec802`, a merge
  whose two parents are each green. Not radial. It is why seed 428 stopped
  building after the carve moved the layout.

## `test:procgen`, honestly

Measured against `origin/feat/sphere-combined` on the same machine.

| | base | work branch |
|---|---|---|
| failed | 49 | **50** |
| passed | 269 | 268 |
| skipped | 279 | 279 |

Net **+1**. One now passes (`the Sky Cruiser built track turns as gently as it
promises`); four newly fail, all on seed 11 and all **layout cascade** from the
carve moving the coaster profile — the tree/wall run, the bridge tunnel ray, and
both ginormous slide clauses. The Overseer ruled to keep the carve: a ride
10.55 m under the grass is worse than four assertions on a branch that already
fails 49 and cannot build the canonical park.

## The slide WIP, and why it is quarantined

`eng/rides-radial-slide-wip`. The conversion itself is measurably right
(30.45° → 0.00° of trough bank) and it **regresses the park build**:

```
work branch : 50 failed | 268 passed | 279 skipped
with slide  :  0 failed | 132 passed | 465 SKIPPED
```

**The zero is not good news.** It is CLAUDE.md's "a skipped test is not a passing
test", and the tell is the **pass count halving**, not the fail count. `new World`
throws on many more seeds, surfacing as *"the module registry was reused across
seeds"*. Reproduced twice, and confirmed by backing the change out and getting the
old numbers back. Root cause not found — I was told to stop first.

**One thing that branch does settle, and it is worth keeping:** the ginormous
slide does **not** cross the indoor/outdoor seam that `RADIAL-INVENTORY.md` §3.6
flags as undecided. Measured on all three seeds that build, every chute point is
in `SPACE_GARDEN`, 83-148 m from the park origin. So the slide can be converted
without anyone having to settle that design question first.
`scripts/measure-slide-seam.mts` is on the work branch and re-runs in seconds.

## Notes for whoever picks this up

- Seeds **11, 326, 428** build at 220 m; the canonical seed does not. Use
  `LGP_SEED=<n>`. After the carve, 428 tips into the `railD 0.0` throw.
- The instruments on the work branch all run controls first and print coverage:
  `measure-cart-off-rails`, `measure-cart-rider-frames`, `measure-cruiser-altitude`,
  `measure-castle-carve`, `measure-slide-seam`, `measure-slide-trough`.
- **Two instrument mistakes I made, both caught by controls**, because they are
  the cheapest lesson here: the first cart instrument watched 3000 frames of a
  cart that never moved and read 0.161 m where the truth was 9.1 — the tell was
  `worst == mean` exactly, not the value. And the first trough instrument
  measured pitch as though it were bank. Both times the control, not the result,
  was what said so.
- I also reported a check as exit 0 when that was `tail`'s exit code. CLAUDE.md
  warns about exactly that and it still caught me inside an hour.
