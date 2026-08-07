# HANDOFF — The Land Hotel (#236) + attraction spread (#241)

Branch: `feat/hotel-236` · Worktree: `.claude/worktrees/hotel-236`
Scope set by Jim, 7 Aug: build the hotel to delivery, AND pick up #241
(attractions escape the old 52 m circle) because the hotel needs the space.

## Baseline (7 Aug, rebased onto origin/main at 2144699)

- `npm run test:procgen` 196 pass · `check:park` 15/15 routes, 75/75
  waypoints, 5 recorded ratchet deviations (worst rail.walkable 30) ·
  `npm run build` exit 0.

## Order of work

1. #241 placement reform (parkLayout/parkManifest):
   per-entry-per-restart RNG streams `Rng(hash(seed, id#restart))`; delete
   pins; fit-inside-boundary via `PARK_BOUNDARY.distanceToEdge >= r + 2.5`
   replacing PLOT_EXTENT_LIMIT; optional `nearEdge` manifest band (distance
   to spline edge — rail-race stall wants the rim); maximin best-of-K spread;
   LAYOUT_VERSION 2 → 3.
2. Train route rework (`train/route.ts`): the loop currently clamps to ONE
   outer radius (boundary's closest approach) and its `lower[]` uses
   "furthest obstacle exit along the ray" — a plot wholly OUTSIDE the loop
   inflates lower past upper and the clamp inverts. Needed: per-bearing
   upper from `edgeRadiusAt(bearing)`, and interval-aware obstacle bounds
   (pass outside a plot when there's room before the wall, thread inside
   otherwise, greedy-continuous across bearings).
3. #241 invariants: park area ≈ 2x within tolerance (the missing #115
   check), every plot inside the boundary with clearance, no large empty
   walkable region. Break each deliberately first (CLAUDE.md).
4. Hotel (#236) — design decided against the code map:
   - Manifest entry `hotel` (circle r≈8, boundingRadius≈9) with
     `near: { id: 'building', min: 24, max: 38 }`; new AnchorId 'hotel';
     facade = crystal tower (toon-shaded faceted prisms + instanced lit
     window rows reading as ~50 storeys + crystals round the base), door
     YAWED toward the solver's doormat (circle footprint so rotation-free).
   - Interior = castle's far-offset trick at own origin, e.g. (-600, 600),
     THREE rooms spread HORIZONTALLY (not stacked): Lobby / Floor 25
     breakfast / Floor 50 suite, ~200 m apart inside SPACE_HOTEL
     (spaces.ts gains one origin). Rooms are open-topped (no ceiling => no
     fader, no InteriorLighting needed). Floors + bed-tops are static
     MovingPlatforms via surfaces.addPlatform — ZERO edits to
     WalkSurfaces.sample.
   - Lift = FIRST PORTAL LIFT (Decision 3's shape): a `HotelLift
     implements LiftPanelSource` (floors()/go(n)); reuse ui/LiftPanel
     unchanged as a second instance. go(n) = iris + teleport + rebound play
     area. Floor list: 'Yours ⭐ 50' (glyph says yours), 'Breakfast 25',
     'Lobby G'. Floor 50 unreachable until checked in at reception.
   - Reception keeper (red jacket/pink — KeeperOptions colours) grants the
     key (saveFlags + speech), giant `createRipikaStatue()` in lobby with
     disco ball above; suite: rainbow walls, disco ball, 3 beds =
     platforms (jump between) + Sleep chip (scripted beat a la Toilets —
     state from position, never a latched flag); corridor pet statues
     (createPet on plinths); restaurant tables, sit chip + three breakfasts
     (heart cheerios / shreddies for Ethan / yoghurt + honey).
   - HUD floor pill while inside (gameStore field + Hud subscriber).
   - "yours" on suite door plaque + painted arrow to the lift in lobby.
5. GAME_DESIGN.md hotel section; ARCHITECTURE-DECISIONS Decision 9
   (boundary-derived placement, unpinned manifest); invariants for hotel
   (doormat/overlap free via existing checks; add near-castle distance).
6. Build + test:procgen + check:park green; push; PR; ONE reviewer agent
   (Jim's 1 Aug rule); do NOT merge (Jim reviews).

## Findings so far

- Rail Race rings live OUTSIDE the masonry (railRace/route.ts) — plots
  can't hit them. The train is the only rim system that must learn the
  spline.
- `LiftPanel` is written against the two-method seam and takes any
  `LiftPanelSource` — second instance works.
- `createRipikaStatue()` (fountain) is reusable as-is for the lobby.
- Keepers (`createKeeper`) take colour options — uniforms are easy.
- `grantFree` in state/store.ts is the free-item path (character creator
  uses it) — the hotel key uses it or saveFlags.
- Shared checkout main is BEHIND origin/main; read docs from the worktree.
- #233 (ferrisKiosk stand point inside wheel exclusion) may bite when
  plots move — watch check:park.

## State

- [x] Rebase, baseline green, design pinned
- [ ] Layout reform  - [ ] Train rework  - [ ] 241 invariants
- [ ] Hotel exterior/placement  - [ ] Interior+lift  - [ ] HUD
- [ ] Docs  - [ ] PR
