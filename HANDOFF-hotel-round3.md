# HANDOFF — hotel round 3 (Jim's 7 Aug live-play feedback)

Branch `feat/hotel-236`, shared worktree `.claude/worktrees/hotel-236`.
Features agent. My files: `src/world/hotel/*`, `src/world/Collision.ts`,
`scripts/check-hotel.mts`. Do NOT touch `art/blend/*` or
`src/art/models/hotelAssets.ts` — the artist agent owns them and will export
`STAIR_*` constants (not landed yet; `git fetch` before assuming).

## Items and state

1. **Reception greeting misdirects** — TODO. Root cause found: the
   `hotel-reception` interact zone in `Hotel.interactZones` hardcodes
   `(LOBBY+5, −6.2)` — the desk's OLD spot, now beside the stair's bottom
   tread — while the desk itself moved to `RECEPTION_X/Z = (10, −9.5)`.
   Fix = zone derives from RECEPTION_X/Z (one owner), lands with item 2.
2. **Lobby layout rework** — TODO (researched: axis door→focal desk, central
   statue feature, symmetric seating flanking the axis, stair as focal point,
   clear lanes). Plan: desk on the entrance axis at lobby-local (0, −6.0)
   in front of the gallery face, receptionist (0, −7.0), runner rug down the
   axis, mirrored seating groups at (±7.6, 4.1) area, café tables to SW
   corner, planters flanking the door. STAIR stays data-driven from
   `layout.ts` until the artist's STAIR_* lands.
3. **Mezzanine floor z-fight** — root cause found, fix TODO: the top stair
   tread box (`buildMezzanine`, top = height exactly at i = treads−1) is
   coplanar with the deck slab top (both y = 3.2) where the tread overlaps
   the deck past the stair mouth. One owner: the slab owns that plane; drop
   the top tread's *visual* box by 2 cm (walk surface unchanged).
4. **Cinematics** — DONE (commit pending push). `cinematic.ts`: matched-pose
   start/return (iso rig parks its ortho camera 90 m out; a perspective
   camera there is a huge zoom-out — match apparent size instead:
   d = viewHalfHeight / tan(fov/2) up the iso diagonal, anchored on the
   aim), MIN_SHOT_DISTANCE = 1.1 m clamp in `play()`, return eases aim to
   iso focus instead of snapping. `Hotel.foodShotFor` now chair-frame
   (was world-axis +0.9/+0.9 — that was the inside-the-head bug), chest
   framing. Probes 9 (all shots ≥ 1.1 m from subject, inside room walls;
   proven red: food-b1-e-0 at 1.09 m) and clamp micro-probe (proven red by
   disabling clamp: 0.05 m). Browser watch still TODO.
5. **topHeight = Infinity furniture** — TODO. Design settled: colliders gain
   an *absolute-top* mode (`Player.position.y` is absolute ground+jump, so
   `position.y + grace >= topAbsY` yields while stood on the prop and mid-jump
   above it, but blocks from the floor; NPC/probe y=0 still blocked).
   `place.ts` `PropPlan` gains required `top` (prop's real height) and plates
   flat-topped mountable props (< JUMP_APEX_HEIGHT) with WalkSurfaces Plates.
   Sofa top = 0.5 (seat), table 0.74, buffet 1.02, chair 0.42, plinth 0.4.
6. **Pictures overlap windows** — TODO. Offender measured: lobby west picture
   `along: 4` (span 3.15–4.85) vs west pane at 3.2 (span 2.3–4.1). Fix: one
   pane-span authority consulted by both `glazeWall` and `hangOnWalls`;
   pictures slide along the wall to clear glass. Probe: world AABBs of
   'hotel.artwork' groups vs 'hotel.window' meshes.

## Working practice
`npm run check:hotel` and `npm run build` green before every commit; probes
proven red first (quote the numbers in the commit). Own vite port, kill by
PID. QA agent owns port 5643 — leave it alone.
