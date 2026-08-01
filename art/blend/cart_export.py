"""Exports the Rail Race cart from its authoring source to the shipped asset.

    blender --background --factory-startup --python art/blend/cart_export.py

Unlike ``kid_roundtrip.py``, this cart has no procedural Stage A to bootstrap
from — it was modelled directly against the reference numbers in
``src/world/railRace/cart.ts`` (``WHEEL_RADIUS``, the rail gauge, ``SEAT_HEIGHT``)
using Blender's own primitive + bevel tools, because the whole point of this
asset (see HANDOFF-rail-cart-blender-asset.md) is to stop those numbers living
as hand-tuned procedural TypeScript that has already shipped two live-game
bugs. So ``art/blend/cart.blend`` **is** the authoring source from the start;
this script's only job is exporting it, the same way step 3 of
``kid_roundtrip.py`` does for the kid.

``--background --factory-startup`` deliberately: this must never touch a
running interactive Blender, which on this project is a shared instance
another agent may be modelling in.
"""

import os

import bpy

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
GLB = os.path.join(REPO, "src", "art", "assets", "cart.glb")
BLEND = os.path.join(REPO, "art", "blend", "cart.blend")


def export_cart() -> None:
    bpy.ops.export_scene.gltf(
        filepath=GLB,
        export_format="GLB",
        use_selection=False,
        # The asset carries shape and nothing else: colour (LANE_COLOURS by
        # lane), the headlamp glow material and the outline all stay in code.
        export_materials="NONE",
        export_normals=True,
        export_texcoords=True,
        export_tangents=False,
        export_cameras=False,
        export_lights=False,
        export_extras=False,
        export_animations=False,
        export_skins=False,
        # Leave the transforms alone: a part's own local placement is part of
        # what the asset describes. Applying it would bake every offset into
        # vertices and hand the game twelve meshes all sitting at the origin.
        export_apply=False,
        export_yup=True,
    )


def summarise() -> str:
    rows = []
    for obj in sorted(bpy.data.objects, key=lambda o: o.name):
        if obj.type != "MESH":
            continue
        mesh = obj.data
        rows.append(f"  {obj.name:<12} {len(mesh.vertices):>5} verts {len(mesh.loop_triangles):>5} tris")
    return "\n".join(rows)


def main() -> None:
    bpy.ops.wm.open_mainfile(filepath=BLEND)
    for mesh in bpy.data.meshes:
        mesh.calc_loop_triangles()

    print("\ncart_export — from", BLEND)
    print(summarise())

    export_cart()
    print("  exported", GLB, f"({os.path.getsize(GLB)} bytes)\n")


if __name__ == "__main__":
    main()
