# HANDOFF — castle floors, half the area (#403)

Branch `feat/castle-floors-half-area`, worktree `.claude/worktrees/castle-shrink`.
Dev server port **5404** (`--strictPort`), killed by PID when done.

**Status: complete, PR open, all gates green.** This file is the record of what
was found, because most of it is not visible in the diff.

## The ask

Jim, 30 Aug: *"The floors inside the castle are still too sparse. Make them half
their current size to increase the feature density."*

Clarified: **half the AREA**, not half each dimension. He was asked directly and
declined halving the linear dimension, which would have quartered the area.

## The numbers

`INTERIOR_PLATE_SHRINK = Math.SQRT1_2` in `src/core/constants.ts`.

| | before | after |
|---|---|---|
| plate | 60.00 x 44.00 m | **42.43 x 31.11 m** |
| area | 2640 m² | **1323 m²** (0.501x) |

Measured off the built scene by `check:shop-spacing`, which prints the plate it
computed, and confirmed by `check:castle` building 4 flagstoned decks.

## The one-line summary for a reviewer

Halving the area does **not** fit the castle's existing floor plan. Six things
had to be re-placed, and the reason is always the same: the plate shrank and the
furniture did not, so every clearance that used to be comfortable is now binding.
None of them were made to fit by relaxing a threshold.

## Every hard-coded position the resize exposed

These all typed an absolute interior-local coordinate instead of deriving one.
Each is a place a future resize will hit again.

1. `STAIRWELL` and `stairFlights` typed the same four numbers twice. Now both
   come off `STAIR_AXIS_X` / `STAIR_AXIS_Z`.
2. `ESCALATOR_WELL` and `escalatorRamp`, the same pairing.
3. `HELTER_ENTRY_X = 15.4` against a shaft edge at 16.5 — a 1.1 m gap held by
   arithmetic written down nowhere. Now `HELTER_SHAFT.minX - 1.1`.
4. `STAIR_STAND_Z = 5.2` against a flight ending at 3.3, likewise.
5. `TOILET_STAND/PAN/BASIN` — three absolute points inside a fourth absolute
   rectangle. Now offsets from the room's own centre.
6. `BRAZIER_SPOTS` — four absolute points, two of which (`22,16` and `-20,-14`)
   fell outside the new walls entirely.
7. `CASTLE_HEARTH.x = -14`.
8. `ROOF_PAVILION_X/Z`, `GROWN_UP_X/Z`, the deck roundel's centre.
9. `Toilets.ts` built its open front at `maxZ` outright — correct only while the
   room was in the north-east corner.
10. `scripts/checkShopSpacing.mjs` hand-copies `INTERIOR_HALF_X/Z`, every shop
    position and `TOILET_ROOM`. Deliberate and documented, but it meant the
    resize had to be typed twice.

## The rule that matters: scale anchors, never parts

`onPlate()` multiplies a **position**, never an extent. Applied naively to
`stairFlights` — scaling each flight's own rect — the two flights overlap by
0.72 m and leave 0.36 m of open slot down each side of the stairwell. That is
architecture review S5's bug rebuilt from scratch. A composite is scaled once,
at its anchor.

## What did not fit, and what was done about it

**Nothing below was resolved by shrinking furniture or relaxing a clearance.**

### The shop run — the big one

Clearances are authored sizes and do not scale: a counter is 2.8 m either side
of centre and a forecourt 4.64 m, whatever the room is.

- Five north-wall units need **46.72 m**. Even at the bare minimum with the
  documented flat 1 m dropped (not on offer) they need 42.72 m. The north wall
  is **42.43 m**. Five do not fit at any spacing.
- Four fit in 30.84 m of centre span, and there is 32.34 m between the west
  perimeter ceiling beam and the east one. 1.5 m of slack.
- That 1.5 m is not enough to move the westmost forecourt clear of the west
  wall's own northern segment, so **the west wall's north segment is
  unusable while four units are on the north wall**.
- The west wall's *middle* is the stairs' own 4.2 m tap target
  (`check:tap-spacing` proved it), so no shop can go there either.

Net: the two far walls hold **six** units and there are **seven**. `toy` moved
to the **east wall** — a *near* wall, so it is partly behind its own parapet.
It was chosen because it is deck 0 (no sunken forecourt, so no hole in the slab)
and its counter is 2.8 m rather than 4.64 m.

**This is the one thing in the PR that is a visible regression and Jim's call.**
If he would rather keep all seven shops on the far walls, the plate cannot halve
its area — a shrink to about 0.65x would.

### The toilets

The north strip cannot carry four shops *and* a 7.4 m room on a 42.43 m wall.
Moved to the south-east, and `Toilets.ts` gained a `TOILET_FRONT_Z` sign so its
open front still faces into the room. The room and its fittings are unchanged in
size.

### The deck roundel

`onPlate(12)` put the rug 0.27 m inside the escalator well on all four lower
decks. The shafts sit in a band across the middle and did **not** shrink, so on
a 31.11 m-deep floor no scaled position exists. It now measures
`BUILDING_SHAFTS` and sits against the band's south edge. 12.3 m of floor for a
12 m disc — genuinely tight.

### The great hall

At 10 m from the throne the feast's benches stood 15.75 m from the north wall,
past every shaft's north edge. All three bays were rejected and `dressGreatHall`
built **no hall at all**; `check:castle`'s contract assertion is what said so.
`TABLE_FROM_THRONE` is now `DAIS_HALF_Z + TABLE_HALF_LENGTH + FEAST_APPROACH`
= 5.7 m. Every object keeps its authored size; only the gap closes, leaving
1.5 m of clear approach — two children abreast.

## Checks strengthened (not weakened)

`checkShopSpacing.mjs` was rewritten to compare real interior-local
**rectangles** instead of intervals along one wall. It immediately found `hat`
and `surpriseEgg` meeting in the north-west corner — a conflict the interval
form was structurally unable to see, since it only ever compared units sharing
a wall. It now also tests every unit against the plate, the toilet room, the
four shafts and the perimeter ceiling beams.

## Gates (all under pnpm, after rebase onto e7d915d4)

| gate | exit |
|---|---|
| `pnpm exec tsc --noEmit` | 0 |
| `pnpm run build` (47 top-level steps, unpiped) | 0 |
| `pnpm run test:procgen` | 0 — 458 passed, 14 files |
| `pnpm run check:castle` | 0 — all 4 sections OK |
| `pnpm run check:park` | 0 |
| `pnpm run check:shop-spacing` | 0 |
| `pnpm run check:tap-spacing` | 0 |

**Environment note:** ~~the `pnpm` on `PATH` via fnm is broken here (its shim
errors with a shell syntax error). `/opt/homebrew/bin/pnpm` 12.1.0 works.~~

**Correction (Overseer, 30 Aug) — struck rather than deleted, because the
wrong version number is the whole lesson.** Just type `pnpm`. Do not
hard-code `/opt/homebrew/bin/pnpm`, and the gates above were **not** run on
12.1.0.

- `/opt/homebrew/bin/pnpm` is **11.20.0**, not 12.1.0. It ran the pinned
  commands correctly because **pnpm 10+ re-executes itself as the
  `packageManager` version in `package.json` before doing any work**. What I
  observed was the version switch working, not the binary's own version.
- The genuinely broken one was the **fnm** pnpm 11.5.0 at the front of
  `PATH`: it fetched 12.1.0 but never ran the postinstall that writes the
  real binary, leaving a 282-byte prose placeholder the shell tried to parse
  — hence `syntax error near unexpected token ')'`. **That is now fixed on
  the machine** (fnm's pnpm upgraded to 11.24.0), so a plain `pnpm` resolves
  per project from one shell.
- **`pnpm --version` cannot tell you which version will actually run.** It is
  a fast path that never consults the pin. That is how this was mis-diagnosed
  twice, including by me above — I read `12.1.0` off it and believed it.

## Screenshots

`scripts/qa-castle-shrink.mjs <port> <outDir> <halfX> <halfZ>` — standing points
are given as **fractions of the half-extent**, so the same call photographs the
same *place in the room* before and after. A fixed metre offset would have
photographed the middle of the old room and the edge of the new one.

Before: `… 30 22`. After: `… 21.2132 15.5563`.

## Honest verdict

**Decks 0-3: yes, clearly denser.** Ground floor especially — the same camera
that used to frame a bubble, a trampoline and a lot of pink now holds the feast
table, a knight, a shop, the roundel and four benches at once.

**Deck 4 (the roof): still reads sparse.** It is smaller, but it is a flat lilac
plain with benches scattered on it and the shrink has not fixed that. The roof
is the one floor with no shops, no shafts through it and no hall — it has the
least furniture to concentrate. If Jim comes back a fourth time it will be about
this floor.

## Known follow-up, not fixed here

On the upper decks the deck above now fades over a much larger fraction of the
frame (visible as a pink wash in the deck-1 shot). `floorFade`'s radius is in
metres and did not scale, so it covers roughly twice the share of a half-area
plate. Not a correctness bug and not in scope; worth its own issue.

## SUPERSEDED: the shops become a market (Jim, 30 Aug)

He rejected all three options for the `toy`-on-a-near-wall problem and gave a
better one, verbatim:

> *"Come up with an aisle-based market-like layout with the stalls in a grid,
> not all against the back wall."*

So: **keep the half-area shrink, keep all seven shops, and redesign them as a
market.** Do not move `toy` to a near wall, do not shrink to 0.65x, do not drop
a shop. The constraint was never "too many shops" — it was "shops may only live
on walls", which made the problem 1-D. A grid uses the *floor*.

### What is measured and true (`scripts/measure-market-floor.mts`)

Run it; it reads obstacles off `BUILDING_SHAFTS`, `TOILET_ROOM`, `DECK_ROUNDEL`
and the **assembled** great-hall furniture group rather than re-deriving them.

- Plate inside the perimeter ceiling beams: **40.83 x 29.51 m**.
- **Free floor: 685.6 m² of 1204.9 m² — 57%.** Folding in 47 obstacle boxes
  (41 of them great-hall furniture) and 3 discs.
- Largest single clear rectangle: **19.50 x 8.00 m** at `x[-20.41, -0.91]
  z[-11.51, -3.51]` — the north-west quadrant.

**One plan, not five.** Indoor collision is height-blind, so seven stalls on
five storeys is a single 2D packing problem: floor used on any deck is blocked
on every deck. That is what defeated the wall layout and it governs the market
too.

### The answer: a plate-wide lattice, not one block

A market does not have to fit inside the largest clear rectangle. Lay a grid
over the whole plate and stand stalls in whichever cells are clear — which is
also what makes it **derive from the plate** instead of from seven typed
positions, so a future resize re-lays the market for free.

With an aisle of `2 * PLAYER_RADIUS + 1.2 = 2.44 m` (two children passing):

| stall | pitch | clear cells |
|---|---|---|
| 5.6 m (today's counter width) | 8.04 m | 3 |
| 4.8 m | 7.24 m | 2 |
| 4.0 m | 6.44 m | 3 |
| **3.6 m** | **6.04 m** | **10** |
| 3.2 m | 5.64 m | 10 |

**Seven stalls fit at 3.6 m with three cells to spare.** At today's 5.6 m
counter only three do — so the stalls do have to become stalls. That means
`SHOP_SCALE_XZ` drops from 1.6, which **reverses the 26 July "shops must
dominate their rooms" decision**. Amend that docblock, do not delete it: it was
right about a shopfront in a warehouse and this is a different object.

### The shape the cells actually make (3.6 m lattice)

    z = -12.08   x = -18.12,          -6.04
    z =  -6.04   x = -18.12, -12.08,  -6.04,  0.00
    z =  +6.04   x = -18.12
    z = +12.08   x = -18.12                    ... and (18.12, +/-12.08) east

The north-west block is the market: **a row of four at z = -6.04 and a row of
two at z = -12.08, facing each other across an east-west aisle at z ~ -9.** Six
stalls contiguous, so **one more is needed** for seven — either free the
`(-12.08, -12.08)` cell (blocked by great-hall furniture; check what) or sweep
the lattice origin. The lattice is currently centred on the plate; a small
origin offset is very likely to land a seventh contiguous cell, and that sweep
is the next piece of work.

### Still to do

- Sweep the lattice origin for the most contiguous cells; pick the market block.
- Stalls **face into the aisle**, serving spot on the aisle side.
- Re-shape `check:shop-spacing` for a grid — it currently reasons in terms of
  "along a wall" and "into the room", which a free-standing stall does not have.
  It was already rewritten once for #403 to compare real rectangles; this is the
  same kind of change again.
- `check:tap-spacing` must still pass: stalls 6.04 m apart with a 2.3 m pick
  radius is comfortable, but the aisle-side serving spots are what to verify.
- Screenshots **standing in an aisle at player height**, not overhead.

## MARKET STATUS — built, all gates green. Superseded section below kept for the record.

The market is implemented and derives from the plate (`marketCell`,
`MARKET_PITCH_X`, `MARKET_ROW_SEPARATION` in `layout.ts`). It does **not** yet
seat all seven shops, and I did not force it to.

**37 failures, all from one stall.** Every one is against the queue keep-out of
the single cell **row 0, col 1** at `(-13.77, -12.35)`, whose three keep-out
spots sit at `x = -14.2, -12.8, -11.3, z = -10.8`. What they hit:

| prop | measured | needs |
|---|---|---|
| `castle-hearth-logs-0[0]` | 4.05 m | 4.62 m |
| `castle-flame-0[20..22]` | 3.89-4.29 m | 4.62 m |
| `castle-flamecore-0[20..22]` | 4.03-4.44 m | 4.62 m |
| NPC children (20 of them) | 4.29-4.52 m | 4.62 m |

**The lesson, and why the probe missed it:** a stall's *footprint* is 2.8 m
square, but the thing that must clear the room is its **queue keep-out** — a
4.0 m disc at each of three spots along the counter (`shopKeepOut`). Seven
cells are clear by footprint; only six are clear once the keep-out is measured.
`check:castle` caught it on the built room. The probe now models the keep-out
too, but its hearth position is approximate — **`check:castle` is the oracle,
not the probe.**

**Capacity, measured:** the north strip is 11.8 m deep (north wall to the shaft
band). Two rows of stalls plus the aisle need 8.53 m of that, leaving 3.27 m of
slack — not enough to also clear the hearth's fire, which reaches about 4.6 m
into the room. Moving the north row south by 1 m bought only 0.27 m of
clearance, so no offset fixes it: the sweep confirms **6 of 7**.

### The decision I did not take on my own

Two ways out, both needing a ruling:

1. **Move the hearth** (or its fire/woodpile) a metre or two west along the
   north wall. It is great-hall furniture and #388 was reviewed on its layout,
   so per the Overseer this is not mine to move unasked.
2. **Two aisles instead of one** — a shorter north row plus a second pair of
   rows in the south strip, which is free apart from the roundel and the
   toilets. More work, and it splits the market in two.

**Do not** shrink the shop keep-out to make the seventh fit. It is 4.0 m
because that is the counter, the serving spot and room to queue; the counter
got smaller but the queue did not.

## THE MARKET AS BUILT — and the honest verdict

**Two aisles, seven stalls, every gate green.** North aisle five, south aisle
two. Both laid out by the same two rules: along-row pitch from `PLAYER_RADIUS`,
row separation from `TAP_FINGER_METRES`. Nothing that belongs to someone else
moved — the hearth, the roundel, the toilets and the great hall are all
obstacles the design goes around.

The north row is mostly fireplace. Columns 1 and 2 are the hearth's fire and
woodpile; column 3's queue stood where the great hall's children gather (21
`check:castle` failures against that one pitch), so it moved to the far row.
One stall, a fire, then the aisle.

Two constants had to be measured rather than chosen, and both were found by a
check rather than by reasoning:

- `MARKET_BEAM_INSET = 1.8` — the north row's queue reached the hearth's fire
  at 1.0. `check:castle`.
- `MARKET_SOUTH_Z`'s `+1.6` — the south aisle's first stall sat 0.68 m inside
  the stairwell's deliberately-wide 4.2 m pick radius at 1.0.
  `check:tap-spacing`.

### Gates

`tsc` 0 · `pnpm run build` 0 (47 steps, unpiped) · `test:procgen` 0 (458/458) ·
`check:castle` 0 (all four sections) · `check:tap-spacing` 0 ·
`check:shop-spacing` 0 (rewritten for a grid).

### Honest verdict: it is a grid, and it is not yet a market

Screenshots on `qa-screenshots` under `403-market/`, at aisle height.

The aisle **works**. Standing between the toy stall and the balloon stall on
deck 0, with the fire off to one side, is exactly the arrangement Jim
described, and it reads far better than the row of shopfronts did. The stall
faces the child, the serving spot is in the aisle, the shopping prompt comes up
where it should.

**But it does not read as a market, and the reason is not the layout.** The
seven shops are on **four different decks** — 2, 2, 2, 1 — so no floor ever
shows more than two stalls. Deck 2's south aisle is one stall alone in a
corner; that is a kiosk, not a market. The grid is a **plan-level** fix, and it
had to be, because collision is height-blind and all seven footprints share one
plan. What it cannot do is put them in one **frame**.

**To read as a market the stalls have to be on the same floor.** That is a
design decision about which deck each shop lives on — deliberately spread, to
give a reason to climb — and it is Jim's, not mine. It also collides with
#377/#380 (three floors, lift-only). Worth asking him directly: *would you
rather all seven stalls on one floor and fewer reasons to climb?*

## Coordination

- **#401** (remove the bubble) is untouched by this and frees a 2.1 m circle;
  it will make the shaft band less tight, which helps everything above.
- **#377/#380** (three floors) deliberately not attempted here.
- **#402** (pnpm) is merged and this branch is rebased onto it.
