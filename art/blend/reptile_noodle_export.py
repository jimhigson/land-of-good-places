"""Exports Noodle and her rock to the shipped asset.

    blender --background --factory-startup --python-exit-code 1 \
        --python art/blend/reptile_noodle_export.py

``reptile_noodle_build.py`` writes ``art/blend/reptile_noodle.blend``; this
reads it back and writes ``src/art/assets/reptileNoodle.glb``. Same split, and
the same reasoning, as ``castle_build.py`` / ``castle_export.py``: the build is
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
GLB = os.path.join(REPO, "src", "art", "assets", "reptileNoodle.glb")
BLEND = os.path.join(REPO, "art", "blend", "reptile_noodle.blend")

# The kit, by name. A node missing or renamed in the .blend fails here, before
# the loader (`src/art/models/reptileNoodleAssets.ts`) finds out at runtime.
EXPECTED = {
    "rn-mound",
    "rn-coil",
    "rn-coil-belly",
    "rn-coil-spots",
    "rn-head",
    "rn-tongue",
    "rn-burrow",
    "rn-tail-mound",
}
# Nodes that carry a canvas texture in their own UVs (ART_DIRECTION §3, §7).
PAINTED = {"rn-head"}
# Nodes whose origin is deliberately not the asset origin: the head pivots at
# its chin's rest point, the tongue scales out of the mouth. A pure
# translation each; anything else on any node is a build mistake.
PLACED_BY_ORIGIN = {"rn-head", "rn-tongue"}


def export() -> None:
    bpy.ops.export_scene.gltf(
        filepath=GLB,
        export_format="GLB",
        use_selection=False,
        # Shape and nothing else: every colour comes from `PALETTE`/`ART` in
        # the loader, as for every other kit in this pipeline.
        export_materials="NONE",
        export_normals=True,
        # On, because `rn-head` is PAINTED — her face is a canvas in this
        # node's own UV space, and without texcoords it has nowhere to land.
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
    print("\nreptile_noodle_export — from", BLEND)
    meshes = [obj for obj in bpy.data.objects if obj.type == "MESH"]
    names = {obj.name for obj in meshes}
    assert names == EXPECTED, (
        f"node set drifted: missing {sorted(EXPECTED - names)}, unexpected {sorted(names - EXPECTED)}"
    )
    for obj in sorted(meshes, key=lambda o: o.name):
        has_uv = bool(obj.data.uv_layers)
        assert has_uv == (obj.name in PAINTED), (
            f"{obj.name} {'has' if has_uv else 'lacks'} a UV layer but is "
            f"{'' if obj.name in PAINTED else 'not '}in PAINTED"
        )
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
            assert location.length > 1e-6, f"{obj.name} should carry its pivot as the node origin and does not"
            print(
                f"  {obj.name}: node origin at "
                f"({location.x:+.3f}, {location.y:+.3f}, {location.z:+.3f}) — deliberate, "
                "this node is placed by its own origin"
            )
        else:
            assert location.length < 1e-6, (
                f"{obj.name} carries a translation {tuple(round(v, 4) for v in location)}; "
                "bake placement into the vertices"
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
