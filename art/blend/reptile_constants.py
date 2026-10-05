"""The Reptile House's game-owned numbers, read for every ``reptile_*`` script.

**This module declares no number.** Every value is read out of
``src/world/reptileHouse/layout.ts`` — the one owner — with
:func:`blendkit.ts_const`, plus the handful of game-wide figures that live in
their own owners (``kid.ts``, ``stallShape.ts``). A build script that wants a
shared dimension imports it from here::

    import os, sys
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    from blendkit import Part, collection, reset_scene  # noqa: E402
    from reptile_constants import (  # noqa: E402
        REPTILE_SHELL_RADIUS,
        REPTILE_TAIL_REACH,
        TALLEST_CHILD_HEIGHT,
    )

and **never** types the figure itself. If a number you need is missing here,
add the ``export const`` to ``layout.ts`` first, then the one-line read below
— that keeps the Python a mirror of the TypeScript rather than a second
source. Derived values (``REPTILE_DOOR_BAND_OUTER`` and friends) are not
readable by the regex on purpose; derive them here from the same literals,
in the same arithmetic, if a script needs them.

Sanity assertions at the bottom fail the Blender run at import, before any
geometry is built, so a renamed or reformatted constant cannot produce a
silently wrong asset.
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from blendkit import ts_const  # noqa: E402

LAYOUT = "src/world/reptileHouse/layout.ts"
KID = "src/art/models/kid.ts"
STALL_SHAPE = "src/world/building/shops/stallShape.ts"


def _layout(name: str) -> float:
    return ts_const(LAYOUT, name)


# --- the space -------------------------------------------------------------
REPTILE_HOUSE_ORIGIN_X = _layout("REPTILE_HOUSE_ORIGIN_X")
REPTILE_HOUSE_ORIGIN_Z = _layout("REPTILE_HOUSE_ORIGIN_Z")
REPTILE_HOUSE_FLOOR_Y = _layout("REPTILE_HOUSE_FLOOR_Y")
REPTILE_HOUSE_PLAY_RADIUS = _layout("REPTILE_HOUSE_PLAY_RADIUS")

# --- plate and shell -------------------------------------------------------
REPTILE_HALF_X = _layout("REPTILE_HALF_X")
REPTILE_HALF_Z = _layout("REPTILE_HALF_Z")
REPTILE_WALL_HEIGHT = _layout("REPTILE_WALL_HEIGHT")
REPTILE_DOOR_X = _layout("REPTILE_DOOR_X")

# --- exterior ("house" kit) ------------------------------------------------
REPTILE_SHELL_RADIUS = _layout("REPTILE_SHELL_RADIUS")
# Derived in layout.ts from two literals it also owns; the same arithmetic
# on the same reads, no number of our own.
REPTILE_DOOR_BAND_OUTER = REPTILE_SHELL_RADIUS + _layout("REPTILE_DOOR_BAND_STANDOFF")
REPTILE_DRAWN_DOOR_ALONG = REPTILE_SHELL_RADIUS - _layout("REPTILE_DRAWN_DOOR_INSET")
REPTILE_TAIL_REACH = _layout("REPTILE_TAIL_REACH")
REPTILE_TAIL_BEARING_OFFSET = _layout("REPTILE_TAIL_BEARING_OFFSET")
REPTILE_ARCH_WIDTH = _layout("REPTILE_ARCH_WIDTH")
REPTILE_ARCH_HEIGHT = _layout("REPTILE_ARCH_HEIGHT")
REPTILE_FOOTPRINT_RADIUS = _layout("REPTILE_FOOTPRINT_RADIUS")
REPTILE_BOUNDING_RADIUS = _layout("REPTILE_BOUNDING_RADIUS")

# --- enclosure masonry ("cases" kit) ---------------------------------------
REPTILE_CASE_SEGMENT = _layout("REPTILE_CASE_SEGMENT")
REPTILE_CASE_HALF_DEPTH = _layout("REPTILE_CASE_HALF_DEPTH")
REPTILE_CASE_PLINTH_HEIGHT = _layout("REPTILE_CASE_PLINTH_HEIGHT")
REPTILE_GLASS_TOP = _layout("REPTILE_GLASS_TOP")
REPTILE_PIER_POST_RADIUS = _layout("REPTILE_PIER_POST_RADIUS")
REPTILE_ENCLOSURE_WALL_HEIGHT = _layout("REPTILE_ENCLOSURE_WALL_HEIGHT")
REPTILE_ROUND_WALL_RADIUS = _layout("REPTILE_ROUND_WALL_RADIUS")
REPTILE_LAGOON_SEGMENT = _layout("REPTILE_LAGOON_SEGMENT")
REPTILE_LAGOON_HALF = _layout("REPTILE_LAGOON_HALF")
REPTILE_TORTOISE_SEGMENT = _layout("REPTILE_TORTOISE_SEGMENT")
REPTILE_TORTOISE_HALF = _layout("REPTILE_TORTOISE_HALF")
REPTILE_NURSERY_RADIUS = _layout("REPTILE_NURSERY_RADIUS")
REPTILE_NURSERY_KERB_HEIGHT = _layout("REPTILE_NURSERY_KERB_HEIGHT")
REPTILE_NURSERY_RAIL_TOP = _layout("REPTILE_NURSERY_RAIL_TOP")
REPTILE_ISLAND_RADIUS = _layout("REPTILE_ISLAND_RADIUS")
REPTILE_ISLAND_KERB_HEIGHT = _layout("REPTILE_ISLAND_KERB_HEIGHT")
REPTILE_JAR_RADIUS = _layout("REPTILE_JAR_RADIUS")
REPTILE_JAR_BASE_HEIGHT = _layout("REPTILE_JAR_BASE_HEIGHT")

# --- plants ("plants" kit) -------------------------------------------------
REPTILE_LOG_INNER_RADIUS = _layout("REPTILE_LOG_INNER_RADIUS")
REPTILE_LOG_OUTER_RADIUS = _layout("REPTILE_LOG_OUTER_RADIUS")
REPTILE_LOG_LENGTH = _layout("REPTILE_LOG_LENGTH")
REPTILE_PALM_HEIGHT = _layout("REPTILE_PALM_HEIGHT")
REPTILE_BANYAN_HEIGHT = _layout("REPTILE_BANYAN_HEIGHT")

# --- creatures and Noodle ("creatures", "noodle" kits) ---------------------
REPTILE_SNAKE_HEAD_LENGTH = _layout("REPTILE_SNAKE_HEAD_LENGTH")
REPTILE_NOODLE_BODY_RADIUS = _layout("REPTILE_NOODLE_BODY_RADIUS")
REPTILE_NOODLE_MOUND_HEIGHT = _layout("REPTILE_NOODLE_MOUND_HEIGHT")
REPTILE_NOODLE_HEAD_X = _layout("REPTILE_NOODLE_HEAD_X")
REPTILE_NOODLE_HEAD_Z = _layout("REPTILE_NOODLE_HEAD_Z")
REPTILE_NOODLE_HEAD_Y = _layout("REPTILE_NOODLE_HEAD_Y")

# --- stall ("stall" kit) ---------------------------------------------------
REPTILE_BABY_SNAKE_UNIT = _layout("REPTILE_BABY_SNAKE_UNIT")
REPTILE_METER_POST_HEIGHT = _layout("REPTILE_METER_POST_HEIGHT")
COUNTER_HALF_WIDTH = ts_const(STALL_SHAPE, "COUNTER_HALF_WIDTH")
# The rest of the kiosk envelope the awning has to sit over — `kiosk.ts` builds
# the counter and the back panel to these, so the stall kit reads the same
# lines rather than guessing where the cloth's eaves and the finial's perch are.
# `BACK_PANEL_Z` is derived in `stallShape.ts` (`SHELF_Z - 0.25`), so it is
# re-derived here with the same arithmetic from the same literal.
COUNTER_Z = ts_const(STALL_SHAPE, "COUNTER_Z")
COUNTER_DEPTH = ts_const(STALL_SHAPE, "COUNTER_DEPTH")
SHELF_Z = ts_const(STALL_SHAPE, "SHELF_Z")
BACK_PANEL_Z = SHELF_Z - 0.25  # as stallShape.ts derives it
BACK_PANEL_THICKNESS = ts_const(STALL_SHAPE, "BACK_PANEL_THICKNESS")
BACK_PANEL_HEIGHT = ts_const(STALL_SHAPE, "BACK_PANEL_HEIGHT")

# --- game-wide figures with their own owners -------------------------------
TALLEST_CHILD_HEIGHT = ts_const(KID, "TALLEST_CHILD_HEIGHT")
#: Where `snakeFace.ts` paints Sunny's eyes, as a fraction of her head's
#: canvas from its top — the house build asserts that row lands above the mouth.
SUNNY_FACE_EYE_ROW = ts_const("src/art/models/snakeFace.ts", "SUNNY_FACE_EYE_ROW")
KID_EYE_HEIGHT = ts_const(KID, "KID_EYE_HEIGHT")
DOOR_HALF = ts_const("src/world/hotel/layout.ts", "DOOR_HALF")

# --- the relationships the spec promises, checked before any mesh is built --
assert REPTILE_ARCH_WIDTH >= 2 * DOOR_HALF, "the snake-hole arch is narrower than the doorway"
assert REPTILE_ARCH_HEIGHT >= TALLEST_CHILD_HEIGHT + 0.4, "the arch head is too low for the tallest hat"
assert 2 * REPTILE_LOG_INNER_RADIUS >= TALLEST_CHILD_HEIGHT + 0.3, "the hollow log is too low to walk through"
assert REPTILE_LOG_OUTER_RADIUS > REPTILE_LOG_INNER_RADIUS, "the hollow log has no wall"
assert REPTILE_ENCLOSURE_WALL_HEIGHT < KID_EYE_HEIGHT, "she could not see over an open enclosure wall"
assert REPTILE_NURSERY_RAIL_TOP > REPTILE_NURSERY_KERB_HEIGHT, "the nursery glass is below its kerb"
assert REPTILE_METER_POST_HEIGHT >= TALLEST_CHILD_HEIGHT, "the Noodle-o-meter is shorter than the tallest hat"
assert REPTILE_TAIL_REACH > REPTILE_SHELL_RADIUS, "the tail signpost stands inside the collision shell"
assert REPTILE_BOUNDING_RADIUS > REPTILE_FOOTPRINT_RADIUS > REPTILE_SHELL_RADIUS, "the plot radii do not enclose the shell"
