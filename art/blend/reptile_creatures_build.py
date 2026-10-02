"""Builds the Reptile House's creature kit and saves ``art/blend/reptile_creatures.blend``.

    blender --background --factory-startup --python-exit-code 1 \
        --python art/blend/reptile_creatures_build.py

The ``creatures`` asset group of ``docs/design/REPTILE-HOUSE.md`` §ASSET
GROUPS 4: **the organic parts primitives fight.** Every animal in the house is
assembled and animated in TypeScript from chunky primitives (segment chains,
travelling sines, hinge rotations); this kit supplies only the thirteen
sculpted pieces a stack of spheres approximates badly — a snake's heart-shaped
head that one painted face has to fit, a crocodile's long snout and jaw, a
scute-ridged shell, a chameleon's curled tail, a gecko's toe pads.

Like ``castle_build.py`` and unlike ``cart.blend``, **this script is the
authoring source** and ``reptile_creatures.blend`` is a generated artefact.
Then ``reptile_creatures_export.py`` writes the ``.glb`` and
``pnpm run blend:reptile-creatures`` runs build → export → pack.

## Design stance (the spec's, and GAME_DESIGN's)

Cute, smiley, never scary. Nothing here has a tooth: the crocodile's bite is a
yawn and the four "bumps" on her lower jaw are round beads, not points. Every
head is sized for a face **taller than it is wide** in the eye (ART_DIRECTION
§3), with the brow room a pair of oversized painted eyes needs. Sizes follow
Jim's scale rule — legible from the isometric camera, not realistic: a
chameleon as long as a child's arm, a frog the size of a grapefruit.

## What is shared and what is measured

* **One number is the game's**: ``REPTILE_SNAKE_HEAD_LENGTH`` — the length of
  ``rr-snake-head`` at scale 1 — read through ``reptile_constants`` from
  ``layout.ts`` (the one owner), asserted against the emitted vertices, and
  re-measured by the loader with ``visibleBounds``. Every other size here is
  **mesh-owned**: it is whatever the vertices say, printed every run in the
  size table and the anchor list below, and the TypeScript measures it rather
  than typing it (ASSET_MANIFEST's "nothing is measured twice").
* **The anchor list** (``ANCHORS``) is the part of this file the Engineer
  actually reads: where a face patch sits on each head, where the chameleon's
  eye spheres go, where a snake's tongue emerges. These are computed from the
  same figures that place the vertices, never typed a second time.

## Conventions (ART_DIRECTION §7, ASSET_MANIFEST's shared contract)

* 1 Blender unit = 1 metre.
* **Blender −Y is the game's +Z**: every creature faces −Y here, so it faces
  forward (+Z) in the game. The exporter's ``export_yup`` maps Blender
  (x, y, z) → glTF (x, z, −y).
* Origin at the **base** (the floor under the belly), centred on X and Y,
  baked into vertex positions — except the four **hinge-origin** nodes below,
  whose node carries a pure translation to the hinge so rotating the node *is*
  the animation (the castle chest-lid precedent). Everything else leaves
  Blender at an identity transform.
* One node per distinctly-coloured part; the ``.glb`` carries **no colour, no
  material**. ``src/art/models/reptileCreaturesAssets.ts`` (the Engineer's)
  owns the ``STYLES`` table.

## The four hinge-origin nodes

| node | hinge is at | the animation it makes one rotation / scale |
|---|---|---|
| ``rr-snake-tongue`` | the mouth, on the head's front tip | ``scale.z`` (Blender −Y) 0→1 is the flick |
| ``rr-croc-jaw`` | the back of the lower jaw, under the head | ``rotation.x`` opens the yawn |
| ``rr-croc-tail`` | the body's rear | ``rotation.y`` (up) sways the tail |
| ``rr-tortoise-head`` | the neck root at the shell's front opening | neck stretch is a translation along the node's −Y; the slow blink is a face swap |

Noodle (``rn-head``, kit 5) and Sunny (``rh-head``, kit 1) share the snake
face's **UV layout** with ``rr-snake-head``, by contract, so one painted canvas
fits all three: see :func:`snake_face_uvs`.
"""

import math
import os
import sys
import traceback

import bpy
from mathutils import Matrix, Vector

sys.dont_write_bytecode = True
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

from blendkit import (  # noqa: E402
    REPO,
    TAU,
    Part,
    collection,
    cone,
    ellipsoid,
    extrude_outline,
    icosphere,
    reset_scene,
    revolve,
    summarise,
    total_triangles,
    tube,
)
from reptile_constants import REPTILE_SNAKE_HEAD_LENGTH  # noqa: E402

BLEND = os.path.join(REPO, "art", "blend", "reptile_creatures.blend")

# The spec's budget for this kit (§ASSET GROUPS 4). Checked at the end of the
# run, so an added bump cannot push the kit over without the build going red.
TRIANGLE_BUDGET = 4500

# =============================================================================
# Design sizes — mesh-owned, legibility-first (Jim's scale rule)
# =============================================================================
#
# None of these is shared with the game. The TypeScript measures the shipped
# mesh with `visibleBounds()`; the figures the Engineer needs are *printed*
# from the built geometry (`ANCHORS`, the size table), never copied from here.

# -- the snake head (hero; painted) -------------------------------------------
# Length along −Y is the one game-owned number. The head is wider than it is
# tall and slightly heart-shaped: broad brow, rounded snout.
SNAKE_HEAD_LENGTH = REPTILE_SNAKE_HEAD_LENGTH
SNAKE_HEAD_HALF_WIDTH = 0.19
SNAKE_HEAD_HALF_HEIGHT = 0.15
SNAKE_BROW_RADIUS = 0.075
SNAKE_MOUTH_DROP = 0.05            # the mouth sits a little under the axis
SNAKE_TONGUE_LENGTH = 0.20         # at scale 1, fully out
SNAKE_TONGUE_FORK = 0.04           # half-spread of the fork tips

# -- Snappy the crocodile -----------------------------------------------------
CROC_LENGTH = 3.6                  # snout tip to tail tip, the spec's "3.6 m"
CROC_BODY_HALF_LENGTH = 0.62
CROC_BODY_HALF_WIDTH = 0.46
CROC_BODY_HALF_HEIGHT = 0.30
CROC_BELLY_LIFT = 0.14             # floor to the belly's underside
CROC_LEG_RADIUS = 0.13
CROC_HEAD_LENGTH = 1.18
CROC_HEAD_HALF_WIDTH = 0.33
CROC_HEAD_HALF_HEIGHT = 0.19
CROC_EYE_RADIUS = 0.13
CROC_JAW_HALF_HEIGHT = 0.085
CROC_BEAD_RADIUS = 0.05

# -- Grandpa Tock -------------------------------------------------------------
TORTOISE_SHELL_LENGTH = 1.2        # the spec's "Grandpa Tock 1.2 m"
TORTOISE_SHELL_WIDTH = 1.0
TORTOISE_PLASTRON_LIFT = 0.18      # floor to the belly plate; the Engineer's leg stubs fill it
TORTOISE_SHELL_TOP = 0.78
TORTOISE_HEAD_RADII = (0.13, 0.16, 0.12)
TORTOISE_NECK_RADIUS = 0.09

# -- the small reptiles -------------------------------------------------------
CHAMELEON_BODY_RADII = (0.12, 0.25, 0.15)
CHAMELEON_HEAD_RADII = (0.10, 0.13, 0.11)
CHAMELEON_TAIL_RADIUS = 0.055
FROG_BODY_RADII = (0.13, 0.15, 0.10)
FROG_EYE_RADIUS = 0.06
GECKO_LENGTH = 0.35
IGUANA_BODY_RADII = (0.14, 0.32, 0.14)
IGUANA_HEAD_RADII = (0.10, 0.14, 0.10)
SKINK_LENGTH = 0.9


# =============================================================================
# Shape helpers — shapes only, every number is passed in
# =============================================================================


def rot_x(deg: float) -> Matrix:
    return Matrix.Rotation(math.radians(deg), 4, "X")


def rot_y(deg: float) -> Matrix:
    return Matrix.Rotation(math.radians(deg), 4, "Y")


def rot_z(deg: float) -> Matrix:
    return Matrix.Rotation(math.radians(deg), 4, "Z")


def at(x=0.0, y=0.0, z=0.0, *rotations: Matrix) -> Matrix:
    """A placement matrix: translate, after applying ``rotations`` in order."""
    m = Matrix.Identity(4)
    for r in rotations:
        m = r @ m
    return Matrix.Translation((x, y, z)) @ m


def ellipsoid_y(rx: float, ry: float, rz: float, subdivisions: int = 2):
    """An ellipsoid whose **pole vertices lie on ±Y**, so its length is exact.

    :func:`blendkit.ellipsoid` puts the icosphere's poles on Z. A body or a
    snout lies along Y, and if its tips are not vertices the measured length
    comes out a few millimetres short of the figure it was built to — which
    is exactly the mismatch the contract assertion exists to catch, pointed
    at the wrong culprit. Rotating the sphere 90° about X puts a vertex on
    each end.
    """
    verts, faces = ellipsoid(rx, rz, ry, subdivisions)
    rot = rot_x(90.0)
    return [tuple(rot @ Vector(v)) for v in verts], faces


def tapered_sweep(points, radii, sides: int = 8):
    """A round tube swept along an open path with a radius per station.

    :func:`blendkit.sweep_path` is constant-radius, which is right for a rope
    and wrong for a tail. Same frame (tangent × up), same fan caps at both
    ends. The path is never vertical here so the frame never degenerates.
    """
    up = Vector((0.0, 0.0, 1.0))
    count = len(points)
    assert count == len(radii) and count >= 2
    verts = []
    for i in range(count):
        p = Vector(points[i])
        nxt = Vector(points[min(i + 1, count - 1)])
        prv = Vector(points[max(i - 1, 0)])
        tangent = (nxt - prv).normalized()
        side = tangent.cross(up)
        if side.length < 1e-6:
            side = tangent.cross(Vector((1.0, 0.0, 0.0)))
        side.normalize()
        normal = side.cross(tangent).normalized()
        for k in range(sides):
            a = k * TAU / sides
            verts.append(tuple(p + side * (math.cos(a) * radii[i]) + normal * (math.sin(a) * radii[i])))
    faces = []
    for i in range(count - 1):
        for k in range(sides):
            kn = (k + 1) % sides
            faces.append((i * sides + k, i * sides + kn, (i + 1) * sides + kn, (i + 1) * sides + k))
    faces.append(tuple(range(sides - 1, -1, -1)))
    faces.append(tuple(range((count - 1) * sides, count * sides)))
    return verts, faces


def leg(part: Part, x: float, y: float, z_top: float, radius: float, sides: int = 6, splay=(0.0, 0.0), z_bottom=None) -> None:
    """A stubby leg from the floor up into a belly — ART_DIRECTION §4's "short
    and fat". ``splay`` leans the top inward so the feet sit wider than the
    hips, which is what makes a lizard read as gripping the ground.

    A splayed leg's end ring tilts with it, and the low edge of a tilted ring
    dips under the floor by ``radius · sin(tilt)`` — the first build had every
    lizard standing 5 mm into its rock. So by default the foot is lifted by
    exactly that, and a leg that ends inside a drawn foot passes ``z_bottom``
    to start inside it instead."""
    if z_bottom is None:
        tilt = math.atan2(math.hypot(*splay), max(z_top, 1e-6))
        z_bottom = radius * math.sin(tilt) + 0.002
    bottom = Vector((x, y, z_bottom))
    top = Vector((x - splay[0], y - splay[1], z_top))
    verts, faces = tapered_sweep([tuple(bottom), tuple(top)], [radius, radius], sides)
    part.add(verts, faces)


def snake_face_uvs(obj, lo_x: float, hi_x: float, lo_z: float, hi_z: float) -> None:
    """The snake face's UV layout: a planar front projection, computed from
    **where each vertex is** after emit (the gate arch's lesson — a per-face
    table keyed by pre-weld index lands on the wrong polygons).

    This is the contract shared with ``rn-head`` and ``rh-head`` so one painted
    canvas fits all three heads:

    * **Front faces** (normal has no +Y component) take ``u`` from X across the
      head's full width and ``v`` from Z down its full height, the whole
      silhouette filling 0..1 — so the painter works in "head space": eyes at
      roughly u 0.3/0.7, the smile at v 0.7.
    * **Back faces** are parked at ``(0.02, 0.02)``, the same corner
      :meth:`blendkit.Part.emit` uses for unpainted faces. The canvas's corner
      pixel must be plain fill, and then the back of the head shows the
      material colour and nothing else. A full planar projection would put a
      mirrored face on the back of the skull.
    * ``v`` is ``(hi_z − z) / height`` because **Blender's glTF exporter
      writes 1 − v**; this cancels it so the eyes arrive above the smile.
    """
    mesh = obj.data
    width = max(hi_x - lo_x, 1e-6)
    height = max(hi_z - lo_z, 1e-6)
    layer = mesh.uv_layers.new(name="UVMap")
    for poly in mesh.polygons:
        front = poly.normal.y <= 1e-6
        for loop_index in poly.loop_indices:
            if not front:
                layer.data[loop_index].uv = (0.02, 0.02)
                continue
            co = mesh.vertices[mesh.loops[loop_index].vertex_index].co
            layer.data[loop_index].uv = ((co.x - lo_x) / width, (hi_z - co.z) / height)


# The Engineer's reading list: `{node: {anchor: (x, y, z) in Blender metres}}`.
# Filled by each builder from the figures that placed its vertices, printed at
# the end of the run, and the only place these positions are ever written.
ANCHORS: dict[str, dict[str, tuple]] = {}


def anchor(node: str, name: str, x: float, y: float, z: float, *extra) -> None:
    ANCHORS.setdefault(node, {})[name] = (round(x, 3), round(y, 3), round(z, 3)) + tuple(
        round(e, 3) for e in extra
    )


# =============================================================================
# 1. The snake head and tongue
# =============================================================================


def build_snake() -> None:
    """``rr-snake-head`` + ``rr-snake-tongue``: the one head every snake wears.

    Origin at the **neck joint** — the back-centre of the head, on the body's
    axis — not at a base, because a head on a segment chain is placed at the
    chain's last segment and turned to face its travel. It extends
    ``SNAKE_HEAD_LENGTH`` along −Y. The TS sizer group scales it to each
    snake: 0.42 m at scale 1 suits a body of radius ≈ 0.2 (the adults); a
    baby of radius 0.05 wears it at ≈ 0.3.

    Heart-shaped, not a plain egg: two brow bumps high on the front corners
    give the silhouette a broad forehead over the painted eyes (the eyes go
    *under* the brows, low and wide — ART_DIRECTION §4), and one small scale
    nub, off-centre, breaks the outline so the head is not a perfect oval.
    """
    coll = collection("snake")
    head = Part("rr-snake-head")
    half_len = SNAKE_HEAD_LENGTH * 0.5
    head.add(
        *ellipsoid_y(SNAKE_HEAD_HALF_WIDTH, half_len, SNAKE_HEAD_HALF_HEIGHT, 3),
        at(0.0, -half_len, 0.0),
    )
    brow_y = -SNAKE_HEAD_LENGTH * 0.66
    brow_z = SNAKE_HEAD_HALF_HEIGHT * 0.62
    for sx in (-1.0, 1.0):
        head.add(
            *ellipsoid(SNAKE_BROW_RADIUS * 1.15, SNAKE_BROW_RADIUS, SNAKE_BROW_RADIUS * 0.85, 2),
            at(sx * SNAKE_HEAD_HALF_WIDTH * 0.55, brow_y, brow_z),
        )
    # The asymmetric nub — "every head gets one feature that is not mirrored".
    head.add(
        *ellipsoid(0.045, 0.05, 0.035, 1),
        at(-SNAKE_HEAD_HALF_WIDTH * 0.3, -SNAKE_HEAD_LENGTH * 0.3, SNAKE_HEAD_HALF_HEIGHT * 0.9),
    )
    obj = head.emit(coll)
    lo, hi = head.bounds()
    snake_face_uvs(obj, lo.x, hi.x, lo.z, hi.z)

    mouth = (0.0, -SNAKE_HEAD_LENGTH + 0.02, -SNAKE_MOUTH_DROP)
    anchor("rr-snake-head", "neck-joint (origin)", 0.0, 0.0, 0.0)
    anchor("rr-snake-head", "mouth / tongue origin", *mouth)
    anchor("rr-snake-head", "painted eye centres (u,v)", 0.30, 0.42, 0.0, 0.70, 0.42)

    # The tongue: a forked ribbon emerging from the mouth, authored fully out.
    # Its node origin is the mouth, so `scale` along its length is the flick.
    tongue = Part("rr-snake-tongue")
    stem = SNAKE_TONGUE_LENGTH * 0.55
    tongue.add(*tapered_sweep([(0.0, 0.0, 0.0), (0.0, -stem, 0.0)], [0.014, 0.012], 4))
    for sx in (-1.0, 1.0):
        tongue.add(
            *tapered_sweep(
                [(0.0, -stem + 0.01, 0.0), (sx * SNAKE_TONGUE_FORK, -SNAKE_TONGUE_LENGTH, 0.012)],
                [0.012, 0.006],
                4,
            )
        )
    tongue.emit(coll, location=mouth)


# =============================================================================
# 2. Snappy the crocodile — four nodes about one origin
# =============================================================================


def croc_body_top(y: float) -> float:
    """Height of the body ellipsoid's back at station ``y`` (a ridge sits here)."""
    t = max(0.0, 1.0 - (y / CROC_BODY_HALF_LENGTH) ** 2)
    return CROC_BELLY_LIFT + CROC_BODY_HALF_HEIGHT + CROC_BODY_HALF_HEIGHT * math.sqrt(t)


def build_croc() -> None:
    """``rr-croc-body`` · ``rr-croc-head`` · ``rr-croc-jaw`` · ``rr-croc-tail``.

    All four are authored in **one frame**, origin on the floor under the
    body's centre, so the Engineer adds the four nodes to one group and the
    crocodile is assembled. The jaw and tail nodes carry their hinge as the
    node origin (export allows a pure translation and nothing else).

    Friendly by construction: the snout is a rounded loaf, not a wedge; the
    eyes are two big domes on top like a cartoon frog's; the lower jaw is
    the cream node (the belly colour), and its four "teeth" are beads.
    """
    coll = collection("croc")
    centre_z = CROC_BELLY_LIFT + CROC_BODY_HALF_HEIGHT

    body = Part("rr-croc-body")
    body.add(
        *ellipsoid_y(CROC_BODY_HALF_WIDTH, CROC_BODY_HALF_LENGTH, CROC_BODY_HALF_HEIGHT, 3),
        at(0.0, 0.0, centre_z),
    )
    for sx in (-1.0, 1.0):
        for sy in (-1.0, 1.0):
            x = sx * CROC_BODY_HALF_WIDTH * 0.95
            y = sy * CROC_BODY_HALF_LENGTH * 0.62
            leg(body, x, y, centre_z - 0.05, CROC_LEG_RADIUS, 6, splay=(sx * 0.12, 0.0), z_bottom=0.06)
            # A big round foot: ART_DIRECTION §4, "feet oversized".
            body.add(*ellipsoid(0.19, 0.21, 0.07, 1), at(x + sx * 0.04, y - 0.03, 0.07))
    # One row of soft ridges down the spine, the biggest in the middle.
    for i in range(5):
        y = (i - 2) * CROC_BODY_HALF_LENGTH * 0.42
        size = 0.11 - abs(i - 2) * 0.018
        body.add(*cone(size, size * 1.3, 6), at(0.0, y, croc_body_top(y) - size * 0.35))
    body.emit(coll)

    # The head sits forward of the body, its back inside the body's front so
    # there is no seam, snout tip exactly at −(head_len + body) for the
    # length assertion.
    head_back = -CROC_BODY_HALF_LENGTH * 0.72
    head_centre_y = head_back - CROC_HEAD_LENGTH * 0.5
    head_z = centre_z + 0.08
    head = Part("rr-croc-head")
    head.add(
        *ellipsoid_y(CROC_HEAD_HALF_WIDTH, CROC_HEAD_LENGTH * 0.5, CROC_HEAD_HALF_HEIGHT, 3),
        at(0.0, head_centre_y, head_z),
    )
    eye_y = head_back - CROC_HEAD_LENGTH * 0.22
    eye_z = head_z + CROC_HEAD_HALF_HEIGHT * 0.95
    for sx in (-1.0, 1.0):
        head.add(*icosphere(CROC_EYE_RADIUS, 2), at(sx * CROC_HEAD_HALF_WIDTH * 0.62, eye_y, eye_z))
        anchor("rr-croc-head", f"eye dome {'L' if sx < 0 else 'R'} (centre, r)",
               sx * CROC_HEAD_HALF_WIDTH * 0.62, eye_y, eye_z, CROC_EYE_RADIUS)
    # Two nostril bumps on the snout tip: the dot pair that makes a loaf a nose.
    for sx in (-1.0, 1.0):
        head.add(*icosphere(0.055, 1),
                 at(sx * 0.10, head_back - CROC_HEAD_LENGTH * 0.93, head_z + CROC_HEAD_HALF_HEIGHT * 0.75))
    head.emit(coll)
    snout_tip = head_back - CROC_HEAD_LENGTH
    anchor("rr-croc-head", "snout tip", 0.0, snout_tip, head_z)
    anchor("rr-croc-head", "smile patch (front of snout, centre)", 0.0, snout_tip + 0.12, head_z - 0.02)

    # The jaw: hinge at the back of the lower jaw, under the head. Authored
    # closed, lying flush under the snout; `rotation.x` drops it open.
    jaw_hinge = (0.0, head_back + 0.04, head_z - CROC_HEAD_HALF_HEIGHT * 0.55)
    jaw = Part("rr-croc-jaw")
    jaw_len = CROC_HEAD_LENGTH * 0.92
    jaw.add(
        *ellipsoid_y(CROC_HEAD_HALF_WIDTH * 0.92, jaw_len * 0.5, CROC_JAW_HALF_HEIGHT, 2),
        at(0.0, -jaw_len * 0.5, 0.0),
    )
    # Four beads along the jaw's rim — round, in the belly colour. No points.
    for sx in (-1.0, 1.0):
        for (fx, fy) in ((0.78, 0.45), (0.55, 0.80)):
            jaw.add(*icosphere(CROC_BEAD_RADIUS, 1),
                    at(sx * CROC_HEAD_HALF_WIDTH * fx, -jaw_len * fy, CROC_JAW_HALF_HEIGHT * 0.9))
    jaw.emit(coll, location=jaw_hinge)
    anchor("rr-croc-jaw", "hinge (node origin)", *jaw_hinge)

    # The tail: hinge at the body's rear, on the axis; sweeps back and a
    # little to one side ("nothing is plumb"), tapering to the floor.
    tail_hinge = (0.0, CROC_BODY_HALF_LENGTH * 0.8, centre_z)
    tail_len = CROC_LENGTH + snout_tip - tail_hinge[1]   # whatever the spec's 3.6 leaves
    assert tail_len > 0.9, f"the crocodile's tail would be only {tail_len:.2f} m"
    stations = [0.0, 0.25, 0.5, 0.72, 0.9, 1.0]
    pts = [(0.14 * s * s, tail_len * s, -(centre_z - 0.12) * s * s) for s in stations]
    radii = [0.27, 0.23, 0.17, 0.11, 0.06, 0.025]
    tail = Part("rr-croc-tail")
    tail.add(*tapered_sweep(pts, radii, 8))
    for s, r in zip(stations[:4], radii[:4]):
        p = pts[stations.index(s)]
        tail.add(*cone(r * 0.35, r * 0.5, 6), at(p[0], p[1], p[2] + r * 0.85))
    tail.emit(coll, location=tail_hinge)
    anchor("rr-croc-tail", "hinge (node origin)", *tail_hinge)
    anchor("rr-croc-body", "origin (floor under the body centre)", 0.0, 0.0, 0.0)


# =============================================================================
# 3. Grandpa Tock — shell and head
# =============================================================================

# (r, z) in a unit-radius frame; scaled to the shell's length and width below.
# Plastron underneath, a flared rim, then the dome. Closed on the axis at
# both ends so `revolve` makes a solid.
TORTOISE_PROFILE = [
    (0.00, 0.00),
    (0.55, 0.00),
    (0.78, 0.08),
    (0.92, 0.17),
    (1.00, 0.27),
    (0.96, 0.40),
    (0.84, 0.58),
    (0.62, 0.78),
    (0.34, 0.93),
    (0.00, 1.00),
]


def tortoise_dome_z(x: float, y: float) -> float:
    """Height of the shell's dome over floor point (x, y) — where a scute sits."""
    rx = TORTOISE_SHELL_WIDTH * 0.5
    ry = TORTOISE_SHELL_LENGTH * 0.5
    r = math.hypot(x / rx, y / ry)
    span = TORTOISE_SHELL_TOP - TORTOISE_PLASTRON_LIFT
    upper = [(pr, pz) for pr, pz in TORTOISE_PROFILE if pz >= 0.27]
    upper.sort(key=lambda p: -p[0])
    for (r0, z0), (r1, z1) in zip(upper, upper[1:]):
        if r1 <= r <= r0:
            t = (r0 - r) / max(r0 - r1, 1e-6)
            return TORTOISE_PLASTRON_LIFT + (z0 + (z1 - z0) * t) * span
    return TORTOISE_SHELL_TOP


def build_tortoise() -> None:
    """``rr-tortoise-shell`` (with its scutes) and ``rr-tortoise-head`` (hinged).

    Origin on the floor under the shell's centre. The plastron floats
    ``TORTOISE_PLASTRON_LIFT`` up; the Engineer's leg stubs fill the gap and
    carry the walk cycle. The head node's origin is the neck root at the
    shell's front opening, so "Tock stretches his neck" is a translation of
    that node along its −Y and the blink is a face swap.

    Scutes are seven hexagonal domes — one on top, six around — not a grid of
    plates: at the game's distance one big bumpy pattern reads as "tortoise"
    where thirteen small ones read as texture.
    """
    coll = collection("tortoise")
    shell = Part("rr-tortoise-shell")
    rx = TORTOISE_SHELL_WIDTH * 0.5
    ry = TORTOISE_SHELL_LENGTH * 0.5
    span = TORTOISE_SHELL_TOP - TORTOISE_PLASTRON_LIFT
    verts, faces = revolve([(r, z) for r, z in TORTOISE_PROFILE], 16)
    verts = [(v[0] * rx, v[1] * ry, TORTOISE_PLASTRON_LIFT + v[2] * span) for v in verts]
    shell.add(verts, faces)
    scutes = [(0.0, 0.0)] + [
        (math.cos(a) * rx * 0.55, math.sin(a) * ry * 0.55)
        for a in (i * TAU / 6 + TAU / 12 for i in range(6))
    ]
    for x, y in scutes:
        shell.add(*cone(0.17, 0.09, 6), at(x, y, tortoise_dome_z(x, y) - 0.025))
    shell.emit(coll)

    neck_root = (0.0, -ry * 0.82, TORTOISE_PLASTRON_LIFT + span * 0.36)
    head = Part("rr-tortoise-head")
    neck_end = (0.0, -0.24, 0.07)
    head.add(*tapered_sweep([(0.0, 0.0, 0.0), neck_end], [TORTOISE_NECK_RADIUS, TORTOISE_NECK_RADIUS * 0.9], 8))
    hrx, hry, hrz = TORTOISE_HEAD_RADII
    head_centre = (0.0, neck_end[1] - hry * 0.7, neck_end[2] + 0.05)
    head.add(*ellipsoid_y(hrx, hry, hrz, 3), at(*head_centre))
    head.emit(coll, location=neck_root)
    anchor("rr-tortoise-head", "hinge / neck root (node origin)", *neck_root)
    anchor("rr-tortoise-head", "head centre (relative to node), r", *head_centre, hrx)
    anchor("rr-tortoise-shell", "origin (floor under the shell centre)", 0.0, 0.0, 0.0)


# =============================================================================
# 4. The small reptiles — one node each
# =============================================================================


def build_chameleon() -> None:
    """``rr-chameleon-body``: body, casque-crested head, four gripping legs,
    and the spiral tail that is the whole reason it is authored geometry.

    Origin on the branch top under the body (she stands on a branch, so the
    Engineer places the node on `rp-branch`'s upper surface). Eyes are
    **not** in the mesh: the spec drives two independent eye spheres from TS,
    and their centres are in `ANCHORS`.
    """
    coll = collection("chameleon")
    part = Part("rr-chameleon-body")
    brx, bry, brz = CHAMELEON_BODY_RADII
    body_z = 0.2
    part.add(*ellipsoid_y(brx, bry, brz, 2), at(0.0, 0.0, body_z))
    hrx, hry, hrz = CHAMELEON_HEAD_RADII
    head_c = (0.0, -bry * 1.15, body_z + 0.06)
    part.add(*ellipsoid_y(hrx, hry, hrz, 2), at(*head_c))
    # The casque: a fin leaning back off the crown.
    part.add(*cone(0.065, 0.15, 6), at(head_c[0], head_c[1] + 0.03, head_c[2] + hrz * 0.75, rot_x(-28.0)))
    for sx in (-1.0, 1.0):
        anchor("rr-chameleon-body", f"eye sphere {'L' if sx < 0 else 'R'} (centre, r)",
               sx * hrx * 0.95, head_c[1] - hry * 0.1, head_c[2] + hrz * 0.3, 0.05)
    for sx in (-1.0, 1.0):
        for sy in (-1.0, 1.0):
            leg(part, sx * brx * 1.1, sy * bry * 0.55, body_z - 0.02, 0.035, 6, splay=(sx * 0.03, 0.0))
    # Spiral tail, curling down and under in the YZ plane behind the body.
    centre = Vector((0.0, bry * 1.3, body_z - 0.02))
    pts, radii = [], []
    steps = 13
    for i in range(steps):
        t = i / (steps - 1)
        a = math.pi + t * TAU * 1.55
        r = 0.13 * (1.0 - 0.78 * t)
        pts.append((0.02 * t, centre.y - math.cos(a) * r, centre.z + math.sin(a) * r))
        radii.append(CHAMELEON_TAIL_RADIUS * (1.0 - 0.85 * t) + 0.004)
    part.add(*tapered_sweep(pts, radii, 6))
    part.emit(coll)
    anchor("rr-chameleon-body", "head centre, r", *head_c, hrx)


def build_frog() -> None:
    """``rr-frog-body``: a squat body with two big eye domes and folded legs.
    Grapefruit-sized on purpose. Origin on the lily pad under the belly."""
    coll = collection("frog")
    part = Part("rr-frog-body")
    brx, bry, brz = FROG_BODY_RADII
    part.add(*ellipsoid_y(brx, bry, brz, 2), at(0.0, 0.0, brz))
    eye = (brx * 0.62, -bry * 0.45, brz * 1.9)
    for sx in (-1.0, 1.0):
        part.add(*icosphere(FROG_EYE_RADIUS, 2), at(sx * eye[0], eye[1], eye[2]))
        anchor("rr-frog-body", f"eye dome {'L' if sx < 0 else 'R'} (centre, r)", sx * eye[0], eye[1], eye[2], FROG_EYE_RADIUS)
    for sx in (-1.0, 1.0):
        # Front legs: little props. Back legs: folded haunches, flattened eggs.
        part.add(*tapered_sweep([(sx * brx * 0.75, -bry * 0.55, brz * 0.7), (sx * brx * 1.05, -bry * 0.85, 0.016)], [0.022, 0.02], 6))
        part.add(*ellipsoid(0.055, 0.09, 0.05, 1), at(sx * brx * 1.05, bry * 0.35, 0.05, rot_z(sx * 20.0)))
    part.emit(coll)
    anchor("rr-frog-body", "smile patch (front, centre), r", 0.0, -bry * 0.9, brz * 0.9, brx)


def build_gecko() -> None:
    """``rr-gecko-body``: a flat sausage with splayed legs and toe pads.
    Origin on the surface it clings to, under the belly — the Engineer
    orients the node to the wall or the glass."""
    coll = collection("gecko")
    part = Part("rr-gecko-body")
    L = GECKO_LENGTH
    stations = [-0.34, -0.26, -0.16, -0.06, 0.06, 0.2, 0.36, 0.5, 0.66]
    radii = [0.035, 0.05, 0.034, 0.048, 0.05, 0.042, 0.03, 0.018, 0.007]
    # Belly flat on the surface: each station rides on its own radius.
    pts = [(0.012 * max(0.0, s) * 2.0, s * L, r + 0.006) for s, r in zip(stations, radii)]
    part.add(*tapered_sweep(pts, radii, 8))
    for sx in (-1.0, 1.0):
        for sy, s in ((-1.0, -0.14), (1.0, 0.12)):
            hip = (sx * 0.035, s * L, 0.035)
            # A near-horizontal leg's end ring stands almost vertical, so the
            # ankle sits one leg-radius up and the pads sit on their own radius.
            foot = (sx * 0.10, s * L + sy * 0.04, 0.018)
            part.add(*tapered_sweep([hip, foot], [0.014, 0.011], 6))
            for k in (-1, 0, 1):
                a = math.atan2(foot[1] - hip[1], foot[0] - hip[0]) + k * 0.55
                part.add(*icosphere(0.013, 1), at(foot[0] + math.cos(a) * 0.028, foot[1] + math.sin(a) * 0.028, 0.014))
    part.emit(coll)
    anchor("rr-gecko-body", "head centre, r", pts[1][0], pts[1][1], pts[1][2], radii[1])


def build_skink() -> None:
    """``rr-skink-body``: Smudge — a fat glossy sausage with the stubbiest legs
    in the house. Origin on the floor under the belly. Her big blue tongue is
    the Engineer's (it is a tap reaction, built from a primitive)."""
    coll = collection("skink")
    part = Part("rr-skink-body")
    L = SKINK_LENGTH
    stations = [-0.44, -0.4, -0.3, -0.16, 0.0, 0.16, 0.3, 0.42, 0.5]
    radii = [0.055, 0.085, 0.1, 0.11, 0.11, 0.1, 0.075, 0.045, 0.018]
    # Each ring stands perpendicular to a sloping tangent where the radius
    # changes, so the belly sits a little over its own radius to stay on the floor.
    pts = [(0.05 * max(0.0, s) ** 2 * 4.0, s * L, r + 0.012) for s, r in zip(stations, radii)]
    part.add(*tapered_sweep(pts, radii, 8))
    for sx in (-1.0, 1.0):
        for s in (-0.22, 0.2):
            leg(part, sx * 0.13, s * L, 0.09, 0.028, 6, splay=(sx * 0.03, 0.0))
    part.emit(coll)
    anchor("rr-skink-body", "head centre, r", pts[1][0], pts[1][1], pts[1][2], radii[1])
    anchor("rr-skink-body", "mouth (tongue origin)", 0.0, stations[0] * L + 0.01, radii[0] * 0.6)


def build_iguana() -> None:
    """``rr-iguana-body``: body, head with a dewlap, a crest of soft spikes
    down the spine, a long tail curling to one side, four gripping legs.
    Origin on the rock under the belly."""
    coll = collection("iguana")
    part = Part("rr-iguana-body")
    brx, bry, brz = IGUANA_BODY_RADII
    body_z = 0.2
    part.add(*ellipsoid_y(brx, bry, brz, 2), at(0.0, 0.0, body_z))
    hrx, hry, hrz = IGUANA_HEAD_RADII
    head_c = (0.0, -bry * 1.2, body_z + 0.07)
    part.add(*ellipsoid_y(hrx, hry, hrz, 2), at(*head_c))
    # Dewlap: a soft rounded flap under the chin, in the YZ plane.
    flap = [(0.0, 0.0), (-0.16, -0.01), (-0.12, -0.11), (-0.02, -0.14)]
    part.add(*extrude_outline(flap, 0.03, (-0.08, -0.06)), at(head_c[0], head_c[1] + 0.02, head_c[2] - hrz * 0.6, rot_z(90.0)))
    # Crest: soft spikes from the nape to the tail root, tallest over the shoulders.
    for i in range(7):
        t = i / 6
        y = head_c[1] + hry * 0.6 + t * (bry * 1.5)
        h = 0.11 - abs(t - 0.3) * 0.09
        d = (y / bry)
        z = body_z + brz * math.sqrt(max(0.0, 1.0 - d * d)) if abs(d) < 1 else body_z + 0.02
        part.add(*cone(0.03, h, 6), at(0.0, y, z - 0.015, rot_x(18.0)))
    for sx in (-1.0, 1.0):
        for sy in (-1.0, 1.0):
            leg(part, sx * brx * 1.15, sy * bry * 0.6, body_z - 0.03, 0.045, 8, splay=(sx * 0.06, 0.0))
    stations = [0.0, 0.2, 0.42, 0.62, 0.8, 0.92, 1.0]
    tail_len = 0.5
    pts = [(0.3 * s * s, bry * 0.85 + tail_len * s, body_z - (body_z - 0.045) * s * s) for s in stations]
    radii = [0.11, 0.09, 0.07, 0.05, 0.035, 0.02, 0.008]
    part.add(*tapered_sweep(pts, radii, 6))
    part.emit(coll)
    anchor("rr-iguana-body", "head centre, r", *head_c, hrx)


# =============================================================================
# The contract, the table, the save
# =============================================================================

EXPECTED = {
    "rr-snake-head", "rr-snake-tongue",
    "rr-croc-head", "rr-croc-jaw", "rr-croc-body", "rr-croc-tail",
    "rr-tortoise-shell", "rr-tortoise-head",
    "rr-chameleon-body", "rr-frog-body", "rr-gecko-body", "rr-skink-body", "rr-iguana-body",
}


def world_bounds(names):
    """Bounds of several nodes **with their node translations applied** — the
    crocodile's length is a fact about four nodes, two of them hinged."""
    lo = Vector((1e9, 1e9, 1e9))
    hi = Vector((-1e9, -1e9, -1e9))
    for name in names:
        obj = bpy.data.objects[name]
        for v in obj.data.vertices:
            w = obj.matrix_world @ v.co
            lo = Vector((min(lo[i], w[i]) for i in range(3)))
            hi = Vector((max(hi[i], w[i]) for i in range(3)))
    return lo, hi


def verify() -> None:
    built = {o.name for o in bpy.data.objects if o.type == "MESH"}
    assert built == EXPECTED, f"built {sorted(built - EXPECTED)}, missing {sorted(EXPECTED - built)}"
    bpy.context.view_layer.update()

    # The one game-owned number: the snake head's length at scale 1.
    lo, hi = world_bounds(["rr-snake-head"])
    length = hi.y - lo.y
    assert abs(length - REPTILE_SNAKE_HEAD_LENGTH) < 2e-3, (
        f"rr-snake-head is {length:.4f} m long; layout.ts says REPTILE_SNAKE_HEAD_LENGTH = "
        f"{REPTILE_SNAKE_HEAD_LENGTH}"
    )
    assert abs(hi.y) < 1e-6, f"rr-snake-head's neck joint is at y={hi.y:+.4f}, not the origin"
    head = bpy.data.objects["rr-snake-head"]
    assert head.data.uv_layers, "rr-snake-head is PAINTED and has no UV layer"
    for name in EXPECTED - {"rr-snake-head"}:
        assert not bpy.data.objects[name].data.uv_layers, f"{name} is not PAINTED but carries UVs"

    # Snappy's length, assembled, is the spec's 3.6 m.
    lo, hi = world_bounds(["rr-croc-body", "rr-croc-head", "rr-croc-jaw", "rr-croc-tail"])
    assert abs((hi.y - lo.y) - CROC_LENGTH) < 0.02, f"the crocodile is {hi.y - lo.y:.3f} m, wanted {CROC_LENGTH}"
    assert lo.z > -1e-4, f"the crocodile dips {lo.z:+.3f} below its floor"

    lo, hi = world_bounds(["rr-tortoise-shell"])
    assert abs((hi.y - lo.y) - TORTOISE_SHELL_LENGTH) < 0.02, f"the shell is {hi.y - lo.y:.3f} m long"
    # The crown scute stands proud of the dome, so the shell tops out a little
    # over TORTOISE_SHELL_TOP — by one scute, never more.
    assert TORTOISE_SHELL_TOP <= hi.z < TORTOISE_SHELL_TOP + 0.1, f"the shell tops out at {hi.z:.3f}"

    sunk = []
    for name in sorted(EXPECTED - {"rr-snake-head", "rr-snake-tongue"}):
        lo, hi = world_bounds([name])
        if lo.z < -1e-4:
            sunk.append(f"{name} dips {lo.z:+.3f}")
    assert not sunk, "below their floors: " + "; ".join(sunk)



def main() -> None:
    reset_scene()
    build_snake()
    build_croc()
    build_tortoise()
    build_chameleon()
    build_frog()
    build_gecko()
    build_skink()
    build_iguana()
    verify()

    print("\nreptile_creatures_build")
    print(f"  REPTILE_SNAKE_HEAD_LENGTH (layout.ts) = {REPTILE_SNAKE_HEAD_LENGTH}")
    print(summarise())
    print(f"  {total_triangles()} triangles in {len(bpy.data.objects)} nodes (budget {TRIANGLE_BUDGET})")
    print("\n  anchors (Blender metres: x right, −y forward, z up; glTF = (x, z, −y)):")
    for node in sorted(ANCHORS):
        for name, value in ANCHORS[node].items():
            print(f"    {node:<20} {name:<42} {value}")
    hinged = [o for o in bpy.data.objects if o.location.length > 1e-6]
    print("\n  hinge-origin nodes:")
    for obj in sorted(hinged, key=lambda o: o.name):
        print(f"    {obj.name:<20} origin at ({obj.location.x:+.3f}, {obj.location.y:+.3f}, {obj.location.z:+.3f})")

    # Last, after the table, so a run that is over budget still shows where
    # the triangles went.
    tris = total_triangles()
    assert tris <= TRIANGLE_BUDGET, f"{tris} triangles is over the kit's {TRIANGLE_BUDGET} budget"

    bpy.ops.wm.save_as_mainfile(filepath=BLEND)
    print(f"\n  saved {BLEND}\n")


if __name__ == "__main__":
    try:
        main()
    except Exception:
        traceback.print_exc()
        sys.exit(1)
