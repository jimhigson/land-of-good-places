# HANDOFF — statue rotates (E13-statue)

Branch `feat/statue-rotates`, worktree `.claude/worktrees/statue-rotates`.
Port reserved 5342 — **no dev server was needed or left running.**

## The job

Jim, 5 Aug: *"can we also make the pikachu statue slowly rotate? A rate of about
once every 5 seconds should do."* The RiPika statue in the plaza fountain (#200).

**Status: done, build green, PR raised, not merged.**

## What shipped

- `STATUE_TURN_SECONDS = 5` in `src/art/models/ripikaStatue.ts`. **Jim's number,
  shipped as asked.** See "the rate" below — it is fast, and he asked to be told
  rather than have it quietly changed.
- Rotation lives in the asset's own `update(dt, elapsed)` hook per
  ART_DIRECTION §7. `Fountain.ts` only ticks it (one line).
- One moving node: a `statueTurntable` group holding **both** plinth and figure.
  Not the root — the contract reserves root yaw for the caller's placement, and
  an asset that stamps it every frame would silently overwrite a placer's angle.
- Driven from `elapsed`, not accumulated `dt`: stateless, and it keeps the
  statue on the same clock as the fountain ripples it stands in. Note `Game.ts`
  zeroes `dt` under pause but deliberately keeps `elapsed` running, so the
  statue keeps turning behind the pause screen and under `/view?timeOfDay=`.
  That is intentional and matches the ripples; flag it to QA so a
  "frozen" screenshot that still moves is not reported as a bug.

## The defect this uncovered — the important part

**`OCCLUDER_RADIUS` 1.8 → 2.5.** A rotating statue hides different ground
through its cycle, and at 1.8 the turning statue hid a child over **0.9 m² of
plaza about 7 m out, at 9 of 24 poses** — `FoliageFade` did not fade it. That
is design feedback #16 arriving by a new route and it was live-bug territory.

Why: at a fixed pose the outflung paw (3.13 m reach) could be written off as
thin decoration pointing one way. Spinning it makes every bearing see the full
reach. `FoliageFade` tests `radius + SIGHTLINE_MARGIN` (= `PLAYER_RADIUS + 0.35`
= 0.97), so covering the sweep predicts `3.13 − 0.97 = 2.16 m`.

Measured thresholds (`SWEEP_R`, ground hidden-and-not-faded):

```
still (one pose)   r=1.2 → 0.4 m²   r=1.4 → 0        r=1.8 → 0
turning            r=1.8 → 0.9 m²   r=2.05 → 0.1 m²  r=2.10 → 0
```

2.10 measured vs 2.16 predicted — good agreement. Threshold is **2.10 at 24, 48,
96 and 180 poses alike**, so it is not a sampling artefact. Shipped 2.5 (~19%
headroom). Headroom is not free: ground where the statue fades but the child was
not really hidden goes 54.5 m² at 2.10 → 68.6 at 2.5 → 76.1 at 2.7, and the fade
is a binary target (`MIN_ALPHA` 0.26), not a ramp.

Took less headroom than the old 29% ratio (which would be 2.7) deliberately: the
old 1.4 came from **one pose in 0.2 m steps**, and the fragility of measuring one
pose is exactly what produced this bug. 2.10 comes from 180 poses in 0.05 m steps.

**No fade flicker from the rotation** — the fade decision is taken against the
capsule alone, and a capsule about the vertical axis is the same shape at every
angle. Fade still only reacts to the player moving.

## The check

`scripts/check-statue-occlusion.mts` now sweeps `ORIENTATIONS = 24` poses across
one revolution and takes the **worst**, not the built pose. Poses come from
driving the asset's own `update()`, so it follows any change to rate or moving
node. `SWEEP_R` and new `SWEEP_POSES` env overrides.

24 chosen by measurement: threshold identical at 24/48/96/180; worst-case hidden
area 29.0 m² at 24, 29.1 at 48, 29.3 at 180. Cost 2.5 s at 24, 20 s at 180.

Because that coupling could fail *open*, there is a **precondition** that the
statue genuinely turns and returns after one period. **Both branches proved red**
by temporarily breaking the asset: rotation disabled → "does not appear to turn";
rate ≠ declared period → "did not bring the statue back". Both exit 1.

## Review follow-up (post-approval): shared fade constants

Reviewer found the FADED side hand-copied four constants `FoliageFade.ts` did
not export — `SIGHTLINE_MARGIN`, `MAX_LINE_T`, `NEAR_PLAYER_RADIUS`,
`CAPSULE_SAMPLES`. All matched, but widening the real fade would have left the
check measuring the old one and **reporting success**: the same fail-open hazard
the rotation precondition exists to prevent, from the other side of the test.
Independence of the *algorithm* is what makes the check worth having; copying
the *parameters* was just duplication.

They now live in **`src/world/foliageFadeTuning.ts`**, imported by both. The
sightline maths in the check stays re-derived.

**They are not simply exported from `FoliageFade.ts`, and cannot be.** Tried it
first: the check scripts run under `--experimental-strip-types`, which is
strip-only and rejects TypeScript parameter properties. `FoliageFade`'s
constructor uses them (`private readonly scenery: Scenery`), so importing
*anything* from that file throws `ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX` before a
constant arrives. Extracting the tuning was much smaller than rewriting a working
constructor to suit a test runner. That is recorded in the new module's header,
along with a note asking the next person not to fold it back in.

Proved live, not assumed: narrowing `SIGHTLINE_MARGIN` in the tuning module
flips the check to failing (0.9 m², 9 of 24 poses). Under the old copies it would
have gone on passing. Restored; numbers identical to before the change
(25.8–29.0 m², worst at 120°, 68.6 m² early), confirming the imports match the
copies exactly.

## Verifications

- `npm run build` → **exit 0**. `npm run test:procgen` → **exit 0**.
- Everything rotates together (probe over the built tree): 40 meshes, **40/40
  under the turntable**; 13 outline hulls, all parented to their own mesh, **all
  castShadow=false (untouched)**; 31 off-axis meshes, **0 left behind** after
  180°, worst error 5.6e-16 m; 9 meshes exactly on axis (no-op, correct).
- **Shadow: not a lighthouse.** Sun at `DAY_START_TIME` is 28.6° elevation,
  19.1 m shadow. Across a full revolution the shadow's **bearing varies 13.6°**
  (a sweeping beam would be 360°) and its **length 18.8–19.7 m**. Rotation about
  a vertical axis under a fixed sun cannot sweep a shadow — the direction is the
  sun's, not the statue's. What moves is detail *within* the fixed shadow: the
  paw's shadow orbits a small circle out at ~19 m at **3.36 m/s**.

## The rate — Jim asked to be told

5 s = **1.257 rad/s**. Ship it, but it is fast, and his own word was "slowly".

- The park's only other large rotating object, the Ferris wheel, is
  `TURN_SECONDS = 44` under the comment *"Slow: this is scenery, not a ride"* —
  0.143 rad/s, 1.0 m/s at a 7 m rim. This statue is **8.8× its angular speed**.
- Every `rotation.y = elapsed * K` in the repo falls in three bands: celestial
  0.01–0.25, tabletop props 0.6–3.4, sparkles 3–9. At 1.257 an **8.24 m** statue
  lands in the *tabletop-prop* band, between a 0.20 m candy-floss spinner (1.4)
  and a 0.62 m tap-marker ring (1.1).
- The raised paw sweeps at **3.93 m/s** — 4× the Ferris wheel rim, faster than an
  NPC walks (2.55), about parade top speed (4.2). The face turns from facing you
  to facing away in 2.5 s; 72°/s.

**Suggested if ever retuned: ~15 s** (0.419 rad/s), putting the paw at 1.31 m/s —
the Ferris wheel's rim speed, this park's established pace for "something large
moving gently". Not the wheel's own 44 s: a six-year-old should see it turning
within a couple of seconds of looking, not have to stand and wait.

This judgement is **analytical, from the park's own constants — nobody has looked
at it running.** The fleet brief forbade the browser. Needs QA eyes.

## For QA

1. Does 5 s/rev read as stately or as a fairground spinner? This is the question
   Jim actually needs answered.
2. Walk round the fountain at ~6–8 m and confirm the statue fades before the
   child is hidden, at all points in the turn (the 2.5 m capsule).
3. Confirm the wider capsule has not made the statue annoyingly ghostly on the
   plaza — 68.6 m² now fades a little early, up from 44.0.
4. The statue keeps turning behind the pause screen and under `/view?timeOfDay=`.
   Intended, matches the fountain ripples. Not a bug.
