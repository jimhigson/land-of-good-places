"""Exports the Reptile House exterior to the shipped asset.

    blender --background --factory-startup --python-exit-code 1 \\
        --python art/blend/reptile_house_export.py

``reptile_house_build.py`` writes ``art/blend/reptile_house.blend``; this reads
it back and writes ``src/art/assets/reptileHouse.glb``. Same split, and the
same reasoning, as ``gate_arch_build.py`` / ``gate_arch_export.py``: the build
is slow and assertive, the export is fast and dumb, and a colour tweak in the
TypeScript needs neither of them.

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
GLB = os.path.join(REPO, "src", "art", "assets", "reptileHouse.glb")
BLEND = os.path.join(REPO, "art", "blend", "reptile_house.blend")

#: Every node the game expects to find. An asset that silently loses a part
#: exports fine and renders a building with no head on it, so the set is
#: asserted here rather than trusted.
EXPECTED = {
    "rh-plinth",
    "rh-coil",
    "rh-coil-belly",
    "rh-coil-spots",
    "rh-house-wall",
    "rh-windows",
    "rh-head",
    "rh-mouth",
    "rh-tongue",
    "rh-tail",
    "rh-tail-bell",
    "rh-sign",
}

#: The nodes that carry a painted canvas, and therefore must ship UVs: Sunny's
#: face, and the sign plank the anchor's lettering goes on.
PAINTED = {"rh-head", "rh-sign"}

#: The one node allowed a (pure translation) transform: its origin is the
#: tongue's root on the mouth's floor, so a wag is a yaw on the node with no
#: pivot arithmetic. The castle chest-lid precedent.
HINGED = {"rh-tongue"}


def export() -> None:
    bpy.ops.export_scene.gltf(
        filepath=GLB,
        export_format="GLB",
        use_selection=False,
        # Shape and nothing else. Every colour — the mint body, the cream
        # greenhouse, the glowing portholes — comes from `PALETTE`/`ART` in
        # `src/art/models/reptileHouseAssets.ts`.
        export_materials="NONE",
        export_normals=True,
        # **On**, and load-bearing: the face and the sign are painted into
        # their own UV space (ART_DIRECTION §3; `src/art/models/CLAUDE.md`).
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
    print("\nreptile_house_export — from", BLEND)
    meshes = [obj for obj in bpy.data.objects if obj.type == "MESH"]
    assert meshes, f"{BLEND} has no meshes — run reptile_house_build.py first"

    names = {obj.name for obj in meshes}
    assert names == EXPECTED, (
        f"node set changed: built but unexpected {sorted(names - EXPECTED)}, "
        f"expected but missing {sorted(EXPECTED - names)}"
    )

    total = 0
    for obj in sorted(meshes, key=lambda o: o.name):
        location, rotation, scale = obj.matrix_world.decompose()
        assert max(abs(scale[i] - 1.0) for i in range(3)) < 1e-6, (
            f"{obj.name} leaves Blender scaled {tuple(round(v, 4) for v in scale)}; "
            "ASSET_MANIFEST reserves scale for the caller's squash-and-stretch"
        )
        assert abs(rotation.angle) < 1e-6, (
            f"{obj.name} leaves Blender rotated by {math.degrees(rotation.angle):.3f}°; "
            "bake the rotation into the vertices"
        )
        if obj.name in HINGED:
            assert location.length > 1e-3, f"{obj.name} should carry its hinge origin and sits at the asset origin"
        else:
            assert location.length < 1e-6, (
                f"{obj.name} leaves Blender at {tuple(round(v, 4) for v in location)}; "
                "every node of this building is authored in the building's own frame"
            )
        has_uvs = len(obj.data.uv_layers) > 0
        assert has_uvs == (obj.name in PAINTED), (
            f"{obj.name} {'carries' if has_uvs else 'is missing'} a UV layer, "
            f"and it should {'not ' if has_uvs else ''}— only {sorted(PAINTED)} are painted"
        )
        obj.data.calc_loop_triangles()
        total += len(obj.data.loop_triangles)
        origin = f", origin {tuple(round(v, 3) for v in location)}" if obj.name in HINGED else ""
        print(f"  {obj.name}: {len(obj.data.polygons)} faces, {len(obj.data.loop_triangles)} tris, uvs {has_uvs}{origin}")

    export()
    print(f"  {len(meshes)} nodes exported, {total} triangles")
    print("  wrote", GLB, f"({os.path.getsize(GLB)} bytes)\n")


if __name__ == "__main__":
    try:
        main()
    except Exception:
        traceback.print_exc()
        sys.exit(1)
