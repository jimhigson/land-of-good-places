# HANDOFF — issue #539: arm `check:hop-clearance`

Branch `fix/check-539`, worktree `.claude/worktrees/check-539`, based on `main` @ `807445af`.

## The finding, re-verified myself (not taken on trust)

- `scripts/measure-hop-clearance.mts`: `grep -c "process.exit\|exitCode\|throw "` = **0**. Confirmed.
- It is **step 6 of 61** in the required `check` chain (parsed from `package.json`, not grepped).
- Baseline run: **exit 0**, ~**1 s**, prints
  `Worst clean crossing over the park's own wall thicknesses: 1.045 m`
  against `MAX_AUTO_HOP_HEIGHT = 1.00` — the 45 mm margin the issue names, enforced by nothing.
- Cost is ~1 s, so arming it spends no meaningful CI margin (cf. #530).

## Geometry the measurement rests on (paste this with any red-run transcript)

`PLAYER_RADIUS = 0.62` (`src/core/constants.ts:112`);
`JUMP_SPEED = 6.6`, `GRAVITY = 17` (`scripts/playerSim.mts:55-56`) → `JUMP_APEX_HEIGHT = 1.2812`;
`MEASURED_HOP_APEX = 1.2812`, `MAX_AUTO_HOP_HEIGHT = 1.0`,
`measuredHopCeiling(c) = 1.574 - 0.3c` (`src/world/Collision.ts:197,206,224`).

Sweep: halfThickness {0.15,0.22,0.28,0.34,0.45,0.6} x fps {20,30,60,90,120} x {walk,sprint} x
angle {0,20,40} = **180 rows**, 30 per thickness (verified by row count).

Per-thickness minimum of the `clean` column on `main` @ `807445af`, vs the fitted line
(`crossing = 2*(half + PLAYER_RADIUS)`):

```
half=0.15 crossing=1.54 measuredMin=1.112 fittedCeiling=1.112 margin=+0.0000
half=0.22 crossing=1.68 measuredMin=1.100 fittedCeiling=1.070 margin=+0.0300
half=0.28 crossing=1.80 measuredMin=1.045 fittedCeiling=1.034 margin=+0.0110
half=0.34 crossing=1.92 measuredMin=1.045 fittedCeiling=0.998 margin=+0.0470
half=0.45 crossing=2.14 measuredMin=0.975 fittedCeiling=0.932 margin=+0.0430
half=0.60 crossing=2.44 measuredMin=0.879 fittedCeiling=0.842 margin=+0.0370
```

Controls run on that instrument (an earlier awk gave `0.000` everywhere — auto-created array
element — and was caught only by the control): independent `sort -n` per thickness agrees at both
ends (0.15 -> 1.112, 0.60 -> 0.879), and the three worked examples in `measuredHopCeiling`'s own
docstring (1.54/1.112, 1.92/1.045, 2.44/0.879) reproduce exactly.

**The margin at half=0.15 reads +0.0000 above only because that table is computed from the
printed 3 dp values.** Measured at full precision it is **-0.4 mm** — the fitted line sits
fractionally *above* the measurement there. That is less than one 1 mm bisection step, so it is
the instrument's quantisation and not a fact about the jump; see "One thing the first armed run
got wrong" below. Consequence either way: the lower-bound assertion is compared at
`BISECTION_RESOLUTION`, and any *added* safety margin would fail today's park for a number nobody
can justify.

## What is being asserted, and why each threshold comes from the game

A. every measured cell is finite — `highest()` returns `NaN` on failure and `Math.min(x, NaN)` is
   `NaN` silently (the issue's point).
B. `|JUMP_APEX_HEIGHT - MEASURED_HOP_APEX| <= 0.001` — tolerance copied from the game's own boot
   check `checkHoppableColliders` (`Collision.ts:1093`), not invented.
C. `measuredHopCeiling(crossing) <= measured clean` at every swept point — this is the docstring's
   own claim ("a straight line fitted *underneath* every measured point... a lower bound on the
   truth everywhere") and it is the **correctness precondition of the boot check**: if the fitted
   line ever rises above the truth, `checkHoppableColliders` passes a wall that in fact strands her.
   Currently that claim is a comment, i.e. two definitions kept in step by hand.
D. `MAX_AUTO_HOP_HEIGHT <= worstClean` over the thicknesses the park really uses.

## Model

Opus 5 (1M context), chosen by the Overseer brief that dispatched this ticket. A replacement
runs the same model.

## Proved red — five mutations, each asserted to have landed before the result was believed

Geometry these were proved against is the block above (`PLAYER_RADIUS 0.62`, `JUMP_SPEED 6.6`,
`GRAVITY 17`, `MEASURED_HOP_APEX 1.2812`, `MAX_AUTO_HOP_HEIGHT 1.0`,
`measuredHopCeiling(c) = 1.574 - 0.3c`, park thicknesses {0.22, 0.32, 0.34}), on
`fix/check-539` at the armed commit. Every mutation was reverted with `git checkout --` and the
tree confirmed clean by `git status --porcelain` after each.

| # | mutation | exit | what it said |
|---|---|---|---|
| M1 | `MAX_AUTO_HOP_HEIGHT` 1.0 -> 1.1 | **1** | 1 problem: "is 1.100 m but the worst clean crossing ... is 1.045 m — the router plans hops by 0.055 m more than the jump delivers" |
| M2 | `measuredHopCeiling` intercept 1.574 -> 1.65 | **1** | 32 problems, e.g. "promises 1.188 m but the flight only cleanly carried her over 1.112 m ... above the measurement by 0.076 m" |
| M3 | `MEASURED_HOP_APEX` 1.2812 -> 1.2 | **1** | 1 problem: "the jump apex is now 1.2812 m but ... says 1.2000 m (difference 0.0812 m > 0.001 m)" |
| M5 | `JUMP_SPEED` 6.6 -> 6.0 (a realistic retune) | **1** | 174 problems: apex complaint **plus** the lower bound failing everywhere, e.g. "promises 1.112 m but ... 0.937 m" |
| M4c | `while (time < 20)` -> `while (time < 0)` (every attempt stuck) | **1** | 421 problems: 420 "clean is NaN, not a number" + "the worst clean crossing came out NaN, so nothing below was measured" |

No message contains `NaN` or `Infinity` as a *number in the complaint* except M4c, where NaN is
precisely the thing being reported.

### Two failed mutations, kept because they are the useful part

- **M4 (first attempt): release gate `face + 0.05` -> `face + 50`. Exit 0, output byte-identical
  to the clean run.** This looked like a dead NaN assertion. It is not: after clearing the wall she
  keeps walking +z and still passes z=50 inside the 20 s budget, so every outcome is unchanged.
  A mutation that lands in the file and changes nothing is a vacuous green — the reason each
  mutation here asserts its own match count *and* the output is compared, not just the exit code.
- **M4b: `hopProbe` disabled. Exit 1, 211 problems — but measured 0.150 m, not NaN.** She steps
  over a 15 cm kerb without hopping, so the NaN branch still was not reached. Only M4c reaches it.

### One thing the first armed run got wrong, worth not repeating

The first armed run **failed** (exit 1) on `half=0.15` with "above the measurement by 0.000 m".
The cause is that `highest()` bisects to 1 mm and returns `lo`, so a measurement understates the
truth by up to a step; at 0.15 the fitted line sits **0.4 mm above** the measurement, both reading
1.112 m. The fix is to compare at the instrument's own resolution (`BISECTION_RESOLUTION`, now
shared with the bisection loop). Note the first diagnosis written down was "a float difference of
1e-16" — that was wrong, and the docstring was corrected to the measured 0.4 mm.

## Open question being resolved

**Resolved.** The park's hoppable (`autoHoppable: true`) walls are exactly three, half-thickness
**{0.22 (`Scenery.ts:2154`, wood), 0.32 (`Fountain.ts:365`, fountain rim), 0.34
(`Scenery.ts:2249`, stone)}**. Every other `addWall`/`addRectangle` in `src/` leaves
`autoHoppable` false — including the 0.45 garden boundary, the 0.18 fences and the 0.15
balustrade — so the excluded 0.60 rows were correctly excluded and D is **not** red.

But the window was still wrong twice over: it **never sampled 0.32 at all**, so the headline
interpolated over the fountain rim; and it was a pair of magic numbers with no link to a source of
truth, so widening a hoppable wall past 0.4 would have dropped it out of the headline silently.
Fixed by giving the three literals a single owner, `HOPPABLE_WALL_HALF_THICKNESSES` in
`src/core/constants.ts`, which the sweep now derives its set from. Measuring 0.32 directly changed
nothing (its minimum is 1.045 m, the same as 0.34's) — the headline is still 1.045 m.

## Status

- [x] finding re-verified, baseline captured, geometry recorded
- [x] assertions implemented (4), thresholds all taken from the game
- [x] hoppable wall thicknesses given a single owner; 0.32 now measured (180 -> 210 rows)
- [x] proved red x5, each mutation asserted to have landed; two failed mutations documented
- [x] `build` 0, `test:procgen` 0 (21 files, 752 tests), `check:coplanar` 0, `check:swept-bus` 0
- [ ] `check` (61 steps) — running
- [ ] PR opened

## Cost

Armed run **822 ms** vs **833 ms** toothless, despite 30 extra rows. No CI margin spent, so #530
is untouched.
