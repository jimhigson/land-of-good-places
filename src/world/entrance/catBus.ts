import {
  Color,
  ConeGeometry,
  CylinderGeometry,
  ExtrudeGeometry,
  Group,
  Mesh,
  Shape,
  SphereGeometry,
} from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { PALETTE, hexToCss } from '../../core/palette';
import {
  CHILD_FOOTPRINT,
  KID_SHOULDER_HEIGHT,
  TALLEST_CHILD_HEIGHT,
  WIDEST_CHILD_FOOTPRINT,
} from '../../art/models/kid';
import { RIDER_HEADROOM } from '../train/clearance';
import { angleDelta, clamp, clamp01, lerp } from '../../core/mathUtils';
import { addOutline, decal, solid, toonMaterial } from '../../art/style/materials';
import { applyStaticBakedFace, type FacePaintOptions } from '../../art/style/faces';
import { blob } from '../../art/style/asset';
import { drapeStripeUvs, tigerStripeTexture } from './tigerStripes';

/**
 * The cat bus.
 *
 * An original design — a pastel toy minibus with a cat's face on the front,
 * not a copy of any existing cartoon catbus: one body (no legs), a painted
 * face rather than a lit-in-the-dark grin, triangular ears on the roof and
 * paw-print livery down the flanks. Built from the
 * same chunky-primitive-plus-toon-material kit as every other vehicle in the
 * park (compare `minigames/dodgems/car.ts`) so it drops straight into the
 * house style.
 *
 * The front third of the body is a big squashed sphere rather than a flat
 * panel — exactly the trick every character's head uses — so the painted face
 * patch (`art/style/faces.ts`) can hug it the same way a kid's or RiPika's
 * face does, instead of floating over a flat windscreen.
 */

/**
 * **The bus is sized by what it has to hold, not by a number picked by eye.**
 *
 * Jim, 7 August 2026, watching the first run anyone had ever seen: *"the bus is
 * also barely bigger than a child, and smaller vertically than one child with a
 * hat"*, and then *"the seats should have children on them too, and there
 * should be about 12 seats total on the bus"*.
 *
 * He was right and the old numbers were unarguable: the bus stood 2.66 m, a
 * child is 2.12 m, and a child in a party hat is `TALLEST_CHILD_HEIGHT` 2.97 m.
 * It was a garden shed with a cat painted on it.
 *
 * So **the seat plan is the source and every body dimension is derived from
 * it.** Twelve seats in six rows of two either side of a gangway; the length is
 * whatever six rows take, the width is whatever two seats and a gangway take,
 * and the height is whatever clears the tallest child's hat. Nothing here
 * agrees with anything else by coincidence — which is the trap the Rail Race
 * cart hit, where lane spacing and cart width were two independent `1.04`s that
 * matched by luck.
 *
 * **That claim was half true when it was written, and the half that was false
 * cost us a round of family QA.** The *height* really was derived from
 * `TALLEST_CHILD_HEIGHT`. The *seat plan* was not derived from anything: it was
 * `SEAT_PITCH = 1.0` and `SEAT_WIDTH = 0.92`, picked by eye against an imagined
 * child "about 0.6 m across", because `kid.ts` published no width for anyone to
 * derive from. A real child measures **1.53 m across and 1.54 m deep** — a
 * chibi rig is almost entirely head — so all twelve passengers overlapped their
 * neighbour by half a metre and poked through the bodywork, on a bus whose own
 * documentation said that could not happen.
 *
 * The lesson is not "measure the bus". It is that **a derivation naming a
 * source it does not actually read is indistinguishable from a guess**, and
 * reads more convincingly. `CHILD_FOOTPRINT` now exists so there is something
 * real to derive from, and `childrenFitTheSeatsTheySitIn` re-measures it.
 */

/** Rows of seats, and seats per row — one either side of the aisle. */
const SEAT_ROWS = 6;
const SEATS_PER_ROW = 2;
/** Jim asked for "about 12 seats total". This is that number, derived once. */
export const CAT_BUS_SEAT_COUNT = SEAT_ROWS * SEATS_PER_ROW;

/**
 * Row-to-row spacing, and across-the-bus seat spacing — **both a whole child
 * wide**, because that is what a child measures.
 *
 * Jim, 7 August 2026: *"the bus far too small to hold that many child models at
 * their size"*. He was right, and the reason is worth keeping, because the file
 * you are reading claimed the opposite in large friendly letters. These were
 * `1.0` and `0.92`, hand-picked against an imagined child "about 0.6 m across".
 * A real child is **1.53 m across and 1.54 m deep** — it is nearly all head,
 * `KID_HEAD_SCALE` being 1.5 — so every one of the twelve passengers stuck
 * 0.10–0.24 m through the bodywork and overlapped the child behind them by
 * **0.52 m**.
 *
 * The height above was derived honestly from `TALLEST_CHILD_HEIGHT` and fits.
 * The seat plan was not derived from anything, because **`kid.ts` exported no
 * width at all** — there was nothing to derive it from. {@link CHILD_FOOTPRINT}
 * is that missing number, measured across every hair style and every hat, and
 * these are now simply it.
 */
const SEAT_PITCH = CHILD_FOOTPRINT;
const SEAT_WIDTH = CHILD_FOOTPRINT;
/**
 * The gangway. Not walkable, and deliberately not pretending to be: a child is
 * 1.8 m wide, so **no aisle this bus could carry is one a child fits down**
 * without brushing the seat backs either side. Nobody walks it — the arrival
 * re-parents a child out of their seat and onto the pavement — so this is the
 * gap that makes it read as a bus rather than a promise about traffic.
 */
const AISLE_WIDTH = 0.8;
/** A low cushion. Children sit **on** it — see {@link CAT_BUS_SEAT_Y}. */
const SEAT_PAD_HEIGHT = 0.3;

/**
 * The cabin floor, above the ground — a **low-floor bus**.
 *
 * Deliberately low: it is one easy step down for a child, and every centimetre
 * of floor height is a centimetre added to the overall height of an already
 * tall vehicle.
 */
const BODY_BOTTOM_Y = 0.62;

/**
 * Interior height, floor to ceiling.
 *
 * `TALLEST_CHILD_HEIGHT` rather than `KID_HEIGHT`, per ARCHITECTURE-DECISIONS
 * §147 — *"a child's height is `TALLEST_CHILD_HEIGHT` (2.97 m), not
 * `KID_HEIGHT`"* — because children wear hats on rides and a ceiling that
 * clips a party hat is the same bug as a duck bar that does. `RIDER_HEADROOM`
 * (0.4 m) is the park train's own allowance over a rider's head, borrowed here
 * so the two vehicles answer "how much room over a child?" with one number.
 *
 * This used to carry a paragraph arguing that **children are seated with their
 * origins on the floor**, not on the cushions, because *"sitting costs exactly
 * what standing costs"*. It was wrong twice over, and Jim found both by riding
 * the bus on 7 August 2026: *"the children on the bus aren't sitting on seats,
 * they're clipped through the floor while on the inside view"*.
 *
 * They were not sitting because nothing ever posed them — see
 * {@link CAT_BUS_SEAT_Y} — and they were through the floor because the constant
 * that says where the floor is said the wrong thing; see {@link CAT_BUS_FLOOR_Y}.
 */
const CABIN_HEIGHT = TALLEST_CHILD_HEIGHT + RIDER_HEADROOM;

/** Wall thickness either side of the seats. */
const WALL_THICKNESS = 0.16;

const BODY_HEIGHT = CABIN_HEIGHT;

/**
 * How much bigger every *small* feature is than in the original drawing.
 *
 * The body above is now stated in real metres, but the ears, whiskers, paw
 * prints, bumpers and door furniture were all drawn against a 1.55 m body. Left
 * alone they would stay shed-sized details stuck on a bus. One factor, applied
 * at each of them, keeps the drawing's proportions.
 *
 * Declared up here rather than two hundred lines down, because the floor's
 * thickness is written in it and everything that stands on the floor needs that
 * number before the model is built.
 */
const DETAIL = BODY_HEIGHT / 1.55;

/** How thick the drawn cabin floor is. Its **top** is {@link CAT_BUS_FLOOR_Y}. */
const FLOOR_PAN_THICKNESS = 0.08 * DETAIL;

/**
 * **The surface you stand on** — the top of the floor pan, not the underside of
 * the bus.
 *
 * This was `BODY_BOTTOM_Y`, and that is the whole of Jim's *"clipped through the
 * floor"*. `BODY_BOTTOM_Y` is where the bodywork's underside sits; the floor is
 * a pan drawn *on* it, {@link FLOOR_PAN_THICKNESS} thick. Everything that put a
 * body "on the floor" — the twelve seats, the driver — used the exported
 * constant and so stood **0.17 m under the floor they were standing on**, feet
 * buried in an opaque slab. From outside they read against the windows and
 * nobody saw it; the inside camera landing is what made it visible.
 *
 * A textbook instance of CLAUDE.md's *"two definitions of one thing"*, with the
 * sharpest possible twist: the two definitions were **the same constant**,
 * meaning the underside to the builder and the walking surface to every reader.
 * So the pan is now built from these two numbers rather than from its own copy
 * of `0.08 * DETAIL`, and the surface has a name that can only mean one thing.
 */
export const CAT_BUS_FLOOR_Y = BODY_BOTTOM_Y + FLOOR_PAN_THICKNESS;

/**
 * **The top of a seat cushion — where a seated child's bottom goes.**
 *
 * The seats are anchored here rather than at the floor, and a child parented to
 * one is posed by the game's own `applyRidePose` (see `entities/ridePose.ts`).
 * That pairing is the fix for *"aren't sitting on seats"*: `BusJourney` used to
 * do `seat.add(kid.root)` and nothing else, which left twelve children standing
 * bolt upright with the cushions passing through their shins.
 *
 * **The rig has no knee**, so a seated child's legs stick straight out in front
 * of her and her lowest drawn point is the hem of her own torso, level with her
 * origin. That is exactly what makes this simple: put the origin on the cushion
 * and she is sitting on it, feet dangling — which is what a small child on a bus
 * seat actually looks like, and what a six-year-old will recognise.
 */
export const CAT_BUS_SEAT_Y = CAT_BUS_FLOOR_Y + SEAT_PAD_HEIGHT;

/** How far off the centre line one seat sits. The one owner of "which side". */
const SEAT_OFFSET_X = AISLE_WIDTH / 2 + SEAT_WIDTH / 2;

/**
 * **Wide enough to contain the widest child it can ever carry.**
 *
 * `SEAT_OFFSET_X` spaces the children so they do not overlap *each other*;
 * this is the separate question of whether the **bodywork** contains them, and
 * the answer has to hold for the one passenger who can be wearing a sun hat —
 * the player, who made her own look in the character creator immediately
 * before boarding. The other eleven are crowd NPCs and go bare-headed.
 *
 * Sized on {@link WIDEST_CHILD_FOOTPRINT} rather than {@link CHILD_FOOTPRINT}
 * precisely because "a child sticking out through the side of the bus" is the
 * fault being fixed here, and shipping a known remaining instance of it would
 * be absurd.
 */
const BODY_WIDTH = 2 * (SEAT_OFFSET_X + WIDEST_CHILD_FOOTPRINT / 2 + WALL_THICKNESS);

/**
 * Slack at the front and back of the seat block, for the same reason.
 *
 * The rows are a child apart, so the front and rear children each hang half a
 * child past the outermost row centre. Without this the back row sat 0.24 m
 * through the back wall — measured, on the bus this replaces.
 */
const ROW_END_MARGIN = Math.max(0, WIDEST_CHILD_FOOTPRINT - SEAT_PITCH) / 2;
/** Six rows, plus the driver's area up front and a little behind the back row. */
const CABIN_LENGTH_FROM_SEATS = SEAT_ROWS * SEAT_PITCH + ROW_END_MARGIN * 2;
const DRIVER_AREA_LENGTH = 1.45;
const FACE_RADIUS = BODY_WIDTH * 0.52;
const BODY_LENGTH = CABIN_LENGTH_FROM_SEATS + DRIVER_AREA_LENGTH + FACE_RADIUS * 1.1;

/**
 * The longest walk anybody has from their seat to the door, in metres.
 *
 * Exported because `ArrivalSequence` walks children down the bus at the park's
 * ordinary pace rather than teleporting them from seat to pavement, and it has
 * to know at module scope how long to keep the bus waiting. Derived from the
 * cabin it is a walk down, so a longer bus keeps its bus waiting longer without
 * anybody adjusting a second number.
 */
export const CAT_BUS_LONGEST_WALK_TO_DOOR = CABIN_LENGTH_FROM_SEATS + BODY_WIDTH / 2;

/**
 * **How big the bus is, for anybody who has to leave room for it.**
 *
 * These were not exported, so everything outside this file that needed the
 * bus's size had a copy of it — and every copy went stale the moment the seat
 * plan was re-derived from a child who had actually been measured and the bus
 * grew from 11 m to 18 m. `layout.ts` still carries the sentence *"an 18.2 m
 * bus"* in a comment; `ENTRANCE_CLEAR_RADIUS` was 10 m, sized for the 11 m bus,
 * and stayed 10 m. That is this repo's most expensive bug shape (CLAUDE.md,
 * "Two definitions of one thing, kept in step by hand") in its plainest form:
 * the derivation was right, it simply had no way to be asked.
 *
 * **These are derived design figures, not a measurement of the built model,
 * and the difference runs both ways.** Measured on the model this file builds
 * (29 Aug 2026, tail removed): a `Box3` round it is **7.30 x 6.00 x 14.45**
 * with the door shut and **8.20** wide with it open; the bodywork — the two
 * shell bands plus the cat's face — is **5.57 x 5.13 x 14.33**.
 *
 * Against that, `CAT_BUS_LENGTH` (15.83) is 1.5 m *longer* than the bodywork it
 * names, so it is safe to reserve space with; but `CAT_BUS_WIDTH` (5.28) is
 * *narrower* than the vehicle really is at every point that matters. The face
 * and whiskers stand 1.43 m off the front of the shells; the wheels reach 3.65
 * from the centreline, 1.01 m outboard of this constant's own half-width; and
 * the open door reaches 4.55, a further 1.91 m out. Anything leaving room for
 * the bus must leave room for *those* — which is why `arrivalSightline.ts` pads
 * by a whole bus length rather than a half and takes {@link CAT_BUS_TRACK_WIDTH}
 * across, not this.
 *
 * **Nothing checks these numbers against the built model.** `check:cat-bus`
 * imports the destination, the route number and the seat count from here and
 * nothing else: it samples the *drawn* box against the park boundary, so it
 * catches a bus that grows outwards into the fence but would not notice these
 * constants drifting from the mesh. `check:bus-journey` asserts every part
 * touches the bodywork, which is a different question again. Re-measure rather
 * than trusting the figures above if you are about to rely on them — a constant
 * claiming to be the whole vehicle while describing only its box is how a 10 m
 * keep-out came to be sized for an 11 m bus in the first place.
 */
export const CAT_BUS_LENGTH = BODY_LENGTH;
export const CAT_BUS_WIDTH = BODY_WIDTH;

/**
 * **Where the bodywork stops and the window opening starts.**
 *
 * The old bus had no openings at all: it was one closed `RoundedBoxGeometry`
 * with transparent panes stuck on the *outside* of it. The glass was real —
 * `transparent: true, opacity: 0.34` — and completely pointless, because 2 cm
 * behind it was a solid cream wall. Jim, 7 August: *"the windows are also not
 * transparent"*. He was reading the wall.
 *
 * So the side walls are now built in two bands with a genuine gap between them,
 * divided by pillars, and the glass fills the gap. The band is placed to frame
 * a **seated child's head**, which sits a little over a metre above the seat
 * and is 1.53 m across — that is what there is to look at, and Stage B's whole ask is
 * that you can see them.
 *
 * **The sill is a seated child's shoulder line**, and that is Jim's second fault
 * of 7 August: *"the windows of the bus go all the way down to the floor of the
 * bus […] windows should only start about halfway up the sides"*. It was
 * `BODY_BOTTOM_Y + 0.55` — a picked number, 0.38 m above the actual floor, which
 * over a 2.72 m interior is glass from the ankles up. He was right.
 *
 * Derived rather than picked now, and from the thing that makes a bus look like
 * a bus: **the panel below the glass is the passengers' bodies, and the band
 * above it is their heads.** {@link KID_SHOULDER_HEIGHT} is where a child's
 * torso stops, measured off the built rig, so the glazing starts at her
 * shoulders exactly as a real coach's does.
 *
 * That lands it **44% up the side** — Jim's "about halfway", reached by
 * derivation rather than by aiming at it. The solid lower panel goes from 0.55 m
 * tall to 1.50 m, nearly tripling.
 *
 * The obvious alternative — the sill at her **chin** — was built and looked at
 * first. It is safer, in that the whole face is above the line whatever else
 * changes, but it only reaches 34% and still reads as a glasshouse rather than a
 * bus: these children are chibi, the head is 59% of their height and 1.32 m
 * across, so a chin-height sill sits barely above the seat. The shoulder line
 * hides the bottom quarter of the skull — the jaw — and leaves eyes and mouth
 * well clear; the mouth is painted 60% of the way down the face canvas, and the
 * flank captures show every face whole above the glass line.
 */
const WINDOW_SILL_Y = CAT_BUS_SEAT_Y + KID_SHOULDER_HEIGHT;
const WINDOW_HEAD_Y = BODY_BOTTOM_Y + CABIN_HEIGHT * 0.86;

/**
 * **The floor and the real ceiling of the cabin**, for anything that has to fit
 * inside the bus.
 *
 * The ceiling is *not* the roof. Between the window head and the roof sits the
 * header band (`cat-bus-shell-upper`), a solid slab the full width and length of
 * the cabin, so the clear interior stops at {@link WINDOW_HEAD_Y} — 0.47 m lower
 * than `BODY_BOTTOM_Y + BODY_HEIGHT` suggests.
 *
 * Exported because that difference is invisible from outside this file and cost
 * a round: the ride's inside camera was placed at `TALLEST_CHILD_HEIGHT` above
 * the floor, which is a height the cabin genuinely has — and is 0.08 m *inside*
 * the header band. The captured frame was a flat brown wall filling the screen,
 * and every check passed, because the camera really was within the bus's
 * bounding box and every child really was within its frustum.
 */
export const CAT_BUS_CABIN_CEILING_Y = WINDOW_HEAD_Y;

/**
 * **How far forward the clear interior goes**, before the cat's own face fills
 * the vehicle.
 *
 * The face is a squashed sphere `FACE_RADIUS` across, flattened to 0.6 in z, and
 * it is not a shell on the front — it *is* the whole front of the bus, with the
 * driver sitting inside it. Anything placed forward of this is inside the cat's
 * head, which is where the ride's interior camera spent a round: the frame was
 * the inside of the face's own BackSide outline shell, 0.15 m from the lens.
 */
export const CAT_BUS_CABIN_FRONT_Z =
  BODY_LENGTH / 2 - FACE_RADIUS * 0.62 - FACE_RADIUS * 0.6;
/**
 * **What colour the bus is** — cream body, pale lemon roof.
 *
 * Exported because anything drawn *over* the bus has to know: the ride's title
 * card sits on top of this vehicle on a portrait phone, and its colours were
 * chosen against grass and sky by somebody who had no way to ask what the bus
 * was painted. The yellow band came out at 1.07:1 against this roof — the same
 * brightness as the thing behind it. A colour that must contrast with another
 * colour has to be able to read it, or the two are kept in step by hand, which
 * is the bug shape this repo pays for most often.
 */
export const CAT_BUS_BODY_COLOUR = PALETTE.pathEdge;
export const CAT_BUS_ROOF_COLOUR = new Color(PALETTE.flowerYellow)
  .lerp(new Color(0xffffff), 0.35)
  .getHex();

/** Thickness of the posts between one window and the next. */
const PILLAR_Z = 0.26;

/**
 * **How much bigger the wheels are than they were drawn.**
 *
 * Jim, 29 August 2026: *"cat bus wheels should be double current size."* (The
 * ask arrived first as "50% larger" and was corrected to 2x before any of it
 * was built; issue #364 carries both.) One factor, named, so that the radius,
 * the track width, the arch gap and the check that guards them all move
 * together if it is ever retuned again.
 *
 * His standing scale ruling is what makes this right rather than a problem to
 * be minimised: **recognisability beats proportion**, and geometry that would
 * be implausible on a real vehicle is fine so long as it works. A 2.13 m tall
 * wheel reads, at a glance, as a big friendly wheel.
 */
export const CAT_BUS_WHEEL_SCALE = 2;

const WHEEL_RADIUS = BODY_BOTTOM_Y * 0.86 * CAT_BUS_WHEEL_SCALE;
/**
 * Tyre width, unchanged from the original drawing.
 *
 * Deliberately *not* scaled with the radius. Scaled, a wheel 2x across would be
 * 1.49 m thick and the bus would be three metres wider still for no gain; left
 * alone, the tyre comes out 2.13 m tall and 0.73 m wide — a 2.9:1 ratio, which
 * is very nearly what a real road tyre measures. The wheel got bigger, not
 * fatter.
 */
const WHEEL_WIDTH = 0.34 * DETAIL;

/**
 * How far the outline shells stand proud of the bodywork they hang on.
 *
 * `addOutline` pushes a copy of the geometry out along its normals by exactly
 * this, so **the bus's true outer surface is this much further out than
 * `BODY_WIDTH / 2`**. Anything asked to stand clear of the bus has to clear the
 * outline too, or it clears the box and clips the line drawn round it — which
 * is a 4 cm error and precisely the size of gap nobody notices until it is on
 * screen.
 */
const OUTLINE_THICKNESS = 0.02 * DETAIL;

/**
 * **The wheels stand entirely outboard of the bodywork, and that is the whole
 * answer to "does a 2x wheel end up inside the bus?".**
 *
 * At the old radius the wheels were half-buried in the flanks: centre at
 * `BODY_WIDTH / 2 - 0.05 * DETAIL`, so the inboard face sat at x 2.16 — a good
 * 0.32 m *inside* the cabin's inner wall at 2.48. That was invisible and
 * harmless while the tyre only reached y 1.05, because everything it passed
 * through down there is the solid lower shell.
 *
 * Doubled, it reaches **y 2.133**, which is 1.34 m above the cabin floor and
 * 9 cm outboard of the cushions. A black cylinder would have stood in the bus
 * beside the passengers, and the ride's interior camera looks straight at it.
 *
 * Raising the ride height cannot fix that. The window sill is derived from
 * `BODY_BOTTOM_Y`, so `sill - wheelTop` is exactly `BODY_BOTTOM_Y - 0.62`
 * however high the bus is lifted — every centimetre of arch you buy is a
 * centimetre added to the step a six-year-old has to make getting off, and
 * clearing the *floor* would need `BODY_BOTTOM_Y ~= 1.96`, chest-high on a
 * 2.12 m child.
 *
 * So the wheels move out instead, and the clearance is then **guaranteed by
 * lateral separation rather than by a height a downstroke can eat**. Nothing
 * about the floor, the seats, the door, the step or the route changes. It also
 * happens to be what a toy looks like.
 *
 * Derived from the widest thing on the axle — the fender, not the tyre — so it
 * is the *whole* assembly that clears, not just the rubber.
 */
const WHEEL_CLEARANCE = 0.08;
/** Half the mudguard's width: it overhangs the tyre by 0.06 m on each side. */
const FENDER_HALF_WIDTH = WHEEL_WIDTH / 2 + 0.06;
/** How thick the mudguard's plates are, radially. */
const FENDER_THICKNESS = 0.11;
/** How far each plate's outline shell stands proud of it — including inwards. */
const FENDER_OUTLINE_THICKNESS = 0.012 * DETAIL;
/**
 * How far round the wheel the mudguard reaches, **as one swept arc**.
 *
 * ## Not a torus, and that was found by measuring rather than by reading
 *
 * The mudguard started as a half-`TorusGeometry`, which is the obvious shape
 * for it — and a torus's tube has to be at least half the wheel's width
 * (0.36 m) to cover the tyre, while the arch gap was 0.35 m. So the tube's
 * innermost surface sat 0.12 m *inside* the tyre it was supposed to clear: a
 * mudguard driven through its own wheel, at rest, before the suspension moved
 * at all. Nothing about it looked wrong in the source.
 *
 * What that bug actually needed was a shape whose **inner surface is at a
 * fixed radius by construction, with its width a free parameter rather than
 * the same number as its clearance**. An extruded annular sector is exactly
 * that, and so was the arc of flat plates that replaced the torus first.
 *
 * ## And not plates either, which took two goes to see
 *
 * The plates were tuned twice — five over 2.44 rad, then eight over 1.6 — and
 * both times from a side elevation, where they duly read as a curve. **The
 * game never looks at the bus from the side.** It looks *down* at it from an
 * isometric camera about 30 m up, and from there a 92-degree arc capping the
 * top of the tyre is seen almost edge-on: what is on screen is eight plate
 * *edges* stacked one behind another, each with its own ink outline, which
 * reads as a little stack of planks — a pallet bolted to the flank, not an
 * arch over a wheel. The review found it by rendering the arrival and looking,
 * and the second retune had moved the problem rather than removed it.
 *
 * So: **one mesh, one outline, one silhouette.** An `ExtrudeGeometry` of an
 * annular sector is a genuine swept arc, so there are no internal edges to
 * count from any angle, and its single ink outline draws the arch's own
 * profile instead of eight parallel lines across it.
 *
 * And the arc **widens to 2.6 rad (149 degrees)**, down past the hub on both
 * sides rather than capping the crown. Seen from above that is the half of the
 * change that matters: an arc that reaches below the wheel's centre presents
 * its curvature to a camera looking down, where one that stops at 46 degrees
 * either side of top has almost none to present.
 *
 * Judged from the game's own isometric camera this time, not from a side
 * elevation. That is the actual lesson here and it is why it is written down.
 */
const FENDER_ARC = 2.6;
/** How many segments the swept arc is tessellated into. Smooth, not faceted. */
const FENDER_ARC_SEGMENTS = 32;
/** Half the track: where a wheel's centre plane sits, either side. */
const WHEEL_X = BODY_WIDTH / 2 + OUTLINE_THICKNESS + WHEEL_CLEARANCE + FENDER_HALF_WIDTH;
/** Front axle first, then rear. Where the wheels were before, unchanged. */
const WHEEL_Z = [BODY_LENGTH * 0.28, -BODY_LENGTH * 0.3] as const;
const WHEELBASE = (WHEEL_Z[0] ?? 0) - (WHEEL_Z[1] ?? 0);

/**
 * **How big the bus is across the wheels** — for anything leaving room for it.
 *
 * {@link CAT_BUS_WIDTH} is, and stays, the *bodywork*: its own docblock is
 * emphatic that the bodywork and the silhouette are different numbers and that
 * confusing them is how a 10 m keep-out came to be sized for an 11 m bus. The
 * wheels used to stand 0.26 m proud of the flanks and nothing accounted for it;
 * doubled and moved outboard they stand a good deal further, and a road sized
 * on the bodywork would have a bus driving down it with its tyres in the grass.
 *
 * So this exists rather than a second copy of the sum appearing in `road.ts`.
 */
export const CAT_BUS_TRACK_WIDTH = 2 * (WHEEL_X + FENDER_HALF_WIDTH);

/**
 * **How far the sprung body may move, and the one place those limits live.**
 *
 * Jim, 29 August 2026: the bus *"should bob up and down while it drives on its
 * suspension to look more realistic"*.
 *
 * These are hard clamps applied in `animate`, not hopes about what the spring
 * will do. That matters because the arch gap below is *derived from them*: if
 * the body could drop further than it says here, it would drive a fender down
 * onto a tyre, and "the wheels do not intersect the body" would be false at the
 * bottom of a bump rather than at rest — which is exactly the failure a still
 * frame cannot show and `check:cat-bus-suspension` exists to catch.
 *
 * Heave in metres; pitch and roll in radians.
 *
 * **Sized in pixels on the screen, not in metres on the bus.** The first cut
 * of this was 0.08 m and 0.014 rad, defended in this very docblock as
 * *"10 cm and a degree, because a bus that visibly lurches reads as broken
 * rather than sprung"*. That is the right instinct for a driving game seen
 * from the cab and the wrong one here: the park is seen from ~30 m up, and
 * that clamp — which the road only ever half used — came out at **0.0645 m
 * peak to peak, about 2 px**. Sampled frame by frame through a real arrival it
 * was arithmetically a suspension and perceptually a rigid bus, and the review
 * found it by measuring the running game rather than by reading this file.
 *
 * As tuned the drive-in heaves **0.3298 m peak to peak**, which is **10.3 px**
 * in the arrival camera, and body-against-wheel measures **11.3 px** as a
 * projected screen offset. It reads as a clean swell of about one and a half
 * cycles at ~0.7 Hz.
 *
 * **How to measure this, because the obvious way is wrong.** Pixels here mean
 * *project the point through the live render camera every frame and subtract*.
 * They do not mean "metres times a scale read off the picture": the scale is
 * different in every camera phase (31.1 px/m at the arrival camera, 41.9 px/m
 * after hand-over — the arrival camera sits further back), so multiplying one
 * phase's metres by another phase's scale silently mixes two moments. That is
 * exactly how this docblock first claimed 13.4 px.
 *
 * And **do not derive the scale from the tyre's silhouette**, which is the
 * trap under that one. A tyre is a *cylinder*, not a flat vertical ruler: seen
 * from an isometric camera its 0.74 m of axial width foreshortens into the
 * screen's vertical axis and pads the silhouette well beyond the 2.133 m disc,
 * so `silhouette / diameter` overstates the vertical scale by about a third
 * (86-87 px suggests ~41 px/m where the camera's real answer is 31.1). Two
 * plausible measurements of the same frame, disagreeing by 35%, and only the
 * one that goes through the camera matrix is answering the question asked.
 *
 * These numbers are Jim's standing ruling that **recognisability beats
 * proportion** applied to motion instead of to size — the same ruling that
 * gave this bus 2.13 m wheels. A real coach does not lean like this. A big
 * friendly cartoon cat pulling away from the kerb does.
 *
 * The three are not interchangeable, and the exchange rate is why they are not
 * all simply doubled again:
 *
 * - **heave** costs {@link CAT_BUS_RIDE_LIFT} 1:1;
 * - **pitch** costs it `NOSE_Z` = ~7.9 m per radian, because the cat's chin
 *   hangs 7.9 m in front of the centre and a nose-down bump is what puts it
 *   through the road. So pitch buys the most visible motion per radian *and*
 *   the most ride height per radian, and it is deliberately the one held back;
 * - **roll** costs `FACE_RADIUS` and only ever shows on a corner, which is
 *   `BusJourney` and not the arrival.
 */
export const CAT_BUS_MAX_HEAVE = 0.2;
export const CAT_BUS_MAX_PITCH = 0.028;
export const CAT_BUS_MAX_ROLL = 0.05;

/**
 * **How much higher the sprung body rests than it is drawn** — the ride height
 * the doubled wheels bought.
 *
 * This is not decoration and it is not a taste call. The cat's face is a
 * squashed sphere whose chin hangs to **y = 0.14 m**, 7.86 m forward of the
 * bus's centre. Pitch the body nose-down by `CAT_BUS_MAX_PITCH` and that point
 * drops 0.11 m; add full heave and a full lean and it is 0.30 m below where it
 * started, which is 0.16 m *under the road*. The bus would plough its own chin
 * through the tarmac on the first bump — and this was found by
 * `check:cat-bus-suspension` reporting `y=-0.1597`, not by looking at it, which
 * is the entire argument for having the check.
 *
 * So the body rests high enough that the worst pose still clears. Derived from
 * the three limits above at the furthest, lowest point of the vehicle, with 15%
 * over, rather than picked — raise a limit and this rises with it.
 *
 * **It is applied to the chassis, so it is invisible to everything inside the
 * bus.** `CAT_BUS_FLOOR_Y`, `CAT_BUS_SEAT_Y` and `CAT_BUS_CABIN_CEILING_Y` are
 * all in the body's own space and none of them changes; the seats, the driver,
 * the twelve children and the ride's interior camera all move together and none
 * of them can tell. What does change is how far it is down from the step to the
 * pavement, from 0.51 m to 0.78 m — which is the honest consequence of fitting
 * wheels twice the size, and is what a bus with big wheels looks like.
 */
const NOSE_Z = BODY_LENGTH / 2 - FACE_RADIUS * 0.62 + FACE_RADIUS * 0.6;
export const CAT_BUS_RIDE_LIFT =
  (CAT_BUS_MAX_HEAVE + CAT_BUS_MAX_PITCH * NOSE_Z + CAT_BUS_MAX_ROLL * FACE_RADIUS) * 1.15;

/**
 * The gap between a tyre and the mudguard over it, **at rest**.
 *
 * Derived from the travel above rather than picked, and by the worst case a
 * wheel can actually see: full heave, plus the pitch contribution at whichever
 * axle is furthest from the centre, plus the roll contribution at the track.
 * The 1.35 is the margin over that — the bus never quite bottoms out, which is
 * how a suspension is supposed to be set up.
 *
 * The fender rides on the **chassis**, so this gap genuinely opens and closes
 * as the bus bobs. That is what makes the suspension visible from outside at
 * all, and it is what the check measures.
 *
 * The outline shell is added on rather than ignored: `addOutline` pushes a copy
 * of each plate out along its normals, and on a plate's *inner* face "out" is
 * towards the tyre. Left out of the sum it ate a third of the margin, and
 * `check:cat-bus-suspension` duly reported the tightest gap as 0.029 m where
 * the derivation promised 0.071 — a small number, but the derivation being
 * wrong is the interesting part, not the size of the error.
 */
const WORST_BODY_DROP_AT_A_WHEEL =
  CAT_BUS_MAX_HEAVE +
  CAT_BUS_MAX_PITCH * Math.max(...WHEEL_Z.map(Math.abs)) +
  CAT_BUS_MAX_ROLL * WHEEL_X;
export const CAT_BUS_ARCH_GAP =
  WORST_BODY_DROP_AT_A_WHEEL * 1.35 + FENDER_OUTLINE_THICKNESS;

/**
 * The spring itself: stiffness and damping, as a plain second-order system.
 *
 * `sqrt(46)` is 6.8 rad/s — a bob a shade over one cycle a second, which is
 * about what a real bus body does and slow enough for a six-year-old to see it
 * happen. Damping ratio comes out at 0.55: under-damped on purpose, so a bump
 * gives two or three visible oscillations rather than one dead thud.
 *
 * **It is integrated with semi-implicit Euler, which depends on `Loop`'s
 * `MAX_FRAME_DELTA` and should say so.** Explicit integration of a spring this
 * stiff diverges above `dt` of about 0.2 s, where it would flap between the
 * clamps every frame instead of oscillating. That is unreachable only because
 * `Loop` clamps a frame to `MAX_FRAME_DELTA` = 1/12 s, measured stable there
 * (worst heave 0.033 m at 1/12 against 0.032 m at 1/60). The dependency is
 * real and silent: raise `MAX_FRAME_DELTA` past ~0.2 and this breaks with
 * nothing pointing back here, so this sentence is the pointer.
 */
const SPRING_RATE = 46;
const SPRING_DAMPING = 7.4;

/**
 * The road surface, as a height in metres at a distance travelled.
 *
 * **A function of *where the bus is*, not of what time it is** — that one
 * choice is the difference between a suspension and a decoration. A fixed sine
 * on `elapsed` keeps bobbing while the bus stands at the kerb with its door
 * open, which is exactly the "box sliding along" the brief rules out; sampled
 * on distance, the bobbing stops dead when the bus stops, resumes when it pulls
 * away, and gets busier the faster it goes, all for free and all correct.
 *
 * The rear axle samples this one wheelbase behind the front, so **the back of
 * the bus hits the same bump the front just did**, a wheelbase later. That
 * lag is most of what reads as "a real vehicle" rather than "a body on a
 * spring", and it costs one subtraction.
 *
 * ## The wavelengths are measured in wheelbases, and that is the whole trick
 *
 * Because of that lag, **what a bump turns into depends entirely on how it
 * compares with the wheelbase**, and the first cut of this file did not know
 * that. Its three terms were incommensurable numbers picked to avoid a
 * repeat — `0.83`, `1.97`, `4.31` rad/m — and the longest of them happened to
 * land at 7.6 m against a 9.2 m wheelbase, which is very nearly antiphase. So
 * the two axles pushed *against* each other: the difference (pitch) saturated
 * its clamp while the average (heave) very nearly cancelled, and the bus
 * managed 0.0645 m of bob — about 2 px — on a road with 0.11 m of bump in it.
 * The amplitude was not the only thing that was too small: most of what there
 * was was being thrown away.
 *
 * So the terms are derived from {@link WHEELBASE} instead of picked:
 *
 * - a wave **one wheelbase long** puts both axles at the same point on it, so
 *   it is a pure **heave** input — the body lifts and drops flat, which is the
 *   motion Jim actually asked for. At 6 m/s it comes in at 0.65 Hz, a lazy
 *   bounce a six-year-old can watch happen;
 * - a wave **two wheelbases long** puts the axles exactly antiphase, so it is
 *   a pure **pitch** input — the nose and tail see-saw, 0.33 Hz;
 * - a third of a wheelbase adds fine texture, and lands near the spring's own
 *   6.8 rad/s so it reads as the road rather than as the body.
 *
 * They are still mutually irrational once the phases are in, so there is no
 * pattern to learn; they are simply aimed now. Total amplitude 0.245 m: the
 * road through the park is still tarmac, but this is a cartoon.
 */
const HEAVE_WAVE = (Math.PI * 2) / WHEELBASE;
function roadHeightAt(distance: number): number {
  return (
    Math.sin(distance * HEAVE_WAVE) * 0.135 +
    Math.sin(distance * HEAVE_WAVE * 0.5 + 1.7) * 0.075 +
    Math.sin(distance * HEAVE_WAVE * 3 + 3.9) * 0.035
  );
}

/**
 * The top of the bus above its own origin — **ear tips included**, per
 * ART_DIRECTION §7's asset contract, not the roof (which would crop a name
 * label, and here would let a tree stand in front of the cat's ears).
 * `createCatBus` returns exactly this as `CatBusHandle.height`; it is a module
 * constant so that something deciding what may stand in front of the bus can
 * ask before there is a bus to ask.
 */
export const CAT_BUS_TOP =
  CAT_BUS_RIDE_LIFT + BODY_BOTTOM_Y + BODY_HEIGHT + (0.28 + 0.56 / 2) * DETAIL;

/**
 * The doorway, sized by the child who walks down out of it.
 *
 * `TALLEST_CHILD_HEIGHT` again, not `KID_HEIGHT`: a door that decapitates a
 * party hat is the same bug as a ceiling that does.
 */
const DOOR_HEIGHT = TALLEST_CHILD_HEIGHT + 0.2;
const DOOR_WIDTH = SEAT_WIDTH * 1.15;

/** How far the door swings open, in radians, at `doorOpen = 1`. */
const DOOR_SWING = 2.05;

/** One paw print: a palm oval plus three toe dots, proud of whatever it sits on. */
export function buildPawPrint(material: ReturnType<typeof toonMaterial>): Group {
  const group = new Group();
  const palm = decal(new Mesh(new SphereGeometry(0.09, 10, 8), material));
  palm.scale.set(1, 0.85, 0.5);
  group.add(palm);
  for (let i = 0; i < 3; i += 1) {
    const toe = decal(new Mesh(new SphereGeometry(0.045, 8, 7), material));
    const a = (i - 1) * 0.55;
    toe.position.set(Math.sin(a) * 0.11, 0.13 + Math.cos(a) * 0.03, 0);
    toe.scale.setScalar(0.9);
    group.add(toe);
  }
  return group;
}

export interface CatBusHandle {
  readonly root: Group;
  readonly height: number;
  /**
   * **The sprung body** — everything except the wheels and their axles.
   *
   * This is what heaves, pitches and rolls on the suspension, and `cabin` is a
   * child of it, so anything riding inside rides the springs for free.
   *
   * Exposed because **a camera inside the bus has to bob with the bus.** The
   * ride's interior shot places its lens by a fixed point in the vehicle's own
   * space and pushes it through a matrix; through `root`'s matrix it would sit
   * dead still while the cabin around it moved, which reads as the *seats*
   * bouncing rather than the bus — worse than no bob at all, and exactly the
   * "passengers stay rigid" failure the brief warns about, wearing a lens.
   */
  readonly chassis: Group;
  /**
   * Where anyone riding inside is parented — a child of the chassis, so a
   * passenger put in here travels with the bus for free rather than being
   * re-positioned every frame by a formula that has to track it.
   */
  readonly cabin: Group;
  /** Where the driver sits, at the wheel. A child of {@link cabin}. */
  readonly driverSeat: Group;
  /** Where a passenger sits, by the door. One of {@link seats}. */
  readonly passengerSeat: Group;
  /**
   * **The twelve seats**, each an anchor at floor level for one child.
   *
   * Exposed so the arrival can fill them and so a check can count what was
   * actually built rather than trust {@link CAT_BUS_SEAT_COUNT}. Jim asked for
   * "about 12 seats total on the bus" with "children on them too".
   */
  readonly seats: readonly Group[];
  /**
   * Where somebody stepping out of the open door lands, **in the bus's own
   * local space** (`x` across, `z` along, `y` is the ground).
   *
   * Exported because the bus is the only thing that knows where its own door
   * is: `doorGroup`, the step and the doorway are all positioned from
   * `BODY_WIDTH`/`cabinLength` in here, and none of those are exported. A
   * sequence that re-derived the drop point from its own copy of those numbers
   * would be a second definition of "where the door is", kept in step by hand —
   * the repo's most common bug by a distance.
   */
  readonly doorDrop: { readonly x: number; readonly z: number };
  /** 0 = fully shut, 1 = fully open. Tweened by the arrival sequence. */
  setDoorOpen(amount01: number): void;
  /**
   * **Cutaway: drop the lower body's outline shell so a lens inside the cabin
   * can see the cabin.**
   *
   * The cabin below {@link WINDOW_SILL_Y} is one solid `RoundedBoxGeometry`
   * ({@link CAT_BUS_CABIN_CEILING_Y}'s neighbour, `cat-bus-shell-lower`), with
   * the twelve seats, the floor pan and every child's body **inside** it. That
   * is right for the exterior and it is what gives the bus its soft rounded
   * flanks.
   *
   * From *inside*, the block itself is invisible — its material is `FrontSide`,
   * so every face round the lens is back-facing and culled. The one thing that
   * does draw is the outline shell `addOutline` hangs on it: `BackSide`,
   * `MeshBasicMaterial`, unlit. So a camera in the cabin sees a flat lightless
   * box and nothing else, whichever way it points.
   *
   * **That, and not where the camera was aimed, is why the ride's interior shot
   * had no seat, no window, no pillar and no ceiling in it** (QA, 8 August
   * 2026). Proved by hiding this one mesh at runtime and re-shooting the
   * identical pose. Turning it off is a cutaway — exactly what a cross-section
   * drawing of a bus does — and it is the whole of the difference.
   *
   * Only the *ride's* bus is ever asked: `BusJourney` builds its own, and the
   * park's arrival builds another that nobody climbs inside.
   */
  setCutaway(open: boolean): void;
  /**
   * Spins the wheels and drives the suspension bob.
   *
   * Takes no wall-clock time: the only thing that ever wanted it was the
   * tail's idle swish, and the tail is gone (#379). Everything left is driven
   * by *distance travelled* instead, which is why the bus stops bouncing when
   * it stops moving.
   */
  animate(dt: number, speed: number): void;
  dispose(): void;
}

export function createCatBus(): CatBusHandle {
  const root = new Group();
  root.name = 'cat-bus';

  const bodyColour = CAT_BUS_BODY_COLOUR;
  const bodyMaterial = toonMaterial(bodyColour);
  /**
   * **The tiger-striped bodywork.**
   *
   * `0xffffff` rather than `bodyColour`, because `MeshToonMaterial` multiplies
   * its colour by its map and the map already carries the bodywork's own cream
   * as the ground the stripes are painted on. Tinted as well as mapped, the
   * flanks would come out cream-squared — a bus a shade darker than its own
   * door, for no reason anybody would ever find.
   *
   * `bodyMaterial` stays, and stays the same flat cream: the pillars between
   * the panes, which share one geometry between ten posts and so cannot each
   * have their own unwrap, keep it. They read as window frames, and a tiger
   * does not have stripes on its windows.
   */
  const stripedMaterial = toonMaterial(0xffffff, { map: tigerStripeTexture() });
  /**
   * Every mesh that gets stripes, with where its own origin sits on the bus.
   *
   * Collected as they are built and unwrapped in one pass at the end, rather
   * than each unwrapping itself inline, so there is exactly one place that
   * knows the drape's parameters — the spine height and where the flanks give
   * way to the end caps — instead of six call sites each repeating them.
   */
  const striped: { mesh: Mesh; at: { x: number; y: number; z: number } }[] = [];
  const roofColour = CAT_BUS_ROOF_COLOUR;
  const roofMaterial = toonMaterial(roofColour);
  const trimMaterial = toonMaterial(PALETTE.stonePink);
  const earInnerMaterial = toonMaterial(PALETTE.stonePinkLight);
  // **Glazed, not painted.** These were opaque, which was fine while the bus was
  // empty scenery and useless the moment there were twelve children inside it
  // to look at — Jim's Stage B ask is that they are visible through the windows,
  // and you cannot see anybody through a solid panel. Transparent glass with
  // `depthWrite` off (which `toonMaterial` does for us) lets the cabin read
  // through it.
  const windowMaterial = toonMaterial(PALETTE.buildingWindow, {
    emissive: PALETTE.buildingWindow,
    emissiveIntensity: 0.08,
    transparent: true,
    opacity: 0.34,
  });
  const wheelMaterial = toonMaterial(PALETTE.ink);
  const hubMaterial = toonMaterial(PALETTE.markerLemon);
  const pawMaterial = toonMaterial(PALETTE.stonePinkDark);
  const bumperMaterial = toonMaterial(PALETTE.woodLight);

  // **The sprung body.** Everything a passenger can see or sit on hangs off
  // this, including `cabin` and the twelve seats — so when it bobs, the
  // children in it bob with it, without a single line of code re-positioning
  // anybody. A bus that bobs while its passengers stay rigid looks worse than
  // no bob at all, and the cheapest way to make that impossible is for there to
  // be no second thing to keep in step.
  const chassis = new Group();
  chassis.name = 'chassis';
  // At rest before anything animates it, so a bus nobody has called `animate`
  // on — the park's parked one, a check, the character creator's backdrop —
  // still stands at its proper ride height rather than sitting on its axles.
  chassis.position.y = CAT_BUS_RIDE_LIFT;
  root.add(chassis);

  // **The unsprung half**: wheels, hubs and stub axles, which stay on the road
  // while the body moves over them. A sibling of the chassis rather than a
  // child of it, because that is the whole mechanism — a wheel parented to a
  // bobbing body would bob with it, which is a bus hopping rather than a bus on
  // springs, and would put the tyres through the tarmac on every downstroke.
  const axles = new Group();
  axles.name = 'axles';
  root.add(axles);

  // --- main body -------------------------------------------------------------
  // Stops short of the very front — the face sphere below picks up from there —
  // so the join between "boxy body" and "round cat face" reads as one shape
  // rather than a sphere glued onto a box.
  const cabinLength = BODY_LENGTH - FACE_RADIUS * 1.1;
  const bodyCentreZ = BODY_LENGTH / 2 - cabinLength / 2 - FACE_RADIUS * 0.55;
  const cabinBackZ = bodyCentreZ - cabinLength / 2;
  const bodyTopY = BODY_BOTTOM_Y + BODY_HEIGHT;

  /** Where a row of seats sits, and where a window therefore goes. One owner. */
  const rowZ = (row: number): number =>
    cabinBackZ + ROW_END_MARGIN + SEAT_PITCH * (row + 0.5);
  const seatX = (column: number): number => (column === 0 ? -1 : 1) * SEAT_OFFSET_X;

  // The door's z span, needed here because the side wall must not grow a window
  // pillar across the doorway. Derived once and reused by the door below.
  //
  // **Behind the middle, not ahead of it**, and that is a kerb constraint
  // rather than a styling choice. `ArrivalSequence` parks the bus by working
  // back from where its door has to be (dead in front of the gate), so a door
  // ahead of centre puts the bus's *centre* that much further along the kerb in
  // the direction it came from — and the safe run of kerb is not symmetrical,
  // because the park boundary is a spline that bulges towards it on that side
  // (#115). Measured, at this bus's 18.2 m length: a door 4.6 m ahead of centre
  // leaves **2.9 m** of approach before the nose is inside the park; the same
  // door 4.6 m behind centre leaves **11.6 m**. A rear door is also just what a
  // coach has.
  const doorZ = bodyCentreZ - cabinLength * 0.28;

  // --- the shell, built as bands so the windows are real holes ---------------
  // Under the windows: the full-width lower body, floor to sill.
  const lowerBody = solid(
    new Mesh(
      new RoundedBoxGeometry(BODY_WIDTH, WINDOW_SILL_Y - BODY_BOTTOM_Y, cabinLength, 4, 0.22 * DETAIL),
      stripedMaterial,
    ),
  );
  // Named, because a check has to be able to find the cabin's own volume to ask
  // whether the passengers are inside it. Guessing "the biggest opaque mesh"
  // picks the cat's face and reports nonsense — which it duly did, once.
  lowerBody.name = 'cat-bus-shell-lower';
  lowerBody.position.set(0, (BODY_BOTTOM_Y + WINDOW_SILL_Y) / 2, bodyCentreZ);
  chassis.add(lowerBody);
  striped.push({ mesh: lowerBody, at: lowerBody.position });
  // Kept, because this shell is the only part of the lower body a camera inside
  // the cabin can see at all — see `setCutaway`.
  const lowerBodyOutline = addOutline(lowerBody, 0.02 * DETAIL);

  // Over the windows: the header band, window head to roof.
  const upperBody = solid(
    new Mesh(
      new RoundedBoxGeometry(BODY_WIDTH, bodyTopY - WINDOW_HEAD_Y, cabinLength, 4, 0.22 * DETAIL),
      stripedMaterial,
    ),
  );
  upperBody.name = 'cat-bus-shell-upper';
  upperBody.position.set(0, (WINDOW_HEAD_Y + bodyTopY) / 2, bodyCentreZ);
  chassis.add(upperBody);
  striped.push({ mesh: upperBody, at: upperBody.position });
  addOutline(upperBody, 0.02 * DETAIL);

  // The back of the bus is closed — you look in through the sides, not through
  // the whole vehicle and out the far end.
  const windowBandHeight = WINDOW_HEAD_Y - WINDOW_SILL_Y;
  const backWall = solid(
    new Mesh(
      new RoundedBoxGeometry(BODY_WIDTH, windowBandHeight, PILLAR_Z * DETAIL, 3, 0.08 * DETAIL),
      stripedMaterial,
    ),
  );
  backWall.name = 'cat-bus-back-wall';
  backWall.position.set(0, (WINDOW_SILL_Y + WINDOW_HEAD_Y) / 2, cabinBackZ + (PILLAR_Z * DETAIL) / 2);
  chassis.add(backWall);
  striped.push({ mesh: backWall, at: backWall.position });

  // Pillars between one window and the next, at the row boundaries — so the
  // posts land between children rather than across their faces.
  const pillarGeometry = new RoundedBoxGeometry(
    WALL_THICKNESS,
    windowBandHeight,
    PILLAR_Z * DETAIL,
    3,
    0.06 * DETAIL,
  );
  for (const side of [-1, 1] as const) {
    for (let boundary = 1; boundary <= SEAT_ROWS; boundary += 1) {
      const z = cabinBackZ + ROW_END_MARGIN + SEAT_PITCH * boundary;
      // The doorway is an opening too: no post may stand in it.
      if (side < 0 && Math.abs(z - doorZ) < SEAT_PITCH * 0.6) continue;
      const pillar = solid(new Mesh(pillarGeometry, bodyMaterial));
      pillar.name = 'cat-bus-pillar';
      pillar.position.set(side * (BODY_WIDTH / 2 - WALL_THICKNESS / 2), (WINDOW_SILL_Y + WINDOW_HEAD_Y) / 2, z);
      chassis.add(pillar);
    }
  }

  // A dark cabin floor, so looking in through a window lands on something.
  //
  // Built from `FLOOR_PAN_THICKNESS`, and its top therefore lands exactly on
  // `CAT_BUS_FLOOR_Y` by construction rather than by two numbers agreeing. That
  // is the whole of the "clipped through the floor" fix: this pan and the
  // constant everything stands on can no longer disagree, because one is
  // written in terms of the other.
  const floorPan = solid(
    new Mesh(
      new RoundedBoxGeometry(
        BODY_WIDTH - WALL_THICKNESS,
        FLOOR_PAN_THICKNESS,
        cabinLength - WALL_THICKNESS,
        2,
        0.05 * DETAIL,
      ),
      toonMaterial(new Color(PALETTE.woodLight).multiplyScalar(0.8).getHex()),
    ),
  );
  floorPan.name = 'cat-bus-floor-pan';
  floorPan.position.set(0, CAT_BUS_FLOOR_Y - FLOOR_PAN_THICKNESS / 2, bodyCentreZ);
  chassis.add(floorPan);

  /** Kept for the handful of places below that positioned off the old body. */
  const body = { position: { z: bodyCentreZ } };

  // A rounded roof cap, so the bus doesn't read as a single flat-topped box —
  // every shop and ride in this park gets a bobble or a cap on top.
  //
  // **Striped, and it is the single most important surface to stripe.** It was
  // left in the roof's own pale lemon at first, on the reasoning that a paler
  // cap breaks up the silhouette. That reasoning is from a side elevation
  // again: from the game's isometric camera, looking *down* at the bus, the
  // roof is the **largest surface on the vehicle by a wide margin**, so a
  // striped body under an unstriped roof read as a cream loaf with a striped
  // skirt rather than as a tiger. The ears keep `roofMaterial`.
  //
  // It costs one `striped.push`, because the drape unwrap already covers it:
  // `v` is `|x| + max(0, spineY - y)`, and the roof stands above `spineY`, so
  // its own `v` is just `|x|` — continuous with the flank it meets at the eaves,
  // with no seam and no second parameter to keep in step.
  const roof = solid(
    new Mesh(new RoundedBoxGeometry(BODY_WIDTH * 0.94, 0.34 * DETAIL, cabinLength * 0.92, 4, 0.16 * DETAIL), stripedMaterial),
  );
  roof.name = 'cat-bus-roof';
  roof.position.set(0, BODY_BOTTOM_Y + BODY_HEIGHT + 0.05 * DETAIL, body.position.z);
  chassis.add(roof);
  striped.push({ mesh: roof, at: roof.position });
  addOutline(roof, 0.016 * DETAIL);

  // --- the face ---------------------------------------------------------------
  // A big squashed sphere at the front, flattened toward the windscreen — the
  // same "nose" trick `dodgems/car.ts` uses, just scaled up to be the whole
  // front of the bus.
  const faceZ = BODY_LENGTH / 2 - FACE_RADIUS * 0.62;
  const faceY = BODY_BOTTOM_Y + BODY_HEIGHT * 0.62;
  // 38 segments, matching the kid's own skull (`kid.ts`), because this sphere is
  // now the surface the face is *printed on* rather than a blank the face hangs
  // in front of — the UV remap below is exact at every vertex, so how finely the
  // sphere is divided is how finely the eyes are drawn.
  const faceSphere = blob(FACE_RADIUS, bodyMaterial, [1, 0.92, 0.6], 38);
  faceSphere.name = 'cat-bus-face';
  faceSphere.position.set(0, faceY, faceZ);
  chassis.add(faceSphere);
  // Before the bake, so the outline takes its tint from the bodywork's own
  // colour rather than from the white the baked material carries.
  addOutline(faceSphere, 0.02 * DETAIL);

  // **The face is painted into the head's own UV map. There is no second mesh.**
  //
  // It used to be a `facePatchGeometry` decal at `FACE_RADIUS * 1.02`, parked at
  // the face sphere's position — but the face sphere is *squashed*, `[1, 0.92,
  // 0.6]`, and the patch was not. So the patch's nose stood at z = r·1.02 while
  // the head it belonged to stopped at z = r·0.6, and the measurement is not
  // marginal: **the cat's face floated 1.13 m in front of the bus**, in clear
  // air, which is what Jim watched on 7 August 2026 — *"the face of the cat
  // projects off its head and floats in space"*.
  //
  // Padding the stand-off could not have fixed it and neither could shrinking
  // it: the patch is a sphere and the head is an ellipsoid, so no single radius
  // makes them touch anywhere but the axis. That is precisely the trap CLAUDE.md
  // records from RiPika's hood — a second surface positioned by a formula that
  // has to track the first one's, which had itself been squashed underneath it.
  //
  // Baked, the face inherits the squash for free: one surface, one texture, and
  // no distance to get wrong. Whiskers go into the same canvas as an `over`
  // layer for the same reason.
  const faceMaterial = applyStaticBakedFace(
    faceSphere,
    { fill: bodyColour, ...CAT_BUS_FACE_PAINT, spreadX: 2.0, spreadY: 1.7, tilt: 0.08 },
    {
      // Both painted into the one canvas: the whiskers below the eyes, the
      // destination board above them. Neither is a mesh.
      over: (ctx, size) => {
        paintWhiskers(ctx, size);
        paintDestinationBoard(ctx, size);
      },
    },
  );
  const faceTexture = faceMaterial.map;

  // --- ears --------------------------------------------------------------------
  // Triangular, on the roof, leaning outward a touch — "nothing is plumb".
  const earGeometry = new ConeGeometry(0.34 * DETAIL, 0.56 * DETAIL, 4);
  const earInnerGeometry = new ConeGeometry(0.18 * DETAIL, 0.32 * DETAIL, 4);
  for (const side of [-1, 1] as const) {
    const ear = solid(new Mesh(earGeometry, roofMaterial));
    ear.position.set(side * BODY_WIDTH * 0.3, BODY_BOTTOM_Y + BODY_HEIGHT + 0.28 * DETAIL, faceZ - 0.35 * DETAIL);
    ear.rotation.z = side * -0.22;
    ear.rotation.y = Math.PI / 4;
    chassis.add(ear);
    addOutline(ear, 0.016 * DETAIL);

    const innerEar = decal(new Mesh(earInnerGeometry, earInnerMaterial));
    innerEar.position.set(0, 0.03 * DETAIL, 0.06 * DETAIL);
    innerEar.rotation.copy(ear.rotation);
    innerEar.scale.set(0.92, 0.8, 0.92);
    ear.add(innerEar);
  }

  // --- windows -------------------------------------------------------------
  // **One window per row of seats, derived from where the rows actually are.**
  // A window count and a seat count that agreed by hand would be two
  // definitions of the same thing; `rowZ` is the only one, so a window cannot
  // end up between two rows however the seat plan changes.
  // Glass that fills the openings the shell above left, rather than a pane
  // stuck on the outside of a solid wall. One per row, sized to the gap between
  // its pillars, so a child sitting in that row is framed by it.
  const glassGeometry = new RoundedBoxGeometry(
    0.05 * DETAIL,
    (WINDOW_HEAD_Y - WINDOW_SILL_Y) * 0.98,
    SEAT_PITCH - PILLAR_Z * DETAIL,
    3,
    0.05 * DETAIL,
  );
  for (const side of [-1, 1] as const) {
    for (let row = 0; row < SEAT_ROWS; row += 1) {
      const z = rowZ(row);
      // No glass across the doorway — that opening is a door, not a window.
      if (side < 0 && Math.abs(z - doorZ) < SEAT_PITCH * 0.6) continue;
      const win = decal(new Mesh(glassGeometry, windowMaterial));
      win.name = 'cat-bus-window';
      win.position.set(side * (BODY_WIDTH / 2 - WALL_THICKNESS / 2), (WINDOW_SILL_Y + WINDOW_HEAD_Y) / 2, z);
      chassis.add(win);
    }
  }

  // --- the seats ---------------------------------------------------------
  // Twelve of them, six rows of two either side of the aisle, because Jim asked
  // for "about 12 seats total" and for children to be sitting on them. Each
  // cushion gets an anchor group **on top of it**, at `CAT_BUS_SEAT_Y` — see
  // there for why that, and not the floor, is where a child's origin goes.
  const seatPadGeometry = new RoundedBoxGeometry(
    SEAT_WIDTH * 0.86,
    SEAT_PAD_HEIGHT,
    SEAT_PITCH * 0.62,
    3,
    0.08 * DETAIL,
  );
  // **The back stops at the window sill.** Derived rather than a multiple of the
  // cushion, so that a seat back can never stand up inside a pane of glass
  // however the sill moves — and so it reaches a seated child's shoulders,
  // which is what a bus seat does and what the old `SEAT_PAD_HEIGHT * 1.5`
  // (0.45 m, ending below her lap) did not.
  const seatBackHeight = WINDOW_SILL_Y - CAT_BUS_SEAT_Y;
  const seatBackGeometry = new RoundedBoxGeometry(
    SEAT_WIDTH * 0.86,
    seatBackHeight,
    0.12 * DETAIL,
    3,
    0.06 * DETAIL,
  );
  const seatMaterial = toonMaterial(PALETTE.stonePink);
  const seats: Group[] = [];
  for (let row = 0; row < SEAT_ROWS; row += 1) {
    for (let column = 0; column < SEATS_PER_ROW; column += 1) {
      const x = seatX(column);
      const z = rowZ(row);

      // The cushion stands on the floor, so its top is `CAT_BUS_SEAT_Y`.
      const pad = solid(new Mesh(seatPadGeometry, seatMaterial));
      pad.name = 'cat-bus-cushion';
      pad.position.set(x, CAT_BUS_FLOOR_Y + SEAT_PAD_HEIGHT / 2, z);
      chassis.add(pad);

      const back = solid(new Mesh(seatBackGeometry, seatMaterial));
      back.name = 'cat-bus-backrest';
      back.position.set(x, CAT_BUS_SEAT_Y + seatBackHeight / 2, z - SEAT_PITCH * 0.3);
      chassis.add(back);

      // Where a child goes: **on the cushion**, facing the front of the bus.
      const seat = new Group();
      seat.name = `cat-bus-seat-${seats.length}`;
      seat.position.set(x, CAT_BUS_SEAT_Y, z);
      chassis.add(seat);
      seats.push(seat);
    }
  }

  // --- door --------------------------------------------------------------------
  // A single hinged panel on the left (-X, local) side, swinging open like a
  // friendly little flap. The hinge sits at its front edge.
  const doorGroup = new Group();
  doorGroup.name = 'door-hinge';
  doorGroup.position.set(-(BODY_WIDTH / 2), BODY_BOTTOM_Y, doorZ);
  chassis.add(doorGroup);

  const doorPanel = solid(
    new Mesh(new RoundedBoxGeometry(0.06 * DETAIL, DOOR_HEIGHT, DOOR_WIDTH, 2, 0.08 * DETAIL), stripedMaterial),
  );
  doorPanel.name = 'cat-bus-door-panel';
  doorPanel.position.set(0, DOOR_HEIGHT / 2, DOOR_WIDTH / 2);
  doorGroup.add(doorPanel);
  // Unwrapped in the pose it holds when **shut** — `doorGroup` is a hinge, so
  // the panel's own origin moves as it swings, and stripes that were a function
  // of where the door currently is would slide about as it opened. Shut is the
  // pose they have to line up with the flank in.
  striped.push({
    mesh: doorPanel,
    at: {
      x: doorGroup.position.x + doorPanel.position.x,
      y: doorGroup.position.y + doorPanel.position.y,
      z: doorGroup.position.z + doorPanel.position.z,
    },
  });
  addOutline(doorPanel, 0.014 * DETAIL);

  // **The door's window is in the same band as every other window**, and it was
  // not: it was `DOOR_HEIGHT * 0.42` tall at `DOOR_HEIGHT * 0.68`, a fraction of
  // the door rather than a part of the glazing. On the bus Jim complained about,
  // the side windows started at 1.17 m and this one at 2.11 — **0.94 m out of
  // step**, so the door had a letterbox up by the roof while the flanks were
  // glazed to the floor.
  //
  // They happened to come within 12 mm of each other once the sill moved to the
  // shoulder line, which is the dangerous kind of agreement: it made this look
  // correct while still being a second, independent definition of where a window
  // starts. It was found by mutation — raising the sill 0.7 m moved the flank
  // glass and left this behind, and the guard went on reading *this* as the
  // lowest glass on the bus and passing.
  //
  // Derived from the band now, in the door's own frame (the hinge sits at
  // `BODY_BOTTOM_Y`), so the glazing runs continuously round the vehicle and
  // there is one answer to "where do the windows start".
  const doorWindowHeight = WINDOW_HEAD_Y - WINDOW_SILL_Y;
  const doorWindow = decal(
    new Mesh(
      new RoundedBoxGeometry(0.04 * DETAIL, doorWindowHeight, DOOR_WIDTH * 0.7, 2, 0.06 * DETAIL),
      windowMaterial,
    ),
  );
  doorWindow.position.set(
    0.02,
    (WINDOW_SILL_Y + WINDOW_HEAD_Y) / 2 - BODY_BOTTOM_Y,
    DOOR_WIDTH / 2,
  );
  doorGroup.add(doorWindow);

  // A dark opening **behind** the door, so swinging it away reveals a doorway
  // instead of a hole showing the sky through the cabin.
  //
  // **It used to be in front of it.** The x was `doorGroup.position.x - 0.12 *
  // DETAIL` — 0.26 m *further out* than the door hinge, on a slab 1.09 m thick
  // — so the closed door was buried inside a black box standing proud of the
  // bodywork, and the bus had a featureless dark rectangle stuck to its flank
  // whenever it was shut. Nobody had seen it because the park's camera is
  // fixed and never looks at that side; the cat bus's journey orbits the bus,
  // so it is on screen for a third of the ride.
  //
  // Half its own thickness *inwards* from the hinge puts it flush inside the
  // wall, which is where "behind the door" always meant.
  //
  // And it is **`WALL_THICKNESS` deep, not `0.5 * DETAIL` (1.09 m)**, which is
  // the second half of the same fix and was caught by `check:cat-bus` rather
  // than by reading: a slab that thick, moved inboard, reaches a third of the
  // way across the cabin and stands behind the two door-side windows — that
  // check probes 0.45 m in from every pane and duly reported *"2 of 12 cat bus
  // windows have solid bodywork immediately behind the glass"*. Filling the
  // aperture in the wall is all this ever needed to do, so the wall's own
  // thickness is what it is.
  const doorway = decal(
    new Mesh(
      new RoundedBoxGeometry(WALL_THICKNESS, DOOR_HEIGHT, DOOR_WIDTH, 2, 0.05 * DETAIL),
      toonMaterial(new Color(PALETTE.ink).multiplyScalar(0.7).getHex()),
    ),
  );
  doorway.position.set(
    doorGroup.position.x + WALL_THICKNESS / 2,
    BODY_BOTTOM_Y + DOOR_HEIGHT / 2,
    doorGroup.position.z + DOOR_WIDTH / 2,
  );
  chassis.add(doorway);

  // A friendly step, always visible, so hopping down reads clearly.
  //
  // **Hung from the body's underside** rather than floated at `BODY_BOTTOM_Y / 2`,
  // which left it 0.20 m clear of the bus in mid-air. Same fault as the rear
  // bumper and found the same way — by measuring every part against the
  // bodywork instead of looking at it from the front — and small enough that
  // nobody had ever noticed, which is why it is worth fixing now that there is
  // a check that would have to be loosened to let it pass.
  // **Two treads, because the bob is what sets how high the top one is.**
  //
  // The sprung body rests `CAT_BUS_RIDE_LIFT` up so its chin clears the road at
  // the bottom of a bump, and raising the bob until it reads on screen raised
  // that lift with it — from 0.28 m to 0.64 m, which put the single tread this
  // used to be 1.26 m above the pavement. That is a drop of 59% of a 2.12 m
  // child's height off the last step of a bus, which is not a step, it is a
  // fall.
  //
  // So a second tread hangs below the first, and **how low it may hang is
  // derived rather than picked**: the body can drop by heave, plus pitch at
  // this z, plus roll at this x, and the tread has to still be above the road
  // at the bottom of all three at once. Derived that way it tracks the clamps —
  // raise the bob again and the lower tread rises out of its way by itself,
  // rather than becoming a plough that `check:cat-bus-suspension` §5 catches
  // only after somebody wonders why the bus is grounding.
  //
  // The *top* tread does not move: it is still hung from the body's underside
  // at `BODY_BOTTOM_Y`, so the floor, the doorway, the sill and every boarding
  // measurement are exactly as they were.
  const stepHeight = 0.1 * DETAIL;
  const stepWidth = 0.5 * DETAIL;
  const stepDepth = DOOR_WIDTH * 0.8;
  const stepX = -(BODY_WIDTH / 2 + 0.16 * DETAIL);
  const stepZ = doorGroup.position.z + DOOR_WIDTH / 2;
  /** How far the road stays clear of the lowest tread at full deflection. */
  const STEP_ROAD_CLEARANCE = 0.06;
  // **At the tread's furthest corner, not at its centre.** Pitch and roll are
  // rotations, so what they cost grows with the lever arm — and the corner of a
  // 1.10 m by 1.66 m slab is 0.55 m further out in x and 0.83 m further along
  // in z than the point it is positioned by. Derived from the centre this came
  // out 0.05 m optimistic and the check duly reported the bodywork reaching
  // y=0.010 where 0.06 was intended: not a failure, but the derivation being
  // wrong is the interesting part, exactly as it was for the arch gap.
  const worstDropAtDoor =
    CAT_BUS_MAX_HEAVE +
    CAT_BUS_MAX_PITCH * (Math.abs(stepZ) + stepDepth / 2) +
    CAT_BUS_MAX_ROLL * (Math.abs(stepX) + stepWidth / 2);
  const lowestTreadUnderside =
    STEP_ROAD_CLEARANCE + worstDropAtDoor - CAT_BUS_RIDE_LIFT;
  const stepGeometry = new RoundedBoxGeometry(
    stepWidth,
    stepHeight,
    stepDepth,
    2,
    0.04 * DETAIL,
  );
  // One group, because the treads and the stringer that carries them are one
  // thing — and because `check:bus-journey` asks whether every top-level part
  // of the bus touches the bodywork, which is the question it should ask.
  const stepGroup = new Group();
  stepGroup.name = 'cat-bus-step';
  chassis.add(stepGroup);
  function addTread(treadTop: number): Mesh {
    const tread = solid(new Mesh(stepGeometry, bumperMaterial));
    tread.name = 'cat-bus-step-tread';
    tread.position.set(stepX, treadTop - stepHeight / 2, stepZ);
    stepGroup.add(tread);
    return tread;
  }
  // The upper tread is the one everything below positions off — it is the one
  // that has always been "the step".
  const step = addTread(BODY_BOTTOM_Y);
  addTread(lowestTreadUnderside + stepHeight);

  // **The stringer, and `check:bus-journey` is why it exists.** The lower tread
  // hangs below the bodywork's own lowest point, so on its own it is a slab of
  // timber floating 0.04 m under the bus attached to nothing — which is exactly
  // the *"strange block floating off the back of it"* Jim reported about the
  // rear bumper, and the check that was written for that duly caught this one
  // before anybody saw it.
  //
  // A grouped part would have satisfied the box test on the upper tread's
  // behalf, and that would have been gaming it: the lower tread would still
  // have been drawn hanging in mid-air. So there is a real panel joining the
  // treads to the body's underside, the way a bus's step well actually is.
  const riserHeight = BODY_BOTTOM_Y - lowestTreadUnderside;
  const riser = solid(
    new Mesh(
      new RoundedBoxGeometry(stepWidth, riserHeight, 0.16 * DETAIL, 2, 0.03 * DETAIL),
      bumperMaterial,
    ),
  );
  riser.position.set(stepX, lowestTreadUnderside + riserHeight / 2, stepZ - stepDepth / 2 + 0.08 * DETAIL);
  stepGroup.add(riser);

  // --- bumpers ---------------------------------------------------------------
  // **`cabinBackZ`, not `-BODY_LENGTH / 2`** — and that difference is Jim's
  // *"strange block floating off the back of it"*, found on 7 August 2026.
  //
  // It is this bumper. `BODY_LENGTH` is a length *budget*: the bodywork is drawn
  // as `cabinLength` centred on `bodyCentreZ`, which is pulled 1.51 m forward of
  // the budget's midpoint so the boxy body sinks into the round cat face instead
  // of being a sphere glued to a box. That reshaping moved the back of the bus
  // forward by the same 1.51 m — and this bumper, which had been written against
  // the budget, stayed where it was. It ended up a 5.2 x 0.65 x 0.48 m slab
  // hanging in clear air **1.05 m behind the vehicle**, which is exactly what it
  // looks like.
  //
  // Nothing warned, because nothing measured: it is invisible from the three-
  // quarter front angle every check and every screenshot of this feature has
  // used, and `CAT_BUS_LENGTH` kept reporting the budget, so the bumper was
  // inside the size the bus claimed to be the whole time.
  //
  // The cure is to ask the bodywork where it ends rather than to keep a second
  // opinion about it — the same one-owner rule the rest of this file runs on.
  const rearBumper = solid(
    new Mesh(new RoundedBoxGeometry(BODY_WIDTH * 0.98, 0.3 * DETAIL, 0.22 * DETAIL, 3, 0.08 * DETAIL), bumperMaterial),
  );
  rearBumper.position.set(0, BODY_BOTTOM_Y + 0.05 * DETAIL, cabinBackZ + 0.08 * DETAIL);
  chassis.add(rearBumper);

  // --- paw-print livery --------------------------------------------------------
  for (const side of [-1, 1] as const) {
    for (let i = 0; i < 3; i += 1) {
      const paw = buildPawPrint(pawMaterial);
      paw.position.set(
        side * (BODY_WIDTH / 2 + 0.005),
        BODY_BOTTOM_Y + BODY_HEIGHT * 0.34,
        body.position.z - cabinLength * 0.3 + i * 0.85 * DETAIL,
      );
      paw.rotation.y = side > 0 ? Math.PI / 2 : -Math.PI / 2;
      paw.scale.setScalar(DETAIL);
      chassis.add(paw);
    }
  }

  // --- wheels, on their own axles ------------------------------------------
  // Twice the radius they were drawn at (`CAT_BUS_WHEEL_SCALE`), standing
  // outboard of every part of the bodywork (`WHEEL_X`), on a group that does
  // **not** bob. Three parts to each corner, and each is there for a reason:
  //
  //  - the tyre and its hub, on `axles`, planted on the road;
  //  - a **stub axle** reaching in under the flank, also on `axles`, so a wheel
  //    held off at arm's length is visibly held by something rather than
  //    floating beside the bus;
  //  - a **mudguard** over the top, on the `chassis`, so the gap between it and
  //    the tyre opens and closes as the body moves. That gap is the suspension,
  //    seen from outside, and it is what `check:cat-bus-suspension` measures.
  const wheelGeometry = new CylinderGeometry(WHEEL_RADIUS, WHEEL_RADIUS, WHEEL_WIDTH, 18);
  const hubGeometry = new CylinderGeometry(
    WHEEL_RADIUS * 0.42,
    WHEEL_RADIUS * 0.42,
    WHEEL_WIDTH * 1.06,
    12,
  );
  // Reaches from the wheel's centre plane inboard to well under the bodywork,
  // so whichever way you look at the bus it disappears into the flank rather
  // than stopping in mid-air.
  const stubLength = WHEEL_X - BODY_WIDTH / 2 + WALL_THICKNESS;
  const stubGeometry = new CylinderGeometry(WHEEL_RADIUS * 0.16, WHEEL_RADIUS * 0.16, stubLength, 8);
  // The mudguard: one swept arc whose **inner surface sits at exactly
  // `WHEEL_RADIUS + CAT_BUS_ARCH_GAP` all the way round** — see `FENDER_ARC`
  // for why this is neither the torus nor the row of plates it has been.
  //
  // Drawn as a flat annular sector in the shape's own xy plane and extruded
  // along its z, then turned a quarter turn about y so that the extrusion runs
  // along the wheel's axle and the sector stands up in the bus's yz plane.
  const fenderInnerRadius = WHEEL_RADIUS + CAT_BUS_ARCH_GAP;
  const fenderOuterRadius = fenderInnerRadius + FENDER_THICKNESS;
  const fenderArcFrom = Math.PI / 2 - FENDER_ARC / 2;
  const fenderArcTo = Math.PI / 2 + FENDER_ARC / 2;
  const fenderSection = new Shape();
  fenderSection.moveTo(
    Math.cos(fenderArcFrom) * fenderInnerRadius,
    Math.sin(fenderArcFrom) * fenderInnerRadius,
  );
  fenderSection.absarc(0, 0, fenderInnerRadius, fenderArcFrom, fenderArcTo, false);
  fenderSection.absarc(0, 0, fenderOuterRadius, fenderArcTo, fenderArcFrom, true);
  fenderSection.closePath();
  const fenderGeometry = new ExtrudeGeometry(fenderSection, {
    depth: FENDER_HALF_WIDTH * 2,
    bevelEnabled: false,
    curveSegments: FENDER_ARC_SEGMENTS,
  });
  // Extrusion runs 0..depth, so it is centred here rather than at every corner.
  fenderGeometry.translate(0, 0, -FENDER_HALF_WIDTH);
  const wheels: Mesh[] = [];
  for (const side of [-1, 1] as const) {
    for (const z of WHEEL_Z) {
      const x = side * WHEEL_X;

      const wheel = solid(new Mesh(wheelGeometry, wheelMaterial));
      wheel.name = 'cat-bus-wheel';
      wheel.rotation.z = Math.PI / 2;
      wheel.position.set(x, WHEEL_RADIUS, z);
      axles.add(wheel);
      wheels.push(wheel);

      const hub = decal(new Mesh(hubGeometry, hubMaterial));
      hub.name = 'cat-bus-hub';
      hub.rotation.z = Math.PI / 2;
      hub.position.copy(wheel.position);
      axles.add(hub);

      const stub = solid(new Mesh(stubGeometry, bumperMaterial));
      stub.rotation.z = Math.PI / 2;
      stub.position.set(x - side * stubLength / 2, WHEEL_RADIUS, z);
      axles.add(stub);

      // A group at the wheel's centre, so the arch is placed by the wheel it
      // guards rather than by its own coordinates.
      const fender = new Group();
      fender.name = 'cat-bus-fender';
      // **`- CAT_BUS_RIDE_LIFT`, and leaving it out was a real bug.** The
      // wheels hang off `axles`, which sits on the road; the fender hangs off
      // `chassis`, which rests `CAT_BUS_RIDE_LIFT` higher up. Placed at plain
      // `WHEEL_RADIUS` in the chassis's own space it therefore came out that
      // much *above* the wheel it guards — 0.64 m of daylight at rest, an arch
      // floating level with the windows rather than sitting over a tyre, which
      // is its own contribution to the fender not reading as a mudguard.
      //
      // Invisible in the source because both numbers are called the wheel's
      // radius and only one of them is in the wheel's frame. Found by the
      // clearance check reporting a tightest gap *larger* than the arch gap it
      // was built with, which is not a thing a correct arch can do.
      fender.position.set(x, WHEEL_RADIUS - CAT_BUS_RIDE_LIFT, z);
      chassis.add(fender);
      // The bumper's timber colour, matching the stub axle it shares a corner
      // with — reads as chassis furniture rather than as bodywork, which the
      // roof's pale lemon made it look like.
      const arch = solid(new Mesh(fenderGeometry, bumperMaterial));
      arch.rotation.y = Math.PI / 2;
      fender.add(arch);
      // One outline for the whole arch. Eight plates meant eight outlines, and
      // from above they read as eight lines ruled across a plank stack.
      addOutline(arch, FENDER_OUTLINE_THICKNESS);
    }
  }

  // --- who is riding inside ---------------------------------------------------
  // A child of the chassis, so anybody seated in here travels with the bus and
  // nothing has to re-position them every frame.
  const cabin = new Group();
  cabin.name = 'cabin';
  chassis.add(cabin);

  // At the wheel: front of the cabin, on the far side from the door so the
  // driver is not standing in the doorway everyone is climbing out of.
  //
  // **On a cushion at `CAT_BUS_SEAT_Y`, like everybody else.** Jim's complaint
  // named the children, but the driver was seated by the very same mechanism
  // and so was 0.17 m under the floor too — he simply never gets a close-up. He
  // had no cushion drawn under him at all, which is the tell for how little
  // anybody had looked at him: he was a child standing at the front of a bus.
  const driverZ = body.position.z + cabinLength / 2 - DRIVER_AREA_LENGTH * 0.5;
  const driverPad = solid(new Mesh(seatPadGeometry, seatMaterial));
  driverPad.position.set(-seatX(0), CAT_BUS_FLOOR_Y + SEAT_PAD_HEIGHT / 2, driverZ);
  chassis.add(driverPad);

  const driverSeat = new Group();
  driverSeat.name = 'driver-seat';
  driverSeat.position.set(-seatX(0), CAT_BUS_SEAT_Y, driverZ);
  cabin.add(driverSeat);

  // **The player's seat is one of the twelve, not a thirteenth.** Picked as the
  // real seat nearest the door on the door's own side, by measuring the seats
  // that were built — so she is sitting somewhere a child could sit, and
  // "twelve seats, all occupied" stays true with her in one of them.
  const doorSideX = seatX(0);
  let passengerSeat = seats[0] as Group;
  let bestGap = Infinity;
  for (const seat of seats) {
    if (Math.sign(seat.position.x) !== Math.sign(doorSideX)) continue;
    const gap = Math.abs(seat.position.z - doorGroup.position.z);
    if (gap < bestGap) {
      bestGap = gap;
      passengerSeat = seat;
    }
  }

  // --- tiger stripes ---------------------------------------------------------
  // **One pass, one owner of the drape's parameters.** Every striped mesh's UVs
  // are rewritten from where its vertices sit on the *vehicle*, so a stripe is
  // the same width in metres on the header band as on the door as on the flank,
  // and the pattern runs unbroken across three separate meshes. See
  // `tigerStripes.ts` for the unwrap and for why this is a texture rather than
  // thirty applied shells.
  //
  // Deliberately after every `addOutline` above: `outlineGeometry` welds
  // vertices, and welding takes UVs into account, so re-mapping first would
  // quietly change which vertices merge and therefore the normals the outline
  // is extruded along.
  for (const { mesh, at } of striped) {
    drapeStripeUvs(mesh, at, bodyTopY, cabinBackZ, cabinBackZ + cabinLength);
  }

  // --- height ----------------------------------------------------------------
  // Measured to the **actual top**, ear tips included, per ART_DIRECTION §7's
  // asset contract — not to the roof, which would crop a name label. One
  // definition, at module scope, because the arrival's sightline keep-out needs
  // the same number before any bus exists.
  const height = CAT_BUS_TOP;

  // Straight out from the step, clear of the sill. Derived from the step's own
  // position rather than restated, so moving the door moves this with it.
  const doorDrop = {
    x: step.position.x - 0.77 * DETAIL,
    z: step.position.z,
  } as const;

  let doorOpenAmount = 0;
  let wheelSpin = 0;

  // --- suspension state -------------------------------------------------------
  /** How far the bus has driven, in metres. The clock the road is sampled on. */
  let distanceTravelled = 0;
  /** Body height above rest at each axle, and how fast it is moving. */
  let frontOffset = 0;
  let frontVelocity = 0;
  let rearOffset = 0;
  let rearVelocity = 0;
  /** Smoothed longitudinal and lateral accelerations, m/s^2. */
  let smoothedAlong = 0;
  let smoothedAcross = 0;
  let lastSpeed = 0;
  let lastYaw = root.rotation.y;

  return {
    root,
    height,
    chassis,
    cabin,
    driverSeat,
    passengerSeat,
    seats,
    doorDrop,

    setDoorOpen(amount01: number): void {
      doorOpenAmount = clamp01(amount01);
      doorGroup.rotation.y = -DOOR_SWING * doorOpenAmount;
    },

    setCutaway(open: boolean): void {
      lowerBodyOutline.visible = !open;
    },

    animate(dt: number, speed: number): void {
      // **Rolling, not spinning at a rate somebody liked the look of.** The
      // wheel covers `speed * dt` metres of road, so it turns through exactly
      // that over its own radius. The old `* 3.1` was a factor tuned by eye
      // against a 0.53 m wheel; left alone, a 1.07 m wheel would have gone
      // round twice as fast as the road beneath it and the bus would have read
      // as permanently skidding.
      wheelSpin += (speed * dt) / WHEEL_RADIUS;
      for (const wheel of wheels) wheel.rotation.x = wheelSpin;

      // --- the suspension -----------------------------------------------------
      //
      // Two corner springs — one per axle — driven by the road under that axle,
      // plus the load that gets thrown forward, back and sideways as the bus
      // drives. Heave and pitch fall out of the two of them; roll is its own
      // term because there is no third spring to derive it from.
      const step = Math.max(dt, 1e-4);
      distanceTravelled += Math.abs(speed) * dt;

      // How hard the bus is accelerating or braking, smoothed hard. The callers
      // hand over a *measured* speed (`ArrivalSequence` divides a distance by a
      // timeline, `BusJourney` passes a constant), so the raw difference is
      // spiky and a spike straight into a spring is a visible twitch.
      const rawAlong = (speed - lastSpeed) / step;
      lastSpeed = speed;
      const smoothing = clamp01(step * 6);
      smoothedAlong = lerp(smoothedAlong, rawAlong, smoothing);

      // Cornering, read off the bus's own heading rather than asked for. Yaw
      // rate times speed is the lateral acceleration a passenger feels, which
      // is the thing that leans a body — a bus leans hard round a tight corner
      // at 5 m/s and not at all doing the same corner stationary, and this gets
      // that right without anybody passing a steering angle in.
      // `angleDelta` rather than a subtraction, because both callers can step
      // the heading across the +/-PI seam — `BusJourney` sets it with `lookAt`,
      // which writes a quaternion and lets the Euler come out wherever it comes
      // out — and a 2*PI jump straight into a spring is a lurch.
      const yawDelta = angleDelta(lastYaw, root.rotation.y);
      lastYaw = root.rotation.y;
      const rawAcross = (yawDelta / step) * speed;
      smoothedAcross = lerp(smoothedAcross, rawAcross, smoothing);

      // Where each axle's spring is being pushed to: the road under it, plus
      // load transfer. Accelerating squats the tail and lifts the nose; braking
      // does the opposite. `LOAD_TRANSFER` is in metres per m/s^2.
      const LOAD_TRANSFER = 0.02;
      const frontTarget =
        roadHeightAt(distanceTravelled) - smoothedAlong * LOAD_TRANSFER;
      const rearTarget =
        roadHeightAt(distanceTravelled - WHEELBASE) + smoothedAlong * LOAD_TRANSFER;

      frontVelocity += (SPRING_RATE * (frontTarget - frontOffset) - SPRING_DAMPING * frontVelocity) * dt;
      rearVelocity += (SPRING_RATE * (rearTarget - rearOffset) - SPRING_DAMPING * rearVelocity) * dt;
      frontOffset += frontVelocity * dt;
      rearOffset += rearVelocity * dt;

      // **Clamped, and the clamp is load-bearing.** `CAT_BUS_ARCH_GAP` is
      // derived from these three limits, so a body that could exceed them would
      // drive a mudguard down onto a tyre. A spring integrated frame by frame
      // can overshoot — a long frame, a step change in speed — and "it usually
      // does not" is not a mechanism.
      const heave = clamp((frontOffset + rearOffset) / 2, -CAT_BUS_MAX_HEAVE, CAT_BUS_MAX_HEAVE);
      // Nose-up is positive, so it is front minus rear.
      const pitch = clamp(
        (frontOffset - rearOffset) / WHEELBASE,
        -CAT_BUS_MAX_PITCH,
        CAT_BUS_MAX_PITCH,
      );
      const roll = clamp(-smoothedAcross * 0.012, -CAT_BUS_MAX_ROLL, CAT_BUS_MAX_ROLL);

      chassis.position.y = CAT_BUS_RIDE_LIFT + heave;
      // Rotation about x lifts the nose when `pitch` is positive: a point at
      // +z moves down by `z * sin(pitch)`, so the sign is flipped here to make
      // "positive pitch = nose up" true, which is what the two targets above
      // assume.
      chassis.rotation.x = -pitch;
      chassis.rotation.z = roll;

    },

    dispose(): void {
      root.traverse((object) => {
        const mesh = object as Partial<Mesh>;
        mesh.geometry?.dispose();
      });
        bodyMaterial.dispose();
      stripedMaterial.dispose();
      roofMaterial.dispose();
      trimMaterial.dispose();
      earInnerMaterial.dispose();
      windowMaterial.dispose();
      wheelMaterial.dispose();
      hubMaterial.dispose();
      pawMaterial.dispose();
      bumperMaterial.dispose();
      faceTexture?.dispose();
      faceMaterial.dispose();
    },
  };
}

/**
 * The cat's face, as paint options for the shared painter.
 *
 * The eyes, nose and cat "w" mouth come from `paintFace()` — the same painter
 * every character in the park uses — so a change to how an eye is drawn reaches
 * the bus too. Only the whiskers are bespoke (no other character has any), and
 * they go into the same canvas as an `over` layer rather than onto a surface of
 * their own.
 */
const CAT_BUS_FACE_PAINT = {
  size: 512,
  eyeY: 0.4,
  eyeGap: 0.48,
  eyeW: 0.13,
  eyeH: 0.165,
  eyeStyle: 'open',
  iris: PALETTE.markerSky,
  mouth: 'cat',
  mouthW: 0.1,
  mouthDrop: 0.22,
  blush: PALETTE.cheek,
  blushStyle: 'soft',
  blushR: 0.085,
  nose: PALETTE.cheek,
} as const satisfies FacePaintOptions;

/**
 * **The park's name and the route number, on the front of the bus.**
 *
 * Jim, 7 August 2026: *"write 'Land of Good Places' on the front of the bus"*,
 * and then *"also make the bus number 67"*.
 *
 * ## Painted into the bus's own UV map, like the face
 *
 * This goes into the **same canvas as the cat's face**, in the band above its
 * eyes — the cat's forehead, which is where a bus carries its destination board
 * anyway. It is not a second mesh and not a plane hung in front of the
 * bodywork: CLAUDE.md's rule about a worn face applies to any flat appliqué,
 * and a destination board hovering a centimetre off the front is the identical
 * bug wearing a different hat. That bug is fixed on the cat's face in this same
 * change; reintroducing it one band higher would be absurd.
 *
 * One surface, one texture. It cannot come adrift from the face because it *is*
 * the face's canvas, and it cannot crowd it because the band is measured
 * against {@link CAT_BUS_FACE_PAINT}'s own `eyeY` rather than guessed.
 *
 * ## The lettering
 *
 * `"Trebuchet MS"` bold in `PALETTE.ink`, which is what `nameLabelTexture`
 * paints every character's name pill in — the park's existing treatment for
 * canvas lettering rather than a new one invented here. The board is a
 * flat-filled rounded panel with an inked edge and a filled roundel for the
 * number: flat fills and bold outlines per ART_DIRECTION §7, no gradient and no
 * shading anywhere. Set a degree and a half off level, because nothing in this
 * park is plumb and a perfectly square board on a hand-painted toy reads as a
 * decal.
 *
 * Two lines for the destination rather than one: nineteen characters across
 * two-thirds of a cat's forehead sets a line so small that measuring it is
 * embarrassing, and broken in two it is nearly twice the height on the same
 * board.
 *
 * ## On GAME_DESIGN.md's TEXT RULE
 *
 * The rule's floor is a *screen* size, and the mechanism for honouring it on
 * canvas text is `NameLabel`'s — size the billboard in world units so its font
 * lands on `minTextPx()`. That mechanism is not available here, because this is
 * painted on **a bus**: it is as big as the front of a bus, at whatever
 * distance the ride shows it, and scaling it to a screen size would be a
 * destination board that grows and shrinks against its own vehicle.
 *
 * That is not a licence to paint it small. It is drawn as large as the band
 * allows and auto-fitted to the width ({@link fitText}) rather than set at a
 * chosen point size, and `check:cat-bus` reports what it actually says. Worth
 * noting too that the park's name is already carried in DOM text at the minimum
 * size by `Hud`'s park pill — the rule-compliant channel for it ever since
 * every in-world sign was taken out on 28 July 2026 — so this is decoration on
 * top of something that already complies, not a replacement for it.
 */
export const CAT_BUS_DESTINATION = 'Land of Good Places';
export const CAT_BUS_ROUTE_NUMBER = '67';

function paintDestinationBoard(ctx: CanvasRenderingContext2D, size: number): void {
  // The band above the eyes. `eyeY` is where the eyes sit in this same window,
  // so the board can never creep down over them however the face is retuned.
  const top = size * 0.015;
  const bottom = size * (CAT_BUS_FACE_PAINT.eyeY - 0.12);
  const height = bottom - top;
  const left = size * 0.05;
  const right = size * 0.95;

  ctx.save();
  ctx.translate(size / 2, (top + bottom) / 2);
  ctx.rotate(-0.026);
  ctx.translate(-size / 2, -(top + bottom) / 2);

  const radius = height * 0.28;
  ctx.beginPath();
  ctx.roundRect(left, top, right - left, height, radius);
  ctx.fillStyle = hexToCss(PALETTE.stonePinkLight);
  ctx.fill();
  ctx.strokeStyle = hexToCss(PALETTE.ink);
  ctx.lineWidth = size * 0.008;
  ctx.stroke();

  // The route number, in a roundel at the near end, as a bus carries it.
  const roundelR = height * 0.36;
  const roundelX = left + roundelR + height * 0.12;
  const roundelY = top + height / 2;
  ctx.beginPath();
  ctx.arc(roundelX, roundelY, roundelR, 0, Math.PI * 2);
  ctx.fillStyle = hexToCss(PALETTE.markerLemon);
  ctx.fill();
  ctx.strokeStyle = hexToCss(PALETTE.ink);
  ctx.lineWidth = size * 0.007;
  ctx.stroke();

  ctx.fillStyle = hexToCss(PALETTE.ink);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  fitText(ctx, CAT_BUS_ROUTE_NUMBER, roundelR * 1.5, roundelR * 1.25);
  ctx.fillText(CAT_BUS_ROUTE_NUMBER, roundelX, roundelY + roundelR * 0.04);

  const textLeft = roundelX + roundelR + height * 0.14;
  const textRight = right - height * 0.12;
  const lines = CAT_BUS_DESTINATION_LINES;
  fitText(ctx, lines[1] ?? '', textRight - textLeft, height * 0.42);
  for (let i = 0; i < lines.length; i += 1) {
    ctx.fillText(lines[i] ?? '', (textLeft + textRight) / 2, top + height * (0.3 + i * 0.42));
  }
  ctx.restore();
}

/** How the destination is broken across the board. Exported so a check can ask. */
export const CAT_BUS_DESTINATION_LINES = ['Land of', 'Good Places'] as const;

/**
 * Sets the largest of the house font that fits `width` and `height`.
 *
 * Auto-fitted rather than set at a chosen point size, so the lettering is as
 * large as the board allows — which is what GAME_DESIGN.md's TEXT RULE asks for
 * on a surface that cannot be scaled to a screen size.
 */
function fitText(ctx: CanvasRenderingContext2D, text: string, width: number, height: number): void {
  const font = (px: number): string => `bold ${px}px "Trebuchet MS", "Segoe UI", sans-serif`;
  let px = height;
  ctx.font = font(px);
  const measured = ctx.measureText(text).width;
  if (measured > width && measured > 0) {
    px = Math.max(1, px * (width / measured));
    ctx.font = font(px);
  }
}

function paintWhiskers(ctx: CanvasRenderingContext2D, size: number): void {
  const ink = hexToCss(PALETTE.ink);
  ctx.strokeStyle = ink;
  ctx.lineCap = 'round';
  ctx.lineWidth = size * 0.011;
  ctx.globalAlpha = 0.78;
  const y0 = size * 0.62;
  for (const side of [-1, 1] as const) {
    for (let i = 0; i < 3; i += 1) {
      const rise = (i - 1) * size * 0.05;
      ctx.beginPath();
      ctx.moveTo(size / 2 + side * size * 0.2, y0 + rise * 0.35);
      ctx.quadraticCurveTo(
        size / 2 + side * size * 0.34,
        y0 + rise * 0.7,
        size / 2 + side * size * 0.48,
        y0 + rise,
      );
      ctx.stroke();
    }
  }
  ctx.globalAlpha = 1;
}
