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

### 1. Her arm clips through the mine cart — SEE BELOW, in progress

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

`scratch-levers.mts` (field sweep at any level via `RR_LEVEL`),
`scratch-arch-feet.mts`, `scratch-arch-legs.mts`. Sweep harness at
`/private/tmp/claude-501/.../scratchpad/sweep.sh`.

## Still needs eyes — no browser this session

Everything visual from rounds 5–8 is still unverified, plus round 9's:
the halved boost lean, and the rainbow's legs (especially whether the 3.7×
lopsidedness reads as "standing on a hill" or as a mistake).

## Issue #240 — checked, not fixed (as instructed)

See the note at the end of this file.
