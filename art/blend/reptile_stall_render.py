"""Renders the stall kit to ``art/renders/reptile-stall/`` so a human can eyeball it.

    blender --background --factory-startup --python-exit-code 1 \
        --python art/blend/reptile_stall_render.py [-- <out dir>]

Not part of ``pnpm run blend:reptile-stall`` — review pictures, not shipped
bytes. Run it whenever the shapes change. An optional directory after ``--``
sends copies somewhere else as well (a scratchpad for a review thread).

Workbench, like ``hotel_render.py`` and for its reason: flat object colour with
an ink outline is the nearest thing a background render gets to the game's
own look, so a shape reading badly here reads badly in the park.

**The colours are the loader's** (``src/art/models/reptileStallAssets.ts``'s
``STYLES``), parsed the way ``reptile_house_render.py`` parses its own, with
the hex behind each palette key read by ``castle_render.palette_values``. No
table of numbers lives here: the first cut's hand-typed one agreed with the
loader by luck and would have gone on agreeing by nobody checking.

The composition stands the kit in the arrangement the game puts it in: the
kiosk's own counter and back panel as plain stand-in boxes (they are
``kiosk.ts``'s to build, not this kit's), the two frames set side by side,
and a child-sized box on the stand spot, because the whole headroom claim is a
claim about a child's hat.
"""

import math
import os
import shutil
import sys
import traceback

import bpy
from mathutils import Vector

HERE = os.path.dirname(os.path.abspath(__file__))
if HERE not in sys.path:
    sys.path.insert(0, HERE)
sys.dont_write_bytecode = True

import reptile_stall_build as rb  # noqa: E402  (import-safe: everything is behind main())
from blendkit import REPO, ts_const  # noqa: E402
from castle_render import palette_values  # noqa: E402
from reptile_constants import (  # noqa: E402
    BACK_PANEL_HEIGHT,
    BACK_PANEL_THICKNESS,
    COUNTER_DEPTH,
    COUNTER_HALF_WIDTH,
    COUNTER_Z,
    TALLEST_CHILD_HEIGHT,
)

BLEND = os.path.join(REPO, "art", "blend", "reptile_stall.blend")
OUT = os.path.join(REPO, "art", "renders", "reptile-stall")

KID_HEIGHT = ts_const("src/art/models/kid.ts", "KID_HEIGHT")

ENGINEER_MODULE = "src/art/models/reptileStallAssets.ts"


def engineer_colours():
    """``{node name: hex}`` from the loader's ``STYLES`` table — the same regex
    ``reptile_house_render.engineer_styles`` uses, over this kit's module."""
    import re

    source = open(os.path.join(REPO, ENGINEER_MODULE), encoding="utf-8").read()
    found = re.findall(
        r"['\"]?(rs-[\w-]*)['\"]?:\s*\{[^}]*?colour:\s*((?:PALETTE|ART)\.\w+)",
        source,
        re.DOTALL,
    )
    assert found, f"{ENGINEER_MODULE} has no STYLES rows for rs- parts — nothing to render the game's colours from"
    values = palette_values()
    missing = [key for _, key in found if key not in values]
    assert not missing, f"these colours are named but do not exist in the palette modules: {missing}"
    return {name: values[key] for name, key in found}


STANDIN_KIOSK = 0xFFF3E2  # ART.cream — kiosk.ts's own counter colour
STANDIN_FLOOR = 0xF4EEF9
STANDIN_CHILD = 0xE86F9B

#: Where the meter stands in the "both" shot, Blender metres. Preview only.
METER_PLACE = (3.4, -1.4, 0.0)
#: The stand spot: straight in front of the counter, at the layout's reach
#: (STALL_STAND is 1.6 m along both axes from STALL_POSITION, on a 45° stall).
STAND_DISTANCE = math.hypot(1.6, 1.6)

# stem -> (which prefixes to show, azimuth° off the front, elevation°, pad, with kiosk?, with child?)
SHOTS = [
    # The park's own camera, near enough: from +X −Y, pitched down 38°.
    ("stall-park-camera", ("stall",), 45.0, 38.0, 1.15, True, True),
    ("stall-front", ("stall",), 0.0, 12.0, 1.1, True, True),
    ("stall-near-corner", ("stall",), 70.0, 25.0, 0.8, True, False),
    ("meter-park-camera", ("meter",), 45.0, 38.0, 1.1, False, True),
    ("meter-front", ("meter",), 10.0, 8.0, 1.1, False, False),
    ("both-park-camera", ("stall", "meter"), 45.0, 38.0, 1.1, True, True),
]


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
    # Standard, never AgX: the park's pastels go grey under it (hotel_render).
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
    shading.background_color = (0.86, 0.91, 0.96)
    scene.display.render_aa = "16"
    colours = engineer_colours()
    print(f"  colours from: {ENGINEER_MODULE}")
    for obj in bpy.data.objects:
        if obj.type == "MESH":
            assert obj.name in colours, f"{ENGINEER_MODULE} has no colour for {obj.name}"
            obj.color = linear_rgba(colours[obj.name])


def standin_box(name: str, size, centre, colour: int):
    """A plain box for a thing this kit does not own. Removed after the shot."""
    hx, hy, hz = (s * 0.5 for s in size)
    verts = [
        (-hx, -hy, -hz), (hx, -hy, -hz), (hx, hy, -hz), (-hx, hy, -hz),
        (-hx, -hy, hz), (hx, -hy, hz), (hx, hy, hz), (-hx, hy, hz),
    ]
    faces = [(0, 3, 2, 1), (4, 5, 6, 7), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)]
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(verts, [], faces)
    mesh.validate(verbose=False)
    obj = bpy.data.objects.new(name, mesh)
    obj.location = centre
    obj.color = linear_rgba(colour)
    bpy.context.scene.collection.objects.link(obj)
    return obj


def kiosk_standins(offset=(0.0, 0.0, 0.0)):
    """`kiosk.ts`'s counter, top plank and back panel, as boxes, where it builds them."""
    ox, oy, oz = offset
    return [
        standin_box("standin-counter", (COUNTER_HALF_WIDTH * 2, COUNTER_DEPTH, 0.95), (ox, oy - COUNTER_Z, oz + 0.475), STANDIN_KIOSK),
        standin_box("standin-counter-top", (COUNTER_HALF_WIDTH * 2 + 0.24, 0.86, 0.12), (ox, oy - COUNTER_Z, oz + 0.98), 0xFFFFFF),
        standin_box("standin-back-panel", (COUNTER_HALF_WIDTH * 2, BACK_PANEL_THICKNESS, BACK_PANEL_HEIGHT), (ox, oy + rb.BACK_PANEL_Y, oz + BACK_PANEL_HEIGHT / 2), STANDIN_KIOSK),
    ]


def child_standin(x, y):
    """KID_HEIGHT body plus the hat block up to TALLEST_CHILD_HEIGHT (hotel_render)."""
    return [
        standin_box("standin-child", (0.55, 0.34, KID_HEIGHT), (x, y, KID_HEIGHT * 0.5), STANDIN_CHILD),
        standin_box("standin-child-hat", (0.78, 0.78, TALLEST_CHILD_HEIGHT - KID_HEIGHT), (x, y, (KID_HEIGHT + TALLEST_CHILD_HEIGHT) * 0.5), STANDIN_CHILD),
    ]


def frame(objects, azimuth_deg: float, elevation_deg: float, camera, pad: float) -> None:
    lo = Vector((1e9, 1e9, 1e9))
    hi = Vector((-1e9, -1e9, -1e9))
    for obj in objects:
        for corner in obj.bound_box:
            world = obj.matrix_world @ Vector(corner)
            lo = Vector((min(lo[i], world[i]) for i in range(3)))
            hi = Vector((max(hi[i], world[i]) for i in range(3)))
    centre = (lo + hi) * 0.5
    size = max((hi - lo).x, (hi - lo).y, (hi - lo).z)
    azimuth = math.radians(azimuth_deg)
    elevation = math.radians(elevation_deg)
    direction = Vector((math.sin(azimuth) * math.cos(elevation), -math.cos(azimuth) * math.cos(elevation), math.sin(elevation)))
    camera.location = centre + direction * (size * 3.0 + 2.0)
    camera.rotation_mode = "QUATERNION"
    camera.rotation_quaternion = direction.to_track_quat("Z", "Y")
    camera.data.type = "ORTHO"
    camera.data.ortho_scale = size * pad


def main() -> None:
    extra_out = None
    if "--" in sys.argv:
        extra_out = sys.argv[sys.argv.index("--") + 1]
    bpy.ops.wm.open_mainfile(filepath=BLEND)
    configure()
    os.makedirs(OUT, exist_ok=True)
    if extra_out:
        os.makedirs(extra_out, exist_ok=True)

    camera_data = bpy.data.cameras.new("review-cam")
    camera = bpy.data.objects.new("review-cam", camera_data)
    bpy.context.scene.collection.objects.link(camera)
    bpy.context.scene.camera = camera

    print("\nreptile_stall_render")
    for stem, frames, azimuth, elevation, pad, with_kiosk, with_child in SHOTS:
        both = len(frames) == 2
        shown = []
        for obj in bpy.data.objects:
            if obj.type != "MESH":
                continue
            is_meter = obj.name.startswith("rs-meter-")
            visible = ("meter" in frames) if is_meter else ("stall" in frames)
            obj.hide_render = not visible
            # The meter is authored about its own base, so as-built it stands
            # inside the stall; the "both" shot sets it beside the counter.
            # Preview placement only — this scene is never saved.
            obj.location = METER_PLACE if (is_meter and both) else (0.0, 0.0, 0.0)
            if visible:
                shown.append(obj)
        extras = []
        if with_kiosk:
            extras += kiosk_standins()
        if with_child:
            if "stall" in frames:
                extras += child_standin(0.0, -STAND_DISTANCE)
            else:
                extras += child_standin(-1.4, -0.5)
        floor_lo = Vector((1e9, 1e9, 0.0))
        floor_hi = Vector((-1e9, -1e9, 0.0))
        for obj in shown + extras:
            for corner in obj.bound_box:
                world = obj.matrix_world @ Vector(corner)
                floor_lo.x, floor_lo.y = min(floor_lo.x, world.x), min(floor_lo.y, world.y)
                floor_hi.x, floor_hi.y = max(floor_hi.x, world.x), max(floor_hi.y, world.y)
        extras.append(
            standin_box(
                "standin-floor",
                (floor_hi.x - floor_lo.x + 1.6, floor_hi.y - floor_lo.y + 1.6, 0.2),
                ((floor_lo.x + floor_hi.x) / 2, (floor_lo.y + floor_hi.y) / 2, -0.1),
                STANDIN_FLOOR,
            )
        )
        bpy.context.view_layer.update()
        frame(shown + extras[:-1], azimuth, elevation, camera, pad)
        path = os.path.join(OUT, f"{stem}.png")
        bpy.context.scene.render.filepath = path
        bpy.ops.render.render(write_still=True)
        print(f"  {stem:<22} {os.path.getsize(path):>8} bytes")
        if extra_out:
            shutil.copy(path, os.path.join(extra_out, f"{stem}.png"))
        for obj in extras:
            mesh = obj.data
            bpy.data.objects.remove(obj, do_unlink=True)
            bpy.data.meshes.remove(mesh)
    print()


if __name__ == "__main__":
    try:
        main()
    except Exception:
        traceback.print_exc()
        sys.exit(1)
