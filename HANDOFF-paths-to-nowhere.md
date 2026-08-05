# HANDOFF — paths to nowhere (issue #114)

Branch `fix/paths-to-nowhere`, worktree `.claude/worktrees/paths-to-nowhere`, dev port **5310**.

Spec: `REQUIREMENTS-2026-07-28.md` §5. Ruling: the path network derives from a
graph of places-to-visit only — the entrance **and** exit of every ride and
building are nodes — and no paved ribbon may terminate anywhere but a node.

## Root cause (found 5 Aug, measured on all five seeds)

**Every stall's paved spur ends 3.4–6.9 m short of the counter the child
actually walks to.** It is not a rounding error and it is not seed-dependent:
it is structural, and it is the family-reported "paths that lead nowhere".

There are **two different points per stall** and the path generator picks the
wrong one:

| point | where | who uses it |
|---|---|---|
| `PlacedEntry.entranceX/entranceZ` | plot edge + `standOff` 1.4, on the bearing **toward the park middle** (`parkLayout.ts:204`) | **only** `paths.ts:372`, the stall spur |
| `STALL_STANDS` | `position + (sin, cos)(facing) * STALL_STAND_DISTANCE` 3.1, i.e. **in front of the counter** (`stallPlacement.ts:103-109`) | the interact zone (`stalls.ts`), `poiGraph`, `LampPosts`, and `parkFacts.entrances` |

Those are different bearings, so the ribbon stops in the grass on one side of
the booth while the counter is round the other side. Measured gaps (canonical
seed 20260728, and the same to within centimetres on seeds 2/5/11/18):

```
railRacer    spur ends (34.8, 12.7)   counter (39.3, 17.0)   gap 6.31 m
skyCruiser   spur ends (-29.9, -5.6)  counter (-33.0, -3.4)  gap 3.81 m
spookyHouse  spur ends (-10.1, 1.8)   counter (-13.2, 5.5)   gap 4.84 m
waterFight   spur ends (12.9, -8.9)   counter (16.9, -8.1)   gap 4.05 m
dodgems      spur ends (-5.5, 21.0)   counter (-5.8, 27.9)   gap 6.89 m
```

Ribbon half-width is 1.3 m, so that is 2.1–5.6 m of bare grass between the end
of the paving and the place the game wants you to stand.

**Second defect, the converse:** the ferris-wheel kiosk (`spaceFerrisWheel`)
has **no `PATH_GRAPH` node at all**. `paths.ts:370` iterates `PARK_LAYOUT`
entries whose id starts `stall.`, and the kiosk is placed by relation
(`stallPlacement.ts:66` `ferrisKiosk()`) rather than by the layout solver, so
it has no `stall.` entry and the loop never sees it. It has been relying on
happening to sit near the `ferrisWheel` anchor spur.

## Fix shape

Drive the stall loop off `STALL_STANDS` instead of off `PARK_LAYOUT`'s
`stall.` entries. That is one loop replacing one loop and it fixes both
defects at once: the node lands on the counter (the real destination, the one
every other system already agrees on), and the kiosk gets a node because it is
in `STALL_STANDS`.

No import cycle: `stallPlacement.ts` imports only `anchors` and `parkLayout`,
neither of which imports `paths.ts`.

The stand is a destination in itself, so it takes the ride-exit case —
`toward === (ex, ez)`, no past-the-doormat extension. (Walking "past" a
counter would walk into the booth.)

Note `PlacedEntry.entranceX/entranceZ` then has **no remaining consumer** for
stalls; `anchors.ts:69` still uses it for anchor entrances, which is correct
and unchanged.

## Invariants (two, and you need both)

In `test/procgen/invariants.ts`, measured off the **drawn** Catmull-Rom curve
rather than the control points — `paths.ts` picks a spur's junction by walking
the control *polygon*, which the drawn curve bows away from.

1. `no paved path stops anywhere but a destination` — both ends of every
   non-backbone paved edge. The far end must reach the node its edge names;
   the near end must land on other paving (`'ring'` is the network, not a
   node). The closed backbone is exempt: it has no ends.
2. `every place a child can be served is a node in the path graph` — the
   converse, over `facts.entrances`, which is built from the coordinates the
   *game* uses.

**Why both.** Reverting the fix does **not** trip invariant 1. The old code
put the *node* at the doormat too, so the ribbon did arrive at its own named
node — the graph was self-consistent and merely pointed at the wrong place.
Only invariant 2 catches that. Anyone tempted to drop one of these should read
this paragraph twice.

Epsilon is game-derived: `ARRIVAL = 2 * PLAYER_RADIUS` (1.24 m), a child's
width — the same derivation `WALKABLE_GAP` uses. Not `paths.ts`'s own 4 m
"already served" threshold and not any route width it draws with.

Structural note: the past-the-doormat extension can never exceed **0.4 m**.
`pastReach = min(2, l - edge - PAST_CLEARANCE)` with `l = edge + standOff`
collapses to `min(2, 1.4 - 1)` for anything with a footprint. That is why
1.24 m is comfortable and still tight enough to catch a 3.4 m miss.

## Proof the invariants have teeth

An invariant that has never failed has only been run. All three code paths were
made to go red deliberately, then restored:

| break | result |
|---|---|
| stall loop reverted to pre-fix | invariant 2 red on **5/5 seeds** (`Tests 5 failed \| 90 passed`) |
| station spur stops at the approach | invariant 1 red on **5/5 seeds**, "stops 3.50 m short of 'station-0'" |
| `nearestNetworkPoint` offset 6 m | invariant 1's junction branch red, "branches off nothing" |

Both use `expect(...)` internally — house style here, and the only thing that
works: `type Invariant = (facts) => void`, so a returned complaints array is
silently discarded and the invariant passes while proving nothing.

## Known, deliberately out of scope

Three nodes sit slightly **off** the paving rather than on it, because
`paths.ts` marks a spur `paved: false` when the node is within 4 m of the
network *centre line* — up to ~2.7 m of grass once half the ribbon width is
taken off. Measured on the canonical seed after the fix: `ferrisWheel` 0.67 m,
`exit-ferrisWheel` 1.90 m, `exit-skyCruiser` 2.23 m. `exit-skyCruiser` was on
the paving before this change and is now off it, because the new face-paint
spur passes within 4 m of it and suppressed its own.

This is a *destination a step off the kerb*, not a ribbon ending in a field, so
it is not the reported bug, and all three remain standable and reachable
(`rideExitsAreUsable` is green). Fixing it means making the `already` test
measure the paved surface instead of the centre line, which changes which
edges get paved and so perturbs lamp and waypoint placement — not something to
do in the change that three other issues rebase onto. **Flagged to the
Overseer as a follow-up.**

## Status

- [x] Audit done, root cause measured on five seeds
- [x] Fix in `paths.ts` (+ `stallPlacement.ts`, `FacePaintStall.ts`)
- [x] Invariants in `test/procgen/invariants.ts` (+ facts in `parkFacts.ts`)
- [x] Proven red on all five seeds before being trusted
- [x] `npm run build` and `npm run test:procgen` green, exit code checked

## Gotchas for whoever picks this up

- A fresh worktree has **no `node_modules`** — `npm ci` before `npm run
  test:procgen`, or vitest is simply not found (exit 127).
- `tsconfig.json` includes only `src`, so **`tsc --noEmit` does not typecheck
  `test/`**. A missing import in an invariant surfaces only when vitest runs
  it. Caught exactly that way here.
