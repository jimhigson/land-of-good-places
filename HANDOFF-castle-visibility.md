# HANDOFF — castle interior visibility (investigate/castle-interior-visibility)

Branch off `origin/main` @ `254484d2`. Worktree `.claude/worktrees/castle-invisible`.
Dev server: **port 5389** (`npx vite --port 5389 --strictPort`), started by me, PID noted per run.

## The question

QA on `main` says `/castle?deck=0..3` puts the player at the right heights with
`playerIsInside: true`, castle meshes in the scene — but every deck renders as an open
pink terrace with grass off the edge. Meanwhile `npm run check:castle` passes claiming
"4 enclosed storeys".

First job: is this real for a **player walking through the door**, or only for the
`?deck=N` debug route?

## Status

- [x] Worktree + `npm ci`.
- [x] Read `scripts/check-castle.mts`, `castleFabric.ts`, `Shell.ts`, `Building.ts`.
- [ ] Screenshots: path A (`?deck=N`) vs path B (walk through the door).

## Code reading so far (not yet proof of anything)

- `Building.enterCastleSpawn(deck)` goes **through** `spaces.changeTo(() => enterInterior())`
  — the door's own code — then teleports up. So on paper the debug route and the door
  share the transition. If path A is broken, path B probably is too.
- `BuildingShell` ('interior') builds walls/glass/beams for `deck < TOP_DECK` (=4) and
  `buildRoofTerrace` for deck 4. `interiorRoot.visible = false` until `enterInterior`.
- **`check:castle` never touches the scene graph.** It calls the factory
  `buildCeilingBeams(deck)` directly, five times, and measures the returned `InstancedMesh`.
  It never asks whether `BuildingShell` added those beams to a floor group, whether the
  floor groups are in `interiorRoot`, whether walls or flagstones exist at all, or whether
  anything is visible. "4 enclosed storeys" in its success line is
  `TOP_DECK`, a constant — not a count of anything it measured.
  That is the candidate answer to "why is the check green", pending proof.

## Next steps

1. Run `scratchpad/probe.mjs` (path A + path B, screenshots + scene dump).
2. Only then decide outcome 1 / 2 / 3.
