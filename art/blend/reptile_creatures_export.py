"""Exports the Reptile House's creature kit to the shipped asset.

    blender --background --factory-startup --python-exit-code 1 \
        --python art/blend/reptile_creatures_export.py

``reptile_creatures_build.py`` writes ``art/blend/reptile_creatures.blend``;
this reads it back and writes ``src/art/assets/reptileCreatures.glb``. Same
split, and the same reasoning, as ``castle_build.py`` / ``castle_export.py``:
the build is slow and assertive, the export is fast and dumb, and a colour
tweak in the TypeScript never needs either of them.

``--background --factory-startup`` deliberately: this must never touch a running
interactive Blender, which on this project is a shared instance another agent
may be modelling in.
"""

import math
import os
import sys
import traceback

import bpy

sys.dont_write_bytecode = True
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

# The build script owns the node list and which nodes are painted; this file
# asks it rather than keeping a second copy that could drift (import-safe:
# everything in the build script is behind `main()`).
from reptile_creatures_build import BLEND, EXPECTED  # noqa: E402

REPO = os.path.dirname(os.path.dirname(HERE))
GLB = os.path.join(REPO, "src", "art", "assets", "reptileCreatures.glb")

# Nodes whose painted face lives in their own UV space (ART_DIRECTION §3's rule
# for a face on authored geometry). The only reason texcoords are exported.
PAINTED = {"rr-snake-head"}

# Nodes whose origin is a hinge, so the node may carry a pure **translation**
# and nothing else (the castle chest-lid precedent). Every other node leaves
# Blender at the identity.
HINGED = {"rr-snake-tongue", "rr-croc-jaw", "rr-croc-tail", "rr-tortoise-head"}


def export() -> None:
    bpy.ops.export_scene.gltf(
        filepath=GLB,
        export_format="GLB",
        use_selection=False,
        # Shape and nothing else. Every colour — the mint of a snake, the
        # cream of a crocodile's jaw — comes from `PALETTE`/`ART` in
        # `src/art/models/reptileCreaturesAssets.ts` (the Engineer's).
        export_materials="NONE",
        export_normals=True,
        # On, because `rr-snake-head` carries the snake face in its own UVs.
        export_texcoords=bool(PAINTED),
        export_tangents=False,
        export_cameras=False,
        export_lights=False,
        export_extras=False,
        export_animations=False,
        export_skins=False,
        # Placement is baked into vertices (or carried as a hinge translation
        # the game reads back), so there is nothing for `export_apply` to do.
        export_apply=False,
        export_yup=True,
    )


def main() -> None:
    bpy.ops.wm.open_mainfile(filepath=BLEND)
    print("\nreptile_creatures_export — from", BLEND)
    meshes = [obj for obj in bpy.data.objects if obj.type == "MESH"]
    names = {obj.name for obj in meshes}
    assert names == EXPECTED, (
        f"{BLEND} has {sorted(names - EXPECTED)} unexpected and {sorted(EXPECTED - names)} "
        "missing — rerun reptile_creatures_build.py"
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
        if obj.name in HINGED:
            assert location.length > 1e-6, f"{obj.name} is a hinge node with its origin at the asset origin"
            print(
                f"  {obj.name}: hinge at "
                f"({location.x:+.3f}, {location.y:+.3f}, {location.z:+.3f}) — deliberate, "
                "this node is placed by its own origin"
            )
        else:
            assert location.length < 1e-6, (
                f"{obj.name} leaves Blender translated by {tuple(round(v, 4) for v in location)}; "
                "only the hinge nodes may carry a translation"
            )
        has_uvs = bool(obj.data.uv_layers)
        assert has_uvs == (obj.name in PAINTED), (
            f"{obj.name} {'carries' if has_uvs else 'lacks'} UVs but is "
            f"{'not ' if obj.name not in PAINTED else ''}in PAINTED"
        )
    export()
    print(f"  {len(meshes)} nodes exported ({len(PAINTED)} painted, {len(HINGED)} hinged)")
    print("  wrote", GLB, f"({os.path.getsize(GLB)} bytes)\n")


if __name__ == "__main__":
    try:
        main()
    except Exception:
        traceback.print_exc()
        sys.exit(1)
