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
