"""Renders Noodle and her rock for the eye.

    pnpm run render:reptile-noodle
    NOODLE_RENDER_DIR=/somewhere pnpm run render:reptile-noodle

Reads ``art/blend/reptile_noodle.blend`` (written by ``reptile_noodle_build.py``)
and writes PNGs to ``art/renders/reptile-noodle/`` — or to ``NOODLE_RENDER_DIR``
when that is set, for a scratch preview that should not land in the tree.

A **preview**, not a shipped asset: Workbench, flat object colours, the house
outline. The game draws these parts with its own toon ramp; what this answers
is whether the pose reads — a kind python resting her chin on the kerb, looking
at whoever just walked in — from the angle the game actually uses.

## Colours are read, not typed

Each node's colour is a *name* in ``STYLES``; the hex behind it is read out of
``src/core/palette.ts`` and ``src/art/style/artPalette.ts`` by regex, the same
way ``blendkit.ts_const`` reads a dimension. The Reptile House's own palette
rows (spec §12: ``snakeMint`` and friends) do not exist in ``artPalette.ts``
yet — they land with the loader — so for those names, and only those, this
file carries the spec's proposed values in ``PROPOSED`` and **says so on every
run**. The moment the palette gains the name, the palette wins and the line
stops printing. That is the one place a number lives here that the game does
not own, and it is a preview colour, not a dimension.

## The stand-in child

A 2.12 m box (``KID_HEIGHT``, read from ``kid.ts``) at the exhibit's stand spot
(``EXHIBIT_PLACEMENTS[noodle].stand`` in ``layout.ts``, read the same way),
so a reviewer can judge the head's height against a child's eye without
opening the game.
"""

import math
import os
import re
import sys
import traceback

import bpy
from mathutils import Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from blendkit import REPO, ts_const  # noqa: E402

BLEND = os.path.join(REPO, "art", "blend", "reptile_noodle.blend")
OUT = os.environ.get("NOODLE_RENDER_DIR") or os.path.join(REPO, "art", "renders", "reptile-noodle")

PALETTE_FILES = ("src/core/palette.ts", "src/art/style/artPalette.ts")

# node → palette name. The loader will make the same choices from PALETTE/ART;
# this is the preview's reading of ART_DIRECTION §5 and the spec's exhibit row.
STYLES = {
    "rn-mound": "stoneGreyMid",
    "rn-coil": "snakeMint",
    "rn-coil-belly": "snakeBelly",
    "rn-coil-spots": "markerLilac",
    "rn-head": "snakeMint",
    "rn-tongue": "markerPink",
    "rn-burrow": "barkDark",
    "rn-tail-mound": "barkDark",
    "stand-in-child": "markerSky",
}

# Spec §12's proposed additions, used ONLY when the palette lacks the name.
PROPOSED = {
    "snakeMint": 0x9FE0B0,
    "snakeCoral": 0xFF9F80,
    "snakeBelly": 0xFFF1D0,
    "cornOrange": 0xFFA75C,
    "cornSaddle": 0xD96B4A,
    "shellOlive": 0xB5B86A,
    "hothouseClay": 0xE9A883,
}


def palette_hex(name: str) -> int:
    for rel in PALETTE_FILES:
        with open(os.path.join(REPO, rel), encoding="utf-8") as handle:
            source = handle.read()
        found = re.findall(rf"^\s+{name}: 0x([0-9a-fA-F]{{6}}),", source, flags=re.MULTILINE)
        if found:
            return int(found[0], 16)
    if name in PROPOSED:
        print(f"  colour {name}: not in the palette yet — using the spec's proposed 0x{PROPOSED[name]:06x}")
        return PROPOSED[name]
    raise SystemExit(f"reptile_noodle_render: no colour named {name} in {PALETTE_FILES}")


def srgb_to_linear(c: float) -> float:
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def linear_rgba(hex_value: int):
    parts = [((hex_value >> shift) & 0xFF) / 255.0 for shift in (16, 8, 0)]
    return tuple(srgb_to_linear(p) for p in parts) + (1.0,)


def configure() -> None:
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_WORKBENCH"
    scene.render.resolution_x = 900
    scene.render.resolution_y = 760
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.compression = 92
    # Standard, never AgX — it crushes exactly the pastels this park is made
    # of (hotel_render.py has the full account).
    scene.view_settings.view_transform = "Standard"
    scene.view_settings.look = "None"
    shading = scene.display.shading
    shading.light = "STUDIO"
    shading.color_type = "OBJECT"
    shading.show_object_outline = True
    shading.object_outline_color = (0.29, 0.23, 0.32)  # PALETTE.ink
    shading.show_cavity = False
    shading.show_shadows = True
    shading.background_type = "VIEWPORT"
    shading.background_color = (0.93, 0.90, 0.84)  # a warm hothouse wall, not sky
    scene.display.render_aa = "16"
    print("\nreptile_noodle_render")
    colours = {name: palette_hex(name) for name in set(STYLES.values())}
    for obj in bpy.data.objects:
        if obj.type == "MESH":
            obj.color = linear_rgba(colours[STYLES[obj.name]])


def stand_in_child() -> bpy.types.Object:
    """A KID_HEIGHT box on the exhibit's stand spot. Removed after the shots."""
    height = ts_const("src/art/models/kid.ts", "KID_HEIGHT")
    # The stand spot is a table row, not a `export const`; read the two
    # numbers off the `noodle` entry's `stand:` line with the same discipline
    # (a regex that must match exactly once).
    with open(os.path.join(REPO, "src/world/reptileHouse/layout.ts"), encoding="utf-8") as handle:
        source = handle.read()
    block = re.search(r"id: 'noodle',.*?stand: \{ x: (-?[\d.]+), z: (-?[\d.]+)[,} ]", source, flags=re.S)
    assert block, "layout.ts has no `noodle` exhibit with a `stand:` — this render cannot place its child"
    sx, sz = float(block.group(1)), float(block.group(2))
    w = 0.62 * 2
    hx = w * 0.5
    verts = [
        (-hx, -hx, 0), (hx, -hx, 0), (hx, hx, 0), (-hx, hx, 0),
        (-hx, -hx, height), (hx, -hx, height), (hx, hx, height), (-hx, hx, height),
    ]
    faces = [(0, 3, 2, 1), (4, 5, 6, 7), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)]
    mesh = bpy.data.meshes.new("stand-in-child")
    mesh.from_pydata(verts, [], faces)
    obj = bpy.data.objects.new("stand-in-child", mesh)
    obj.location = (sx, -sz, 0.0)  # game +Z is Blender −Y
    bpy.context.scene.collection.objects.link(obj)
    print(f"  stand-in child {height:.2f} m at game ({sx}, {sz})")
    return obj


def bounds_of(objects):
    lo = Vector((1e9, 1e9, 1e9))
    hi = Vector((-1e9, -1e9, -1e9))
    for obj in objects:
        for v in obj.data.vertices:
            w = obj.matrix_world @ v.co
            lo = Vector(min(lo[i], w[i]) for i in range(3))
            hi = Vector(max(hi[i], w[i]) for i in range(3))
    return lo, hi


def aim(camera, eye, target, lens=None, ortho=None):
    camera.location = Vector(eye)
    camera.rotation_mode = "QUATERNION"
    camera.rotation_quaternion = (Vector(eye) - Vector(target)).to_track_quat("Z", "Y")
    if ortho is not None:
        camera.data.type = "ORTHO"
        camera.data.ortho_scale = ortho
    else:
        camera.data.type = "PERSP"
        camera.data.lens = lens or 50


def main() -> None:
    bpy.ops.wm.open_mainfile(filepath=BLEND)
    os.makedirs(OUT, exist_ok=True)
    child = stand_in_child()
    configure()

    cam_data = bpy.data.cameras.new("review-cam")
    camera = bpy.data.objects.new("review-cam", cam_data)
    bpy.context.scene.collection.objects.link(camera)
    bpy.context.scene.camera = camera

    island = [o for o in bpy.data.objects if o.type == "MESH" and o.name != "rn-tail-mound"]
    lo, hi = bounds_of([o for o in island if o.name != "stand-in-child"])
    centre = (lo + hi) * 0.5
    centre.z = 1.0

    # The game's own view: fixed iso camera at +X+Z (Blender +X, −Y), pitched
    # 38° — the exact rig the sightline rule in the spec is written against.
    pitch = math.radians(38.0)
    dist = 14.0
    d = Vector((math.cos(pitch) * math.cos(-math.pi / 4), math.cos(pitch) * math.sin(-math.pi / 4), math.sin(pitch)))
    # stem, eye, target, lens/ortho, the one node to show alone (or None),
    # whether the stand-in child is in shot. She stands on the head's own
    # bearing, between the head and the camera, so she is left out of the
    # shots that are *about* the head and kept in the ones about scale.
    shots = [
        ("game-view", centre + d * dist, centre, dict(ortho=11.5), None, False),
        ("game-view-with-child", centre + d * dist, centre, dict(ortho=11.5), None, True),
        ("head-closeup", Vector((5.6, -4.4, 2.4)), Vector((2.4, -2.4, 0.9)), dict(lens=60), None, False),
        # A hair off straight down: an exactly vertical track is degenerate and
        # came out rotated 180°. North (game −Z, Blender +Y) is up the page.
        ("plan", centre + Vector((0, -0.02, 20)), centre, dict(ortho=8.5), None, True),
        ("from-the-north", centre + Vector((-7.5, 10.5, 6.0)), centre, dict(lens=45), None, True),
        ("tail-mound", Vector((2.6, -2.2, 1.9)), Vector((0, 0, 0.25)), dict(lens=50), "rn-tail-mound", False),
    ]
    for stem, eye, target, how, only, with_child in shots:
        for obj in bpy.data.objects:
            if obj.type != "MESH":
                continue
            if obj.name == "stand-in-child":
                obj.hide_render = not with_child
            elif only is None:
                obj.hide_render = obj.name == "rn-tail-mound"
            else:
                obj.hide_render = obj.name != only
        aim(camera, eye, target, **how)
        path = os.path.join(OUT, f"{stem}.png")
        bpy.context.scene.render.filepath = path
        bpy.ops.render.render(write_still=True)
        print("  wrote", path)

    bpy.data.objects.remove(child, do_unlink=True)
    bpy.data.objects.remove(camera, do_unlink=True)
    print()


if __name__ == "__main__":
    try:
        main()
    except Exception:
        traceback.print_exc()
        sys.exit(1)
