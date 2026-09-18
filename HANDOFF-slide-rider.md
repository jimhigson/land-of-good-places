# HANDOFF — `check:slide-rider` on `feat/procgen-on-sphere`

Branch `fix/slide-rider`, off `origin/feat/procgen-on-sphere` (base commit
`ae20b9fc`). PR target: `feat/procgen-on-sphere`. **Model: Opus 5 (1M context)**,
chosen by the Overseer; a replacement runs the same model.

Browser: **not allocated** to this task (the fairy-lights engineer has it). Work
is build-verified only; the PR must say so and list what needs visual QA.

## The failure, reproduced on the base branch

```
beat 1 trackside frame 240  head  1592 px   body    42 px   body is  0.13% of frame
```

against a 0.40% floor. The other five trackside samples were 1.22–2.75%.

## Root cause — measured

Walking beat 1 frame by frame, printing eye-to-rider distance and
`endOn` = |dot(viewDir, bodyAxis)| (1 = straight down her body, 0 = broadside):

```
  frame 170  dist 6.89 m  endOn 0.002  head  2202  body   832  body% 2.57
  frame 210  dist 6.97 m  endOn 0.655  head  2511  body   460  body% 1.42
  frame 240  dist 8.89 m  endOn 0.910  head  1592  body    42  body% 0.13
```

Distance was fine throughout and inside every allowance the placement code had.
The **angle** collapsed: the chute turns inside a beat, the eye was built from
the beat's **midpoint** frame, so it is broadside at the midpoint and end-on at
the ends. The 75° elevation constant was a hand-tune against the same symptom on
the old chute. Beats stretch with the park (#241), so this gets worse, not
better.

## The fix

`planSlideShots` now sweeps anchor × elevation × standoff, scores every
candidate by the worst apparent body extent across its own beat
(`sin(theta)/distance`), and **probes them in that rank order against the chute
as built**, taking the first actually clear. Backtracking, per CLAUDE.md.

An analytic cross-section wall test was written first and was **wrong**: it
drops the along-chute component, and on beat 5 the chute bends back so the
trough blocking the shot for 31 frames belonged to a different part of the curve
1.4 m in front of her. The built chute is available at plan time — it is asked
directly. Do not reintroduce the analytic version.

`parkFacts` + the existing trackside invariant gained a fifth clause: the worst
body extent per beat, floor `0.06`, calibrated against the pixel check on shared
frames (0.40% of frame ≈ 0.064 extent). This is what gives the other seeds cover
that `check:slide-rider` (canonical seed only) cannot.

## Status

- [x] reproduced, root-caused
- [x] fix implemented; `check:slide-rider` green (exit 0)
- [x] new invariant clause added and proved capable of failing (seed 24 read
      0.0546 against the 0.06 floor before the search was resolved finely
      enough; fixed by raising the search's sample count, not by lowering the
      floor)
- [x] `test:procgen` failure set **identical** to the base branch — 55 on both,
      none added, none fixed. The base branch is already red here.
- [x] dense per-frame pixel sweep — the check samples only 2 frames per beat, so
      every trackside frame was rastered at 5-frame resolution. **True worst
      across the whole ride: 0.59% of frame** (beat 1, frame 240), against the
      0.40% floor. Next worst 0.68%, 0.73%, 0.79%. No frame dips under.
      Beat 3 reaches `endOn` 0.99 and still reads 0.68% — viewed end-on from her
      **feet**, where there is no head to hide the body; the extent measure
      treats both ends alike, which is conservative, not wrong.
- [x] `pnpm run check` — `check:slide-rider` **passes inside the chain**. The
      chain still exits 1, for six steps that fail **identically on the base
      commit** `ae20b9fc`: `check:waypoints` (245 identical findings),
      `check:cart-shape` (TDZ on `RIDE_SCALE`), `check:park-boot`,
      `check:ground-claims`, `check:layout-rung`, `check:arrival-camera`. Plus
      `check:solve-cost`, which is flaky under load (260.3 ms once after a
      30-step batch; 96.6/98.0/99.3 ms clean here vs 110/117 ms on base).
      **The brief's "exactly one of 65 steps fails" is stale** — it is seven of
      67, and six are not this slice's.
- [x] deliberate break. `git checkout origin/feat/procgen-on-sphere --
      src/world/slide/cameras.ts src/world/building/Building.ts` (keeping the new
      test clause) puts the **original** placement back, and the new invariant
      clause goes red on the exact defect:

      ```
        seed 20260728: worst body extent beat 1 0.0445 (0.90 end-on), beat 3
          0.0614 (0.81), beat 5 0.0854 (0.66) — floor 0.06
        × the ginormous slide's cameras cover the whole ride and can see it
        AssertionError: the trackside camera on beat 1 shows the rider at 0.0445
        of body extent at its worst moment, against 0.06 required — it looks 90%
        of the way down her own body there
      ```

      0.90 end-on matches the 0.910 measured frame by frame at ridden frame 240,
      so the clause is armed against the thing it was written for, not merely
      against a moved threshold. With the fix restored the same seed reads
      0.0695. **Geometry this was proved against: base commit `ae20b9fc`,
      canonical seed 20260728, slide length 78.94 m.**
- [x] PR #680, against `feat/procgen-on-sphere`

## Notes for whoever takes this over

- `scripts/` is outside every tsconfig project, so `tsc --noEmit` proves
  **nothing** about `check-slide-rider.mts`. Running the check is the only proof.
- `scripts/diag-*.mts` written during this work were scratch and have been
  deleted; the repo's own pre-existing `diag-*.mts` are untouched.
- Real rendered frames are possible **without** the shared Chrome profile:
  `playwright-core` + `vite preview` on your own port, headless, WebGL works.
- The 0.40% threshold (`TRACKSIDE_BODY_FLOOR`) is untouched, and `scripts/` has
  no diff against the base at all.


---

# Round 2 — Jim rode it: "camera all jittery, player clips into the slide"

## Both defects were PRE-EXISTING. Hard control

Same instrumented ride on branch and on base: `deepest body point: -0.676 m in
the trough frame (head, frame 489)` — **byte-identical**, same value, same part,
same frame. Camera motion likewise (worst within-beat turn 1.13 vs 0.95
deg/frame). Jim's "this used to be almost perfect before spherical world" was
right.

## Root cause — three notions of "up" over 95 m of one chute

| thing | its "up" |
|---|---|
| centre line (`solve.ts` `heightAt`/`worldYAtRadius`) | radius-held, per column |
| trough cross-section (`SlideRide.sampleFrames`) | world `(0,1,0)`, per sample |
| **the rider** (`advanceRide`->`setRidePose`->`faceOnGround`) | **the sphere normal** |

`faceOnGround` premultiplies `tiltToSphere`. She was leant onto the planet
inside a trough that is not. Measured at the worst frame: chute slope 28.4 deg,
her `rotation.x` **-15.7 deg**, and as the slope fell 29.1->27.9 her pitch moved
the OPPOSITE way. Head at `up=-0.655` where a reclining child belongs at `+0.51`.

## Second defect: `up.ts` built a YXZ intent from an XYZ euler

`_euler` was `new Euler()` (XYZ). `setFromEuler` ignores the object's own
`rotation.order`, so `Building.ts:1649`'s `rotation.order = 'YXZ'` — with a
docblock explaining why it is load-bearing — could never take effect.

**Wider survey, as asked:** of every `faceOnGround` caller in the game, only
**two** pass a non-zero pitch — `railRace/seat.ts:88` and the slide. With
`pitch = 0` the two orders are identical (one turn about Y), so the parade, the
NPCs, the pets, the bus and the exit crowd were never affected. The rail race
**was**, and its engineer should know.

## The fix

`SlideRide.frameAt(t)` is now the single owner of the chute's cross-section, and
`sampleFrames` — the sweep that draws the trough — is written in terms of it.
The rider, the chase seat, the grown-up and the pets all read it; each had been
rebuilding its own from a yaw and a `slopeOf`. Lifts go along the frame's `up`,
not world `+Y`. Orientation is handed over as a **basis**, not euler angles,
because angles need an order and the order was the second bug.

`Player.setRideFrame` is the new door for a ride that owns its frame;
`setRidePose` (which ends in `faceOnGround`) stays for anything whose floor is
the actual ground.

    deepest body point in the trough frame   -0.676 m  ->  +0.237 m   (floor -0.06)

## Two new clauses, both proved red

1. **Rider inside the trough surface**, in the chute's own frame via `frameAt`.
   The old clause measures distance to the centre LINE and allows 1.90 m — it
   reported a comfortable "worst 0.26 m off the chute" while her head was 0.62 m
   through the floor. **A distance to a line cannot tell you which side of a
   surface you are on.** Keep that as the cautionary note.
2. **How the shot MOVES** — a trackside eye may not drift within its beat
   (bolted to the ground), and the turn rate may not change abruptly. Within a
   beat only: the cut BETWEEN beats is a deliberate 128-deg hard cut.

Red transcripts (geometry: canonical seed 20260728, base `76224f91`):

    both bugs restored: head -0.659 m, frame 490  (reproduces the original -0.676)
    frame fix only reverted: head -0.147 m, frame 605
    eye re-solved per frame: trackside drift 0.000222 m (allowed 0.000001)
    aim alternating between two candidates: turn rate change 43.652 deg/frame^2 (allowed 1)

Green: drift 0.000000, turn-rate change 0.021, deepest +0.237.

## The jitter — measured in a real browser, and NOT reproduced by the harness

Fixed-dt stepping shows perfect smoothness, which is itself the finding: the
defect is dt-dependent. Real Chrome, built bundle, `vite preview`:

- frame pacing mid-ride is **good** — mean 7.31 ms, p50 6.1 ms;
- **67 of 70 stalls fall in the first 5.4 s** (park generation / lazy imports),
  several of 180-237 ms, and that window overlaps the start of the ride;
- only two ~59 ms stalls land inside the ride proper.

`MAX_FRAME_DELTA` is **1/12 s (83 ms)**, so a 59 ms frame passes through
unclamped: `ride.distance += 6.5 * 0.059` moves her **0.38 m in one frame**
against 0.04 m normally — a ~10x jump, and the trackside camera aims at her
every frame, so the shot snaps with her. The 237 ms generation stalls clamp to
83 ms, which is still a 0.54 m jump.

`damp` is a proper exponential half-life (`2^(-dt/halfLife)`), so it is
frame-rate independent and is **not** a continuous-jitter source. Ruled out.

**Jim rode a preview built before #670** (park solve 1538 s -> 299.7 s), which
is why his load was slow — so he got the generation stalls at their worst,
overlapping the opening beats. This branch is now rebased onto a base that
includes #670.

**Still unproven:** whether that fully accounts for what he saw. The honest next
step is for him to ride a fresh preview of this branch and say whether it is
better. If it is still juddery, the fix is to clamp `dt` far tighter for a ride
that integrates distance, or to integrate the ride on a fixed step.

## State

- rebased onto `76224f91`; `test:procgen` 55 failures — **identical to the
  pre-existing baseline**, none added; trackside extents unchanged, confirming
  the trough geometry did not move.
- `check:slide-rider` green with both new clauses.
- Browser page closed, preview server killed by PID, port 5419 free.
