"""Exports the doorway-frame kit to the shipped asset.

    blender --background --factory-startup --python-exit-code 1 \
        --python art/blend/doorframes_export.py

``doorframes_build.py`` writes ``art/blend/doorframes.blend``; this reads it
back and writes ``src/art/assets/doorframes.glb``. The same split as every
kit here: the build is slow and assertive, the export fast and dumb.

``--background --factory-startup`` deliberately: this must never touch the
running interactive Blender another agent may be modelling in.
"""

import math
import os
import sys
import traceback

import bpy

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
GLB = os.path.join(REPO, "src", "art", "assets", "doorframes.glb")
BLEND = os.path.join(REPO, "art", "blend", "doorframes.blend")


def export() -> None:
    bpy.ops.export_scene.gltf(
        filepath=GLB,
        export_format="GLB",
        use_selection=False,
        # Shape and nothing else: every colour belongs to the loader.
        export_materials="NONE",
        export_normals=True,
        export_texcoords=False,
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
    print("\ndoorframes_export — from", BLEND)
    meshes = [obj for obj in bpy.data.objects if obj.type == "MESH"]
    assert meshes, f"{BLEND} has no meshes — run doorframes_build.py first"
    for obj in sorted(meshes, key=lambda o: o.name):
        # GLTFLoader deletes full stops from node names (ART-AGENT-NOTES §6a).
        assert "." not in obj.name, f"{obj.name}: a dotted node name loads back renamed"
        assert obj.name.startswith("doorframe-"), f"{obj.name}: not a doorframe-<style>-<role> node"
        # No pivots in this kit: every node leaves at an identity transform.
        location, rotation, scale = obj.matrix_world.decompose()
        assert max(abs(scale[i] - 1.0) for i in range(3)) < 1e-6, f"{obj.name} leaves Blender scaled"
        assert abs(rotation.angle) < 1e-6, f"{obj.name} leaves Blender rotated by {math.degrees(rotation.angle):.3f}°"
        assert location.length < 1e-6, f"{obj.name} leaves Blender translated; this kit has no pivots"
        assert not obj.data.uv_layers, f"{obj.name} has a UV layer; nothing in this kit is painted"
        assert not set(obj.keys()) and not set(obj.data.keys()), f"{obj.name} carries custom properties"
    export()
    print(f"  {len(meshes)} nodes exported")
    print("  wrote", GLB, f"({os.path.getsize(GLB)} bytes)\n")


if __name__ == "__main__":
    try:
        main()
    except Exception:
        traceback.print_exc()
        sys.exit(1)
