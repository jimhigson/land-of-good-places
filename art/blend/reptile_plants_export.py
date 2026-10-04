"""Exports the Reptile House's plant kit to the shipped asset.

    blender --background --factory-startup --python-exit-code 1 \
        --python art/blend/reptile_plants_export.py

``reptile_plants_build.py`` writes ``art/blend/reptile_plants.blend``; this
reads it back and writes ``src/art/assets/reptilePlants.glb``. Same split, and
the same reasoning, as ``castle_build.py`` / ``castle_export.py``: the build is
slow and assertive, the export is fast and dumb, and a colour tweak in the
TypeScript never needs either of them.

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
GLB = os.path.join(REPO, "src", "art", "assets", "reptilePlants.glb")
BLEND = os.path.join(REPO, "art", "blend", "reptile_plants.blend")

# The kit, by node name. A node missing here is a build that has drifted from
# its contract; a node here that is missing from the `.blend` is a build that
# was never run. Either way the export refuses.
EXPECTED = {
    "rp-palm-trunk",
    "rp-palm-frond",
    "rp-banana-leaf",
    "rp-monstera-stalk",
    "rp-monstera-leaf",
    "rp-fern-frond",
    "rp-heliconia-stalk",
    "rp-heliconia",
    "rp-vine-strand",
    "rp-vine-leaves",
    "rp-lily-pad",
    "rp-rock-a",
    "rp-rock-b",
    "rp-rock-c",
    "rp-log-small",
    "rp-log-hollow",
    "rp-log-knothole",
    "rp-banyan",
    "rp-banyan-canopy",
    "rp-banyan-anchor-a",
    "rp-banyan-anchor-b",
    "rp-banyan-anchor-c",
    "rp-branch",
}

# Nothing in this kit is painted (the Engineer colours each node flat from the
# palette), so no node carries UVs and texcoords stay off.
PAINTED: set[str] = set()

# Nodes allowed a node-origin translation: the point *is* the data (a hang
# anchor, the knothole's centre) and the loader reads `GlbPart.position`.
PLACED_BY_ORIGIN = {
    "rp-log-knothole",
    "rp-banyan-anchor-a",
    "rp-banyan-anchor-b",
    "rp-banyan-anchor-c",
}


def export() -> None:
    bpy.ops.export_scene.gltf(
        filepath=GLB,
        export_format="GLB",
        use_selection=False,
        # Shape and nothing else. Every colour comes from `PALETTE`/`ART` in
        # `src/art/models/reptilePlantsAssets.ts` (the Engineer's).
        export_materials="NONE",
        export_normals=True,
        export_texcoords=bool(PAINTED),
        export_tangents=False,
        export_cameras=False,
        export_lights=False,
        export_extras=False,
        export_animations=False,
        export_skins=False,
        # Placement is baked into vertices (or, for PLACED_BY_ORIGIN, carried
        # as a pure translation the loader reads), so there is nothing here
        # for `export_apply` to decide.
        export_apply=False,
        export_yup=True,
    )


def main() -> None:
    bpy.ops.wm.open_mainfile(filepath=BLEND)
    print("\nreptile_plants_export — from", BLEND)
    meshes = [obj for obj in bpy.data.objects if obj.type == "MESH"]
    names = {obj.name for obj in meshes}
    assert names == EXPECTED, (
        f"node set drifted — missing {sorted(EXPECTED - names)}, unexpected {sorted(names - EXPECTED)}; "
        "rerun reptile_plants_build.py or update EXPECTED deliberately"
    )
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
        if obj.name in PLACED_BY_ORIGIN:
            assert location.length > 1e-6, f"{obj.name} should be placed by its node origin and is at zero"
            print(
                f"  {obj.name}: node origin at "
                f"({location.x:+.3f}, {location.y:+.3f}, {location.z:+.3f}) — deliberate, "
                "the loader reads this point"
            )
        else:
            assert location.length < 1e-6, f"{obj.name} carries a node translation it should not"
        has_uv = len(obj.data.uv_layers) > 0
        assert has_uv == (obj.name in PAINTED), f"{obj.name}: UV layer present={has_uv}, painted={obj.name in PAINTED}"
    export()
    print(f"  {len(meshes)} nodes exported")
    print("  wrote", GLB, f"({os.path.getsize(GLB)} bytes)\n")


if __name__ == "__main__":
    try:
        main()
    except Exception:
        traceback.print_exc()
        sys.exit(1)
