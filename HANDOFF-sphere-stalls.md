# Sphere "up" — stalls, entrance, gate arch (Engineer, Opus 5 1M)

Branch `feat/sphere-combined`, shared worktree with another agent (it owns
trees, player, rails, scenery; this half owns the files listed below).

Done, all committed and pushed:

- `world/KeychainShop.ts`, `world/FacePaintStall.ts`, `minigames/stalls.ts` —
  one `standOnSphere` on the stall's own group, which is what keeps each booth
  rigid; every part is already a child of it.
- `world/FacePaintStall.ts` `updateNpcDecals` — the decals hang off the booth's
  (now leaning) group but belong to children anywhere in the park, so their
  local transform is taken by inverting the group's real world matrix, and each
  head's world transform comes from `placeOnSphere` at its own (x, z). The
  hand-written `stallToLocal` inverse is deleted. It writes `quaternion`
  outright every frame, never pre-multiplying, so it cannot compound.
- `world/entrance/Entrance.ts` — the bus shelter's posts/canopy/bench/paw were
  siblings in world space; they are now one `bus-shelter` group, leaned once.
  Welcome sign group leaned.
- `world/entrance/gateArch.ts` — new opt-in `onParkSphere` option. `Entrance`
  passes it; `BusJourney` must not (its lane is not on the park's sphere, and
  `spaceAt` would still call it "garden").

Deliberately untouched, all interior spaces at far-off origins: `building/
ShopUnits.ts`, `building/dressing.ts`, `building/shops/Shops.ts` (comments
added saying why), and the entrance road ribbon (per-vertex `terrainHeight`,
already conforms).

Not verified: no browser was available.
