"""Exports the Library's secret den kit to the shipped asset.

    blender --background --factory-startup --python-exit-code 1 \
        --python art/blend/library_den_export.py

``library_den_build.py`` writes ``art/blend/libraryDen.blend``; this reads it
back and writes ``src/art/assets/libraryDen.glb``. The same split, for the same
reasons, as ``library_export.py``: the build is slow and assertive, the export
is fast and dumb, and a colour tweak in the TypeScript never needs either.

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
GLB = os.path.join(REPO, "src", "art", "assets", "libraryDen.glb")
BLEND = os.path.join(REPO, "art", "blend", "libraryDen.blend")


def export() -> None:
    bpy.ops.export_scene.gltf(
        filepath=GLB,
        export_format="GLB",
        use_selection=False,
        # Shape and nothing else: every colour and glow is the Engineer's.
        export_materials="NONE",
        export_normals=True,
        # Nothing in this kit carries a painted face, so nothing carries a UV
        # layer (asserted below) and no texcoords ship.
        export_texcoords=False,
        export_tangents=False,
        export_cameras=False,
        export_lights=False,
        # No custom property rides out of this kit: asserted below, so the
        # exporter has nothing to carry.
        export_extras=False,
        export_animations=False,
        export_skins=False,
        export_apply=False,
        export_yup=True,
    )


def main() -> None:
    bpy.ops.wm.open_mainfile(filepath=BLEND)
    print("\nlibrary_den_export — from", BLEND)
    meshes = [obj for obj in bpy.data.objects if obj.type == "MESH"]
    assert meshes, f"{BLEND} has no meshes — run library_den_build.py first"
    for block in (bpy.data.scenes, bpy.data.collections):
        for item in block:
            assert not set(item.keys()), f"{item.name} carries custom properties"
    for obj in sorted(meshes, key=lambda o: o.name):
        # GLTFLoader deletes full stops from node names (ART-AGENT-NOTES §6a).
        assert "." not in obj.name, f"{obj.name}: a dotted node name loads back renamed"
        # No pivots in this kit: every node leaves at the identity.
        location, rotation, scale = obj.matrix_world.decompose()
        assert location.length < 1e-6, f"{obj.name} leaves Blender translated by {tuple(round(v, 4) for v in location)}"
        assert max(abs(scale[i] - 1.0) for i in range(3)) < 1e-6, (
            f"{obj.name} leaves Blender scaled {tuple(round(v, 4) for v in scale)}"
        )
        assert abs(rotation.angle) < 1e-6, (
            f"{obj.name} leaves Blender rotated by {math.degrees(rotation.angle):.3f}°"
        )
        assert not obj.data.uv_layers, f"{obj.name} carries a UV layer, and no node of this kit is painted"
        assert not set(obj.keys()), f"{obj.name} carries custom properties {sorted(obj.keys())}"
        assert not set(obj.data.keys()), f"{obj.name}'s mesh carries custom properties"
    export()
    print(f"  {len(meshes)} nodes exported")
    print("  wrote", GLB, f"({os.path.getsize(GLB)} bytes)\n")


if __name__ == "__main__":
    try:
        main()
    except Exception:
        traceback.print_exc()
        sys.exit(1)
