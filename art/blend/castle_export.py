"""Exports the castle interior's dressing to the shipped asset.

    blender --background --factory-startup --python-exit-code 1 \
        --python art/blend/castle_export.py

``castle_build.py`` writes ``art/blend/castle.blend``; this
reads it back and writes ``src/art/assets/castle.glb``. Same split, and
the same reasoning, as ``hotel_build.py`` / ``hotel_export.py``: the build is
slow and assertive, the export is fast and dumb, and a colour tweak in the
TypeScript never needs either of them.

``--background --factory-startup`` deliberately: this must never touch a running
interactive Blender, which on this project is a shared instance another agent
may be modelling in.
"""

import math
import os
import sys
import traceback

import bpy

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
GLB = os.path.join(REPO, "src", "art", "assets", "castle.glb")
BLEND = os.path.join(REPO, "art", "blend", "castle.blend")


def export() -> None:
    bpy.ops.export_scene.gltf(
        filepath=GLB,
        export_format="GLB",
        use_selection=False,
        # Shape and nothing else. Every colour in this asset — the iron, the
        # gold, the flame's emissive lift, the cloth a picture is painted on —
        # comes from `PALETTE`/`ART` in `src/art/models/castleAssets.ts` (the Engineer's),
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
    print("\ncastle_export — from", BLEND)
    meshes = [obj for obj in bpy.data.objects if obj.type == "MESH"]
    assert meshes, f"{BLEND} has no meshes — run castle_dressing_build.py first"
    for obj in sorted(meshes, key=lambda o: o.name):
        # `export_apply` is False, so whatever transform a node carries is what
        # the game reads back through `src/art/style/glb.ts`. ASSET_MANIFEST's
        # contract is that placement is baked into vertex positions, and every
        # node here obeys it except the chest lid, whose origin has to *be* the
        # hinge axis so opening it is one rotation rather than a pivot offset
        # somebody has to keep in step with the lid's shape.
        #
        # So the rule enforced is the useful one: a node may carry a pure
        # **translation** and nothing else. A stray rotation or scale is always
        # a mistake, and it is the sort that ships looking almost right.
        location, rotation, scale = obj.matrix_world.decompose()
        assert max(abs(scale[i] - 1.0) for i in range(3)) < 1e-6, (
            f"{obj.name} leaves Blender scaled {tuple(round(v, 4) for v in scale)}; "
            "ASSET_MANIFEST reserves scale for the caller's squash-and-stretch"
        )
        assert abs(rotation.angle) < 1e-6, (
            f"{obj.name} leaves Blender rotated by {math.degrees(rotation.angle):.3f}°; "
            "bake the rotation into the vertices"
        )
        if location.length > 1e-6:
            print(
                f"  {obj.name}: node origin at "
                f"({location.x:+.3f}, {location.y:+.3f}, {location.z:+.3f}) — deliberate, "
                "this node is placed by its own origin"
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
