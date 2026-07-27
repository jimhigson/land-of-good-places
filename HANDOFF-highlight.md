# Handoff — item 1.2, the HIGHLIGHT RULE

Branch `feat/highlight-rule`, worktree `.claude/worktrees/highlight-rule`.

## What it is

Everything interactable is outlined in a rainbow: on **hover** (mouse), and on
whatever **E** would use right now (keyboard/pad/touch pill), while it is primed.
Built once, as a system every interactable already registers with.

## The API (decided — later features depend on it)

`src/world/highlight.ts`

```ts
export type HighlightTarget =
  | { readonly object: Object3D }                                  // a mesh or a whole group
  | { readonly object: InstancedMesh; readonly instanceId: number } // one instance

export function highlightObject(object: Object3D): HighlightTarget
export function highlightInstance(mesh: InstancedMesh, instanceId: number): HighlightTarget
```

`InteractZone` gains **one optional field**: `highlight?: HighlightTarget`.
`SignZone` gains `object: Object3D` (free — `collectSignZones` already has the mesh).

**A zone that supplies nothing still gets highlighted** — a rainbow ring on the
ground at `x/y/z` with radius `pickRadius`. That fallback is what makes the rule
automatic: nobody can forget it, and a new interactable inherits it for free.
Supplying `highlight` upgrades the ring to a true rainbow outline of the shape.

## How it draws (`src/world/Highlights.ts`, `src/art/effects/rainbowOutline.ts`)

- Inverted hull, exactly like the ink outlines: every `castShadow` mesh under the
  target is merged once into ONE shell geometry (cached per target object), pushed
  along its normals in local metres, drawn `BackSide` with `depthWrite: false`.
  Nothing is ever scaled — `root.scale` and `body.scale` are untouched.
- One shared `MeshBasicMaterial` carrying a canvas rainbow strip (`ART.rainbow`,
  plum separators between bands so it reads on pale sand as well as at night).
  The sweep is `map.offset.x`, so the animation costs nothing per frame.
- **Three slots, allocated at construction: hover, primed zone, primed sign.**
  At most 3 extra draw calls in the whole frame, whatever the interactable count.
- Instanced targets (the flowers) compose `mesh.matrixWorld * instanceMatrix[i]`
  and share the one shell geometry across every instance.

## Wiring

- `PointerControls.onHover` (new, mouse only) → `Highlights.setCursor`.
- `ActionButton.zone` / `SignReader.nearby` (new getters) are the "E is primed" source.
- `Game.currentZones()` memoises the per-frame zone list — it was being rebuilt
  three times a frame (~450 objects each), now once.

## State

Done and building. Targets wired: stalls, face-paint stall, flowers (instanced).
Everything else (building shops/lift/stairs, trees, train) is on the ring fallback
— upgrading one is a one-line `highlight:` on its zone.
