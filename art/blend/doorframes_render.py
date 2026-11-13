"""Review renders of the doorway-frame kit — one picture per style.

    blender --background --factory-startup --python-exit-code 1 \
        --python art/blend/doorframes_render.py

Each frame is assembled the way ``src/art/models/doorFrames.ts`` assembles it
(a post either side of the gap, the lintel tiled post to post, the crest on
the middle) round an illustrative gap, beside a ``TALLEST_CHILD_HEIGHT`` post
standing in the opening. **Every size is the kit's own**, imported from
``doorframes_build``; the gap is the one figure that is not the kit's (each
room owns its own), so the picture uses the hotel's ``DOOR_HALF``, read from
``hotel/layout.ts``. Colours are the loader's ``DOORFRAME_NODE_STYLES``, read
from the TypeScript — magenta for any node it forgot.

Writes ``art/renders/doorframes/<style>.png``.
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
import doorframes_build as db  # noqa: E402  (import-safe: everything is behind main())
import blendkit as kit  # noqa: E402
from castle_render import GAME_ELEVATION, configure, frame, palette_values, standin  # noqa: E402

OUT = os.path.join(kit.REPO, "art", "renders", "doorframes")
LOADER = "src/art/models/doorFrames.ts"
GAP_HALF = kit.ts_const("src/world/hotel/layout.ts", "DOOR_HALF")


def loader_colours(values):
    source = open(os.path.join(kit.REPO, LOADER), encoding="utf-8").read()
    found = re.findall(r"'(doorframe-[\w-]+)':\s*\{\s*colour:\s*((?:PALETTE|ART)\.\w+)", source)
    assert found, f"no DOORFRAME_NODE_STYLES entries parsed out of {LOADER}"
    missing = [key for _, key in found if key not in values]
    assert not missing, f"colours named but not in the palette modules: {missing}"
    return {name: values[key] for name, key in found}


def bounds(obj):
    lo = Vector((1e9, 1e9, 1e9))
    hi = Vector((-1e9, -1e9, -1e9))
    for v in obj.data.vertices:
        for i in range(3):
            lo[i] = min(lo[i], v.co[i])
            hi[i] = max(hi[i], v.co[i])
    return lo, hi


def place(src, x, z, sx=1.0):
    obj = src.copy()
    obj.location = (x, 0.0, z)
    obj.scale = (sx, 1.0, 1.0)
    obj.hide_render = False
    bpy.context.scene.collection.objects.link(obj)
    return obj


def main() -> None:
    values = palette_values()
    bpy.ops.wm.open_mainfile(filepath=db.BLEND)
    colours = loader_colours(values)
    configure(colours)
    os.makedirs(OUT, exist_ok=True)
    for name in os.listdir(OUT):
        if name.endswith(".png"):
            os.remove(os.path.join(OUT, name))
    cam = bpy.data.objects.new("review-cam", bpy.data.cameras.new("review-cam"))
    bpy.context.scene.collection.objects.link(cam)
    bpy.context.scene.camera = cam
    scene = bpy.context.scene
    scene.render.resolution_x, scene.render.resolution_y = 900, 760
    scene.render.image_settings.color_mode = "RGB"
    originals = [o for o in bpy.data.objects if o.type == "MESH"]
    for style, c in db.CONTRACT.items():
        for o in originals:
            o.hide_render = True
        nodes = {o.name: o for o in originals if o.name.startswith(f"doorframe-{style}-")}
        posts = [o for n, o in nodes.items() if "-post" in n]
        lintels = [o for n, o in nodes.items() if "-lintel" in n]
        crests = [o for n, o in nodes.items() if "-crest" in n]
        lo, hi = db.union_bounds(posts)
        made = []
        left = -GAP_HALF - hi.x
        right = GAP_HALF - lo.x
        for x in (left, right):
            made += [place(o, x, 0.0) for o in posts]
        span = (right + hi.x) - (left + lo.x)
        count = max(1, round(span / c["T"]))
        stretch = span / (count * c["T"])
        for i in range(count):
            x = left + lo.x + span * (i + 0.5) / count
            made += [place(o, x, c["H"], stretch) for o in lintels]
        made += [place(o, 0.0, c["H"] + c["L"]) for o in crests]
        made.append(standin(f"child-{style}", (0.42, 0.42, db.TALLEST_CHILD_HEIGHT), (0.0, 0.0, db.TALLEST_CHILD_HEIGHT / 2), values["PALETTE.markerSky"]))
        made.append(standin(f"floor-{style}", (span + 3.0, 4.0, 0.1), (0.0, 0.0, -0.05), values["PALETTE.buildingFloor"]))
        bpy.context.view_layer.update()
        # From the game's side: the camera looks in from +X +Z, which is
        # Blender's +X −Y, at the game's own elevation.
        frame(made, -35.0, GAME_ELEVATION, cam, 1.15)
        bpy.ops.render.render(write_still=False)
        path = os.path.join(OUT, f"{style}.png")
        bpy.data.images["Render Result"].save_render(filepath=path, scene=scene)
        print(f"  wrote {path} ({os.path.getsize(path)} bytes)")
        for o in made:
            bpy.data.objects.remove(o, do_unlink=True)


if __name__ == "__main__":
    try:
        main()
    except Exception:
        traceback.print_exc()
        sys.exit(1)
