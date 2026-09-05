# Handoff — the park entrance arch (3D Artist)

Branch `art/gate-arch-asset`, worktree `.claude/worktrees/gate-arch-asset`.

## What it is

Jim, 2026-09-03: *"a decorative arch, designed in Blender, with a project logo
of a ferris wheel and 'LAND OF GOOD PLACES' written onto it"*, and on the logo:
*"yeah it is fine to just be a texture for the design"*.

Delivered: two pink piers, a segmental arch band with nine lemon bobbles along
its top, a hanging cream plank lettered LAND OF GOOD PLACES, and a ferris-wheel
roundel on a collar above the apex.

## Status

Done and rendered. **Not merged, not placed** — it is a visible change, so it
waits for Jim.

| file | what |
|---|---|
| `art/blend/gate_arch_build.py` | authoring source; asserts every size against the emitted vertices |
| `art/blend/gate_arch_export.py` | → `src/art/assets/gateArch.glb` (63 KB, budget 120 KB) |
| `scripts/pack-gate-arch-asset.mts` | → `gateArchGlb.ts` |
| `src/art/models/gateArch.ts` | colour table, both canvas painters, `createGateArch()` |
| `gate-arch.html` + `art/samples/gateArch.ts` | the render page; also openable by hand |
| `scripts/render-gate-arch.mts` | Playwright driver → `art/renders/gate-arch-*.png` |

`pnpm run blend:gate-arch` (build → export → pack), `pnpm run render:gate-arch`.

## The numbers, and who owns each

- **`src/world/entrance/layout.ts`** owns the gateway. The build script reads
  `ENTRANCE_GATE_HALF_WIDTH` (4.3) and `ENTRANCE_GATE_POST_HEIGHT` (3.3) with
  `ts_const`; `gateArch.ts` re-measures the shipped mesh against them at load
  and **throws** if they have moved. A rigid `.glb` of a gateway the park sizes
  for itself can go stale — it must not go stale quietly.
- **The mesh** owns every shape number. `gateArch.ts` derives
  `GATE_ARCH_PIER_KEEP_OUT`, `GATE_ARCH_CLEAR_WIDTH`, `GATE_ARCH_CLEAR_HEIGHT`,
  `GATE_ARCH_LOGO_CENTRE_Y` and both canvas aspect ratios from the vertices.
- **`gateArch.ts`** owns colour and paint. The `.glb` has neither.

Measured, printed on every build run: **8.16 m** tall, **7.00 m** clear opening,
**+0.630 m** of headroom over `TALLEST_CHILD_HEIGHT` under the plank, 2 492
triangles, 5 nodes.

## For whoever places it

`createGateArch()` → `AssetHandle`. Origin is **the middle of the gateway, on
the ground**; forward is **+Z, out of the park at the arriving child** (the
lettering faces her). `root.scale` untouched.

```ts
const arch = createGateArch();
arch.root.position.set(ENTRANCE_GATE_X, terrainHeight(ENTRANCE_GATE_X, ENTRANCE_GATE_Z), ENTRANCE_GATE_Z);
arch.root.rotation.y = <yaw so +Z points out of the park>;
```

**Collider: two circles, radius `GATE_ARCH_PIER_KEEP_OUT` (0.80 m), at
`x = ±ENTRANCE_GATE_HALF_WIDTH` in the arch's frame, and nothing else.**
Everything else is over 3.5 m up. That leaves `GATE_ARCH_CLEAR_WIDTH` = 7.00 m
of floor through the gateway, so it cannot block the way in — but the placer
still owes a reachability check against `keepOutsFor`, with a control run on the
instrument first (CLAUDE.md).

**Two owners of the old arch, and this replaces both.** `Entrance.ts` (~line
311) builds posts + a `TorusGeometry` crossbar named `park-gate-arch`, and
`BusJourney.ts` (~line 1498) builds a second, differently wrong copy. Whoever
lands this should give the arch **one owner both call**. Note
`scripts/check-park-map.mts` finds the gate by the scene name
`park-gate-arch` — that name has to survive, on a node that is still centred on
the gateway.

A separate agent was fixing the existing crossbar's orientation and collider on
its own branch; **nothing here touches `Entrance.ts` or `BusJourney.ts`.**

## Two traps, both invisible to every assertion, both found by looking

Worth reading before you paint the next authored surface.

1. **Blender's glTF exporter writes `1 − v`** (glTF's texture origin is top
   left, Blender's is bottom left). A `v` authored climbing with height arrives
   climbing downward, and the sign ships upside down while the mesh, the canvas
   and the UV layout are each individually correct. Author `v = (hi_z − z)/h`.
2. **`blendkit.revolve` cannot carry a painted surface.** Its profile closes on
   the axis, leaving degenerate faces at each pole; `Part.emit`'s
   `remove_doubles` collapses them, the polygon indices shift, and `Part`'s
   per-face UV table — keyed by index — lands on the wrong polygons. The roundel
   came out smeared into radial wedges. Fixed with `paint_planar_uvs()`, which
   computes UVs from **where each vertex is**, after emit. A UV that is a
   function of position cannot be given to the wrong face. `plate()` in the same
   file is the poleless builder for a flat round part.

Both are in `ASSET_MANIFEST.md` §34 as well, because the next kit will hit them.

## Left undone

- **Not placed in the world.** Deliberate: `Entrance.ts` is somebody else's live
  fix.
- **`pnpm run check` / `test:procgen` / `check:coplanar` not yet run to
  completion on this branch** — nothing here is reachable from the park yet, so
  none of them can see it, but they should be run before any PR that places it.
- No fairy lights on it. The bobbles are the obvious mount if Jim wants the gate
  to light up at dusk; `GATE_ARCH_LOGO_CENTRE_Y` is exported for a lamp on the
  roundel.
