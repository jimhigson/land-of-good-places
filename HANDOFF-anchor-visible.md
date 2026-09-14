# Handoff: the Anchor migration, visible lane

**Model: Opus 5 (1M context).** Branch `eng/anchor-visible`, worktree
`.claude/worktrees/eng-anchor`, off `feat/sphere-combined`.
Before-build worktree at `.claude/worktrees/eng-anchor-before` (detached at
`714e7d4e`) — delete when done.

## Done and pushed

1. `src/world/up.ts` — **`frameFor(x,y,z,bearing,target)`** and
   **`anchorAt(anchor,x,y,z,bearing)`**. The space-aware constructor for the
   core's `Frame`: outdoors it delegates to `Frame.setFromBearing` (no
   duplicated tilt maths); indoors it skips the lean, because a hotel room is
   six hundred metres out where the radial formula means nothing. `up.ts`
   already owned that branch for `upFor`/`standOnGround`.
2. `src/art/models/tapMarker.ts` — root is an `Anchor`; `show`/`moveTo` set a
   frame. The two `rotation.x = -PI/2` discs are untouched.
3. `src/art/effects/rainbowRing.ts` — an `Anchor` per pooled ring and per
   spark. The `RISE` lift and the stars' compass are now **local** to the
   anchor, so they mean the ground's up for free; the `bases[]` array is gone.
4. `src/world/Highlights.ts` — the fallback highlight ring hangs off a
   `ringAnchor`; visibility moved from the mesh to the anchor.
5. `src/world/DayNight.ts` — the fill light's direction is solved in the flat
   frame into `fillFlatDirection` and rotated onto the player's local horizon
   in `followPlayer`; the `HemisphereLight`'s axis (`position`) is assigned
   there too. At the park origin both are bit-identical to before.

## Measured, with controls

Dev servers: **5422** = after (this branch), **5423** = before (`714e7d4e`).
Both `/spawn?pos=140,45&facing=210&seed=11`, clock pinned to 0.45.

| | tap marker, angle off the ground's own up |
|---|---|
| before build, 135.1 m out | **37.9°** (and 41.1°, 42.3° at other taps) |
| after build, 134.2 m out | **0.00°** |
| control: after build with the Anchor's quaternion forced to identity | **42.2°** — the instrument does report a real number |

Frames: `scratchpad/BEFORE3.png` (the ring is an edge-on pink *sliver* half
buried in the hill) vs `scratchpad/AFTER3.png` (a complete round ring lying on
the grass).

## Red on the branch, not mine

**`feat/sphere-combined` still cannot build the canonical seed** — §0 of
`RADIAL-INVENTORY.md`, unchanged. Thrown from `crossings.ts:432`:
"rail crossings: the drawn paths cross the railway at railD … which snaps to no
proven bridge site". Reproduced in the browser on `20260728` on **both** the
base commit and this branch, so it is not this branch's doing. Seed **11**
builds and is what every measurement above used.

## Next in this lane

`rainbowRing.ts`'s sparks and the highlight ring have not been *looked* at yet
(measured only). Then `flowerSparkle.ts`, `train/puffs.ts`, `dustPuff.ts`,
`ActionChips.ts`, `interact.ts` — all §3.1 of `RADIAL-INVENTORY.md`.
