import { Group, Vector3 } from 'three';
import {
  CAMERA_YAW_DEGREES,
  PLAYER_ACCELERATION,
  PLAYER_BOB_CYCLES_PER_METRE,
  PLAYER_BOB_HEIGHT,
  PLAYER_DECELERATION,
  PLAYER_MAX_SPEED,
  PLAYER_RADIUS,
  PLAYER_SPRINT_MULTIPLIER,
  PLAYER_TURN_SPEED,
} from '../core/constants';
import { clamp01, damp, DEG, lerp, smoothstep, TAU, turnTowards } from '../core/mathUtils';
// The pose itself, for `animate` to apply. A `export … from` re-export does not
// create a local binding, so this file imports what it uses like anybody else.
import { applyRidePose, type RidePosture } from './ridePose';
import type { FrameContext, GameSystem } from '../core/types';
import type { IsoCamera } from '../core/IsoCamera';
import type { CollisionWorld } from '../world/Collision';
import { terrainHeight } from '../world/terrain';
import { CharacterModel } from './CharacterModel';
import { createGlasses } from '../art/models/glasses';
import { createFaceLife, type FaceLife } from '../art/style/faceLife';
import { poseRailRaceRider, type RiderPose } from '../world/railRace/duckPose';
import { createRainbowRings, type RainbowRings } from '../art/effects/rainbowRing';
import { createDustPuffs, type DustPuffs } from '../art/effects/dustPuff';
import { disposeTree } from '../art/style/materials';
import { NameLabel } from '../ui/NameLabel';
import { discoverSecret, gameStore, type PlayerState } from '../state';
import type { WornHat } from './WornHat';
import type { WornJetpack } from './WornJetpack';

/**
 * How fast counts as *running*, in metres per second.
 *
 * GAME_DESIGN.md: *"only while running, not walking, so running feels
 * different rather than just faster"* — so this is the line between the two,
 * and it is a speed rather than `input.isDown('sprint')` on purpose. Holding
 * sprint while wading through the fountain (which sets `speedMultiplier` to
 * ~0.6) is not running, and neither is the first moment of a sprint before
 * `PLAYER_ACCELERATION` has got her anywhere. What kicks up dust is going
 * fast, which is also the only version of the rule a child can see.
 *
 * Sits between a flat-out walk (`PLAYER_MAX_SPEED`, 7.4) and a flat-out
 * sprint (× `PLAYER_SPRINT_MULTIPLIER`, 11.1), nearer the walk so the dust
 * starts early in the sprint rather than only at the very top of it.
 */
const DUST_SPEED = PLAYER_MAX_SPEED * 1.12;

/**
 * How much of the stride cycle one puff of dust covers.
 *
 * A quarter of it — so **two puffs per foot**, one as it lands and one part
 * way through it carrying her weight. It was half a cycle (one puff per foot)
 * and the family wanted about twice as much dust; doing it by shortening this
 * rather than by making the puffs bigger or longer-lived keeps every puff the
 * size and life it already had, which is what was asked for.
 *
 * Which side a puff comes off is still decided per *foot* rather than per
 * puff — see {@link Player.spawnRunningDust} — or the two trails would zip
 * back and forth across each other instead of being two lines.
 */
const DUST_STRIDE = Math.PI / 2;

/** How far behind her heels a puff is dropped, in metres. */
const DUST_TRAIL = 0.3;
/** And how far to the side, so the two feet leave two lines of dust. */
const DUST_STANCE = 0.14;

/**
 * Tuned so the jump clears the low garden walls but not the tall ones (design
 * feedback #10 — "jump over walls").
 *
 * `JUMP_SPEED` gives an algebraic apex of `JUMP_SPEED² / (2·GRAVITY)` ≈ 1.28 m.
 * **That is not how tall a wall it gets you over**, and the arithmetic that
 * used to be written here (apex + `JUMP_CLEARANCE_GRACE` = 1.43 m, "comfortably
 * over every wall ≤ 1.4 m") was wrong in three separate ways at once — see
 * `Collision.ts`'s `MAX_AUTO_HOP_HEIGHT`, which carries the measured answer
 * (1.00 m, against a measured limit of 1.07–1.10 m) and the reasons. Buildings
 * and tree trunks stay `Infinity` (unjumpable) — see `Collision.ts`.
 */
const JUMP_SPEED = 6.6;
const GRAVITY = 17;

/**
 * The height a jump actually reaches, in metres — the ≈1.28 m the doc above
 * derives `JUMP_SPEED` from. Shared with the auto-hop check below so "would
 * an automatic hop clear this?" asks the exact same question the manual jump
 * already answers, rather than a second, independently-tuned number that
 * could quietly drift out of step with it.
 *
 * Exported for the same reason, one consumer further out: `world/NavGrid.ts`
 * leaves a wall this clears out of the walkable map altogether, so that
 * tap-to-move hops a low garden wall instead of routing the long way round it.
 * All three questions are answered by `Collision.ts`'s `autoHopClears` from
 * this one number.
 */
export const JUMP_APEX_HEIGHT = (JUMP_SPEED * JUMP_SPEED) / (2 * GRAVITY);

/**
 * The ride pose now lives in `./ridePose.ts`, and everything it used to export
 * from here is re-exported below so that no importer had to move.
 *
 * It left because the cat bus needs it and **cannot import this file**: this one
 * reaches `world/terrain`, which reaches `PARK_BOUNDARY`, and the ride's whole
 * job is to be on screen before the park has been solved. See that file's
 * header. `Player` is still the only thing that *drives* the pose; it is simply
 * no longer the only thing allowed to know what one is.
 */
export {
  applyRidePose,
  CLIMB_WAVE_ARM_X,
  CLIMB_WAVE_ARM_Z,
  CLIMB_WAVE_HEAD_PITCH,
  CLIMB_WAVE_LEAN,
  CLIMB_WAVE_LEAN_RATE,
  WAVE_WAGGLE,
  type RidePoseTarget,
  type RidePosture,
} from './ridePose';

/**
 * How far ahead — in the direction actually being walked — the auto-hop
 * feature (design feedback #30e) looks for a wall it could jump. Small: this
 * only needs to fire a moment before contact, not give a long run-up, and a
 * bigger number would hop over things well before they were ever really in
 * the way.
 */
const AUTO_HOP_LOOKAHEAD = 0.5;

/** Drop further than this below the surface under your feet and you fall. */
const FALL_THRESHOLD = 0.5;

/**
 * ---------------------------------------------------------------------------
 * THE JET PACK
 * ---------------------------------------------------------------------------
 * Eleri's own ask, in her words: *"Button to use it next to the jump button and
 * then you fly and control where you fly instead of walking."* It started as a
 * second button beside jump; Jim's follow-up request moved it onto jump itself
 * — one control to learn instead of two, and nothing to press "blind".
 *
 * **One button, one rule, no explaining.** Tap jump and she hops, exactly as
 * she always could, pack or no pack. Hold it — past {@link JETPACK_HOLD_THRESHOLD},
 * so a normal tap can never be mistaken for one — and, with a pack on her back
 * and room to use it, the hop turns into a climb. Let go and gravity takes over
 * immediately: there is no separate "come down" input, because there is nothing
 * to press to make gravity happen. Touch the ground and she is walking again.
 *
 * ### Why a hold threshold instead of reading the button instantly
 *
 * `jump` alone can't tell a tap from the first frame of a hold — both look
 * identical the instant the button goes down. So every press starts as an
 * ordinary hop, and only once it is still held {@link JETPACK_HOLD_THRESHOLD}
 * later does the arc she is already rising through turn into a climb, smoothly
 * — see {@link update}. Short enough that holding reads as instant, long enough
 * that even an eager stab at the button never accidentally ignites the pack.
 *
 * ### It obeys the CONTROL RULE, which is what most of this is about
 *
 * Steering in the air is the *same code* as steering on the ground: the
 * camera's ground basis from `core/screenBasis.ts`, straight out of
 * `this.moveDirection` above, with no branch for flight at all. Press left and
 * she goes left, in the air exactly as on foot. **Nothing rotates to turn**, and
 * her facing is written from the direction she ended up travelling — decoration,
 * never an input.
 *
 * ### And nobody can get stuck (the EXIT RULE's spirit)
 *
 * - Letting go always falls her towards whatever is under her feet *right
 *   now*, sampled through the same {@link Player.groundAt} the walk uses — so
 *   she lands on the deck, the stair tread or the grass, whichever is really
 *   there.
 * - Collision keeps running while she flies, with `clearance` set to her height
 *   above the local ground. That is the existing wall-clearing machinery, not a
 *   new one: fly high and a low wall stops pushing back, fly low and it pushes
 *   exactly as it always did, and a tree trunk or a building (`topHeight:
 *   Infinity`) never stops pushing at any height. **So the spot she comes down
 *   on is always a spot she was allowed to be**, and she cannot land inside
 *   anything.
 * - The collision world's own circular soft boundary applies unchanged, so she
 *   cannot fly out of the park, and {@link Player.flyCeiling} stops her leaving
 *   the top of it.
 * - Taking the pack off mid-air does not drop her: it takes the *thrust* away,
 *   and — same as letting go of the button — she finishes the descent under
 *   gravity instead.
 */
const FLY_RISE_SPEED = 4.4;

/** How briskly the climb gets up to speed. Snappy, not instant. */
const FLY_VERTICAL_ACCELERATION = 24;

/**
 * How long `jump` must stay down, past the frame it was pressed, before it
 * reads as "hold to fly" rather than a tap.
 *
 * A normal hop off this button already takes the better part of a second
 * (see `JUMP_APEX_HEIGHT`'s own comment) so there is no risk of this making a
 * deliberate hold feel late — it just needs to comfortably outlast the
 * fastest tap a six-year-old's thumb can manage, which is well under a tenth
 * of a second.
 */
const JETPACK_HOLD_THRESHOLD = 0.16;

/**
 * How high above the ground under her feet she may fly, out in the park.
 *
 * High enough to look down on the whole thing — the castle's lower storeys, the
 * tops of the trees — and low enough that coming home is never a chore.
 */
export const PARK_FLY_CEILING = 12;

/**
 * And how high indoors — which is also how "you cannot fly in here" is said.
 *
 * A castle floor is `BUILDING_FLOOR_HEIGHT` (3.6 m) below the one above it and
 * there is **no ceiling collider up there**: nothing would stop her going
 * through the slab, and a child inside the deck above has nothing to land on
 * that she chose. She is `KID_HEIGHT` (2.12 m) tall and `position` is her feet,
 * so this leaves the better part of a third of a metre of headroom.
 *
 * It does two jobs, and that is deliberate rather than a coincidence worth
 * separating into two fields:
 *
 * 1. It is the **sentinel** {@link Player.canFlyHere} compares against, so the
 *    castle refuses a take-off outright and holding jump indoors is just a
 *    hop, nothing more. The jet pack is an outdoors thing, everywhere,
 *    consistently — rather than a full flight in the park and a puzzling
 *    one-metre hover indoors that nothing tells you is even possible.
 * 2. It stays the **backstop** for a flight already in the air if the space
 *    under her ever changes, which is what it was written for.
 *
 * `world/building/Building.ts` is what writes it — see `Player.flyCeiling`.
 */


export const INDOOR_FLY_CEILING = 1.2;

/** Metres of soft approach to the ceiling, so it eases rather than clunks. */
const FLY_CEILING_EASE = 2.5;

/** Thrust shown on the pack while falling with the button released — a pilot
 * light, not a climb. */
const FLY_IDLE_THRUST = 0.3;


/**
 * The beats of the flower-picking flourish, in seconds from the pick — see
 * {@link Player.pickFlower}.
 *
 * The family asked for *bend, pick, smell*, and the whole thing is over in a
 * little over a second on purpose. A six-year-old picks a great many flowers;
 * at three seconds the third one would already be a thing she was waiting
 * through. She is never stopped from walking during it in any case — the pose
 * simply gives way (see {@link Player.applyFlowerPick}) — so this is how long
 * the flourish lasts when she chooses to stand and watch it.
 */
const PICK_BEND_IN = 0.24;
const PICK_PLUCK = 0.28;
const PICK_PLUCK_END = 0.42;
const PICK_RISE_END = 0.66;
const PICK_SNIFF_IN = 0.7;
const PICK_SECONDS = 1.1;

/**
 * Above this fraction of top speed the flourish is gone entirely.
 *
 * Not a hard cancel at the first twitch of the stick: a tap-to-walk pick
 * arrives with the character still decelerating (`gait` is damped), so a
 * zero-tolerance rule would throw the flourish away on the very frame it
 * started, every single time a flower was tapped rather than walked up to.
 * Below this the pose fades in as she settles; above it, she is walking away
 * and it fades out over a couple of frames.
 */
const PICK_WALK_AWAY = 0.38;

/**
 * Answers "how high is the ground at this point?" for a character standing at
 * height `y`.
 *
 * The default is `terrainHeight`, but the building installs its own so that
 * decks, stairs, escalators, lifts and the floating bubble all become walkable
 * without the player knowing anything about them. Passing the walker's current
 * height is what lets the same point mean "deck three" or "the grass" depending
 * on where they came from.
 */
export type GroundSampler = (x: number, z: number, y: number) => number;

/**
 * The player character: movement, collision, and the walk animation.
 *
 * Movement is camera-relative — pushing the stick "up" always walks up the
 * screen, whichever of the four isometric views is active — and velocity is
 * accelerated towards the target rather than snapped, so starting and stopping
 * has a bit of weight to it.
 *
 * The walk cycle is driven by *distance travelled*, not by time. That is what
 * stops the legs skating: at half speed the character takes half as many steps
 * over the same ground, exactly as it should.
 */
export class Player implements GameSystem {
  readonly name = 'player';
  readonly group = new Group();
  /**
   * Not `readonly` — see {@link replaceModel}, the HUD's "Look" pill's whole
   * reason for existing: changing your look used to mean reloading the page
   * and rebuilding the entire park from scratch, because there was no way to
   * hand this a new one in place.
   */
  model: CharacterModel;
  readonly label: NameLabel;

  /**
   * The rainbow that flicks out from under her feet on every hop.
   *
   * Deliberately **not** a child of `this.group`: the ring is left behind in the
   * world where the jump happened, so parenting it to the character would drag
   * it along and spin it. It attaches itself to whatever the player was added
   * to, the first time it is needed — which keeps the wiring inside this class
   * instead of spreading a new field through Game and World.
   */
  readonly hopRings: RainbowRings = createRainbowRings();

  /**
   * Puffs of dust off her heels while she runs. Parented to the world beside
   * `hopRings`, and for the same reason: a puff belongs to the patch of ground
   * it was kicked off, not to the girl who is already several metres past it.
   */
  readonly dust: DustPuffs = createDustPuffs();

  /** Feet position in world space. */
  readonly position = new Vector3();
  readonly velocity = new Vector3();

  /**
   * Where the ground is. Left `null` the character walks on the terrain; the
   * building swaps in its own so the decks, stairs, lift and bubble are solid.
   */
  groundSampler: GroundSampler | null = null;

  /**
   * The system that draws whatever hat is currently worn — left `null` until
   * `Game` wires it up (it is built just after `Player`, from
   * `this.model.hatAnchor`; see `Game.ts`). Read only to size the name label
   * so it clears the hat instead of sitting at a fixed bare-head height.
   */
  wornHat: WornHat | null = null;

  /**
   * The system that draws the jet pack, if one is on her back — left `null`
   * until `Game` wires it up, exactly like {@link wornHat}. Read for two
   * things: whether she may take off at all, and where to send the thrust so
   * the painted flames light while she climbs.
   */
  wornJetpack: WornJetpack | null = null;

  /**
   * How high above the ground under her feet she may fly, in metres.
   *
   * {@link speedMultiplier}'s sibling, and written by the same sort of caller:
   * whichever system currently owns the ground underfoot. `Building` drops it
   * to a hover indoors, because a castle floor is 3.6 m from the one above it
   * and there is no ceiling collider up there to stop her — a child who flew
   * through a slab would be inside the deck above with nothing to land on that
   * she chose. Out in the park it stays at {@link PARK_FLY_CEILING}.
   *
   * One frame stale by construction, the same tolerance `hopClearance` and
   * `speedMultiplier` already document.
   */
  flyCeiling = PARK_FLY_CEILING;

  private readonly desiredVelocity = new Vector3();
  private readonly moveDirection = new Vector3();
  /**
   * Where she was when this frame's movement started — so `previousPosition →
   * position` is the *line she walked this frame*, not just the point she
   * ended on.
   *
   * Public because a walk-through trigger needs the line rather than the
   * point: a doorway sampled once a frame is a doorway a long frame steps
   * clean over (`tapSpacing.ts`'s `bandCrossed`, the same reasoning
   * `CollisionWorld.resolveMovement` applies to walls). It is read after
   * `Game.ts` has run `player.update()` — step 2, before `world.update()` at
   * step 4 — so what a trigger sees is this frame's own resolved movement.
   *
   * **Every teleport collapses it onto the destination** (`teleportTo`,
   * `setRidePose`, the constructor), which is what makes a swept test against
   * it safe for free: a change of space leaves a zero-length segment, not a
   * six-hundred-metre one sweeping through every door in the game. That
   * property is load-bearing — do not add a way of moving her that skips it.
   */
  readonly previousPosition = new Vector3();
  /** Scratch point for the auto-hop lookahead — see `wouldAutoHopClear` below. */
  private readonly hopProbe = new Vector3();

  /** Start facing the camera, so the first thing you see is her face. */
  private facingAngle = CAMERA_YAW_DEGREES * DEG;
  private walkPhase = 0;
  /** Last frame's `walkPhase`, so a footfall can be spotted as it is crossed. */
  private previousWalkPhase = 0;
  /** 0 = standing still, 1 = flat out. Smoothed, drives animation blending. */
  private gait = 0;
  private verticalVelocity = 0;
  private airborne = false;
  /**
   * Seconds `jump` has been held since it last went down, while she is not
   * yet flying — reset on every fresh press and every landing. Compared
   * against {@link JETPACK_HOLD_THRESHOLD} in {@link update} to tell a hold
   * from a tap; irrelevant once {@link flying} is true, when `isDown('jump')`
   * is read directly every frame instead.
   */
  private jumpHeldFor = 0;
  /**
   * True while the jet pack is holding her up — a strict subset of
   * {@link airborne}, so everything that already asks "is she off the ground?"
   * (the parade's copycat hop, the flower flourish, the dust) gets the right
   * answer for flight without being told about it.
   *
   * Only ever *entered* with a pack worn, and only ever left by touching the
   * ground. Taking the pack off mid-air therefore takes the thrust away
   * rather than the flight: `canFlyHere` goes false, thrust stops, and she
   * finishes her descent under gravity, same as letting go of the button.
   */
  private flying = false;
  /** 0..1, eased, so the flying pose fades on and off rather than snapping. */
  private flightPose = 0;
  /**
   * How high the feet are above the local ground right now — 0 while
   * walking, positive mid-jump. Fed into `collision.resolve` as `clearance`
   * so a jump can sail over a low wall (see `Collision.ts`); one frame stale
   * by construction (this frame's value is only known after this frame's
   * collision pass), which is well inside `JUMP_CLEARANCE_GRACE`.
   */
  private hopClearance = 0;

  /**
   * How she holds herself while a ride owns her.
   *
   * Set by the ride, reset to `'seated'` on every `beginRide`/`endRide` so it
   * can never leak from one ride into the next. Only the ginormous slide asks
   * for `'reclined'`, and only the cat-bus arrival asks for `'walking'` — see
   * {@link applyRidePose}, which owns what each posture means.
   *
   * A flag on the rider rather than the ride reaching in and turning her parts:
   * `update` rewrites this pose every frame while riding, so anything set from
   * outside would be overwritten within one frame and look like it had been
   * ignored.
   */
  ridePosture: RidePosture = 'seated';
  /**
   * How fast a `'walking'` posture should *look* like it is going, in metres a
   * second. Written by the sequence that is walking her; see
   * {@link setScriptedWalk}.
   */
  private scriptedWalkSpeed = 0;
  /** Edge-detects "just cleared a wall" so the poof effect fires once, not every frame. */
  private wasClearingWall = false;
  /**
   * True while an escort out of a deep overlap is still running — see the
   * velocity read-back in `update`.
   *
   * Being walked back out of something is a *process*, several frames long,
   * and only its first frames are deep enough for `resolve` to call them an
   * escort. Latching it here, and holding it until the corrections stop
   * altogether, is what stops the shallow tail of an escort being mistaken
   * for ordinary contact and banked as speed.
   */
  private escorting = false;
  /** Blinks, on the beat every face in the game shares. See `faceLife.ts`. */
  private readonly face: FaceLife;
  private ridingFlag = false;
  /** 0..1 of the tree-climb wave. See {@link setClimbWave}. */
  private climbWave = 0;
  /**
   * Seconds into the flower-picking flourish, or `-1` when there is none.
   *
   * See {@link pickFlower} and {@link applyFlowerPick}.
   */
  private pickTime = -1;
  /** True while the flourish is at the sniff — makes her smile. */
  private smelling = false;

  /**
   * Multiplies the speed limit below — 1 normally. The fountain sets this to
   * ~0.6 while the player's feet are in its water (see `Fountain.ts`), so
   * wading feels like wading without this class knowing anything about water.
   * Read once per frame here; written externally by whichever system
   * currently owns the ground underfoot. One frame stale by construction,
   * the same tolerance `hopClearance` already documents above.
   */
  speedMultiplier = 1;

  /**
   * True while some other system wants the face to read happy without
   * fighting the blink state machine in `animate()` — the fountain sets this
   * while the player is standing in its water.
   */
  waterHappy = false;

  /**
   * True while some other system wants the face to read a frown without
   * fighting the blink state machine in `animate()` — the Rail Race sets this
   * for the moments a bonk's wobble is still fresh, and while she is actively
   * holding through a sparking black stretch. See `RailRace.driveRiders`.
   */
  railRaceFrown = false;

  /**
   * True while she is asleep — **eyes shut, and staying shut**.
   *
   * Jim, live play, 21 Aug 2026, of the hotel suite's nap: *"the player's
   * character doesn't close their eyes when in bed."* `Hotel.nap` really did
   * call `setExpression('blink')` — and it was overwritten by `animate()`
   * within a single frame, because {@link face} rewrites the face from its own
   * blink clock every frame and knows nothing about anybody else's one-shot
   * call. That is the same trap {@link railRaceFrown} and
   * {@link ridePosture} both exist to avoid, so this is the same shape: a flag
   * the frame reads, not a call that races the frame.
   *
   * It feeds the **resting** face rather than bypassing the blink clock, and
   * that is the whole trick — a blink *is* shut eyes (`art/style/faces.ts`),
   * so resting on `'blink'` holds them shut and the clock's own blinks punch
   * through as a no-op. No new mechanism, no second eye-closing path to keep
   * in step with the one every other face in the park uses.
   *
   * Reset by {@link beginRide} and {@link endRide} alongside
   * {@link ridePosture}, so it can never leak out of the bed and follow her
   * round the park asleep on her feet.
   */
  sleeping = false;

  /**
   * `null` when she is not on the Rail Race; otherwise everything the ride
   * wants her body doing this frame — see `RiderPose` in `railRace/duckPose.ts`.
   *
   * A field rather than the ride posing her directly, for the same reason
   * {@link railRaceFrown} is one: `animate()` below rewrites `body.rotation.x`,
   * `body.position.y`, `body.scale`, `head.rotation.x` and both legs every
   * single frame, so anything the ride set from outside would be stamped over
   * before it was ever drawn.
   *
   * **A whole pose rather than a single duck amount** because four separate
   * things now want `body.rotation.x` — sitting, ducking, the boost rock and the
   * win jump. Handing them over one at a time is how they end up fighting; the
   * ride states all of them and `poseRailRaceRider` writes the property once.
   *
   * **`null` rather than 0** because being *aboard* is the state that matters:
   * a rider is sat down for the whole ride, not only while ducking. Setting it
   * back to `null` in `RailRace.arrive()` is all the restoring that is needed —
   * `animate()`'s own walk pose owns every one of those transforms again from
   * the very next frame, so there is no list of what-was-changed to lose track
   * of. (`TreeClimbing.hidePlayerBody` kept such a list, got it wrong, and left
   * her a floating head on every ride in the park until it was deleted today.)
   */
  railRaceRide: RiderPose | null = null;

  private readonly collision: CollisionWorld;
  private readonly camera: IsoCamera;

  constructor(
    collision: CollisionWorld,
    camera: IsoCamera,
    spawn: Vector3,
  ) {
    this.collision = collision;
    this.camera = camera;
    this.group.name = 'player';

    const playerState = gameStore.get().player;
    this.model = this.buildModel(playerState);
    // One blink clock, shared with every other face in the game.
    this.face = createFaceLife((expression) => this.model.setExpression(expression));
    this.group.add(this.model.root);

    this.label = new NameLabel(playerState.name);
    this.label.sprite.position.y = this.labelTopHeight() + 0.42;
    this.group.add(this.label.sprite);

    this.position.copy(spawn);
    this.position.y = terrainHeight(spawn.x, spawn.z);
    this.previousPosition.copy(this.position);
    this.group.position.copy(this.position);
  }

  /**
   * Builds a fresh {@link CharacterModel} (and its glasses, if any) from a
   * `PlayerState` slice — the constructor's own model-building, pulled out
   * so {@link replaceModel} can do exactly the same thing later without a
   * second copy of the field mapping to drift out of step with the first.
   *
   * Glasses are attached here directly rather than through a live setter:
   * `CharacterModel` has none for them (see its own `glassesAnchor` doc
   * comment — "glasses are never sold, so nothing ever changes this
   * mid-game" was true right up until the Look pill stopped reloading the
   * page to get a new one).
   */
  private buildModel(playerState: PlayerState): CharacterModel {
    const model = new CharacterModel(
      {
        skin: playerState.skinColour,
        hair: playerState.hairColour,
        outfit: playerState.outfitColour,
        outfitArms: playerState.outfitArmsColour,
        shoe: playerState.shoeColour,
      },
      {
        hairStyle: playerState.hairStyle,
        eyeColour: playerState.eyeColour,
        backpackKind: playerState.backpackKind,
        backpackColour: playerState.backpackColour,
        shoeKind: playerState.shoeKind,
      },
    );
    if (playerState.glassesKind) {
      model.glassesAnchor.add(createGlasses(playerState.glassesKind).root);
    }
    return model;
  }

  /**
   * Rebuilds this character's own model in place from `playerState` — the
   * HUD's "Look" pill, by way of `Game.applyLiveLook`, so a new hairstyle,
   * colour or hat no longer means reloading the page and rebuilding the
   * whole park (`main.ts`'s old `reopenCharacterCreation` path). The old
   * model is fully torn down first; `model.root`, `hatAnchor`,
   * `glassesAnchor` and every other anchor on it are gone the moment this
   * returns, which is why every system that reached into one of them at
   * construction time (`WornFlower`, `WornHat`, `WornJetpack`, the shop's
   * `CarriedItem`/`EatenTreat`, the parade's `BackpackPeek`, the face-paint
   * stall) has to be told to do it again afterwards — see
   * `Game.applyLiveLook`, which is the only caller and owns that list.
   *
   * The name label is untouched here: `label.setName` already updates it
   * live, so `Game.applyLiveLook` calls that separately rather than this
   * method reaching past its own job.
   */
  replaceModel(playerState: PlayerState): void {
    const old = this.model;
    this.group.remove(old.root);
    disposeTree(old.root);

    this.model = this.buildModel(playerState);
    this.group.add(this.model.root);
  }

  /** Puts the character somewhere immediately, clearing momentum. */
  teleport(x: number, z: number): void {
    this.teleportTo(x, this.groundAt(x, z, Infinity), z);
  }

  /**
   * The same, but you say how high as well.
   *
   * Needed by anything that moves the character between the park and the
   * building's own space, where "the ground" is not a function of the terrain
   * and asking for it at the destination before you are there gives the wrong
   * answer.
   */
  teleportTo(x: number, y: number, z: number, facing?: number): void {
    this.position.set(x, y, z);
    this.previousPosition.copy(this.position);
    this.velocity.set(0, 0, 0);
    this.verticalVelocity = 0;
    this.airborne = false;
    // Landed, wherever this put her: a flight cannot survive being teleported
    // into the castle (or out of it), because the ground under her is now a
    // different ground entirely.
    this.flying = false;
    this.jumpHeldFor = 0;
    // Whatever she was being walked out of, she is not in it any more.
    this.escorting = false;
    if (facing !== undefined) this.facingAngle = facing;
    this.group.position.copy(this.position);
    this.group.rotation.y = this.facingAngle;
  }

  /** True while a ride is driving the character instead of the player. */
  get riding(): boolean {
    return this.ridingFlag;
  }

  /**
   * Bend, pick, smell — the little flourish when a flower comes out of the
   * meadow. Called by `world/Flowers.ts` the moment one is picked.
   *
   * **It never takes the controls.** The family asked for the moment to read;
   * a six-year-old will pick a hundred flowers and an animation she has to sit
   * through is an obstacle, not a treat. So this changes nothing but the pose:
   * the flower is already hers, already in her hair (`gameStore.collectFlower`
   * wears it immediately), and she can walk off mid-bend without losing it.
   *
   * Interrupting is therefore free and there is nothing to unwind.
   * {@link applyFlowerPick} is layered on top of a pose that `animate` rebuilds
   * from scratch every frame, so dropping the flourish — because she walked,
   * jumped, got on a ride, or simply finished — restores the ordinary walk
   * cycle on the very next frame with no state left behind. That is also why
   * the timer is a bare number rather than a state machine: there is no state
   * that can be wrong.
   *
   * Starting a second pick mid-flourish restarts it, which is exactly what
   * picking two flowers in a row should look like.
   */
  pickFlower(): void {
    if (this.ridingFlag || this.airborne) return;
    this.pickTime = 0;
  }

  /**
   * Which way she is looking, in radians — the same units `teleportTo` takes.
   *
   * Exposed for the autosave (`SaveSystem`): coming back to a game facing a
   * different way than you left it is a small thing, but it is the sort of
   * small thing a six-year-old notices immediately.
   */
  get facing(): number {
    return this.facingAngle;
  }

  /** Downward speed, negative while falling. Rides and trampolines read this. */
  get verticalSpeed(): number {
    return this.verticalVelocity;
  }

  get isAirborne(): boolean {
    return this.airborne;
  }

  /**
   * True where she may actually take off: a jet pack is on her back **and**
   * there is room here to use it.
   *
   * One question, asked in one place, because two things need the answer and
   * they must never disagree: the take-off in {@link update}, and whether
   * `ui/ScreenControls.ts` shows the on-screen hop button as also being the
   * fly button. A control that looks like it will fly while the take-off is
   * refused is exactly the promise this game does not make.
   *
   * "Room here" is read off {@link flyCeiling} rather than from a second
   * indoors flag, so there is still only one thing `Building` has to write and
   * only one thing that can be wrong. Indoors that ceiling is exactly
   * {@link INDOOR_FLY_CEILING}, so the comparison is a genuine `>` rather than
   * a float equality, and anywhere with a real ceiling over her — the park, the
   * roof terrace — comes out true.
   */
  get canFlyHere(): boolean {
    return (this.wornJetpack?.isWorn ?? false) && this.flyCeiling > INDOOR_FLY_CEILING;
  }

  /**
   * True while the jet pack is holding her up.
   *
   * Read by `entities/parade/Parade.ts`, which takes the whole line into the
   * air with her rather than dropping each toy onto the ground under the trail
   * — see its `aimAt`.
   */
  get isFlying(): boolean {
    return this.flying;
  }

  /**
   * How high her feet are above the ground under them, in metres — 0 walking,
   * positive mid-hop or in flight.
   *
   * This is the number `Collision.resolve` calls `clearance`, and the parade
   * borrows it so the line is allowed over the same low walls she is rather
   * than being shoved about by things it is currently ten metres above.
   */
  get heightAboveGround(): number {
    return this.hopClearance;
  }

  /** Throws the character upwards — the trampoline, later the corgi balloon. */
  launch(speed: number): void {
    this.verticalVelocity = speed;
    this.airborne = true;
  }

  /**
   * Shoves the character sideways without them asking — escalators, and any
   * moving walkway that comes later. Collision still applies.
   */
  nudge(dx: number, dz: number): void {
    // Sub-stepped for the same reason her own movement is (see `update`),
    // though an escalator's per-frame shove is far too small to reach even one
    // extra sub-step: a moving walkway that ever carried her a wall's width in
    // a frame should not be able to carry her through one.
    this.collision.resolveMovement(this.position, dx, dz, PLAYER_RADIUS, this.hopClearance);
    this.group.position.copy(this.position);
  }

  /** Hands the character to a ride: input, collision and gravity stop applying. */
  beginRide(): void {
    this.ridingFlag = true;
    // Every ride is sat in until it says otherwise, so a ride that has never
    // heard of postures cannot inherit one from the ride before it.
    this.ridePosture = 'seated';
    // …and nobody boards anything asleep. Same reasoning, same line.
    this.sleeping = false;
    this.scriptedWalkSpeed = 0;
    this.velocity.set(0, 0, 0);
    this.verticalVelocity = 0;
    this.airborne = false;
    // The ride is flying her now. She keeps the pack on — it is hers — but it
    // stops being what holds her up, and its flames go out (see `update`).
    this.flying = false;
    // So a jump button still held from before boarding can't be mistaken for
    // a fresh hold-past-the-threshold the moment she's handed back.
    this.jumpHeldFor = 0;
  }

  /**
   * Called by the ride every frame while it owns the character.
   *
   * `pitch` defaults to 0 (upright) — most rides that call this are flat, or
   * put the rider inside a vehicle whose own tilt is enough on its own (a
   * child of that vehicle's group inherits its pitch for free). A ride whose
   * player model is positioned independently of any such parent, and that
   * climbs or drops (the Rail Race's undulating ring), needs to pass its
   * cart's actual pitch here explicitly, or the rider stays bolt upright
   * through every hill while the cart under her visibly tilts.
   */
  setRidePose(x: number, y: number, z: number, facing: number, pitch = 0): void {
    this.position.set(x, y, z);
    this.previousPosition.copy(this.position);
    this.facingAngle = facing;
    this.group.position.copy(this.position);
    this.group.rotation.y = facing;
    this.group.rotation.x = pitch;
  }

  /**
   * How much of the "waving from up a tree" pose to wear, 0 to 1.
   *
   * Written every frame by `world/TreeClimbing.ts` while she is peeking out of
   * a canopy. It lives here, rather than TreeClimbing simply posing the arm
   * itself, because the riding branch of {@link update} rewrites *both* arms
   * from scratch every frame — a ride's "holding on" pose — so an arm posed
   * from outside would survive exactly one tick before being overwritten.
   *
   * Same rule as `applyFlowerPick`: it is only ever *blended over* the pose
   * `update` already wrote, and it cannot get stuck, because the next frame
   * that does not set it goes straight back to the plain ride pose.
   */
  setClimbWave(amount: number): void {
    this.climbWave = clamp01(amount);
  }

  /**
   * How fast a `'walking'` posture should look like it is going, in metres a
   * second — the same number her own movement would have had.
   *
   * Written every frame by whatever is walking her, alongside the
   * {@link setRidePose} that actually moves her, so the stride matches the
   * ground she is covering instead of being a rate somebody guessed. Ignored
   * entirely under any other posture, and reset by {@link endRide}, so it
   * cannot leak into the next thing she gets on.
   */
  setScriptedWalk(speed: number): void {
    this.scriptedWalkSpeed = Math.max(0, speed);
  }

  /** Gives the character back, optionally still moving. */
  endRide(velocityX = 0, velocityY = 0, velocityZ = 0): void {
    this.ridingFlag = false;
    // Stand her back up before handing her over, or she walks away lying down.
    this.ridePosture = 'seated';
    // …and wake her up, or she walks away with her eyes shut.
    this.sleeping = false;
    this.scriptedWalkSpeed = 0;
    this.model.root.rotation.x = 0;
    this.model.head.rotation.x = 0;
    // The sleeping pose lolls her head to one side; unloll it with the rest.
    this.model.head.rotation.z = 0;
    this.climbWave = 0;
    this.velocity.set(velocityX, 0, velocityZ);
    this.verticalVelocity = velocityY;
    this.airborne = true;
    // A ride hands back a fresh velocity of its own choosing; nothing about
    // the overlap she was in before it took over still applies.
    this.escorting = false;
  }

  update(context: FrameContext): void {
    const { dt, input } = context;

    // Before the ride check, so a rainbow started on the ground still finishes
    // if you hop straight onto something. Dust settles on the same terms — the
    // puffs from her last stride should not freeze in mid-air because she
    // stepped onto the escalator.
    this.hopRings.update(dt);
    this.dust.update(dt);

    if (this.ridingFlag) {
      // The ride positions us; all we do is hold a suitably delighted pose.
      //
      // The ride pose itself is applied *inside* `animate`, not after it — see
      // the end of that method for why the difference cost this project three
      // days. Calling it out here, after `animate` returned, made it the last
      // writer of `body.rotation.x` and silently deleted the Rail Race's entire
      // pose from the screen.
      this.wornJetpack?.setThrust(0);
      if (this.ridePosture === 'walking') {
        // A sequence is walking her rather than carrying her. Her *position*
        // still arrives through `setRidePose`, like any ride; her *pose* is the
        // ordinary walk cycle, driven through the very same `gait`/`walkPhase`
        // pair her own movement writes below — the two lines are deliberately
        // identical to the ones in the movement path, so the game has one walk
        // and not a second copy of it that can drift out of step.
        this.gait = damp(this.gait, clamp01(this.scriptedWalkSpeed / PLAYER_MAX_SPEED), 0.07, dt);
        this.walkPhase += this.scriptedWalkSpeed * PLAYER_BOB_CYCLES_PER_METRE * TAU * dt;
        if (this.walkPhase > TAU) this.walkPhase -= TAU;
        // No `applyRidePose` call here, and that is the merge of #223 talking:
        // `animate` is now the one place the ride pose is applied, at its very
        // end. A second call out here would be the last writer of
        // `body.rotation.x` again — the exact thing that deleted the Rail
        // Race's pose from the screen. It happened to be harmless for this
        // branch (`applyRidePose` returns immediately for `'walking'`, which is
        // what keeps the walk cycle `animate` just wrote), but a no-op that
        // contradicts the comment above it is a trap for the next reader.
        this.animate(context, 0);
        return;
      }
      // The ride positions us; all we do is hold a suitably delighted pose.
      this.gait = damp(this.gait, 0, 0.1, dt);
      this.animate(context, 0);
      return;
    }

    // --- intent -----------------------------------------------------------
    // Map stick/keys onto the camera's ground basis so "up" is always up-screen.
    this.moveDirection
      .set(0, 0, 0)
      .addScaledVector(this.camera.right, input.moveX)
      .addScaledVector(this.camera.forward, input.moveY);

    const inputLength = this.moveDirection.length();
    const speedLimit =
      PLAYER_MAX_SPEED *
      (input.isDown('sprint') ? PLAYER_SPRINT_MULTIPLIER : 1) *
      this.speedMultiplier;

    if (inputLength > 1e-4) {
      this.desiredVelocity.copy(this.moveDirection).multiplyScalar(speedLimit);
    } else {
      this.desiredVelocity.set(0, 0, 0);
    }

    // --- acceleration -------------------------------------------------------
    const rate = inputLength > 1e-4 ? PLAYER_ACCELERATION : PLAYER_DECELERATION;
    approach(this.velocity, this.desiredVelocity, rate * dt);

    // --- horizontal movement + collision ------------------------------------
    this.previousPosition.copy(this.position);
    // `resolveMovement`, not `resolve`: it walks the step in sub-steps short
    // enough that nothing solid can be crossed without ever being overlapped.
    // At `MAX_FRAME_DELTA` a sprint covers 0.93 m in one frame — wider than a
    // garden wall's whole footprint — and the plain point test would let her
    // land beyond the middle and then be pushed out the *far* side, through
    // the wall, at any height. See `Collision.ts`'s `resolveMovement`. At any
    // ordinary frame rate the step is short enough that this is the old single
    // `resolve` call, unchanged, so the walk feels exactly as it did.
    //
    // `hopClearance` (this jumper's height above local ground, as of last
    // frame) lets a wall the player has jumped above stop pushing back — see
    // Collision.ts. Grounded, it's 0, so every wall blocks exactly as before.
    // Passing `dt` is what lets a *deep* overlap (spawned or stepped inside
    // something) resolve as a gentle, capped escort rather than a one-frame
    // shove — see `Collision.ts`'s `MAX_DEPENETRATION_SPEED` (design feedback
    // #17, "the fling"). Ordinary shallow contact against a wall is
    // unaffected and stays exactly as crisp as before. `dt` is shared out
    // among the sub-steps, so the escort still moves at the same metres per
    // second and the latch below still sees the same escort it always did.
    const { clearedWall, escorting, corrected } = this.collision.resolveMovement(
      this.position,
      this.velocity.x * dt,
      this.velocity.z * dt,
      PLAYER_RADIUS,
      this.hopClearance,
      dt,
    );

    // An escort runs until the pushing stops, not until it goes quiet.
    //
    // `escorting` is true only while *this frame's* correction is deeper than
    // ordinary contact, and the last frames of any escort are shallow by
    // definition — the overlap is nearly gone, which is the point of it. So
    // the flag drops while the mover is still being pushed, and the frame it
    // drops on gets its correction banked as velocity after all.
    //
    // That is the wall fling ("jumping over walls the player sometimes gets a
    // burst of extreme speed"): a wall the jump only just clears stops being
    // solid at the apex, goes solid again under her on the way down while she
    // is inside its footprint, and the resulting escort's tail is still ~0.4 m
    // — a hair under `SHALLOW_OVERLAP`, so it is called ordinary contact and
    // read back as ~25 m/s against a walking pace of 7.4. Same feedback loop
    // as design feedback #17, entered through the door the #17 fix left open.
    //
    // Latching until `corrected` goes false closes it: the whole escort, deep
    // frames and shallow tail alike, is treated as the external nudge it is.
    this.escorting = corrected && (escorting || this.escorting);

    // Trust the resolved position over the intended one, so walking into a wall
    // actually kills the momentum instead of grinding against it — but never
    // while an escort is running: that distance is an external nudge, not
    // something achieved under her own power. Leaving velocity alone lets it
    // simply decelerate normally, as if nothing solid were there at all.
    if (dt > 0 && !this.escorting) {
      const previousSpeed = Math.hypot(this.velocity.x, this.velocity.z);
      const derivedX = (this.position.x - this.previousPosition.x) / dt;
      const derivedZ = (this.position.z - this.previousPosition.z) / dt;
      // Second line of defence, and an invariant worth stating outright:
      // being blocked is a *constraint*, so it can only ever take speed away.
      // If a resolved position ever implies she came out of a collision going
      // faster than she went in, that is not her walking into a wall, whatever
      // produced it — so decline it rather than launch a six-year-old across
      // the park. Never fires on ordinary contact, where the correction can
      // only undo part of the step that caused it.
      if (Math.hypot(derivedX, derivedZ) <= previousSpeed) {
        this.velocity.x = derivedX;
        this.velocity.z = derivedZ;
      }
    }

    const groundY = this.groundAt(this.position.x, this.position.z, this.position.y);

    // Walk off the edge of a deck — or over one of the shafts inside the big
    // building — and the surface under your feet drops away. Start falling.
    if (!this.airborne && this.position.y - groundY > FALL_THRESHOLD) {
      this.airborne = true;
      this.verticalVelocity = 0;
    }

    // --- auto-hop (design feedback #30e) -------------------------------------
    // Walking into a jumpable wall — most naturally via tap-to-move, which
    // steers exactly like a thumbstick held down (see `TapNavigator`) — used
    // to just stop there. A short lookahead in the direction actually being
    // walked asks `Collision.ts` the same question the button already
    // answers: "would a jump from here clear what's in the way?" Only
    // `autoHoppable` colliders count — the garden's wooden and stone walls,
    // registered that way in `Scenery.ts` — so this can never fire for the
    // fountain rim, a deck edge (which isn't a collider at all) or a wall
    // too tall to clear; manual jump is completely untouched.
    let autoHopWanted = false;
    if (!this.airborne && inputLength > 1e-4) {
      const inverse = 1 / inputLength;
      this.hopProbe
        .copy(this.position)
        .addScaledVector(this.moveDirection, AUTO_HOP_LOOKAHEAD * inverse);
      autoHopWanted = this.collision.wouldAutoHopClear(this.hopProbe, PLAYER_RADIUS, JUMP_APEX_HEIGHT);
    }

    // --- hop, and — held past a beat — the jet pack --------------------------
    // One button does both; see "THE JET PACK" above. A tap is the ordinary
    // hop, unconditionally, pack or no pack: `canFlyHere` is never consulted
    // here. Only whether it is *still* held once {@link JETPACK_HOLD_THRESHOLD}
    // has passed decides whether that hop turns into a take-off.
    const canFly = this.canFlyHere;
    if ((input.justPressed('jump') || autoHopWanted) && !this.airborne) {
      this.verticalVelocity = JUMP_SPEED;
      this.airborne = true;
      this.jumpHeldFor = 0;
      this.spawnHopRing(groundY);
    }
    if (this.airborne && !this.flying) {
      this.jumpHeldFor = input.isDown('jump') ? this.jumpHeldFor + dt : 0;
      if (canFly && this.jumpHeldFor >= JETPACK_HOLD_THRESHOLD) {
        // No snap to climbing speed: she is already moving, mid-hop, and
        // `approachScalar` below eases the existing velocity towards the
        // climb target exactly as it eases any other change of heart in the
        // air. The take-off is the hop that never came back down.
        this.flying = true;
      }
    }

    let hopHeight = 0;
    if (this.flying) {
      // Held: climb. Released: gravity, exactly as if there were no pack at
      // all — the same formula the plain fall below uses. That absence *is*
      // "come down"; there is nothing else to press.
      const thrusting = canFly && input.isDown('jump');
      if (thrusting) {
        const height = this.position.y - groundY;
        // Ease off into the ceiling instead of stopping dead against it.
        const headroom = clamp01((this.flyCeiling - height) / FLY_CEILING_EASE);
        this.verticalVelocity = approachScalar(
          this.verticalVelocity,
          FLY_RISE_SPEED * headroom,
          FLY_VERTICAL_ACCELERATION * dt,
        );
      } else {
        this.verticalVelocity -= GRAVITY * dt;
      }
      this.position.y += this.verticalVelocity * dt;
      if (this.position.y <= groundY) {
        this.position.y = groundY;
        this.verticalVelocity = 0;
        this.airborne = false;
        this.flying = false;
        // And a rainbow on the way back in, so landing is an event too.
        this.spawnHopRing(groundY);
      }
      hopHeight = this.position.y - groundY;
      this.wornJetpack?.setThrust(thrusting ? 1 : FLY_IDLE_THRUST);
    } else if (this.airborne) {
      this.wornJetpack?.setThrust(0);
      this.verticalVelocity -= GRAVITY * dt;
      this.position.y += this.verticalVelocity * dt;
      if (this.position.y <= groundY) {
        this.position.y = groundY;
        this.verticalVelocity = 0;
        this.airborne = false;
      }
      hopHeight = this.position.y - groundY;
    } else {
      this.wornJetpack?.setThrust(0);
      // Damp onto the ground so walking over the gentle hills isn't jittery.
      this.position.y = damp(this.position.y, groundY, 0.04, dt);
    }
    this.hopClearance = hopHeight;

    // A little sparkle the moment the jump actually carries her over a wall's
    // footprint, rather than every frame she's above it.
    if (clearedWall && !this.wasClearingWall) this.spawnClearPoof();
    this.wasClearingWall = clearedWall;

    this.group.position.copy(this.position);

    // --- facing -------------------------------------------------------------
    const planarSpeed = Math.hypot(this.velocity.x, this.velocity.z);
    if (planarSpeed > 0.35) {
      const target = Math.atan2(this.velocity.x, this.velocity.z);
      this.facingAngle = turnTowards(this.facingAngle, target, PLAYER_TURN_SPEED * dt);
    }
    this.group.rotation.y = this.facingAngle;

    // --- animation ----------------------------------------------------------
    this.gait = damp(this.gait, clamp01(planarSpeed / PLAYER_MAX_SPEED), 0.07, dt);
    this.walkPhase += planarSpeed * PLAYER_BOB_CYCLES_PER_METRE * TAU * dt;
    if (this.walkPhase > TAU) this.walkPhase -= TAU;

    this.spawnRunningDust(planarSpeed);

    this.animate(context, hopHeight);
  }

  /** Renames the character and rebuilds the floating label. */
  setName(name: string): void {
    gameStore.setPlayerName(name);
    this.label.setName(gameStore.get().player.name);
  }

  dispose(): void {
    this.label.dispose();
    this.hopRings.root.removeFromParent();
    this.hopRings.dispose();
    this.dust.root.removeFromParent();
    this.dust.dispose();
  }

  // -------------------------------------------------------------- internals

  /**
   * Drops a rainbow ring at the feet, in world space.
   *
   * The effect group is parented lazily to whatever holds the player — the
   * scene, in practice — because a `Player` is constructed before it is added to
   * anything, and rings pinned to the character would ride around with her.
   */
  private spawnHopRing(groundY: number): void {
    const world = this.group.parent;
    if (!world) return;
    if (this.hopRings.root.parent !== world) world.add(this.hopRings.root);
    this.hopRings.burst(this.position.x, groundY, this.position.z);
  }

  /**
   * A dinky puff at wall-top height the instant a jump clears a wall.
   *
   * Reuses the hop rainbow's own pool at low strength rather than building a
   * second effect — it is already a free-floating, ground-agnostic ring, so
   * bursting it at the current (elevated, mid-air) position just works.
   */
  /**
   * One puff of dust per footfall, while she is running.
   *
   * Tied to `walkPhase` rather than to a timer, because `walkPhase` is what
   * the legs are already swinging on — so the dust lands in time with her
   * feet, and speeds up and slows down with her instead of ticking along at
   * its own rate beside her. `walkPhase` runs 0…TAU per stride cycle and
   * wraps, so a change in `floor(phase / DUST_STRIDE)` is one step of that
   * cycle; the wrap from the top of the range back to 0 counts as one of them.
   *
   * At {@link DUST_STRIDE} = π/2 that is four steps a cycle, two per foot.
   * Halving `step` recovers which foot it is, so a foot's pair of puffs both
   * come off the same heel.
   *
   * Not while airborne — dust comes off the ground, and there is none up
   * there — and not while riding, where her feet are not doing the moving.
   *
   * Allocates nothing. The trig is on `facingAngle`, which is already the
   * direction she is actually pointing, so the puffs come off her heels rather
   * than out of her velocity vector during a turn.
   */
  private spawnRunningDust(planarSpeed: number): void {
    const previous = this.previousWalkPhase;
    this.previousWalkPhase = this.walkPhase;

    if (this.airborne || this.ridingFlag || planarSpeed < DUST_SPEED) return;
    const step = Math.floor(this.walkPhase / DUST_STRIDE);
    if (step === Math.floor(previous / DUST_STRIDE)) return;

    const world = this.group.parent;
    if (!world) return;
    if (this.dust.root.parent !== world) world.add(this.dust.root);

    // `facingAngle` is measured so that forward is (sin, cos); behind is the
    // negative of that, and the sideways axis is the perpendicular.
    const forwardX = Math.sin(this.facingAngle);
    const forwardZ = Math.cos(this.facingAngle);
    // Alternate feet, so two lines of dust trail her rather than one — per
    // foot, not per puff, which is why `step` is halved first.
    const side = Math.floor(step / 2) % 2 === 0 ? 1 : -1;

    this.dust.puff(
      this.position.x - forwardX * DUST_TRAIL + forwardZ * DUST_STANCE * side,
      this.position.y + 0.08,
      this.position.z - forwardZ * DUST_TRAIL - forwardX * DUST_STANCE * side,
      -forwardX,
      -forwardZ,
    );

    // She has done the thing. Idempotent and cheap after the first time — see
    // `discoverSecret` on why this is not a flag kept out here.
    discoverSecret('secret.dust');
  }

  private spawnClearPoof(): void {
    const world = this.group.parent;
    if (!world) return;
    if (this.hopRings.root.parent !== world) world.add(this.hopRings.root);
    this.hopRings.burst(this.position.x, this.position.y - 0.05, this.position.z, 0.4);
  }

  private groundAt(x: number, z: number, y: number): number {
    return this.groundSampler ? this.groundSampler(x, z, y) : terrainHeight(x, z);
  }

  /**
   * Top of the character right now, in metres above the feet, for the name
   * label to clear — bare hair height normally, or the top of whatever hat is
   * worn when that reaches higher. `Math.max` rather than a straight swap
   * because a few hats (the flower crown, say) sit lower than the hair itself
   * does; only a hat that actually reaches above the hair should ever move
   * the label, so a bare-headed child's label — or one in a low hat — stays
   * exactly where it always was.
   */
  private labelTopHeight(): number {
    const hatHeight = this.wornHat?.hatHeight ?? null;
    if (hatHeight === null) return this.model.height;
    return Math.max(this.model.height, this.model.hatAnchorHeight + hatHeight);
  }

  /**
   * The flower flourish, laid over this frame's finished pose.
   *
   * Four beats, all read off one clock: she bends and reaches down, tugs the
   * stem free, straightens up bringing her hand to her face, and has a couple
   * of little sniffs of it before letting her arm fall. Angles are *added* to
   * what `animate` has already written, so she can walk, run, bob and blink
   * through the whole thing.
   *
   * **Nothing here can get stuck**, which is the whole reason it is shaped
   * this way. Every pose value it touches is overwritten from scratch at the
   * top of the next `animate`, so the flourish exists only for as long as it
   * keeps re-applying itself: walking away (or a ride, or a jump, or simply
   * running out of clock) stops it re-applying and the ordinary pose is back
   * on the next frame with nothing to tidy up.
   *
   * `weight` is what makes walking away read as her giving up on the sniff
   * rather than as a snap: it fades with `gait`, so a step or two out of the
   * flowerbed dissolves the pose. Below {@link PICK_WALK_AWAY} it also fades
   * back *in*, which is what makes a tapped flower work — she arrives still
   * slowing down, and the flourish eases on as she comes to rest.
   *
   * Angles follow the rig's own convention (see the asset contract: forward is
   * +Z), where a **negative** `rotation.x` pitches a body or a limb forwards.
   */
  private applyFlowerPick(dt: number, gait: number): void {
    if (this.pickTime < 0) {
      this.smelling = false;
      return;
    }
    // A ride or a jump takes the character away from us outright; there is no
    // sensible way to bend down off the ground or out of a dodgem.
    if (this.ridingFlag || this.airborne) {
      this.pickTime = -1;
      this.smelling = false;
      return;
    }

    const t = this.pickTime;
    this.pickTime += dt;
    if (this.pickTime >= PICK_SECONDS) this.pickTime = -1;

    // Eased on at the start and off at the end so neither edge snaps, and
    // faded out by walking.
    const envelope = Math.min(
      smoothstep(0, 0.07, t),
      smoothstep(PICK_SECONDS, PICK_SECONDS - 0.18, t),
    );
    const weight = envelope * clamp01(1 - gait / PICK_WALK_AWAY);
    if (weight <= 0.001) {
      this.smelling = false;
      return;
    }

    // How far into the bend she is: down, held through the pluck, then up.
    const bend = Math.min(smoothstep(0, PICK_BEND_IN, t), 1 - smoothstep(PICK_PLUCK_END, PICK_RISE_END, t));
    // The reaching hand, which lets go of the ground as the stem comes free.
    const reach = Math.min(smoothstep(0, PICK_BEND_IN * 0.9, t), 1 - smoothstep(PICK_PLUCK, PICK_RISE_END * 0.8, t));
    // And the flower at her nose, from halfway up until the very end.
    const sniff = Math.min(
      smoothstep(PICK_PLUCK_END, PICK_SNIFF_IN, t),
      1 - smoothstep(PICK_SECONDS - 0.2, PICK_SECONDS, t),
    );
    // The pluck itself: one quick up-flick of the hand, in and out.
    const tug = t < PICK_PLUCK || t > PICK_PLUCK_END
      ? 0
      : Math.sin(((t - PICK_PLUCK) / (PICK_PLUCK_END - PICK_PLUCK)) * Math.PI);

    const model = this.model;

    // Bending at the waist, with the feet planted — the legs hang off `body`
    // in the rig, so lowering it would take her shoes into the grass.
    model.body.rotation.x -= bend * 0.78 * weight;
    // Head down to look at the flower on the way in, tipped towards her hand
    // on the way back.
    model.head.rotation.x -= (bend * 0.34 - sniff * 0.2) * weight;

    // The picking hand is the one a carried toy is held in (`holdAnchor` hangs
    // off `rightArm`), so the flower goes where her hands already do things.
    // Down for the stem, then folded up to her face for the sniff.
    model.rightArm.rotation.x -= (reach * 0.6 + sniff * 2.25 - tug * 0.5) * weight;
    model.rightArm.rotation.z += sniff * 0.42 * weight;
    // The other arm swings back a little as she goes down, for balance.
    model.leftArm.rotation.x += bend * 0.4 * weight;
    // A small bounce out of the knees as the stem gives way.
    model.leftLeg.rotation.x -= tug * 0.12 * weight;
    model.rightLeg.rotation.x -= tug * 0.12 * weight;

    // Two quick sniffs — small and fast, so they read as a nose rather than a
    // nod. Driven off the flourish's own clock, not `elapsed`, so every pick
    // sniffs at the same place in the movement.
    model.head.rotation.x -= Math.sin(t * 38) * 0.045 * sniff * weight;

    // She only smiles once the flower is actually under her nose — a grin
    // through the bend would be smiling at the ground.
    this.smelling = sniff * weight > 0.4;
  }

  /**
   * The flying pose: arms out like wings, legs together and trailing, leaning
   * into wherever she is going.
   *
   * Eased in and out on {@link flightPose} rather than switched, so taking off
   * and landing are a moment rather than a snap — and so the pose survives the
   * frame she touches down on, which is the frame `flying` goes false.
   *
   * Angles follow the rig's own convention (forward is +Z), where a **negative**
   * `rotation.x` pitches a body or a limb forwards.
   */
  private applyFlightPose(dt: number): void {
    const wanted = this.flying ? 1 : 0;
    this.flightPose = damp(this.flightPose, wanted, 0.08, dt);
    const weight = this.flightPose;
    if (weight <= 0.002) return;

    const model = this.model;
    const planarSpeed = Math.hypot(this.velocity.x, this.velocity.z);
    // Lean into the travel — but off *speed*, not off direction, because the
    // model is already turned to face the way it is going. A lean derived from
    // the direction would be the facing feeding back into the pose, and the
    // whole point of the CONTROL RULE is that it never does.
    const lean = clamp01(planarSpeed / PLAYER_MAX_SPEED);

    model.body.rotation.x = lerp(model.body.rotation.x, -0.34 * lean - 0.06, weight);
    model.body.rotation.z = lerp(model.body.rotation.z, 0, weight);

    // Arms out and back, palms trailing — the shape a child makes when she
    // pretends to fly, which is the only reference that matters here.
    model.leftArm.rotation.x = lerp(model.leftArm.rotation.x, 0.55, weight);
    model.rightArm.rotation.x = lerp(model.rightArm.rotation.x, 0.55, weight);
    model.leftArm.rotation.z = lerp(model.leftArm.rotation.z, 1.05, weight);
    model.rightArm.rotation.z = lerp(model.rightArm.rotation.z, -1.05, weight);

    // Legs together and trailing, with the smallest kick apart so she is not a
    // plank. Off the walk phase, so they keep paddling at the pace she moves.
    const kick = Math.sin(this.walkPhase) * 0.12 * lean;
    model.leftLeg.rotation.x = lerp(model.leftLeg.rotation.x, 0.34 + kick, weight);
    model.rightLeg.rotation.x = lerp(model.rightLeg.rotation.x, 0.34 - kick, weight);

    // Chin up, looking where she is going rather than at her own shoes.
    model.head.rotation.x = lerp(model.head.rotation.x, 0.16, weight);
    model.head.rotation.z = lerp(model.head.rotation.z, 0, weight);
  }

  private animate({ elapsed, dt }: FrameContext, hopHeight: number): void {
    const model = this.model;
    // Applied at the very end of this method — see `railRaceDuck`.
    const gait = this.gait;
    const phase = this.walkPhase;

    // Bob: the body rises on each step. Two bumps per stride, hence phase * 2.
    const bob = Math.abs(Math.sin(phase)) * PLAYER_BOB_HEIGHT * gait;
    // Idle breathing keeps the character alive when standing still.
    const breathe = Math.sin(elapsed * 1.9) * 0.014 * (1 - gait);
    model.body.position.y = bob + breathe + hopHeight * 0.12;

    // Squash and stretch: compressed at the bottom of the step, stretched at
    // the top. Small numbers — any more and it looks like jelly.
    const squash = 1 - Math.cos(phase * 2) * 0.045 * gait;
    model.body.scale.set(1 / Math.sqrt(squash), squash, 1 / Math.sqrt(squash));

    // Lean into the run, and roll gently side to side.
    model.body.rotation.x = lerp(0, -0.13, gait) + (this.airborne ? -0.1 : 0);
    model.body.rotation.z = Math.sin(phase) * 0.045 * gait;

    // Head lags behind the body a touch — a tiny bit of secondary motion does
    // more for the feeling of weight than anything else here.
    model.head.rotation.z = -Math.sin(phase) * 0.07 * gait;
    model.head.rotation.x = Math.sin(phase * 2 + 0.6) * 0.035 * gait + breathe * 2;
    model.head.position.y = model.headHeight + Math.sin(phase * 2 + 1.2) * 0.012 * gait;

    // Arms and legs swing in opposition.
    const swing = Math.sin(phase) * (0.95 * gait);
    const armLift = this.airborne ? -0.9 : 0;
    model.leftArm.rotation.x = swing + armLift;
    model.rightArm.rotation.x = -swing + armLift;
    model.leftArm.rotation.z = 0.12 + gait * 0.08;
    model.rightArm.rotation.z = -0.12 - gait * 0.08;

    const legSwing = Math.sin(phase) * (0.85 * gait);
    model.leftLeg.rotation.x = -legSwing;
    model.rightLeg.rotation.x = legSwing;

    // Bend, pick, smell. Layered on top of everything above, and on top of a
    // pose that has just been written from scratch — see `applyFlowerPick`.
    this.applyFlowerPick(dt, gait);

    // Flying. Also layered rather than branched, and for the same reason: every
    // value it touches is rewritten from scratch at the top of the next
    // `animate`, so landing restores the walk on the very next frame with
    // nothing to unwind.
    this.applyFlightPose(dt);

    // Blinking: a long pause, then a quick close-and-open.
    //
    // The face is painted onto a canvas now rather than built out of spheres,
    // so a blink is a texture swap. That makes it cheap, but only if it happens
    // on the two TRANSITIONS — calling `setExpression` every frame would flip
    // `needsUpdate` every frame and re-upload the texture to the GPU.
    //
    // `sleeping` outranks everything, because a child asleep in a bed is not
    // having a mood — and `'blink'` **is** shut eyes, so resting on it holds
    // them shut for the whole nap and the clock's own blinks land on the face
    // that is already showing. See {@link sleeping}.
    //
    // `railRaceFrown` outranks `waterHappy`/`smelling` because a bonk is a
    // sudden thing that happens *to* her and should win over an ambient good
    // mood, but a blink still outranks the lot — `faceLife` punches one
    // through whatever resting face it is handed, so the ordinary blink cycle
    // keeps interrupting a held frown exactly as it does a held smile.
    this.face.update(
      dt,
      this.sleeping
        ? 'blink'
        : this.railRaceFrown
          ? 'frown'
          : this.waterHappy || this.smelling
            ? 'happy'
            : 'neutral',
    );

    // The pose worn on any ride — "holding on, delighted", with the tree-climb
    // wave blended over it. See `applyRidePose`.
    //
    // **Here, and not in `update`'s riding branch where it used to be.** It ran
    // there for months, immediately *after* this method returned, which made it
    // the last writer of `body.rotation.x` — so it stamped
    // `RIDE_POSE_BODY_PITCH` (0.3) over whatever the line below had just
    // written. `poseRailRaceRider` was correctly built as the single owner of
    // that property and correctly checked as one, and none of that mattered:
    // the Rail Race's waist fold, boost rock and victory lean were computed
    // exactly right and then thrown away before they were drawn, every frame,
    // for the whole life of the feature. The measured cost was a duck worth
    // 0.42 m against a bar sized for 0.73 m — a duck bar that went through her
    // head *while she was ducking*, under a check that reported a clearance.
    //
    // So the rule this ordering encodes: **one owner, and that owner writes
    // last.** Anything that wants a say in `body.rotation.x` on a ride goes
    // into `RiderPose` (or into `applyRidePose`, above this line) — never into
    // a new assignment after the pose, however local and harmless it looks.
    // `check:rail-race` drives a real `Player` through this exact order and
    // compares what she ends up drawing against what the pose asked for, so a
    // writer added below here fails the build rather than the family.
    if (this.ridingFlag) applyRidePose(model, this.climbWave, elapsed, this.ridePosture);

    // The Rail Race's own pose, last of all — everything above has just
    // finished writing `body.rotation.x`, `body.scale` and `head.rotation.x`,
    // which are the three things it needs to own outright while she is ducking.
    // See `railRace/duckPose.ts` and `railRaceRide`.
    if (this.railRaceRide !== null) poseRailRaceRider(model, this.railRaceRide);

    // Secondary motion the model owns: the swishy ponytail, if that is what
    // the child chose. Last, and deliberately so — it is pinned to the world
    // position of an anchor on the head, and the head's pose for this frame
    // was only just written above (the duck included). See
    // `CharacterModel.update`.
    model.update(dt);

    // The name label counter-rotates so it never tips with the character.
    this.label.sprite.position.y = this.labelTopHeight() + 0.42 + bob + Math.sin(elapsed * 1.3) * 0.03;
    // Kept a constant size on screen rather than in the world — see
    // `NameLabel.updateScreenSize` for why a fixed world scale is the bug.
    // Distance is measured from what the camera is *looking at*, not from the
    // camera's own position — this is an orthographic rig, so the camera sits
    // a fixed distance back at every zoom level, and a straight line to it is
    // roughly constant regardless of what's actually on screen.
    this.label.updateScreenSize(
      this.camera.worldUnitsPerPixel,
      this.camera.focusPoint.distanceTo(this.position),
    );
  }
}

/** Moves one number towards another by at most `maxDelta`. */
function approachScalar(current: number, target: number, maxDelta: number): number {
  const delta = target - current;
  if (Math.abs(delta) <= maxDelta) return target;
  return current + Math.sign(delta) * maxDelta;
}

/** Moves `current` towards `target` by at most `maxDelta`, componentwise in XZ. */
function approach(current: Vector3, target: Vector3, maxDelta: number): void {
  const dx = target.x - current.x;
  const dz = target.z - current.z;
  const distance = Math.hypot(dx, dz);
  if (distance <= maxDelta || distance < 1e-6) {
    current.x = target.x;
    current.z = target.z;
    return;
  }
  const scale = maxDelta / distance;
  current.x += dx * scale;
  current.z += dz * scale;
}
