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

6. `src/art/effects/dustPuff.ts` — an `Anchor` per slot, **turned to face the
   way she is running**, so the drift is `(0, DRIFT_UP, -DRIFT_BACK)` in local
   space and the `scale.y · 0.62` settling squash is along the ground's up.
7. `src/art/effects/flowerSparkle.ts` — the sparkles get an `Anchor` each; the
   **flyer cannot have one** (it interpolates between the flower and wherever
   the player is *this frame*, two different frames), so it asks `upFor` at
   each end instead. 1.55 m of world `+Y` at the rim is 1.09 m of height and
   1.11 m sideways — the bloom parked beside her ear.
8. `src/world/train/puffs.ts` — `upFor` at the funnel, once per puff; the
   sideways wander is projected into the tangent plane. No `Anchor`: a puff is
   an instance matrix and outlives the loco that made it.
9. `src/ui/ActionChips.ts` — the chip's anchor point is lifted along `upFor`.

Looked at in a browser, on seed 11 at ~143 m out: the tap ring, the hop
rainbow, the heel dust and the flower pick all render correctly and throw
nothing. Frames in the scratchpad.

## Next in this lane, and the trap in it

`src/world/interact.ts:254` — `Math.abs(y - zone.y) > ZONE_HEIGHT_TOLERANCE`.
**Do not fix this one alone.** `src/world/tapSpacing.ts`'s `sameStorey(aY, bY)`
is the same rule, exported, and consumed by `test/procgen/invariants.ts`'s
`tapTargetsKeepTheirDistance` as `sameStorey(one.y, two.y)`. Fixing one and not
the other is this repo's single commonest bug. The honest metric is the
perpendicular separation, `|(P − Z) · upFor(Z)|`, which collapses to
`|y − zone.y|` at the park's origin — so make **one** owner take three
coordinates apiece and move all three call sites, invariant included, in the
same commit.

Then `src/world/coaster/clearance.ts` and `castleWindows.ts` (§3.3 — the
identical swept envelope in two files, plus `Coaster.ts:321-329` seating the
cart flat: three disagreeing models of one thing, to be fixed from one frame).
