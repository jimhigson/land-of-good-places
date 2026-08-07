"""Builds The Land Hotel's art assets **procedurally** and saves ``art/blend/hotel.blend``.

    blender --background --factory-startup --python art/blend/hotel_build.py

Unlike ``cart.blend`` and ``duckbar.blend`` — which are hand-modelled files that
``*_export.py`` merely opens — this asset's authoring source is *this script*.
Six assets in one file (a 28 m crystal tower plus the furniture of a hotel) is
far too much to keep re-posing by hand, and every number in here wants to be
readable next to the number it has to agree with: the mattress top at 0.55 m
because children stand on it, the counter at 1.02 m because that is what the
shop kiosks use, the 16 m footprint because that is the plot the park gives it.

``hotel.blend`` is therefore a **generated** artefact: run this, then
``npm run blend:hotel`` (``hotel_export.py``) to write the ``.glb``. Do not
hand-edit the .blend — the next run of this script will overwrite it.

## What the asset owns, and what it does not

Shape only, exactly like every other asset in `ART-AGENT-NOTES.md` §6a:
geometry, UVs (only where code paints a word), and one named node per
distinctly-coloured part. Colours, outlines, emissive window glow and the
shadow flags all stay in `src/art/models/hotelAssets.ts`.

## Conventions this file is written against (ART_DIRECTION §7)

* 1 Blender unit = 1 metre.
* **Blender −Y is the game's +Z.** The glTF exporter's `export_yup` maps
  Blender (x, y, z) → glTF (x, z, −y), so anything that must face the player
  is built facing **−Y** here: the tower's door, the reception desk's
  customer side, the "yours" door's leaf.
* Each asset's origin is its own base, centred on X and Y, and every part is
  baked into vertex positions — every object leaves Blender at an identity
  transform. Assets therefore all sit on top of each other at the world
  origin; each lives in its own **collection** so the outliner stays
  readable, and `hotel_render.py` shows them one at a time.
* The disco ball is the documented exception: its origin is the top of its
  rod, so all of its geometry hangs *below* z = 0 (the balloon rule).
* No randomness at all, in here or in the game: every "scattered" crystal,
  every jumbled shreddie is a literal in a table below.
"""

import math
import os

import bmesh
import bpy
from mathutils import Matrix, Vector

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
BLEND = os.path.join(REPO, "art", "blend", "hotel.blend")

TAU = math.pi * 2.0

# =============================================================================
# Scene plumbing
# =============================================================================


def reset_scene() -> None:
    """Empties the factory-startup scene — cube, camera, light and all."""
    # No `hotel.blend1` backup. Blender keeps one copy of the previous save by
    # default, which for a hand-modelled file is a kindness and for a generated
    # one is a 190 KB binary that lands untracked in `git status` after every
    # run and that nobody should ever restore from — the Python is the source.
    bpy.context.preferences.filepaths.save_version = 0
    for obj in list(bpy.data.objects):
        bpy.data.objects.remove(obj, do_unlink=True)
    for block in (bpy.data.meshes, bpy.data.materials, bpy.data.collections):
        for item in list(block):
            block.remove(item)


def collection(name: str) -> bpy.types.Collection:
    coll = bpy.data.collections.new(name)
    bpy.context.scene.collection.children.link(coll)
    return coll


class Part:
    """One named node's geometry, accumulated in metres about the asset origin.

    Everything is added as plain vertex/face lists so a builder can compose
    primitives without worrying about bmesh bookkeeping; :meth:`emit` does the
    welding, normal recalculation and shading in one place.
    """

    def __init__(self, name: str) -> None:
        self.name = name
        self.verts: list[tuple[float, float, float]] = []
        self.faces: list[tuple[int, ...]] = []
        self.uvs: dict[int, list[tuple[float, float]]] = {}

    def add(self, verts, faces, matrix: Matrix | None = None, uvs=None) -> None:
        base = len(self.verts)
        if matrix is None:
            self.verts.extend(tuple(v) for v in verts)
        else:
            self.verts.extend(tuple(matrix @ Vector(v)) for v in verts)
        for index, face in enumerate(faces):
            self.faces.append(tuple(i + base for i in face))
            if uvs is not None:
                self.uvs[len(self.faces) - 1] = list(uvs[index])

    def emit(
        self,
        coll: bpy.types.Collection,
        *,
        smooth: bool = True,
        sharp_deg: float = 46.0,
        recalc: bool = True,
        weld: bool = True,
    ) -> bpy.types.Object:
        mesh = bpy.data.meshes.new(self.name)
        mesh.from_pydata(self.verts, [], self.faces)
        mesh.validate(verbose=False)

        bm = bmesh.new()
        bm.from_mesh(mesh)
        if weld:
            bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
        if recalc:
            bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
        threshold = math.radians(sharp_deg)
        for face in bm.faces:
            face.smooth = smooth
        if smooth:
            # "Smooth by angle", done by hand: a bevelled corner reads round,
            # a genuine crease stays a crease. Blender ≥ 4.1 derives split
            # normals straight from these flags, and the glTF exporter writes
            # the result — so this is the only shading control the asset needs.
            #
            # **46° is a size decision as much as a look one.** A split normal
            # is a duplicated vertex in the exported file, and this asset is
            # nearly all chamfered boxes: at 33° every one-segment bevel came
            # out sharp and the shipped `.glb` paid four vertices per corner
            # for edges the toon ramp cannot even show. 46° keeps a cube's own
            # 90° edges crisp, keeps a hex prism faceted, and lets both a
            # one-segment (45°) and a two-segment (30°) bevel round off.
            for edge in bm.edges:
                if len(edge.link_faces) == 2 and edge.calc_face_angle(0.0) > threshold:
                    edge.smooth = False
        bm.to_mesh(mesh)
        bm.free()

        if self.uvs:
            layer = mesh.uv_layers.new(name="UVMap")
            for poly in mesh.polygons:
                corners = self.uvs.get(poly.index)
                for step, loop_index in enumerate(poly.loop_indices):
                    layer.data[loop_index].uv = corners[step] if corners else (0.02, 0.02)

        obj = bpy.data.objects.new(self.name, mesh)
        coll.objects.link(obj)
        return obj


# =============================================================================
# Primitive generators — all return (verts, faces) in local metres
# =============================================================================


def bm_lists(bm: bmesh.types.BMesh):
    bm.verts.index_update()
    verts = [tuple(v.co) for v in bm.verts]
    faces = [tuple(loop.vert.index for loop in f.loops) for f in bm.faces]
    bm.free()
    return verts, faces


def rounded_box(sx: float, sy: float, sz: float, radius: float, segments: int = 2):
    """A chunky rounded box, centred on its own origin. ART_DIRECTION §1's shape.

    Two bevel segments by default, not three. A third segment is invisible on a
    toon-shaded toy — the ramp bands the corner into the same two values either
    way — and it very nearly doubles the triangles of the most-used shape in
    this file. Small parts (a shreddie, a chair leg) pass 1 and read the same.
    """
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    bmesh.ops.scale(bm, vec=(sx, sy, sz), verts=bm.verts)
    limit = min(sx, sy, sz) * 0.49
    bmesh.ops.bevel(
        bm,
        geom=list(bm.verts) + list(bm.edges),
        offset=min(radius, limit),
        segments=segments,
        profile=0.5,
        affect="EDGES",
    )
    return bm_lists(bm)


def flat_top_box(sx: float, sy: float, sz: float, radius: float, segments: int = 2):
    """A rounded box whose **top face stays perfectly flat** at +sz/2.

    The mattress and the counter both need a clean standing surface, and a
    bevel that rounds the top face away is exactly what would make a child
    slide off the edge of a platform the game says is flat. Only the four
    vertical edges and the bottom are rounded.
    """
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    bmesh.ops.scale(bm, vec=(sx, sy, sz), verts=bm.verts)
    top = sz * 0.5 - 1e-4
    geom = [e for e in bm.edges if not (e.verts[0].co.z > top and e.verts[1].co.z > top)]
    geom += [v for v in bm.verts if v.co.z < top]
    bmesh.ops.bevel(
        bm,
        geom=geom,
        offset=min(radius, min(sx, sy) * 0.49),
        segments=segments,
        profile=0.5,
        affect="EDGES",
    )
    return bm_lists(bm)


def icosphere(radius: float, subdivisions: int = 2):
    bm = bmesh.new()
    bmesh.ops.create_icosphere(bm, subdivisions=subdivisions, radius=radius)
    return bm_lists(bm)


def ring(count: int, radius: float, z: float, spin: float = 0.0):
    return [
        (radius * math.cos(spin + i * TAU / count), radius * math.sin(spin + i * TAU / count), z)
        for i in range(count)
    ]


def tube(radius: float, height: float, sides: int = 16, z0: float = 0.0):
    """A capped cylinder standing on z0."""
    lower = ring(sides, radius, z0)
    upper = ring(sides, radius, z0 + height)
    verts = lower + upper
    faces = []
    for i in range(sides):
        j = (i + 1) % sides
        faces.append((i, j, sides + j, sides + i))
    faces.append(tuple(range(sides - 1, -1, -1)))
    faces.append(tuple(range(sides, sides * 2)))
    return verts, faces


def revolve(profile, segments: int = 20):
    """A closed surface of revolution about Z from a closed (r, z) cross-section.

    Used for every bowl and the yoghurt's dome. Points with r == 0 collapse
    onto a single pole vertex, which `remove_doubles` in :meth:`Part.emit`
    then welds — so a profile may open and close on the axis freely.
    """
    verts = []
    faces = []
    count = len(profile)
    for s in range(segments):
        angle = s * TAU / segments
        cos_a, sin_a = math.cos(angle), math.sin(angle)
        for r, z in profile:
            verts.append((r * cos_a, r * sin_a, z))
    for s in range(segments):
        s_next = (s + 1) % segments
        for p in range(count):
            p_next = (p + 1) % count
            a = s * count + p
            b = s * count + p_next
            c = s_next * count + p_next
            d = s_next * count + p
            faces.append((a, b, c, d))
    return verts, faces


def sweep_path(points, radius: float, sides: int = 5, up=(0.0, 0.0, 1.0), closed: bool = True):
    """A round tube swept along a planar path — the heart cheerios, the honey swirl.

    The path is planar by construction here, so the frame is the honest cheap
    one: tangent × plane-normal. No parallel transport, no twist to chase.

    An open path (`closed=False`) gets a fan cap at each end. Sweeping one as a
    loop instead looked like it worked and did not: the return leg lands on the
    outward leg vertex for vertex, `remove_doubles` welds the two together, and
    what comes out is a tube with two open ends and no cap — invisible from
    outside until the camera catches the hole.
    """
    up_v = Vector(up)
    count = len(points)
    verts = []
    faces = []
    for i in range(count):
        p = Vector(points[i])
        nxt = Vector(points[min(i + 1, count - 1)] if not closed else points[(i + 1) % count])
        prv = Vector(points[max(i - 1, 0)] if not closed else points[(i - 1) % count])
        tangent = (nxt - prv).normalized()
        side = tangent.cross(up_v).normalized()
        normal = side.cross(tangent).normalized()
        for k in range(sides):
            angle = k * TAU / sides
            verts.append(tuple(p + side * (math.cos(angle) * radius) + normal * (math.sin(angle) * radius)))
    span = count if closed else count - 1
    for i in range(span):
        i_next = (i + 1) % count
        for k in range(sides):
            k_next = (k + 1) % sides
            faces.append(
                (
                    i * sides + k,
                    i * sides + k_next,
                    i_next * sides + k_next,
                    i_next * sides + k,
                )
            )
    if not closed:
        faces.append(tuple(range(sides - 1, -1, -1)))
        faces.append(tuple(range((count - 1) * sides, count * sides)))
    return verts, faces


def heart_path(width: float, samples: int = 22):
    """The classic heart curve, scaled so its widest point is `width` across."""
    points = []
    for i in range(samples):
        t = i * TAU / samples
        x = 16.0 * math.sin(t) ** 3
        y = 13.0 * math.cos(t) - 5.0 * math.cos(2 * t) - 2.0 * math.cos(3 * t) - math.cos(4 * t)
        points.append((x, y))
    scale = width / (2.0 * max(abs(p[0]) for p in points))
    return [(x * scale, y * scale, 0.0) for x, y in points]


def extrude_outline(outline, depth: float, centre=(0.0, 0.0)):
    """A solid prism from a closed 2-D outline in the XZ plane, extruded along Y.

    Caps are fans from `centre`, which is valid for every outline this file
    builds (they are all star-shaped about it) and avoids handing the glTF
    exporter a concave n-gon to triangulate — the star is concave, and a bad
    triangulation of a five-point star is very visible.
    """
    count = len(outline)
    half = depth * 0.5
    verts = [(x, -half, z) for x, z in outline] + [(x, half, z) for x, z in outline]
    front_c = len(verts)
    verts.append((centre[0], -half, centre[1]))
    back_c = len(verts)
    verts.append((centre[0], half, centre[1]))
    faces = []
    for i in range(count):
        j = (i + 1) % count
        faces.append((i, j, count + j, count + i))  # side wall
        faces.append((front_c, j, i))  # front cap
        faces.append((back_c, count + i, count + j))  # back cap
    return verts, faces


def ring_outline(inner, outer, depth: float, cap_ends: bool = True):
    """A frame: the band between two open outlines, given depth along Y."""
    count = len(inner)
    half = depth * 0.5
    verts = (
        [(x, -half, z) for x, z in inner]
        + [(x, -half, z) for x, z in outer]
        + [(x, half, z) for x, z in inner]
        + [(x, half, z) for x, z in outer]
    )
    i0, o0, i1, o1 = 0, count, count * 2, count * 3
    faces = []
    for i in range(count - 1):
        j = i + 1
        faces.append((i0 + i, i0 + j, o0 + j, o0 + i))  # front band
        faces.append((i1 + j, i1 + i, o1 + i, o1 + j))  # back band
        faces.append((i0 + j, i0 + i, i1 + i, i1 + j))  # inner wall
        faces.append((o0 + i, o0 + j, o1 + j, o1 + i))  # outer wall
    if cap_ends:
        faces.append((i0, o0, o1, i1))
        last = count - 1
        faces.append((o0 + last, i0 + last, i1 + last, o1 + last))
    return verts, faces


def arch_outline(half_width: float, straight_top: float, samples: int = 12, floor: float = 0.0):
    """A doorway outline: up the right jamb, over a semicircular arch, down the left."""
    points = [(half_width, floor), (half_width, straight_top)]
    for i in range(1, samples):
        angle = i * math.pi / samples
        points.append((half_width * math.cos(angle), straight_top + half_width * math.sin(angle)))
    points += [(-half_width, straight_top), (-half_width, floor)]
    return points


def offset_arch(half_width: float, straight_top: float, grow: float, samples: int = 12, floor: float = 0.0):
    """`arch_outline` grown outward by `grow` — the frame's outer edge."""
    points = [(half_width + grow, floor), (half_width + grow, straight_top)]
    for i in range(1, samples):
        angle = i * math.pi / samples
        r = half_width + grow
        points.append((r * math.cos(angle), straight_top + r * math.sin(angle)))
    points += [(-half_width - grow, straight_top), (-half_width - grow, floor)]
    return points


def rounded_rect(width: float, height: float, radius: float, samples: int = 3):
    """A rounded-rectangle outline in the XZ plane, centred on its own origin."""
    hw, hh = width * 0.5 - radius, height * 0.5 - radius
    corners = ((hw, hh, 0.0), (-hw, hh, math.pi * 0.5), (-hw, -hh, math.pi), (hw, -hh, math.pi * 1.5))
    points = []
    for cx, cz, start in corners:
        for i in range(samples + 1):
            angle = start + (math.pi * 0.5) * i / samples
            points.append((cx + radius * math.cos(angle), cz + radius * math.sin(angle)))
    return points


def uv_from_xz(verts, faces, width: float, height: float):
    """Per-face-corner UVs mapping a panel's own XZ extent onto 0..1.

    For the two nodes code paints a word onto. The UV comes off the same
    vertices the shape does, so it cannot drift from the geometry the way a
    hand-written UV rectangle can — ART-AGENT-NOTES §6a's whole point.
    """
    return [
        [(v[0] / width + 0.5, v[2] / height + 0.5) for v in (verts[i] for i in face)] for face in faces
    ]


def star_outline(points_count: int, r_outer: float, r_inner: float, phase: float = math.pi / 2):
    out = []
    for i in range(points_count * 2):
        r = r_outer if i % 2 == 0 else r_inner
        angle = phase + i * math.pi / points_count
        out.append((r * math.cos(angle), r * math.sin(angle)))
    return out


# =============================================================================
# 1. TOWER — a cluster of faceted crystal prisms that has to read as a hotel
# =============================================================================

FOOTPRINT_RADIUS = 8.0
"""Half of the 16 m the park's plot gives the hotel. Asserted at the end."""


def crystal(
    sides: int,
    r_base: float,
    r_belly: float,
    r_shoulder: float,
    belly_h: float,
    body_h: float,
    tip_h: float,
    spin: float,
):
    """One faceted gem: narrow foot, wide belly, tapered shoulder, pyramid point.

    **The belly is what stops this being a skyscraper.** The first pass built
    each prism as a straight tapered tube and the finished cluster rendered as
    an office district — flat-sided, plumb, and entirely believable, which is
    the one thing this park's buildings must never be. A crystal grown out of
    the ground swells just above the ground and narrows all the way to its
    point, and that one extra ring is the whole difference between "cut gem"
    and "tower block".

    Everything is flat: no smoothing, no rounding. That is the Pokémon-esque
    cut-gem read, and it is also what lets the window rows sit on genuinely
    planar faces.
    """
    foot = ring(sides, r_base, 0.0, spin)
    belly = ring(sides, r_belly, belly_h, spin)
    shoulder = ring(sides, r_shoulder, body_h, spin)
    verts = foot + belly + shoulder + [(0.0, 0.0, body_h + tip_h)]
    apex_i = len(verts) - 1
    faces = []
    for i in range(sides):
        j = (i + 1) % sides
        faces.append((i, j, sides + j, sides + i))
        faces.append((sides + i, sides + j, sides * 2 + j, sides * 2 + i))
        faces.append((sides * 2 + i, sides * 2 + j, apex_i))
    faces.append(tuple(range(sides - 1, -1, -1)))
    return verts, faces


def gem(sides: int, r: float, body_h: float, tip_h: float, spin: float):
    """A crystal in the house proportions — for the base cluster, which wants
    fourteen of these and does not want fourteen rows of five numbers."""
    return crystal(sides, r * 0.84, r, r * 0.66, body_h * 0.16, body_h, tip_h, spin)


def crystal_side_faces(
    sides: int, r_belly: float, r_shoulder: float, belly_h: float, body_h: float, spin: float
):
    """The **upper** band of each face as (p00, p10, p11, p01) — bottom-left,
    -right, top-right, -left seen from outside, so a sub-quad interpolated in
    that order faces out too. Windows only ever live above the belly ring, so
    one band is all they need."""
    lower = ring(sides, r_belly, belly_h, spin)
    upper = ring(sides, r_shoulder, body_h, spin)
    out = []
    for i in range(sides):
        j = (i + 1) % sides
        out.append((Vector(lower[i]), Vector(lower[j]), Vector(upper[j]), Vector(upper[i])))
    return out


def lean_matrix(cx: float, cy: float, lean_deg: float) -> Matrix:
    """Places a prism at (cx, cy) tilting its top *away* from the tower's axis.

    "Nothing is plumb" (ART_DIRECTION §4). The lean is applied about the
    prism's own base so the foot stays planted on the ground — a tilt about
    the centre would bury one edge and float the other.
    """
    if abs(cx) < 1e-6 and abs(cy) < 1e-6 or abs(lean_deg) < 1e-6:
        return Matrix.Translation((cx, cy, 0.0))
    direction = Vector((cx, cy, 0.0)).normalized()
    axis = Vector((-direction.y, direction.x, 0.0))
    return Matrix.Translation((cx, cy, 0.0)) @ Matrix.Rotation(math.radians(lean_deg), 4, axis)


# name, sides, cx, cy, r_base, r_belly, r_shoulder, belly, body, tip, lean°, spin°,
#   windows (cols, pitch, z0, z1)
#
# Four prisms, four different side counts and four different leans: a cluster
# of identical shapes at identical angles is the placeholder look ART_DIRECTION
# §4 warns about. `tower-spire-c` sits front-**left** on purpose — it leaves the
# door, the porch and the signboard in clear view from the front right, which is
# where the park's isometric camera looks from.
TOWER_PRISMS = [
    ("tower-main", 6, 0.00, 0.55, 3.20, 3.45, 2.40, 2.9, 23.2, 4.80, 0.0, 0.0, (3, 0.72, 6.35, 21.6)),
    ("tower-spire-a", 6, -3.35, 1.10, 1.95, 2.35, 1.55, 1.8, 15.6, 4.40, 9.0, 12.0, (2, 0.68, 3.40, 14.9)),
    ("tower-spire-b", 5, 3.30, 1.75, 1.70, 2.05, 1.30, 1.4, 12.2, 3.90, 10.0, 24.0, None),
    ("tower-spire-c", 7, -3.75, -1.70, 1.35, 1.65, 1.05, 1.1, 9.20, 3.30, 8.0, 40.0, None),
]

DOOR_W = 2.20
DOOR_H = 2.60
DOOR_DEPTH = 0.55


def main_face_y(z: float) -> float:
    """Where the main prism's front (−Y) face plane sits at height `z`.

    The door, the porch and the signboard all attach to that face, and the
    belly makes it a *sloped* plane rather than a fixed number — so it is
    derived from `TOWER_PRISMS[0]` every time instead of being written down
    again. A hand-copied apothem is precisely the "two definitions of one
    thing, kept in step by hand" shape CLAUDE.md names as this repo's most
    common bug, and retuning the gem profile is exactly when it would bite:
    the porch would float off the wall and nothing would say so.

    The main prism is the one that does **not** lean, which is what makes this
    a function of z alone. Its three siblings carry the "nothing is plumb"
    rule for the whole cluster.
    """
    _, sides, _, cy, r_base, r_belly, r_shoulder, belly, body, _, lean, _, _ = TOWER_PRISMS[0]
    assert lean == 0.0, "main_face_y assumes the main prism is plumb"
    if z <= belly:
        r = r_base + (r_belly - r_base) * (z / belly)
    else:
        r = r_belly + (r_shoulder - r_belly) * ((z - belly) / (body - belly))
    return cy - r * math.cos(math.pi / sides)

# angle°, distance, sides, r, body, tip, lean°, spin°  — the base-ring cluster.
# Hand-placed, never random: the park must look identical on every reload, and
# the corridor in front of the door (250°–292°) is deliberately left clear so a
# child can walk straight in.
BASE_CRYSTALS = [
    (8.0, 4.55, 6, 0.62, 1.55, 0.75, 12.0, 10.0),
    (30.0, 5.45, 5, 0.40, 0.80, 0.44, 18.0, 40.0),
    (52.0, 4.20, 6, 0.72, 2.00, 0.92, 9.0, 25.0),
    (76.0, 5.60, 5, 0.34, 0.58, 0.32, 21.0, 5.0),
    (99.0, 4.80, 6, 0.54, 1.24, 0.60, 14.0, 33.0),
    (126.0, 4.35, 5, 0.66, 1.78, 0.84, 8.0, 47.0),
    (147.0, 5.35, 6, 0.36, 0.68, 0.36, 19.0, 22.0),
    (168.0, 4.60, 6, 0.58, 1.42, 0.68, 13.0, 8.0),
    (192.0, 5.55, 5, 0.42, 0.94, 0.48, 16.0, 36.0),
    (212.0, 4.25, 6, 0.70, 1.90, 0.88, 7.0, 15.0),
    (240.0, 4.75, 5, 0.50, 1.14, 0.56, 15.0, 28.0),
    (300.0, 4.85, 6, 0.56, 1.32, 0.64, 12.0, 12.0),
    (322.0, 5.60, 5, 0.38, 0.74, 0.38, 18.0, 38.0),
    (340.0, 4.30, 6, 0.68, 1.96, 0.90, 8.0, 20.0),
    # Two flanking the entrance. Placed by their Cartesian position rather than
    # picked off the ring: the clear corridor in front of the door is a box
    # (|x| < 2.2, y < −2.0), not an arc, and an angle that looks safely off to
    # one side at 5 m is standing squarely in the doorway at 3.5 m.
    (311.5, 3.47, 6, 0.62, 1.55, 0.75, 10.0, 15.0),
    (228.5, 3.47, 5, 0.55, 1.35, 0.65, 12.0, 32.0),
]


def build_tower(coll: bpy.types.Collection) -> float:
    windows = Part("tower-windows")
    reach = 0.0
    top = 0.0

    for name, sides, cx, cy, r_base, r_belly, r_shoulder, belly, body, tip, lean, spin_deg, win in (
        TOWER_PRISMS
    ):
        spin = math.radians(spin_deg)
        matrix = lean_matrix(cx, cy, lean)
        part = Part(name)
        part.add(*crystal(sides, r_base, r_belly, r_shoulder, belly, body, tip, spin), matrix=matrix)
        part.emit(coll, smooth=False)

        for v in part.verts:
            reach = max(reach, math.hypot(v[0], v[1]))
            top = max(top, v[2])

        if win is None:
            continue
        cols, pitch, z0, z1 = win
        rows = int((z1 - z0) / pitch)
        span = body - belly
        # Windows are laid out in the prism's own parametric face space and
        # then carried through the *same* matrix as the prism. There is no
        # second formula for where a leaning tower's face is.
        for p00, p10, p11, p01 in crystal_side_faces(sides, r_belly, r_shoulder, belly, body, spin):
            for row in range(rows):
                z_mid = z0 + (row + 0.5) * pitch
                v_half = 0.155 / span
                v_lo, v_hi = (z_mid - belly) / span - v_half, (z_mid - belly) / span + v_half
                for col in range(cols):
                    u_mid = (col + 0.5) / cols
                    u_half = 0.26 / cols
                    u_lo, u_hi = u_mid - u_half, u_mid + u_half
                    quad = []
                    for u, v in ((u_lo, v_lo), (u_hi, v_lo), (u_hi, v_hi), (u_lo, v_hi)):
                        bottom = p00.lerp(p10, u)
                        upper = p01.lerp(p11, u)
                        point = bottom.lerp(upper, v)
                        # Proud of the surface, per ART_DIRECTION §5: a marking
                        # that sits *in* the surface shows only where it happens
                        # to poke through, and the intersection reads as a rip.
                        out = Vector((point.x, point.y, 0.0))
                        if out.length > 1e-6:
                            point = point + out.normalized() * 0.03
                        quad.append(tuple(point))
                    windows.add(quad, [(0, 1, 2, 3)], matrix=matrix)

    windows.emit(coll, smooth=False, recalc=False, weld=False)

    # ---- doorway: a recess in the main prism's −Y face (the game's +Z) -------
    #
    face_y = main_face_y(DOOR_H * 0.5)
    half_w, band = DOOR_W * 0.5, 0.36

    jamb = Part("tower-door-jamb")
    inner = [(half_w, 0.0), (half_w, DOOR_H), (-half_w, DOOR_H), (-half_w, 0.0)]
    outer = [
        (half_w + band, 0.0),
        (half_w + band, DOOR_H + band),
        (-half_w - band, DOOR_H + band),
        (-half_w - band, 0.0),
    ]
    # The surround stands 0.14 proud and the reveal runs 0.55 back into the face.
    jamb.add(*ring_outline(inner, outer, DOOR_DEPTH + 0.14), matrix=Matrix.Translation(
        (0.0, face_y + DOOR_DEPTH * 0.5 - 0.07, 0.0)
    ))
    jamb.emit(coll)

    glow = Part("tower-door-glow")
    back = face_y + DOOR_DEPTH
    glow.add(
        [
            (half_w, back, 0.02),
            (-half_w, back, 0.02),
            (-half_w, back, DOOR_H),
            (half_w, back, DOOR_H),
        ],
        [(0, 1, 2, 3)],
    )
    glow.emit(coll, smooth=False, recalc=False, weld=False)

    # ---- porch: one crystal shard cantilevered over the door ----------------
    #
    # Take three. Both earlier attempts were a plate held up on two posts, and
    # both rendered as a garden table standing in front of the entrance —
    # scaling it up only made a bigger table. **The posts were the problem, not
    # the size:** four legs under a flat top is furniture, whatever it is made
    # of. So the awning is now a single faceted shard growing out of the wall
    # over the doorway, wide, thick, and tipped down at its point. It is the
    # same shape language as the prisms it hangs off, and there is nothing left
    # in it that a chair also has.
    #
    # `crystal` grows along +Z, so a +100° turn about X lays it on its side
    # pointing −Y (the game's +Z) and tips its point ten degrees down.
    porch = Part("tower-porch")
    porch.add(
        *crystal(6, 0.98, 1.06, 0.72, 0.16, 1.05, 0.80, math.radians(30.0)),
        matrix=Matrix.Translation((0.0, main_face_y(3.55) + 0.20, 3.55))
        @ Matrix.Rotation(math.radians(100.0), 4, "X")
        @ Matrix.Scale(2.05, 4, (1.0, 0.0, 0.0))
        @ Matrix.Scale(0.46, 4, (0.0, 1.0, 0.0)),
    )
    porch.emit(coll, smooth=False)

    # ---- signboard: flat, UV-mapped, painted by code ------------------------
    sign = Part("tower-signboard")
    sw, sh, sd = 3.90, 1.22, 0.18
    board_y = main_face_y(5.30) - 0.03
    sign_verts = [
        (-sw / 2, board_y - sd, -sh / 2),
        (sw / 2, board_y - sd, -sh / 2),
        (sw / 2, board_y - sd, sh / 2),
        (-sw / 2, board_y - sd, sh / 2),
        (-sw / 2, board_y, -sh / 2),
        (sw / 2, board_y, -sh / 2),
        (sw / 2, board_y, sh / 2),
        (-sw / 2, board_y, sh / 2),
    ]
    sign_faces = [
        (0, 1, 2, 3),  # front (−Y, the game's +Z) — carries the words
        (5, 4, 7, 6),
        (4, 5, 1, 0),
        (3, 2, 6, 7),
        (4, 0, 3, 7),
        (1, 5, 6, 2),
    ]
    edge = (0.03, 0.03)
    sign_uvs = [
        [(0.0, 0.0), (1.0, 0.0), (1.0, 1.0), (0.0, 1.0)],
    ] + [[edge] * 4 for _ in range(5)]
    sign.add(sign_verts, sign_faces, matrix=Matrix.Translation((0.0, 0.0, 5.30)), uvs=sign_uvs)
    sign.emit(coll, smooth=False, recalc=False)

    # ---- the crystal cluster round the base ---------------------------------
    crystals = Part("tower-crystals")
    for angle_deg, dist, sides, r, body, tip, lean, spin_deg in BASE_CRYSTALS:
        angle = math.radians(angle_deg)
        cx, cy = dist * math.cos(angle), dist * math.sin(angle)
        crystals.add(
            *gem(sides, r, body, tip, math.radians(spin_deg)),
            matrix=lean_matrix(cx, cy, lean),
        )
        reach = max(reach, dist + r)
    crystals.emit(coll, smooth=False)

    assert reach <= FOOTPRINT_RADIUS, f"tower is {reach * 2:.2f} m across, over the 16 m plot"
    return top


# =============================================================================
# 2. BED — the mattress top is a standing surface, so it is genuinely flat
# =============================================================================

MATTRESS_TOP = 0.55
"""Children stand and bounce on this. `hotelAssets.ts` re-measures it, and the
game hangs a static platform at exactly this height."""


def build_bed(coll: bpy.types.Collection) -> float:
    frame = Part("bed-frame")
    frame.add(*rounded_box(1.46, 2.10, 0.30, 0.075), matrix=Matrix.Translation((0.0, 0.0, 0.26)))
    for sx in (-1, 1):
        for sy in (-1, 1):
            frame.add(
                *rounded_box(0.22, 0.22, 0.16, 0.05, segments=1),
                matrix=Matrix.Translation((sx * 0.58, sy * 0.90, 0.08)),
            )
    frame.emit(coll)

    mattress = Part("bed-mattress")
    mattress.add(
        *flat_top_box(1.40, 2.00, 0.21, 0.06),
        matrix=Matrix.Translation((0.0, 0.0, MATTRESS_TOP - 0.105)),
    )
    mattress.emit(coll)

    pillow = Part("bed-pillow")
    pillow.add(
        *rounded_box(1.00, 0.42, 0.19, 0.088),
        matrix=Matrix.Translation((0.0, 0.72, MATTRESS_TOP + 0.075)),
    )
    pillow.emit(coll)

    blanket = Part("bed-blanket")
    blanket.add(
        *rounded_box(1.50, 0.80, 0.11, 0.045, segments=1),
        matrix=Matrix.Translation((0.0, -0.56, MATTRESS_TOP + 0.035)),
    )
    # The turned-over fold: one chunky roll across the bed, so the band reads as
    # cloth rather than as a slab painted on the mattress.
    roll_verts, roll_faces = tube(0.082, 1.50, sides=10)
    blanket.add(
        roll_verts,
        roll_faces,
        matrix=Matrix.Translation((-0.75, -0.16, MATTRESS_TOP + 0.055))
        @ Matrix.Rotation(math.radians(90.0), 4, "Y"),
    )
    blanket.emit(coll)

    return MATTRESS_TOP + 0.075 + 0.095


# =============================================================================
# 3. DISCO BALL — origin at the hang point, everything below it
# =============================================================================


def build_disco(coll: bpy.types.Collection) -> float:
    rod = Part("disco-rod")
    rod.add(*tube(0.048, 0.34, sides=10, z0=-0.34))
    rod.add(*tube(0.10, 0.05, sides=10, z0=-0.05))
    rod.emit(coll)

    ball = Part("disco-ball")
    ball.add(*icosphere(0.45, 2), matrix=Matrix.Translation((0.0, 0.0, -0.79)))
    ball.emit(coll, smooth=False)
    return 1.24


# =============================================================================
# 4. BREAKFAST SET — table, one chair, and three bowls that read from above
# =============================================================================

TABLE_TOP = 0.74
SEAT_TOP = 0.42


def bowl_profile(rim_r: float = 0.125, rim_z: float = 0.115):
    """A chunky open bowl: thick wall, small foot, nothing thin enough to vanish."""
    return [
        (0.0, 0.0),
        (0.072, 0.006),
        (rim_r * 0.94, 0.048),
        (rim_r, rim_z),
        (rim_r - 0.026, rim_z),
        (rim_r * 0.80, 0.052),
        (0.0, 0.030),
    ]


def build_breakfast(coll: bpy.types.Collection) -> dict[str, float]:
    # A round top with a rounded rim and a genuinely flat surface, lathed in
    # one piece. Built first as a flat-top box inside a disc, which was wrong:
    # a 1.2 m square's corners stand 0.25 m outside a 1.2 m circle, so the
    # "round" table had four spikes.
    top = Part("table-top")
    top.add(
        *revolve(
            [
                (0.0, TABLE_TOP - 0.105),
                (0.560, TABLE_TOP - 0.105),
                (0.600, TABLE_TOP - 0.072),
                (0.600, TABLE_TOP - 0.030),
                (0.572, TABLE_TOP),
                (0.0, TABLE_TOP),
            ],
            22,
        )
    )
    top.emit(coll)

    leg = Part("table-leg")
    leg.add(*tube(0.115, 0.62, sides=14))
    leg.add(*revolve([(0.0, 0.0), (0.30, 0.0), (0.34, 0.05), (0.30, 0.13), (0.0, 0.13)], 18))
    leg.add(*tube(0.22, 0.07, sides=14, z0=0.58))
    leg.emit(coll)

    chair = Part("chair")
    chair.add(*flat_top_box(0.46, 0.46, 0.11, 0.05), matrix=Matrix.Translation((0.0, 0.0, SEAT_TOP - 0.055)))
    for sx in (-1, 1):
        for sy in (-1, 1):
            chair.add(
                *rounded_box(0.085, 0.085, 0.34, 0.03, segments=1),
                matrix=Matrix.Translation((sx * 0.16, sy * 0.16, 0.17)),
            )
    chair.add(
        *rounded_box(0.44, 0.10, 0.44, 0.045, segments=1),
        matrix=Matrix.Translation((0.0, 0.20, SEAT_TOP + 0.21))
        @ Matrix.Rotation(math.radians(-7.0), 4, "X"),
    )
    chair.emit(coll)

    for name in ("food-cheerios-bowl", "food-shreddies-bowl", "food-yoghurt-bowl"):
        bowl = Part(name)
        bowl.add(*revolve(bowl_profile(), 20))
        bowl.emit(coll)

    # --- heart cheerios -------------------------------------------------------
    cheerios = Part("food-cheerios")
    hearts = [
        (0.0, -0.006, 0.086, 0.0, 12.0),
        (-0.046, 0.030, 0.084, 24.0, -8.0),
        (0.048, 0.022, 0.084, -35.0, 10.0),
        (-0.034, -0.040, 0.104, -18.0, 20.0),
        (0.042, -0.030, 0.106, 47.0, -22.0),
    ]
    for x, y, z, yaw, tilt in hearts:
        cheerios.add(
            *sweep_path(heart_path(0.080, samples=12), 0.0125, sides=5),
            matrix=Matrix.Translation((x, y, z))
            @ Matrix.Rotation(math.radians(yaw), 4, "Z")
            @ Matrix.Rotation(math.radians(tilt), 4, "X")
            @ Matrix.Rotation(math.radians(90.0), 4, "X"),
        )
    # A five-sided tube shaded smooth reads as a round ring at 7 cm across, and
    # costs a fifth of the vertices a faceted one would.
    cheerios.emit(coll, sharp_deg=80.0)

    # --- square shreddies -----------------------------------------------------
    shreddies = Part("food-shreddies")
    squares = [
        (0.000, 0.000, 0.082, 8.0, 6.0),
        (-0.048, 0.020, 0.080, 34.0, -12.0),
        (0.046, 0.026, 0.080, -22.0, 9.0),
        (0.018, -0.050, 0.081, 57.0, 14.0),
        (-0.044, -0.036, 0.082, -41.0, -7.0),
        (-0.012, 0.052, 0.080, 12.0, 18.0),
        (-0.026, -0.006, 0.110, 26.0, 11.0),
        (0.026, 0.030, 0.111, -55.0, -9.0),
        (0.008, -0.032, 0.112, 40.0, 15.0),
    ]
    for x, y, z, yaw, tilt in squares:
        shreddies.add(
            *rounded_box(0.048, 0.048, 0.017, 0.006, segments=1),
            matrix=Matrix.Translation((x, y, z))
            @ Matrix.Rotation(math.radians(yaw), 4, "Z")
            @ Matrix.Rotation(math.radians(tilt), 4, "Y"),
        )
    shreddies.emit(coll)

    # --- yoghurt and its honey swirl -----------------------------------------
    yoghurt = Part("food-yoghurt")
    yoghurt.add(
        *revolve(
            [
                (0.0, 0.052),
                (0.058, 0.060),
                (0.093, 0.078),
                (0.100, 0.098),
                (0.086, 0.098),
                (0.040, 0.094),
                (0.0, 0.090),
            ],
            16,
        )
    )
    yoghurt.emit(coll)

    honey = Part("food-yoghurt-honey")
    spiral = []
    turns, samples = 2.4, 26
    for i in range(samples):
        t = i / (samples - 1)
        angle = t * turns * TAU
        r = 0.010 + t * 0.062
        spiral.append((r * math.cos(angle), r * math.sin(angle), 0.101 + 0.005 * math.sin(angle * 2)))
    honey.add(*sweep_path(spiral, 0.0115, sides=5, closed=False))
    honey.emit(coll, sharp_deg=80.0)

    return {"table": TABLE_TOP, "chair": SEAT_TOP + 0.44 + 0.02, "bowl": 0.125}


# =============================================================================
# 5. RECEPTION DESK — a gently bowed crystal counter at kiosk height
# =============================================================================

COUNTER_TOP = 1.02
"""Matches the shop kiosks' counters. One height for every counter in the park."""

DESK_ARC_R = 3.40
DESK_HALF_W = 1.30


def desk_arc(samples: int):
    """Points along the counter's bow, front-facing normal included.

    The arc bulges toward −Y (the game's +Z), so the customer stands in the
    hollow of it and the receptionist behind.
    """
    out = []
    phi0 = math.asin(DESK_HALF_W / DESK_ARC_R)
    for i in range(samples):
        phi = -phi0 + (2 * phi0) * i / (samples - 1)
        point = Vector((DESK_ARC_R * math.sin(phi), DESK_ARC_R * (1.0 - math.cos(phi)), 0.0))
        # Radially outward from the centre of curvature at (0, DESK_ARC_R).
        # Written `(−sin φ, −cos φ)` first, which is right at φ = 0 and wrong
        # everywhere else: the sign error flared the counter's *back* edge out
        # to 3.08 m while its front lip was only 2.53 m, so the desk splayed
        # away from the receptionist instead of wrapping round them. It looked
        # plausible in a render and only showed up in the measured bounds.
        normal = Vector((math.sin(phi), -math.cos(phi), 0.0))
        out.append((point, normal))
    return out


def build_desk(coll: bpy.types.Collection) -> float:
    counter = Part("desk-counter")
    arc = desk_arc(9)
    # (distance forward of the arc line, height) — a bulged front lip and a
    # genuinely flat top from the lip back to the receptionist's edge.
    profile = [
        (0.02, 0.90),
        (0.09, 0.945),
        (0.075, COUNTER_TOP - 0.012),
        (0.02, COUNTER_TOP),
        (-0.62, COUNTER_TOP),
        (-0.62, 0.90),
    ]
    rings = []
    for point, normal in arc:
        rings.append([tuple(point + normal * d + Vector((0.0, 0.0, z))) for d, z in profile])
    count = len(profile)
    verts = [v for r in rings for v in r]
    faces = []
    for i in range(len(rings) - 1):
        for p in range(count):
            q = (p + 1) % count
            faces.append((i * count + p, i * count + q, (i + 1) * count + q, (i + 1) * count + p))
    faces.append(tuple(range(count - 1, -1, -1)))
    faces.append(tuple(range((len(rings) - 1) * count, len(rings) * count)))
    counter.add(verts, faces)
    counter.emit(coll)

    # --- faceted front panel --------------------------------------------------
    front = Part("desk-front")
    arc = desk_arc(9)
    rings = []
    for index, (point, normal) in enumerate(arc):
        # Alternating stand-off is the whole trick: nine samples of a shallow
        # arc read as a smooth curve, nine samples pushed in and out by 4 cm
        # read as cut crystal.
        push = 0.045 if index % 2 == 0 else -0.02
        outer = point + normal * push
        inner = point - normal * 0.58
        rings.append(
            [
                (outer.x, outer.y, 0.0),
                (outer.x, outer.y, 0.94),
                (inner.x, inner.y, 0.94),
                (inner.x, inner.y, 0.0),
            ]
        )
    verts = [v for r in rings for v in r]
    faces = []
    for i in range(len(rings) - 1):
        for p in range(4):
            q = (p + 1) % 4
            faces.append((i * 4 + p, i * 4 + q, (i + 1) * 4 + q, (i + 1) * 4 + p))
    faces.append((3, 2, 1, 0))
    last = (len(rings) - 1) * 4
    faces.append((last, last + 1, last + 2, last + 3))
    front.add(verts, faces)
    front.emit(coll, smooth=False)

    # --- the key board, standing behind ---------------------------------------
    board = Part("desk-key-board")
    board_y = 1.02
    board.add(
        *rounded_box(1.34, 0.11, 0.74, 0.055),
        matrix=Matrix.Translation((0.0, board_y, 1.36)),
    )
    for sx in (-1, 1):
        board.add(
            *rounded_box(0.13, 0.13, 1.06, 0.04),
            matrix=Matrix.Translation((sx * 0.56, board_y, 0.53)),
        )
    for z in (1.20, 1.52):
        for col in range(4):
            peg_v, peg_f = tube(0.036, 0.13, sides=6)
            board.add(
                peg_v,
                peg_f,
                matrix=Matrix.Translation(((col - 1.5) * 0.30, board_y - 0.055, z))
                @ Matrix.Rotation(math.radians(-90.0), 4, "X"),
            )
    board.emit(coll)

    # The keys themselves. Their own node because they are the one gold thing
    # on a cream board, and because a board of bare pegs did not read as a key
    # board at all in the first review render — it read as a noticeboard.
    keys = Part("desk-keys")
    hanging = [(-1.5, 1.20, -9.0), (-0.5, 1.20, 6.0), (1.5, 1.20, -4.0), (-0.5, 1.52, 8.0), (0.5, 1.52, -7.0)]
    for col, z, tilt in hanging:
        swing = Matrix.Translation((col * 0.30, board_y - 0.10, z)) @ Matrix.Rotation(
            math.radians(tilt), 4, "Y"
        )
        keys.add(*rounded_box(0.085, 0.026, 0.16, 0.028), matrix=swing @ Matrix.Translation((0.0, 0.0, -0.10)))
        keys.add(
            *tube(0.030, 0.026, sides=8),
            matrix=swing @ Matrix.Translation((0.0, -0.013, -0.02)) @ Matrix.Rotation(math.radians(90.0), 4, "X"),
        )
    keys.emit(coll)
    return 1.73


# =============================================================================
# 6. YOURS DOOR — the suite door, with a plaque code paints "yours" onto
# =============================================================================

LEAF_HALF_W = 0.53
LEAF_STRAIGHT = 1.75
FRAME_HALF_W = 0.55


def build_door(coll: bpy.types.Collection) -> float:
    frame = Part("door-frame")
    inner = arch_outline(FRAME_HALF_W, LEAF_STRAIGHT, samples=14)
    outer = offset_arch(FRAME_HALF_W, LEAF_STRAIGHT, 0.16, samples=14)
    frame.add(*ring_outline(inner, outer, 0.24))
    frame.emit(coll)

    leaf = Part("door-leaf")
    outline = arch_outline(LEAF_HALF_W, LEAF_STRAIGHT - 0.02, samples=14, floor=0.015)
    leaf.add(
        *extrude_outline(outline, 0.09, centre=(0.0, 1.10)),
        matrix=Matrix.Translation((0.0, 0.02, 0.0)),
    )
    leaf.emit(coll)

    knob = Part("door-knob")
    knob.add(*icosphere(0.076, 2), matrix=Matrix.Translation((0.355, -0.062, 1.14)))
    knob.add(
        *tube(0.030, 0.05, sides=10),
        matrix=Matrix.Translation((0.355, -0.02, 1.14)) @ Matrix.Rotation(math.radians(90.0), 4, "X"),
    )
    knob.emit(coll)

    # A rounded panel, not a rectangle: §1 says no sharp edges, and this is the
    # one part of the door a child is meant to walk up close and read.
    plaque = Part("door-plaque")
    pw, ph = 0.66, 0.36
    pv, pf = extrude_outline(rounded_rect(pw, ph, 0.085), 0.06)
    plaque.add(pv, pf, matrix=Matrix.Translation((0.0, -0.065, 1.52)), uvs=uv_from_xz(pv, pf, pw, ph))
    plaque.emit(coll, recalc=False)

    star = Part("door-star")
    star.add(
        *extrude_outline(star_outline(5, 0.30, 0.130), 0.12),
        matrix=Matrix.Translation((0.0, -0.02, 2.70)),
    )
    star.emit(coll, smooth=False)
    return 2.70 + 0.30


# =============================================================================


def summarise() -> str:
    rows = []
    total = 0
    for obj in sorted(bpy.data.objects, key=lambda o: o.name):
        mesh = obj.data
        mesh.calc_loop_triangles()
        total += len(mesh.loop_triangles)
        rows.append(f"  {obj.name:<22} {len(mesh.vertices):>6} verts {len(mesh.loop_triangles):>6} tris")
    rows.append(f"  {'TOTAL':<22} {'':>6}       {total:>6} tris")
    return "\n".join(rows)


def main() -> None:
    reset_scene()
    heights = {}
    heights["tower"] = build_tower(collection("hotel-tower"))
    heights["bed"] = build_bed(collection("hotel-bed"))
    heights["disco"] = build_disco(collection("hotel-disco"))
    heights.update(build_breakfast(collection("hotel-breakfast")))
    heights["desk"] = build_desk(collection("hotel-desk"))
    heights["door"] = build_door(collection("hotel-door"))

    print("\nhotel_build")
    print(summarise())
    print("  intended heights (m):", {k: round(v, 3) for k, v in heights.items()})

    bpy.ops.wm.save_as_mainfile(filepath=BLEND)
    print("  saved", BLEND, f"({os.path.getsize(BLEND)} bytes)\n")


if __name__ == "__main__":
    main()
