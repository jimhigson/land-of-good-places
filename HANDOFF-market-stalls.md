# HANDOFF — market stalls differ again (#444)

Branch `feat/market-stalls-differ`, worktree `.claude/worktrees/market-stalls`.
Dev server port **5485** (`--strictPort`), kill by PID.

## What was wrong

The market re-lay (`eadf60eb`, #377/#380) replaced seven hand-placed shops with
seven cells of one grid. The grid is right and stays; what it silently deleted
was the hand-placement that had been doing all the work of telling the shops
apart. Seven identical shells differing by an accent colour.

## What was built

New `src/world/building/shops/stallShape.ts`:

- `STALL_STYLES`, keyed by `ShopId` — the sibling of `fitouts.ts`'s `BUILDERS`,
  so variation is derived from identity, never a seed.
- Seven canopy kinds, one each: gable (toy), bouquet-of-balloons (balloon),
  parasol (candyFloss), striped barrel vault (iceCream), flat plank on legs
  (hat), bunting swag (stickerPet), sawtooth valance (surpriseEgg).
- Four skirt kinds on the counter front, plus **the same skirt on the back**.
- An emblem per stall, built from **the shop's own stock factories** —
  `createBiscuit`, `createCandyFloss`, `createIceCream`, `createHat`,
  `createStarToy`, `createSurpriseEgg` — scaled to fill the gap between its
  canopy's own `perch` and the ceiling, then shrunk if that would leave the
  footprint. No hand-tuned sizes; a canopy tells its own finial where it is.

`kiosk.ts` keeps only what all seven share (counter, top plank, shelving).
`ShopUnits.registerCounter` now imports `COUNTER_HALF_WIDTH` instead of its own
copy of 1.75.

New `scripts/check-stall-shape.mts`, in the `check` chain
(`pnpm run check:stall-shape`).

## Two findings worth keeping

1. **The camera always shows an object's +X and +Z faces** (direction
   `(-0.557, -0.616, -0.557)`). Market row 0 faces +Z and shows its front; row 1
   faces −Z and shows its **back**, from every position a child can stand in.
   That is why the back panel now wears the skirt too. It also means row 1's
   *goods* are largely hidden behind their own back panel — pre-existing, not
   touched here, probably worth its own ticket.
2. **Lowering the canopies created a head-clearance bug that the eye missed and
   the check caught.** The gap between two stalls along a row is 2.44 m of
   walkable floor; five canopies overhung it at 1.6–2.0 m and the kid is 2.12 m.
   Canopies are now exactly the footprint wide. `check:stall-shape` was proved
   red on that geometry (7 failures, real numbers) before it was proved green.

## State

`check`, `test:procgen`, `build` — see the PR. Looked at in the browser at
`/castle?deck=0&at=-3.5,-2` and `at=6.5,-2`; screenshots on the PR.
