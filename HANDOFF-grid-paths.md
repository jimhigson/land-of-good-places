# HANDOFF — grid-first path network (the path rework Jim actually asked for)

Branch `feat/grid-paths`, stacked on `feat/park-warp-solver` (#474).
Worktree `.claude/worktrees/park-warp`. Dev port 5611 if needed.

## Jim's brief, verbatim (2 Sep, direct — THE authority; re-read, do not paraphrase)

1. "the player can stand in 'path mess' near the first bridge on the main
   branch" (screenshot: apron knot of overlapping ribbon at the bridge foot).
2. "paths get plotted, then bridges added, but I fundamentally think this
   is the wrong approach ... it souldn't be make paths and then put bridges
   on after the fact, these need to be consdiered together from the start."
3. "they should be on an aproximate grid layout but they end up with twists
   and mini-turns etc that make no sense visually."
4. "the paths don't go up to the door of the hotel or up to the castle
   door, or other attractions reliably."
5. END GOAL: "a park that makes paths that actually go to useful places,
   zero level crossings (the ability to create LC should not even exist)
   and that looks good with things roughly evenly spaced around."
6. "A big-bang rewrite is fine if it fixes the many issues with path
   plotting we currently have."
7. After #474 preview: "I don't understand how this fixes the issues I
   reported ... The path still doesn't go up to the hotel for example."
   → the path rework must include EVERYTHING above; do not stop until
   everything he asked for is ready.

Zero-LC is done (parent branch). THIS branch owes 1, 3, 4 (and the rest of
2 — bridges as first-class citizens of path layout).

## The design

Replace the lattice/street/stub/spur/fallbackSpurRoute plotting stack in
`paths.ts` with a grid-first network:

1. **Grid graph**: an approximate (lightly jittered) axis-aligned grid over
   the park, clipped to the boundary, cell size chosen from the game
   (existing street spacing constant if one exists; measure, don't invent).
   Cells blocked by plots/rail/water removed.
2. **Mandatory nodes, snapped into the grid**: the entrance gate, EVERY
   attraction's door (PlacedEntry.entranceX/Z doormats), and EVERY bridge
   foot (from CROSSING_SITES ramp reaches — the same crossingFeet formula
   paths.ts already owns). **Mandatory edges**: each bridge's
   foot→deck→foot polyline. The rail is crossable ONLY via those edges —
   already true by construction on the parent branch.
3. **Network selection**: connected subgraph of grid edges spanning gate +
   all doors (+ plaza ring attachment), lightly redundant (loops are good
   in a park), detour-bounded. Everything drawn IS a grid edge → no
   mini-turns; doors are terminal nodes → paths go UP TO the door; bridge
   feet are nodes → the apron knot cannot exist.
4. Keep: plaza/promenade ring, paving/ribbon rendering, waypoints, lamps,
   NavGrid interfaces — the rewrite replaces route PLOTTING, not drawing.
   Surveyor mapping paths.ts's public surface + consumers is running
   (report may arrive to a replacement: re-dispatch if lost — task was
   "map the complete public surface of src/world/paths.ts").

## Acceptance (his words → measurable)

- Every attraction door is a path terminal: walk from gate reaches the
  door node ON PAVING for all entries, all 16 pool seeds (extend
  invariants: "every door is a paving endpoint", prove red by mutation).
- No hairpin/apron: inside any bridge footprint the network contains only
  the deck edge and its two feet (invariant; the 59.6m-for-33.4m canonical
  measurement is the historical red).
- Grid-ness: every drawn segment is axis-aligned or a deliberate diagonal
  of the grid (invariant on segment bearings), no turn sharper than the
  grid admits outside the plaza ring.
- All existing gates stay green: test:procgen (583), check:park 16 seeds,
  vet:seeds, full chain. The warp vectors may need re-searching after the
  plotting change (parks change!) — expect to re-run warp-search and
  possibly re-bake; canonical's exhaustion may well DISSOLVE here, since
  the canonical-only failures were all path-shaped.

## State

- [x] Branch created off park-warp head (d9faa0b6 + npc/pet gates).
- [ ] Surveyor report on paths.ts surface.
- [ ] Grid module built (pathGrid solve; grid+mandatory nodes+selection).
- [ ] paths.ts plotting stack replaced, drawing kept.
- [ ] Invariants added (doors, no-apron, grid bearings) + red proofs.
- [ ] 16-seed measurement; warp re-search if needed; full chain; PR.

## Open elsewhere

- #474 blocks on Jim's canonical ruling (widen vs leave pool) — separate.
- Visual QA owed on both PRs; Overseer dispatches.
