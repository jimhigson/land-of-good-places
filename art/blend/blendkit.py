"""Shared Blender-authoring helpers for this repo's headless build scripts.

``hotel_build.py`` grew a small library of primitive generators — a rounded
box, a surface of revolution, a swept tube — and ``bridge_stones_build.py``
grew a smaller one beside it. This module is that library, extracted so the
castle's dressing (thirty-odd parts) does not grow a *third* copy.

``hotel_build.py`` and ``bridge_stones_build.py`` are deliberately **left
alone**: both have a shipped ``.glb`` whose byte size is asserted by its
``pack:`` step, and re-pointing them at a re-indented copy of their own
helpers would mean re-verifying two large binaries for no change a child can
see. New scripts import from here; those two are grandfathered.

Nothing in this file knows a single dimension of anything. It is shapes and
scene plumbing only — the numbers live in the build script that calls it, and
the numbers that are *shared with the game* live in TypeScript and are read
back through :func:`ts_const`.

Conventions every caller is written against (ART_DIRECTION §7):

* 1 Blender unit = 1 metre.
* **Blender −Y is the game's +Z.** The glTF exporter's ``export_yup`` maps
  Blender (x, y, z) → glTF (x, z, −y), so anything whose facing matters is
  built facing **−Y** here.
* Every part leaves Blender at an identity transform with its placement baked
  into vertex positions, and each lives in its own collection.
"""

import math
import os
import re

import bmesh
import bpy
from mathutils import Matrix, Vector

TAU = math.pi * 2.0

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


# =============================================================================
# Reading the game's own numbers
# =============================================================================


def ts_const(relative_path: str, name: str) -> float:
    """Read ``export const NAME = <number>;`` out of one of the game's modules.

    Verbatim in behaviour from ``hotel_build.py``, and for its reason: when a
    number is shared between an asset and the game, the game owns it and the
    asset *asks*. Typing the figure into Python as well is CLAUDE.md's "two
    definitions of one thing", and the copy is always found wrong later, by a
    child, in the built park.

    A regex over a source file is a blunt instrument and a deliberate one: it
    cannot silently return a default, it drags no import graph into Blender,
    and the assertion turns a rename or a reformat into a loud failure rather
    than into a wrong asset.
    """
    path = os.path.join(REPO, relative_path)
    with open(path, encoding="utf-8") as handle:
        source = handle.read()
    found = re.findall(
        rf"^export const {name} = (-?\d+(?:\.\d+)?);\s*$", source, flags=re.MULTILINE
    )
    assert len(found) == 1, (
        f"{relative_path} must declare `export const {name} = <number>;` exactly once "
        f"and declares it {len(found)} times — this asset is built to that number and "
        "cannot guess it"
    )
    return float(found[0])


# =============================================================================
# Scene plumbing
# =============================================================================


def reset_scene() -> None:
    """Empties the factory-startup scene — cube, camera, light and all."""
    # No `.blend1` backup: the Python is the source, and a fat binary landing
    # untracked in `git status` after every run helps nobody.
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
    primitives without bmesh bookkeeping; :meth:`emit` does the welding, the
    normal recalculation and the shading in one place.
    """

    def __init__(self, name: str) -> None:
        self.name = name
        self.verts: list[tuple[float, float, float]] = []
        self.faces: list[tuple[int, ...]] = []
        self.uvs: dict[int, list[tuple[float, float]]] = {}

    def add(self, verts, faces, matrix: Matrix | None = None, uvs=None) -> "Part":
        """Append a primitive, optionally transformed, optionally UV-mapped.

        Returns ``self`` so a part can be composed in one chained expression.
        """
        base = len(self.verts)
        if matrix is None:
            self.verts.extend(tuple(v) for v in verts)
        else:
            self.verts.extend(tuple(matrix @ Vector(v)) for v in verts)
        for index, face in enumerate(faces):
            self.faces.append(tuple(i + base for i in face))
            if uvs is not None:
                self.uvs[len(self.faces) - 1] = list(uvs[index])
        return self

    def at(self, verts, faces, x=0.0, y=0.0, z=0.0, **kwargs) -> "Part":
        """:meth:`add` with a plain translation — the common case, spelled short."""
        return self.add(verts, faces, Matrix.Translation((x, y, z)), **kwargs)

    def bounds(self):
        lo = [1e9, 1e9, 1e9]
        hi = [-1e9, -1e9, -1e9]
        for v in self.verts:
            for i in range(3):
                lo[i] = min(lo[i], v[i])
                hi[i] = max(hi[i], v[i])
        return Vector(lo), Vector(hi)

    def emit(
        self,
        coll: bpy.types.Collection,
        *,
        smooth: bool = True,
        sharp_deg: float = 46.0,
        weld: bool = True,
    ) -> bpy.types.Object:
        mesh = bpy.data.meshes.new(self.name)
        mesh.from_pydata(self.verts, [], self.faces)
        mesh.validate(verbose=False)

        bm = bmesh.new()
        bm.from_mesh(mesh)
        if weld:
            bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
        # Drop edges left with no face either side — `revolve` makes one every
        # time a profile opens *and* closes on the axis. They export as nothing
        # (glTF carries triangles) but they are the difference between "this
        # mesh is a closed solid" being true and being nearly true.
        loose = [edge for edge in bm.edges if not edge.link_faces]
        if loose:
            bmesh.ops.delete(bm, geom=loose, context="EDGES")
        threshold = math.radians(sharp_deg)
        for face in bm.faces:
            face.smooth = smooth
        if smooth:
            # "Smooth by angle" by hand: a bevelled corner reads round, a
            # genuine crease stays a crease. 46° keeps a cube's 90° edges
            # crisp, keeps a hex prism faceted, and lets a one-segment (45°)
            # or two-segment (30°) bevel round off. Lower thresholds cost a
            # duplicated vertex per corner in the shipped `.glb` for edges the
            # toon ramp cannot show anyway.
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


def box(sx: float, sy: float, sz: float):
    """A plain cube — **eight** vertices, where :func:`rounded_box` costs 24.

    ART_DIRECTION §1's "no sharp edges" is about shapes a child looks at. A
    2 cm rivet, a tapestry's hem tube and a barrel hoop are not those, and a
    bevel on them is a corner nobody can see paid for in shipped bytes.
    Anything a silhouette depends on still gets a real bevel.
    """
    hx, hy, hz = sx * 0.5, sy * 0.5, sz * 0.5
    verts = [
        (-hx, -hy, -hz), (hx, -hy, -hz), (hx, hy, -hz), (-hx, hy, -hz),
        (-hx, -hy, hz), (hx, -hy, hz), (hx, hy, hz), (-hx, hy, hz),
    ]
    faces = [(0, 1, 2, 3), (7, 6, 5, 4), (0, 4, 5, 1), (1, 5, 6, 2), (2, 6, 7, 3), (3, 7, 4, 0)]
    return verts, faces


def rounded_box(sx: float, sy: float, sz: float, radius: float, segments: int = 2):
    """A chunky rounded box, centred on its own origin. ART_DIRECTION §1's shape."""
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

    A table top, a chest lid's shelf, a bench seat: a bevel that rounds the top
    away is what makes a goblet the game says is standing look as if it is
    sliding off. Only the four vertical edges and the bottom are rounded.
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


def ellipsoid(rx: float, ry: float, rz: float, subdivisions: int = 2):
    """A squashed sphere — ART_DIRECTION §4's "every sphere squashed", pre-squashed."""
    verts, faces = icosphere(1.0, subdivisions)
    return [(v[0] * rx, v[1] * ry, v[2] * rz) for v in verts], faces


def ring(count: int, radius: float, z: float, spin: float = 0.0):
    return [
        (radius * math.cos(spin + i * TAU / count), radius * math.sin(spin + i * TAU / count), z)
        for i in range(count)
    ]


def tube(radius: float, height: float, sides: int = 16, z0: float = 0.0, spin: float = 0.0):
    """A capped cylinder standing on ``z0``."""
    lower = ring(sides, radius, z0, spin)
    upper = ring(sides, radius, z0 + height, spin)
    verts = lower + upper
    faces = []
    for i in range(sides):
        j = (i + 1) % sides
        faces.append((i, j, sides + j, sides + i))
    faces.append(tuple(range(sides - 1, -1, -1)))
    faces.append(tuple(range(sides, sides * 2)))
    return verts, faces


def cone(radius: float, height: float, sides: int = 12, z0: float = 0.0):
    """A capped cone standing on ``z0`` — a candle flame, a helmet spike."""
    base = ring(sides, radius, z0)
    verts = base + [(0.0, 0.0, z0 + height)]
    tip = sides
    faces = [(i, (i + 1) % sides, tip) for i in range(sides)]
    faces.append(tuple(range(sides - 1, -1, -1)))
    return verts, faces


def revolve(profile, segments: int = 20):
    """A closed surface of revolution about Z from a closed (r, z) cross-section.

    Points with ``r == 0`` collapse onto a single pole vertex, which
    ``remove_doubles`` in :meth:`Part.emit` then welds — so a profile may open
    and close on the axis freely.
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
            faces.append(
                (
                    s * count + p,
                    s * count + p_next,
                    s_next * count + p_next,
                    s_next * count + p,
                )
            )
    return verts, faces


def sweep_path(points, radius: float, sides: int = 5, up=(0.0, 0.0, 1.0), closed: bool = True):
    """A round tube swept along a planar path — a chain link, a rope, a hoop.

    The path is planar by construction in every caller here, so the frame is
    the honest cheap one: tangent × plane-normal. No parallel transport.

    An open path (``closed=False``) gets a fan cap at each end. Sweeping one as
    a loop instead looks like it works and does not: the return leg lands on
    the outward leg vertex for vertex, ``remove_doubles`` welds the two, and
    what comes out is a tube with two open ends and no cap.
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
            verts.append(
                tuple(p + side * (math.cos(angle) * radius) + normal * (math.sin(angle) * radius))
            )
    span = count if closed else count - 1
    for i in range(span):
        i_next = (i + 1) % count
        for k in range(sides):
            k_next = (k + 1) % sides
            faces.append(
                (i * sides + k, i * sides + k_next, i_next * sides + k_next, i_next * sides + k)
            )
    if not closed:
        faces.append(tuple(range(sides - 1, -1, -1)))
        faces.append(tuple(range((count - 1) * sides, count * sides)))
    return verts, faces


def extrude_outline(outline, depth: float, centre=(0.0, 0.0)):
    """A solid prism from a closed 2-D outline in the XZ plane, extruded along Y.

    Caps are fans from ``centre``, which avoids handing the glTF exporter a
    concave n-gon to triangulate — and a bad triangulation of a shield or a
    swallow-tailed pennant is very visible. Every caller's outline is
    star-shaped about the centre it passes.
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
        faces.append((i, j, count + j, count + i))
        faces.append((j, i, front_c))
        faces.append((count + i, count + j, back_c))
    return verts, faces


def planar_uvs(verts, faces, lo=None, hi=None):
    """UVs for **every** face, projected straight along −Y onto the XZ plane.

    For the flat painted things a castle is full of — a tapestry's picture, a
    banner's charge, a shield's device, a portrait's canvas. The whole part
    takes one UV layout in its own local space, so the texture is baked into
    *this* surface and there is no second mesh whose position has to keep
    agreeing with it (CLAUDE.md's hood-face rule, and ART_DIRECTION §7's
    restatement of it for authored geometry).

    Side faces come out with the UVs of the silhouette they run along, which
    for a 3–15 cm thick prism reads as the picture wrapping round its own
    edge. That is what a real hanging does, and it costs nothing.

    ``lo``/``hi`` default to the passed geometry's own bounds; pass them to map
    several primitives into one shared frame.
    """
    if lo is None or hi is None:
        xs = [v[0] for v in verts]
        zs = [v[2] for v in verts]
        lo = (min(xs), 0.0, min(zs)) if lo is None else lo
        hi = (max(xs), 0.0, max(zs)) if hi is None else hi
    width = max(hi[0] - lo[0], 1e-6)
    height = max(hi[2] - lo[2], 1e-6)
    return [
        [((verts[i][0] - lo[0]) / width, (verts[i][2] - lo[2]) / height) for i in face]
        for face in faces
    ]


def quad_uvs(u0=0.0, v0=0.0, u1=1.0, v1=1.0):
    """The four corners of a UV rectangle, in :func:`plane`'s own face order."""
    return [(u0, v0), (u1, v0), (u1, v1), (u0, v1)]


def plane(sx: float, sz: float, y: float = 0.0):
    """A single quad in the XZ plane facing **−Y** — the game's +Z, i.e. forward.

    For the one thing that genuinely is a flat painted surface: a tapestry's
    cloth, a portrait's canvas, a cobweb. Winding is chosen so the visible face
    points at the player, which is the whole of the hood-face bug in one line
    (CLAUDE.md): a plane wound the other way is culled by ``FrontSide`` and is
    then invisible in the game while looking perfect in the outliner.
    """
    hx, hz = sx * 0.5, sz * 0.5
    verts = [(-hx, y, -hz), (hx, y, -hz), (hx, y, hz), (-hx, y, hz)]
    return verts, [(0, 3, 2, 1)]


# =============================================================================
# Reporting
# =============================================================================


def summarise(objects=None) -> str:
    """A per-object table of size and triangle count, for the build log.

    Printed by every build script because these are the numbers the *other*
    agent needs — the one placing the asset — and a build log is the one place
    they cannot be stale.
    """
    rows = []
    source = objects if objects is not None else bpy.data.objects
    for obj in sorted(source, key=lambda o: o.name):
        if obj.type != "MESH":
            continue
        mesh = obj.data
        mesh.calc_loop_triangles()
        lo = Vector((1e9, 1e9, 1e9))
        hi = Vector((-1e9, -1e9, -1e9))
        for v in mesh.vertices:
            lo = Vector((min(lo[i], v.co[i]) for i in range(3)))
            hi = Vector((max(hi[i], v.co[i]) for i in range(3)))
        size = hi - lo
        rows.append(
            f"  {obj.name:<26} {len(mesh.vertices):>5} v {len(mesh.loop_triangles):>5} t"
            f"   {size.x:6.2f} × {size.y:6.2f} × {size.z:6.2f} m"
            f"   base z {lo.z:+.3f}"
        )
    return "\n".join(rows)


def total_triangles() -> int:
    total = 0
    for obj in bpy.data.objects:
        if obj.type != "MESH":
            continue
        obj.data.calc_loop_triangles()
        total += len(obj.data.loop_triangles)
    return total
