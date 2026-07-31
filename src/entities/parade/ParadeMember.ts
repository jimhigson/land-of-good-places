import { Group, Vector3 } from 'three';
import { clamp, clamp01, TAU, turnTowards } from '../../core/mathUtils';
import { disposeTree } from '../../art/style/materials';
import type { AssetHandle, CreatureHandle } from '../../art/style/asset';
import type { Expression } from '../../art/style/faces';
import { createJetpack, type JetpackHandle } from '../../art/models/jetpack';
import { KID_HEIGHT } from '../../art/models/kid';
import type { ShopItem } from '../../world/building/shops/catalogue';

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

  constructor(uid: string, item: ShopItem) {
    this.uid = uid;
    this.itemId = item.id;
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

    // Stagger the first joyful face so eight toys do not all beam at once.
    this.joyCountdown = 2 + Math.random() * 7;
    this.root.scale.setScalar(0.001);
  }

  /** Height of the model in metres — the parade uses it to space the line out. */
  get height(): number {
    return this.handle.height;
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
    const wanted: Expression = this.joyRemaining > 0 ? 'happy' : 'neutral';
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
