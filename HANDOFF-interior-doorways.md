# HANDOFF — interior doorway frames (branch `interior-doorways`)

Jim, 11 Nov: interiors' way out is a gap in a hidden wall with nothing drawn;
model a doorway frame (no door) per setting so the exit is obvious.

## Findings
- Interiors with a way out to the park: hotel lobby (south gap `[-DOOR_HALF, DOOR_HALF]`,
  `hotel/layout.ts`), reptile hall (`reptileDoorGap()`, `reptileHouse/shell.ts`), library
  reading room (`libraryDoorGap()`, `library/shell.ts`), castle mall deck 0
  (`INTERIOR_DOOR_MIN_X..MAX_X`; castle south wall is DRAWN and has an outside porch).
  Den is internal (no exit). Shops/stalls are open or curtain games. Hotel other rooms: lift only.
- Hotel/reptile/library south+east walls are `visible=false` (camera looks in from +X+Z).
- Wall colliders are capsules (round ends stick `half` into each gap already).
- `check:coplanar` ignores `visible`, so posts must not share a plane with the hidden wall's
  end face: the drawn wall span is trimmed back by the post width; colliders unchanged.
- Local parks: `gh run download <run> -n parks-<hash> -D .parks` (hash from
  `node scripts/lib/park-source-hash.mjs`), then dev server on 5791.

## Plan
Blender kit `art/blend/doorframes_build.py` → `doorframes.glb` → `pack:doorframes` →
`src/art/models/doorFrames.ts` (posts + tiled lintel + crest, measured off the GLB) →
each room builds it on its own gap; `check:doorframes` walks lanes through each opening both
ways (5 cm and PLAYER_LONGEST_STEP), with/without frame, control = narrowed frame.

## State
- DONE: kit (build/export/pack/render, ASSET_MANIFEST 43), `doorFrames.ts`, wired in hotel
  (Hotel.buildRoomShell, LOBBY), reptile (buildHallShell returns it), library (buildReadingRoomShell),
  castle (BuildingShell.exitFrame drawn, Building registers solids). Each system exposes `exitDoorFrame`.
- `check:doorframes` green + controls red + mutation red; `check:doorframes-glb` green; in shards 4 / 1.
- check:coplanar flagged outline hull on stepped posts → outlines removed on hotel/castle posts.
- check:exits OK. Next: coplanar/library/reptile/hotel/castle/solids, then full check + test:procgen, PR.
- Local parks trick: CI parks artifact restamped to the tree's hash (scratchpad restamp.sh) — re-run
  after EVERY src edit or the harness re-solves (minutes).
- Shots: `scripts/qa-interior-doorways.mjs <base> <out> <tag>`; draft shots look right; castle frame
  mostly hidden behind the existing porch roof (only lintel strip shows).
- PR body draft: scratchpad/mine/pr-body.md.
