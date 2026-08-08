"""Renders each hotel asset to ``art/renders/hotel/`` so a human can eyeball it.

    blender --background --factory-startup --python art/blend/hotel_render.py

Not part of ``npm run blend:hotel`` — it produces review pictures, not shipped
bytes, and it costs a few seconds. Run it whenever the shapes change.

Workbench, not Eevee or Cycles, deliberately. The game's own look is flat
banded colour with an ink outline (ART_DIRECTION §2), and Workbench's
`color_type='OBJECT'` + object outline is the closest thing to that a
background render can produce in a second: what comes out is close enough to
the shipped material that a shape reading badly here reads badly in the park.
The per-object colours below **mirror `src/art/models/hotelAssets.ts`** — they
are a preview of that file's choices, and the model file is the owner. If the
two disagree, the model file is right and this one is stale.
"""

import math
import os

import bpy
from mathutils import Vector

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
BLEND = os.path.join(REPO, "art", "blend", "hotel.blend")
OUT = os.path.join(REPO, "art", "renders", "hotel")

# Mirrors hotelAssets.ts. PALETTE/ART names in the comments so the two can be
# compared by eye without opening a colour picker.
COLOURS = {
    "tower-main": 0xCDEEFF,  # PALETTE.glassTint
    "tower-spire-a": 0xD7B3FF,  # PALETTE.flowerViolet
    "tower-spire-b": 0xCDF3FF,  # PALETTE.bubbleSkin
    "tower-spire-c": 0xFFC2D8,  # PALETTE.stonePink
    "tower-windows": 0xFFE08A,  # PALETTE.buildingWindowWarm
    "tower-door-jamb": 0xFFB0CF,  # PALETTE.buildingTrim
    "tower-door-glow": 0xFFE08A,  # PALETTE.buildingWindowWarm
    "tower-porch": 0xFFB0CF,  # PALETTE.buildingTrim
    "tower-signboard": 0xFFF2DC,  # PALETTE.signBoard
    "tower-crystals": 0xC9A9FF,  # PALETTE.markerLilac
    "bed-frame": 0xFFB0CF,  # PALETTE.buildingTrim
    "bed-mattress": 0xFFF3E2,  # ART.cream
    "bed-pillow": 0xFFF3F8,  # PALETTE.blossomWhite
    "bed-blanket": 0x7FE3C0,  # PALETTE.markerMint
    "disco-ball": 0xCDF3FF,  # PALETTE.bubbleSkin
    "disco-rod": 0xFFD76E,  # PALETTE.liftFrame
    "table-top": 0xE6BD8C,  # PALETTE.woodLight
    "table-leg": 0xD2A06A,  # PALETTE.wood
    "chair": 0x87C9FF,  # PALETTE.markerSky
    "food-cheerios-bowl": 0xFFF3F8,  # PALETTE.blossomWhite
    "food-shreddies-bowl": 0xFFF3F8,
    "food-yoghurt-bowl": 0xFFF3F8,
    "food-cheerios": 0xFF8FC0,  # PALETTE.markerPink
    "food-shreddies": 0xDCA873,  # ART.biscuitFur
    "food-yoghurt": 0xFFF3E2,  # ART.cream
    "food-yoghurt-honey": 0xFFD76E,  # PALETTE.liftFrame
    "desk-counter": 0xCDEEFF,  # PALETTE.glassTint
    "desk-front": 0xD7B3FF,  # PALETTE.flowerViolet
    "desk-key-board": 0xFFF2DC,  # PALETTE.signBoard
    "door-leaf": 0xFF8FC0,  # PALETTE.markerPink
    "door-frame": 0xCDEEFF,  # PALETTE.glassTint
    "door-knob": 0xFFD76E,  # PALETTE.liftFrame
    "door-plaque": 0xFFF2DC,  # PALETTE.signBoard
    "door-star": 0xFFE066,  # PALETTE.flowerYellow
    "desk-keys": 0xFFD76E,  # PALETTE.liftFrame
    "petbed-base": 0xC9A9FF,  # PALETTE.markerLilac
    "petbed-cushion": 0xFFF3E2,  # ART.cream
    "petbed-bolster": 0xFFA9D4,  # PALETTE.blossomPink
    "petbed-posts": 0xE6BD8C,  # PALETTE.woodLight
    "petbed-canopy": 0x87C9FF,  # PALETTE.markerSky
    "petbed-pillow": 0xFFF3F8,  # PALETTE.blossomWhite
    "petbed-blanket": 0x7FE3C0,  # PALETTE.markerMint
    "petbed-toy": 0xFFC95C,  # PALETTE.slideChute
    "petbed-toy-eye": 0x3B2D3F,  # PALETTE.eyeDark
    "petbowl-bowl": 0x87C9FF,  # PALETTE.markerSky
    "petbowl-food": 0xDCA873,  # ART.biscuitFur
    "lift-door-left": 0xCDEEFF,  # PALETTE.glassTint
    "lift-door-right": 0xCDEEFF,
    "lift-frame": 0xD7B3FF,  # PALETTE.flowerViolet
    "lift-frame-sill": 0xFFD76E,  # PALETTE.liftFrame
    "lift-car": 0xE6BD8C,  # PALETTE.woodLight
    "lift-car-floor": 0xD2A06A,  # PALETTE.wood
    "lift-car-rail": 0xFFD76E,  # PALETTE.liftFrame
    "lift-dial": 0xFFD76E,  # PALETTE.liftFrame
    "lift-dial-face": 0xFFF2DC,  # PALETTE.signBoard
    "lift-dial-ticks": 0x4A3A52,  # PALETTE.ink
    "lift-dial-needle": 0xFF8F8F,  # PALETTE.flowerRed
    "entrance-door-left": 0xCDEEFF,  # PALETTE.glassTint
    "entrance-door-right": 0xCDEEFF,
    "tv-body": 0xD2A06A,  # PALETTE.wood
    "tv-screen": 0x9ADCFF,  # PALETTE.buildingWindow
    "tv-knobs": 0xFFD76E,  # PALETTE.liftFrame
    "tv-stand": 0xB37F4F,  # PALETTE.woodDark
    "tv-aerial": 0xFFD76E,  # PALETTE.liftFrame
    "gameboy-body": 0xD3CACB,  # ART.statueStone
    "gameboy-screen": 0x7FE3C0,  # PALETTE.markerMint
    "gameboy-buttons": 0xFF8FC0,  # PALETTE.markerPink
    "stair-tread": 0xCDEEFF,  # PALETTE.glassTint (the lobby's floor colour)
    "stair-stringer": 0xC9A9FF,  # PALETTE.markerLilac (the lobby's trim)
    "stair-rail": 0xFFD76E,  # PALETTE.liftFrame
    "stair-baluster": 0xFFF3F8,  # PALETTE.blossomWhite
    "stair-newel": 0xD7B3FF,  # PALETTE.flowerViolet
}

# Every asset's origin is its own base, so a whole collection rendered as-authored
# stacks its assets inside one another — the breakfast set's first review render
# was a chair buried in a table with three bowls inside the pedestal. These are
# **preview placements only**, applied to a scene this script never saves. Where
# an asset has a natural place (a bowl on the table, a chair at it) the preview
# uses it, because that is the arrangement the shapes have to work in.
LAYOUTS = {
    "breakfast": {
        "chair": (0.0, -1.02, 0.0),
        "food-cheerios-bowl": (-0.30, 0.16, 0.74),
        "food-cheerios": (-0.30, 0.16, 0.74),
        "food-shreddies-bowl": (0.28, 0.20, 0.74),
        "food-shreddies": (0.28, 0.20, 0.74),
        "food-yoghurt-bowl": (0.02, -0.26, 0.74),
        "food-yoghurt": (0.02, -0.26, 0.74),
        "food-yoghurt-honey": (0.02, -0.26, 0.74),
    },
    "breakfast-bowls": {
        "food-cheerios-bowl": (-0.34, 0.0, 0.0),
        "food-cheerios": (-0.34, 0.0, 0.0),
        "food-yoghurt-bowl": (0.34, 0.0, 0.0),
        "food-yoghurt": (0.34, 0.0, 0.0),
        "food-yoghurt-honey": (0.34, 0.0, 0.0),
    },
    # The lift's four parts are four separate factories and are authored, like
    # everything else here, each about its own origin — so as built they sit
    # inside one another. This is the arrangement the game puts them in: car
    # behind the wall, leaves slid wide open in front of it.
    "lift-open": {
        "lift-door-left": (-0.90, 0.0, 0.0),
        "lift-door-right": (0.90, 0.0, 0.0),
        "lift-car": (0.0, 1.45, 0.0),
        "lift-car-floor": (0.0, 1.45, 0.0),
        "lift-car-rail": (0.0, 1.45, 0.0),
    },
}

# Objects a shot leaves out entirely, by shot name.
OMIT = {
    "breakfast-bowls": {"table-top", "table-leg", "chair"},
    "lift-doors": {"lift-car", "lift-car-floor", "lift-car-rail"},
    "lift-car": {"lift-frame", "lift-frame-sill", "lift-door-left", "lift-door-right"},
}

# file stem -> (collection, camera azimuth in degrees off the front, elevation)
# Azimuth 0 looks straight along +Y (at the asset's front face, which is −Y).
SHOTS = [
    ("tower", "hotel-tower", 34.0, 24.0),
    ("tower-front", "hotel-tower", 0.0, 8.0),
    ("bed", "hotel-bed", 38.0, 30.0),
    ("disco-ball", "hotel-disco", 30.0, 14.0),
    ("breakfast", "hotel-breakfast", 36.0, 26.0),
    ("breakfast-bowls", "hotel-breakfast", 30.0, 34.0),
    ("reception-desk", "hotel-desk", 34.0, 26.0),
    ("yours-door", "hotel-door", 26.0, 16.0),
    ("pet-bed", "hotel-petbed", 32.0, 26.0),
    ("pet-bowl", "hotel-petbowl", 30.0, 40.0),
    ("lift-doors", "hotel-lift", 16.0, 12.0),
    ("lift-open", "hotel-lift", 26.0, 16.0),
    ("lift-car", "hotel-lift", 18.0, 18.0),
    ("lift-dial", "hotel-lift-dial", 12.0, 8.0),
    ("entrance-doors", "hotel-entrance", 22.0, 12.0),
    ("tv", "hotel-tv", 30.0, 20.0),
    # Nearly overhead: the Game Boy is the one asset in this file that lies
    # face **up**, so the shot that says whether it reads is the one the iso
    # camera almost takes.
    ("game-boy", "hotel-gameboy", 20.0, 58.0),
    # **The park's own camera, as nearly as this script can take it.** The game
    # looks from focus + (+X, +Y, +Z) at 38° of pitch; the game's +Z is
    # Blender's −Y, so +45° of azimuth here puts the camera at (+X, −Y), which
    # is the same corner. This is the shot that says whether the sweep reads.
    ("staircase", "hotel-stair", 45.0, 36.0),
    # …and a low one from the foot of the flight, which is the only angle that
    # shows the rake: strings, handrail and coping should be three parallel
    # straight lines, and any tread out of step shows up as a kink in them.
    ("staircase-rake", "hotel-stair", 8.0, 10.0),
]


def srgb_to_linear(c: float) -> float:
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def linear_rgba(hex_value: int):
    parts = [((hex_value >> shift) & 0xFF) / 255.0 for shift in (16, 8, 0)]
    return tuple(srgb_to_linear(p) for p in parts) + (1.0,)


def configure() -> None:
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_WORKBENCH"
    scene.render.resolution_x = 760
    scene.render.resolution_y = 760
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.compression = 92
    # **Standard, never AgX.** Blender's default view transform crushes and
    # desaturates exactly the pale pastels this park is made of — the first
    # pass of these renders showed `glassTint` (a near-white ice blue) as a
    # mid grey and made the whole hotel look like a financial district. The
    # game tone-maps with `NeutralToneMapping` (ART_DIRECTION §6) precisely
    # because ACES-alikes do this, so the review render must not either.
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
    for obj in bpy.data.objects:
        obj.color = linear_rgba(COLOURS.get(obj.name, 0xCCCCCC))


def frame(objects, azimuth_deg: float, elevation_deg: float, camera) -> None:
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
    # Away from the asset's front (−Y) and up.
    direction = Vector(
        (
            math.sin(azimuth) * math.cos(elevation),
            -math.cos(azimuth) * math.cos(elevation),
            math.sin(elevation),
        )
    )
    camera.location = centre + direction * (size * 3.0 + 2.0)
    camera.rotation_mode = "QUATERNION"
    camera.rotation_quaternion = direction.to_track_quat("Z", "Y")
    camera.data.type = "ORTHO"
    camera.data.ortho_scale = size * 1.22


def main() -> None:
    bpy.ops.wm.open_mainfile(filepath=BLEND)
    configure()
    os.makedirs(OUT, exist_ok=True)

    camera_data = bpy.data.cameras.new("review-cam")
    camera = bpy.data.objects.new("review-cam", camera_data)
    bpy.context.scene.collection.objects.link(camera)
    bpy.context.scene.camera = camera

    print("\nhotel_render")
    for stem, coll_name, azimuth, elevation in SHOTS:
        coll = bpy.data.collections.get(coll_name)
        if coll is None:
            raise SystemExit(f"hotel_render: no collection '{coll_name}' — rerun hotel_build.py")
        layout = LAYOUTS.get(stem, {})
        omit = OMIT.get(stem, set())
        shown = [obj for obj in coll.objects if obj.name not in omit]
        for obj in bpy.data.objects:
            obj.hide_render = obj.type == "MESH" and obj not in shown
            if obj.type == "MESH":
                obj.location = layout.get(obj.name, (0.0, 0.0, 0.0))
        bpy.context.view_layer.update()
        frame(shown, azimuth, elevation, camera)
        path = os.path.join(OUT, f"{stem}.png")
        bpy.context.scene.render.filepath = path
        bpy.ops.render.render(write_still=True)
        print(f"  {stem:<16} {os.path.getsize(path):>8} bytes")
    print()


if __name__ == "__main__":
    main()
