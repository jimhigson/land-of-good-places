"""Builds the bridge's stone kit and saves ``art/blend/bridgeStones.blend``.

    blender --background --factory-startup --python art/blend/bridge_stones_build.py

Three stones — one coping block, one voussoir, one keystone — that
``src/world/train/bridges.ts`` repeats along a parapet and around a tunnel
mouth. See ``src/art/models/bridgeStones.ts`` for why the bridge ships as a
*kit* rather than as one model: its span, ramps and crown are solved per
crossing and it follows the drawn path's own curve, so no single rigid ``.glb``
could be it.

Like ``hotel_build.py`` and unlike ``cart.blend``, **this script is the
authoring source** and ``bridgeStones.blend`` is a generated artefact. Do not
hand-edit the .blend; the next run overwrites it. Then
``bridge_stones_export.py`` writes the ``.glb`` (``npm run blend:bridge-stones``
does both plus the pack step).

## Conventions (ART_DIRECTION §7, ASSET_MANIFEST's shared contract)

* 1 Blender unit = 1 metre.
* **Blender −Y is the game's +Z.** The glTF exporter's ``export_yup`` maps
  Blender (x, y, z) → glTF (x, z, −y). So a part whose "forward" matters is
  built facing −Y here.
* Every part leaves Blender at an identity transform, with its placement baked
  into vertex positions, and each lives in its own collection.
* No randomness: variety in the built park comes from where ``bridges.ts``
  puts these stones, never from the stones themselves.

## The two local frames

**``coping``** — the block a parapet is capped with. +Z up, running direction
along Y (so the game gets it running along +Z, its forward), width across X.
Origin at the base, centred on X and Y: the contract's origin rule, and the
thing ``bridges.ts`` sits on the parapet top.

**``voussoir`` / ``keystone``** — modelled *as the crown stone of the arch*,
which is the one position in a ring where the stone's own axes and the world's
agree. +Z is radially outward (up, at the crown); X is tangential; −Y is out of
the tunnel mouth, i.e. the game's forward. Origin at the middle of the
intrados (inner) face, so ``bridges.ts`` places a stone by putting that origin
on the arch curve and rotating about the arch's own centre — no offset to get
wrong.

The side faces are cut as planes through the arch centre, so a ring of these
closes on itself. They are cut for the **haunch** radius
(``VOUSSOIR_TAPER_RADIUS``), the tightest part of the three-centred curve: on
the flatter crown arc adjacent stones then overlap by about a centimetre at
their outer edge rather than gapping. Overlaps hide; gaps show.
"""

import math
import os
import re

import bmesh
import bpy
from mathutils import Vector

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
BLEND = os.path.join(REPO, "art", "blend", "bridgeStones.blend")


def ts_const(relative_path: str, name: str) -> float:
    """Read `export const NAME = <number>;` out of one of the game's TypeScript
    modules, and fail loudly if it is not there exactly once.

    Same helper, same reasoning, as ``hotel_build.py``'s: the owner of every
    number this kit is cut to is `src/art/models/bridgeStones.ts`, and typing
    the figures in here as well would be CLAUDE.md's "two definitions of one
    thing" in its purest form — found wrong by a child looking at a gap in a
    wall, one retune after the number moved.
    """
    path = os.path.join(REPO, relative_path)
    with open(path, encoding="utf-8") as handle:
        source = handle.read()
    found = re.findall(
        rf"^export const {name} = (-?\d+(?:\.\d+)?);\s*$", source, flags=re.MULTILINE
    )
    assert len(found) == 1, (
        f"{relative_path} must declare `export const {name} = <number>;` exactly once "
        f"and declares it {len(found)} times — this asset is cut to that number and "
        "cannot guess it"
    )
    return float(found[0])


STONES = "src/art/models/bridgeStones.ts"
FOOTPRINT = "src/world/train/bridgeFootprint.ts"

COPING_LENGTH = ts_const(STONES, "COPING_LENGTH")
COPING_JOINT = ts_const(STONES, "COPING_JOINT")
COPING_OVERHANG = ts_const(STONES, "COPING_OVERHANG")
COPING_HEIGHT = ts_const(STONES, "COPING_HEIGHT")
COPING_TOP_INSET = ts_const(STONES, "COPING_TOP_INSET")
VOUSSOIR_DEPTH = ts_const(STONES, "VOUSSOIR_DEPTH")
VOUSSOIR_PROUD = ts_const(STONES, "VOUSSOIR_PROUD")
VOUSSOIR_SUNK = ts_const(STONES, "VOUSSOIR_SUNK")
VOUSSOIR_PITCH = ts_const(STONES, "VOUSSOIR_PITCH")
VOUSSOIR_JOINT = ts_const(STONES, "VOUSSOIR_JOINT")
VOUSSOIR_TAPER_RADIUS = ts_const(STONES, "VOUSSOIR_TAPER_RADIUS")
KEYSTONE_PITCH = ts_const(STONES, "KEYSTONE_PITCH")
KEYSTONE_DEPTH = ts_const(STONES, "KEYSTONE_DEPTH")
KEYSTONE_PROUD = ts_const(STONES, "KEYSTONE_PROUD")
WALL_THICKNESS = ts_const(FOOTPRINT, "BRIDGE_WALL_THICKNESS")

# A chamfer, not a rounding. One segment at 2 cm: enough for the toon ramp to
# catch a highlight along every arris so a block reads as a block, small enough
# that the silhouette stays square — which is the half of "reads as stone" the
# lighting cannot do.
CHAMFER = 0.02


# =============================================================================
# Scene plumbing
# =============================================================================


def reset_scene() -> None:
    """Empties the factory-startup scene — cube, camera, light and all."""
    # No `.blend1` backup: the Python is the source, and a 100 KB binary
    # landing untracked in `git status` after every run helps nobody.
    bpy.context.preferences.filepaths.save_version = 0
    for obj in list(bpy.data.objects):
        bpy.data.objects.remove(obj, do_unlink=True)
    for block in (bpy.data.meshes, bpy.data.materials, bpy.data.collections):
        for item in list(block):
            block.remove(item)


def emit(name: str, verts, faces) -> bpy.types.Object:
    """One named object from a vertex/face list, chamfered and shaded."""
    coll = bpy.data.collections.new(name)
    bpy.context.scene.collection.children.link(coll)

    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata([tuple(v) for v in verts], [], [tuple(f) for f in faces])
    mesh.validate(verbose=False)

    bm = bmesh.new()
    bm.from_mesh(mesh)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-6)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bmesh.ops.bevel(
        bm,
        geom=list(bm.verts) + list(bm.edges) + list(bm.faces),
        offset=CHAMFER,
        segments=1,
        affect="EDGES",
        clamp_overlap=True,
    )
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    # Flat everywhere. These are dressed blocks; a smoothed chamfer would read
    # as a pebble, which is the opposite of the brief.
    for face in bm.faces:
        face.smooth = False
    bm.to_mesh(mesh)
    bm.free()

    obj = bpy.data.objects.new(name, mesh)
    coll.objects.link(obj)
    return obj


def box(x0, x1, y0, y1, z0, z1):
    """An axis-aligned box as (verts, faces)."""
    verts = [
        (x0, y0, z0), (x1, y0, z0), (x1, y1, z0), (x0, y1, z0),
        (x0, y0, z1), (x1, y0, z1), (x1, y1, z1), (x0, y1, z1),
    ]
    faces = [
        (0, 3, 2, 1), (4, 5, 6, 7),
        (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7),
    ]
    return verts, faces


# =============================================================================
# The stones
# =============================================================================


def build_coping() -> None:
    """The parapet's capping block.

    A frustum, not a box: the top face is inset ``COPING_TOP_INSET`` all round,
    which on a real coping sheds rain and here gives the toon ramp four sloped
    faces to shade differently from the vertical wall below. Together with the
    overhang, that is what makes a capped wall read as capped from the game's
    45° camera instead of as a wall that stops.
    """
    half_x = WALL_THICKNESS / 2 + COPING_OVERHANG
    half_y = (COPING_LENGTH - COPING_JOINT) / 2
    top_x = half_x - COPING_TOP_INSET
    top_y = half_y - COPING_TOP_INSET

    verts = [
        (-half_x, -half_y, 0.0), (half_x, -half_y, 0.0),
        (half_x, half_y, 0.0), (-half_x, half_y, 0.0),
        (-top_x, -top_y, COPING_HEIGHT), (top_x, -top_y, COPING_HEIGHT),
        (top_x, top_y, COPING_HEIGHT), (-top_x, top_y, COPING_HEIGHT),
    ]
    faces = [
        (0, 3, 2, 1), (4, 5, 6, 7),
        (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7),
    ]
    emit("coping", verts, faces)


def wedge(pitch: float, joint: float, depth: float, proud: float, sunk: float):
    """One arch stone, cut for a ring of radius ``VOUSSOIR_TAPER_RADIUS``.

    ``pitch`` is the stone's share of the intrados arc, joint included; the
    joint is taken off it. The two side faces are planes through the arch
    centre — that, and nothing else, is what lets a ring of these close.
    """
    radius = VOUSSOIR_TAPER_RADIUS
    half_angle = (pitch - joint) / (2 * radius)
    spread = math.tan(half_angle)
    inner = radius * spread
    outer = (radius + depth) * spread

    # −Y is the game's +Z: the stone stands proud out of the tunnel mouth.
    y0, y1 = -proud, sunk
    verts = [
        (-inner, y0, 0.0), (inner, y0, 0.0), (inner, y1, 0.0), (-inner, y1, 0.0),
        (-outer, y0, depth), (outer, y0, depth), (outer, y1, depth), (-outer, y1, depth),
    ]
    faces = [
        (0, 3, 2, 1), (4, 5, 6, 7),
        (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7),
    ]
    return verts, faces


def build_voussoir() -> None:
    verts, faces = wedge(
        VOUSSOIR_PITCH, VOUSSOIR_JOINT, VOUSSOIR_DEPTH, VOUSSOIR_PROUD, VOUSSOIR_SUNK
    )
    emit("voussoir", verts, faces)


def build_keystone() -> None:
    """The crown stone: wider, deeper and standing further out than a voussoir.

    All three at once, deliberately. One of them alone reads as a mistake in
    the ring; all three read as *the keystone*, which is the one stone in an
    arch a six-year-old can name.
    """
    verts, faces = wedge(
        KEYSTONE_PITCH, VOUSSOIR_JOINT, KEYSTONE_DEPTH, KEYSTONE_PROUD, VOUSSOIR_SUNK
    )
    emit("keystone", verts, faces)


# =============================================================================


def summarise() -> str:
    rows = []
    for obj in sorted(bpy.data.objects, key=lambda o: o.name):
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
            f"  {obj.name:<10} {len(mesh.vertices):>4} verts {len(mesh.loop_triangles):>4} tris"
            f"   {size.x:.3f} × {size.y:.3f} × {size.z:.3f} m"
            f"   base z {lo.z:+.3f}"
        )
    return "\n".join(rows)


def main() -> None:
    reset_scene()
    build_coping()
    build_voussoir()
    build_keystone()

    print("\nbridge_stones_build")
    print(summarise())

    bpy.ops.wm.save_as_mainfile(filepath=BLEND)
    print(f"  saved {BLEND} ({os.path.getsize(BLEND)} bytes)\n")


if __name__ == "__main__":
    main()
