"""Exports the Rail Race duck bar from its authoring source to the shipped asset.

    blender --background --factory-startup --python art/blend/duckbar_export.py

Same shape of pipeline as ``cart_export.py``: no procedural Stage A, modelled
directly against ``src/world/railRace/track.ts``'s and ``hazards.ts``'s own
reference numbers (``DUCK_CLEARANCE``, ``BAR_HALF_SPAN``) in Blender.
``art/blend/duckbar.blend`` **is** the authoring source; this script's only
job is exporting it.

**One real difference from the cart.** The cart is one group of parts built
once per cart and placed at a computed transform. The duck bar's two parts
(``post``, ``bar``) are drawn through `InstancedMesh` — up to a hundred posts
and dozens of bars, one draw call each, at positions `track.ts` computes
fresh every build. So this asset exports **shape only**: both nodes sit at
the origin with an identity transform, and the game reads their geometry
(`duckBarAssetGeometry`), never their node transform, the same way
`kidAssetGeometry`/`cartAssetGeometry` are used where a caller wants shared
geometry rather than a positioned mesh.

``--background --factory-startup`` deliberately: this must never touch a
running interactive Blender, which on this project is a shared instance
another agent may be modelling in.
"""

import os

import bpy

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
GLB = os.path.join(REPO, "src", "art", "assets", "duckbar.glb")
BLEND = os.path.join(REPO, "art", "blend", "duckbar.blend")


def export_duckbar() -> None:
    bpy.ops.export_scene.gltf(
        filepath=GLB,
        export_format="GLB",
        use_selection=False,
        # Shape only. The bar's hazard-tape stripes are a code-side canvas
        # texture (ART_DIRECTION's "shape from the asset, appearance from
        # code" split — same as the kid's skin/hair colour and the cart's
        # lane colour) mapped onto the UVs this file does export.
        export_materials="NONE",
        export_normals=True,
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


def summarise() -> str:
    rows = []
    for obj in sorted(bpy.data.objects, key=lambda o: o.name):
        if obj.type != "MESH":
            continue
        mesh = obj.data
        uvs = ", ".join(layer.name for layer in mesh.uv_layers) or "NO UV"
        rows.append(f"  {obj.name:<8} {len(mesh.vertices):>5} verts {len(mesh.loop_triangles):>5} tris  uv[{uvs}]")
    return "\n".join(rows)


def main() -> None:
    bpy.ops.wm.open_mainfile(filepath=BLEND)
    for mesh in bpy.data.meshes:
        mesh.calc_loop_triangles()

    print("\nduckbar_export — from", BLEND)
    print(summarise())

    export_duckbar()
    print("  exported", GLB, f"({os.path.getsize(GLB)} bytes)\n")


if __name__ == "__main__":
    main()
