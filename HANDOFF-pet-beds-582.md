# HANDOFF — pet beds (#582)

**Branch** `feat/pet-beds-582`, worktree `.claude/worktrees/pet-beds-582`, based on `d80a3d4c`.

## The ask
Jim, 6 Sep 2026: the hotel bedroom needs **as many pet beds as the player has pets**.
Done = she sleeps, and every pet is asleep *in* a bed. Not a fixed larger number.

**Model: Opus 5 (1M context)**, chosen by the Overseer for this ticket. A replacement
must run the same model (CLAUDE.md, "A replacement runs the same model").

## The decision — Jim chose option C, 6 Sep 2026

Overflow pets sleep in the **middle bedroom**. Put to him with all four options and
their costs, including that C was rejected once on 18 Aug because she cannot see those
pets from the room she is in. **He picked it knowing that. Do not re-litigate it.**
The remaining duty is to *show* him what it looks like and let him keep it or change
his mind having seen it.

## What was built

- `Hotel.petBedsForNapIn(bedIndex)` — **the single owner** of "which bed does each
  companion go to for a nap here": its bed in that room, else its bed in the middle
  bedroom. `sendPetsToBed` acts on it, `petBedShortfall` counts what it could not
  place, `check:hotel` asks it directly, so the three cannot drift apart.
- `Hotel.petBedShortfall(bedIndex)` — how many companions get **no bed at all**.
  Exists to be non-zero out loud rather than passing quietly.
- `MIDDLE_BEDROOM_INDEX` in `layout.ts` — replaces a bare `1` in two files.
- `check:hotel` probe 3c, with its own control and a coverage announcement.

### Measured behaviour on the built park (control included)

The instrument computed the **old** rule (napped room only) beside the new one; they
differ, so it is not measuring a tautology.

| owns | room 0 old→new | room 1 old→new | room 2 old→new | shortfall |
|---|---|---|---|---|
| 1 | 1→1 | 1→1 | 1→1 | 0 |
| 2 | 2→2 | 2→2 | 2→2 | 0 |
| 3 | **2→3** | 3→3 | **2→3** | 0 |
| 7 | **2→7** | 7→7 | **2→7** | 0 |
| 12 | **2→10** | 10→10 | **2→10** | **2** |

No two companions are ever sent to the same bed (spot identity, as `Parade.petBedPhase`
compares it).

### The residual gap, reported not hidden

**The middle bedroom holds 10, not 12.** The "12" in my earlier note was from the
*hypothetical anchored* packing model, not shipped geometry — measured on the real park
it is 10. So a child owning 11+ companions still has animals with nowhere, in every
room. `petBedShortfall` and probe 3c's printed line both say so. Raising it is a layout
change, not a packing one, and **must not** be done via the 0.002 m north-strip trick.

### Red-run proof, with the geometry it was proved against

Mutation: `const chosen = here ?? overflow` → `const chosen = here` (the old
napped-room-only rule) in `Hotel.petBedsForNapIn`.
`pnpm run check:hotel` → **exit 1, 4 failures**, e.g.:

```
✗ a child owning 3 companion(s) who naps in bedroom 1 leaves 1 of them with no bed
  at all, though the middle bedroom holds 10 — issue #582 is not fixed for that room
✗ a child owning 10 companion(s) who naps in bedroom 1 leaves 8 of them with no bed
  at all, though the middle bedroom holds 10 — issue #582 is not fixed for that room
```

Proved against this geometry (if it moves, re-prove rather than trusting the above):
pet bed footprint r **0.774 m**, pitch **2.156 m**; `SUITE` halfX **14.8** halfZ **8**;
`SUITE_BED_SPOTS` `[[-10.7,-5.2],[-0.4,-5.2],[11.0,-5.2]]`; side capacity **2**,
middle capacity **10**; catalogue offers **12** `walksInParade` items.

## Status
- [x] Worktree + `pnpm install --frozen-lockfile` (pnpm 12.1.0 running, confirmed)
- [ ] Survey of pet/bed/hotel code (subagent running)
- [x] Implementation (option C)
- [x] Instrument with a built-in control; check proved red then green
- [ ] Gates: `check`, `test:procgen`, `build`, `check:coplanar`, `check:swept-bus`, `check:park-pool`
- [ ] Browser watch: 1 pet, several, maximum — pet must *reach and enter* a bed
- [ ] PR

## The three questions — all settled
1. **Max pet count 12** (catalogue); side bedrooms hold 2, middle 10. No floor space
   for 12 in a side room — reported, not silently capped.
2. **Layout** — settled by Jim choosing option C; no new bed arrangement was invented.
3. **Build time**, and not open: `Hotel.ts:4924` already decided it deliberately.

## Findings — the feature already exists; the bug is room capacity

**Most of #582 is already built** (issues #275 / #279 / the 18 + 23 Aug follow-ups).
`Hotel.dressPetBeds` (`src/world/hotel/Hotel.ts:4982`) already places
**one bed per companion, in all three bedrooms**, from `petBedSlots(count, bedIndex)`
(`src/world/hotel/layout.ts:1834`). The count is genuinely derived from the save —
nothing is hand-typed. So "make as many beds as the player has" is *already the code's
intent*; it fails only because the room runs out of floor.

### Measured (all numbers from the generator, none typed)

| bedroom | clear floor | pet-bed capacity |
|---|---|---|
| 0 (west, side) | 6.35 × 5.85 m | **2** |
| 1 (middle) | 14.80 × 5.85 m | **10** |
| 2 (east, side) | 7.15 × 5.85 m | **2** |

- Pet bed footprint radius **0.774 m** (diameter 1.548), tiling pitch **2.156 m** —
  both from `petBedFit.ts`, sized to the largest animal that lies in one.
- **`Hotel.enterSuite` drops her at local (−13.2, 0)**, so the first bedroom door she
  reaches (x = −10.4) is **bedroom 0 — the capacity-2 one**.
- `sendPetsToBed(bedIndex)` only sends pets whose bed is in the room she napped in.
  So a child with 3+ companions who naps in the room she walks to first watches
  **exactly 2** pets get into beds and the rest stand about. **That is #582.**

### The maximum pet count

**There is no ceiling in `store.ts`** — confirmed, and stated in the code's own docs.
The practical maximum is the catalogue: **12** distinct `walksInParade` items
(7 `pet` + 5 `toy`, including egg prizes; RiPika the starter is a `toy`).

### Does the bedroom have floor space for that many? — **No, and the sides cannot be tuned into it**

Modelled four packing rules against the real geometry:

| packing rule | side 0 | middle | side 2 |
|---|---|---|---|
| current (x-band keep-out) | 2 | 10 | 2 |
| keep-out made z-aware | 2 | 10 | 2 |
| z-aware + row anchored hard to the north wall | 4 | **12** | 4 |
| z-aware + anchored + 0.85× pitch | 5 | 18 | 6 |

Two things this says, and they decide the whole design:

1. **The middle bedroom already holds 12 — exactly the catalogue maximum** — once the
   first bed row is anchored to the north wall. The middle room is a complete answer.
2. **The side bedrooms top out at 4**, and only via a knife-edge. Row 0 clears the human
   bed in z by **0.002 m**; that is why "z-aware" alone gains nothing and a 0.1 m nudge
   flips capacity from 2 to 4. Not a mechanism to ship. The depth (5.85 m) fits only
   **2 rows** at a 2.156 m pitch whatever the margin does, and the human bed eats the
   middle of one of them. Holding 12 beds in 2 rows needs ~12.3 m of width; the side
   bedrooms have 6.35 and 7.15 m. **They physically cannot do it.**

This is the finding the ticket asked for rather than a silent cap.

### Question 3 is already answered by the code

Beds are placed **at build time** from the whole inventory, read once at construction —
deliberately, and documented at `Hotel.ts:4924`: a count that changed mid-visit would be
*"a bed that pops"*. Changing it to appear-on-acquire is a real change, not a gap.

### Open decision for Jim (do not decide alone)
Since the side rooms cannot hold her pets, "every pet in a bed" needs one of:
- **A.** the nap happens in the middle bedroom (holds all 12);
- **B.** the side bedrooms get wider — the suite's total width is fixed, so this takes
  it from the middle one;
- **C.** overflow pets sleep in the middle bedroom — rejected once already: she cannot
  see them from the room she is in, which was the exact 18 Aug 2026 bug;
- **D.** overflow pets curl up on the floor — but the ticket says *in* a bed.

### Also of note
`GAME_DESIGN.md:541` — the ferris gondola has **three** pet tub chairs, a separate
fixed number that does not follow the pet count. Out of scope here; worth an issue.

## Traps recorded in CLAUDE.md that apply here
- `topIsAbsolute` for knee-high props (`hotel/place.ts` is the precedent).
- A `CollisionWorld` rectangle is four walls round a hollow middle — a mover that gets
  inside is never pushed out. Beds must be unreachable-inside or genuinely leavable.
- `keepOutsFor` owns where she must be able to stand. Prove with a reachability
  instrument and **run a control on the instrument first**.
- `check:park-pool` builds all sixteen parks (#579); `check` + `test:procgen` can be
  green while a pool park is broken.
