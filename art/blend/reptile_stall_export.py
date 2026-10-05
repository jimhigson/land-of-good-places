"""Exports the Reptile House's stall kit to the shipped asset.

    blender --background --factory-startup --python-exit-code 1 \
        --python art/blend/reptile_stall_export.py

``reptile_stall_build.py`` writes ``art/blend/reptile_stall.blend``; this reads
it back and writes ``src/art/assets/reptileStall.glb``. Same split, and the
same reasoning, as ``gate_arch_build.py`` / ``gate_arch_export.py``: the build
is slow and assertive, the export is fast and dumb, and a colour tweak in the
TypeScript needs neither of them. ``pnpm run blend:reptile-stall`` runs the
pair, then packs the result.

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
GLB = os.path.join(REPO, "src", "art", "assets", "reptileStall.glb")
BLEND = os.path.join(REPO, "art", "blend", "reptile_stall.blend")

#: Every node the loader expects. One node per colour; the `rs-meter-` prefix
#: is the Noodle-o-meter, authored about its own base, everything else is the
#: stall dressing authored in the kiosk's frame. A kit that silently loses a
#: node exports fine and ships a snake with no eyes, so the set is asserted.
EXPECTED = {
    "rs-awning",
    "rs-awning-posts",
    "rs-awning-snake",
    "rs-finial",
    "rs-sign",
    "rs-stall-snake-face",
    "rs-stall-snake-shine",
    "rs-stall-snake-tongue",
    "rs-stall-snake-spots",
    "rs-meter-post",
    "rs-meter-bands",
    "rs-meter-board",
    "rs-meter-snake",
    "rs-meter-snake-face",
    "rs-meter-snake-shine",
    "rs-meter-snake-tongue",
    "rs-meter-snake-spots",
}

#: The nodes that carry a painted canvas (the sign atlas), and must ship UVs.
PAINTED = {"rs-sign", "rs-meter-board"}


def export() -> None:
    bpy.ops.export_scene.gltf(
        filepath=GLB,
        export_format="GLB",
        use_selection=False,
        # Shape and nothing else: every colour comes from the loader's STYLES
        # table, exactly as the castle's and the gate's do.
        export_materials="NONE",
        export_normals=True,
        # On, and load-bearing: the two boards are painted from the sign atlas
        # into their own UV space (ART_DIRECTION §3, src/art/models/CLAUDE.md).
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
    print("\nreptile_stall_export — from", BLEND)
    meshes = [obj for obj in bpy.data.objects if obj.type == "MESH"]
    assert meshes, f"{BLEND} has no meshes — run reptile_stall_build.py first"

    names = {obj.name for obj in meshes}
    assert names == EXPECTED, (
        f"node set changed: built but unexpected {sorted(names - EXPECTED)}, "
        f"expected but missing {sorted(EXPECTED - names)}"
    )

    total = 0
    for obj in sorted(meshes, key=lambda o: o.name):
        # Every node is authored in its own kit frame with placement baked into
        # the vertices; nothing here is a hinge, so any transform is a mistake.
        location, rotation, scale = obj.matrix_world.decompose()
        assert max(abs(scale[i] - 1.0) for i in range(3)) < 1e-6, (
            f"{obj.name} leaves Blender scaled {tuple(round(v, 4) for v in scale)}; "
            "ASSET_MANIFEST reserves scale for the caller's squash-and-stretch"
        )
        assert abs(rotation.angle) < 1e-6, (
            f"{obj.name} leaves Blender rotated by {math.degrees(rotation.angle):.3f}°; "
            "bake the rotation into the vertices"
        )
        assert location.length < 1e-6, (
            f"{obj.name} leaves Blender at {tuple(round(v, 4) for v in location)}; "
            "every node of this kit is authored about its own origin"
        )
        has_uvs = len(obj.data.uv_layers) > 0
        assert has_uvs == (obj.name in PAINTED), (
            f"{obj.name} {'carries' if has_uvs else 'is missing'} a UV layer, "
            f"and it should {'not ' if has_uvs else ''}— only {sorted(PAINTED)} are painted"
        )
        obj.data.calc_loop_triangles()
        total += len(obj.data.loop_triangles)
        print(f"  {obj.name:<24} {len(obj.data.loop_triangles):>5} tris  uvs {has_uvs}")

    export()
    print(f"  {len(meshes)} nodes, {total} triangles exported")
    print("  wrote", GLB, f"({os.path.getsize(GLB)} bytes)\n")


if __name__ == "__main__":
    try:
        main()
    except Exception:
        traceback.print_exc()
        sys.exit(1)
