"""Exports the castle interior's dressing to the shipped asset.

    blender --background --factory-startup --python-exit-code 1 \
        --python art/blend/castle_dressing_export.py

``castle_dressing_build.py`` writes ``art/blend/castleDressing.blend``; this
reads it back and writes ``src/art/assets/castleDressing.glb``. Same split, and
the same reasoning, as ``hotel_build.py`` / ``hotel_export.py``: the build is
slow and assertive, the export is fast and dumb, and a colour tweak in the
TypeScript never needs either of them.

``--background --factory-startup`` deliberately: this must never touch a running
interactive Blender, which on this project is a shared instance another agent
may be modelling in.
"""

import os
import sys
import traceback

import bpy

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
GLB = os.path.join(REPO, "src", "art", "assets", "castleDressing.glb")
BLEND = os.path.join(REPO, "art", "blend", "castleDressing.blend")


def export() -> None:
    bpy.ops.export_scene.gltf(
        filepath=GLB,
        export_format="GLB",
        use_selection=False,
        # Shape and nothing else. Every colour in this asset — the iron, the
        # gold, the flame's emissive lift, the cloth a picture is painted on —
        # comes from `PALETTE`/`ART` in `src/art/models/castleDressing.ts`,
        # exactly as it does for the kid's skin and the hotel's windows.
        export_materials="NONE",
        export_normals=True,
        # **Unlike every earlier asset in this pipeline, texcoords are on.**
        # The tapestry, the banner, the shield and the portrait carry a
        # painted picture in their own UV space (ART_DIRECTION §7's rule for
        # appliqué on authored geometry), and without UVs there is nothing for
        # the canvas texture to land on.
        export_texcoords=True,
        export_tangents=False,
        export_cameras=False,
        export_lights=False,
        export_extras=False,
        export_animations=False,
        export_skins=False,
        # Every part is authored at an identity transform with its placement
        # baked into vertices, so there is nothing here for `export_apply` to
        # decide; left False to match the other export scripts rather than
        # differ for no reason.
        export_apply=False,
        export_yup=True,
    )


def main() -> None:
    bpy.ops.wm.open_mainfile(filepath=BLEND)
    print("\ncastle_dressing_export — from", BLEND)
    meshes = [obj for obj in bpy.data.objects if obj.type == "MESH"]
    assert meshes, f"{BLEND} has no meshes — run castle_dressing_build.py first"
    for obj in sorted(meshes, key=lambda o: o.name):
        assert obj.matrix_world.is_identity, (
            f"{obj.name} leaves Blender at a non-identity transform; ASSET_MANIFEST's "
            "contract is that placement is baked into vertex positions, and "
            "export_apply is False so this one would ship displaced"
        )
    export()
    print(f"  {len(meshes)} nodes exported")
    print("  wrote", GLB, f"({os.path.getsize(GLB)} bytes)\n")


if __name__ == "__main__":
    try:
        main()
    except Exception:
        traceback.print_exc()
        sys.exit(1)
