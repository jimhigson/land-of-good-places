# Handoff — the pet slides down behind her (#468 / PR #469)

Branch `feat/pet-rides-the-slide`, worktree `.claude/worktrees/pet-slide`.

## Round 3 (2 Sept) — Jim's feedback on the preview

> *"Pet on the slide shouldn't mean they clip inside the player's head — they
> should ride behind them, lying down like the player, possibly multiple pets
> too."*

Three things, all done:

1. **They lie down.** `RIDE_RECLINE` (−1.35) is now exported from
   `entities/ridePose.ts` — the one definition of how a body lies on the chute,
   the child's own — and travels to each companion **in the seat**
   (`SlideSeat.recline`). `ParadeMember.updateOnSlide` turns the body by
   `pitch + recline` in the same `YXZ` frame the child's ride group and model
   root compose it in. No second description of the pose anywhere.
2. **A reclining companion sinks 0.6 m through the trough** if you just turn it
   about its own feet, so `ParadeMember.measureSlideOffset` measures the posed
   body once and lifts it onto its seat — the same trick `measureSleepOffset`
   uses for a pet bed. The rotate-measure-restore dance is now shared as
   `petBedFit.posedBox`, so there is one of it rather than two.
3. **Spacing is measured against her body, not the lens.** A reclining child
   reaches **2.28 m** back from her feet — her *arms*, not her head, which is
   only 1.33 m — so `PET_SLIDE_LEAD` is 2.28 + 0.45 = **2.73 m**, and the line
   then steps by a pet's own reclined length plus the same clearance
   (1.53 + 0.45 = **1.98 m**). The old 1.5 m lead put a pet 0.78 m *inside* her.

**`PET_BLIND_BAND` and `CHASE_EYE_BACK` are deleted.** The band existed because
a 1.46 m animal standing bolt upright 45 cm from the lens filled the frame.
Lying down retires that: a reclining pet stands 0.6–0.9 m off the trough floor
against a lens 1.62 m above it, so the one that passes under the camera passes
*under* it. The line is a plain `lead + slot * gap` again, which is what "several
strung out behind her, as a line" asks for, and the copied `CHASE_EYE.z` goes
with the band that needed it.

## The check

`pnpm run check:pet-slide` gained three clauses and replaced one.

- **not inside her** — every drawn part of the child against every drawn part of
  every companion, as **oriented** boxes through a 15-axis SAT, on all 675
  ridden frames. Oriented matters: measured axis-aligned she "reached" 3.05 m
  up-slope against the 2.28 m she spans, and spacing padded to clear that would
  have been the check driving the game.
- **not inside each other** — the same question one place down the line.
- **lying down** — each companion's own up axis against the built chute's
  tangent. The pitch cancels out of the product, so it asks about the pose and
  not the slope.
- **in shot** now counts **pixels** through the live camera instead of
  projecting a point. The point probe scored 3% on a shot the raster measures a
  whole pet in — the same *in frustum is not in shot* mistake as the clause
  before it, pointed the other way. Rasters every 25 chase frames, after the
  boarding grace, floor 95%.

### Proved red against the geometry as it ships today

With `src/` reverted to **206e3c98** (the tree Jim looked at) and only the new
check applied:

```
not inside her: Little Mouse was 33 cm inside the child on ridden frame 1
lying down:     up axis 0.000 against -0.707 required
```

— clipping on **675 of 675** ridden frames, deepest **1.08 m** inside her;
upright on **2025 of 2025** pet-frames. Both clauses fail on the shipped
geometry, which is the point.

### Green, on this branch

```
675 ridden frames, worst 0.78 m off the chute, closest pair 2.09 m,
closest to her 0.12 m (deepest inside her 0.00 m),
closest to its neighbour 0.70 m, most upright lie -0.958 against -0.707,
biggest single-frame step 0.167 m, nearest pet in shot on 100% of rasters
(smallest 4.4%, biggest pet 12% of frame), back within 4.2 m of her 3 s later.
```

The **control** (ride never told about the parade) still fails 7 clauses.

## A bug this round, worth remembering

The recline was written into the seat and **not copied out of it** in
`ParadeMember.rideSlide`. The seat is a scratch object refilled per companion,
so a field not copied never reaches the body: the pets rode the whole descent
bolt upright while `petSeatOnSlide` filled in a recline nobody read. The one-line
fix was made, verified green, and then **lost** — the commit that followed named
only two files and `git checkout HEAD -- src/` (restoring after the red proof)
threw it away. It came back as a deterministic red run. Name every file you mean.

Also: **do not swap source files under a running background `check`.** I did,
diagnosed a real failure as corruption, and had to re-run twice to find out it
was neither.

## Watched running

Headless Chromium via `playwright-core`, `channel: 'chromium'` (a real GPU), on
port 5593 — **not** the shared MCP browser. Five companions, whole descent, 46
beats captured, each one twice: clean, and with the live values burnt in.

There is no corner a caption can sit in without covering an animal — in the
chase shot the line lies along the very bottom of the frame, in a trackside shot
across the top — so the caption is a **second exposure** rather than an overlay.
The first two attempts each hid the pets they were captioning.

Measured on screen, through the live camera, mid-descent:

| beat | her NDC | nearest companion |
|---|---|---|
| chase, t = 0.44 | (0.03, −0.32) | Trilla (0.21, −0.86), 2.81 m, `rot.x` −1.10 |
| trackside, t = 0.50 | (−0.04, −0.22) | Trilla (0.04, 0.63), 2.77 m; Little Mouse also framed |
| trackside, t = 0.84 | (−0.09, −0.23) | Trilla (0.26, 0.69), 2.82 m; Little Mouse also framed |

Every companion `onSlide`, `rot.x` between −0.98 and −1.35 throughout (reclined,
the value being pitch + recline), all six strung out at 2.8 / 4.7 / 6.6 / 8.4 /
10.6 / 11.6 m behind her with no pile-up.

Screenshots on the `qa-screenshots` orphan branch under `pr469/`.

## Gates

- `pnpm run build` — exit 0
- `pnpm run test:procgen` — exit 0, **497 tests in 16 files** (confirmed, same
  as before this branch)
- `pnpm run check` — step sets compared against `origin/main`: 55 → 56, nothing
  dropped, `check:pet-slide` added.

## Two findings measured but deliberately NOT landed here

Both concern `PET_SIDE_STEP` (0.45 m), which is **unchanged by this round** — it
came in with round 2 and the numbers below are pre-existing, not a regression.
They were found while checking whether its doc was still true. It was not: it
argues from `CHUTE_ENVELOPE.halfWidth` (0.95 m, the width at the *top* of the
trough) and `PARADE_MEMBER_RADIUS` (0.3, the radius the *parade* shoves animals
apart by, which is not any model's half-width).

**1. A wide companion reaches outside the trough.** Instrumented with the same
oriented boxes the clip clause uses, the widest lateral reach of a riding
companion's drawn geometry is **1.116 m** from the chute centre line, against a
`CHUTE_ENVELOPE.halfWidth` of **0.95 m** — and the profile is only **±0.66 m**
down at the floor where a lying body actually is. The puff is 1.23 m across, so
0.615 + 0.45 = 1.065 m before the box corner is even counted. Nothing in
`check:pet-slide` can currently see this: its `on the chute` clause measures the
**root's** distance from the centreline against a 1.58 m allowance, which a
poking shoulder passes comfortably.

**2. Retuning it is not a one-line change, because it trades against framing.**
Measured on the real chase raster:

| stagger | species in check | biggest pet, chase frame | child, worst |
|---|---|---|---|
| 0.45 m | 3 | 12% | 296 px |
| none | 4 (puff added) | 23% | 75 px |
| 0.30 m | 4 (puff added) | 26% — **over the 25% ceiling** | 3 px |

Deleting the stagger was tried first and is wrong: with the line dead down the
middle the nearest companion sits squarely between her and the lens and covers
her up, which is Jim's own complaint one notch quieter. Shrinking it is worse
still on these runs. Note also that simply adding `pet.puff` to `PET_IDS` moved
the raster numbers far more than the seat geometry alone explains — **that is
not yet understood**, and retuning the constant before it is understood would be
tuning against an instrument nobody has read properly. (Suspicion: the check
grants companions on top of whatever the store already holds, so `PET_IDS`
controls how many slots are *measured* rather than who is in them.)

**The fix that probably wants writing** is a per-companion side step — each
animal offset by what its own width leaves inside the trough, rather than one
constant for a bunny and a puff alike — plus a trough-fit clause in
`check:pet-slide` measured on geometry rather than on the root. That is a
sensible follow-up issue and a bad thing to land unwatched at the end of a
round. **Left as it shipped, and written down here rather than fixed quietly or
forgotten.**

## Housekeeping

- Dev server 5593 killed by PID; browser pages closed by the capture script.
- `qa-capture-slide.mjs`, `qa-probe.mjs`, `qa-frame-facts.mjs` are scratch
  harnesses, untracked, deleted at the end. Nothing in the repo depends on them.
