# Water fight mini-game — progress

Worktree: `.claude/worktrees/water-fight` · branch `feat/water-fight` (from `origin/main` @ df84993)
**NOTE:** the first worktree (`agent-a7209371928b2e682`) was culled mid-read; recreated from scratch.
Bash cwd resets between calls — always use absolute paths.

## Done

- `npm ci`, branch, docs + RailRacer worked example read.
- All modules written under `src/minigames/waterFight/`:
  `arena.ts` (layout + collision data), `garden.ts` (world + sky), `water.ts` (droplets,
  ground rings, air-wetness), `rainbow.ts` (vertex-coloured arch), `child.ts` (kid + very big
  water gun + drippy soaked hair), `controls.ts` (own key/pointer listeners), `hud.ts`,
  `score.ts` (session best), `plot.ts` (park-side dressing), `WaterFight.ts` (the game).
- Shared files touched, exactly as scoped: ONE row + one import in `src/minigames/stalls.ts`;
  ONE block + one import in `src/world/World.ts`.
- `npm run build` GREEN (tsc strict clean first time).

## Decisions

- **Entry**: stall booth at world `[-27, 21.5]`, facing 1.1 rad, standing *inside* the
  waterFight anchor plot. `dressWaterFightPlot` hides the placeholder and puts a real
  "Water Fight!" sign back at the same spot (the placeholder's collision circle stays,
  so a solid sign has to stay too or the park grows an invisible post).
- **Session best** lives in `waterFight/score.ts`, not `state/store.ts` (shared file,
  parallel PRs, no action exists yet). Documented in the file.
- **Two framing yaws**: 45° landscape, 88° portrait, so a phone held upright looks down the
  garden's long axis instead of across it. Frustum fits the walkable lawn + child height +
  rainbow top; never crops.
- **Input**: own `window` capture-phase listeners for WASD/arrows + pointer. Pointer takes
  precedence over `MiniGameInput.hold` (the framework folds "finger down" into `hold` too,
  so reading both would double-fire).
- **Auto-aim always hits** — shots re-solve their ballistic arc each frame onto the moving
  target. Missing is not a skill this garden teaches.
- Framework's "HOLD to go!" pad hidden via `body[data-waterfight]` + one CSS rule; restored
  on dispose.

## Next step

Browser verification (tap + keyboard squirt, splash-back, soaked hair, rainbow, points/best,
exit, portrait, console), screenshots to `art/renders/waterfight-*.png`, then PR.
