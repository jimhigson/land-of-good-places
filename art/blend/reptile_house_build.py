"""Builds the Reptile House's exterior — "Sunny, the snake who is the building"
— and saves ``art/blend/reptile_house.blend``.

    blender --background --factory-startup --python-exit-code 1 \\
        --python art/blend/reptile_house_build.py

Jim, 2026-10-02: *"The outside of the building should be snake-themed too."*
GAME_DESIGN's novelty-architecture rule, taken literally: a friendly mint
snake coiled round a cream greenhouse, her head resting on top looking at the
camera (sunbathing — that is why she is on the roof), her tail curling down
beside the door as the signpost. Spec: ``docs/design/REPTILE-HOUSE.md`` §2.

## What this file owns, and what it asks for

Like ``gate_arch_build.py``: **the mesh owns its own shape numbers** (coil
pitch, tube radii, where the portholes sit) and asserts them against the
emitted vertices at the end of every run. The numbers that are **shared with
the game** are not typed here at all — they come through
``reptile_constants.py``, which reads them out of
``src/world/reptileHouse/layout.ts`` with :func:`blendkit.ts_const`:

* ``REPTILE_SHELL_RADIUS`` — the plinth's circumradius, and the exterior
  collision ring's radius. Mesh and collider are one number.
* ``REPTILE_TAIL_REACH`` / ``REPTILE_TAIL_BEARING_OFFSET`` — where the tail
  signpost stands on the ground (its ``addCircle`` collider is placed there).
* ``REPTILE_ARCH_WIDTH`` / ``REPTILE_ARCH_HEIGHT`` — the snake-hole's clear
  opening, asserted ≥ the doorway (``DOOR_HALF``) and the tallest hat
  (``TALLEST_CHILD_HEIGHT``) in ``reptile_constants.py`` before any mesh is
  built.
* ``REPTILE_DRAWN_DOOR_ALONG`` — the arch's mouth is at least this far out, so
  the paving the plot lays reaches it.
* ``REPTILE_BOUNDING_RADIUS`` — nothing in the kit reaches past it.

## The door is her mouth

Jim, 2 October 2026, on seeing the first cut's snake hole beside a head on
the roof: *"Why beside the door and not the door as its mouth? That sounds
cooler so do that."* So the head lies on the ground in front of the plinth,
chin down, mouth open — the bore through it is the game's
``REPTILE_ARCH_WIDTH × REPTILE_ARCH_HEIGHT`` doorway, lined pink
(``rh-mouth``, a boolean of the old arch tunnel with the head), the tongue
(``rh-tongue``) lolling out of it over the plinth's edge onto the paving as
the doormat, and the eyes above the mouth. Cute, smiley, no teeth.

The body still has to get past its own door. The helix starts just past it
(the tail's bearing, ``REPTILE_TAIL_BEARING_OFFSET`` degrees round) and winds
**away**, so the bottom turn never crosses the doorway; the pass over the
door comes 0.92 turns later and carries a smooth **hump** at the door
bearing, tall enough to clear the crown of the head below it. The helix ends
a little short of the door on its second lap, and the neck lifts up over that
humped pass and dives down into the back of the crown — Sunny has reached
round her own body to lay her head at your feet. Every clearance (coil over
head, neck over coil, tail beside head) is measured off the emitted vertices
below, not trusted.

## Conventions (ART_DIRECTION §7)

* 1 Blender unit = 1 metre; origin on the ground at the building's centre.
* **Blender −Y is the game's +Z**: the door, the head and the leaf awning all
  face −Y here. The plot is ``cameraFacing``, so in the park that is the
  camera's diagonal.
* Every node is baked into vertex positions and leaves at an identity
  transform, with one exception the export script allows: ``rh-tongue`` is
  emitted with its node origin at its root on the mouth's floor, so the game
  can wag it a few degrees with no pivot arithmetic (the castle chest-lid
  precedent).
* No two faces share a plane (``check:coplanar``). Parts interpenetrate
  rather than touch; the start caps of the coil, belly and tail are each
  buried inside another tube at a different angle.
* Shape only — no colour, no material. ``reptileHouseAssets.ts`` owns the
  colour table; ``reptile_house_render.py`` previews it by parsing that file.
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
    box,
    collection,
    ellipsoid,
    reset_scene,
    revolve,
    summarise,
    total_triangles,
    tube,
)
from gate_arch_build import paint_planar_uvs  # noqa: E402
from reptile_constants import (  # noqa: E402
    SUNNY_FACE_EYE_ROW,
    REPTILE_ARCH_HEIGHT,
    REPTILE_ARCH_WIDTH,
    REPTILE_BOUNDING_RADIUS,
    REPTILE_DRAWN_DOOR_ALONG,
    REPTILE_SHELL_RADIUS,
    REPTILE_TAIL_BEARING_OFFSET,
    REPTILE_TAIL_REACH,
    TALLEST_CHILD_HEIGHT,
)

BLEND = os.path.join(REPO, "art", "blend", "reptile_house.blend")

# ---------------------------------------------------------------- bearings
#
# Blender XY angles, measured from +X anticlockwise. The door faces −Y.

DOOR_BEARING = -math.pi / 2
#: The tail stands this way round from the door, on the +X side. The helix
#: starts here too and winds anticlockwise, i.e. away from the door.
TAIL_BEARING = DOOR_BEARING + math.radians(REPTILE_TAIL_BEARING_OFFSET)

# ------------------------------------------------------------------ plinth

PLINTH_SIDES = 16
PLINTH_H = 0.3
#: The ground she walks on through the arch: the plinth's top.
FLOOR = PLINTH_H

# -------------------------------------------------------------------- coil
#
# A helix of `COIL_TURNS` turns winding up and inward from the tail. The
# ring radius, the height and the tube radius are all linear in the turn
# count, plus the door hump described in the docstring.

#: Short of two laps: the body ends on the second lap a little before the
#: door bearing, where the neck takes over (`body_path`).
COIL_TURNS = 1.86
COIL_RING_R0 = 8.1
#: How much the ring tightens per turn.
COIL_RING_STEP = 0.9
COIL_Z0 = 1.3
#: Height gained per turn. With the ring stepping in by 0.9 the centre-to-
#: centre distance between stacked turns is √(3.2² + 0.9²) = 3.32 m against
#: tube radii summing to ≈ 2.4, which leaves ~0.9 m of greenhouse wall showing
#: between coils — that is where the portholes go.
COIL_PITCH = 3.2
COIL_TUBE_R0 = 1.3
COIL_TUBE_R1 = 1.0
COIL_SIDES = 16
COIL_STEPS_PER_TURN = 36

#: The hump over the door: a raised-cosine window this wide either side of the
#: door bearing, lifting the body by `HUMP_H` on the first pass — clear over
#: the crown of the head lying below it (`check_head_clearance`) — and
#: `HUMP_SECOND_PASS` of that on the second, so the two passes stay snug
#: where the helix ends.
HUMP_HALF_WINDOW = math.radians(60.0)
HUMP_H = 3.5
HUMP_SECOND_PASS = 0.7

#: The neck: from the helix end, up over the first pass, down into the crown.
NECK_R1 = 0.85

#: The belly stripe: a thinner tube on the same path, pushed down and outward
#: so a cream band shows along the lower outer flank of every coil from the
#: game's 38° camera (a belly on the true underside would be invisible).
BELLY_SCALE = 0.86
BELLY_OFFSET = 0.3
BELLY_SIDES = 6

SPOT_COUNT = 14
SPOT_SIZE = (0.62, 0.44, 0.15)

# ------------------------------------------------------------------- house
#
# The cream greenhouse the coils wrap: a surface of revolution the coils bite
# into, closing in a dome under the head.

HOUSE_PROFILE = [
    (0.0, 0.2),
    (7.0, 0.2),
    (7.0, 2.4),
    (6.6, 4.4),
    (6.0, 6.2),
    (5.1, 7.5),
    (3.8, 8.3),
    (2.0, 8.65),
    (0.0, 8.75),
]
HOUSE_SEGMENTS = 28

#: Twelve portholes, six per band of visible wall, as helix-turn fractions:
#: each sits halfway (in height) between the coil pass below it and the one
#: above, on the bearing that turn fraction gives.
PORTHOLE_TURNS = [0.10, 0.22, 0.34, 0.46, 0.58, 0.70, 1.08, 1.18, 1.28, 1.38, 1.48, 1.58]
PORTHOLE_R_IN = 0.36
PORTHOLE_R_OUT = 0.50
PORTHOLE_DEPTH = 0.26
#: How far the frame's outer face stands proud of the wall.
PORTHOLE_PROUD = 0.22
PORTHOLE_SEGMENTS = 10

# -------------------------------------------------------------------- head

#: A wide, flattish snake head big enough to hold the doorway in its open
#: mouth with the eyes above it: 8.4 wide, 4.6 deep, and sunk two metres into
#: the ground so its chin spreads wide at ground level where the mouth is
#: (a round head sitting *on* the ground is only 1.8 m wide at its base).
HEAD_RX, HEAD_RY, HEAD_RZ = 4.2, 2.3, 4.4
#: Head centre: in front of the plinth with the back of the head buried in
#: the greenhouse wall, the mouth's lips just inside `REPTILE_BOUNDING_RADIUS`.
HEAD_CENTRE = Vector((0.0, -8.5, 2.0))

#: The bore through the head is the old snake hole's outline (`arch_outline`):
#: legs straight down to the plinth's top so the full `REPTILE_ARCH_WIDTH` is
#: clear at ankle height, a semicircle on top. It is lined pink `ARCH_LIP`
#: thick (`rh-mouth`) — the lining shows on the face as lips — and the head's
#: own hole is cut `LIP_BURY` smaller than the lining's outer skin, so the
#: skin sits inside the flesh and no two faces share a plane.
ARCH_LIP = 0.4
LIP_BURY = 0.04
ARCH_SEGMENTS = 24
#: Where the bore ends at the back: just inside the greenhouse wall (r 7.0 at
#: the door, 6.68 at the bore's corners), so the mouth is an alcove closed by
#: the house, as the snake hole was; the back-wall collider stops her first.
ARCH_BACK_Y = -(HOUSE_PROFILE[1][0] - 0.4)
#: Both cutters start out here, well in front of the head's front-most point.
ARCH_FRONT_Y = -(REPTILE_BOUNDING_RADIUS + 1.0)
#: The stone-less join: behind the head's back surface the lining runs on to
#: the house wall as a plain collar, within this box.
COLLAR_BACK_Y = HEAD_CENTRE.y

#: The tongue: a flat pink ribbon from the mouth's floor on the plinth, out
#: over the plinth's edge and down onto the paving, forking at its tip — the
#: doormat. Its node origin is its root on the plinth; the game wags it there.
TONGUE_ROOT = Vector((0.0, -8.0, 0.0))
TONGUE_THICK = 0.08
#: Standing off the plinth top and the paving by more than a centimetre, so
#: `check:coplanar` has no stand-off to report.
TONGUE_LIFT = 0.06

# -------------------------------------------------------------------- tail
#
# From the bottom of the coil, out and down to the ground at
# `REPTILE_TAIL_REACH`, then an S-curve rising to the bell. The signpost
# plank hangs off the lower bend.

TAIL_RISE = 4.0
TAIL_TIP_R = 0.2
TAIL_SIDES = 10
BELL_R = 0.36

SIGN_W, SIGN_H, SIGN_D = 1.7, 0.85, 0.08
#: Where the plank hangs, measured along the rising tail.
SIGN_Z = 2.35


# =============================================================================
# A sweep with a rotation-minimising frame and a radius per point
# =============================================================================


def sweep_varying(points, radii, sides):
    """A round tube along a 3-D path, tapering as ``radii`` says.

    ``blendkit.sweep_path`` is for planar paths with a constant radius, and
    its frame (tangent × a fixed up) folds flat where the tangent lines up with
    that up — which a tail rising vertically does. This one carries the frame
    along the path by double reflection (Wang et al.'s rotation-minimising
    frame), so a helix, a neck arcing over a dome and a vertical S-curve all
    come out untwisted. Fan caps at both ends.
    """
    pts = [Vector(p) for p in points]
    count = len(pts)
    assert count == len(radii) >= 2
    tangents = []
    for i in range(count):
        nxt = pts[min(i + 1, count - 1)]
        prv = pts[max(i - 1, 0)]
        tangents.append((nxt - prv).normalized())
    # Seed the frame with any vector not parallel to the first tangent.
    seed = Vector((0.0, 0.0, 1.0))
    if abs(tangents[0].dot(seed)) > 0.9:
        seed = Vector((1.0, 0.0, 0.0))
    normal = (seed - tangents[0] * seed.dot(tangents[0])).normalized()
    verts = []
    for i in range(count):
        if i > 0:
            v1 = pts[i] - pts[i - 1]
            c1 = v1.dot(v1)
            if c1 > 1e-12:
                r_l = normal - v1 * (2.0 / c1) * v1.dot(normal)
                t_l = tangents[i - 1] - v1 * (2.0 / c1) * v1.dot(tangents[i - 1])
                v2 = tangents[i] - t_l
                c2 = v2.dot(v2)
                normal = r_l - v2 * (2.0 / c2) * v2.dot(r_l) if c2 > 1e-12 else r_l
        binormal = tangents[i].cross(normal).normalized()
        for k in range(sides):
            a = k * TAU / sides
            verts.append(tuple(pts[i] + normal * (math.cos(a) * radii[i]) + binormal * (math.sin(a) * radii[i])))
    faces = []
    for i in range(count - 1):
        for k in range(sides):
            kn = (k + 1) % sides
            faces.append((i * sides + k, i * sides + kn, (i + 1) * sides + kn, (i + 1) * sides + k))
    faces.append(tuple(range(sides - 1, -1, -1)))
    faces.append(tuple(range((count - 1) * sides, count * sides)))
    return verts, faces


# =============================================================================
# The body's path
# =============================================================================


def hump(angle: float, turns: float) -> float:
    """How far the body lifts at ``angle`` (radians) on turn ``turns``."""
    delta = (angle - DOOR_BEARING + math.pi) % TAU - math.pi
    if abs(delta) >= HUMP_HALF_WINDOW:
        return 0.0
    window = 0.5 * (1.0 + math.cos(math.pi * delta / HUMP_HALF_WINDOW))
    return HUMP_H * window * (1.0 if turns < 1.5 else HUMP_SECOND_PASS)


def helix_at(t: float):
    """Centre line and tube radius at ``t`` turns from the tail."""
    angle = TAIL_BEARING + t * TAU
    ring = COIL_RING_R0 - COIL_RING_STEP * t
    z = COIL_Z0 + COIL_PITCH * t + hump(angle, t)
    radius = COIL_TUBE_R0 + (COIL_TUBE_R1 - COIL_TUBE_R0) * (t / COIL_TURNS)
    return Vector((ring * math.cos(angle), ring * math.sin(angle), z)), radius, angle


def helix_outward(t: float) -> Vector:
    angle = TAIL_BEARING + t * TAU
    return Vector((math.cos(angle), math.sin(angle), 0.0))


def catmull_rom(points, samples_per_span: int):
    """Uniform Catmull-Rom through ``points`` (endpoints repeated)."""
    pts = [Vector(points[0])] + [Vector(p) for p in points] + [Vector(points[-1])]
    out = []
    for i in range(1, len(pts) - 2):
        p0, p1, p2, p3 = pts[i - 1], pts[i], pts[i + 1], pts[i + 2]
        for s in range(samples_per_span):
            u = s / samples_per_span
            out.append(
                0.5 * ((2 * p1) + (-p0 + p2) * u + (2 * p0 - 5 * p1 + 4 * p2 - p3) * u * u + (-p0 + 3 * p1 - 3 * p2 + p3) * u * u * u)
            )
    out.append(Vector(points[-1]))
    return out


def body_path():
    """The coil and the neck as one (points, radii) pair."""
    steps = int(round(COIL_TURNS * COIL_STEPS_PER_TURN))
    points, radii = [], []
    for i in range(steps + 1):
        p, r, _ = helix_at(COIL_TURNS * i / steps)
        points.append(p)
        radii.append(r)
    end, end_r, _ = helix_at(COIL_TURNS)
    # The neck: from the helix end on the second lap, just short of the door,
    # forward and up over the humped first pass, then down into the back of
    # the crown — the last knot is buried in the head so the end cap is hidden.
    crown = HEAD_CENTRE + Vector((0.0, -0.5, HEAD_RZ * 0.8))
    neck_knots = [
        end,
        Vector((end.x * 0.7, HEAD_CENTRE.y + 0.9, end.z + 1.8)),
        Vector((end.x * 0.25, HEAD_CENTRE.y - 1.0, end.z + 0.8)),
        Vector((0.0, HEAD_CENTRE.y - 1.0, crown.z + 1.6)),
        crown,
    ]
    neck = catmull_rom(neck_knots, 4)[1:]
    for i, p in enumerate(neck):
        u = (i + 1) / len(neck)
        points.append(p)
        radii.append(end_r + (NECK_R1 - end_r) * u)
    return points, radii


# =============================================================================
# The parts
# =============================================================================


def build_plinth(coll):
    # A flat centred on the door: vertex `i` sits at spin + i·2π/16, so the
    # door bearing lands midway between two vertices.
    spin = DOOR_BEARING - math.pi / PLINTH_SIDES
    verts, faces = tube(REPTILE_SHELL_RADIUS, PLINTH_H, PLINTH_SIDES, 0.0, spin)
    return Part("rh-plinth").add(verts, faces).emit(coll, smooth=False)


def build_coil(coll):
    points, radii = body_path()
    verts, faces = sweep_varying(points, radii, COIL_SIDES)
    coil = Part("rh-coil").add(verts, faces).emit(coll)

    belly_pts = []
    belly_r = []
    for i, p in enumerate(points):
        # Down and outward: outward is radial for the helix, and for the neck
        # (which crosses the centre) the same radial reads as "away from the
        # dome's axis", which is still the visible flank.
        radial = Vector((p.x, p.y, 0.0))
        radial = radial.normalized() if radial.length > 0.3 else Vector((0.0, -1.0, 0.0))
        shift = (radial * 0.7 + Vector((0.0, 0.0, -1.0)) * 0.7).normalized() * (radii[i] * BELLY_OFFSET)
        belly_pts.append(p + shift)
        belly_r.append(radii[i] * BELLY_SCALE)
    bverts, bfaces = sweep_varying(belly_pts, belly_r, BELLY_SIDES)
    belly = Part("rh-coil-belly").add(bverts, bfaces).emit(coll)

    spots = Part("rh-coil-spots")
    sv, sf = ellipsoid(*SPOT_SIZE, subdivisions=2)
    for i in range(SPOT_COUNT):
        t = COIL_TURNS * (i + 0.5) / SPOT_COUNT
        p, r, angle = helix_at(t)
        outward = helix_outward(t)
        # Alternate the spots between the top and the outer shoulder so the
        # row does not read as a stripe.
        up_mix = 0.9 if i % 2 == 0 else 0.45
        normal = (outward * (1.0 - up_mix) + Vector((0.0, 0.0, 1.0)) * up_mix).normalized()
        along = Vector((-math.sin(angle), math.cos(angle), 0.0))
        side = normal.cross(along).normalized()
        along = side.cross(normal).normalized()
        basis = Matrix((
            (along.x, side.x, normal.x, 0.0),
            (along.y, side.y, normal.y, 0.0),
            (along.z, side.z, normal.z, 0.0),
            (0.0, 0.0, 0.0, 1.0),
        ))
        spots.add(sv, sf, Matrix.Translation(p + normal * (r * 0.9)) @ basis)
    spots_obj = spots.emit(coll)
    return coil, belly, spots_obj


def house_radius_at(z: float) -> float:
    """The greenhouse wall's radius at height ``z``, off `HOUSE_PROFILE`."""
    prof = HOUSE_PROFILE[1:]
    for (r0, z0), (r1, z1) in zip(prof, prof[1:]):
        if z0 <= z <= z1:
            u = (z - z0) / max(z1 - z0, 1e-6)
            return r0 + (r1 - r0) * u
    return prof[-1][0]


def build_house(coll):
    verts, faces = revolve(HOUSE_PROFILE, HOUSE_SEGMENTS)
    wall = Part("rh-house-wall").add(verts, faces)

    windows = Part("rh-windows")
    ring_profile = [
        (PORTHOLE_R_IN, -PORTHOLE_DEPTH * 0.5),
        (PORTHOLE_R_OUT, -PORTHOLE_DEPTH * 0.5),
        (PORTHOLE_R_OUT, PORTHOLE_DEPTH * 0.5),
        (PORTHOLE_R_IN, PORTHOLE_DEPTH * 0.5),
    ]
    rv, rf = revolve(ring_profile, PORTHOLE_SEGMENTS)
    # A pane: a disc just inside the ring, set back from its outer face.
    pane_r = PORTHOLE_R_IN + 0.04
    pv = [
        (pane_r * math.cos(s * TAU / PORTHOLE_SEGMENTS), pane_r * math.sin(s * TAU / PORTHOLE_SEGMENTS), 0.0)
        for s in range(PORTHOLE_SEGMENTS)
    ]
    pf = [tuple(range(PORTHOLE_SEGMENTS)), tuple(range(PORTHOLE_SEGMENTS - 1, -1, -1))]
    frames = []
    for t in PORTHOLE_TURNS:
        p, _, angle = helix_at(t)
        z = p.z + COIL_PITCH * 0.5
        radial = Vector((math.cos(angle), math.sin(angle), 0.0))
        wall_r = house_radius_at(z)
        # The frame's axis follows the wall's own slope, so a porthole on the
        # dome's shoulder sits square to the surface rather than jutting out.
        slope = (house_radius_at(z + 0.05) - house_radius_at(z - 0.05)) / 0.1
        normal = (radial + Vector((0.0, 0.0, -slope))).normalized()
        centre = radial * wall_r + Vector((0.0, 0.0, z)) + normal * (PORTHOLE_PROUD - PORTHOLE_DEPTH * 0.5)
        basis = normal.to_track_quat("Z", "Y").to_matrix().to_4x4()
        placed = Matrix.Translation(centre) @ basis
        wall.add(rv, rf, placed)
        windows.add(pv, pf, Matrix.Translation(centre + normal * 0.05) @ basis)
        frames.extend(placed @ Vector(v) for v in rv)
    return wall.emit(coll), windows.emit(coll), frames


def paint_face_uvs(obj, centre: Vector, rx: float, rz: float):
    """Planar face UVs on the front (−Y) hemisphere; the back tucked away.

    The same two conventions as :func:`gate_arch_build.paint_planar_uvs`, and
    that docstring is the owner of why: ``u`` runs with ``x`` (the viewer's
    right), and ``v`` is ``(hi − z) / h`` to cancel the exporter's ``1 − v``.
    The back of the head is not painted — a face projected straight through a
    sphere would print a mirrored face on the back of her skull — so every
    face whose normal points away from the viewer is parked on one corner of
    the canvas, which the painter leaves as plain body colour.
    """
    mesh = obj.data
    lo_x, hi_x = centre.x - rx, centre.x + rx
    lo_z, hi_z = centre.z - rz, centre.z + rz
    width, height = hi_x - lo_x, hi_z - lo_z
    layer = mesh.uv_layers.new(name="UVMap")
    for poly in mesh.polygons:
        front = poly.normal.y < -0.02
        for loop_index in poly.loop_indices:
            if not front:
                layer.data[loop_index].uv = (0.02, 0.02)
                continue
            co = mesh.vertices[mesh.loops[loop_index].vertex_index].co
            layer.data[loop_index].uv = ((co.x - lo_x) / width, (hi_z - co.z) / height)


def apply_boolean(obj, other, operation: str) -> None:
    """``obj = obj <operation> other``, applied in place with the exact solver."""
    modifier = obj.modifiers.new("bool", "BOOLEAN")
    modifier.operation = operation
    modifier.object = other
    modifier.solver = "EXACT"
    with bpy.context.temp_override(object=obj, active_object=obj, selected_objects=[obj]):
        bpy.ops.object.modifier_apply(modifier=modifier.name)


def tunnel(outer: float, y0: float, y1: float):
    """A closed solid round the mouth's outline: the bore widened by ``outer``
    on every side, extruded along Y from ``y0`` to ``y1``. ``outer`` 0 is the
    bore itself (the cutter); `ARCH_LIP` is the lining's skin."""
    outline, _ = arch_outline()
    count = len(outline)
    verts = []
    for i, (x, z) in enumerate(outline):
        xa, za = outline[max(i - 1, 0)]
        xb, zb = outline[min(i + 1, count - 1)]
        tx, tz = xb - xa, zb - za
        length = math.hypot(tx, tz) or 1.0
        nx, nz = tz / length, -tx / length
        if nx * x + nz * (z - (FLOOR + REPTILE_ARCH_HEIGHT * 0.5)) < 0:
            nx, nz = -nx, -nz
        verts.append((x + nx * outer, y0, z + nz * outer))
        verts.append((x + nx * outer, y1, z + nz * outer))
    faces = []
    for i in range(count - 1):
        a, b = 2 * i, 2 * i + 1
        c, d = 2 * (i + 1) + 1, 2 * (i + 1)
        faces.append((a, b, c, d))
    # The legs' bottoms, below the floor, and the two side faces of the
    # open-bottomed outline: close the solid with a floor strip.
    floor = [(count - 1) * 2, (count - 1) * 2 + 1, 1, 0]
    faces.append(tuple(floor))
    front = [2 * i for i in range(count)]
    back = [2 * i + 1 for i in range(count - 1, -1, -1)]
    faces.append(tuple(front))
    faces.append(tuple(back))
    return verts, faces


def build_head(coll):
    """The head on the ground with the doorway through it, the pink lining
    and the tongue. Three booleans, all against an uncut copy of the head:

    * ``rh-head`` = head − tunnel(`ARCH_LIP` − `LIP_BURY`)
    * ``rh-mouth`` = tunnel(`ARCH_LIP`) ∩ (head ∪ collar) − tunnel(0)
    """
    hv, hf = ellipsoid(HEAD_RX, HEAD_RY, HEAD_RZ, subdivisions=4)
    head = Part("rh-head").add(hv, hf, Matrix.Translation(HEAD_CENTRE)).emit(coll)
    clip = Part("tmp-clip").add(hv, hf, Matrix.Translation(HEAD_CENTRE)).emit(coll)
    # The collar: the bit of lining between the head's back surface and the
    # greenhouse wall, a box the lining is clipped to behind the head.
    half_w = REPTILE_ARCH_WIDTH * 0.5 + ARCH_LIP + 0.3
    cv, cf = box(half_w * 2, COLLAR_BACK_Y - ARCH_BACK_Y, FLOOR + REPTILE_ARCH_HEIGHT + ARCH_LIP + 1.0)
    collar = Part("tmp-collar").add(
        cv, cf, Matrix.Translation(Vector((0.0, (COLLAR_BACK_Y + ARCH_BACK_Y) * 0.5, (FLOOR + REPTILE_ARCH_HEIGHT + ARCH_LIP + 1.0) * 0.5 - 0.6)))
    ).emit(coll, smooth=False)
    apply_boolean(clip, collar, "UNION")

    hole = Part("tmp-hole").add(*tunnel(ARCH_LIP - LIP_BURY, ARCH_FRONT_Y, ARCH_BACK_Y)).emit(coll, smooth=False)
    apply_boolean(head, hole, "DIFFERENCE")

    mouth = Part("rh-mouth").add(*tunnel(ARCH_LIP, ARCH_FRONT_Y, ARCH_BACK_Y)).emit(coll)
    apply_boolean(mouth, clip, "INTERSECT")
    bore = Part("tmp-bore").add(*tunnel(0.0, ARCH_FRONT_Y - 1.0, ARCH_BACK_Y + 0.1)).emit(coll, smooth=False)
    apply_boolean(mouth, bore, "DIFFERENCE")
    # The bore cutter was pushed `0.1` past the back so the lining has a
    # 0.1 m back annulus and the back face of the bore itself: the mouth is
    # an alcove closed by the lining, like the snake hole was by the wall.

    for tmp in (clip, collar, hole, bore):
        mesh = tmp.data
        bpy.data.objects.remove(tmp, do_unlink=True)
        bpy.data.meshes.remove(mesh)

    paint_face_uvs(head, HEAD_CENTRE, HEAD_RX, HEAD_RZ)
    tongue = build_tongue(coll)
    return head, mouth, tongue


def sweep_flat(points, half_widths, half_thick: float, sides: int = 8):
    """A flat ribbon: `sweep_varying`'s frame with an elliptical section,
    ``half_widths`` across and ``half_thick`` through."""
    pts = [Vector(p) for p in points]
    count = len(pts)
    tangents = []
    for i in range(count):
        nxt = pts[min(i + 1, count - 1)]
        prv = pts[max(i - 1, 0)]
        tangents.append((nxt - prv).normalized())
    up = Vector((0.0, 0.0, 1.0))
    verts = []
    for i in range(count):
        side = tangents[i].cross(up).normalized()
        normal = side.cross(tangents[i]).normalized()
        for k in range(sides):
            a = k * TAU / sides
            verts.append(tuple(pts[i] + side * (math.cos(a) * half_widths[i]) + normal * (math.sin(a) * half_thick)))
    faces = []
    for i in range(count - 1):
        for k in range(sides):
            kn = (k + 1) % sides
            faces.append((i * sides + k, i * sides + kn, (i + 1) * sides + kn, (i + 1) * sides + k))
    faces.append(tuple(range(sides - 1, -1, -1)))
    faces.append(tuple(range((count - 1) * sides, count * sides)))
    return verts, faces


def build_tongue(coll):
    """The tongue, authored about its root on the mouth's floor: along the
    plinth, over its edge, down to the paving, and forking at the tip."""
    plinth_edge = -REPTILE_SHELL_RADIUS * math.cos(math.pi / PLINTH_SIDES)
    on_plinth = FLOOR + TONGUE_LIFT + TONGUE_THICK * 0.5
    on_ground = TONGUE_LIFT + TONGUE_THICK * 0.5
    fork_y = plinth_edge - 1.6
    stem = catmull_rom(
        [
            (0.0, 0.0, on_plinth),
            (0.0, plinth_edge + 0.25 - TONGUE_ROOT.y, on_plinth),
            (0.0, plinth_edge - 0.45 - TONGUE_ROOT.y, on_ground + 0.02),
            (0.0, fork_y - TONGUE_ROOT.y, on_ground),
        ],
        6,
    )
    widths = [0.45 + 0.2 * (i / (len(stem) - 1)) for i in range(len(stem))]
    tongue = Part("rh-tongue").add(*sweep_flat(stem, widths, TONGUE_THICK * 0.5))
    tip_y = fork_y - 0.95
    for sx in (-1.0, 1.0):
        prong = catmull_rom(
            [
                (0.0, fork_y - TONGUE_ROOT.y + 0.3, on_ground),
                (sx * 0.28, fork_y - TONGUE_ROOT.y - 0.35, on_ground),
                (sx * 0.62, tip_y - TONGUE_ROOT.y, on_ground),
            ],
            5,
        )
        pw = [0.34 * (1.0 - 0.75 * (i / (len(prong) - 1))) for i in range(len(prong))]
        tongue.add(*sweep_flat(prong, pw, TONGUE_THICK * 0.5))
    return tongue.emit(coll, location=tuple(TONGUE_ROOT))


def tail_path():
    """Centre line and radii: coil → ground at the tail reach → S-curve up."""
    # The tail begins *inside* the coil, a little way along the helix, and
    # runs back through its start point: the two tubes overlap there and the
    # coil's start cap is swallowed, so the body reads as one continuous
    # snake rather than a coil with a stub and a tail hung beside it.
    inside, start_r, _ = helix_at(0.08)
    start, _, _ = helix_at(0.0)
    base = Vector((REPTILE_TAIL_REACH * math.cos(TAIL_BEARING), REPTILE_TAIL_REACH * math.sin(TAIL_BEARING), 0.0))
    out = (base - Vector((start.x, start.y, 0.0))).normalized()
    side = Vector((-out.y, out.x, 0.0))
    # Knots: out of the coil and down onto the ground, then up in an S that
    # leans back toward the building so the tip stays inside the bounding
    # radius, with the bell on top.
    knots = [
        inside,
        start,
        start + out * 1.3 + Vector((0.0, 0.0, -0.45)),
        base - out * 1.9 + Vector((0.0, 0.0, 1.3)),
        base - out * 0.4 + Vector((0.0, 0.0, 0.5)),
        base + side * 0.5 - out * 0.45 + Vector((0.0, 0.0, 1.4)),
        base - side * 0.55 - out * 0.5 + Vector((0.0, 0.0, 2.6)),
        base + side * 0.35 - out * 0.9 + Vector((0.0, 0.0, 3.5)),
        base - out * 1.1 + Vector((0.0, 0.0, TAIL_RISE + 0.25)),
    ]
    points = catmull_rom(knots, 6)
    count = len(points)
    radii = []
    for i in range(count):
        u = i / (count - 1)
        # A shade fatter than the coil where the two overlap (so the coil's
        # cap is inside the tail, not flush with its skin), then slim by the
        # time it touches down — the reach point is only 0.3 m inside the
        # bounding radius.
        w = (1.0 - u) ** 3.2
        radii.append((start_r + 0.03) * w + TAIL_TIP_R * (1.0 - w))
    return points, radii, base, out, side


def build_tail(coll):
    points, radii, base, out, side = tail_path()
    tv, tf = sweep_varying(points, radii, TAIL_SIDES)

    tip = points[-1]
    bv, bf = ellipsoid(BELL_R, BELL_R, BELL_R * 0.9, subdivisions=2)
    bell = Part("rh-tail-bell").add(bv, bf, Matrix.Translation(tip + Vector((0.0, 0.0, BELL_R * 0.55)))).emit(coll)

    # The sign plank hangs beside the tail on the door's side, facing −Y like
    # the door, held up by a tendril of tail that curls over its top edge.
    sign_centre = base - side * 1.3 - out * 0.35 + Vector((0.0, 0.0, SIGN_Z))
    hold_from = min(points, key=lambda q: (q - (sign_centre + Vector((0.0, 0.0, 1.0)))).length)
    tendril = catmull_rom(
        [
            hold_from,
            hold_from - side * 0.5 + Vector((0.0, 0.0, 0.25)),
            sign_centre + Vector((0.0, 0.0, SIGN_H * 0.5 + 0.35)),
            sign_centre + Vector((0.0, 0.0, SIGN_H * 0.5 - 0.3)),
        ],
        5,
    )
    tail_part = Part("rh-tail").add(tv, tf)
    tail_part.add(*sweep_varying(tendril, [0.16] * len(tendril), 6))
    tail = tail_part.emit(coll)
    sv, sf = box(SIGN_W, SIGN_D, SIGN_H)
    sign = Part("rh-sign").add(sv, sf, Matrix.Translation(sign_centre)).emit(coll, smooth=False)
    paint_planar_uvs(
        sign,
        sign_centre.x - SIGN_W * 0.5,
        sign_centre.x + SIGN_W * 0.5,
        sign_centre.z - SIGN_H * 0.5,
        sign_centre.z + SIGN_H * 0.5,
    )
    return tail, bell, sign, sign_centre


def arch_outline():
    """The snake hole's clear outline in XZ: straight legs under a semicircle.

    A round bore was tried first and rejected: its floor curves up at the
    sides, so a child walking through at the edge of the collider's doorway
    would clip through drawn stone. Legs that go straight down to the floor
    give the full `REPTILE_ARCH_WIDTH` at ankle height, and the semicircle
    on top is what makes it read as a hole rather than a door.
    """
    half_w = REPTILE_ARCH_WIDTH * 0.5
    spring = FLOOR + REPTILE_ARCH_HEIGHT - half_w
    assert spring > FLOOR, "the arch is wider than it is tall"
    # Anticlockwise seen from the mouth (−Y): up the +X leg, over, down −X.
    pts = [(half_w, FLOOR - ARCH_LIP), (half_w, spring)]
    for s in range(1, ARCH_SEGMENTS):
        a = (s / ARCH_SEGMENTS) * math.pi
        pts.append((half_w * math.cos(a), spring + half_w * math.sin(a)))
    pts += [(-half_w, spring), (-half_w, FLOOR - ARCH_LIP)]
    return pts, spring


# =============================================================================
# Checks — every one of them against the emitted vertices
# =============================================================================


def measured():
    out = {}
    for obj in bpy.data.objects:
        if obj.type != "MESH":
            continue
        lo = Vector((1e9, 1e9, 1e9))
        hi = Vector((-1e9, -1e9, -1e9))
        for v in obj.data.vertices:
            w = obj.matrix_world @ v.co
            lo = Vector((min(lo[i], w[i]) for i in range(3)))
            hi = Vector((max(hi[i], w[i]) for i in range(3)))
        out[obj.name] = (lo, hi)
    return out


def world_verts(name):
    obj = bpy.data.objects[name]
    return [obj.matrix_world @ v.co for v in obj.data.vertices]


def check_plinth(bounds) -> str:
    lo, hi = bounds["rh-plinth"]
    circum = max(math.hypot(v.x, v.y) for v in world_verts("rh-plinth"))
    assert abs(circum - REPTILE_SHELL_RADIUS) < 1e-4, (
        f"plinth circumradius {circum:.4f} ≠ REPTILE_SHELL_RADIUS {REPTILE_SHELL_RADIUS}"
    )
    flat = REPTILE_SHELL_RADIUS * math.cos(math.pi / PLINTH_SIDES)
    return (
        f"  plinth: {PLINTH_SIDES}-gon, circumradius {circum:.3f} = REPTILE_SHELL_RADIUS, "
        f"flats at {flat:.3f}, top at z {hi.z:.2f}"
    )


def head_scaled(v: Vector) -> float:
    """< 1 inside the head's ellipsoid, 1 on its skin, > 1 outside."""
    d = v - HEAD_CENTRE
    return math.sqrt((d.x / HEAD_RX) ** 2 + (d.y / HEAD_RY) ** 2 + (d.z / HEAD_RZ) ** 2)


def check_head_clearance() -> str:
    """The body clears the head it lies in front of, the neck clears the pass
    it climbs over, and the neck's end is buried in the crown."""
    points, radii = body_path()
    steps = int(round(COIL_TURNS * COIL_STEPS_PER_TURN))
    head_verts = world_verts("rh-head")
    # Every helix sample's tube against every head vertex: the real mesh, not
    # the ellipsoid formula (the boolean leaves the formula's skin only where
    # it was not cut).
    worst = 1e9
    worst_t = 0.0
    for i in range(steps + 1):
        p, r = points[i], radii[i]
        if p.y > HEAD_CENTRE.y + HEAD_RY + 1.5:
            continue
        gap = min((v - p).length for v in head_verts) - r
        if gap < worst:
            worst, worst_t = gap, COIL_TURNS * i / steps
    assert worst > 0.1, f"the coil comes within {worst:.2f} m of the head at turn {worst_t:.2f} — raise HUMP_H"
    # The neck over the first pass.
    first = [(points[i], radii[i]) for i in range(steps + 1) if COIL_TURNS * i / steps < 1.3]
    neck = [(points[i], radii[i]) for i in range(steps + 1, len(points))]
    neck_gap = min((p - q).length - r - s for p, r in neck for q, s in first)
    assert neck_gap > 0.05, f"the neck passes {-neck_gap:.2f} m into the first coil pass"
    end, end_r = neck[-1]
    buried = head_scaled(end)
    assert buried < 0.9, f"the neck's end sits at {buried:.2f} of the head's radius — not buried"
    return (
        f"  head clearance: the coil's nearest pass is {worst:.2f} m off the head's skin (turn {worst_t:.2f}); "
        f"the neck clears the first pass by {neck_gap:.2f} m and ends {buried:.2f} of a radius into the crown"
    )


def check_mouth(bounds) -> str:
    lo, hi = bounds["rh-mouth"]
    half_w = REPTILE_ARCH_WIDTH * 0.5
    _, spring = arch_outline()

    def bore_distance(v):
        if v.z <= spring:
            return abs(v.x) - half_w
        return math.hypot(v.x, v.z - spring) - half_w

    bore = [v for v in world_verts("rh-mouth") if abs(bore_distance(v)) < 0.01]
    assert len(bore) >= 2 * (ARCH_SEGMENTS + 3), f"only {len(bore)} bore vertices found"
    width = max(v.x for v in bore) - min(v.x for v in bore)
    height = max(v.z for v in bore) - FLOOR
    assert abs(width - REPTILE_ARCH_WIDTH) < 0.01, f"mouth bore {width:.3f} wide ≠ REPTILE_ARCH_WIDTH"
    assert abs(height - REPTILE_ARCH_HEIGHT) < 0.01, f"mouth bore {height:.3f} tall ≠ REPTILE_ARCH_HEIGHT"
    # The bore runs the whole way: from in front of the plinth to the back wall.
    front = -min(v.y for v in bore)
    back = -max(v.y for v in bore)
    assert front >= REPTILE_DRAWN_DOOR_ALONG, f"the lips are at {front:.2f}, inside REPTILE_DRAWN_DOOR_ALONG"
    assert back <= -ARCH_BACK_Y + 0.11, f"the bore stops {back:.2f} out, short of the house wall"
    # The lips at ground level, where she walks in: the lining's lowest front
    # vertices on either side of the bore.
    lip = [v for v in world_verts("rh-mouth") if v.z < 0.6 and abs(v.x) > half_w + 0.02]
    lips_at = -min(v.y for v in lip)
    assert height >= TALLEST_CHILD_HEIGHT + 0.4
    return (
        f"  mouth: bore {width:.2f} × {height:.2f} above the plinth (legs straight to the floor, "
        f"semicircle from z {spring:.2f}), lips {front:.2f} out at the top and {lips_at:.2f} at the floor "
        f"(≥ REPTILE_DRAWN_DOOR_ALONG {REPTILE_DRAWN_DOOR_ALONG}), bore back at {back:.2f}, lining top "
        f"{hi.z:.2f}, headroom {height - TALLEST_CHILD_HEIGHT:.2f} over TALLEST_CHILD_HEIGHT"
    )


def check_tongue(bounds) -> str:
    lo, hi = bounds["rh-tongue"]
    plinth_top = bounds["rh-plinth"][1].z
    verts = world_verts("rh-tongue")
    on_plinth = [v for v in verts if v.y > -REPTILE_SHELL_RADIUS * math.cos(math.pi / PLINTH_SIDES) + 0.3]
    assert min(v.z for v in on_plinth) > plinth_top + 0.01, "the tongue lies in the plinth's top"
    assert lo.z > 0.01, f"the tongue's underside is at z {lo.z:.3f}, in the paving"
    assert hi.z < plinth_top + TONGUE_THICK + TONGUE_LIFT + 0.05
    reach = max(math.hypot(v.x, v.y) for v in verts)
    return (
        f"  tongue: from the mouth's floor (z {max(v.z for v in on_plinth):.2f} over the plinth's {plinth_top:.2f}) "
        f"out to {reach:.2f} ≤ REPTILE_BOUNDING_RADIUS {REPTILE_BOUNDING_RADIUS}, underside {lo.z:.3f} over the paving"
    )


def check_tail() -> str:
    # The tail's thickest part at the reach point stands where the collider
    # disc goes, and nothing reaches past the bounding radius.
    base = Vector((REPTILE_TAIL_REACH * math.cos(TAIL_BEARING), REPTILE_TAIL_REACH * math.sin(TAIL_BEARING), 0.0))
    lowest = min(world_verts("rh-tail"), key=lambda v: v.z)
    assert lowest.z < 0.35, f"the tail never touches down (lowest vertex z {lowest.z:.2f})"
    off = (Vector((lowest.x, lowest.y, 0.0)) - base).length
    assert off < 0.7, f"the tail touches down {off:.2f} m from the REPTILE_TAIL_REACH point"
    reach = max(math.hypot(v.x, v.y) for name in ("rh-tail", "rh-tail-bell", "rh-sign") for v in world_verts(name))
    assert reach <= REPTILE_BOUNDING_RADIUS, f"tail reaches {reach:.2f} > REPTILE_BOUNDING_RADIUS"
    # Beside the head, never in it: the tail and the plank keep clear of the skin.
    nearest = min(head_scaled(v) for name in ("rh-tail", "rh-sign", "rh-tail-bell") for v in world_verts(name))
    assert nearest > 1.08, f"the tail or its plank reaches {nearest:.2f} of the head's radius — into the head"
    return (
        f"  tail: touches down (z {lowest.z:.2f}) {off:.2f} m from the REPTILE_TAIL_REACH point "
        f"({base.x:.2f}, {base.y:.2f}); furthest vertex {reach:.2f} ≤ REPTILE_BOUNDING_RADIUS {REPTILE_BOUNDING_RADIUS}; "
        f"nearest to the head {nearest:.2f} radii"
    )


def check_bounds(bounds) -> str:
    reach = 0.0
    for name, (lo, hi) in bounds.items():
        for v in world_verts(name):
            reach = max(reach, math.hypot(v.x, v.y))
    assert reach <= REPTILE_BOUNDING_RADIUS + 1e-6, f"{reach:.2f} > REPTILE_BOUNDING_RADIUS"
    top = max(hi.z for _, hi in bounds.values())
    low = min(lo.z for lo, _ in bounds.values())
    return f"  whole kit: radius {reach:.2f} ≤ REPTILE_BOUNDING_RADIUS {REPTILE_BOUNDING_RADIUS}, z {low:.2f} … {top:.2f}"


def check_head(bounds) -> str:
    lo, hi = bounds["rh-head"]
    mesh = bpy.data.objects["rh-head"].data
    painted = sum(1 for p in mesh.polygons if p.normal.y < -0.02)
    assert mesh.uv_layers, "rh-head has no UV layer"
    assert 0.2 < painted / len(mesh.polygons) < 0.65, "the painted hemisphere is not a hemisphere"
    # The eyes sit above the mouth: the row `snakeFace.ts` paints Sunny's eyes
    # on, read from the canvas's own owner, lands on the head above the lips.
    eye_z = hi.z - SUNNY_FACE_EYE_ROW * (hi.z - lo.z)
    lips_top = FLOOR + REPTILE_ARCH_HEIGHT + ARCH_LIP
    assert eye_z > lips_top + 0.3, f"the eyes paint at z {eye_z:.2f}, on or below the lips' top {lips_top:.2f}"
    return (
        f"  head: centre ({HEAD_CENTRE.x:.1f}, {HEAD_CENTRE.y:.1f}, {HEAD_CENTRE.z:.1f}), "
        f"{HEAD_RX * 2:.1f} × {HEAD_RY * 2:.1f} × {HEAD_RZ * 2:.1f} m, z {lo.z:.2f} … {hi.z:.2f}; "
        f"face UVs on {painted} of {len(mesh.polygons)} faces (front, −Y); the eye row paints at z {eye_z:.2f}, "
        f"{eye_z - lips_top:.2f} above the lips' top {lips_top:.2f}"
    )


def check_portholes(frames) -> str:
    """No porthole frame is swallowed by a coil: the band of wall between
    stacked turns is narrow, and a frame that disappears into the body is a
    window nobody can see."""
    steps = 400
    centreline = [helix_at(COIL_TURNS * i / steps) for i in range(steps + 1)]
    worst = 1e9
    for v in frames:
        for p, r, _ in centreline:
            worst = min(worst, (v - p).length - r)
    assert worst > -0.12, f"a porthole frame is {-worst:.2f} m inside the coil"
    return f"  portholes: {len(PORTHOLE_TURNS)}, every frame vertex ≥ {worst:+.2f} m from the coil's surface"


def main() -> None:
    reset_scene()
    build_plinth(collection("plinth"))
    build_coil(collection("coil"))
    _, _, porthole_frames = build_house(collection("house"))
    build_head(collection("head"))
    _, _, _, sign_centre = build_tail(collection("tail"))
    bpy.context.view_layer.update()

    bounds = measured()
    print("\nreptile_house_build")
    print(summarise())
    print("\n  measured off the emitted vertices:")
    print(check_plinth(bounds))
    print(check_mouth(bounds))
    print(check_head_clearance())
    print(check_tongue(bounds))
    print(check_tail())
    print(check_head(bounds))
    print(check_portholes(porthole_frames))
    print(check_bounds(bounds))
    print(
        f"  sign plank centre ({sign_centre.x:.2f}, {sign_centre.y:.2f}, {sign_centre.z:.2f}), "
        f"{SIGN_W} × {SIGN_H} m, UVs as gate-arch-sign"
    )
    print(
        f"  read from the game: REPTILE_SHELL_RADIUS {REPTILE_SHELL_RADIUS}, REPTILE_TAIL_REACH {REPTILE_TAIL_REACH}, "
        f"REPTILE_TAIL_BEARING_OFFSET {REPTILE_TAIL_BEARING_OFFSET}, REPTILE_ARCH_WIDTH {REPTILE_ARCH_WIDTH}, "
        f"REPTILE_ARCH_HEIGHT {REPTILE_ARCH_HEIGHT}, REPTILE_DRAWN_DOOR_ALONG {REPTILE_DRAWN_DOOR_ALONG}, "
        f"REPTILE_BOUNDING_RADIUS {REPTILE_BOUNDING_RADIUS}, TALLEST_CHILD_HEIGHT {TALLEST_CHILD_HEIGHT}"
    )
    tris = total_triangles()
    print(f"\n  {len(bpy.data.objects)} nodes, {tris} triangles total")
    assert tris <= 11_000, f"{tris} triangles is over the house kit's 11 000 budget"

    bpy.ops.wm.save_as_mainfile(filepath=BLEND)
    print("  saved", BLEND, f"({os.path.getsize(BLEND)} bytes)\n")


if __name__ == "__main__":
    try:
        main()
    except Exception:
        traceback.print_exc()
        sys.exit(1)
