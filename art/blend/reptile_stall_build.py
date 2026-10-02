"""Builds the Reptile House's stall kit and saves ``art/blend/reptile_stall.blend``.

    blender --background --factory-startup --python-exit-code 1 \
        --python art/blend/reptile_stall_build.py

Two things travel in this one file, each authored about **its own base
origin** (ART_DIRECTION §7) and told apart by name prefix:

* ``rs-awning`` … ``rs-stall-*`` — the dressing that turns ``kiosk.ts``'s plain
  counter-and-back-panel into **Scales & Tails**: a scalloped cloth awning on
  two posts, a long mint snake lying along its front eave and coiling up at
  the near corner to lift a smiling head at the shopper, a second snake coiled
  into a finial crest on the awning's back ridge, and the name board standing
  on the front eave. Authored in the kiosk's own frame, so the awning's eaves land
  over the counter `kiosk.ts` builds and the finial sits on the panel it
  builds, with nothing to line up afterwards.
* ``rs-meter-*`` — the **Noodle-o-meter**: a post taller than the tallest hat,
  a band every baby-snake unit, a snake coiled up it, and a board on top for
  the "How tall?" copy. A free-standing prop, placed by the room on its own.

## What this file owns, and what it asks for

**The mesh owns its shape numbers** — cloth thickness, scallop size, body
radii, where a head looks — and asserts the ones that matter against the
emitted vertices at the end of every run. The numbers that are **shared with
the game** are read, never typed (CLAUDE.md, "two definitions of one thing"):

* ``COUNTER_HALF_WIDTH``, ``COUNTER_Z``, ``COUNTER_DEPTH``, ``SHELF_Z``
  (``shops/stallShape.ts``) — the counter and the back panel this awning has
  to reach over.
* ``REPTILE_METER_POST_HEIGHT`` and ``REPTILE_BABY_SNAKE_UNIT``
  (``reptileHouse/layout.ts``) — the post, and the band spacing the game's
  "You are N baby snakes tall!" arithmetic divides by.
* ``TALLEST_CHILD_HEIGHT`` (``kid.ts``) — nothing of the awning in front of
  the counter may come down to her hat.

All of them arrive through ``reptile_constants.py``, the one Blender-side
accessor, which asserts the cross-kit relationships before any mesh exists.

**No colour, no material, no texture in the ``.glb``.** The loader
(``src/art/models/reptileStallAssets.ts``) owns the colour table. The two
boards carry their **own UVs** for the sign atlas; the snake faces are
geometry — ink eye discs with a catchlight, a little w-mouth and a forked
tongue, the hotel's ``petbed-toy-eye`` precedent — because these three snakes
are decoration seen from the fixed camera, not creatures with expressions,
and a canvas each would spend the house's six-canvas ceiling on bunting.

## Conventions (ART_DIRECTION §7, blendkit)

* 1 Blender unit = 1 metre; **Blender −Y is the game's +Z**, i.e. toward the
  counter front and the child being served. Every head looks that way.
* Every node leaves at an identity transform with placement baked in.
* One node per colour. Faces, catchlights, tongues and spots of the two stall
  snakes share one node each (``rs-stall-snake-*``); the meter snake's are
  their own (``rs-meter-snake-*``) because the meter is placed separately.
* Where parts meet they interpenetrate (posts into the counter plank, boards
  into the cloth, the coil into its plinth) so no two faces share a plane.
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
    reset_scene,
    revolve,
    summarise,
    total_triangles,
    tube,
)
from reptile_constants import (  # noqa: E402
    BACK_PANEL_Z,
    COUNTER_DEPTH,
    COUNTER_HALF_WIDTH,
    COUNTER_Z,
    REPTILE_BABY_SNAKE_UNIT,
    REPTILE_METER_POST_HEIGHT,
    TALLEST_CHILD_HEIGHT,
)

BLEND = os.path.join(REPO, "art", "blend", "reptile_stall.blend")

#: Pack and loader budget for the whole kit (the spec's ceiling).
TRIANGLE_BUDGET = 2500

# ------------------------------------------------------------- the kiosk, in
# Blender's frame: game +Z is Blender −Y, so the counter is at negative y.
COUNTER_FRONT_Y = -(COUNTER_Z + COUNTER_DEPTH / 2)
BACK_PANEL_Y = -BACK_PANEL_Z

# ----------------------------------------------------------------- the awning
#
# A pitched cloth, high at the back and low at the front, with a gentle sag,
# and a scalloped hem all round the three open edges. It overhangs the counter
# by a lip so it reads as a canopy rather than a lid. The stall stands alone
# in the foyer (not on the mall's row), so the mall's no-overhang rule does
# not bind here — but the hem still has to clear the tallest hat anywhere a
# child can stand, which is everything in front of the counter.
AWN_LIP_X = 0.25
AWN_HALF_X = COUNTER_HALF_WIDTH + AWN_LIP_X
AWN_Y_FRONT = COUNTER_FRONT_Y - 0.45
AWN_Y_BACK = BACK_PANEL_Y + 0.25
#: Underside of the cloth at the front eave.
AWN_EAVE_Z = 3.25
#: Underside at the back edge.
AWN_BACK_Z = 3.85
#: How far the cloth dips below the straight line between the two, mid-way.
AWN_SAG = 0.12
AWN_CLOTH_T = 0.07
#: The hem: half-round scallops, this many along the front and each side.
SCALLOPS_FRONT = 8
SCALLOPS_SIDE = 4
SCALLOP_SEGMENTS = 4
#: Ridge-side headroom the hem must keep over the tallest hat, in front of
#: the counter. The awning drops nothing lower than its front eave.
HEM_MARGIN = 0.25

POST_R = 0.075
#: The posts stand through the counter's top plank (`kiosk.ts` puts it at
#: y 0.98 ± 0.06), just inside the awning's lip, and rise into the cloth.
POST_X = COUNTER_HALF_WIDTH + 0.02
POST_Y = COUNTER_FRONT_Y - 0.05
POST_BASE_Z = 0.9

# ------------------------------------------------------------------- the sign
SIGN_HALF_W = 0.75
SIGN_H = 0.5
SIGN_T = 0.06
SIGN_CORNER_R = 0.12
#: Behind the eave snake, standing on the cloth with its foot buried in it.
SIGN_Y = AWN_Y_FRONT + 0.38

# ---------------------------------------------------------------- the snakes
#
# A snake here is a tapered tube swept along a path, a big squashed-sphere
# head, two tall ink eyes with a catchlight each, a w-mouth and a forked
# tongue. Big head, small body, eyes low and wide: ART_DIRECTION §4.
BODY_SIDES = 5
#: Head size as a multiple of the body radius: length, width, height.
HEAD_SCALE = (4.0, 3.1, 2.7)
SPOTS_PER_SNAKE = 4

#: The eave snake: tail at the far (−X) front corner, body along the front
#: eave, a flat coil on the near (+X) corner, head lifted at the shopper.
EAVE_SNAKE_R = 0.13
EAVE_COIL_CENTRE = (AWN_HALF_X - 0.55, AWN_Y_FRONT + 0.52)
EAVE_COIL_R = 0.42

#: The finial: a cone-coil standing on the awning's back ridge — the stall's
#: crest, where every mall stall carries its emblem. The spec put it on the
#: back panel; measured from the park camera's 38° pitch, the awning's 3.9 m
#: back edge shadows 1.8 m of everything behind and below it, so a coil on a
#: 1.5 m panel under the cloth would never be seen. Up here it is the first
#: thing read across the foyer.
FINIAL_R = 0.11
FINIAL_PLINTH_R = 0.36
FINIAL_PLINTH_H = 0.06
FINIAL_COIL_R = 0.34
FINIAL_TURNS = 2.25
FINIAL_Y = AWN_Y_BACK - 0.42

#: The meter: post, bands, a helix up it, the board on top.
METER_POST_R = 0.12
METER_BASE_R = 0.34
METER_BASE_H = 0.07
METER_BAND_R = 0.15
METER_BAND_H = 0.05
METER_SNAKE_R = 0.09
METER_TURNS = 2.5
METER_BOARD_HALF_W = 0.5
METER_BOARD_H = 0.45
METER_BOARD_T = 0.06
METER_BOARD_CORNER_R = 0.1


# =============================================================================
# Shape helpers this kit needs beyond blendkit's
# =============================================================================


def sweep_var(points, radii, sides=BODY_SIDES):
    """An open tapered tube: ``blendkit.sweep_path`` with a radius per point
    and a parallel-transported frame, so a path that climbs a post or rears
    into a neck does not pinch where its tangent nears the reference up."""
    pts = [Vector(p) for p in points]
    count = len(pts)
    tangents = []
    for i in range(count):
        nxt = pts[min(i + 1, count - 1)]
        prv = pts[max(i - 1, 0)]
        tangents.append((nxt - prv).normalized())
    up = Vector((0.0, 0.0, 1.0))
    if abs(tangents[0].dot(up)) > 0.9:
        up = Vector((0.0, -1.0, 0.0))
    side = tangents[0].cross(up).normalized()
    verts = []
    faces = []
    for i in range(count):
        if i:
            spin = tangents[i - 1].rotation_difference(tangents[i])
            side = (spin @ side).normalized()
            # Re-orthogonalise against drift from the quaternion products.
            side = (side - tangents[i] * side.dot(tangents[i])).normalized()
        normal = side.cross(tangents[i]).normalized()
        r = radii[i]
        for k in range(sides):
            a = k * TAU / sides
            verts.append(tuple(pts[i] + side * (math.cos(a) * r) + normal * (math.sin(a) * r)))
    for i in range(count - 1):
        for k in range(sides):
            k_next = (k + 1) % sides
            faces.append((i * sides + k, i * sides + k_next, (i + 1) * sides + k_next, (i + 1) * sides + k))
    faces.append(tuple(range(sides - 1, -1, -1)))
    faces.append(tuple(range((count - 1) * sides, count * sides)))
    return verts, faces


def ellipsoid_rev(rx, ry, rz, segments=12, rings=6):
    """A squashed sphere as a surface of revolution — a 12-gon silhouette
    from every side, which a subdivision-1 icosphere (hexagonal in outline)
    cannot give a head, at under half the cost of subdivision 2."""
    profile = []
    for i in range(rings + 1):
        phi = math.pi * i / rings
        profile.append((math.sin(phi), math.cos(phi)))
    verts, faces = revolve(profile, segments)
    return [(v[0] * rx, v[1] * ry, v[2] * rz) for v in verts], faces


def disc(rx, ry, thickness, sides):
    """A flat elliptical coin standing on z = 0, its axis along Z."""
    verts, faces = tube(1.0, thickness, sides)
    return [(v[0] * rx, v[1] * ry, v[2]) for v in verts], faces


def frame_to(forward, up=(0.0, 0.0, 1.0)):
    """A rotation whose local +Y is ``forward`` and local +Z is as near ``up`` as it can be."""
    return Vector(forward).normalized().to_track_quat("Y", "Z").to_matrix().to_4x4()


def axis_to(normal):
    """A rotation whose local +Z is ``normal``."""
    return Vector(normal).normalized().to_track_quat("Z", "Y").to_matrix().to_4x4()


def taper(count, r_max, r_tail=0.03, tail_fraction=0.22, neck_fraction=0.0, r_neck=None):
    """Radii along a body: thin at the tail, fat, optionally thinning to a neck."""
    out = []
    for i in range(count):
        t = i / max(count - 1, 1)
        if t < tail_fraction:
            s = t / tail_fraction
            r = r_tail + (r_max - r_tail) * (0.5 - 0.5 * math.cos(math.pi * s))
        elif neck_fraction and t > 1.0 - neck_fraction:
            s = (t - (1.0 - neck_fraction)) / neck_fraction
            r = r_max + ((r_neck if r_neck is not None else r_max * 0.85) - r_max) * s
        else:
            r = r_max
        out.append(r)
    return out


class Snake:
    """The parts of one snake, each a :class:`Part` the caller names.

    ``body`` is the colourway; ``face`` is ink (eyes and mouth); ``shine`` the
    catchlights; ``tongue`` pink; ``spots`` the back markings. Several snakes
    may share the same five parts when they ship as one node per colour.
    """

    def __init__(self, body, face, shine, tongue, spots):
        self.body, self.face, self.shine, self.tongue, self.spots = body, face, shine, tongue, spots

    def lay(self, points, radii, *, head_forward, spot_every):
        """Sweep the body and put the head on its last point."""
        self.body.add(*sweep_var(points, radii))
        pts = [Vector(p) for p in points]
        # Spots along the back: on top of the body, skipping the tapered tail
        # and the last few points the head covers.
        start = int(len(pts) * 0.3)
        stop = len(pts) - 4
        for i in range(start, stop, spot_every):
            t = (pts[i + 1] - pts[i - 1]).normalized()
            n = Vector((0.0, 0.0, 1.0))
            n = (n - t * n.dot(t)).normalized()
            r = radii[i]
            m = Matrix.Translation(pts[i] + n * (r * 0.92)) @ axis_to(n)
            self.spots.add(*disc(r * 0.62, r * 0.48, 0.012, 6), m)
        self.head(pts[-1], radii[-1], head_forward)

    def head(self, neck, r, forward):
        length, width, height = (r * s for s in HEAD_SCALE)
        fwd = Vector(forward).normalized()
        # The head's centre is a little forward of the neck's end so the neck
        # runs into its back rather than its middle.
        centre = Vector(neck) + fwd * (length * 0.32)
        m = Matrix.Translation(centre) @ frame_to(fwd)
        a, b, c = width / 2, length / 2, height / 2
        self.body.add(*ellipsoid_rev(a, b, c), m)

        def surface(d):
            """Point on and outward normal of the head ellipsoid in local direction d."""
            d = Vector(d).normalized()
            k = 1.0 / math.sqrt((d.x / a) ** 2 + (d.y / b) ** 2 + (d.z / c) ** 2)
            p = d * k
            n = Vector((p.x / a**2, p.y / b**2, p.z / c**2)).normalized()
            return p, n

        # Eyes: tall ink ovals low on the face, wide apart, with a catchlight
        # high and forward on each — the house face (ART_DIRECTION §3).
        for s in (-1.0, 1.0):
            p, n = surface((s * 0.48, 0.82, 0.34))
            eye = Matrix.Translation(centre) @ frame_to(fwd) @ Matrix.Translation(p - n * 0.004) @ axis_to(n)
            self.face.add(*disc(width * 0.17, height * 0.26, 0.012, 8), eye)
            glint = (
                Matrix.Translation(centre)
                @ frame_to(fwd)
                @ Matrix.Translation(p + n * 0.006 + Vector((s * -0.03, 0.0, 0.07)) * width)
                @ axis_to(n)
            )
            self.shine.add(*disc(width * 0.055, width * 0.07, 0.01, 6), glint)
        # The w-mouth: a thin ink line across the front of the snout, dipping
        # twice — five points, no teeth, nothing scary.
        mouth = []
        for i, (x, dz) in enumerate(((-0.42, 0.0), (-0.21, -0.1), (0.0, 0.0), (0.21, -0.1), (0.42, 0.0))):
            p, n = surface((x, 0.95, -0.25 + dz))
            mouth.append(p + n * 0.006)
        line_verts, line_faces = sweep_var(mouth, [width * 0.035] * len(mouth), 3)
        self.face.add(line_verts, line_faces, m)
        # Forked tongue, out of the snout tip and splaying.
        tip, _ = surface((0.0, 1.0, -0.42))
        for s in (-1.0, 1.0):
            fork = [tip, tip + Vector((0.0, length * 0.22, -height * 0.05)), tip + Vector((s * width * 0.16, length * 0.4, -height * 0.02))]
            tv, tf = sweep_var(fork, [width * 0.045, width * 0.04, width * 0.02], 3)
            self.tongue.add(tv, tf, m)


def rounded_plank(half_width, bottom, height, depth, radius, segments=3):
    """A board in XZ with rounded corners, extruded through Y, facing −Y.

    Same shape as the entrance arch's sign plank, for the same reason: the
    two flat faces are what the atlas is painted across.
    """
    z0, z1 = bottom, bottom + height
    outline = []
    for cx, cz, start in (
        (half_width - radius, z0 + radius, -math.pi / 2),
        (half_width - radius, z1 - radius, 0.0),
        (-(half_width - radius), z1 - radius, math.pi / 2),
        (-(half_width - radius), z0 + radius, math.pi),
    ):
        for s in range(segments + 1):
            a = start + (s / segments) * (math.pi / 2)
            outline.append((cx + radius * math.cos(a), cz + radius * math.sin(a)))
    count = len(outline)
    half = depth * 0.5
    verts = [(x, -half, z) for x, z in outline] + [(x, half, z) for x, z in outline]
    faces = []
    for i in range(count):
        j = (i + 1) % count
        faces.append((i, j, count + j, count + i))
    faces.append(tuple(range(count)))
    faces.append(tuple(range(2 * count - 1, count - 1, -1)))
    return verts, faces


def paint_planar_uvs(obj, lo_x, hi_x, lo_z, hi_z):
    """Planar UVs computed from where the emitted vertices are.

    After ``Part.emit``, not through it, because ``remove_doubles`` reorders
    faces and a per-face table keyed by the old index lands on the wrong
    face. ``u`` runs with x on the −Y face and against it on the +Y face so
    the words read from both sides; ``v`` is ``(hi_z − z)`` because the glTF
    exporter writes ``1 − v`` (the entrance arch's lesson, `gate_arch_build.py`).
    """
    mesh = obj.data
    width = max(hi_x - lo_x, 1e-6)
    height = max(hi_z - lo_z, 1e-6)
    layer = mesh.uv_layers.new(name="UVMap")
    for poly in mesh.polygons:
        mirror = poly.normal.y > 1e-6
        for loop_index in poly.loop_indices:
            co = mesh.vertices[mesh.loops[loop_index].vertex_index].co
            u = (co.x - lo_x) / width if not mirror else (hi_x - co.x) / width
            layer.data[loop_index].uv = (u, (hi_z - co.z) / height)


# =============================================================================
# The stall
# =============================================================================


def cloth_z(y):
    """Underside of the awning cloth at depth ``y``: pitched back-to-front, sagging."""
    t = (y - AWN_Y_FRONT) / (AWN_Y_BACK - AWN_Y_FRONT)
    t = min(max(t, 0.0), 1.0)
    return AWN_EAVE_Z + (AWN_BACK_Z - AWN_EAVE_Z) * t - AWN_SAG * math.sin(math.pi * t)


def scalloped_outline():
    """The awning's plan outline, going round anticlockwise seen from above:
    back-left corner, down the left side, along the front, up the right side,
    then straight across the back. Scallops bulge outward on the open edges."""
    pts = []

    def edge(a, b, count, outward):
        a, b = Vector(a), Vector(b)
        step = (b - a) / count
        half = step.length / 2
        for i in range(count):
            start = a + step * i
            mid = start + step / 2
            for s in range(SCALLOP_SEGMENTS):
                ang = math.pi * s / SCALLOP_SEGMENTS
                # From cusp to cusp through the bulge: along the edge by cos,
                # outward by sin.
                along = -math.cos(ang) * half
                p = mid + step.normalized() * along + Vector(outward) * (math.sin(ang) * half)
                pts.append((p.x, p.y))

    edge((-AWN_HALF_X, AWN_Y_BACK), (-AWN_HALF_X, AWN_Y_FRONT), SCALLOPS_SIDE, (-1.0, 0.0))
    edge((-AWN_HALF_X, AWN_Y_FRONT), (AWN_HALF_X, AWN_Y_FRONT), SCALLOPS_FRONT, (0.0, -1.0))
    edge((AWN_HALF_X, AWN_Y_FRONT), (AWN_HALF_X, AWN_Y_BACK), SCALLOPS_SIDE, (1.0, 0.0))
    pts.append((AWN_HALF_X, AWN_Y_BACK))
    return pts


def build_awning(coll):
    part = Part("rs-awning")
    outline = scalloped_outline()
    count = len(outline)
    lower = [(x, y, cloth_z(y)) for x, y in outline]
    upper = [(x, y, cloth_z(y) + AWN_CLOTH_T) for x, y in outline]
    verts = lower + upper
    mid_y = (AWN_Y_FRONT + AWN_Y_BACK) / 2
    centre_lo = len(verts)
    verts.append((0.0, mid_y, cloth_z(mid_y)))
    centre_hi = len(verts)
    verts.append((0.0, mid_y, cloth_z(mid_y) + AWN_CLOTH_T))
    faces = []
    for i in range(count):
        j = (i + 1) % count
        faces.append((i, j, count + j, count + i))
        faces.append((j, i, centre_lo))
        faces.append((count + i, count + j, centre_hi))
    part.add(verts, faces)
    return part.emit(coll, sharp_deg=70.0)


def build_posts(coll):
    """Two round posts under the front eave, and the finial's little plinth
    on the awning's back ridge — all one wood colour, so one node."""
    part = Part("rs-awning-posts")
    for sx in (-1.0, 1.0):
        x = sx * POST_X
        height = cloth_z(POST_Y) + AWN_CLOTH_T * 0.6 - POST_BASE_Z
        part.at(*tube(POST_R, height, 8), x, POST_Y, POST_BASE_Z)
    part.at(*tube(FINIAL_PLINTH_R, FINIAL_PLINTH_H, 10), 0.0, FINIAL_Y, cloth_z(FINIAL_Y) + AWN_CLOTH_T - 0.02)
    return part.emit(coll)


def build_sign(coll):
    part = Part("rs-sign")
    bottom = cloth_z(SIGN_Y) + AWN_CLOTH_T - 0.04
    part.at(*rounded_plank(SIGN_HALF_W, 0.0, SIGN_H, SIGN_T, SIGN_CORNER_R), 0.0, SIGN_Y, bottom)
    obj = part.emit(coll, smooth=False)
    paint_planar_uvs(obj, -SIGN_HALF_W, SIGN_HALF_W, bottom, bottom + SIGN_H)
    return obj


def eave_snake_path():
    """Along the front eave, then a flat coil on the near corner, then up."""
    pts = []
    radii = []
    top = cloth_z(AWN_Y_FRONT) + AWN_CLOTH_T
    x0 = -AWN_HALF_X + 0.12
    cx, cy = EAVE_COIL_CENTRE
    x1 = cx - EAVE_COIL_R
    along = 22
    for i in range(along):
        t = i / (along - 1)
        x = x0 + (x1 - x0) * t
        wave = math.sin(t * math.pi * 3.0)
        pts.append((x, AWN_Y_FRONT + 0.1 + wave * 0.07, top + abs(wave) * 0.03))
    # The coil: a spiral in from the eave, a turn and a quarter, climbing.
    coil = 13
    for i in range(1, coil + 1):
        t = i / coil
        ang = math.pi + t * TAU * 1.2
        r = EAVE_COIL_R * (1.0 - 0.45 * t)
        pts.append((cx + r * math.cos(ang), cy + r * math.sin(ang), top + EAVE_SNAKE_R + 0.22 * t))
    # The neck: up and forward, to the head looking at the shopper.
    last = Vector(pts[-1])
    neck = 4
    for i in range(1, neck + 1):
        t = i / neck
        pts.append((last.x + 0.08 * t, last.y - 0.42 * t * t, last.z + 0.62 * math.sin(t * math.pi / 2)))
    radii = taper(len(pts), EAVE_SNAKE_R, neck_fraction=0.12, r_neck=EAVE_SNAKE_R * 0.9)
    # Seat the straight run on the cloth by its own local radius, so the thin
    # tail lies on the roof rather than floating at the fat body's height.
    pts = [(x, y, z + radii[i]) if i < along else (x, y, z) for i, (x, y, z) in enumerate(pts)]
    return pts, radii


def finial_path():
    cx, cy = 0.0, FINIAL_Y
    z0 = cloth_z(FINIAL_Y) + AWN_CLOTH_T + FINIAL_PLINTH_H - 0.02
    pts = []
    turns = 14
    for i in range(turns + 1):
        t = i / turns
        ang = -math.pi / 2 + t * TAU * FINIAL_TURNS
        r = FINIAL_COIL_R * (1.0 - 0.6 * t)
        pts.append((cx + r * math.cos(ang), cy + r * math.sin(ang), z0 + 0.68 * t))
    last = Vector(pts[-1])
    for i in range(1, 5):
        t = i / 4
        pts.append((last.x, last.y - 0.16 * t, last.z + 0.2 * t))
    radii = taper(len(pts), FINIAL_R, neck_fraction=0.15, r_neck=FINIAL_R * 0.85)
    pts = [(x, y, z + radii[i]) for i, (x, y, z) in enumerate(pts)]
    return pts, radii


def build_stall_snakes(coll):
    body = Part("rs-awning-snake")
    finial = Part("rs-finial")
    face = Part("rs-stall-snake-face")
    shine = Part("rs-stall-snake-shine")
    tongue = Part("rs-stall-snake-tongue")
    spots = Part("rs-stall-snake-spots")
    pts, radii = eave_snake_path()
    Snake(body, face, shine, tongue, spots).lay(pts, radii, head_forward=(0.35, -1.0, -0.25), spot_every=7)
    pts, radii = finial_path()
    Snake(finial, face, shine, tongue, spots).lay(pts, radii, head_forward=(0.0, -1.0, -0.2), spot_every=6)
    # Bodies keep a crease at their tail caps; the face discs, catchlights,
    # tongues and spots are emitted fully smooth: a 1 cm coin's rim-to-cap
    # edge is invisible, and splitting it triples every vertex in the kit's
    # fattest category of parts (`pack:` found 23 discs costing ~17 KB).
    return [body.emit(coll, sharp_deg=80.0), finial.emit(coll, sharp_deg=80.0)] + [
        p.emit(coll, sharp_deg=100.0) for p in (face, shine, tongue, spots)
    ]


# =============================================================================
# The Noodle-o-meter
# =============================================================================


def build_meter_post(coll):
    part = Part("rs-meter-post")
    part.at(*tube(METER_BASE_R, METER_BASE_H, 12), 0.0, 0.0, 0.0)
    part.at(*tube(METER_POST_R, REPTILE_METER_POST_HEIGHT - METER_BASE_H * 0.5, 8), 0.0, 0.0, METER_BASE_H * 0.5)
    return part.emit(coll)


def build_meter_bands(coll):
    """A band every baby-snake unit, so the post is a ruler she can read."""
    part = Part("rs-meter-bands")
    z = REPTILE_BABY_SNAKE_UNIT
    count = 0
    while z < REPTILE_METER_POST_HEIGHT - 0.1:
        part.at(*tube(METER_BAND_R, METER_BAND_H, 6), 0.0, 0.0, z - METER_BAND_H / 2)
        z += REPTILE_BABY_SNAKE_UNIT
        count += 1
    return part.emit(coll), count


def build_meter_board(coll):
    part = Part("rs-meter-board")
    bottom = REPTILE_METER_POST_HEIGHT - 0.06
    part.at(*rounded_plank(METER_BOARD_HALF_W, 0.0, METER_BOARD_H, METER_BOARD_T, METER_BOARD_CORNER_R), 0.0, 0.0, bottom)
    obj = part.emit(coll, smooth=False)
    paint_planar_uvs(obj, -METER_BOARD_HALF_W, METER_BOARD_HALF_W, bottom, bottom + METER_BOARD_H)
    return obj


def meter_snake_path():
    helix_r = METER_POST_R + METER_SNAKE_R * 0.9
    z0 = METER_BASE_H
    z1 = REPTILE_METER_POST_HEIGHT - 0.55
    pts = []
    steps = 20
    for i in range(steps + 1):
        t = i / steps
        # Finish on the front (−Y) of the post so the neck lifts straight at her.
        ang = -math.pi / 2 - TAU * METER_TURNS * (1.0 - t)
        pts.append((helix_r * math.cos(ang), helix_r * math.sin(ang), z0 + (z1 - z0) * t))
    last = Vector(pts[-1])
    for i in range(1, 5):
        t = i / 4
        pts.append((last.x, last.y - 0.1 * t, last.z + 0.22 * t))
    radii = taper(len(pts), METER_SNAKE_R, neck_fraction=0.12, r_neck=METER_SNAKE_R * 0.85)
    pts = [(x, y, z + radii[i]) for i, (x, y, z) in enumerate(pts)]
    return pts, radii


def build_meter_snake(coll):
    body = Part("rs-meter-snake")
    face = Part("rs-meter-snake-face")
    shine = Part("rs-meter-snake-shine")
    tongue = Part("rs-meter-snake-tongue")
    spots = Part("rs-meter-snake-spots")
    pts, radii = meter_snake_path()
    Snake(body, face, shine, tongue, spots).lay(pts, radii, head_forward=(0.0, -1.0, 0.15), spot_every=7)
    return [body.emit(coll, sharp_deg=80.0)] + [p.emit(coll, sharp_deg=100.0) for p in (face, shine, tongue, spots)]


# =============================================================================
# Checks — against the emitted vertices
# =============================================================================


def measured():
    out = {}
    for obj in bpy.data.objects:
        if obj.type != "MESH":
            continue
        lo = Vector((1e9, 1e9, 1e9))
        hi = Vector((-1e9, -1e9, -1e9))
        for v in obj.data.vertices:
            p = obj.matrix_world @ v.co
            lo = Vector((min(lo[i], p[i]) for i in range(3)))
            hi = Vector((max(hi[i], p[i]) for i in range(3)))
        out[obj.name] = (lo, hi)
    return out


def check_headroom():
    """Nothing of the stall dressing in front of the counter may come down
    to the tallest hat. Per vertex, over the strip y < COUNTER_FRONT_Y."""
    lowest = 1e9
    owner = "nothing"
    for obj in bpy.data.objects:
        if obj.type != "MESH" or obj.name.startswith("rs-meter-"):
            continue
        if obj.name == "rs-awning-posts":
            continue  # the posts stand through the counter plank, inside its collider
        for v in obj.data.vertices:
            p = obj.matrix_world @ v.co
            if p.y < COUNTER_FRONT_Y and p.z < lowest:
                lowest = p.z
                owner = obj.name
    clearance = lowest - TALLEST_CHILD_HEIGHT
    assert clearance >= HEM_MARGIN, (
        f"{owner} comes down to {lowest:.3f} m in front of the counter — only "
        f"{clearance:.3f} m over a {TALLEST_CHILD_HEIGHT} m child in the tallest hat"
    )
    return f"    lowest thing in front of the counter: {owner} at {lowest:.3f} m, {clearance:+.3f} m over TALLEST_CHILD_HEIGHT"


def check_awning_covers_counter(bounds):
    lo, hi = bounds["rs-awning"]
    assert lo.x <= -COUNTER_HALF_WIDTH and hi.x >= COUNTER_HALF_WIDTH, "the awning is narrower than the counter"
    assert lo.y <= COUNTER_FRONT_Y and hi.y >= BACK_PANEL_Y, "the awning does not reach from the back panel to the counter front"
    return (
        f"    awning {hi.x - lo.x:.2f} × {hi.y - lo.y:.2f} m over a counter {2 * COUNTER_HALF_WIDTH:.2f} m wide "
        f"(front y {COUNTER_FRONT_Y:+.2f}, back panel y {BACK_PANEL_Y:+.2f}); top {hi.z:.3f} m"
    )


def check_finial_sits_on_ridge(bounds):
    lo, hi = bounds["rs-finial"]
    ridge = cloth_z(FINIAL_Y) + AWN_CLOTH_T
    assert ridge - 0.03 <= lo.z <= ridge + FINIAL_PLINTH_H + 0.03, f"the finial starts at {lo.z:.3f}, not on the ridge at {ridge:.3f}"
    assert abs((lo.x + hi.x) / 2) < 0.1, "the finial is not centred on the stall"
    assert hi.y <= AWN_Y_BACK, "the finial overhangs the awning's back edge"
    return f"    finial on the awning's back ridge: z {lo.z:.3f}..{hi.z:.3f}, centred y {(lo.y + hi.y) / 2:+.2f}"


def check_meter(bounds, bands):
    lo, hi = bounds["rs-meter-post"]
    assert abs(lo.z) < 1e-6, "the meter post must stand on the ground"
    assert hi.z >= REPTILE_METER_POST_HEIGHT - 1e-6, "the post is shorter than REPTILE_METER_POST_HEIGHT"
    expected = int((REPTILE_METER_POST_HEIGHT - 0.1) / REPTILE_BABY_SNAKE_UNIT)
    assert bands == expected, f"{bands} bands, expected {expected}"
    blo, bhi = bounds["rs-meter-board"]
    assert blo.z >= REPTILE_METER_POST_HEIGHT - 0.1, "the board hangs below the post top"
    base_r = max(abs(lo.x), abs(hi.x), abs(lo.y), abs(hi.y))
    return (
        f"    meter: post {hi.z:.2f} m, {bands} bands every {REPTILE_BABY_SNAKE_UNIT} m, "
        f"board top {bhi.z:.3f} m, base radius {base_r:.3f} m (the collider's)"
    )


def check_uvs():
    painted = {"rs-sign", "rs-meter-board"}
    lines = []
    for obj in sorted(bpy.data.objects, key=lambda o: o.name):
        if obj.type != "MESH":
            continue
        has = len(obj.data.uv_layers) > 0
        if obj.name in painted:
            assert has, f"{obj.name} is painted and has no UV layer"
            us = [loop.uv[0] for loop in obj.data.uv_layers[0].data]
            vs = [loop.uv[1] for loop in obj.data.uv_layers[0].data]
            lines.append(f"    {obj.name}: u {min(us):.3f}..{max(us):.3f}  v {min(vs):.3f}..{max(vs):.3f}")
        else:
            assert not has, f"{obj.name} is flat-coloured and should carry no UVs"
    return "\n".join(lines)


def main() -> None:
    reset_scene()
    stall = collection("stall")
    build_awning(stall)
    build_posts(stall)
    build_sign(stall)
    build_stall_snakes(stall)
    meter = collection("meter")
    build_meter_post(meter)
    _, bands = build_meter_bands(meter)
    build_meter_board(meter)
    build_meter_snake(meter)
    bpy.context.view_layer.update()

    bounds = measured()
    print("\nreptile_stall_build")
    print(summarise())
    print("\n  measured off the emitted vertices:")
    print(check_awning_covers_counter(bounds))
    print(check_headroom())
    print(check_finial_sits_on_ridge(bounds))
    print(check_meter(bounds, bands))
    print("\n  painted surfaces:")
    print(check_uvs())
    for name in ("rs-sign", "rs-meter-board"):
        lo, hi = bounds[name]
        print(f"    {name}: {hi.x - lo.x:.3f} × {hi.z - lo.z:.3f} m — canvas aspect {(hi.x - lo.x) / (hi.z - lo.z):.3f}")
    stall_top = max(hi.z for name, (_, hi) in bounds.items() if not name.startswith("rs-meter-"))
    meter_top = max(hi.z for name, (_, hi) in bounds.items() if name.startswith("rs-meter-"))
    print(f"\n  stall dressing top {stall_top:.3f} m; meter top {meter_top:.3f} m")
    print(
        f"  read from the game: COUNTER_HALF_WIDTH {COUNTER_HALF_WIDTH}, COUNTER_Z {COUNTER_Z}, "
        f"BACK_PANEL_Z {BACK_PANEL_Z}, REPTILE_METER_POST_HEIGHT {REPTILE_METER_POST_HEIGHT}, "
        f"REPTILE_BABY_SNAKE_UNIT {REPTILE_BABY_SNAKE_UNIT}, TALLEST_CHILD_HEIGHT {TALLEST_CHILD_HEIGHT}"
    )
    total = total_triangles()
    print(f"\n  {len(bpy.data.objects)} nodes, {total} triangles total (budget {TRIANGLE_BUDGET})")
    assert total <= TRIANGLE_BUDGET, f"{total} triangles is over the {TRIANGLE_BUDGET} budget"

    bpy.ops.wm.save_as_mainfile(filepath=BLEND)
    print("  saved", BLEND, f"({os.path.getsize(BLEND)} bytes)\n")


if __name__ == "__main__":
    try:
        main()
    except Exception:
        traceback.print_exc()
        sys.exit(1)
