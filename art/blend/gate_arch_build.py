"""Builds the park's decorative entrance arch and saves ``art/blend/gateArch.blend``.

    blender --background --factory-startup --python-exit-code 1 \
        --python art/blend/gate_arch_build.py

Jim, 2026-09-03: *"what I want now is a decorative arch, designed in Blender,
with a project logo of a ferris wheel and 'LAND OF GOOD PLACES' written onto
it"*, and on how the logo is made: *"yeah it is fine to just be a texture for
the design"*.

This is the first thing anyone sees. The cat bus stops outside it, a child
walks under it, and it is the park's front door.

## What this file owns, and what it asks for

Like ``castle_build.py``: **the mesh owns its own shape numbers** and they are
asserted against the emitted vertices at the end of every run, so this
docstring and the geometry cannot drift apart in silence.

Three numbers are **not** this file's, and are read out of the game's own
TypeScript with :func:`blendkit.ts_const` rather than typed here — CLAUDE.md's
"two definitions of one thing, kept in step by hand" is the most common bug in
this repo and a gate that does not fit its gateway is the loudest possible
instance of it:

* ``ENTRANCE_GATE_HALF_WIDTH`` and ``ENTRANCE_GATE_POST_HEIGHT``
  (``src/world/entrance/layout.ts``) — where the piers stand and how tall the
  shafts are. The arch is one rigid model, so if the park ever re-sizes its
  gateway this asset is stale; ``gateArch.ts`` asserts the built span against
  the same two constants at load, which turns that into a loud failure rather
  than a gate standing beside its own opening.
* ``TALLEST_CHILD_HEIGHT`` (``src/art/models/kid.ts``) — a child in the tallest
  hair and hat. Everything a child walks under is checked against it below,
  with real headroom to spare, and printed on every run.

**No colour, no material, no texture in the ``.glb``.** ``gateArch.ts`` owns
the colour table and paints both canvas textures, exactly as ``castleAssets.ts``
does for the castle. The two painted surfaces — the lettered sign and the
ferris-wheel roundel — carry **their own UVs**, so the lettering and the logo
live in the arch's own UV space and there is no second mesh tracking a first
one's surface (``src/art/models/CLAUDE.md``; ART_DIRECTION §3, §7).

## Conventions (ART_DIRECTION §7)

* 1 Blender unit = 1 metre.
* **Blender −Y is the game's +Z**, which here is *out of the park, at the
  arriving child*. The lettering faces her.
* Every node is authored in the **arch's own frame**: origin at the centre of
  the gateway, on the ground. So all five nodes are added at the handle's origin
  and nothing needs a placement offset.
* No two faces share a plane (ART_DIRECTION §7, ``check:coplanar``). Where
  parts meet they **interpenetrate** — the sign's top edge runs up into the
  band, the piers swallow the band's springing and the sign's ends — so there
  is never a coincident pair to fight over depth, and never a slot of daylight
  either.
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
    icosphere,
    reset_scene,
    revolve,
    summarise,
    total_triangles,
    ts_const,
)

BLEND = os.path.join(REPO, "art", "blend", "gateArch.blend")

# ---------------------------------------------------------------- the game's
#
# Read, never typed. See the module docstring.

HALF_WIDTH = ts_const("src/world/entrance/layout.ts", "ENTRANCE_GATE_HALF_WIDTH")
POST_HEIGHT = ts_const("src/world/entrance/layout.ts", "ENTRANCE_GATE_POST_HEIGHT")
TALLEST_CHILD = ts_const("src/art/models/kid.ts", "TALLEST_CHILD_HEIGHT")

# ------------------------------------------------------------------ the piers
#
# A chunky round pier: plinth, tapered shaft, flared capital. Radii are fat on
# purpose — Jim's standing scale rule is legibility from the isometric camera,
# not a tape measure, and a slim column reads as scaffolding rather than as the
# gate of a place worth going into.

PLINTH_R = 0.76
PLINTH_H = 0.22
SHAFT_R_LOW = 0.56
SHAFT_R_TOP = 0.47
CAPITAL_R = 0.80
#: How far the capital rises above the shaft. The arch springs off its top.
CAPITAL_H = 0.38
#: Where the arch springs from, and the top of the pier.
SPRING_Y = POST_HEIGHT + CAPITAL_H

# ------------------------------------------------------------------- the band
#
# A segmental arch: one circular band from capital to capital. `RISE` is how
# far the soffit climbs over the springing at the centre of the gateway.

RISE = 1.80
#: Radial thickness of the band.
BAND = 0.46
#: How thick the arch is through the gateway (the game's Z).
DEPTH = 0.62
#: How far below the springing the band's ends run on, so they finish *inside*
#: the capitals rather than sitting on top of them with a visible joint.
BAND_BURY = 0.38
BAND_SAMPLES = 44

#: Intrados radius and centre, from the two points the soffit must pass
#: through: (±HALF_WIDTH, SPRING_Y) and (0, SPRING_Y + RISE).
INTRADOS_R = (HALF_WIDTH * HALF_WIDTH + RISE * RISE) / (2.0 * RISE)
EXTRADOS_R = INTRADOS_R + BAND
ARC_CENTRE_Z = SPRING_Y + RISE - INTRADOS_R
#: The very top of the band, on the arch's centre line.
BAND_TOP = ARC_CENTRE_Z + EXTRADOS_R

# ---------------------------------------------------------------- the bobbles
#
# Nine balls along the top of the band. Cheap, unmistakably fairground, and
# they break the silhouette so the arch is not a plain semicircle in outline
# (ART_DIRECTION §4).

BOBBLES = 9
BOBBLE_R = 0.20
#: How far the ball's centre sits outside the extrados. Sunk in, so each one
#: reads as growing out of the stone rather than balanced on it.
BOBBLE_SINK = 0.11
#: Fraction of the visible arc the run of bobbles spans.
BOBBLE_SPREAD = 0.78

# ------------------------------------------------------------------- the sign
#
# A hanging plank across the opening carrying "LAND OF GOOD PLACES".
#
# Straight, not arch-topped, and that is the legibility decision. An arch-topped
# tympanum filling the whole opening gives the lettering a 1.98 m tall field
# whose ends taper to nothing, so the type has to shrink to survive the corners.
# A straight plank hung inside the curve keeps one honest rectangle of full
# height for the words, and leaves a crescent of sky either side of it, which is
# what a fairground gate looks like anyway.
#
# The width is not free: the plank's top corners must clear the soffit. See
# `check_sign_clears_the_arch()`.

SIGN_HALF_WIDTH = 2.85
SIGN_BOTTOM = 3.60
SIGN_HEIGHT = 1.06
SIGN_DEPTH = 0.26
#: Corner rounding on the plank, so it is a plank and not a slab.
SIGN_ROUND = 0.16
SIGN_TOP = SIGN_BOTTOM + SIGN_HEIGHT

#: Two straps from the soffit down onto the plank, so it reads as *hung*.
HANGER_X = 1.90
HANGER_W = 0.22
HANGER_D = 0.18
#: How far each strap laps onto the plank and up into the band.
HANGER_LAP = 0.16

# -------------------------------------------------------------- the medallion
#
# The ferris wheel roundel, on a short collar off the top of the band. The
# park's own wheel is what it is a mark of, so the painted art in `gateArch.ts`
# takes the ride's twelve gondolas, its double rim and its splayed legs.

COLLAR_R_LOW = 0.34
COLLAR_R_TOP = 0.24
#: How far the collar sinks into the band, and how far it rises above it.
COLLAR_SINK = 0.30
COLLAR_RISE = 0.34
#: Radius of the roundel's flat painted face, and of its raised rim.
MEDALLION_R = 0.86
MEDALLION_RIM_R = 1.00
#: Half the roundel's thickness through the gateway.
MEDALLION_HALF_D = 0.13
#: How far the roundel's bottom laps down over the collar's top.
MEDALLION_LAP = 0.12
MEDALLION_SEGMENTS = 28
MEDALLION_CENTRE_Z = BAND_TOP + COLLAR_RISE - MEDALLION_LAP + MEDALLION_RIM_R


# =============================================================================
# Local shape generators
# =============================================================================


def revolve_about_z(profile, segments, offset=(0.0, 0.0, 0.0)):
    """A vertical surface of revolution, translated. Pier, collar."""
    verts, faces = revolve(profile, segments=segments)
    dx, dy, dz = offset
    return [(v[0] + dx, v[1] + dy, v[2] + dz) for v in verts], faces


def revolve_about_y(profile, segments):
    """A surface of revolution about **Blender Y** — a plate facing the player.

    ``blendkit.revolve`` turns about Z, which is up here; a coin standing on
    edge in the gateway turns about the depth axis instead. The profile is
    ``(radius, depth)`` pairs, and the radius sweeps X and Z, so the flat face
    lands squarely in the plane the lettering and the logo are read off.
    """
    count = len(profile)
    verts = []
    faces = []
    for s in range(segments):
        angle = s * TAU / segments
        cos_a, sin_a = math.cos(angle), math.sin(angle)
        for r, y in profile:
            verts.append((r * cos_a, y, r * sin_a))
    for s in range(segments):
        s_next = (s + 1) % segments
        for p in range(count):
            p_next = (p + 1) % count
            faces.append(
                (
                    s * count + p,
                    s * count + p_next,
                    s_next * count + p_next,
                    s_next * count + p,
                )
            )
    return verts, faces


def strip_solid(inner, outer, depth):
    """A solid slab between two matched polylines in XZ, extruded through Y.

    The arch band (soffit and extrados) and nothing else. Written rather than
    reached for from ``blendkit``: ``extrude_outline`` caps with a fan from a
    centre point, and an arch band is an annular sector — star-shaped about no
    interior point at all, so a fan cap would triangulate it inside out.
    """
    assert len(inner) == len(outer), "an arch band needs one soffit point per extrados point"
    count = len(inner)
    half = depth * 0.5
    verts = []
    for y in (-half, half):
        for x, z in inner:
            verts.append((x, y, z))
        for x, z in outer:
            verts.append((x, y, z))
    front_in, front_out = 0, count
    back_in, back_out = 2 * count, 3 * count
    faces = []
    for i in range(count - 1):
        j = i + 1
        # front and back
        faces.append((front_in + i, front_in + j, front_out + j, front_out + i))
        faces.append((back_out + i, back_out + j, back_in + j, back_in + i))
        # soffit and extrados
        faces.append((front_in + i, back_in + i, back_in + j, front_in + j))
        faces.append((front_out + j, back_out + j, back_out + i, front_out + i))
    # the two cut ends
    faces.append((front_in, front_out, back_out, back_in))
    last = count - 1
    faces.append((back_in + last, back_out + last, front_out + last, front_in + last))
    return verts, faces


def rounded_plank(half_width, bottom, height, depth, radius, segments=4):
    """The sign plank: a rectangle in XZ with rounded ends, extruded through Y.

    Returns ``(verts, faces, front_face_indices, back_face_indices)`` so the
    caller can hand the two flat faces their own UVs — the front reading
    left-to-right for a child walking up to the gate, the back reading
    left-to-right for one walking out of the park. One texture, two faces, no
    second mesh (``src/art/models/CLAUDE.md``).
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
    front = tuple(range(count))
    back = tuple(range(2 * count - 1, count - 1, -1))
    faces.append(front)
    faces.append(back)
    return verts, faces, len(faces) - 2, len(faces) - 1


def face_uvs(verts, face, lo_x, hi_x, lo_z, hi_z, mirror):
    """Planar UVs for one flat face, in the part's own XZ bounds.

    ``mirror`` flips ``u``. It is the whole of getting a painted word the right
    way round, and it is not guessable from the vertex data: the game's +Z is
    Blender's −Y, so a viewer standing in front of this arch has the model's
    **+X on her left**. The front face therefore runs ``u`` from +X to −X and
    the back face runs it the other way, and both read correctly.
    """
    width = max(hi_x - lo_x, 1e-6)
    height = max(hi_z - lo_z, 1e-6)
    out = []
    for i in face:
        x, _, z = verts[i]
        u = (hi_x - x) / width if not mirror else (x - lo_x) / width
        out.append((u, (z - lo_z) / height))
    return out


# =============================================================================
# The parts
# =============================================================================


def build_piers(coll):
    """Both piers in one node — same colour, so one draw call rather than two."""
    profile = [
        (0.0, 0.0),
        (PLINTH_R, 0.0),
        (PLINTH_R, PLINTH_H),
        (PLINTH_R - 0.12, PLINTH_H + 0.12),
        (SHAFT_R_LOW, PLINTH_H + 0.20),
        (SHAFT_R_LOW - 0.06, POST_HEIGHT * 0.55),
        (SHAFT_R_TOP, POST_HEIGHT),
        (SHAFT_R_TOP + 0.15, POST_HEIGHT + 0.10),
        (CAPITAL_R, POST_HEIGHT + 0.24),
        (CAPITAL_R, POST_HEIGHT + 0.32),
        (CAPITAL_R - 0.10, SPRING_Y),
        (0.0, SPRING_Y),
    ]
    part = Part("gate-arch-piers")
    for side in (-1.0, 1.0):
        verts, faces = revolve_about_z(profile, 20, offset=(side * HALF_WIDTH, 0.0, 0.0))
        part.add(verts, faces)
    return part.emit(coll)


def arc_points(radius, samples):
    """Soffit/extrados sample points, from one buried end round to the other."""
    # The end angle: run the band on past the springing and down into the
    # capital, so the joint is inside solid stone.
    end_z = SPRING_Y - BAND_BURY
    reach = (end_z - ARC_CENTRE_Z) / INTRADOS_R
    theta_end = math.asin(max(-1.0, min(1.0, reach)))
    points = []
    for i in range(samples):
        t = i / (samples - 1)
        theta = theta_end + t * (math.pi - 2.0 * theta_end)
        points.append((radius * math.cos(theta), ARC_CENTRE_Z + radius * math.sin(theta)))
    return points


def build_band(coll):
    """The arch band, the two sign hangers and the medallion's collar."""
    part = Part("gate-arch-band")
    inner = arc_points(INTRADOS_R, BAND_SAMPLES)
    outer = arc_points(EXTRADOS_R, BAND_SAMPLES)
    part.add(*strip_solid(inner, outer, DEPTH))

    # The straps the sign hangs from. Each laps up into the soffit and down
    # onto the plank, so no face of either meets a face of the other.
    for side in (-1.0, 1.0):
        x = side * HANGER_X
        soffit_z = ARC_CENTRE_Z + math.sqrt(max(INTRADOS_R**2 - x * x, 0.0))
        top = soffit_z + HANGER_LAP
        bottom = SIGN_TOP - HANGER_LAP
        verts, faces = strip_solid(
            [(x - HANGER_W / 2, bottom), (x - HANGER_W / 2, top)],
            [(x + HANGER_W / 2, bottom), (x + HANGER_W / 2, top)],
            HANGER_D,
        )
        part.add(verts, faces)

    # The collar the roundel stands on.
    collar = [
        (0.0, BAND_TOP - COLLAR_SINK),
        (COLLAR_R_LOW, BAND_TOP - COLLAR_SINK),
        (COLLAR_R_LOW - 0.04, BAND_TOP + 0.06),
        (COLLAR_R_TOP, BAND_TOP + COLLAR_RISE),
        (0.0, BAND_TOP + COLLAR_RISE),
    ]
    part.add(*revolve_about_z(collar, 16))
    return part.emit(coll)


def build_bobbles(coll):
    """Nine balls along the extrados. Their own node, so they take their own
    colour — a row of lemon bobbles on a pink arch, which is the whole point of
    them."""
    part = Part("gate-arch-bobbles")
    inner = arc_points(EXTRADOS_R + BOBBLE_R - BOBBLE_SINK, BOBBLES * 8)
    span = len(inner) - 1
    first = int(span * (1.0 - BOBBLE_SPREAD) / 2.0)
    last = span - first
    verts, faces = icosphere(BOBBLE_R, subdivisions=2)
    for i in range(BOBBLES):
        index = first + round((last - first) * i / (BOBBLES - 1))
        x, z = inner[index]
        part.at(verts, faces, x=x, y=0.0, z=z)
    return part.emit(coll, smooth=True)


def build_sign(coll):
    """The lettered plank. Carries the arch's own UVs — see the module docstring."""
    verts, faces, front, back = rounded_plank(
        SIGN_HALF_WIDTH, SIGN_BOTTOM, SIGN_HEIGHT, SIGN_DEPTH, SIGN_ROUND
    )
    lo_x, hi_x = -SIGN_HALF_WIDTH, SIGN_HALF_WIDTH
    lo_z, hi_z = SIGN_BOTTOM, SIGN_TOP
    uvs = []
    for index, face in enumerate(faces):
        if index == front:
            uvs.append(face_uvs(verts, face, lo_x, hi_x, lo_z, hi_z, mirror=False))
        elif index == back:
            uvs.append(face_uvs(verts, face, lo_x, hi_x, lo_z, hi_z, mirror=True))
        else:
            # The rounded edge. Takes the silhouette's own UVs, so the painted
            # border wraps round the end of the plank the way paint does.
            uvs.append(face_uvs(verts, face, lo_x, hi_x, lo_z, hi_z, mirror=False))
    part = Part("gate-arch-sign")
    part.add(verts, faces, uvs=uvs)
    # Not smoothed: a plank with a hard front face is what the lettering wants,
    # and a smoothed rounded end would drag the toon ramp across the words.
    return part.emit(coll, sharp_deg=30.0)


def build_medallion(coll):
    """The ferris-wheel roundel: a raised-rim coin, painted in its own UV space."""
    profile = [
        (0.0, -MEDALLION_HALF_D),
        (MEDALLION_R, -MEDALLION_HALF_D),
        (MEDALLION_R + 0.06, -MEDALLION_HALF_D + 0.04),
        (MEDALLION_RIM_R, -MEDALLION_HALF_D + 0.09),
        (MEDALLION_RIM_R, MEDALLION_HALF_D - 0.09),
        (MEDALLION_R + 0.06, MEDALLION_HALF_D - 0.04),
        (MEDALLION_R, MEDALLION_HALF_D),
        (0.0, MEDALLION_HALF_D),
    ]
    verts, faces = revolve_about_y(profile, MEDALLION_SEGMENTS)
    verts = [(x, y, z + MEDALLION_CENTRE_Z) for x, y, z in verts]
    lo_x, hi_x = -MEDALLION_RIM_R, MEDALLION_RIM_R
    lo_z = MEDALLION_CENTRE_Z - MEDALLION_RIM_R
    hi_z = MEDALLION_CENTRE_Z + MEDALLION_RIM_R
    uvs = [
        face_uvs(
            verts,
            face,
            lo_x,
            hi_x,
            lo_z,
            hi_z,
            # A face on the far side of the plate is read from behind, so it
            # wants the mirrored map. The wheel is left-right symmetric, so
            # this changes nothing visible — it is here so the rule is the same
            # one everywhere and the next painted thing inherits it.
            mirror=sum(verts[i][1] for i in face) / len(face) > 0.0,
        )
        for face in faces
    ]
    part = Part("gate-arch-medallion")
    part.add(verts, faces, uvs=uvs)
    return part.emit(coll)


# =============================================================================
# Checks — every one of them against the emitted vertices
# =============================================================================


def measured():
    """Every object's world-space bounds, read back off the mesh."""
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


def check_headroom(bounds):
    """Nothing a child walks under may come near her hat.

    The gateway is the strip between the piers; the lowest thing over it is the
    sign plank. Measured off the mesh, never off the constant that placed it.
    """
    lines = []
    pier_lo, pier_hi = bounds["gate-arch-piers"]
    # The clear opening: from the inner face of one capital to the other.
    clear_half = HALF_WIDTH - CAPITAL_R
    # **Per vertex, not per bounding box.** The band's own bbox reaches down to
    # z = 3.30, but only at x = ±5.0, where it is buried in a capital — a
    # bbox test reports that as 30 cm of headroom over the middle of the
    # gateway, which is a wrong answer of exactly the shape CLAUDE.md warns
    # about: an assertion describing something other than the thing it names.
    lowest = 1e9
    owner = "nothing"
    for obj in bpy.data.objects:
        if obj.type != "MESH" or obj.name == "gate-arch-piers":
            continue
        for v in obj.data.vertices:
            p = obj.matrix_world @ v.co
            if abs(p.x) <= clear_half and p.z < lowest:
                lowest = p.z
                owner = obj.name
    clearance = lowest - TALLEST_CHILD
    lines.append(
        f"    clear opening {2 * clear_half:.2f} m wide "
        f"(pier centres ±{HALF_WIDTH:.2f}, capital radius {CAPITAL_R:.2f})"
    )
    lines.append(
        f"    lowest thing over it: {owner} at {lowest:.3f} m — "
        f"{clearance:+.3f} m over a {TALLEST_CHILD:.2f} m child"
    )
    assert clearance > 0.35, (
        f"only {clearance:.3f} m of headroom under {owner} for a {TALLEST_CHILD:.2f} m "
        "child in the tallest hat — a gate she has to duck through is a bug"
    )
    assert clear_half > 3.0, f"the gateway is only {2 * clear_half:.2f} m wide"
    assert pier_lo.z < 1e-6 and pier_hi.z > POST_HEIGHT, "the piers must stand on the ground"
    return "\n".join(lines)


def check_sign_clears_the_arch(bounds):
    """The plank's top corners must be inside the soffit, or it pokes through.

    This is the number that actually sets how wide the sign can be, and it is
    the one a person changing ``SIGN_HALF_WIDTH`` by eye would get wrong.
    """
    lo, hi = bounds["gate-arch-sign"]
    x = max(abs(lo.x), abs(hi.x))
    soffit = ARC_CENTRE_Z + math.sqrt(max(INTRADOS_R**2 - x * x, 0.0))
    margin = soffit - hi.z
    assert margin > 0.05, (
        f"the sign's corners reach {hi.z:.3f} m at x=±{x:.3f} where the soffit is only "
        f"{soffit:.3f} m — widen the arch or narrow the sign"
    )
    return (
        f"    sign {hi.x - lo.x:.2f} × {hi.z - lo.z:.2f} m; its top corners clear the "
        f"soffit by {margin:.3f} m"
    )


def check_span(bounds):
    """The arch must actually span the gateway the park cut for it."""
    lo, hi = bounds["gate-arch-piers"]
    span = hi.x - lo.x
    want = 2.0 * (HALF_WIDTH + max(PLINTH_R, CAPITAL_R))
    assert abs(span - want) < 1e-3, f"piers span {span:.3f} m, expected {want:.3f} m"
    band_lo, band_hi = bounds["gate-arch-band"]
    assert band_hi.x < hi.x and band_lo.x > lo.x, (
        "the band's springing must finish inside the capitals, not outside the piers"
    )
    return (
        f"    piers at x=±{HALF_WIDTH:.2f} (from layout.ts), footprint {span:.2f} m across;\n"
        f"    band springs at z={SPRING_Y:.2f} and reaches x=±{band_hi.x:.2f}, buried in the capitals"
    )


def check_keep_out(bounds):
    """What the collider has to be, measured — not proposed in prose.

    ``keepOutsFor`` owns where a child must be able to stand, so the arch's
    collider is two circles on the piers and nothing else. This prints the
    radius the built plinths actually need and proves the gap between them.
    """
    lo, hi = bounds["gate-arch-piers"]
    radius = max(PLINTH_R, CAPITAL_R)
    gap = 2.0 * (HALF_WIDTH - radius)
    assert gap > 2.0, f"a {gap:.2f} m gap between the piers is not a gateway"
    return (
        f"    collider: one circle per pier, centre x=±{HALF_WIDTH:.2f}, radius "
        f"{radius:.2f} m — {gap:.2f} m of clear floor between them.\n"
        f"    Depth through the gateway {hi.y - lo.y:.2f} m; nothing else is solid."
    )


def check_uv_coverage():
    """Both painted parts must carry UVs, and nothing else should.

    A painted surface with no UV layer is the failure that looks fine in the
    outliner and ships a flat grey plank, so it is asserted rather than assumed.
    """
    lines = []
    painted = {"gate-arch-sign", "gate-arch-medallion"}
    for obj in sorted(bpy.data.objects, key=lambda o: o.name):
        if obj.type != "MESH":
            continue
        has = len(obj.data.uv_layers) > 0
        if obj.name in painted:
            assert has, f"{obj.name} carries a painted texture and has no UV layer"
            us = [loop.uv[0] for loop in obj.data.uv_layers[0].data]
            vs = [loop.uv[1] for loop in obj.data.uv_layers[0].data]
            lines.append(
                f"    {obj.name}: u {min(us):.3f}..{max(us):.3f}  v {min(vs):.3f}..{max(vs):.3f}"
            )
        else:
            assert not has, f"{obj.name} is a flat-coloured part and should carry no UVs"
    return "\n".join(lines)


def check_texture_aspect(bounds):
    """The aspect ratio each canvas must be painted at, so pixels come out square.

    ``gateArch.ts`` derives these the same way, from the same measured
    geometry, rather than being told them here.
    """
    lines = []
    for name in ("gate-arch-sign", "gate-arch-medallion"):
        lo, hi = bounds[name]
        w, h = hi.x - lo.x, hi.z - lo.z
        lines.append(f"    {name}: {w:.3f} × {h:.3f} m — canvas aspect {w / h:.3f}")
    return "\n".join(lines)


def main() -> None:
    reset_scene()
    build_piers(collection("piers"))
    build_band(collection("band"))
    build_bobbles(collection("bobbles"))
    build_sign(collection("sign"))
    build_medallion(collection("medallion"))
    bpy.context.view_layer.update()

    bounds = measured()
    top = max(hi.z for _, hi in bounds.values())

    print("\ngate_arch_build")
    print(summarise())
    print("\n  the gateway, measured off the emitted vertices:")
    print(check_span(bounds))
    print(check_headroom(bounds))
    print(check_sign_clears_the_arch(bounds))
    print("\n  what the placer needs:")
    print(check_keep_out(bounds))
    print("\n  painted surfaces (ART_DIRECTION §7 — one surface, one texture):")
    print(check_uv_coverage())
    print(check_texture_aspect(bounds))
    print(
        f"\n  total height {top:.3f} m to the top of the roundel"
        f"  (band top {BAND_TOP:.3f}, roundel centre {MEDALLION_CENTRE_Z:.3f})"
    )
    print(
        f"  read from the game: ENTRANCE_GATE_HALF_WIDTH {HALF_WIDTH}, "
        f"ENTRANCE_GATE_POST_HEIGHT {POST_HEIGHT}, TALLEST_CHILD_HEIGHT {TALLEST_CHILD}"
    )
    print(f"\n  {len(bpy.data.objects)} nodes, {total_triangles()} triangles total")

    bpy.ops.wm.save_as_mainfile(filepath=BLEND)
    print("  saved", BLEND, f"({os.path.getsize(BLEND)} bytes)\n")


if __name__ == "__main__":
    # Blender exits 0 on an uncaught Python exception; `--python-exit-code 1` on
    # the command line is what covers assertions in the module body, which this
    # block cannot. See `hotel_build.py`'s tail.
    try:
        main()
    except Exception:
        traceback.print_exc()
        sys.exit(1)
