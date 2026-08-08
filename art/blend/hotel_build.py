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


def box(sx: float, sy: float, sz: float):
    """A plain cube — **eight** vertices, where :func:`rounded_box` costs 24.

    ART_DIRECTION §1's "no sharp edges" is about shapes a child looks at. A
    2 cm tick mark on a dial, a 4 cm biscuit in a pet bowl and a raised panel
    on a lift wall are not those, and a bevel on them is a corner nobody can
    see paid for in shipped bytes. Swapping this in for the nine smallest parts
    of the second batch, together with a few coarser revolutions, took 1532
    triangles and 12.7 KB off the `.glb` (407,320 → 394,580 bytes, measured).
    Anything a silhouette depends on still gets a real bevel.

    Worth knowing before optimising further: this asset costs a steady **~36
    bytes per triangle** whatever it is made of, because almost every edge in
    it is over the 46° split-normal threshold and a split normal is a whole
    duplicated vertex. Shaving triangles is therefore linear and slow going;
    the only step change available is not drawing something at all.
    """
    hx, hy, hz = sx * 0.5, sy * 0.5, sz * 0.5
    verts = [
        (-hx, -hy, -hz),
        (hx, -hy, -hz),
        (hx, hy, -hz),
        (-hx, hy, -hz),
        (-hx, -hy, hz),
        (hx, -hy, hz),
        (hx, hy, hz),
        (-hx, hy, hz),
    ]
    faces = [(0, 1, 2, 3), (7, 6, 5, 4), (0, 4, 5, 1), (1, 5, 6, 2), (2, 6, 7, 3), (3, 7, 4, 0)]
    return verts, faces


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


def revolve_profiles(profiles):
    """:func:`revolve` with a **different** closed (r, z) cross-section per step.

    The canopy's scalloped pelmet needs its bottom edge to rise and fall around
    the ring while its top stays level, which a single profile cannot say. Every
    profile must have the same number of points; the angle for step *s* is
    ``s * TAU / len(profiles)``, exactly as in :func:`revolve`.
    """
    segments = len(profiles)
    count = len(profiles[0])
    verts = []
    for s, profile in enumerate(profiles):
        angle = s * TAU / segments
        cos_a, sin_a = math.cos(angle), math.sin(angle)
        for r, z in profile:
            verts.append((r * cos_a, r * sin_a, z))
    faces = []
    for s in range(segments):
        s_next = (s + 1) % segments
        for p in range(count):
            p_next = (p + 1) % count
            faces.append(
                (s * count + p, s * count + p_next, s_next * count + p_next, s_next * count + p)
            )
    return verts, faces


def loft(rings, centre=(0.0, 0.0)):
    """Skins a stack of equal-length **XY** outlines at given heights, capped.

    The vertical counterpart of :func:`extrude_outline` (which works in XZ and
    extrudes along Y). Two rings make a plain prism; four make one with a
    chamfer top and bottom, which is how every sliding door leaf here loses its
    razor edges without paying for a bevel modifier.
    """
    count = len(rings[0][0])
    verts = []
    for outline, z in rings:
        verts.extend((x, y, z) for x, y in outline)
    bottom_c = len(verts)
    verts.append((centre[0], centre[1], rings[0][1]))
    top_c = len(verts)
    verts.append((centre[0], centre[1], rings[-1][1]))
    faces = []
    for r in range(len(rings) - 1):
        for i in range(count):
            j = (i + 1) % count
            faces.append((r * count + i, r * count + j, (r + 1) * count + j, (r + 1) * count + i))
    last = (len(rings) - 1) * count
    for i in range(count):
        j = (i + 1) % count
        faces.append((bottom_c, j, i))
        faces.append((top_c, last + i, last + j))
    return verts, faces


def sweep_rings(rings, cap_start: bool = True, cap_end: bool = True):
    """Skins an **open** run of equal-length rings of arbitrary 3-D points.

    :func:`loft` is the same idea for a stack of level XY outlines and
    :func:`revolve_profiles` for a closed ring of them; this is the version for
    a path that starts somewhere and ends somewhere else, with each ring already
    positioned in space by the caller. The staircase is built entirely out of
    it — flight, strings, handrail and coping are four sweeps of four different
    cross-sections along one arc.

    Both ends are capped by default, because an uncapped sweep is a solid with
    a hole in it: `Part.emit`'s `recalc_face_normals` cannot orient what is not
    closed, and the inverted-hull outline the game draws round it would break
    open along the same seam.
    """
    count = len(rings[0])
    verts = [v for ring_ in rings for v in ring_]
    faces = []
    for i in range(len(rings) - 1):
        for p in range(count):
            q = (p + 1) % count
            faces.append((i * count + p, i * count + q, (i + 1) * count + q, (i + 1) * count + p))
    if cap_start:
        faces.append(tuple(range(count - 1, -1, -1)))
    if cap_end:
        base = (len(rings) - 1) * count
        faces.append(tuple(range(base, base + count)))
    return verts, faces


def lozenge(width: float, height: float, shoulder: float = 0.14):
    """An elongated hexagon in the XZ plane — the crystal panel on a door leaf."""
    hw, hh = width * 0.5, height * 0.5
    return [
        (hw, -hh + shoulder),
        (hw, hh - shoulder),
        (0.0, hh),
        (-hw, hh - shoulder),
        (-hw, -hh + shoulder),
        (0.0, -hh),
    ]


def uv_from_xy(verts, faces, width: float, depth: float):
    """:func:`uv_from_xz` for a panel that lies **flat** — the Game Boy's screen.

    Same rule and the same reason: the UV is read off the very vertices the
    shape is made of, so it cannot drift from them.
    """
    return [
        [(v[0] / width + 0.5, v[1] / depth + 0.5) for v in (verts[i] for i in face)]
        for face in faces
    ]


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
# 7. PET BED — Eleri's brief, verbatim: "half-human half-cat bed, in a circular
#    shape with four poster type design. With a pillow and a blanket and even a
#    toy for them to play with."
# =============================================================================

PET_BED_CUSHION_TOP = 0.30
"""The flat cushion disc a pet is posed lying on. `hotelAssets.ts` exports it."""

PET_BED_CUSHION_RADIUS = 0.42
"""Radius of the **clear** part of that disc: 0.84 m across, nothing standing in it.

The brief asked for at least 0.5 m and this is deliberately much more. Every
pet in this park renders at `PET_RENDER_HEIGHT` = 1.46 m standing
(`src/art/models/pets.ts`), and a bunny that tall curled up is a good deal more
than half a metre long — a bed sized to the number in the brief would have read
as a saucer with a rabbit spilling over it. Hence a 1.34 m bed rather than the
1.1 m first sketched, and hence the pillow rests **on the bolster rim** rather
than on the cushion: that keeps the whole disc clear for whoever poses the pet,
instead of leaving them a crescent to fit a creature into.
"""

PET_BED_BOLSTER_R = 0.545
"""Ring radius of the padded rim. The four posts stand on it, at 45° intervals."""


def build_pet_bed(coll: bpy.types.Collection) -> float:
    # ---- the tub -------------------------------------------------------------
    base = Part("petbed-base")
    base.add(
        *revolve(
            [
                (0.0, 0.24),
                (0.46, 0.24),
                (0.52, 0.27),
                (0.58, 0.22),
                (0.60, 0.14),
                (0.58, 0.03),
                (0.50, 0.0),
                (0.0, 0.0),
            ],
            18,
        )
    )
    base.emit(coll)

    # ---- the cushion pad, its own node and its own colour --------------------
    #
    # Split out of the tub after the first review render, where a lilac pad in
    # a lilac tub 17 cm below the rim read as a **hole in the bed** rather than
    # as something soft to lie on. A cream pad against the lilac says "this is
    # the bit you get into" from across the room, which is the whole job of the
    # only surface in this asset a pet is ever posed on.
    cushion = Part("petbed-cushion")
    cushion.add(
        *revolve(
            [
                (0.0, PET_BED_CUSHION_TOP),
                (PET_BED_CUSHION_RADIUS, PET_BED_CUSHION_TOP),
                (0.48, 0.26),
                (0.46, 0.21),
                (0.0, 0.21),
            ],
            18,
        )
    )
    cushion.emit(coll)

    # ---- the bolster: a squashed torus, wider than it is tall ----------------
    bolster = Part("petbed-bolster")
    rx, rz, cz = 0.125, 0.115, 0.355
    bolster.add(
        *revolve(
            [
                (PET_BED_BOLSTER_R + rx * math.cos(i * TAU / 6), cz + rz * math.sin(i * TAU / 6))
                for i in range(6)
            ],
            18,
        )
    )
    bolster.emit(coll)

    # ---- four posts, and this is where the "half-human" half comes in --------
    posts = Part("petbed-posts")
    for i in range(4):
        angle = math.radians(45.0 + i * 90.0)
        px, py = PET_BED_BOLSTER_R * math.cos(angle), PET_BED_BOLSTER_R * math.sin(angle)
        posts.add(*tube(0.055, 0.78, sides=8, z0=0.20), matrix=Matrix.Translation((px, py, 0.0)))
    # Four small finials, back on the post tops now the crown is open: the
    # single apex ball belongs to the canopy's own boss, which is where the
    # ribs actually meet.
    for i in range(4):
        angle = math.radians(45.0 + i * 90.0)
        posts.add(
            *icosphere(0.062, 1),
            matrix=Matrix.Translation(
                (PET_BED_BOLSTER_R * math.cos(angle), PET_BED_BOLSTER_R * math.sin(angle), 1.00)
            )
            @ Matrix.Scale(0.76, 4, (0.0, 0.0, 1.0)),
        )
    posts.emit(coll)

    # ---- canopy: a ring, a scalloped pelmet, and an OPEN crown of ribs -------
    #
    # **Take three, and the third one is a gameplay constraint rather than a
    # taste one.** Take one was the ring and pelmet alone: a blue hula hoop on
    # four sticks, nothing overhead, nothing that says *canopy*. Take two put a
    # solid conical roof on it, which read as a canopy immediately — and hid the
    # entire inside of the bed. The park's camera looks **down** at 38°
    # (ART_DIRECTION §4), and the one thing this asset exists to show off is a
    # pet lying in it, so a lid over it is the one shape it may not have,
    # however well it reads on its own.
    #
    # So: four slender ribs arcing from the ring to a boss, like a crown or a
    # bandstand frame. It is unmistakably a four-poster canopy from the side and
    # it is **open sky** from above, which is where the player is.
    #
    # The pelmet is a **solid band**, not a one-sided skirt. A single sheet of
    # quads would have been half the vertices and invisible from inside the bed
    # — `MeshToonMaterial` is `FrontSide`, which is exactly how the hood faces
    # went missing for a fortnight (CLAUDE.md). Anything a camera can get behind
    # gets two skins here.
    canopy = Part("petbed-canopy")
    canopy.add(
        *revolve(
            [
                (PET_BED_BOLSTER_R + 0.05 * math.cos(i * TAU / 6), 0.95 + 0.05 * math.sin(i * TAU / 6))
                for i in range(6)
            ],
            14,
        )
    )
    for i in range(4):
        angle = math.radians(45.0 + i * 90.0)
        rib = []
        for step in range(8):
            t = step / 7.0
            r = PET_BED_BOLSTER_R * (1.0 - t)
            rib.append(
                (r * math.cos(angle), r * math.sin(angle), 0.95 + 0.26 * math.sin(t * math.pi * 0.5))
            )
        canopy.add(*sweep_path(rib, 0.030, sides=5, closed=False))
    canopy.add(
        *icosphere(0.070, 1),
        matrix=Matrix.Translation((0.0, 0.0, 1.20)) @ Matrix.Scale(0.72, 4, (0.0, 0.0, 1.0)),
    )
    pelmet = []
    for s in range(20):
        angle = s * TAU / 20
        z_bot = 0.795 + 0.062 * math.cos(6.0 * angle)
        pelmet.append([(0.512, 0.935), (0.578, 0.935), (0.578, z_bot), (0.512, z_bot)])
    canopy.add(*revolve_profiles(pelmet))
    canopy.emit(coll, sharp_deg=80.0)

    # ---- pillow, propped against the back of the rim -------------------------
    # Bigger and leaned back further than the first pass, where it sat almost
    # flat behind the bolster and the render showed a grey sliver.
    pillow = Part("petbed-pillow")
    pillow.add(
        *rounded_box(0.54, 0.26, 0.17, 0.065, segments=1),
        matrix=Matrix.Translation((0.0, 0.36, 0.53)) @ Matrix.Rotation(math.radians(-34.0), 4, "X"),
    )
    pillow.emit(coll)

    # ---- blanket, folded over the right-hand rim between two posts -----------
    #
    # Take two as well. The first was a big slab cantilevered out sideways with
    # a roll along it, and it read as a **lever** sticking out of the bed — the
    # give-away being that it did not touch the bolster it was supposed to be
    # lying on anywhere along its length. Now it is two short panels that
    # follow the rim over and down its outside, which is what a throw does.
    blanket = Part("petbed-blanket")
    blanket.add(
        *rounded_box(0.23, 0.35, 0.055, 0.022, segments=1),
        matrix=Matrix.Translation((0.545, -0.02, 0.495)),
    )
    blanket.add(
        *rounded_box(0.21, 0.32, 0.050, 0.020, segments=1),
        matrix=Matrix.Translation((0.553, 0.01, 0.545)) @ Matrix.Rotation(math.radians(7.0), 4, "Z"),
    )
    blanket.emit(coll)

    # ---- the toy: a plush goldfish, on the floor beside the bed --------------
    #
    # A ball was the other option in the brief and a fish is the better one for
    # a bed that is half cat: a sphere beside a round bed reads as a second,
    # smaller bed, and the fish's tail is the one silhouette in this asset that
    # is not a circle.
    fish = (
        Matrix.Translation((0.70, -0.46, 0.095))
        @ Matrix.Rotation(math.radians(28.0), 4, "Z")
        @ Matrix.Rotation(math.radians(-8.0), 4, "Y")
    )
    toy = Part("petbed-toy")
    toy.add(
        *icosphere(0.115, 1),
        matrix=fish
        @ Matrix.Scale(1.25, 4, (1.0, 0.0, 0.0))
        @ Matrix.Scale(0.60, 4, (0.0, 1.0, 0.0))
        @ Matrix.Scale(0.80, 4, (0.0, 0.0, 1.0)),
    )
    toy.add(
        *extrude_outline([(0.0, 0.0), (-0.14, 0.10), (-0.14, -0.055)], 0.05, centre=(-0.085, 0.015)),
        matrix=fish @ Matrix.Translation((-0.115, 0.0, 0.0)),
    )
    toy.add(
        *extrude_outline([(0.05, 0.0), (-0.06, 0.0), (-0.02, 0.085)], 0.04, centre=(-0.01, 0.02)),
        matrix=fish @ Matrix.Translation((0.0, 0.0, 0.070)),
    )
    toy.emit(coll)

    eye = Part("petbed-toy-eye")
    for side in (-1, 1):
        eye.add(
            *icosphere(0.024, 1),
            matrix=fish @ Matrix.Translation((0.085, side * 0.056, 0.036)),
        )
    eye.emit(coll)

    return 1.24


# =============================================================================
# 8. PET BOWL — so the pet can eat breakfast too
# =============================================================================


def build_pet_bowl(coll: bpy.types.Collection) -> float:
    bowl = Part("petbowl-bowl")
    bowl.add(
        *revolve(
            [
                (0.0, 0.0),
                (0.090, 0.004),
                (0.125, 0.030),
                (0.130, 0.072),
                (0.108, 0.076),
                (0.100, 0.036),
                (0.0, 0.024),
            ],
            16,
        )
    )
    bowl.emit(coll)

    # Nine chunks, hand-placed like every other "scatter" in this file.
    food = Part("petbowl-food")
    for x, y, z, yaw in (
        (0.000, 0.000, 0.038, 10.0),
        (-0.042, 0.016, 0.036, 38.0),
        (0.040, 0.020, 0.036, -26.0),
        (0.014, -0.044, 0.037, 55.0),
        (-0.038, -0.032, 0.038, -44.0),
        (-0.010, 0.046, 0.036, 14.0),
        (-0.022, -0.004, 0.060, 28.0),
        (0.024, 0.026, 0.061, -52.0),
        (0.006, -0.028, 0.062, 42.0),
    ):
        food.add(
            *box(0.040, 0.040, 0.022),
            matrix=Matrix.Translation((x, y, z)) @ Matrix.Rotation(math.radians(yaw), 4, "Z"),
        )
    food.emit(coll)
    return 0.076


# =============================================================================
# 9. LIFT — Jim: the alcove has "no doors, no floor and also no lift to speak
#    of". A pair of sliding leaves, the surround they slide behind, the car you
#    stand in, and a classic pointer dial over the top.
# =============================================================================

LIFT_LEAF_W = 0.90
LIFT_LEAF_H = 2.44
LIFT_LEAF_D = 0.11
"""One lift door leaf. Two of them close on a 1.80 m opening, 2.44 m tall."""

LIFT_FRAME_W = 3.28
LIFT_FRAME_H = 2.96
LIFT_OPENING_W = 1.84
LIFT_OPENING_H = 2.50
"""The surround plugs the room's 3.2 m west wall gap (`layout.ts`'s
``gaps.west = [-1.6, 1.6]``) and leaves a 1.84 × 2.50 hole for the leaves."""


def door_leaf(width: float, height: float, depth: float, chamfer: float = 0.045):
    """A chunky sliding leaf whose front is **three crystal facets**, not a slab.

    The tower is a cut gem and the doors have to belong to it, so the leaf's
    horizontal cross-section is a flattened hexagon — flat at the back, three
    planes at the front — and the 46° shading threshold in :meth:`Part.emit`
    keeps every one of those creases crisp. A plain box front read as a
    cupboard door in the first review render.

    The top and bottom rings are inset by `chamfer`, which is a bevel bought
    for four extra vertices instead of a bevel modifier's forty.
    """

    def section(inset: float):
        w, d = width * 0.5 - inset, depth * 0.5 - inset
        return [
            (-w, d),
            (w, d),
            (w, -d * 0.34),
            (w * 0.42, -d),
            (-w * 0.42, -d),
            (-w, -d * 0.34),
        ]

    return loft(
        [
            (section(chamfer), 0.0),
            (section(0.0), chamfer),
            (section(0.0), height - chamfer),
            (section(chamfer), height),
        ]
    )


def build_sliding_pair(
    coll: bpy.types.Collection, prefix: str, width: float, height: float, depth: float, y0: float
) -> float:
    """Two leaves, authored **closed**, each its own node with its own vertices.

    Left spans x ∈ [−w, −0.005] and right x ∈ [0.005, w], so the seam is a real
    5 mm gap you can see rather than two coincident faces z-fighting. Code opens
    them by sliding each leaf ±`width` along its own X — no rotation, no pivot,
    nothing that can fall out of step with the other leaf.
    """
    # Narrower than the leaf's flat middle facet (±0.42 of the half-width), so
    # the panel sits **on** that facet instead of sinking into the two angled
    # shoulders either side of it.
    panel = lozenge(width * 0.40, height * 0.58)
    for name, sign in ((f"{prefix}-door-left", -1.0), (f"{prefix}-door-right", 1.0)):
        leaf = Part(name)
        centre_x = sign * (width * 0.5 + 0.0025)
        leaf.add(
            *door_leaf(width - 0.005, height, depth),
            matrix=Matrix.Translation((centre_x, y0 + depth * 0.5, 0.0)),
        )
        # The crystal panel, standing 0.014 proud of that facet (§5: a marking
        # that sits *in* a surface reads as a rip where it pokes through).
        leaf.add(
            *extrude_outline(panel, 0.036),
            matrix=Matrix.Translation((centre_x, y0 + 0.004, height * 0.52)),
        )
        leaf.emit(coll)
    return height


def build_lift(coll: bpy.types.Collection) -> dict[str, float]:
    # ---- the leaves ---------------------------------------------------------
    # Blender −Y is the game's +Z, so "toward the room" is −Y. The surround
    # stands 0.12 m proud into the room and the leaves run 0.10–0.21 m behind
    # the wall plane, which is where a real lift's doors sit: in the reveal.
    build_sliding_pair(coll, "lift", LIFT_LEAF_W, LIFT_LEAF_H, LIFT_LEAF_D, 0.10)

    # ---- the surround -------------------------------------------------------
    frame = Part("lift-frame")
    jamb_w = (LIFT_FRAME_W - LIFT_OPENING_W) * 0.5
    for sx in (-1, 1):
        frame.add(
            *rounded_box(jamb_w, 0.22, LIFT_FRAME_H, 0.035, segments=1),
            matrix=Matrix.Translation((sx * (LIFT_OPENING_W + jamb_w) * 0.5, -0.01, LIFT_FRAME_H * 0.5)),
        )
        # A slender faceted pilaster either side of the opening: the same
        # six-sided gem the tower is made of, at door scale.
        frame.add(
            *crystal(6, 0.088, 0.112, 0.072, 0.24, 2.42, 0.30, math.radians(15.0)),
            matrix=Matrix.Translation((sx * (LIFT_OPENING_W * 0.5 + 0.16), -0.11, 0.0)),
        )
    frame.add(
        *rounded_box(LIFT_OPENING_W + 0.06, 0.22, LIFT_FRAME_H - LIFT_OPENING_H, 0.035, segments=1),
        matrix=Matrix.Translation((0.0, -0.01, (LIFT_FRAME_H + LIFT_OPENING_H) * 0.5)),
    )
    frame.emit(coll)

    # ---- the threshold ------------------------------------------------------
    sill = Part("lift-frame-sill")
    sill.add(
        *flat_top_box(LIFT_OPENING_W + 0.10, 0.46, 0.055, 0.02, segments=1),
        matrix=Matrix.Translation((0.0, 0.06, 0.0275)),
    )
    sill.emit(coll)

    # ---- the car ------------------------------------------------------------
    # Open-fronted (the front is −Y, the game's +Z), 2.2 × 2.2 × 2.5 inside, so
    # it drops into the 3.0 × 3.4 m alcove `Hotel.buildRoomShell` already walls
    # off with room to spare.
    car = Part("lift-car")
    car.add(*rounded_box(2.40, 0.10, 2.50, 0.04, segments=1), matrix=Matrix.Translation((0.0, 1.15, 1.25)))
    for sx in (-1, 1):
        car.add(
            *rounded_box(0.10, 2.30, 2.50, 0.04, segments=1),
            matrix=Matrix.Translation((sx * 1.15, 0.0, 1.25)),
        )
    car.add(*rounded_box(2.40, 2.40, 0.10, 0.04, segments=1), matrix=Matrix.Translation((0.0, 0.05, 2.55)))
    # Cosy panelling: raised fielded panels, three across the back and two a
    # side, standing 3 cm proud the way ART_DIRECTION §5 wants a marking to.
    for px in (-0.70, 0.0, 0.70):
        car.add(
            *box(0.62, 0.06, 1.50),
            matrix=Matrix.Translation((px, 1.07, 1.30)),
        )
    for sx in (-1, 1):
        for py in (-0.52, 0.52):
            car.add(
                *box(0.06, 0.70, 1.50),
                matrix=Matrix.Translation((sx * 1.07, py, 1.30)),
            )
    car.emit(coll)

    floor = Part("lift-car-floor")
    # **Top at exactly z = 0**, so the plate lies flush under the walkable
    # surface `Hotel.buildRoomShell` already registers at the alcove's y = 0
    # rather than standing on it as a 5 cm step. The geometry is therefore
    # below the origin, documented in `hotelAssets.ts` the way the tower's
    # leaning feet are.
    floor.add(
        *flat_top_box(2.30, 2.30, 0.05, 0.03, segments=1),
        matrix=Matrix.Translation((0.0, 0.0, -0.025)),
    )
    floor.emit(coll)

    rail = Part("lift-car-rail")
    back_v, back_f = tube(0.032, 2.00, sides=8)
    rail.add(back_v, back_f, matrix=Matrix.Translation((-1.00, 1.02, 0.92)) @ Matrix.Rotation(math.radians(90.0), 4, "Y"))
    for sx in (-1, 1):
        side_v, side_f = tube(0.032, 1.90, sides=8)
        rail.add(
            side_v,
            side_f,
            matrix=Matrix.Translation((sx * 1.02, -0.88, 0.92)) @ Matrix.Rotation(math.radians(-90.0), 4, "X"),
        )
    # Brackets, each running from its own rail **outward into the wall behind
    # it**. The first pass turned every side bracket the same way with one
    # `90.0 if …` — right for the +X wall and backwards for the −X one, where
    # two brackets stuck out into the middle of the car instead of holding
    # anything up. Visible in the review render as brass stubs floating in mid
    # air; the sign has to come off the bracket's own side, not be a constant.
    for bx, by in ((-0.70, 1.02), (0.70, 1.02), (-1.02, -0.55), (-1.02, 0.55), (1.02, -0.55), (1.02, 0.55)):
        bracket_v, bracket_f = tube(0.026, 0.11, sides=6)
        if abs(bx) > 1.0:
            turn = Matrix.Rotation(math.radians(90.0 if bx > 0 else -90.0), 4, "Y")
        else:
            turn = Matrix.Rotation(math.radians(-90.0), 4, "X")
        rail.add(bracket_v, bracket_f, matrix=Matrix.Translation((bx, by, 0.92)) @ turn)
    rail.emit(coll)

    return {"lift-doors": LIFT_LEAF_H, "lift-frame": LIFT_FRAME_H, "lift-car": 2.60}


# =============================================================================
# 10. LIFT DIAL — Jim: "a classic style lift pointer style display"
# =============================================================================

DIAL_R = 0.45
"""Radius of the dial face. The plaque is 1.02 m wide over its bezel; the arc
the needle sweeps is 0.90 m across, as briefed."""


def build_lift_dial(coll: bpy.types.Collection) -> float:
    """A semicircular brass plaque with a needle, built about the **pivot**.

    Every asset in this file has its origin at its own base. This one does not,
    and for the same reason the disco ball does not: the one point a caller has
    to line up is the point code rotates about. `lift-dial-needle`'s vertices
    radiate from (0, 0, 0), so `needle.rotation.z = θ` just works — no offset
    group, no second copy of the pivot position to keep in step with this file.

    The needle is authored pointing **straight up**. Rotating about the game's
    +Z (this file's +Y, under `export_yup`) by a positive angle sweeps it to the
    player's left, which is the ground-floor end of the arc.
    """
    plaque = Part("lift-dial")
    outer = [(-0.51, -0.13), (0.51, -0.13), (0.51, 0.02)]
    outer += [
        (0.51 * math.cos(i * math.pi / 16), 0.02 + 0.51 * math.sin(i * math.pi / 16))
        for i in range(1, 16)
    ]
    outer += [(-0.51, 0.02)]
    plaque.add(*extrude_outline(outer, 0.06), matrix=Matrix.Translation((0.0, 0.0, 0.0)))
    # The bezel: a raised rim following the arc, so the face reads as recessed
    # into brass rather than printed on it.
    bezel_in = [
        (DIAL_R * math.cos(i * math.pi / 16), DIAL_R * math.sin(i * math.pi / 16)) for i in range(17)
    ]
    bezel_out = [
        (0.505 * math.cos(i * math.pi / 16), 0.505 * math.sin(i * math.pi / 16)) for i in range(17)
    ]
    plaque.add(*ring_outline(bezel_in, bezel_out, 0.105), matrix=Matrix.Translation((0.0, -0.0225, 0.0)))
    plaque.add(
        *rounded_box(1.02, 0.105, 0.10, 0.03, segments=1),
        matrix=Matrix.Translation((0.0, -0.0225, -0.055)),
    )
    plaque.emit(coll)

    # ---- the face: blank, UV-mapped, painted with floor numbers by code -----
    face = Part("lift-dial-face")
    disc = [
        (DIAL_R * math.cos(i * math.pi / 20), DIAL_R * math.sin(i * math.pi / 20)) for i in range(21)
    ] + [(-DIAL_R, -0.055), (DIAL_R, -0.055)]
    fv, ff = extrude_outline(disc, 0.025, centre=(0.0, 0.10))
    face.add(fv, ff, matrix=Matrix.Translation((0.0, -0.0375, 0.0)), uvs=uv_from_xz(fv, ff, DIAL_R * 2, DIAL_R * 2))
    face.emit(coll, recalc=False)

    # ---- ticks: geometry, not paint (ART_DIRECTION §5) ----------------------
    ticks = Part("lift-dial-ticks")
    for i in range(11):
        angle = i * math.pi / 10
        long = i in (0, 5, 10)
        length = 0.075 if long else 0.045
        r_mid = DIAL_R - 0.035 - length * 0.5
        ticks.add(
            *box(0.026 if long else 0.020, 0.028, length),
            matrix=Matrix.Translation(
                (r_mid * math.cos(angle), -0.062, r_mid * math.sin(angle))
            )
            @ Matrix.Rotation(math.pi * 0.5 - angle, 4, "Y"),
        )
    ticks.emit(coll)

    # ---- the needle ---------------------------------------------------------
    needle = Part("lift-dial-needle")
    pointer = [(0.032, -0.085), (0.024, 0.300), (0.0, 0.370), (-0.024, 0.300), (-0.032, -0.085)]
    needle.add(*extrude_outline(pointer, 0.034, centre=(0.0, 0.06)), matrix=Matrix.Translation((0.0, -0.090, 0.0)))
    # +90° about X sends the tube down −Y, i.e. **toward the viewer**, so the
    # hub caps the front of the blade rather than hiding behind it.
    hub_v, hub_f = tube(0.052, 0.05, sides=12)
    needle.add(
        hub_v,
        hub_f,
        matrix=Matrix.Translation((0.0, -0.075, 0.0)) @ Matrix.Rotation(math.radians(90.0), 4, "X"),
    )
    needle.emit(coll)

    return 0.53 + 0.13


# =============================================================================
# 11. ENTRANCE DOORS — the tower's own front door, so it "slides open as you
#     approach". Same construction as the lift's, sized to the doorway that is
#     already cut in the tower's face.
# =============================================================================

ENTRANCE_LEAF_W = 1.09
ENTRANCE_LEAF_H = 2.58
"""Two leaves inside `DOOR_W` × `DOOR_H` with 1 cm of clearance all round —
**derived from the tower's own doorway, not typed again.** Asserted below."""


def build_entrance_doors(coll: bpy.types.Collection) -> float:
    assert abs(ENTRANCE_LEAF_W * 2 - (DOOR_W - 0.02)) < 1e-9, "entrance leaves must fill DOOR_W"
    assert abs(ENTRANCE_LEAF_H - (DOOR_H - 0.02)) < 1e-9, "entrance leaves must fit DOOR_H"
    return build_sliding_pair(coll, "entrance", ENTRANCE_LEAF_W, ENTRANCE_LEAF_H, 0.12, 0.0)


# =============================================================================
# 12. THE SUITE'S TELEVISION — Jim: "1 with a large TV and a sofa and a game boy
#     on the table"
# =============================================================================


def build_tv(coll: bpy.types.Collection) -> float:
    """A big chunky set on splayed legs, with rabbit ears. Faces −Y (game +Z).

    A flat panel was the obvious read of "a large TV" and the wrong one: a
    black rectangle on a stick has no silhouette, no roundness and nothing a
    six-year-old would call a toy — and there is no black in this game to draw
    it with anyway (§1). A wooden set with a domed screen, two brass knobs and
    a pair of aerials is chunky, reads instantly from the iso camera, and is
    made of the same painted-wood vocabulary as the breakfast table.
    """
    body = Part("tv-body")
    body.add(*rounded_box(1.62, 0.56, 1.08, 0.075), matrix=Matrix.Translation((0.0, 0.0, 0.84)))
    body.emit(coll)

    # The screen is a **panel of the set's own front**, given its own node
    # because it is its own colour and its own UV map — code paints the picture
    # onto it. Not a decal floated in front of the cabinet (CLAUDE.md's hood
    # face): it is a solid inset that shares the cabinet's front plane.
    screen = Part("tv-screen")
    sw, sh = 1.06, 0.74
    sv, sf = extrude_outline(rounded_rect(sw, sh, 0.10, samples=4), 0.09)
    screen.add(sv, sf, matrix=Matrix.Translation((-0.18, -0.255, 0.88)), uvs=uv_from_xz(sv, sf, sw, sh))
    screen.emit(coll, recalc=False)

    knobs = Part("tv-knobs")
    for kz in (1.06, 0.88):
        knob_v, knob_f = tube(0.072, 0.055, sides=12)
        knobs.add(
            knob_v,
            knob_f,
            matrix=Matrix.Translation((0.57, -0.30, kz)) @ Matrix.Rotation(math.radians(-90.0), 4, "X"),
        )
    for gz in (0.60, 0.53, 0.46):
        knobs.add(
            *box(0.30, 0.03, 0.030),
            matrix=Matrix.Translation((0.57, -0.285, gz)),
        )
    knobs.emit(coll)

    stand = Part("tv-stand")
    for sx in (-1, 1):
        for sy in (-1, 1):
            leg_v, leg_f = tube(0.055, 0.34, sides=8)
            stand.add(
                leg_v,
                leg_f,
                matrix=Matrix.Translation((sx * 0.60, sy * 0.20, 0.0))
                @ Matrix.Rotation(math.radians(sx * -9.0), 4, "Y")
                @ Matrix.Rotation(math.radians(sy * 8.0), 4, "X"),
            )
    stand.add(*rounded_box(1.30, 0.42, 0.09, 0.035, segments=1), matrix=Matrix.Translation((0.0, 0.0, 0.325)))
    stand.emit(coll)

    # Rabbit ears. **Different angles and different lengths**, per §4's "nothing
    # is plumb" — a symmetrical V is the placeholder look. Each ball is put
    # exactly where its own ear ends, computed rather than typed: a hand-written
    # tip position is one retune away from a floating ball, and this file's own
    # `main_face_y` exists for the same reason.
    aerial = Part("tv-aerial")
    aerial.add(*rounded_box(0.22, 0.18, 0.09, 0.03, segments=1), matrix=Matrix.Translation((0.0, 0.10, 1.42)))
    top = 0.0
    for sx, tilt_deg, length in ((-1, 41.0, 0.58), (1, 31.0, 0.65)):
        base = Vector((sx * 0.05, 0.10, 1.45))
        tilt = math.radians(sx * tilt_deg)
        ear_v, ear_f = tube(0.026, length, sides=6)
        aerial.add(ear_v, ear_f, matrix=Matrix.Translation(base) @ Matrix.Rotation(tilt, 4, "Y"))
        tip = base + Vector((math.sin(tilt) * length, 0.0, math.cos(tilt) * length))
        aerial.add(*icosphere(0.048, 1), matrix=Matrix.Translation(tip))
        top = max(top, tip.z + 0.048)
    aerial.emit(coll)
    return top


# =============================================================================
# 13. GAME BOY — on the lounge table, lying face up
# =============================================================================

GAMEBOY_W = 0.22
GAMEBOY_L = 0.34
GAMEBOY_H = 0.055
"""Three times life size, and it has to be.

A 90 × 148 mm handheld on a 0.45 m table, seen from a camera 38° up and some
metres back, is four pixels of speckle. Everything in this park is already
scaled to be read rather than measured (§4 — the kid's head is 59% of her),
and a toy console that a child can actually see her Game Boy in is worth more
than one that is correct and invisible."""


def build_gameboy(coll: bpy.types.Collection) -> float:
    body = Part("gameboy-body")
    body.add(
        *rounded_box(GAMEBOY_W, GAMEBOY_L, GAMEBOY_H, 0.022),
        matrix=Matrix.Translation((0.0, 0.0, GAMEBOY_H * 0.5)),
    )
    body.emit(coll)

    # Lies flat, so its UV comes off X and Y rather than X and Z. Same rule.
    screen = Part("gameboy-screen")
    scw, scl = 0.150, 0.125
    sv, sf = extrude_outline(rounded_rect(scw, scl, 0.022, samples=2), 0.022)
    sv = [(v[0], v[2], v[1]) for v in sv]  # stand the panel down flat, face up
    screen.add(sv, sf, matrix=Matrix.Translation((0.0, 0.085, GAMEBOY_H)), uvs=uv_from_xy(sv, sf, scw, scl))
    screen.emit(coll, recalc=True)

    buttons = Part("gameboy-buttons")
    # The d-pad: two crossed bars, one node, one colour.
    for bar in ((0.062, 0.020), (0.020, 0.062)):
        buttons.add(
            *box(bar[0], bar[1], 0.016),
            matrix=Matrix.Translation((-0.052, -0.045, GAMEBOY_H)),
        )
    for bx, by in ((0.038, -0.030), (0.070, -0.012)):
        btn_v, btn_f = tube(0.019, 0.016, sides=10)
        buttons.add(btn_v, btn_f, matrix=Matrix.Translation((bx, by, GAMEBOY_H - 0.002)))
    for i in range(2):
        buttons.add(
            *box(0.044, 0.016, 0.012),
            matrix=Matrix.Translation((-0.014 + i * 0.052, -0.120, GAMEBOY_H - 0.002))
            @ Matrix.Rotation(math.radians(-16.0), 4, "Z"),
        )
    buttons.emit(coll)
    return GAMEBOY_H + 0.018


# =============================================================================
# 14. GRAND STAIRCASE — the lobby's sweeping quarter-turn stair to the gallery
# =============================================================================
#
# Jim, playing on 7 August 2026: *"the staircase is also poorly modelled,
# looking like a random stack of boxes more than anything… Model the staircase
# properly in blender, with a rail and a nice consistent sweep all the way up
# and a hand rail."*
#
# It **was** a stack of boxes, and knowing why is worth the paragraph. The old
# `Hotel.buildMezzanine` drew each tread as a `BoxGeometry` running from the
# floor all the way up to that tread's own top — ten nested slabs of ten
# different heights, sharing no surface with each other — and then yawed each
# one by `rotation.y = angle`, which is 90° out from the rotation that would
# have pointed its 1.8 m radial dimension along the radius (three.js yaws +X
# toward −Z; the arc's outward normal at angle *a* is (−sin a, cos a), so the
# box wanted `−a − π/2`). So every tread lay across the flight rather than
# along it, at ten different heights, in two alternating colours. Nothing about
# that was a modelling *style* problem: it was ten boxes.
#
# What replaces it is one continuous sweep. Everything below is a function of a
# single parameter `u`, measured in **treads** (0 at the bottom riser, 10 at the
# deck), which is what makes the flight even by construction rather than by
# ten literals agreeing: constant riser, constant tread depth, a soffit and two
# string top edges that are all straight rakes in (u, height), and a handrail
# that is one more of those.

STAIR_INNER_R = 2.40
STAIR_OUTER_R = 4.20
STAIR_SWEEP_ANGLE = math.pi / 2
STAIR_RISE = 3.20
STAIR_TREADS = 10
"""The arc. **`src/world/hotel/layout.ts` owns these five numbers, not this
file** — `LOBBY.mezzanine.stair` and `LOBBY_MEZZANINE_Y`. The game derives its
walkable `ArcTread` surfaces and the stair's two flank colliders from them, so
an asset built to a different arc is a staircase a child falls through.
`src/art/models/hotelAssets.ts` re-exports them as `STAIR_*` for the placing
code to read back, which keeps it at one owner and two readers rather than
three hand-kept copies (CLAUDE.md, "two definitions of one thing")."""

STAIR_RISER = STAIR_RISE / STAIR_TREADS
assert abs(STAIR_RISER - 0.32) < 1e-9, "layout.ts promises a 0.32 m riser; the arc has moved"

# The flight's own timber, none of which anything outside this file needs.
STAIR_NOSE_DROP = 0.045
"""Chamfer down the leading edge of every tread. Under the toon ramp this is
what draws the line along each nosing — without it ten treads of one colour
read as a ramp, which is the opposite failure to ten boxes and just as wrong."""
STAIR_NOSE_RUN = 0.075
"""…and how far along the tread it runs, in **treads** (≈39 mm at mid radius)."""
STAIR_RISER_LEAN = 0.03
"""Each riser leans back by this much (in treads, ≈16 mm), so the nosing above
it very slightly overhangs. Real stairs do it, and it also keeps the two rings
at each step off each other: coincident rings would weld into a zero-area quad
and leave `validate()` to tidy up after us."""
STAIR_WAIST = 0.55
"""Thickness of the flight measured **down from the pitch line**, so the soffit
is a rake parallel to the stair rather than a staircase upside-down. Clamped at
the floor, which makes the bottom ~1.7 treads solid — a flight growing out of
the floor rather than one balanced on a knife edge."""
STAIR_STRING_T = 0.20
STAIR_STRING_BITE = 0.03
"""How far each string laps *over* the tread ends. Overlapping solids, never
coincident faces — two faces in the same plane is what z-fights."""
STAIR_STRING_UPSTAND = 0.10
"""How far the string's top edge stands above the nosing line. This is what
makes it a **closed** string: the tread ends are housed inside it and the flight
reads as solid masonry from the side, which is also exactly what the game's
flank colliders claim it is."""
STAIR_STRING_CHAMFER = 0.055
STAIR_STRING_FACET = 0.04
"""How far each string's exposed face steps in and out between samples.

The reception desk's trick, and the same reason: a 6.6 m run of flat lilac is a
slab, and a slab in this park reads as a placeholder however well it is
proportioned. Twelve samples of a shallow arc read as a smooth curve; twelve
samples pushed in and out by 4 cm read as cut crystal. The string's *top edge*
is untouched by it — the rake is the thing the eye follows up the flight, and
it stays a straight line."""
STAIR_STRING_CAP = 0.34
"""Depth of the un-faceted capping band along each string's top edge."""
STAIR_STRING_EASE = 0.16
"""Radius of the easing curve where the rake meets the landing, in metres.

A handrail that climbs at 32° and then turns level in one vertex has a visible
elbow in it, which is the one place a "consistent sweep all the way up" stops
being consistent. Real joinery puts an easing there. Kept small on purpose: the
ease dips the pitch line by at most `k/4` = 4 cm, and the string's 10 cm upstand
is what has to survive that — at 6 cm it still does, and a bigger radius would
start to sink the string below the top tread it is meant to hide the end of."""
STAIR_RAIL_H = 0.86
"""Handrail centre-line above the nosing line — the same 0.86 m
`Hotel.dressMezzanine` already puts the gallery's own rail at, so the two meet
where the stair lands instead of stepping."""
STAIR_BALUSTERS = 13

STAIR_OUTER_STRING = (
    STAIR_OUTER_R - STAIR_STRING_BITE,
    STAIR_OUTER_R - STAIR_STRING_BITE + STAIR_STRING_T,
)
STAIR_INNER_STRING = (
    STAIR_INNER_R + STAIR_STRING_BITE - STAIR_STRING_T,
    STAIR_INNER_R + STAIR_STRING_BITE,
)
STAIR_RAIL_R = sum(STAIR_OUTER_STRING) * 0.5
STAIR_COPING_R = sum(STAIR_INNER_STRING) * 0.5


def stair_point(u: float, radius: float, z: float):
    """One point on the arc: `u` in treads, `radius` in metres, `z` in metres.

    **The one place the angle convention is written down.** The game measures
    this yaw as *0 is +Z, turning toward −X* (`layout.ts`'s `Mezzanine`), so a
    point at game-angle *a* sits at `(centreX − sin a · r, centreZ + cos a · r)`.
    `export_yup` maps Blender (x, y, z) → glTF (x, z, −y), so the game's X is
    Blender's x and the game's Z is Blender's **−y** — which is where the second
    minus sign comes from. Nine call sites go through this rather than repeating
    it, because a sign slip here is the entire asset facing the wrong way and
    nothing else (the reception desk lost an afternoon to exactly that).
    """
    a = STAIR_SWEEP_ANGLE * u / STAIR_TREADS
    return (-math.sin(a) * radius, -math.cos(a) * radius, z)


def stair_nosing(u: float) -> float:
    """The pitch line through the front top corner of every tread.

    Clamped at the deck, so over the last tread it goes level: the handrail and
    both strings then arrive at the gallery flat rather than continuing to climb
    past it, which is what a flight meeting a landing does. The clamp is a
    **smooth** minimum (`STAIR_STRING_EASE`) so that meeting is a curve rather
    than an elbow — every line that follows this one inherits the easing for
    free, which is what keeps rail, coping and both strings parallel through it.
    """
    rake = STAIR_RISER * (u + 1.0)
    k = STAIR_STRING_EASE
    h = max(0.0, k - abs(rake - STAIR_RISE)) / k
    return min(rake, STAIR_RISE) - h * h * k * 0.25


def stair_soffit(u: float) -> float:
    return max(0.0, STAIR_RISER * u - STAIR_WAIST)


def stair_string_top(u: float) -> float:
    return stair_nosing(u) + STAIR_STRING_UPSTAND


def stair_string_bottom(u: float) -> float:
    """The floor. Both strings are solid all the way down, and that is a
    **collision** decision before it is a look one.

    `Hotel.buildMezzanine` walls each radius off with a chain of colliders that
    are solid *from the floor to the tread* — which is what the side of a
    masonry stair is, and what stops a child walking into the flank of the
    flight from the open lobby. A string that floated on the soffit rake would
    leave a metre of daylight under the middle of the stair with an invisible
    wall standing in it: the one thing worse than a wall you can see is a wall
    you cannot.

    It is also, separately, the grander shape. A hotel staircase is a solid
    sweep of masonry that meets the floor; an open flight with its soffit on
    display is a modern stair, and this is not a modern hotel. The flight's own
    raked soffit (:func:`stair_soffit`) is kept regardless — it is now enclosed
    between the two strings and nobody sees it, but it means the geometry stays
    honest if anyone ever opens an arch under the stair."""
    return 0.0


def stair_rail_line(u: float) -> float:
    return stair_nosing(u) + STAIR_RAIL_H


def stair_samples(count: int, *breaks: float):
    """`count` even samples along the sweep, plus every `u` where a rake kinks.

    Sampling a straight-in-(u, h) line only needs enough points for the *arc* to
    read round — but a sample must land exactly on each kink (where a clamp
    bites), or the loft cuts the corner and the rail sags there."""
    out: list[float] = []
    for u in sorted([STAIR_TREADS * i / count for i in range(count + 1)] + list(breaks)):
        if not out or u - out[-1] > 1e-6:
            out.append(u)
    return out


def build_stair(coll: bpy.types.Collection) -> float:
    # --- the flight -----------------------------------------------------------
    # One swept solid, not ten. Its cross-section is the same radial rectangle
    # everywhere — inner radius to outer radius, soffit to the tread it is
    # under — and the *steps* come from where the rings are put, not from
    # separate objects: two rings at (nearly) the same angle make a vertical
    # riser, a third makes the nosing chamfer, and the rest ride the tread.
    treads = Part("stair-tread")
    profile: list[tuple[float, float]] = []
    for i in range(STAIR_TREADS):
        top = STAIR_RISER * (i + 1)
        # The bottom step has no riser below it to lean off — it rises straight
        # off the lobby floor, and its end cap *is* that first riser.
        lean = 0.0 if i == 0 else STAIR_RISER_LEAN
        profile.append((i + lean, top - STAIR_NOSE_DROP))
        profile.append((i + lean + STAIR_NOSE_RUN, top))
        profile.append((i + 0.55, top))
        profile.append((i + 1.0, top))
    treads.add(
        *sweep_rings(
            [
                [
                    stair_point(u, STAIR_INNER_R, stair_soffit(u)),
                    stair_point(u, STAIR_OUTER_R, stair_soffit(u)),
                    stair_point(u, STAIR_OUTER_R, top),
                    stair_point(u, STAIR_INNER_R, top),
                ]
                for u, top in profile
            ]
        )
    )
    treads.emit(coll)

    # --- the two closed strings ----------------------------------------------
    # The sample list has to contain the `u` where the rake eases into the
    # landing, or the loft cuts that corner and the string's top edge sags
    # away from the handrail running parallel to it.
    strings = Part("stair-stringer")
    string_us = stair_samples(12, 8.5, 9.0, 9.5)
    chamfer = STAIR_STRING_CHAMFER
    # `face` says which of the two radii is the one nobody's shin touches, and
    # is therefore the one free to facet: the outer string shows its outside,
    # the inner string its inside. The other radius stays exactly where it is,
    # because that is the edge lapping over the ends of the treads.
    for (r0, r1), face in ((STAIR_OUTER_STRING, 1), (STAIR_INNER_STRING, -1)):
        sections = []
        for index, u in enumerate(string_us):
            push = STAIR_STRING_FACET if index % 2 == 0 else -STAIR_STRING_FACET
            lo, hi = r0, r1
            # The facet lives on the wall, never on the top edge. Faceting the
            # whole section wobbled the string's top edge by ±4 cm and the
            # nosings showing over it turned into a sawtooth — the one line in
            # the whole asset that has to read as a clean rake, chewed up by a
            # detail meant for the blank surface below it. So the top
            # `STAIR_STRING_CAP` of the section stays at the true radius and
            # the crystal facets stop under it, which is a plinth-and-capping
            # reading rather than a mistake.
            lo_f, hi_f = (lo - push, hi) if face < 0 else (lo, hi + push)
            bottom, top = stair_string_bottom(u), stair_string_top(u)
            waist = top - STAIR_STRING_CAP
            sections.append(
                [
                    stair_point(u, lo_f, bottom),
                    stair_point(u, hi_f, bottom),
                    stair_point(u, hi_f, waist),
                    stair_point(u, hi, waist + STAIR_STRING_FACET),
                    stair_point(u, hi, top - chamfer),
                    stair_point(u, hi - chamfer, top),
                    stair_point(u, lo + chamfer, top),
                    stair_point(u, lo, top - chamfer),
                    stair_point(u, lo, waist + STAIR_STRING_FACET),
                    stair_point(u, lo_f, waist),
                ]
            )
        strings.add(*sweep_rings(sections))
    # Flat, like `desk-front` and for the same reason: a 4 cm facet across a
    # 45 cm chord is a 20° crease, which is *under* `emit`'s 46° threshold — so
    # smooth shading would average the facets back into a soft wobble, which
    # reads as a modelling mistake rather than as cut stone.
    strings.emit(coll, smooth=False)

    # --- the handrail, and the matching coping on the inner string ------------
    # One node, two sweeps, one colour: the thing a hand goes on and the thing
    # that answers it across the flight are the same piece of brass, which is
    # what makes the two edges of the stair read as a pair.
    rail = Part("stair-rail")
    handrail_section = [
        (-0.045, -0.060),
        (0.045, -0.060),
        (0.090, 0.0),
        (0.045, 0.062),
        (-0.045, 0.062),
        (-0.090, 0.0),
    ]
    rail.add(
        *sweep_rings(
            [
                [
                    stair_point(u, STAIR_RAIL_R + dr, stair_rail_line(u) + dz)
                    for dr, dz in handrail_section
                ]
                for u in stair_samples(30, 8.5, 9.0, 9.5)
            ]
        )
    )
    # A coping stone, overhanging its string by 15 mm each side. A second full
    # handrail down here would be a rail on the side of the stair nobody can
    # fall off — the inner string is already a collider floor-to-tread — and it
    # would have doubled the balusters for a line the camera barely sees.
    coping_section = [
        (-0.115, -0.030),
        (0.115, -0.030),
        (0.115, 0.050),
        (0.075, 0.085),
        (-0.075, 0.085),
        (-0.115, 0.050),
    ]
    rail.add(
        *sweep_rings(
            [
                [
                    stair_point(u, STAIR_COPING_R + dr, stair_string_top(u) + dz)
                    for dr, dz in coping_section
                ]
                for u in stair_samples(24, 8.5, 9.0, 9.5)
            ]
        )
    )
    rail.emit(coll)

    # --- balusters ------------------------------------------------------------
    # Evenly spaced in `u`, which on a curve is what the eye reads as even:
    # thirteen of them at 0.51 m centres along the outer radius, against the
    # 0.62 m `dressMezzanine` uses on the gallery's own rail. Plumb, not radial
    # — a real curved balustrade's balusters are vertical, and the slight fan
    # they make in plan is the whole charm of one.
    balusters = Part("stair-baluster")
    for k in range(STAIR_BALUSTERS):
        u = 0.40 + (STAIR_TREADS - 0.80) * k / (STAIR_BALUSTERS - 1)
        cx, cy, _ = stair_point(u, STAIR_RAIL_R, 0.0)
        spin = math.atan2(cy, cx)
        foot = stair_string_top(u) - 0.04
        head = stair_rail_line(u) - 0.045
        balusters.add(
            *loft(
                [
                    ([(x, y) for x, y, _ in ring(6, r, 0.0, spin)], z)
                    # Chunky, and barely tapered. The first pass ran
                    # 0.072 → 0.055 and rendered as a row of tent pegs: on a
                    # 0.75 m spindle a taper the eye can see reads as a *point*,
                    # and ART_DIRECTION §1's "no thin parts" is exactly about
                    # this. 0.18 m across the belly is the same chunk as the
                    # gallery's own balusters.
                    for r, z in (
                        (0.082, foot),
                        (0.090, foot + 0.15),
                        (0.070, head),
                    )
                ]
            ),
            matrix=Matrix.Translation((cx, cy, 0.0)),
        )
    balusters.emit(coll)

    # --- the two newels -------------------------------------------------------
    # One on the lobby floor where the flight starts, one on the deck where it
    # lands, each capped with the same six-sided gem the tower is grown from —
    # the cheapest way to say "this staircase belongs to that building".
    newels = Part("stair-newel")
    for u, ground in ((0.0, 0.0), (float(STAIR_TREADS), STAIR_RISE)):
        cx, cy, _ = stair_point(u, STAIR_RAIL_R, 0.0)
        spin = math.atan2(cy, cx)
        cap = stair_rail_line(u) + 0.062
        newels.add(
            *loft(
                [
                    ([(x, y) for x, y, _ in ring(6, r, 0.0, spin)], z)
                    for r, z in (
                        (0.132, ground),
                        (0.115, ground + 0.13),
                        (0.115, cap - 0.10),
                        (0.134, cap),
                    )
                ]
            ),
            matrix=Matrix.Translation((cx, cy, 0.0)),
        )
        newels.add(
            *gem(6, 0.092, 0.13, 0.10, spin),
            matrix=Matrix.Translation((cx, cy, cap - 0.012)),
        )
    newels.emit(coll)

    # --- the contract with the game, asserted rather than promised -----------
    # The game registers a walkable `ArcTread` per step from `layout.ts`'s arc
    # and two flank colliders down the two radii. If this asset ever stops
    # agreeing with that arc it should stop *building*, not quietly ship a
    # staircase whose treads are somewhere other than where a child's feet go.
    # Measured off the emitted mesh, never off the numbers that made it —
    # `check:assets`' founding lesson, and the reason the desk's splayed
    # counter was found at all.
    flight = bpy.data.objects["stair-tread"].data
    heights = {round(v.co.z, 4) for v in flight.vertices}
    for i in range(STAIR_TREADS):
        top = round(STAIR_RISER * (i + 1), 4)
        assert top in heights, f"tread {i + 1} should top out at {top} m and no vertex does"
    radii = [math.hypot(v.co.x, v.co.y) for v in flight.vertices]
    assert abs(min(radii) - STAIR_INNER_R) < 1e-6 and abs(max(radii) - STAIR_OUTER_R) < 1e-6, (
        "the walkable flight must span exactly the arc the game puts `ArcTread`s "
        f"over, and spans {min(radii):.4f}..{max(radii):.4f}"
    )
    assert abs(max(v.co.z for v in flight.vertices) - STAIR_RISE) < 1e-6, "top tread ≠ deck height"
    # …and both strings have to house those tread ends at every point along the
    # arc, top and bottom, or the flight's bare side face shows through the
    # masonry that is meant to be hiding it.
    for u in stair_samples(120):
        tread_top = STAIR_RISER * min(STAIR_TREADS, math.floor(u) + 1)
        assert stair_string_top(u) > tread_top, f"string sinks below its tread at u={u:.3f}"
        assert stair_string_bottom(u) <= stair_soffit(u) + 1e-9, f"string floats at u={u:.3f}"

    return stair_rail_line(float(STAIR_TREADS)) + 0.062 + 0.23


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
    heights["petBed"] = build_pet_bed(collection("hotel-petbed"))
    heights["petBowl"] = build_pet_bowl(collection("hotel-petbowl"))
    heights.update(build_lift(collection("hotel-lift")))
    heights["liftDial"] = build_lift_dial(collection("hotel-lift-dial"))
    heights["entranceDoors"] = build_entrance_doors(collection("hotel-entrance"))
    heights["tv"] = build_tv(collection("hotel-tv"))
    heights["gameBoy"] = build_gameboy(collection("hotel-gameboy"))
    heights["stair"] = build_stair(collection("hotel-stair"))

    print("\nhotel_build")
    print(summarise())
    print("  intended heights (m):", {k: round(v, 3) for k, v in heights.items()})

    bpy.ops.wm.save_as_mainfile(filepath=BLEND)
    print("  saved", BLEND, f"({os.path.getsize(BLEND)} bytes)\n")


if __name__ == "__main__":
    main()
