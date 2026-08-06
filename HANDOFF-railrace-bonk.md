# HANDOFF — railrace-bonk (agent `e-railrace-bonk`)

Working branch `e/railrace-bonk`, pushed to **`chore/rail-race-pr-triage`** (PR #223).
`.claude/worktrees/pr-triage` belongs to another agent — never touch it.
My worktree: `.claude/worktrees/railrace-bonk`.

Jim rode the Rail Race and reported three things. **Bars only exist at level 3**
(`BARS_FROM_LEVEL = 3`) — any QA at level 1 or 2 will never see one.

## The three items

1. Rider faces away; the frown PR #223 adds is unobservable in normal play.
2. Her head passes through the duck bars like a ghost.
3. She slows down only *after* passing through the bar.

## Findings so far — 2 and 3 are NOT the same root cause

### Item 3 — ROOT CAUSE FOUND AND MEASURED

The duck-bar **geometry** is built at `spot.at` — the supporting trestle's
collision-nudged arc position (`track.ts`'s duck-bar loop, `const at = spot.at`)
— while `simulate.ts` fires the bonk at `bar.at`, the *un-nudged* scheduled
position from `planHazards`. Nothing reconciles them.

`track.ts`'s `MANDATORY_RADIAL_NUDGES` doc comment states the opposite in prose:

> "An arc nudge shifts `at` for the leg and the bar identically ... **so it costs
> nothing**: bar and leg stay exactly as coincident as they always were"

It costs nothing to *bar-vs-leg* alignment. It costs the whole hazard its
correctness, because the physics never learns about the nudge.

**Measured on the canonical seed (20260728), via a headless park build:**

| bar | scheduled `at` | built `at` | offset |
|-----|---------------:|-----------:|-------:|
| 0 | 60.52 | 58.52 | **−2.000** |
| 1 | 96.83 | 94.84 | −1.994 |
| 2 | 169.46 | 167.46 | −2.002 |
| 3 | 205.77 | 203.78 | −1.996 |
| 4 | 290.50 | 288.50 | −2.009 |
| 5 | 326.82 | 324.81 | −2.003 |
| 6 | 363.13 | 361.13 | −1.997 |

7 of 7 bars, every one ~2 m **early**. A never-ducking rider at 32.4 m/s crosses
the built bar 0 with speed *unchanged* and the bonk lands **2.52 m past it**.
That is Jim's "slow down only after passing through it", exactly.

(The arc-inversion used to measure this was round-tripped first: fed 60.52 →
recovered 60.518, err 1.8 mm. The 2 m is real, not measurement error.)

Every bar taking the *same* −2.00 m nudge is itself suspicious — see
`searchForClearGround`, which searches at the module constant `NOMINAL_RADIUS`
rather than the ring's own radius, so both rings search the same ground and the
walk-past ring's solid trestles (built first) may be systematically blocking the
race ring's slot. Not chased; the fix below makes it moot either way.

### Item 2 — a different cause: there is no collision volume at all

A bonk is a scalar test — `crossings[cursor] <= travelled && !ducking`. Nothing
anywhere compares bar height to head height. `hazards.ts` says so outright:
"a purely visual clearance (bonking is decided by button state at the moment of
crossing, not an actual pose/collision test)". `track.ts:661` has a stale comment
about "the thing you actually collide with" — no such thing exists.

Geometry, measured: rail top at bar 0 is y=11.02, `duckClearance` = 5.25 m, so the
bar sits at y=16.27. `hazards.ts` records her crown at rail+4.70 ducked and
rail+5.95 standing → **standing crown y≈16.97, i.e. 0.70 m above the bar centre**.
So a standing rider's head is *inside* the bar and nothing reacts.

## The fix, as planned

- **3:** make the physics read the bar positions that were actually *built* —
  `track.ts` reports each bar's real arch-relative distance, `RailRace` schedules
  the crossings from those. Measured fact beats authored claim; this is the
  repo's own `parkFacts.ts` philosophy. Offset becomes 0 by construction.
- **2:** the bar must visibly *knock her down* rather than pass through her, and
  the contact must be tested against the leading faces of head and bar, not
  origin-vs-centre.
- **1:** turn her towards the camera (head + a little shoulder), keeping the body
  reading as riding forwards. The rig is side-on and solved (`camera.ts`), so
  derive the turn from the live camera direction rather than a second constant.

## Status

- [x] Diagnosis for 1, 2, 3 — measured, not assumed
- [ ] Fixes
- [ ] Invariants (frown *visibility*; bonk *timing*), each proved red by mutation
- [ ] Build + test:procgen (bar: 132 passed / 0 skipped)
- [ ] Ridden in the browser

## Scratch

`scratch-bonk-probe.mts` at the worktree root is my measuring script (untracked;
delete before finishing). Run:
`node --experimental-transform-types --no-warnings --import ./scripts/ts-extension-resolver-register.mjs scratch-bonk-probe.mts`
