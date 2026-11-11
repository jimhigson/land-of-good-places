import { Vector3, type Group } from 'three';
import { angleDelta, clamp, clamp01, damp, lerp, Rng, smoothstep } from '../../core/mathUtils';
import { PALETTE } from '../../core/palette';
import { BUILDING_STEP_UP } from '../../core/constants';
import type { IsoCamera } from '../../core/IsoCamera';
import { gameStore } from '../../state';
import type { Player } from '../../entities/Player';
import type { BoxCollider, CollisionWorld, WallCollider } from '../Collision';
import type { InteriorControls } from '../building/Building';
import { SpeechBubble } from '../../ui/SpeechBubble';
import { lineSeconds } from '../../ui/speechTiming';
import { playSurpriseChime } from '../../ui/chime';
import { createFaceLife, type FaceLife } from '../../art/style/faceLife';
import { visibleBounds, visiblePoints, visibleReachXZ } from '../../art/style/measure';
import { SpritePuffs } from '../../art/effects/spritePuffs';
import { createLibraryOwl, type OwlHandle } from '../../art/models/libraryCreatures';
import { libraryArmchairSize, libraryBookcaseSize, libraryDeskSize } from '../../art/models/libraryAssets';
import type { LibraryProps } from './props';
import type { FurnishedShelfBook } from './furnish';
import { LIBRARY_LINES } from './libraryLines';
import { giveLibraryCard, hasLibraryCard } from './libraryCard';
import { recommendFor } from './recommendation';
import { isBookRead } from './readBooks';
import { LIBRARY_BOOKCASES, LIBRARY_FLOOR_Y, LIBRARY_FURNITURE, LIBRARY_LIBRARIAN_SPOT, LIBRARY_ORIGIN_X, LIBRARY_ORIGIN_Z, LIBRARY_STORY_CHAIR, pieceToRoom, type StandSpot } from './layout';

/**
 * **The owl librarian at her desk** (#718, plan Step 6) — Jim, 13 October
 * 2026: an owl librarian with glasses and a cardigan, behind her desk, who
 * hands over a library card on the first visit, recommends a book that glows
 * until it is read, and says "Shhh!" to runners and jumpers with no penalty.
 *
 * ## A prop, not a resident
 *
 * She never walks, so she is not an `NpcSystem` resident (plan Decision 4): a
 * resident's own `move()` would resolve her out of her own collider, its
 * push-apart is capped well under a running child's speed, and the crowd gives
 * its residents random facings. Everything that makes her alive — breathing,
 * blinking, a head that turns to watch the child, the shush wing, the card
 * flap, and (plan Step 9) her flight to the story chair — lives here, driven
 * off the Artist's model (`libraryCreatures.ts`, `library.glb`).
 *
 * ## Solid, wherever she is drawn — and never moved into anybody
 *
 * Anything drawn is solid. **At her desk** her solid is a filled disc of her
 * measured plan reach, head and glasses included, across every pose she holds
 * standing there ({@link radius}, {@link standingReach} on the built model —
 * never typed), registered through `props.wall(spot, spot, …)` as a
 * zero-length capsule: the one round solid `CollisionWorld` can take out and
 * put back as the same object. `LIBRARY_LIBRARIAN_SPOT` therefore left
 * `libraryStandSpots()`: it is a place a child bumps into now, not one she
 * must be able to stand on.
 *
 * **Everywhere else she is one body that moves with her** ({@link body},
 * `CollisionWorld.addMovingBox` — the train's kind of solid), its base at her
 * feet and its top her head, in the shape she is there: low over her desk,
 * her desk's disc; low over the story chair and perched on it, her drawn
 * outline as a box ({@link perchShape}), which stands inside the chair's
 * front ({@link OWL_PERCH_BACK}); in the air with her wings open, a disc of
 * her reach at their widest beat ({@link flightReach}). She flies straight up,
 * across and straight down ({@link owlFlightPose}), turning only at the top,
 * her wings folded while she is low ({@link owlWingOpening}) — so whenever
 * she is low she is over the spot she stands on and no wider than her solid
 * there. Each top is her head at the top of a breath ({@link owlTop}), like
 * every solid's real top since PR #722: a jump that reaches it lands on it —
 * physics, not a flag.
 *
 * And **like the train, she waits for anybody in her way**: before each step
 * of a flight she asks whether her body there would touch the child, the
 * child's pets or the library's children ({@link OwlBystanders}), with a
 * step's headroom over a head ({@link OWL_HEADROOM}); if it would, she holds
 * where she is — on the ground at take-off, a step over the child's head
 * coming down — and flies on the moment it is clear. So she is never drawn
 * inside anybody: not landing on a child standing in her spot behind the
 * desk, not perched round one standing on the story chair's seat, not rising
 * through one on her head (browser QA round 1, 23 Oct 2026, found the first
 * two; the third is the same disease) — and a child waiting at the chair's
 * front, or pressed against her at her desk, is never in her way.
 *
 * ## Her words
 *
 * Every line is `libraryLines.ts`'s, said through one `SpeechBubble` in the
 * hotel receptionist's shape: a script of lines, each held `lineSeconds` long
 * (`ui/speechTiming.ts`, the one rule for every speaker). The bubble is the
 * owl zone's `actionFeedback` — the answer to the press she just made — so
 * while the owl talks the chip over her is put away rather than drawn over her
 * words (`ui/LabelManager.ts`, rule 1). A **script** (the card ceremony, the
 * recommendation, a story) is never interrupted: a press mid-script does
 * nothing, and a shush mid-script moves only her wing and face. Her one-line
 * invitation and the shush itself are interruptible, because a press during
 * "Come to my desk for your library card!" is the invited press.
 *
 * ## The shush
 *
 * `Player.isRunning` held {@link SHUSH_RUN_SECONDS}, or a real take-off (the
 * rising edge of `isAirborne` with `verticalSpeed > 0`, so standing up off a
 * cushion — airborne at speed 0 — never counts). Not while riding, not while
 * a change of space is running. She says "Shhh!" and, at her desk, raises her
 * **left** wing over it (the right holds her book), the face goes wide for a
 * moment, and then she waits {@link SHUSH_COOLDOWN_SECONDS} before the next
 * one. **No penalty of any kind** — Jim's rule, and a six-year-old's delight is
 * in making her say it. She shushes from her desk and from the story chair,
 * never on the wing; mid-story only her face answers (a story is a script),
 * and on the chair her wings stay down: there the shush wing would swing out
 * over the rug, past her chair's front, into a listener ({@link perchShape}).
 * Not while the child is in the secret den: that condition is the den track's
 * (#719), which owns `libraryDenContains`.
 *
 * ## Story time (plan Step 9)
 *
 * `storyTime.ts` flies her to the story chair and back ({@link flyTo}): up,
 * across in a straight line over the stacks at her measured cruise, and down
 * ({@link owlFlightPose}, pure, so `check:library`'s FLIGHT measures the very
 * path she flies — a wait only pauses her on it). Her desk capsule goes as she
 * leaves her desk and her body takes over; landed home, it hands back; landed
 * on the chair, it stays, her solid there. She perches on the chair's seat
 * ({@link owlPerch}), `OWL_PERCH_BACK` into it.
 */
export const OWL_ZONE_ID = 'library-owl';

/** Her own seeded stream: the phase of her breathing, so she is never in step with anything else that breathes. */
export const LIBRARY_OWL_SEED = 0x0b00c4;
/** The library's sprite effects' stream: the card's sparkles and the glowing book's twinkles. */
export const LIBRARY_FX_SEED = 0x0b00d5;

/** How long a run must last before she shushes: a stride or two, not a single hurried step. */
export const SHUSH_RUN_SECONDS = 0.35;
/** How long she waits after a "Shhh!" before the next: long enough that a child who keeps running is not nagged every stride. */
export const SHUSH_COOLDOWN_SECONDS = 6;
/** How long her face stays wide and her wing stays up. */
export const SHUSH_FACE_SECONDS = 1.2;
/** Her free wing's lift for the shush: forward and up, a "hush" at the child (radians about the wing's own pivot). */
export const SHUSH_WING_X = -1.3;

/** She watches a child within this of her desk (metres); further, she looks straight ahead. */
export const OWL_LOOK_RANGE = 9;
/** How far her head turns, either way (radians) — an owl's head turns a long way, but not all the way round. */
export const HEAD_TURN_LIMIT = 1.0;
/**
 * The head's turn, as a half-life in seconds: the plan's "damps 0.12 a frame"
 * at 60 fps, made frame-rate independent — a per-frame factor of 0.12 halves
 * the remaining turn in `ln 2 / −ln(1 − 0.12)` ≈ 5.4 frames, 0.09 s.
 */
export const HEAD_TURN_HALF_LIFE = 0.09;
/** The wings' ease, up and back down. */
const WING_HALF_LIFE = 0.08;

/** The recommended book's glow: `GLOW_BASE + GLOW_SWING · (½ + ½ sin(GLOW_RATE · t))` on its cover's emissive. */
export const GLOW_BASE = 0.25;
export const GLOW_SWING = 0.35;
export const GLOW_RATE = 2.4;
/** A pair of warm twinkles rises off the glowing book this often (seconds). */
export const TWINKLE_EVERY = 1.4;
/**
 * **A beacon over the glowing book's case** — one sky-blue sparkle this often
 * (seconds), rising off the top of its bookcase right over the book, into the
 * open air above the stacks where it can be seen across the room. The book's
 * own glow is a sliver among hundreds of spines from the desk, 5 px wide at a
 * laptop's size (browser QA round 1); a sparkle rising over a case's top is
 * the thing a child can spot from the desk and walk to.
 */
export const BEACON_EVERY = 0.25;
/** The beacon's sparkles' size (metres) — bigger than the card's, to read across the room. */
export const BEACON_SCALE = 0.7;
/** They rise from this far over the case's measured top. */
const BEACON_OVER = 0.1;
/** Enough for the beacon's sparkles in flight at once (each lives 1.2 s): a little rising column of them. */
const BEACON_POOL = 6;

/** How long one flight takes, desk to story chair or back (seconds) — the plan's 3.2. */
export const OWL_FLIGHT_SECONDS = 3.2;
/** How far over the stacks' measured top her feet cruise (metres). */
export const OWL_CRUISE_OVER_STACKS = 0.6;
/** She rises straight up to her cruise by this share of a flight … */
export const OWL_CLIMBED_BY = 0.2;
/** … crosses the room at it until this one, and then comes straight down. */
export const OWL_DESCEND_AT = 0.8;
/**
 * Her wings stay folded until this share of a flight — when she is a step
 * over a child's head (at 0.14 her feet are 2.98 m up from her desk, 3.06 from
 * the story chair) — and are fully open by {@link OWL_WINGS_OPEN_BY}; folded
 * again by the mirror of it as she comes down. Low over where she stands, she
 * is no wider than her solid there, so a child pressed against it is never
 * touched by a wing, and never in her way.
 */
export const OWL_WINGS_OPEN_FROM = 0.14;
/** … open by this share (and from `1 −` it, folding). */
export const OWL_WINGS_OPEN_BY = 0.19;
/** Her wings' beat in flight: this far about each wing's own z (radians), at {@link OWL_WING_BEAT_RATE}. */
export const OWL_WING_BEAT = 0.6;
/** How fast her wings beat (radians a second). */
export const OWL_WING_BEAT_RATE = 9;
/**
 * How far back of the story chair's seat centre she sits (metres, along the
 * chair's own −Z, into it): far enough that her glasses — her furthest point
 * forward, 0.631 m from her middle at the top of a breath — stay inside the
 * chair's front face, so her solid there ({@link perchShape}) does too, and a
 * child standing against the chair's front is never in her way as she comes
 * down to it (browser QA round 1: at 0.15 they reached 4 cm past it, and a
 * child at the chair's front held her in the air). Her back then stands 6 cm
 * behind the chair's back, in the gap before the wall cases, which nobody fits
 * in. `check:library` measures both, on a fresh model.
 */
export const OWL_PERCH_BACK = 0.21;

/**
 * **Where the glowing book's beacon rises from** ({@link BEACON_EVERY}): the
 * measured top of the book's own bookcase (`libraryBookcaseSize` of its kind),
 * {@link BEACON_OVER} over it — room-local height, over the floor.
 */
export function glowBeaconBase(placed: Readonly<FurnishedShelfBook>): number {
  const spec = LIBRARY_BOOKCASES.find((candidate) => candidate.id === placed.slot.bookcase);
  if (!spec) throw new Error(`LibraryOwl: '${placed.book.id}' stands on '${placed.slot.bookcase}', which is not in LIBRARY_BOOKCASES`);
  return libraryBookcaseSize(spec.kind).height + BEACON_OVER;
}

/**
 * **Where her card passes to the child**: over the middle of her desk's top,
 * room-local — the desk's own spot (`LIBRARY_FURNITURE`) and its measured top
 * and footprint (`libraryDeskSize`), never typed. The card's sparkles rise from
 * here.
 */
export function cardHandOver(): Readonly<RoomPoint> {
  const desk = LIBRARY_FURNITURE.find((piece) => piece.kind === 'desk');
  if (!desk) throw new Error('LibraryOwl: no desk in LIBRARY_FURNITURE, so there is nowhere to hand her card over');
  const size = libraryDeskSize();
  const at = pieceToRoom(desk, size.centreX, size.centreZ);
  return { x: at.x, y: size.top, z: at.z };
}

/** Her cruise height over the room's floor: the stacks' measured top and {@link OWL_CRUISE_OVER_STACKS} — never typed. */
export function owlCruiseHeight(): number {
  return libraryBookcaseSize('stack').height + OWL_CRUISE_OVER_STACKS;
}

/** A point of the reading room's own frame: metres east, up from its floor, and toward the camera. */
export interface RoomPoint {
  x: number;
  y: number;
  z: number;
}

/**
 * **Where the owl's feet are at `t` of a flight** (0 at take-off, 1 on
 * landing), room-local — the plan's path, pure, so the check measures the
 * very line she flies. **Straight up, across, straight down**: she rises from
 * where she stood to `cruise` by {@link OWL_CLIMBED_BY}, crosses the room in a
 * straight line at it, eased in and out, until {@link OWL_DESCEND_AT}, and
 * comes straight down onto where she lands. Never low over the floor between:
 * low, she is only ever over the spot she stands on, inside the solid she has
 * there — so a child next to her desk or against her chair's front is never in
 * her way (browser QA round 1: on a slanting way down over the rug, a child
 * waiting at the chair's front held her in the air for good). Writes `out`
 * (allocating nothing) and returns it.
 */
export function owlFlightPose(
  from: Readonly<RoomPoint>,
  to: Readonly<RoomPoint>,
  t: number,
  out: RoomPoint = { x: 0, y: 0, z: 0 },
  cruise: number = owlCruiseHeight(),
): RoomPoint {
  const u = clamp01(t);
  const s = smoothstep(OWL_CLIMBED_BY, OWL_DESCEND_AT, u);
  out.x = lerp(from.x, to.x, s);
  out.z = lerp(from.z, to.z, s);
  out.y = u < OWL_DESCEND_AT ? lerp(from.y, cruise, smoothstep(0, OWL_CLIMBED_BY, u)) : lerp(cruise, to.y, smoothstep(OWL_DESCEND_AT, 1, u));
  return out;
}

/**
 * **How far open her wings' beat is at `t` of a flight**, 0..1: folded while
 * she rises and comes down near where she stands, open between — from
 * {@link OWL_WINGS_OPEN_FROM} to {@link OWL_WINGS_OPEN_BY}, and closing over the
 * mirror of it — the share of {@link OWL_WING_BEAT} she beats at. One owner, so
 * `check:library`'s FLIGHT measures her reach at the opening she really has,
 * and her moving body is the shape she is at it ({@link LibraryOwl.body}).
 */
export function owlWingOpening(t: number): number {
  return smoothstep(OWL_WINGS_OPEN_FROM, OWL_WINGS_OPEN_BY, t) * (1 - smoothstep(1 - OWL_WINGS_OPEN_BY, 1 - OWL_WINGS_OPEN_FROM, t));
}

/**
 * **Where the owl perches to read** (plan Step 9): the story chair's measured
 * seat centre (`libraryArmchairSize().seatCentre`), {@link OWL_PERCH_BACK}
 * further into the chair, turned by its facing (`pieceToRoom`), on its seat's
 * measured top, facing the chair's own way — at the rug. Room-local.
 */
export function owlPerch(): Readonly<RoomPoint> & { readonly facing: number } {
  const size = libraryArmchairSize();
  const at = pieceToRoom(LIBRARY_STORY_CHAIR, size.seatCentre.x, size.seatCentre.z - OWL_PERCH_BACK);
  return { x: at.x, y: size.seat, z: at.z, facing: LIBRARY_STORY_CHAIR.facing };
}

/** Breathing: `body.scale` sways by this share, at this rate (radians a second). */
export const BREATH_DEPTH = 0.02;
const BREATH_RATE = 1.7;
/** Her bubble's tail points this far over the top of her head, wherever she is — `check:library`'s STORY measures it there on every frame she speaks. */
export const OWL_BUBBLE_OVER_HEAD = 0.42;
/**
 * The hand-over: sparkles rising off her desk, and two waves of the wing that
 * holds her book — **forward and up**, over her desk (`wingR.rotation.x`, the
 * shush wing's own axis), the book lifted high, the way a card is held up to be
 * seen. Forward rather than out to her side because her wings are drawn and her
 * solid is not a wing: a sideways flap swings the wing 0.9 m from her middle,
 * 0.24 m past her solid, at her west side, where a child can stand against her
 * (measured); forward, every point past her solid is over the desk, where
 * nobody can, and at the top of the wave the wing is back inside her solid's
 * reach (0.665 m). `check:library` measures the drawn owl at her widest, live,
 * on both wings.
 *
 * The sparkles rise off the desk's middle — where the card passes, between her
 * and the child — and not over her head: there her own bubble, drawn over the
 * scenery, stood in front of them (browser QA round 1: "the card sparkles
 * hardly show"). Bigger than the glowing book's twinkles, so they read at the
 * camera's distance; `check:library`'s CARD measures them clear of her bubble
 * on screen.
 */
export const CARD_SPARKLES = 12;
/** In this many little clouds, across the desk from her side to the child's, so they read as a path the card takes rather than one blob. */
const CARD_SPARKLE_CLOUDS = 3;
/** The card's sparkles' size (metres), against the glowing book's twinkles' 0.3. */
export const CARD_SPARKLE_SCALE = 0.55;
/**
 * Their colour: the sky of the glowing book's cover light, not the room's warm
 * light — warm sparkles over a lamp-lit desk barely showed (headless Chrome,
 * 23 Oct).
 */
const CARD_SPARKLE_COLOUR = PALETTE.markerSky;
/** How long her two waves of the card take (seconds). */
export const FLAP_SECONDS = 1.4;
/** How far the book wing lifts at the top of each wave (radians about its pivot; negative is forward, past −π/2 up over her shoulder). */
export const CARD_FLAP_LIFT = 2.0;
/** How many sprites the twinkles' pool holds — a pair or two in flight, and the Story listener's eight. */
const PUFF_POOL = 12;
/** Sprites rise from a little over a book's base, so they come off the book rather than out of the board under it. */
const TWINKLE_RISE = 0.25;

/** How many head turns, from one limit to the other, {@link standingReach} measures her at. */
const REACH_TURN_SAMPLES = 9;

/**
 * **Her plan reach across every pose she holds standing at her desk** — the
 * radius her solid needs to cover her as drawn: `visibleReachXZ` with her head
 * turned anywhere in ±{@link HEAD_TURN_LIMIT} and her breath at rest or at
 * either extreme of {@link BREATH_DEPTH}, the largest of them. (Her glasses
 * sit forward of her head's pivot, so a turned head reaches a little further
 * than a straight one: 0.660 m against 0.655, measured.) The handle is left at
 * rest.
 */
export function standingReach(handle: OwlHandle): number {
  let reach = 0;
  for (let i = 0; i < REACH_TURN_SAMPLES; i += 1) {
    handle.head.rotation.y = -HEAD_TURN_LIMIT + (2 * HEAD_TURN_LIMIT * i) / (REACH_TURN_SAMPLES - 1);
    for (const breath of [-BREATH_DEPTH, 0, BREATH_DEPTH]) {
      handle.body.scale.set(1 + 0.6 * breath, 1 - breath, 1 + 0.6 * breath);
      reach = Math.max(reach, visibleReachXZ(handle.root));
    }
  }
  handle.head.rotation.y = 0;
  handle.body.scale.set(1, 1, 1);
  return reach;
}

/**
 * **Her drawn top at her tallest** — the top of every solid of hers: her head
 * at the top of a breath, when `body.scale.y` stretches to 1 + {@link
 * BREATH_DEPTH} (her head rides her body), 3 cm over her rest pose's measured
 * height. A child stood on her head stands there, so a breath in never pushes
 * her ear tufts up through the child's feet (`check:library`'s NEVER INSIDE
 * HER found exactly that, with her solid's top at the rest pose). The handle
 * is left at rest.
 */
export function owlTop(handle: OwlHandle): number {
  let top = 0;
  for (const breath of [-BREATH_DEPTH, 0, BREATH_DEPTH]) {
    handle.body.scale.set(1 + 0.6 * breath, 1 - breath, 1 + 0.6 * breath);
    top = Math.max(top, visibleBounds(handle.root).top);
  }
  handle.body.scale.set(1, 1, 1);
  return top;
}

/**
 * **A plan shape of her solid, in her own frame**: a box (`halfX` across her,
 * `halfZ` front to back) round its middle `(offX, offZ)`, thickened by
 * `rounding` — a disc is no box and a rounding; her drawn outline at rest, a
 * box and no rounding. `CollisionWorld.moveBox` takes its extents
 * (`MovingShape`); the middle is carried round her by her yaw.
 */
export interface OwlShape {
  readonly halfX: number;
  readonly halfZ: number;
  readonly rounding: number;
  readonly offX: number;
  readonly offZ: number;
}

/**
 * **Her drawn outline as she sits on the story chair, in her own frame** —
 * the box her solid there is ({@link LibraryOwl.body} at rest on the chair):
 * every visible point of her with her head straight (she watches the child
 * only from her desk), her wings down, and her breath at rest or at either
 * extreme. A box rather than a disc of her reach because the chair is a box
 * and she is wider than she is deep: a disc of 0.663 m stood 8 cm proud of the
 * chair's front, where a child waiting there for the story held her in the air
 * (browser QA round 1); the box stands inside the chair's front
 * ({@link OWL_PERCH_BACK}). Her wings stay down on the chair: a shush there is
 * her face alone ({@link noticeShush}), because the shush wing would swing
 * forward over the rug — 0.740 m from her middle, 0.16 m past the chair's
 * front. The handle is left at rest.
 */
export function perchShape(handle: OwlHandle): OwlShape {
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const breath of [-BREATH_DEPTH, 0, BREATH_DEPTH]) {
    handle.body.scale.set(1 + 0.6 * breath, 1 - breath, 1 + 0.6 * breath);
    visiblePoints(handle.root, (point) => {
      minX = Math.min(minX, point.x);
      maxX = Math.max(maxX, point.x);
      minZ = Math.min(minZ, point.z);
      maxZ = Math.max(maxZ, point.z);
    });
  }
  handle.body.scale.set(1, 1, 1);
  return { halfX: (maxX - minX) / 2, halfZ: (maxZ - minZ) / 2, rounding: 0, offX: (minX + maxX) / 2, offZ: (minZ + maxZ) / 2 };
}

/**
 * **Her plan reach on the wing** — the radius of her moving body: her wings at
 * either extreme of the widest beat ({@link OWL_WING_BEAT}), her head anywhere
 * in ±{@link HEAD_TURN_LIMIT} (it straightens over her first frames aloft),
 * her breath at rest or at either extreme, and her free wing down or still up
 * from a shush just before she took off. The largest of them (0.806 m
 * measured, her wings out). The handle is left at rest.
 */
export function flightReach(handle: OwlHandle): number {
  let reach = 0;
  for (const beat of [-OWL_WING_BEAT, OWL_WING_BEAT]) {
    handle.wingL.rotation.z = beat;
    handle.wingR.rotation.z = -beat;
    for (let i = 0; i < REACH_TURN_SAMPLES; i += 1) {
      handle.head.rotation.y = -HEAD_TURN_LIMIT + (2 * HEAD_TURN_LIMIT * i) / (REACH_TURN_SAMPLES - 1);
      for (const wing of [0, SHUSH_WING_X]) {
        handle.wingL.rotation.x = wing;
        for (const breath of [-BREATH_DEPTH, 0, BREATH_DEPTH]) {
          handle.body.scale.set(1 + 0.6 * breath, 1 - breath, 1 + 0.6 * breath);
          reach = Math.max(reach, visibleReachXZ(handle.root));
        }
      }
    }
  }
  handle.head.rotation.y = 0;
  handle.wingL.rotation.set(0, 0, 0);
  handle.wingR.rotation.set(0, 0, 0);
  handle.body.scale.set(1, 1, 1);
  return reach;
}

/**
 * **Somebody the owl must never fly into or come down on** — where their feet
 * are, in the world, and the upright cylinder they fill: the child (her
 * collision radius and her height), each of her pets out of the backpack, each
 * of the library's children. Written by whoever lists them and read at once, so
 * one object may be handed out again for the next.
 */
export interface OwlBystander {
  /** Who: "the child", a library child's name, "a pet" — what a check or a reader of {@link LibraryOwl.waitingFor} is told. */
  what: string;
  x: number;
  y: number;
  z: number;
  radius: number;
  height: number;
}

/** Everybody the owl must keep clear of right now — the Library lists them (`Library.owlBystanders`). */
export type OwlBystanders = () => Iterable<Readonly<OwlBystander>>;

/**
 * **The headroom she keeps over anybody's head, waiting over them** — one
 * step (`BUILDING_STEP_UP`). A child's walk up onto anything within a step
 * asks for her head's room over it; an owl hovering a hand over the child's
 * hair took that room, the step became a wall, and the child stood on the
 * story chair's seat edge (half in its arm, which is a step) was judged wedged
 * and put down on a cushion a metre and a quarter away (`check:library`'s
 * NEVER INSIDE HER, measured). A step clear over her, nothing about where she
 * stands changes.
 */
export const OWL_HEADROOM = BUILDING_STEP_UP;

/**
 * She turns between her facing and the way she travels over this share of a
 * flight, at its top — after the climb, and before the descent — so she rises
 * and comes down without turning, her solid the shape she stands in there.
 */
export const OWL_TURN_SHARE = 0.1;

/** A flight under way: from where she took off, to where she lands, how far through, and how she faces on landing. */
interface Flight {
  readonly from: RoomPoint;
  readonly to: RoomPoint;
  /** Her facing on take-off and on landing, radians (`rotation.y`). */
  readonly startYaw: number;
  readonly landYaw: number;
  /** The way she travels in plan, radians — she faces it between take-off and landing. */
  readonly travelYaw: number;
  /** 0 at take-off, 1 on landing. */
  t: number;
  /** Lands at her desk (her solid goes back) rather than on the story chair. */
  readonly home: boolean;
  /** Her solid's shape low over where she took off — her desk's disc, the chair's box, or (from mid-air) her wings' disc. */
  readonly fromShape: OwlShape;
  /** … and low over where she lands. */
  readonly toShape: OwlShape;
  /** She has taken her first step: the solid she stood in has handed over to her body. */
  leftGround: boolean;
}

/** A run of lines being said: which is up, how long it has left, and which one carries the cheer. */
interface Speech {
  readonly lines: readonly string[];
  index: number;
  timer: number;
  /** The index of the hand-over line, or −1 for a script with nothing to celebrate. */
  readonly cheerAt: number;
  /** A one-liner a press or a shush may cut short; a script is never interrupted. */
  readonly interruptible: boolean;
}

export class LibraryOwl {
  /** The Artist's owl, assembled: her root stands on {@link spot}, facing its bearing. */
  readonly handle: OwlHandle;
  /**
   * Her plan reach as she stands at her desk — head and glasses included,
   * across every pose she holds there (her head turned to either limit, her
   * breath at its widest), measured off the built model ({@link standingReach},
   * `visibleReachXZ`): the radius of her solid. Her wings' quick gestures (the
   * shush, the card flap) go forward over the desk, where no child can stand.
   */
  readonly radius: number;
  /**
   * Her solid at the desk: a zero-length capsule (a filled disc of
   * {@link radius}, top {@link top}) registered as `'the owl'`.
   * Story time (plan Step 9) takes it out as she leaves the ground and puts the
   * same object back as she lands (`props.detach` / `props.attach`).
   */
  readonly capsule: WallCollider;
  /** Her drawn top at her tallest breath ({@link owlTop}), over her feet: the top of every solid of hers. */
  readonly top: number;
  /** Her drawn outline perched, in her own frame ({@link perchShape}): her body's shape on the story chair. */
  readonly perchBox: OwlShape;
  /** Her plan reach on the wing ({@link flightReach}): the radius of {@link body} while her wings are open. */
  readonly flightRadius: number;
  /**
   * **Her solid everywhere but her desk**: one moving body
   * (`CollisionWorld.addMovingBox`), its base at her feet and its top at her
   * head, moved with her every frame of a flight, in the shape she is there
   * ({@link shapeAt}) — her desk's disc or the chair's box low over each, a disc
   * of {@link flightRadius} with her wings open — and, landed on the story chair,
   * her solid there, in the shape of {@link perchBox}. Out of the world while
   * she stands at her desk, where {@link capsule} is her solid.
   */
  readonly body: BoxCollider;
  /** Her speech bubble — `actionFeedback` for {@link OWL_ZONE_ID}, so it outranks her own chip. */
  readonly bubble: SpeechBubble;
  /** Where she stands: `LIBRARY_LIBRARIAN_SPOT`, room-local, with her facing. */
  readonly spot: StandSpot = LIBRARY_LIBRARIAN_SPOT;

  private readonly roomRoot: Group;
  private readonly collision: CollisionWorld;
  private readonly bystanders: OwlBystanders;
  private readonly controls: InteriorControls;
  private readonly shelfBooks: readonly FurnishedShelfBook[];
  private readonly face: FaceLife;
  private readonly puffs: SpritePuffs;
  /** The card's sparkles — their own pool, bigger than the twinkles ({@link CARD_SPARKLE_SCALE}). */
  readonly cardSparkles: SpritePuffs;
  /** The beacon over the glowing book's case ({@link BEACON_EVERY}). */
  readonly beacon: SpritePuffs;
  private readonly fx = new Rng(LIBRARY_FX_SEED);
  private readonly breathPhase: number;
  private readonly scratch = new Vector3();

  private speech: Speech | null = null;
  private lastLine: string | null = null;
  /** The book she last recommended, until it is read; the glow's target. */
  private recommendedId: string | null = null;
  /** The book whose emissive is lit right now, so the one that stops glowing is written dark exactly once. */
  private glowingId: string | null = null;
  private twinkleIn = 0;
  private beaconIn = 0;
  private shushFor = 0;
  private cooldown = 0;
  private runningFor = 0;
  private wasAirborne = false;
  private shushCount = 0;
  private flapFor = 0;
  /** At her desk: her Talk zone is offered only here. Story time flies her away from it (plan Step 9). */
  private atDeskFlag = true;
  /** On the story chair, reading. */
  private perchedFlag = false;
  private flight: Flight | null = null;
  /** Her desk capsule is in the world: she is standing behind her desk, not about to leave it. */
  private deskSolidIn = true;
  /** Her moving body is in the world: she is on the wing, or perched on the story chair. */
  private bodyIn = false;
  /** Scratch for her body's shape at the step being asked about. */
  private readonly shapeScratch = { halfX: 0, halfZ: 0, rounding: 0, offX: 0, offZ: 0 };
  /** How long she has waited, this flight, for somebody to get out of her way (seconds). */
  private waitedSeconds = 0;
  /** Who she is waiting for this frame, or '' — the bystander her next step would have touched. */
  private waitingForWhat = '';
  private readonly props: LibraryProps;
  private readonly pose: RoomPoint = { x: 0, y: 0, z: 0 };

  constructor(
    roomRoot: Group,
    props: LibraryProps,
    collision: CollisionWorld,
    shelfBooks: readonly FurnishedShelfBook[],
    controls: InteriorControls,
    bystanders: OwlBystanders,
  ) {
    this.roomRoot = roomRoot;
    this.controls = controls;
    this.shelfBooks = shelfBooks;
    this.props = props;
    this.collision = collision;
    this.bystanders = bystanders;

    this.handle = createLibraryOwl();
    // Measured before she is moved: her reach about her own origin, in her own frame.
    this.radius = standingReach(this.handle);
    this.top = owlTop(this.handle);
    this.perchBox = perchShape(this.handle);
    this.flightRadius = flightReach(this.handle);
    this.handle.root.position.set(this.spot.x, 0, this.spot.z);
    this.handle.root.rotation.y = (this.spot.facing * Math.PI) / 180;
    roomRoot.add(this.handle.root);
    this.capsule = props.wall('the owl', this.spot, this.spot, this.radius, this.top);
    // Her body: registered once, out of the world until she leaves her desk (`updateFlight`).
    this.body = collision.addMovingBox(
      LIBRARY_ORIGIN_X + this.spot.x,
      LIBRARY_ORIGIN_Z + this.spot.z,
      0,
      0,
      0,
      LIBRARY_FLOOR_Y + this.top,
      LIBRARY_FLOOR_Y,
      this.flightRadius,
    );
    collision.removeBox(this.body);

    // Drawn over the room's furniture, never cut by it (`overScenery`; LABELS.md, "Drawn over the
    // scenery"): she reads from the story chair, backed onto the bookcase wall, and a depth-tested bubble
    // there lost its right side behind the cases — "A day in the pa…" (headless Chrome, 23 Oct; STORY
    // measures it). The label manager still decides whether it is drawn; this only stops scenery cutting
    // a granted one.
    this.bubble = new SpeechBubble({ id: 'library-owl-says', item: OWL_ZONE_ID, kind: 'actionFeedback' }, PALETTE.markerLilac, { overScenery: true });
    roomRoot.add(this.bubble.sprite);
    this.anchorBubble();

    this.puffs = new SpritePuffs(roomRoot, PUFF_POOL, PALETTE.fairyWarm, 0.3);
    this.cardSparkles = new SpritePuffs(roomRoot, CARD_SPARKLES, CARD_SPARKLE_COLOUR, CARD_SPARKLE_SCALE);
    this.beacon = new SpritePuffs(roomRoot, BEACON_POOL, CARD_SPARKLE_COLOUR, BEACON_SCALE);
    this.breathPhase = new Rng(LIBRARY_OWL_SEED).range(0, Math.PI * 2);
    this.face = createFaceLife((expression) => this.handle.setExpression(expression));
  }

  // --------------------------------------------------------------- state

  /** At her desk — where her Talk zone is offered. */
  get atDesk(): boolean {
    return this.atDeskFlag;
  }

  /** On the story chair (plan Step 9). */
  get perched(): boolean {
    return this.perchedFlag;
  }

  /** On the wing, between her desk and the story chair. */
  get flying(): boolean {
    return this.flight !== null;
  }

  /** Off the ground, her moving body carrying her solid ({@link body}) — from the frame she leaves her capsule to the frame she lands. */
  get airborne(): boolean {
    return this.flight !== null && this.flight.leftGround;
  }

  /** How far through her flight she is, 0 at take-off to 1 on landing — `NaN` when she is not flying. What `owlFlightPose` is asked at. */
  get flightProgress(): number {
    return this.flight ? this.flight.t : Number.NaN;
  }

  /** How long she has waited, on this flight or her last, for somebody to get out of her way (seconds). */
  get waited(): number {
    return this.waitedSeconds;
  }

  /** Who she is waiting for right now ("the child", a library child's name, "a pet"), or '' — she is not. */
  get waitingFor(): string {
    return this.waitingForWhat;
  }

  /** Where her feet are, room-local — the check reads her against {@link owlFlightPose}. */
  get feet(): Readonly<Vector3> {
    return this.handle.root.position;
  }

  /** Saying something — a script or a one-liner. */
  get speaking(): boolean {
    return this.speech !== null;
  }

  /** In a script (the card, the recommendation, a story): nothing interrupts it. */
  get midScript(): boolean {
    return this.speech !== null && !this.speech.interruptible;
  }

  /** The last line she put in her bubble, kept after the bubble goes — what a check reads. */
  get lastSaid(): string | null {
    return this.lastLine;
  }

  /** How many times she has shushed since she was built — a count, because `lastSaid` stays "Shhh!" until she says something else. */
  get shushes(): number {
    return this.shushCount;
  }

  /** The book she is recommending — the one that glows — or null. */
  get recommendedBookId(): string | null {
    return this.recommendedId;
  }

  /** The warm twinkles' pool — the glowing book's own twinkles, and the Story listener's sparkles — for a check to measure. */
  get twinkles(): SpritePuffs {
    return this.puffs;
  }

  // --------------------------------------------------------------- doors

  /** The child has come in: without her card, the owl invites her over — once per visit. */
  enter(): void {
    if (!hasLibraryCard(gameStore.get())) this.say([LIBRARY_LINES.owl.welcome], -1, true);
  }

  /**
   * The child has left: whatever the owl was saying stops with her, nothing of
   * a run carries over, and she is back behind her desk — a flight or a story
   * is not left hanging for the next visit ({@link snapHome}).
   */
  leave(): void {
    this.clearSpeech();
    this.shushFor = 0;
    this.runningFor = 0;
    this.flapFor = 0;
    this.snapHome();
  }

  // --------------------------------------------------------------- story time

  /**
   * **A script of her own lines** — story time's call, and a whole story read
   * aloud: never interrupted (a press is not offered away from her desk, and a
   * shush mid-script moves only her wing and face).
   */
  tell(lines: readonly string[]): void {
    this.say(lines, -1, false);
  }

  /** Stops whatever she is saying. */
  hush(): void {
    this.clearSpeech();
  }

  /** Warm sparkles over a room-local spot — story time's Story listener card, over the child. */
  sparkleOver(x: number, y: number, z: number, count: number): void {
    this.puffs.puff(x, y, z, this.fx, count);
  }

  /**
   * **Off she flies** — to the story chair ({@link owlPerch}), or home to her
   * desk (`home`). From wherever she is: her desk, the chair, or mid-flight
   * (she turns round where she is). The capsule she stands in stays until she
   * leaves the ground, which is the first frame her moving body would touch
   * nobody ({@link updateFlight}).
   */
  flyTo(home: boolean): void {
    const root = this.handle.root;
    // Where she stands now decides her shape low over it: her desk's disc, the chair's box, or — turned
    // round in the air — her wings' disc.
    const fromShape = this.atDeskFlag ? this.deskShape : this.perchedFlag ? this.perchBox : this.wingShape;
    this.atDeskFlag = false;
    this.perchedFlag = false;
    this.waitedSeconds = 0;
    this.waitingForWhat = '';
    const perch = owlPerch();
    const to: RoomPoint = home ? { x: this.spot.x, y: 0, z: this.spot.z } : { x: perch.x, y: perch.y, z: perch.z };
    const landYaw = ((home ? this.spot.facing : perch.facing) * Math.PI) / 180;
    const from: RoomPoint = { x: root.position.x, y: root.position.y, z: root.position.z };
    const travelYaw = Math.atan2(to.x - from.x, to.z - from.z);
    const toShape = home ? this.deskShape : this.perchBox;
    this.flight = { from, to, startYaw: root.rotation.y, landYaw, travelYaw, t: 0, home, fromShape, toShape, leftGround: false };
  }

  /** Her desk solid's shape, as her body has it low over her desk: a disc of {@link radius}. */
  private get deskShape(): OwlShape {
    return { halfX: 0, halfZ: 0, rounding: this.radius, offX: 0, offZ: 0 };
  }

  /** Her body's shape with her wings open: a disc of {@link flightRadius}. */
  private get wingShape(): OwlShape {
    return { halfX: 0, halfZ: 0, rounding: this.flightRadius, offX: 0, offZ: 0 };
  }

  /**
   * **Back behind her desk at once** — story time abandoned, or the child
   * gone: no flight, no perch, her desk solid back and every other solid of
   * hers out. Only ever with the child out of the room (`leave`), so there is
   * nobody it could come down on.
   */
  snapHome(): void {
    const root = this.handle.root;
    this.flight = null;
    this.perchedFlag = false;
    root.position.set(this.spot.x, 0, this.spot.z);
    root.rotation.y = (this.spot.facing * Math.PI) / 180;
    this.handle.wingL.rotation.z = 0;
    this.handle.wingR.rotation.z = 0;
    this.atDeskFlag = true;
    this.waitingForWhat = '';
    this.collision.removeBox(this.body);
    this.bodyIn = false;
    this.props.attach([this.capsule]);
    this.deskSolidIn = true;
    this.anchorBubble();
  }

  // --------------------------------------------------------------- the press

  /**
   * The Talk press: her library card, the first time; a recommendation every
   * time after. Nothing while she is mid-script — the chip is put away under
   * her bubble then anyway (the label manager's rule 1), so no chip she is
   * showing ever lies.
   */
  talk(player: Player): void {
    if (this.midScript) return;
    if (hasLibraryCard(gameStore.get())) this.hello();
    else this.giveCard(player);
  }

  /**
   * **The card ceremony.** The card is hers **on the press** — not at the end
   * of the script, so a child who walks off mid-sentence still has it — and the
   * hand-over line ({@link LIBRARY_LINES}'s `cardCheerAt`) is the celebration:
   * the room flashes, a chime plays, sparkles rise off her desk where the card
   * passes, and she waves the card high in the wing that holds her book. The
   * hotel's check-in is the precedent.
   */
  private giveCard(player: Player): void {
    giveLibraryCard();
    player.model.setExpression('happy');
    this.say(LIBRARY_LINES.owl.card, LIBRARY_LINES.owl.cardCheerAt, false);
  }

  /** The hand-over moment of the card script. */
  private cheer(): void {
    this.controls.flash();
    playSurpriseChime();
    // Across the desk toward the child, from a little her side of its middle to past its front edge: the
    // card's way over. Not from its back edge: a cloud there rose into the tail of her bubble (check:library's CARD).
    const over = cardHandOver();
    const depth = libraryDeskSize().depth;
    const facing = (this.spot.facing * Math.PI) / 180;
    for (let i = 0; i < CARD_SPARKLE_CLOUDS; i += 1) {
      const along = (-0.2 + (0.8 * i) / (CARD_SPARKLE_CLOUDS - 1)) * depth;
      this.cardSparkles.puff(over.x + Math.sin(facing) * along, over.y + 0.05, over.z + Math.cos(facing) * along, this.fx, CARD_SPARKLES / CARD_SPARKLE_CLOUDS);
    }
    this.flapFor = FLAP_SECONDS;
  }

  /**
   * **"Say hello!"** — the recommendation: the first book she has not read in
   * the owl's one seeded order (`recommendation.ts`), named in the bubble and
   * lit on its shelf until she reads it. With every book read, the owl says so
   * and points her at story time instead.
   */
  private hello(): void {
    const pick = recommendFor(gameStore.get());
    if (!pick) {
      this.say(LIBRARY_LINES.owl.allRead, -1, false);
      return;
    }
    this.recommendedId = pick.id;
    const owl = LIBRARY_LINES.owl;
    this.say([owl.helloAgain, owl.recommendLead, owl.recommend(pick.title), owl.recommendGlow], -1, false);
  }

  // --------------------------------------------------------------- every frame

  /**
   * One frame, while the child is in the reading room: her words, the shush,
   * her life (breath, blink, head, wings), the recommended book's glow, the
   * sprites, and her bubble's place on screen. `changing` is the room's
   * `SpaceManager.isChanging` — mid-iris nobody is shushed.
   */
  update(dt: number, elapsed: number, player: Player, changing: boolean, camera: IsoCamera): void {
    this.updateFlight(dt, elapsed);
    this.updateSpeech(dt);
    this.noticeShush(player, dt, changing);
    this.live(dt, elapsed, player);
    this.glow(dt, elapsed);
    this.puffs.update(dt);
    this.cardSparkles.update(dt);
    this.beacon.update(dt);
    if (this.speech) {
      this.anchorBubble();
      this.bubble.updateScreenSize(camera);
    }
  }

  /**
   * Puts a run of lines in her bubble — `Hotel.say`'s shape. `cheerAt` is the
   * index of the hand-over line, or −1. `interruptible` marks a one-liner a
   * press or a shush may cut short; a script is never interrupted.
   */
  private say(lines: readonly string[], cheerAt: number, interruptible: boolean): void {
    const first = lines[0];
    if (first === undefined) return;
    this.speech = { lines, index: 0, timer: lineSeconds(first), cheerAt, interruptible };
    this.setLine(first);
    if (cheerAt === 0) this.cheer();
  }

  private setLine(line: string): void {
    this.lastLine = line;
    this.bubble.setText(line);
  }

  private clearSpeech(): void {
    this.speech = null;
    this.bubble.setText(null);
  }

  /** One frame of her script: the next line when this one's time is up, the bubble away when the script is done. */
  private updateSpeech(dt: number): void {
    const speech = this.speech;
    if (!speech) return;
    speech.timer -= dt;
    if (speech.timer > 0) return;
    speech.index += 1;
    const line = speech.lines[speech.index];
    if (line === undefined) {
      this.clearSpeech();
      return;
    }
    this.setLine(line);
    speech.timer = lineSeconds(line);
    if (speech.index === speech.cheerAt) this.cheer();
  }

  /**
   * **Runners and jumpers get a "Shhh!"** — see the class doc. Measured off
   * the real player every frame: `isRunning` (the one definition, `Player`'s)
   * accumulated into a run, and a take-off as the rising edge of `isAirborne`
   * with upward speed. Fired, she says the line unless she is mid-script, in
   * which case only her wing and face answer; either way the cooldown starts.
   */
  private noticeShush(player: Player, dt: number, changing: boolean): void {
    this.cooldown = Math.max(0, this.cooldown - dt);
    this.shushFor = Math.max(0, this.shushFor - dt);
    const airborne = player.isAirborne;
    const jumped = !this.wasAirborne && airborne && player.verticalSpeed > 0;
    this.wasAirborne = airborne;
    if (changing || player.riding || !(this.atDeskFlag || this.perchedFlag)) {
      this.runningFor = 0;
      return;
    }
    this.runningFor = player.isRunning ? this.runningFor + dt : 0;
    if (this.cooldown > 0) return;
    if (this.runningFor < SHUSH_RUN_SECONDS && !jumped) return;
    this.shushCount += 1;
    this.shushFor = SHUSH_FACE_SECONDS;
    if (!this.midScript) this.say([LIBRARY_LINES.owl.shush], -1, true);
    this.cooldown = SHUSH_COOLDOWN_SECONDS;
  }

  /**
   * Breath, blink, the head that watches her, and the wings: the shush wing
   * up while the shush lasts, the book wing's two quick flaps at the hand-over.
   * The head turns toward the child's bearing from the owl's own facing,
   * clamped to {@link HEAD_TURN_LIMIT}, within {@link OWL_LOOK_RANGE}; beyond
   * it, or away from the desk, straight ahead.
   */
  private live(dt: number, elapsed: number, player: Player): void {
    const { body, head, wingL, wingR, root } = this.handle;
    const b = Math.sin(elapsed * BREATH_RATE + this.breathPhase) * BREATH_DEPTH;
    body.scale.set(1 + 0.6 * b, 1 - b, 1 + 0.6 * b);

    this.face.update(dt, this.shushFor > 0 ? 'surprised' : this.speech ? 'happy' : 'neutral');

    let target = 0;
    if (this.atDeskFlag) {
      const dx = player.position.x - (LIBRARY_ORIGIN_X + root.position.x);
      const dz = player.position.z - (LIBRARY_ORIGIN_Z + root.position.z);
      if (Math.hypot(dx, dz) <= OWL_LOOK_RANGE) {
        // `Player.facing`'s convention: 0 along +Z, π/2 along +X — and so is
        // a positive `rotation.y`, which turns her face from +Z toward +X.
        target = clamp(angleDelta(root.rotation.y, Math.atan2(dx, dz)), -HEAD_TURN_LIMIT, HEAD_TURN_LIMIT);
      }
    }
    head.rotation.y = damp(head.rotation.y, target, HEAD_TURN_HALF_LIFE, dt);

    // The shush wing goes up only at her desk, over the desk; on the story chair a shush is her face alone (`perchShape`).
    wingL.rotation.x = damp(wingL.rotation.x, this.shushFor > 0 && this.atDeskFlag ? SHUSH_WING_X : 0, WING_HALF_LIFE, dt);
    // On the wing they beat (`updateFlight` writes them); landed, they fold back.
    if (!this.flight) {
      wingL.rotation.z = damp(wingL.rotation.z, 0, WING_HALF_LIFE, dt);
      wingR.rotation.z = damp(wingR.rotation.z, 0, WING_HALF_LIFE, dt);
    }
    if (this.flapFor > 0) {
      this.flapFor = Math.max(0, this.flapFor - dt);
      const t = (FLAP_SECONDS - this.flapFor) / FLAP_SECONDS;
      // Two waves over the wave's time; negative lifts the book wing forward over the desk and, past −π/2, up high.
      wingR.rotation.x = -Math.abs(Math.sin(t * Math.PI * 2)) * CARD_FLAP_LIFT;
    } else {
      wingR.rotation.x = damp(wingR.rotation.x, 0, WING_HALF_LIFE, dt);
    }
  }

  /**
   * **The recommended book glows until it is read.** Its own cover material's
   * emissive (`createShelfBook` sets the emissive to the cover's colour at
   * intensity 0) breathes between {@link GLOW_BASE} and `GLOW_BASE +
   * GLOW_SWING`, a pair of warm twinkles rises off it every
   * {@link TWINKLE_EVERY} seconds, and a sky-blue sparkle rises off the top of
   * its case right over it every {@link BEACON_EVERY}, where it can be seen
   * across the room. Every other book reads 0 — written only on
   * the frame a book stops glowing, never every frame. The recommendation
   * clears on the frame `isBookRead` turns true. **Never the rainbow**, which
   * means "selected" and nothing else.
   */
  private glow(dt: number, elapsed: number): void {
    if (this.recommendedId !== null && isBookRead(gameStore.get(), this.recommendedId)) this.recommendedId = null;
    const wanted = this.recommendedId;
    if (this.glowingId !== wanted) {
      const was = this.shelfBooks.find((placed) => placed.book.id === this.glowingId);
      if (was) was.material.emissiveIntensity = 0;
      this.glowingId = wanted;
      this.twinkleIn = 0;
      this.beaconIn = 0;
    }
    if (wanted === null) return;
    const placed = this.shelfBooks.find((candidate) => candidate.book.id === wanted);
    if (!placed) return;
    placed.material.emissiveIntensity = GLOW_BASE + GLOW_SWING * (0.5 + 0.5 * Math.sin(elapsed * GLOW_RATE));
    // The book's spot in the room's frame: a stack's book rides its stack's group, a wall case's the room.
    const at = placed.mesh.getWorldPosition(this.scratch);
    this.roomRoot.worldToLocal(at);
    this.twinkleIn -= dt;
    if (this.twinkleIn <= 0) {
      this.twinkleIn = TWINKLE_EVERY;
      this.puffs.puff(at.x, at.y + TWINKLE_RISE, at.z, this.fx, 2);
    }
    this.beaconIn -= dt;
    if (this.beaconIn <= 0) {
      this.beaconIn = BEACON_EVERY;
      this.beacon.puff(at.x, glowBeaconBase(placed), at.z, this.fx, 1);
    }
  }

  /**
   * **One frame of a flight** — the next step along {@link owlFlightPose},
   * **taken only if her body there would touch nobody** ({@link wouldTouch});
   * otherwise she waits where she is this frame, and asks again the next. The
   * first step she takes is her take-off: from her desk, its capsule goes and
   * her moving body ({@link body}) takes over; from the story chair, the body
   * that was her solid there flies on. Every step moves the body with her, in
   * the shape she is at it ({@link shapeAt}); the last is her landing: at her
   * desk the body hands back to its capsule (the same disc), on the chair it
   * stays, her solid there.
   *
   * She turns between her facing and the way she travels only at the top of
   * the flight ({@link yawAt}), so she rises and comes down without turning,
   * no wider than the solid she stands in. Her wings beat with the opening
   * {@link owlWingOpening} gives — folded low, open in the air — and while she
   * waits in the air they keep beating, so she hovers.
   */
  private updateFlight(dt: number, elapsed: number): void {
    const flight = this.flight;
    if (!flight) return;
    const { root, wingL, wingR, head } = this.handle;
    const next = Math.min(1, flight.t + dt / OWL_FLIGHT_SECONDS);
    owlFlightPose(flight.from, flight.to, next, this.pose);
    const yaw = this.yawAt(flight, next);
    const shape = this.shapeAt(flight, next);
    if (this.wouldTouch(this.pose, yaw, shape)) {
      this.waitedSeconds += dt;
    } else {
      this.waitingForWhat = '';
      if (!flight.leftGround) {
        flight.leftGround = true;
        if (this.deskSolidIn) {
          this.props.detach([this.capsule]);
          this.deskSolidIn = false;
        }
        if (!this.bodyIn) {
          this.collision.restoreBox(this.body);
          this.bodyIn = true;
        }
      }
      flight.t = next;
      root.position.set(this.pose.x, this.pose.y, this.pose.z);
      root.rotation.y = yaw;
      this.placeBody(yaw, shape);
    }
    head.rotation.y = damp(head.rotation.y, 0, HEAD_TURN_HALF_LIFE, dt);
    const beat = Math.sin(elapsed * OWL_WING_BEAT_RATE) * OWL_WING_BEAT * owlWingOpening(flight.t);
    wingL.rotation.z = beat;
    wingR.rotation.z = -beat;
    if (flight.t < 1) return;
    this.flight = null;
    root.rotation.y = flight.landYaw;
    if (flight.home) {
      this.collision.removeBox(this.body);
      this.bodyIn = false;
      this.props.attach([this.capsule]);
      this.deskSolidIn = true;
      this.atDeskFlag = true;
    } else {
      this.perchedFlag = true;
    }
  }

  /** Her facing at `t` of a flight: her own at the ends, the way she travels across the top, turning over {@link OWL_TURN_SHARE} after the climb and before the descent. */
  private yawAt(flight: Readonly<Flight>, t: number): number {
    const out = smoothstep(OWL_CLIMBED_BY, OWL_CLIMBED_BY + OWL_TURN_SHARE, t);
    const back = smoothstep(OWL_DESCEND_AT - OWL_TURN_SHARE, OWL_DESCEND_AT, t);
    return back > 0
      ? flight.travelYaw + angleDelta(flight.travelYaw, flight.landYaw) * back
      : flight.startYaw + angleDelta(flight.startYaw, flight.travelYaw) * out;
  }

  /**
   * **Her body's shape at `t` of a flight**: with her wings open at all, a disc
   * of {@link flightRadius}; folded, the shape she stands in at the end she is
   * low over — her desk's disc, or the story chair's box. Written into one
   * scratch shape.
   */
  private shapeAt(flight: Readonly<Flight>, t: number): Readonly<OwlShape> {
    const shape = owlWingOpening(t) > 0 ? this.wingShape : t < 0.5 ? flight.fromShape : flight.toShape;
    const out = this.shapeScratch;
    out.halfX = shape.halfX;
    out.halfZ = shape.halfZ;
    out.rounding = shape.rounding;
    out.offX = shape.offX;
    out.offZ = shape.offZ;
    return out;
  }

  /** Her body moved to where she is, turned with her, in `shape` — its middle carried round her by her yaw. */
  private placeBody(yaw: number, shape: Readonly<OwlShape>): void {
    const at = this.handle.root.position;
    const middleX = at.x + shape.offX * Math.cos(yaw) + shape.offZ * Math.sin(yaw);
    const middleZ = at.z - shape.offX * Math.sin(yaw) + shape.offZ * Math.cos(yaw);
    this.collision.moveBox(this.body, LIBRARY_ORIGIN_X + middleX, LIBRARY_ORIGIN_Z + middleZ, -yaw, LIBRARY_FLOOR_Y + at.y + this.top, LIBRARY_FLOOR_Y + at.y, shape);
  }

  /**
   * **Would her body at `pose` (room-local feet), turned to `yaw`, in `shape`,
   * touch anybody?** — the child, her pets, the library's children
   * ({@link OwlBystanders}), each an upright cylinder: in plan, closer to her
   * shape than their radius (the shape's box in her own frame, its rounding
   * round it — `CollisionWorld`'s own box), and their heights — with
   * {@link OWL_HEADROOM} over their heads — overlapping hers. The one question
   * that keeps her from ever being drawn inside somebody, asked before every
   * step she takes.
   */
  private wouldTouch(pose: Readonly<RoomPoint>, yaw: number, shape: Readonly<OwlShape>): boolean {
    const cos = Math.cos(yaw);
    const sin = Math.sin(yaw);
    const middleX = LIBRARY_ORIGIN_X + pose.x + shape.offX * cos + shape.offZ * sin;
    const middleZ = LIBRARY_ORIGIN_Z + pose.z - shape.offX * sin + shape.offZ * cos;
    const feet = LIBRARY_FLOOR_Y + pose.y;
    const head = feet + this.top;
    for (const somebody of this.bystanders()) {
      // Into her own frame (her local x across her, z ahead), then to the box's nearest point.
      const dx = somebody.x - middleX;
      const dz = somebody.z - middleZ;
      const lx = dx * cos - dz * sin;
      const lz = dx * sin + dz * cos;
      const ox = Math.max(Math.abs(lx) - shape.halfX, 0);
      const oz = Math.max(Math.abs(lz) - shape.halfZ, 0);
      const reach = shape.rounding + somebody.radius;
      if (ox * ox + oz * oz >= reach * reach) continue;
      // flat-ok: heights in the reading room's own flat space, off the sphere — her feet and head against theirs
      if (somebody.y < head && feet < somebody.y + somebody.height + OWL_HEADROOM) {
        this.waitingForWhat = somebody.what;
        return true;
      }
    }
    return false;
  }

  /** The bubble's tail over the top of her head, wherever she is. */
  private anchorBubble(): void {
    const at = this.handle.root.position;
    this.bubble.anchorAt(at.x, at.y + this.handle.height + OWL_BUBBLE_OVER_HEAD, at.z);
  }
}
