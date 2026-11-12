# HANDOFF — lazy hotel interior

Branch `lazy-hotel`, worktree `.claude/worktrees/lazy-hotel`. Task: move the
hotel's whole interior (code, kit, colliders) into a lazy chunk the way #749
did the reptile hall; exterior (tower, its collider, outer doors) stays boot.

## Baseline (main f3e0b6b8, `check:boot-chunk --report`)
- boot set 35 chunks, 4742 KB; largest `Game` 1081 KB; 9 lazy chunks 1475 KB
- in boot: `hotelGlb.ts` 929 KB, `Hotel.ts` 99 KB, `dressing.ts` 26 KB,
  `layout.ts` 20 KB, `hotelAssets.ts` 20 KB (rendered, pre-minify)

## Plan
1. `pack:hotel` splits `hotel.glb` into two modules: `hotelGlb.ts` (boot:
   tower, entrance doors, and parts other buildings borrow — lift, pet bowl,
   pet bed, breakfast bowls, disco ball) and `hotelInsideGlb.ts` (lazy: the
   rest). Partition has one owner. Factories stay in `hotelAssets.ts`; the
   inside kit registers its parts when loaded.
   Why those borrowed parts stay boot: castle (boot) uses lift + pet bowl; the
   lazy BookReader uses bowls/pet bed/disco ball, and a module shared by two
   lazy chunks fails check:boot-chunk rule 4.
2. `Hotel.ts` → `hotel/interior.ts` (`HotelInterior`, lazy). New thin boot
   `Hotel.ts`: tower + collider + outer doors + door band + exterior zone +
   shared SpaceManager/HotelLift/reception bubble; delegates to the interior
   once furnished (`changeToFurnished` behind the iris, like the reptile).
3. NpcSystem gets `addResidents` for guests furnished after boot.
4. `interiors.ts`: `HOTEL_INTERIOR` + preload for saves in hotel rooms and
   `/hotel…` links; eagerInteriors provides it; check:boot-chunk lists it.

## After (d8cb8a6f, `check:boot-chunk`)
- boot set 41 chunks, 4122 KB (was 4742); largest boot chunk 603 KB; 10 lazy
  chunks 2108 KB (was 9, 1475) — the hotel interior chunk is ~632 KB
- proved red: `import * as hotelEager from './interior'` appended to Hotel.ts
  → exit 1, 5 FAIL lines (interior, dressing, cinematic, hotelInsideKit,
  hotelInsideGlb in chunk Hotel-*.js), boot set 4753 KB. Reverted.

## Status
- [x] 1 pack split (60108cba)
- [x] 2 class split, 3 residents, 4 wiring (d8cb8a6f); guard proved red
- [ ] check, test:procgen, Playwright desktop+phone, PR
