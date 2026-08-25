# HANDOFF — pet beds on a **real** save, and beds the animal fits in (PR #279, round 8)

Branch `petbed-real-default`, pushed to **`bedroom-size-pet-beds`** (PR #279).
Worktree `.claude/worktrees/petbed-real-default`. Read
`HANDOFF-petbed-conflict-fix.md` first — round 7 deleted the second pet body,
and that fix stands. This is a different bug that was hiding behind it.

## Bug 1 — on a real save the feature did nothing at all

`Hotel.ownedPets()` filtered the inventory on `kind === 'pet'`. **RiPika**, the
companion `defaultCharacterChoice()` grants every fresh character, is
catalogued `kind: 'toy'`. So on the default save every pet bed in every bedroom
was built with `uid: null`, `sendPetsToBed` skipped all of them, and the pet a
child watches follow her around stood there awake while she slept.

Reproduced live, pre-fix, in a real browser on an empty profile:

```
companions with a bed of their own, on a save nobody seeded:
FAIL: every pet bed was built with uid null — this is the shipped bug.
```

**Fix, per Jim (24 Aug 2026): *"if they follow the character they get a bed."***
`state/store.ts` now owns `walksInParade(kind)` — `PARADE_KINDS` minus
balloons. `Parade.isOut` asks it; `Hotel.ownedCompanions` asks it.
`Parade.sendPetToBed`/`petState` dropped their own `kind === 'pet'` tests:
membership of the line already *is* that question.

## Bug 2 — the beds were smaller than the animals in them

Measured, on the built park:

| | plan span, lying |
|---|---|
| `pet.puff` | 1.30 × **1.53 m** |
| `pet.mouse` | 1.06 × 1.52 |
| `pet.kitten` | 1.09 × 1.50 |
| `toy.ripika` | 1.12 × 1.49 |
| `pet.bunny` | 0.80 × 1.47 |
| the bed's bolster rim | 1.37 × **1.35** |

`PET_BED_PITCH` was 1.3 m, derived from the *bed's* 1.24 m footprint and never
from the animal. Two pets in neighbouring rows overlapped by **0.18 m**.

**Fix:** `world/hotel/petBedFit.ts` measures every catalogue companion in the
real sleeping pose and the real bed's own bolster/base, and derives everything
from that — scale **1.25×**, footprint radius **0.774 m**, pitch **2.156 m**,
cushion top **0.376 m**. `createPetBed(scale)` reports its own scaled numbers.
`BED_POSE_X/Y` and `sleepingBox` moved there, so the pose a bed is *sized* for
is literally the pose a companion *lies down* in.

Deliberate side effect: a bedroom holds fewer beds (10 middle, 2 each side,
from 27 and 3). A bed a pet fits in beats three it does not.

## check:hotel — the change that matters most

Probe 16b runs **twice**, and cast one is a real fresh save: `hydrate` to an
empty profile, then the game's own
`completeCharacterCreation(defaultCharacterChoice())`, nothing bought. Cast two
buys two pets so "its **own** bed" and "two asleep side by side" stay askable.
New: pairwise sleeper-vs-sleeper clearance, measured box against measured box;
`RIM_OVERHANG_ALLOWED` is now **0** (was 0.12 m of tolerated ear and tail);
probe 3b derives the bedroom's capacity instead of a hand-typed 27.

Proven red before trusted green:

| break | message |
|---|---|
| `ownedCompanions` → `kind === 'pet'` | `the RiPika has no bed at all in bedroom 0` |
| `sendPetToBed` → `kind === 'pet'` | `the RiPika spent only 0 frame(s) walking to its bed in bedroom 0` |
| pitch → the shipped 1.3 m | `the bunny and the kitten … overlap by 0.18 m` |
| bed → raw asset size | `the RiPika … sticks 0.09 m past its own bed's bolster in z` |

Green line: `9 companion naps across 2 casts × 3 bedrooms; beds built at 1.25×
(footprint r=0.77 m, pitch 2.16 m) for a longest sleeper of 1.53 m; tightest
bolster margin 0.08 m, closest two sleepers came 0.68 m.`

## Browser QA

`scripts/qa-petbed-fresh-save.mjs` — seeds **nothing**, opens `/hotel-suite`
with empty storage. Chrome for Testing 151.0.7922.34 (the latest
`playwright-core@1.62.1` ships), own dev server on 6141.

```
node scripts/qa-petbed-fresh-save.mjs <port> <outDir> [bedIndex] [camDx,camDy,camDz]
```

Measured on this branch: `toy.ripika#2` has a bed in all three bedrooms;
`visibility toggles=0 | frames not drawn=0/346 | models seen=toy.ripika |
phases=walking@0 -> climbing@4 -> asleep@15`; lowest point 0.376 m on a cushion
top of 0.376 m; no console errors. Two-pet run in a side bedroom: both asleep,
0 toggles each, no overlap.

Screenshots on `qa-screenshots` under `pr279-round8/`.

## Still open / worth knowing

- The pet bed's own goldfish toy sits on the floor at +X of the bed and is not
  part of the footprint the pitch clears; at 2.16 m pitch it no longer reaches
  a neighbour, but nothing asserts that.
- `Hotel.paradePetKind()` (the breakfast feast's decorative pet) still matches
  on `kind === 'pet'` and the species in the id. That is a different question —
  it needs a `PetKind` for `createPet` — and is deliberately untouched.
