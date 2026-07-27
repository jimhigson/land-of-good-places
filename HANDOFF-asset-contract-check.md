# Handoff — asset contract check (branch `test/asset-height-contract`)

## What this is

A build-time check that every asset's declared `AssetHandle.height` matches the
object the factory actually built, that its base sits at the origin, and that
`root.scale` is still 1. From the architecture review: *a number an author
writes down is a claim; a number derived from the built object is a fact.*

## Shape of the work

- `src/art/style/measure.ts` — new. `visibleBounds(root)` returns `{bottom, top}`
  by walking vertices (not bounding boxes: nested rotations inflate a `Box3`)
  and expanding `InstancedMesh` through `instanceMatrix` (a pet's ears are one
  instanced mesh; walk the geometry alone and the bunny loses them). `visibleTop`
  moved here from `art/models/hair.ts` and is now implemented on top of it —
  import sites updated in `art/models/kid.ts` and `entities/npc/kidCrowd.ts`.
- `scripts/headless-canvas.mjs` — a stub `document`/`window` so model factories,
  which paint canvas textures at construction, can be built in Node.
- `scripts/check-asset-contract.mts` — the check. Runs as `npm run check:assets`,
  wired into `npm run build`.
- `ARCHITECTURE.md` — a short section under the asset contract.

Nothing in the art was moved. Existing deviations are recorded in the script's
`KNOWN_DRIFT` table, which is a ratchet: an asset may not drift further than its
recorded figure, and a new asset gets no allowance.

## What it found (81 assets)

Gross — a number that does not describe the model at all:

| asset | declares | builds | out by |
| --- | --- | --- | --- |
| `spaceTurtle` | 0.520 | 0.738 | **+42%** — the sprout on its shell is not in the sum, exactly like the bunny's ears |
| `prop.tree.tall.*` | 4.07–4.23 | 3.51–3.64 | **−14%** — `tallness` multiplies the whole declared height but only the trunk and canopy pivot are scaled |
| `hat.puff` | 0.358 | 0.492 | **+37%**, and it hovers 30 mm above the crown — both derived from a guessed `PUFF_BALL_RADIUS * 0.92` |

Pets are still not the 1.46 m they claim: kitten −34 mm, mouse −55 mm, puff
−68 mm. Last night's fix closed `sizeToStandard` over a `Box3`, which is the
axis-aligned box of already axis-aligned boxes — every rotation inflates it, so
the sizer scales each pet down slightly too far. A vertex walk fixes it.

Origins off the floor: `keeper` +99 mm (a legless bust — fine behind its counter,
wrong anywhere else), `candy.spookyHouse` +77 mm, `pet.puff` −28 mm,
`prop.tree.*` −135 mm (the root flare is deliberately half-buried).

The rest is 2–8 cm of hand-written drift across biscuit, star, ices, balloons,
several hats and the walls. A tuning conversation, not a licence to move
anything.

## Status

Build green (`npm run build`, exit 0). No browser QA done — this agent does not
own it, and nothing visual changed.
