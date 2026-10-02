"""Builds the Reptile House's plant kit and saves ``art/blend/reptile_plants.blend``.

    blender --background --factory-startup --python-exit-code 1 \
        --python art/blend/reptile_plants_build.py

Jim, 2026-10-02: *"lots of cultivated tropical and otherwise snake-appropriate
vegetation"*. This is that vegetation — the pieces primitives fight (big
veined leaves, a curved trunk, a fallen log you can walk through, a banyan
with buttress roots), authored once and **instanced by TypeScript** (spec
§5): one ``InstancedMesh`` per node, so the kit is fifteen-odd small meshes
and not fifteen hundred.

## What this file owns, and what it asks for

**The mesh owns its own shape numbers** (leaf lengths, rock sizes, how much a
frond droops) and asserts them against the emitted vertices at the end of
every run, so this docstring and the geometry cannot drift apart in silence.

The numbers **shared with the game** are not this file's. They are read out
of ``src/world/reptileHouse/layout.ts`` — the Reptile House's one owner —
through ``reptile_constants.py`` and never typed here:

* ``REPTILE_LOG_INNER_RADIUS`` / ``REPTILE_LOG_OUTER_RADIUS`` /
  ``REPTILE_LOG_LENGTH`` — the Hollow Log. Its inner faces are *exactly*
  where the Log Walk's two thick-wall colliders put them, so the collider is
  the mesh and not a second opinion of it.
* ``REPTILE_PALM_HEIGHT`` and ``REPTILE_BANYAN_HEIGHT`` — the sightline rule
  (spec §3) is written against these, so the trunk is built *to* them.
* ``TALLEST_CHILD_HEIGHT`` (``kid.ts``) — the log's clear bore is asserted
  above it, with headroom.

**No colour, no material, no texture in the ``.glb``.** The Engineer's
``reptilePlantsAssets.ts`` owns the colour table; ``reptile_plants_render.py``
proposes one until it lands. Nothing here is painted, so nothing carries UVs.

## The Hollow Log is a squashed log, on purpose

A round tube of inner radius 1.65 standing on the floor has a 3.3 m bore at
its *centreline* and a curved floor that a child walking at the collider's
inner face (y = ±1.65) would be standing inside. The Log Walk's colliders are
two straight thick walls, so the log's inside is two straight walls too — a
semicircular arch of ``REPTILE_LOG_INNER_RADIUS`` standing on vertical walls
of the same height. The bore is then **3.3 m wide at the floor and 3.3 m
tall at the crown**, which is what ``reptile_constants.py`` asserts against
``TALLEST_CHILD_HEIGHT``. A fallen log that has sagged flat reads fine; a
child stuck in the wall of a round one does not.

The "¾" is the near (south, Blender −Y) side: the arch stops a little past
the crown and the south wall is a 1.0 m stub, so the fixed camera at +X+Z
sees her crawling through.

## Where the origins are (ART_DIRECTION §7)

* Everything stands at the world origin, base at z = 0 centred on X/Y, except:
* ``rp-vine-strand`` / ``rp-vine-leaves`` hang **from** their origin: the
  hang point is (0, 0, 0) and the strand runs to −z. The thing a placer has
  is a rib arch to hang it from, not a floor to stand it on.
* ``rp-log-knothole`` and the three ``rp-banyan-anchor-*`` nodes carry a
  **node translation** (the castle chest-lid rule: a pure translation and
  nothing else). The loader reads ``GlbPart.position`` as the point — the
  knothole's centre, a snake's hang point — so nobody has to copy a number
  out of this file's log into TypeScript.
* Blender −Y is the game's +Z. Leaves point along −Y; the logs lie along X.
* No two faces share a plane: everything that stands on the floor is sunk
  ``SINK`` below it, so there is no bottom face coincident with the plate.
"""

import math
import os
import random
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
    extrude_outline,
    icosphere,
    reset_scene,
    revolve,
    summarise,
    sweep_path,
    total_triangles,
)
from reptile_constants import (  # noqa: E402
    REPTILE_BANYAN_HEIGHT,
    REPTILE_LOG_INNER_RADIUS,
    REPTILE_LOG_LENGTH,
    REPTILE_LOG_OUTER_RADIUS,
    REPTILE_PALM_HEIGHT,
    TALLEST_CHILD_HEIGHT,
)

BLEND = os.path.join(REPO, "art", "blend", "reptile_plants.blend")

# Seeded, so the jitter on a rock is the same rock on every run and the
# `.glb` is byte-identical (the pack step's contract).
SEED = 2026_10_02

# Everything that stands on the floor is sunk this far below z = 0, so no
# bottom face is coplanar with the floor plate (ART_DIRECTION §7).
SINK = 0.05

# --- the mesh's own numbers --------------------------------------------------
PALM_BASE_RADIUS = 0.38
PALM_TOP_RADIUS = 0.22
PALM_LEAN = 0.2            # the trunk's S-curve, returning to centre at the crown
PALM_FROND_LENGTH = 3.0
PALM_FROND_HALF_WIDTH = 0.46
BANANA_LENGTH = 3.0
BANANA_HALF_WIDTH = 0.55
MONSTERA_STALK = 1.25
MONSTERA_RADIUS = 0.72
FERN_LENGTH = 1.4
FERN_HALF_WIDTH = 0.22
HELICONIA_HEIGHT = 2.2
HELICONIA_BRACTS = 6
VINE_DROP = 2.6
VINE_LEAVES = 7
LILY_RADIUS = 0.38
ROCK_TOP_MAX = 0.7         # spec §5: a rock she can hop onto is a plate ≤ 0.7
LOG_SMALL_LENGTH = 4.0
LOG_SMALL_TOP = 0.6        # the spec's "top 0.6 absolute" — the collider's top
LOG_SMALL_RADIUS = 0.32    # so the body's belly sits SINK under the floor
LOG_HOLLOW_SOUTH_WALL = 1.3
LOG_HOLLOW_CUT_DEG = 138.0  # the roof curls on past the crown and overhangs the stub
LOG_HOLLOW_BULGE = 0.22     # the outer walls belly out, so the log is round, not boxed
KNOTHOLE_HEIGHT = 1.25
KNOTHOLE_RADIUS = 0.32
BANYAN_TRUNK_RADIUS = 0.55
BANYAN_BRANCH_Z = 3.6
BANYAN_ROOTS = 5
BRANCH_LENGTH = 2.4
BRANCH_TOP = 1.55          # fits under a case's glass (plinth 1.1 → rim 2.9)


# =============================================================================
# Helpers this kit needs that blendkit does not have
# =============================================================================


def frame_at(points, i, up=Vector((0.0, 0.0, 1.0))):
    """(tangent, side, normal) at ``points[i]`` of an open path."""
    count = len(points)
    nxt = Vector(points[min(i + 1, count - 1)])
    prv = Vector(points[max(i - 1, 0)])
    tangent = (nxt - prv).normalized()
    side = tangent.cross(up)
    if side.length < 1e-6:
        side = tangent.cross(Vector((0.0, 1.0, 0.0)))
    side.normalize()
    normal = side.cross(tangent).normalized()
    return tangent, side, normal


def taper_sweep(points, radii, sides=8, spin=0.0):
    """A round tube along an open path with a radius per station, fan-capped.

    ``sweep_path`` is one radius for the whole length; a trunk tapers and a
    bark ridge is a radius that wobbles, so this is the same frame with a
    radius list.
    """
    count = len(points)
    verts = []
    faces = []
    for i in range(count):
        p = Vector(points[i])
        _, side, normal = frame_at(points, i)
        for k in range(sides):
            angle = spin + k * TAU / sides
            verts.append(
                tuple(p + side * (math.cos(angle) * radii[i]) + normal * (math.sin(angle) * radii[i]))
            )
    for i in range(count - 1):
        for k in range(sides):
            k_next = (k + 1) % sides
            faces.append((i * sides + k, i * sides + k_next, (i + 1) * sides + k_next, (i + 1) * sides + k))
    faces.append(tuple(range(sides - 1, -1, -1)))
    faces.append(tuple(range((count - 1) * sides, count * sides)))
    return verts, faces


def ribbon(spine, half_widths, thickness, fold=0.0, folds=None):
    """A leaf: a closed, slightly thick ribbon along a spine, creased at the rib.

    Each station is three points across — left edge, rib, right edge — on the
    top, and the same three dropped by ``thickness`` on the bottom; the edges
    sit ``fold × half-width`` below the rib so the leaf reads as a V (a palm
    frond) or a U (a banana leaf) and never as a flat plank. Six quads a
    station: two top, two bottom, two sides, plus a cap at each end.

    This is the one leaf generator for the whole kit; serration, droop and
    width are all in the inputs.
    """
    count = len(spine)
    verts = []
    for i in range(count):
        p = Vector(spine[i])
        _, side, normal = frame_at(spine, i)
        w = half_widths[i]
        f = (folds[i] if folds is not None else fold) * w
        top = [p - side * w - normal * f, p, p + side * w - normal * f]
        for q in top:
            verts.append(tuple(q))
        for q in top:
            verts.append(tuple(q - normal * thickness))
    faces = []
    for i in range(count - 1):
        a, b = i * 6, (i + 1) * 6
        faces.append((a + 0, a + 1, b + 1, b + 0))   # top left
        faces.append((a + 1, a + 2, b + 2, b + 1))   # top right
        faces.append((b + 3, b + 4, a + 4, a + 3))   # bottom left
        faces.append((b + 4, b + 5, a + 5, a + 4))   # bottom right
        faces.append((a + 3, a + 0, b + 0, b + 3))   # left side
        faces.append((a + 2, a + 5, b + 5, b + 2))   # right side
    faces.append((0, 3, 4, 1))
    faces.append((1, 4, 5, 2))
    last = (count - 1) * 6
    faces.append((last + 0, last + 1, last + 4, last + 3))
    faces.append((last + 1, last + 2, last + 5, last + 4))
    return verts, faces


def arc_spine(length, start_deg, end_deg, count, yaw_deg=0.0, start=(0.0, 0.0, 0.0)):
    """An open path of ``count`` points that pitches from ``start_deg`` to
    ``end_deg`` (above the horizontal) over ``length``, heading along −Y."""
    points = []
    p = Vector(start)
    step = length / (count - 1)
    yaw = math.radians(yaw_deg)
    for i in range(count):
        points.append(tuple(p))
        t = i / (count - 1)
        pitch = math.radians(start_deg + (end_deg - start_deg) * t)
        direction = Vector((math.sin(yaw) * math.cos(pitch), -math.cos(yaw) * math.cos(pitch), math.sin(pitch)))
        p = p + direction * step
    return points


def blob(rng, rx, ry, rz, jitter, subdivisions=2):
    """A jittered squashed icosphere — a rock, a canopy clump."""
    verts, faces = icosphere(1.0, subdivisions)
    out = []
    for x, y, z in verts:
        s = 1.0 + rng.uniform(-jitter, jitter)
        out.append((x * rx * s, y * ry * s, z * rz * s))
    return out, faces


def flatten_bottom(verts, floor):
    """Clamp everything below ``floor`` to it — a rock sat on the ground."""
    return [(x, y, max(z, floor)) for x, y, z in verts]


def rot_z(deg):
    return Matrix.Rotation(math.radians(deg), 4, "Z")


def rot_x(deg):
    return Matrix.Rotation(math.radians(deg), 4, "X")


def rot_y(deg):
    return Matrix.Rotation(math.radians(deg), 4, "Y")


def heart_outline(points=36, lobes=0, lobe_depth=0.0, radius=1.0):
    """A heart-shaped leaf outline in the XZ plane (stem notch at the bottom),
    optionally slit into lobes. Star-shaped about (0, 0) by construction, as
    ``extrude_outline`` wants."""
    out = []
    for i in range(points):
        a = i * TAU / points
        # A heart: wide shoulders, a notch at the stem end (−z).
        r = 1.0 - 0.28 * math.cos(a) ** 3 - 0.08 * math.cos(2 * a)
        if lobes:
            r *= 1.0 - lobe_depth * max(0.0, math.sin(a * lobes) ** 3)
        out.append((math.sin(a) * radius * r * 0.92, -math.cos(a) * radius * r))
    return out


# =============================================================================
# The parts
# =============================================================================


def build_palm(coll):
    """``rp-palm-trunk`` — ``REPTILE_PALM_HEIGHT`` tall, an S-curve that comes
    back to centre, so the crown's anchor is (0, 0, height) by construction
    — and ``rp-palm-frond``, one frond a placer fans seven of."""
    rings = 26
    spine = []
    radii = []
    for i in range(rings):
        t = i / (rings - 1)
        z = -SINK + (REPTILE_PALM_HEIGHT + SINK) * t
        # sin² has a zero slope at both ends, so the base and crown rings
        # are level and the top is exactly REPTILE_PALM_HEIGHT.
        x = PALM_LEAN * math.sin(math.pi * t) ** 2
        spine.append((x, 0.0, z))
        r = PALM_BASE_RADIUS + (PALM_TOP_RADIUS - PALM_BASE_RADIUS) * t
        # Bark rings: a scallop every so often, and a flared root collar.
        r *= 1.0 + 0.07 * (0.5 + 0.5 * math.cos(TAU * t * 9.0))
        r *= 1.0 + 0.35 * max(0.0, 1.0 - t * 12.0) ** 2
        # A crown boss where the fronds sprout.
        r *= 1.0 + 0.55 * max(0.0, (t - 0.9) / 0.1) ** 2
        radii.append(r)
    verts, faces = taper_sweep(spine, radii, sides=10)
    # The crown ring's frame is a hair off level (the S-curve's last step is
    # not quite vertical); planing it to the constant is what makes the
    # anchor the sightline rule reads *exactly* REPTILE_PALM_HEIGHT.
    verts = [(x, y, REPTILE_PALM_HEIGHT if z > REPTILE_PALM_HEIGHT - 0.02 else z) for x, y, z in verts]
    trunk = Part("rp-palm-trunk")
    trunk.add(verts, faces)
    trunk.emit(coll)

    # The frond: a bare stalk for the first sixth, then leaflets as a
    # sawtooth width, creased into a V, arching up and over.
    count = 24
    spine = arc_spine(PALM_FROND_LENGTH, 42.0, -62.0, count)
    widths = []
    folds = []
    for i in range(count):
        t = i / (count - 1)
        if t < 0.16:
            widths.append(0.045)
            folds.append(0.0)
            continue
        u = (t - 0.16) / 0.84
        w = PALM_FROND_HALF_WIDTH * math.sin(math.pi * (0.08 + 0.92 * u)) ** 0.7
        w *= 1.0 if i % 2 == 0 else 0.62
        widths.append(max(w, 0.05))
        folds.append(0.42)
    frond = Part("rp-palm-frond")
    frond.add(*ribbon(spine, widths, 0.03, folds=folds))
    frond.emit(coll, sharp_deg=70.0)


def build_banana(coll):
    """``rp-banana-leaf`` — one big paddle on a stalk, arching over. Two wind
    splits in the blade so three of them in a clump do not read as one
    green block."""
    count = 18
    spine = arc_spine(BANANA_LENGTH, 80.0, -16.0, count)
    widths = []
    folds = []
    for i in range(count):
        t = i / (count - 1)
        if t < 0.24:
            widths.append(0.05)
            folds.append(0.0)
            continue
        u = (t - 0.24) / 0.76
        w = BANANA_HALF_WIDTH * math.sin(math.pi * (0.1 + 0.9 * u)) ** 0.55
        if i in (9, 14):
            w *= 0.55
        widths.append(max(w, 0.05))
        folds.append(0.3)
    leaf = Part("rp-banana-leaf")
    leaf.add(*ribbon(spine, widths, 0.035, folds=folds))
    leaf.emit(coll)


def build_monstera(coll):
    """``rp-monstera-leaf`` — a slit heart on a leaning stalk, tilted back to
    show its face to the camera."""
    stalk_pts = [(0.0, 0.0, -SINK)]
    for i in range(1, 7):
        t = i / 6
        stalk_pts.append((0.0, -0.32 * t, MONSTERA_STALK * t))
    stalk = Part("rp-monstera-stalk")
    stalk.add(*taper_sweep(stalk_pts, [0.045] * 7, sides=6))
    stalk.emit(coll)

    outline = heart_outline(points=40, lobes=5, lobe_depth=0.5, radius=MONSTERA_RADIUS)
    verts, faces = extrude_outline(outline, 0.03)
    # The outline's stem notch is at −z; lift it so the notch sits on the stalk
    # tip, then tilt the blade back 38° and face it down the −Y axis.
    lift = Matrix.Translation((0.0, 0.0, MONSTERA_RADIUS * 0.72))
    pose = Matrix.Translation((0.0, -0.32, MONSTERA_STALK - 0.04)) @ rot_x(-38.0) @ lift
    leaf = Part("rp-monstera-leaf")
    leaf.add(verts, faces, pose)
    leaf.emit(coll)


def build_fern(coll):
    """``rp-fern-frond`` — knee-high, strongly serrated, so six in a ring read
    as a fern and not as a small palm. No collider (spec §5)."""
    count = 26
    spine = arc_spine(FERN_LENGTH, 48.0, -40.0, count)
    widths = []
    for i in range(count):
        t = i / (count - 1)
        if t < 0.12:
            widths.append(0.025)
            continue
        u = (t - 0.12) / 0.88
        w = FERN_HALF_WIDTH * math.sin(math.pi * (0.1 + 0.9 * u)) ** 0.6
        w *= 1.0 if i % 2 == 0 else 0.42
        widths.append(max(w, 0.03))
    frond = Part("rp-fern-frond")
    frond.add(*ribbon(spine, widths, 0.02, fold=0.25))
    frond.emit(coll, sharp_deg=70.0)


def build_heliconia(coll):
    """``rp-heliconia-stalk`` and ``rp-heliconia`` — the lobster-claw bracts,
    zig-zagging up the top of the stalk. The red is the colour pop the
    camera wants in a green room (spec §5), so the bracts are their own node."""
    rings = 9
    pts = []
    for i in range(rings):
        t = i / (rings - 1)
        pts.append((0.08 * math.sin(math.pi * t * 0.5), -0.22 * t * t, -SINK + (HELICONIA_HEIGHT - 0.25 + SINK) * t))
    stalk = Part("rp-heliconia-stalk")
    stalk.add(*taper_sweep(pts, [0.07 - 0.025 * (i / (rings - 1)) for i in range(rings)], sides=6))
    stalk.emit(coll)

    rng = random.Random(SEED + 3)
    bracts = Part("rp-heliconia")
    base_z = HELICONIA_HEIGHT - 1.3
    for i in range(HELICONIA_BRACTS):
        t = i / (HELICONIA_BRACTS - 1)
        z = base_z + t * 1.15
        side = 1.0 if i % 2 == 0 else -1.0
        x = 0.08 * math.sin(math.pi * (z / HELICONIA_HEIGHT) * 0.5)
        y = -0.22 * (z / HELICONIA_HEIGHT) ** 2
        verts, faces = blob(rng, 0.32, 0.11, 0.1, 0.04, subdivisions=1)
        pose = Matrix.Translation((x + side * 0.25, y, z)) @ rot_y(side * 28.0)
        bracts.add(verts, faces, pose)
    # The top bract points up like a flame.
    verts, faces = blob(rng, 0.1, 0.1, 0.24, 0.04, subdivisions=1)
    bracts.add(verts, faces, Matrix.Translation((0.08 * 0.99, -0.22, HELICONIA_HEIGHT - 0.14)))
    bracts.emit(coll)


def build_vine(coll):
    """``rp-vine-strand`` (the stem) and ``rp-vine-leaves`` — hung from the
    origin, dropping ``VINE_DROP``. The placer hangs it ≥ 3.2 m over a path
    (spec §5), so it never needs a collider."""
    rng = random.Random(SEED + 4)
    steps = 14
    pts = []
    for i in range(steps):
        t = i / (steps - 1)
        pts.append((0.14 * math.sin(t * 5.1), 0.09 * math.cos(t * 3.7) - 0.09, -VINE_DROP * t))
    strand = Part("rp-vine-strand")
    strand.add(*taper_sweep(pts, [0.035 - 0.015 * (i / (steps - 1)) for i in range(steps)], sides=5))
    strand.emit(coll)

    leaves = Part("rp-vine-leaves")
    outline = heart_outline(points=10, radius=0.17)
    verts, faces = extrude_outline(outline, 0.02)
    for i in range(VINE_LEAVES):
        t = (i + 0.7) / (VINE_LEAVES + 0.4)
        k = int(t * (steps - 1))
        p = Vector(pts[k])
        yaw = rng.uniform(0.0, 360.0)
        pose = (
            Matrix.Translation(p)
            @ rot_z(yaw)
            @ Matrix.Translation((0.0, -0.05, 0.0))
            @ rot_x(rng.uniform(55.0, 80.0))
            @ Matrix.Translation((0.0, 0.0, 0.17 * 0.72))
        )
        leaves.add(verts, faces, pose)
    leaves.emit(coll)


def build_lily_pad(coll):
    """``rp-lily-pad`` — a disc with the notch every child draws. It floats, so
    the placer sets its y to the water; its base is z = 0 here."""
    points = 30
    notch = math.radians(38.0)
    outline = []
    for i in range(points + 1):
        a = -math.pi / 2 - notch / 2 - i * (TAU - notch) / points
        outline.append((LILY_RADIUS * math.cos(a), LILY_RADIUS * math.sin(a)))
    outline.append((0.0, 0.0))
    # extrude_outline builds in XZ along Y; lay it flat on the water.
    verts, faces = extrude_outline(outline, 0.04, centre=(0.0, 0.04))
    pad = Part("rp-lily-pad")
    pad.add(verts, faces, Matrix.Translation((0.0, 0.0, 0.02)) @ rot_x(90.0))
    pad.emit(coll)


def build_rocks(coll):
    """``rp-rock-a/b/c`` — three mossy lumps, every top under ``ROCK_TOP_MAX``
    so each is a hop-on plate. The circumradius is measured off the
    vertices (below) and printed; the loader measures it again."""
    rng = random.Random(SEED + 5)
    for name, rx, ry, rz in (
        ("rp-rock-a", 0.95, 0.8, 0.42),
        ("rp-rock-b", 0.62, 0.55, 0.3),
        ("rp-rock-c", 1.35, 1.05, 0.38),
    ):
        verts, faces = blob(rng, rx, ry, rz, 0.16)
        # Sit it on the floor: the lump's belly is under the plate.
        verts = [(x, y, z + rz * 0.45) for x, y, z in verts]
        verts = flatten_bottom(verts, -SINK)
        rock = Part(name)
        rock.add(verts, faces)
        # Flat-shaded on purpose: a low-poly boulder reads as rock where a
        # smooth one reads as a pudding.
        rock.emit(coll, sharp_deg=12.0)


def build_log_small(coll):
    """``rp-log-small`` — 4 m along X, lying on the floor. The top is exactly
    2 × ``LOG_SMALL_RADIUS``: the grooves go *in*, so "top 0.6 absolute" is
    the top and not an average."""
    rings = 18
    pts = []
    radii = []
    for i in range(rings):
        t = i / (rings - 1)
        r = LOG_SMALL_RADIUS * (1.0 - 0.16 * t)
        r *= 1.0 - 0.07 * (0.5 - 0.5 * math.cos(TAU * t * 7.0))
        pts.append((-LOG_SMALL_LENGTH / 2 + LOG_SMALL_LENGTH * t, 0.0, LOG_SMALL_TOP - r))
        radii.append(r)
    log = Part("rp-log-small")
    log.add(*taper_sweep(pts, radii, sides=10))
    # Two stub branches, one up, one out towards the camera.
    # Both stubs lean out, never up: a child stands on this log.
    for yaw, pitch, at in ((35.0, 8.0, -0.9), (-30.0, -4.0, 0.8)):
        stub = [(at, 0.0, LOG_SMALL_RADIUS * 0.6)]
        for k in range(1, 4):
            s = k / 3 * 0.55
            p = math.radians(pitch)
            y = math.radians(yaw)
            stub.append((at + s * math.cos(p) * math.sin(y), -s * math.cos(p) * math.cos(y), LOG_SMALL_RADIUS * 0.6 + s * math.sin(p)))
        log.add(*taper_sweep(stub, [0.1, 0.08, 0.06, 0.045], sides=5))
    log.emit(coll)


def hollow_profiles(outer_scale):
    """The two closed (y, z) loops of the Hollow Log's cross-section at one
    station: the north C-piece and the south stub. ``outer_scale`` wobbles the
    outer surface only (bark); the inner faces are the game's constants."""
    ri = REPTILE_LOG_INNER_RADIUS
    ro = REPTILE_LOG_OUTER_RADIUS * outer_scale
    steps = 9
    cut = math.radians(LOG_HOLLOW_CUT_DEG)
    bulge = LOG_HOLLOW_BULGE * outer_scale
    outer = [(ro, -SINK), (ro + bulge * 0.8, ri * 0.35), (ro + bulge, ri * 0.7), (ro, ri)]
    inner = [(ri, -SINK), (ri, ri * 0.35), (ri, ri * 0.7), (ri, ri)]
    for k in range(1, steps + 1):
        a = cut * k / steps
        outer.append((ro * math.cos(a), ri + ro * math.sin(a)))
        inner.append((ri * math.cos(a), ri + ri * math.sin(a)))
    north = outer + inner[::-1]
    sw = LOG_HOLLOW_SOUTH_WALL
    south = [
        (-ro, -SINK), (-ro - bulge * 0.8, sw * 0.45), (-ro - bulge * 0.9, sw * 0.9), (-ro - bulge * 0.5, sw),
        (-ri, sw), (-ri, sw * 0.9), (-ri, sw * 0.45), (-ri, -SINK),
    ]
    return north, south


def loft(loops, x_stations):
    """Extrude a closed (y, z) loop along X through ``x_stations`` (a list of
    (x, loop) pairs) and cap both ends with quads between matching points."""
    verts = []
    faces = []
    count = len(loops[0])
    for x, loop in zip(x_stations, loops):
        for y, z in loop:
            verts.append((x, y, z))
    stations = len(loops)
    for s in range(stations - 1):
        for i in range(count):
            j = (i + 1) % count
            faces.append((s * count + i, s * count + j, (s + 1) * count + j, (s + 1) * count + i))
    return verts, faces, count, stations


def cap_c(faces, count, stations):
    """End caps for the C-piece: its loop is outer[0..n] + reversed inner, so
    outer[i] pairs with inner[i] at index count−1−i."""
    half = count // 2
    for s, flip in ((0, True), (stations - 1, False)):
        base = s * count
        for i in range(half - 1):
            o0, o1 = base + i, base + i + 1
            i0, i1 = base + count - 1 - i, base + count - 2 - i
            quad = (o0, i0, i1, o1)
            faces.append(quad[::-1] if flip else quad)


def build_log_hollow(coll):
    """``rp-log-hollow`` and ``rp-log-knothole`` — see the module docstring."""
    stations = 13
    xs = []
    norths = []
    souths = []
    for i in range(stations):
        t = i / (stations - 1)
        x = -REPTILE_LOG_LENGTH / 2 + REPTILE_LOG_LENGTH * t
        wobble = 1.0 - 0.05 * (0.5 - 0.5 * math.cos(TAU * t * 6.0))
        north, south = hollow_profiles(wobble)
        xs.append(x)
        norths.append(north)
        souths.append(south)
    log = Part("rp-log-hollow")
    verts, faces, count, n = loft(norths, xs)
    cap_c(faces, count, n)
    log.add(verts, faces)
    verts, faces, count, n = loft(souths, xs)
    cap_c(faces, count, n)
    log.add(verts, faces)
    log.emit(coll, sharp_deg=50.0)

    # The knothole: a rimmed cup let into the inside of the north wall, where
    # hidden baby #1 peeks out. Authored about its own centre and placed by
    # node translation, so the loader reads the point rather than copying it.
    profile = [
        (KNOTHOLE_RADIUS * 0.55, 0.0),
        (KNOTHOLE_RADIUS * 0.55, 0.14),
        (KNOTHOLE_RADIUS * 0.8, 0.2),
        (KNOTHOLE_RADIUS, 0.12),
        (KNOTHOLE_RADIUS * 0.92, -0.02),
        (0.0, -0.02),
        (0.0, 0.0),
    ]
    verts, faces = revolve(profile, segments=12)
    hole = Part("rp-log-knothole")
    # Revolved about Z; turn it to face −Y (into the bore).
    hole.add(verts, faces, rot_x(90.0))
    hole.emit(coll, location=(0.0, REPTILE_LOG_INNER_RADIUS + 0.02, KNOTHOLE_HEIGHT))


def build_banyan(coll):
    """``rp-banyan`` (trunk, buttress roots, branches, aerial roots),
    ``rp-banyan-canopy`` and the three ``rp-banyan-anchor-*`` hang points."""
    rng = random.Random(SEED + 6)
    tree = Part("rp-banyan")

    rings = 10
    pts = []
    radii = []
    for i in range(rings):
        t = i / (rings - 1)
        pts.append((0.06 * math.sin(t * 4.0), 0.04 * math.cos(t * 3.0), -SINK + (BANYAN_BRANCH_Z + 0.3 + SINK) * t))
        radii.append(BANYAN_TRUNK_RADIUS * (1.0 - 0.3 * t) * (1.0 + 0.05 * math.sin(t * 17.0)))
    tree.add(*taper_sweep(pts, radii, sides=10))

    # Buttress roots: wedge fins, tall at the trunk, running out along the
    # floor. Each is an outline in XZ extruded through Y, then yawed round.
    fin = [
        (0.0, -SINK), (1.85, -SINK), (1.95, 0.14), (1.6, 0.38), (1.05, 0.7),
        (0.6, 1.25), (0.38, 1.9), (0.0, 2.3),
    ]
    fin_verts, fin_faces = extrude_outline(fin, 0.32, centre=(0.5, 0.4))
    for k in range(BANYAN_ROOTS):
        yaw = k * 360.0 / BANYAN_ROOTS + rng.uniform(-14.0, 14.0)
        tree.add(fin_verts, fin_faces, rot_z(yaw) @ Matrix.Translation((BANYAN_TRUNK_RADIUS * 0.3, 0.0, 0.0)))

    # Three main branches, spreading from the trunk top; a hang anchor on each.
    anchors = []
    for k, (yaw, reach, rise) in enumerate(((20.0, 2.5, 1.3), (150.0, 2.2, 1.5), (260.0, 2.6, 1.1))):
        y = math.radians(yaw)
        branch = []
        for j in range(7):
            t = j / 6
            r = reach * math.sin(t * math.pi / 2)
            branch.append((r * math.cos(y), r * math.sin(y), BANYAN_BRANCH_Z + rise * t ** 0.8))
        tree.add(*taper_sweep(branch, [0.32 - 0.22 * (j / 6) for j in range(7)], sides=6))
        # The hang point is low on the branch, under the canopy's skirt, so a
        # 1.4 m snake dangles in clear air where the camera can see it.
        anchors.append(Vector(branch[2]) - Vector((0.0, 0.0, 0.3)))
        # An aerial root dropping from each branch to the floor.
        top = Vector(branch[3])
        root = []
        for j in range(6):
            t = j / 5
            root.append((top.x + 0.1 * math.sin(t * 6.0 + k), top.y + 0.1 * math.cos(t * 5.0 + k), top.z * (1.0 - t) - SINK * t))
        tree.add(*taper_sweep(root, [0.07, 0.065, 0.06, 0.06, 0.07, 0.09], sides=4))
    tree.emit(coll)

    canopy = Part("rp-banyan-canopy")
    top = REPTILE_BANYAN_HEIGHT
    # One crown clump whose top is REPTILE_BANYAN_HEIGHT, six round it whose
    # skirt stays *above* the hang anchors, so a snake dangles in clear air.
    clumps = [(0.0, 0.0, top - 0.9, 2.4, 2.1, 0.9)]
    for k in range(6):
        a = k * TAU / 6 + 0.3
        clumps.append((2.05 * math.cos(a), 2.05 * math.sin(a), top - 0.85, 1.5, 1.35, 0.62))
    for x, y, z, rx, ry, rz in clumps:
        verts, faces = blob(rng, rx, ry, rz, 0.06)
        canopy.add(verts, faces, Matrix.Translation((x, y, z)))
    canopy.emit(coll, sharp_deg=60.0)

    # Hang points as tiny mesh nodes placed by translation: the loader reads
    # `position` and never draws them. A tetrahedron is the cheapest mesh.
    tet_v = [(0.02, 0.0, -0.01), (-0.01, 0.017, -0.01), (-0.01, -0.017, -0.01), (0.0, 0.0, 0.02)]
    tet_f = [(0, 1, 2), (0, 3, 1), (1, 3, 2), (2, 3, 0)]
    for letter, point in zip("abc", anchors):
        node = Part(f"rp-banyan-anchor-{letter}")
        node.add(tet_v, tet_f)
        node.emit(coll, smooth=False, location=tuple(point))
    return anchors


def build_branch(coll):
    """``rp-branch`` — the forked climbing branch inside a case; origin at
    its thick end on the case floor, rising to ``BRANCH_TOP``."""
    main = []
    for j in range(9):
        t = j / 8
        main.append((BRANCH_LENGTH * 0.72 * t, -0.35 * math.sin(t * math.pi), -SINK + (BRANCH_TOP + SINK) * t ** 0.9))
    branch = Part("rp-branch")
    branch.add(*taper_sweep(main, [0.14 - 0.09 * (j / 8) for j in range(9)], sides=6))
    fork_from = Vector(main[4])
    fork = [tuple(fork_from)]
    for j in range(1, 6):
        t = j / 5
        fork.append((fork_from.x + 0.5 * t, fork_from.y + 0.75 * t, fork_from.z + 0.55 * t))
    branch.add(*taper_sweep(fork, [0.09, 0.08, 0.07, 0.06, 0.05, 0.04], sides=5))
    twig_from = Vector(main[6])
    twig = [tuple(twig_from)]
    for j in range(1, 5):
        t = j / 4
        twig.append((twig_from.x + 0.15 * t, twig_from.y - 0.5 * t, twig_from.z + 0.3 * t))
    branch.add(*taper_sweep(twig, [0.06, 0.05, 0.04, 0.03, 0.025], sides=5))
    branch.emit(coll)


# =============================================================================
# Measuring what was built
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


def circumradius(name):
    obj = bpy.data.objects[name]
    return max(math.hypot(v.co.x, v.co.y) for v in obj.data.vertices)


def check_contract(bounds, anchors):
    lines = []

    lo, hi = bounds["rp-palm-trunk"]
    assert abs(hi.z - REPTILE_PALM_HEIGHT) < 1e-3, f"palm trunk top {hi.z:.3f} ≠ REPTILE_PALM_HEIGHT"
    crown = [v.co for v in bpy.data.objects["rp-palm-trunk"].data.vertices if v.co.z > REPTILE_PALM_HEIGHT - 1e-3]
    cx = sum(v.x for v in crown) / len(crown)
    cy = sum(v.y for v in crown) / len(crown)
    assert math.hypot(cx, cy) < 1e-3, f"the palm's crown is off-centre at ({cx:.3f}, {cy:.3f})"
    lines.append(f"    palm trunk: {hi.z:.2f} m = REPTILE_PALM_HEIGHT; crown anchor (0, 0, {hi.z:.2f}); base r {PALM_BASE_RADIUS}")
    lo, hi = bounds["rp-palm-frond"]
    lines.append(f"    palm frond: reaches {-lo.y:.2f} m forward, {hi.z:.2f} m up, drops to {lo.z:.2f}")

    for name in ("rp-rock-a", "rp-rock-b", "rp-rock-c"):
        lo, hi = bounds[name]
        assert hi.z <= ROCK_TOP_MAX, f"{name} top {hi.z:.3f} is over the hop-on limit {ROCK_TOP_MAX}"
        lines.append(f"    {name}: top {hi.z:.2f} m (≤ {ROCK_TOP_MAX}), circumradius {circumradius(name):.3f} m")

    lo, hi = bounds["rp-log-small"]
    assert hi.z <= LOG_SMALL_TOP + 0.03, f"log small top {hi.z:.3f} is over LOG_SMALL_TOP {LOG_SMALL_TOP}"
    assert lo.z < 0.0, "log small floats above the floor"
    lines.append(f"    log small: {hi.x - lo.x:.2f} m along X, top {hi.z:.2f} m (LOG_SMALL_TOP {LOG_SMALL_TOP}), belly {lo.z:+.2f}")

    lo, hi = bounds["rp-log-hollow"]
    inner = [v.co for v in bpy.data.objects["rp-log-hollow"].data.vertices if abs(abs(v.co.y) - REPTILE_LOG_INNER_RADIUS) < 1e-4]
    assert inner, "the hollow log's inner wall faces are not at REPTILE_LOG_INNER_RADIUS"
    crown_z = max(v.co.z for v in bpy.data.objects["rp-log-hollow"].data.vertices if abs(v.co.x) < 0.01)
    clear = 2 * REPTILE_LOG_INNER_RADIUS
    assert clear >= TALLEST_CHILD_HEIGHT + 0.3, f"bore {clear} under TALLEST_CHILD_HEIGHT + 0.3"
    assert abs((hi.x - lo.x) - REPTILE_LOG_LENGTH) < 1e-3, f"hollow log length {hi.x - lo.x:.3f} ≠ REPTILE_LOG_LENGTH"
    assert hi.y <= REPTILE_LOG_OUTER_RADIUS + LOG_HOLLOW_BULGE + 1e-3 and -lo.y <= REPTILE_LOG_OUTER_RADIUS + LOG_HOLLOW_BULGE + 1e-3, "hollow log outside its outer radius"
    lines.append(
        f"    hollow log: {hi.x - lo.x:.2f} m along X, inner faces y = ±{REPTILE_LOG_INNER_RADIUS}, "
        f"clear bore {clear:.2f} m (TALLEST_CHILD_HEIGHT {TALLEST_CHILD_HEIGHT} + 0.3), crown top {crown_z:.2f} m, "
        f"south stub {LOG_HOLLOW_SOUTH_WALL} m"
    )
    hole = bpy.data.objects["rp-log-knothole"]
    lines.append(f"    knothole centre (node origin): ({hole.location.x:+.2f}, {hole.location.y:+.2f}, {hole.location.z:+.2f}) Blender = game (x, y {hole.location.z:.2f}, z {-hole.location.y:.2f})")

    lo, hi = bounds["rp-banyan-canopy"]
    assert abs(hi.z - REPTILE_BANYAN_HEIGHT) < 0.25, f"banyan top {hi.z:.3f} vs REPTILE_BANYAN_HEIGHT {REPTILE_BANYAN_HEIGHT}"
    tlo, thi = bounds["rp-banyan"]
    lines.append(f"    banyan: canopy top {hi.z:.2f} m (REPTILE_BANYAN_HEIGHT {REPTILE_BANYAN_HEIGHT}), spread {hi.x - lo.x:.1f} × {hi.y - lo.y:.1f} m, roots out to r {max(abs(tlo.x), abs(thi.x), abs(tlo.y), abs(thi.y)):.2f}")
    for letter, a in zip("abc", anchors):
        node = bpy.data.objects[f"rp-banyan-anchor-{letter}"]
        assert (Vector(node.location) - a).length < 1e-6
        assert a.z < lo.z, f"banyan anchor {letter} at z {a.z:.2f} is inside the canopy (skirt {lo.z:.2f})"
        lines.append(f"    banyan anchor {letter}: ({a.x:+.2f}, {a.y:+.2f}, {a.z:+.2f}) Blender = game (x {a.x:+.2f}, y {a.z:.2f}, z {-a.y:+.2f})")

    lo, hi = bounds["rp-branch"]
    assert hi.z <= BRANCH_TOP + 0.15, f"case branch {hi.z:.2f} too tall for a case"
    lines.append(f"    case branch: {hi.x - lo.x:.2f} m along X, top {hi.z:.2f} m")

    for name in ("rp-banana-leaf", "rp-monstera-leaf", "rp-fern-frond", "rp-heliconia", "rp-lily-pad"):
        lo, hi = bounds[name]
        lines.append(f"    {name}: {hi.x - lo.x:.2f} × {hi.y - lo.y:.2f} × {hi.z - lo.z:.2f} m, top {hi.z:.2f}")
    lo, hi = bounds["rp-fern-frond"]
    assert hi.z < 1.0, "a fern is knee-high and has no collider; this one is not"
    lo, hi = bounds["rp-vine-strand"]
    assert abs(hi.z) < 0.05 and lo.z < -VINE_DROP + 0.05, f"the vine hangs from its origin: top {hi.z:+.3f}, bottom {lo.z:+.3f}"
    lines.append(f"    vine: hangs {-lo.z:.2f} m below its origin")

    return "\n".join(lines)


def check_uvs():
    for obj in bpy.data.objects:
        if obj.type == "MESH":
            assert not obj.data.uv_layers, f"{obj.name} carries UVs and nothing in this kit is painted"


def main() -> None:
    reset_scene()
    build_palm(collection("palm"))
    build_banana(collection("banana"))
    build_monstera(collection("monstera"))
    build_fern(collection("fern"))
    build_heliconia(collection("heliconia"))
    build_vine(collection("vine"))
    build_lily_pad(collection("lily"))
    build_rocks(collection("rocks"))
    build_log_small(collection("log-small"))
    build_log_hollow(collection("log-hollow"))
    anchors = build_banyan(collection("banyan"))
    build_branch(collection("branch"))
    bpy.context.view_layer.update()

    bounds = measured()
    print("\nreptile_plants_build")
    print(summarise())
    print("\n  measured off the emitted vertices:")
    print(check_contract(bounds, anchors))
    check_uvs()
    print(
        f"\n  read from the game: REPTILE_PALM_HEIGHT {REPTILE_PALM_HEIGHT}, REPTILE_BANYAN_HEIGHT {REPTILE_BANYAN_HEIGHT}, "
        f"REPTILE_LOG_INNER_RADIUS {REPTILE_LOG_INNER_RADIUS}, REPTILE_LOG_OUTER_RADIUS {REPTILE_LOG_OUTER_RADIUS}, "
        f"REPTILE_LOG_LENGTH {REPTILE_LOG_LENGTH}, TALLEST_CHILD_HEIGHT {TALLEST_CHILD_HEIGHT}"
    )
    banyan = 0
    for obj in bpy.data.collections["banyan"].objects:
        obj.data.calc_loop_triangles()
        banyan += len(obj.data.loop_triangles)
    total = total_triangles()
    print(f"\n  {len(bpy.data.objects)} nodes, {total} triangles total (banyan {banyan})")
    assert total <= 6000, f"{total} triangles is over the kit's 6 000 budget"
    assert banyan <= 2500, f"the banyan's {banyan} triangles is over its 2 500 budget"

    bpy.ops.wm.save_as_mainfile(filepath=BLEND)
    print("  saved", BLEND, f"({os.path.getsize(BLEND)} bytes)\n")


if __name__ == "__main__":
    try:
        main()
    except Exception:
        traceback.print_exc()
        sys.exit(1)
