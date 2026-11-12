# HANDOFF — lazy castle interior + rail-race cart

Branch `lazy-castle`, worktree `.claude/worktrees/lazy-castle`. Follows #749
(`src/world/LazyPart.ts`, `src/world/interiors.ts`, `scripts/lib/eagerInteriors.mts`,
`check:boot-chunk`).

## Baseline (origin/main f3e0b6b8, `check:boot-chunk`)
boot set 35 chunks, 4742 KB; Game chunk 1081 KB; 9 lazy chunks 1475 KB.
`castleGlb.ts` 172 KB and `cartGlb.ts` 134 KB in the boot (rendered).

## Plan (castle)
- New lazy root `src/world/building/castleInterior.ts`: `furnishCastle()` builds
  CastleFire.dress, dressCastle, GreatHallBanquet.dress per deck, and registers
  hall + decor colliders (moved from Building.ts). Returns seats, pet places,
  feast-dish maker, fire and banquet for per-frame updates.
- Building keeps shell, lift, shops, toilets, dressDeck (kit-free benches/planters
  + their colliders), slide, wild pets. Door and `/castle` go through
  `spaces.changeToFurnished` (iris holds until built).
- `dressing.ts` no longer imports castleFurniture: `scatterKeepOutsFor` moved to
  castleFurniture; `CASTLE_GREAT_HALL_DECK` → `HALL_DECK`.
- `interactZones.ts` gets the seats handed in.
- Castle saves never restore inside (`resolveSpawn`), so only `/castle` preloads.

## Rail race
Carts are built at construction and visible on the walk-past ring, and
`barReach` measures the cart kit to pose the duck bars of both rings, so
`cartGlb` must stay in the boot (task: carts visible in the park stay).

## Status
- [ ] castle split
- [ ] rail race race-only split (assess)
- [ ] guard red proof
- [ ] browser verify
- [ ] PR
