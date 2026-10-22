"""Builds the story-props kit — every model the six chapter books' pictures
need that the game does not have — and saves ``art/blend/story_props.blend``.

    blender --background --factory-startup --python-exit-code 1 \
        --python art/blend/story_props_build.py

Jim, 22 October 2026: *"model in Blender as much as is needed, in preference
to coding geometric primitives to create items in the world."* The six chapter
books (``docs/library-build/chapter-books/final.json`` on
``feat/library-714-books2``) name, page by page, the props their pictures are
drawn with; the ones the park has no model for — and the one picture-book
primitive the chapter books reuse (the closed storybook) — are built here.
HANDOFF-art-story-props.md lists every asset with the pages it serves.

Like ``library_build.py``, **this script is the authoring source** and
``story_props.blend`` is a generated artefact. ``story_props_export.py`` writes
the ``.glb`` and ``pnpm run blend:story-props`` runs build → export → pack.

## The seam with the picture engineers

* **This file owns shape and nothing else**: geometry, the face UVs on the two
  nodes that carry a painted face (Nimbus the storm cloud, the rubber duck),
  and one named node per distinctly-coloured part. The ``.glb`` carries **no
  colour and no material**.
* **The loader owns the TypeScript** (``src/world/library/reader/storyProps.ts``):
  colours, outlines, the faces' paint, and every factory a page calls. It
  measures this file's figures off the built mesh with ``visibleBounds()`` and
  never types them.
* Every number in :data:`CONTRACT` is **asserted against the measured
  geometry** at the end of this run.

## What is read, and what is the kit's own

A prop's size is the kit's own — these are picture props, drawn beside the
park's creatures and framed by the reader's camera — **except where the game
already owns the figure**: the bench's seat is ``KID_HIP_HEIGHT`` (the one seat
height a kneeless rig's feet reach the floor from; the library's rule), the
battlement's merlons are ``CASTLE_MERLON_HEIGHT`` (the castle's own), and the
rainbow has as many bands as ``ART.rainbow`` has colours. All read with
``ts_const`` / :func:`ts_array_len`; nothing typed twice.

## Conventions (ART_DIRECTION §7; library_build.py's, imported)

* 1 Blender unit = 1 metre; **Blender −Y is the game's +Z** (fronts face −Y).
* Hyphenated node names, ``<asset>-<part>`` or ``<asset>`` for a one-node asset.
* Origin at the **base**, centred on X, every node at an identity transform.
  No pivots: nothing turns in a still picture.
* **Faces in the node's own UVs**, exactly as the owl's: :class:`library_build.Asset`
  (imported, not copied) maps the front polygons over the node's own bounds,
  ``v`` pre-inverted, back faces parked at (0.02, 0.02), and ships the eye
  anchors and window size as node extras — ``pack:story-props`` copies them
  into ``STORY_FACES``. Paint through a default ``CanvasTexture`` /
  ``planarUvCanvasTexture``, never ``glbCanvasTexture``. Each faced node is
  built **round** (equal x and z radii) so its square canvas lands undistorted.
* No randomness. Every "scatter" below is a fixed table.
"""

import math
import os
import re
import sys
import traceback

import bmesh
import bpy
from mathutils import Matrix, Vector

sys.dont_write_bytecode = True
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import library_build as lb  # noqa: E402  (import-safe: everything is behind main())
from blendkit import (  # noqa: E402
    REPO,
    TAU,
    bm_lists,
    box,
    collection,  # noqa: F401  (re-exported for the render script's tooling)
    ellipsoid,
    flat_top_box,
    icosphere,
    reset_scene,
    revolve,
    rounded_box,
    summarise,
    sweep_path,
    total_triangles,
    ts_const,
    tube,
)
from library_build import (  # noqa: E402
    Asset,
    band_prism,
    deg,
    ellipsoid_front_y,
    lying_book,
    place,
    register,
    revolve_lobed,
    rot,
    tapered_sweep,
    torus,
)

BLEND = os.path.join(REPO, "art", "blend", "story_props.blend")

# =============================================================================
# The game's numbers. Read, never typed.
# =============================================================================

KID_MODULE = "src/art/models/kid.ts"
CHILD_HEIGHT = ts_const(KID_MODULE, "KID_HEIGHT")
CHILD_HIP = ts_const(KID_MODULE, "KID_HIP_HEIGHT")
MERLON_HEIGHT = ts_const("src/world/building/layout.ts", "CASTLE_MERLON_HEIGHT")
PALETTE_ART = "src/art/style/artPalette.ts"


def ts_array_len(relative_path: str, name: str) -> int:
    """How many entries ``NAME: [ ... ],`` has in one of the game's modules —
    the rainbow's band count is ``ART.rainbow``'s length, nobody's to retype.
    Same blunt-and-loud reasoning as :func:`blendkit.ts_const`."""
    with open(os.path.join(REPO, relative_path), encoding="utf-8") as handle:
        source = handle.read()
    found = re.findall(rf"^\s{{2}}{name}: \[([^\]]*)\],", source, flags=re.MULTILINE)
    assert len(found) == 1, f"{relative_path} must declare `{name}: [...]` exactly once, found {len(found)}"
    return len([item for item in found[0].split(",") if item.strip()])


RAINBOW_BANDS = ts_array_len(PALETTE_ART, "rainbow")

# =============================================================================
# Shapes this file needs that blendkit and library_build do not have
# =============================================================================


def soft(verts, faces, radius: float, segments: int = 1):
    """Any closed primitive with its edges bevelled — the chunky-toy edge
    (ART_DIRECTION §1) for a shape ``rounded_box`` cannot make: a sandwich
    wedge, a star plate."""
    bm = bmesh.new()
    vs = [bm.verts.new(v) for v in verts]
    for face in faces:
        bm.faces.new([vs[i] for i in face])
    bm.verts.index_update()
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bmesh.ops.bevel(bm, geom=list(bm.verts) + list(bm.edges), offset=radius, segments=segments,
                    profile=0.5, affect="EDGES")
    return bm_lists(bm)


def tapered_ellipsoid(rx: float, ry: float, rz: float, axis: int, taper: float, subdivisions: int = 2):
    """An ellipsoid narrowed towards its +axis end — a feather, a petal, a
    leaf: the silhouette points without any edge being sharp (``soft_ear``'s
    trick along a chosen axis)."""
    verts, faces = ellipsoid(rx, ry, rz, subdivisions)
    r = (rx, ry, rz)[axis]
    out = []
    for v in verts:
        k = 1.0 - taper * max(0.0, v[axis] / r)
        out.append(tuple(c * k if i != axis else c for i, c in enumerate(v)))
    return out, faces


def mirror_x(verts, faces):
    """The same solid reflected through x = 0, re-wound so it stays outward."""
    return [(-x, y, z) for x, y, z in verts], [tuple(reversed(f)) for f in faces]


def ring_prism(outer_xz, inner_xz, y0: float, y1: float):
    """A flat frame between two outlines with the same vertex count, in the
    XZ plane, extruded from y0 to y1 — the wheel's empty star bracket. Quads
    only, so no triangulator has to guess at a shape with a hole in it."""
    n = len(outer_xz)
    assert n == len(inner_xz)
    verts = []
    for y in (y0, y1):
        verts += [(x, y, z) for x, z in outer_xz]
        verts += [(x, y, z) for x, z in inner_xz]
    o0, i0, o1, i1 = 0, n, 2 * n, 3 * n
    faces = []
    for i in range(n):
        j = (i + 1) % n
        faces.append((o0 + i, i0 + i, i0 + j, o0 + j))   # front (−Y)
        faces.append((o1 + j, i1 + j, i1 + i, o1 + i))   # back
        faces.append((o0 + j, o1 + j, o1 + i, o0 + i))   # outer wall
        faces.append((i0 + i, i1 + i, i1 + j, i0 + j))   # inner wall
    return verts, faces


def star_outline(outer: float, inner: float, points: int = 5):
    pts = []
    for k in range(points * 2):
        r = outer if k % 2 == 0 else inner
        a = math.pi * 0.5 + math.pi * k / points
        pts.append((r * math.cos(a), r * math.sin(a)))
    return pts


def prism_xy(outline_xy, z0: float, z1: float):
    """A convex outline in XY standing from z0 to z1, each cap **one** face —
    so :func:`soft` bevels only real edges (a fan-capped cap, as `extrude_z`
    makes, has coplanar interior edges that bevel into slivers)."""
    n = len(outline_xy)
    verts = [(x, y, z0) for x, y in outline_xy] + [(x, y, z1) for x, y in outline_xy]
    faces = [tuple(range(n - 1, -1, -1)), tuple(range(n, 2 * n))]
    for i in range(n):
        j = (i + 1) % n
        faces.append((i, j, n + j, n + i))
    return verts, faces


def wedge(leg: float, thick: float, z0: float, grow: float = 0.0):
    """A right-isosceles triangular slab in XY standing from ``z0`` — half a
    square sandwich cut corner to corner — about the square's centre, so a
    second wedge turned 180° makes the whole square. ``grow`` pushes the
    outline out: the filling peeping past the bread."""
    h = leg * 0.5
    g = grow
    outline = [(-h - g, -h - g), (h + g * 2.4, -h - g), (-h - g, h + g * 2.4)]
    return prism_xy(outline, z0, z0 + thick)


def islands_count(node: str) -> int:
    return len(lb.islands(node))


def flat_disc(radius: float, thick: float, segments: int = 24, lobes: int = 0, amp: float = 0.0):
    """A soft-edged flat disc (a footprint, a puddle, a stone's start)."""
    profile = [(0.0, 0.0), (radius * 0.9, 0.0), (radius, thick * 0.5), (radius * 0.9, thick), (0.0, thick)]
    if lobes:
        return revolve_lobed(profile, segments, lobes, amp)
    return revolve(profile, segments)


# =============================================================================
# THE CONTRACT — asserted against the emitted geometry (library_build's shape)
# =============================================================================

TOL = 0.005
EXACT, AT_MOST, AT_LEAST = lb.EXACT, lb.AT_MOST, lb.AT_LEAST

CLOUD_HEIGHT = 1.20
FLUFFY_HEIGHT = 0.80
ARCH_INNER_RADIUS = 2.60
ARCH_BAND = 0.22
ARCH_LEG = 0.30
QUEUE_POST_HEIGHT = 1.00
DUCK_HEIGHT = 0.42
BENCH_LENGTH = 1.60
GLASS_HANDLE, GLASS_RIM_R, GLASS_RIM_T = 0.24, 0.17, 0.03
GLASS_HEIGHT = GLASS_HANDLE + 2.0 * GLASS_RIM_R + GLASS_RIM_T
PANCAKE_LENGTH = 0.24
GIANT_PRINT_WIDTH = 0.60
SPOON_LENGTH = 0.33
STONE_WIDTH = 0.40
STICK_HEIGHT = 0.46
OPEN_BOOK_WIDTH = 0.84
LOOSE_PAGE_WIDTH = 0.36
# The closed storybook, as `createStoryBook` (readerAssets.ts) draws it today:
# this kit becomes the owner once the factory delegates (handoff, Decision 5).
CLOSED_BOOK_WIDTH, CLOSED_BOOK_DEPTH, CLOSED_BOOK_THICK = 0.42, 0.32, 0.10
FLOWER_HEIGHT = 0.80
PETAL_COUNT = 6
PETAL_LENGTH = 0.12
BLANKET_WIDTH, BLANKET_DEPTH = 1.80, 1.40
BLANKET_CHECK = 0.20
SANDWICH_LEG = 0.34
SANDWICH_THICK = 0.07
TOWER_COUNT = 16
HEAP_COUNT = 41          # Nimbus's forty-one (Biscuit and the Storm, p10)
TART_WIDTH = 0.22
CAKE_HEIGHT = 0.47
PUDDLE_WIDTH = 0.70
WINDOW_WIDTH, WINDOW_HEIGHT = 1.30, 1.50
UMBRELLA_HEIGHT = 1.15
BATTLEMENT_LENGTH = 2.40
BATTLEMENT_PARAPET = 0.50
WHEEL_RADIUS = 2.00
WHEEL_HUB_Z = 2.70
WHEEL_CARS = 8
WHEEL_LIGHTS = 16
WHEEL_LIGHT_R = 0.075
FEATHER_LENGTH = 0.32
NEST_WIDTH = 1.40      # the bowl; the twigs poke past it
NEST_TWIGS = 10
TREAT_WIDTH = 0.30

CONTRACT = {
    "storm-cloud": {"height": (EXACT, CLOUD_HEIGHT), "width": (AT_MOST, 2.6), "depth": (AT_MOST, 1.5),
                    # The face puff is the cloud's biggest, so the face reads first (§4).
                    "faceOverPuff": (AT_LEAST, 1.05)},
    "fluffy-cloud": {"height": (EXACT, FLUFFY_HEIGHT), "width": (AT_MOST, 3.0), "depth": (AT_MOST, 1.4)},
    "rainbow-arch": {"bands": (EXACT, float(RAINBOW_BANDS)),
                     "height": (EXACT, ARCH_LEG + ARCH_INNER_RADIUS + (RAINBOW_BANDS - 1) * ARCH_BAND + ARCH_BAND * 0.5),
                     "everyFootOnGround": (AT_MOST, 0.001), "depth": (AT_MOST, ARCH_BAND + 0.01)},
    "queue-posts": {"height": (EXACT, QUEUE_POST_HEIGHT + 0.075), "width": (AT_MOST, 1.9), "depth": (AT_MOST, 0.5),
                    "ropeSag": (AT_LEAST, 0.2)},
    "rubber-duck": {"height": (EXACT, DUCK_HEIGHT), "width": (AT_MOST, 0.4), "depth": (AT_MOST, 0.7),
                    "headOverBody": (AT_LEAST, 0.7)},
    "park-bench": {"width": (EXACT, BENCH_LENGTH), "seatTop": (EXACT, CHILD_HIP), "height": (EXACT, CHILD_HIP),
                   "depth": (AT_MOST, 0.6), "legs": (EXACT, 2.0)},
    "magnifying-glass": {"height": (EXACT, GLASS_HEIGHT), "width": (AT_MOST, 0.45), "depth": (AT_MOST, 0.15)},
    "pancake-footprint": {"depth": (EXACT, PANCAKE_LENGTH), "height": (AT_MOST, 0.03), "width": (AT_MOST, 0.2),
                          "toes": (EXACT, 3.0)},
    "giant-footprint": {"width": (EXACT, GIANT_PRINT_WIDTH), "height": (AT_MOST, 0.04), "depth": (AT_MOST, 0.75),
                        "toes": (EXACT, 4.0)},
    "spoon": {"depth": (EXACT, SPOON_LENGTH), "height": (AT_MOST, 0.06), "width": (AT_MOST, 0.14)},
    "flat-stone": {"width": (EXACT, STONE_WIDTH), "height": (AT_MOST, 0.12), "depth": (AT_MOST, 0.36)},
    "stick": {"height": (EXACT, STICK_HEIGHT), "width": (AT_MOST, 0.2), "depth": (AT_MOST, 0.2)},
    "open-book": {"width": (EXACT, OPEN_BOOK_WIDTH), "height": (AT_MOST, 0.16), "depth": (AT_MOST, 0.36)},
    "loose-page": {"width": (EXACT, LOOSE_PAGE_WIDTH), "height": (AT_MOST, 0.08), "depth": (AT_MOST, 0.3)},
    "closed-book": {"width": (EXACT, CLOSED_BOOK_WIDTH), "depth": (AT_MOST, CLOSED_BOOK_DEPTH + 0.02),
                    "height": (EXACT, CLOSED_BOOK_THICK)},
    "flower": {"height": (EXACT, FLOWER_HEIGHT), "width": (AT_MOST, 0.5), "depth": (AT_MOST, 0.5),
               "petals": (EXACT, float(PETAL_COUNT))},
    "petal": {"depth": (EXACT, PETAL_LENGTH), "height": (AT_MOST, 0.03), "width": (AT_MOST, 0.1)},
    "picnic-blanket": {"width": (EXACT, BLANKET_WIDTH), "depth": (EXACT, BLANKET_DEPTH), "height": (AT_MOST, 0.05),
                       "checks": (EXACT, 32.0)},
    "sandwich": {"height": (EXACT, SANDWICH_THICK), "width": (AT_MOST, 0.42), "depth": (AT_MOST, 0.42)},
    "sandwich-tower": {"sandwiches": (EXACT, float(TOWER_COUNT)), "height": (EXACT, TOWER_COUNT * SANDWICH_THICK),
                       "width": (AT_MOST, 0.8), "depth": (AT_MOST, 0.8)},
    "sandwich-heap": {"sandwiches": (EXACT, float(HEAP_COUNT)), "height": (EXACT, 4 * SANDWICH_THICK),
                      "width": (AT_MOST, 1.8), "depth": (AT_MOST, 1.5)},
    "jam-tart": {"width": (EXACT, TART_WIDTH), "height": (AT_MOST, 0.09), "depth": (AT_MOST, 0.24)},
    "cake": {"height": (EXACT, CAKE_HEIGHT), "width": (AT_MOST, 0.6), "depth": (AT_MOST, 0.6)},
    "puddle": {"width": (EXACT, PUDDLE_WIDTH), "height": (AT_MOST, 0.02), "depth": (AT_MOST, 0.6)},
    "window-frame": {"width": (EXACT, WINDOW_WIDTH), "height": (EXACT, WINDOW_HEIGHT), "depth": (AT_MOST, 0.14)},
    "umbrella-inside-out": {"height": (EXACT, UMBRELLA_HEIGHT), "width": (AT_MOST, 1.1), "depth": (AT_MOST, 1.1)},
    "battlement": {"width": (EXACT, BATTLEMENT_LENGTH), "height": (EXACT, BATTLEMENT_PARAPET + MERLON_HEIGHT),
                   "merlonHeight": (EXACT, MERLON_HEIGHT), "depth": (AT_MOST, 0.5)},
    "story-wheel": {"height": (EXACT, WHEEL_HUB_Z + WHEEL_RADIUS + WHEEL_LIGHT_R), "width": (AT_MOST, 4.6), "depth": (AT_MOST, 1.3),
                    "cars": (EXACT, float(WHEEL_CARS)), "lights": (EXACT, float(WHEEL_LIGHTS)),
                    "bracketEmpty": (AT_LEAST, 0.15)},
    "feather": {"depth": (EXACT, FEATHER_LENGTH), "height": (AT_MOST, 0.06), "width": (AT_MOST, 0.14)},
    "twig-nest": {"bowlWidth": (EXACT, NEST_WIDTH), "width": (AT_MOST, 2.0), "height": (AT_MOST, 0.6), "depth": (AT_MOST, 2.1),
                  "twigs": (EXACT, float(NEST_TWIGS))},
    "biscuit-treat": {"width": (EXACT, TREAT_WIDTH), "height": (AT_MOST, 0.1), "depth": (AT_MOST, 0.32),
                      "chips": (EXACT, 6.0)},
}


# =============================================================================
# 1. Nimbus, the storm cloud — the one character in the kit
# =============================================================================


def build_storm_cloud() -> None:
    """A cross little cloud: one big round face puff in front, a ring of
    squashed puffs behind and beside it, a flat-ish underside. Four moods the
    judge named (frown, sad, surprised, happy) are the painter's; the shape is
    one. Grey or white is the loader's — the shape never knows.

    The face puff is a true sphere so its UV window is square and a round eye
    paints round; it is also the biggest puff and the one furthest forward, so
    nothing can stand in front of the eyes (asserted by rays)."""
    a = register(Asset("storm-cloud"))
    face = a.part("face")
    puffs = a.part("puffs")
    fc, fr = (0.0, 0.0, 0.58), (0.50, 0.46, 0.50)
    face.at(*ellipsoid(*fr, 3), *fc)
    for c, r in (
        ((0.66, 0.12, 0.46), (0.38, 0.34, 0.34)),     # left big (+X, the creature's own left)
        ((-0.72, 0.10, 0.52), (0.42, 0.36, 0.38)),    # right big — a little bigger: the asymmetric feature
        ((0.30, 0.08, 0.98), (0.26, 0.24, 0.24)),     # top left
        ((-0.26, 0.12, 1.00), (0.22, 0.21, 0.21)),    # top right
        ((0.26, 0.02, 0.18), (0.34, 0.36, 0.18)),     # underside, flat
        ((-0.30, 0.02, 0.17), (0.36, 0.36, 0.17)),
        ((0.96, 0.14, 0.20), (0.22, 0.24, 0.16)),
        ((-1.02, 0.12, 0.22), (0.20, 0.22, 0.16)),
        ((0.12, 0.46, 0.60), (0.40, 0.30, 0.36)),     # the back row
        ((-0.30, 0.42, 0.52), (0.36, 0.28, 0.30)),
    ):
        puffs.at(*ellipsoid(*r, 2), *c)
    eye_x, eye_z = 0.19, fc[2]
    for sx, key in ((1.0, "eyeL"), (-1.0, "eyeR")):
        a.mark(key, sx * eye_x, ellipsoid_front_y(fc, fr, sx * eye_x, eye_z), eye_z)
    mouth_z = eye_z - 0.20
    a.mark("mouth", 0.0, ellipsoid_front_y(fc, fr, 0.0, mouth_z), mouth_z)
    a.faces = {"storm-cloud-face": ["eyeL", "eyeR"]}
    a.normalise(height=CLOUD_HEIGHT)


def build_fluffy_cloud() -> None:
    """The cloud Chicken-looter hides in: long, low, faceless — a different
    silhouette from Nimbus on purpose, so nobody takes it for her."""
    a = register(Asset("fluffy-cloud"))
    body = a.part()
    for c, r in (
        ((0.0, 0.0, 0.40), (0.55, 0.42, 0.40)),
        ((0.72, 0.06, 0.34), (0.44, 0.36, 0.34)),
        ((-0.70, 0.04, 0.36), (0.46, 0.38, 0.36)),
        ((1.18, 0.10, 0.26), (0.30, 0.28, 0.26)),
        ((-1.14, 0.08, 0.28), (0.32, 0.30, 0.28)),
        ((0.34, 0.30, 0.30), (0.40, 0.30, 0.30)),
        ((-0.36, 0.30, 0.28), (0.38, 0.30, 0.28)),
        ((0.0, 0.0, 0.14), (0.9, 0.44, 0.14)),
    ):
        body.at(*ellipsoid(*r, 2), *c)
    a.normalise(height=FLUFFY_HEIGHT)


# =============================================================================
# 2. The Rail Race's finish rainbow, as a prop
# =============================================================================


def build_rainbow_arch() -> None:
    """Six half-torus bands standing on short straight legs — the ride's own
    arch (``railRace/track.ts`` draws a semicircle on legs, inner band first,
    in ``ART.rainbow``), one node per band so each takes its own colour. The
    ride solves its radius from its lanes; a prop's radius is its own. Each
    band is one closed sweep — leg, arc, leg — capped at the feet."""
    a = register(Asset("rainbow-arch"))
    tube_r = ARCH_BAND * 0.5
    for i in range(RAINBOW_BANDS):
        band = a.part(f"band{i + 1}")
        r = ARCH_INNER_RADIUS + i * ARCH_BAND
        pts = [(-r, 0.0, tube_r), (-r, 0.0, ARCH_LEG)]
        arc_steps = 30
        for k in range(1, arc_steps):
            ang = math.pi - math.pi * k / arc_steps
            pts.append((r * math.cos(ang), 0.0, ARCH_LEG + r * math.sin(ang)))
        pts += [(r, 0.0, ARCH_LEG), (r, 0.0, tube_r)]
        band.add(*sweep_path(pts, tube_r, sides=8, up=(0.0, 1.0, 0.0), closed=False))
        # A fat round foot under each leg so the band stands on the ground
        # with a sole rather than a knife-edge cap.
        for sx in (-1.0, 1.0):
            band.at(*ellipsoid(tube_r, tube_r, tube_r, 1), sx * r, 0.0, tube_r)


# =============================================================================
# 3. Queue posts and rope
# =============================================================================


def build_queue_posts() -> None:
    a = register(Asset("queue-posts"))
    posts = a.part("posts")
    rope = a.part("rope")
    half = 0.70
    h = QUEUE_POST_HEIGHT
    for sx in (-1.0, 1.0):
        x = sx * half
        posts.at(*revolve([(0.0, 0.0), (0.17, 0.0), (0.18, 0.03), (0.15, 0.06), (0.05, 0.08), (0.0, 0.08)], 16), x)
        posts.at(*tube(0.045, h - 0.1, sides=12, z0=0.06), x)
        posts.at(*icosphere(0.075, 2), x, 0.0, h)
    pts = []
    for k in range(17):
        u = k / 16.0
        x = -half + 0.02 + (2.0 * half - 0.04) * u
        pts.append((x, 0.0, h - 0.04 - 0.28 * math.sin(math.pi * u)))
    rope.add(*sweep_path(pts, 0.04, sides=8, up=(0.0, 1.0, 0.0), closed=False))


# =============================================================================
# 4. The rubber duck — the payoff of "Duck, Sir Hopsalot!"
# =============================================================================


def build_rubber_duck() -> None:
    """A bath duck: a plump body, a round head set forward on it, a flat beak
    under the eyes, a little tail tipped up. The head is its own round node
    carrying the face; the beak is separate so a painted mouth is never
    needed (the owl's beak rule) and the eye rays clear it."""
    a = register(Asset("rubber-duck"))
    body = a.part("body")
    head = a.part("head")
    beak = a.part("beak")
    body.at(*ellipsoid(0.17, 0.25, 0.13, 3), 0.0, 0.03, 0.14)
    body.add(*ellipsoid(0.07, 0.09, 0.05, 2), matrix=place(0.0, 0.27, 0.19, rx=-35.0))
    hc, hr = (0.0, -0.12, 0.30), (0.125, 0.12, 0.125)
    head.at(*ellipsoid(*hr, 3), *hc)
    eye_x, eye_z = 0.05, hc[2]
    for sx, key in ((1.0, "eyeL"), (-1.0, "eyeR")):
        a.mark(key, sx * eye_x, ellipsoid_front_y(hc, hr, sx * eye_x, eye_z), eye_z)
    beak_z = hc[2] - 0.05
    beak.add(*ellipsoid(0.055, 0.075, 0.028, 2),
             matrix=place(0.0, ellipsoid_front_y(hc, hr, 0.0, beak_z) - 0.02, beak_z, rx=12.0))
    a.faces = {"rubber-duck-head": ["eyeL", "eyeR"]}
    a.normalise(height=DUCK_HEIGHT)


# =============================================================================
# 5. Park bench, magnifying glass, footprints, small finds
# =============================================================================


def build_park_bench() -> None:
    """A plank seat on two end boards and nothing underneath — Biscuit hides
    under it. Seat top at the child's hip, the one height her feet reach the
    floor from (library_build's `CHILD_HIP`, kid.ts's `KID_HIP_HEIGHT`)."""
    a = register(Asset("park-bench"))
    seat = a.part("seat")
    legs = a.part("legs")
    seat_t = 0.10
    seat.at(*flat_top_box(BENCH_LENGTH, 0.55, seat_t, 0.03, 1), z=CHILD_HIP - seat_t * 0.5)
    leg_h = CHILD_HIP - seat_t + 0.02
    for sx in (-1.0, 1.0):
        legs.at(*rounded_box(0.12, 0.50, leg_h, 0.02, 1), x=sx * 0.68, z=leg_h * 0.5)


def build_magnifying_glass() -> None:
    """Standing on its handle like a lollipop: a fat rim in the XZ plane, a
    knobbed handle, and the lens its own node (pale, maybe see-through —
    the loader's call)."""
    a = register(Asset("magnifying-glass"))
    frame = a.part("frame")
    lens = a.part("lens")
    rim_r, rim_t, handle_h = GLASS_RIM_R, GLASS_RIM_T, GLASS_HANDLE
    frame.add(*tapered_sweep([(0.0, 0.0, 0.0), (0.0, 0.0, handle_h + 0.02)], [0.038, 0.03], 10))
    frame.at(*ellipsoid(0.05, 0.05, 0.035, 2), 0.0, 0.0, 0.035)
    centre_z = handle_h + rim_r
    frame.add(*torus(rim_r, rim_t, 24, 8), matrix=place(0.0, 0.0, centre_z, rx=90.0))
    lens.add(*tube(rim_r - rim_t * 0.6, 0.012, sides=24, z0=-0.006), matrix=place(0.0, 0.0, centre_z, rx=90.0))
    a.normalise()


def build_pancake_footprint() -> None:
    """The mini's foot, flat and wide like a pancake, three toe bumps forward."""
    a = register(Asset("pancake-footprint"))
    print_ = a.part()
    print_.at(*ellipsoid(0.075, 0.095, 0.012, 2), 0.0, 0.02, 0.012)
    for x in (-0.045, 0.0, 0.045):
        # The middle toe reaches furthest forward (−Y).
        print_.at(*ellipsoid(0.024, 0.028, 0.009, 1), x, -0.085 - (0.012 if x == 0.0 else 0.0), 0.009)
    a.normalise()


def build_giant_footprint() -> None:
    """Grandpa Tock's: a dinner-plate disc with four stubby toes along its front."""
    a = register(Asset("giant-footprint"))
    print_ = a.part()
    print_.add(*flat_disc(0.30, 0.026, 28))
    for k in range(4):
        ang = deg(-125.0 + 70.0 * k / 3.0)
        print_.at(*ellipsoid(0.056, 0.062, 0.018, 2), 0.33 * math.cos(ang), 0.33 * math.sin(ang), 0.018)
    a.normalise()


def build_spoon() -> None:
    a = register(Asset("spoon"))
    spoon = a.part()
    spoon.at(*ellipsoid(0.055, 0.075, 0.022, 2), 0.0, -0.09, 0.022)
    spoon.add(*tapered_sweep([(0.0, -0.03, 0.02), (0.0, 0.06, 0.02), (0.0, 0.165, 0.026)], [0.02, 0.019, 0.026], 8))
    a.normalise()


def build_flat_stone() -> None:
    a = register(Asset("flat-stone"))
    stone = a.part()
    verts, faces = revolve_lobed([(0.0, 0.0), (0.18, 0.0), (0.20, 0.03), (0.17, 0.075), (0.09, 0.098), (0.0, 0.102)],
                                 24, 2, 0.15)
    stone.add([(x, y * 0.78, z) for x, y, z in verts], faces)
    a.normalise()


def build_stick() -> None:
    a = register(Asset("stick"))
    stick = a.part()
    stick.add(*tapered_sweep([(0.0, 0.0, 0.0), (0.012, 0.016, 0.22), (0.04, 0.02, 0.42)], [0.032, 0.028, 0.022], 8))
    stick.at(*icosphere(0.03, 2), 0.04, 0.02, 0.425)
    a.normalise()


# =============================================================================
# 6. Books: open, loose page, closed
# =============================================================================


def page_curve(reach: float, lift: float, sag: float, steps: int = 6):
    """x stations from the gutter out to ``reach``, and the height the paper
    rises to over them: ``lift`` at the edge, pulled down by ``sag``·u²."""
    xs, zs = [], []
    for k in range(steps + 1):
        u = k / steps
        xs.append(0.02 + (reach - 0.02) * u)
        zs.append(lift * u - sag * u * u)
    return xs, zs


def build_open_book() -> None:
    """Lying open: two gently curved pages rising from the gutter, cover
    boards under them, a spine roll between. Spine along Y; the gutter at x = 0."""
    a = register(Asset("open-book"))
    cover = a.part("cover")
    pages = a.part("pages")
    half_d = 0.16
    reach = OPEN_BOOK_WIDTH * 0.5
    xs, rise = page_curve(reach, 0.11, 0.03)
    board_t, page_t = 0.022, 0.03
    board_b = list(rise)
    board_tp = [z + board_t for z in board_b]
    page_b = [z - 0.002 for z in board_tp]
    page_tp = [z + page_t for z in page_b]
    right_board = band_prism(xs, board_b, board_tp, -half_d - 0.01, half_d + 0.01)
    right_pages = band_prism([x - 0.004 for x in xs], page_b, page_tp, -half_d, half_d)
    cover.add(*right_board)
    cover.add(*mirror_x(*right_board))
    pages.add(*right_pages)
    pages.add(*mirror_x(*right_pages))
    # The spine roll under the gutter, its underside on the floor with the boards'.
    cover.add(*tube(0.03, 2.0 * (half_d + 0.01), sides=12), matrix=place(0.0, -half_d - 0.01, 0.03, rx=-90.0))
    a.normalise()


def build_loose_page() -> None:
    """One page fluttering free: a thin sheet curled up along its width."""
    a = register(Asset("loose-page"))
    page = a.part()
    steps = 8
    xs, zb = [], []
    for k in range(steps + 1):
        u = k / steps
        xs.append(-LOOSE_PAGE_WIDTH * 0.5 + LOOSE_PAGE_WIDTH * u)
        zb.append(0.055 * math.sin(math.pi * u))
    page.add(*band_prism(xs, zb, [z + 0.008 for z in zb], -0.13, 0.13))
    a.normalise()


def build_closed_book() -> None:
    """The storybook lying flat, spine to the front (−Y), as the picture books
    draw it — library_build's `lying_book`, at `createStoryBook`'s size."""
    a = register(Asset("closed-book"))
    cover_part, page_part = lying_book(CLOSED_BOOK_WIDTH, CLOSED_BOOK_DEPTH, CLOSED_BOOK_THICK, board=0.02)
    a.part("cover").add(cover_part.verts, cover_part.faces)
    a.part("pages").add(page_part.verts, page_part.faces)
    a.normalise()


# =============================================================================
# 7. Flowers
# =============================================================================


def build_flower() -> None:
    """A storybook flower: a fat stem with two leaves, a round centre and six
    plump petals in a head tilted up to the reader. The nibbled yellow one is
    the stem node alone — its top shows where the head was bitten."""
    a = register(Asset("flower"))
    stem = a.part("stem")
    petals = a.part("petals")
    centre = a.part("centre")
    top = (0.0, -0.02, 0.56)
    stem.add(*tapered_sweep([(0.0, 0.0, 0.0), (0.0, -0.01, 0.3), top], [0.036, 0.033, 0.03], 10))
    # Two leaves, one each side, tips up: the leaf tapers towards +X, so the
    # left one is turned half round to point out its own way.
    for sx, z, yaw in ((1.0, 0.20, 20.0), (-1.0, 0.31, -30.0)):
        stem.add(*tapered_ellipsoid(0.13, 0.055, 0.02, 0, 0.55),
                 matrix=place(sx * 0.10, 0.0, z, ry=-28.0, rz=yaw + (0.0 if sx > 0 else 180.0)))
    tilt = -38.0  # the head faces −Y and up
    head = Matrix.Translation((top[0], top[1] - 0.02, top[2] + 0.05)) @ rot(x=tilt)
    for k in range(PETAL_COUNT):
        ang = TAU * k / PETAL_COUNT + deg(15.0)
        petals.add(*ellipsoid(0.065, 0.10, 0.026, 2),
                   matrix=head @ Matrix.Translation((0.14 * math.cos(ang), 0.14 * math.sin(ang), 0.0)) @ rot(z=math.degrees(ang) + 90.0))
    centre.add(*ellipsoid(0.085, 0.085, 0.05, 2), matrix=head @ Matrix.Translation((0.0, 0.0, 0.012)))
    a.normalise(height=FLOWER_HEIGHT)


def build_petal() -> None:
    a = register(Asset("petal"))
    petal = a.part()
    petal.add(*tapered_ellipsoid(0.04, PETAL_LENGTH * 0.5, 0.009, 1, 0.5))
    a.normalise()


# =============================================================================
# 8. The picnic: blanket, sandwiches, tarts, cake
# =============================================================================


def build_picnic_blanket() -> None:
    """A soft-edged cloth with gingham checks standing a few millimetres proud
    (a second node, a second colour), buried into the cloth so no face shares
    its plane."""
    a = register(Asset("picnic-blanket"))
    cloth = a.part("cloth")
    checks = a.part("checks")
    cloth_t = 0.035
    cloth.at(*rounded_box(BLANKET_WIDTH, BLANKET_DEPTH, cloth_t, 0.015, 1), z=cloth_t * 0.5)
    cols, rows = 9, 7
    sq = BLANKET_CHECK
    for i in range(cols):
        for j in range(rows):
            if (i + j) % 2:
                continue
            x = (i - (cols - 1) * 0.5) * sq
            y = (j - (rows - 1) * 0.5) * sq
            checks.at(*box(sq - 0.012, sq - 0.012, 0.012), x, y, cloth_t)
    a.normalise()


def sandwich_into(bread, filling, matrix: Matrix, z0: float = 0.0) -> None:
    """One sandwich — two bevelled bread wedges and a filling peeping past
    them — placed by ``matrix``, standing from ``z0``."""
    slice_t = 0.028
    bread.add(*soft(*wedge(SANDWICH_LEG, slice_t, z0), 0.011), matrix=matrix)
    bread.add(*soft(*wedge(SANDWICH_LEG, slice_t, z0 + SANDWICH_THICK - slice_t), 0.011), matrix=matrix)
    filling.add(*wedge(SANDWICH_LEG, SANDWICH_THICK - 2.0 * slice_t + 0.004, z0 + slice_t - 0.002, grow=0.012), matrix=matrix)


def build_sandwich() -> None:
    a = register(Asset("sandwich"))
    sandwich_into(a.part("bread"), a.part("filling"), Matrix.Identity(4))
    a.normalise()


# (yaw°, dx, dy) for the tower's layers, bottom to top: a lean that grows.
TOWER_LAYOUT = [
    (0.0, 0.0, 0.0), (180.0, 0.01, 0.0), (4.0, 0.02, 0.01), (184.0, 0.02, -0.01),
    (-3.0, 0.03, 0.0), (177.0, 0.04, 0.01), (6.0, 0.05, 0.0), (186.0, 0.05, -0.01),
    (-5.0, 0.07, 0.0), (175.0, 0.08, 0.01), (3.0, 0.10, 0.0), (183.0, 0.11, -0.01),
    (-7.0, 0.13, 0.0), (173.0, 0.15, 0.01), (8.0, 0.17, 0.0), (188.0, 0.19, -0.01),
]
assert len(TOWER_LAYOUT) == TOWER_COUNT


def build_sandwich_tower() -> None:
    """Sixteen sandwiches stacked in a teetering tower taller than Biscuit."""
    a = register(Asset("sandwich-tower"))
    bread, filling = a.part("bread"), a.part("filling")
    for i, (yaw, dx, dy) in enumerate(TOWER_LAYOUT):
        sandwich_into(bread, filling, place(dx, dy, 0.0, rz=yaw), z0=i * SANDWICH_THICK)
    a.normalise()


def build_sandwich_heap() -> None:
    """Nimbus's forty-one, as a mountain: 4×3 squares of two, then 3×2, then
    2×1, then one wedge on the summit — 24 + 12 + 4 + 1."""
    a = register(Asset("sandwich-heap"))
    bread, filling = a.part("bread"), a.part("filling")
    pitch = SANDWICH_LEG + 0.06
    count = 0
    for layer, (cols, rows) in enumerate(((4, 3), (3, 2), (2, 1))):
        for i in range(cols):
            for j in range(rows):
                x = (i - (cols - 1) * 0.5) * pitch
                y = (j - (rows - 1) * 0.5) * pitch
                wobble = ((i * 3 + j * 5 + layer) % 7 - 3) * 1.5
                for half in (0.0, 180.0):
                    sandwich_into(bread, filling, place(x, y, 0.0, rz=half + wobble), z0=layer * SANDWICH_THICK)
                    count += 1
    sandwich_into(bread, filling, place(0.0, 0.0, 0.0, rz=12.0), z0=3 * SANDWICH_THICK)
    count += 1
    assert count == HEAP_COUNT, count
    a.normalise()


def build_jam_tart() -> None:
    a = register(Asset("jam-tart"))
    pastry = a.part("pastry")
    jam = a.part("jam")
    r = TART_WIDTH * 0.5
    pastry.add(*revolve_lobed([(0.0, 0.0), (r * 0.82, 0.0), (r * 0.98, 0.02), (r, 0.05), (r * 0.9, 0.066),
                               (r * 0.74, 0.058), (r * 0.72, 0.028), (0.0, 0.028)], 30, 10, 0.07))
    jam.add(*revolve([(0.0, 0.026), (r * 0.75, 0.026), (r * 0.76, 0.045), (r * 0.55, 0.06), (0.0, 0.064)], 20))
    a.normalise()


def build_cake() -> None:
    """Two tiers, icing dripping off each, a cherry on top."""
    a = register(Asset("cake"))
    sponge = a.part("sponge")
    icing = a.part("icing")
    cherry = a.part("cherry")
    sponge.add(*revolve([(0.0, 0.0), (0.24, 0.0), (0.25, 0.02), (0.25, 0.19), (0.24, 0.21), (0.16, 0.21),
                         (0.17, 0.23), (0.17, 0.35), (0.16, 0.37), (0.0, 0.37)], 24))
    icing.add(*revolve([(0.0, 0.19), (0.258, 0.19), (0.262, 0.215), (0.25, 0.235), (0.0, 0.235)], 24))
    icing.add(*revolve([(0.0, 0.35), (0.178, 0.35), (0.182, 0.375), (0.17, 0.395), (0.0, 0.395)], 20))
    for k in range(7):
        ang = TAU * k / 7 + deg(10.0)
        icing.at(*ellipsoid(0.03, 0.03, 0.04 + 0.012 * (k % 3), 1), 0.252 * math.cos(ang), 0.252 * math.sin(ang), 0.19 - 0.012)
    for k in range(5):
        ang = TAU * k / 5 + deg(36.0)
        icing.at(*ellipsoid(0.026, 0.026, 0.034 + 0.01 * (k % 2), 1), 0.172 * math.cos(ang), 0.172 * math.sin(ang), 0.35 - 0.01)
    cherry.at(*ellipsoid(0.046, 0.046, 0.042, 2), 0.0, 0.0, 0.395 + 0.034)
    a.normalise(height=CAKE_HEIGHT)


# =============================================================================
# 9. Puddle, window, umbrella, battlement
# =============================================================================


def build_puddle() -> None:
    a = register(Asset("puddle"))
    puddle = a.part()
    # Six lobes, not five: an odd count puts a trough opposite every peak, so
    # no odd-lobed disc can meet an exact width.
    verts, faces = flat_disc(PUDDLE_WIDTH * 0.5, 0.014, 30, 6, 0.14)
    puddle.add([(x, y * 0.78, z) for x, y, z in verts], faces)
    a.normalise()


def build_window_frame() -> None:
    """A rounded frame with a cross of glazing bars, upright, facing −Y."""
    a = register(Asset("window-frame"))
    frame = a.part()
    w, h, d, t = WINDOW_WIDTH, WINDOW_HEIGHT, 0.12, 0.11
    for x in (-(w - t) * 0.5, (w - t) * 0.5):
        frame.at(*rounded_box(t, d, h, 0.03, 1), x, 0.0, h * 0.5)
    for z in (t * 0.5, h - t * 0.5):
        frame.at(*rounded_box(w - 2.0 * t + 0.02, d, t, 0.03, 1), 0.0, 0.0, z)
    frame.at(*rounded_box(0.07, d - 0.03, h - 2.0 * t + 0.02, 0.02, 1), 0.0, 0.0, h * 0.5)
    frame.at(*rounded_box(w - 2.0 * t + 0.02, d - 0.03, 0.07, 0.02, 1), 0.0, 0.0, h * 0.52)
    a.normalise()


def build_umbrella_inside_out() -> None:
    """Blown inside out: a scalloped bowl pointing up on a J-handled stick."""
    a = register(Asset("umbrella-inside-out"))
    canopy = a.part("canopy")
    handle = a.part("handle")
    shaft = 0.70
    canopy.add(*revolve_lobed([(0.0, shaft - 0.02), (0.10, shaft + 0.06), (0.46, shaft + 0.36), (0.50, shaft + 0.41),
                               (0.47, shaft + 0.43), (0.44, shaft + 0.40), (0.09, shaft + 0.13), (0.0, shaft + 0.09)],
                              32, 8, 0.06))
    # A straight chunky stick with a round foot, not a J: a hook's lowest point
    # is off the shaft, and this asset's origin — the point the picture stands
    # it on — is the foot under the shaft.
    handle.add(*tapered_sweep([(0.0, 0.0, 0.03), (0.0, 0.0, shaft + 0.04)], [0.034, 0.03], 10))
    handle.at(*ellipsoid(0.05, 0.05, 0.04, 2), 0.0, 0.0, 0.04)
    a.normalise(height=UMBRELLA_HEIGHT)


def build_battlement() -> None:
    """A run of the castle roof's wall: a parapet with three merlons at the
    castle's own `CASTLE_MERLON_HEIGHT`, sunk 2 cm into it."""
    a = register(Asset("battlement"))
    wall = a.part()
    depth = 0.45
    wall.at(*rounded_box(BATTLEMENT_LENGTH, depth, BATTLEMENT_PARAPET, 0.04, 1), z=BATTLEMENT_PARAPET * 0.5)
    for x in (-0.95, 0.0, 0.95):
        wall.at(*rounded_box(0.50, depth - 0.04, MERLON_HEIGHT + 0.02, 0.04, 1),
                x, 0.0, BATTLEMENT_PARAPET - 0.02 + (MERLON_HEIGHT + 0.02) * 0.5)
    a.normalise()


# =============================================================================
# 10. The Space Ferris Wheel, as a toy stand-in
# =============================================================================


def build_story_wheel() -> None:
    """Not the ride (`createFerrisWheelProp` wants an anchor and a collision
    world): a toy wheel — rim, eight spokes on a fat hub, eight cars hanging,
    an A-frame each side, an **empty** star bracket on the hub's face (the
    story's missing star goes in it), and a ring of lights the loader hides
    on page 1 and lights on page 9."""
    a = register(Asset("story-wheel"))
    rim = a.part("rim")
    spokes = a.part("spokes")
    cars = a.part("cars")
    legs = a.part("legs")
    bracket = a.part("bracket")
    lights = a.part("lights")
    R, hz = WHEEL_RADIUS, WHEEL_HUB_Z
    ring = [(R * math.cos(TAU * k / 48), 0.0, hz + R * math.sin(TAU * k / 48)) for k in range(48)]
    rim.add(*sweep_path(ring, 0.07, sides=8, up=(0.0, 1.0, 0.0), closed=True))
    spokes.add(*tube(0.30, 0.30, sides=20), matrix=place(0.0, 0.15, hz, rx=90.0))
    spokes.add(*tube(0.065, 1.10, sides=10), matrix=place(0.0, 0.55, hz, rx=90.0))
    for k in range(WHEEL_CARS):
        ang = TAU * k / WHEEL_CARS + deg(22.5)
        tip = (R * math.cos(ang), 0.0, hz + R * math.sin(ang))
        spokes.add(*tapered_sweep([(0.0, 0.0, hz), tip], [0.05, 0.045], 8))
        cars.at(*box(0.08, 0.08, 0.12), tip[0], 0.0, tip[2] - 0.08)
        cars.at(*rounded_box(0.52, 0.50, 0.44, 0.06, 2), tip[0], 0.0, tip[2] - 0.12 - 0.22)
    for k in range(WHEEL_LIGHTS):
        ang = TAU * k / WHEEL_LIGHTS
        lights.at(*icosphere(WHEEL_LIGHT_R, 1), R * math.cos(ang), -0.08, hz + R * math.sin(ang))
    for sy in (-1.0, 1.0):
        y = sy * 0.42
        for sx in (-1.0, 1.0):
            # Each leg's top is buried in the axle; a brace ties the pair at knee height.
            legs.add(*tapered_sweep([(sx * 1.6, y, 0.08), (sx * 0.15, y, hz - 0.02)], [0.09, 0.07], 8))
            legs.at(*ellipsoid(0.16, 0.14, 0.06, 2), sx * 1.6, y, 0.06)
        legs.add(*rounded_box(2.0, 0.12, 0.10, 0.03, 1), matrix=place(0.0, y, 1.2))
    bracket.add(*ring_prism(star_outline(0.46, 0.22), star_outline(0.38, 0.165), -0.20, -0.14),
                matrix=Matrix.Translation((0.0, 0.0, hz)))
    a.mark("bracketCentre", 0.0, -0.17, hz)
    a.normalise()


# =============================================================================
# 11. Feather, nest, biscuit
# =============================================================================


def build_feather() -> None:
    """Lying on the grass: a plump vane tapering to its quill, and a quill stub."""
    a = register(Asset("feather"))
    feather = a.part()
    feather.at(*tapered_ellipsoid(0.055, 0.14, 0.02, 1, 0.6), 0.0, -0.02, 0.02)
    feather.add(*tapered_sweep([(0.0, 0.02, 0.014), (0.0, 0.16, 0.014)], [0.018, 0.012], 8))
    a.normalise()


def build_twig_nest() -> None:
    """Chicken-looter's hoard sits in this: a fat woven bowl, ten chunky
    twigs poking out of its rim."""
    a = register(Asset("twig-nest"))
    bowl = a.part("bowl")
    twigs = a.part("twigs")
    r = NEST_WIDTH * 0.5
    bowl.add(*revolve_lobed([(0.0, 0.0), (r * 0.78, 0.0), (r * 0.98, 0.14), (r, 0.30), (r * 0.94, 0.37),
                             (r * 0.82, 0.38), (r * 0.72, 0.33), (r * 0.6, 0.14), (0.0, 0.10)], 32, 8, 0.04))
    for k in range(NEST_TWIGS):
        ang = TAU * k / NEST_TWIGS + deg(7.0 * (k % 3))
        base = Vector((r * 0.9 * math.cos(ang), r * 0.9 * math.sin(ang), 0.26 + 0.03 * (k % 2)))
        out = Vector((math.cos(ang + deg(35.0 * (1 if k % 2 else -1))), math.sin(ang + deg(35.0 * (1 if k % 2 else -1))), 0.35 + 0.15 * (k % 3)))
        out.normalize()
        length = 0.34 + 0.05 * (k % 4)
        twigs.add(*tapered_sweep([tuple(base), tuple(base + out * length * 0.5), tuple(base + out * length)],
                                 [0.036, 0.03, 0.022], 8))
    a.normalise()


def build_biscuit_treat() -> None:
    """A biscuit to eat, not Biscuit the bear: a fat bumpy-edged round with
    six chocolate chips sunk into its top."""
    a = register(Asset("biscuit-treat"))
    body = a.part("body")
    chips = a.part("chips")
    r = TREAT_WIDTH * 0.5
    body.add(*revolve_lobed([(0.0, 0.0), (r * 0.86, 0.0), (r, 0.025), (r, 0.06), (r * 0.88, 0.082), (0.0, 0.084)],
                            24, 12, 0.03))
    for k, (cx, cy) in enumerate(((0.06, 0.03), (-0.05, 0.06), (0.0, -0.07), (0.09, -0.04), (-0.085, -0.025), (-0.01, 0.0))):
        chips.at(*ellipsoid(0.028, 0.024, 0.018, 1), cx, cy, 0.084 - 0.006)
    a.normalise()


# =============================================================================
# Measuring what was built
# =============================================================================


def m_size(asset: str, axis: int) -> float:
    lo, hi = lb.asset_bounds(asset)
    return hi.z if axis == 2 else hi[axis] - lo[axis]


def m_rope_sag() -> float:
    """How far the rope hangs below the posts' finials at its middle."""
    _, posts_hi = lb.node_bounds("queue-posts-posts")
    rope = [w for w in lb.world_verts(bpy.data.objects["queue-posts-rope"]) if abs(w.x) < 0.1]
    return posts_hi.z - min(w.z for w in rope)


def m_bracket_empty() -> float:
    """How far up from the bracket's centre a ray straight back at the hub
    travels before the bracket stops it — the star's socket is open that far.
    Only the bracket is in the BVH, so the hub behind cannot answer for it.
    The control: a ray at the bracket's top point does hit it."""
    bvh, _ = lb.bvh_for(["story-wheel-bracket"])
    c = lb.ASSETS["story-wheel"].marks["bracketCentre"]

    def blocked(dz: float) -> bool:
        return bvh.ray_cast(Vector((c.x, -5.0, c.z + dz)), Vector((0.0, 1.0, 0.0)))[0] is not None

    assert blocked(0.42), "control: a ray at the bracket's top point missed it"
    clear = 0.0
    while clear < 0.5 and not blocked(clear + 0.005):
        clear += 0.005
    return clear


def m_merlon_height() -> float:
    levels = lb.up_faces_z("battlement")
    assert len(levels) >= 2, f"battlement has {len(levels)} flat tops; wanted the parapet's and the merlons'"
    return levels[-1] - levels[-2]


def m_feet_on_ground() -> float:
    worst = 0.0
    for obj in lb.objects_of("rainbow-arch"):
        lo, _ = lb.node_bounds(obj.name)
        worst = max(worst, abs(lo.z))
    return worst


def m_face_over_puff() -> float:
    """The face puff's width over the widest single puff behind it."""
    flo, fhi = lb.node_bounds("storm-cloud-face")
    widest = max(max(w.x for w in piece) - min(w.x for w in piece) for piece in lb.islands("storm-cloud-puffs"))
    return (fhi.x - flo.x) / widest


MEASURE = {
    ("storm-cloud", "faceOverPuff"): m_face_over_puff,
    ("rainbow-arch", "bands"): lambda: float(len(lb.objects_of("rainbow-arch"))),
    ("rainbow-arch", "everyFootOnGround"): m_feet_on_ground,
    ("queue-posts", "ropeSag"): m_rope_sag,
    ("rubber-duck", "headOverBody"): lambda: lb.m_head_over_body("rubber-duck-head", "rubber-duck-body"),
    ("park-bench", "seatTop"): lambda: lb.node_bounds("park-bench-seat")[1].z,
    ("park-bench", "legs"): lambda: float(islands_count("park-bench-legs")),
    ("pancake-footprint", "toes"): lambda: float(islands_count("pancake-footprint") - 1),
    ("giant-footprint", "toes"): lambda: float(islands_count("giant-footprint") - 1),
    ("flower", "petals"): lambda: float(islands_count("flower-petals")),
    ("picnic-blanket", "checks"): lambda: float(islands_count("picnic-blanket-checks")),
    ("sandwich-tower", "sandwiches"): lambda: float(islands_count("sandwich-tower-filling")),
    ("sandwich-heap", "sandwiches"): lambda: float(islands_count("sandwich-heap-filling")),
    ("battlement", "merlonHeight"): m_merlon_height,
    ("story-wheel", "cars"): lambda: float(islands_count("story-wheel-cars") / 2),
    ("story-wheel", "lights"): lambda: float(islands_count("story-wheel-lights")),
    ("story-wheel", "bracketEmpty"): m_bracket_empty,
    ("twig-nest", "twigs"): lambda: float(islands_count("twig-nest-twigs")),
    ("twig-nest", "bowlWidth"): lambda: (lambda b: b[1].x - b[0].x)(lb.node_bounds("twig-nest-bowl")),
    ("biscuit-treat", "chips"): lambda: float(islands_count("biscuit-treat-chips")),
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
                f"{asset}.{fig}: the contract says {op} {want:.4f} and the geometry measures {got:.4f}. "
                "Fix the shape, or change CONTRACT and the handoff — never let the two differ."
            )
            cells.append(f"{fig} {got:.3f} ({op}{want:.3f})")
        rows.append(f"  {asset:<20} " + ", ".join(cells))
    return "\n".join(rows)


def check_origins() -> str:
    """Every asset is a FLOOR asset: lowest vertex on z = 0, centred on X,
    origin inside its own footprint — from the vertices."""
    rows = []
    for asset in CONTRACT:
        lo, hi = lb.asset_bounds(asset)
        assert abs(lo.z) < 1e-4, f"{asset}: lowest vertex at z {lo.z:+.5f}, not on the floor"
        assert abs(lo.x + hi.x) < 0.02, f"{asset} is off-centre on X by {(lo.x + hi.x) / 2:+.4f}"
        flo, fhi = lb.footprint(asset)
        assert flo[0] <= 0.0 <= fhi[0] and flo[1] <= 0.0 <= fhi[1], (
            f"{asset}'s origin is outside its own footprint {flo}..{fhi}")
        rows.append(f"  {asset:<20} x {lo.x:+.3f}..{hi.x:+.3f}  y {lo.y:+.3f}..{hi.y:+.3f}  z {lo.z:+.3f}..{hi.z:+.3f}")
    return "\n".join(rows)


def check_mouths() -> str:
    """The cloud's mouth row is on the face puff too: a ray at the mouth mark
    from in front must land on `storm-cloud-face`, not on a puff below it —
    `check_faces` asks this of the eyes; the painter's mouth needs it as well."""
    asset = lb.ASSETS["storm-cloud"]
    bvh, owner = lb.bvh_for(list(asset.parts))
    m = asset.marks["mouth"]
    hit = bvh.ray_cast(Vector((m.x, -10.0, m.z)), Vector((0.0, 1.0, 0.0)))
    assert hit[0] is not None, "storm-cloud: a ray at the mouth hits nothing"
    node = owner[hit[2]][0]
    assert node == "storm-cloud-face", f"storm-cloud: the mouth ray lands on {node}, not the face"
    u, v = asset.face_uv("storm-cloud-face", "mouth")
    # The control: a ray well below the mouth, where the underside puffs are,
    # must land on the puffs — the instrument can tell the two nodes apart.
    low = bvh.ray_cast(Vector((0.3, -10.0, 0.05)), Vector((0.0, 1.0, 0.0)))
    assert low[0] is not None and owner[low[2]][0] == "storm-cloud-puffs", "control: the underside ray missed the puffs"
    return f"  storm-cloud-face mouth at uv ({u:.3f}, {v:.3f}), {v - asset.face_uv('storm-cloud-face', 'eyeL')[1]:.3f} below the eyes"


BUILDERS = (
    build_storm_cloud, build_fluffy_cloud, build_rainbow_arch, build_queue_posts, build_rubber_duck,
    build_park_bench, build_magnifying_glass, build_pancake_footprint, build_giant_footprint, build_spoon,
    build_flat_stone, build_stick, build_open_book, build_loose_page, build_closed_book, build_flower,
    build_petal, build_picnic_blanket, build_sandwich, build_sandwich_tower, build_sandwich_heap,
    build_jam_tart, build_cake, build_puddle, build_window_frame, build_umbrella_inside_out, build_battlement,
    build_story_wheel, build_feather, build_twig_nest, build_biscuit_treat,
)

TRIANGLE_BUDGET = 40000


def main() -> None:
    reset_scene()
    for builder in BUILDERS:
        builder()
    for asset in lb.ASSETS.values():
        asset.emit()
    bpy.context.view_layer.update()

    built = {c.name for c in bpy.data.collections}
    assert built == set(CONTRACT), (
        f"built but not in the contract: {sorted(built - set(CONTRACT))}; "
        f"in the contract but not built: {sorted(set(CONTRACT) - built)}"
    )

    print("\nstory_props_build")
    print(summarise())
    lb.check_nodes()
    print(f"\n  winding: {lb.check_winding()} closed pieces, every one outward-facing")
    print("\n  origins, measured off the emitted vertices (every asset FLOOR):")
    print(check_origins())
    print("\n  pivots: none — nothing turns in a still picture")
    assert not lb.check_pivots()
    print("\n  painted faces (rays at each eye, through every node of the creature):")
    print(lb.check_faces())
    print(check_mouths())
    print("\n  stretches applied by normalise():")
    print(lb.check_scales())
    print("\n  CONTRACT, measured:")
    print(check_contract())
    print(f"\n  read from the game: KID_HEIGHT {CHILD_HEIGHT}, KID_HIP_HEIGHT {CHILD_HIP} ({KID_MODULE}); "
          f"CASTLE_MERLON_HEIGHT {MERLON_HEIGHT} (src/world/building/layout.ts); "
          f"ART.rainbow has {RAINBOW_BANDS} bands ({PALETTE_ART})")
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
