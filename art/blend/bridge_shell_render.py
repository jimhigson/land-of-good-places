"""Renders a *built* bridge — the geometry the game actually draws — for the eye.

    blender --background --factory-startup --python art/blend/bridge_shell_render.py \
        -- <bridge.obj> [<bridge.obj> ...]

Companion to ``bridge_shell_dump.mts``, which writes those OBJs straight out of
the real park. Issue #489's missing parapet is in the *swept* masonry shell
(``src/world/train/bridges.ts``), not in the authored stone kit, so
``bridge_stones_render.py`` — which assembles a preview bridge out of
``bridgeStones.blend`` — structurally cannot show it. This renders the real
thing instead.

**No number in this file is a bridge dimension.** The dump is already in the
bridge's own frame (+X across, +Z along in three.js, so +X across and −Y along
once Blender's OBJ importer has turned Y-up into Z-up), and every camera below
is placed from the *imported geometry's own bounding box*. There is therefore
nothing here to drift out of step with the game the way
``bridge_stones_render.py``'s hand-copied constants once did — the geometry is
the constant.

Colour is deliberately not the game's palette: the stone is flat grey and the
sky behind it is saturated orange, because the question these renders answer
is "is there a hole", and a hole is only obvious when whatever is behind it
looks nothing like stone. For how the bridge is *meant* to look, use
``pnpm run render:bridge``.

Renders land in ``art/renders/`` as ``<obj stem>-<shot>.png``.
"""

import os
import sys

import bpy
from mathutils import Vector

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
RENDERS = os.path.join(REPO, "art", "renders")


def reset_scene() -> None:
    bpy.context.preferences.filepaths.save_version = 0
    for obj in list(bpy.data.objects):
        bpy.data.objects.remove(obj, do_unlink=True)
    for block in (bpy.data.meshes, bpy.data.materials, bpy.data.collections):
        for item in list(block):
            block.remove(item)


def flat_material(name: str, rgb, emission: float = 0.0):
    mat = bpy.data.materials.get(name)
    if mat:
        return mat
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = (*rgb, 1.0)
    bsdf.inputs["Roughness"].default_value = 0.9
    bsdf.inputs["Specular IOR Level"].default_value = 0.05
    if emission:
        bsdf.inputs["Emission Color"].default_value = (*rgb, 1.0)
        bsdf.inputs["Emission Strength"].default_value = emission
    return mat


#: Flat greys per mesh name, so the parts of the bridge can be told apart in a
#: still. Not the game's stone colours — see the module docstring.
PART_COLOUR = {
    "shell": (0.55, 0.53, 0.50),
    "wallTop": (0.62, 0.60, 0.57),
    "coping": (0.72, 0.70, 0.66),
    "archRing": (0.44, 0.42, 0.40),
}


def import_obj(path: str) -> list:
    before = set(bpy.data.objects)
    bpy.ops.wm.obj_import(filepath=path)
    imported = [o for o in bpy.data.objects if o not in before]
    for obj in imported:
        # The dump writes one OBJ object per drawn mesh, keeping the game's own
        # names, so a shot can be read part by part.
        stem = obj.name.split(".")[0]
        colour = PART_COLOUR.get(stem, (0.5, 0.5, 0.5))
        obj.data.materials.clear()
        obj.data.materials.append(flat_material(f"part-{stem}", colour))
        for face in obj.data.polygons:
            face.use_smooth = False
    return imported


def backdrop(bounds_min: Vector, bounds_max: Vector) -> None:
    """A saturated wall behind the bridge, so daylight through the masonry is
    unmistakable in a still. Placed off the geometry's own extent."""
    size = max(bounds_max.x - bounds_min.x, bounds_max.z - bounds_min.z) * 4 + 20
    mesh = bpy.data.meshes.new("backdrop")
    y = bounds_max.y + 6.0
    half = size / 2
    mid = (bounds_min + bounds_max) / 2
    mesh.from_pydata(
        [
            (mid.x - half, y, mid.z - half),
            (mid.x + half, y, mid.z - half),
            (mid.x + half, y, mid.z + half),
            (mid.x - half, y, mid.z + half),
        ],
        [],
        [(0, 1, 2, 3)],
    )
    mesh.validate()
    mesh.materials.append(flat_material("backdrop", (0.95, 0.35, 0.05), emission=1.4))
    bpy.context.scene.collection.objects.link(bpy.data.objects.new("backdrop", mesh))


def look_at(obj, target: Vector) -> None:
    obj.rotation_euler = (obj.location - target).to_track_quat("Z", "Y").to_euler()


def setup_render():
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE_NEXT" if hasattr(
        bpy.types, "RenderEngineEeveeNext"
    ) else "BLENDER_EEVEE"
    scene.render.resolution_x = 1400
    scene.render.resolution_y = 900
    scene.render.film_transparent = False
    # 8-bit RGB, fully compressed. Blender's default 16-bit RGBA writes 1.2 MB
    # for a still that is mostly two flat colours, and these are committed —
    # a megabyte of unused alpha and low bits per render is a repository cost
    # with nothing bought.
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGB"
    scene.render.image_settings.color_depth = "8"
    scene.render.image_settings.compression = 100
    # And no dither. It exists to hide banding in a gradient; there are no
    # gradients here, only flat toon-ish faces, so all it does is scatter
    # per-pixel noise through them and defeat PNG's row filters — 770 KB a
    # still instead of 40 KB, for a difference no eye can find.
    scene.render.dither_intensity = 0.0

    world = bpy.data.worlds.new("preview")
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs[0].default_value = (0.95, 0.45, 0.10, 1)
    world.node_tree.nodes["Background"].inputs[1].default_value = 1.2
    scene.world = world

    sun_data = bpy.data.lights.new("sun", type="SUN")
    sun_data.energy = 4.0
    sun = bpy.data.objects.new("sun", sun_data)
    scene.collection.objects.link(sun)
    sun.rotation_euler = (0.9, 0.0, 0.7)

    cam_data = bpy.data.cameras.new("cam")
    cam = bpy.data.objects.new("cam", cam_data)
    scene.collection.objects.link(cam)
    scene.camera = cam
    return cam


def bounds(objects) -> tuple:
    lo = Vector((1e9, 1e9, 1e9))
    hi = Vector((-1e9, -1e9, -1e9))
    for obj in objects:
        for corner in obj.bound_box:
            world = obj.matrix_world @ Vector(corner)
            lo = Vector((min(lo[i], world[i]) for i in range(3)))
            hi = Vector((max(hi[i], world[i]) for i in range(3)))
    return lo, hi


def shots(lo: Vector, hi: Vector) -> dict:
    """Cameras derived from the geometry, never from typed dimensions.

    Blender axes after the OBJ import: +X across the bridge, ±Y along it,
    +Z up. The bridge is centred on its own crown at the origin.
    """
    top = hi.z
    across = hi.x
    length = hi.y - lo.y
    return {
        # Standing beside the near parapet at the crown, at a walker's eye
        # height, looking along it — issue #489's own view.
        "parapet": (
            Vector((across + 5.5, -6.0, top + 1.0)),
            Vector((0.0, 0.0, top - 0.5)),
            45.0,
        ),
        # Square on the near flank at the crown: the band of wall over the
        # arch, with the backdrop showing through it if it is missing.
        "flank": (
            Vector((across + 9.0, 0.0, top - 0.2)),
            Vector((0.0, 0.0, top - 0.6)),
            50.0,
        ),
        # The game's own 45 degree iso, pulled back to hold the whole bridge.
        "iso": (
            Vector((length * 0.55, -length * 0.55, top + length * 0.42)),
            Vector((0.0, 0.0, top - 1.0)),
            45.0,
        ),
        # The tunnel mouth, so the voussoir ring and the wall above it are in
        # one frame — "the ring stands proud with nothing above it".
        "mouth": (
            Vector((0.0, -length * 0.35, top - 0.3)),
            Vector((0.0, 0.0, top - 1.2)),
            42.0,
        ),
    }


def main() -> None:
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    if not argv:
        raise SystemExit(
            "give me at least one OBJ from art/blend/bridge_shell_dump.mts"
        )

    os.makedirs(RENDERS, exist_ok=True)
    for path in argv:
        reset_scene()
        imported = import_obj(path)
        if not imported:
            raise SystemExit(f"{path} imported nothing")
        lo, hi = bounds(imported)
        backdrop(lo, hi)
        cam = setup_render()
        stem = os.path.splitext(os.path.basename(path))[0]
        print(f"\nbridge_shell_render {stem}")
        print(f"  {len(imported)} parts: {', '.join(o.name for o in imported)}")
        print(f"  extent x {lo.x:.2f}..{hi.x:.2f}  y {lo.y:.2f}..{hi.y:.2f}  "
              f"z {lo.z:.2f}..{hi.z:.2f}")
        for name, (pos, target, lens) in shots(lo, hi).items():
            cam.location = pos
            cam.data.lens = lens
            look_at(cam, target)
            out = os.path.join(RENDERS, f"{stem}-{name}.png")
            bpy.context.scene.render.filepath = out
            bpy.ops.render.render(write_still=True)
            print(f"  wrote {out}")
    print()


if __name__ == "__main__":
    main()
