# Handoff — cat bus paws and rock (#435)

Branch `feat/cat-bus-paws-and-rock`, worktree `.claude/worktrees/cat-bus`.
Dev server port **5587**.

## The ask

Jim: *"1) Add modelled paws to the front of the mudguards/fenders on the bus.
2) The bus's bob should also be a rocking back and forth, since it has
suspension at the front and back."*

## State: both done, checks green, watched running.

## 1. Paws — `buildFenderPaw` in `src/world/entrance/catBus.ts`

One squashed sphere for the paw plus three for the toe beans, the same
palm-plus-three-toes reading as `buildPawPrint` (the flat livery, untouched).
Cream `bodyMaterial` palm, `pawMaterial` beans, one ink outline on the palm
only.

**Everything about the placement comes from the mudguard.** The arch's geometry
is now four module constants — `FENDER_INNER_RADIUS`, `FENDER_OUTER_RADIUS`,
`FENDER_ARC_FROM`, `FENDER_ARC_TO` — instead of four expressions written where
the arch is extruded, so there is one owner with two readers. The paw's angle is
`FENDER_ARC_FROM` (the arc's leading end); its radius is
`FENDER_INNER_RADIUS + palmHalfDepth`, which puts its innermost surface exactly
on the surface `CAT_BUS_ARCH_GAP` is derived for, so **the paw can never be the
part of the assembly that reaches the tyre**; its size is `FENDER_HALF_WIDTH`.

No coplanar faces: spheres pushed into the plate share no face with it, so there
is nothing to strobe and no hidden face to delete.

### The bug worth remembering

The placement rotation was `FENDER_ARC_FROM - PI/2` where it must be
`PI/2 - FENDER_ARC_FROM`. A rotation about x sends `+y` to `(0, cos, sin)`, and
the radial direction at angle `a` is `(0, sin a, cos a)` — so the angle wanted is
the **complement**, not its negation. Flipped, the paw's long axis lay radially
and reached **0.09 m inside the arch's own inner surface**, into the gap the tyre
travels through. `check:cat-bus-suspension` caught it, by reporting a gap swing
too small to be a suspension. Nobody would have seen it: from outside, a paw
pointing backwards up the arch and one pointing down the road are both a blob on
the end of a mudguard.

## 2. The rock

**The brief's description of this file is stale and the next person should know.**
The issue and the brief both say "the idle animation already runs on `elapsed`
(the tail swish uses two out-of-phase sine terms)". The tail is gone (#379),
`animate(dt, speed)` takes no wall-clock time, and `check:cat-bus-suspension`
§6d **explicitly forbids** clock-driven motion: the road is sampled on distance
travelled so a bus parked at the kerb with its door open is still. Adding an idle
`elapsed` rock would be red. Do not "fix" that.

So the rock is the *driving* one, and it was a limit rather than a missing
mechanism. The two-axle spring has always made pitch — the road carries a wave
two wheelbases long precisely so that it does — and the clamp was eating it.
**Sampled off the running game, the body sat at exactly `-0.028` rad, its own
limit.**

- `CAT_BUS_MAX_PITCH` 0.028 -> **0.042** rad (2.4 degrees).
- `roadHeightAt`: the two-wheelbase (pure pitch) term 0.075 -> **0.135**, the
  one-wheelbase (pure heave) term 0.135 -> **0.105**. Total road amplitude
  unchanged — a redistribution, not a rougher road.
- `CAT_BUS_RIDE_LIFT` and `CAT_BUS_ARCH_GAP` are derived from the limit and rose
  with it, as their docblocks promise (arch gap 0.691 -> 0.781).

Out of phase for free, because it always was: one wheelbase of road is a pure
heave input at 0.65 Hz, two wheelbases a pure pitch input at 0.33 Hz.

## 3. The check, extended not duplicated

`check:cat-bus-suspension` §6e. 6c owns the bob and **structurally cannot see the
rock** — heave is the *average* of the corners, so a bus with both axles in
lockstep passes everything. Three clauses: it rocks at all; the nose's own travel
beats the heave by a clear margin (a floor alone passes on noise, and on a "rock"
that merely rises and falls with the body); and it stops when the bus stops.

### Proved red by mutation

| mutation | result |
| --- | --- |
| road pitch term -> 0 | red on **both** the floor and the nose-travel clause |
| road pitch term -> the old 0.075 | floor **passes**, nose-travel clause **red** — so the second clause earns its place |
| a clock-driven idle rock added after the clamp | red on the parked clause *and* the existing pitch clamp |

Restored and green after each.

## How the motion was judged

Not by stills alone. `scripts/tmp-capture.mjs` (**delete before the PR merges** —
it is a scratch harness) drives headless Chromium via `playwright-core` with
`channel: 'chromium'`, which gets a **real GPU** (ANGLE Metal on this machine),
not swiftshader — so the ride runs at a real frame rate and rAF is not throttled.
It clicks through character creation, waits for an `outside` shot of the intro
ride, then takes a strip of screenshots **each labelled with the chassis's own
`position.y` and `rotation.x` read live from the page** via
`window.journey.ride.bus`. Frames at opposite pitch extremes are then compared.

That is what makes stills able to judge a rock: each one is known to be at a
known phase, so nose-down and nose-up can be put side by side.

Measured that way: steady cruise pitches +/-0.032 rad (1.8 degrees), the 2.4
degree clamp being reached only in the pull-away transient at t~0.3 s. Nose-down
and nose-up frames are plainly different attitudes; it reads as a nod, not a
lurch.

The paw was retuned from these captures too — the first cut was sized against
the mudguard, which it matched, when what it has to read against is a 2.13 m
wheel, and it came out a bump on the end of the fender.

## Left to do

- full `check`, `build`, `test:procgen`
- PR
- `rm scripts/tmp-capture.mjs`, kill the dev server by PID
