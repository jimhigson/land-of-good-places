import { Vector3, type Group } from 'three';
import { angleDelta, clamp, clamp01, damp, lerp, Rng, smoothstep } from '../../core/mathUtils';
import { PALETTE } from '../../core/palette';
import { PLAYER_RADIUS } from '../../core/constants';
import type { IsoCamera } from '../../core/IsoCamera';
import { gameStore } from '../../state';
import type { Player } from '../../entities/Player';
import type { WallCollider } from '../Collision';
import type { InteriorControls } from '../building/Building';
import { SpeechBubble } from '../../ui/SpeechBubble';
import { lineSeconds } from '../../ui/speechTiming';
import { playSurpriseChime } from '../../ui/chime';
import { createFaceLife, type FaceLife } from '../../art/style/faceLife';
import { visibleReachXZ } from '../../art/style/measure';
import { SpritePuffs } from '../../art/effects/spritePuffs';
import { createLibraryOwl, type OwlHandle } from '../../art/models/libraryCreatures';
import { libraryArmchairSize, libraryBookcaseSize } from '../../art/models/libraryAssets';
import type { LibraryProps } from './props';
import type { FurnishedShelfBook } from './furnish';
import { LIBRARY_LINES } from './libraryLines';
import { giveLibraryCard, hasLibraryCard } from './libraryCard';
import { recommendFor } from './recommendation';
import { isBookRead } from './readBooks';
import { LIBRARY_LIBRARIAN_SPOT, LIBRARY_ORIGIN_X, LIBRARY_ORIGIN_Z, LIBRARY_STORY_CHAIR, pieceToRoom, type StandSpot } from './layout';

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
 * ## Solid
 *
 * Anything drawn is solid. Her solid is **a filled disc of her measured plan
 * reach, head and glasses included, across every pose she holds standing at
 * her desk** ({@link radius}, {@link standingReach} on the built model — never
 * typed), registered through `props.wall(spot, spot, …)`
 * as a zero-length capsule: the one round solid `CollisionWorld` can take out
 * and put back as the same object, which story time needs when she flies
 * (`props.detach` / `attach`, plan Step 9). Its top is her measured height,
 * like every solid's since PR #722: a top is where a jump lands, and a jump
 * that reaches the top of her head lands on it — physics, not a flag.
 * `LIBRARY_LIBRARIAN_SPOT` therefore left `libraryStandSpots()`: it is a place
 * a child bumps into now, not one she must be able to stand on.
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
 * a change of space is running. She says "Shhh!" and raises her **left** wing
 * (the right holds her book), the face goes wide for a moment, and then she
 * waits {@link SHUSH_COOLDOWN_SECONDS} before the next one. **No penalty of
 * any kind** — Jim's rule, and a six-year-old's delight is in making her say
 * it. She shushes from her desk and from the story chair, never on the wing;
 * mid-story only her wing and face answer (a story is a script). Not while the
 * child is in the secret den: that condition is the den track's (#719), which
 * owns `libraryDenContains`.
 *
 * ## Story time (plan Step 9)
 *
 * `storyTime.ts` flies her to the story chair and back ({@link flyTo}): a
 * straight line in plan, eased, over the stacks at her measured cruise
 * ({@link owlFlightPose}, pure, so `check:library`'s FLIGHT measures the very
 * path she flies). Her desk solid is taken out as she takes off and put back
 * when she lands — **never onto a child**: if the child is standing where she
 * lands, it waits until she has stepped out of it ({@link solidWaiting}).
 * She perches on the chair's seat ({@link owlPerch}), where the chair's own
 * solids hold her.
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

/** How long one flight takes, desk to story chair or back (seconds) — the plan's 3.2. */
export const OWL_FLIGHT_SECONDS = 3.2;
/** How far over the stacks' measured top her feet cruise (metres). */
export const OWL_CRUISE_OVER_STACKS = 0.6;
/** She is up at her cruise from this share of a flight … */
export const OWL_CLIMBED_BY = 0.2;
/** … until this one, and then comes down. */
export const OWL_DESCEND_AT = 0.8;
/** Her wings' beat in flight: this far about each wing's own z (radians), at {@link OWL_WING_BEAT_RATE}. */
export const OWL_WING_BEAT = 0.6;
/** How fast her wings beat (radians a second). */
export const OWL_WING_BEAT_RATE = 9;
/**
 * How far back of the story chair's seat centre she sits (metres, along the
 * chair's own −Z, into it): measured, so that her face and glasses stay over
 * the chair's seat, inside its solids, where a child standing at the chair's
 * front cannot touch them — on the seat centre itself they reach 8 cm past
 * its front edge. `check:library`'s STORY measures her perched.
 */
export const OWL_PERCH_BACK = 0.12;

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
 * very line she flies. In plan, straight from `from` to `to`, eased in and out
 * (`s = smoothstep(0, 1, t)`); in height, the line between the two ends'
 * heights lifted to `cruise` by a bump that rises by {@link OWL_CLIMBED_BY}
 * and falls from {@link OWL_DESCEND_AT}, so she is up over the stacks for the
 * middle of the flight and comes down almost straight onto where she lands.
 * Writes `out` (allocating nothing) and returns it.
 */
export function owlFlightPose(
  from: Readonly<RoomPoint>,
  to: Readonly<RoomPoint>,
  t: number,
  out: RoomPoint = { x: 0, y: 0, z: 0 },
  cruise: number = owlCruiseHeight(),
): RoomPoint {
  const u = clamp01(t);
  const s = smoothstep(0, 1, u);
  out.x = lerp(from.x, to.x, s);
  out.z = lerp(from.z, to.z, s);
  const base = lerp(from.y, to.y, s);
  const bump = smoothstep(0, OWL_CLIMBED_BY, u) * (1 - smoothstep(OWL_DESCEND_AT, 1, u));
  out.y = base + (cruise - base) * bump;
  return out;
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
/** Her bubble's tail points this far over the top of her head. */
const BUBBLE_OVER_HEAD = 0.42;
/**
 * The hand-over: sparkles over her, and two quick flaps of the wing that holds
 * her book — **forward**, over her desk (`wingR.rotation.x`, the shush wing's
 * own axis), the book lifted toward the child across it. Forward rather than
 * out to her side because her wings are drawn and her solid is not a wing: a
 * sideways flap swings the wing 0.9 m from her middle, 0.24 m past her solid,
 * at her west side, where a child can stand against her (measured); forward,
 * every point past her solid is over the desk, where nobody can. `check:library`
 * measures the drawn owl at her widest, live, on both wings.
 */
const CARD_SPARKLES = 6;
const FLAP_SECONDS = 0.8;
/** How far the book wing lifts forward at the top of each flap (radians about its pivot; negative is forward). */
export const CARD_FLAP_LIFT = 0.9;
/** How many sprites the one pool holds — enough for the card's six and a twinkle pair or two in flight. */
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
   * {@link radius}, top at her measured height) registered as `'the owl'`.
   * Story time (plan Step 9) takes it out as she takes off and puts the same
   * object back as she lands (`props.detach` / `props.attach`).
   */
  readonly capsule: WallCollider;
  /** Her speech bubble — `actionFeedback` for {@link OWL_ZONE_ID}, so it outranks her own chip. */
  readonly bubble: SpeechBubble;
  /** Where she stands: `LIBRARY_LIBRARIAN_SPOT`, room-local, with her facing. */
  readonly spot: StandSpot = LIBRARY_LIBRARIAN_SPOT;

  private readonly roomRoot: Group;
  private readonly controls: InteriorControls;
  private readonly shelfBooks: readonly FurnishedShelfBook[];
  private readonly face: FaceLife;
  private readonly puffs: SpritePuffs;
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
  /** Landed at her desk with the child standing where her solid goes: it goes back once she has stepped out. */
  private solidWaitingFlag = false;
  private readonly props: LibraryProps;
  private readonly pose: RoomPoint = { x: 0, y: 0, z: 0 };

  constructor(roomRoot: Group, props: LibraryProps, shelfBooks: readonly FurnishedShelfBook[], controls: InteriorControls) {
    this.roomRoot = roomRoot;
    this.controls = controls;
    this.shelfBooks = shelfBooks;
    this.props = props;

    this.handle = createLibraryOwl();
    // Measured before she is moved: her reach about her own origin, in her own frame.
    this.radius = standingReach(this.handle);
    this.handle.root.position.set(this.spot.x, 0, this.spot.z);
    this.handle.root.rotation.y = (this.spot.facing * Math.PI) / 180;
    roomRoot.add(this.handle.root);
    this.capsule = props.wall('the owl', this.spot, this.spot, this.radius, this.handle.height);

    this.bubble = new SpeechBubble({ id: 'library-owl-says', item: OWL_ZONE_ID, kind: 'actionFeedback' }, PALETTE.markerLilac);
    roomRoot.add(this.bubble.sprite);
    this.anchorBubble();

    this.puffs = new SpritePuffs(roomRoot, PUFF_POOL, PALETTE.fairyWarm, 0.3);
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

  /** Back at her desk with her solid still out, waiting for the child to step out of where it goes. */
  get solidWaiting(): boolean {
    return this.solidWaitingFlag;
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
   * desk (`home`). From wherever she is: her desk (her solid is taken out as
   * she takes off), the chair, or mid-flight (she turns round where she is).
   */
  flyTo(home: boolean): void {
    const root = this.handle.root;
    if (this.atDeskFlag) {
      this.props.detach([this.capsule]);
      this.atDeskFlag = false;
    }
    this.solidWaitingFlag = false;
    this.perchedFlag = false;
    const perch = owlPerch();
    const to: RoomPoint = home ? { x: this.spot.x, y: 0, z: this.spot.z } : { x: perch.x, y: perch.y, z: perch.z };
    const landYaw = ((home ? this.spot.facing : perch.facing) * Math.PI) / 180;
    const from: RoomPoint = { x: root.position.x, y: root.position.y, z: root.position.z };
    const travelYaw = Math.atan2(to.x - from.x, to.z - from.z);
    this.flight = { from, to, startYaw: root.rotation.y, landYaw, travelYaw, t: 0, home };
  }

  /**
   * **Back behind her desk at once** — story time abandoned, or the child
   * gone: no flight, no perch, her solid back (it is waited for only while the
   * child stands in it; with her gone, it goes straight back).
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
    this.solidWaitingFlag = false;
    this.props.attach([this.capsule]);
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
   * the room flashes, a chime plays, sparkles rise over the owl and she flaps
   * the wing that holds her book. The hotel's check-in is the precedent.
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
    const at = this.handle.root.position;
    this.puffs.puff(at.x, at.y + this.handle.height + 0.3, at.z, this.fx, CARD_SPARKLES);
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
    this.putSolidBack(player);
    this.updateSpeech(dt);
    this.noticeShush(player, dt, changing);
    this.live(dt, elapsed, player);
    this.glow(dt, elapsed);
    this.puffs.update(dt);
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

    wingL.rotation.x = damp(wingL.rotation.x, this.shushFor > 0 ? SHUSH_WING_X : 0, WING_HALF_LIFE, dt);
    // On the wing they beat (`updateFlight` writes them); landed, they fold back.
    if (!this.flight) {
      wingL.rotation.z = damp(wingL.rotation.z, 0, WING_HALF_LIFE, dt);
      wingR.rotation.z = damp(wingR.rotation.z, 0, WING_HALF_LIFE, dt);
    }
    if (this.flapFor > 0) {
      this.flapFor = Math.max(0, this.flapFor - dt);
      const t = (FLAP_SECONDS - this.flapFor) / FLAP_SECONDS;
      // Two flaps over the flap's time; negative lifts the book wing forward, over the desk.
      wingR.rotation.x = -Math.abs(Math.sin(t * Math.PI * 2)) * CARD_FLAP_LIFT;
    } else {
      wingR.rotation.x = damp(wingR.rotation.x, 0, WING_HALF_LIFE, dt);
    }
  }

  /**
   * **The recommended book glows until it is read.** Its own cover material's
   * emissive (`createShelfBook` sets the emissive to the cover's colour at
   * intensity 0) breathes between {@link GLOW_BASE} and `GLOW_BASE +
   * GLOW_SWING`, and a pair of warm twinkles rises off it every
   * {@link TWINKLE_EVERY} seconds. Every other book reads 0 — written only on
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
    }
    if (wanted === null) return;
    const placed = this.shelfBooks.find((candidate) => candidate.book.id === wanted);
    if (!placed) return;
    placed.material.emissiveIntensity = GLOW_BASE + GLOW_SWING * (0.5 + 0.5 * Math.sin(elapsed * GLOW_RATE));
    this.twinkleIn -= dt;
    if (this.twinkleIn > 0) return;
    this.twinkleIn = TWINKLE_EVERY;
    // The book's spot in the room's frame: a stack's book rides its stack's group, a wall case's the room.
    const at = placed.mesh.getWorldPosition(this.scratch);
    this.roomRoot.worldToLocal(at);
    this.puffs.puff(at.x, at.y + TWINKLE_RISE, at.z, this.fx, 2);
  }

  /**
   * One frame of a flight: her feet on {@link owlFlightPose}; she turns from
   * her facing to the way she travels as she climbs, and to her landing
   * facing as she comes down; her wings beat, opening as she lifts off and
   * folding as she lands. On landing: perched, or home — where her solid goes
   * back ({@link putSolidBack}).
   */
  private updateFlight(dt: number, elapsed: number): void {
    const flight = this.flight;
    if (!flight) return;
    flight.t = Math.min(1, flight.t + dt / OWL_FLIGHT_SECONDS);
    const { root, wingL, wingR, head } = this.handle;
    owlFlightPose(flight.from, flight.to, flight.t, this.pose);
    root.position.set(this.pose.x, this.pose.y, this.pose.z);
    const climb = smoothstep(0, OWL_CLIMBED_BY, flight.t);
    const land = smoothstep(OWL_DESCEND_AT, 1, flight.t);
    const yaw =
      land > 0
        ? flight.travelYaw + angleDelta(flight.travelYaw, flight.landYaw) * land
        : flight.startYaw + angleDelta(flight.startYaw, flight.travelYaw) * climb;
    root.rotation.y = yaw;
    head.rotation.y = damp(head.rotation.y, 0, HEAD_TURN_HALF_LIFE, dt);
    const open = smoothstep(0, 0.1, flight.t) * (1 - smoothstep(0.92, 1, flight.t));
    const beat = Math.sin(elapsed * OWL_WING_BEAT_RATE) * OWL_WING_BEAT * open;
    wingL.rotation.z = beat;
    wingR.rotation.z = -beat;
    if (flight.t < 1) return;
    this.flight = null;
    root.rotation.y = flight.landYaw;
    if (flight.home) {
      this.atDeskFlag = true;
      this.solidWaitingFlag = true;
    } else {
      this.perchedFlag = true;
    }
  }

  /**
   * **Her desk solid back — never onto a child.** Landed home, her solid goes
   * back the first frame the child is not standing where it goes (a body of
   * her size clear of its disc); until then she stands drawn but not solid
   * where the child is, rather than the child being shoved out of a collider
   * that appeared round her.
   */
  private putSolidBack(player: Player): void {
    if (!this.solidWaitingFlag) return;
    const apart = Math.hypot(player.position.x - (LIBRARY_ORIGIN_X + this.spot.x), player.position.z - (LIBRARY_ORIGIN_Z + this.spot.z));
    if (apart < this.radius + PLAYER_RADIUS) return;
    this.props.attach([this.capsule]);
    this.solidWaitingFlag = false;
  }

  /** The bubble's tail over the top of her head, wherever she is. */
  private anchorBubble(): void {
    const at = this.handle.root.position;
    this.bubble.anchorAt(at.x, at.y + this.handle.height + BUBBLE_OVER_HEAD, at.z);
  }
}
