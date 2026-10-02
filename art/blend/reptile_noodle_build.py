"""Builds Noodle — the Reptile House's centrepiece python — and her rock.

    blender --background --factory-startup --python-exit-code 1 \
        --python art/blend/reptile_noodle_build.py

Writes ``art/blend/reptile_noodle.blend``; ``reptile_noodle_export.py`` turns
that into ``src/art/assets/reptileNoodle.glb``. The ``.blend`` is a build
artefact — this file is the authoring source (ASSET_MANIFEST.md, "The Python
is the authoring source").

## What is in the kit (``docs/design/REPTILE-HOUSE.md`` §ASSET GROUPS 5)

| node | what |
| --- | --- |
| ``rn-mound`` | the mossy rock mound her coils pile up on, r 3.0, 1.6 m |
| ``rn-coil`` | her whole visible body: out of the burrow, three turns up the mound, neck arching back down to the kerb |
| ``rn-coil-belly`` | the paler belly stripe, a thinner tube riding the lower-outer flank of the same path |
| ``rn-coil-spots`` | twenty shallow domed spots along her back |
| ``rn-head`` | **PAINTED** — the face is a canvas in this node's own UVs; node origin at the chin's rest point |
| ``rn-tongue`` | a forked tongue; node origin at the mouth so a scale from 0 flicks it out |
| ``rn-burrow`` | the dark rim she disappears into |
| ``rn-tail-mound`` | the nursery's mound, 14 m away, that the TypeScript tail chain emerges from — authored at the origin |

## Every shared number is read, never typed

``reptile_constants.py`` reads them out of ``src/world/reptileHouse/layout.ts``
with ``ts_const``. The figures that are **not** shared with the game (the
drape of the neck, the spot count, the mound's ledges) live here as plainly
named module constants, and the build prints every measured size so the
loader (``src/art/models/reptileNoodleAssets.ts``) has numbers to assert
against rather than a drawing to trust.

## The shape, and why

Noodle rests the way a real python rests: her body comes up out of a burrow
on the island's floor, curls once round the foot of the rock, climbs it in
three stacked turns, and from the top her neck arches back out over her own
coils and down to lay her chin on the kerb, looking straight at the arrival
spot. Two things fall out of that pose that are worth knowing:

* **The mound is derived from the coil, not the other way round.** The spiral
  is fixed first (its radius and height are the pose), and the rock's profile
  is then "whatever surface the coils sit on, 0.3 m down into the body" — so
  every turn rests on stone and nothing floats. The peak lands at exactly
  ``REPTILE_NOODLE_MOUND_HEIGHT``, which is asserted.
* **The neck must cross the turns below it**, because the head is at the kerb
  and the top of the spiral is at the middle: there is no bearing at which it
  could come down without passing over earlier turns. So the neck rides the
  pile's envelope — each waypoint is placed above the top of whichever turn is
  underneath it — and sinks a hand's width into the coil below, which is what
  "resting on her own coils" looks like.

## Coordinates

Blender metres; Blender −Y is the game's +Z (``blendkit`` docstring). The
island is at the hall's origin, so island-local **is** hall-local, and the
rock, coil, head, tongue and burrow are baked in place. The head faces the
game's +X+Z (towards the arrival and the camera), which here is the bearing
(+X, −Y). The tail mound is a separate prop for another exhibit and is
authored at its own base origin like any placeable.
"""

import math
import os
import random
import sys
import traceback

import bpy
from mathutils import Matrix, Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from blendkit import (  # noqa: E402
    REPO,
    TAU,
    Part,
    collection,
    icosphere,
    reset_scene,
    revolve,
    summarise,
    total_triangles,
)
from blendkit import ts_const  # noqa: E402
from reptile_constants import (  # noqa: E402
    LAYOUT,
    REPTILE_ISLAND_KERB_HEIGHT,
    REPTILE_ISLAND_RADIUS,
    REPTILE_NOODLE_BODY_RADIUS,
    REPTILE_NOODLE_HEAD_X,
    REPTILE_NOODLE_HEAD_Y,
    REPTILE_NOODLE_HEAD_Z,
    REPTILE_NOODLE_MOUND_HEIGHT,
    REPTILE_NURSERY_RADIUS,
)

BLEND = os.path.join(REPO, "art", "blend", "reptile_noodle.blend")

# Only printed here (the snout's overhang past the island's solid disc is the
# collider owner's to judge), so read straight from the owner rather than
# widening the shared accessor module for one note.
REPTILE_ISLAND_COLLIDER_RADIUS = ts_const(LAYOUT, "REPTILE_ISLAND_COLLIDER_RADIUS")

# The kit's triangle ceiling (REPTILE-HOUSE.md §ASSET GROUPS 5). Bytes are
# the pack script's to police; triangles are checked here, where they are made.
TRIANGLE_BUDGET = 5000

# =============================================================================
# The pose — numbers that belong to this asset alone
# =============================================================================

BODY_R = REPTILE_NOODLE_BODY_RADIUS
# The spiral: three turns, from the foot of the rock to its top.
TURNS = 3
SPIRAL_R_OUTER = 2.5
SPIRAL_R_INNER = 0.95
SPIRAL_Z_BOTTOM = BODY_R  # the bottom turn rests on the island floor
SPIRAL_Z_TOP = 1.9
# How far each turn sinks into the rock under it. Derives the mound profile.
COIL_SINK = 0.30
# The head's bearing, from the layout's own rest point: the game's (+2.3, +2.3)
# is Blender (+2.3, −2.3), i.e. −45°. The spiral is wound so it *ends* on this
# bearing and the neck leaves it radially.
HEAD_BEARING = math.atan2(-REPTILE_NOODLE_HEAD_Z, REPTILE_NOODLE_HEAD_X)
HEAD_LENGTH, HEAD_WIDTH, HEAD_HEIGHT = 1.3, 0.9, 0.8
NECK_R = 0.36  # she slims a little towards the head
# The burrow. The spec's exhibit row puts it at hall (3.0, −0.8), but at r 3.1
# a 0.42 m body entering it stands 0.1 m proud of the kerb (r 3.4), so it is
# pulled 0.35 m inward along the same bearing: hall (2.66, −0.71) → Blender
# (2.66, +0.71). Not a layout constant; the collider is the island disc either way.
BURROW_XY = (3.0 * 2.75 / 3.1, 0.8 * 2.75 / 3.1)
BURROW_RIM_R = 0.5
SPOT_COUNT = 20
MOUND_BASE_R = 3.0
MOUND_SINK = 0.05  # buried into the floor so no face shares the floor's plane
TAIL_MOUND_R = 1.1
TAIL_MOUND_H = 0.5

# The spec's exhibit row puts the top of the pile at ~2.6 m (the neck's arch
# over the coils); the collider's `top` is the Engineer's, but a pile that
# grows past this would hide the north cases from the camera. Asserted off
# the vertices after the build.
PILE_TOP_LIMIT = 2.7


def spiral_z_at_r(r: float) -> float:
    """The spiral's centreline height at radius ``r`` — the pose, as a function."""
    t = (SPIRAL_R_OUTER - r) / (SPIRAL_R_OUTER - SPIRAL_R_INNER)
    return SPIRAL_Z_BOTTOM + (SPIRAL_Z_TOP - SPIRAL_Z_BOTTOM) * t


def mound_z_at_r(r: float) -> float:
    """The rock's surface under the coil: the coil's centreline, ``COIL_SINK`` down.

    Peaks at exactly ``REPTILE_NOODLE_MOUND_HEIGHT`` by construction of the
    pose constants above — and that is asserted after the mesh is built, off
    its vertices, not off this formula.
    """
    if r <= SPIRAL_R_INNER:
        return spiral_z_at_r(SPIRAL_R_INNER) - COIL_SINK
    if r >= SPIRAL_R_OUTER:
        foot = spiral_z_at_r(SPIRAL_R_OUTER) - COIL_SINK
        return foot * max(0.0, (MOUND_BASE_R - r) / (MOUND_BASE_R - SPIRAL_R_OUTER))
    return spiral_z_at_r(r) - COIL_SINK


# =============================================================================
# Geometry helpers local to this kit
# =============================================================================


def rot_z(deg: float) -> Matrix:
    return Matrix.Rotation(math.radians(deg), 4, "Z")


def catmull_rom(points, samples_per_span: int):
    """A smooth curve through the waypoints — the neck's drape wants no corners."""
    pts = [Vector(p) for p in points]
    out = []
    for i in range(len(pts) - 1):
        p0 = pts[max(i - 1, 0)]
        p1 = pts[i]
        p2 = pts[i + 1]
        p3 = pts[min(i + 2, len(pts) - 1)]
        for s in range(samples_per_span):
            t = s / samples_per_span
            t2, t3 = t * t, t * t * t
            out.append(
                0.5
                * (
                    2 * p1
                    + (-p0 + p2) * t
                    + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2
                    + (-p0 + 3 * p1 - 3 * p2 + p3) * t3
                )
            )
    out.append(pts[-1])
    return out


def transport_frames(points):
    """Parallel-transport frames along a 3-D path: (tangent, side, normal) per point.

    ``blendkit.sweep_path``'s tangent × up frame is honest for planar paths and
    starts to twist on this one — a helix that turns into a drape — so the
    frame is carried along the curve instead and never flips.
    """
    tangents = []
    count = len(points)
    for i in range(count):
        nxt = points[min(i + 1, count - 1)]
        prv = points[max(i - 1, 0)]
        tangents.append((nxt - prv).normalized())
    side = tangents[0].cross(Vector((0.0, 0.0, 1.0)))
    if side.length < 1e-6:
        side = Vector((1.0, 0.0, 0.0))
    side.normalize()
    frames = []
    for i in range(count):
        t = tangents[i]
        side = (side - t * side.dot(t)).normalized()
        normal = t.cross(side).normalized()
        frames.append((t, side, normal))
    return frames


def sweep_varying(points, frames, radius_at, sides: int, offset_at=None):
    """A capped tube along ``points`` with a per-sample radius (and centre offset)."""
    count = len(points)
    verts = []
    faces = []
    for i, p in enumerate(points):
        _t, side, normal = frames[i]
        r = radius_at(i)
        centre = p + (offset_at(i, side, normal) if offset_at else Vector())
        for k in range(sides):
            a = k * TAU / sides
            verts.append(tuple(centre + side * (math.cos(a) * r) + normal * (math.sin(a) * r)))
    for i in range(count - 1):
        for k in range(sides):
            k2 = (k + 1) % sides
            faces.append((i * sides + k, i * sides + k2, (i + 1) * sides + k2, (i + 1) * sides + k))
    faces.append(tuple(range(sides - 1, -1, -1)))
    faces.append(tuple(range((count - 1) * sides, count * sides)))
    return verts, faces


def outward_up(p: Vector, side: Vector, normal: Vector, out_w: float, up_w: float) -> Vector:
    """A unit direction in the tube's cross-section plane, blending "away from the
    rock's axis" with "up" — where the back of a coiled snake shows."""
    radial = Vector((p.x, p.y, 0.0))
    radial = radial.normalized() if radial.length > 1e-6 else Vector((1.0, 0.0, 0.0))
    want = radial * out_w + Vector((0.0, 0.0, 1.0)) * up_w
    d = side * want.dot(side) + normal * want.dot(normal)
    return d.normalized() if d.length > 1e-6 else normal


def jittered_revolve(profile, segments: int, jitter: float, seed: int, rings_to_jitter):
    """``blendkit.revolve`` with a seeded radial wobble on chosen profile rows.

    A perfect surface of revolution reads as a lathe-turned pot; a rock wants
    its silhouette to wander. Seeded, so two runs give the same bytes.
    """
    rng = random.Random(seed)
    wobble = [
        [1.0 + rng.uniform(-jitter, jitter) if row in rings_to_jitter else 1.0 for row in range(len(profile))]
        for _ in range(segments)
    ]
    verts, faces = revolve(profile, segments)
    count = len(profile)
    out = []
    for i, (x, y, z) in enumerate(verts):
        s, row = divmod(i, count)
        w = wobble[s][row]
        out.append((x * w, y * w, z))
    return out, faces


# =============================================================================
# The parts
# =============================================================================


def body_path():
    """Her centreline, burrow to chin, as a list of Vectors.

    Wound **clockwise seen from above** (bearing decreasing) so that the
    spiral's three full turns end on ``HEAD_BEARING`` and the neck can leave
    radially from there; the lead-in from the burrow therefore runs the short
    way round the foot of the rock, 60° or so.
    """
    # --- lead-in: up out of the burrow and round the foot ------------------
    burrow = Vector((BURROW_XY[0], BURROW_XY[1], -0.45))
    burrow_bearing = math.atan2(BURROW_XY[1], BURROW_XY[0])
    lead = [burrow, Vector((BURROW_XY[0] * 0.98, BURROW_XY[1] * 0.98, 0.05))]
    start_bearing = HEAD_BEARING + TAU  # one bearing the spiral starts from, CW to it
    # bring the lead-in bearing into the half-turn above the spiral start
    while burrow_bearing <= start_bearing - math.pi:
        burrow_bearing += TAU
    while burrow_bearing > start_bearing + math.pi:
        burrow_bearing -= TAU
    lead_steps = 5
    for s in range(1, lead_steps):
        f = s / lead_steps
        b = burrow_bearing + (start_bearing - burrow_bearing) * f
        r = 2.8 + (SPIRAL_R_OUTER - 2.8) * f
        z = 0.12 + (SPIRAL_Z_BOTTOM - 0.12) * f
        lead.append(Vector((r * math.cos(b), r * math.sin(b), z)))

    # --- the spiral: TURNS full turns, clockwise, ending on the head bearing
    steps_per_turn = 15  # 24° a step: still smooth on the 0.95 m inner turn under the toon ramp
    spiral = []
    total = TURNS * steps_per_turn
    for i in range(total + 1):
        f = i / total
        b = start_bearing - TURNS * TAU * f
        r = SPIRAL_R_OUTER + (SPIRAL_R_INNER - SPIRAL_R_OUTER) * f
        spiral.append(Vector((r * math.cos(b), r * math.sin(b), spiral_z_at_r(r))))

    # --- the neck: out over the pile and down to the kerb ------------------
    # Each waypoint sits over the top of the turn beneath it (that turn is one,
    # two, three full turns earlier in the spiral at this same bearing), minus
    # the sink, so she rests on her own coils rather than hovering.
    cb, sb = math.cos(HEAD_BEARING), math.sin(HEAD_BEARING)

    # `sway` is a sideways offset (metres, +ve to her left as she looks out),
    # so the neck comes down in a gentle S rather than a straight pipe.
    def over(r: float, lift: float, sway: float = 0.0) -> Vector:
        return Vector((r * cb - sway * sb, r * sb + sway * cb, spiral_z_at_r(r) + BODY_R + lift))

    chin_r = math.hypot(REPTILE_NOODLE_HEAD_X, REPTILE_NOODLE_HEAD_Z)
    head_centre_z = REPTILE_NOODLE_HEAD_Y + HEAD_HEIGHT * 0.5
    neck = [
        over(1.5, 0.30, 0.30),
        over(2.0, 0.30, 0.10),
        over(2.5, 0.28, -0.22),
        Vector((2.85 * cb + 0.12 * sb, 2.85 * sb - 0.12 * cb, head_centre_z + 0.12)),
        # the last stretch runs *into* the head so a 0.4 m "Say hi!" lift
        # still leaves the neck inside it
        Vector(((chin_r - 0.45) * cb, (chin_r - 0.45) * sb, head_centre_z)),
        Vector(((chin_r - 0.30) * cb, (chin_r - 0.30) * sb, head_centre_z)),
    ]
    smooth_neck = catmull_rom([spiral[-2], spiral[-1]] + neck, 4)[4:]
    return lead + spiral + smooth_neck


def build_body(coll, path, frames):
    count = len(path)
    neck_start = count - 25  # the catmull-rom neck is 6 waypoints × 4 samples + 1

    def radius_at(i: int) -> float:
        if i < neck_start:
            return BODY_R
        f = (i - neck_start) / max(1, count - 1 - neck_start)
        return BODY_R + (NECK_R - BODY_R) * min(1.0, f * 1.4)

    body = Part("rn-coil")
    # 14 sides, not the spec's 16: at r 0.42 the toon ramp cannot tell them
    # apart, and the two sides are ~320 triangles the budget needed elsewhere.
    body.add(*sweep_varying(path, frames, radius_at, 14))
    body.emit(coll)

    belly = Part("rn-coil-belly")

    def belly_offset(i, side, normal):
        # Round the lower-outer flank — far enough round that a band of it
        # shows from the game's 38° camera, which looks down on the pile.
        return outward_up(path[i], side, normal, 0.75, -0.6) * 0.16

    # 8 sides, not fewer: a 6-sided tube's 60° edges are over `emit`'s 46°
    # crease threshold, and the belly then rendered as hard-edged flat panels.
    belly.add(*sweep_varying(path, frames, lambda i: radius_at(i) * 0.84, 8, belly_offset))
    belly.emit(coll)

    spots = Part("rn-coil-spots")
    first = 6  # skip the burrow lead-in; spots start where she climbs onto the rock
    last = count - 10  # and stop short of the head
    rng = random.Random(7)
    for n in range(SPOT_COUNT):
        i = first + int((last - first) * (n + 0.5) / SPOT_COUNT)
        p = path[i]
        _t, side, normal = frames[i]
        # alternate between the back and the outer flank, with a little wander
        up_w = 0.9 if n % 2 == 0 else 0.45
        out_w = 0.35 if n % 2 == 0 else 0.9
        d = outward_up(p, side, normal, out_w + rng.uniform(-0.1, 0.1), up_w)
        along = frames[i][0]
        across = d.cross(along).normalized()
        r_here = radius_at(i)
        centre = p + d * (r_here - 0.035)
        rx, ry = 0.27 * r_here / BODY_R, 0.20 * r_here / BODY_R
        base = len(spots.verts)
        rim = []
        for k in range(6):
            a = k * TAU / 6
            rim.append(tuple(centre + along * (math.cos(a) * rx) + across * (math.sin(a) * ry)))
        spots.verts.extend(rim)
        spots.verts.append(tuple(centre + d * 0.05))
        spots.verts.append(tuple(centre - d * 0.03))
        apex, bottom = base + 6, base + 7
        for k in range(6):
            k2 = (k + 1) % 6
            spots.faces.append((base + k, base + k2, apex))
            spots.faces.append((base + k2, base + k, bottom))
    spots.emit(coll, weld=False)
    return neck_start


def build_mound(coll):
    """The rock. Its profile under the coil is the coil's own; the visible foot
    and crown get moss ledges — flat steps a child reads as "a rock you could
    climb", even though the kerb says she cannot."""
    profile = [(MOUND_BASE_R, -MOUND_SINK), (MOUND_BASE_R, 0.0)]
    # the foot: two ledges before the coil covers it
    profile += [(2.92, 0.05), (2.80, 0.06), (2.78, 0.11), (2.62, 0.12)]
    for r in (2.5, 2.0, 1.5, 1.2, SPIRAL_R_INNER):
        profile.append((r, mound_z_at_r(r)))
    # the crown: a stepped plateau inside the top turn
    peak = mound_z_at_r(SPIRAL_R_INNER)
    profile += [(0.70, peak), (0.66, peak - 0.08), (0.42, peak), (0.0, peak)]
    verts, faces = jittered_revolve(profile, 18, 0.045, seed=3, rings_to_jitter={0, 1, 2, 3, 4, 5})
    mound = Part("rn-mound").add(verts, faces)
    mound.emit(coll, sharp_deg=60.0)
    lo, hi = mound.bounds()
    return hi.z


def build_head(coll):
    """The head, authored about its own rest point and carried there by the node.

    The node's **origin** is the layout's rest point — ``(HEAD_X, HEAD_Y,
    HEAD_Z)`` in the game's axes — placed at the head's XZ centre and at its
    chin, the lowest vertex, so that the chin lies on the kerb
    (``REPTILE_ISLAND_KERB_HEIGHT``). A yaw of the node turns her to track the
    child and a lift of the node is the "Say hi!" nod, with no pivot
    arithmetic in the TypeScript; ``reptile_noodle_export.py`` allows a pure
    translation on a node for exactly this reason (the castle chest lid is
    the precedent).

    **PAINTED.** The front hemisphere carries planar UVs: ``u`` runs across her
    width as the child sees it (her right is the child's left), ``v`` runs
    **top to bottom** — ``(hi − z) / h`` — because ``glbCanvasTexture`` leaves
    ``flipY`` off and a glTF canvas's row 0 is the top of the picture. The
    back of the head is parked in the canvas's blank top-left corner so the
    face does not reappear mirrored on her nape. This is the UV contract
    shared with ``rr-snake-head`` (creatures kit) and ``rh-head`` (house kit):
    one snake-face canvas fits all three.
    """
    # Blender's icosphere levels: 2 is 80 faces, 3 is 320. The face lives on
    # this surface, so it gets the 320.
    verts, faces = icosphere(1.0, 3)
    # Local frame before placing: forward is −Y, up is +Z. Snout narrower than
    # the back of the head (the cheeks), nose rounded off, chin at z = 0.
    hl, hw, hh = HEAD_LENGTH * 0.5, HEAD_WIDTH * 0.5, HEAD_HEIGHT * 0.5
    shaped = []
    for x, y, z in verts:
        f = -y  # +1 at the snout, −1 at the nape
        cheek = 1.0 + 0.10 * (1.0 - f) * 0.5 - 0.22 * max(0.0, f) ** 2
        shaped.append((x * hw * cheek, y * hl, z * hh * (1.0 - 0.10 * max(0.0, f) ** 2) + hh))
    lo = Vector((-hw, 0.0, 0.0))
    hi = Vector((hw, 0.0, HEAD_HEIGHT))
    uvs = []
    for face in faces:
        pts = [Vector(shaped[i]) for i in face]
        normal = (pts[1] - pts[0]).cross(pts[2] - pts[0])
        if normal.y < -0.12 * normal.length:  # facing −Y: the front
            uvs.append([((p.x - lo.x) / (hi.x - lo.x), (hi.z - p.z) / (hi.z - lo.z)) for p in pts])
        else:
            uvs.append([(0.02, 0.02)] * len(face))
    origin = (REPTILE_NOODLE_HEAD_X, -REPTILE_NOODLE_HEAD_Z, REPTILE_NOODLE_HEAD_Y)
    yaw = math.degrees(HEAD_BEARING) + 90.0  # local −Y → HEAD_BEARING
    head = Part("rn-head").add(shaped, faces, matrix=rot_z(yaw), uvs=uvs)
    head.emit(coll, location=origin)

    # The tongue: origin at the mouth, so `scale 0 → 1` flicks it out.
    mouth_local = Vector((0.0, -hl * 0.96, HEAD_HEIGHT * 0.30))
    mouth_world = Vector(origin) + rot_z(yaw) @ mouth_local
    tongue = Part("rn-tongue")
    stem = [Vector((0.0, 0.0, 0.0)), Vector((0.0, -0.12, -0.01)), Vector((0.0, -0.26, -0.04))]
    prongs = [
        [stem[-1], Vector((-0.05, -0.36, -0.07)), Vector((-0.10, -0.46, -0.12))],
        [stem[-1], Vector((0.05, -0.36, -0.07)), Vector((0.10, -0.46, -0.12))],
    ]
    for pts in (stem, *prongs):
        pts = catmull_rom(pts, 3)
        fr = transport_frames(pts)
        tongue.add(*sweep_varying(pts, fr, lambda i, n=len(pts): 0.035 * (1.0 - 0.6 * i / n), 5), matrix=rot_z(yaw))
    tongue.emit(coll, location=tuple(mouth_world), weld=False)
    return origin, tuple(mouth_world), head


def build_burrow(coll):
    """A dark rim with a dark floor — the hole she goes down. Flat on the floor,
    0.06 m proud of it so nothing shares the floor plate's plane."""
    profile = [
        (BURROW_RIM_R, -MOUND_SINK),
        (BURROW_RIM_R, 0.04),
        (BURROW_RIM_R - 0.04, 0.16),
        (BURROW_RIM_R - 0.16, 0.18),
        (BURROW_RIM_R - 0.24, 0.10),
        (BURROW_RIM_R - 0.28, 0.06),
        (0.0, 0.06),
    ]
    verts, faces = jittered_revolve(profile, 12, 0.06, seed=11, rings_to_jitter={0, 1, 2, 3})
    burrow = Part("rn-burrow").add(verts, faces, Matrix.Translation((BURROW_XY[0], BURROW_XY[1], 0.0)))
    burrow.emit(coll)


def build_tail_mound(coll):
    """The nursery's mound, at its own origin: a soft hummock with a crater on
    top for the TypeScript tail chain to rise out of."""
    profile = [
        (TAIL_MOUND_R, -MOUND_SINK),
        (TAIL_MOUND_R, 0.0),
        (TAIL_MOUND_R * 0.85, 0.24),
        (TAIL_MOUND_R * 0.55, TAIL_MOUND_H * 0.92),
        (0.38, TAIL_MOUND_H),
        (0.30, TAIL_MOUND_H - 0.10),
        (0.16, TAIL_MOUND_H - 0.20),
        (0.0, TAIL_MOUND_H - 0.22),
    ]
    verts, faces = jittered_revolve(profile, 14, 0.05, seed=5, rings_to_jitter={0, 1, 2, 3})
    mound = Part("rn-tail-mound").add(verts, faces)
    mound.emit(coll, sharp_deg=60.0)
    return mound


# =============================================================================
# Main
# =============================================================================


def radial_extent(obj) -> float:
    return max(math.hypot(v.co.x, v.co.y) for v in obj.data.vertices)


def main() -> None:
    reset_scene()
    island = collection("noodle")
    nursery = collection("tail-mound")

    path = body_path()
    frames = transport_frames(path)
    neck_start = build_body(island, path, frames)
    mound_top = build_mound(island)
    head_origin, mouth, head_part = build_head(island)
    build_burrow(island)
    build_tail_mound(nursery)

    objs = {o.name: o for o in bpy.data.objects}

    print("\nreptile_noodle_build")
    print(summarise())

    # --- the contract, off the emitted vertices ------------------------------
    assert abs(mound_top - REPTILE_NOODLE_MOUND_HEIGHT) < 1e-3, (
        f"rn-mound peaks at {mound_top:.3f} m, not REPTILE_NOODLE_MOUND_HEIGHT {REPTILE_NOODLE_MOUND_HEIGHT}"
    )
    for name in ("rn-mound", "rn-coil", "rn-coil-belly", "rn-coil-spots", "rn-burrow"):
        extent = radial_extent(objs[name])
        assert extent <= REPTILE_ISLAND_RADIUS + 1e-6, (
            f"{name} reaches r {extent:.3f} m, outside the kerb at REPTILE_ISLAND_RADIUS {REPTILE_ISLAND_RADIUS}"
        )
    head_obj = objs["rn-head"]
    # Measured in the head's own frame (yaw undone): the pivot is the centre
    # of her length and width and the bottom of her chin. A world-axis box
    # round a yawed, snout-narrower-than-cheeks head is not centred on the
    # pivot and would say nothing useful.
    unyaw = rot_z(-(math.degrees(HEAD_BEARING) + 90.0))
    hv = [unyaw @ v.co for v in head_obj.data.vertices]
    hx = [v.x for v in hv]
    hy = [v.y for v in hv]
    hz = [v.z for v in hv]
    assert abs(min(hz)) < 1e-3, f"rn-head's chin is at local z {min(hz):+.3f}, not on its origin"
    assert abs((min(hx) + max(hx)) * 0.5) < 2e-2 and abs((min(hy) + max(hy)) * 0.5) < 2e-2, (
        f"rn-head's origin is not under its centre: local x {min(hx):+.2f}..{max(hx):+.2f}, y {min(hy):+.2f}..{max(hy):+.2f}"
    )
    assert tuple(round(c, 6) for c in head_obj.location) == tuple(round(c, 6) for c in head_origin)
    assert REPTILE_NOODLE_HEAD_Y >= REPTILE_ISLAND_KERB_HEIGHT - 1e-6, (
        "the chin's rest height is below the kerb it is supposed to rest on"
    )
    head_reach = max(math.hypot(head_origin[0] + v.co.x, head_origin[1] + v.co.y) for v in head_obj.data.vertices)
    assert radial_extent(objs["rn-tail-mound"]) <= REPTILE_NURSERY_RADIUS - 0.5, (
        "rn-tail-mound is too wide for the nursery"
    )
    # The tongue's origin (the mouth) must be inside the head's own bounds.
    tongue_obj = objs["rn-tongue"]
    rel = unyaw @ (Vector(tongue_obj.location) - Vector(head_origin))
    assert min(hx) <= rel.x <= max(hx) and min(hy) <= rel.y <= max(hy) and 0.0 <= rel.z <= max(hz), (
        f"rn-tongue's origin {tuple(round(c, 3) for c in rel)} is not inside rn-head"
    )

    top_of_everything = max(v.co.z + o.location.z for o in bpy.data.objects if o.type == "MESH" for v in o.data.vertices)
    assert top_of_everything <= PILE_TOP_LIMIT, (
        f"the pile tops out at {top_of_everything:.2f} m, over PILE_TOP_LIMIT {PILE_TOP_LIMIT}"
    )
    tris = total_triangles()
    assert tris <= TRIANGLE_BUDGET, f"{tris} triangles is over the kit's {TRIANGLE_BUDGET}"

    print(f"  total {tris} triangles (budget {TRIANGLE_BUDGET})")
    print(f"  body path: {len(path)} samples, neck from sample {neck_start}; body r {BODY_R}, neck r {NECK_R}")
    print(f"  spiral: {TURNS} turns, r {SPIRAL_R_OUTER} → {SPIRAL_R_INNER}, centreline z {SPIRAL_Z_BOTTOM:.2f} → {SPIRAL_Z_TOP:.2f}")
    print(f"  mound peak z {mound_top:.3f} (REPTILE_NOODLE_MOUND_HEIGHT {REPTILE_NOODLE_MOUND_HEIGHT})")
    print(f"  top of the whole pile z {top_of_everything:.3f}")
    print(
        f"  rn-head: node origin (game x, y, z) = ({head_origin[0]:+.3f}, {head_origin[2]:+.3f}, {-head_origin[1]:+.3f});"
        f" width × length × height {max(hx) - min(hx):.2f} × {max(hy) - min(hy):.2f} × {max(hz):.2f} m in her own frame;"
        f" faces bearing {math.degrees(HEAD_BEARING):+.0f}° (game rotation.y 45°)"
    )
    print(f"  rn-head: snout reaches r {head_reach:.2f} m (island collider r {REPTILE_ISLAND_COLLIDER_RADIUS})")
    print(
        f"  rn-tongue: node origin (game x, y, z) = ({mouth[0]:+.3f}, {mouth[2]:+.3f}, {-mouth[1]:+.3f});"
        " scale it 0 → 1 to flick"
    )
    print(f"  rn-burrow: rim centred game ({BURROW_XY[0]:+.2f}, {-BURROW_XY[1]:+.2f}), rim r {BURROW_RIM_R}")
    print(f"  rn-tail-mound: r {radial_extent(objs['rn-tail-mound']):.2f}, h {TAIL_MOUND_H} (nursery r {REPTILE_NURSERY_RADIUS})")

    bpy.ops.wm.save_as_mainfile(filepath=BLEND)
    print("  wrote", BLEND, "\n")


if __name__ == "__main__":
    try:
        main()
    except Exception:
        traceback.print_exc()
        sys.exit(1)
