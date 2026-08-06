# HANDOFF — scenery RNG decoupling (E14-rng)

Branch: `fix/scenery-rng-decoupling`. Worktree: `.claude/worktrees/rng-decoupling`.
Build and `test:procgen` both exit 0. Suite 127 -> 136 tests, 8 -> 9 files.

## Root cause — corrected from the brief

The brief called this "a single shared RNG stream coupled to path length". That
is not the mechanism, and the difference decides the fix.

`paths.ts` draws **zero** random numbers. Nothing is interleaved. The coupling
is **rejection sampling with a variable draw count**:

```
const angle    = rng.range(0, TAU);           // draw 1
const distance = Math.sqrt(rng.unit()) * 54;  // draw 2
if (!isPlantable(x, z, 2.6)) continue;        // REJECTED after 2 draws
const kind = pickTreeKind(rng);               // draw 3
...                                           // ACCEPTED costs 10-20 draws
```

A longer path refuses one candidate, that candidate costs 3 draws instead of
17, and everything later on the stream lands elsewhere.

**Separate streams alone would not have fixed it.** The wall that stranded the
ferris kiosk was a stone run already on its own stream. Splitting streams
further would have shipped green-looking and fixed nothing.

There was a **second, independent coupling** nobody had named: the bush loop ran
`while (bushCount < 108)`. Refuse one clump and the loop runs one attempt longer
and admits a tail candidate that was never in the park. Fill-to-N and locality
are incompatible; locality won.

## The fix

`candidateRng(salt, index)` in `mathUtils.ts`. Each candidate of each sampler
gets a stream derived from its own index, so candidate *k* is a pure function of
*k* and the seed. Applied to trees, bushes and the wall maze (`generateStoneRuns`
was already immune — fixed five draws per attempt, test last). Bushes moved to
their own salt; foliage salts now xor `PARK_SEED`, which they never did, so the
five CI seeds finally draw five different scatters instead of one.

Bush loop now runs a fixed budget of 1050 with no target count.

## Proof

`test/procgen/scatterDecoupling.test.ts` builds the park twice via
`scripts/scatter-digest.mts` (two processes — module-load constants need two
registries) and asserts nothing beyond 30 m of the perturbed spur moved.

- Reinstating the coupling fails it with changes **47-72 m** away, in a park
  55 m in radius.
- The perturbation is asserted to change the paths, so a no-op knob cannot pass
  it vacuously. **This caught a real mistake**: the first version of the test
  hook extended the ribbon backwards from its branch point onto already-paved
  ground and moved nothing on `origin/main` at 1, 2, 3, 4, 6, 8, 10, 14, 18 or
  24 m. Bowing the spur sideways between fixed endpoints does bite.
- A different seed is asserted to change the digest.

## Scatter counts (expected one-off reshuffle)

Canonical seed: trees 27 -> 28, bushes 108 -> 108, walls 4 -> 4.

| seed | trees | bushes | walls |
|---|---|---|---|
| 20260728 | 28 | 108 | 4 |
| 2 | 28 | 86 | 4 |
| 5 | 27 | 103 | 6 |
| 11 | 30 | 106 | 5 |
| 18 | 26 | 102 | 6 |

## IT DOES NOT FREE THE RAIL RACE BOOTH — read this before building on it

Swept 50 booth positions (bearings 4-40 deg x radii 36-42) on `origin/main` and
on this branch. **Identical on both**: 5 pass, 5 strand, 39 rejected by the
layout solver as illegal pins, 1 other. Same positions, same stranded waypoint
(20.9, 20.2).

The premise in the brief does not survive measurement. With the booth moved to
the stranding position, **nothing from `Scenery` is within 8 m of that
waypoint** — no wall, no tree, no bush — and the surroundings are byte-identical
in the working and the failing park. The waypoint sits **2.36 m inside the
ferris wheel's own plot boundary** and strands into a disconnected pocket of the
`garden` nav graph. There is no garden wall across a line of sight. The scatter
was never what blocked this booth.

What actually constrains it:

1. **The layout solver** rejects 39 of 50 positions outright — plot placement,
   not scenery.
2. **The manifest band** is `min 13, max 42`, so "the rim" past 42 m is not even
   expressible without editing it.
3. **The rail exclusion zone.** Widening the band to 60 and pushing out along
   the one working bearing (20 deg): r=42 PASS, r=44 PASS, r=46 and r=48 fail on
   `rail.exclusion`/`poi.stranded`, r=50 illegal. **Identical on both branches.**

So #216 gets 3 m of extra reach (41 -> 44) from a one-line band change, and
needs no RNG work at all. Whoever picks up #216/#117 should start at the
waypoint at (20.9, 20.2) inside the ferris wheel's plot, and at
`stallPlacement.ts`'s `ferrisKiosk`, which places that stand by relation to the
wheel rather than through the solver.

## What this PR is still worth

The coupling was real, is now measured, and is now guarded on every PR. It would
have bitten the next person to move anything — it just is not what is holding up
#216.

## Status

- [x] Index-lock trees / bushes / wall maze; own salt for bushes; seed-derived
- [x] Fixed bush budget (second coupling)
- [x] `Scenery.bushes` -> `ParkFacts.bushes` -> bush invariant, proven red
- [x] Two-park decoupling test, proven red both ways
- [x] `npm run build` exit 0, `npm run test:procgen` exit 0 (136 tests)
- [x] Booth sweep on both branches — negative result, documented above
- [ ] PR raised; **do not merge**, Jim reviews tomorrow

No dev server was started; nothing to visually QA beyond "the park still looks
like a park" — the scatter is one-off reshuffled by a tree.
