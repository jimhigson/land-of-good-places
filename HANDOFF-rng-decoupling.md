# HANDOFF — scenery RNG decoupling (E14-rng)

Branch: `fix/scenery-rng-decoupling`. Worktree: `.claude/worktrees/rng-decoupling`.
Port if needed: 5343. Issue context: blocks PR #216 (`railRaceStallStandsAtTheRim`)
and #117 (ride stalls must adjoin their rides).

## Root cause — corrected from the brief

The brief called this "a single shared RNG stream coupled to path length".
Measured, that is **not** the mechanism, and the difference decides the fix.

`paths.ts` draws **zero** random numbers (verified: no `Rng`, no `createRandom`,
no `Math.random`). Nothing is interleaved. The real coupling is
**rejection sampling with a variable draw count**:

```
const angle    = rng.range(0, TAU);      // draw 1
const distance = Math.sqrt(rng.unit()) * 54;  // draw 2
if (!isPlantable(x, z, 2.6)) continue;   // <-- REJECTED after 2 draws
const kind = pickTreeKind(rng);          // draw 3
...                                      // ACCEPTED costs 10-20 draws
```

`isPlantable` -> `isOnPath`. A longer spur paves more ground, so **one**
candidate flips accepted -> rejected, consumes 3 draws instead of 17, and every
later object on that stream lands somewhere else. That is the whole bug.

**Consequence: separate streams alone do not fix it.** The wall that landed
across the ferris kiosk was a *stone* run already on its own stream
(`0x57013e ^ PARK_SEED`). Splitting streams further would have shipped
green-looking and fixed nothing.

The three samplers with a variable draw count:

| Site | Draws if rejected | Draws if accepted |
|---|---|---|
| `Scenery.ts` trees (~425) | 2 or 3 | 10-20 |
| `Scenery.ts` bushes (~574) | 2 | 12-17 |
| `Scenery.ts` `generateWallMaze` (~1087) | 2 or 6 | 8 |

`generateStoneRuns` is already immune — it draws a fixed 5 per attempt with
`consider()` last, so candidate *k* is already a pure function of *k*. That is
the pattern to copy, and it is the accidental proof that the fix works.

Trees and bushes additionally **share** one stream (`new Rng(0xc0ffee)`, one
generator, bushes looping after trees), so any tree change also moved all 108
bush clumps.

## The fix

**Index-lock each sampler**: derive a per-candidate stream from
`(salt, PARK_SEED, attemptIndex)` so candidate *k*'s proposal is a pure function
of *k*. Rejecting *k-1* then cannot move *k*.

## Residual, stated honestly

Index-locking does not make the park immune to geometry. Two real cascades
remain, and both are *local* rather than global:

1. A candidate whose own footprint overlaps the changed path is still rejected
   — correctly. It vanishes; it does not relocate.
2. Sequential conflict state (`planted`, `cornerPoints`, `placed`) means a
   candidate that previously clashed with a now-rejected one can newly appear.
   Its position is still fixed by its index, so a wall can only appear at a
   spot that was already a legal maze spot.

So the provable property is: **an object far from the changed path does not
move.** Objects near it may appear or disappear. Do not claim more than that.

## Status

- [x] Worktree + `npm ci` (exit 0)
- [ ] Baseline procgen run recorded
- [ ] `candidateRng` helper
- [ ] Index-lock trees / bushes / wall maze
- [ ] Publish bushes -> `ParkFacts` -> new invariant (proven red first)
- [ ] Spur-lengthening knob + SHA-256 scatter digest experiment
- [ ] `npm run build`, `npm run test:procgen` exit 0
- [ ] PR raised (do NOT merge — Jim reviews tomorrow)

## Expect the canonical park to change

Decoupling re-rolls the scatter once. That is expected and must be called out
in the PR with before/after counts. Do **not** try to preserve the current
arrangement — that would recreate the coupling. Watch the tree floor: the
budget comment at `Scenery.ts:390-424` says seed 5 sits at 25-26 against a
floor of `> 24`, so there is about one tree of slack.
