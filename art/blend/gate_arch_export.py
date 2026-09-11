"""Exports the entrance arch to the shipped asset.

    blender --background --factory-startup --python-exit-code 1 \
        --python art/blend/gate_arch_export.py

``gate_arch_build.py`` writes ``art/blend/gateArch.blend``; this reads it back
and writes ``src/art/assets/gateArch.glb``. Same split, and the same reasoning,
as ``castle_build.py`` / ``castle_export.py``: the build is slow and assertive,
the export is fast and dumb, and a colour tweak in the TypeScript needs neither
of them.

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
GLB = os.path.join(REPO, "src", "art", "assets", "gateArch.glb")
BLEND = os.path.join(REPO, "art", "blend", "gateArch.blend")

#: Every node the game expects to find. An asset that silently loses a part
#: exports fine and renders a gate with no lettering on it, so the set is
#: asserted here rather than trusted.
EXPECTED = {
    "gate-arch-piers",
    "gate-arch-band",
    "gate-arch-bobbles",
    "gate-arch-sign",
    "gate-arch-medallion",
}

#: The two nodes that carry a painted canvas, and therefore must ship UVs.
PAINTED = {"gate-arch-sign", "gate-arch-medallion"}


def export() -> None:
    bpy.ops.export_scene.gltf(
        filepath=GLB,
        export_format="GLB",
        use_selection=False,
        # Shape and nothing else. Every colour — the pink stone, the lemon
        # bobbles, the cream the lettering is painted on — comes from
        # `PALETTE` in `src/art/models/gateArch.ts`, exactly as the castle's
        # does from `castleAssets.ts`.
        export_materials="NONE",
        export_normals=True,
        # **On**, and load-bearing. The sign's lettering and the roundel's
        # ferris wheel are painted into these two nodes' own UV space
        # (ART_DIRECTION §3's rule for appliqué, and `src/art/models/CLAUDE.md`
        # on why it is never a second mesh). Without UVs there is nothing for
        # the canvas to land on and the arch ships blank.
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
    print("\ngate_arch_export — from", BLEND)
    meshes = [obj for obj in bpy.data.objects if obj.type == "MESH"]
    assert meshes, f"{BLEND} has no meshes — run gate_arch_build.py first"

    names = {obj.name for obj in meshes}
    assert names == EXPECTED, (
        f"node set changed: built but unexpected {sorted(names - EXPECTED)}, "
        f"expected but missing {sorted(EXPECTED - names)}"
    )

    for obj in sorted(meshes, key=lambda o: o.name):
        # Every part of this arch is authored in the arch's own frame with its
        # placement baked into vertex positions, so — unlike the castle's chest
        # lid — there is no node here that is placed by its own origin. Any
        # transform at all is a mistake, and it is the sort that ships looking
        # almost right.
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
            "every node of this arch is authored in the arch's own frame"
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
