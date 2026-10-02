"""Builds the Reptile House's enclosure masonry and saves ``art/blend/reptile_cases.blend``.

    blender --background --factory-startup --python-exit-code 1 \
        --python art/blend/reptile_cases_build.py

The ``cases`` kit of the Reptile House (``docs/design/REPTILE-HOUSE.md``,
"ASSET GROUPS" §2): the plinth, frame rim, backboard and pier post that make a
glass wall case; the Frog Jar's drum and rim; the four open enclosure walls;
the Nursery's kerb and rail; Noodle's island kerb; and the Grotto's rock face
with its pool basin and waterfall lip. Glass panes are **not** here — they are
TypeScript planes with ``glassMaterial(0.24)``, placed by the Engineer.

## Every footprint is the game's, read, never typed

Each enclosure's collider is one ``addWall`` stadium or one ``addCircle``
disc registered from the constants in ``src/world/reptileHouse/layout.ts``.
The masonry is built *to those same constants* through ``reptile_constants``
(which itself declares nothing and reads everything with ``blendkit.ts_const``)
so a mesh and its collider cannot drift — CLAUDE.md's "two definitions of one
thing" and ART_DIRECTION §7's collider rule. The build asserts off the emitted
vertices that:

* no wall or kerb reaches outside its own collider footprint (the collider
  always encloses the drawn stone, never the other way round);
* every open enclosure wall tops out at exactly
  ``REPTILE_ENCLOSURE_WALL_HEIGHT``, the nursery rail at
  ``REPTILE_NURSERY_RAIL_TOP``, the case rim at ``REPTILE_GLASS_TOP``;
* a pier post, vine and leaves included, stays inside
  ``REPTILE_PIER_POST_RADIUS``.

The numbers this file *does* own — wall thickness, a coping's bulge, how many
lobes a scalloped wall has, the Grotto's boulders — are cosmetic: nothing in
the game depends on them, and the sizes that matter to a placer are measured
off the emitted mesh and printed on every run.

## Conventions (ART_DIRECTION §7, and the rest of ``art/blend``)

* 1 Blender unit = 1 metre; **Blender −Y is the game's +Z**. A case's front
  (where the glass is) faces −Y, so a north-wall case needs no rotation and a
  west-wall case is the same node rotated at its root.
* Every node is authored about its own footprint centre, on the floor, and
  leaves Blender at an identity transform. Rings and stadiums are centred;
  the plinth's stadium runs along X.
* **Nothing stands *on* the floor plate — everything is sunk 0.05 m into it
  and has no bottom face** (``FLOOR_SINK``), so no face of this kit shares the
  floor's plane (ART_DIRECTION §7, "two surfaces in the same plane").
  Likewise the backboard runs up into the rim and down into the plinth, and
  the relief leaves sit into the board, rather than any two faces agreeing.
* The case plinth and rim have **no back face**: that side is 0.2 m off the
  room wall and never seen.
* One node per colour. No colour, material or texture is in the ``.glb``;
  ``reptileCasesAssets.ts`` (the Engineer's loader) owns the colour table.
  Nothing in this kit is painted, so no node carries UVs.
"""

import math
import os
import sys
import traceback

import bpy
from mathutils import Matrix, Vector

sys.dont_write_bytecode = True
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from blendkit import (  # noqa: E402
    REPO,
    TAU,
    Part,
    collection,
    ellipsoid,
    extrude_outline,
    flat_top_box,
    reset_scene,
    revolve,
    summarise,
    sweep_path,
    total_triangles,
    tube,
)
from reptile_constants import (  # noqa: E402
    REPTILE_CASE_HALF_DEPTH,
    REPTILE_CASE_PLINTH_HEIGHT,
    REPTILE_CASE_SEGMENT,
    REPTILE_ENCLOSURE_WALL_HEIGHT,
    REPTILE_GLASS_TOP,
    REPTILE_ISLAND_KERB_HEIGHT,
    REPTILE_ISLAND_RADIUS,
    REPTILE_JAR_BASE_HEIGHT,
    REPTILE_JAR_RADIUS,
    REPTILE_LAGOON_HALF,
    REPTILE_LAGOON_SEGMENT,
    REPTILE_NURSERY_KERB_HEIGHT,
    REPTILE_NURSERY_RADIUS,
    REPTILE_NURSERY_RAIL_TOP,
    REPTILE_PIER_POST_RADIUS,
    REPTILE_ROUND_WALL_RADIUS,
    REPTILE_TORTOISE_HALF,
    REPTILE_TORTOISE_SEGMENT,
)

BLEND = os.path.join(REPO, "art", "blend", "reptile_cases.blend")

#: How far below the floor every grounded node reaches. Below the plate so no
#: face of this kit lies in the floor's plane; small so nothing shows if a
#: floor decal is ever cut around a footprint.
FLOOR_SINK = 0.05

#: The Frog Jar's collider is `REPTILE_JAR_RADIUS + 0.15` in `layout.ts`
#: (`EXHIBIT_PLACEMENTS`, an expression `ts_const` cannot read); the drum's
#: foot is derived here in the same arithmetic and asserted below.
JAR_FOOT_RADIUS = REPTILE_JAR_RADIUS + 0.15

#: Enclosure masonry: how thick a 1.4 m wall is, how far its coping bulges
#: past the body, and how deep the Snake Grove's scallops crimp in. The body
#: face sits `COPING_BULGE` inside the collider radius so the coping's bulge
#: lands exactly on it — the collider encloses the stone everywhere.
WALL_THICKNESS = 0.4
COPING_BULGE = 0.06
SCALLOP_LOBES = 8
SCALLOP_DEPTH = 0.1

#: The pier post: a stone core with a vine spiralling up it. Core, vine tube
#: and leaf tips all stay inside `REPTILE_PIER_POST_RADIUS` (asserted).
PIER_HEIGHT = 3.2
PIER_CORE_RADIUS = REPTILE_PIER_POST_RADIUS - 0.05
VINE_TUBE_RADIUS = 0.05
VINE_TURNS = 2.5
VINE_LEAVES = 8
VINE_LEAF_LENGTH = 0.16

#: The glass wall case. The plinth body sits `CASE_LIP` inside the collider so
#: its base kerb and top lip, which stand proud of the body, land on it.
CASE_LIP = 0.07
#: Frame rim: from the glass top up `CASE_RIM_HEIGHT`, `CASE_RIM_INSET` deep.
CASE_RIM_HEIGHT = 0.2
CASE_RIM_INSET = 0.12
#: The glass panes (TS) stand this far inside the frame face. Printed, not
#: used here — it is the Engineer's number and this is only where it is stated
#: for the render's stand-in panes.
CASE_GLASS_RECESS = 0.06

#: The nursery: a kerb with a glass drum on it, held by a gold rail. The
#: rail's outermost extent *is* the glass radius, so the loader can measure
#: the glass radius off the rail node (`visibleBounds`) rather than be told.
NURSERY_GLASS_RADIUS = REPTILE_NURSERY_RADIUS - 0.2
NURSERY_RAIL_POSTS = 8
NURSERY_RAIL_POST_RADIUS = 0.04
NURSERY_RAIL_RING = 0.08

#: The Grotto: mesh-owned throughout, measured and printed.
GROTTO_HEIGHT = 3.5
GROTTO_POOL_CENTRE = (0.3, -1.3)
GROTTO_POOL_RADIUS = 1.5
GROTTO_POOL_LIP = 0.3
GROTTO_LIP_Z = 2.1


# =============================================================================
# Generators this kit needs that blendkit has not got
# =============================================================================


def stadium_outline(segment: float, half: float, arc_steps: int = 12):
    """The closed outline of a stadium along X, as ``(x, y, nx, ny, back)``.

    ``back`` marks an outline *edge* (from this point to the next) that lies on
    the +Y straight run — the side against the room wall, which the case
    plinth and rim leave unbuilt. Points run anticlockwise from the right
    end's bottom, so the edge from point ``i`` runs to point ``i + 1``.
    """
    half_seg = segment * 0.5
    points = []
    # Right arc: −90° → +90°.
    for i in range(arc_steps + 1):
        angle = -math.pi * 0.5 + math.pi * i / arc_steps
        points.append((half_seg + half * math.cos(angle), half * math.sin(angle),
                       math.cos(angle), math.sin(angle), i == arc_steps))
    # Left arc: +90° → +270°. The edge from the right arc's last point to the
    # left arc's first point is the back run (flagged above).
    for i in range(arc_steps + 1):
        angle = math.pi * 0.5 + math.pi * i / arc_steps
        points.append((-half_seg + half * math.cos(angle), half * math.sin(angle),
                       math.cos(angle), math.sin(angle), False))
    return points


def circle_outline(radius: float, steps: int, lobes: int = 0, depth: float = 0.0):
    """A closed circular outline as ``(x, y, nx, ny, back)``, optionally crimped.

    With ``lobes`` the radius dips by up to ``depth`` between lobe peaks — a
    pie-crust crimp in plan. The peaks sit exactly on ``radius``.
    """
    points = []
    for i in range(steps):
        angle = i * TAU / steps
        dip = depth * (1.0 - math.cos(lobes * angle)) * 0.5 if lobes else 0.0
        r = radius - dip
        points.append((r * math.cos(angle), r * math.sin(angle),
                       math.cos(angle), math.sin(angle), False))
    return points


def swept_wall(outline, profile, *, closed_profile: bool = False, cap_top: float | None = None,
               skip_back: bool = False):
    """Sweep an ``(offset, z)`` profile round a closed outline.

    ``offset`` is along the outline's outward normal (negative is inward).
    An open profile makes a wall with no bottom; ``closed_profile`` makes a
    closed ring (a rim). ``cap_top`` fills the top with one n-gon at that
    height from the profile's *last* point's offset — the plinth's shelf.
    ``skip_back`` leaves the back-flagged outline edges unbuilt.
    """
    count = len(outline)
    rows = len(profile)
    verts = []
    for x, y, nx, ny, _ in outline:
        for off, z in profile:
            verts.append((x + nx * off, y + ny * off, z))
    faces = []
    for i in range(count):
        if skip_back and outline[i][4]:
            continue
        j = (i + 1) % count
        for p in range(rows if closed_profile else rows - 1):
            q = (p + 1) % rows
            faces.append((i * rows + p, i * rows + q, j * rows + q, j * rows + p))
    if cap_top is not None:
        last = rows - 1
        faces.append(tuple(i * rows + last for i in range(count)))
    return verts, faces


def lathe_open(profile, segments: int):
    """A surface of revolution about Z from an **open** ``(r, z)`` profile.

    Unlike :func:`blendkit.revolve` the profile does not close, so a drum with
    no bottom face comes out with no bottom face. A last point at ``r == 0``
    makes a pole that ``Part.emit`` welds.
    """
    verts = []
    faces = []
    rows = len(profile)
    for s in range(segments):
        angle = s * TAU / segments
        for r, z in profile:
            verts.append((r * math.cos(angle), r * math.sin(angle), z))
    for s in range(segments):
        t = (s + 1) % segments
        for p in range(rows - 1):
            faces.append((s * rows + p, s * rows + p + 1, t * rows + p + 1, t * rows + p))
    return verts, faces


def enclosure_profile(height: float, thickness: float = WALL_THICKNESS):
    """The open ``(offset, z)`` cross-section of a 1.4 m enclosure wall.

    Outer face up, a rounded coping bulging ``COPING_BULGE`` out both sides,
    inner face down. The outer body face is at offset ``-COPING_BULGE`` so the
    coping's widest point lands on the outline itself (the collider).
    """
    b = COPING_BULGE
    t = thickness
    neck = height - 0.35
    return [
        (-b, -FLOOR_SINK),
        (-b, neck),
        (0.0, neck + 0.13),
        (-b - 0.05, height),
        (-t + 0.05, height),
        (-t - b, neck + 0.13),
        (-t, neck),
        (-t, -FLOOR_SINK),
    ]


def leaf_outline(length: float, width: float, points: int = 6):
    """A pointed leaf in the XZ plane, base at the origin, tip at ``+X``."""
    outline = []
    for i in range(points):
        t = i / points
        angle = t * TAU
        x = length * 0.5 * (1.0 + math.cos(angle))
        z = width * 0.5 * math.sin(angle) * (0.6 + 0.4 * math.sin(math.pi * x / length))
        outline.append((x, z))
    return outline


# =============================================================================
# The glass wall case
# =============================================================================


def build_case(coll):
    outline = stadium_outline(REPTILE_CASE_SEGMENT, REPTILE_CASE_HALF_DEPTH)
    h = REPTILE_CASE_PLINTH_HEIGHT
    lip = CASE_LIP
    # Coursed stone: a base kerb, a body with one shadow groove, and a top lip
    # the glass sits behind. All offsets ≤ 0 so the lip lands on the collider.
    profile = [
        (0.0, -FLOOR_SINK),
        (0.0, 0.12),
        (-lip, 0.18),
        (-lip, h * 0.56),
        (-lip - 0.03, h * 0.6),
        (-lip - 0.03, h * 0.66),
        (-lip, h * 0.7),
        (-lip, h - 0.12),
        (0.0, h - 0.06),
        (0.0, h),
    ]
    Part("rc-case-plinth").add(
        *swept_wall(outline, profile, cap_top=h, skip_back=True)
    ).emit(coll)

    # The frame rim: a closed ring section standing on the glass top.
    g = REPTILE_GLASS_TOP
    # A soft bulge on its outer face; the bulge is what lands on the collider.
    rim = [
        (-0.03, g),
        (-0.03, g + CASE_RIM_HEIGHT * 0.3),
        (0.0, g + CASE_RIM_HEIGHT * 0.5),
        (-0.03, g + CASE_RIM_HEIGHT * 0.7),
        (-0.03, g + CASE_RIM_HEIGHT),
        (-CASE_RIM_INSET, g + CASE_RIM_HEIGHT),
        (-CASE_RIM_INSET, g),
    ]
    Part("rc-case-rim").add(
        *swept_wall(outline, rim, closed_profile=True, skip_back=True)
    ).emit(coll)

    # The backboard: a flat slab across the back, run into the plinth below
    # and the rim above. Its corners stay inside the stadium's arcs.
    half_w = REPTILE_CASE_SEGMENT * 0.5 + 0.4
    y_back = REPTILE_CASE_HALF_DEPTH - CASE_LIP - 0.03
    board_depth = 0.15
    arc_y = math.sqrt(REPTILE_CASE_HALF_DEPTH ** 2 - (half_w - REPTILE_CASE_SEGMENT * 0.5) ** 2)
    assert arc_y > y_back, "the backboard's corners poke out through the plinth's arcs"
    z0 = h - 0.05
    z1 = g + CASE_RIM_HEIGHT * 0.75
    board = Part("rc-case-backboard")
    verts = [
        (-half_w, y_back - board_depth, z0), (half_w, y_back - board_depth, z0),
        (half_w, y_back, z0), (-half_w, y_back, z0),
        (-half_w, y_back - board_depth, z1), (half_w, y_back - board_depth, z1),
        (half_w, y_back, z1), (-half_w, y_back, z1),
    ]
    faces = [(0, 1, 2, 3), (7, 6, 5, 4), (0, 4, 5, 1), (1, 5, 6, 2), (2, 6, 7, 3), (3, 7, 4, 0)]
    board.add(verts, faces).emit(coll, smooth=False)

    # Jungle relief: big leaves standing a few centimetres off the board, their
    # backs sunk into it. Fans of leaves from two "stems" at the bottom corners
    # and one hanging from the top — enough to read as jungle from across the
    # room, nothing a child has to look closely at.
    relief = Part("rc-case-backboard-relief")
    face_y = y_back - board_depth
    leaves = [
        # (base x, base z, angle from +X in the XZ plane, length, width)
        (-half_w + 0.3, z0 + 0.1, 70, 1.3, 0.55),
        (-half_w + 0.3, z0 + 0.1, 40, 1.1, 0.5),
        (-half_w + 0.3, z0 + 0.1, 100, 1.0, 0.45),
        (half_w - 0.3, z0 + 0.1, 110, 1.3, 0.55),
        (half_w - 0.3, z0 + 0.1, 140, 1.1, 0.5),
        (half_w - 0.3, z0 + 0.1, 80, 1.0, 0.45),
        (0.0, z1 - 0.1, -75, 1.0, 0.5),
        (0.0, z1 - 0.1, -105, 0.9, 0.45),
    ]
    for bx, bz, angle, length, width in leaves:
        verts, faces = extrude_outline(leaf_outline(length, width), 0.08, centre=(length * 0.5, 0.0))
        # extrude_outline's prism is centred on Y; shift it so its back sits
        # 2 cm into the board and its front stands 6 cm proud (−Y is out).
        # Blender's Y rotation turns +X towards −Z, so negate to lift the tip.
        m = Matrix.Translation((bx, face_y - 0.02, bz)) @ Matrix.Rotation(-math.radians(angle), 4, "Y")
        relief.add(verts, faces, m)
    relief.emit(coll)
    return {"glass_recess": CASE_GLASS_RECESS, "board_face_y": face_y}


def build_pier(coll):
    core = Part("rc-pier-post")
    core.add(*tube(PIER_CORE_RADIUS, PIER_HEIGHT - 0.15 + FLOOR_SINK, sides=14, z0=-FLOOR_SINK))
    # A squashed cap, its equator sunk into the core's top.
    core.at(*ellipsoid(PIER_CORE_RADIUS + 0.02, PIER_CORE_RADIUS + 0.02, 0.17, 1),
            z=PIER_HEIGHT - 0.17)
    core.emit(coll)

    vine = Part("rc-pier-vine")
    samples = 32
    z_lo, z_hi = 0.3, PIER_HEIGHT - 0.35
    helix_r = REPTILE_PIER_POST_RADIUS - VINE_TUBE_RADIUS
    path = []
    for i in range(samples + 1):
        t = i / samples
        angle = t * VINE_TURNS * TAU
        path.append((helix_r * math.cos(angle), helix_r * math.sin(angle), z_lo + t * (z_hi - z_lo)))
    vine.add(*sweep_path(path, VINE_TUBE_RADIUS, sides=5, closed=False))
    # Leaves hug the post along the vine's tangent, tilted up, never radially
    # out: the tip stays inside the collider.
    for k in range(VINE_LEAVES):
        t = (k + 0.5) / VINE_LEAVES
        angle = t * VINE_TURNS * TAU
        x, y, z = helix_r * math.cos(angle), helix_r * math.sin(angle), z_lo + t * (z_hi - z_lo)
        verts, faces = extrude_outline(leaf_outline(VINE_LEAF_LENGTH, 0.1), 0.02, centre=(VINE_LEAF_LENGTH * 0.5, 0.0))
        # Leaf in XZ pointing +X → rotate to lie tangentially (around Z by the
        # helix angle + 90°), tilted 40° upward, then moved to the stem.
        m = (Matrix.Translation((x, y, z))
             @ Matrix.Rotation(angle + math.pi * 0.5, 4, "Z")
             @ Matrix.Rotation(math.radians(40 if k % 2 else -40), 4, "Y"))
        vine.add(verts, faces, m)
    vine.emit(coll)


# =============================================================================
# Enclosures
# =============================================================================


def build_jar(coll):
    r = REPTILE_JAR_RADIUS
    h = REPTILE_JAR_BASE_HEIGHT
    base = [
        (JAR_FOOT_RADIUS, -FLOOR_SINK),
        (JAR_FOOT_RADIUS, 0.1),
        (JAR_FOOT_RADIUS - 0.05, 0.18),
        (r + 0.02, h - 0.14),
        (r + 0.08, h - 0.06),
        (r + 0.02, h),
        (0.0, h),
    ]
    Part("rc-jar-base").add(*lathe_open(base, 20)).emit(coll)
    g = REPTILE_GLASS_TOP
    rim = [(r - 0.1, g), (r + 0.06, g), (r + 0.08, g + 0.1), (r + 0.06, g + 0.2),
           (r - 0.1, g + 0.2), (r - 0.12, g + 0.1)]
    Part("rc-jar-rim").add(*revolve(rim, 20)).emit(coll)


def build_round_wall(coll):
    outline = circle_outline(REPTILE_ROUND_WALL_RADIUS, 32, SCALLOP_LOBES, SCALLOP_DEPTH)
    Part("rc-round-wall").add(
        *swept_wall(outline, enclosure_profile(REPTILE_ENCLOSURE_WALL_HEIGHT))
    ).emit(coll)


def build_stadium_wall(coll, name: str, segment: float, half: float):
    outline = stadium_outline(segment, half)
    Part(name).add(
        *swept_wall(outline, enclosure_profile(REPTILE_ENCLOSURE_WALL_HEIGHT))
    ).emit(coll)


def build_nursery(coll):
    r = REPTILE_NURSERY_RADIUS
    h = REPTILE_NURSERY_KERB_HEIGHT
    t = 0.4
    # A flat-topped kerb the glass drum stands on, with a soft outer bevel.
    kerb = [
        (0.0, -FLOOR_SINK),
        (0.0, h - 0.16),
        (-0.02, h - 0.04),
        (-0.08, h),
        (-t + 0.06, h),
        (-t, h - 0.06),
        (-t, -FLOOR_SINK),
    ]
    Part("rc-nursery-kerb").add(*swept_wall(circle_outline(r, 32), kerb)).emit(coll)

    rail = Part("rc-nursery-rail")
    gr = NURSERY_GLASS_RADIUS
    top = REPTILE_NURSERY_RAIL_TOP
    ring = [(gr - NURSERY_RAIL_RING, top - NURSERY_RAIL_RING), (gr, top - NURSERY_RAIL_RING),
            (gr, top), (gr - NURSERY_RAIL_RING, top)]
    rail.add(*revolve(ring, 32))
    post_r = NURSERY_RAIL_POST_RADIUS
    for k in range(NURSERY_RAIL_POSTS):
        angle = k * TAU / NURSERY_RAIL_POSTS
        # Posts stand just inside the glass, sunk into the kerb's top.
        pr = gr - post_r
        rail.at(*tube(post_r, top - NURSERY_RAIL_RING * 0.5 - (h - 0.1), sides=6, z0=h - 0.1),
                x=pr * math.cos(angle), y=pr * math.sin(angle))
    rail.emit(coll)


def build_island_kerb(coll):
    r = REPTILE_ISLAND_RADIUS
    h = REPTILE_ISLAND_KERB_HEIGHT
    t = 0.45
    # Mossy and round-shouldered: the kerb Noodle's rock sits inside.
    kerb = [
        (0.0, -FLOOR_SINK),
        (0.0, h - 0.22),
        (-0.03, h - 0.07),
        (-0.14, h),
        (-t + 0.1, h),
        (-t - 0.02, h - 0.1),
        (-t, h - 0.25),
        (-t, -FLOOR_SINK),
    ]
    Part("rc-island-kerb").add(*swept_wall(circle_outline(r, 40), kerb)).emit(coll)


# =============================================================================
# The Grotto
# =============================================================================

#: (centre x, y, z, radii x, y, z) — a back arc of boulders, two low ones at
#: the front corners, two stacked up to the waterfall's top.
GROTTO_BOULDERS = [
    (-1.9, 0.9, 1.0, 1.3, 1.1, 1.0),
    (0.0, 1.1, 1.3, 1.6, 1.2, 1.3),
    (1.9, 0.9, 0.9, 1.2, 1.0, 0.95),
    (-0.9, 1.3, 2.4, 1.1, 0.9, 0.9),
    (0.8, 1.4, 2.7, 1.0, 0.85, 0.8),
    (-2.8, 0.3, 0.45, 0.7, 0.6, 0.5),
    (2.7, 0.2, 0.4, 0.6, 0.55, 0.45),
]


def build_grotto(coll):
    rock = Part("rc-grotto-rock")
    for cx, cy, cz, rx, ry, rz in GROTTO_BOULDERS:
        rock.at(*ellipsoid(rx, ry, rz, 1), x=cx, y=cy, z=cz)
    # The waterfall lip: a flat shelf poking out of the middle boulder. Water
    # (TS) falls off its front edge into the pool.
    lip_depth = 0.9
    lip_y = GROTTO_BOULDERS[1][1] - GROTTO_BOULDERS[1][4] + 0.55 - lip_depth * 0.5
    rock.at(*flat_top_box(0.8, lip_depth, 0.2, 0.06), x=0.3, y=lip_y, z=GROTTO_LIP_Z - 0.1)
    # The pool basin: a low lipped ring, open to the floor inside.
    pr = GROTTO_POOL_RADIUS
    basin = [
        (pr, -FLOOR_SINK),
        (pr, GROTTO_POOL_LIP - 0.1),
        (pr - 0.08, GROTTO_POOL_LIP),
        (pr - 0.2, GROTTO_POOL_LIP),
        (pr - 0.28, GROTTO_POOL_LIP - 0.1),
        (pr - 0.28, -FLOOR_SINK),
    ]
    rock.at(*lathe_open(basin, 24), x=GROTTO_POOL_CENTRE[0], y=GROTTO_POOL_CENTRE[1])
    rock.emit(coll)

    moss = Part("rc-grotto-moss")
    for cx, cy, cz, rx, ry, rz in GROTTO_BOULDERS[:5]:
        moss.at(*ellipsoid(rx * 0.55, ry * 0.5, rz * 0.22, 1), x=cx, y=cy - ry * 0.15, z=cz + rz * 0.86)
    moss.emit(coll)
    return {
        "lip_front_y": lip_y - lip_depth * 0.5,
        "lip_z": GROTTO_LIP_Z,
    }


# =============================================================================
# Measuring what was built
# =============================================================================


def measured():
    bounds = {}
    for obj in bpy.data.objects:
        if obj.type != "MESH":
            continue
        lo = Vector((1e9, 1e9, 1e9))
        hi = Vector((-1e9, -1e9, -1e9))
        for v in obj.data.vertices:
            lo = Vector((min(lo[i], v.co[i]) for i in range(3)))
            hi = Vector((max(hi[i], v.co[i]) for i in range(3)))
        bounds[obj.name] = (lo, hi)
    return bounds


def max_radius(name: str) -> float:
    return max(math.hypot(v.co.x, v.co.y) for v in bpy.data.objects[name].data.vertices)


def max_stadium_overreach(name: str, segment: float, half: float) -> float:
    """How far any vertex stands outside the stadium ``addWall(a, b, half)``."""
    hs = segment * 0.5
    worst = -1e9
    for v in bpy.data.objects[name].data.vertices:
        dx = max(abs(v.co.x) - hs, 0.0)
        worst = max(worst, math.hypot(dx, v.co.y) - half)
    return worst


def check_contract(bounds):
    """Every promise the loader re-asserts, proved on the emitted vertices."""
    eps = 1e-3
    lines = []

    def top(name):
        return bounds[name][1].z

    # Open enclosure walls top out at exactly the collider's absolute top.
    for name in ("rc-round-wall", "rc-lagoon-wall", "rc-tortoise-wall"):
        assert abs(top(name) - REPTILE_ENCLOSURE_WALL_HEIGHT) < eps, (
            f"{name} tops out at {top(name):.3f}, not REPTILE_ENCLOSURE_WALL_HEIGHT "
            f"{REPTILE_ENCLOSURE_WALL_HEIGHT}"
        )
    assert abs(top("rc-nursery-rail") - REPTILE_NURSERY_RAIL_TOP) < eps
    assert abs(top("rc-nursery-kerb") - REPTILE_NURSERY_KERB_HEIGHT) < eps
    assert abs(top("rc-island-kerb") - REPTILE_ISLAND_KERB_HEIGHT) < eps
    assert abs(top("rc-case-plinth") - REPTILE_CASE_PLINTH_HEIGHT) < eps
    assert abs(bounds["rc-case-rim"][0].z - REPTILE_GLASS_TOP) < eps
    assert abs(bounds["rc-jar-rim"][0].z - REPTILE_GLASS_TOP) < eps
    assert abs(top("rc-jar-base") - REPTILE_JAR_BASE_HEIGHT) < eps

    # Nothing drawn stands outside its collider footprint.
    radial = {
        "rc-round-wall": REPTILE_ROUND_WALL_RADIUS,
        "rc-nursery-kerb": REPTILE_NURSERY_RADIUS,
        "rc-nursery-rail": NURSERY_GLASS_RADIUS,
        "rc-island-kerb": REPTILE_ISLAND_RADIUS,
        "rc-jar-base": JAR_FOOT_RADIUS,
        "rc-pier-post": REPTILE_PIER_POST_RADIUS,
        "rc-pier-vine": REPTILE_PIER_POST_RADIUS,
    }
    for name, limit in radial.items():
        reach = max_radius(name)
        assert reach <= limit + eps, f"{name} reaches r {reach:.3f}, outside its {limit} footprint"
        lines.append(f"    {name:<22} reaches r {reach:.3f} of {limit:.3f}")
    # The rail's outer extent *is* the glass radius — the loader measures it.
    assert abs(max_radius("rc-nursery-rail") - NURSERY_GLASS_RADIUS) < eps
    stadiums = {
        "rc-case-plinth": (REPTILE_CASE_SEGMENT, REPTILE_CASE_HALF_DEPTH),
        "rc-case-rim": (REPTILE_CASE_SEGMENT, REPTILE_CASE_HALF_DEPTH),
        "rc-case-backboard": (REPTILE_CASE_SEGMENT, REPTILE_CASE_HALF_DEPTH),
        "rc-case-backboard-relief": (REPTILE_CASE_SEGMENT, REPTILE_CASE_HALF_DEPTH),
        "rc-lagoon-wall": (REPTILE_LAGOON_SEGMENT, REPTILE_LAGOON_HALF),
        "rc-tortoise-wall": (REPTILE_TORTOISE_SEGMENT, REPTILE_TORTOISE_HALF),
    }
    for name, (segment, half) in stadiums.items():
        over = max_stadium_overreach(name, segment, half)
        assert over <= eps, f"{name} stands {over:.3f} m outside addWall(…, {half})"
        lines.append(f"    {name:<22} stadium {segment} × half {half}: worst overreach {over:+.3f}")
    # Every grounded node is sunk into the floor, never sat on it.
    for name, (lo, _) in bounds.items():
        if name in ("rc-case-rim", "rc-jar-rim", "rc-nursery-rail", "rc-case-backboard",
                    "rc-case-backboard-relief", "rc-grotto-moss", "rc-pier-vine"):
            continue
        assert abs(lo.z + FLOOR_SINK) < eps, f"{name} base is at {lo.z:+.3f}, not −{FLOOR_SINK}"
    return "\n".join(lines)


def main() -> None:
    reset_scene()
    case = build_case(collection("case"))
    build_pier(collection("pier"))
    build_jar(collection("jar"))
    build_round_wall(collection("round"))
    build_stadium_wall(collection("lagoon"), "rc-lagoon-wall", REPTILE_LAGOON_SEGMENT, REPTILE_LAGOON_HALF)
    build_stadium_wall(collection("tortoise"), "rc-tortoise-wall", REPTILE_TORTOISE_SEGMENT, REPTILE_TORTOISE_HALF)
    build_nursery(collection("nursery"))
    build_island_kerb(collection("island"))
    grotto = build_grotto(collection("grotto"))
    bpy.context.view_layer.update()

    bounds = measured()
    print("\nreptile_cases_build")
    print(summarise())
    print("\n  the contract, measured off the emitted vertices:")
    print(check_contract(bounds))
    print("\n  what the Engineer needs (mesh-owned, measured):")
    print(f"    nursery glass radius (= rc-nursery-rail's XY reach): {max_radius('rc-nursery-rail'):.3f}")
    print(f"    case glass panes: {case['glass_recess']} inside the plinth outline, "
          f"from z {REPTILE_CASE_PLINTH_HEIGHT} to {REPTILE_GLASS_TOP}; "
          f"backboard face at y {case['board_face_y']:+.3f} (game z {-case['board_face_y']:+.3f})")
    print(f"    pier post height {bounds['rc-pier-post'][1].z:.3f}")
    glo, ghi = bounds["rc-grotto-rock"]
    print(f"    grotto rock: {ghi.x - glo.x:.2f} wide × {ghi.y - glo.y:.2f} deep × {ghi.z:.2f} tall; "
          f"bounds x {glo.x:+.2f}..{ghi.x:+.2f}, game z {-ghi.y:+.2f}..{-glo.y:+.2f}")
    print(f"    grotto pool: centre (x {GROTTO_POOL_CENTRE[0]:+.2f}, game z {-GROTTO_POOL_CENTRE[1]:+.2f}) "
          f"inner r {GROTTO_POOL_RADIUS - 0.28:.2f}, lip top {GROTTO_POOL_LIP}")
    print(f"    waterfall lip front edge: x +0.30, game z {-grotto['lip_front_y']:+.2f}, y {grotto['lip_z']:.2f}")
    assert abs(ghi.z - GROTTO_HEIGHT) < 0.05, f"grotto is {ghi.z:.2f} tall, not {GROTTO_HEIGHT}"
    print(f"\n  {len(bpy.data.objects)} nodes, {total_triangles()} triangles total (budget 6000)")
    assert total_triangles() <= 6000, "over the kit's 6 000-triangle budget"

    bpy.ops.wm.save_as_mainfile(filepath=BLEND)
    print("  saved", BLEND, f"({os.path.getsize(BLEND)} bytes)\n")


if __name__ == "__main__":
    try:
        main()
    except Exception:
        traceback.print_exc()
        sys.exit(1)
