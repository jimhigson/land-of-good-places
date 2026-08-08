# HANDOFF — dressing The Land Hotel (Jim's play feedback)

Branch `feat/hotel-236` · worktree `.claude/worktrees/hotel-236` ·
Jim's dev server runs on **5641** (do NOT start another, do NOT open a
browser). Edits hot-reload into his live session.

## State: DONE. `npx tsc --noEmit` EXIT 0 · seed-canonical 39/39 green.

Nothing committed (brief says do not commit).

## Facts worked out up front (don't re-derive these)

- Camera: yaw 45°, pitch 38°, eye at focus + (+X, +Y, +Z). **The camera sees
  the inside faces of the NORTH (z = −halfZ) and WEST (x = −halfX) walls
  only.** Pictures and sconces go on those two; the south and east walls hide
  a ~3.1 m band of floor each. Everything with a front faces **+Z**.
- `HOTEL_PLAY_RADIUS` 24 m from each room origin; a 12 × 9 room corners at
  15 m and its lift alcove reaches 15.4 m, so it fits.
- `spaceAt` claims 70 m round each origin and rooms are 260 m apart, so
  growing a room can never leak into a neighbour.
- Storeys are data in `HOTEL_FLOORS`; only the lift indicator reads them.
- **Floor-decal height ladder** (documented in `hotel/dressing.ts`'s header):
  mosaic 0.02, rugs 0.03, rainbow ring 0.04, arrow chevrons 0.06. Add on top,
  never in between.
- **A `ConeGeometry` does not flatten by tipping it over** — its radius runs
  perpendicular to its axis in *both* directions. Two props were built wrong
  this way (the sun's rays, the pictures' triangles) and both now use a flat
  `ShapeGeometry`/3-sided `CylinderGeometry`. Check any new "flat" prop.
- **glTF UVs are top-left origin**, so a default `CanvasTexture` (flipY true)
  on a `.glb` mesh renders text upside-down. `glbCanvasTexture()` in Hotel.ts
  owns that; use it for anything painted onto an authored mesh.

## What is where

| File | What it owns |
| --- | --- |
| `core/textures.ts` | `mosaicTexture()` — the only thing added outside `world/hotel/` |
| `world/hotel/layout.ts` | room rects **and `HotelTheme` per floor** |
| `world/hotel/dressing.ts` | the prop kit (crystals, columns, rugs, sofa, picture, sconce, buffet, stars, clouds, sunburst, chevron) |
| `world/hotel/Hotel.ts` | which props go where, per room; keep-out registry |
| `world/hotel/HotelGuests.ts` | 4 kids + 3 pets strolling seeded circuits |

## Budget note (the one thing to watch)

`createKid` paints **5 expression canvases per child** — it is a hero factory;
the park's background crowd instances one prototype instead
(`entities/npc/kidCrowd.ts`). Four guest children = 20 canvases against
ART_DIRECTION §7's "under 40 game-wide", which is why the roster is 4 kids and
3 *pets* rather than 7 kids: `createPet` goes through `sharedFacePatch`, so
pets cost no textures at all. **If more people are wanted, add pets, or give
`createKid` a shared-face option** (a `sharedFacePatch`-keyed path beside the
baked one in `kid.ts`) — that was outside this task's allowed file set.

## Still open / not done

- No browser QA — I was told not to drive one. Everything below is
  build-verified and arithmetic-checked only.
- `src/ui/FloorPill.ts`'s doc comment still says `"Floor 25"` as an example,
  and `GAME_DESIGN.md:267` still records breakfast as level 25. Both are prose
  outside this task's file set; worth a follow-up line.
- Guests can walk into the ~3 m strip the near walls hide, and briefly
  disappear. The player does too. Not worth a cutaway.
