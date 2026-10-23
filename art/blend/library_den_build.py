"""Builds the Library's secret den kit and saves ``art/blend/libraryDen.blend``.

    blender --background --factory-startup --python-exit-code 1 \
        --python art/blend/library_den_build.py

Library v2 (epic #714, part 5, #719): the den behind the reading room's west
wall, where a baby dragon hoards books. Jim, 22 October 2026: *"model in
Blender as much as is needed, in preference to coding geometric primitives to
create items in the world"* — so every visible thing the den track drew, or
would have drawn, from three.js primitives is authored here instead: the
den's floor, its three walls, the lintel over its doorway, and the pull book
on the secret shelf, plus the dressing that makes the den a room of its own
(book niches cut into its far walls, raised stars and a moon, two lanterns).

**A second kit, not an addition to ``library.glb``.** The library kit ships
11 KB under its 450 KB budget; the den is tens of KB. ``library_build.py``
is the authoring source for everything else in the Library, and this file is
its sibling: same ``blendkit``, same conventions, same seam with the
Engineer, and it **imports** ``library_build`` for every figure the two kits
share (the shelf's length and height, its rows, the book depth, the child's
sizes) rather than typing one twice.

## The seam with the Engineer

* **This file owns shape and nothing else.** No colour, no material, no UV.
  ``library_den_export.py`` writes the ``.glb``; ``pnpm run blend:library-den``
  runs build → export → pack.
* **Every size the game owns is read from its owner**, with ``ts_const``:
  the wall's half-thickness and height, the den's depth, its doorway's half
  width and its run north past the doorway are ``src/world/library/layout.ts``'s
  (the den track laid the den out from them, #719 plan Step 11); the doorway's
  width and the lintel's base are the drawn secret shelf's (the case fills
  the gap, so ``SHELF_LENGTH`` and ``SHELF_HEIGHT`` here); the niche rows are
  the kit's shelf rows, so a den row is a reading-room row and the Engineer's
  ``shelveFace`` arithmetic fills it with the same book blocks.
* Every figure in :data:`CONTRACT` is **asserted against the emitted
  geometry** at the end of this run, and ``report_extras`` prints the rest —
  the Engineer re-measures all of it off the loaded mesh
  (``src/art/models/libraryDenKit.ts``) and types none of it.

## Frame

1 Blender unit = 1 metre; **Blender −Y is the game's +Z**. The ``den`` asset's
origin is **the middle of its doorway, on the reading room's west wall's
centre line, at the bottom of the den's floor slab** — the slab is the den's
plinth, hanging below the floor she walks on (``floorTop``, measured), the
way the exterior's plinth stands under its door. The doorway faces −Y (the
game's +Z, the room); the den runs away to +Y; its longer run past the
doorway is on +X. In the game that is ``rotation.y = +π/2`` at the secret
case's wall spot, so asset +Z (the doorway) points into the room (+X) and
asset +X points north (−Z).

The ``denLantern`` hangs on a wall: its back is on y = 0 (the wall's face),
it protrudes to −Y (the game's +Z), its bottom is at z = 0. The ``secretBook``
is a book block like the kit's six: base-centred, thickness along X, spine on
−Y (the game's +Z, a shelf's front).
"""

import math
import os
import sys
import traceback

import bpy
from mathutils import Matrix, Vector
from mathutils.bvhtree import BVHTree

sys.dont_write_bytecode = True
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from blendkit import (  # noqa: E402
    REPO,
    TAU,
    Part,
    box,
    collection,
    ellipsoid,
    extrude_outline,
    icosphere,
    reset_scene,
    revolve,
    rounded_box,
    summarise,
    total_triangles,
    ts_const,
)
import library_build as lb  # noqa: E402  (import-safe: everything there is behind main())

BLEND = os.path.join(REPO, "art", "blend", "libraryDen.blend")

# =============================================================================
# The game's numbers. Read, never typed.
# =============================================================================

LAYOUT_MODULE = "src/world/library/layout.ts"
# The reading room's walls — the den's are the same wall (one number).
WALL_HALF = ts_const(LAYOUT_MODULE, "LIBRARY_WALL_HALF")
WALL_HEIGHT = ts_const(LAYOUT_MODULE, "LIBRARY_WALL_HEIGHT")
# The den's plan (#719, plan Step 11): how far it runs behind the room's west
# wall, half its doorway, and how far on north past the doorway's north edge
# its far corner is. The south edge of the doorway *is* the den's south wall.
DEN_DEPTH = ts_const(LAYOUT_MODULE, "LIBRARY_DEN_DEPTH")
DEN_DOOR_HALF = ts_const(LAYOUT_MODULE, "LIBRARY_DEN_DOOR_HALF")
DEN_NORTH_PAST_DOOR = ts_const(LAYOUT_MODULE, "DEN_NORTH_PAST_DOOR")

# The doorway is exactly the secret shelf: the shut case fills it (the
# library kit's contract, which the game asserts in `shell.ts`'s
# `libraryDenGap`). So its width and the lintel's base are the drawn shelf's.
DOOR_WIDTH = lb.SHELF_LENGTH
LINTEL_BASE = lb.SHELF_HEIGHT
assert abs(DOOR_WIDTH - 2.0 * DEN_DOOR_HALF) < 1e-9, (
    f"layout.ts lays the den's doorway out {2.0 * DEN_DOOR_HALF} m wide and the secret shelf "
    f"(library_build.SHELF_LENGTH) is {DOOR_WIDTH} m — the den must be laid out from the case"
)

CHILD_HEIGHT = lb.CHILD_HEIGHT
CHILD_REACH = lb.CHILD_REACH


def deg(x: float) -> float:
    return math.radians(x)


# =============================================================================
# THE CONTRACT — the kit's own figures, each asserted against the mesh
# =============================================================================

TOL = 0.005
EXACT, AT_MOST, AT_LEAST = "=", "<=", ">="

# --- the den -----------------------------------------------------------------
# The floor slab under the walkable floor. Cosmetic: its underside is never
# seen (the den hangs in an empty space). Matches the reading room's slab on
# the day (shell.ts draws its floor 0.5 m thick); nothing reads either.
FLOOR_THICKNESS = 0.5
# Book niches cut into the two far walls (never cases standing against them,
# so the den track's wall colliders and keep-outs are untouched): deep enough
# for a kit book (BOOK_DEPTH) behind a thin wood back, their boards' fronts a
# hair behind the wall's face so the opening reads as a lip, not a seam.
NICHE_DEPTH = 0.34
NICHE_BACK = 0.03
NICHE_BOARD_SETBACK = 0.02
NICHE_BAYS = 3
NICHE_PIER = 0.275
# How far the stars and the moon stand off the wall — a relief, inside the
# ink outline's own thickness (the outline hull is 20–30 mm), above every
# reach (the lowest sits above the niches' top band).
STAR_RELIEF = 0.025
# --- the lantern ---------------------------------------------------------------
LANTERN_HEIGHT = 0.62
# --- the pull book -------------------------------------------------------------
# Taller than any kit book (TALL_BOOK) so it stands proud of its row's
# skyline, and fatter than the thick block; still under the row's clear
# height with room to tip it out (BOOK_PULL_MARGIN), asserted below.
SECRET_BOOK_HEIGHT = 0.46
SECRET_BOOK_THICKNESS = 0.11
SECRET_BOOK_DEPTH = lb.BOOK_DEPTH
assert SECRET_BOOK_HEIGHT > lb.TALL_BOOK
assert SECRET_BOOK_HEIGHT + lb.BOOK_PULL_MARGIN <= lb.SHELF_ROW_CLEAR + 1e-9, (
    f"the pull book ({SECRET_BOOK_HEIGHT} m) cannot be tipped out of a {lb.SHELF_ROW_CLEAR:.3f} m row"
)

# Derived, from the owners above — never typed again below.
FLOOR_TOP = FLOOR_THICKNESS
WALL_T = WALL_HALF * 2.0
# The doorway wall (the room's west wall) runs along X at y = 0; its outer face
# is the den's near edge.
NEAR_Y = WALL_HALF
FAR_Y = NEAR_Y + DEN_DEPTH                 # the far wall's inner face
SOUTH_X = -DEN_DOOR_HALF                   # the south wall's inner face (the doorway's south edge)
NORTH_X = DEN_DOOR_HALF + DEN_NORTH_PAST_DOOR  # the north wall's inner face
INNER_LENGTH = NORTH_X - SOUTH_X           # along the far wall
NICHE_BAY = (INNER_LENGTH - (NICHE_BAYS + 1) * NICHE_PIER) / NICHE_BAYS
# The niche rows are the library kit's shelf rows, exactly.
ROW_PITCH = lb.SHELF_BOARD + lb.SHELF_ROW_CLEAR
NICHE_Z0 = lb.SHELF_KICK
NICHE_Z1 = NICHE_Z0 + lb.SHELF_ROWS * ROW_PITCH
assert NICHE_Z1 < LINTEL_BASE < WALL_HEIGHT

CONTRACT = {
    "den": {
        # the plan, measured by rays off the far walls' piers
        "innerDepth": (EXACT, DEN_DEPTH),
        "northPastDoor": (EXACT, DEN_NORTH_PAST_DOOR),
        "southPastDoor": (EXACT, 0.0),
        # the doorway: the lintel's span, its base (the shut case's top), its top
        "doorWidth": (EXACT, DOOR_WIDTH),
        "lintelBase": (EXACT, LINTEL_BASE),
        "wallHeight": (EXACT, WALL_HEIGHT),
        "wallThickness": (EXACT, WALL_T),
        "floorTop": (EXACT, FLOOR_TOP),
        # the niches: how many, how many rows each, a kit book fits in every row
        "niches": (EXACT, float(NICHE_BAYS * 2)),
        "rowsPerNiche": (EXACT, float(lb.SHELF_ROWS)),
        "rowClear": (AT_LEAST, lb.TALL_BOOK + lb.BOOK_PULL_MARGIN),
        "nicheUsableDepth": (AT_LEAST, lb.BOOK_DEPTH + 0.02),
        "reliefStandOff": (AT_MOST, STAR_RELIEF + TOL),
        "lowestRelief": (AT_LEAST, lb.SHELF_HEIGHT),
    },
    "denLantern": {
        "height": (EXACT, LANTERN_HEIGHT), "width": (AT_MOST, 0.40), "depth": (AT_MOST, 0.45),
        "backOnWall": (AT_MOST, 0.0005),
    },
    "secretBook": {
        "height": (EXACT, SECRET_BOOK_HEIGHT), "width": (EXACT, SECRET_BOOK_THICKNESS),
        "shelfDepth": (EXACT, SECRET_BOOK_DEPTH), "depth": (AT_MOST, SECRET_BOOK_DEPTH + 0.04),
        "triangles": (AT_MOST, 400),
    },
}

# How each asset's origin is placed — see `check_origins`.
#   DOORWAY: x = the doorway's middle, y = the wall's centre line, z = the slab's bottom
#   WALL:    the back on y = 0, the bottom on z = 0, centred on X
#   FLOOR:   the library kit's family — base-centred on X and Y
ORIGIN_FAMILY = {"den": "DOORWAY", "denLantern": "WALL", "secretBook": "FLOOR"}

ASSETS: dict[str, lb.Asset] = {}


def register(asset: lb.Asset) -> lb.Asset:
    assert asset.name not in ASSETS
    ASSETS[asset.name] = asset
    return asset


# =============================================================================
# Shapes this file needs that blendkit and library_build do not have
# =============================================================================


def pocketed_slab(x0: float, x1: float, thickness: float, height: float, pockets):
    """A wall with rectangular pockets cut into one face, as one closed mesh.

    Local frame: the pocketed face lies in the XZ plane at y = 0 and faces −Y;
    the wall's material runs from y = 0 to y = ``thickness``; it spans
    ``x0..x1`` and stands from z = 0 to ``height``. ``pockets`` are
    ``(px0, px1, pz0, pz1, depth)`` on that face.

    Built as a grid rather than by a boolean: every face, the ends, the top
    and the bottom are split at the same stations, so no edge has a vertex
    the face across it does not share (a T-junction is a hairline crack from
    the game camera), and the result is a closed solid by construction —
    ``Part.emit``'s normal recalculation then has a manifold to work on.
    """
    xs = sorted({x0, x1, *(p[0] for p in pockets), *(p[1] for p in pockets)})
    zs = sorted({0.0, height, *(p[2] for p in pockets), *(p[3] for p in pockets)})
    verts: list[tuple[float, float, float]] = []
    index: dict[tuple[float, float, float], int] = {}

    def v(x: float, y: float, z: float) -> int:
        key = (round(x, 6), round(y, 6), round(z, 6))
        if key not in index:
            index[key] = len(verts)
            verts.append(key)
        return index[key]

    faces = []
    t = thickness

    def pocket_depth(i: int, j: int):
        cx = (xs[i] + xs[i + 1]) * 0.5
        cz = (zs[j] + zs[j + 1]) * 0.5
        for px0, px1, pz0, pz1, d in pockets:
            if px0 < cx < px1 and pz0 < cz < pz1:
                assert px0 in xs and px1 in xs and pz0 in zs and pz1 in zs
                return d
        return None

    for i in range(len(xs) - 1):
        for j in range(len(zs) - 1):
            xa, xb, za, zb = xs[i], xs[i + 1], zs[j], zs[j + 1]
            d = pocket_depth(i, j)
            if d is None:
                faces.append((v(xa, 0, za), v(xa, 0, zb), v(xb, 0, zb), v(xb, 0, za)))
            else:
                assert 0.0 < d < t
                faces.append((v(xa, 0, za), v(xa, d, za), v(xa, d, zb), v(xa, 0, zb)))  # side reveal
                faces.append((v(xb, 0, za), v(xb, 0, zb), v(xb, d, zb), v(xb, d, za)))  # side reveal
                faces.append((v(xa, 0, za), v(xb, 0, za), v(xb, d, za), v(xa, d, za)))  # bottom reveal
                faces.append((v(xa, 0, zb), v(xa, d, zb), v(xb, d, zb), v(xb, 0, zb)))  # top reveal
                faces.append((v(xa, d, za), v(xa, d, zb), v(xb, d, zb), v(xb, d, za)))  # the back
            faces.append((v(xa, t, za), v(xb, t, za), v(xb, t, zb), v(xa, t, zb)))
    for i in range(len(xs) - 1):
        xa, xb = xs[i], xs[i + 1]
        faces.append((v(xa, 0, height), v(xa, t, height), v(xb, t, height), v(xb, 0, height)))
        faces.append((v(xa, 0, 0), v(xb, 0, 0), v(xb, t, 0), v(xa, t, 0)))
    for j in range(len(zs) - 1):
        za, zb = zs[j], zs[j + 1]
        faces.append((v(x0, 0, za), v(x0, 0, zb), v(x0, t, zb), v(x0, t, za)))
        faces.append((v(x1, 0, za), v(x1, t, za), v(x1, t, zb), v(x1, 0, zb)))
    return verts, faces


def arc_relief(cx: float, cz: float, radius: float, width: float, start_deg: float,
               end_deg: float, depth: float, segments: int = 18):
    """A crescent: a band along an arc in the XZ plane whose width swells from a
    sliver at each horn to ``width`` in the middle, extruded from y = 0 to
    y = −``depth`` (standing off a wall whose face is y = 0). Strips of quads
    between the inner and outer curves, so nothing is triangulated by guess."""
    inner = []
    outer = []
    for i in range(segments + 1):
        u = i / segments
        a = deg(start_deg + (end_deg - start_deg) * u)
        w = width * max(0.06, math.sin(math.pi * u))
        outer.append((cx + radius * math.cos(a), cz + radius * math.sin(a)))
        inner.append((cx + (radius - w) * math.cos(a), cz + (radius - w) * math.sin(a)))
    n = segments + 1
    verts = []
    for y in (-depth, 0.0):
        verts += [(x, y, z) for x, z in outer]
        verts += [(x, y, z) for x, z in inner]
    fo, fi, bo, bi = 0, n, 2 * n, 3 * n
    faces = []
    for i in range(segments):
        j = i + 1
        faces.append((fo + i, fo + j, fi + j, fi + i))  # front
        faces.append((bo + j, bo + i, bi + i, bi + j))  # back
        faces.append((fo + i, bo + i, bo + j, fo + j))  # outer rim
        faces.append((fi + j, bi + j, bi + i, fi + i))  # inner rim
    faces.append((fo, fi, bi, bo))
    faces.append((fo + segments, bo + segments, bi + segments, fi + segments))
    return verts, faces


def standing_book(thick: float, depth: float, height: float, board: float = 0.014):
    """A closed book standing on its bottom edge: two boards and a rounded
    spine (the cover, one colour) and the page block between them (its own
    node, cream). Thickness along X, the spine on −Y, base-centred.

    Like ``library_build.lying_book``, every face that would share a plane
    with a neighbour is moved off it: the spine stands 1 cm proud of the
    boards' front edges and 4 mm inside their outer faces, 2 mm inside their top and bottom;
    the page block is inset and buried 2 mm into each board.
    """
    cover = Part("_cover")
    pages = Part("_pages")
    board_box = rounded_box(board, depth, height, 0.006, 1)
    for sx in (-1.0, 1.0):
        cover.at(*board_box, x=sx * (thick - board) * 0.5, z=height * 0.5)
    spine_d = 0.04
    cover.at(*rounded_box(thick - 0.008, spine_d, height - 0.004, 0.015, 1),
             y=-depth * 0.5 - 0.01 + spine_d * 0.5, z=height * 0.5)
    page_y0 = -depth * 0.5 + spine_d - 0.02
    page_y1 = depth * 0.5 - 0.015
    pages.at(*box(thick - 2.0 * board + 0.004, page_y1 - page_y0, height - 0.02),
             y=(page_y0 + page_y1) * 0.5, z=height * 0.5)
    spine_front_y = -depth * 0.5 - 0.01
    return cover, pages, spine_front_y


# =============================================================================
# 1. library.den — the room: floor, three walls, the lintel, the niches
# =============================================================================


def niche_bays(face_from: float, face_to: float):
    """Where the bays sit along a far wall's inner face: ``NICHE_BAYS`` bays of
    ``NICHE_BAY`` between ``NICHE_BAYS + 1`` piers, from one corner to the other."""
    assert abs((face_to - face_from) - INNER_LENGTH) < 1e-6
    bays = []
    for k in range(NICHE_BAYS):
        a = face_from + NICHE_PIER + k * (NICHE_BAY + NICHE_PIER)
        bays.append((a, a + NICHE_BAY))
    return bays


def niche_wall(a: lb.Asset, wall_part: Part, slab_x0: float, slab_x1: float, face_from: float,
               face_to: float, matrix: Matrix, decorate) -> None:
    """One far wall in the local slab frame (face at y = 0 facing −Y, material
    to +Y, standing on z = 0), with its niches, their boards and backs, and
    its reliefs — all placed into the asset by ``matrix``."""
    bays = niche_bays(face_from, face_to)
    pockets = [(bx0, bx1, NICHE_Z0, NICHE_Z1, NICHE_DEPTH) for bx0, bx1 in bays]
    wall_part.add(*pocketed_slab(slab_x0, slab_x1, WALL_T, WALL_HEIGHT, pockets), matrix=matrix)
    shelves = a.parts["den-shelves"]
    backs = a.parts["den-nicheBacks"]
    board_depth = NICHE_DEPTH - NICHE_BOARD_SETBACK - NICHE_BACK
    for bx0, bx1 in bays:
        cx = (bx0 + bx1) * 0.5
        # The back panel: a hair inside the pocket on every side (so none of
        # its faces lies in a reveal's plane), its back on the pocket's back.
        backs.add(*box(NICHE_BAY - 0.01, NICHE_BACK, NICHE_Z1 - NICHE_Z0 - 0.01),
                  matrix=matrix @ Matrix.Translation((cx, NICHE_DEPTH - NICHE_BACK * 0.5,
                                                      (NICHE_Z0 + NICHE_Z1) * 0.5)))
        for row in range(lb.SHELF_ROWS):
            z0 = NICHE_Z0 + row * ROW_PITCH
            shelves.add(*rounded_box(NICHE_BAY, board_depth, lb.SHELF_BOARD, 0.015, 1),
                        matrix=matrix @ Matrix.Translation((cx, NICHE_BOARD_SETBACK + board_depth * 0.5,
                                                            z0 + lb.SHELF_BOARD * 0.5)))
    decorate(matrix)


def star_relief(part: Part, cx: float, cz: float, outer: float, matrix: Matrix) -> None:
    """A fat five-point star standing ``STAR_RELIEF`` off the wall's face (y = 0,
    the local frame of ``niche_wall``), its back on the face."""
    part.add(*extrude_outline(lb.star_outline(cx, cz, outer, outer * 0.46), STAR_RELIEF, centre=(cx, cz)),
             matrix=matrix @ Matrix.Translation((0.0, -STAR_RELIEF * 0.5, 0.0)))


def build_den() -> None:
    """The den as one placed asset — see the module docstring for its frame."""
    a = register(lb.Asset("den"))
    floor = a.part("floor")
    wall_west = a.part("wallWest")
    wall_north = a.part("wallNorth")
    wall_south = a.part("wallSouth")
    a.part("shelves")
    a.part("nicheBacks")
    lintel = a.part("lintel")
    stars = a.part("stars")
    moon = a.part("moon")

    outer_far = FAR_Y + WALL_T
    outer_north = NORTH_X + WALL_T
    outer_south = SOUTH_X - WALL_T
    # The floor slab: from the reading room floor's apron edge (the wall's
    # whole thickness past its centre line, which it abuts) to the far wall's
    # outer face, corner to corner, its top at FLOOR_TOP.
    floor_y0 = WALL_T
    floor.at(*box(outer_north - outer_south, outer_far - floor_y0, FLOOR_THICKNESS),
             x=(outer_south + outer_north) * 0.5, y=(floor_y0 + outer_far) * 0.5, z=FLOOR_TOP * 0.5)

    # The far (west) wall takes both corners; its inner face is the den's full
    # length. In its local frame x is the asset's x, so the matrix is a lift.
    far_matrix = Matrix.Translation((0.0, FAR_Y, FLOOR_TOP))

    def far_reliefs(m: Matrix) -> None:
        # Above the niches' top band: a moon toward the corner the nest is in,
        # stars scattered along the band — every one above the shelf height.
        moon.add(*arc_relief(NORTH_X - 1.05, NICHE_Z1 + 1.25, 0.42, 0.19, 40.0, 320.0, STAR_RELIEF),
                 matrix=m)
        for cx, cz, r in ((SOUTH_X + 0.75, NICHE_Z1 + 0.75, 0.2), (SOUTH_X + 1.65, NICHE_Z1 + 1.45, 0.14),
                          (SOUTH_X + 2.55, NICHE_Z1 + 0.6, 0.24), (NORTH_X - 1.95, NICHE_Z1 + 1.75, 0.16),
                          (NORTH_X - 0.4, NICHE_Z1 + 0.55, 0.13)):
            star_relief(stars, cx, cz, r, m)

    niche_wall(a, wall_west, outer_south, outer_north, SOUTH_X, NORTH_X, far_matrix, far_reliefs)

    # The north wall: its inner face is x = NORTH_X facing −X, from the room
    # wall's outer face (y = NEAR_Y) to the far wall's inner face (y = FAR_Y),
    # abutting both rather than buried in either. A quarter turn about Z puts
    # the slab's local −Y on the asset's −X and its local +X along −Y.
    north_matrix = Matrix.Translation((NORTH_X, 0.0, FLOOR_TOP)) @ lb.rot(z=-90.0)

    def north_reliefs(m: Matrix) -> None:
        for cx, cz, r in ((-NEAR_Y - 0.9, NICHE_Z1 + 1.35, 0.22), (-NEAR_Y - 2.2, NICHE_Z1 + 0.65, 0.15),
                          (-NEAR_Y - 3.3, NICHE_Z1 + 1.6, 0.2), (-NEAR_Y - 4.6, NICHE_Z1 + 0.8, 0.17)):
            star_relief(stars, cx, cz, r, m)

    niche_wall(a, wall_north, -FAR_Y, -NEAR_Y, -FAR_Y, -NEAR_Y, north_matrix, north_reliefs)

    # The south wall: plain (the camera's near side — the game draws it hidden),
    # the same run as the north wall.
    wall_south.at(*box(WALL_T, FAR_Y - NEAR_Y, WALL_HEIGHT),
                  x=SOUTH_X - WALL_HALF, y=(NEAR_Y + FAR_Y) * 0.5, z=FLOOR_TOP + WALL_HEIGHT * 0.5)

    # The lintel over the doorway: from the shut shelf's top to the wall's top,
    # the wall's own thickness, abutting the room's west wall spans at the
    # doorway's edges. A plain wall piece — on the room side it must read as
    # wall above an ordinary bookcase, or the secret is given away.
    lintel.at(*box(DOOR_WIDTH, WALL_T, WALL_HEIGHT - LINTEL_BASE),
              z=FLOOR_TOP + (LINTEL_BASE + WALL_HEIGHT) * 0.5)


# =============================================================================
# 2. library.denLantern — a paper lantern on a curly bracket
# =============================================================================


def build_lantern() -> None:
    """A round glowing lantern hung from a brass bracket: a backplate on the
    wall, a fat arm curling out and down to a hook, a little cap, the glowing
    ball (``-glow``, the part the Engineer lights) and a knob under it.
    Chunky throughout (ART_DIRECTION §1): the arm is 5 cm thick."""
    a = register(lb.Asset("denLantern"))
    bracket = a.part("bracket")
    glow = a.part("glow")
    h = LANTERN_HEIGHT
    # The backplate's top is the lantern's highest point — the asset's height.
    plate_h = 0.24
    bracket.at(*rounded_box(0.16, 0.03, plate_h, 0.012, 1), y=-0.015, z=h - plate_h * 0.5)
    ball_y = -0.27
    ball_r = 0.145
    ball_z = 0.10 + ball_r
    # The arm leaves the plate's upper half, curls out just under the plate's
    # top and drops to a hook that the cap on the ball swallows.
    bracket.add(*lb.tapered_sweep([(0.0, -0.025, h - 0.09), (0.0, -0.13, h - 0.035),
                                   (0.0, -0.24, h - 0.08), (0.0, ball_y, ball_z + ball_r * 1.12 + 0.01)],
                                  [0.026, 0.028, 0.026, 0.024], 10))
    glow.at(*ellipsoid(ball_r, ball_r, ball_r * 1.12, 2), y=ball_y, z=ball_z)
    # The cap sits on the ball's crown and swallows the arm's end.
    bracket.at(*revolve([(0.0, 0.0), (0.085, 0.0), (0.09, 0.02), (0.07, 0.05), (0.035, 0.07), (0.0, 0.075)], 14),
               y=ball_y, z=ball_z + ball_r * 1.12 - 0.03)
    # The knob under it is the lantern's lowest point — the asset's base.
    bracket.at(*icosphere(0.05, 1), y=ball_y, z=0.05)


# =============================================================================
# 3. library.secretBook — the pull book, with a star on its spine
# =============================================================================


def build_secret_book() -> None:
    """The special book on the secret shelf: a fat standing tome, its spine
    carrying a raised star for the twinkle to live on (``-star``, its own node
    so the Engineer can make it glow). Shelved like any kit book — thickness
    along X, spine on −Y — and the Engineer stands it 3 cm proud."""
    a = register(lb.Asset("secretBook"))
    cover = a.part("cover")
    pages = a.part("pages")
    star = a.part("star")
    c, p, spine_front = standing_book(SECRET_BOOK_THICKNESS, SECRET_BOOK_DEPTH, SECRET_BOOK_HEIGHT)
    cover.add(c.verts, c.faces)
    pages.add(p.verts, p.faces)
    relief = 0.012
    star.add(*extrude_outline(lb.star_outline(0.0, SECRET_BOOK_HEIGHT * 0.62, 0.032, 0.015),
                              relief, centre=(0.0, SECRET_BOOK_HEIGHT * 0.62)),
             matrix=Matrix.Translation((0.0, spine_front - relief * 0.5, 0.0)))


# =============================================================================
# Measurements — the CONTRACT read back off the emitted vertices
# =============================================================================


def bvh_for(nodes):
    """A BVH over the named nodes (world space) — `library_build.bvh_for`'s twin
    for this file's own objects."""
    verts, polys = [], []
    for node in nodes:
        obj = bpy.data.objects[node]
        base = len(verts)
        verts.extend(lb.world_verts(obj))
        for poly in obj.data.polygons:
            polys.append([base + i for i in poly.vertices])
    return BVHTree.FromPolygons(verts, polys)


def ray_distance(bvh, origin, direction) -> float:
    hit = bvh.ray_cast(Vector(origin), Vector(direction))
    assert hit[0] is not None, f"a ray from {origin} along {direction} hits nothing"
    return hit[3]


def m_den_inner_depth() -> float:
    """From the doorway wall's outer face to the far wall's inner face, by a
    ray up the first pier (never into a niche) at a child's chest."""
    bvh = bvh_for(["den-wallWest"])
    x = SOUTH_X + NICHE_PIER * 0.5
    return ray_distance(bvh, (x, NEAR_Y, FLOOR_TOP + 1.0), (0.0, 1.0, 0.0))


def m_den_north_past_door() -> float:
    bvh = bvh_for(["den-wallNorth"])
    y = NEAR_Y + NICHE_PIER * 0.5
    return ray_distance(bvh, (DEN_DOOR_HALF, y, FLOOR_TOP + 1.0), (1.0, 0.0, 0.0))


def m_den_south_past_door() -> float:
    bvh = bvh_for(["den-wallSouth"])
    # Cast from a hand's breadth inside the doorway's south edge, so a face
    # exactly on that edge is a hit and not a numerical coin toss.
    back = 0.1
    return ray_distance(bvh, (-DEN_DOOR_HALF + back, (NEAR_Y + FAR_Y) * 0.5, FLOOR_TOP + 1.0), (-1.0, 0.0, 0.0)) - back


def m_lintel_base() -> float:
    lo, _ = lb.node_bounds("den-lintel")
    return lo.z - m_floor_top()


def m_floor_top() -> float:
    _, hi = lb.node_bounds("den-floor")
    return hi.z


def m_wall_height() -> float:
    _, hi = lb.node_bounds("den-wallWest")
    return hi.z - m_floor_top()


def m_wall_thickness() -> float:
    lo, hi = lb.node_bounds("den-wallWest")
    return hi.y - lo.y


def m_door_width() -> float:
    lo, hi = lb.node_bounds("den-lintel")
    return hi.x - lo.x


def niche_rows():
    """Every niche's board tops and clear heights, found with rays the way
    `library_build.m_shelf_rows` finds a case's: up from just above each board,
    across the bay, to whatever is over it. Returns ``{wall: [(bay centre
    along the wall, [(top z, clear)...])]}`` in the asset frame, z from the
    den's floor."""
    bvh = bvh_for(["den-wallWest", "den-wallNorth", "den-shelves", "den-nicheBacks"])
    out = {}
    levels = sorted({round(z, 4) for z in lb.up_faces_z("den-shelves")})
    for wall, bays, probe in (
        ("west", niche_bays(SOUTH_X, NORTH_X), lambda along, depth, z: (along, FAR_Y + depth, z)),
        ("north", niche_bays(NEAR_Y, FAR_Y), lambda along, depth, z: (NORTH_X + depth, along, z)),
    ):
        rows = []
        for b0, b1 in bays:
            centre = (b0 + b1) * 0.5
            mine = []
            for z in levels:
                shortest = math.inf
                for i in range(9):
                    along = b0 + 0.08 + (b1 - b0 - 0.16) * i / 8.0
                    for depth in (0.06, 0.15, 0.26):
                        d = bvh.ray_cast(Vector(probe(along, depth, z + 0.001)), Vector((0.0, 0.0, 1.0)))
                        shortest = min(shortest, d[3] + 0.001 if d[0] is not None else math.inf)
                mine.append((z - FLOOR_TOP, shortest))
            rows.append((centre, mine))
        out[wall] = rows
    return out


def m_niche_count() -> float:
    return float(sum(len(rows) for rows in niche_rows().values()))


def m_rows_per_niche() -> float:
    counts = {len(levels) for rows in niche_rows().values() for _c, levels in rows}
    assert len(counts) == 1, f"niches disagree on their row count: {sorted(counts)}"
    return float(counts.pop())


def m_row_clear() -> float:
    return min(clear for rows in niche_rows().values() for _c, levels in rows for _z, clear in levels)


def m_niche_usable_depth() -> float:
    """From the wall's inner face to the niche's back panel, by a ray into the
    middle of the first west niche at its bottom row."""
    bvh = bvh_for(["den-wallWest", "den-nicheBacks"])
    b0, b1 = niche_bays(SOUTH_X, NORTH_X)[0]
    return ray_distance(bvh, ((b0 + b1) * 0.5, FAR_Y - 0.01, FLOOR_TOP + NICHE_Z0 + 0.25), (0.0, 1.0, 0.0)) - 0.01


def m_relief_stand_off() -> float:
    """How far any star or the moon stands off its wall's face."""
    worst = 0.0
    for node in ("den-stars", "den-moon"):
        for w in lb.world_verts(bpy.data.objects[node]):
            # Each relief is on one of the two far walls: its stand-off is its
            # distance to the nearer face (the other is metres away).
            worst = max(worst, min(FAR_Y - w.y, NORTH_X - w.x))
    return worst


def m_lowest_relief() -> float:
    lo = min(lb.node_bounds("den-stars")[0].z, lb.node_bounds("den-moon")[0].z)
    return lo - FLOOR_TOP


def m_lantern_back() -> float:
    _, hi = lb.asset_bounds("denLantern")
    return abs(hi.y)


def m_book_shelf_depth() -> float:
    """The boards' depth — what sits on the shelf behind the spine. The book is
    built about y = 0 and only the spine (and its star) stands proud of the
    boards' front, so the boards' back edge is half their depth behind the
    origin: twice the cover node's furthest vertex back."""
    _, hi = lb.node_bounds("secretBook-cover")
    return hi.y * 2.0


def m_size(asset: str, axis: int) -> float:
    lo, hi = lb.asset_bounds(asset)
    if axis == 2:
        return hi.z
    return hi[axis] - lo[axis]


MEASURE = {
    ("den", "innerDepth"): m_den_inner_depth,
    ("den", "northPastDoor"): m_den_north_past_door,
    ("den", "southPastDoor"): m_den_south_past_door,
    ("den", "doorWidth"): m_door_width,
    ("den", "lintelBase"): m_lintel_base,
    ("den", "wallHeight"): m_wall_height,
    ("den", "wallThickness"): m_wall_thickness,
    ("den", "floorTop"): m_floor_top,
    ("den", "niches"): m_niche_count,
    ("den", "rowsPerNiche"): m_rows_per_niche,
    ("den", "rowClear"): m_row_clear,
    ("den", "nicheUsableDepth"): m_niche_usable_depth,
    ("den", "reliefStandOff"): m_relief_stand_off,
    ("den", "lowestRelief"): m_lowest_relief,
    ("denLantern", "backOnWall"): m_lantern_back,
    ("secretBook", "shelfDepth"): m_book_shelf_depth,
    ("secretBook", "triangles"): lambda: lb.m_triangles("secretBook"),
}
for _asset, _figures in CONTRACT.items():
    for _fig, _axis in (("width", 0), ("depth", 1), ("height", 2)):
        if _fig in _figures:
            MEASURE[(_asset, _fig)] = (lambda a=_asset, ax=_axis: m_size(a, ax))


def check_contract() -> str:
    wanted = {(a, f) for a, figs in CONTRACT.items() for f in figs}
    assert wanted == set(MEASURE), (
        f"contract figures with no measurement: {sorted(wanted - set(MEASURE))}; "
        f"measurements with no contract figure: {sorted(set(MEASURE) - wanted)}"
    )
    rows = []
    for asset in CONTRACT:
        cells = []
        for fig, (op, want) in CONTRACT[asset].items():
            got = MEASURE[(asset, fig)]()
            if op == EXACT:
                ok = abs(got - want) <= TOL
            elif op == AT_MOST:
                ok = got <= want + 1e-6
            else:
                ok = got >= want - 1e-6
            assert ok, (
                f"{asset}.{fig}: the contract says {op} {want:.4f} and the geometry measures "
                f"{got:.4f}. Fix the shape, or change CONTRACT and tell the Engineer — never let "
                "the two differ."
            )
            cells.append(f"{fig} {got:.3f} ({op}{want:.3f})")
        rows.append(f"  {asset:<12} " + ", ".join(cells))
    return "\n".join(rows)


def check_origins() -> str:
    rows = []
    for asset, family in ORIGIN_FAMILY.items():
        lo, hi = lb.asset_bounds(asset)
        assert abs(lo.z) < 1e-4, f"{asset}: lowest vertex at z {lo.z:+.5f}, not on its base"
        if family == "FLOOR":
            # The library kit's rule: centred on X, the origin inside the
            # footprint. Not centred on Y — a book's spine stands proud of its
            # front, as the kit's own blocks' do.
            assert abs(lo.x + hi.x) < 0.02, f"{asset} is off-centre on X by {(lo.x + hi.x) / 2:+.4f}"
            flo, fhi = lb.footprint(asset)
            assert flo[0] <= 0.0 <= fhi[0] and flo[1] <= 0.0 <= fhi[1], (
                f"{asset}'s origin is outside its own footprint {flo}..{fhi}"
            )
        elif family == "WALL":
            assert abs(hi.y) < 1e-4, f"{asset}'s back is at y {hi.y:+.5f}, not on the wall"
            assert abs(lo.x + hi.x) < 0.02, f"{asset} is off-centre on X"
        elif family == "DOORWAY":
            llo, lhi = lb.node_bounds("den-lintel")
            assert abs(llo.x + lhi.x) < 1e-4 and abs(llo.y + lhi.y) < 1e-4, (
                f"den: the doorway's middle is at ({(llo.x + lhi.x) / 2:+.4f}, {(llo.y + lhi.y) / 2:+.4f}), "
                "not on the origin"
            )
        rows.append(f"  {asset:<12} {family:<7} x {lo.x:+.3f}..{hi.x:+.3f}  y {lo.y:+.3f}..{hi.y:+.3f}  "
                    f"z {lo.z:+.3f}..{hi.z:+.3f}")
    return "\n".join(rows)


def check_nodes() -> None:
    """Names and transforms: every node is named for its collection, and every
    node leaves at the identity — this kit has no pivots."""
    for obj in bpy.data.objects:
        if obj.type != "MESH":
            continue
        coll = obj.users_collection[0].name
        assert "." not in obj.name, f"{obj.name}: GLTFLoader strips full stops"
        assert obj.name == coll or obj.name.startswith(coll + "-"), (
            f"{obj.name} is in collection {coll} but not named for it"
        )
        loc, quat, scale = obj.matrix_world.decompose()
        assert loc.length < 1e-9 and abs(quat.angle) < 1e-9 and (scale - Vector((1, 1, 1))).length < 1e-9, (
            f"{obj.name} does not leave Blender at the identity"
        )


def check_abutting() -> str:
    """The pieces that must meet exactly, and the pairs that must never share a
    face: measured off the emitted nodes rather than trusted from the arithmetic."""
    floor_lo, floor_hi = lb.node_bounds("den-floor")
    west_lo, west_hi = lb.node_bounds("den-wallWest")
    north_lo, north_hi = lb.node_bounds("den-wallNorth")
    south_lo, south_hi = lb.node_bounds("den-wallSouth")
    lintel_lo, lintel_hi = lb.node_bounds("den-lintel")
    assert abs(floor_hi.z - west_lo.z) < 1e-6 and abs(floor_hi.z - north_lo.z) < 1e-6, "walls stand on the floor"
    assert abs(floor_lo.y - WALL_T) < 1e-6, "the floor abuts the room floor's apron edge (the wall's whole thickness past its centre line)"
    assert abs(north_lo.y - NEAR_Y) < 1e-6 and abs(south_lo.y - NEAR_Y) < 1e-6, "the side walls abut the room wall's outer face"
    assert abs(north_hi.y - west_lo.y) < 1e-6 and abs(south_hi.y - west_lo.y) < 1e-6, "the side walls abut the far wall's inner face"
    assert abs(west_lo.x - south_lo.x) < 1e-6 and abs(west_hi.x - north_hi.x) < 1e-6, "the far wall takes both corners"
    assert abs(lintel_lo.y + WALL_HALF) < 1e-6 and abs(lintel_hi.y - WALL_HALF) < 1e-6, "the lintel is the room wall's thickness"
    assert abs(lintel_lo.x - south_hi.x) < 1e-6 and abs(lintel_hi.x - DEN_DOOR_HALF) < 1e-6, "the lintel spans the doorway"
    assert abs(lintel_hi.z - west_hi.z) < 1e-6, "the lintel's top is the walls' top"
    return (f"  floor top {floor_hi.z:.3f}; walls {west_lo.z:.3f}..{west_hi.z:.3f}; the floor from y {floor_lo.y:.3f} "
            f"(the apron edge) to {floor_hi.y:.3f}; side walls y {north_lo.y:.3f}..{north_hi.y:.3f}; "
            f"lintel x {lintel_lo.x:+.3f}..{lintel_hi.x:+.3f} y {lintel_lo.y:+.3f}..{lintel_hi.y:+.3f} "
            f"z {lintel_lo.z:.3f}..{lintel_hi.z:.3f}")


def report_extras() -> str:
    """Figures the Engineer will want that are measurements, not contract
    lines — printed so they are never typed from memory. Game axes: the
    asset's (x, y, z) here is the game's (x, z = −y, y = z)."""
    lines = []
    rows = niche_rows()
    for wall in ("west", "north"):
        for centre, levels in rows[wall]:
            where = f"x {centre:+.3f}" if wall == "west" else f"game z {-centre:+.3f}"
            lines.append(f"  {wall} niche at {where}: board tops "
                         + ", ".join(f"{z:.3f}" for z, _c in levels)
                         + " m above the floor; clear "
                         + ", ".join(f"{c:.3f}" for _z, c in levels))
    lines.append(f"  niche bays {NICHE_BAY:.3f} m between {NICHE_PIER:.3f} m piers; boards "
                 f"{NICHE_DEPTH - NICHE_BOARD_SETBACK - NICHE_BACK:.3f} m deep, their fronts {NICHE_BOARD_SETBACK:.3f} m "
                 f"behind the wall's face; the back panel {NICHE_BACK:.3f} m")
    lo, hi = lb.asset_bounds("den")
    lines.append(f"  den extent, asset frame: x {lo.x:+.3f}..{hi.x:+.3f}, y {lo.y:+.3f}..{hi.y:+.3f} "
                 f"(game z {-hi.y:+.3f}..{-lo.y:+.3f}), z {lo.z:.3f}..{hi.z:.3f}")
    lines.append(f"  the far corner, walls included, is {math.hypot(hi.x, hi.y):.3f} m from the doorway's middle")
    glo, ghi = lb.node_bounds("denLantern-glow")
    lines.append(f"  lantern glow centre, asset frame: ({(glo.x + ghi.x) / 2:+.3f}, {(glo.y + ghi.y) / 2:+.3f}, "
                 f"{(glo.z + ghi.z) / 2:.3f}); radius {(ghi.x - glo.x) / 2:.3f}")
    slo, shi = lb.node_bounds("secretBook-star")
    lines.append(f"  pull book's star: centre z {(slo.z + shi.z) / 2:.3f} m up the spine, {shi.y - slo.y:.3f} m proud")
    return "\n".join(lines)


BUILDERS = (build_den, build_lantern, build_secret_book)

TRIANGLE_BUDGET = 4000


def main() -> None:
    reset_scene()
    for builder in BUILDERS:
        builder()
    for asset in ASSETS.values():
        asset.emit()
    bpy.context.view_layer.update()

    built = {c.name for c in bpy.data.collections}
    assert built == set(CONTRACT) == set(ORIGIN_FAMILY), (
        f"built but not in the contract: {sorted(built - set(CONTRACT))}; "
        f"in the contract but not built: {sorted(set(CONTRACT) - built)}"
    )

    print("\nlibrary_den_build")
    print(summarise())
    check_nodes()
    print(f"\n  winding: {lb.check_winding()} closed pieces, every one outward-facing")
    print("\n  origins, measured off the emitted vertices:")
    print(check_origins())
    print("\n  the pieces that meet, measured:")
    print(check_abutting())
    print("\n  CONTRACT, measured:")
    print(check_contract())
    print("\n  measured figures for the Engineer:")
    print(report_extras())
    print(f"\n  read from the game: LIBRARY_WALL_HALF {WALL_HALF}, LIBRARY_WALL_HEIGHT {WALL_HEIGHT}, "
          f"LIBRARY_DEN_DEPTH {DEN_DEPTH}, LIBRARY_DEN_DOOR_HALF {DEN_DOOR_HALF}, DEN_NORTH_PAST_DOOR "
          f"{DEN_NORTH_PAST_DOOR} ({LAYOUT_MODULE}); from library_build: SHELF_LENGTH {lb.SHELF_LENGTH}, "
          f"SHELF_HEIGHT {lb.SHELF_HEIGHT}, SHELF_ROWS {lb.SHELF_ROWS}, SHELF_ROW_CLEAR {lb.SHELF_ROW_CLEAR:.4f}, "
          f"BOOK_DEPTH {lb.BOOK_DEPTH}, TALL_BOOK {lb.TALL_BOOK}, BOOK_PULL_MARGIN {lb.BOOK_PULL_MARGIN}, "
          f"KID_HEIGHT {CHILD_HEIGHT}, KID_REACH_HEIGHT {CHILD_REACH}")
    tris = total_triangles()
    assert tris <= TRIANGLE_BUDGET, f"{tris} triangles against a budget of {TRIANGLE_BUDGET}"
    print(f"\n  {len(bpy.data.objects)} nodes, {tris} triangles (budget {TRIANGLE_BUDGET})")

    bpy.ops.wm.save_as_mainfile(filepath=BLEND)
    print("  saved", BLEND, f"({os.path.getsize(BLEND)} bytes)\n")


if __name__ == "__main__":
    try:
        main()
    except Exception:
        traceback.print_exc()
        sys.exit(1)
