# HANDOFF — remove the floating bubble (issues #377, #380)

Branch `feat/remove-the-bubble`, worktree `.claude/worktrees/remove-bubble`.

Jim, 29 Aug 2026: *"Yeah I think remove it and keep only the lift. It's the
only one that works very well. Remove from docs too."* Following his earlier
*"there are too many ways between the floors right now. Let's reduce it to
just the lift."* The bubble is the first of those to go. Decision, not a bug.

## Scope

Code + assets + docs. **Only the castle's floating platform.** The *backpack
charm* called "bubble" (`src/art/models/backpacks.ts`, `state/types.ts`,
`ui/CharacterCreation.ts`, GAME_DESIGN.md ~line 254) stays — different thing.
`PALETTE.bubbleSkin` also stays: the hotel tower and its dressing use it.

## Files touched

- deleted `src/world/building/Bubble.ts`
- `src/world/building/layout.ts` — `BUBBLE_SHAFT`, its `BUILDING_SHAFTS` row,
  `BUBBLE_X/Z/RADIUS`
- `src/world/building/ShaftGuards.ts` — the deck 1-4 circular guard
- `src/world/building/Building.ts`, `interactZones.ts`, `src/core/constants.ts`,
  `src/ui/ParkMap.ts`
- comment-only: Game.ts, World.ts, Player.ts, interact.ts, anchors.ts,
  ParkTrain.ts, Shell.ts, surfaces.ts, castleFabric.ts, check-castle.mts
- docs: GAME_DESIGN.md, ARCHITECTURE.md, ARCHITECTURE-DECISIONS.md,
  ARCHITECTURE-REVIEW.md, ASSET_MANIFEST.md

## What the removal frees

`BUBBLE_SHAFT` was **both** a shaft and a deck hole — it was a row in
`BUILDING_SHAFTS`, which `DECK_HOLES` spreads. Removing it makes a 2.1 m
circle at local (-1.5, 0) **solid floor on decks 1-4** rather than an open
well, and takes the deck 1-4 guard rail with it. No hole is left behind.
