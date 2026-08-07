# HANDOFF — railrace-round9 (agent `e-railrace-round9`)

Work for PR **#223**. Branch `e/railrace-round9` in
`.claude/worktrees/e-railrace-round9`, pushed to `chore/rail-race-pr-triage`.
Left alone as instructed: `railrace-bonk`, `railrace-round5`,
`e-railrace-blockers`, `pr-triage`.

Read `HANDOFF-railrace-bonk.md` for rounds 1–8. This file covers round 9 only:
**Jim's four notes after riding the approved PR.**

## Merge with `origin/main` — done first, two real conflicts

1. **`Player.ts`** — round 8 moved `applyRidePose` to the end of `animate` (so
   the Rail Race pose is the last writer of `body.rotation.x`); `main`'s slide
   branch added a `posture` parameter and a reclined pose, still called from
   `update`. Resolved by keeping **round 8's ordering** and **main's parameter**:
   one call, at the end of `animate`, passing `this.ridePosture`. Both doc
   paragraphs kept — they document different things and both are true.
2. **`parkFacts.ts`** — both sides destructured `Matrix4` from a dynamic import
   into the same function scope. Aliased mine (`Mat4`) inside the rail-race
   block that introduced the clash.

**Test count reconciled after the merge: 171 → 216** (main brought +45), then
**221** with round 9's new invariant.

## The four notes — all four done

### 1. Her arm clips through the mine cart. DONE, guarded

**Measured first**, by ray-casting the built hopper against every vertex her arms
draw, outlines included, in each pose that moves them:

```
seated -0.226   duck -0.271   boost -0.285   duck+boost -0.271
celebration: arms lift clear over the rim, nothing beside the tub at all
```

Her hand reached **0.285 m outside** the tub — not buried in a wall, out in open
air beside the cart, under the overhang of the rim.

**The cause was the taper, not the width.** The tub was 0.62 m across at its
floor and 1.04 m at its rim, and her hands hang only **24% of the way up that
wall**: her hand's outer edge sat at 0.527 in cart units against a wall at 0.409.
Her hand was always *inside* the rim's own 0.52 — it came through the slope
below it.

So most of the fix is **shape**, done in the authoring source
(`art/blend/cart.blend` via the new `art/blend/cart_widen_hopper.py`): floor
0.31 → 0.52, and the wall now runs **vertical** at 0.55 from the bevel to the
rim instead of sloping 0.37 → 0.52. Only 0.06 is extra footprint.

The ramp is **capped** at the rim's half-width, and the cap is the point: without
it the floor's much larger scale factor reaches the lowest bevel loop too and
throws the widest part of the cart down to 0.608 — a tub with a belly, wider
below than at its rim.

**One owner.** `CART_WIDTH_AT_PARK_SCALE` (1.04 → **1.10**) is new in `route.ts`
and `LANE_SPACING_AT_PARK_SCALE` is derived from it. They were two independent
1.04s that happened to be equal with nothing saying they had to be — so four
carts sat side by side with zero gap *by coincidence*, and any widening would
silently have made neighbours interpenetrate. Everything downstream (`laneSpan`,
`laneOffsets`, `WIDEST_HALF_SPAN`, trestle beam span, the arch's half-width, the
camera's rider offset) already derived from lane spacing and follows for free.

`check:cart-shape` now asserts the built hopper's widest vertices equal
`CART_WIDTH_AT_PARK_SCALE / 2` — the shape is authored in Python-and-Blender and
consumed in TypeScript, so nothing else can catch the two disagreeing.

**1.10 is a ceiling, not a preference, and it was found by being caught.** At
1.12 `raceCameraNeverRunsBackwards` **fails on seed 5**: widening the lanes walks
the outermost lane — the player's — further out, and the race camera stands off
*that* lane round a ~22 m hairpin where it already turns tighter than she does.
Swept against the real invariant: 1.04 / 1.06 / 1.08 / 1.10 pass, **1.12 fails**
at 0.049 against its 0.05 floor. The floor was not lowered and round 8's camera
work was not reopened.

**Result:** seated **0.057**, duck 0.116, boost **0.057**, duck+boost 0.116 m of
clearance; celebration clear of the tub entirely.

**Knock-ons checked.** Wheels still 100% visible on the lap sweep (mean 1.000,
worst 1.000). Corridor re-derived in `NOMINAL_OUTSET`'s own doc: half-width
4.675 → 4.90 m, limits 5.92/7.15 → 6.15/6.92, slack 0.58 → **0.35 inside, 0.42
outside**. The finish arch grew with `laneSpan` and its legs still land clear —
closest approach to a path **33.7 m**, to the railway **25.1 m**, all five seeds.

Guarded in `check:rail-race` **by ray-casting the built hopper, not by comparing
against a half-width**: the tub is not a box, so "the cart's width" is a
different number at every height — and a width-based check would have gone green
on a uniform scale-up that never touched the taper. Proved red by rebuilding the
original tapered tub from the `.blend`: *"the rider's arm goes 0.285 m through
the side of the cart in the 'boost' pose"*.

### 2. Too easy — halfway back. DONE, measured

Real before/after read off the branch history (`299d90d` is the last commit
before the difficulty work; `130867b` is the work):

| lever | old ("too hard") | current ("too easy") | **shipping** |
| --- | --- | --- | --- |
| `PLAYER_BOOST_ADVANTAGE` | 1.2 | 3.0 | **2.1** |
| `MAX_SPEED` | 33 | 40 | **36.5** |
| `RIVAL_SKILL` | .62/.72/.82 | .40/.48/.56 | **.51/.60/.69** |
| `SWING_BEHIND` | 1.0 | 0.4 | **0.7** |

**It really is halfway, on the outcome and not just on the constants:**

```
config                     child L1  child L2  child L3   competent L3
old     (Jim: too hard)      0/24      0/24      0/24        100.1 m
halfway (shipping)          24/24     24/24     11/24        298.0 m
current (Jim: too easy)     24/24     24/24     24/24        461.2 m
```

461.2 → 298.0 m is the figure Jim reacted to. `playsBadly` still loses every
seed (0/24). Sloppy play wins 23/24.

**Two things to know before re-tuning:**

- **`MAX_SPEED` is inert.** 40 → 36.5 changes every number above by *exactly
  zero* — nobody ever reaches the cap. Moved for consistency with the ask only.
- **`PLAYER_BOOST_ADVANTAGE` only touches the child.** Halving it alone takes
  the child 114.8 → 65.3 m and leaves the competent player at **464.8 m** — it
  does nothing whatever for the complaint being answered. That is the
  self-limiting property its own doc comment predicts, now confirmed by
  measurement. The levers that moved Jim's own race are `RIVAL_SKILL` (−99 m)
  and `SWING_BEHIND` (−57 m).

**Guards: two moved, one added, none slid to fit.** The old child guard was
`wins >= 22` at level 3 — that encodes "a child wins essentially every race on
the hardest level", which is the *previous* instruction and is arithmetically
incompatible with this one. Halfway between never and always is about half, so
a 22/24 bound makes "halfway" impossible by construction.

Split by level instead, which is where it belonged — **level 3 is the only
level with duck bars at all** (`BARS_FROM_LEVEL`), so it is hard mode by
construction:

- child must win **every** seed at levels 1 and 2 (tighter than the 22/24 it
  replaces, in the place that decides whether the game is playable)
- child's mean margin taken from **level 1 only**, because that is the sweep she
  wins every seed of. `marginMetres` is ≈ −0.2 on a loss, so a mean over a level
  she loses half of measures win *rate* while pretending to measure closeness
- level 3 must stay a race, not a wall: at least a quarter of seeds
- **NEW**: the competent player's mean margin gets the child's half-lap bound.
  Nothing bounded *his* race before, which is why his complaint landed on a
  build where every child-facing guard was green. Tight on purpose (298.0
  against 300.1) and safe to be — the sweep is fully deterministic, so it cannot
  flake; only a balance change moves it.

Proved red on the real configs: old settings fire all three child guards, the
"too easy" settings fire the new one at 461.2 m.

### 3. The rainbow must reach the ground. DONE, guarded

Each band continues straight down at its own radius, in its own colour, from
the arc's foot to `terrainHeight`. 12 legs per ring. **The solve is untouched** —
`innerRadius` is still `hypot(halfWidth, clearHeight)`; these are added beneath
the existing feet, not a resize.

Legs are lopsided by 3.7× (6.1–6.3 m inner, ~22.6 m outer) and that is honest:
the ring runs `NOMINAL_OUTSET` outside the park edge and the arch is wider than
the ring, so the outer feet land past `RIM_OUTSET_END` where terrain has fallen
the full `RIM_DROP`. The trestles beside it are just as lopsided.

**Where the feet land, all five seeds:** closest approach to a path **35.7 m**,
to the railway **27.4 m**, every foot clear of plots. The arch is in a genuinely
different place on each seed, so that is five measurements not one repeated.

New invariant `finishRainbowStandsOnTheGround`, +5 tests. **The ground test
takes the lowest terrain under the leg's own footprint, not at its centre** —
the centre reading is `bottom = ground - tube` played back and was identical to
three decimals on all five seeds. Proved red three ways (legs removed; stopped
3 m short; hung 2 m below their own band), the third leaving the ground half
green so the two are independent.

Also pinned a latent trap: `parkFacts`'s headroom fact matched
`startsWith('railRace:finish-rainbow')`, which now also catches the legs.
Matched exactly (`-\d+$`) now.

### 4. Boost lean overdone — halve it. DONE, guarded

`BOOST_ROCK` 0.42 → **0.21** rad (24° → 12°). Head throw on a pump
**1.42 → 0.71 m**. The visibility floor in `check:rail-race` moved 0.4 → 0.2 of
the ride scale (1.0 → 0.5 m) deliberately and in step; what it still catches is
a *disappearance* (the constant at 0, and round 8's stamping bug), both of which
read as exactly 0.00 m. Proved red at `BOOST_ROCK = 0`.

Boosting while ducking re-checked: head top **5.66 either way** against a bar
underside of 6.38 — unchanged, and the change only ever reduces the rock.

## Checks

- `npm run build` — **exit 0**, run directly, never piped.
- `npm run test:procgen` — **221 passed, 9 files, 0 skipped**.
- `npm run check:rail-race` — exit 0.

## Untracked scratch files (deliberately left)

`scratch-levers.mts` (field sweep at any level via `RR_LEVEL`), `scratch-arm-clip.mts`,
`scratch-label240.mts`,
`scratch-arch-feet.mts`, `scratch-arch-legs.mts`. Sweep harness at
`/private/tmp/claude-501/.../scratchpad/sweep.sh`.

## Still needs eyes — no browser this session

Everything visual from rounds 5–8 is still unverified, plus round 9's:
the halved boost lean, and the rainbow's legs (especially whether the 3.7×
lopsidedness reads as "standing on a hill" or as a mistake).

## Issue #240 — YES, it affects this ride. Checked, not fixed (as instructed)

`Player.animate` sizes the label from `this.camera` — the orthographic
`IsoCamera` — and **nothing hides the label while riding**, so it is drawn all
the way round the Rail Race under the perspective `RaceCamera`. Same root cause
as the slide.

**But it fails in the opposite direction here, which is presumably why nobody
has reported it.** Measured on the canonical seed at 1600×900:

| | worldUnitsPerPixel | rider distance |
| --- | --- | --- |
| `IsoCamera` (what the label is sized from) | 0.016667 | — |
| `RaceCamera` at rest | 0.050470 | 62.2 m |
| `RaceCamera` racing | 0.055844 | 68.8 m |

`NameLabel.updateScreenSize` sets `height = worldUnitsPerPixel × pixels`, so on
the Rail Race the pill is drawn **3.0–3.4× too small** — not enormous and
clipped as on the slide, just quietly wrong and easy to miss.

**There is a second half of the same bug on this ride, and it is the more
interesting one.** `updateScreenSize`'s *other* argument is also the wrong
camera's: `LABEL_MAX_DISTANCE` is 46 m and the visibility test is
`distanceToCamera <= 46` against the **iso** camera's focus point. The real lens
is **62–69 m** from the rider — past that cut-off. So a label that the rule says
should be **hidden entirely** on this ride is being drawn, and then mis-sized.
Fixing #240 by passing the active camera would therefore *remove* the Rail
Race's name label rather than resize it, which is very likely the right answer
(the rider is the whole picture; she does not need labelling) but is a design
call worth making deliberately rather than as a side effect.

Not touched here — it is pre-existing on `main` and belongs in its own PR.
`scratch-label240.mts` reproduces the table above.
