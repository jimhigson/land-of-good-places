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
import type { FrameContext, GameSystem } from '../core/types';
import type { IsoCamera } from '../core/IsoCamera';
import type { CollisionWorld } from '../world/Collision';
import { terrainHeight } from '../world/terrain';
import { CharacterModel } from './CharacterModel';
import { createGlasses } from '../art/models/glasses';
import type { Expression } from '../art/style/faces';
import { createRainbowRings, type RainbowRings } from '../art/effects/rainbowRing';
import { createDustPuffs, type DustPuffs } from '../art/effects/dustPuff';
import { NameLabel } from '../ui/NameLabel';
import { discoverSecret, gameStore } from '../state';
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
 * then you fly and control where you fly instead of walking."*
 *
 * **One button, one rule, no explaining.** Tap fly and she lifts off; hold it
 * and she climbs; let go and she comes gently down; touch the ground and she is
 * walking again. That is the whole control scheme, and a six-year-old has it
 * after one press because she can see the flames.
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
 * - Letting go always sinks her to whatever is under her feet *right now*,
 *   sampled through the same {@link Player.groundAt} the walk uses — so she
 *   lands on the deck, the stair tread or the grass, whichever is really there.
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
 *   and she finishes the descent she was already making.
 */
const FLY_RISE_SPEED = 4.4;

/**
 * How fast she sinks with the button released.
 *
 * Slower than she rises, so letting go reads as *floating down* rather than as
 * the jet pack failing — but not so slow that coming down from the ceiling is
 * something a child has to wait through. At this rate the full descent from
 * {@link PARK_FLY_CEILING} takes about four seconds.
 */
const FLY_SINK_SPEED = 3;

/**
 * And how fast she sinks with the **down** button held.
 *
 * Twice the drift, so pressing it is obviously doing something, and still well
 * under a free fall (`GRAVITY` reaches this in a fifth of a second) so it reads
 * as flying down rather than as the pack cutting out.
 *
 * The button exists because "let go and you come down" is, as a *control*,
 * invisible — the way to descend was to stop doing something, which is the
 * least discoverable instruction there is. See `ui/ScreenControls.ts`. Letting
 * go of everything still floats her down at {@link FLY_SINK_SPEED} exactly as
 * it always did; this is an addition, not a replacement.
 */
const FLY_DIVE_SPEED = 6;

/** How briskly the climb and the sink get up to speed. Snappy, not instant. */
const FLY_VERTICAL_ACCELERATION = 24;

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
 *    castle refuses a take-off outright and the fly buttons are not on screen
 *    inside it. The jet pack is an outdoors thing, everywhere, consistently —
 *    rather than a full flight in the park and a puzzling one-metre hover
 *    indoors that no button offers you.
 * 2. It stays the **backstop** for a flight already in the air if the space
 *    under her ever changes, which is what it was written for.
 *
 * `world/building/Building.ts` is what writes it — see `Player.flyCeiling`.
 */
export const INDOOR_FLY_CEILING = 1.2;

/** Metres of soft approach to the ceiling, so it eases rather than clunks. */
const FLY_CEILING_EASE = 2.5;

/** Thrust shown on the pack while coasting down — a pilot light, not a climb. */
const FLY_IDLE_THRUST = 0.3;

/** How long the eyes stay shut. Any longer and she looks sleepy, not blinking. */
const BLINK_DURATION = 0.11;

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
  readonly model: CharacterModel;
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
  private readonly previousPosition = new Vector3();
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
   * True while the jet pack is holding her up — a strict subset of
   * {@link airborne}, so everything that already asks "is she off the ground?"
   * (the parade's copycat hop, the flower flourish, the dust) gets the right
   * answer for flight without being told about it.
   *
   * Only ever *entered* with a pack worn, and only ever left by touching the
   * ground. Taking the pack off mid-air therefore takes the thrust away rather
   * than the flight, and she finishes her descent at flying speed instead of
   * dropping.
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
  private blinkTimer = 2.4;
  private blinkRemaining = 0;
  private currentExpression: Expression = 'neutral';
  private ridingFlag = false;
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

  constructor(
    private readonly collision: CollisionWorld,
    private readonly camera: IsoCamera,
    spawn: Vector3,
  ) {
    this.group.name = 'player';

    const playerState = gameStore.get().player;
    this.model = new CharacterModel(
      {
        skin: playerState.skinColour,
        hair: playerState.hairColour,
        outfit: playerState.outfitColour,
        outfitArms: playerState.outfitArmsColour,
        shoe: playerState.shoeColour,
      },
      // Hair style, skin tone, eye colour, the backpack and the shoes are all
      // chosen in the character creator (`ui/CharacterCreation.ts`) and have
      // already been written to the store by the time this constructor runs —
      // see `main.ts`'s `boot()`, which applies them before `Game` (and
      // therefore `Player`) is ever built.
      {
        hairStyle: playerState.hairStyle,
        eyeColour: playerState.eyeColour,
        backpackKind: playerState.backpackKind,
        backpackColour: playerState.backpackColour,
        shoeKind: playerState.shoeKind,
      },
    );
    this.group.add(this.model.root);

    // Glasses, chosen in the character creator and worn from the first spawn —
    // see `PlayerState.glassesKind`'s doc comment. Unlike the hat there is no
    // `WornGlasses` system: glasses are never sold, so nothing ever changes
    // this mid-game, and a static attach here is all that is needed. `null`
    // ("None" in the creator) attaches nothing.
    if (playerState.glassesKind) {
      this.model.glassesAnchor.add(createGlasses(playerState.glassesKind).root);
    }

    this.label = new NameLabel(playerState.name);
    this.label.sprite.position.y = this.labelTopHeight() + 0.42;
    this.group.add(this.label.sprite);

    this.position.copy(spawn);
    this.position.y = terrainHeight(spawn.x, spawn.z);
    this.previousPosition.copy(this.position);
    this.group.position.copy(this.position);
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
   * `ui/ScreenControls.ts` puts the up and down buttons on screen at all. A
   * button that is there while the take-off is refused is exactly the promise
   * this game does not make.
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
    this.velocity.set(0, 0, 0);
    this.verticalVelocity = 0;
    this.airborne = false;
    // The ride is flying her now. She keeps the pack on — it is hers — but it
    // stops being what holds her up, and its flames go out (see `update`).
    this.flying = false;
  }

  /** Called by the ride every frame while it owns the character. */
  setRidePose(x: number, y: number, z: number, facing: number): void {
    this.position.set(x, y, z);
    this.previousPosition.copy(this.position);
    this.facingAngle = facing;
    this.group.position.copy(this.position);
    this.group.rotation.y = facing;
  }

  /** Gives the character back, optionally still moving. */
  endRide(velocityX = 0, velocityY = 0, velocityZ = 0): void {
    this.ridingFlag = false;
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
      this.wornJetpack?.setThrust(0);
      this.gait = damp(this.gait, 0, 0.1, dt);
      this.animate(context, 0);
      this.model.leftArm.rotation.x = -2.5;
      this.model.rightArm.rotation.x = -2.5;
      this.model.leftArm.rotation.z = 0.5;
      this.model.rightArm.rotation.z = -0.5;
      this.model.body.rotation.x = 0.3;
      this.model.leftLeg.rotation.x = -0.7;
      this.model.rightLeg.rotation.x = -0.55;
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

    // --- take off (the jet pack) ---------------------------------------------
    // A tap on the fly button — and only where she may actually fly. The HUD
    // hides the buttons on exactly the same question ({@link canFlyHere}), so a
    // button that is there and a take-off that is allowed are one fact rather
    // than two that can drift apart.
    const canFly = this.canFlyHere;
    if (canFly && !this.flying && input.justPressed('fly')) {
      this.flying = true;
      this.airborne = true;
      // Straight to climbing speed: a take-off that has to build up reads as
      // the button not having worked.
      this.verticalVelocity = FLY_RISE_SPEED;
      // A rainbow off the ground she is leaving, exactly like a hop.
      this.spawnHopRing(groundY);
    }

    // --- hop ----------------------------------------------------------------
    if ((input.justPressed('jump') || autoHopWanted) && !this.airborne) {
      this.verticalVelocity = JUMP_SPEED;
      this.airborne = true;
      this.spawnHopRing(groundY);
    }
    let hopHeight = 0;
    if (this.flying) {
      // Hold to climb, let go to come down. `jump` counts too, so the space bar
      // a child is already holding does the obvious thing rather than nothing.
      const thrusting = canFly && (input.isDown('fly') || input.isDown('jump'));
      // And hold *down* to come down briskly rather than drifting. Up wins when
      // both are held: it is the button that makes something happen, and a
      // six-year-old with a thumb on each should go up rather than stall.
      const diving = !thrusting && input.isDown('flyDown');
      const height = this.position.y - groundY;
      // Ease off into the ceiling instead of stopping dead against it.
      const headroom = clamp01((this.flyCeiling - height) / FLY_CEILING_EASE);
      const target = thrusting
        ? FLY_RISE_SPEED * headroom
        : diving
          ? -FLY_DIVE_SPEED
          : -FLY_SINK_SPEED;
      this.verticalVelocity = approachScalar(
        this.verticalVelocity,
        target,
        FLY_VERTICAL_ACCELERATION * dt,
      );
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
    this.blinkTimer -= dt;
    if (this.blinkTimer <= 0) {
      this.blinkTimer = 2.6 + Math.random() * 3.4;
      this.blinkRemaining = BLINK_DURATION;
    }
    if (this.blinkRemaining > 0) this.blinkRemaining -= dt;

    const blinking = this.blinkRemaining > 0;
    const desiredExpression: Expression = blinking
      ? 'blink'
      : this.railRaceFrown
        ? 'frown'
        : this.waterHappy || this.smelling
          ? 'happy'
          : 'neutral';
    if (desiredExpression !== this.currentExpression) {
      this.currentExpression = desiredExpression;
      model.setExpression(desiredExpression);
    }

    // Secondary motion the model owns: the swishy ponytail, if that is what
    // the child chose. Last, and deliberately so — it is pinned to the world
    // position of an anchor on the head, and the head's pose for this frame
    // was only just written above. See `CharacterModel.update`.
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
