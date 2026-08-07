"""Exports The Land Hotel from its authoring source to the shipped asset.

    blender --background --factory-startup --python art/blend/hotel_export.py

The same shape of pipeline as ``cart_export.py`` and ``duckbar_export.py``, with
one difference: ``art/blend/hotel.blend`` is **generated** rather than
hand-modelled — ``hotel_build.py`` writes it, and that script is the authoring
source. ``npm run blend:hotel`` runs the pair, then packs the result.

Six assets travel in this one file (tower, bed, disco ball, breakfast set,
reception desk, "yours" door), each part a separately named node so
``src/art/models/hotelAssets.ts`` can colour it. Shape only: no materials, no
textures — colour, the emissive lift on the window rows and every outline stay
in code, exactly as they do for the kid and the cart.

UVs are exported because two nodes need them — ``tower-signboard`` and
``door-plaque``, which code paints words onto. Every other node is a flat
material colour and carries no UV layer at all.

``--background --factory-startup`` deliberately: this must never touch a
running interactive Blender, which on this project is a shared instance
another agent may be modelling in.
"""

import os

import bpy

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
GLB = os.path.join(REPO, "src", "art", "assets", "hotel.glb")
BLEND = os.path.join(REPO, "art", "blend", "hotel.blend")


def export_hotel() -> None:
    bpy.ops.export_scene.gltf(
        filepath=GLB,
        export_format="GLB",
        use_selection=False,
        export_materials="NONE",
        export_normals=True,
        export_texcoords=True,
        export_tangents=False,
        export_cameras=False,
        export_lights=False,
        export_extras=False,
        export_animations=False,
        export_skins=False,
        # Every part's placement is already baked into its vertices by
        # `hotel_build.py`, so each node leaves here at an identity transform.
        # Applying modifiers would change nothing; leaving it off keeps this
        # identical to the other two exporters.
        export_apply=False,
        export_yup=True,
    )


def summarise() -> str:
    rows = []
    total = 0
    for obj in sorted(bpy.data.objects, key=lambda o: o.name):
        if obj.type != "MESH":
            continue
        mesh = obj.data
        total += len(mesh.loop_triangles)
        uvs = ", ".join(layer.name for layer in mesh.uv_layers) or "flat colour"
        rows.append(
            f"  {obj.name:<22} {len(mesh.vertices):>6} verts {len(mesh.loop_triangles):>6} tris  [{uvs}]"
        )
    rows.append(f"  {'TOTAL':<22} {'':>6}       {total:>6} tris")
    return "\n".join(rows)


def main() -> None:
    bpy.ops.wm.open_mainfile(filepath=BLEND)
    for mesh in bpy.data.meshes:
        mesh.calc_loop_triangles()

    print("\nhotel_export — from", BLEND)
    print(summarise())

    export_hotel()
    print("  exported", GLB, f"({os.path.getsize(GLB)} bytes)\n")


if __name__ == "__main__":
    main()
