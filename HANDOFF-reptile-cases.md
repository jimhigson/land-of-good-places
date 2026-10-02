# Handoff — Reptile House `cases` kit (3D Artist)

**Model:** Fable 5.1 (`claude-fable-5-1`), chosen by Jim for the whole Reptile
House effort ("Start a new Fable ultracode effort on this"). A replacement
runs the same model.

**Branch:** `feat/reptile-house-art-cases`, based on `feat/reptile-house`
(`795ed178`). **Worktree:** `.claude/worktrees/reptile-art-cases`.

**Role:** 3D Artist, headless Blender only. Asset group §2 `cases` of
`docs/design/REPTILE-HOUSE.md`.

## State: done, awaiting integration

- `art/blend/reptile_cases_build.py` → `art/blend/reptile_cases.blend`
  (16 nodes, 5 674 triangles, budget 6 000; every footprint read from
  `src/world/reptileHouse/layout.ts` through `reptile_constants.py` and
  asserted against the emitted vertices).
- `art/blend/reptile_cases_export.py` → `src/art/assets/reptileCases.glb`
  (154.2 KB, budget 180; byte-identical on re-run; no UVs).
- `scripts/pack-reptile-cases-asset.mts` → `src/art/assets/reptileCasesGlb.ts`
  (`REPTILE_CASES_GLB_BASE64`).
- `art/blend/reptile_cases_render.py` → `art/renders/reptile-cases/*.png`
  (Workbench; colours parsed from `reptileCasesAssets.ts` once it exists,
  `PROPOSED` until then and the banner says so).
- `package.json`: `blend:reptile-cases`, `pack:reptile-cases`,
  `render:reptile-cases`.

**Not done here, by instruction:** the `ASSET_MANIFEST.md` row (text handed
to the integrator in the task's return), the loader
`src/art/models/reptileCasesAssets.ts` (Engineer), glass panes and nameplates
(TypeScript, not in the kit).

## Decisions a successor needs

- Two nodes were added beyond the spec's list, because one node is one
  colour: `rc-case-backboard-relief` (the leaf relief, leaf colour, separate
  from the emissive warm board) and `rc-pier-vine` (leaf colour, separate from
  the stone post) and `rc-grotto-moss` (moss on the Grotto's rock).
- Every grounded node is sunk 0.05 m below the floor with no bottom face
  (`FLOOR_SINK`), so nothing in the kit shares the floor plate's plane.
- The collider always encloses the stone: wall bodies sit `COPING_BULGE`
  inside their radius so the coping's widest point lands exactly on it.
- The nursery glass radius is mesh-owned: it is `rc-nursery-rail`'s XY reach
  (2.400 = `REPTILE_NURSERY_RADIUS − 0.2`); the loader measures it rather than
  being told.
- The case rim closes all the way round (the 38° camera sees its back run
  over the backboard); only the plinth has its back run deleted.
