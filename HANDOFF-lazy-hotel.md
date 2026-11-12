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

## Status
- [ ] 1 pack split
- [ ] 2 class split
- [ ] 3 residents
- [ ] 4 wiring + guard proved red
- [ ] check, test:procgen, Playwright desktop+phone, PR
