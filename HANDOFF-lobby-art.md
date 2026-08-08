# HANDOFF — the lobby's twin-stair composition, art assets

Branch: `art/lobby-twin-stairs` · Worktree: `.claude/worktrees/lobby-art`
Role: **Artist.** Delivers the assets a features agent needs to lay the hotel
lobby out like Jim's reference photo of a grand resort lobby: two mirrored
sweeping staircases rising to a mezzanine **bridge** across the room, a central
archway you can see straight through at ground level, and a cluster-of-pendants
chandelier in the double-height space.

**Nothing here touches `src/world/**`.** The features agent owns the room.

## State: DONE and pushed (`feb7005`)

`npm run blend:hotel` exits 0. `npx tsc --noEmit` exits 0. `npm run build`
exits 0. All three read off the command, never through a pipe.

**No PR** — as briefed, the features agent's lobby rework builds on this branch
and PRs the whole composition together.

**No browser QA.** Judged in `art/renders/hotel/*.png` (Workbench) only. Wants
one look under the real toon ramp, in the lobby, at gameplay distance.

## The API

```ts
createGrandStaircase(handedness: 'right' | 'left' = 'right'): GrandStaircaseHandle
// + handedness, innerRadius, outerRadius, sweep (SIGNED), rise, treads, riser,
//   railHeight, treadTop(i), treadArc(i)
createBridgeRailing(): BridgeRailingHandle   // + tile, railHeight, depth
createBridgeNewel(): BridgeNewelHandle       // + radius
createChandelier(): ChandelierHandle         // + drops (Mesh), spread, lamps
```

Constants exported alongside, so nobody re-types them: `BRIDGE_RAIL_TILE`
(1.02), `BRIDGE_RAIL_HEIGHT` (= `STAIR_RAIL_HEIGHT`, 0.86), `BRIDGE_RAIL_DEPTH`
(0.23), `BRIDGE_NEWEL_RADIUS` (0.134), `CHANDELIER_LAMPS` (12), plus the
existing `STAIR_*`, which **still apply unchanged to both hands**.

Measured through the real factories, `root.scale` 1 on all of them:

| asset | height | bottom | bbox x | bbox z |
| --- | --- | --- | --- | --- |
| `grandStaircase('right')` | 4.348 | −0.022 | −4.419…0.134 | −0.134…4.432 |
| `grandStaircase('left')` | 4.348 | −0.022 | −0.134…4.419 | −0.134…4.432 |
| `bridgeRailing` | 0.938 | −0.020 | −0.530…0.530 | −0.135…0.135 |
| `bridgeNewel` | 1.148 | −0.018 | −0.149…0.149 | −0.134…0.134 |
| `chandelier` | 3.016 | −3.016 | −1.036…1.065 | −0.974…1.091 |

The right-hand flight is **bit-for-bit what shipped on 7 August** — same bbox
to the millimetre. Non-zero `bottom` is the inverted-hull outline standing
proud, as everywhere else. The chandelier's `height` is the **drop** below its
hang point; its top is exactly 0.000, and nothing is drawn above it.

## The mirror convention

Handedness is named for **the climber**, never for a side of the room:

| `handedness` | climbing, you turn | bottom tread | top tread | game yaw |
| --- | --- | --- | --- | --- |
| `'right'` | right | `+Z` from the origin | `−X` | 0 → `+π/2` |
| `'left'` | left | `+Z` from the origin (**the same place**) | `+X` | 0 → `−π/2` |

Origin unchanged for both: **the arc's centre of curvature, on the floor**, not
the foot of the flight. Both authored at `fromAngle = 0`, so `'right'` is
`LOBBY.mezzanine.stair` exactly and needs no rotation; a different start angle
is `root.rotation.y = -fromAngle`.

**Why it is authored and not `scale.x = -1`.** A negative scale flips triangle
winding, `MeshToonMaterial` is `FrontSide`, and the whole flight would be
*culled* — invisible in the game while the mesh, the code and every render of
the original looked correct. That is the critter hoods' fortnight (CLAUDE.md).
`hotel_build.py` sweeps the arc the other way instead and `assert_stairs_mirror`
compares the two emitted meshes **vertex for vertex** at build time, so the
claim is measured. `art/renders/hotel/staircase-mirror.png` is the same proof a
human can do in a glance: both flights left at the origin, seen from *in* the
mirror plane, so a true pair renders exactly left–right symmetric.

### The trap in the left-hand flight, and the thing that removes it

A left-hand flight climbs through **decreasing** angles. `ArcTread.covers`
tests `angle >= from && angle < to`, so subdividing `fromAngle → fromAngle +
sweep` by hand gives ranges in descending order for it, `covers` returns false
everywhere, and what a child meets is a staircase she walks straight through.
Nothing about that is visible in a render.

So: **use `handle.treadArc(i)`**, which returns tread `i`'s span always
ascending, `from < to`, whichever hand it is, with index 0 the bottom tread for
both. `handle.sweep` is signed (`±π/2`) and is the *climbing* direction — the
sign is the whole difference between the two flights, and a caller that reads
`Math.PI / 2` for both places one of them back to front.

## Placing the composition

Put the two origins at `(±C, Zc)`, **`'right'` on the `+X` side** and `'left'`
on `−X`. Each flight's top then swings *inward*:

- the feet stand side by side at `z = Zc + r`, toward the entrance;
- the two tops face each other across a clear `2·(C − STAIR_OUTER_RADIUS)` at
  `z = Zc` — that gap is the bridge's span **and** the archway's width at
  ground level;
- at `C = 7` in the lobby (`halfX = 13`): outer edges at `±11.2`, tops spanning
  `x 2.8…4.62` and `−4.62…−2.8`, a **5.6 m** archway. That is the number
  `art/renders/hotel/staircase-pair{,-front}.png` were rendered at, and it is a
  worked example, not a mandate — pick `C` for the archway you want.

The stair's handrail eases level at `STAIR_RISE + STAIR_RAIL_HEIGHT` (4.06 m),
which is exactly where the bridge's handrail sits when the balustrade stands on
the 3.2 m deck. Butt them. Note `Hotel.ts`'s existing `STAIR_SINK = -0.02`.

## The balustrade tiles, and how not to get a seam

Origin at the **centre** of the segment, on the deck, running along **X** with
the face you look over toward `+Z`. A run along Z is the same tile at
`rotation.y = π/2`.

Place tile `i` at `x0 + (i + 0.5) * BRIDGE_RAIL_TILE`. The handrail and plinth
span the tile *exactly*, so tiles butt face to face and the balusters stay at
even 0.51 m centres straight across every join. The joins do not show because a
90° end cap is over the split-normal threshold, so its outline pushes along ±X
only, *into* the neighbour's solid, where the neighbour hides it.
`hotel_build.py` asserts both ends of both sweeps land on exactly
`±BRIDGE_RAIL_TILE / 2`.

Centre a newel **on** the end of a run (or on a corner) and let the handrail run
into it; `BRIDGE_NEWEL_RADIUS` is how far it reaches past that point. It is the
same post the staircase starts and finishes with, so a bridge that meets a stair
meets it post to post.

0.51 m centres is the **stair's** spacing, not `dressMezzanine`'s 0.62: a bridge
a sweeping stair lands on is that balustrade continuing, and a rail that changes
rhythm at the join is two railings.

## The chandelier

Origin at the **hang point** — the disco ball's exception, fourth documented
case in this asset. Every vertex below `y = 0`; `ceilingAnchor.add(root)` needs
no offset. ~3.0 m of drop, ~2.2 m across. Hung from the top of the lobby's 6.4 m
walls the lowest globe sits ~3.4 m up: above the 3.2 m deck, well clear of a
2.12 m child.

`handle.drops` is all twelve globes in **one** mesh — the node to light from.
They ship with a gentle `emissive` (0.45) so they read as lit the moment they
are added; raise it, or hang a `PointLight` in the cluster, from
`hotel/lighting.ts`. One mesh rather than twelve on purpose: the park's whole
lighting budget is fourteen point lights, so twelve drops were never going to be
twelve lamps, and twelve nodes would have cost ~8 KB of glTF JSON to say so.

## Three things this round got wrong first

1. **The chandelier had a 2.9 m saucer over the whole cluster.** Which is what a
   real ceiling fitting has, and a **lid** over the drops in a game whose camera
   looks down at 38° into an open-topped room. The pet bed's canopy again
   (HANDOFF-hotel-art.md round 2), one render later. It ships as a 0.60 m rose
   with the cords fanning 19°–29° off plumb — a cascade, and the form that
   leaves every drop in view from above.
2. **`npm run blend:hotel` could not fail.** Blender exits **0** on an uncaught
   Python exception: the traceback prints, `save_as_mainfile` never runs, and
   the pipeline goes on to export the *previous* `.blend`, pack it and pass CI.
   Every assertion in `hotel_build.py` — including the ones that exist to catch
   `layout.ts` moving the arc — was until now a check that could not fail. Found
   by watching a genuine assertion fire and the shell report success; fixed with
   a `sys.exit(1)`, and proven by breaking a check on purpose.
3. **The tile-length assertion measured `max(abs(x))`**, which is one number for
   two ends: a handrail deliberately shortened by 2 cm at one end left it green.
   It measures the two ends separately now. Both of these are CLAUDE.md's "a
   check can pass without checking anything", found the only way it ever is.

Also: `Part.emit` now drops faceless edges. `revolve` leaves one behind every
time a profile opens *and* closes on the axis (every bowl, every teardrop) —
they export as nothing, but they are the difference between `assert_closed`
saying "closed solid" and saying "nearly".

## The byte budget moved, and it is not this agent's file

`scripts/pack-hotel-asset.mts`: **512 KB → 640 KB**, arithmetic in the file.
Flagged rather than done quietly, exactly as rounds 2 and 3 flagged the same
edit; the budget line lives there and `npm run blend:hotel` cannot exit 0
without it.

Measured, not estimated: 13,610 tris / 491,696 bytes before, 17,404 / 632,420
after — **+3,794 triangles for +140,724 bytes**, 37 bytes a triangle, the rate
this file has always run at. The mirrored flight is 2,304 of those triangles
(~84 KB), the chandelier 1,296 (~47 KB), the balustrade and its newel 194
(~7 KB). 618 KB / 222 KB gzipped for nineteen factories is ~33 KB each against
the 150 KB one character gets. Headroom is ~23 KB, about 630 triangles —
deliberately not much.

**The one trade worth re-reading before anyone extends this.** Mirroring the
geometry *in code* (negate x, reverse the index order) would also be correct and
would cost zero bytes. It was not taken because the brief asked for an authored
mirror and because an authored one can be **asserted at build time**, which no
runtime flip can be. 84 KB (29 KB gzipped) for a check that cannot lie. It is a
cheap decision to revisit if this file ever gets tight.

## Renders

`art/renders/hotel/`: `staircase`, `staircase-rake` (right, unchanged shots),
`staircase-left`, `staircase-left-rake`, **`staircase-mirror`** (the symmetry
proof), `staircase-pair`, `staircase-pair-front` (the composition at `C = 7`),
`bridge-rail` (three tiles and a newel at each end — the seam shot),
`bridge-newel`, `chandelier`.

`hotel_render.py` grew two things for this: a shot may name a **tuple** of
collections, and `COPIES` makes linked duplicates for one shot so a tiled run
can be judged as a run. One trap it hit: `LAYOUTS` is keyed by shot stem, and
`staircase-pair-front` had no entry, so it silently rendered both flights
**stacked at the origin** — which looks so plausible (a symmetric V of two
mirrored flights meeting at their feet) that it took measuring pixel positions
against projected geometry to notice it was not the composition at all. That
picture is now its own deliberate shot, because overlaid at the origin is the
best mirror check there is.

## Files this agent owns

| File | What |
| --- | --- |
| `art/blend/hotel_build.py` | The authoring source. |
| `art/blend/hotel_export.py` | Untouched this round. |
| `art/blend/hotel_render.py` | Review renders. Not in any npm script. |
| `art/blend/hotel.blend` | **Generated — never hand-edited.** |
| `src/art/assets/hotel.glb`, `hotelGlb.ts` | Generated. |
| `src/art/models/hotelAssets.ts` | Factories, constants, colours, outlines. |
| `scripts/pack-hotel-asset.mts` | Byte budget only, flagged above. |

## Not done

- No browser QA (see above).
- `check-asset-contract.mts` still does not know about any hotel factory — now
  twenty-two parts across nineteen of them. The measured table above is what it
  should see. The chandelier needs `Origin: 'anchor'`-style treatment like the
  disco ball; so does the staircase (centre of curvature).
- Part names changed: `stair-*` are now `stair-right-*`, and `stair-left-*` are
  new. They appeared in exactly three files, all owned here.
