"""Exports the Reptile House's cases kit to the shipped asset.

    blender --background --factory-startup --python-exit-code 1 \
        --python art/blend/reptile_cases_export.py

``reptile_cases_build.py`` writes ``art/blend/reptile_cases.blend``; this reads
it back and writes ``src/art/assets/reptileCases.glb``. Same split, and the
same reasoning, as ``castle_build.py`` / ``castle_export.py``: the build is slow
and assertive, the export is fast and dumb, and a colour tweak in the
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
GLB = os.path.join(REPO, "src", "art", "assets", "reptileCases.glb")
BLEND = os.path.join(REPO, "art", "blend", "reptile_cases.blend")

#: Every node the game expects to find. An asset that silently loses a part
#: exports fine and ships a case with no rim, so the set is asserted here
#: rather than trusted. One node per colour; the Engineer's `STYLES` table in
#: `reptileCasesAssets.ts` is keyed by exactly these names.
EXPECTED = {
    "rc-case-plinth",
    "rc-case-rim",
    "rc-case-backboard",
    "rc-case-backboard-relief",
    "rc-pier-post",
    "rc-pier-vine",
    "rc-jar-base",
    "rc-jar-rim",
    "rc-round-wall",
    "rc-lagoon-wall",
    "rc-tortoise-wall",
    "rc-nursery-kerb",
    "rc-nursery-rail",
    "rc-island-kerb",
    "rc-grotto-rock",
    "rc-grotto-moss",
}

#: Nodes that carry a painted canvas and therefore must ship UVs. None: every
#: part of this kit is a flat material colour. The nameplates and the glass
#: are TypeScript.
PAINTED: set[str] = set()


def export() -> None:
    bpy.ops.export_scene.gltf(
        filepath=GLB,
        export_format="GLB",
        use_selection=False,
        # Shape and nothing else. Every colour — the pink stone, the gold
        # rail, the moss — comes from `PALETTE`/`ART` in
        # `src/art/models/reptileCasesAssets.ts`, as the castle's does from
        # `castleAssets.ts`.
        export_materials="NONE",
        export_normals=True,
        # Off: nothing in this kit is painted (`PAINTED` is empty), and a UV
        # layer on a flat-coloured part is bytes the toon material never reads.
        export_texcoords=False,
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
    print("\nreptile_cases_export — from", BLEND)
    meshes = [obj for obj in bpy.data.objects if obj.type == "MESH"]
    assert meshes, f"{BLEND} has no meshes — run reptile_cases_build.py first"

    names = {obj.name for obj in meshes}
    assert names == EXPECTED, (
        f"node set changed: built but unexpected {sorted(names - EXPECTED)}, "
        f"expected but missing {sorted(EXPECTED - names)}"
    )

    for obj in sorted(meshes, key=lambda o: o.name):
        # Every part is authored about its own footprint centre, on the floor,
        # with its placement baked into vertex positions. No node here is a
        # hinge, so any transform at all is a mistake — and it is the sort
        # that ships looking almost right.
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
            "every node of this kit is authored about its own footprint centre"
        )
        has_uvs = len(obj.data.uv_layers) > 0
        assert has_uvs == (obj.name in PAINTED), (
            f"{obj.name} {'carries' if has_uvs else 'is missing'} a UV layer, "
            f"and it should {'not ' if has_uvs else ''}— only {sorted(PAINTED)} are painted"
        )
        print(f"  {obj.name}: {len(obj.data.polygons)} faces, uvs {has_uvs}")

    export()
    print(f"  {len(meshes)} nodes exported")
    print("  wrote", GLB, f"({os.path.getsize(GLB)} bytes)\n")


if __name__ == "__main__":
    try:
        main()
    except Exception:
        traceback.print_exc()
        sys.exit(1)
