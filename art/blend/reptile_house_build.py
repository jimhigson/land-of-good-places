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

## How the snake avoids her own front door

A snake coiled round a building blocks its door, and this took some working
out, so here it is once. The helix starts just past the door (the tail's
bearing, ``REPTILE_TAIL_BEARING_OFFSET`` degrees round from it) and winds
**away**, so the bottom turn never crosses the doorway at all; it is the
*second* turn that passes over the door, 0.92 turns later. One pitch is not
tall enough to clear a 3.6 m arch, so every turn carries a smooth **hump** at
the door bearing — full height on the first pass, half on the second, so the
coils stay snug — and the whole body reads as lifting to let you in. The head
then sits at the front with her chin on that second hump, looking at the
camera, and the neck comes over the dome from behind. The clearance under the
hump is measured off the emitted vertices below, not trusted.

## Conventions (ART_DIRECTION §7)

* 1 Blender unit = 1 metre; origin on the ground at the building's centre.
* **Blender −Y is the game's +Z**: the door, the head and the leaf awning all
  face −Y here. The plot is ``cameraFacing``, so in the park that is the
  camera's diagonal.
* Every node is baked into vertex positions and leaves at an identity
  transform, with one exception the export script allows: ``rh-tongue`` is
  emitted with its node origin at the mouth, so the game can scale it 0→1 for
  a flick with no pivot arithmetic (the castle chest-lid precedent).
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

COIL_TURNS = 2.6
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
#: door bearing, lifting the body by `HUMP_H` on the first pass and half that on
#: the second (the pass the head's chin rests on).
HUMP_HALF_WINDOW = math.radians(50.0)
HUMP_H = 2.15
HUMP_SECOND_PASS = 0.5

#: The neck: from the helix end, over the dome, into the back of the head.
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

HEAD_RX, HEAD_RY, HEAD_RZ = 1.7, 2.1, 1.5
#: Head centre: on top of everything at the front, resting on the second door
#: hump with her chin out over the entrance, so the first thing a child sees
#: walking up is Sunny looking down at her. Measured and printed below.
HEAD_CENTRE = Vector((0.0, -6.0, 10.7))
#: The mouth, where the tongue's node origin goes.
MOUTH = HEAD_CENTRE + Vector((0.0, -HEAD_RY + 0.25, -0.62))
TONGUE_R = 0.08

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

# -------------------------------------------------------------------- arch
#
# The snake hole: a short round tunnel from the coil's face back to the
# greenhouse wall, with a rounded lip. Its *clear* opening is the game's
# `REPTILE_ARCH_WIDTH × REPTILE_ARCH_HEIGHT`, above the plinth.

ARCH_LIP = 0.4
ARCH_SEGMENTS = 24
#: The tunnel's mouth is this far out; it runs back into the house wall.
ARCH_MOUTH_Y = -(REPTILE_DRAWN_DOOR_ALONG + 0.45)
ARCH_BACK_Y = -(HOUSE_PROFILE[1][0] - 0.5)

# ------------------------------------------------------------------ awning
#
# One giant leaf over the doormat, sprouting from the arch's top and leaning
# out and up, so it sits in front of the humped coil rather than inside it.

AWNING_W, AWNING_L, AWNING_T = 4.0, 2.5, 0.12
AWNING_TILT = math.radians(18.0)


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
    # The neck: from the helix end at the back-left, arcing over the dome
    # and the top coil's front, into the back of the head.
    back = HEAD_CENTRE + Vector((0.0, HEAD_RY, 0.0))
    ahead, _, _ = helix_at(COIL_TURNS + 0.02)
    tangent = (ahead - end).normalized()
    neck_knots = [
        end,
        end + tangent * 1.6 + Vector((0.0, 0.0, 0.5)),
        Vector((end.x * 0.25, back.y + 1.7, HEAD_CENTRE.z - 0.1)),
        back + Vector((0.0, 0.1, 0.0)),
        HEAD_CENTRE + Vector((0.0, HEAD_RY - 1.0, 0.0)),
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


def build_head(coll):
    hv, hf = ellipsoid(HEAD_RX, HEAD_RY, HEAD_RZ, subdivisions=4)
    head = Part("rh-head").add(hv, hf, Matrix.Translation(HEAD_CENTRE)).emit(coll)
    paint_face_uvs(head, HEAD_CENTRE, HEAD_RX, HEAD_RZ)

    # The tongue, authored about the mouth: a stem forward, then the fork.
    tongue = Part("rh-tongue")
    stem = [(0.0, 0.1, 0.0), (0.0, -0.5, -0.03), (0.0, -0.95, -0.08)]
    tongue.add(*sweep_varying(stem, [TONGUE_R, TONGUE_R, TONGUE_R * 0.9], 6))
    for sx in (-1.0, 1.0):
        prong = [(0.0, -0.9, -0.08), (sx * 0.18, -1.25, -0.12), (sx * 0.32, -1.5, -0.2)]
        tongue.add(*sweep_varying(prong, [TONGUE_R * 0.9, TONGUE_R * 0.7, 0.03], 6))
    tongue_obj = tongue.emit(coll, location=tuple(MOUTH))
    return head, tongue_obj


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


def build_arch(coll):
    """The snake hole: an arched tunnel from the coil's face back to the
    greenhouse wall, with a half-round lip at the mouth. Clear opening =
    `REPTILE_ARCH_WIDTH × REPTILE_ARCH_HEIGHT` above the plinth; the legs run
    on down into the plinth so the ends are buried."""
    outline, _ = arch_outline()
    depth = ARCH_BACK_Y - ARCH_MOUTH_Y
    # The lip profile, as (outward offset, depth): bore edge at the mouth,
    # half-round out to the outer face, straight back to the wall, and in.
    lip = ARCH_LIP * 0.5
    profile = [(0.0, 0.0)]
    lip_segments = 5
    for s in range(1, lip_segments):
        a = (s / lip_segments) * math.pi
        profile.append((lip * (1 - math.cos(a)), -lip * math.sin(a)))
    profile += [(ARCH_LIP, 0.0), (ARCH_LIP, depth), (0.0, depth)]
    count = len(outline)
    pcount = len(profile)
    verts = []
    for i, (x, z) in enumerate(outline):
        # The outward normal, from the neighbouring outline points; the legs'
        # ends get a plain sideways normal.
        xa, za = outline[max(i - 1, 0)]
        xb, zb = outline[min(i + 1, count - 1)]
        tx, tz = xb - xa, zb - za
        length = math.hypot(tx, tz) or 1.0
        nx, nz = tz / length, -tx / length
        if nx * x + nz * (z - (FLOOR + REPTILE_ARCH_HEIGHT * 0.5)) < 0:
            nx, nz = -nx, -nz
        for off, d in profile:
            verts.append((x + nx * off, ARCH_MOUTH_Y + d, z + nz * off))
    faces = []
    for i in range(count - 1):
        for p in range(pcount):
            pn = (p + 1) % pcount
            a = i * pcount + p
            b = i * pcount + pn
            c = (i + 1) * pcount + pn
            d = (i + 1) * pcount + p
            faces.append((a, b, c, d))
    # Caps on the buried leg ends, so the tunnel is a closed solid.
    faces.append(tuple(range(pcount - 1, -1, -1)))
    faces.append(tuple(range((count - 1) * pcount, count * pcount)))
    return Part("rh-arch").add(verts, faces).emit(coll)


def build_awning(coll):
    """A giant leaf, pointing out over the doormat from the arch's top."""
    n = 24
    outline = []
    for i in range(n):
        a = i * TAU / n
        # A pointed leaf: a lens in XZ (Z = along the leaf) with a sharp tip.
        x = (AWNING_W * 0.5) * math.sin(a) * (1.0 - 0.3 * math.cos(a))
        y = (AWNING_L * 0.5) * math.cos(a)
        outline.append((x, y))
    verts = [(x, -AWNING_T * 0.5, z) for x, z in outline] + [(x, AWNING_T * 0.5, z) for x, z in outline]
    verts.append((0.0, -AWNING_T * 0.5, 0.0))
    verts.append((0.0, AWNING_T * 0.5, 0.0))
    fc, bc = 2 * n, 2 * n + 1
    faces = []
    for i in range(n):
        j = (i + 1) % n
        faces.append((i, j, n + j, n + i))
        faces.append((j, i, fc))
        faces.append((n + i, n + j, bc))
    # A midrib: a slim tube down the leaf's length, standing proud of it.
    rib_v, rib_f = sweep_varying(
        [(0.0, -AWNING_T * 0.35, -AWNING_L * 0.5 + 0.1), (0.0, -AWNING_T * 0.35, AWNING_L * 0.5 - 0.15)],
        [0.09, 0.05],
        6,
    )
    # Lay the leaf flat (its length along −Y, out of the door), tilt it up by
    # `AWNING_TILT`, and hang its stem end over the arch's top.
    lie = Matrix.Rotation(-math.pi / 2, 4, "X")
    tilt = Matrix.Rotation(-AWNING_TILT, 4, "X")
    stem = Vector((0.0, ARCH_MOUTH_Y - 0.1, FLOOR + REPTILE_ARCH_HEIGHT + ARCH_LIP - 0.1))
    place = Matrix.Translation(stem + Vector((0.0, -AWNING_L * 0.5 * math.cos(AWNING_TILT), AWNING_L * 0.5 * math.sin(AWNING_TILT))))
    awning = Part("rh-awning").add(verts, faces, place @ tilt @ lie).add(rib_v, rib_f, place @ tilt @ lie)
    return awning.emit(coll, sharp_deg=60.0)


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


def check_door_clearance(bounds) -> str:
    """Nothing of the snake hangs onto the arch, and the leaf is clear of her."""
    arch_lo, arch_hi = bounds["rh-arch"]
    lowest = 1e9
    for name in ("rh-coil", "rh-coil-belly", "rh-coil-spots"):
        for v in world_verts(name):
            if abs(v.x) <= arch_hi.x + 0.1 and arch_lo.y - 0.5 <= v.y <= arch_hi.y + 0.5:
                lowest = min(lowest, v.z)
    assert lowest > arch_hi.z, (
        f"the coil hangs to z {lowest:.2f} over the door, below the arch's top {arch_hi.z:.2f} — raise HUMP_H"
    )
    # The awning must sit in front of the humped body, never inside it: every
    # leaf vertex is further from the coil's centre line than the tube there.
    steps = 400
    centreline = [helix_at(COIL_TURNS * i / steps) for i in range(steps + 1)]
    worst = 1e9
    for v in world_verts("rh-awning"):
        for p, r, _ in centreline:
            worst = min(worst, (v - p).length - r)
    assert worst > 0.05, f"the awning pokes {-worst:.2f} m into the coil"
    return (
        f"  door: the humped coil's lowest point over the arch is z {lowest:.2f} against the arch's top "
        f"{arch_hi.z:.2f}; the awning clears the body by {worst:.2f} m"
    )


def check_arch(bounds) -> str:
    lo, hi = bounds["rh-arch"]
    half_w = REPTILE_ARCH_WIDTH * 0.5
    _, spring = arch_outline()

    def bore_distance(v):
        if v.z <= spring:
            return abs(v.x) - half_w
        return math.hypot(v.x, v.z - spring) - half_w

    mid_y = (ARCH_MOUTH_Y + ARCH_BACK_Y) * 0.5
    bore = [v for v in world_verts("rh-arch") if abs(bore_distance(v)) < 0.01 and abs(v.y - mid_y) <= (ARCH_BACK_Y - ARCH_MOUTH_Y) * 0.5 + 1e-4]
    assert len(bore) >= 2 * (ARCH_SEGMENTS + 3), f"only {len(bore)} bore vertices found"
    width = max(v.x for v in bore) - min(v.x for v in bore)
    height = max(v.z for v in bore) - FLOOR
    assert abs(width - REPTILE_ARCH_WIDTH) < 0.01, f"arch bore {width:.3f} wide ≠ REPTILE_ARCH_WIDTH"
    assert abs(height - REPTILE_ARCH_HEIGHT) < 0.01, f"arch bore {height:.3f} tall ≠ REPTILE_ARCH_HEIGHT"
    assert -lo.y >= REPTILE_DRAWN_DOOR_ALONG, (
        f"arch mouth at {-lo.y:.2f} is inside REPTILE_DRAWN_DOOR_ALONG {REPTILE_DRAWN_DOOR_ALONG}"
    )
    assert height >= TALLEST_CHILD_HEIGHT + 0.4
    return (
        f"  arch: bore {width:.2f} × {height:.2f} above the plinth (legs straight to the floor, "
        f"semicircle from z {spring:.2f}), mouth at {-lo.y:.2f} out (≥ REPTILE_DRAWN_DOOR_ALONG "
        f"{REPTILE_DRAWN_DOOR_ALONG}), lip top {hi.z:.2f}, headroom {height - TALLEST_CHILD_HEIGHT:.2f} "
        f"over TALLEST_CHILD_HEIGHT"
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
    return (
        f"  tail: touches down (z {lowest.z:.2f}) {off:.2f} m from the REPTILE_TAIL_REACH point "
        f"({base.x:.2f}, {base.y:.2f}); furthest vertex {reach:.2f} ≤ REPTILE_BOUNDING_RADIUS {REPTILE_BOUNDING_RADIUS}"
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
    assert 0.35 < painted / len(mesh.polygons) < 0.65, "the painted hemisphere is not a hemisphere"
    return (
        f"  head: centre ({HEAD_CENTRE.x:.1f}, {HEAD_CENTRE.y:.1f}, {HEAD_CENTRE.z:.1f}), "
        f"{HEAD_RX * 2:.1f} × {HEAD_RY * 2:.1f} × {HEAD_RZ * 2:.1f} m, z {lo.z:.2f} … {hi.z:.2f}; "
        f"face UVs on {painted} of {len(mesh.polygons)} faces (front, −Y), canvas aspect "
        f"{HEAD_RX * 2:.1f}:{HEAD_RZ * 2:.1f}; mouth / tongue origin ({MOUTH.x:.2f}, {MOUTH.y:.2f}, {MOUTH.z:.2f})"
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
    build_arch(collection("arch"))
    build_awning(collection("awning"))
    bpy.context.view_layer.update()

    bounds = measured()
    print("\nreptile_house_build")
    print(summarise())
    print("\n  measured off the emitted vertices:")
    print(check_plinth(bounds))
    print(check_arch(bounds))
    print(check_door_clearance(bounds))
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
