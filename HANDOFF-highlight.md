# Handoff — item 1.2, the HIGHLIGHT RULE

Branch `feat/highlight-rule`, worktree `.claude/worktrees/highlight-rule`.
Build passes (`npm run build`, exit 0). Not visually QA'd — see the PR.

## What the rule now says (GAME_DESIGN.md is updated, it is the record)

Everything interactable — **in the park and in the interface** — is outlined in
rainbow when it is about to be used:

- **mouse:** on hover, plus `cursor: pointer`;
- **keyboard/pad:** whatever E would use, while E is primed (no cursor change);
  and in the DOM, whatever has `:focus-visible`;
- **on activation** (tap, click, or key — any input method): the same rainbow
  radiates outward for ~0.55 s with particles. This is the phone story: no
  hover exists there, so this is the only confirmation a tap landed.

## THE REGISTRATION API — the thing to preserve

`src/world/highlight.ts`

```ts
export interface HighlightTarget {
  readonly object: Object3D;      // a mesh or a whole group
  readonly instanceId?: number;   // set only for one instance of an InstancedMesh
}

export function highlightObject(object: Object3D): HighlightTarget;
export function highlightInstance(mesh: InstancedMesh, instanceId: number): HighlightTarget;
```

`InteractZone` gains **one optional field**: `highlight?: HighlightTarget`.
`SignZone` gains `object: Object3D` (free — `collectSignZones` already held the mesh).

**A zone that supplies nothing is still highlighted**: a rainbow ring on the
ground at `x/y/z` with radius `pickRadius`. That fallback is what makes the rule
automatic — registering a tap target *is* registering a highlight, and no future
call site can forget. Supplying `highlight` upgrades the ring to a true outline
of the silhouette. Both are the same rainbow, so they read as one system.

Registering a new interactable therefore costs nothing, and upgrading one costs
one line:

```ts
zones.push({ id: 'thing', /* … */, highlight: highlightObject(this.group) });
```

## How it draws

- `src/art/effects/rainbowOutline.ts` — inverted hull, exactly like the ink
  outlines: every `castShadow` mesh under the target is merged **once** into one
  shell geometry (cached per object), pushed along its normals in local metres,
  drawn `BackSide` with `depthWrite: false`. A target with nothing solid under
  it (the shop-sign boards are `castShadow = false`) falls back to everything
  visible. Nothing is ever scaled: `root.scale` is squash-and-stretch and
  `body.scale` is `applyWalk`'s, so the shell is a separate mesh carrying a
  **copy** of the target's world matrix, never a child of it.
- One shared `MeshBasicMaterial` with a canvas rainbow strip (`ART.rainbow`,
  plum separators between bands so it reads on pale sand in daylight as well as
  on dark grass at night; unlit, so day and night look the same). The sweep is
  `map.offset.x` — no shader, and every highlight on screen stays in step.
- `src/world/Highlights.ts` — the system. **Three slots allocated at
  construction: hover, primed zone, primed sign.** At most three extra draw
  calls a frame however big the park grows.
- Instanced targets compose `mesh.matrixWorld * instanceMatrix[i]` and share one
  shell across every instance (the flowers: 400 zones, 1 geometry).
- Activation flash: `createRainbowRings()` (the hop rainbow's own pool, reused)
  + `createRainbowSparks()` (new, same file, same `ART.rainbow`). Pooled; nothing
  allocates per tap.
- DOM: one global rule at the top of `src/style.css` over
  `button, summary, a[href], [role=button]` for the steady outline (`:hover` and
  `:focus-visible`, `cursor: pointer` on hover only), and `src/ui/TapBurst.ts` —
  one delegated `click` listener plus a pool of four overlay elements — for the
  flash. `click` is used deliberately: finger, mouse and Enter/Space on a focused
  button all raise it, so the rule covers every input method with one handler.
  The rainbow (`--lgp-rainbow`) and the sweep (`6.25s = 1 / SWEEP_SPEED`) are
  the same numbers as the 3D half, on purpose.

## Wiring

- `PointerControls.onHover` (new, mouse only) → `Highlights.setCursor`.
- `ActionButton.zone` / `SignReader.nearby` (new getters) are the "primed" source
  — read rather than re-derived so the pill and the outline cannot disagree.
- `TapNavigator.destinationZone` (new getter) → flash on the tap itself.
- `Game.currentZones()` memoises the per-frame zone list (it was being rebuilt
  three times a frame, ~450 objects each); `Game.uiOwnsTheScreen()` is now the
  one definition of "a panel owns the screen", shared by three systems.

## What is left

- Targets registered so far: the stalls, the face-paint stall, the flowers
  (instanced). Everything else — building shops/lift/stairs/toilets/grown-up,
  climbable trees, train stations, the front door — is on the ring fallback and
  reads fine. Each is one line away from an outline.
- The trees and the crowd are instanced with no per-instance handle exposed
  (`Scenery.climbableTrees` has no mesh reference); giving `ClimbableTreeSeed` a
  `{ mesh, index }` would let trees use `highlightInstance`.
- Visual QA not done (no browser). See the PR for the list.
