"""Renders the Reptile House exterior to ``art/renders/reptile-house/`` so a
human can eyeball it.

    pnpm run render:reptile-house            # → art/renders/reptile-house/
    blender --background --factory-startup --python-exit-code 1 \\
        --python art/blend/reptile_house_render.py -- <out-dir>

Not part of ``pnpm run blend:reptile-house`` — it produces review pictures,
not shipped bytes. Run it whenever the shapes change.

Workbench, not Eevee or Cycles, deliberately: the game's own look is flat
banded colour with an ink outline (ART_DIRECTION §2), and Workbench's
``color_type='OBJECT'`` plus object outline is the closest thing to that a
background render can produce in a second.

## It reads the geometry, and it reads the colours. It copies neither.

The bridge kit's review found a render script that hand-copied its build
script's numbers and drifted, so:

* **The geometry comes from ``reptile_house.blend``**, opened here — the
  picture is of the mesh that ships.
* **The colours come from ``src/art/models/reptileHouseAssets.ts``**, parsed,
  once the Engineer's loader lands. Until then :data:`PROPOSED` below is used
  — the Artist's suggestion, stated once and printed loudly on every run so a
  render made from proposals is never mistaken for one made from the game.
* The composition's numbers (where the camera points, where the scale figure
  stands) come from ``reptile_house_build`` itself, imported, so the review
  shot moves with the geometry.

Hex values are never written here: :data:`PROPOSED` names ``PALETTE.``/``ART.``
keys and :func:`castle_render.palette_values` reads the numbers out of the
palette modules. The snake's own colours (``ART.snakeMint`` and friends) are
spec §12's additions and do not exist on this branch yet, so each has a
stand-in from the existing palette, named beside it.
"""

import math
import os
import re
import sys
import traceback

import bpy
from mathutils import Vector

sys.dont_write_bytecode = True
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import reptile_house_build as rb  # noqa: E402  (import-safe: everything is behind main())
from blendkit import REPO, ts_const  # noqa: E402
from castle_render import configure, frame, linear_rgba, palette_values, standin  # noqa: E402

BLEND = os.path.join(REPO, "art", "blend", "reptile_house.blend")
DEFAULT_OUT = os.path.join(REPO, "art", "renders", "reptile-house")

ENGINEER_MODULE = "src/art/models/reptileHouseAssets.ts"

# The Artist's proposal for the Engineer's `STYLES` table, by node name. Every
# value is a palette key, never a hex literal. Where spec §12 names a colour
# that does not exist yet (`ART.snakeMint`, `ART.snakeBelly`), the nearest
# existing key stands in and the intended one is named beside it.
PROPOSED = {
    "rh-plinth": "PALETTE.stonePink",
    "rh-coil": "PALETTE.markerMint",  # → ART.snakeMint (0x9fe0b0) when §12 lands
    "rh-coil-belly": "ART.cream",  # → ART.snakeBelly (0xfff1d0)
    "rh-coil-spots": "PALETTE.markerLilac",
    "rh-house-wall": "PALETTE.buildingWall",
    "rh-windows": "PALETTE.buildingWindowWarm",
    "rh-head": "PALETTE.markerMint",  # → ART.snakeMint, face painted in code
    "rh-tongue": "PALETTE.markerPink",
    "rh-tail": "PALETTE.markerMint",  # → ART.snakeMint
    "rh-tail-bell": "PALETTE.flowerYellow",
    "rh-arch": "PALETTE.stonePink",
    "rh-awning": "PALETTE.leafLight",
    "rh-sign": "PALETTE.signBoard",
}

STANDIN_GROUND = 0xF4EEF9
STANDIN_CHILD = 0xE86F9B
"""The scale figure, in a colour nothing in the kit is."""

KID_HEIGHT = ts_const("src/art/models/kid.ts", "KID_HEIGHT")


def engineer_styles():
    """The Engineer's ``STYLES`` table, if their module is on this branch yet."""
    path = os.path.join(REPO, ENGINEER_MODULE)
    if not os.path.exists(path):
        return None
    source = open(path, encoding="utf-8").read()
    found = re.findall(
        r"['\"]?(rh-[\w-]*)['\"]?:\s*\{[^}]*?colour:\s*((?:PALETTE|ART)\.\w+)",
        source,
        re.DOTALL,
    )
    return {name: key for name, key in found} or None


def resolve_colours():
    values = palette_values()
    styles = engineer_styles()
    if styles:
        source = f"{ENGINEER_MODULE} — the Engineer's own table"
    else:
        styles = PROPOSED
        source = (
            "PROPOSED in reptile_house_render.py — the Engineer's module is not on "
            "this branch yet, so these renders show the Artist's SUGGESTED colours"
        )
    missing = [key for key in styles.values() if key not in values]
    assert not missing, f"these colours are named but do not exist in the palette modules: {missing}"
    return {node: values[key] for node, key in styles.items()}, source, styles


def render(camera, objects, stem, azimuth, elevation, pad, out):
    frame(objects, azimuth, elevation, camera, pad)
    bpy.context.scene.render.filepath = os.path.join(out, f"{stem}.png")
    bpy.ops.render.render(write_still=True)
    print("  wrote", bpy.context.scene.render.filepath)


def main() -> None:
    argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    out = argv[0] if argv else DEFAULT_OUT
    os.makedirs(out, exist_ok=True)

    bpy.ops.wm.open_mainfile(filepath=BLEND)
    colours, source, styles = resolve_colours()
    configure(colours)
    print("\nreptile_house_render")
    print("  colours from:", source)
    for node, key in sorted(styles.items()):
        print(f"    {node:<16} {key}")

    camera_data = bpy.data.cameras.new("review-cam")
    camera = bpy.data.objects.new("review-cam", camera_data)
    bpy.context.scene.collection.objects.link(camera)
    bpy.context.scene.camera = camera

    kit = [obj for obj in bpy.data.objects if obj.type == "MESH" and obj.name.startswith("rh-")]

    # A ground slab and a child on the doormat, for scale. The child stands
    # where the door band is: `REPTILE_SHELL_RADIUS − 0.4` out along the door
    # bearing (spec §2), which the plinth's own edge makes the step up onto.
    reach = rb.REPTILE_SHELL_RADIUS + 3.0
    ground = standin("standin-ground", (34.0, 34.0, 0.2), (0.0, 0.0, -0.1), STANDIN_GROUND)
    child_at = Vector((
        (rb.REPTILE_SHELL_RADIUS - 0.4) * math.cos(rb.DOOR_BEARING),
        (rb.REPTILE_SHELL_RADIUS - 0.4) * math.sin(rb.DOOR_BEARING),
        rb.FLOOR + KID_HEIGHT * 0.5,
    ))
    child = standin("standin-child", (0.9, 0.5, KID_HEIGHT), tuple(child_at), STANDIN_CHILD)

    # The game's own view: iso from the front-right, pitched like the fixed
    # camera (38°), with the whole building, the tail signpost and the child.
    render(camera, kit + [child], "iso", 28.0, 38.0, 1.12, out)
    # Walking up: low and square on, the door, the awning and the tail.
    door_parts = [bpy.data.objects[n] for n in ("rh-arch", "rh-awning", "rh-tail", "rh-sign", "rh-tail-bell")]
    render(camera, door_parts + [child], "door", 8.0, 10.0, 1.35, out)
    # The face end: head, tongue and the neck coming over the dome.
    head_parts = [bpy.data.objects[n] for n in ("rh-head", "rh-tongue")]
    render(camera, head_parts, "head", -22.0, 18.0, 2.2, out)
    # From behind, so the neck's route over the dome can be judged.
    render(camera, kit, "back", 180.0 + 30.0, 30.0, 1.1, out)

    bpy.data.objects.remove(ground, do_unlink=True)
    bpy.data.objects.remove(child, do_unlink=True)
    print(f"  {len(kit)} nodes, scale figure {KID_HEIGHT} m (KID_HEIGHT)\n")


if __name__ == "__main__":
    try:
        main()
    except Exception:
        traceback.print_exc()
        sys.exit(1)
