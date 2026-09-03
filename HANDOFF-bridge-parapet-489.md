# HANDOFF — issue #489, the hole in the bridge parapet above the arch

Branch `fix/bridge-parapet-489`, worktree
`.claude/worktrees/bridge-parapet-489`. Off `origin/main` at `7a1d81f9`.

## Status

**Root cause confirmed by measurement on all 17 pool seeds / 23 bridges.**
Fix not yet written.

## FOR THE OVERSEER AND THE ARTIST — the reported "second fault" is not one

The Artist reports that after the one-liner, **0.16–0.18 m of daylight survives
at 1.10–1.28 m over the road, at along ≈ ±6 m**, on seed 3's `bridge-4.0` and
seed 5's `bridge-56.0`, and calls it a second independent fault. **Measured, it
is its instrument reading the sky above an intact coping.** #489 does close on
the anchor fix.

The one number that settles it: **the tallest parapet on any bridge in this
game is 1.170 m**, and only at the crown. That is
`PARAPET_HEIGHT + PARAPET_CROWN_LIFT` = 0.72 + 0.45, and it is capped there by
construction. Confirmed on all three of the Artist's own seeds:

| seed | bridge | tallest parapet anywhere on it |
|---|---|---|
| 1 | bridge-72.0 | 1.170 m |
| 3 | bridge-4.0 | 1.170 m |
| 5 | bridge-56.0 | 1.170 m |

A band at **1.28 m** over the road is therefore above the wall on every bridge
in the park, at every ring, including the crown. And the reported spot is *not*
the crown: at along ≈ ±6 m the parapet is shorter still, because
`parapetHeightFor` arcs it with the hump. Seed 5's `bridge-56.0`, mid-ramp,
read off the drawn `wallTop` mesh with a downward cast for the coping's real
top:

| ring | road | wall top | parapet | coping top | road + 1.10 | road + 1.28 |
|---|---|---|---|---|---|---|
| 17 | 3.578 | 4.683 | **1.105 m** | 4.788 | 4.678 | 4.858 |
| 34 | 2.859 | 3.865 | **1.006 m** | 3.970 | 3.959 | 4.139 |

At ring 34 the coping's top is 3.970 and the probed band runs to 4.139 — it
overshoots the stone by **0.169 m**, which is the Artist's own 0.16–0.18 m
figure, arrived at as an overshoot rather than a hole.

That is exactly the failure its instrument's history already records ("it
bounded the ladder by *the ray stopped hitting anything*, which in a hole means
sky"), relocated rather than removed: the ladder no longer runs off the top of a
*holed* wall, it runs off the top of an *intact but shorter* one on the ramp.
It also explains the two properties the Artist found puzzling — span-independent,
and byte-identical under a different ladder anchoring — because it is not
geometry at all.

Checked the other way too. My probe takes the parapet top per ring from the
drawn mesh and refuses to judge any sample its inner-face control cannot find
wall at, so it cannot run off the top. On the Artist's own two seeds, after the
fix: seed 1 `bridge-72.0` **0 / 3041**, seed 3 `bridge-4.0` **0 / 2407**, both
with a clean negative control (0 walled of 936 and 738 samples in open air).

Where the Artist is right, and it matters: the kit contains no wall piece, the
fault is `buildShellGeometry`'s course ladder, and collision is correct. All
three agree with what I measured independently.

## FOR THE OVERSEER — the ownership call, settled

**This is mine (Engineer), not the Artist's. The authored stone kit is not
implicated and does not need rebuilding.** The fault is in how the swept
masonry shell is built in `src/world/train/bridges.ts` — one wrong anchor
constant. The voussoirs, keystone, imposts and coping from
`art/blend/bridge_stones_*.py` are all placed correctly and are all present in
the geometry; the probe hits them. I have not touched `art/blend/*`.

**And the collider is already correct — only the mesh is wrong.** She can see
through the bridge; she cannot walk through it. Measured, canonical seed, on
the real `CollisionWorld` with `PLAYER_RADIUS`, pushing a body at the parapet
from the roadway in 6 cm resolved steps:

| | bridge-0.0 | bridge-234.0 |
|---|---|---|
| full-height parapet, escaped | **0 / 88** | **0 / 75** |
| tapered kerb (no parapet by design), escaped | 19 / 23 | 16 / 21 |

The kerb row is the control: it is what an escape looks like when the probe can
see one, and those escapes are correct — `parapetHeightFor` tapers the parapet
away below `BUILDING_STEP_UP` on purpose so a wing wall does not sever the path
junction each ramp foot lands in. Both thresholds there are the game's own step,
not figures of the probe's.

So this PR is a **geometry-only fix**. Nothing about collision changes.

## The diagnosis (read, not yet measured)

**It is not the authored stone kit, and it is not the arch's cut.** It is the
coursed outer face of the spandrel/parapet wall, in
`src/world/train/bridges.ts`'s `buildShellGeometry`, and it is one number.

`courseLevels` is built downward from **`crownY`** — the road surface at the
crown:

```ts
for (let y = crownY; y > lowestBottom - COURSE_HEIGHT; y -= COURSE_HEIGHT) {
  if (y <= highestTop + COURSE_HEIGHT) courseLevels.push(y);
}
```

so the topmost course level is exactly `crownY`, and nothing above it is ever
pushed. `buildCourses` then clamps every column into those levels:

```ts
const yTop = Math.min(topY, Math.max(bottomY, levelTop));
```

with `topY` = this ring's parapet top. Where the parapet top is **above**
`crownY`, `yTop` clamps down to `crownY` and the wall between `crownY` and the
parapet top gets **no outer face at all**.

The parapet top is `surface + parapetHeightFor(hump)`, and at the crown that is
`crownY + PARAPET_HEIGHT + PARAPET_CROWN_LIFT` = `crownY + 0.72 + 0.45` =
**`crownY + 1.17 m`**. So the missing band is widest — up to 1.17 m — exactly
at the crown, which is directly above the arch, and narrows to nothing out on
the ramps where the road surface has fallen a parapet's height below the crown.

That is Jim's report precisely: a run of wall absent above the arch's opening,
the parapet either side intact.

The `Ring.outerTop` vertices (`bridges.ts:1122`) are created at the parapet top
and then **never referenced by any quad** — dead vertices, which is the tell.
Before #360 the outer face was one quad `outerBottom → outerTop` and there was
no gap; #360 replaced it with the coursed column and anchored the courses on the
road crown instead of on the wall top.

The comment on the course levels states the intent — *"anchored on the crown so
the top course lands square under the coping"* — and that intent is right; the
anchor is simply the wrong crown. `PARAPET_CROWN_LIFT` (also #360, same commit)
put the coping 0.45 m above the road crown the levels are anchored on.

### Why you can see through it rather than seeing the inside of the wall

Only the **outer** face is missing. The inner face (`innerTop` → `innerBottom`)
and the `wallTop` cap are drawn full height. Those are single-sided, so the game
camera — looking down at the near parapet from outside — sees straight past the
missing outer face, through the back of the inner face, to the grass and railway
beyond.

## Ownership split

**Mine (Engineer), not the Artist's.** The fault is in how the swept shell is
built in `src/world/train/bridges.ts`; the authored kit
(`art/blend/bridge_stones_*.py`, voussoirs / keystone / coping) is placed
correctly and is not implicated. I have not touched `art/blend/*`.

## The intended fix

Anchor `courseLevels` on the **parapet top line** rather than the road crown:
start the ladder at `highestTop` and drop the now-redundant
`y <= highestTop + COURSE_HEIGHT` guard. Then course 0's `levelTop` is at or
above every ring's own parapet top, `yTop` clamps to the parapet top, and the
face covers the whole wall by construction. `crownY` then has no remaining use
inside `buildShellGeometry` and the parameter should go — one owner, rather than
a second crown definition sitting unused.

## Still to do

1. Run the instrument (below) and paste per-seed numbers under "Measured".
2. Answer the collider question: `guardRails`' `topHeight` already reads
   `parapetTopFor`, i.e. the *arced* top, so the collider is expected to be
   correct where the mesh is not — confirm by measurement, not by reading.
3. Fix, re-measure, add the invariant, prove it red against today's geometry
   and paste the geometry beside the transcript.
4. `pnpm run check`, `pnpm run test:procgen`, `pnpm run build`; `check:coplanar`
   especially — new wall area meets the coping plane.
5. Eyes on it in a browser, standing on a bridge, on more than one seed.

## The instrument

A see-through probe, derived from the drawn `wallTop` mesh rather than from the
formula behind it.

`wallTop`'s vertex buffer is written four per ring by `buildShellGeometry` —
`copingOuter[+], copingOuter[−], copingInner[+], copingInner[−]` — so vertex
`4r + 0..3` gives, for ring `r`, the outer edge point and the inner edge point
on each side, both at that side's own parapet-top height. Outward direction is
`normalize(outer − inner)` in plan.

From each outer point, march a horizontal ray in from `D` metres outside at a
ladder of heights below the parapet top and record the first **front-face** hit
on the bridge group. Where the outer face exists the ray stops at the wall;
where it does not, it sails past.

**Control:** the same probe at a height well below `crownY`, where the wall is
known to be drawn, must hit on every sample. An instrument that reports a hole
everywhere, or nowhere, is measuring the wrong thing — two agents on this
project have had clean, decisive, wrong answers from exactly that.

## Measured

`pnpm run measure:bridge-parapet` (new, on this branch). Every parapet ring, a
ray in at the outer face at 5 cm height steps from 0.03 m to 1.50 m below that
wall's own drawn top; each sample controlled by a second ray outward at the same
wall's *inner* face, so a sample only counts when there is wall there and you
can still see through it.

**Negative control** (`--control`, the same ladder in open air 0.40–0.80 m
*above* each parapet top), canonical seed: `bridge-0.0` 0 walled of 1026
samples, `bridge-234.0` 0 walled of 882 samples, 0 one-sided on either. The
instrument does not invent walls.

An earlier version of the control probed a fixed 1.6 m below the parapet top
and reported 35–42% see-through. That was the *instrument* being wrong, not the
bridge: at a tapered ramp foot, 1.6 m below the parapet top is below the
masonry entirely. It is recorded here because it is exactly the failure
CLAUDE.md warns about, and the control is what caught it.

**The probe**, `--pool`, all 17 seeds carrying a bridge, 23 bridges:

| seed | bridge | see-through / walled | worst band |
|---|---|---|---|
| 20260728 | bridge-0.0 | 488 / 2975 (16.4%) | 1.05 m |
| 20260728 | bridge-234.0 | 453 / 2559 (17.7%) | 1.05 m |
| 5 | bridge-12.0 | 530 / 3235 (16.4%) | 1.05 m |
| 5 | bridge-56.0 | 441 / 2571 (17.2%) | 1.05 m |
| 5 | bridge-142.0 | 538 / 3222 (16.7%) | 1.05 m |
| 11 | bridge-30.0 | 438 / 2559 (17.1%) | 1.05 m |
| 24 | bridge-20.0 | 482 / 2918 (16.5%) | 1.05 m |
| 115 | bridge-62.0 | 526 / 3231 (16.3%) | 1.05 m |
| 128 | bridge-0.0 | 453 / 2574 (17.6%) | 1.05 m |
| 131 | bridge-224.0 | 538 / 3230 (16.7%) | 1.05 m |
| 208 | bridge-2.0 | 524 / 3242 (16.2%) | 1.05 m |
| 225 | bridge-16.0 | 455 / 2562 (17.8%) | 1.05 m |
| 225 | bridge-104.0 | 443 / 2562 (17.3%) | 1.05 m |
| 225 | bridge-200.0 | 524 / 3226 (16.2%) | 1.05 m |
| 225 | bridge-244.0 | 463 / 2823 (16.4%) | 1.05 m |
| 267 | bridge-284.0 | 536 / 3236 (16.6%) | 1.05 m |
| 274 | bridge-2.0 | 451 / 2562 (17.6%) | 1.05 m |
| 274 | bridge-312.0 | 440 / 2526 (17.4%) | 1.05 m |
| 288 | bridge-4.0 | 450 / 2562 (17.6%) | 1.05 m |
| 326 | bridge-18.0 | 444 / 2548 (17.4%) | 1.05 m |
| 346 | bridge-244.0 | 530 / 3229 (16.4%) | 1.05 m |
| 428 | bridge-0.0 | 532 / 3239 (16.4%) | 1.05 m |
| 451 | bridge-0.0 | 528 / 3235 (16.3%) | 1.05 m |

**Every bridge on every seed**, and — the tell — the worst contiguous band is
**1.05 m on all 23 of them**, always running from 0.03 m below the parapet top
downward. The hole does not vary with span, because it is not set by the span:
it is `PARAPET_HEIGHT + PARAPET_CROWN_LIFT` = 0.72 + 0.45 = **1.17 m** of wall
standing above the level the courses stop at, sampled on a 5 cm ladder.

That also answers the issue's own question of which way round it is: the
parapet is **not** skipping courses where it thinks the arch is, and the arch's
cut is **not** taking wall it should not. The arch is innocent. The courses
simply never reach the top of the wall anywhere, on any bridge — it merely
*looks* like an arch problem because the parapet stands highest, and so the
band is widest, at the crown, which is directly over the arch.
