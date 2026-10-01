# HANDOFF — paths-to-doors

- Model: Claude Opus 5.5 (1M), chosen by the Overseer. Role: Engineer.
- Branch: `fix/paths-to-doors` off `origin/wip/sb-merge` (PR target: `wip/sb-merge`, lead a52ae9484877226d6, PR #706).
- Worktree: `.claude/worktrees/paths-to-doors`. Logs: scratchpad `paths-to-doors/`.

## Task
1. Invariant: drawn paving (mesh triangles) continuous from gate to every doormat (anchors, stalls, exits, stations), touching the doormat.
2. Invariant: no drawn paving crosses a bridge's parapet/stone except the carried route via the deck ends.
Controls first, sweep 0..15, fix generators, add to PARK_ACCEPTANCE, re-record `accept:parks -- 0-15 --fresh --write`.

## State
- Started. Lead says: fix/sb-bush may touch theParkIsFurnished in invariants.ts (small textual merge expected).

## Findings (1 Oct)
- BEFORE sweep (frozen tree 17cf536e, accepted restarts): `drawnPavingReachesEveryDoor` fails 16/16 seeds — hotel door 1.83–1.92 m of lawn on all 16, castle front door 0.78–26 m on 15/16 (castle doormat was placed toward the park middle, but its front door always faces +Z), plus stalls/exits 1–2.5 m on seeds 1,2,5,8,13,15. `pathsMeetBridgesOnlyAtTheirEnds` fails seed 11 only (spur-stall.facePaint into bridge-186.0 parapet near (37.1, 11.3)).
- Controls: paving-gap (0–2.5 m round stall:dodgems → red 2.21 m; 4–6 m ring → red "does not join up"), bridge-side (turned copy → red; beside copy → red). scripts/controls/*.mts + scripts/run-park-invariants.mts (LGP_CONTROL=...).
- Fix in progress: ManifestEntry.door (castle: foot of front steps, facing +Z; hotel: reach). Hotel: the DRAWN door (asset `tower-door-glow`) is at ~1.77 m along from the tower centre, far inside the collision facade (6.65) — paving to the facade still leaves ~4.9 m of lawn in front of the drawn door. Need the paving to reach the drawn door.

## Fix state (commit 0c545314)
- `ManifestEntry.door` (parkManifest.ts): castle `{local: CASTLE_DOORMAT_LOCAL (foot of front steps), facing [0,1]}`; hotel `{reach: TOWER_DOOR_BAND_OUTER, pavedTo: TOWER_DRAWN_DOOR_ALONG (1.77, drawn door recess)}`. parkLayout: `entranceFacing`, `hasOwnDoor`, `pavedPastTheDoormat`; paths.ts spur lead along facing, `past` into hotel recess. LAYOUT_VERSION 5.
- Leaf modules: `hotel/towerDimensions.ts`, `building/frontDoor.ts`.
- Invariant doors now measured off scene meshes `tower-door-glow` / `entrance-steps` (`drawnDoorstep`). noPathEndsNowhere accepts an end at a drawn door front.
- Frozen tree `.claude/worktrees/paths-to-doors-frozen` @0c545314 running `accept:parks -- 0-15 --fresh --out accept1.json` (scratchpad). Before-tree `paths-to-doors-before` @17cf536e, preview :5439 (pid 91660). Current preview :5437 (pid 47476), dev :5438 (pid 83647).
