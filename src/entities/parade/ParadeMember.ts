import { Box3, Group, Vector3 } from 'three';
import { clamp, clamp01, TAU, turnTowards } from '../../core/mathUtils';
import { disposeTree } from '../../art/style/materials';
import type { AssetHandle, CreatureHandle } from '../../art/style/asset';
import type { Expression } from '../../art/style/faces';
import { createJetpack, type JetpackHandle } from '../../art/models/jetpack';
import { KID_HEIGHT } from '../../art/models/kid';
import type { ShopItem } from '../../world/building/shops/catalogue';
import type { PetBedSpot } from '../../world/hotel/Hotel';

/**
 * One cute thing walking behind you.
 *
 * Two sorts, decided by what the model can actually do rather than by what
 * shop it came from — which means a new asset joins the parade correctly the
 * day it is written, without anyone remembering to add it to a list:
 *
 * - **walker** — anything implementing `CreatureHandle`: RiPika, Biscuit, the
 *   pets, later the minis. Driven through `setWalkPhase`, speed-matched to the
 *   ground it covers so the legs never skate.
 * - **hopper** — a cute thing with no walk cycle at all, like the Twinkle Star.
 *   It bounces along instead, which is funnier than sliding.
 *
 * There used to be a third, **floater**, for balloons — riding along above the
 * line on their string. Balloons no longer walk at all: they are *held*, above
 * the player, on a bending string (see `entities/HeldBalloon.ts` and
 * `Parade.ts`'s `isOut`, which excludes them outright), so a balloon never
 * reaches a `ParadeMember` to need a style in the first place.
 */
export type MemberStyle = 'walker' | 'hopper';

/** Anything that can pull a face. Creatures can; so could a hopper, in principle. */
interface Expressive {
  setExpression(name: Expression): void;
}

/** How fast a follower has to travel to count as "flat out", in m/s. */
const TOP_SPEED = 4.2;

/** Seconds for the follow spring to close most of the gap. Bigger = dreamier. */
const FOLLOW_SMOOTH = 0.19;

/** Radians per second a follower can turn. Generous — they are small and light. */
const TURN_SPEED = 7;

/** Peak height of a member's copycat hop, in metres. */
const HOP_HEIGHT = 0.42;

/** Seconds a hop lasts. */
const HOP_SECONDS = 0.44;

/** Seconds the pop-in / poof-out takes. */
const POP_SECONDS = 0.34;

/** Seconds a joyful face is held before going back to neutral. */
const JOY_SECONDS = 1.1;

/**
 * How close a pet has to get to its own bed's run-up spot before it starts
 * climbing in — see {@link ParadeMember.goToBed}.
 *
 * Loose enough that the critically-damped follow spring's own settle can never
 * leave a pet hovering a few centimetres short of its bed for ever; tight
 * enough that "arrived" means standing at the bed rather than somewhere in the
 * room. Measured against `root.position`, never against {@link target}, which
 * is the goal from the first frame and would call every pet arrived before it
 * had moved at all.
 */
const BED_ARRIVE_RADIUS = 0.35;

/**
 * Seconds a pet takes to trot off the floor and settle onto its own cushion.
 *
 * Long enough to read as *the pet getting into bed* — the whole point of a
 * nap for a six-year-old — and short enough to finish well inside the nap
 * itself (`Hotel.NAP_SECONDS`).
 */
const BED_CLIMB_SECONDS = 0.8;

/**
 * The sleeping pose, as a rotation of the whole model: tipped a quarter turn
 * back about X — which swings the head, and so the pillow end, to −Z — and
 * rolled a quarter turn about its own Y so it lies **on its side** rather than
 * flat on its back.
 *
 * Both quarters matter, and both were measured on the real bed
 * (`art/models/hotelAssets.ts`, `createPetBed`) rather than picked:
 *
 * - Every pet stands {@link PET_RENDER_HEIGHT} = 1.46 m tall, so tipped flat on
 *   its back its own *depth* becomes its height in the bed — 1.09 m for the
 *   kitten, 1.30 m for the puff — against a canopy whose fabric starts at
 *   0.72 m and peaks at 1.27 m. Three of the four pets went through the roof of
 *   their own bed.
 * - Rolled onto its side it is the pet's *width* that stands up instead — 0.67 m
 *   for the bunny, 0.84 m for the kitten, 0.90 m for the mouse — which clears
 *   the canopy, and it is what a sleeping animal actually looks like.
 * - Y is +π/2 rather than −π/2 so the pet's front (and its face) rolls toward
 *   +X, which is the side the fixed iso camera looks from.
 *
 * Three.js applies an `XYZ` Euler as `Rx·Ry·Rz`, so the roll happens in the
 * pet's own frame first and the tip afterwards, which is what keeps the head
 * on the pillow whichever way it is rolled.
 */
const BED_POSE_X = -Math.PI / 2;
const BED_POSE_Y = Math.PI / 2;

/** Where a pet is in {@link ParadeMember.goToBed}'s routine. */
export type BedPhase = 'walking' | 'climbing' | 'asleep';

/**
 * The smallest a follower's jet pack may be shrunk, as a fraction of the one on
 * the player's back.
 *
 * Scaled off the wearer so a mouse gets a mouse-sized rocket rather than a
 * wardrobe — but floored, because past about a quarter size the tanks, the
 * nozzles and the fin stop being readable at all and it reads as a smudge on
 * the toy's back. Better slightly too big and obviously a jet pack.
 */
const MIN_JETPACK_SCALE = 0.28;

export class ParadeMember {
  /** The purchase this member *is* — the key everything else identifies it by. */
  readonly uid: string;
  readonly itemId: string;
  /** The catalogue's own category — `'pet'`, `'toy'`, … See {@link Parade.setPetsHidden}. */
  readonly kind: ShopItem['kind'];
  readonly displayName: string;
  readonly style: MemberStyle;
  /** World-space node. Origin at the feet, per the asset contract. */
  readonly root: Group;

  /** Distance back along the trail this member follows, in metres. */
  offset = 0;
  /** Position in the visible line, 0 nearest the player. Drives the hop ripple. */
  slot = 0;
  /**
   * Where on the trail this member is trying to be, already resolved onto the
   * walkable surface. Written by the parade each frame — and deliberately *not*
   * written for a member that is leaving, so a poofing toy holds still while it
   * shrinks instead of chasing the line it has just left.
   */
  readonly target = new Vector3();

  private readonly handle: AssetHandle;
  private readonly creature: CreatureHandle | null;
  private readonly expressive: Expressive | null;

  private readonly position = new Vector3();
  private readonly velocity = new Vector3();

  private facing = 0;
  /** 0..1 through one stride. Advanced by distance covered, never by time. */
  private phase = 0;
  private gait = 0;
  private readonly cyclesPerMetre: number;

  private hopTimer = -1;
  private hopDelay = 0;

  private expression: Expression = 'neutral';
  private joyRemaining = 0;
  private joyCountdown: number;

  private pop = 0;
  private leaving = false;
  private placedYet = false;

  /**
   * This one's own jet pack, built the first time the player ever takes off and
   * kept thereafter.
   *
   * Lazy on purpose: most children will never buy a jet pack, and building
   * eight of these at construction would put a rocket's worth of geometry
   * behind every toy in the park for a feature nobody had bought yet. Kept
   * rather than rebuilt because a child who has one takes off constantly, and
   * this is a `new` per take-off otherwise.
   */
  private jetpack: JetpackHandle | null = null;
  private flying = false;

  /**
   * This one's own bed in the hotel suite while the player naps, or `null`
   * the rest of the time — see {@link goToBed}. Holding it here, on the
   * member, is what makes this class the **single** owner of where its body
   * is and whether it is drawn, awake or asleep: nothing else in the game
   * moves, hides or poses a parade pet.
   */
  private bed: PetBedSpot | null = null;
  private phase_: BedPhase = 'walking';
  private climbTimer = 0;
  /** Where the climb starts from, captured on arrival at the run-up spot. */
  private readonly climbFrom = new Vector3();
  private climbFromFacing = 0;

  /**
   * The offset from a bed's cushion centre that puts **this** model's own
   * lowest point exactly on the cushion and its plan footprint centred on the
   * bed — measured off the built model in {@link measureSleepOffset}, never
   * hand-written, because the four pets differ by up to 0.29 m in the y term
   * alone and a shared literal is the "two definitions of one thing"
   * CLAUDE.md warns about.
   */
  private readonly sleepOffset = new Vector3();

  constructor(uid: string, item: ShopItem) {
    this.uid = uid;
    this.itemId = item.id;
    this.kind = item.kind;
    this.displayName = item.displayName;

    this.handle = item.model();
    this.root = this.handle.root;
    this.root.name = `parade:${uid}`;

    this.creature = hasWalk(this.handle) ? this.handle : null;
    this.expressive = hasExpression(this.handle) ? this.handle : null;
    this.style = this.creature ? 'walker' : 'hopper';

    // A short creature takes more steps over the same ground than a tall one.
    // Deriving the stride from the model's own height is what keeps a bunny and
    // a teddy walking at the same *speed* without either one moon-walking.
    this.cyclesPerMetre = 1 / Math.max(0.32, this.handle.height * 0.85);

    // Before the pop-in shrinks the model to nothing: the measurement has to
    // be taken at full size, and this is the one moment in a member's life
    // when the model is built, unposed and not yet scaled or carrying a jet
    // pack (which is lazy, and would otherwise land inside the box).
    this.measureSleepOffset();

    // Stagger the first joyful face so eight toys do not all beam at once.
    this.joyCountdown = 2 + Math.random() * 7;
    this.root.scale.setScalar(0.001);
  }

  /** Height of the model in metres — the parade uses it to space the line out. */
  get height(): number {
    return this.handle.height;
  }

  /**
   * This one's own bed while the player naps, or `null` — the parade reads it
   * to know whether to aim this member at a trail sample or at its bed.
   */
  get bedSpot(): PetBedSpot | null {
    return this.bed;
  }

  /**
   * Where this one is in its bedtime routine, or `null` if it is not going to
   * bed at all. `'asleep'` is the only state a "Z" glyph — or a check — should
   * treat as *in bed*.
   */
  get bedPhase(): BedPhase | null {
    return this.bed ? this.phase_ : null;
  }

  /**
   * **Go to bed**: walk to `bed`'s run-up spot on the floor beside it, then
   * climb in and lie down. The hotel suite's nap is the one caller, by way of
   * `Parade.sendPetToBed`.
   *
   * The walk is the ordinary follow spring every member already uses — the
   * parade simply points {@link target} at the run-up spot instead of at a
   * trail sample — so there is no second way of moving a pet anywhere in this
   * game. The climb and the sleeping pose are this class's own, for the same
   * reason: the body a child is watching is this one, and nothing else may
   * write to it. There is no stand-in, no hand-off and no second model, so
   * there is nothing for a hand-off to get wrong (Jim, 23 Aug 2026: the pet
   * *"phases in and out of existence on alternating frames … then morphs into
   * a totally different pet"*).
   *
   * Idempotent for a pet already on its way to the same bed, so a caller may
   * re-assert it every frame if it likes.
   */
  goToBed(bed: PetBedSpot): void {
    if (this.bed === bed) return;
    this.bed = bed;
    this.phase_ = 'walking';
    this.climbTimer = 0;
  }

  /**
   * The nap is over: stand back up, wherever the routine had got to, and
   * rejoin the line. A no-op for a member that was never sent to bed.
   */
  getOutOfBed(): void {
    if (!this.bed) return;
    this.bed = null;
    this.phase_ = 'walking';
    this.climbTimer = 0;
    this.root.rotation.set(0, this.facing, 0);
    // No teleport out: {@link position} tracked the body the whole way into
    // the bed (see {@link updateInBed}), so the ordinary follow spring simply
    // carries it back to its place in the line from where it was lying.
    this.velocity.set(0, 0, 0);
    this.rejoice();
  }

  /** True once the poof-out has finished and the member can be thrown away. */
  get gone(): boolean {
    return this.leaving && this.pop <= 0;
  }

  /** False until {@link placeAt} has put this member on the ground even once. */
  get placed(): boolean {
    return this.placedYet;
  }

  /** Drops the member somewhere immediately, with no follow-lag to catch up. */
  placeAt(x: number, y: number, z: number, facing: number): void {
    this.placedYet = true;
    this.position.set(x, y, z);
    this.target.set(x, y, z);
    this.velocity.set(0, 0, 0);
    this.facing = facing;
    this.root.position.copy(this.position);
    this.root.rotation.y = facing;
  }

  /** Starts the poof-out. The member keeps updating until {@link gone}. */
  beginExit(): void {
    this.leaving = true;
  }

  /**
   * Changed your mind: the member swells back up and rejoins the line.
   *
   * Necessary as well as nice. Putting a toy away from the Cute-o-dex happens
   * while the book has the park paused, so the poof-out has not moved a frame by
   * the time it is un-stowed again — and without this it would come back as a
   * *second* copy standing inside the first.
   */
  cancelExit(): void {
    this.leaving = false;
    this.rejoice();
  }

  /**
   * Hop, because the player just did.
   *
   * `delay` staggers the line so the hop travels down it like a Mexican wave —
   * far cuter than eight toys leaving the ground on the same frame, and it costs
   * one number.
   */
  hop(delay: number): void {
    if (this.hopTimer >= 0) return;
    this.hopDelay = delay;
    this.hopTimer = 0;
    this.rejoice();
  }

  /**
   * Straps a jet pack on this one, or takes it off.
   *
   * Eleri's rule: *"when you use it your pet gets one too."* The parade calls it
   * every frame with `player.isFlying`; it does nothing at all when the answer
   * has not changed, so a member that is walking costs one comparison.
   *
   * Everything in the line gets one, not only the pets — a teddy bear with a
   * rocket on its back is exactly the sort of thing this game is for, and
   * "everything you own comes with you" is already the rule the parade lives by.
   */
  setFlying(flying: boolean): void {
    if (flying === this.flying) return;
    this.flying = flying;
    if (flying && !this.jetpack) this.jetpack = this.buildJetpack();
    const pack = this.jetpack;
    if (pack) {
      pack.root.visible = flying;
      pack.setThrust(flying ? 1 : 0);
    }
    // Delighted, obviously.
    if (flying) this.rejoice();
  }

  /** Pulls a delighted face for a moment. */
  rejoice(): void {
    this.joyRemaining = JOY_SECONDS;
    this.joyCountdown = 4 + Math.random() * 6;
  }

  /** Follows {@link target}, animates, and writes the result onto `root`. */
  update(dt: number, elapsed: number): void {
    const bed = this.bed;
    // Past the run-up spot the bedtime routine owns this body outright — the
    // climb and the sleeping pose are not a spring following a target, and
    // letting both write `root` in the same frame is the two-owners bug this
    // whole class is now the single owner against.
    if (bed && this.phase_ !== 'walking') {
      this.updateInBed(dt, elapsed, bed);
      return;
    }

    const target = this.target;
    this.updatePop(dt);

    const previousX = this.position.x;
    const previousZ = this.position.z;

    smoothDamp(this.position, this.velocity, target, FOLLOW_SMOOTH, dt, 'x');
    smoothDamp(this.position, this.velocity, target, FOLLOW_SMOOTH, dt, 'z');
    // Height is followed hard rather than sprung: a toy that lags in Y sinks
    // into the step it is climbing, and there is nothing cute about that.
    this.position.y += (target.y - this.position.y) * clamp01(dt * 14);

    const moved = Math.hypot(this.position.x - previousX, this.position.z - previousZ);
    const speed = dt > 0 ? moved / dt : 0;
    this.gait += (clamp01(speed / TOP_SPEED) - this.gait) * clamp01(dt * 9);

    if (moved > 1e-4) {
      const wanted = Math.atan2(this.position.x - previousX, this.position.z - previousZ);
      this.facing = turnTowards(this.facing, wanted, TURN_SPEED * dt);
    }

    this.phase = (this.phase + moved * this.cyclesPerMetre) % 1;

    const hopLift = this.updateHop(dt);
    const styleLift = this.pose(dt, elapsed, hopLift);

    this.root.position.set(
      this.position.x,
      this.position.y + hopLift + styleLift,
      this.position.z,
    );
    this.root.rotation.y = this.facing;
    this.handle.update?.(dt, elapsed);
    // Flickers the flames. Only while lit — see `createJetpack`.
    if (this.flying) this.jetpack?.update?.(dt, elapsed);

    // Arrived at its own bed? Asked of the body that was just drawn, never of
    // {@link target}, which has been the run-up spot since the first frame.
    if (bed && Math.hypot(this.position.x - bed.runUpX, this.position.z - bed.runUpZ) <= BED_ARRIVE_RADIUS) {
      this.phase_ = 'climbing';
      this.climbTimer = 0;
      this.climbFrom.copy(this.position);
      this.climbFromFacing = this.facing;
    }
  }

  dispose(): void {
    this.root.removeFromParent();
    // Explicitly, rather than trusting the sweep below: a handle with its own
    // `dispose` frees what *it* built, and the jet pack was added afterwards by
    // this class.
    if (this.jetpack) {
      this.jetpack.root.removeFromParent();
      disposeTree(this.jetpack.root);
      this.jetpack = null;
    }
    if (this.handle.dispose) this.handle.dispose();
    else disposeTree(this.root);
  }

  // -------------------------------------------------------------- internals

  /**
   * One frame of a pet climbing into, and then sleeping in, its own bed.
   *
   * **The one owner of this body's transform while it is in bed.** No spring,
   * no trail, no second model: the climb eases the same body from the run-up
   * spot it walked to onto the cushion, and the sleeping pose holds it there.
   * {@link position} is kept level with what is drawn throughout, so waking is
   * simply handing this body back to the spring rather than a teleport.
   */
  private updateInBed(dt: number, elapsed: number, bed: PetBedSpot): void {
    this.updatePop(dt);

    const restX = bed.cushionX + this.sleepOffset.x;
    const restY = bed.cushionTop + this.sleepOffset.y;
    const restZ = bed.cushionZ + this.sleepOffset.z;

    if (this.phase_ === 'climbing') {
      this.climbTimer += dt;
      const t = clamp01(this.climbTimer / BED_CLIMB_SECONDS);
      // The same smoothstep the rest of the game eases a short move with, so a
      // pet getting into bed reads like everything else that arrives softly.
      const eased = t * t * (3 - 2 * t);
      this.position.set(
        this.climbFrom.x + (restX - this.climbFrom.x) * eased,
        this.climbFrom.y + (restY - this.climbFrom.y) * eased,
        this.climbFrom.z + (restZ - this.climbFrom.z) * eased,
      );
      this.root.rotation.set(
        BED_POSE_X * eased,
        this.climbFromFacing + (BED_POSE_Y - this.climbFromFacing) * eased,
        0,
      );
      // Still trotting while it climbs — the stride every pet in the park has.
      this.creature?.setWalkPhase(elapsed * 9, 1);
      if (t >= 1) this.phase_ = 'asleep';
    } else {
      this.position.set(restX, restY, restZ);
      this.root.rotation.set(BED_POSE_X, BED_POSE_Y, 0);
      // Asleep: breathing, no stride — `setWalkPhase(phase, 0)` is the pets'
      // own idle, the same one every other still pet in the park uses.
      this.creature?.setWalkPhase(elapsed * 0.7, 0);
    }

    this.root.position.copy(this.position);
    this.facing = this.root.rotation.y;
    this.gait = 0;
    this.updateFace(dt);
    this.handle.update?.(dt, elapsed);
  }

  /**
   * Measures the offset from a cushion's centre that lands **this** model's
   * lowest point on the cushion and its plan footprint centred on the bed,
   * in the {@link BED_POSE_X}/{@link BED_POSE_Y} sleeping pose.
   *
   * Measured, never written down. The pose that shipped before this put every
   * pet's *feet* at the bed's centre and let the rest of it hang off the
   * pillow end — a bunny lay from z −0.10 to −1.57 on a bolster that stops at
   * −0.67, i.e. 0.90 m of rabbit over the edge, and the kitten, mouse and puff
   * all had their lowest point *below the floor*. That was Jim's *"clips out
   * of the bed and floats half hanging off the edge"* (23 Aug 2026), and no
   * single hand-picked drop could have fixed it for all four: the four pets'
   * own y terms differ by 0.29 m.
   *
   * Taken in the constructor because that is the one moment the model is at
   * full scale, unposed, and has no lazily-built jet pack in it to inflate the
   * box.
   */
  private measureSleepOffset(): void {
    const rotation = this.root.rotation.clone();
    const scale = this.root.scale.clone();
    const position = this.root.position.clone();
    this.root.rotation.set(BED_POSE_X, BED_POSE_Y, 0);
    this.root.scale.setScalar(1);
    this.root.position.set(0, 0, 0);
    this.root.updateMatrixWorld(true);
    const box = new Box3().setFromObject(this.root);
    if (!box.isEmpty()) {
      this.sleepOffset.set(
        -(box.min.x + box.max.x) / 2,
        -box.min.y,
        -(box.min.z + box.max.z) / 2,
      );
    }
    this.root.rotation.copy(rotation);
    this.root.scale.copy(scale);
    this.root.position.copy(position);
    this.root.updateMatrixWorld(true);
  }

  /**
   * Builds this one's jet pack and straps it to its back.
   *
   * Mounted on `body` where there is one, so it rides the bob and the squash
   * with the rest of the creature rather than floating steadily behind a
   * bouncing bunny. Placed and sized from the model's own measured `height`, so
   * a mouse, a teddy and a squishy star each get one that fits without a table
   * of per-asset offsets that a new toy would not be in.
   */
  private buildJetpack(): JetpackHandle {
    const height = this.handle.height;
    const pack = createJetpack(clamp(height / KID_HEIGHT, MIN_JETPACK_SCALE, 1));
    // Mid-back, and proud of it: the same fractions of a body the player's own
    // anchor sits at (0.56 / 2.12 up, 0.32 / 2.12 back — see `art/models/kid.ts`).
    pack.root.position.set(0, height * 0.26, -height * 0.15);
    (this.creature?.body ?? this.root).add(pack.root);
    return pack;
  }

  /** Squash-and-stretch pop on arrival, and the reverse on the way out. */
  private updatePop(dt: number): void {
    const target = this.leaving ? 0 : 1;
    const step = dt / POP_SECONDS;
    this.pop = target > this.pop ? Math.min(1, this.pop + step) : Math.max(0, this.pop - step);
    // Overshoot in the middle, settle at the end — the same bounce the buttons
    // and the carried item use, so the whole game pops the same way.
    const eased = 1 + Math.sin(this.pop * Math.PI) * 0.3;
    this.root.scale.setScalar(Math.max(0.001, this.pop * eased));
    // **The one and only writer of this member's visibility, ever.** It reads
    // one number, which moves at most one step a frame, so this body cannot
    // flicker: there is no second system with an opinion about whether a pet
    // is on screen (Jim, 23 Aug 2026, on the version that had one: the pet
    // *"phases in and out of existence on alternating frames"*).
    this.root.visible = this.pop > 0.002;
  }

  /** Returns the current hop height in metres, and advances the hop clock. */
  private updateHop(dt: number): number {
    if (this.hopTimer < 0) return 0;
    this.hopTimer += dt;
    if (this.hopTimer < this.hopDelay) return 0;

    const t = (this.hopTimer - this.hopDelay) / HOP_SECONDS;
    if (t >= 1) {
      this.hopTimer = -1;
      return 0;
    }
    return Math.sin(t * Math.PI) * HOP_HEIGHT;
  }

  /** Poses the model for this frame and returns any extra height it wants. */
  private pose(dt: number, elapsed: number, hopLift: number): number {
    let lift = 0;

    switch (this.style) {
      case 'walker': {
        const creature = this.creature!;
        creature.setWalkPhase(this.phase, this.gait);
        // Airborne: legs tucked and arms up, over the top of the walk cycle.
        // Flying counts — a jet pack is the longest hop there is, and the pose
        // that reads as "off the ground" is the same one either way.
        if ((hopLift > 0.01 || this.flying) && creature.limbs) {
          creature.limbs.leftArm.rotation.x = -1.5;
          creature.limbs.rightArm.rotation.x = -1.5;
          creature.limbs.leftLeg.rotation.x = 0.5;
          creature.limbs.rightLeg.rotation.x = 0.35;
        }
        // A little look up at the player when idling right behind her.
        creature.head.rotation.x = -0.1 * (1 - this.gait) + Math.sin(elapsed * 2.1) * 0.03;
        break;
      }
      case 'hopper': {
        // No legs, so it bounces: two hops a stride, plus a happy little tilt.
        lift = Math.abs(Math.sin(this.phase * TAU)) * 0.16 * this.gait;
        this.root.rotation.z = Math.sin(this.phase * TAU) * 0.16 * this.gait;
        break;
      }
    }

    this.updateFace(dt);
    return lift;
  }

  private updateFace(dt: number): void {
    if (!this.expressive) return;

    if (this.joyRemaining > 0) this.joyRemaining -= dt;
    else {
      this.joyCountdown -= dt;
      if (this.joyCountdown <= 0) this.rejoice();
    }

    // Faces are canvas textures: `setExpression` re-uploads one. Only ever call
    // it on a transition, never per frame. See ARCHITECTURE.md.
    //
    // Asleep in its own bed beats every other mood: a blink *is* shut eyes, so
    // holding it is the whole of "this pet is asleep" — the same one mechanism
    // `Player.sleeping` uses for the child in the bed next to it, rather than a
    // second eye-closing idea.
    const wanted: Expression =
      this.bedPhase === 'asleep' ? 'blink' : this.joyRemaining > 0 ? 'happy' : 'neutral';
    if (wanted === this.expression) return;
    this.expression = wanted;
    this.expressive.setExpression(wanted);
  }
}

// ------------------------------------------------------------------ helpers

function hasWalk(handle: AssetHandle): handle is CreatureHandle {
  return typeof (handle as Partial<CreatureHandle>).setWalkPhase === 'function';
}

function hasExpression(handle: AssetHandle): handle is AssetHandle & Expressive {
  return typeof (handle as Partial<Expressive>).setExpression === 'function';
}

/**
 * A critically-damped spring, on one axis, that cannot explode.
 *
 * The usual `damp()` helper is an exponential ease with no velocity, which makes
 * a follower stop dead the instant the thing it follows does. This carries
 * momentum, so the line settles with a tiny lean rather than a freeze — and the
 * rational approximation of `exp` keeps it stable at any frame time, which
 * matters on a phone that has just dropped to 20 fps.
 */
function smoothDamp(
  position: Vector3,
  velocity: Vector3,
  target: Vector3,
  smoothTime: number,
  dt: number,
  axis: 'x' | 'z',
): void {
  if (dt <= 0) return;
  const omega = 2 / smoothTime;
  const x = omega * dt;
  const decay = 1 / (1 + x + 0.48 * x * x + 0.235 * x * x * x);
  const change = position[axis] - target[axis];
  const temp = (velocity[axis] + omega * change) * dt;
  velocity[axis] = (velocity[axis] - omega * temp) * decay;
  position[axis] = target[axis] + (change + temp) * decay;
}
