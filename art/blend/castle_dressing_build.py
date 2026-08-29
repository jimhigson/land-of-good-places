"""Builds the castle interior's dressing and saves ``art/blend/castleDressing.blend``.

    blender --background --factory-startup --python-exit-code 1 \
        --python art/blend/castle_dressing_build.py

Issue #363: *"style the inside of the castle like a castle. Currently it is a
generic box … very many decorative assets such as tapestries and suits of
armour, lighting, and anything else a brainstorm judges as appropriate."*

Like ``hotel_build.py`` and unlike ``cart.blend``, **this script is the
authoring source** and ``castleDressing.blend`` is a generated artefact. Do not
hand-edit the .blend; the next run overwrites it. Then
``castle_dressing_export.py`` writes the ``.glb`` and ``npm run
blend:castle-dressing`` runs build → export → pack in order.

## Jim's scale rule, which governs every number below

> "Maintain the non-proportional scale — it doesn't matter if things are a
> realistic size, only that they are easily recognisable as what they are."

So these are sized for **legibility from the game's 45° isometric camera**,
not for a tape measure. The suit of armour is over three metres tall beside a
1.86 m child; the tapestry is four metres of picture. Every one of them reads
as itself in silhouette from across a hall, which is the only test that matters
here. **Do not "correct" these toward realism** — that is the
brief being undone, not a bug being fixed.

The one place proportion is load-bearing is clearance: anything a child walks
past is kept clear of her, and that is `TALLEST_CHILD_HEIGHT`'s job, read from
`src/art/models/kid.ts` rather than typed in here.

## What the asset owns, and what it does not

Shape only, exactly like every other asset in the pipeline: geometry, UVs on
the nodes code paints pictures onto, and one named node per distinctly-coloured
part. Colours, outlines, the emissive lift on every flame, and the shadow flags
all live in ``src/art/models/castleDressing.ts``.

Node names are ``<asset>-<part>``. The TypeScript walks a table keyed by that
suffix, so a part cannot be added here and quietly go undressed.

## Conventions (ART_DIRECTION §7, ASSET_MANIFEST's shared contract)

* 1 Blender unit = 1 metre.
* **Blender −Y is the game's +Z.** Anything whose facing matters is built
  facing −Y: a tapestry's picture, a throne's seat, an armour's visor.
* Origin at the **base**, centred on X and Y, baked into vertex positions.
  Every object leaves Blender at an identity transform, so the assets all
  stand on top of one another at the world origin; each lives in its own
  collection and ``castle_dressing_render.py`` shows them one at a time.
* **Three documented exceptions to "origin at the base"**, all of the same
  kind as the hotel's disco ball — a thing that is *hung*, not *stood*:
  - ``chandelier``: origin at the **top of its chain**, all geometry below.
  - ``wallTorch``, ``tapestry``, ``banner``, ``shield``, ``portrait``,
    ``cobweb``, ``stainedGlass``, ``mouseHole``: origin at the **wall mount
    point**, with the wall plane at y = 0 and the geometry standing out of it
    toward −Y (the game's +Z). Same reasoning as the jetpack's back mount:
    the placer writes `anchor.add(thing.root)` and does no offset maths, so
    there is no second formula to fall out of step with the first.
* No randomness. Variety comes from where the placer puts these and which
  picture it paints on them, never from the parts themselves.
"""

import math
import os
import sys
import traceback

import bpy
from mathutils import Euler, Matrix, Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from blendkit import (  # noqa: E402
    REPO,
    TAU,
    Part,
    box,
    collection,
    cone,
    ellipsoid,
    extrude_outline,
    flat_top_box,
    icosphere,
    planar_uvs,
    reset_scene,
    revolve,
    rounded_box,
    summarise,
    sweep_path,
    total_triangles,
    ts_const,
    tube,
)

BLEND = os.path.join(REPO, "art", "blend", "castleDressing.blend")

# The one number in this file the game owns. Everything a child walks under —
# the chandelier's lowest candle, a wall torch's flame, a doorway's arch — is
# cleared against her true standing height including hair and hat, which is
# guarded by an invariant that re-measures every hair style crossed with every
# hat on every seed. Typing 2.97 in here as well would be the copy that is
# found wrong later, by a child walking into a torch.
TALLEST_CHILD = ts_const("src/art/models/kid.ts", "TALLEST_CHILD_HEIGHT")

# Head clearance under anything hung over a walkable floor. Generous on
# purpose: the camera looks down at 45°, so a fitting that clears a child's
# head by a hand's breadth still visually sits *on* her from behind.
HUNG_CLEARANCE = 0.9


def deg(x: float) -> float:
    return math.radians(x)


def rot(x=0.0, y=0.0, z=0.0) -> Matrix:
    """A rotation matrix from degrees, in XYZ order."""
    return Euler((deg(x), deg(y), deg(z)), "XYZ").to_matrix().to_4x4()


def place(x=0.0, y=0.0, z=0.0, rx=0.0, ry=0.0, rz=0.0) -> Matrix:
    return Matrix.Translation((x, y, z)) @ rot(rx, ry, rz)


# =============================================================================
# Shared shapes several assets are made of
# =============================================================================


def hanging_cloth(width, height, thickness, cols=10, rows=8, billow=0.05, taper=0.0):
    """A hanging sheet with a gentle billow — a tapestry, a banner, a bed-drape.

    Flat cloth reads as cardboard from the game's camera: the toon ramp has
    nothing to band, so the whole hanging comes out one value and the eye
    files it as a poster. Three shallow waves across the width give the ramp
    two shading changes per metre and the thing reads as *cloth* immediately,
    for 160 triangles.

    The billow is scaled by ``sag``, zero at the rod and full at the hem: a
    hanging is pinned along its top edge and free at the bottom, and a sheet
    that waves as much where it is nailed as where it swings looks like
    corrugated iron.

    ``taper`` narrows the sheet toward the bottom (a pennant); 0 is a
    rectangle. Returns ``(verts, faces)`` centred on X, spanning z = 0..height,
    facing −Y.
    """
    half_t = thickness * 0.5
    grid_front = []
    grid_back = []
    for r in range(rows + 1):
        v = r / rows
        z = v * height
        sag = v * v  # still at the rod, loosest at the hem
        half_w = width * 0.5 * (1.0 - taper * (1.0 - v))
        row_f, row_b = [], []
        for c in range(cols + 1):
            u = c / cols
            x = (u - 0.5) * 2.0 * half_w
            wave = math.sin(u * TAU * 1.5) * billow * sag
            row_f.append((x, wave - half_t, z))
            row_b.append((x, wave + half_t, z))
        grid_front.append(row_f)
        grid_back.append(row_b)

    verts = []
    index_f = []
    index_b = []
    for r in range(rows + 1):
        fr, br = [], []
        for c in range(cols + 1):
            fr.append(len(verts))
            verts.append(grid_front[r][c])
        for c in range(cols + 1):
            br.append(len(verts))
            verts.append(grid_back[r][c])
        index_f.append(fr)
        index_b.append(br)

    faces = []
    for r in range(rows):
        for c in range(cols):
            faces.append((index_f[r][c], index_f[r][c + 1], index_f[r + 1][c + 1], index_f[r + 1][c]))
            faces.append((index_b[r][c], index_b[r + 1][c], index_b[r + 1][c + 1], index_b[r][c + 1]))
    for r in range(rows):
        faces.append((index_f[r][0], index_f[r + 1][0], index_b[r + 1][0], index_b[r][0]))
        faces.append((index_f[r][cols], index_b[r][cols], index_b[r + 1][cols], index_f[r + 1][cols]))
    for c in range(cols):
        faces.append((index_f[0][c], index_b[0][c], index_b[0][c + 1], index_f[0][c + 1]))
        faces.append((index_f[rows][c], index_f[rows][c + 1], index_b[rows][c + 1], index_b[rows][c]))
    return verts, faces


def flame(height: float, width: float, segments: int = 8):
    """A teardrop flame, standing on z = 0 with its tip up.

    The one shape in this file that is *light* rather than *thing*: every
    torch, candle, brazier and hearth uses it, and `castleDressing.ts` gives
    them all the same emissive lift so a lit castle reads as lit at dusk
    without a single extra light in the scene — which is what keeps #251's
    shadow-pass budget from being spent on decoration.

    A cone would have done and does not: a cone reads as a party hat. The
    profile below is fat at a third of its height and drawn to a point,
    which is what makes it read as fire at ten metres.
    """
    profile = [
        (0.0, 0.0),
        (width * 0.30, height * 0.06),
        (width * 0.50, height * 0.30),
        (width * 0.38, height * 0.58),
        (width * 0.16, height * 0.82),
        (0.0, height),
    ]
    return revolve(profile, segments)


def iron_hoop(radius: float, thickness: float, sides: int = 5, segments: int = 18):
    """A torus — a chandelier's wheel, a barrel's hoop, a bracket's ring."""
    points = [
        (radius * math.cos(i * TAU / segments), radius * math.sin(i * TAU / segments), 0.0)
        for i in range(segments)
    ]
    return sweep_path(points, thickness, sides=sides, up=(0.0, 0.0, 1.0), closed=True)


def link_chain(length: float, links: int, radius: float, thickness: float):
    """A hanging chain along −Z from z = 0, alternating link planes.

    Alternating is the whole trick: a stack of coplanar rings reads as a
    ladder, and rotating every other one 90° is what makes it read as chain
    from any angle for four extra vertices a link.
    """
    verts, faces = [], []
    pitch = length / links
    for i in range(links):
        z = -(i + 0.5) * pitch
        ring_v, ring_f = iron_hoop(radius, thickness, sides=4, segments=8)
        matrix = Matrix.Translation((0.0, 0.0, z)) @ rot(90.0, 0.0, 90.0 * (i % 2))
        base = len(verts)
        verts.extend(tuple(matrix @ Vector(v)) for v in ring_v)
        faces.extend(tuple(k + base for k in f) for f in ring_f)
    return verts, faces


def seat_against_wall(*parts: Part) -> None:
    """Slide a whole wall-mounted asset back until it just touches the stone.

    Every WALL asset is authored in whatever frame is natural for its own
    shape — a tapestry billows either side of its cloth plane, a torch's back
    plate is a box centred on its own middle — and then this puts the wall
    where it belongs: **y = 0, with every vertex of the asset at or in front
    of it** (−Y, the game's +Z, into the room).

    Done here, once, from the measured geometry, rather than by each builder
    subtracting a half-thickness it has to keep in step with its own shape.
    That subtraction is precisely the kind of second formula CLAUDE.md warns
    about: it is right the day it is written and 3 cm wrong the day the billow
    changes, and 3 cm wrong means a tapestry half inside a wall.

    All the parts of one asset are shifted **together**, so their alignment
    with each other is untouched.
    """
    highest = max(v[1] for part in parts for v in part.verts)
    for part in parts:
        part.verts = [(v[0], v[1] - highest, v[2]) for v in part.verts]


def candle(part_wax: Part, part_flame: Part, x: float, y: float, z: float, height: float, radius: float):
    """One candle and its flame, added to two different nodes at once.

    Two nodes because they are two colours (§ the asset owns shape, the
    TypeScript owns colour) — and one function because a candle whose flame
    is somewhere else is the single most likely mistake in a file with
    thirty-one of them.
    """
    part_wax.at(*tube(radius, height, sides=8), x=x, y=y, z=z)
    part_flame.at(*flame(radius * 2.6, radius * 1.7, segments=6), x=x, y=y, z=z + height)


# =============================================================================
# 1. Tapestry — the thing Jim named first
# =============================================================================

TAPESTRY_WIDTH = 2.8
TAPESTRY_HEIGHT = 4.2
TAPESTRY_ROD_OVERHANG = 0.28


def build_tapestry() -> None:
    """A picture hanging on a wall, origin at its **top mount point**.

    The picture itself is a canvas texture painted by `castleDressing.ts` into
    this cloth's **own UV map** — not a second sheet floating in front of it.
    That is CLAUDE.md's rule after the hood faces went invisible, and it is
    worth restating for a tapestry specifically: a hanging is exactly the
    shape that tempts you to bolt a flat decal onto a curved surface, and the
    decal is exactly what falls out of step when the billow changes.

    The origin is the rod, not the hem, because a tapestry is hung from a
    bracket at a known height and its length is then whatever it is. Origin at
    the hem would make the placer subtract a length it should not have to know.
    """
    coll = collection("tapestry")

    cloth = Part("tapestry-cloth")
    verts, faces = hanging_cloth(TAPESTRY_WIDTH, TAPESTRY_HEIGHT, 0.05, cols=10, rows=8)
    # Built hanging *down* from the origin, so z runs -HEIGHT..0.
    verts = [(v[0], v[1], v[2] - TAPESTRY_HEIGHT) for v in verts]
    cloth.add(verts, faces, uvs=planar_uvs(verts, faces))

    rod = Part("tapestry-rod")
    half = TAPESTRY_WIDTH * 0.5 + TAPESTRY_ROD_OVERHANG
    rod.add(*tube(0.075, half * 2.0, sides=8), matrix=place(x=-half, rx=0.0, ry=90.0))
    for side in (-1.0, 1.0):
        rod.at(*icosphere(0.13, 1), x=side * half, z=0.0)
        # The bracket that pins the rod to the stone.
        rod.at(*box(0.10, 0.22, 0.10), x=side * (half - 0.30), y=0.09, z=0.0)

    fringe = Part("tapestry-fringe")
    tassels = 9
    for i in range(tassels):
        u = (i + 0.5) / tassels
        x = (u - 0.5) * TAPESTRY_WIDTH * 0.94
        sag = 1.0
        wave = math.sin(u * TAU * 1.5) * 0.05 * sag
        fringe.at(*cone(0.055, -0.20, sides=5), x=x, y=wave, z=-TAPESTRY_HEIGHT + 0.02)

    seat_against_wall(cloth, rod, fringe)
    for part in (cloth, rod, fringe):
        part.emit(coll)


# =============================================================================
# 2. Banner — a tapestry's smaller, pointier cousin
# =============================================================================

BANNER_WIDTH = 1.15
BANNER_HEIGHT = 3.6


def build_banner() -> None:
    """A swallow-tailed pennant, origin at its top mount point.

    Narrow and long where the tapestry is broad: hung in a row down a hall
    they give the vertical rhythm a 30 m box has none of, and each one carries
    a different painted charge from the same UV layout.
    """
    coll = collection("banner")

    cloth = Part("banner-cloth")
    verts, faces = hanging_cloth(
        BANNER_WIDTH, BANNER_HEIGHT, 0.045, cols=5, rows=9, billow=0.055, taper=0.18
    )
    verts = [(v[0], v[1], v[2] - BANNER_HEIGHT) for v in verts]
    cloth.add(verts, faces, uvs=planar_uvs(verts, faces))

    # The swallow tail: two points hanging below the hem, built as a prism so
    # they carry the same painted cloth colour round their edge.
    tail = Part("banner-tail")
    hem_half = BANNER_WIDTH * 0.5 * (1.0 - 0.18)
    outline = [
        (-hem_half, 0.0),
        (hem_half, 0.0),
        (hem_half, -0.62),
        (0.0, -0.24),
        (-hem_half, -0.62),
    ]
    t_verts, t_faces = extrude_outline(outline, 0.045, centre=(0.0, -0.12))
    t_verts = [(v[0], v[1], v[2] - BANNER_HEIGHT) for v in t_verts]
    tail.add(t_verts, t_faces)

    rod = Part("banner-rod")
    half = BANNER_WIDTH * 0.5 + 0.16
    rod.add(*tube(0.055, half * 2.0, sides=6), matrix=place(x=-half, ry=90.0))
    for side in (-1.0, 1.0):
        rod.at(*cone(0.085, 0.16, sides=6), x=side * half, z=-0.08)

    seat_against_wall(cloth, tail, rod)
    for part in (cloth, tail, rod):
        part.emit(coll)


# =============================================================================
# 3. Shield — hung, or carried by the armour
# =============================================================================

SHIELD_WIDTH = 1.15
SHIELD_HEIGHT = 1.45


def shield_outline(width: float, height: float, samples: int = 9):
    """The heraldic *heater* shield: square shoulders, sides curving to a point.

    Two straight top corners and a parabolic taper. A rounded-rectangle shield
    reads as a road sign; the point at the bottom is the whole of what makes a
    child call it a shield.
    """
    half = width * 0.5
    points = [(-half, 0.0), (half, 0.0)]
    for i in range(1, samples + 1):
        t = i / samples
        z = -height * t
        # Straight for the first fifth, then a cosine sweep into the point.
        x = half * (1.0 if t < 0.2 else math.cos((t - 0.2) / 0.8 * math.pi * 0.5) ** 0.7)
        points.append((x, z))
    for i in range(samples, 0, -1):
        t = i / samples
        z = -height * t
        x = half * (1.0 if t < 0.2 else math.cos((t - 0.2) / 0.8 * math.pi * 0.5) ** 0.7)
        points.append((-x, z))
    return points


def build_shield() -> None:
    """Origin at the top mount point, hanging down — same frame as the banner.

    The device (a lion, a star, a dragon, per-instance) is painted into the
    shield's **own** UV map by the TypeScript, and the boss is the one piece
    of relief: a half-ellipsoid standing 6 cm proud of the face, which per
    ART_DIRECTION §5's marking rule must *protrude past the surface* rather
    than sit inside it and read as a jagged intersection.
    """
    coll = collection("shield")

    face = Part("shield-face")
    outline = shield_outline(SHIELD_WIDTH, SHIELD_HEIGHT)
    verts, faces = extrude_outline(outline, 0.13, centre=(0.0, -SHIELD_HEIGHT * 0.42))
    lo = (-SHIELD_WIDTH * 0.5, 0.0, -SHIELD_HEIGHT)
    hi = (SHIELD_WIDTH * 0.5, 0.0, 0.0)
    face.add(verts, faces, uvs=planar_uvs(verts, faces, lo, hi))

    trim = Part("shield-boss")
    boss_v, boss_f = ellipsoid(0.17, 0.10, 0.17, subdivisions=2)
    trim.at(boss_v, boss_f, y=-0.065, z=-SHIELD_HEIGHT * 0.40)
    # Six studs round the rim, at the top and down each straight shoulder.
    for x, z in ((0.0, -0.08), (-0.42, -0.08), (0.42, -0.08), (-0.46, -0.5), (0.46, -0.5), (0.0, -1.16)):
        trim.at(*icosphere(0.045, 1), x=x, y=-0.070, z=z)

    seat_against_wall(face, trim)
    face.emit(coll, sharp_deg=30.0)
    trim.emit(coll)


# =============================================================================
# 4. Suit of armour — the second thing Jim named, and the star of the room
# =============================================================================

# The suit, segment by segment from the floor up. **These are the owner of the
# armour's height** — `ARMOUR_HEIGHT` is their sum, never a number typed twice,
# and `main()` asserts the geometry that comes out actually measures it. Change
# a segment and the total follows; add something that pokes out of the top and
# the build fails rather than the handoff going quietly stale.
ARMOUR_PLINTH_HEIGHT = 0.18
ARMOUR_SABATON = 0.14
ARMOUR_GREAVE = 0.54
ARMOUR_THIGH = 0.42
ARMOUR_FAULD = 0.24
ARMOUR_CUIRASS = 0.68
ARMOUR_GORGET = 0.08
ARMOUR_HELM = 0.52
ARMOUR_PLUME = 0.28
ARMOUR_HEIGHT = (
    ARMOUR_PLINTH_HEIGHT + ARMOUR_SABATON + ARMOUR_GREAVE + ARMOUR_THIGH
    + ARMOUR_FAULD + ARMOUR_CUIRASS + ARMOUR_GORGET + ARMOUR_HELM + ARMOUR_PLUME
)
ARMOUR_PLINTH_RADIUS = 0.62
ARMOUR_PLUME_RADIUS = 0.20


def build_armour() -> None:
    """An empty suit standing on a plinth, 2.7 m tall.

    **Deliberately bigger than the 1.86 m tallest child**, per Jim's rule: a
    suit of armour scaled honestly against a six-year-old is a 1.2 m dumpy
    thing that reads as a bin from across a hall. At 2.7 m, backlit by a
    torch, it reads as a knight standing guard from the far end of the room —
    which is the entire point of putting one there.

    Chunky-primitive throughout (ART_DIRECTION §7's preferred route): every
    plate is a rounded box or a squashed sphere. The proportions are the
    park's own cartoon ones — a big head, huge round pauldrons, stumpy legs —
    so it belongs to this game rather than visiting from a realistic one.

    Faces −Y, i.e. the game's +Z: the visor looks at the player.
    """
    coll = collection("armour")

    plate = Part("armour-plate")
    trim = Part("armour-trim")
    dark = Part("armour-visor")
    plume = Part("armour-plume")
    haft = Part("armour-haft")
    plinth = Part("armour-plinth")

    z = 0.0
    plinth.add(*revolve([(0.0, 0.0), (ARMOUR_PLINTH_RADIUS, 0.0),
                         (ARMOUR_PLINTH_RADIUS * 0.92, ARMOUR_PLINTH_HEIGHT),
                         (0.0, ARMOUR_PLINTH_HEIGHT)], segments=12))
    z += ARMOUR_PLINTH_HEIGHT

    # --- legs -----------------------------------------------------------
    sabaton_h = ARMOUR_SABATON
    greave_h = ARMOUR_GREAVE
    for side in (-1.0, 1.0):
        x = side * 0.24
        # Sabaton: a foot, pointing forward (−Y), so the suit reads as standing.
        plate.at(*rounded_box(0.30, 0.52, sabaton_h, 0.05), x=x, y=-0.09, z=z + sabaton_h * 0.5)
        plate.at(*rounded_box(0.30, 0.30, greave_h, 0.09), x=x, y=0.0,
                 z=z + sabaton_h + greave_h * 0.5)
        # Poleyn — the knee cop. A disc, so the leg has a joint in silhouette.
        trim.at(*ellipsoid(0.19, 0.13, 0.13, 1), x=x, y=-0.09, z=z + sabaton_h + greave_h)
        plate.at(*rounded_box(0.34, 0.34, ARMOUR_THIGH, 0.10), x=x, y=0.0,
                 z=z + sabaton_h + greave_h + ARMOUR_THIGH * 0.5)
    z += sabaton_h + greave_h + ARMOUR_THIGH

    # --- fauld and cuirass ----------------------------------------------
    fauld_h = ARMOUR_FAULD
    trim.at(*revolve([(0.0, 0.0), (0.44, 0.0), (0.52, fauld_h), (0.0, fauld_h)], segments=12),
            z=z)
    z += fauld_h

    cuirass_h = ARMOUR_CUIRASS
    # A barrel chest: widest two-thirds up, tapering into the fauld.
    plate.at(*revolve([
        (0.0, 0.0), (0.40, 0.0), (0.50, cuirass_h * 0.35), (0.52, cuirass_h * 0.68),
        (0.42, cuirass_h), (0.0, cuirass_h),
    ], segments=14), z=z)
    # The breastplate's central ridge — one raised keel, standing proud, so the
    # toon ramp splits the chest into a lit half and a shaded half.
    plate.at(*rounded_box(0.13, 0.30, cuirass_h * 0.86, 0.05), y=-0.40, z=z + cuirass_h * 0.47)
    # Belt.
    trim.add(*iron_hoop(0.49, 0.055, sides=5, segments=14), matrix=place(z=z + cuirass_h * 0.30))
    trim.at(*rounded_box(0.24, 0.10, 0.18, 0.03), y=-0.46, z=z + cuirass_h * 0.30)
    z += cuirass_h

    # --- arms ------------------------------------------------------------
    shoulder_z = z - 0.10
    for side in (-1.0, 1.0):
        x = side * 0.56
        # Pauldron: a big squashed sphere. The single most recognisable piece
        # of a suit of armour in silhouette, so it is oversized even here.
        plate.at(*ellipsoid(0.30, 0.28, 0.24, 2), x=x, z=shoulder_z)
        plate.at(*rounded_box(0.24, 0.24, 0.48, 0.09), x=x, z=shoulder_z - 0.36)
        trim.at(*ellipsoid(0.16, 0.14, 0.11, 1), x=x, y=-0.05, z=shoulder_z - 0.60)
        plate.at(*rounded_box(0.22, 0.22, 0.42, 0.08), x=x, z=shoulder_z - 0.84)
        # Gauntlet, a mitten. Fingers at this size are four triangles of mush.
        plate.at(*ellipsoid(0.16, 0.19, 0.15, 2), x=x, y=-0.04, z=shoulder_z - 1.10)

    # --- gorget, helm ----------------------------------------------------
    trim.add(*iron_hoop(0.31, 0.075, sides=5, segments=12), matrix=place(z=z + 0.02))
    z += ARMOUR_GORGET

    helm_h = ARMOUR_HELM
    # The great helm: a rounded barrel with a domed crown.
    plate.at(*rounded_box(0.52, 0.50, helm_h, 0.13), z=z + helm_h * 0.5)
    plate.at(*ellipsoid(0.27, 0.26, 0.17, 2), z=z + helm_h)
    # Visor slit and breaths — a recessed dark node, standing 1 cm proud of the
    # helm's own face so it cannot z-fight with it (§5's marking rule).
    dark.at(*box(0.38, 0.06, 0.075), y=-0.255, z=z + helm_h * 0.62)
    for i in range(3):
        dark.at(*box(0.05, 0.06, 0.11), x=-0.10 + i * 0.10, y=-0.245, z=z + helm_h * 0.32)
    # Brow band and rivets.
    trim.at(*box(0.50, 0.46, 0.05), z=z + helm_h * 0.74)
    for side in (-1.0, 1.0):
        trim.at(*icosphere(0.045, 1), x=side * 0.245, y=-0.10, z=z + helm_h * 0.42)
    z += helm_h

    # Crest: a fan of plume, the one soft thing on a suit of iron and the bit
    # that tips it from "armour" to "knight". The middle feather is what sets
    # the suit's total height, so it is placed *from the top down*.
    crest_top = z + ARMOUR_PLUME
    for i in range(7):
        t = (i - 3) / 3.0
        radius_z = ARMOUR_PLUME_RADIUS - abs(t) * 0.06
        plume.at(*ellipsoid(0.055, 0.16 - abs(t) * 0.05, radius_z, 1),
                 x=0.0, y=t * 0.16, z=crest_top - radius_z - abs(t) * 0.04)

    # --- the halberd it stands guard with --------------------------------
    # Its tip finishes level with the crest, deliberately: two things reaching
    # the same height read as one composition, and it means the suit's own
    # height is the only number the placer has to know.
    pole_x = -0.86
    tip_h = 0.32
    pole_h = ARMOUR_HEIGHT - ARMOUR_PLINTH_HEIGHT - tip_h + 0.04
    haft.at(*tube(0.055, pole_h, sides=8), x=pole_x, y=0.02, z=ARMOUR_PLINTH_HEIGHT)
    blade_z = ARMOUR_PLINTH_HEIGHT + pole_h - 0.52
    # An axe head one side, a spike the other, and a point on top: the three
    # silhouette features that stop a polearm reading as a broom.
    plate.at(*extrude_outline(
        [(0.0, 0.0), (0.40, 0.10), (0.44, 0.34), (0.0, 0.46)], 0.05, centre=(0.18, 0.24)
    ), x=pole_x + 0.05, y=0.02, z=blade_z)
    plate.at(*extrude_outline(
        [(0.0, 0.10), (-0.24, 0.16), (0.0, 0.30)], 0.05, centre=(-0.08, 0.19)
    ), x=pole_x - 0.05, y=0.02, z=blade_z)
    plate.at(*cone(0.055, tip_h, sides=6), x=pole_x, y=0.02,
             z=ARMOUR_PLINTH_HEIGHT + pole_h - 0.04)

    for part in (plate, trim, dark, plume, haft, plinth):
        part.emit(coll)


# =============================================================================
# 5. Wall torch — Jim's third named ask: lighting
# =============================================================================

TORCH_REACH = 0.46
TORCH_FLAME_HEIGHT = 0.42


def build_wall_torch() -> None:
    """An iron bracket, a stub of wood and a flame, mounted on a wall.

    Origin at the **wall mount point**: the wall plane is y = 0 and everything
    stands out of it toward −Y, which is the game's +Z. So the placer parents
    it to a point on the wall and rotates the root to face into the room — no
    offset, no half-thickness to remember, nothing that can drift when the
    bracket changes shape.

    The flame is a separate node so `castleDressing.ts` can give it the
    emissive lift and turn off its shadow flags. It is *not* a light: #251
    records the shadow pass already at 57% of draw calls, and a room full of
    real point lights is exactly how that gets worse. A bright emissive flame
    plus the room's own warm fill reads as fire and costs one draw call.
    """
    coll = collection("wallTorch")

    iron = Part("wallTorch-bracket")
    wood = Part("wallTorch-haft")
    fire = Part("wallTorch-flame")

    # Back plate against the stone.
    iron.at(*rounded_box(0.16, 0.05, 0.34, 0.03), y=0.02, z=0.0)
    for z in (-0.12, 0.12):
        iron.at(*icosphere(0.035, 1), y=-0.01, z=z)
    # The arm, sloping up and out.
    arm = sweep_path(
        [(0.0, 0.0, -0.02), (0.0, -TORCH_REACH * 0.55, 0.02), (0.0, -TORCH_REACH, 0.20)],
        0.035, sides=5, up=(1.0, 0.0, 0.0), closed=False,
    )
    iron.add(*arm)
    # The cup the torch sits in.
    iron.at(*revolve([(0.0, 0.0), (0.085, 0.0), (0.115, 0.14), (0.10, 0.15), (0.075, 0.02), (0.0, 0.02)],
                     segments=10), y=-TORCH_REACH, z=0.18)

    wood.at(*tube(0.05, 0.30, sides=6), y=-TORCH_REACH, z=0.22)
    fire.at(*flame(TORCH_FLAME_HEIGHT, 0.24, segments=7), y=-TORCH_REACH, z=0.50)

    seat_against_wall(iron, wood, fire)
    for part in (iron, wood, fire):
        part.emit(coll)


# =============================================================================
# 6. Brazier
# =============================================================================

BRAZIER_HEIGHT = 1.32


def build_brazier() -> None:
    """A tripod, a bowl of coals and a flame. Origin at the floor.

    The floor-standing half of the lighting pair: a torch marks a wall, a
    brazier marks a *place* — the foot of a stair, either side of a throne.
    """
    coll = collection("brazier")

    iron = Part("brazier-stand")
    bowl = Part("brazier-bowl")
    coals = Part("brazier-coals")
    fire = Part("brazier-flame")

    bowl_z = 0.86
    for i in range(3):
        angle = i * TAU / 3 + math.pi / 6
        x, y = math.cos(angle) * 0.34, math.sin(angle) * 0.34
        # Splayed legs: built as a swept tube from the foot up to the rim.
        iron.add(*sweep_path(
            # Starting at 5 cm, not 0: a swept tube's end cap is perpendicular
            # to its own tangent, so a leg that starts on the floor puts a
            # centimetre of itself *through* it. The foot pad below is what
            # actually touches down.
            [(x, y, 0.05), (x * 0.55, y * 0.55, bowl_z * 0.55), (x * 0.78, y * 0.78, bowl_z)],
            0.045, sides=5, up=(0.0, 0.0, 1.0), closed=False,
        ))
        # The foot pad sits *on* the floor, not through it — check_origins()
        # measures this and the build fails if it is out by 5 mm.
        iron.at(*ellipsoid(0.09, 0.09, 0.035, 1), x=x, y=y, z=0.035)
    iron.add(*iron_hoop(0.22, 0.035, sides=4, segments=12), matrix=place(z=bowl_z * 0.42))

    bowl.at(*revolve([
        (0.0, 0.0), (0.30, 0.0), (0.46, 0.24), (0.48, 0.30), (0.40, 0.28), (0.24, 0.06), (0.0, 0.06),
    ], segments=14), z=bowl_z)
    coals.at(*ellipsoid(0.33, 0.33, 0.10, 2), z=bowl_z + 0.20)
    fire.at(*flame(0.46, 0.42, segments=8), z=bowl_z + 0.24)

    for part in (iron, bowl, coals, fire):
        part.emit(coll)


# =============================================================================
# 7. Chandelier
# =============================================================================

CHANDELIER_RADIUS = 1.30
CHANDELIER_DROP = 1.95
CHANDELIER_CANDLES = 8


def build_chandelier() -> None:
    """An iron wheel of candles on a chain. **Origin at the top of the chain.**

    The hotel's disco ball established this exception and it is the right one:
    a hung thing's fixed point is where it is nailed to the ceiling, not where
    its lowest bit happens to reach. All the geometry is below z = 0, and the
    placer writes `ceilingAnchor.add(chandelier.root)`.
    """
    coll = collection("chandelier")

    iron = Part("chandelier-frame")
    wax = Part("chandelier-candle")
    fire = Part("chandelier-flame")

    chain_len = CHANDELIER_DROP - 0.55
    iron.add(*link_chain(chain_len, 7, 0.075, 0.022))
    iron.at(*ellipsoid(0.12, 0.12, 0.07, 1), z=-chain_len - 0.04)

    wheel_z = -CHANDELIER_DROP
    iron.add(*iron_hoop(CHANDELIER_RADIUS, 0.055, sides=5, segments=20),
             matrix=place(z=wheel_z))
    iron.add(*iron_hoop(CHANDELIER_RADIUS * 0.62, 0.04, sides=4, segments=14),
             matrix=place(z=wheel_z + 0.16))
    for i in range(4):
        angle = i * TAU / 4 + math.pi / 4
        end = (math.cos(angle) * CHANDELIER_RADIUS, math.sin(angle) * CHANDELIER_RADIUS, wheel_z)
        iron.add(*sweep_path(
            [(0.0, 0.0, -chain_len), end], 0.028, sides=4, up=(0.0, 0.0, 1.0), closed=False,
        ))

    for i in range(CHANDELIER_CANDLES):
        angle = i * TAU / CHANDELIER_CANDLES
        x, y = math.cos(angle) * CHANDELIER_RADIUS, math.sin(angle) * CHANDELIER_RADIUS
        # The drip pan each candle stands in.
        iron.at(*revolve([(0.0, 0.0), (0.10, 0.0), (0.13, 0.05), (0.09, 0.05), (0.06, 0.02), (0.0, 0.02)],
                         segments=8), x=x, y=y, z=wheel_z + 0.04)
        candle(wax, fire, x, y, wheel_z + 0.08, 0.34, 0.055)

    for part in (iron, wax, fire):
        part.emit(coll)


# =============================================================================
# 8. Throne
# =============================================================================

THRONE_HEIGHT = 3.30
THRONE_SEAT_HEIGHT = 0.92
THRONE_WIDTH = 1.70


def build_throne() -> None:
    """The seat at the end of the hall, built to be looked *at*, not sat on.

    3.3 m to the finial with a 0.92 m seat: a child can climb on it and it
    still towers. The tall back is the whole silhouette — a throne with a
    normal chair back is a chair.
    """
    coll = collection("throne")

    wood = Part("throne-frame")
    gold = Part("throne-gold")
    cushion = Part("throne-cushion")

    half_w = THRONE_WIDTH * 0.5
    # Plinth: two steps, so the throne reads as raised even on a flat floor.
    wood.at(*flat_top_box(THRONE_WIDTH + 0.80, 1.80, 0.15, 0.04), z=0.075)
    wood.at(*flat_top_box(THRONE_WIDTH + 0.36, 1.50, 0.15, 0.04), z=0.225)
    base = 0.30

    seat_t = 0.16
    wood.at(*flat_top_box(THRONE_WIDTH, 1.10, seat_t, 0.05),
            z=THRONE_SEAT_HEIGHT - seat_t * 0.5 + base * 0.0)
    for sx in (-1.0, 1.0):
        for sy in (-1.0, 1.0):
            wood.at(*rounded_box(0.20, 0.20, THRONE_SEAT_HEIGHT - seat_t, 0.04),
                    x=sx * (half_w - 0.14), y=sy * 0.44,
                    z=(THRONE_SEAT_HEIGHT - seat_t) * 0.5)

    # Arms.
    for sx in (-1.0, 1.0):
        wood.at(*rounded_box(0.20, 1.02, 0.18, 0.06),
                x=sx * (half_w - 0.10), z=THRONE_SEAT_HEIGHT + 0.44)
        wood.at(*rounded_box(0.18, 0.18, 0.44, 0.05),
                x=sx * (half_w - 0.10), y=-0.42, z=THRONE_SEAT_HEIGHT + 0.22)

    # The back: a tall gothic panel drawn to a point.
    back_top = THRONE_HEIGHT - 0.30
    back_outline = [
        (-half_w, THRONE_SEAT_HEIGHT),
        (half_w, THRONE_SEAT_HEIGHT),
        (half_w, back_top - 0.75),
        (half_w * 0.55, back_top - 0.14),
        (0.0, back_top),
        (-half_w * 0.55, back_top - 0.14),
        (-half_w, back_top - 0.75),
    ]
    wood.add(*extrude_outline(back_outline, 0.16, centre=(0.0, THRONE_SEAT_HEIGHT + 0.9)),
             matrix=place(y=0.46))

    cushion.at(*rounded_box(THRONE_WIDTH - 0.26, 0.94, 0.22, 0.09),
               z=THRONE_SEAT_HEIGHT + 0.11)
    cushion.at(*rounded_box(THRONE_WIDTH - 0.34, 0.14, 1.30, 0.09),
               y=0.34, z=THRONE_SEAT_HEIGHT + 0.85)

    # Gold: finials on the back, studs on the cushion, a sunburst at the crown.
    gold.at(*icosphere(0.15, 1), z=THRONE_HEIGHT - 0.16)
    gold.at(*cone(0.09, 0.22, sides=6), z=THRONE_HEIGHT - 0.22)
    for sx in (-1.0, 1.0):
        gold.at(*icosphere(0.115, 1), x=sx * half_w, y=0.46, z=back_top - 0.72)
        gold.at(*icosphere(0.09, 1), x=sx * (half_w - 0.10), y=-0.90,
                z=THRONE_SEAT_HEIGHT + 0.53)
    for i in range(5):
        t = (i - 2) / 2.0
        gold.at(*ellipsoid(0.10, 0.035, 0.10, 1), x=t * 0.42, y=0.36,
                z=THRONE_SEAT_HEIGHT + 1.62)

    for part in (wood, gold, cushion):
        part.emit(coll)


# =============================================================================



def placement_notes() -> str:
    """The two things the placer has to know that a bounding box does not say.

    **Measured off the emitted geometry, not off the constants that made it.**
    A wall torch's lowest point is a bracket stud and a chandelier's is a
    candle's drip pan; neither is a number anybody typed — both fall out of the
    shape. Deriving them here means the figure the other agent is given is the
    figure the mesh actually is, and it moves the moment the mesh does.

    That is exactly what the bridge pair got wrong: they agreed a parapet
    formula in prose and each implemented it, so their two answers met at the
    points a spot-check looked and were 3.2 cm apart everywhere in between.
    There is one answer here and it comes from the vertices.

    * A **CEILING** fitting is walked *under*, so what matters is how far it
      hangs and therefore how high the ceiling must be.
    * A **WALL** fitting is walked *past*, so what matters is how far it
      sticks out into the room — the corridor it narrows. A tapestry hanging
      flat down a wall needs no head clearance at all; a torch on a bracket
      eats half a metre of the walkway and must not be over a doorway.
    """
    rows = []
    for name, family in sorted(ORIGIN_FAMILY.items()):
        lo, hi = collection_bounds(name)
        if family == "CEILING":
            rows.append(
                f"  {name:<16} hangs {-lo.z:5.2f} m below its mount, so the ceiling must be "
                f"at least {TALLEST_CHILD + HUNG_CLEARANCE - lo.z:5.2f} m over the floor "
                f"(child {TALLEST_CHILD:.2f} + clearance {HUNG_CLEARANCE:.2f})"
            )
        elif family == "WALL":
            rows.append(
                f"  {name:<16} stands {-lo.y:5.2f} m proud of the wall and spans "
                f"{hi.x - lo.x:5.2f} m across it, {hi.z - lo.z:5.2f} m down"
            )
        else:
            rows.append(
                f"  {name:<16} stands on the floor, {hi.x - lo.x:5.2f} × {hi.y - lo.y:5.2f} m "
                f"footprint, {hi.z:5.2f} m tall"
            )
    return "\n".join(rows)


def collection_bounds(name: str):
    coll = bpy.data.collections[name]
    lo = Vector((1e9, 1e9, 1e9))
    hi = Vector((-1e9, -1e9, -1e9))
    for obj in coll.objects:
        if obj.type != "MESH":
            continue
        for v in obj.data.vertices:
            lo = Vector((min(lo[i], v.co[i]) for i in range(3)))
            hi = Vector((max(hi[i], v.co[i]) for i in range(3)))
    return lo, hi


def check_origins() -> str:
    """Assert every asset's origin really is where this file's docstring says.

    Not a spot check on two of them — **all** of them, measured off the emitted
    geometry rather than off the numbers that were meant to produce it. This is
    the lesson from the bridge pair, who agreed a parapet formula in prose,
    each implemented it, and were 3.2 cm apart everywhere except the two points
    a spot check happened to look at. Prose about an origin is worth nothing;
    the mesh is the only thing the game draws.

    ``FLOOR`` assets stand: their lowest vertex is z = 0, so
    ``root.position.y = floorHeight`` sits them on the floor with no fudge.

    ``WALL`` assets are nailed to stone: the wall plane is y = 0 and **no
    vertex is behind it**, so the placer parents one to a point on a wall and
    nothing is ever half inside the masonry. They are centred on X too, so
    "hang it here" means the middle of the thing lands there.

    ``CEILING`` assets are hung from above: their highest vertex is z = 0 and
    the whole body is below it.

    A fitting in the wrong family is the one mistake here a screenshot would
    not show — it would just be an inch into the floor, or a hand into the
    wall, at some angles — so it fails the build instead.
    """
    rows = []
    for name, family in sorted(ORIGIN_FAMILY.items()):
        lo, hi = collection_bounds(name)
        if family == "FLOOR":
            assert abs(lo.z) < 0.006, (
                f"{name} is a FLOOR asset and its lowest vertex is at z = {lo.z:+.4f}, "
                "not 0 — it would float or sink by exactly that much in the game"
            )
        elif family == "WALL":
            assert abs(hi.y) < 0.006, (
                f"{name} is a WALL asset and reaches y = {hi.y:+.4f}; the wall plane is "
                "y = 0 and every vertex must be at or in front of it (−Y). Call "
                "seat_against_wall() with all of its parts."
            )
            assert abs(lo.x + hi.x) < 0.02, (
                f"{name} is a WALL asset and is off-centre on X by "
                f"{(lo.x + hi.x) * 0.5:+.4f} m — 'hang it here' has to mean the middle"
            )
        else:
            assert abs(hi.z) < 0.006, (
                f"{name} is a CEILING asset and its highest vertex is at z = {hi.z:+.4f}; "
                "its origin must be the point it hangs from, with the body below"
            )
        rows.append(
            f"  {name:<16} {family:<5} x {lo.x:+.2f}..{hi.x:+.2f}  "
            f"y {lo.y:+.2f}..{hi.y:+.2f}  z {lo.z:+.2f}..{hi.z:+.2f}  "
            f"({hi.x - lo.x:.2f} × {hi.y - lo.y:.2f} × {hi.z - lo.z:.2f} m)"
        )
    return "\n".join(rows)


BUILDERS = (
    build_tapestry,
    build_banner,
    build_shield,
    build_armour,
    build_wall_torch,
    build_brazier,
    build_chandelier,
    build_throne,
)

# Which frame each asset's origin is in — see :func:`check_origins`. Every
# collection a builder makes must appear here; `main()` checks the two lists
# match, so a new asset cannot be added without saying how it is hung.
ORIGIN_FAMILY = {
    "tapestry": "WALL",
    "banner": "WALL",
    "shield": "WALL",
    "wallTorch": "WALL",
    "chandelier": "CEILING",
    "armour": "FLOOR",
    "brazier": "FLOOR",
    "throne": "FLOOR",
}


def main() -> None:
    reset_scene()
    for builder in BUILDERS:
        builder()

    built = {c.name for c in bpy.data.collections}
    assert built == set(ORIGIN_FAMILY), (
        "every asset must declare its origin family: built but undeclared "
        f"{sorted(built - set(ORIGIN_FAMILY))}, declared but not built "
        f"{sorted(set(ORIGIN_FAMILY) - built)}"
    )

    lo, hi = collection_bounds("armour")
    assert abs(hi.z - ARMOUR_HEIGHT) < 0.01, (
        f"the suit of armour measures {hi.z:.3f} m but its segments sum to "
        f"{ARMOUR_HEIGHT:.3f} — something (the crest? the halberd?) pokes out of the "
        "total the handoff and the placer are both quoting"
    )

    print("\ncastle_dressing_build")
    print(summarise())
    print("\n  origins and bounding sizes — this table is the placement contract:")
    print(check_origins())
    print(f"\n  {len(bpy.data.objects)} nodes, {total_triangles()} triangles total")
    print(f"  tallest child read from kid.ts: {TALLEST_CHILD:.3f} m")
    # The two numbers the *other* agent needs and must not have to guess. A
    # build log is the one place they cannot be stale, and they are derived
    # here from the same constants the geometry is, so they cannot disagree
    # with it either — which is precisely how the bridge pair's parapet
    # formula went wrong (two definitions that met at the spot-check points).
    print("\n  what the placer needs that a bounding box does not say:")
    print(placement_notes())

    bpy.ops.wm.save_as_mainfile(filepath=BLEND)
    print("  saved", BLEND, f"({os.path.getsize(BLEND)} bytes)\n")


if __name__ == "__main__":
    # Blender exits 0 on an uncaught Python exception, so `--python-exit-code 1`
    # is on the command line in `package.json` — that is what covers assertions
    # that fire while the *module body* runs, which this block cannot catch.
    # See hotel_build.py's tail for the full account.
    try:
        main()
    except Exception:
        traceback.print_exc()
        sys.exit(1)
