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
import sys

import bpy
from mathutils import Vector

HERE = os.path.dirname(os.path.abspath(__file__))
if HERE not in sys.path:
    sys.path.insert(0, HERE)
# No `__pycache__` beside the authoring scripts: `art/blend/` is a tracked
# directory and `.gitignore` says nothing about `.pyc`, so importing a sibling
# would leave a binary in `git status` after every review render.
sys.dont_write_bytecode = True

# **The composition shots take their arithmetic from the builder itself.**
# `hotel_build` is import-safe (everything is behind `main()`), so the recipe
# below is written in terms of the very constants the geometry was made from —
# a stair whose sweep changes moves the review render with it instead of
# quietly rendering a composition that no longer exists. Which is exactly what
# happened to `staircase-pair-front` the first time round.
import hotel_build as hb  # noqa: E402

REPO = os.path.dirname(os.path.dirname(HERE))
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
    # Both hands of the staircase are the same five colours: they are one piece
    # of architecture seen twice, and a pair that did not match would be two
    # staircases rather than a composition.
    "stair-right-tread": 0xCDEEFF,  # PALETTE.glassTint (the lobby's floor colour)
    "stair-right-stringer": 0xC9A9FF,  # PALETTE.markerLilac (the lobby's trim)
    "stair-right-rail": 0xFFD76E,  # PALETTE.liftFrame
    "stair-right-baluster": 0xFFF3F8,  # PALETTE.blossomWhite
    "stair-right-newel": 0xD7B3FF,  # PALETTE.flowerViolet
    "stair-left-tread": 0xCDEEFF,
    "stair-left-stringer": 0xC9A9FF,
    "stair-left-rail": 0xFFD76E,
    "stair-left-baluster": 0xFFF3F8,
    "stair-left-newel": 0xD7B3FF,
    "stair-straight-tread": 0xCDEEFF,
    "stair-straight-stringer": 0xC9A9FF,
    "stair-straight-rail": 0xFFD76E,
    "stair-straight-baluster": 0xFFF3F8,
    "stair-straight-newel": 0xD7B3FF,
    "landing-nose": 0xC9A9FF,  # PALETTE.markerLilac — the strings' own masonry
    "bridge-rail-plinth": 0xFFF2DC,  # PALETTE.signBoard
    "bridge-rail-baluster": 0xFFF3F8,  # PALETTE.blossomWhite
    "bridge-rail-hand": 0xFFD76E,  # PALETTE.liftFrame
    "bridge-newel": 0xD7B3FF,  # PALETTE.flowerViolet
    "chandelier-frame": 0xFFD76E,  # PALETTE.liftFrame
    "chandelier-drop": 0xFFF2DC,  # PALETTE.signBoard (lit warm in code)
}

# Every asset's origin is its own base, so a whole collection rendered as-authored
# stacks its assets inside one another — the breakfast set's first review render
# was a chair buried in a table with three bowls inside the pedestal. These are
# **preview placements only**, applied to a scene this script never saves. Where
# an asset has a natural place (a bowl on the table, a chair at it) the preview
# uses it, because that is the arrangement the shapes have to work in.
PART_SUFFIXES = ("tread", "stringer", "rail", "baluster", "newel")

# =============================================================================
# The imperial composition, laid out from `hotel_build`'s own constants
# =============================================================================
#
# Blender is the game's frame with **z up and y reversed**: game +Z is Blender
# −y. The recipe below is written in Blender's, with the landing's front edge on
# y = 0 and the composition climbing toward +y (which is the game's −Z, deeper
# into the room, away from the entrance).
#
# `C` is the free parameter: how far apart the two arcs' centres are. It is
# chosen so the two curves' **top newels** — which are the two ends of the
# landing's front balustrade — come out a whole number of balustrade tiles
# apart. A part-tile is the one thing that run cannot do.

C = hb.STAIR_RAIL_R + 3.0 * hb.BRIDGE_RAIL_TILE
"""Half the distance between the two arcs' centres: six tiles between the two
top newels, which stand at x = ±(C − STAIR_RAIL_R) = ±3.06."""

FRONT_HALF = C - hb.STAIR_RAIL_R
"""…that run's half-length, and where the front balustrade stops each side."""

SIDE_TILES = 5
LANDING_BACK = SIDE_TILES * hb.BRIDGE_RAIL_TILE
"""How far the platform reaches back from the curves' tops to the gallery it
delivers you to — five tiles, so each side edge is a whole run too."""

LANDING_DEPTH = LANDING_BACK - hb.STRAIGHT_RUN
"""…and therefore where the straight flight's foot sits: what is left of the
platform once the flight has taken its run out of it."""

LANDING_HALF_X = C - hb.STAIR_INNER_R
"""The platform's half width: out to the far end of each curve's top tread."""

RAIL_INSET = 0.115
"""Half the balustrade's depth. A run is set in by this much from the edge it
guards, so its outer face lands exactly on that edge and the nosing below it
still has its overhang in clear air."""


def composition():
    """Every piece of the assembly, as (object name, location, yaw°) in Blender.

    One list, built once, so the isometric and the front elevation cannot
    disagree about what they are showing — the exact bug that let
    `staircase-pair-front` render two flights stacked at the origin for a whole
    round of review.
    """
    places: list[tuple[str, tuple[float, float, float], float]] = []
    # The two curves. `fromAngle = ±45°` — a rotation of ∓45° in both Blender
    # and three.js — is what lands their top treads *square* to the landing,
    # running along x with the climber heading into the room. With a 45° sweep
    # you can have the foot square or the top square and not both; a floor takes
    # a stair at any angle and a landing does not.
    for hand, sign in (("right", 1.0), ("left", -1.0)):
        for part in PART_SUFFIXES:
            places.append((f"stair-{hand}-{part}", (sign * C, 0.0, 0.0), -sign * 45.0))
    # The wide flight, standing on the landing with its bottom riser facing the
    # entrance.
    for part in PART_SUFFIXES:
        places.append(
            (f"stair-straight-{part}", (0.0, LANDING_DEPTH, hb.LANDING_HEIGHT), 0.0)
        )
    # The landing's front balustrade: six tiles between the two curves' top
    # newels, which are the run's end posts — no extra newel there, because the
    # stair already finishes with one and two posts in one place is a lump.
    for i in range(6):
        x = -FRONT_HALF + (i + 0.5) * hb.BRIDGE_RAIL_TILE
        places.append(("bridge-rail-plinth", (x, RAIL_INSET, hb.LANDING_HEIGHT), 0.0))
        places.append(("bridge-rail-baluster", (x, RAIL_INSET, hb.LANDING_HEIGHT), 0.0))
        places.append(("bridge-rail-hand", (x, RAIL_INSET, hb.LANDING_HEIGHT), 0.0))
        places.append(("landing-nose", (x, 0.0, hb.LANDING_HEIGHT), 0.0))
    # …and its two side edges, the same tiles turned a quarter turn, from the
    # front corner back to the gallery, with a newel on each end of each run.
    for sign in (1.0, -1.0):
        edge = sign * LANDING_HALF_X
        yaw = sign * 90.0
        for i in range(SIDE_TILES):
            y = (i + 0.5) * hb.BRIDGE_RAIL_TILE
            inset = edge - sign * RAIL_INSET
            places.append(("bridge-rail-plinth", (inset, y, hb.LANDING_HEIGHT), yaw))
            places.append(("bridge-rail-baluster", (inset, y, hb.LANDING_HEIGHT), yaw))
            places.append(("bridge-rail-hand", (inset, y, hb.LANDING_HEIGHT), yaw))
            places.append(("landing-nose", (edge, y, hb.LANDING_HEIGHT), yaw))
        for y in (0.0, LANDING_BACK):
            places.append(("bridge-newel", (edge - sign * RAIL_INSET, y, hb.LANDING_HEIGHT), 0.0))
    return places


# The floor, the landing and the gallery deck are the **room's** to build, not
# this asset's — but a composition rendered without them is three flights
# floating in white, and the whole question this shot exists to answer is
# whether they land on each other. So the review render stands in for them with
# plain boxes, in a scene it never saves. They are boxes on purpose: anything
# more would start to look like art this file owns.
STANDIN_SLAB = 0xD8CCEC
STANDIN_FLOOR = 0xF4EEF9


def standins():
    """(name, size, centre) boxes for the assembly shot, in Blender metres."""
    slab = 0.30
    return [
        (
            "standin-floor",
            (2 * (C - 0.8), LANDING_BACK + 4.6, 0.30),
            (0.0, LANDING_BACK * 0.5 - 1.6, -0.15),
            STANDIN_FLOOR,
        ),
        (
            "standin-landing",
            (2 * LANDING_HALF_X, LANDING_BACK, slab),
            (0.0, LANDING_BACK * 0.5, hb.LANDING_HEIGHT - slab * 0.5),
            STANDIN_SLAB,
        ),
        (
            "standin-gallery",
            (2 * (LANDING_HALF_X + 1.0), 3.4, slab),
            (0.0, LANDING_BACK + 1.7, hb.STAIR_RISE - slab * 0.5),
            STANDIN_SLAB,
        ),
    ]


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
    # A newel centred on each end of a three-tile run. The handrail dies into
    # the post, which is what joinery does and what hides both end caps.
    "bridge-rail": {"bridge-newel": (-1.53, 0.0, 0.0)},
}

# Shots built entirely out of linked copies at absolute places, rather than out
# of one collection sitting at its own origin: the composition is three flights,
# twenty-odd balustrade tiles and a nosing run, and every one of them is a
# *repeat* of an asset authored about its own origin.
PLACEMENTS = {
    "staircase-assembly": composition(),
    "staircase-assembly-front": composition(),
    "staircase-assembly-landing": composition(),
}

STANDINS = {
    "staircase-assembly": standins(),
    "staircase-assembly-front": standins(),
    "staircase-assembly-landing": standins(),
}

# stem -> {object: [extra offsets]}. Linked copies made just for that shot and
# removed after it, so a run of tiled segments can be judged as a run — the one
# thing a single tile cannot show is whether two of them meet cleanly.
COPIES = {
    "bridge-rail": {
        "bridge-rail-plinth": [(-1.02, 0.0, 0.0), (1.02, 0.0, 0.0)],
        "bridge-rail-baluster": [(-1.02, 0.0, 0.0), (1.02, 0.0, 0.0)],
        "bridge-rail-hand": [(-1.02, 0.0, 0.0), (1.02, 0.0, 0.0)],
        "bridge-newel": [(3.06, 0.0, 0.0)],
    },
    "landing-nose": {"landing-nose": [(-1.02, 0.0, 0.0), (1.02, 0.0, 0.0)]},
}

# Objects a shot leaves out entirely, by shot name.
OMIT = {
    "breakfast-bowls": {"table-top", "table-leg", "chair"},
    "lift-doors": {"lift-car", "lift-car-floor", "lift-car-rail"},
    "lift-car": {"lift-frame", "lift-frame-sill", "lift-door-left", "lift-door-right"},
}

# file stem -> (collection(s), camera azimuth in degrees off the front, elevation)
# Azimuth 0 looks straight along +Y (at the asset's front face, which is −Y).
# The collection field takes a name or a tuple of names, because the twin-stair
# composition is two collections and judging a mirror image means seeing both
# in one frame.
# An optional fifth field widens the frame: `frame()` sizes the ortho view off
# the asset's largest single dimension, which crops anything whose diagonal is
# much longer than that — a quarter-turn staircase is 4.4 m in three directions
# at once and lost its newels at the default 1.22.
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
    ("staircase", "hotel-stair-right", 45.0, 36.0, 1.6),
    # …and a low one from the foot of the flight, which is the only angle that
    # shows the rake: strings, handrail and coping should be three parallel
    # straight lines, and any tread out of step shows up as a kink in them.
    ("staircase-rake", "hotel-stair-right", 8.0, 10.0, 1.45),
    # The mirror, from the same two angles. Printed side by side with the two
    # above they are the check a human can actually do; `hotel_build.py`'s
    # `assert_stairs_mirror` is the check a machine does, vertex for vertex.
    ("staircase-left", "hotel-stair-left", 45.0, 36.0, 1.6),
    ("staircase-left-rake", "hotel-stair-left", 8.0, 10.0, 1.45),
    # **The mirror check a human can do in one glance.** Both flights left at
    # the origin, seen from dead ahead — which is *in* the mirror plane, so a
    # true pair renders as an exactly left–right symmetric picture and anything
    # that is not a true pair renders as a picture that is not.
    ("staircase-mirror", ("hotel-stair-right", "hotel-stair-left"), 0.0, 14.0, 1.3),
    # The wide flight on its own, from the park's camera and from the foot.
    # The low one is the shot that says whether the two sides match: two
    # handrails, two rows of balusters and four newels, all of which have to
    # read as one flight rather than as two railings with a floor between them.
    ("staircase-straight", "hotel-stair-straight", 45.0, 36.0, 1.35),
    ("staircase-straight-rake", "hotel-stair-straight", 14.0, 9.0, 1.2),
    # **The composition, assembled.** Three flights, the landing's balustrade
    # and its nosing, at the spacing the placement recipe gives — standing on
    # plain stand-in slabs for the floor, the landing and the gallery, because
    # the question this shot exists to answer is whether they land on each
    # other.
    ("staircase-assembly", (), 45.0, 30.0, 1.12),
    ("staircase-assembly-front", (), 0.0, 10.0, 1.06),
    # …and a closer, lower look at the one join that is new: three flights and
    # two balustrade runs meeting on the landing.
    ("staircase-assembly-landing", (), 24.0, 26.0, 0.72),
    # The nosing, tiled, and **cropped to the joins**. Same question as
    # `bridge-rail`: can you see where one segment stops and the next starts?
    # A 3 m run of a 0.2 m moulding framed whole is a stick, and a stick answers
    # nothing — the pad crops to the middle 1.7 m, which holds both joins.
    ("landing-nose", "hotel-landing-nose", 30.0, 26.0, 0.55),
    # Three tiles and a newel at each end. The only question this shot exists to
    # answer: can you see where one segment stops and the next starts?
    ("bridge-rail", ("hotel-bridge-rail", "hotel-bridge-newel"), 34.0, 22.0, 1.35),
    ("bridge-newel", "hotel-bridge-newel", 30.0, 20.0),
    # Hangs, so it is framed like the disco ball. Low elevation on purpose: a
    # chandelier is looked *up* at, and the varied drop lengths are the whole
    # point of the asset — from above they all read as one flat ring.
    ("chandelier", "hotel-chandelier", 26.0, 12.0, 1.3),
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


def standin_box(name: str, size, centre, colour: int):
    """A plain box for a floor this asset does not own. Removed after the shot."""
    hx, hy, hz = (s * 0.5 for s in size)
    verts = [
        (-hx, -hy, -hz),
        (hx, -hy, -hz),
        (hx, hy, -hz),
        (-hx, hy, -hz),
        (-hx, -hy, hz),
        (hx, -hy, hz),
        (hx, hy, hz),
        (-hx, hy, hz),
    ]
    # Wound outward by hand. `hotel_build`'s `box()` is wound the other way and
    # gets away with it because `Part.emit` recalculates normals; nothing does
    # that here, and a slab whose top face points at the floor renders as a
    # sheet of mid grey — which reads as a lighting choice rather than as the
    # mistake it is.
    faces = [(0, 3, 2, 1), (4, 5, 6, 7), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)]
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(verts, [], faces)
    mesh.validate(verbose=False)
    obj = bpy.data.objects.new(name, mesh)
    obj.location = centre
    obj.color = linear_rgba(colour)
    bpy.context.scene.collection.objects.link(obj)
    return obj


def frame(objects, azimuth_deg: float, elevation_deg: float, camera, pad: float = 1.22) -> None:
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
    camera.data.ortho_scale = size * pad


def main() -> None:
    bpy.ops.wm.open_mainfile(filepath=BLEND)
    configure()
    os.makedirs(OUT, exist_ok=True)

    camera_data = bpy.data.cameras.new("review-cam")
    camera = bpy.data.objects.new("review-cam", camera_data)
    bpy.context.scene.collection.objects.link(camera)
    bpy.context.scene.camera = camera

    print("\nhotel_render")
    for stem, coll_names, azimuth, elevation, *rest in SHOTS:
        pad = rest[0] if rest else 1.22
        names = (coll_names,) if isinstance(coll_names, str) else coll_names
        shown = []
        for coll_name in names:
            coll = bpy.data.collections.get(coll_name)
            if coll is None:
                raise SystemExit(f"hotel_render: no collection '{coll_name}' — rerun hotel_build.py")
            shown.extend(coll.objects)
        layout = LAYOUTS.get(stem, {})
        omit = OMIT.get(stem, set())
        shown = [obj for obj in shown if obj.name not in omit]
        for obj in bpy.data.objects:
            obj.hide_render = obj.type == "MESH" and obj not in shown
            if obj.type == "MESH":
                obj.location = layout.get(obj.name, (0.0, 0.0, 0.0))
        # Linked copies for a tiled run. Made here and removed below, because
        # this script must leave the scene exactly as it found it — it never
        # saves, but the next shot in this same loop would inherit them.
        copies = []
        for name, offsets in COPIES.get(stem, {}).items():
            source = bpy.data.objects[name]
            for offset in offsets:
                clone = source.copy()
                clone.location = Vector(source.location) + Vector(offset)
                clone.color = source.color
                bpy.context.scene.collection.objects.link(clone)
                copies.append(clone)
        # …and the same mechanism for a whole assembly: absolute places and a
        # yaw each, plus the plain boxes that stand in for the room's floors.
        for name, location, yaw in PLACEMENTS.get(stem, ()):
            source = bpy.data.objects[name]
            clone = source.copy()
            clone.location = location
            clone.rotation_mode = "XYZ"
            clone.rotation_euler = (0.0, 0.0, math.radians(yaw))
            clone.color = source.color
            # **The clone inherits `hide_render` from its source**, and the
            # source was hidden three lines ago because it is not in this shot's
            # collection list — a placement shot has no collection. The first
            # run of the assembly render was three stand-in slabs and nothing
            # else, which is a picture that looks like a composition problem and
            # is a visibility one.
            clone.hide_render = False
            bpy.context.scene.collection.objects.link(clone)
            copies.append(clone)
        for name, size, centre, colour in STANDINS.get(stem, ()):
            box = standin_box(name, size, centre, colour)
            copies.append(box)
        shown.extend(copies)
        bpy.context.view_layer.update()
        frame(shown, azimuth, elevation, camera, pad)
        path = os.path.join(OUT, f"{stem}.png")
        bpy.context.scene.render.filepath = path
        bpy.ops.render.render(write_still=True)
        print(f"  {stem:<22} {os.path.getsize(path):>8} bytes")
        for clone in copies:
            mesh = clone.data if clone.name.startswith("standin-") else None
            bpy.data.objects.remove(clone, do_unlink=True)
            if mesh is not None:
                bpy.data.meshes.remove(mesh)
    print()


if __name__ == "__main__":
    main()
