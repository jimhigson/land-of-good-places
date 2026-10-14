# HANDOFF — The Library, foundation second half (epic #714; plan Steps 3, 4 + the real-child harness)

Branch `feat/library-714-assets` (from 009dea3e, the foundation head), worktree
`.claude/worktrees/library-714-assets`. Engineer, Claude Opus 5.5. The orchestrator merges this
branch into `feat/library-714`; **never push to `feat/library-714` or `feat/library` from here.**
Plan: `library-plan-parts-4-5.md` in the orchestrator scratchpad (Steps 3, 4, Step 6's "Checks").
Stay off the first half's files: props.ts, layout.ts, libraryLines.ts, check-copy-brevity.mts,
HANDOFF-library-714.md.

## Status
- [x] worktree, `pnpm install --frozen-lockfile` (pnpm/12.1.0, node v26.5.0), branch pushed
- [x] Step 3a: `LIBRARY_GLB_STYLES` exported (the building's STYLES, renamed), `libraryKitMesh` (c6ec7f5c)
- [ ] Step 3b: `libraryFaces.ts`, `libraryCreatures.ts`, readerAssets' dragon colours
- [ ] Step 3c: check:assets x5, check-library PAINTED FACES + the LIBRARY_CHECK_MUTATE allow-list
- [ ] Step 4: `/library?at=<desk stand>` check-deep-links entry with facing; reds
- [ ] WITH A REAL CHILD harness + its clause + red
- [ ] final: tsc, typecheck:test, check:library, check:assets, check:deep-links, check:served-deep-links

## Parks, locally
Only `src/art/models/libraryAssets.ts` is a park-closure edit in this task (measured with
`parkSourceClosure`: libraryAssets.ts IN; readerAssets.ts, check-library.mts,
check-asset-contract.mts, check-deep-links.mts, main.ts, Game.ts OUT; the new
libraryFaces.ts/libraryCreatures.ts are imported by no closure file). Source hash after c6ec7f5c:
`94225e989746ab584747672e0385ff5671dadf3ac0386c5865f61872a54882bf`.
`LGP_SEEDS=5 LGP_RESTART_LANES=4 pnpm run build:parks` was started on it (log:
orchestrator scratchpad `assets714/build-parks-5.log`).

## Decisions (with reasons)
- **One table, one decode, one dresser.** `libraryKit.ts` already decodes the glb once and
  `libraryAssets.ts` already dressed all 65 nodes from a private STYLES table. So the plan's
  `libraryKit()`/`loadReptileKit` is NOT added (it would be a second decode); STYLES is renamed and
  exported as `LIBRARY_GLB_STYLES`, and the existing dresser is exported as `libraryKitMesh(name,
  material?)`. Existing callers build byte-identical meshes (kitMesh unchanged in behaviour).
- **Outlines: the building's table is kept**, not the plan's parenthesised figures. The plan's
  `cat-* (0.016)` breaks ART_DIRECTION §2 (small creatures 0.010–0.014; the cat is 0.35 m), and
  the owl's 0.02 vs the plan's 0.016 are both inside the kid/prop range. House rule decides; the
  only colour change is the plan's one: `dragon-wings` → `ART.miniLilac`.
- **The render script's regex**: it reads every `name: { ... colour: PALETTE|ART.key` in
  libraryAssets.ts's text, so no example row may appear in a comment there (a comment written that
  way would have made `library_render.py` assert on `PALETTE.key`). Verified: 77 rows before and
  after, only dragon-wings changed.

## For the join
