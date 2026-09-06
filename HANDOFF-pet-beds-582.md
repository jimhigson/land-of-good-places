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

## Rebased onto `main` after #588, 6 Sep 2026

`origin/main` = `dd5b3b6b` ("The hotel suite's lounge and bathroom can be walked
into (#583) (#588)"), which touches **the same two files this branch does** —
`scripts/check-hotel.mts` and `src/world/hotel/Hotel.ts`. The rebase was clean,
which CLAUDE.md warns is the exact shape of a silent revert, so it was checked
rather than trusted: **all 330 lines #588 added to those two files are present
in the rebased tree** (249 in `check-hotel.mts`, 81 in `Hotel.ts`; each added
line grepped back out of the current file, 0 missing).

The `check` chain was compared as a **set**, not a count: 117 scripts on both
sides, nothing missing, nothing added, and `main`'s new `check:ground-claims`
step is present. This branch does not touch `package.json`.

## The parade cap is announced now, not silently truncating

`?pets=N` grants N and dresses N beds, but only **8** companions have a body in
the park at once, and `Parade.sendPetToBed` is a no-op for one with none. So
`?pets=12` builds twelve beds' worth of layout and at most eight animals walk
to them — which reads as a broken link rather than as a second system's limit.

That cap (`MAX_VISIBLE`, "more than this and the park disappears") is deliberate
design and predates this link, so it is **announced, not raised** — raising it
is a visible gameplay change and Jim's call. `grantDebugPets` now warns on the
console with the real numbers when more companions are owned than can walk.

The number moved to **`src/entities/parade/paradeCap.ts`**, a leaf module with
no imports, and `Parade` asks it for the value. Two reasons: CLAUDE.md's "one
owner; everyone else asks", and `main.ts` is the boot entry that lazy-loads
`Game` on purpose — a static import of `Parade` there would drag `three` and
the whole scene graph into the first chunk.

## Browser QA — re-watched on the rebased branch, 6 Sep 2026

Port 5417, `--strictPort`, killed by PID; pages closed as each was read.
Napped in the **west** bedroom (bedroom 0, capacity 2) every time, so the
overflow is forced. Phases read from `Parade.petBedPhase`, so "it reached a
bed" is measured rather than inferred.

| N | beds planned | shortfall | parade members | waiting | asleep | verdict |
|---|---|---|---|---|---|---|
| 1 | 1 | 0 | 1 | 0 | **1** | traced `climbing → climbing → asleep` |
| 5 | 5 | 0 | 5 | 0 | **5** | 2 in her room, 3 next door — all asleep |
| 12 | 10 | **2** | 8 | **4** | **6** | both limits, exactly as recorded below |

**N=5 is the case that answers Jim's question and it reads well** — the fixed
camera holds her room and the middle bedroom in one frame, so the three
overflow pets are plainly asleep next door. It reads as *my pets are next
door*, not *my pets have vanished*.

### At N=12 the bedless animals stack on one point — measured, after a wrong first reading

**Correcting a claim made earlier in this file's own history: they are not "on
her bed".** That came from reading a screenshot, and from a probe whose
`m.group ?? m.object ?? m.root` fallback silently resolved to the *player*, so
it reported her position as theirs. The tell was that the "pets'" coordinate
was byte-identical to `player.position`. Measured against `ParadeMember.root`,
which is the drawn body:

```
pet.bunny#5    (-613.2, 0, 1380)  phase null
toy.star#4     (-613.2, 0, 1380)  phase null
toy.biscuit#3  (-613.2, 0, 1380)  phase null   -- separation between them: 0.000 m
```

That point is exactly `player.position` — where she was standing when she got
into bed. A companion with no bed keeps following, and the follow target
collapses onto her once she stops moving, so **three animals interpenetrate at
one spot**, awake, while the other five sleep. `player.position` itself stays
at her pre-nap spot (the nap is a *ride pose*, not a move), which is why the
pile is 5.77 m from the bed she is actually lying in.

**This branch strictly improves it rather than causing it.** Under the old
napped-room-only rule a nap in bedroom 0 gave beds to 2 of the walkers, so 6
would have piled up; now 5 sleep and 3 pile. The stacking is the parade's
follow behaviour for a bedless companion, untouched here, and it is worth its
own issue.

**It is not a reason to hold the link back**: it needs N=12, which is above
both the bed capacity (10) and the parade cap (8) and is only reachable by
typing it. At N=5 — the value that answers Jim's question — every companion
gets a bed and nothing stacks.

**A bad value cannot break the boot**: `?pets=not-a-number` booted into the
suite normally, granted nothing, logged no error, and — correctly — printed no
cap warning either, since the link did nothing to warn about.

## Status
- [x] Worktree + `pnpm install --frozen-lockfile` (pnpm 12.1.0 running, confirmed)
- [x] Survey of pet/bed/hotel code
- [x] Implementation (option C)
- [x] Instrument with a built-in control; check proved red then green
- [ ] Gates: `check`, `test:procgen`, `build`, `check:coplanar`, `check:swept-bus`, `check:park-pool`
- [x] Browser watch at N=1, 5, 12 — watched, screenshotted, server killed by PID
- [ ] PR

## Browser QA — watched, 6 Sep 2026 (port 5391, killed by PID; pages closed)

`/hotel-suite?pets=N`, napping in the **west** bedroom (the capacity-2 one she
reaches first) each time. Pet phases sampled every 0.7 s from `petBedPhase`, so
"it walked and climbed in" is measured, not inferred.

| N | beds w/ mid | sent | in her room | in middle room | no bed | all asleep? |
|---|---|---|---|---|---|---|
| 1 | 1 | 1 | 1 | — | 0 | **yes** (climbing → asleep) |
| 5 | 5 | 5 | 2 | 3 | 0 | **yes** (all 5 climbing → asleep) |
| 12 | 10 | 10 | 2 | 8 | **2** | **no — only 6 asleep** |

**N=5 is the case that answers Jim's question, and it reads well.** The fixed
camera shows her room *and* the middle bedroom in one frame — the partition is
2.2 m and the camera is above it — so the three overflow pets are plainly
visible asleep next door. It reads as *my pets are next door*, not *my pets have
vanished*. That is a frame for Jim to judge, not my call.

### A second, pre-existing limit found at N=12 — NOT caused by this change

At 12 companions only **6** animals are actually asleep, though 10 were sent:

- 2 own no bed at all (middle bedroom holds 10) — the known, announced shortfall;
- and separately **the parade only walks 8 companions at once** —
  `paradeMemberCount` 8, `waitingCount` 4. `Parade.sendPetToBed` is a no-op for a
  uid with no body in the line, so those come back `petBedPhase === null`.

This is **not** something #582 introduced: `sendPetsToBed` could only ever reach
pets in the line, before and after. But it means "every pet asleep in a bed"
stops being literally true above ~8 companions for a *second* reason, in a
different system. Worth its own issue; deliberately not fixed here.

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

1. **The middle bedroom holds 10 as shipped.** The "12" in this row was a *hypothetical*
   model (anchoring the first row hard to the north wall) and it was **not built** —
   measured on the real park the middle bedroom holds **10**. Do not quote 12 as fact;
   see "The residual gap" above, which is the measured number.
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
