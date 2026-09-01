# HANDOFF — two tables, free places, and a table for the pets (#449)

Branch `feat/banquet-seats`, cut from **`origin/feat/great-hall-banquet`** (PR #422),
**not** `main`. Worktree `.claude/worktrees/banquet-seats`. Dev port **5509**.
PR goes against `feat/great-hall-banquet`.

> Jim, on #422's preview: *"Great hall only has one table and no free spaces for
> the player to sit. Make it two big tables, with a few spaces and the action to
> sit and eat on the blank spaces. There should also be a small pets table for
> the pets to eat at, and they go there when the player sits."*

**All four asks are built, played and screenshotted.** What is left is the PR
body, and whatever review asks for.

## The deep link is `/castle?deck=1`, not `?deck=0`

The brief says 0. The hall is `HALL_DECK = CASTLE_HALL.index` = **1** since the
floor split; deck 0 is the mall. `main.ts`'s own doc comment for the link is
stale for the same reason. `/castle?deck=1&at=3.8,-7.6` lands her standing at a
blank place with the Sit chip up — that is the URL to hand anyone.

## What was built

| ask | where |
|---|---|
| two big tables | `castleFurniture.ts` — `FEAST_ROW_OFFSET`, `FEAST_ROWS_SHIFT`, `feastRowAxes` |
| free places | `GreatHallSeat.free`, `FREE_PLACE_STRIDE/SIDE/ROW`; `greatHallBanquet.ts` skips them |
| sit and eat | `interactZones.ts` banquet zones; `Building.sitAtFeast/eatAtFeast/leaveFeast` |
| pets go to their table | `ParadeMember.goToTable/leaveTable`, `Parade.sendPetsToTable`, `Building.petParade` |

32 places, **3 free**, **29 children** seated. Pets' table at floor-local
(1.8, −3.8) with 4 places and a bowl at each.

## The numbers that are pinned, and by what

Do not move these without re-reading why:

- `FEAST_ROW_OFFSET = 3.3`, `FEAST_ROWS_SHIFT = −0.55`. The **east run's
  southernmost bench** reaches the lift lobby's keep-out `(19.21, 5) r4`, and
  `check:castle` wants any prop 4.62 m from its centre. Wider or less-shifted
  fails; further west and the west run walks into the roundel's disc.
- `FEAST_TABLE_COUNT = 2` per run. Three per run puts the **west** run's south
  bench inside `(0, 11.556) r7`.
- Free places are on the **west run only** (`FREE_PLACE_ROW = 0`) because a run
  is 12 m long and there is one pets' table. From the east run the nearest pet
  measured 12.0 m and walked off the bottom of the frame.
- `PET_TABLE_FROM_ROW = 5.0` — in shot from the seat *and* clear of the free
  places' own stand spots.

## Two things found by looking, not by reasoning

1. **The pets' table at the mouth of the aisle was 12 m from the nearest free
   place.** Clear floor, tidy, and on screen the cat simply walked out of the
   picture. Moved alongside the banquet; now 6.4 m at worst.
2. **`check:castle`'s new assertion 11 was appended after the block that
   reports failures and exits**, so its four fails were computed and thrown
   away while it printed a green line about a hall it had just rejected. Moved
   above the report; its OK line is now conditional on its own clauses.

Two of its clauses also had to be rewritten because they compared the scene
against the very function that built it — a mutation moved both sides together
and sailed through green. The run count now comes from the ticket (two), and
the bowl clause asks whether a pet can *reach* a bowl rather than counting a
list against itself. **All five clauses proved red by mutation and reverted.**

## Round two — Jim's #453 feedback (done)

> *"Banquet tables have green bench things clipping into them … Clear out other
> 'stuff' from the middle of the room … have as many tables as is needed to fill
> the space."*

- **The hall gets no `dressDeck` furniture** (`deckIsFurnished`) — no benches,
  no roundel, no planters — and no roundel **rug** (`castleDecor`).
- **Two dead keep-outs removed on the hall**: the roundel's and the front
  door's. Neither thing exists on that storey. They were most of "shoved into
  one end".
- **Everything derived**: 5 runs (east-most on the throne axis as the high
  table, then west at `FEAST_ROW_PITCH` until 2 m from the wall), 3 tables per
  run (south until 3 m from the wall). **120 places, 117 children.**
- **`scatterKeepOutsFor`** = `keepOutsFor` + `greatHallFootprint`. Braziers and
  corner clutter ask it; **wall anchors must not** (the banquet is derived from
  them — cycle).
- Blank places count back from the **south end** of run 0; the pets' table is in
  the clear band at the south wall beside them.
- Companions joining the line mid-meal now go to the table too (re-asserted
  each frame while seated).

## Gates

- `check:castle` green, including the new `places` assertion.
- `pnpm run check` exit 0, `build` exit 0, `test:procgen` 482 passed.
- **Run `check` on a quiet machine.** `check:park-boot` failed once at 36.8 ms
  against a 24 ms ceiling with **zero work units in the slice** — the box was
  running a dev server and a rendering browser page. Three consecutive passes at
  15.6–16.9 ms with those killed. Kill your dev server before the final gate.

## Known, and not mine

The seated chip row shows **`R` twice** — "Warm bread R" and "Leave the feast
R". The hotel breakfast room offers the same four chips (three foods plus a
leave) and does the same thing, so this is the chip row's key assignment, not
the banquet's. Worth its own issue.

---

# Round three — #453: "you can walk straight through the tables"

> Jim, having walked the hall on #453: *"Banquet hall looks good but you can
> walk straight through the tables — they should be solid."*

## The prohibition is stale. Measured, not reasoned — `scripts/probe-height-blind.mts`

The rule in `dressing.ts`, `castleFurniture.ts`, `castleDecor.ts`, `Toilets.ts`
and `layout.ts` is *"castle props get no colliders at all, because indoor
collision is height-blind."* That one sentence hides **two** facts, and the
prohibition only follows if both hold:

**A. the collision world is 2-D — a collider blocks at every height.**
**B. two floors share an (x, z), so A reaches across storeys.**

The probe walks a player-sized body at a collider from 3 m out, at eight
heights, and then sweeps every floor's whole plate against that same collider.

```
A. one circular collider, radius 1.0, at the great hall's centre.

   topHeight = Infinity (the default every castle prop would get)
     y = 0 / 0.5 / 1 / 1.3 / 4 / 8 / 20 / 100   ended -1.62 m past its centre  BLOCKED (all)

   topIsAbsolute, top = 0.675 m (a feast table, hotel/place.ts style)
     y = 0, 0.5                                 BLOCKED
     y = 1, 1.3, 4, 8, 20, 100                  walked through

B. that same hall collider, swept against every floor's whole plate
   castle.mall   origin x=600      0/21250 plate points blocked  nearest approach 279.0 m
   castle.hall   origin x=900    133/21250 plate points blocked  nearest approach   0.1 m
   castle.roof   origin x=1200      0/21250 plate points blocked  nearest approach 278.8 m
   garden/park   160x160 m sweep: 0 points blocked

   plate half-extents 21.21 x 15.56 m, floors 300 m apart:
   nearest edge-to-edge gap 257.6 m.
```

**A still holds. B is dead.** An `Infinity`-top collider is still height-blind —
it blocks at y = 100 — so nothing about `CollisionWorld` changed. What changed is
that the great hall's plan is now **279 m** from the nearest point of any other
storey, so height-blindness has nothing left to reach: **0 of 21250** points on
the mall and **0 of 21250** on the roof are touched by a collider in the middle
of the hall, and the park is untouched too.

So the reasoning that forbade the colliders is genuinely spent, and **the fix is
the colliders**. Two consequences worth carrying:

1. The prohibition must be **corrected where it is written**, or the next person
   gets talked out of the right fix — `dressing.ts`, `castleFurniture.ts`,
   `castleDecor.ts`, `Toilets.ts`, `layout.ts`, `CLAUDE.md`.
2. `topIsAbsolute` (row two of A) is the *other* half of the answer, and it is
   the half that was never about floors at all: it is what lets a 0.675 m table
   be solid to feet on the flagstones and air to feet in a jump. Jim, 7 Aug:
   *"I should be able to jump onto any solid item that's not too high, here and
   elsewhere in the game."* `world/hotel/place.ts` is the shipped precedent.

## The numbers this lands on (all measured off the assets)

| | |
|---|---|
| bench half-width / half-length / seat top | 0.300 / 1.400 / 0.360 m |
| table half-width / half-length / top | 1.100 / 3.000 / 0.675 m |
| `BENCH_OFFSET` / `FEAST_AISLE` / `FEAST_ROW_PITCH` | 1.85 / 2.6 / 4.90 m |
| gap between a bench's inner face and the table | **0.450 m** |
| player collision diameter | **1.240 m** (`PLAYER_RADIUS` 0.62) |
| free places | 3, on run 0's **west** side; stand spots 0.85 m past the bench's outer face, reach 1.450 m (`SIT_PICK_RADIUS` is 1.6 — the stand spot may not move outward without moving that too) |

The 0.45 m bench-to-table gap **cannot be entered by a 1.24 m body at all**, so
registering table + benches as one rectangle per *run* invents no pocket a child
could ever have stood in — it only stops being able to walk through the run.
Benches along a run are 0.1–0.3 m apart, so a run is already a continuous line.

