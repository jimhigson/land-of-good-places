import { Group } from 'three';
import { Rng } from '../../core/mathUtils';
import { SpritePuffs } from '../../art/effects/spritePuffs';
import { createLibraryBookPile, createLibraryCat, type BookPileHandle, type CatHandle } from '../../art/models/libraryCreatures';
import { playPurr } from '../../ui/chime';
import { measureTop } from '../measuredTop';
import { LIBRARY_LINES } from './libraryLines';
import { LIBRARY_CAT_PILE } from './layout';
import { posedFootprint, sweep, type BoxFootprint, type BoxWalls, type LibraryProps } from './props';

/**
 * **The library cat, asleep on a pile of books by the desk** (#719, plan
 * Step 13) — Jim, 13 October 2026: *"a sleeping cat that purrs and twitches
 * when petted"*.
 *
 * Beside the librarian's desk, in its lamp's pool, turned to face the camera
 * (`LIBRARY_CAT_PILE`): the Artist's pile of five fat books (`bookPile-*`)
 * and, curled up on top of it, the ginger cat (`cat-*`), assembled by
 * `libraryCreatures.ts`. **Pet the cat!** from in front of her
 * (`LIBRARY_CAT_STAND`) and she lifts her head, twitches her ears, smiles,
 * sends up hearts and purrs; then she goes back to sleep.
 *
 * ## Solid, in its own shape
 *
 * Two bodies, each measured off the built model (PR #722: one 3D body per
 * solid, its real top):
 *
 * - **the pile** — a filled box of its drawn plan, outlines included, turned
 *   with it, to the books' measured top (0.9 m: over a step, so she meets its
 *   side; a jump reaches it).
 * - **the cat** — a filled box over every point she is drawn at in every pose
 *   she takes (her breath drawn in, her ears twitched, her head lifted: see
 *   {@link posedFootprint}), from the floor to the tips of her ears on the
 *   pile. Her top measures under two centimetres either side of its crest (her
 *   ears' tips), so the width rule (`CollisionWorld.toppedNarrow`) has it hold
 *   nobody: **nobody stands on a sleeping cat, by physics, not by a flag or a
 *   blocker**.
 *
 * The cat covers the pile's top all but a hand's breadth round her, so a child
 * who jumps up onto the books is pushed straight back off them by the cat.
 */

/** The cat's own seeded stream: the phase of her breath and her tail, her hearts' scatter. */
export const LIBRARY_CAT_SEED = 0x0b00d3;

/**
 * **How long a pet lasts** (seconds): the ears' twitch, the head's lift and its
 * ease back, the happy face — then asleep again. The one owner: `check:library`'s
 * CAT clause reads it.
 */
export const PET_SECONDS = 2.2;
/** A press within this of the last one (seconds) is ignored: a stroke, not a drum roll. */
export const PET_GUARD_SECONDS = 0.5;
/** The ears' twitch: this far either way (radians, `rotation.z`), two and a half times over this long. */
export const CAT_EAR_TWITCH = 0.3;
export const CAT_EAR_TWITCH_SECONDS = 0.6;
/**
 * The head's lift (radians, `rotation.x` about its pivot), reached over
 * {@link CAT_HEAD_LIFT_SECONDS}, held, and eased back over the pet's last
 * {@link CAT_HEAD_DOWN_SECONDS}. Negative lifts her face: `check:library`
 * measures her face rising, so the sign is the model's, read off it.
 */
export const CAT_HEAD_LIFT = -0.25;
export const CAT_HEAD_LIFT_SECONDS = 0.3;
const CAT_HEAD_DOWN_SECONDS = 0.6;
/** Hearts per pet. */
export const CAT_HEARTS = 3;
const CAT_HEART_POOL = 6;
/**
 * Breathing: `body.scale` sways by this share at this rate (radians a second)
 * — the plan's "1.1 Hz" read as the dragon's own formula's rate, because a
 * 1.1 Hz breath (66 a minute) is a pant, not a sleeping cat.
 */
export const CAT_BREATH_DEPTH = 0.025;
const CAT_BREATH_RATE = 1.1;
/** The tip of her tail sways this much (radians) while she sleeps, at this rate. */
const CAT_TAIL_SWAY = 0.08;
const CAT_TAIL_RATE = 0.9;

/** Her purr's bubble hangs this far over the tips of her ears; her hearts rise from this far over them. */
const CAT_BUBBLE_OVER = 0.45;
const CAT_HEARTS_OVER = 0.1;

/** Her Pet zone's id (`Library.ts` builds the zone) — the item her purr's bubble answers. */
export const CAT_ZONE_ID = 'library-cat';

/** The two solids' names — what `LIBRARY_CHECK_REMOVE` takes out by. */
export const CAT_SOLID = 'the library cat';
export const CAT_PILE_SOLID = "the cat's pile of books";

export class LibraryCat {
  /** The pile and the cat on it, one group at the pile's spot, turned to its facing — what the rainbow rings. */
  readonly group = new Group();
  readonly pile: BookPileHandle;
  readonly cat: CatHandle;
  /** The pile's body: its drawn plan, room-local, its collider and its measured top. */
  readonly pileFootprint: BoxFootprint;
  readonly pileCollider: BoxWalls;
  readonly pileTop: number;
  /** The cat's body: a box over every pose she is drawn in, room-local, its collider, its top over the floor and its measured width. */
  readonly catFootprint: BoxFootprint;
  readonly catCollider: BoxWalls;
  readonly catTop: number;
  readonly catTopHalf: number;
  readonly hearts: SpritePuffs;

  private readonly say: (line: string) => void;
  private readonly rng = new Rng(LIBRARY_CAT_SEED);
  private readonly breathPhase: number;
  private readonly tailPhase: number;
  private readonly rest: { readonly earL: number; readonly earR: number; readonly head: number; readonly tail: number };
  /** Seconds since the last pet that counted (Infinity before the first), and what is left of the one going. */
  private sincePet = Infinity;
  private petFor = 0;
  private petCount = 0;
  private purrNext = 0;

  /**
   * The pile and the cat at `LIBRARY_CAT_PILE`, both solid through `props`
   * (so both footprints are held clear of every stand spot), under the
   * reading room's root. `say` puts a line in the Library's creature bubble
   * over her.
   */
  constructor(roomRoot: Group, props: LibraryProps, say: (line: string) => void) {
    this.say = say;
    const spot = LIBRARY_CAT_PILE;
    this.pile = createLibraryBookPile();
    this.cat = createLibraryCat();
    this.breathPhase = this.rng.range(0, Math.PI * 2);
    this.tailPhase = this.rng.range(0, Math.PI * 2);
    const { earL, earR, head, tail } = this.cat;
    this.rest = { earL: earL.rotation.z, earR: earR.rotation.z, head: head.rotation.x, tail: tail.rotation.y };

    // Measured before anything is moved: the pile's top and plan, the cat's
    // own top and how wide a foot could stand on it.
    const pileTop = measureTop(this.pile.root);
    const catTop = measureTop(this.cat.root);
    this.pileTop = pileTop.top;
    this.catTop = this.pileTop + catTop.top;
    this.catTopHalf = catTop.topHalf;
    const plan = this.pile.plan;
    const yaw = (spot.facing * Math.PI) / 180;
    const cx = (plan.minX + plan.maxX) / 2;
    const cz = (plan.minZ + plan.maxZ) / 2;
    this.pileFootprint = {
      x: spot.x + cx * Math.cos(yaw) + cz * Math.sin(yaw),
      z: spot.z - cx * Math.sin(yaw) + cz * Math.cos(yaw),
      facing: spot.facing,
      halfLength: (plan.maxX - plan.minX) / 2,
      halfDepth: (plan.maxZ - plan.minZ) / 2,
    };
    // Her body covers her in every pose she is drawn in: her breath drawn in
    // (its widest), her ears anywhere across their twitch, her head anywhere
    // from down to lifted, her tail anywhere across its sway.
    const poses: (() => void)[] = [];
    for (const lift of sweep(0, CAT_HEAD_LIFT, 3)) {
      for (const twitch of sweep(-CAT_EAR_TWITCH, CAT_EAR_TWITCH, 5)) {
        for (const sway of sweep(-CAT_TAIL_SWAY, CAT_TAIL_SWAY, 3)) {
          poses.push(() => {
            head.rotation.x = this.rest.head + lift;
            earL.rotation.z = this.rest.earL + twitch;
            earR.rotation.z = this.rest.earR - twitch;
            tail.rotation.y = this.rest.tail + sway;
            this.breathe(CAT_BREATH_DEPTH);
          });
        }
      }
    }
    this.catFootprint = posedFootprint(this.cat.root, poses, spot, spot.facing);
    this.restPose();

    this.group.name = 'library.catAndPile';
    this.group.position.set(spot.x, 0, spot.z);
    this.group.rotation.y = yaw; // flat-ok: room-local yaw in the library's own flat space at (-600, -600), off the sphere
    this.cat.root.position.y = this.pileTop;
    this.group.add(this.pile.root, this.cat.root);
    roomRoot.add(this.group);

    // Two bodies, each in its own shape (see the class doc).
    this.pileCollider = props.box(CAT_PILE_SOLID, this.pileFootprint, this.pileTop, pileTop.topHalf);
    this.catCollider = props.box(CAT_SOLID, this.catFootprint, this.catTop, this.catTopHalf);

    this.hearts = new SpritePuffs(roomRoot, CAT_HEART_POOL);
  }

  // --------------------------------------------------------------- state

  /** Mid-pet: awake and happy, ears and head moving. */
  get petting(): boolean {
    return this.petFor > 0;
  }

  /** How many pets have counted since she was built (a press inside the guard is not one). */
  get pets(): number {
    return this.petCount;
  }

  /** Where her bubble hangs, room-local: over the tips of her ears. */
  get bubbleAt(): { readonly x: number; readonly y: number; readonly z: number } {
    return { x: LIBRARY_CAT_PILE.x, y: this.catTop + CAT_BUBBLE_OVER, z: LIBRARY_CAT_PILE.z };
  }

  // --------------------------------------------------------------- the press

  /**
   * **"Pet the cat!"** — ignored within {@link PET_GUARD_SECONDS} of the last
   * pet; otherwise {@link PET_SECONDS} of it: the ears twitch, the head lifts
   * and eases back, the face is happy, three hearts rise, she purrs and says
   * so. True when it counted.
   */
  pet(): boolean {
    if (this.sincePet < PET_GUARD_SECONDS) return false;
    this.sincePet = 0;
    this.petFor = PET_SECONDS;
    this.petCount += 1;
    this.hearts.puff(LIBRARY_CAT_PILE.x, this.catTop + CAT_HEARTS_OVER, LIBRARY_CAT_PILE.z, this.rng, CAT_HEARTS);
    playPurr();
    const purrs = LIBRARY_LINES.cat.purr;
    this.say(purrs[this.purrNext % purrs.length]!);
    this.purrNext += 1;
    return true;
  }

  /** She has left the library: a pet in progress ends and the cat is asleep again, head down. */
  leave(): void {
    this.petFor = 0;
    this.restPose();
    this.cat.setFace('asleep');
  }

  // --------------------------------------------------------------- every frame

  /** One frame, while she is in the reading room: her breath and tail, and the pet if one is going. */
  update(dt: number, elapsed: number): void {
    this.sincePet += dt;
    this.hearts.update(dt);
    const { earL, earR, head, tail } = this.cat;
    this.breathe(Math.sin(elapsed * CAT_BREATH_RATE + this.breathPhase) * CAT_BREATH_DEPTH);
    tail.rotation.y = this.rest.tail + CAT_TAIL_SWAY * Math.sin(elapsed * CAT_TAIL_RATE + this.tailPhase);
    if (this.petFor <= 0) {
      earL.rotation.z = this.rest.earL;
      earR.rotation.z = this.rest.earR;
      head.rotation.x = this.rest.head;
      this.cat.setFace('asleep');
      return;
    }
    this.petFor = Math.max(0, this.petFor - dt);
    const t = PET_SECONDS - this.petFor;
    // The ears: two and a half quick twitches, mirrored, at the start.
    const twitch = t < CAT_EAR_TWITCH_SECONDS ? CAT_EAR_TWITCH * Math.sin((t / CAT_EAR_TWITCH_SECONDS) * 5 * Math.PI) : 0;
    earL.rotation.z = this.rest.earL + twitch;
    earR.rotation.z = this.rest.earR - twitch;
    // The head: up over the first moments, held, eased back down at the end.
    const up = smooth(Math.min(1, t / CAT_HEAD_LIFT_SECONDS));
    const down = smooth(Math.min(1, this.petFor / CAT_HEAD_DOWN_SECONDS));
    head.rotation.x = this.rest.head + CAT_HEAD_LIFT * Math.min(up, down);
    this.cat.setFace(this.petFor > 0 ? 'happy' : 'asleep');
  }

  // ------------------------------------------------------------ private

  /** Ears, head and tail at rest, breath out of it — how she is measured from and how she sleeps. */
  private restPose(): void {
    const { earL, earR, head, tail, body } = this.cat;
    earL.rotation.z = this.rest.earL;
    earR.rotation.z = this.rest.earR;
    head.rotation.x = this.rest.head;
    tail.rotation.y = this.rest.tail;
    body.scale.set(1, 1, 1);
  }

  /** The breath's share `b` on her body: wider and lower as she breathes in, the owl's and the dragon's shape. */
  private breathe(b: number): void {
    this.cat.body.scale.set(1 + 0.6 * b, 1 - b, 1 + 0.6 * b);
  }
}

/** Smoothstep on [0, 1]. */
function smooth(u: number): number {
  return u * u * (3 - 2 * u);
}
