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

Bush loop now runs a fixed budget of **1400** with no target count — see the
counts table below for why 1400 and not the 1050 first tried.

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

All five seeds, before -> after. `BUSH_BUDGET` is 1400, set so the **worst**
seed clears the 108 every seed used to plant, not so the canonical seed
happens to match it (1050 did that and quietly stripped seed 2 to 86).

| seed | trees | bushes | walls |
|---|---|---|---|
| 20260728 | 27 -> 28 | 108 -> 149 | 4 -> 4 |
| 2 | 30 -> 28 | 108 -> 128 | 3 -> 4 |
| 5 | 26 -> 27 | 108 -> 137 | 5 -> 6 |
| 11 | 28 -> 30 | 108 -> 142 | 5 -> 5 |
| 18 | 26 -> 26 | 108 -> 140 | 6 -> 6 |

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

The conclusion stands: **#216 needs no RNG work at all.** The numbers in this
section were taken on `main` and on this branch, where the ring is still in its
old place. They were superseded by measuring on #216's own branch — see the
next section, which is the one to act on.

## #216: how far the band change actually gets (measured on its own branch)

Measured on `feat/railrace-ring-boundary` itself, not on main. Baseline there:
`check:park` clean, `railRaceStallStandsAtTheRim` red.

The invariant is **relational**: the stall must be the *closest plot of all* to
the built ring. It sits 43.1 m out while `waterFight` is 34.0 m, so it needs to
come ~9 m closer — a change of **bearing**, not just radius. Bearing 20 (where
it is pinned) never beats 34.0 m at any legal radius.

Hard ceiling nobody had noted: `PLOT_EXTENT_LIMIT` 52 minus the stall's 3.4 m
bounding radius caps it at **r = 48.6**, whatever the band says.

Exhaustive enumeration of every position that satisfies the rim test and is
legal: **372 spots**, in three clusters (bearings 4-12, 103-104, 266-288).
What blocks the rest: gate corridor 3050, waterFight 2792, building 2337,
dodgems 1929, ferrisWheel 1373, ballPit 187.

Best combination found — band 42 -> 49, pin `[44.1660, 6.2071]` (bearing 8,
r = 44.6), **plus** a fix to `ferrisKiosk()` pushing its stand outside the
wheel's own bounding circle:

- `railRaceStallStandsAtTheRim` **green** on the canonical seed (19/19)
- the stranded waypoint (20.9, 20.2) **gone** — the ferris fix clears it
- `rail.walkable` back within its recorded 30
- residual: **`rail.exclusion` 22 vs recorded 21** — 1 m of a 362 m loop.
  Identical at bearings 8, 9, 11 and 12, so it is not positional.

**And the blocker that kills the whole approach: a fixed pin cannot satisfy a
relational invariant across seeds.** The full sweep fails on **2 of 5 seeds**
(seed 18: stall 40.7 m, but `ferrisWheel` 33.3 m). The ring and the rival plots
move per seed while the pin does not.

So #216 cannot be closed by a band change. What it actually needs is for the
stall to be **placed by relation to the ring** (solver-side, like
`ferrisKiosk`'s relation to the wheel) rather than pinned — then it is the
closest plot on every seed by construction. Two further things fall out of the
work regardless, both worth doing on their own:

1. `ferrisKiosk()` returns a stand **2.3 m inside the ferris wheel's own
   bounding radius** (`stallPlacement.ts`: 5 m tangentially from an entrance
   that is itself inset). That is the latent cause of the (20.9, 20.2)
   stranding, and pushing it clear fixes it.
2. `railRaceStallStandsAtTheRim` and `rail.exclusion` are in mild tension: the
   booth can only be closest to the ring by standing near the railway, which
   interrupts its flanking walls.

Nothing was pushed to `feat/railrace-ring-boundary` — it is not green, and the
1 m `rail.exclusion` overrun would have meant re-recording a guard, which is
not mine to do.

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
