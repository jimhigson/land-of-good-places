"""Builds the castle interior's authored geometry and saves ``art/blend/castle.blend``.

    blender --background --factory-startup --python-exit-code 1 \
        --python art/blend/castle_build.py

Issue #363: *"style the inside of the castle like a castle. Currently it is a
generic box … very many decorative assets such as tapestries and suits of
armour, lighting, and anything else a brainstorm judges as appropriate."*

Like ``hotel_build.py`` and unlike ``cart.blend``, **this script is the
authoring source** and ``castle.blend`` is a generated artefact. Do not
hand-edit the .blend; the next run overwrites it. Then ``castle_export.py``
writes the ``.glb`` and ``npm run blend:castle`` runs build → export → pack.

## The seam with the Engineer

This is a two-agent job (`HANDOFF-castle-interior-363.md` on
`feat/castle-interior-363` is the request contract; `HANDOFF-castle-assets.md`
on this branch is the reply). The split mirrors `hotelAssets.ts`, which is the
worked precedent:

* **This file owns shape and nothing else** — geometry, the UV map on the one
  node a picture is painted into, and one named node per distinctly-coloured
  part. The ``.glb`` carries **no colour and no material**.
* **The Engineer owns `src/art/models/castleAssets.ts`**: the colour table, the
  `AssetHandle` factories, outlines, shadow flags and every placement.
* No flame in this file. The Engineer builds the fire, its glow and its
  flicker, because those are a lighting-budget decision (#251) and not a shape.

Every figure in :data:`CONTRACT` below is a number the two of us must agree on
exactly. It is **asserted against the measured geometry** at the end of this
run, and the Engineer re-derives the same figures from the built mesh with
``visibleBounds()``. Neither of us copies a number out of a document — that is
the bug this project has hit more than any other, and it is what the bridge
pair hit: two formulas that agreed at the two points a spot-check looked and
were 3.2 cm apart everywhere in between.

## Jim's scale rule, which governs every size

> "Maintain the non-proportional scale — it doesn't matter if things are a
> realistic size, only that they are easily recognisable as what they are."

So these are sized for **legibility from the game's isometric camera**, not for
a tape measure: the suit of armour is 2.60 m beside a 1.86 m child, and a
goblet is the size of a bucket. **Do not "correct" these toward realism** —
that is the brief being undone, not a bug being fixed.

Two hard limits override the rule, and only two:

1. Nothing standing on a floor may reach ``CEILING_CLEAR`` (3.30 m — the
   Engineer's, from `BUILDING_FLOOR_HEIGHT` minus `BUILDING_SLAB`).
2. Nothing may be wider than its keep-out allows.

## Conventions (ART_DIRECTION §7, ASSET_MANIFEST's shared contract)

* 1 Blender unit = 1 metre.
* **Blender −Y is the game's +Z.** The exporter's ``export_yup`` maps Blender
  (x, y, z) → glTF (x, z, −y), so anything whose facing matters is built facing
  −Y: a visor, a tapestry's picture, a throne's seat, a chest's lock.
* Origin at the **base**, centred on X and Y, baked into vertex positions.
  Every object leaves Blender at an identity transform, so the assets stand on
  top of one another at the world origin; each lives in its own collection and
  ``castle_render.py`` shows them one at a time.
* **Three documented exceptions**, each declared in :data:`ORIGIN_FAMILY` and
  each checked against the emitted vertices rather than described in prose:
  - ``WALL`` (tapestry, sconce): the wall plane is y = 0 and every vertex is at
    or in front of it, so the placer parents the thing to a point on a wall and
    does no offset arithmetic.
  - ``AXIS`` (the tapestry rail): centred on its own origin, because a pole is
    placed by its axis.
  - ``HINGE`` (the chest lid): the node's origin is the hinge axis, so opening
    the lid is one rotation and not a second formula tracking the first.
* No randomness. Variety comes from where the Engineer puts these and which
  picture is painted on them, never from the parts themselves.
"""

import math
import os
import sys
import traceback

import bpy
from mathutils import Euler, Matrix, Vector

sys.dont_write_bytecode = True
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from blendkit import (  # noqa: E402
    REPO,
    TAU,
    Part,
    box,
    collection,
    cone,
    ellipsoid,
    extrude_outline,
    flat_top_box,
    icosphere,
    planar_uvs,
    reset_scene,
    revolve,
    rounded_box,
    summarise,
    sweep_path,
    total_triangles,
    ts_const,
    tube,
)

BLEND = os.path.join(REPO, "art", "blend", "castle.blend")

# The two numbers the game owns and this file must ask for.
#
# `TALLEST_CHILD` is `kid.ts`'s, guarded by an invariant that re-measures every
# hair style crossed with every hat on every seed.
#
# `CEILING_CLEAR` is the Engineer's, and **there are two ceilings in this room;
# the tighter one governs.** `CASTLE_CEILING_CLEAR` (3.30 m) is the slab
# underside out in the middle of the hall. `BEAM_UNDERSIDE` (3.08 m) is the
# perimeter timber wall-plate, which runs round every wall 0.9 m in and hangs
# 0.22 m below the slab. The Engineer built it on 29 August, after this file's
# first pass, and their §4.4 states the rule that came with it:
#
#   > Anything standing within 1.25 m of a wall must clear 3.08 m
#   > (`BEAM_UNDERSIDE`), not 3.30 m. Out in the room it is still 3.30 m.
#
# **Every floor asset here is checked against the tighter one**, and that is a
# deliberate choice rather than an oversight of the 1.25 m proviso. Not all of
# these stand against a wall, but all of them *may*: eight suits of armour are
# specified "back to a wall", the throne stands at the end of the hall, and the
# chest and benches go wherever the room wants them. An asset that only fits in
# the middle of the floor is an asset carrying an unwritten placement rule, and
# an unwritten placement rule is the "two definitions kept in step by hand" bug
# with one of the definitions missing. Shortening a prop is cheap; discovering
# in a screenshot that somebody pushed the throne back a metre is not.
#
# **Until the Engineer's modules exist, this falls back to 3.08 from their
# contract.** The fallback is stated, printed loudly, and deliberately the
# *tight* number rather than the loose one, so the day it is wrong it is wrong
# in the direction that leaves a gap rather than the direction that puts a
# finial through a beam. It used to be 3.30, which was the loose number and,
# by 29 August, a superseded one as well.
CEILING_CLEAR_FALLBACK = 3.08
# In tightest-first order. Whichever of these resolves first wins; they are two
# readings of one room and the wall-plate is the one every asset must survive.
CEILING_SOURCES = (
    ("src/world/building/castleFabric.ts", "BEAM_UNDERSIDE"),
    ("src/art/models/castleAssets.ts", "CASTLE_CEILING_CLEAR"),
)


def read_ceiling_clear():
    """The headroom to assert against, and a sentence saying where it came from.

    Distinguishes the two reasons a read can fail, because they mean opposite
    things. **The module not existing yet** is the expected state on this
    branch and falls back quietly-but-loudly. **The module existing while the
    constant cannot be read** is a seam that has moved, and the note says so by
    name rather than blending into the same message — a fallback that cannot
    tell "not here yet" from "here and unreadable" is a check reporting success
    about something it is not describing.
    """
    for path, name in CEILING_SOURCES:
        if not os.path.exists(os.path.join(REPO, path)):
            continue
        try:
            return ts_const(path, name), f"{path}'s {name}"
        except AssertionError:
            # `ts_const` only reads `export const NAME = <number>;`. Both of
            # these constants are currently *derived* — `BEAM_UNDERSIDE =
            # CASTLE_CEILING_CLEAR - BEAM_DEPTH` — so the regex will not match
            # them even once the file lands. That is a real thing to fix at the
            # seam, not here: asked of the Engineer in §2.5 of the handoff.
            return (
                CEILING_CLEAR_FALLBACK,
                f"the fallback — {path} exists but `{name}` is a derived "
                "expression, not `export const NAME = <number>;`, so it cannot "
                "be read. See handoff §2.5",
            )
    return (
        CEILING_CLEAR_FALLBACK,
        "the Engineer's contract, §4.4 (neither of their modules is on this "
        "branch yet)",
    )


CEILING_CLEAR, CEILING_FROM = read_ceiling_clear()

TALLEST_CHILD = ts_const("src/art/models/kid.ts", "TALLEST_CHILD_HEIGHT")
# A child with ordinary hair and no hat — the figure to judge everyday scale
# against, where `TALLEST_CHILD` is the worst case the ceiling checks use.
# Read, not typed, for the reason the whole file exists: this one was typed as
# **1.86** in two places, and it was wrong by a quarter of a child.
CHILD_HEIGHT = ts_const("src/art/models/kid.ts", "KID_HEIGHT")


def deg(x: float) -> float:
    return math.radians(x)


def rot(x=0.0, y=0.0, z=0.0) -> Matrix:
    """A rotation matrix from degrees, in XYZ order."""
    return Euler((deg(x), deg(y), deg(z)), "XYZ").to_matrix().to_4x4()


def place(x=0.0, y=0.0, z=0.0, rx=0.0, ry=0.0, rz=0.0) -> Matrix:
    return Matrix.Translation((x, y, z)) @ rot(rx, ry, rz)


# =============================================================================
# THE CONTRACT
# =============================================================================
#
# `HANDOFF-castle-interior-363.md` §4.3, asset by asset, as a machine-readable
# table. `check_contract()` asserts the emitted geometry against it, so the
# reply to "did the Artist build it to the requested size" is a build result
# rather than a claim in a document.
#
# `width` and `depth` are **maxima** — an asset may come in under its allowance
# and several deliberately do. `height` is exact to `HEIGHT_TOLERANCE`, because
# the Engineer stacks things on it (a goblet on a table, an armour on a plinth)
# and a table that is 3 cm short leaves fourteen goblets floating.

HEIGHT_TOLERANCE = 0.02

# The height of the throne's dais. **The Engineer builds it; this file cannot
# measure it**, so unlike every other number in the contract it is a figure
# typed from their §4.3 rather than read off a mesh — the one such number here,
# and called out as one so it is not mistaken for a measurement.
#
# It is typed because there is no better option *yet*, not because typing it is
# fine. The moment `castleAssets.ts` exists this should be `ts_const`'d like the
# headroom is, and the ask is in §2.5 of the handoff. Until then the mitigation
# is that it appears exactly once, is printed on every run beside the throne's
# measured height and the resulting total, and is the reason the ceiling
# assertion can see the throne at all.
DAIS_HEIGHT = 0.30


class Requested:
    """One row of the Engineer's §4.3 table.

    ``exact`` is the interesting field. A height the Engineer **stacks things
    on** — a table top, a bench seat, a plinth, an armour that stands on that
    plinth — has to be the requested number to the centimetre, because
    fourteen goblets sit on it and a 3 cm drift floats every one of them. A
    height that is only an **allowance** — the feast props are "each ≤ 0.45 m",
    and a goblet, a roast and a pie are obviously not all the same height — is
    a maximum, and asserting it as exact would be a check that forced four
    different objects to be one size for no reason anybody wanted.

    ``stands_on`` and ``dais`` are the ceiling check's half of it, and they
    exist because of a bug this table had for a week. Almost nothing in this
    room stands on the floor it is checked against: the armour stands on a
    plinth, the feast stands on the table, and the throne stands on a dais the
    Engineer builds. The ceiling assertion used to compare the **bare mesh**
    against the headroom, so a 2.80 m throne on a 0.30 m dais passed a 3.08 m
    check while standing 3.10 m into a 3.08 m beam. The check read correctly,
    carried real numbers in its message, and was describing something other
    than the thing that has to clear.

    So the mount height is now part of the request rather than prose in a
    docstring, and it comes from whichever of two places can be *measured*:

    * ``stands_on`` names another asset **in this file**, and its measured top
      is the mount height. Nothing is typed — if the table is retuned to
      1.02 m, the goblets standing on it are re-checked at 1.02 m on the next
      build, with no second number to update.
    * ``dais`` is a height the **Engineer** builds and this file does not, so
      there is no mesh here to measure and it has to be a number. It is the
      only such number in the table, and it is one the two handoffs both
      state.
    """

    def __init__(self, width, height, depth, note="", exact=True,
                 stands_on=None, dais=0.0):
        self.width = width
        self.height = height
        self.depth = depth
        self.note = note
        self.exact = exact
        self.stands_on = stands_on
        self.dais = dais


CONTRACT = {
    # A1 — the star of the room. 2.60 m beside a 1.86 m child, on purpose.
    "armour": Requested(1.10, 2.60, 0.80, "8 across decks 0–3, back to a wall",
                        stands_on="plinth"),
    # A2 — a plain chamfered stone block, separate so it can be left off where
    # a step would trip somebody.
    "plinth": Requested(1.30, 0.25, 1.00, "one per armour"),
    # A3 — rail at 2.90 m, hem at 0.50 m, so the drop is exactly 2.40 m.
    # **0.26 m deep, not the contract's original 0.12 m — a renegotiation, and
    # the Engineer has approved it** (their §4.5, reconciliation entry 1:
    # "Approved. Change it."). At 0.12 the cloth cannot be modelled as cloth:
    # the thickness alone is 0.04 of it, leaving ±0.04 of wave across a 3.2 m
    # sheet, which the first review render showed as a completely flat maroon
    # rectangle. The Engineer's own §5 rule is that wall furniture projects **at
    # most 0.45 m** (less than the wall's own thickness), so 0.26 is comfortably
    # inside the rule the 0.12 was presumably a guess at.
    #
    # **0.26 and not 0.28.** The allowance enforced here and the number asked
    # for in the handoff were briefly 0.28 and 0.26 — two documents disagreeing
    # by 2 cm, which is exactly the failure the reconciliation section exists to
    # prevent, committed inside the section that prevents it. The Engineer
    # signed off "0.26", so 0.26 is what the build holds this to; there is now
    # no slack that only one of the two documents knows about.
    "tapestry": Requested(3.20, 2.40, 0.26, "hangs from the rail; 6 of them"),
    # A4 — wider than the cloth it carries.
    "tapestryrail": Requested(3.60, 0.14, 0.14, "centred on its own axis"),
    # A5 — no flame: the Engineer builds fire.
    "sconce": Requested(0.34, 0.46, 0.42, "~40, instanced, back plate on the wall"),
    # A6 — the one asset the wall-plate actually caught, and the reason
    # `stands_on`/`dais` exist at all.
    #
    # The Engineer asked for 2.80 against a 3.00 allowance, to keep headroom
    # over the 0.30 m dais they build under it, and 2.80 + 0.30 = 3.10 sat
    # 0.20 m under the 3.30 m ceiling they were writing against. Then they
    # built the perimeter wall-plate and the headroom near a wall became
    # 3.08 — so the throne at the end of the hall stood **2 cm through a
    # beam**, and the assertion that should have said so was comparing the
    # bare 2.80 m mesh against it and passing.
    #
    # **2.75, not 2.80.** 2.75 + 0.30 = 3.05, which clears the wall-plate by
    # 0.03 m. Five centimetres off a 2.75 m throne is invisible — the
    # silhouette is the step from shoulder to spire, not the last 2% of its
    # height — and the alternative costs the Engineer a rebuild of the dais.
    # If they would rather keep 2.80 m of throne and shave the dais to 0.25,
    # that is a one-line change here and the build will confirm it either way,
    # which is the point: 0.03 m is thin, and it is now *asserted* thin
    # instead of assumed. The day the dais grows a step, this fails.
    "throne": Requested(1.60, 2.75, 1.20, "1, deck 0, on a 0.30 m dais",
                        dais=DAIS_HEIGHT),
    "table": Requested(2.20, 1.05, 6.00, "long axis along the game's +Z"),
    "bench": Requested(0.60, 0.55, 2.80, "4, both sides of the table"),
    "feast": Requested(0.45, 0.45, 0.45, "goblet, roast, loaf, pie — bucket-sized",
                       exact=False, stands_on="table"),
    "chest": Requested(1.20, 0.90, 0.80, "lid on its own hinge node"),
}

# Which frame each asset's origin is in — see :func:`check_origins`. Every
# collection a builder makes must appear here, and `main()` checks the two
# lists match, so an asset cannot be added without saying how it is placed.
ORIGIN_FAMILY = {
    "armour": "FLOOR",
    "plinth": "FLOOR",
    "throne": "FLOOR",
    "table": "FLOOR",
    "bench": "FLOOR",
    "feast": "FLOOR",
    "chest": "FLOOR",
    "tapestry": "WALL",
    "sconce": "WALL",
    "tapestryrail": "AXIS",
}


# =============================================================================
# Shared shapes
# =============================================================================


def seat_against_wall(*parts: Part) -> None:
    """Slide a whole wall-mounted asset back until it just touches the stone.

    Every WALL asset is authored in whatever frame is natural for its own shape
    — a tapestry billows either side of its cloth plane, a sconce's back plate
    is a box centred on its own middle — and this then puts the wall where it
    belongs: **y = 0, with every vertex at or in front of it** (−Y, the game's
    +Z, into the room).

    Done here, once, from the measured geometry, rather than by each builder
    subtracting a half-thickness it has to keep in step with its own shape.
    That subtraction is the second formula CLAUDE.md warns about: right the day
    it is written, and 3 cm wrong the day the billow changes — and 3 cm wrong
    means a tapestry half inside a wall.

    All the parts of one asset shift **together**, so their alignment with each
    other is untouched.
    """
    highest = max(v[1] for part in parts for v in part.verts)
    for part in parts:
        part.verts = [(v[0], v[1] - highest, v[2]) for v in part.verts]


def hanging_cloth(width, height, thickness, cols=8, rows=6, billow=0.05, sag=0.0):
    """A hanging sheet with a gentle billow, spanning z = −height..0.

    Flat cloth reads as cardboard from the game's camera: the toon ramp has
    nothing to band, the whole hanging comes out one value, and the eye files it
    as a poster. Three shallow waves across the width give the ramp two shading
    changes per metre and it reads as *cloth* immediately, for ~200 triangles.

    The billow grows toward the hem, because a hanging is pinned along its top
    edge and free at the bottom; a sheet that waves as much where it is nailed
    as where it swings looks like corrugated iron.

    ``sag`` dips the **top** edge between its fixings — the Engineer asked for
    "sag across the top" specifically, and it is what stops a tapestry reading
    as a rectangle of wallpaper.
    """
    half_t = thickness * 0.5
    verts = []
    index_f = []
    index_b = []
    for r in range(rows + 1):
        v = r / rows  # 0 at the hem, 1 at the rail
        droop = sag * math.sin(0.0)  # placeholder, replaced per column below
        row_f, row_b = [], []
        for c in range(cols + 1):
            u = c / cols
            x = (u - 0.5) * width
            # Sag is a shallow catenary across the top, fading out by the hem.
            droop = -sag * math.sin(u * math.pi) * (v ** 2)
            z = -height + v * height + droop
            wave = math.sin(u * TAU * 1.5) * billow * (1.0 - v) ** 1.5
            row_f.append(len(verts))
            verts.append((x, wave - half_t, z))
        for c in range(cols + 1):
            u = c / cols
            x = (u - 0.5) * width
            droop = -sag * math.sin(u * math.pi) * (v ** 2)
            z = -height + v * height + droop
            wave = math.sin(u * TAU * 1.5) * billow * (1.0 - v) ** 1.5
            row_b.append(len(verts))
            verts.append((x, wave + half_t, z))
        index_f.append(row_f)
        index_b.append(row_b)

    faces = []
    for r in range(rows):
        for c in range(cols):
            faces.append((index_f[r][c], index_f[r][c + 1], index_f[r + 1][c + 1], index_f[r + 1][c]))
            faces.append((index_b[r][c], index_b[r + 1][c], index_b[r + 1][c + 1], index_b[r][c + 1]))
        faces.append((index_f[r][0], index_f[r + 1][0], index_b[r + 1][0], index_b[r][0]))
        faces.append((index_f[r][cols], index_b[r][cols], index_b[r + 1][cols], index_f[r + 1][cols]))
    for c in range(cols):
        faces.append((index_f[0][c], index_b[0][c], index_b[0][c + 1], index_f[0][c + 1]))
        faces.append((index_f[rows][c], index_f[rows][c + 1], index_b[rows][c + 1], index_b[rows][c]))
    return verts, faces


# =============================================================================
# A1 — Suit of armour
# =============================================================================
#
# Segment by segment from the floor up. **These are the owner of the armour's
# height**: `ARMOUR_HEIGHT` is their sum, never a number typed twice, and
# `check_contract()` asserts the geometry that comes out actually measures it.
# Change a segment and the total follows; add a crest that pokes out of the top
# and the build fails rather than the handoff going quietly stale.

ARMOUR_SABATON = 0.14
ARMOUR_GREAVE = 0.48
ARMOUR_THIGH = 0.36
ARMOUR_FAULD = 0.24
ARMOUR_CUIRASS = 0.60
ARMOUR_GORGET = 0.08
ARMOUR_HELM = 0.46
ARMOUR_PLUME = 0.24
ARMOUR_HEIGHT = (
    ARMOUR_SABATON + ARMOUR_GREAVE + ARMOUR_THIGH + ARMOUR_FAULD
    + ARMOUR_CUIRASS + ARMOUR_GORGET + ARMOUR_HELM + ARMOUR_PLUME
)

# Half-width at the pauldrons, which is what sets the whole asset's width. The
# Engineer's keep-out is a **0.65 m radius** disc, so the half-diagonal of the
# footprint has to fit inside it — see the assertion in `check_contract`.
ARMOUR_SHOULDER_X = 0.38
ARMOUR_PAULDRON_RX = 0.14


def build_armour() -> None:
    """An empty suit standing to attention with a sword grounded in front of it.

    **Deliberately taller than a child**, per Jim's rule: a suit of armour
    scaled honestly against a six-year-old is a dumpy 1.2 m thing that reads as
    a bin from across a hall. At 2.60 m, lit from a sconce, it reads as a knight
    standing guard from the far end of the room — which is the entire point of
    putting one there.

    Chunky-primitive throughout (ART_DIRECTION §7's preferred route): every
    plate is a rounded box or a squashed sphere, and the proportions are this
    park's cartoon ones — a big head, round pauldrons, stumpy legs — so it
    belongs to this game rather than visiting from a realistic one.

    The sword rather than a polearm is the Engineer's call and the right one:
    a halberd held out to the side was 2.0 m wide and could never have met the
    0.65 m keep-out radius, and it made eight of them along a wall look like a
    fence. Point down, both gauntlets on the pommel, entirely inside the
    silhouette.

    Faces −Y, i.e. the game's +Z: the visor looks at the player.
    """
    coll = collection("armour")
    plate = Part("armour-plate")
    trim = Part("armour-trim")
    dark = Part("armour-visor")
    plume = Part("armour-plume")

    z = 0.0

    # --- legs -------------------------------------------------------------
    for side in (-1.0, 1.0):
        x = side * 0.19
        # Sabaton: a foot pointing forward (−Y), so the suit reads as standing.
        plate.at(*rounded_box(0.24, 0.40, ARMOUR_SABATON, 0.05, 1), x=x, y=-0.07,
                 z=ARMOUR_SABATON * 0.5)
        plate.at(*rounded_box(0.24, 0.24, ARMOUR_GREAVE, 0.07, 1), x=x,
                 z=ARMOUR_SABATON + ARMOUR_GREAVE * 0.5)
        # Poleyn — the knee cop, so the leg has a joint in silhouette.
        trim.at(*ellipsoid(0.15, 0.10, 0.10, 1), x=x, y=-0.07,
                z=ARMOUR_SABATON + ARMOUR_GREAVE)
        plate.at(*rounded_box(0.27, 0.27, ARMOUR_THIGH, 0.08, 1), x=x,
                 z=ARMOUR_SABATON + ARMOUR_GREAVE + ARMOUR_THIGH * 0.5)
    z += ARMOUR_SABATON + ARMOUR_GREAVE + ARMOUR_THIGH

    # --- fauld and cuirass -------------------------------------------------
    trim.at(*revolve([(0.0, 0.0), (0.30, 0.0), (0.35, ARMOUR_FAULD), (0.0, ARMOUR_FAULD)],
                     segments=10), z=z)
    z += ARMOUR_FAULD

    cuirass = ARMOUR_CUIRASS
    # A barrel chest: widest two-thirds up, tapering into the fauld.
    plate.at(*revolve([
        (0.0, 0.0), (0.28, 0.0), (0.34, cuirass * 0.35), (0.35, cuirass * 0.68),
        (0.29, cuirass), (0.0, cuirass),
    ], segments=12), z=z)
    # One raised keel down the breastplate, so the toon ramp splits the chest
    # into a lit half and a shaded half instead of banding it as one cylinder.
    plate.at(*rounded_box(0.10, 0.22, cuirass * 0.84, 0.04, 1), y=-0.28, z=z + cuirass * 0.47)
    trim.at(*rounded_box(0.20, 0.08, 0.14, 0.03, 1), y=-0.32, z=z + cuirass * 0.28)
    z += cuirass

    # --- arms --------------------------------------------------------------
    shoulder_z = z - 0.08
    for side in (-1.0, 1.0):
        x = side * ARMOUR_SHOULDER_X
        # The pauldron is the single most recognisable piece of a suit of
        # armour in silhouette, so it is generous even inside a tight width.
        plate.at(*ellipsoid(ARMOUR_PAULDRON_RX, 0.19, 0.17, 1), x=x, z=shoulder_z)
        plate.at(*rounded_box(0.17, 0.17, 0.34, 0.06, 1), x=x, z=shoulder_z - 0.26)
        trim.at(*ellipsoid(0.11, 0.09, 0.08, 1), x=x, y=-0.03, z=shoulder_z - 0.43)
        # The forearms angle in **and forward** onto the sword's grip. The
        # first render had them hanging at the sides and the blade buried in
        # the skirt behind them, which read as a suit of armour standing next
        # to a sword rather than holding one — the pose is most of what makes
        # this asset say "on guard".
        plate.at(*rounded_box(0.15, 0.15, 0.30, 0.05, 1), x=x * 0.62, y=-0.24,
                 z=shoulder_z - 0.55)
        # Gauntlet, a mitten. Fingers at this size are four triangles of mush.
        plate.at(*ellipsoid(0.10, 0.10, 0.10, 1), x=x * 0.40, y=-0.34,
                 z=shoulder_z - 0.70)

    # --- gorget and helm ---------------------------------------------------
    trim.at(*revolve([(0.0, 0.0), (0.24, 0.0), (0.22, ARMOUR_GORGET), (0.0, ARMOUR_GORGET)],
                     segments=10), z=z)
    z += ARMOUR_GORGET

    helm = ARMOUR_HELM
    plate.at(*rounded_box(0.42, 0.40, helm, 0.11, 1), z=z + helm * 0.5)
    plate.at(*ellipsoid(0.21, 0.20, 0.13, 1), z=z + helm)
    # Visor slit and breaths — standing 1 cm proud of the helm's own face so
    # they cannot z-fight with it (ART_DIRECTION §5's marking rule: a marking
    # whose front sits inside the surface shows only where it pokes through).
    dark.at(*box(0.30, 0.06, 0.06), y=-0.205, z=z + helm * 0.62)
    for i in range(3):
        dark.at(*box(0.04, 0.06, 0.09), x=-0.08 + i * 0.08, y=-0.195, z=z + helm * 0.30)
    trim.at(*box(0.40, 0.38, 0.04), z=z + helm * 0.76)
    z += helm

    # Crest: a fan of plume, the one soft thing on a suit of iron and the bit
    # that tips it from "armour" to "knight". The middle feather sets the
    # suit's total height, so the fan is placed from the **top down**.
    crest_top = z + ARMOUR_PLUME
    for i in range(5):
        t = (i - 2) / 2.0
        radius_z = ARMOUR_PLUME - abs(t) * 0.05
        plume.at(*ellipsoid(0.045, 0.13 - abs(t) * 0.04, radius_z, 1),
                 y=t * 0.13, z=crest_top - radius_z - abs(t) * 0.03)

    # --- the grounded sword -------------------------------------------------
    # Point on the floor, crossguard just under the gauntlets, pommel between
    # them. Grounded rather than raised: eight raised swords along a wall read
    # as a fence, and a point at floor level is what says "at rest, on guard".
    guard_z = shoulder_z - 0.86
    blade = [
        (0.0, 0.0),                  # the point, on the floor
        (0.055, 0.14),
        (0.055, guard_z),
        (-0.055, guard_z),
        (-0.055, 0.14),
    ]
    # y = −0.38 is the whole of the depth budget spent deliberately: it puts
    # the blade's back face 1.2 cm clear of the fauld's 0.35 m radius, and the
    # gauntlets that grip it are what the remaining 6 cm of the Engineer's
    # 0.80 m allowance goes on. At −0.22 the blade ran *through* the skirt,
    # which the front elevation showed immediately and no amount of reading
    # the code would have.
    sword_y = -0.38
    plate.at(*extrude_outline(blade, 0.035, centre=(0.0, guard_z * 0.5)), y=sword_y)
    trim.at(*box(0.40, 0.07, 0.055), y=sword_y, z=guard_z + 0.03)
    trim.at(*tube(0.042, 0.13, sides=6), y=sword_y, z=guard_z + 0.055)
    trim.at(*icosphere(0.058, 1), y=sword_y, z=guard_z + 0.20)

    for part in (plate, trim, dark, plume):
        part.emit(coll)


# =============================================================================
# A2 — the plinth an armour stands on
# =============================================================================


def build_plinth() -> None:
    """A plain chamfered stone block, 1.30 × 1.00 × 0.25.

    Its own collection rather than part of the armour, because the Engineer
    asked to be able to leave it off: a 25 cm step in a route a child runs
    along is a trip, and eight of them is eight trips. The armour's own origin
    is its feet, so an armour on a plinth is
    ``armour.root.position.y = floorY + plinth.height`` and nothing else.

    Flat-topped deliberately (:func:`flat_top_box`): a bevel that rounds the top
    away is what makes something the game says is standing on it look as if it
    is sliding off.
    """
    coll = collection("plinth")
    stone = Part("plinth-block")
    stone.at(*flat_top_box(1.30, 1.00, 0.25, 0.04, 1), z=0.125)
    stone.emit(coll)


# =============================================================================
# A3 / A4 — tapestry and its rail
# =============================================================================

TAPESTRY_WIDTH = 3.20
TAPESTRY_DROP = 2.40
TAPESTRY_FRINGE = 0.22
RAIL_LENGTH = 3.60
RAIL_RADIUS = 0.07


def build_tapestry() -> None:
    """3.20 m of picture, dropping 2.40 m from its rail. Origin at the hang point.

    The picture is a canvas texture the Engineer paints into this cloth's
    **own UV map** — not a second sheet floating in front of it. That is
    CLAUDE.md's rule after the hood faces went invisible, and it is worth
    restating for a tapestry specifically: a hanging is exactly the shape that
    tempts you to bolt a flat decal onto a curved surface, and the decal is
    exactly what falls out of step when the billow changes. One surface, one
    texture, and :func:`planar_uvs` maps the whole silhouette into 0..1 so the
    picture wraps round the hanging's own edge the way a real one does.

    Origin at the rail, not the hem, because a tapestry is hung from a bracket
    at a stated height (2.90 m, the Engineer's) and its length is then whatever
    it is. Origin at the hem would make the placer subtract a length it should
    not have to know.

    The fringe is inside the 2.40 m drop, not added below it, so "rail at 2.90,
    hem at 0.50" is true of the thing a child actually sees.
    """
    coll = collection("tapestry")

    cloth = Part("tapestry-cloth")
    verts, faces = hanging_cloth(
        # 0.05 thick with a 0.09 billow. A hanging spends its depth allowance
        # twice — once on the cloth's own thickness, once on the wave either
        # side of it — and the first pass, tuned to a 0.12 m allowance, came
        # out of the render a dead flat rectangle. Nine centimetres is what it
        # takes for the toon ramp to actually band a 3.2 m sheet from the
        # game's camera; below that the waves exist in the mesh and not in the
        # picture, which is the only place they were ever for.
        TAPESTRY_WIDTH, TAPESTRY_DROP - TAPESTRY_FRINGE, 0.05,
        cols=10, rows=6, billow=0.09, sag=0.10,
    )
    # The UV frame is the *requested* rectangle, not the billowed geometry's
    # own bounds — so the picture the Engineer paints lands in the same place
    # on every tapestry however the cloth is retuned.
    lo = (-TAPESTRY_WIDTH * 0.5, 0.0, -TAPESTRY_DROP)
    hi = (TAPESTRY_WIDTH * 0.5, 0.0, 0.0)
    cloth.add(verts, faces, uvs=planar_uvs(verts, faces, lo, hi))

    fringe = Part("tapestry-fringe")
    # A **valance** along the top and **beaded tassels** along the hem. The
    # first version was 13 thin spikes, which rendered as a row of teeth: a
    # fringe is short, fat and ends in a bead, and it is the bead that reads
    # from ten metres. The valance is the cheaper half of the same job — one
    # band across the top turns a rectangle of cloth into a *hanging*.
    fringe.at(*rounded_box(TAPESTRY_WIDTH * 0.99, 0.10, 0.16, 0.03, 1), z=-0.10)
    tassels = 11
    for i in range(tassels):
        u = (i + 0.5) / tassels
        x = (u - 0.5) * TAPESTRY_WIDTH * 0.94
        # The tassels follow the hem's own wave, which is what makes the fringe
        # read as attached to the cloth rather than as a separate comb.
        wave = math.sin(u * TAU * 1.5) * 0.09
        hem = -(TAPESTRY_DROP - TAPESTRY_FRINGE) + 0.02
        # The bead's underside is the lowest point of the whole asset, so it
        # is what has to land on the contracted 2.40 m drop — the cord above
        # it is sized from that, not the other way round.
        fringe.at(*tube(0.030, -TAPESTRY_FRINGE * 0.80, sides=5), x=x, y=wave, z=hem)
        fringe.at(*ellipsoid(0.048, 0.048, 0.058, 1), x=x, y=wave,
                  z=hem - TAPESTRY_FRINGE * 0.82)

    seat_against_wall(cloth, fringe)
    cloth.emit(coll)
    fringe.emit(coll)


def build_tapestry_rail() -> None:
    """A turned pole with finials, 3.60 m long. **Origin on the pole's axis.**

    Centred on its own origin in all three axes, because a pole is placed by
    its axis and by nothing else — the Engineer sets one y (2.90 m) for the
    rail and the same y for the tapestry's hang point, and the two numbers
    being the same number is the whole point of splitting them into two nodes.
    """
    coll = collection("tapestryrail")
    pole = Part("tapestryrail-pole")
    # The **finials** are what reach 3.60 m, not the pole: an asset that
    # measures its allowance plus a ball on each end is an asset that does not
    # fit, and the check below would catch it — but only after somebody had
    # already drawn it. The pole is short by one finial each end by construction.
    half = RAIL_LENGTH * 0.5 - RAIL_RADIUS
    pole.add(*tube(RAIL_RADIUS, half * 2.0, sides=8), matrix=place(x=-half, ry=90.0))
    for side in (-1.0, 1.0):
        # A turned collar and a ball finial at each end: three changes of
        # diameter is what makes a cylinder read as a *turned* pole rather than
        # as a pipe, and it is the cheapest detail in this file.
        pole.add(*tube(0.045, 0.06, sides=8), matrix=place(x=side * (half - 0.20), ry=90.0 * side))
        pole.at(*ellipsoid(0.05, 0.07, 0.07, 1), x=side * (half - 0.10))
        pole.at(*icosphere(0.07, 1), x=side * half)
    pole.emit(coll)


# =============================================================================
# A5 — the wall-torch sconce (no flame; the Engineer builds fire)
# =============================================================================

# **Built to the full 0.34 m width allowance, and the trade that pays for it.**
#
# The first cut came in at 0.23 m against 0.34 — 32% under, the only asset here
# meaningfully under in the dimension that governs whether a thing reads. Close
# up (`sconce.png`) it was a nicely made little bracket. In the assembled hall,
# at the game's iso camera, all forty of them were dark smudges on a pink wall
# that you had to already know were there. That is the most-repeated object in
# this room failing at the only distance anybody sees it from, and ART_DIRECTION
# §4 is explicit that shapes are judged at gameplay distance, not close up.
#
# Jim's standing rule is the licence here: *"it doesn't matter if things are a
# realistic size, only that they are easily recognisable as what they are."* A
# torch bracket with a 34 cm fire bowl is not a plausible piece of ironwork. It
# is a thing a six-year-old identifies instantly from across the hall, which is
# the whole job.
#
# The width comes out of the cup, because the cup is what says "fire goes here"
# — so the cup grows to the allowance and **the reach comes in to pay for the
# depth**: 0.42 m of depth allowance has to cover the reach plus the cup's own
# outer radius, and a bowl that wide cannot also hang 0.28 m off the wall. The
# reach drops 0.28 → 0.225, which **moves `SCONCE_CUP_OFFSET`'s Z from 0.3025 to
# ~0.2475**. That is a published number the Engineer has provisionally typed
# into `castleFabric.ts`, so it is flagged in §2.2 and §2.6 of the handoff. The
# cup's *mouth height* is deliberately unchanged at 0.2850 — the rim profile and
# the cup's mounting height are untouched — so only the one component moves.
SCONCE_REACH = 0.225
SCONCE_CUP_RADIUS = 0.147
SCONCE_CUP_RIM_Z = 0.21
# The back plate, widened with the cup. A 34 cm bowl on a 13 cm plate reads as a
# bowl balanced on a nail; the plate is the part that says the thing is *bolted
# to the wall*, and at this distance it is a silhouette, not a detail.
SCONCE_PLATE_WIDTH = 0.20
SCONCE_PLATE_HEIGHT = 0.34
# No thin parts (ART_DIRECTION §4). The arm and strut were 28 and 20 mm, which
# is a wire at 20 m; they carry a bowl twice the size now and should look it.
SCONCE_ARM_RADIUS = 0.034
SCONCE_STRUT_RADIUS = 0.026


def build_sconce() -> None:
    """An iron bracket and a cup, mounted on a wall. **No flame.**

    Origin at the **wall face**: the back plate is at y = 0 (the game's z = 0)
    and the cup sticks out toward −Y (the game's +Z). So the Engineer parents it
    to a point on a wall and yaws the root into the room — no offset, no
    half-thickness to remember, nothing that drifts when the bracket changes.
    Same reasoning as the jetpack's back mount.

    **The flame is not here on purpose.** Fire in this room is a lighting-budget
    decision (#251 has the shadow pass at 57% of draw calls), and the Engineer
    builds all forty flames as one emissive `InstancedMesh` with the glow and
    the flicker. A flame baked into this asset would be forty separate meshes
    they could not batch, and a second definition of where fire sits.

    What they need instead is a **number**: where the cup's mouth is, so a flame
    lands in it. That is `SCONCE_CUP_OFFSET`, printed by :func:`sconce_offset`
    from the emitted vertices and re-derived by them with `visibleBounds()`.
    Neither of us eyeballs it.
    """
    coll = collection("sconce")
    iron = Part("sconce-bracket")
    cup = Part("sconce-cup")

    # Back plate against the stone, with two bolt heads.
    iron.at(*rounded_box(SCONCE_PLATE_WIDTH, 0.045, SCONCE_PLATE_HEIGHT, 0.025, 1),
            y=0.0, z=0.0)
    for z in (-0.12, 0.12):
        iron.at(*icosphere(0.032, 1), y=-0.022, z=z)
    # The arm, sloping up and out, and a scroll strut under it.
    iron.add(*sweep_path(
        [(0.0, -0.01, -0.07), (0.0, -SCONCE_REACH * 0.55, -0.02), (0.0, -SCONCE_REACH, 0.15)],
        SCONCE_ARM_RADIUS, sides=4, up=(1.0, 0.0, 0.0), closed=False,
    ))
    iron.add(*sweep_path(
        [(0.0, -0.01, -0.15), (0.0, -SCONCE_REACH * 0.40, -0.12), (0.0, -SCONCE_REACH * 0.62, -0.03)],
        SCONCE_STRUT_RADIUS, sides=4, up=(1.0, 0.0, 0.0), closed=False,
    ))

    # The bowl. Its profile is written in **multiples of the radius**, not in
    # centimetres, so widening the cup widens its stem and its foot with it —
    # the first draft had the stem typed as 0.070 and 0.055, and scaling the
    # radius alone would have left a 34 cm bowl on a 7 cm stalk.
    r = SCONCE_CUP_RADIUS
    cup.at(*revolve([
        (0.0, 0.0), (r * 0.70, 0.0), (r, SCONCE_CUP_RIM_Z - 0.10),
        (r * 1.15, SCONCE_CUP_RIM_Z - 0.06),
        (r * 0.98, SCONCE_CUP_RIM_Z - 0.055),
        (r * 0.55, 0.02), (0.0, 0.02),
    ], segments=10), y=-SCONCE_REACH, z=0.13)

    seat_against_wall(iron, cup)
    iron.emit(coll)
    cup.emit(coll)


def sconce_offset():
    """Where the cup's mouth is, **in the game's frame**, measured off the mesh.

    Returned as ``(x, y, z)`` metres from the sconce's origin — which is the
    point on the wall the Engineer mounts it at. Blender (x, y, z) maps to glTF
    (x, z, −y), so this converts as it measures; getting that conversion wrong
    in a handoff table is exactly the sort of quiet 40-centimetre error the
    §4.4 protocol exists to prevent.

    The Engineer re-derives the same figure from the built mesh with
    `visibleBounds()` on the ``sconce-cup`` node and asserts the two agree, so
    if this ever stops being true the build fails rather than forty flames
    hanging in mid-air.
    """
    cup = bpy.data.objects["sconce-cup"]
    lo = Vector((1e9, 1e9, 1e9))
    hi = Vector((-1e9, -1e9, -1e9))
    for v in cup.data.vertices:
        lo = Vector((min(lo[i], v.co[i]) for i in range(3)))
        hi = Vector((max(hi[i], v.co[i]) for i in range(3)))
    centre = (lo + hi) * 0.5
    # Blender (x, y, z) → glTF (x, z, −y). The flame's foot sits at the cup's
    # rim, so the height taken is the top rather than the middle.
    return (centre.x, hi.z, -centre.y)


# =============================================================================
# A6 — the throne
# =============================================================================

# 2.75, not 2.80 — see the `throne` row of `CONTRACT`. 2.75 + the Engineer's
# 0.30 m dais = 3.05 m, which clears the 3.08 m wall-plate. At 2.80 it was
# 3.10 m and stood 2 cm through the beam.
THRONE_HEIGHT = 2.75
THRONE_SEAT = 0.88
THRONE_WIDTH = 1.60
THRONE_DEPTH = 1.20


def build_throne() -> None:
    """The seat at the end of the hall: 2.80 m to the finial, seat at 0.88 m.

    Built to be looked *at* as much as sat on — the tall back drawn to a point
    is the entire silhouette, and a throne with an ordinary chair back is a
    chair.

    **2.80 m and not 3.00 m**, which is the Engineer's explicit ask and worth
    recording why: they build a 0.30 m dais under it, the clear headroom is
    3.30 m, and 3.00 + 0.30 would land exactly on the ceiling with nothing left
    for a finial, a cushion that settles, or the dais growing a step. It comes
    in at 3.10 m total, 0.20 m clear.

    No plinth of its own: the dais is theirs, so this stands on its own feet at
    z = 0 like every other floor asset.
    """
    coll = collection("throne")
    wood = Part("throne-frame")
    gold = Part("throne-gold")
    cushion = Part("throne-cushion")

    half_w = THRONE_WIDTH * 0.5
    half_d = THRONE_DEPTH * 0.5
    seat_t = 0.14

    wood.at(*flat_top_box(THRONE_WIDTH, THRONE_DEPTH * 0.86, seat_t, 0.04, 1),
            z=THRONE_SEAT - seat_t * 0.5)
    for sx in (-1.0, 1.0):
        for sy in (-1.0, 1.0):
            wood.at(*rounded_box(0.16, 0.16, THRONE_SEAT - seat_t, 0.03, 1),
                    x=sx * (half_w - 0.12), y=sy * (half_d - 0.20),
                    z=(THRONE_SEAT - seat_t) * 0.5)

    for sx in (-1.0, 1.0):
        wood.at(*rounded_box(0.16, THRONE_DEPTH * 0.80, 0.15, 0.05, 1),
                x=sx * (half_w - 0.08), z=THRONE_SEAT + 0.40)
        wood.at(*rounded_box(0.14, 0.14, 0.38, 0.04, 1),
                x=sx * (half_w - 0.08), y=-half_d + 0.22, z=THRONE_SEAT + 0.19)

    # The back, and it is the whole asset.
    #
    # **The first version read as an armchair** — a broad panel from the seat
    # to shoulder height with a shallow arch on top, which is a comfortable
    # chair and not a throne, and no amount of gold on it changed that. What
    # makes a throne is the step: broad where somebody's shoulders go, then
    # *narrowing* into a tall spire drawn to a point well above their head.
    # Two silhouettes, one of them at twice the height of the other, and a
    # six-year-old names the second one instantly.
    back_top = THRONE_HEIGHT - 0.24
    shoulder = THRONE_SEAT + 0.50
    spire_w = half_w * 0.62
    outline = [
        (-half_w, THRONE_SEAT),
        (half_w, THRONE_SEAT),
        (half_w, shoulder),
        (spire_w, shoulder + 0.22),
        (spire_w, back_top - 0.55),
        (spire_w * 0.42, back_top - 0.16),
        (0.0, back_top),
        (-spire_w * 0.42, back_top - 0.16),
        (-spire_w, back_top - 0.55),
        (-spire_w, shoulder + 0.22),
        (-half_w, shoulder),
    ]
    wood.add(*extrude_outline(outline, 0.14, centre=(0.0, shoulder + 0.30)),
             matrix=place(y=half_d - 0.14))

    cushion.at(*rounded_box(THRONE_WIDTH - 0.24, THRONE_DEPTH * 0.70, 0.18, 0.07, 1),
               z=THRONE_SEAT + 0.09)
    # The back cushion stops at the shoulder step, and that is the whole
    # point. At 1.10 m tall it covered the panel from the seat to 2.21 m and
    # hid the spire behind it — so the review render showed an armchair with a
    # small hat, which is exactly the shape the redesign was meant to fix. A
    # throne's spire has to be *bare wood above the sitter's head*.
    cushion.at(*rounded_box(THRONE_WIDTH - 0.40, 0.12, 0.62, 0.06, 1),
               y=half_d - 0.26, z=THRONE_SEAT + 0.36)

    gold.at(*icosphere(0.12, 1), z=THRONE_HEIGHT - 0.12)
    gold.at(*cone(0.075, 0.18, sides=6), z=THRONE_HEIGHT - 0.18)
    for sx in (-1.0, 1.0):
        # Inboard by its own radius. A finial centred on the panel's outer
        # edge is a finial *outside* the width allowance — which is where
        # three of the four size failures in this file came from, every one
        # of them a ball or a fringe added after the shape it decorates was
        # already exactly as wide as it was allowed to be.
        # Crockets on the shoulder step, where the broad back becomes the
        # spire — the one place on the silhouette the eye stops.
        gold.at(*icosphere(0.10, 1), x=sx * (half_w - 0.10), y=half_d - 0.14,
                z=shoulder + 0.06)
        gold.at(*icosphere(0.07, 1), x=sx * (half_w - 0.08), y=-half_d + 0.16,
                z=THRONE_SEAT + 0.46)
    # A little sunburst on the back panel: five rays, the one flourish that
    # says "this is the important chair" without another 400 triangles.
    # A sunburst up the spire: the one flourish that says "this is the
    # important chair" without another 400 triangles. On the spire rather
    # than behind the sitter's head, where a cushion covers it.
    for i in range(5):
        t = (i - 2) / 2.0
        gold.at(*ellipsoid(0.07, 0.03, 0.07, 1), x=t * 0.20, y=half_d - 0.22,
                z=back_top - 0.62 + abs(t) * -0.05)

    for part in (wood, gold, cushion):
        part.emit(coll)


# =============================================================================
# A7 / A8 — the banqueting table and its benches
# =============================================================================

TABLE_TOP = 1.05
TABLE_LENGTH = 6.00
TABLE_WIDTH = 2.20
TABLE_SLAB = 0.14
BENCH_SEAT = 0.55
BENCH_LENGTH = 2.80
BENCH_WIDTH = 0.60


def build_table() -> None:
    """Six metres of trestle table, top at exactly 1.05 m.

    The long axis runs along −Y, i.e. the game's +Z, so the Engineer's
    `rotation.y` alone aims it down the hall.

    **The top is flat and its height is exact.** Fourteen feast props stand on
    it at `TABLE_TOP`, and the Engineer's check asserts the measured top equals
    the number reported here — so a bevel that rounded the top away, or a 3 cm
    drift, would float every goblet in the hall rather than being noticed by
    somebody looking at a screenshot.
    """
    coll = collection("table")
    top = Part("table-top")
    legs = Part("table-legs")

    top.at(*flat_top_box(TABLE_WIDTH, TABLE_LENGTH, TABLE_SLAB, 0.04, 1),
           z=TABLE_TOP - TABLE_SLAB * 0.5)

    trestle_z = TABLE_TOP - TABLE_SLAB
    for sy in (-1.0, 1.0):
        y = sy * (TABLE_LENGTH * 0.5 - 0.85)
        # A trestle: two splayed feet, a post and a cross beam. Four straight
        # legs would have read as a picnic table.
        legs.at(*rounded_box(TABLE_WIDTH * 0.86, 0.22, 0.14, 0.04, 1), y=y, z=0.07)
        legs.at(*rounded_box(0.28, 0.22, trestle_z - 0.14, 0.05, 1), y=y,
                z=0.14 + (trestle_z - 0.14) * 0.5)
        legs.at(*rounded_box(TABLE_WIDTH * 0.70, 0.20, 0.13, 0.04, 1), y=y,
                z=trestle_z - 0.065)
    # The stretcher that ties the two trestles together — the piece that makes
    # a table read as *heavy*.
    legs.at(*rounded_box(0.20, TABLE_LENGTH - 1.30, 0.18, 0.04, 1), z=0.42)

    top.emit(coll)
    legs.emit(coll)


def build_bench() -> None:
    """A plain heavy bench, seat at exactly 0.55 m, 2.80 m long.

    Reported back to the Engineer so a child model can be posed sitting on it,
    and asserted against the measured top by their check for the same reason
    the table's is.
    """
    coll = collection("bench")
    bench = Part("bench-plank")
    slab = 0.10
    bench.at(*flat_top_box(BENCH_WIDTH, BENCH_LENGTH, slab, 0.03, 1), z=BENCH_SEAT - slab * 0.5)
    for sy in (-1.0, 1.0):
        y = sy * (BENCH_LENGTH * 0.5 - 0.42)
        bench.at(*rounded_box(BENCH_WIDTH * 0.82, 0.14, BENCH_SEAT - slab, 0.03, 1),
                 y=y, z=(BENCH_SEAT - slab) * 0.5)
    bench.emit(coll)


# =============================================================================
# A9 — the feast
# =============================================================================


def build_feast() -> None:
    """A goblet, a roast, a round loaf and a pie — each sized like a bucket.

    Jim's rule at its most literal: a life-size goblet on a six-metre table is
    four pixels from the game's camera and reads as nothing at all. At 40 cm it
    reads as a goblet from the far side of the hall, which is what it is for.

    Four nodes in one collection because they are one still life and are always
    placed together, each with its own base at z = 0 so they all stand on the
    table with `y = tableTop` and no per-prop offset.
    """
    coll = collection("feast")

    goblet = Part("feast-goblet")
    goblet.at(*revolve([
        (0.0, 0.0), (0.11, 0.0), (0.10, 0.03), (0.035, 0.07), (0.035, 0.17),
        (0.14, 0.26), (0.155, 0.42), (0.135, 0.42), (0.115, 0.27), (0.0, 0.20),
    ], segments=10))

    # The roast: a fat ellipsoid on a platter with two little bones sticking
    # out. The bones are the whole joke and cost 60 triangles.
    roast = Part("feast-roast")
    roast.at(*revolve([(0.0, 0.0), (0.22, 0.0), (0.21, 0.035), (0.0, 0.045)], segments=12))
    roast.at(*ellipsoid(0.155, 0.115, 0.11, 1), z=0.14)
    for side in (-1.0, 1.0):
        roast.add(*tube(0.022, 0.16, sides=5), matrix=place(x=side * 0.10, z=0.16, ry=side * 38.0))
        roast.at(*icosphere(0.035, 1), x=side * 0.175, z=0.235)

    loaf = Part("feast-loaf")
    loaf.at(*ellipsoid(0.17, 0.17, 0.115, 2), z=0.115)
    # Three slashes across the crust, standing proud of it (§5's marking rule).
    for i in range(3):
        loaf.at(*rounded_box(0.22 - abs(i - 1) * 0.06, 0.035, 0.035, 0.012, 1),
                y=(i - 1) * 0.065, z=0.215)

    pie = Part("feast-pie")
    pie.at(*revolve([(0.0, 0.0), (0.19, 0.0), (0.20, 0.11), (0.175, 0.13), (0.0, 0.13)],
                    segments=12))
    pie.at(*ellipsoid(0.155, 0.155, 0.045, 1), z=0.145)
    pie.at(*ellipsoid(0.05, 0.05, 0.03, 1), z=0.185)

    for part in (goblet, roast, loaf, pie):
        part.emit(coll)


# =============================================================================
# A10 — the treasure chest, with a lid that opens
# =============================================================================

CHEST_WIDTH = 1.20
CHEST_DEPTH = 0.70
CHEST_BODY = 0.52
CHEST_HEIGHT = 0.90


def build_chest() -> None:
    """A banded chest with a domed lid. **The lid's node origin is its hinge.**

    That is the one thing about this asset that is not decoration. If the lid's
    geometry were baked about the chest's own base, opening it would mean the
    Engineer computing a pivot offset — a second formula tracking this one's
    shape, which is precisely the failure mode CLAUDE.md keeps a whole section
    about. Instead the lid node *is* the hinge: `lid.rotation.x` opens it, and
    there is no offset anywhere to get wrong.

    So this is the file's only object that leaves Blender at a non-identity
    transform, and `castle_export.py` allows exactly that: a pure translation,
    no rotation, no scale, on this node and no other.
    """
    coll = collection("chest")
    body = Part("chest-body")
    bands = Part("chest-bands")
    lid = Part("chest-lid")

    body.at(*rounded_box(CHEST_WIDTH, CHEST_DEPTH, CHEST_BODY, 0.05, 1), z=CHEST_BODY * 0.5)
    # Iron bands: two round the body, and a lock plate on the front (−Y).
    for x in (-CHEST_WIDTH * 0.30, CHEST_WIDTH * 0.30):
        # Proud in Y only. A band that also stood proud of the *top* and
        # *bottom* would poke through the floor by a centimetre — which the
        # FLOOR origin check catches, and which is why it is worth checking.
        bands.at(*box(0.11, CHEST_DEPTH + 0.04, CHEST_BODY), x=x, z=CHEST_BODY * 0.5)
    bands.at(*rounded_box(0.20, 0.06, 0.22, 0.03, 1), y=-CHEST_DEPTH * 0.5 - 0.01,
             z=CHEST_BODY - 0.02)
    # The lock's boss is the deepest point of the whole asset, so it is what
    # the 0.80 m depth allowance is actually spent on — worth knowing before
    # making it bigger.
    bands.at(*icosphere(0.042, 1), y=-CHEST_DEPTH * 0.5 - 0.030, z=CHEST_BODY - 0.05)

    # --- the lid, authored about the hinge ---------------------------------
    # The hinge runs along the chest's **back** top edge (+Y here, the game's
    # −Z, since the chest opens toward the player). Every vertex below is
    # relative to that line, and `emit(location=...)` puts the node on it.
    hinge = (0.0, CHEST_DEPTH * 0.5, CHEST_BODY)
    dome_h = CHEST_HEIGHT - CHEST_BODY
    # A half-barrel arc in the (y, z) plane, from the hinge at (0, 0) over the
    # top and down to the chest's front edge at (−depth, 0), then closed along
    # a shallow lip so the lid is a solid rather than a shell.
    steps = 6
    arc = [
        (
            -CHEST_DEPTH * 0.5 - math.cos(i * math.pi / steps) * CHEST_DEPTH * 0.5,
            math.sin(i * math.pi / steps) * dome_h,
        )
        for i in range(steps + 1)
    ]
    outline = arc + [(-0.02, -0.04), (-CHEST_DEPTH + 0.02, -0.04)]
    verts, faces = extrude_outline(
        outline, CHEST_WIDTH, centre=(-CHEST_DEPTH * 0.5, dome_h * 0.35)
    )
    # `extrude_outline` lays an outline in XZ and extrudes along Y; this arc
    # lives in YZ, so the prism is turned a quarter about Z — which maps
    # (x, y, z) → (−y, x, z), putting the extrusion across the chest's width
    # and the arc down its depth.
    lid.add(verts, faces, matrix=rot(z=90.0))
    for x in (-CHEST_WIDTH * 0.30, CHEST_WIDTH * 0.30):
        lid.at(*box(0.11, CHEST_DEPTH * 0.86, 0.03), x=x, y=-CHEST_DEPTH * 0.5, z=dome_h)

    body.emit(coll)
    bands.emit(coll)
    lid.emit(coll, location=hinge)


# =============================================================================
# Checks
# =============================================================================


def collection_bounds(name: str):
    """World-space bounds of one asset, over every mesh in its collection."""
    coll = bpy.data.collections[name]
    lo = Vector((1e9, 1e9, 1e9))
    hi = Vector((-1e9, -1e9, -1e9))
    for obj in coll.objects:
        if obj.type != "MESH":
            continue
        for v in obj.data.vertices:
            world = obj.matrix_world @ v.co
            lo = Vector((min(lo[i], world[i]) for i in range(3)))
            hi = Vector((max(hi[i], world[i]) for i in range(3)))
    return lo, hi



def footprint_bounds(name: str, band: float = 0.05):
    """XY bounds of the vertices that actually touch the floor.

    ``band`` is how thick "touching" is. 5 cm catches a foot, a plinth's base
    and a table leg's pad, and excludes everything the asset is *holding* —
    which is the distinction that makes this a useful check rather than an
    awkward one.
    """
    coll = bpy.data.collections[name]
    lo = [1e9, 1e9]
    hi = [-1e9, -1e9]
    for obj in coll.objects:
        if obj.type != "MESH":
            continue
        for v in obj.data.vertices:
            world = obj.matrix_world @ v.co
            if world.z <= band:
                for i in range(2):
                    lo[i] = min(lo[i], world[i])
                    hi[i] = max(hi[i], world[i])
    assert lo[0] < 1e8, f"{name} has no geometry within {band} m of the floor"
    return lo, hi


def check_origins() -> str:
    """Assert every asset's origin really is where this file's docstring says.

    Not a spot check on two of them — **all** of them, measured off the emitted
    geometry rather than off the numbers that were meant to produce it. Prose
    about an origin is worth nothing; the mesh is the only thing the game draws.

    An asset in the wrong family is the one mistake here a screenshot would not
    show — it would just be an inch into the floor, or a hand into the wall, at
    some angles — so it fails the build instead.
    """
    rows = []
    for name, family in sorted(ORIGIN_FAMILY.items()):
        lo, hi = collection_bounds(name)
        if family == "FLOOR":
            assert abs(lo.z) < 0.006, (
                f"{name} is a FLOOR asset and its lowest vertex is at z = {lo.z:+.4f}, "
                "not 0 — it would float or sink by exactly that much in the game"
            )
            # ASSET_MANIFEST says "centred on X and Z". **On X that is exact
            # and load-bearing**: everything here can be put against a wall or
            # yawed to face down a hall, and an asset off-centre across its
            # own facing is an asset that drifts sideways every time the placer
            # rotates it.
            assert abs(lo.x + hi.x) < 0.02, (
                f"{name} is off-centre on X by {(lo.x + hi.x) * 0.5:+.4f} m"
            )
            # **On depth it is not exact, and pretending otherwise costs
            # shapes.** A suit of armour grounds a sword in front of its feet;
            # a chest's lock boss stands proud of its front; a throne's arms
            # reach forward. All three are lopsided in Y and all three stand
            # squarely on their own origin, which is the property that actually
            # matters — a placer's keep-out disc is centred on the origin, so
            # what must be true is that the origin is *inside the footprint*,
            # not that the footprint is symmetric about it. An earlier version
            # of this check asserted the symmetry and its first act was to
            # demand the sword be put back inside the skirt it had just been
            # moved out of, which is a check driving the art rather than
            # guarding it.
            foot_lo, foot_hi = footprint_bounds(name)
            assert foot_lo[0] <= 0.0 <= foot_hi[0] and foot_lo[1] <= 0.0 <= foot_hi[1], (
                f"{name}'s origin is outside its own footprint "
                f"(x {foot_lo[0]:+.3f}..{foot_hi[0]:+.3f}, y {foot_lo[1]:+.3f}..{foot_hi[1]:+.3f}) "
                "— it would stand beside the point the placer puts it on, and its "
                "keep-out disc would be centred on empty floor"
            )
        elif family == "WALL":
            assert abs(hi.y) < 0.006, (
                f"{name} is a WALL asset and reaches y = {hi.y:+.4f}; the wall plane is "
                "y = 0 and every vertex must be at or in front of it (−Y). Call "
                "seat_against_wall() with all of its parts."
            )
            assert abs(lo.x + hi.x) < 0.02, (
                f"{name} is a WALL asset and is off-centre on X by "
                f"{(lo.x + hi.x) * 0.5:+.4f} m — 'hang it here' has to mean the middle"
            )
        elif family == "AXIS":
            for axis, value in zip("xyz", (lo.x + hi.x, lo.y + hi.y, lo.z + hi.z)):
                assert abs(value) < 0.02, (
                    f"{name} is an AXIS asset and is off-centre on {axis.upper()} by "
                    f"{value * 0.5:+.4f} m — it is placed by its own axis and nothing else"
                )
        rows.append(
            f"  {name:<14} {family:<5} x {lo.x:+.2f}..{hi.x:+.2f}  "
            f"y {lo.y:+.2f}..{hi.y:+.2f}  z {lo.z:+.2f}..{hi.z:+.2f}"
        )
    return "\n".join(rows)


def check_contract() -> str:
    """Assert the emitted geometry against the Engineer's requested sizes.

    This is §4.4's protocol with teeth on this side of the seam: the Engineer
    re-derives the same figures from the built mesh and asserts them again, so
    a size lives in exactly one place — the vertices — and is checked twice
    from opposite directions.
    """
    rows = []
    for name, want in sorted(CONTRACT.items()):
        lo, hi = collection_bounds(name)
        size = hi - lo
        # A floor asset's height is measured from the floor it stands on; a
        # wall or axial one has no floor, so its height is its own extent.
        got_h = hi.z if ORIGIN_FAMILY[name] == "FLOOR" else size.z
        if want.exact:
            assert abs(got_h - want.height) < HEIGHT_TOLERANCE, (
                f"{name}: the contract asks for {want.height:.2f} m and the geometry "
                f"measures {got_h:.3f} m. The Engineer stacks things on this number — fix "
                "the shape or renegotiate it in the handoff, but do not let the two differ."
            )
        else:
            assert got_h <= want.height + 1e-3, (
                f"{name}: {got_h:.3f} m tall against an allowance of {want.height:.2f} m"
            )
        assert size.x <= want.width + 1e-3, (
            f"{name}: {size.x:.3f} m wide against an allowance of {want.width:.2f} m"
        )
        assert size.y <= want.depth + 1e-3, (
            f"{name}: {size.y:.3f} m deep against an allowance of {want.depth:.2f} m"
        )
        mount_note = ""
        if ORIGIN_FAMILY[name] == "FLOOR":
            # **Assert the height that actually has to clear, not the mesh's
            # own.** Almost nothing here stands on the floor: the armour stands
            # on the plinth, the feast stands on the table, the throne stands on
            # the Engineer's dais. Comparing the bare mesh against the headroom
            # is a check on a quantity nobody builds — it passed a 2.80 m throne
            # against 3.08 m of headroom while the thing stood at 3.10 m.
            #
            # `stands_on` is resolved by **measuring** the asset underneath, so
            # the mount is a build result rather than a second copy of a number:
            # retune the table and the goblets are re-checked at the new top on
            # the same run.
            mount = want.dais
            if want.stands_on is not None:
                _, under = collection_bounds(want.stands_on)
                mount += under.z
            top = hi.z + mount
            if mount:
                mount_note = (
                    f" — {hi.z:.3f} m of asset on {mount:.3f} m of mount"
                )
            assert top < CEILING_CLEAR, (
                f"{name} stands {hi.z:.3f} m tall on a {mount:.3f} m mount"
                f"{' (' + want.stands_on + ', measured)' if want.stands_on else ' (dais)'}"
                f", so its top is at {top:.3f} m, and the clear headroom is "
                f"{CEILING_CLEAR:.2f} m ({CEILING_FROM}) — it would go through the ceiling"
            )
        rows.append(
            f"  {name:<14} {size.x:5.2f} × {got_h:5.2f} × {size.y:5.2f} m "
            f"(asked {want.width:.2f} × {want.height:.2f} × {want.depth:.2f})  "
            f"{want.note}{mount_note}"
        )
    rows.append(f"  armour keep-out radius needed: {armour_keep_out():.4f} m "
                "(their allowance 0.650)")
    return "\n".join(rows)


def armour_keep_out() -> float:
    """The armour's keep-out radius, **about its origin**, from the vertices.

    A placer's keep-out disc is centred on the **origin** — `check_origins`
    says so eighty lines up, in the comment that explains why a FLOOR asset's
    footprint is allowed to be lopsided. So the radius that feeds the
    Engineer's check is the distance from the origin to the furthest vertex in
    plan, and nothing else.

    This used to be ``hypot(hi.x - lo.x, hi.y - lo.y) * 0.5`` — the
    half-diagonal of the footprint AABB, which is the radius about the
    **footprint's centre**. Those two are the same number only for an asset
    that is symmetric about its origin, and this file deliberately stopped
    requiring that: the armour grounds a sword in front of its feet, so its Y
    range is −0.3500..+0.4293 and its footprint centre sits 0.040 m off the
    origin. The old figure came out 0.638 and the true one is 0.505.

    0.638 was the conservative error and both are inside the Engineer's 0.650,
    so nothing was ever mis-placed — but a footprint-centred half-diagonal
    **understates** the origin-centred radius exactly when an asset is lopsided,
    which is the freedom the FLOOR check was relaxed to allow. The one shape
    that would break it is the one shape this file is now free to make. Taking
    the max over the vertices is correct by construction under any future shape,
    which a formula over an AABB is not.
    """
    furthest = 0.0
    for obj in bpy.data.collections["armour"].objects:
        if obj.type != "MESH":
            continue
        for v in obj.data.vertices:
            world = obj.matrix_world @ v.co
            furthest = max(furthest, math.hypot(world.x, world.y))
    assert furthest <= 0.65 + 1e-3, (
        f"the armour reaches {furthest:.4f} m from its own origin in plan and the "
        "Engineer's keep-out radius is 0.65 m — eight of these go against walls "
        "children walk past"
    )
    return furthest


# =============================================================================

BUILDERS = (
    build_armour,
    build_plinth,
    build_tapestry,
    build_tapestry_rail,
    build_sconce,
    build_throne,
    build_table,
    build_bench,
    build_feast,
    build_chest,
)


def main() -> None:
    reset_scene()
    for builder in BUILDERS:
        builder()

    # **Evaluate the dependency graph before measuring anything.** Every check
    # below reads `matrix_world`, and a freshly-created object's is stale until
    # the view layer updates — which cost an hour here: the chest lid is the
    # one node with a non-identity transform, and without this line its origin
    # measured as if the hinge offset did not exist.
    bpy.context.view_layer.update()

    built = {c.name for c in bpy.data.collections}
    assert built == set(ORIGIN_FAMILY), (
        "every asset must declare its origin family: built but undeclared "
        f"{sorted(built - set(ORIGIN_FAMILY))}, declared but not built "
        f"{sorted(set(ORIGIN_FAMILY) - built)}"
    )
    assert built == set(CONTRACT), (
        "every asset must appear in the request contract: built but not requested "
        f"{sorted(built - set(CONTRACT))}, requested but not built "
        f"{sorted(set(CONTRACT) - built)}"
    )

    print("\ncastle_build")
    print(summarise())
    print("\n  origins, measured off the emitted vertices:")
    print(check_origins())
    print("\n  sizes against the Engineer's request contract (§4.3):")
    print(check_contract())
    offset = sconce_offset()
    print(
        "\n  SCONCE_CUP_OFFSET (game frame, metres from the sconce's origin) = "
        f"({offset[0]:.4f}, {offset[1]:.4f}, {offset[2]:.4f})"
        "\n    — the centre of the cup's mouth, where the Engineer's flame stands."
    )
    print(f"\n  TABLE_TOP = {TABLE_TOP:.3f}   BENCH_SEAT = {BENCH_SEAT:.3f}")
    print(f"  clear headroom {CEILING_CLEAR:.2f} m, from {CEILING_FROM}")
    print(f"  tallest child {TALLEST_CHILD:.3f} m, from src/art/models/kid.ts")
    print(f"\n  {len(bpy.data.objects)} nodes, {total_triangles()} triangles total")

    bpy.ops.wm.save_as_mainfile(filepath=BLEND)
    print("  saved", BLEND, f"({os.path.getsize(BLEND)} bytes)\n")


if __name__ == "__main__":
    # Blender exits 0 on an uncaught Python exception, so `--python-exit-code 1`
    # is on the command line in `package.json` — that is what covers assertions
    # which fire while the *module body* runs, and this block cannot. See
    # `hotel_build.py`'s tail for the full account.
    try:
        main()
    except Exception:
        traceback.print_exc()
        sys.exit(1)
