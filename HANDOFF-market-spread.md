# HANDOFF — spread the market out (#446)

Branch `feat/market-spread`, off **`origin/feat/market-stalls-differ`** (PR #446's
head — the seven stall silhouettes are that branch's work and stay untouched).
Worktree `.claude/worktrees/market-spread`. Dev server port **5503**
(`--strictPort`), kill by PID. **PR goes against `feat/market-stalls-differ`**,
not `main`.

## The ask

Jim: *"Market stalls are all clumped together in the middle of a large room —
spread them out more. Move a couple to the back wall, while keeping the rest in
a bigger grid."*

## What was actually wrong

Seven 2.8 m stalls at a 5.24 m pitch occupied a **15.7 × 5.7 m** patch of a
**42.4 × 31.1 m** room, all within a few metres of the middle. Every gap in it
was the narrowest that could legally exist: the aisle was 2.93 m, which is what
the *tap targets* need and nothing more, so one child at a counter filled it.

## What was built

Three ranks, `MARKET_ROWS` in `layout.ts` (replaces `MARKET_ROW_Z` +
`MARKET_ROW_LENGTHS`; a rank now declares its own z, facing and columns):

| rank | z | faces | stalls |
| --- | --- | --- | --- |
| 0 back wall | −13.06 | +Z | stickerPet (−11.28), surpriseEgg (+11.28) |
| 1 | −6.68 | +Z | toy (−7.52), iceCream (0), hat (+7.52) |
| 2 | +0.84 | −Z | balloon (−3.76), candyFloss (+3.76) |

- Aisle **2.93 → 4.72 m**, derived: `2 × MARKET_QUEUE_DEPTH + MARKET_WALK_AISLE`
  — two children being served facing each other, two more walking between. The
  old tap-target minimum is kept as a `Math.max` floor, not deleted.
- Along-row pitch **5.24 → 7.52 m**, the same number, so the grid is square and
  one constant widens both.
- Back rank columns are at **half-pitch offsets** (±1.5) so they sit opposite
  the cross-lanes and read through them from the aisle, rather than hiding
  behind rank 1's canopies.

## Two findings worth keeping

1. **The depth budget is 16.9 m and the market needs 16.7 m.** Usable Z runs
   from the beam at −14.76 to the **roundel**, whose disc reaches z = 2.76 and
   is the real southern limit — not the wall, not the doorway. Three ranks plus
   their two lanes just fit, with about 0.5 m to spare. Anyone widening a lane
   further has to take it from somewhere.
2. **The planter ring is inside the roundel disc.** Pots sit at
   `ROUNDEL_RADIUS − 0.9` = 5.1 m carrying a 0.55 m bush, so they reach 5.65 m
   of a 6 m disc. The first cut of the new check assumed they stuck out past it
   and failed the layout by 9 cm on a radius that does not exist.

## #447 (stall backs to the camera) is improved, not worsened

The camera always shows +X/+Z faces. Rank 2 is the only rank facing −Z, and it
went from **three stalls to two** — and those two are the balloon bouquet and
the candy floss parasol, the canopies that read the same from every side.

## Keep-outs

Nothing to do: `keepOutsFor` in `dressing.ts` builds its shop discs by looping
`SHOP_UNITS`, so benches and props followed the stalls without a second list.

## `check:shop-spacing`

Reshaped for the fifth time, per its own instruction. Clause 2 now walks every
rank and measures the lane in front of it to whatever is really there; a new
clause 2 requirement is that some pair of ranks still faces each other (the
#403 aisle), and a new clause 7 keeps stalls off the roundel disc.

Proved red before green — see the commit message for the three mutations and
their real numbers.

## State

- `check:shop-spacing`, `check:stall-shape`, `tsc --noEmit` — green.
- Full `pnpm run check`, `test:procgen`, `build`, browser pass — see the PR.
