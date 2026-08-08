# HANDOFF — the lobby's imperial staircase, art assets

Branch: `art/lobby-twin-stairs` · Worktree: `.claude/worktrees/lobby-art`
Role: **Artist.** Delivers the assets a features agent needs to lay the hotel
lobby out like Jim's reference photo of a grand resort lobby.

**Nothing here touches `src/world/**`.** The features agent owns the room.

## State: DONE and pushed

`npm run blend:hotel` exits 0. `npx tsc --noEmit` exits 0. Every check in
`npm run build` passes **except `check:hotel`**, which fails with four problems,
all of them the same one: the room still builds the ten-tread, full-height
flight this asset no longer is. `npx vite build` and every check after it pass.
See *"The build is red until the room is rebuilt"* below — it is the first thing
the features agent has to do, and the numbers it needs are all here.

No PR, as briefed.

## The change — Jim, 8 August 2026, on the twin-sweep renders

> *"Make the curved stairs reach an intermediate floor that then turns into a
> single, wide straight staircase up to the true level."*

An **imperial** composition. Three flights instead of two:

| | rise | treads | what it is |
| --- | --- | --- | --- |
| `createGrandStaircase('right')` | 0 → 1.6 | 5 | a 45° curve, floor to the landing |
| `createGrandStaircase('left')` | 0 → 1.6 | 5 | its exact mirror |
| `createStraightStaircase()` | 1.6 → 3.2 | 5 | 3.6 m wide, landing to the true level |

Look at `art/renders/hotel/staircase-assembly-front.png` first: that elevation is
the whole design in one picture.

### The riser never moved, so the sweep did

`STAIR_RISER` = 0.32 m is half the game's `BUILDING_STEP_UP` and is now the
**owner**: both tread counts derive from it. Halving a flight's rise therefore
halves its tread count — and five treads spread over the old 90° arc would have
been **1.04 m deep** at mid radius, a 17° pitch, which is a ramp with occasional
steps rather than the 32° stair Jim approved. Every constant in the file (the
waist, the nosing chamfer, the string's easing, the baluster pitch) is tuned to
that rake.

So the arc halved with the rise, to **45°**, and the going at mid radius comes
out at exactly the 0.5184 m it has always been. Measured: pitch 31.69°, going
0.51836, against the old flight's 0.51836. It is the same staircase, half as
long.

### Constants, and the one relationship

```py
STAIR_RISE      = 3.20                          # the true level (LOBBY_MEZZANINE_Y)
STAIR_RISER     = 0.32                          # half BUILDING_STEP_UP — the owner
LANDING_HEIGHT  = 1.60                          # the intermediate floor
STRAIGHT_RISE   = STAIR_RISE - LANDING_HEIGHT   # ← one relationship, never two literals
STAIR_TREADS    = round(LANDING_HEIGHT / STAIR_RISER)     # 5
STRAIGHT_TREADS = round(STRAIGHT_RISE / STAIR_RISER)      # 5
STRAIGHT_GOING  = STAIR_MID_R * STAIR_SWEEP_ANGLE / STAIR_TREADS   # the curve's own going
STRAIGHT_WALK_W = 2 * (STAIR_OUTER_R - STAIR_INNER_R)     # both curves gathered: 3.6 m
BALUSTER_PITCH  = 0.51                          # now the owner; BRIDGE_RAIL_TILE derives from it
```

`assert_flights_meet()` then measures the same relationship **off the two
emitted meshes** — curve top, straight foot, and the two tops summing to
`STAIR_RISE`. A derivation proves the arithmetic; only a measurement proves the
geometry. Both are needed and neither is enough: see *"three checks, broken on
purpose"*.

## The API

```ts
createGrandStaircase(handedness: 'right' | 'left' = 'right'): GrandStaircaseHandle
// + handedness, innerRadius, outerRadius, railRadius, sweep (SIGNED), rise (= LANDING_HEIGHT),
//   treads, riser, railHeight, treadTop(i), treadArc(i)

createStraightStaircase(): StraightStaircaseHandle
// + walkWidth, width (measured), run, going, rise (= STRAIGHT_RISE), treads, riser,
//   railHeight, treadTop(i), treadFront(i)

createLandingNosing(): LandingNosingHandle          // + tile, bite, reach
createBridgeRailing(): BridgeRailingHandle          // + tile, railHeight, depth
createBridgeNewel(): BridgeNewelHandle              // + radius
createChandelier(): ChandelierHandle                // + drops (Mesh), spread, lamps
```

New exported constants: `LANDING_HEIGHT` (1.6), `STRAIGHT_RISE` (1.6),
`STRAIGHT_TREADS` (5), `STRAIGHT_GOING` (0.5184), `STRAIGHT_RUN` (2.5918),
`STRAIGHT_WALK_WIDTH` (3.6), `STAIR_RAIL_RADIUS` (4.27), `LANDING_NOSE_BITE`
(0.06), `LANDING_NOSE_PROUD` (0.008), `LANDING_NOSE_REACH` (0.062),
`LANDING_NOSE_DROP` (0.15).

**Changed values** — read these before you trust anything you remember:
`STAIR_SWEEP` π/2 → **π/4**, `STAIR_TREADS` 10 → **5**, and
`GrandStaircaseHandle.rise` 3.2 → **1.6** (it is the flight's own rise, which is
now the landing). Code that meant "the height of the gallery" wants `STAIR_RISE`.

### Measured through the real factories, `root.scale` 1

| asset | height | bottom | bbox x | bbox z |
| --- | --- | --- | --- | --- |
| `grandStaircase('right')` | 2.748 | −0.022 | −3.166…0.134 | 1.554…4.432 |
| `grandStaircase('left')` | 2.748 | −0.022 | −0.134…3.166 | 1.554…4.432 |
| `straightStaircase` | 2.748 | −0.022 | −2.032…2.032 | −2.726…0.134 |
| `bridgeRailing` | 0.938 | −0.020 | −0.530…0.530 | −0.135…0.135 |
| `bridgeNewel` | 1.148 | −0.018 | −0.149…0.149 | −0.134…0.134 |
| `landingNosing` | 0.024 | −0.166 | −0.526…0.526 | −0.076…0.078 |
| `chandelier` | 3.016 | −3.016 | −1.036…1.065 | −0.974…1.091 |

Non-zero `bottom` is the inverted-hull outline standing proud, as everywhere
else. The curve's bbox is **unrotated** (`fromAngle = 0`); at the recipe's
`fromAngle = ±π/4` the x and z extents swap — see below. The nosing's origin is
on the edge *line*, so its `height` is how far it stands proud of the floor and
its `bottom` how far it hangs down the face.

## The placement recipe

Everything is relative to the two arcs' centres, at `(±C, Zc)` on the floor,
**`'right'` on the `+X` side** and `'left'` on `−X`, exactly as before.

### 1. Rotate both curves so their tops arrive square

```ts
right.root.position.set(originX + C, floorY, originZ + Zc);
right.root.rotation.y = -Math.PI / 4;        // fromAngle = +π/4
left.root.position.set(originX - C, floorY, originZ + Zc);
left.root.rotation.y = +Math.PI / 4;         // fromAngle = -π/4
```

`fromAngle = ±(π/2 − STAIR_SWEEP)`. **This is the one placement fact that is new
and it is not optional.** With a 45° sweep you can have the foot square to the
room or the top square to the landing, and not both; the tread that meets the
landing is the join that must not arrive at an angle. A floor takes a stair at
any angle. A landing does not.

Rotated, each flight occupies, relative to its own origin:

- `x` −4.432…−1.554 (right hand; mirrored for left), `z` −0.134…+3.166.

So with origins at `(±C, Zc)`: the two flights fill `x ±[C−4.432, C−1.554]`,
reaching from `z = Zc − 0.134` (their tops, at the landing) out to
`z = Zc + 3.166` (their feet, toward the entrance, angled inward).

### 2. Choose C so the landing's front balustrade is whole tiles

```
C = STAIR_RAIL_RADIUS + n · BRIDGE_RAIL_TILE / 2        // n tiles between the two top newels
```

The two curves' **top newels** stand at `x = ±(C − STAIR_RAIL_RADIUS)`,
`z = Zc`, and they are the two ends of the landing's front run. A part-tile is
the one thing that run cannot do.

**Worked at n = 6, `C = 7.33`** — the numbers in every `staircase-assembly*`
render:

| | value |
| --- | --- |
| front balustrade run, newel to newel | 6.12 m = **6 tiles** |
| gap between the two top *treads* | 6.26 m |
| gap between the two flights' *masses* — the archway width | **5.80 m** |
| landing half width, `C − STAIR_INNER_RADIUS` | ±4.93 m |
| composition overall width, `2·(C − 1.554)` | 11.55 m |

The landing's floor at ±4.93 laps 3 cm into each curve's inner string, which is
the same `STAIR_STRING_BITE` overlap the string was designed with — overlapping
solids, never coincident faces.

### 3. The landing, and where the straight flight's foot sits

The landing is a platform at **`LANDING_HEIGHT` = 1.6 m**, its front edge on
`z = Zc` (where both curves' top treads end), running back to the gallery.

```
LANDING_BACK  = 5 · BRIDGE_RAIL_TILE = 5.10 m     // front edge → the gallery's face
LANDING_DEPTH = LANDING_BACK - STRAIGHT_RUN = 2.508 m   // front edge → the flight's foot
```

Five tiles back is a choice, not a law: it makes each **side** edge a whole run
too, and it leaves 2.508 m of landing in front of the flight — comfortably more
than a flight is wide (2.14 m), which is the rule of thumb for turning on one.

```ts
straight.root.position.set(originX, floorY + LANDING_HEIGHT, originZ + Zc - LANDING_DEPTH);
// no rotation: it climbs toward −Z, away from the entrance, which is the composition
```

Its origin is the **centre of its bottom riser, on the landing**. It then
occupies `x ±2.032`, `z` from `Zc − LANDING_DEPTH + 0.134` (the bottom newels
reaching back — a post stands *on* the end of a run, not beyond it) to
`Zc − LANDING_BACK` (its top tread, level with the gallery).

**The platform has to be under all of it.** The flight's strings stop at its own
`y = 0`: it stands on the landing, it is not solid to the lobby floor the way
the curves are. So the 1.6 m platform must carry back the whole `LANDING_BACK`,
not just `LANDING_DEPTH` — or the flight needs a podium of its own. It is the
one thing here that can be got wrong and not seen: the flight would float,
correctly lit, over nothing.

Carrying the platform back the full 5.10 m at its full ±4.93 width is the
cheaper and better answer anyway: it leaves a 2.90 m strip of floor at 1.6 m
either side of the flight (somewhere to put a plant, a bench, a guest) and it
makes each side balustrade one clean five-tile run from the front corner to the
gallery.

### 4. Meeting the gallery at 3.2

The straight flight's top tread **is** the deck edge: its top is
`STRAIGHT_RISE` above the landing, i.e. `STAIR_RISE` above the floor, at
`z = Zc − LANDING_BACK`. Its strings and both handrails ease level over that
last tread, exactly as the curve's do, so the deck's own balustrade butts them
post to post — the flight's two top newels are already standing on the deck.
`Hotel.ts`'s existing `STAIR_SINK = -0.02` applies to all three flights.

The gallery's balustrade therefore wants a **gap of the flight's overall width**
(4.02 m, 4.064 with the outline) centred on `x = 0`, with a newel each side.

### 5. The balustrade schedule

Everything below is `createBridgeRailing()` tiles at `BRIDGE_RAIL_TILE` pitch
with `createBridgeNewel()` on the ends, set **in from the edge by half the
rail's depth** (0.115) so its outer face lands on the edge:

| edge | run | tiles | newels |
| --- | --- | --- | --- |
| landing front, between the curves' tops | 6.12 m | 6 | none — the curves' own top newels are the ends |
| landing side, ×2 | 5.10 m | 5 | one at each end |
| gallery front | the room's | — | one each side of the flight |

Tile `i` of a run goes at `start + (i + 0.5) · BRIDGE_RAIL_TILE`. The front
run's ends need no newel of their own: the curve's top newel is 0.134 across and
swallows the handrail's end cap (0.115 away), which is a rail dying into a post.
Two posts in one place is a lump — the assembly renders were laid out this way
and it reads correctly.

### 6. What is left underneath, and it is not a doorway

**Say this to Jim before the room is built.** The old composition had a 3.2 m
archway you could walk through under the bridge. The landing is at 1.6 m, so
what remains beneath it is a **5.80 m wide, 5.10 m deep recess with 1.6 m of
headroom** — less the platform's own thickness. A 2.12 m child cannot walk
through it.

That is arithmetic, not a modelling choice: half of 3.2 is 1.6, and 1.6 is below
head height. The options, in the order I would take them:

1. **Treat it as a solid mass with an arched niche** — which is what a hotel
   does under a half-landing (a mirror, a console, a lit alcove). The
   composition still reads as an arch from the lobby, and nothing has to move.
2. Raise the landing and re-split the treads: at `LANDING_HEIGHT = 2.24`
   (7 curve treads + 3 straight) the recess clears 2.24 m and a child walks
   under it — but the curves grow back to a 63° sweep and the straight flight
   becomes a three-tread step, which is much less of a finish.
3. Leave it open and low, and accept that the see-through is now *over* the
   landing rather than under it.

The assets support all three: `LANDING_HEIGHT` is one line and everything
derives from it.

## Landing trim — the answer to "do the existing tiles suffice?"

**For the balustrade, yes.** Every open edge of the landing is a straight run at
a single height, which is exactly what `createBridgeRailing()` + `createBridgeNewel()`
are for, and the tile pitch is now derived from `BALUSTER_PITCH` so the rhythm
is identical across the curve's rail, the straight flight's rails and the
landing's. The only constraint is that runs between newels are whole tiles,
which is what §2 and §3 above buy with `C` and `LANDING_BACK`.

**For the edge itself, no — that is the new piece.** `createLandingNosing()`:
one 1.02 m tile (the balustrade's own pitch, so one loop can lay both), a
bullnose lip that overhangs the face by 0.062 and hangs 0.15 m down it, laying
along the edge line with the platform's colour behind it. Without it the landing
is a code-built box whose front face a child looks straight at from the lobby
floor, and nine metres of flat colour under a balustrade is the one thing left
in this composition that reads as programmer-art.

It is deliberately **not** a second plinth: the balustrade already brings a
moulded kerb and two mouldings side by side is a wedding cake. Place the nosing
on the edge and stand the balustrade behind it; the nosing's lap ends up buried
under the plinth, which is the point.

**Why it stands 8 mm proud.** A moulding whose top is coplanar with the slab it
caps gives the depth buffer two faces in one plane over the whole lapped band.
`LANDING_NOSE_PROUD` buries the slab's own top face inside solid geometry
instead. It is `STAIR_STRING_BITE`/`UPSTAND` at a tenth of the size. Walk
surfaces are registered by code, so nothing steps on it.

## The build is red until the room is rebuilt

`npm run check:hotel` fails with exactly four problems, and all four are one
fact — `layout.ts` still describes a ten-tread flight climbing 3.2 m:

```
✗ sweeping-stair tread 5 does not rise: sample says 0.00 m, standing on 1.44 m
✗ the sweeping stair tops out at 1.44 m but the deck is at 3.20 m
✗ sprinting up the stair's own spiral ends at y=0.00 m, not the deck's 3.20 m
✗ pushing west across the stair fan leaves a player at y=0.00 m
```

(1.44 m and not 1.60 m because `Hotel.ts` samples the fourth of its four walk
slices; the flight itself measures 1.600 exactly.)

Everything else in `npm run build` passes, including `tsc`, `check:assets`,
`check:park` and `vite build` — verified by running the remainder of the chain
by hand after `check:hotel` (exit 0).

What the room now needs, in `src/world/hotel/`:

- `layout.ts`: `LOBBY.mezzanine.stair` → `treads: 5`, `toAngle: fromAngle ± π/4`,
  two of them at `(±C, Zc)` with `fromAngle = ±π/4`, plus the landing and the
  straight flight as their own entries. `LOBBY_MEZZANINE_Y` stays 3.2.
- `Hotel.ts`: place three flights instead of one; walk slices for the straight
  flight are five rectangles `x ±STRAIGHT_WALK_WIDTH/2`, `z` from
  `treadFront(i)` to `treadFront(i+1)`, at `landingY + treadTop(i)` — and they
  want the **same four-slice ramp per tread** the curve already uses, for the
  same ground-damp reason (`buildMezzanine`'s comment: a flat 0.32 riser is
  walkable in theory and not at speed). The straight flight's flanks are solid
  from the landing to the tread at `x = ±2.01`, like the curve's.
- the landing platform itself: a walk surface at 1.6 m over the extent in §3,
  with a solid front so nobody walks into its underside.

## Three checks, broken on purpose

Every new assertion was watched going red before it was trusted green.

1. **`assert_flights_meet`** — writing `STRAIGHT_RISE` as a second literal
   (1.28) instead of the derivation: *"the two flights climb 1.6000 + 1.2800 =
   2.8800 m between them, and the true level is 3.2"*. ✔
2. **`assert_straight_symmetric`** — building the handrail down one side only:
   *"stair-straight-rail is not symmetric about its own centre line: 96
   vertices differ"*. ✔ This is the defect that matters most on this piece and
   the one a render from any single angle hides best.
3. **The nosing's proud-of-the-slab check — which did not fail, and was the
   real find.** It compared a measured top against `LANDING_NOSE_PROUD`, the
   constant the geometry is made from; setting that constant to zero left it
   **green** while producing exactly the coplanar surfaces it exists to forbid.
   It now asserts the physical claim (at least a millimetre above the floor it
   caps) as well as the bookkeeping one, and fails properly. CLAUDE.md's "a
   check can pass without checking anything", found the only way it ever is.

Also derived away, because they were literals that had silently stopped
describing anything when the flight got shorter: the string's facet count and
the rail's sample count (now one facet every 0.572 m and one rail sample every
0.224 m, whatever the arc), the ease break points (`ease_breaks`, which were the
literals 8.5/9.0/9.5 and would have missed the corner entirely at five treads),
and the baluster count (`baluster_fractions`, fixed 0.51 m pitch with the
remainder shared between the ends — never `length / (count − 1)`, which is how a
short flight and a long one end up with two rhythms).

## The byte budget did **not** move

Still 640 KB, and there is more headroom than before.

Measured: **17,404 triangles / 632,420 bytes → 16,912 / 619,536**. The
composition gained a whole third flight and a nosing and still came out
**12,884 bytes smaller**, because halving both curves gave back more than the
straight flight cost:

| | triangles |
| --- | --- |
| each curve, 10 treads over 90° → 5 over 45° | 2,304 → 1,280 (×2) |
| the straight flight (new) | 1,532 |
| the landing nosing (new) | 24 |

605.0 KB on disk, 204.8 KB gzipped, against the 640 KB line: **35 KB of
headroom**, up from 23 KB.

## Renders

`art/renders/hotel/`, all looked at:

- **`staircase-assembly-front.png`** — the composition in elevation. This is the
  one to show Jim.
- `staircase-assembly.png` — the same from the park's own camera angle.
- `staircase-assembly-landing.png` — closer and lower, at the landing, which is
  where three flights and two balustrade runs meet.
- `staircase-straight.png`, `staircase-straight-rake.png` — the new flight alone.
- `staircase.png`, `staircase-rake.png`, `staircase-left.png`,
  `staircase-left-rake.png` — the curves, re-rendered at 45°.
- `staircase-mirror.png` — both curves overlaid at the origin: a true pair
  renders exactly symmetric, and this one does.
- `landing-nose.png` — three tiles, cropped to the joins.

The three assembly shots stand on plain **stand-in boxes** for the floor, the
landing and the gallery, made and destroyed inside the render script, because
whether the flights land on each other is the whole question and three flights
floating in white cannot answer it.

`hotel_render.py` now **imports `hotel_build`** and lays the composition out
from its constants, so a sweep that changes moves the review render with it.
That is the direct fix for last round's `staircase-pair-front`, which silently
rendered a composition that did not exist. `staircase-pair{,-front}.png` are
deleted: that composition no longer exists either.

One trap it hit: a linked copy inherits `hide_render` from its source, and the
sources are hidden for a placement shot (they belong to no collection the shot
names). The first assembly render was three stand-in slabs and nothing else —
which looks like a composition problem and is a visibility one.

## Files this agent owns

| File | What |
| --- | --- |
| `art/blend/hotel_build.py` | The authoring source. |
| `art/blend/hotel_export.py` | Untouched. |
| `art/blend/hotel_render.py` | Review renders. Not in any npm script. |
| `art/blend/hotel.blend` | **Generated — never hand-edited.** |
| `src/art/assets/hotel.glb`, `hotelGlb.ts` | Generated. |
| `src/art/models/hotelAssets.ts` | Factories, constants, colours, outlines. |
| `scripts/pack-hotel-asset.mts` | Byte budget only — **not touched this round**. |

## Not done

- **No browser QA.** Judged in `art/renders/hotel/*.png` (Workbench) only. It
  wants one look under the real toon ramp, in the lobby, at gameplay distance —
  after the room rebuild, since there is nothing to stand on until then.
- `check-asset-contract.mts` still does not know about any hotel factory — now
  twenty-four parts across twenty-one of them. The measured table above is what
  it should see. The chandelier needs `Origin: 'anchor'`-style treatment like
  the disco ball; so do the staircase (centre of curvature), the straight flight
  (centre of its bottom riser) and the nosing (its own edge line).
- Part names added: `stair-straight-*` (five) and `landing-nose`. They appear in
  exactly three files, all owned here.
