"""Exports the Library kit to the shipped asset.

    blender --background --factory-startup --python-exit-code 1 \
        --python art/blend/library_export.py

``library_build.py`` writes ``art/blend/library.blend``; this reads it back and
writes ``src/art/assets/library.glb``. Same split, and the same reasoning, as
``castle_export.py``: the build is slow and assertive, the export is fast and
dumb, and a colour tweak in the TypeScript never needs either of them.

``--background --factory-startup`` deliberately: this must never touch a
running interactive Blender, which on this project is a shared instance
another agent may be modelling in.
"""

import math
import os
import sys
import traceback

import bpy

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
GLB = os.path.join(REPO, "src", "art", "assets", "library.glb")
BLEND = os.path.join(REPO, "art", "blend", "library.blend")

# The three heads whose UVs carry a painted face. Every other node ships with
# no texcoords at all, so a UV layer turning up anywhere else is a mistake.
FACED = {"owl-head", "dragon-head", "cat-head"}


def export() -> None:
    bpy.ops.export_scene.gltf(
        filepath=GLB,
        export_format="GLB",
        use_selection=False,
        # Shape and nothing else: every colour, the glow of the lamp shades
        # and the painted faces belong to the Engineer's TypeScript.
        export_materials="NONE",
        export_normals=True,
        # On for the three faced heads; the other nodes have no UV layer and
        # so export none.
        export_texcoords=True,
        export_tangents=False,
        export_cameras=False,
        export_lights=False,
        export_extras=False,
        export_animations=False,
        export_skins=False,
        export_apply=False,
        export_yup=True,
    )


def main() -> None:
    bpy.ops.wm.open_mainfile(filepath=BLEND)
    print("\nlibrary_export — from", BLEND)
    meshes = [obj for obj in bpy.data.objects if obj.type == "MESH"]
    assert meshes, f"{BLEND} has no meshes — run library_build.py first"
    for obj in sorted(meshes, key=lambda o: o.name):
        # GLTFLoader deletes full stops from node names (ART-AGENT-NOTES §6a).
        assert "." not in obj.name, f"{obj.name}: a dotted node name loads back renamed"
        # A node may carry a pure translation (a hinge or a joint) and nothing
        # else. A stray rotation or scale is always a mistake.
        location, rotation, scale = obj.matrix_world.decompose()
        assert max(abs(scale[i] - 1.0) for i in range(3)) < 1e-6, (
            f"{obj.name} leaves Blender scaled {tuple(round(v, 4) for v in scale)}"
        )
        assert abs(rotation.angle) < 1e-6, (
            f"{obj.name} leaves Blender rotated by {math.degrees(rotation.angle):.3f}°"
        )
        has_uv = len(obj.data.uv_layers) > 0
        assert has_uv == (obj.name in FACED), (
            f"{obj.name}: {'has' if has_uv else 'lacks'} a UV layer, and only "
            f"{sorted(FACED)} should carry one"
        )
        if location.length > 1e-6:
            print(f"  {obj.name}: node origin at ({location.x:+.3f}, {location.y:+.3f}, "
                  f"{location.z:+.3f}) — a joint, placed by its own origin")
    export()
    print(f"  {len(meshes)} nodes exported")
    print("  wrote", GLB, f"({os.path.getsize(GLB)} bytes)\n")


if __name__ == "__main__":
    try:
        main()
    except Exception:
        traceback.print_exc()
        sys.exit(1)
