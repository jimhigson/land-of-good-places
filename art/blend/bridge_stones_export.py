"""Exports the bridge's stone kit to the shipped asset.

    blender --background --factory-startup --python art/blend/bridge_stones_export.py

``bridge_stones_build.py`` writes ``art/blend/bridgeStones.blend``; this reads
it back and writes ``src/art/assets/bridgeStones.glb``. Same split, and the
same reasoning, as ``hotel_build.py`` / ``hotel_export.py``.

``--background --factory-startup`` deliberately: this must never touch a
running interactive Blender, which on this project is a shared instance
another agent may be modelling in.
"""

import os

import bpy

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
GLB = os.path.join(REPO, "src", "art", "assets", "bridgeStones.glb")
BLEND = os.path.join(REPO, "art", "blend", "bridgeStones.blend")


def export() -> None:
    bpy.ops.export_scene.gltf(
        filepath=GLB,
        export_format="GLB",
        use_selection=False,
        # Shape and nothing else. The stone colour comes from `PALETTE`
        # in `world/train/bridges.ts`, the same pink the garden walls use.
        export_materials="NONE",
        export_normals=True,
        export_texcoords=False,
        export_tangents=False,
        export_cameras=False,
        export_lights=False,
        export_extras=False,
        export_animations=False,
        export_skins=False,
        # Every stone is authored at an identity transform with its placement
        # baked into vertices, so there is nothing here for `export_apply` to
        # decide; left False to match `cart_export.py` rather than differ for
        # no reason.
        export_apply=False,
        export_yup=True,
    )


def summarise() -> str:
    rows = []
    for obj in sorted(bpy.data.objects, key=lambda o: o.name):
        if obj.type != "MESH":
            continue
        mesh = obj.data
        mesh.calc_loop_triangles()
        rows.append(
            f"  {obj.name:<10} {len(mesh.vertices):>4} verts {len(mesh.loop_triangles):>4} tris"
        )
    return "\n".join(rows)


def main() -> None:
    bpy.ops.wm.open_mainfile(filepath=BLEND)
    print("\nbridge_stones_export — from", BLEND)
    print(summarise())
    export()
    print("  exported", GLB, f"({os.path.getsize(GLB)} bytes)\n")


if __name__ == "__main__":
    main()
