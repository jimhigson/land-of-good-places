import { Group, Vector3, type Object3D } from 'three';
import { angleDelta, clamp, damp, Rng } from '../../core/mathUtils';
import { PALETTE } from '../../core/palette';
import { gameStore } from '../../state/store';
import { discoverSecret } from '../../state/secrets';
import { createFaceLife, type FaceLife } from '../../art/style/faceLife';
import { SpritePuffs } from '../../art/effects/spritePuffs';
import {
  createLibraryDragon,
  createLibraryDragonNest,
  DRAGON_BELLY_REST_GLOW,
  type DragonHandle,
  type DragonNestHandle,
} from '../../art/models/libraryCreatures';
import { measureTop } from '../measuredTop';
import { LIBRARY_LINES } from './libraryLines';
import { LIBRARY_DRAGON_NEST, type LocalPoint } from './layout';
import { posedFootprint, type BoxFootprint, type BoxWalls, type LibraryProps } from './props';

/**
 * **The baby dragon on its nest of books** (#719, plan Step 13) — Jim, 13
 * October 2026: *"a secret door behind a bookshelf into a hidden room where a
 * baby dragon hoards books (nest, warm glow puff, a new Cute-o-dex entry)"*.
 *
 * In the secret den's far corner (`LIBRARY_DRAGON_NEST`), turned to face the
 * doorway and the camera: the Artist's nest (`library.glb`'s `dragonNest-*`,
 * a soft pink pad ringed by fat books) and, sitting on its pad, the mint baby
 * dragon (`dragon-*`, assembled by `libraryCreatures.ts`). Built under the
 * den's root, so it shows only while the den does.
 *
 * ## Solid, in its own shape
 *
 * Anything drawn is solid, and since PR #722 a solid is one 3D body with its
 * real top (Jim, 17 Oct 2026: *"anything should be jumpable with no special
 * 'floor' being marked to make it so"*). So the nest and the dragon are two
 * bodies, each its own shape, each measured off the built model:
 *
 * - **the nest** — a filled disc of its drawn reach, outlines included, its top
 *   the books' measured top (0.19 m: a step she could take). The whole disc is
 *   its top: the ring of books measures 0.12 m either side of its crown, over
 *   the 0.1 her feet need (`FOOT_HALF_WIDTH`), and the engine's alternative for
 *   a disc — a top round its *centre* — would be the pad under the dragon.
 * - **the dragon** — a filled box over every point it is drawn at in every
 *   pose it takes (its head turned either way, its tail flicked, its breath
 *   drawn in: {@link posedFootprint}), from the floor to the top of its horns.
 *   Its top measures 1.5 cm either side of its crest (the horns' tips), so the
 *   width rule (`CollisionWorld.toppedNarrow`) has it hold nobody: **nobody
 *   stands on a baby dragon, by physics, not by a flag or a blocker** — the
 *   plan's "one disc to the ceiling" is gone with the ceiling flag (PR #722).
 *
 * The dragon's body covers the nest's middle and comes within a stride of
 * every point of its rim, so a child who steps up onto the books is pushed
 * back off them by the dragon: she walks up to it and bumps into it.
 *
 * ## Alive
 *
 * It breathes (`body.scale`), blinks (`createFaceLife`), flicks its tail every
 * five to nine seconds, and — while she is in the den within
 * {@link DRAGON_LOOK_RADIUS} — turns its head to look at her, with a small
 * nod, happy to see her. Every nine to fourteen seconds, and whenever she says
 * hi, it **puffs**: its face goes round-mouthed, its cream belly glows warm
 * (the belly's own emissive, `DRAGON_BELLY_REST_GLOW` up by
 * {@link DRAGON_PUFF_GLOW} and back), and four warm sprites rise from its
 * mouth. No `PointLight` — the library's budget is eight of eight.
 *
 * ## Meeting it
 *
 * The first frame of a visit that she is in the den, with the secret shelf
 * open, within {@link DRAGON_MEET_RADIUS} of the nest: the **Dragon friend**
 * card (`secret.babyDragon`, idempotent), a hello — *"Oh, a visitor for me!"*
 * the first time ever, *"Hello again, friend!"* after — and a puff. **Say
 * hi!** ({@link sayHi}) puffs, answers with the next of its three lines, and
 * awards the card too, so the card is never further than the chip.
 */

/** The dragon's own seeded stream: its breath's phase, its tail's and its puffs' timing, its sprites' scatter. */
export const LIBRARY_DRAGON_SEED = 0x0b00d1;

/** Within this of the nest's middle (metres), in the den with the shelf open, she has met the dragon. */
export const DRAGON_MEET_RADIUS = 2.2;
/** Within this, in the den, it turns its head to watch her and is happy to see her. */
export const DRAGON_LOOK_RADIUS = 3;
/** How far its head turns either way (radians), and the half-life it turns with. */
export const DRAGON_HEAD_TURN_LIMIT = 0.6;
const DRAGON_HEAD_HALF_LIFE = 0.12;
/** The small nod while it watches her: this much (radians), at this rate (radians a second). */
export const DRAGON_NOD = 0.05;
const DRAGON_NOD_RATE = 2.2;

/** A puff lasts this long (seconds): the round mouth, the belly's glow up and back, the sprites rising. */
export const DRAGON_PUFF_SECONDS = 1.2;
/** How far the belly's warm emissive rises over its rest at the puff's height. */
export const DRAGON_PUFF_GLOW = 1.0;
/** Warm sprites per puff, from a pool of this many, this big. */
export const DRAGON_PUFF_SPRITES = 4;
const DRAGON_PUFF_POOL = 10;
const DRAGON_PUFF_SCALE = 0.3;
/** Between idle puffs, seconds: drawn from the dragon's stream each time. */
export const DRAGON_IDLE_PUFF_MIN = 9;
export const DRAGON_IDLE_PUFF_MAX = 14;

/** The tail flick: every five to nine seconds, one wag of this much either way (radians) over this long. */
export const DRAGON_TAIL_FLICK = 0.25;
export const DRAGON_TAIL_FLICK_SECONDS = 0.8;
const DRAGON_TAIL_FLICK_MIN = 5;
const DRAGON_TAIL_FLICK_MAX = 9;

/** Breathing: `body.scale` sways by this share, at this rate (radians a second) — the owl's own shape of breath. */
export const DRAGON_BREATH_DEPTH = 0.03;
const DRAGON_BREATH_RATE = 1.7;

/** Its words' bubble hangs this far over the top of its horns. */
const DRAGON_BUBBLE_OVER = 0.45;

/** The Cute-o-dex card for meeting it — `state/secrets.ts`'s row. */
export const DRAGON_FRIEND_SECRET = 'secret.babyDragon';

/** The two solids' names — what `LIBRARY_CHECK_REMOVE` takes out by. */
export const DRAGON_SOLID = 'the baby dragon';
export const DRAGON_NEST_SOLID = "the dragon's nest of books";

export class LibraryDen {
  /** The nest and the dragon on it, one group at the nest's spot, turned to its facing — under the den's root. */
  readonly group = new Group();
  readonly nest: DragonNestHandle;
  readonly dragon: DragonHandle;
  /** The nest's collider: a filled disc of its drawn reach (its `props.disc` id). */
  readonly nestRadius: number;
  /** The nest's measured top over the den's floor — where a foot on its books would rest. */
  readonly nestTop: number;
  /** The dragon's body: a filled box over every pose it is drawn in, room-local, and its collider. */
  readonly dragonFootprint: BoxFootprint;
  readonly dragonCollider: BoxWalls;
  /** The top of the dragon's body over the den's floor (its horns), and how much of it a foot could stand on. */
  readonly dragonTop: number;
  readonly dragonTopHalf: number;
  /** The warm sprites a puff sends up, in the den's frame. */
  readonly puffs: SpritePuffs;

  private readonly say: (line: string) => void;
  private readonly rng = new Rng(LIBRARY_DRAGON_SEED);
  private readonly face: FaceLife;
  private readonly breathPhase: number;
  private readonly tailRest: number;
  private readonly scratch = new Vector3();
  private readonly denRoot: Object3D;
  /** Seconds to the next idle puff, and how much of the puff showing now is left. */
  private puffIn: number;
  private puffFor = 0;
  private puffCount = 0;
  /** Seconds to the next tail flick, and how much of the one going is left. */
  private tailIn: number;
  private tailFor = 0;
  /** Which of its "Say hi!" answers is next. */
  private hiNext = 0;
  /** Met on this visit already (the hello is once a visit). */
  private met = false;

  /**
   * The nest and the dragon at `LIBRARY_DRAGON_NEST`, both solid through
   * `props` (so both footprints are held clear of every stand spot), under
   * `denRoot`. `say` puts a line in the Library's creature bubble over it.
   */
  constructor(denRoot: Group, props: LibraryProps, say: (line: string) => void) {
    this.denRoot = denRoot;
    this.say = say;
    const spot = LIBRARY_DRAGON_NEST;
    this.nest = createLibraryDragonNest();
    this.dragon = createLibraryDragon();
    this.tailRest = this.dragon.tail.rotation.y;
    this.breathPhase = this.rng.range(0, Math.PI * 2);
    this.puffIn = this.rng.range(DRAGON_IDLE_PUFF_MIN, DRAGON_IDLE_PUFF_MAX);
    this.tailIn = this.rng.range(DRAGON_TAIL_FLICK_MIN, DRAGON_TAIL_FLICK_MAX);

    // Measured before anything is moved or hidden: the nest's top and reach,
    // and the dragon's own top and how wide a foot could stand on it.
    const nestTop = measureTop(this.nest.root);
    const dragonTop = measureTop(this.dragon.root);
    this.nestRadius = this.nest.radius;
    this.nestTop = nestTop.top;
    this.dragonTop = this.nest.padTop + dragonTop.top;
    this.dragonTopHalf = dragonTop.topHalf;

    // The dragon's body covers it in every pose it is drawn in: the head turned
    // either way and nodding, the tail flicked either way, the breath drawn in.
    const { head, tail, body } = this.dragon;
    const poses: (() => void)[] = [];
    for (const turn of [-DRAGON_HEAD_TURN_LIMIT, 0, DRAGON_HEAD_TURN_LIMIT]) {
      for (const nod of [-DRAGON_NOD, DRAGON_NOD]) {
        for (const flick of [-DRAGON_TAIL_FLICK, DRAGON_TAIL_FLICK]) {
          poses.push(() => {
            head.rotation.set(nod, turn, 0);
            tail.rotation.y = this.tailRest + flick;
            this.breathe(DRAGON_BREATH_DEPTH);
          });
        }
      }
    }
    this.dragonFootprint = posedFootprint(this.dragon.root, poses, spot, spot.facing);
    head.rotation.set(0, 0, 0);
    tail.rotation.y = this.tailRest;
    body.scale.set(1, 1, 1);

    this.group.name = 'library.den.dragonAndNest';
    this.group.position.set(spot.x, 0, spot.z);
    this.group.rotation.y = (spot.facing * Math.PI) / 180; // flat-ok: room-local yaw in the library's own flat space at (-600, -600), off the sphere
    this.dragon.root.position.y = this.nest.padTop;
    this.group.add(this.nest.root, this.dragon.root);
    denRoot.add(this.group);

    // Two bodies, each in its own shape (see the class doc).
    props.disc(DRAGON_NEST_SOLID, spot.x, spot.z, this.nestRadius, this.nestTop);
    this.dragonCollider = props.box(DRAGON_SOLID, this.dragonFootprint, this.dragonTop, this.dragonTopHalf);

    this.puffs = new SpritePuffs(denRoot, DRAGON_PUFF_POOL, PALETTE.fairyWarm, DRAGON_PUFF_SCALE);
    this.face = createFaceLife((expression) => this.dragon.setExpression(expression));
  }

  // --------------------------------------------------------------- state

  /** Puffing now: the round mouth, the belly glowing, the sprites rising. */
  get puffing(): boolean {
    return this.puffFor > 0;
  }

  /** How many puffs since it was built — idle ones and hellos alike. */
  get puffsSoFar(): number {
    return this.puffCount;
  }

  /** The belly's warm glow now: `DRAGON_BELLY_REST_GLOW` at rest, up to {@link DRAGON_PUFF_GLOW} more at a puff's height. */
  get bellyGlow(): number {
    return this.dragon.belly.emissiveIntensity;
  }

  /** Its head's turn now, radians from straight ahead: positive toward its own +X (its left, as it faces you). */
  get headTurn(): number {
    return this.dragon.head.rotation.y;
  }

  /** Has it said hello on this visit? */
  get metThisVisit(): boolean {
    return this.met;
  }

  /** Where its bubble hangs, room-local: over the top of its horns. */
  get bubbleAt(): { readonly x: number; readonly y: number; readonly z: number } {
    return { x: LIBRARY_DRAGON_NEST.x, y: this.dragonTop + DRAGON_BUBBLE_OVER, z: LIBRARY_DRAGON_NEST.z };
  }

  // --------------------------------------------------------------- visits

  /**
   * She has left the library: a puff in progress settles, and on her next
   * visit it says hello again the first time she comes near — a visit is from
   * the park in to the park out, so a link typed from inside the room is not
   * a new one.
   */
  leave(): void {
    this.met = false;
    this.puffFor = 0;
    this.dragon.belly.emissiveIntensity = DRAGON_BELLY_REST_GLOW;
  }

  // --------------------------------------------------------------- the press

  /**
   * **"Say hi!"** — it puffs, answers with the next of its three lines, and
   * the Dragon friend card is hers (idempotently: the meeting may have given
   * it already). Saying hi is meeting it, so no hello follows on this visit.
   */
  sayHi(): void {
    discoverSecret(DRAGON_FRIEND_SECRET);
    this.met = true;
    const lines = LIBRARY_LINES.dragon.hi;
    const line = lines[this.hiNext % lines.length]!;
    this.hiNext += 1;
    this.say(line);
    this.puff();
  }

  // --------------------------------------------------------------- every frame

  /**
   * One frame, while the den is drawn. `her` is her room-local spot (null with
   * no child); `inDen` is `libraryDenContains` asked of it, and `open` whether
   * the secret shelf has landed open — the meeting wants both.
   */
  update(dt: number, elapsed: number, her: LocalPoint | null, inDen: boolean, open: boolean): void {
    const spot = LIBRARY_DRAGON_NEST;
    const distance = her ? Math.hypot(her.x - spot.x, her.z - spot.z) : Infinity;

    if (!this.met && inDen && open && distance <= DRAGON_MEET_RADIUS) this.meet();

    // The idle puff, and the one showing.
    this.puffIn -= dt;
    if (this.puffIn <= 0 && this.puffFor <= 0) this.puff();
    if (this.puffFor > 0) this.puffFor = Math.max(0, this.puffFor - dt);
    const u = this.puffFor > 0 ? 1 - this.puffFor / DRAGON_PUFF_SECONDS : 0;
    this.dragon.belly.emissiveIntensity = DRAGON_BELLY_REST_GLOW + (this.puffFor > 0 ? DRAGON_PUFF_GLOW * Math.sin(Math.PI * u) : 0);
    this.puffs.update(dt);

    // Breath, the face, the tail.
    this.breathe(Math.sin(elapsed * DRAGON_BREATH_RATE + this.breathPhase) * DRAGON_BREATH_DEPTH);
    const watching = inDen && distance <= DRAGON_LOOK_RADIUS;
    this.face.update(dt, this.puffFor > 0 ? 'surprised' : watching ? 'happy' : 'neutral');
    this.tailIn -= dt;
    if (this.tailIn <= 0) {
      this.tailFor = DRAGON_TAIL_FLICK_SECONDS;
      this.tailIn = this.rng.range(DRAGON_TAIL_FLICK_MIN, DRAGON_TAIL_FLICK_MAX);
    }
    if (this.tailFor > 0) {
      this.tailFor = Math.max(0, this.tailFor - dt);
      const t = 1 - this.tailFor / DRAGON_TAIL_FLICK_SECONDS;
      this.dragon.tail.rotation.y = this.tailRest + DRAGON_TAIL_FLICK * Math.sin(2 * Math.PI * t);
    } else {
      this.dragon.tail.rotation.y = this.tailRest;
    }

    // The head: toward her bearing from its own facing while she is near in
    // the den — `Player.facing`'s convention, which a positive `rotation.y`
    // shares (it turns the face from +Z toward +X) — with a small nod; else
    // straight ahead.
    let turn = 0;
    if (watching && her) {
      const yaw = (spot.facing * Math.PI) / 180;
      turn = clamp(angleDelta(yaw, Math.atan2(her.x - spot.x, her.z - spot.z)), -DRAGON_HEAD_TURN_LIMIT, DRAGON_HEAD_TURN_LIMIT);
    }
    const head = this.dragon.head;
    head.rotation.y = damp(head.rotation.y, turn, DRAGON_HEAD_HALF_LIFE, dt);
    head.rotation.x = damp(head.rotation.x, watching ? DRAGON_NOD * Math.sin(elapsed * DRAGON_NOD_RATE) : 0, DRAGON_HEAD_HALF_LIFE, dt);
  }

  // ------------------------------------------------------------ private

  /** The meeting: the card, a hello (the very first, or again), and a puff. */
  private meet(): void {
    this.met = true;
    const before = gameStore.get().collection[DRAGON_FRIEND_SECRET]?.discovered === true;
    discoverSecret(DRAGON_FRIEND_SECRET);
    this.say(before ? LIBRARY_LINES.dragon.hello : LIBRARY_LINES.dragon.firstHello);
    this.puff();
  }

  /** A puff: the round mouth and the belly's glow for {@link DRAGON_PUFF_SECONDS}, and warm sprites from its mouth, wherever its head is turned. */
  private puff(): void {
    this.puffFor = DRAGON_PUFF_SECONDS;
    this.puffCount += 1;
    this.puffIn = this.rng.range(DRAGON_IDLE_PUFF_MIN, DRAGON_IDLE_PUFF_MAX);
    const mouth = this.scratch.copy(this.dragon.mouthInHead);
    this.dragon.head.updateWorldMatrix(true, false);
    this.denRoot.updateWorldMatrix(true, false);
    this.denRoot.worldToLocal(this.dragon.head.localToWorld(mouth));
    this.puffs.puff(mouth.x, mouth.y, mouth.z, this.rng, DRAGON_PUFF_SPRITES);
  }

  /** The breath's share `b` on its body: wider and lower as it breathes in, the owl's own shape. */
  private breathe(b: number): void {
    this.dragon.body.scale.set(1 + 0.6 * b, 1 - b, 1 + 0.6 * b);
  }
}
