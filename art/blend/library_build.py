"""Builds the Library's authored geometry and saves ``art/blend/library.blend``.

    blender --background --factory-startup --python-exit-code 1 \
        --python art/blend/library_build.py

Issue #715, part 1 of the Library epic #714. Jim, 13 October 2026: *"a
library, including many readable books, a librarian, and many other cute
features and a dimly lit atmosphere ... with models for the building and
interior features made using Blender."*

Like ``castle_build.py``, **this script is the authoring source** and
``library.blend`` is a generated artefact. Do not hand-edit the .blend; the
next run overwrites it. ``library_export.py`` writes the ``.glb`` and
``pnpm run blend:library`` runs build → export → pack.

## The seam with the Engineer (#716 and later)

* **This file owns shape and nothing else**: geometry, the face UVs on the
  three heads that carry a painted face, and one named node per
  distinctly-coloured part. The ``.glb`` carries **no colour and no
  material**.
* **The Engineer owns the TypeScript**: colours, outlines, shadows, glow,
  colliders and every placement. They re-measure this file's figures off the
  built mesh with ``visibleBounds()`` and never type them.
* Every number in :data:`CONTRACT` is **asserted against the measured
  geometry** at the end of this run. If one has to change, it changes there,
  in HANDOFF-library-art.md, and in a comment on #716.

## Jim's scale rule (quoted in castle_build.py), which governs every size

> "Maintain the non-proportional scale — it doesn't matter if things are a
> realistic size, only that they are easily recognisable as what they are."

So: books the size of a child's forearm, an owl as tall as a child's
shoulders-and-head, a lamp shade like a mushroom cap. **Do not "correct"
these toward realism.** The two things that are *not* style and come from
the rig are seat heights and reach (see :data:`CHILD_HIP`).

## Conventions (ART_DIRECTION §7, ASSET_MANIFEST's shared contract)

* 1 Blender unit = 1 metre. **Blender −Y is the game's +Z**: anything with a
  front faces −Y here (the door, the desk's customer side, every face, every
  spine). The exporter's ``export_yup`` maps Blender (x, y, z) → glTF
  (x, z, −y).
* **Node names are hyphenated, never dotted.** three.js's ``GLTFLoader``
  deletes full stops from node names (ART-AGENT-NOTES §6a), so the brief's
  ``library.shell.walls`` ships as ``shell-walls``. The game-side asset key
  ``library.<asset>`` maps to the collection ``<asset>`` here (dots → hyphens:
  ``library.book.tall.thin`` → ``book-tall-thin``), and every node is
  ``<asset>-<part>`` — or just ``<asset>`` for a one-node asset such as a book.
* Origin at the **base**, centred on X, every placement baked into vertices
  and every node at an identity transform — except the documented families
  below, each **asserted against the emitted vertices**:
  - ``HINGE`` (the secret shelf): the asset's origin is its hinge axis, the
    vertical line through its front-left corner, so opening it is one
    rotation of the whole asset about local Y.
  - ``PIVOT`` nodes inside an ordinary asset (an owl's head, a cat's ear, a
    dragon's tail): the node carries a pure translation to its joint, so a
    turn, a twitch or a flick is one rotation of that node and nobody keeps a
    pivot offset in step with a shape. The castle chest lid and the reptile
    kit's croc tail are the precedent.
* No randomness. Variety comes from where the Engineer puts things and what
  colour they paint them.

## Faces (ART_DIRECTION §3, src/art/models/CLAUDE.md)

The owl, the dragon and the cat each carry their face **in their own head's
UVs** — no second mesh. Front-facing polygons of the head node get a planar
projection over a stated window; every other polygon is parked at
``(0.02, 0.02)``, which must be plain fill on the canvas. ``v`` is written
``(top − z) / height`` exactly as ``reptile_creatures_build.py``'s
``snake_face_uvs`` does, to cancel the exporter's ``1 − v``; so **paint these
through ``planarUvCanvasTexture`` (flipY = true), not ``glbCanvasTexture``**.
Canvas (u, v) in the printed anchors are fractions from the canvas's
top-left corner.
"""

import math
import os
import sys
import traceback

import bmesh
import bpy
from mathutils import Euler, Matrix, Vector
from mathutils import geometry as mgeom
from mathutils.bvhtree import BVHTree

sys.dont_write_bytecode = True
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
    reset_scene,
    revolve,
    rounded_box,
    summarise,
    total_triangles,
    ts_const,
    tube,
)

BLEND = os.path.join(REPO, "art", "blend", "library.blend")

# =============================================================================
# The game's numbers. Read, never typed.
# =============================================================================

KID_MODULE = "src/art/models/kid.ts"
CHILD_HEIGHT = ts_const(KID_MODULE, "KID_HEIGHT")
TALLEST_CHILD = ts_const(KID_MODULE, "TALLEST_CHILD_HEIGHT")
# **The one seat height at which a child's feet reach the floor.** The rig has
# no knee (kid.ts, `KID_HIP_HEIGHT`'s own doc): sat on a seat of height H her
# feet land at H − hip, and there is no joint to take up the difference. The
# brief proposed 0.55 m for the armchair and 0.30 m for the floor cushion;
# 0.55 leaves her feet dangling 0.19 m and 0.30 puts them 6 cm through the
# floor. Both are cut to this instead — the castle's bench and throne were
# re-cut to it on Jim's ruling of 29 August for the same reason.
CHILD_HIP = ts_const(KID_MODULE, "KID_HIP_HEIGHT")
CHILD_REACH = ts_const(KID_MODULE, "KID_REACH_HEIGHT")
# The librarian's desk is a counter a child is served over, so it stands at
# the shop kiosks' counter height — the kiosk's own constant, not a copy.
COUNTER_MODULE = "src/world/building/shops/stallShape.ts"
COUNTER_TOP = ts_const(COUNTER_MODULE, "COUNTER_TOP_Y")


def deg(x: float) -> float:
    return math.radians(x)


def rot(x=0.0, y=0.0, z=0.0) -> Matrix:
    """A rotation matrix from degrees, in XYZ order."""
    return Euler((deg(x), deg(y), deg(z)), "XYZ").to_matrix().to_4x4()


def place(x=0.0, y=0.0, z=0.0, rx=0.0, ry=0.0, rz=0.0) -> Matrix:
    return Matrix.Translation((x, y, z)) @ rot(rx, ry, rz)


def scaled(sx=1.0, sy=1.0, sz=1.0) -> Matrix:
    return Matrix.Diagonal((sx, sy, sz, 1.0))


# =============================================================================
# Shapes this file needs that blendkit does not have
# =============================================================================


def prism_x(outline_yz, half_x: float, centre):
    """A solid prism from a closed (y, z) outline, extruded along X over ±half_x.

    ``extrude_outline`` lays its outline in XZ and extrudes along Y; a quarter
    turn about Z maps (x, y, z) → (−y, x, z), which puts the outline's first
    coordinate on Y and the extrusion across X. ``centre`` must see every
    outline point (the caps are fans from it).
    """
    verts, faces = extrude_outline(outline_yz, half_x * 2.0, centre=centre)
    return [tuple(rot(z=90.0) @ Vector(v)) for v in verts], faces


def extrude_z(outline_xy, z0: float, z1: float, centre=(0.0, 0.0)):
    """A solid prism from a closed (x, y) outline, standing from z0 to z1."""
    n = len(outline_xy)
    verts = [(x, y, z0) for x, y in outline_xy] + [(x, y, z1) for x, y in outline_xy]
    bottom = len(verts)
    verts.append((centre[0], centre[1], z0))
    top = len(verts)
    verts.append((centre[0], centre[1], z1))
    faces = []
    for i in range(n):
        j = (i + 1) % n
        faces.append((i, j, n + j, n + i))
        faces.append((j, i, bottom))
        faces.append((n + i, n + j, top))
    return verts, faces


def arch_outline(width: float, height: float, segments: int = 10):
    """An upright arch in (x, z): straight jambs from z = 0 and a semicircular
    head whose crown is at ``height``. Convex, so a fan from its middle works."""
    r = width * 0.5
    spring = height - r
    pts = [(-r, 0.0), (r, 0.0)]
    for i in range(segments + 1):
        a = math.pi * i / segments
        pts.append((r * math.cos(a), spring + r * math.sin(a)))
    return pts


def arch_block(half_w: float, spring_z: float, top_z: float, y0: float, y1: float,
               segments: int = 12):
    """The masonry over a round-headed opening: a block from ``spring_z`` to
    ``top_z`` whose underside is the semicircular soffit, between y0 and y1.

    Built as strips rather than a fan because the shape is not star-shaped —
    every face is a quad between the soffit curve and the flat top, so it is a
    closed solid by construction rather than by a triangulator's opinion.
    """
    curve = [
        (half_w * math.cos(math.pi - math.pi * i / segments),
         spring_z + half_w * math.sin(math.pi - math.pi * i / segments))
        for i in range(segments + 1)
    ]
    verts = []
    for y in (y0, y1):
        for x, z in curve:
            verts.append((x, y, z))
        for x, _ in curve:
            verts.append((x, y, top_z))
    n = segments + 1
    lo0, hi0, lo1, hi1 = 0, n, 2 * n, 3 * n
    faces = []
    for i in range(segments):
        j = i + 1
        faces.append((lo0 + i, lo0 + j, hi0 + j, hi0 + i))  # front
        faces.append((lo1 + j, lo1 + i, hi1 + i, hi1 + j))  # back
        faces.append((lo1 + i, lo1 + j, lo0 + j, lo0 + i))  # soffit
        faces.append((hi0 + i, hi0 + j, hi1 + j, hi1 + i))  # top
    faces.append((lo0, hi0, hi1, lo1))                      # left end
    faces.append((lo1 + segments, hi1 + segments, hi0 + segments, lo0 + segments))
    return verts, faces


def torus(major: float, minor: float, segments: int = 16, sides: int = 6):
    """A ring lying in XY about Z — a glasses rim, once turned to face −Y."""
    profile = [
        (major + minor * math.cos(TAU * k / sides), minor * math.sin(TAU * k / sides))
        for k in range(sides)
    ]
    return revolve(profile, segments)


def revolve_lobed(profile, segments: int, lobes: int, amp: float):
    """:func:`blendkit.revolve` with the radius pinched into ``lobes`` soft
    puffs — a buttoned pouf rather than a hockey puck. The profile's radii are
    the *peak* radii: troughs come in by ``amp``."""
    verts = []
    faces = []
    count = len(profile)
    for s in range(segments):
        a = s * TAU / segments
        k = 1.0 - amp * 0.5 * (1.0 - math.cos(lobes * a))
        for r, z in profile:
            verts.append((r * k * math.cos(a), r * k * math.sin(a), z))
    for s in range(segments):
        sn = (s + 1) % segments
        for p in range(count):
            pn = (p + 1) % count
            faces.append((s * count + p, s * count + pn, sn * count + pn, sn * count + p))
    return verts, faces


def tapered_sweep(points, radii, sides: int = 8):
    """A tube along an open path with a radius per station, capped both ends.

    The frame is carried along the path (each station's normal is the last
    one's, re-squared against the new tangent) so a path that turns from
    horizontal to vertical — a lamp's gooseneck — does not twist or collapse,
    which a fixed tangent × up frame does.
    """
    count = len(points)
    assert count == len(radii) and count >= 2
    pts = [Vector(p) for p in points]
    tangents = []
    for i in range(count):
        nxt = pts[min(i + 1, count - 1)]
        prv = pts[max(i - 1, 0)]
        tangents.append((nxt - prv).normalized())
    seed = Vector((0.0, 0.0, 1.0))
    if abs(seed.dot(tangents[0])) > 0.9:
        seed = Vector((1.0, 0.0, 0.0))
    normal = (seed - tangents[0] * seed.dot(tangents[0])).normalized()
    verts = []
    for i in range(count):
        t = tangents[i]
        normal = (normal - t * normal.dot(t)).normalized()
        side = t.cross(normal).normalized()
        for k in range(sides):
            a = k * TAU / sides
            verts.append(tuple(pts[i] + side * (math.cos(a) * radii[i])
                               + normal * (math.sin(a) * radii[i])))
    faces = []
    for i in range(count - 1):
        for k in range(sides):
            kn = (k + 1) % sides
            faces.append((i * sides + k, i * sides + kn, (i + 1) * sides + kn, (i + 1) * sides + k))
    faces.append(tuple(range(sides - 1, -1, -1)))
    faces.append(tuple(range((count - 1) * sides, count * sides)))
    return verts, faces


def lying_book(width: float, depth: float, thick: float, board: float = 0.03,
               round_spine: bool = True):
    """A closed book lying flat: two cover boards and a spine (the cover, one
    colour) and the page block between them (cream, its own node).

    The spine faces −Y. The faces that would otherwise share a plane with a
    neighbour are moved off it on purpose (ART_DIRECTION §7, "two surfaces in
    the same plane will flicker"): the spine stands 1 cm proud of the boards'
    front edge, stops 5 mm short of their ends and 2 mm inside their top and
    bottom; the page block is inset on three sides and buried 2 mm into each
    board.
    """
    cover = Part("_cover")
    pages = Part("_pages")
    # Plain boxes for the boards and the page block: 3 cm of board edge seen
    # from the iso camera does not show a bevel, and two dozen of these books
    # are in the nest — a bevel there was 40 KB of shipped file.
    cover.at(*box(width, depth, board), z=board * 0.5)
    cover.at(*box(width, depth, board), z=thick - board * 0.5)
    spine_d = 0.05
    spine = (rounded_box(width - 0.01, spine_d, thick - 0.004, 0.018, 1) if round_spine
             else box(width - 0.01, spine_d, thick - 0.004))
    cover.at(*spine, y=-depth * 0.5 - 0.01 + spine_d * 0.5, z=thick * 0.5)
    page_y0 = -depth * 0.5 + spine_d - 0.02
    page_y1 = depth * 0.5 - 0.018
    pages.at(*box(width - 0.036, page_y1 - page_y0, thick - 2.0 * board + 0.004),
             y=(page_y0 + page_y1) * 0.5, z=thick * 0.5)
    return cover, pages


# =============================================================================
# One asset: its parts, its landmarks, its pivots and its faces
# =============================================================================

PARKED_UV = (0.02, 0.02)


class Asset:
    """Every part of one asset, built in the asset's own frame.

    **Landmarks** (``marks``) are named points — a neck, a shoulder, an eye
    centre, a face window's corners — authored with the geometry and carried
    through every transform the geometry goes through. A pivot or an eye is
    therefore never a second number kept in step with a shape: it moves when
    the shape moves, including through :meth:`normalise`.
    """

    def __init__(self, name: str) -> None:
        assert "." not in name, f"{name}: GLTFLoader strips full stops — hyphenate"
        self.name = name
        self.parts: dict[str, Part] = {}
        self.marks: dict[str, Vector] = {}
        # node -> (landmark, parent node it turns against)
        self.pivots: dict[str, tuple[str, str]] = {}
        # node -> (lo landmark, hi landmark, [eye landmarks])
        self.faces: dict[str, tuple[str, str, list]] = {}
        self.scale = (1.0, 1.0, 1.0)

    def part(self, suffix=None) -> Part:
        node = self.name if suffix is None else f"{self.name}-{suffix}"
        assert "." not in node and node not in self.parts
        self.parts[node] = Part(node)
        return self.parts[node]

    def mark(self, key: str, x: float, y: float, z: float) -> None:
        self.marks[key] = Vector((x, y, z))

    def bounds(self):
        lo = Vector((1e9, 1e9, 1e9))
        hi = Vector((-1e9, -1e9, -1e9))
        for part in self.parts.values():
            plo, phi = part.bounds()
            for i in range(3):
                lo[i] = min(lo[i], plo[i])
                hi[i] = max(hi[i], phi[i])
        return lo, hi

    def transform(self, fn) -> None:
        for part in self.parts.values():
            part.verts = [tuple(fn(Vector(v))) for v in part.verts]
        for key in self.marks:
            self.marks[key] = fn(self.marks[key])

    def normalise(self, height=None, length=None, span=None, centre_x=True) -> None:
        """Ground the asset, centre it on X and stretch it to its contract.

        For the creatures, whose silhouettes are a dozen squashed spheres
        whose union no formula predicts: the design is built at roughly the
        right size and this makes it exactly the right size. The stretch is
        printed and held within 8% (:func:`check_scales`), so a design that is
        badly off its brief fails rather than being silently squashed.
        """
        lo, hi = self.bounds()
        sz = 1.0 if height is None else height / (hi.z - lo.z)
        sx = sy = 1.0
        if length is not None:
            sx = length / (hi.x - lo.x)
        if span is not None:
            sx = sy = span / max(hi.x - lo.x, hi.y - lo.y)
        cx = (lo.x + hi.x) * 0.5 if centre_x else 0.0
        ground = lo.z
        self.transform(lambda v: Vector(((v.x - cx) * sx, v.y * sy, (v.z - ground) * sz)))
        self.scale = (sx, sy, sz)

    def emit(self) -> dict:
        coll = collection(self.name)
        objs = {}
        for node, part in self.parts.items():
            pivot = self.pivots.get(node)
            if pivot is None:
                objs[node] = part.emit(coll)
                continue
            p = self.marks[pivot[0]]
            part.verts = [(v[0] - p.x, v[1] - p.y, v[2] - p.z) for v in part.verts]
            objs[node] = part.emit(coll, location=tuple(p))
        for node, (lo_key, hi_key, _eyes) in self.faces.items():
            face_window_uvs(objs[node], self.marks[lo_key], self.marks[hi_key])
        return objs

    def face_uv(self, node: str, key: str):
        """Where landmark ``key`` lands on ``node``'s canvas, as (u, v) from the
        top-left — the same mapping :func:`face_window_uvs` writes."""
        lo_key, hi_key, _ = self.faces[node]
        return window_uv(self.marks[key], self.marks[lo_key], self.marks[hi_key])


def window_uv(point: Vector, lo: Vector, hi: Vector):
    return ((point.x - lo.x) / (hi.x - lo.x), (hi.z - point.z) / (hi.z - lo.z))


def face_window_uvs(obj, lo: Vector, hi: Vector) -> None:
    """Planar front projection of a head node's front-facing polygons over the
    window ``lo``..``hi`` (asset frame, x and z); everything else parked.

    Computed from where each vertex **is** after emit, in the node's own frame
    (a pivoted head's vertices are relative to its neck, so the window is
    shifted by the node's location). A per-face table keyed by pre-weld index
    lands on the wrong polygons — the gate arch's lesson, which the reptile
    kit's ``snake_face_uvs`` also follows.
    """
    mesh = obj.data
    off = Vector(obj.location)
    lo_l = lo - off
    hi_l = hi - off
    layer = mesh.uv_layers.new(name="UVMap")
    for poly in mesh.polygons:
        front = poly.normal.y < -0.05
        for loop_index in poly.loop_indices:
            if not front:
                layer.data[loop_index].uv = PARKED_UV
                continue
            co = mesh.vertices[mesh.loops[loop_index].vertex_index].co
            layer.data[loop_index].uv = window_uv(co, lo_l, hi_l)


ASSETS: dict[str, Asset] = {}


def register(asset: Asset) -> Asset:
    assert asset.name not in ASSETS
    ASSETS[asset.name] = asset
    return asset


# =============================================================================
# THE CONTRACT
# =============================================================================
#
# Every figure the Engineer builds against, by asset. Each is asserted against
# the emitted geometry by a measurement in `MEASURE` below, and `main()` fails
# if a figure has no measurement or a measurement has no figure — a contract
# line nobody checks is a check that cannot fail.
#
# `=` is exact to `TOL` (5 mm); `<=`/`>=` are allowances. Heights of FLOOR
# assets are measured from the floor they stand on.

TOL = 0.005

# --- the exterior ------------------------------------------------------------
SHELL_WIDTH = 18.0
SHELL_DEPTH = 14.0
SHELL_HEIGHT = 12.0
PLINTH_TOP = 0.36
STEP_RISE = 0.18
STEP_COUNT = round(PLINTH_TOP / STEP_RISE)
COLUMN_COUNT = 6
COLUMN_DIAMETER = 1.2
COLUMN_TOP = 7.0
DOOR_WIDTH = 3.2
DOOR_HEIGHT = 4.0

# --- the bookcase --------------------------------------------------------------
SHELF_LENGTH = 4.0
SHELF_DEPTH = 0.6
SHELF_HEIGHT = 3.2
SHELF_ROWS = 5

# --- furniture -----------------------------------------------------------------
DESK_LENGTH = 3.0
DESK_DEPTH = 1.0
READING_LAMP_HEIGHT = 0.7
FLOOR_LAMP_HEIGHT = 2.4
ARMCHAIR_WIDTH = 1.4
CUSHION_DIAMETER = 0.9

# --- books -----------------------------------------------------------------------
BOOK_HEIGHTS = (("tall", 0.42), ("mid", 0.36), ("short", 0.30))
BOOK_THICKNESSES = (("thin", 0.06), ("thick", 0.09))
BOOK_DEPTH = 0.26
TALL_BOOK = dict(BOOK_HEIGHTS)["tall"]
# Headroom over the tallest book on every row, so a book can be tipped out by
# its top edge rather than slid out sideways. A row that fits a book exactly
# is a row whose books look wedged in.
BOOK_PULL_MARGIN = 0.04
BOOK_PILE_HEIGHT = 0.9
READER_BOARD_WIDTH = 0.45   # spine → fore-edge, along X
READER_BOARD_HEIGHT = 0.60  # along the spine, along Y

# --- creatures -------------------------------------------------------------------
OWL_HEIGHT = 1.6
DRAGON_LENGTH = 1.1
DRAGON_HEIGHT = 0.9
NEST_DIAMETER = 1.6
CAT_LENGTH = 0.6
CAT_HEIGHT = 0.35

EXACT, AT_MOST, AT_LEAST = "=", "<=", ">="

CONTRACT = {
    "shell": {
        "width": (EXACT, SHELL_WIDTH), "depth": (EXACT, SHELL_DEPTH),
        "height": (EXACT, SHELL_HEIGHT), "plinthTop": (EXACT, PLINTH_TOP),
        "stepRise": (EXACT, STEP_RISE), "stepCount": (EXACT, STEP_COUNT),
        "columnCount": (EXACT, COLUMN_COUNT), "columnDiameter": (EXACT, COLUMN_DIAMETER),
        "columnTop": (EXACT, COLUMN_TOP), "doorWidth": (EXACT, DOOR_WIDTH),
        "doorHeight": (EXACT, DOOR_HEIGHT),
    },
    "shelf": {
        "width": (EXACT, SHELF_LENGTH), "depth": (EXACT, SHELF_DEPTH),
        "height": (EXACT, SHELF_HEIGHT), "rows": (EXACT, SHELF_ROWS),
        "rowClear": (AT_LEAST, TALL_BOOK + BOOK_PULL_MARGIN),
    },
    "secretShelf": {
        "width": (EXACT, SHELF_LENGTH), "depth": (EXACT, SHELF_DEPTH),
        "height": (EXACT, SHELF_HEIGHT), "hingeOffset": (AT_MOST, 0.0005),
        "shapeVsShelf": (AT_MOST, 0.0005),
    },
    "desk": {
        "width": (EXACT, DESK_LENGTH), "depth": (EXACT, DESK_DEPTH),
        "height": (EXACT, COUNTER_TOP), "flatTop": (AT_LEAST, 0.85),
    },
    "readingLamp": {"height": (EXACT, READING_LAMP_HEIGHT), "width": (AT_MOST, 0.45),
                    "depth": (AT_MOST, 0.45)},
    "floorLamp": {"height": (EXACT, FLOOR_LAMP_HEIGHT), "width": (AT_MOST, 0.80),
                  "depth": (AT_MOST, 0.80)},
    "armchair": {"width": (EXACT, ARMCHAIR_WIDTH), "seatTop": (EXACT, CHILD_HIP),
                 "depth": (AT_MOST, 1.20), "height": (AT_MOST, 1.30)},
    "cushion": {"width": (EXACT, CUSHION_DIAMETER), "depth": (EXACT, CUSHION_DIAMETER),
                "height": (EXACT, CHILD_HIP)},
    "bookPile": {"height": (EXACT, BOOK_PILE_HEIGHT), "width": (AT_MOST, 0.95),
                 "depth": (AT_MOST, 0.80)},
    "reader-cover": {"boardWidth": (EXACT, READER_BOARD_WIDTH),
                     "boardHeight": (EXACT, READER_BOARD_HEIGHT),
                     "height": (AT_MOST, 0.05)},
    "owl": {"height": (EXACT, OWL_HEIGHT), "headOverBody": (AT_LEAST, 1.10),
            "width": (AT_MOST, 1.30), "depth": (AT_MOST, 1.00)},
    "dragon": {"length": (EXACT, DRAGON_LENGTH), "height": (EXACT, DRAGON_HEIGHT)},
    "dragonNest": {"diameter": (EXACT, NEST_DIAMETER), "height": (AT_MOST, 0.40)},
    "cat": {"length": (EXACT, CAT_LENGTH), "height": (EXACT, CAT_HEIGHT)},
}
for _h_name, _h in BOOK_HEIGHTS:
    for _t_name, _t in BOOK_THICKNESSES:
        CONTRACT[f"book-{_h_name}-{_t_name}"] = {
            "height": (EXACT, _h), "width": (EXACT, _t), "depth": (EXACT, BOOK_DEPTH),
            # Hundreds of these are instanced. A budget, so a bevel added
            # "because it looks nicer" cannot quietly cost 10,000 triangles.
            "triangles": (AT_MOST, 40),
        }

# How each asset's origin is placed — see `check_origins`.
ORIGIN_FAMILY = {name: "FLOOR" for name in CONTRACT}
ORIGIN_FAMILY["secretShelf"] = "HINGE"


# =============================================================================
# 1. library.shell — the pillared exterior
# =============================================================================
#
# Laid out front (−Y) to back. All of these are this asset's own and nothing
# else reads them; the contract figures above are the ones the Engineer gets.

FRONT_Y = -SHELL_DEPTH * 0.5
BACK_Y = SHELL_DEPTH * 0.5
STEP_TREAD = 0.60
PLINTH_FRONT_Y = FRONT_Y + STEP_COUNT * STEP_TREAD
# The central bay is wider than the others — the classical "eustyle" door bay,
# and here a functional one: the clear gap between the two middle shafts is
# 3.3 m, wider than the 3.2 m door behind it, so the door is never framed by
# a column. The side bays are 1.5 m clear — narrower than a child
# (`CHILD_FOOTPRINT`), so nobody is invited to squeeze between them.
COLUMN_XS = (-7.65, -4.95, -2.25, 2.25, 4.95, 7.65)
COLUMN_Y = -4.85
COLUMN_BASE_RADIUS = 0.78
ABACUS = 1.56
WALL_HALF = 8.2
WALL_FRONT_Y = -2.6
WALL_BACK_Y = 6.4
DOOR_RECESS = 0.9
DOOR_BACK_Y = WALL_FRONT_Y + DOOR_RECESS
DOOR_SPRING = PLINTH_TOP + DOOR_HEIGHT - DOOR_WIDTH * 0.5
# (z0, z1, half-width, y0, y1) of each band of the entablature.
ARCHITRAVE = (COLUMN_TOP, 7.55, 8.50, -5.70, 6.55)
FRIEZE = (7.54, 8.06, 8.45, -5.65, 6.50)
CORNICE = (8.05, 8.40, 8.75, -5.95, 6.80)
CORNICE_TOP = CORNICE[1]
ROOF_HALF = 8.95
EAVE_TOP = 8.62
# The ridge roll's top *is* the building's height: the roll is a cylinder of
# radius SHELL_HEIGHT − ROOF_APEX laid along the ridge.
ROOF_APEX = 11.80
RIDGE_RADIUS = SHELL_HEIGHT - ROOF_APEX
ROOF_FRONT_Y = -5.75
ROOF_BACK_Y = 6.95
ROOF_SLOPE = (ROOF_APEX - EAVE_TOP) / ROOF_HALF
PEDIMENT_FRONT_Y = -6.15
PEDIMENT_FRAME = 0.42
TYMPANUM_FRONT_Y = -5.95
ROOF_OUTLINE = [
    (-ROOF_HALF, CORNICE_TOP), (-ROOF_HALF, EAVE_TOP), (0.0, ROOF_APEX),
    (ROOF_HALF, EAVE_TOP), (ROOF_HALF, CORNICE_TOP),
]


def inner_gable(offset: float, base_z: float):
    """The triangle inside the roof outline, ``offset`` in from its raking
    edges, standing on ``base_z``: (left, apex, right) in (x, z)."""
    apex = ROOF_APEX - offset * math.sqrt(1.0 + ROOF_SLOPE ** 2)
    half = (apex - base_z) / ROOF_SLOPE
    return [(-half, base_z), (0.0, apex), (half, base_z)]


def pediment_frame(y_front: float, y_back: float):
    """The pediment's stone frame: the roof outline with the tympanum cut out
    of it, as one closed ring. Outer is the five-point roof outline; inner is
    the three-point gable :data:`PEDIMENT_FRAME` in from it."""
    outer = ROOF_OUTLINE
    inner = inner_gable(PEDIMENT_FRAME, CORNICE_TOP + PEDIMENT_FRAME)
    verts = []
    for y in (y_front, y_back):
        verts += [(x, y, z) for x, z in outer]
        verts += [(x, y, z) for x, z in inner]
    of, inf_, ob, inb = 0, 5, 8, 13
    a, b, c, d, e = range(5)
    lft, top, rgt = range(3)
    ring = [
        ((a, b), (lft,)), ((b, c), (top, lft)), ((c, d), (rgt, top)),
        ((d, e), (rgt,)), ((e, a), (lft, rgt)),
    ]
    faces = []
    for (i, j), inner_ids in ring:
        faces.append(tuple([of + i, of + j] + [inf_ + k for k in inner_ids]))
        faces.append(tuple(reversed([ob + i, ob + j] + [inb + k for k in inner_ids])))
    for i in range(5):
        j = (i + 1) % 5
        faces.append((of + i, ob + i, ob + j, of + j))
    for i in range(3):
        j = (i + 1) % 3
        faces.append((inf_ + i, inf_ + j, inb + j, inb + i))
    return verts, faces


def star_outline(cx: float, cz: float, outer: float, inner: float, points: int = 5):
    pts = []
    for k in range(points * 2):
        r = outer if k % 2 == 0 else inner
        a = math.pi * 0.5 + math.pi * k / points
        pts.append((cx + r * math.cos(a), cz + r * math.sin(a)))
    return pts


def build_shell() -> None:
    """The library: steps, a plinth, six fat columns, an entablature and a
    pediment with a book carved in it, over a solid box with a round-headed
    door. The sign is the Engineer's (the label system), not geometry."""
    a = register(Asset("shell"))
    plinth = a.part("plinth")
    steps = a.part("steps")
    walls = a.part("walls")
    windows = a.part("windows")
    door = a.part("door")
    columns = a.part("columns")
    entablature = a.part("entablature")
    pediment = a.part("pediment")
    book = a.part("pedimentBook")
    roof = a.part("roof")

    # --- plinth and steps ---------------------------------------------------
    plinth.at(*flat_top_box(SHELL_WIDTH, BACK_Y - PLINTH_FRONT_Y, PLINTH_TOP, 0.08, 1),
              y=(PLINTH_FRONT_Y + BACK_Y) * 0.5, z=PLINTH_TOP * 0.5)
    # One stair profile, full width, two risers with softened nosings. Its
    # back face meets the plinth's front back-to-back, which is not a seam
    # either can lose (only same-facing coplanar faces fight).
    nose = 0.04
    profile = [(FRONT_Y, 0.0)]
    for k in range(STEP_COUNT):
        y_riser = FRONT_Y + k * STEP_TREAD
        z_top = (k + 1) * STEP_RISE
        if k > 0:
            profile.append((y_riser, k * STEP_RISE))
        profile += [(y_riser, z_top - nose), (y_riser + nose * 0.3, z_top - nose * 0.3),
                    (y_riser + nose, z_top)]
    profile += [(PLINTH_FRONT_Y, PLINTH_TOP), (PLINTH_FRONT_Y, 0.0)]
    steps.add(*prism_x(profile, SHELL_WIDTH * 0.5,
                       centre=(PLINTH_FRONT_Y - STEP_TREAD * 0.5, STEP_RISE * 0.5)))

    # --- walls --------------------------------------------------------------
    wall_h = COLUMN_TOP - PLINTH_TOP
    walls.at(*rounded_box(WALL_HALF * 2.0, WALL_BACK_Y - DOOR_BACK_Y, wall_h, 0.15, 2),
             y=(DOOR_BACK_Y + WALL_BACK_Y) * 0.5, z=PLINTH_TOP + wall_h * 0.5)
    # The facade either side of the door, stepped 5 cm in from the side walls
    # so its side faces never share a plane with theirs.
    wing_outer = WALL_HALF - 0.05
    wing_w = wing_outer - DOOR_WIDTH * 0.5
    for sx in (-1.0, 1.0):
        walls.at(*rounded_box(wing_w, DOOR_RECESS, wall_h, 0.10, 2),
                 x=sx * (DOOR_WIDTH * 0.5 + wing_w * 0.5),
                 y=WALL_FRONT_Y + DOOR_RECESS * 0.5, z=PLINTH_TOP + wall_h * 0.5)
    # The arch over the door, 8 cm proud of the facade, and a keystone that
    # stands on its crown — never below it, or it would be in the doorway.
    walls.add(*arch_block(DOOR_WIDTH * 0.5, DOOR_SPRING, COLUMN_TOP,
                          WALL_FRONT_Y - 0.08, DOOR_BACK_Y))
    crown = DOOR_SPRING + DOOR_WIDTH * 0.5
    walls.add(*extrude_outline([(-0.26, 0.0), (0.26, 0.0), (0.36, 0.72), (-0.36, 0.72)],
                               0.24, centre=(0.0, 0.36)),
              matrix=Matrix.Translation((0.0, WALL_FRONT_Y - 0.06, crown)))

    # Windows: arched panes 6 cm proud, a sill under each (wall colour).
    win_w, win_h, win_z = 1.3, 2.9, 1.4
    pane = arch_outline(win_w, win_h, 8)
    pane_centre = (0.0, win_h * 0.45)
    for sx in (-1.0, 1.0):
        x = sx * 6.3
        windows.add(*extrude_outline(pane, 0.12, centre=pane_centre),
                    matrix=Matrix.Translation((x, WALL_FRONT_Y, win_z)))
        walls.at(*rounded_box(win_w + 0.3, 0.24, 0.12, 0.04, 1),
                 x=x, y=WALL_FRONT_Y - 0.06, z=win_z - 0.05)
        for y in (0.3, 2.5, 4.7):
            windows.add(*prism_x([(py + y, pz + win_z) for py, pz in pane], 0.06,
                                 centre=(y, win_z + win_h * 0.45)),
                        matrix=Matrix.Translation((sx * WALL_HALF, 0.0, 0.0)))
            walls.add(*rounded_box(0.24, win_w + 0.3, 0.12, 0.04, 1),
                      matrix=Matrix.Translation((sx * (WALL_HALF + 0.06), y, win_z - 0.05)))

    # --- the door -----------------------------------------------------------
    # A plate 4 cm over-size on each edge so its edges are buried in the
    # masonry rather than meeting it face to face, two leaves of raised
    # panels, a centre strip and two knobs.
    door.add(*extrude_outline(arch_outline(DOOR_WIDTH + 0.04, DOOR_HEIGHT + 0.02, 12), 0.16,
                              centre=(0.0, DOOR_HEIGHT * 0.5)),
             matrix=Matrix.Translation((0.0, DOOR_BACK_Y - 0.04, PLINTH_TOP)))
    strip_h = DOOR_SPRING - PLINTH_TOP + 1.33
    door.at(*rounded_box(0.14, 0.08, strip_h, 0.03, 1),
            y=DOOR_BACK_Y - 0.15, z=PLINTH_TOP + 0.02 + strip_h * 0.5)
    for sx in (-1.0, 1.0):
        door.at(*rounded_box(0.96, 0.07, 1.20, 0.04, 1),
                x=sx * 0.78, y=DOOR_BACK_Y - 0.13, z=PLINTH_TOP + 0.30 + 0.60)
        door.at(*rounded_box(0.96, 0.07, 1.30, 0.04, 1),
                x=sx * 0.78, y=DOOR_BACK_Y - 0.13, z=PLINTH_TOP + 1.80 + 0.65)
        door.at(*icosphere(0.09, 1), x=sx * 0.24, y=DOOR_BACK_Y - 0.21, z=PLINTH_TOP + 1.55)

    # --- columns -------------------------------------------------------------
    # One turned profile per column, foot to capital: a round plinth, a fat
    # torus, a shaft swelling to exactly COLUMN_DIAMETER a third of the way up
    # (entasis), a neck ring and a cushion capital that runs up into the
    # square abacus. Round at the foot, so its collider can be a disc.
    base_h = 0.14
    profile = [
        (0.0, PLINTH_TOP), (COLUMN_BASE_RADIUS, PLINTH_TOP),
        (COLUMN_BASE_RADIUS, PLINTH_TOP + base_h - 0.04), (COLUMN_BASE_RADIUS - 0.04, PLINTH_TOP + base_h),
        (0.725, 0.58), (0.60, 0.70),
        (COLUMN_DIAMETER * 0.5, 2.60), (0.545, 6.16), (0.59, 6.25),
        (0.70, 6.58), (0.74, 6.74), (0.0, 6.74),
    ]
    for x in COLUMN_XS:
        columns.at(*revolve(profile, 16), x=x, y=COLUMN_Y)
        columns.at(*rounded_box(ABACUS, ABACUS, 0.30, 0.05, 1), x=x, y=COLUMN_Y,
                   z=COLUMN_TOP - 0.15)

    # --- entablature --------------------------------------------------------
    for z0, z1, half, y0, y1 in (ARCHITRAVE, FRIEZE):
        entablature.at(*rounded_box(half * 2.0, y1 - y0, z1 - z0, 0.05, 1),
                       y=(y0 + y1) * 0.5, z=(z0 + z1) * 0.5)
    z0, z1, half, y0, y1 = CORNICE
    entablature.at(*flat_top_box(half * 2.0, y1 - y0, z1 - z0, 0.06, 1),
                   y=(y0 + y1) * 0.5, z=(z0 + z1) * 0.5)
    # A row of chunky dentils under the cornice, across the front only.
    for i in range(13):
        x = -7.8 + i * 1.30
        entablature.at(*box(0.24, 0.14, 0.17), x=x, y=FRIEZE[3] - 0.05, z=CORNICE[0] - 0.075)

    # --- roof ---------------------------------------------------------------
    roof.add(*extrude_outline(ROOF_OUTLINE, ROOF_BACK_Y - ROOF_FRONT_Y,
                              centre=(0.0, CORNICE_TOP + 1.0)),
             matrix=Matrix.Translation((0.0, (ROOF_FRONT_Y + ROOF_BACK_Y) * 0.5, 0.0)))
    ridge_y0 = PEDIMENT_FRONT_Y - 0.10
    roof.add(*tube(RIDGE_RADIUS, ROOF_BACK_Y - ridge_y0, sides=12),
             matrix=Matrix.Translation((0.0, ridge_y0, ROOF_APEX)) @ rot(x=-90.0))
    # Tile courses: four battens down each slope, so 230 m² of roof reads as a
    # roof rather than as a grey ramp.
    alpha = math.degrees(math.atan(ROOF_SLOPE))
    batten_len = ROOF_BACK_Y - ROOF_FRONT_Y - 0.10
    for d in (1.6, 3.4, 5.2, 7.0):
        z = EAVE_TOP + d * ROOF_SLOPE
        for sx in (-1.0, 1.0):
            nx, nz = sx * math.sin(math.radians(alpha)), math.cos(math.radians(alpha))
            roof.add(*rounded_box(0.24, batten_len, 0.10, 0.04, 1),
                     matrix=Matrix.Translation((sx * (ROOF_HALF - d) + nx * 0.03,
                                                (ROOF_FRONT_Y + ROOF_BACK_Y) * 0.5,
                                                z + nz * 0.03)) @ rot(y=sx * alpha))

    # --- pediment -----------------------------------------------------------
    pediment.add(*pediment_frame(PEDIMENT_FRONT_Y, ROOF_FRONT_Y))
    # The tympanum plate, grown 10 cm so its edges are buried in the frame.
    tymp = inner_gable(PEDIMENT_FRAME - 0.10, CORNICE_TOP + PEDIMENT_FRAME - 0.10)
    pediment.add(*extrude_outline(tymp, ROOF_FRONT_Y - TYMPANUM_FRONT_Y,
                                  centre=(0.0, tymp[0][1] + 0.6)),
                 matrix=Matrix.Translation((0.0, (TYMPANUM_FRONT_Y + ROOF_FRONT_Y) * 0.5, 0.0)))

    # The carved book: a closed book face-on — cover, a fat spine down its
    # left edge, a star on the cover and a bookmark ribbon hanging out.
    bx, bz, bw, bh = 0.10, 9.95, 2.20, 1.50
    by = TYMPANUM_FRONT_Y - 0.04
    book.at(*rounded_box(bw, 0.16, bh, 0.08, 2), x=bx, y=by, z=bz)
    book.at(*rounded_box(0.28, 0.22, bh + 0.08, 0.10, 2), x=bx - bw * 0.5, y=by - 0.02, z=bz)
    for dz in (-0.45, 0.45):
        book.at(*rounded_box(0.34, 0.24, 0.10, 0.04, 1), x=bx - bw * 0.5, y=by - 0.03, z=bz + dz)
    book.add(*extrude_outline(star_outline(0.0, 0.0, 0.42, 0.19), 0.10, centre=(0.0, 0.0)),
             matrix=Matrix.Translation((bx + 0.12, by - 0.09, bz + 0.05)))
    ribbon = [(-0.10, 0.0), (0.10, 0.0), (0.10, -0.40), (0.0, -0.30), (-0.10, -0.40)]
    book.add(*extrude_outline(ribbon, 0.06, centre=(0.0, -0.15)),
             matrix=Matrix.Translation((bx + 0.55, by - 0.07, bz - bh * 0.5 + 0.06)))

    a.mark("doorThreshold", 0.0, DOOR_BACK_Y, PLINTH_TOP)


# =============================================================================
# 2. library.shelf and library.secretShelf
# =============================================================================

SHELF_SIDE_T = 0.12
SHELF_SIDE_INSET = 0.04      # side panels in from the cornice's ends
SHELF_FRONT_INSET = 0.03     # side panels back from the cornice's front
SHELF_KICK = 0.12
SHELF_BOARD = 0.06
SHELF_TOP_BOARD = 0.08
SHELF_CORNICE = 0.12
SHELF_BOARD_SETBACK = 0.05   # boards back from the cornice's front
SHELF_BACK_T = 0.055
# The clear height of every row, derived rather than chosen: whatever is left
# of the 3.2 m once the solid parts are paid for, shared equally.
SHELF_ROW_CLEAR = (SHELF_HEIGHT - SHELF_KICK - SHELF_ROWS * SHELF_BOARD
                   - SHELF_TOP_BOARD - SHELF_CORNICE) / SHELF_ROWS


def shelf_parts(a: Asset) -> None:
    """A tall bookcase: cornice, two side panels, a top board, a kick, a back
    panel (the carcass) and five standing boards (the shelves).

    Every piece between the sides **abuts** them exactly rather than
    overlapping into them, so the only coincident faces are back-to-back ones
    (which never fight); every front face is set back from its neighbours'.
    """
    carcass = a.part("carcass")
    shelves = a.part("shelves")
    half = SHELF_LENGTH * 0.5
    front = -SHELF_DEPTH * 0.5
    back = SHELF_DEPTH * 0.5
    side_x = half - SHELF_SIDE_INSET - SHELF_SIDE_T * 0.5
    inner = half - SHELF_SIDE_INSET - SHELF_SIDE_T
    side_front = front + SHELF_FRONT_INSET
    under_cornice = SHELF_HEIGHT - SHELF_CORNICE

    carcass.at(*rounded_box(SHELF_LENGTH, SHELF_DEPTH, SHELF_CORNICE, 0.035, 2),
               z=SHELF_HEIGHT - SHELF_CORNICE * 0.5)
    for sx in (-1.0, 1.0):
        carcass.at(*rounded_box(SHELF_SIDE_T, back - side_front, under_cornice, 0.03, 1),
                   x=sx * side_x, y=(side_front + back) * 0.5, z=under_cornice * 0.5)
    top_front = side_front + 0.015
    carcass.at(*rounded_box(inner * 2.0, back - top_front, SHELF_TOP_BOARD, 0.02, 1),
               y=(top_front + back) * 0.5, z=under_cornice - SHELF_TOP_BOARD * 0.5)
    board_front = front + SHELF_BOARD_SETBACK
    board_back = back - SHELF_BACK_T - 0.005
    carcass.at(*rounded_box(inner * 2.0, board_back - board_front - 0.02, SHELF_KICK, 0.02, 1),
               y=(board_front + 0.02 + board_back) * 0.5, z=SHELF_KICK * 0.5)
    panel_h = under_cornice - SHELF_TOP_BOARD - SHELF_KICK
    carcass.at(*box(inner * 2.0, SHELF_BACK_T, panel_h),
               y=board_back + SHELF_BACK_T * 0.5, z=SHELF_KICK + panel_h * 0.5)

    for row in range(SHELF_ROWS):
        z0 = SHELF_KICK + row * (SHELF_BOARD + SHELF_ROW_CLEAR)
        shelves.at(*rounded_box(inner * 2.0, board_back - board_front, SHELF_BOARD, 0.015, 1),
                   y=(board_front + board_back) * 0.5, z=z0 + SHELF_BOARD * 0.5)


def build_shelf() -> None:
    shelf_parts(register(Asset("shelf")))


def build_secret_shelf() -> None:
    """The same bookcase, re-originated on its hinge.

    The hinge is the **vertical line through its front-left corner** (−X, −Y:
    the left end as a child facing it sees it, on the face she sees). So the
    asset spans x 0..4.0 and y 0..0.6 here, and in the game x 0..4.0, z
    −0.6..0: placed with its root on the hinge, ``rotation.y`` from 0 towards
    −π/2 swings it open out into the room (+Z), clear of the wall behind it.
    ``check_secret_shelf`` proves the shape is the shelf's, vertex for vertex.
    """
    a = register(Asset("secretShelf"))
    shelf_parts(a)
    shift = Vector((SHELF_LENGTH * 0.5, SHELF_DEPTH * 0.5, 0.0))
    a.transform(lambda v: v + shift)


# =============================================================================
# 3. library.desk
# =============================================================================

DESK_SLAB = 0.10


def build_desk() -> None:
    """The librarian's desk: a panelled body under a flat top at the kiosk
    counter height. The customer side — the panels — faces −Y."""
    a = register(Asset("desk"))
    body = a.part("body")
    top = a.part("top")
    under = COUNTER_TOP - DESK_SLAB
    top.at(*flat_top_box(DESK_LENGTH, DESK_DEPTH, DESK_SLAB, 0.05, 2), z=COUNTER_TOP - DESK_SLAB * 0.5)
    body_w, body_d = DESK_LENGTH - 0.12, DESK_DEPTH - 0.12
    body.at(*rounded_box(body_w + 0.06, body_d + 0.06, 0.10, 0.03, 1), z=0.05)
    body.at(*rounded_box(body_w, body_d, under - 0.06, 0.06, 2), z=0.06 + (under - 0.06) * 0.5)
    for x in (-0.94, 0.0, 0.94):
        body.at(*rounded_box(0.78, 0.06, 0.56, 0.025, 1), x=x, y=-body_d * 0.5 - 0.01, z=0.50)


# =============================================================================
# 4. Lamps
# =============================================================================


def build_reading_lamp() -> None:
    """A mushroom of a desk lamp: a round foot, a gooseneck and a fat dome
    shade with a bulb under it. ``-shade`` is the part the Engineer lights."""
    a = register(Asset("readingLamp"))
    stem = a.part("stem")
    shade = a.part("shade")
    h = READING_LAMP_HEIGHT
    stem.at(*revolve([(0.0, 0.0), (0.15, 0.0), (0.16, 0.025), (0.14, 0.055),
                      (0.06, 0.07), (0.0, 0.075)], 16))
    stem.add(*tapered_sweep([(0.0, 0.03, 0.05), (0.0, 0.03, 0.30), (0.0, 0.0, 0.45),
                             (0.0, -0.07, 0.52)], [0.036, 0.034, 0.033, 0.032], 8))
    sy = -0.08
    shade.at(*revolve([(0.0, h - 0.24), (0.16, h - 0.235), (0.20, h - 0.205),
                       (0.195, h - 0.15), (0.15, h - 0.085), (0.075, h - 0.045),
                       (0.0, h - 0.035)], 16), y=sy)
    shade.at(*icosphere(0.055, 1), y=sy, z=h - 0.24)
    # The knob on top is the lamp's highest point, and the asset's height.
    stem.at(*icosphere(0.035, 1), y=sy, z=h - 0.035)


def build_floor_lamp() -> None:
    """A tall standard lamp: a domed foot, a pole with a bead halfway, and a
    tulip shade topped with a finial at exactly the contract height."""
    a = register(Asset("floorLamp"))
    base = a.part("base")
    stem = a.part("stem")
    shade = a.part("shade")
    h = FLOOR_LAMP_HEIGHT
    base.at(*revolve([(0.0, 0.0), (0.32, 0.0), (0.33, 0.03), (0.30, 0.07),
                      (0.12, 0.10), (0.0, 0.11)], 20))
    stem.at(*tube(0.045, 2.0 - 0.08, sides=10, z0=0.08))
    stem.at(*ellipsoid(0.09, 0.09, 0.075, 1), z=1.0)
    shade.at(*revolve([(0.0, h - 0.44), (0.36, h - 0.44), (0.40, h - 0.41),
                       (0.37, h - 0.30), (0.31, h - 0.12), (0.27, h - 0.05),
                       (0.21, h - 0.04), (0.0, h - 0.04)], 20))
    stem.at(*icosphere(0.04, 1), z=h - 0.04)


# =============================================================================
# 5. Seats — both cut to the child's hip
# =============================================================================


def build_armchair() -> None:
    """A chunky rolled-arm armchair whose seat cushion's top is `CHILD_HIP`.

    ``-seat`` is the cushion and nothing else, so its measured top *is* the
    seat height. ``-frame`` is the upholstered body; ``-feet`` four buns.
    """
    a = register(Asset("armchair"))
    frame = a.part("frame")
    seat = a.part("seat")
    feet = a.part("feet")
    roll_r = 0.15
    arm_x = ARMCHAIR_WIDTH * 0.5 - roll_r
    frame.at(*rounded_box(1.24, 0.92, 0.20, 0.06, 2), z=0.17)
    for sx in (-1.0, 1.0):
        frame.at(*rounded_box(0.26, 0.92, 0.34, 0.06, 1), x=sx * arm_x, z=0.40)
        frame.add(*tube(roll_r, 0.98, sides=14),
                  matrix=Matrix.Translation((sx * arm_x, -0.49, 0.57)) @ rot(x=-90.0))
    frame.add(*rounded_box(1.10, 0.26, 0.80, 0.08, 2), matrix=place(0.0, 0.36, 0.62, rx=-8.0))
    frame.add(*tube(0.14, 1.14, sides=14), matrix=place(-0.57, 0.42, 1.02, ry=90.0))
    seat.at(*rounded_box(0.86, 0.78, 0.12, 0.05, 2), y=-0.06, z=CHILD_HIP - 0.06)
    for sx in (-1.0, 1.0):
        for sy in (-1.0, 1.0):
            feet.at(*ellipsoid(0.075, 0.075, 0.05, 1), x=sx * 0.52, y=sy * 0.36, z=0.05)


def build_cushion() -> None:
    """A fat floor pouf, eight soft puffs round, its crown at `CHILD_HIP` so a
    child sat on it has her feet on the floor."""
    a = register(Asset("cushion"))
    body = a.part("body")
    r = CUSHION_DIAMETER * 0.5
    h = CHILD_HIP
    body.add(*revolve_lobed([(0.0, 0.0), (r * 0.86, 0.0), (r * 0.98, h * 0.12),
                             (r, h * 0.36), (r * 0.97, h * 0.62), (r * 0.86, h * 0.82),
                             (r * 0.62, h * 0.95), (r * 0.30, h * 0.995), (0.0, h)],
                            32, 8, 0.05))


# =============================================================================
# 6. Books
# =============================================================================

BOOK_SPINE_BULGE = 0.014


def build_books() -> None:
    """Six book blocks for an ``InstancedMesh`` with per-instance colour —
    three heights × two thicknesses, one node each, 28 triangles each.

    Thickness is along X (books stand side by side along a shelf), depth along
    Y with the **spine at −Y**, bulging 14 mm so a row of them reads as a row
    of spines rather than a row of bricks. Origin base-centre.
    """
    for h_name, height in BOOK_HEIGHTS:
        for t_name, thick in BOOK_THICKNESSES:
            a = register(Asset(f"book-{h_name}-{t_name}"))
            block = a.part()
            half_t, half_d, b = thick * 0.5, BOOK_DEPTH * 0.5, BOOK_SPINE_BULGE
            outline = [(half_t, half_d), (-half_t, half_d), (-half_t, -half_d + b)]
            for k in (1, 2, 3):
                outline.append((-half_t + thick * k / 4.0,
                                -half_d + b - b * math.sin(math.pi * k / 4.0)))
            outline.append((half_t, -half_d + b))
            block.add(*extrude_z(outline, 0.0, height))


PILE = (  # (width X, depth Y, thickness, yaw°, dx, dy) bottom to top
    (0.80, 0.58, 0.20, 0.0, 0.000, 0.000),
    (0.76, 0.55, 0.19, 7.0, 0.035, -0.020),
    (0.72, 0.53, 0.18, -5.0, 0.065, 0.015),
    (0.70, 0.51, 0.17, 10.0, 0.100, -0.010),
    (0.66, 0.49, 0.16, -4.0, 0.130, 0.020),
)


def build_book_pile() -> None:
    """Five fat books stacked flat, leaning a little further right with each
    one, spines to the front. The cat sleeps on the top one.

    One cover node per book (so each can be its own colour) and one shared
    cream page node. The height is the sum of the thicknesses —
    :data:`BOOK_PILE_HEIGHT` by construction, asserted by measurement.
    """
    assert abs(sum(t for _w, _d, t, *_ in PILE) - BOOK_PILE_HEIGHT) < 1e-9
    a = register(Asset("bookPile"))
    pages = a.part("pages")
    z = 0.0
    for i, (w, d, t, yaw, dx, dy) in enumerate(PILE, start=1):
        cover_part, page_part = lying_book(w, d, t)
        m = place(dx, dy, z, rz=yaw)
        a.part(f"cover{i}").add(cover_part.verts, cover_part.faces, matrix=m)
        pages.add(page_part.verts, page_part.faces, matrix=m)
        z += t
    a.normalise(centre_x=True)


READER_BOARD_T = 0.03
READER_SPINE_HALF = 0.03
READER_BOARD_LIFT = 0.006


def build_reader_cover() -> None:
    """The open reader's cover: two boards lying open and flat with a spine
    between them. **No pages** — those are code, because they bend.

    Origin at the spine's base: the Engineer hinges the pages on local x = 0,
    at the boards' top (the measured top of this node). The boards are lifted
    6 mm off the spine's base so the gutter dips between them and no board
    face shares a plane with a spine face.
    """
    a = register(Asset("reader-cover"))
    cover = a.part()
    z0 = READER_BOARD_LIFT
    for sx in (-1.0, 1.0):
        cover.at(*rounded_box(READER_BOARD_WIDTH, READER_BOARD_HEIGHT, READER_BOARD_T, 0.01, 2),
                 x=sx * (READER_SPINE_HALF + READER_BOARD_WIDTH * 0.5), z=z0 + READER_BOARD_T * 0.5)
    spine_top = z0 + READER_BOARD_T - 0.01
    cover.at(*rounded_box(READER_SPINE_HALF * 2.0 + 0.03, READER_BOARD_HEIGHT - 0.012, spine_top,
                          0.012, 2), z=spine_top * 0.5)


# =============================================================================
# 7. The owl librarian
# =============================================================================


def ellipsoid_front_y(c, r, x: float, z: float) -> float:
    """The −Y surface of an axis-aligned ellipsoid at (x, z): where to stand a
    button or a pair of glasses on it."""
    t = 1.0 - ((x - c[0]) / r[0]) ** 2 - ((z - c[2]) / r[2]) ** 2
    return c[1] - r[1] * math.sqrt(max(t, 0.0))


def build_owl() -> None:
    """The librarian: a round owl in a cardigan and big round glasses, holding
    a little book under one wing. Faces −Y. Head wider than body (§4).

    Pivots: ``-head`` turns at the neck (owls turn their heads — let her
    watch you walk past the desk); ``-wingL``/``-wingR`` at the shoulders for
    a shush or a wave; ``-heldBook`` shares ``-wingR``'s pivot, so turn the
    two together and the book stays in the wing.
    """
    a = register(Asset("owl"))
    feet = a.part("feet")
    body = a.part("body")
    bib = a.part("bib")
    buttons = a.part("buttons")
    head = a.part("head")
    beak = a.part("beak")
    glasses = a.part("glasses")
    wing_l = a.part("wingL")
    wing_r = a.part("wingR")
    held = a.part("heldBook")

    for sx in (-1.0, 1.0):
        fx = sx * 0.16
        for yaw in (-30.0, 0.0, 30.0):
            dx, dy = math.sin(deg(yaw)) * 0.07, -math.cos(deg(yaw)) * 0.07
            feet.add(*ellipsoid(0.05, 0.085, 0.045, 1), matrix=place(fx + dx, -0.05 + dy, 0.045, rz=yaw))
        feet.at(*ellipsoid(0.075, 0.07, 0.045, 1), x=fx, y=0.0, z=0.045)

    body_c, body_r = (0.0, 0.0, 0.50), (0.40, 0.36, 0.42)
    body.at(*ellipsoid(*body_r, 3), *body_c)
    bib.at(*ellipsoid(0.21, 0.10, 0.30, 2), y=-0.29, z=0.53)
    # Buttons down her left front (+X): her right wing has the book.
    for z in (0.70, 0.55, 0.40):
        x = 0.22
        buttons.at(*icosphere(0.04, 1), x=x, y=ellipsoid_front_y(body_c, body_r, x, z) - 0.01, z=z)

    head_c, head_r = (0.0, -0.02, 1.13), (0.52, 0.44, 0.40)
    head.at(*ellipsoid(*head_r, 3), *head_c)
    # Ear tufts, the left one tipped further out — the asymmetric feature.
    head.add(*ellipsoid(0.085, 0.07, 0.17, 2), matrix=place(0.30, 0.0, 1.46, ry=22.0))
    head.add(*ellipsoid(0.085, 0.07, 0.17, 2), matrix=place(-0.30, 0.0, 1.45, ry=-32.0))
    head.at(*ellipsoid(0.10, 0.08, 0.06, 1), x=0.07, y=0.04, z=1.52)
    a.mark("faceLo", head_c[0] - head_r[0], 0.0, head_c[2] - head_r[2])
    a.mark("faceHi", head_c[0] + head_r[0], 0.0, head_c[2] + head_r[2])

    beak.add(*ellipsoid(0.065, 0.11, 0.075, 2), matrix=place(0.0, -0.47, 1.02, rx=25.0))

    # Glasses: the eyes are painted where the rims are. The eye landmarks ARE
    # the rim centres, so the two cannot be placed apart.
    rim_r, rim_t, eye_x, eye_z = 0.15, 0.03, 0.19, 1.17
    rim_y = ellipsoid_front_y(head_c, head_r, eye_x, eye_z) - 0.045
    for sx, key in ((1.0, "eyeL"), (-1.0, "eyeR")):
        glasses.add(*torus(rim_r, rim_t, 16, 5),
                    matrix=place(sx * eye_x, rim_y, eye_z, rz=sx * 14.0) @ rot(x=90.0))
        a.mark(key, sx * eye_x, rim_y, eye_z)
        out_x = sx * (eye_x + rim_r * math.cos(deg(14.0)))
        out_y = rim_y + rim_r * math.sin(deg(14.0))
        glasses.add(*tapered_sweep([(out_x, out_y, eye_z + 0.02), (sx * 0.43, -0.25, eye_z + 0.04),
                                    (sx * 0.47, -0.10, eye_z + 0.05)], [0.022, 0.022, 0.022], 6))
    in_x = eye_x - rim_r * math.cos(deg(14.0))
    in_y = rim_y - rim_r * math.sin(deg(14.0))
    glasses.add(*tapered_sweep([(-in_x, in_y, eye_z + 0.01), (0.0, in_y - 0.03, eye_z + 0.045),
                                (in_x, in_y, eye_z + 0.01)], [0.022, 0.024, 0.022], 6))

    wing = ellipsoid(0.11, 0.24, 0.34, 2)
    wing_l.add(*wing, matrix=place(0.40, 0.02, 0.52, ry=-14.0))
    wing_r.add(*wing, matrix=place(-0.37, -0.14, 0.52, ry=14.0, rz=32.0))
    held.add(*rounded_box(0.30, 0.07, 0.36, 0.025, 1), matrix=place(-0.15, -0.41, 0.47, ry=10.0, rz=16.0))

    a.mark("neck", 0.0, -0.02, 0.86)
    a.mark("shoulderL", 0.34, 0.0, 0.80)
    a.mark("shoulderR", -0.34, 0.0, 0.80)
    a.pivots = {
        "owl-head": ("neck", "owl-body"),
        "owl-wingL": ("shoulderL", "owl-body"),
        "owl-wingR": ("shoulderR", "owl-body"),
        "owl-heldBook": ("shoulderR", "owl-wingR"),
    }
    a.faces = {"owl-head": ("faceLo", "faceHi", ["eyeL", "eyeR"])}
    a.normalise(height=OWL_HEIGHT)


# =============================================================================
# 8. The baby dragon and its nest of books
# =============================================================================


def build_dragon() -> None:
    """A round baby dragon curled up, tail wrapped round to the front, big
    head up and facing −Y, stubby wings, cream horns and back spines.

    Pivots: ``-head`` at the neck (it lifts its head when you come in) and
    ``-tail`` at its root (a sleepy flick). The face is in ``-head``'s UVs.
    """
    a = register(Asset("dragon"))
    body = a.part("body")
    belly = a.part("belly")
    head = a.part("head")
    horns = a.part("horns")
    wings = a.part("wings")
    tail = a.part("tail")

    body_c, body_r = (0.0, 0.04, 0.29), (0.34, 0.32, 0.29)
    body.at(*ellipsoid(*body_r, 3), *body_c)
    for sx in (-1.0, 1.0):
        body.at(*ellipsoid(0.085, 0.11, 0.06, 1), x=sx * 0.17, y=-0.25, z=0.06)
        body.at(*ellipsoid(0.12, 0.14, 0.09, 1), x=sx * 0.27, y=0.07, z=0.09)
    belly.at(*ellipsoid(0.22, 0.10, 0.22, 2), y=-0.23, z=0.29)

    head_c, head_r = (0.0, -0.16, 0.62), (0.27, 0.23, 0.22)
    head.at(*ellipsoid(*head_r, 3), *head_c)
    head.at(*ellipsoid(0.15, 0.11, 0.10, 2), y=-0.35, z=0.53)
    for sx in (-1.0, 1.0):
        head.at(*icosphere(0.025, 1), x=sx * 0.05, y=-0.42, z=0.61)
    a.mark("faceLo", head_c[0] - head_r[0], 0.0, head_c[2] - head_r[2])
    a.mark("faceHi", head_c[0] + head_r[0], 0.0, head_c[2] + head_r[2])
    for sx, key in ((1.0, "eyeL"), (-1.0, "eyeR")):
        a.mark(key, sx * 0.115, ellipsoid_front_y(head_c, head_r, sx * 0.115, 0.67), 0.67)

    for sx in (-1.0, 1.0):
        horns.add(*tapered_sweep([(sx * 0.12, -0.12, 0.78), (sx * 0.14, -0.07, 0.86),
                                  (sx * 0.16, 0.0, 0.90)], [0.05, 0.035, 0.02], 8))
        horns.at(*icosphere(0.022, 1), x=sx * 0.16, y=0.0, z=0.90)
    for phi in (40.0, 58.0, 76.0):
        n = Vector((0.0, math.sin(deg(phi)), math.cos(deg(phi))))
        p = Vector(body_c) + Vector((0.0, body_r[1] * n.y, body_r[2] * n.z)) * 0.97
        horns.add(*cone(0.055, 0.10, 8), matrix=Matrix.Translation(p) @ rot(x=-phi))
        horns.at(*icosphere(0.022, 1), *(p + n * 0.09))

    for sx in (-1.0, 1.0):
        m = place(sx * 0.24, 0.24, 0.50, rx=-20.0, rz=sx * 35.0)
        wings.add(*ellipsoid(0.20, 0.035, 0.13, 2), matrix=m @ Matrix.Translation((sx * 0.12, 0.0, 0.0)))
        for k in range(3):
            wings.add(*ellipsoid(0.065, 0.03, 0.06, 1),
                      matrix=m @ Matrix.Translation((sx * (0.03 + 0.09 * k), 0.0, -0.10)))
        wings.add(*tapered_sweep([(0.0, 0.0, 0.0), (sx * 0.17, 0.0, 0.10), (sx * 0.30, 0.0, 0.07)],
                                 [0.035, 0.03, 0.026], 6), matrix=m)

    path = [(0.10, 0.30, 0.12), (0.32, 0.34, 0.09), (0.52, 0.18, 0.075), (0.58, -0.08, 0.065),
            (0.50, -0.30, 0.06), (0.32, -0.44, 0.055), (0.14, -0.48, 0.05)]
    tail.add(*tapered_sweep(path, [0.12, 0.11, 0.095, 0.08, 0.065, 0.05, 0.04], 10))
    tip = Vector(path[-1])
    for dx in (-0.045, 0.045):
        tail.add(*ellipsoid(0.065, 0.055, 0.03, 1), matrix=place(tip.x - 0.06, tip.y + dx, tip.z, rz=-30.0))

    a.mark("neck", 0.0, -0.06, 0.48)
    a.mark("tailRoot", 0.10, 0.28, 0.12)
    a.pivots = {"dragon-head": ("neck", "dragon-body"), "dragon-tail": ("tailRoot", "dragon-body")}
    a.faces = {"dragon-head": ("faceLo", "faceHi", ["eyeL", "eyeR"])}
    a.normalise(height=DRAGON_HEIGHT, length=DRAGON_LENGTH)


def nest_ring(radius: float):
    """The nest's two staggered rings of books, as (layer, index, matrix,
    w, d, t) — one place the ring is described, used to build it and to fit
    it to its diameter."""
    books = []
    for layer, (count, t, z, spin, r_off) in enumerate(((8, 0.10, 0.0, 0.0, 0.0),
                                                         (7, 0.09, 0.10, 22.5, -0.03))):
        for k in range(count):
            theta = spin + k * 360.0 / count
            yaw = theta + 90.0 + (6.0 if (k + layer) % 2 else -6.0)
            r = radius + r_off
            m = place(r * math.cos(deg(theta)), r * math.sin(deg(theta)), z, rz=yaw)
            books.append((layer, k, m, 0.44, 0.30, t))
    return books


def build_nest() -> None:
    """A ring of books 1.6 m across round a soft pad — the dragon's hoard is
    books, not gold. Spines face outward, so from outside it is a ring of
    coloured spines. Covers in three colour groups, pages one cream node."""
    a = register(Asset("dragonNest"))
    pad = a.part("pad")
    covers = [a.part("coversA"), a.part("coversB"), a.part("coversC")]
    pages = a.part("pages")
    pad.add(*revolve_lobed([(0.0, 0.0), (0.56, 0.0), (0.60, 0.04), (0.58, 0.10),
                            (0.48, 0.135), (0.0, 0.145)], 28, 7, 0.06))
    for i, (_layer, _k, m, w, d, t) in enumerate(nest_ring(0.64)):
        # Square spines here: fifteen books, seen from above, in a ring.
        cover_part, page_part = lying_book(w, d, t, round_spine=False)
        covers[i % 3].add(cover_part.verts, cover_part.faces, matrix=m)
        pages.add(page_part.verts, page_part.faces, matrix=m)
    a.normalise(span=NEST_DIAMETER)


# =============================================================================
# 9. The library cat
# =============================================================================


def build_cat() -> None:
    """A cat curled asleep, long axis along X, face to −Y, tail wrapped round
    the front. Pivots: ``-head`` (it lifts its head when petted), ``-earL``/
    ``-earR`` at their bases (the twitch), ``-tail`` at its root."""
    a = register(Asset("cat"))
    body = a.part("body")
    head = a.part("head")
    tail = a.part("tail")
    ear_l = a.part("earL")
    ear_r = a.part("earR")

    body.at(*ellipsoid(0.25, 0.19, 0.15, 3), x=0.03, y=0.03, z=0.15)
    body.at(*ellipsoid(0.13, 0.14, 0.11, 2), x=0.15, y=0.05, z=0.15)
    for dx in (-0.06, 0.05):
        body.at(*ellipsoid(0.05, 0.07, 0.035, 1), x=-0.11 + dx, y=-0.17, z=0.035)

    head_c, head_r = (-0.14, -0.09, 0.17), (0.14, 0.12, 0.115)
    head.at(*ellipsoid(*head_r, 3), *head_c)
    for sx in (-1.0, 1.0):
        head.at(*ellipsoid(0.055, 0.045, 0.045, 1), x=head_c[0] + sx * 0.05, y=-0.19, z=0.125)
    a.mark("faceLo", head_c[0] - head_r[0], 0.0, head_c[2] - head_r[2])
    a.mark("faceHi", head_c[0] + head_r[0], 0.0, head_c[2] + head_r[2])
    for sx, key in ((1.0, "eyeL"), (-1.0, "eyeR")):
        x = head_c[0] + sx * 0.06
        a.mark(key, x, ellipsoid_front_y(head_c, head_r, x, 0.185), 0.185)

    ear = cone(0.06, 0.10, 8)
    # Each ear leans outward; the right one further — the asymmetric feature.
    for part, base, tilt, key in ((ear_l, (-0.07, -0.08, 0.245), 18.0, "earBaseL"),
                                  (ear_r, (-0.21, -0.09, 0.24), -26.0, "earBaseR")):
        m = Matrix.Translation(base) @ rot(y=tilt) @ scaled(1.0, 0.55, 1.0)
        part.add(*ear, matrix=m)
        part.add(*icosphere(0.016, 1), matrix=m @ Matrix.Translation((0.0, 0.0, 0.092)))
        a.mark(key, *base)

    path = [(0.24, 0.12, 0.07), (0.30, -0.04, 0.055), (0.22, -0.19, 0.045), (0.05, -0.23, 0.045),
            (-0.04, -0.215, 0.05)]
    tail.add(*tapered_sweep(path, [0.05, 0.048, 0.046, 0.043, 0.04], 8))
    tail.at(*icosphere(0.04, 1), *path[-1])

    a.mark("neck", -0.08, -0.04, 0.13)
    a.mark("tailRoot", 0.23, 0.12, 0.08)
    a.pivots = {
        "cat-head": ("neck", "cat-body"),
        "cat-earL": ("earBaseL", "cat-head"),
        "cat-earR": ("earBaseR", "cat-head"),
        "cat-tail": ("tailRoot", "cat-body"),
    }
    a.faces = {"cat-head": ("faceLo", "faceHi", ["eyeL", "eyeR"])}
    a.normalise(height=CAT_HEIGHT, length=CAT_LENGTH)


# =============================================================================
# Measuring what was built
# =============================================================================


def objects_of(asset: str):
    return [o for o in bpy.data.collections[asset].objects if o.type == "MESH"]


def world_verts(obj):
    mw = obj.matrix_world
    return [mw @ v.co for v in obj.data.vertices]


def bounds_of(objs):
    lo = Vector((1e9, 1e9, 1e9))
    hi = Vector((-1e9, -1e9, -1e9))
    for obj in objs:
        for w in world_verts(obj):
            for i in range(3):
                lo[i] = min(lo[i], w[i])
                hi[i] = max(hi[i], w[i])
    return lo, hi


def asset_bounds(asset: str):
    return bounds_of(objects_of(asset))


def node_bounds(node: str):
    return bounds_of([bpy.data.objects[node]])


def footprint(asset: str, band: float = 0.05):
    lo = [1e9, 1e9]
    hi = [-1e9, -1e9]
    for obj in objects_of(asset):
        for w in world_verts(obj):
            if w.z <= band:
                for i in range(2):
                    lo[i] = min(lo[i], w[i])
                    hi[i] = max(hi[i], w[i])
    assert lo[0] < 1e8, f"{asset} has nothing within {band} m of the floor"
    return lo, hi


def bvh_for(nodes):
    """A BVH over the named nodes in world space, and which node each polygon
    came from — so a ray can say *what* it hit, not just where."""
    verts, polys, owner = [], [], []
    for node in nodes:
        obj = bpy.data.objects[node]
        base = len(verts)
        verts.extend(world_verts(obj))
        for p in obj.data.polygons:
            polys.append([base + i for i in p.vertices])
            owner.append((node, p.index))
    return BVHTree.FromPolygons(verts, polys), owner


def up_faces_z(node: str):
    """The distinct heights of a node's horizontal, upward-facing faces."""
    obj = bpy.data.objects[node]
    mw = obj.matrix_world
    levels = set()
    for p in obj.data.polygons:
        n = (mw.to_3x3() @ p.normal).normalized()
        if n.z > 0.999:
            levels.add(round((mw @ p.center).z, 4))
    return sorted(levels)


def m_size(asset: str, axis: int) -> float:
    lo, hi = asset_bounds(asset)
    if axis == 2 and ORIGIN_FAMILY[asset] in ("FLOOR", "HINGE"):
        return hi.z
    return hi[axis] - lo[axis]


def m_length(asset: str) -> float:
    lo, hi = asset_bounds(asset)
    return max(hi.x - lo.x, hi.y - lo.y)


def m_triangles(asset: str) -> float:
    total = 0
    for obj in objects_of(asset):
        obj.data.calc_loop_triangles()
        total += len(obj.data.loop_triangles)
    return float(total)


MEASURED_NOTES: dict[str, list] = {}


def note(asset: str, text: str) -> None:
    MEASURED_NOTES.setdefault(asset, []).append(text)


def m_step_rises():
    levels = [z for z in up_faces_z("shell-steps") if z > 0.01]
    rises = [b - a for a, b in zip([0.0] + levels, levels)]
    return levels, rises


def m_columns():
    """Six clusters of shaft vertices: count, widest shaft diameter, centres.

    Only the band of the shaft a ray from the side would meet between base
    and capital (1.0–5.5 m) is measured, so the diameter is the shaft's and
    not the wider base or abacus."""
    pts = [w for w in world_verts(bpy.data.objects["shell-columns"]) if 1.0 <= w.z <= 5.5]
    pts.sort(key=lambda w: w.x)
    clusters = [[pts[0]]]
    for w in pts[1:]:
        if w.x - clusters[-1][-1].x > 0.5:
            clusters.append([])
        clusters[-1].append(w)
    centres, widest = [], 0.0
    for c in clusters:
        cx = (min(w.x for w in c) + max(w.x for w in c)) * 0.5
        cy = (min(w.y for w in c) + max(w.y for w in c)) * 0.5
        centres.append((cx, cy))
        widest = max(widest, 2.0 * max(math.hypot(w.x - cx, w.y - cy) for w in c))
    base = [w for w in world_verts(bpy.data.objects["shell-columns"]) if w.z <= PLINTH_TOP + 0.4]
    base_r = 0.0
    for w in base:
        cx, cy = min(centres, key=lambda c: abs(c[0] - w.x))
        base_r = max(base_r, math.hypot(w.x - cx, w.y - cy))
    return len(clusters), widest, centres, base_r


def m_door():
    """The door opening as the walls actually have it, found with rays.

    Rays are cast from in front of the building straight at the facade; one
    that reaches the back of the door recess is *in* the opening. Width is
    marched across at knee height and height up the middle, 1 mm at a time.
    Only ``shell-walls`` is in the BVH, so the columns and the door leaves
    themselves cannot shadow the answer."""
    bvh, _ = bvh_for(["shell-walls"])
    deep_y = WALL_FRONT_Y + DOOR_RECESS * 0.5

    def deep(x: float, z: float) -> bool:
        hit = bvh.ray_cast(Vector((x, FRONT_Y - 2.0, z)), Vector((0.0, 1.0, 0.0)))
        return hit[0] is not None and hit[0].y > deep_y

    z = PLINTH_TOP + 1.0
    assert deep(0.0, z), "a ray at the middle of the door does not reach the recess"
    assert not deep(DOOR_WIDTH, z), "control: a ray at the wall beside the door reaches the recess"
    step = 0.001
    left = 0.0
    while deep(left - step, z):
        left -= step
    right = 0.0
    while deep(right + step, z):
        right += step
    top = PLINTH_TOP + 0.05
    while deep(0.0, top + step):
        top += step
    return right - left + step, top + step - PLINTH_TOP


def m_shelf_rows(asset: str):
    """Every standing surface and the clear height above it, by ray.

    Rays go straight up from just above each board's top, across the whole
    span and depth, and the shortest one is that row's clear height. The
    control: a ray from the floor in front of the bookcase must hit nothing."""
    levels = up_faces_z(f"{asset}-shelves")
    bvh, _ = bvh_for([f"{asset}-carcass", f"{asset}-shelves"])
    lo, hi = asset_bounds(asset)
    cx, cy = (lo.x + hi.x) * 0.5, (lo.y + hi.y) * 0.5
    clears = []
    for z in levels:
        shortest = math.inf
        for i in range(21):
            x = cx - 1.70 + 3.40 * i / 20.0
            for dy in (-0.18, -0.05, 0.10):
                hit = bvh.ray_cast(Vector((x, cy + dy, z + 0.001)), Vector((0.0, 0.0, 1.0)))
                shortest = min(shortest, hit[3] + 0.001 if hit[0] is not None else math.inf)
        clears.append(shortest)
    control = bvh.ray_cast(Vector((cx, lo.y - 0.5, 0.01)), Vector((0.0, 0.0, 1.0)))
    assert control[0] is None, "control: a ray up from the floor in front of the shelf hit it"
    return levels, clears


def m_secret_vs_shelf() -> float:
    def key(asset, shift):
        pts = []
        for obj in sorted(objects_of(asset), key=lambda o: o.name.split("-", 1)[1]):
            pts += [tuple(round(c, 4) for c in (w + shift)) for w in world_verts(obj)]
        return sorted(pts)
    shelf = key("shelf", Vector((SHELF_LENGTH * 0.5, SHELF_DEPTH * 0.5, 0.0)))
    secret = key("secretShelf", Vector())
    assert len(shelf) == len(secret), f"shelf {len(shelf)} verts, secret shelf {len(secret)}"
    return max(max(abs(a[i] - b[i]) for i in range(3)) for a, b in zip(shelf, secret))


def m_flat_top(node: str, area: float) -> float:
    obj = bpy.data.objects[node]
    _, hi = node_bounds(node)
    flat = sum(p.area for p in obj.data.polygons
               if p.normal.z > 0.999 and abs((obj.matrix_world @ p.center).z - hi.z) < 1e-4)
    return flat / area


def islands(node: str):
    """The connected pieces of a node, each as its list of world vertices."""
    obj = bpy.data.objects[node]
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    bm.verts.ensure_lookup_table()
    seen = set()
    pieces = []
    for start in bm.verts:
        if start.index in seen:
            continue
        stack, piece = [start], []
        seen.add(start.index)
        while stack:
            v = stack.pop()
            piece.append(obj.matrix_world @ v.co)
            for e in v.link_edges:
                o = e.other_vert(v)
                if o.index not in seen:
                    seen.add(o.index)
                    stack.append(o)
        pieces.append(piece)
    bm.free()
    return pieces


def m_reader_board(axis: int) -> float:
    """One board's extent, measured on the board itself: the piece of the
    node lying wholly at x > 0 (the right-hand board; the spine straddles 0)."""
    boards = [p for p in islands("reader-cover") if min(w.x for w in p) > 0.0]
    assert len(boards) == 1, f"expected one right-hand board, found {len(boards)}"
    return max(w[axis] for w in boards[0]) - min(w[axis] for w in boards[0])


def m_head_over_body(head: str, body: str) -> float:
    hlo, hhi = node_bounds(head)
    blo, bhi = node_bounds(body)
    return (hhi.x - hlo.x) / (bhi.x - blo.x)


MEASURE = {
    ("shell", "plinthTop"): lambda: node_bounds("shell-plinth")[1].z,
    ("shell", "stepRise"): lambda: max(m_step_rises()[1]),
    ("shell", "stepCount"): lambda: float(len(m_step_rises()[0])),
    ("shell", "columnCount"): lambda: float(m_columns()[0]),
    ("shell", "columnDiameter"): lambda: m_columns()[1],
    ("shell", "columnTop"): lambda: node_bounds("shell-columns")[1].z,
    ("shell", "doorWidth"): lambda: m_door()[0],
    ("shell", "doorHeight"): lambda: m_door()[1],
    ("shelf", "rows"): lambda: float(len(m_shelf_rows("shelf")[0])),
    ("shelf", "rowClear"): lambda: min(m_shelf_rows("shelf")[1]),
    ("secretShelf", "hingeOffset"): lambda: asset_bounds("secretShelf")[0].length,
    ("secretShelf", "shapeVsShelf"): m_secret_vs_shelf,
    ("desk", "flatTop"): lambda: m_flat_top("desk-top", DESK_LENGTH * DESK_DEPTH),
    ("armchair", "seatTop"): lambda: node_bounds("armchair-seat")[1].z,
    ("reader-cover", "boardWidth"): lambda: m_reader_board(0),
    ("reader-cover", "boardHeight"): lambda: m_reader_board(1),
    ("owl", "headOverBody"): lambda: m_head_over_body("owl-head", "owl-body"),
    ("dragon", "length"): lambda: m_length("dragon"),
    ("dragonNest", "diameter"): lambda: m_length("dragonNest"),
    ("cat", "length"): lambda: m_length("cat"),
}
for _asset, _figures in CONTRACT.items():
    for _fig, _axis in (("width", 0), ("depth", 1), ("height", 2)):
        if _fig in _figures:
            MEASURE[(_asset, _fig)] = (lambda a=_asset, ax=_axis: m_size(a, ax))
    if "triangles" in _figures:
        MEASURE[(_asset, "triangles")] = (lambda a=_asset: m_triangles(a))


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
                f"{asset}.{fig}: the contract says {op} {want:.4f} and the geometry "
                f"measures {got:.4f}. Fix the shape, or change CONTRACT and tell the "
                "Engineer on #716 — never let the two differ."
            )
            cells.append(f"{fig} {got:.3f} ({op}{want:.3f})")
        rows.append(f"  {asset:<16} " + ", ".join(cells))
    return "\n".join(rows)


def check_origins() -> str:
    """Every asset's origin is where its family says, from the vertices."""
    rows = []
    for asset, family in ORIGIN_FAMILY.items():
        lo, hi = asset_bounds(asset)
        assert abs(lo.z) < 1e-4, f"{asset}: lowest vertex at z {lo.z:+.5f}, not on the floor"
        if family == "FLOOR":
            assert abs(lo.x + hi.x) < 0.02, f"{asset} is off-centre on X by {(lo.x + hi.x) / 2:+.4f}"
            flo, fhi = footprint(asset)
            assert flo[0] <= 0.0 <= fhi[0] and flo[1] <= 0.0 <= fhi[1], (
                f"{asset}'s origin is outside its own footprint {flo}..{fhi}"
            )
        elif family == "HINGE":
            assert abs(lo.x) < 1e-4 and abs(lo.y) < 1e-4, (
                f"{asset} is a HINGE asset and its front-left corner is at "
                f"({lo.x:+.5f}, {lo.y:+.5f}), not on its origin"
            )
        rows.append(f"  {asset:<16} {family:<5} x {lo.x:+.3f}..{hi.x:+.3f}  "
                    f"y {lo.y:+.3f}..{hi.y:+.3f}  z {lo.z:+.3f}..{hi.z:+.3f}")
    return "\n".join(rows)


def check_nodes() -> None:
    """Names, transforms and pivots — the things a typo turns into a bug."""
    for obj in bpy.data.objects:
        if obj.type != "MESH":
            continue
        coll = obj.users_collection[0].name
        assert "." not in obj.name, f"{obj.name}: GLTFLoader strips full stops"
        assert obj.name == coll or obj.name.startswith(coll + "-"), (
            f"{obj.name} is in collection {coll} but not named for it"
        )
        loc, quat, scale = obj.matrix_world.decompose()
        assert abs(quat.angle) < 1e-9 and (scale - Vector((1, 1, 1))).length < 1e-9, obj.name
        pivoted = any(obj.name in a.pivots for a in ASSETS.values())
        assert pivoted or loc.length < 1e-9, f"{obj.name} carries a translation and is no pivot"


def check_pivots() -> str:
    """Each pivot is a real joint: inside its own part and inside the part it
    turns against (a neck inside both head and body)."""
    rows = []
    for asset in ASSETS.values():
        for node, (key, parent) in asset.pivots.items():
            p = asset.marks[key]
            obj = bpy.data.objects[node]
            assert (Vector(obj.location) - p).length < 1e-9
            # A node that *rides* its parent (the held book on the wing) shares
            # the parent's pivot rather than having a joint of its own.
            rides = asset.pivots.get(parent, (None,))[0] == key
            for other in ((parent,) if rides else (node, parent)):
                lo, hi = node_bounds(other)
                inside = all(lo[i] - 0.02 <= p[i] <= hi[i] + 0.02 for i in range(3))
                assert inside, f"{node}'s pivot {tuple(round(c, 3) for c in p)} is outside {other}"
            g = (p.x, p.z, -p.y)
            rows.append(f"  {node:<16} at {key:<10} blender ({p.x:+.3f}, {p.y:+.3f}, {p.z:+.3f})"
                        f"  game ({g[0]:+.3f}, {g[1]:+.3f}, {g[2]:+.3f})  "
                        + (f"rides {parent}" if rides else f"turns against {parent}"))
    return "\n".join(rows)


def check_faces() -> str:
    """Cast a ray at each painted eye from in front, the way the camera sees
    it, through every node of the creature: it must land on the head (not a
    glasses rim, a beak, a paw) on a front-mapped polygon, and the UV stored
    there must be the anchor's. ART-AGENT-NOTES §6: an inside-out or occluded
    face is invisible to arithmetic and visible to a ray."""
    rows = []
    for asset in ASSETS.values():
        for node, (lo_key, hi_key, eyes) in asset.faces.items():
            nodes = list(asset.parts)
            bvh, owner = bvh_for(nodes)
            obj = bpy.data.objects[node]
            mesh = obj.data
            layer = mesh.uv_layers["UVMap"]
            lo, hi = asset.marks[lo_key], asset.marks[hi_key]
            for key in eyes:
                e = asset.marks[key]
                hit = bvh.ray_cast(Vector((e.x, -10.0, e.z)), Vector((0.0, 1.0, 0.0)))
                assert hit[0] is not None, f"{node}: a ray at {key} hits nothing"
                hit_node, poly_index = owner[hit[2]]
                assert hit_node == node, f"{node}: the ray at {key} hits {hit_node} first"
                poly = mesh.polygons[poly_index]
                assert poly.normal.y < -0.05, f"{node}: {key} lands on a back-facing polygon"
                local = obj.matrix_world.inverted() @ hit[0]
                corners = [(mesh.vertices[mesh.loops[li].vertex_index].co,
                            layer.data[li].uv) for li in poly.loop_indices]
                uv = None
                for i in range(1, len(corners) - 1):
                    (a, ua), (b, ub), (c, uc) = corners[0], corners[i], corners[i + 1]
                    if mgeom.intersect_point_tri(local, a, b, c) is not None:
                        uv = mgeom.barycentric_transform(local, a, b, c, ua.to_3d(), ub.to_3d(),
                                                         uc.to_3d())
                        break
                assert uv is not None, f"{node}: could not locate {key}'s hit inside its polygon"
                want = asset.face_uv(node, key)
                assert abs(uv.x - want[0]) < 0.01 and abs(uv.y - want[1]) < 0.01, (
                    f"{node}: {key} reads uv ({uv.x:.3f}, {uv.y:.3f}) at the hit and the anchor "
                    f"says ({want[0]:.3f}, {want[1]:.3f})"
                )
                assert 0.05 < want[0] < 0.95 and 0.05 < want[1] < 0.95, f"{node}: {key} off the canvas"
            w, h = hi.x - lo.x, hi.z - lo.z
            eye_txt = ", ".join(
                f"{k} ({asset.face_uv(node, k)[0]:.3f}, {asset.face_uv(node, k)[1]:.3f})" for k in eyes)
            rows.append(f"  {node:<12} window {w:.3f} × {h:.3f} m; {eye_txt}")
            if node == "owl-head":
                rows.append(f"               rim inner radius {0.15 - 0.03:.3f} m = "
                            f"{(0.15 - 0.03) * asset.scale[0] / w:.3f} of the canvas width, "
                            f"{(0.15 - 0.03) * asset.scale[2] / h:.3f} of its height — paint "
                            "the eyes inside that")
    return "\n".join(rows)


def check_winding() -> int:
    """Every closed piece of every node has positive signed volume, i.e. its
    faces point outward. Inside-out geometry is *invisible* in the game
    (``FrontSide`` culls it) rather than obviously broken — ART-AGENT-NOTES
    §4, a fortnight lost to it once."""
    pieces = 0
    for obj in bpy.data.objects:
        if obj.type != "MESH":
            continue
        bm = bmesh.new()
        bm.from_mesh(obj.data)
        bm.faces.ensure_lookup_table()
        seen = set()
        for start in bm.faces:
            if start.index in seen:
                continue
            stack, island = [start], []
            seen.add(start.index)
            while stack:
                f = stack.pop()
                island.append(f)
                for e in f.edges:
                    for g in e.link_faces:
                        if g.index not in seen:
                            seen.add(g.index)
                            stack.append(g)
            vol = 0.0
            for f in island:
                vs = [v.co for v in f.verts]
                for i in range(1, len(vs) - 1):
                    vol += vs[0].dot(vs[i].cross(vs[i + 1])) / 6.0
            assert vol > 0.0, f"{obj.name} has an inside-out piece (signed volume {vol:.6f})"
            pieces += 1
        bm.free()
    return pieces


def check_scales() -> str:
    rows = []
    for asset in ASSETS.values():
        if asset.scale == (1.0, 1.0, 1.0):
            continue
        assert all(abs(s - 1.0) < 0.08 for s in asset.scale), (
            f"{asset.name} had to be stretched by {asset.scale} to meet its contract — the design "
            "is too far off its brief to be fixed by stretching; rework the shape"
        )
        rows.append(f"  {asset.name:<12} stretched x {asset.scale[0]:.3f}, y {asset.scale[1]:.3f}, "
                    f"z {asset.scale[2]:.3f} to its contract")
    return "\n".join(rows)


def report_extras() -> str:
    """Figures the Engineer will want that are measurements, not contract
    lines: printed so they are never typed from memory."""
    count, diameter, centres, base_r = m_columns()
    levels, clears = m_shelf_rows("shelf")
    reachable = [i + 1 for i, z in enumerate(levels) if z <= CHILD_REACH]
    _, pile_top = asset_bounds("bookPile")
    _, pad_top = node_bounds("dragonNest-pad")
    _, cover_top = node_bounds("reader-cover")
    lines = [
        "  shell column centres (blender x, y): "
        + ", ".join(f"({x:+.2f}, {y:+.2f})" for x, y in centres),
        f"  shell column base radius (the round plinth a child's feet meet): {base_r:.3f} m",
        "  shelf row surfaces z: " + ", ".join(f"{z:.3f}" for z in levels)
        + f"; clear heights: " + ", ".join(f"{c:.3f}" for c in clears),
        f"  rows a child can reach (surface ≤ KID_REACH_HEIGHT {CHILD_REACH:.2f} m): {reachable}",
        f"  book pile top (where the cat lies): {pile_top.z:.3f} m",
        f"  dragon nest pad top (where the dragon lies): {pad_top.z:.3f} m",
        f"  reader page hinge: local x = 0, z = {cover_top.z:.3f} m (the boards' top)",
    ]
    return "\n".join(lines)


BUILDERS = (
    build_shell,
    build_shelf,
    build_secret_shelf,
    build_desk,
    build_reading_lamp,
    build_floor_lamp,
    build_armchair,
    build_cushion,
    build_books,
    build_book_pile,
    build_reader_cover,
    build_owl,
    build_dragon,
    build_nest,
    build_cat,
)

TRIANGLE_BUDGET = 30000


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

    print("\nlibrary_build")
    print(summarise())
    check_nodes()
    print(f"\n  winding: {check_winding()} closed pieces, every one outward-facing")
    print("\n  origins, measured off the emitted vertices:")
    print(check_origins())
    print("\n  pivots (node origin = joint):")
    print(check_pivots())
    print("\n  painted faces (rays at each eye, through every node of the creature):")
    print(check_faces())
    print("\n  stretches applied by normalise():")
    print(check_scales())
    print("\n  CONTRACT, measured:")
    print(check_contract())
    print("\n  measured figures for the Engineer:")
    print(report_extras())
    print(f"\n  read from the game: KID_HEIGHT {CHILD_HEIGHT}, TALLEST_CHILD_HEIGHT "
          f"{TALLEST_CHILD}, KID_HIP_HEIGHT {CHILD_HIP}, KID_REACH_HEIGHT {CHILD_REACH} "
          f"({KID_MODULE}); COUNTER_TOP_Y {COUNTER_TOP} ({COUNTER_MODULE})")
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
