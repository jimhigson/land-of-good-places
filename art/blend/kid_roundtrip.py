"""Brings the kid's body and head into Blender, and writes them back out.

    blender --background --factory-startup --python art/blend/kid_roundtrip.py

This is what makes Blender the **authoring home** for the player kid's
geometry rather than a place it happened to pass through. It

1. imports ``src/art/assets/kid.glb`` — Stage A's bootstrap, generated from
   the procedural code by ``npm run export:kid``;
2. saves ``art/blend/kid.blend``, which from here on is the file an artist
   opens to change the shape of the character; and
3. exports it straight back to ``src/art/assets/kid.glb``, so **the asset the
   game ships is Blender's output**, not the exporter's.

Step 3 is the point. Until the shipped file comes out of Blender, Stage B —
real re-topology — would be a change to a file nothing round-trips, and the
first time anybody exported from Blender they would find out all at once
whatever the round trip does to the geometry. Doing it now, while the answer
is provably "nothing", is the cheap time to find out.

``--background --factory-startup`` deliberately: this must never touch a
running interactive Blender, which on this project is a shared instance
another agent may be modelling in.

Whether the round trip really changed nothing is not this script's opinion —
``npm run check:character-parity`` measures the result against the procedural
build, vertex for vertex.
"""

import os
import sys

import bpy

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
GLB = os.path.join(REPO, "src", "art", "assets", "kid.glb")
BLEND = os.path.join(REPO, "art", "blend", "kid.blend")


def clear_scene() -> None:
    """An empty file, including the startup cube, camera and light."""
    bpy.ops.wm.read_factory_settings(use_empty=True)


def import_kid() -> None:
    bpy.ops.import_scene.gltf(
        filepath=GLB,
        # Off, and it matters. glTF splits a vertex wherever two faces need
        # different normals or different UVs — which is exactly what the UV
        # seam down the back of the skull is. Merging by distance would weld
        # that seam back together, and one quad would then interpolate right
        # across the face texture and smear it round the head.
        merge_vertices=False,
        import_shading="NORMALS",
    )


def export_kid() -> None:
    bpy.ops.export_scene.gltf(
        filepath=GLB,
        export_format="GLB",
        use_selection=False,
        # The asset carries shape and nothing else: materials and textures stay
        # in code so per-child skin, outfit and shoe colour keep working.
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
        # what the asset describes, and applying it would bake every offset
        # into vertices and hand the game fourteen meshes at the origin.
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
        rows.append(
            f"  {obj.name:<14} {len(mesh.vertices):>5} verts "
            f"{len(mesh.loop_triangles):>5} tris  uv[{uvs}]  mesh={mesh.name}"
        )
    return "\n".join(rows)


def main() -> None:
    clear_scene()
    import_kid()
    for mesh in bpy.data.meshes:
        mesh.calc_loop_triangles()

    print("\nkid_roundtrip — imported from", GLB)
    print(summarise())

    bpy.ops.wm.save_as_mainfile(filepath=BLEND)
    print("  saved", BLEND)

    export_kid()
    print("  exported", GLB, f"({os.path.getsize(GLB)} bytes)\n")


if __name__ == "__main__":
    main()
    sys.exit(0)
