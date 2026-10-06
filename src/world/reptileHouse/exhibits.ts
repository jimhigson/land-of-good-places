import {
  CatmullRomCurve3,
  CylinderGeometry,
  DoubleSide,
  Group,
  Mesh,
  MeshToonMaterial,
  PlaneGeometry,
  Shape,
  ShapeGeometry,
  SphereGeometry,
  Sprite,
  SpriteMaterial,
  Vector3,
  type Object3D,
} from 'three';
import { PALETTE } from '../../core/palette';
import { glowTexture } from '../../core/textures';
import { ART } from '../../art/style/artPalette';
import { decal, markShared, solid, toonMaterial } from '../../art/style/materials';
import { glassMaterial } from '../building/parts';
import { highlightObject } from '../highlight';
import { PRIMARY_ACTION, type InteractZone, type ZoneAction } from '../interact';
import { createSnake, type SnakeHandle } from '../../art/models/snake';
import {
  createChameleon,
  createCroc,
  createEgg,
  createFrog,
  createGecko,
  createIguana,
  createSkink,
  createTortoise,
  type EggHandle,
  type FrogHandle,
  type GeckoHandle,
  type ReptileHandle,
  type TortoiseHandle,
} from '../../art/models/reptiles';
import { reptileCaseMesh, REPTILE_NURSERY_GLASS_RADIUS } from '../../art/models/reptileCasesAssets';
import { instancedPlant, reptilePlantAnchor, reptilePlantBottom, reptilePlantMesh } from '../../art/models/reptilePlantsAssets';
import { createNoodleRock, createNoodleTailMound, type NoodleRock } from '../../art/models/reptileNoodleAssets';
import type { HallContext } from './context';
import { asCrowd } from './exhibitCamera';
import {
  EXHIBIT_PLACEMENTS,
  FOYER_POT,
  FOYER_POT_RADIUS,
  GROTTO_ROCK,
  GROTTO_ROCK_YAW,
  HIDDEN_BABY_SPOTS,
  REPTILE_CASE_HALF_DEPTH,
  REPTILE_CASE_PLINTH_HEIGHT,
  REPTILE_CASE_SEGMENT,
  REPTILE_ENCLOSURE_WALL_HEIGHT,
  REPTILE_GLASS_TOP,
  REPTILE_HOUSE_ORIGIN_X,
  REPTILE_HOUSE_ORIGIN_Z,
  REPTILE_ISLAND_COLLIDER_RADIUS,
  REPTILE_JAR_BASE_HEIGHT,
  REPTILE_JAR_RADIUS,
  REPTILE_LOG_CENTRE_X,
  REPTILE_LOG_INNER_RADIUS,
  REPTILE_LOG_LENGTH,
  REPTILE_NURSERY_KERB_HEIGHT,
  REPTILE_NOODLE_HEAD_Y,
  REPTILE_NURSERY_RAIL_TOP,
  REPTILE_PIER_POST_RADIUS,
  PIER_POSTS,
  type ExhibitPlacement,
  type ExhibitShape,
  type LocalPoint,
  type StandSpot,
} from './layout';

/**
 * **The fifteen exhibits, and what each one says and does.**
 *
 * The copy is a table (`check:brevity` walks it: title ≤ 24 characters, blurb
 * one sentence of ≤ 50, chip a short call to action) and the building is what
 * the table describes: a glass wall case or an open walled enclosure from the
 * `cases` kit, the animals inside it, and one `InteractZone` whose chip pokes
 * the animals. Every animal is cute, smiley and never scary; every reaction is
 * a two-second state on the creature itself.
 *
 * **No nameplates.** The first cut painted each exhibit's title and blurb on a
 * 1.6 × 0.2 m plate — 6–8 cm letters nobody could read from the stand spot,
 * against GAME_DESIGN.md's TEXT RULE and the 28 July ruling that in-world
 * signs carry no painted words (`signs.ts` has the account). The title is the
 * zone's label (DOM text, sized by the rule), and the blurb is said in a
 * speech bubble over the exhibit the first time it is greeted — the same
 * line, where a child can read it.
 *
 * Coordinates are hall-local. The glass cases' colliders are the one
 * `addWall` capsule their plinth is drawn to, the round enclosures one filled
 * disc, the lagoon and the tortoise garden one filled stadium — nothing here
 * has a hollow a child can get into (`props.ts`).
 */
export interface ExhibitCopy {
  readonly id: string;
  readonly title: string;
  /** One sentence, said in a bubble over the exhibit on its first hello. */
  readonly blurb: string;
  /** The chip — a short call to action. */
  readonly chip: string;
  readonly glyph: string;
  /** The zone's verb, for the tap-spacing rule's "different actions". */
  readonly verb: string;
}

export const EXHIBITS: readonly ExhibitCopy[] = [
  { id: 'noodle', title: 'Noodle', blurb: 'The biggest, kindest python in the whole park.', chip: 'Say hi!', glyph: '👋', verb: 'Say hi' },
  { id: 'rainbowBoa', title: 'Ribbon the Rainbow Boa', blurb: 'She shimmers every colour when she moves.', chip: 'Shimmer!', glyph: '🌈', verb: 'Shimmer' },
  { id: 'hatchery', title: 'The Hatchery', blurb: 'Something wriggly is about to hatch.', chip: 'Shh!', glyph: '🥚', verb: 'Shh' },
  { id: 'cornSnakes', title: 'The Stripeys', blurb: 'Three corn snakes who love climbing.', chip: 'Wiggle!', glyph: '🐍', verb: 'Wiggle' },
  { id: 'chameleon', title: 'Cammy the Chameleon', blurb: 'Say peekaboo and watch her change colour.', chip: 'Peekaboo!', glyph: '🦎', verb: 'Peekaboo' },
  { id: 'geckoWall', title: 'Gecko Wall', blurb: 'Five geckos who can walk upside down.', chip: 'Hello geckos!', glyph: '🦎', verb: 'Hello geckos' },
  { id: 'treeSnake', title: 'Emmy the Tree Snake', blurb: 'She loves to dangle, so say hi and she drops by.', chip: 'Say hi!', glyph: '👋', verb: 'Say hi' },
  { id: 'milkSnake', title: 'Minty the Milk Snake', blurb: 'Minty hides in her log, can you spot her?', chip: 'Peekaboo!', glyph: '🪵', verb: 'Peekaboo' },
  { id: 'skink', title: 'Smudge the Skink', blurb: 'Smudge has a big blue tongue, say hi!', chip: 'Say hi!', glyph: '👋', verb: 'Say hi' },
  { id: 'snakeGrove', title: 'Snake Grove', blurb: 'Six green snakes who sway in the banyan.', chip: 'Hiss hello!', glyph: '🌳', verb: 'Hiss hello' },
  { id: 'tortoiseGarden', title: 'Tortoise Garden', blurb: 'Grandpa Tock is 102 and in no hurry.', chip: 'Say hi!', glyph: '🐢', verb: 'Say hi' },
  { id: 'lagoon', title: "Snappy's Lagoon", blurb: 'A crocodile with the friendliest yawn.', chip: 'Wave!', glyph: '🐊', verb: 'Wave' },
  { id: 'iguanaRocks', title: 'Iguana Rocks', blurb: 'Two iguanas doing push-ups in the sun.', chip: 'Say hi!', glyph: '🦎', verb: 'Say hi' },
  { id: 'nursery', title: 'The Nursery', blurb: "Twelve baby snakes, snoozing on mum's tail.", chip: 'Tickle tail!', glyph: '🐍', verb: 'Tickle tail' },
  { id: 'frogJar', title: 'Frog Jar', blurb: 'Five leaf frogs who sing when you ask.', chip: 'Ribbit!', glyph: '🐸', verb: 'Ribbit' },
];

/** The chip over a hidden baby, until it is found. */
export const FOUND_YOU_CHIP = 'Found you!';
/** The nursery's second chip — the adoption stand. */
export const ADOPT_CHIP = 'Adopt a snake!';

/** The grotto pool's basin, in the grotto rock's own frame — where the `cases` kit cut it. */
const GROTTO_BASIN: LocalPoint = { x: 0.3, z: 1.3 };

/** A point in the grotto rock's frame, hall-local. */
function grottoLocal(x: number, z: number): LocalPoint {
  const yaw = (GROTTO_ROCK_YAW * Math.PI) / 180;
  return {
    x: GROTTO_ROCK.x + Math.cos(yaw) * x + Math.sin(yaw) * z,
    z: GROTTO_ROCK.z - Math.sin(yaw) * x + Math.cos(yaw) * z,
  };
}

/** The grotto pool's middle, hall-local — the planting keeps the sightline from hidden baby #2's stand to it clear. */
export function grottoPoolSpot(): LocalPoint {
  return grottoLocal(GROTTO_BASIN.x, GROTTO_BASIN.z);
}

const PICK_RADIUS = 2.4;
const PEEK_RANGE = 5;
/** The grove's banyan, scaled to its disc. */
const BANYAN_SCALE = 0.9;
/** Where the first-hello bubble floats over an exhibit: above the glass cases' rims. */
const BLURB_BUBBLE_Y = 3.1;

const GLASS = glassMaterial(0.24);
GLASS.side = DoubleSide;
const SMALL_SPHERE = markShared(new SphereGeometry(1, 10, 8));

interface Exhibit {
  readonly id: string;
  readonly zone: InteractZone;
  update(dt: number, elapsed: number, player: LocalPoint | null): void;
  /** Where each animal's root is, hall-local — for the "every animal is inside its enclosure" check. */
  animals(): LocalPoint[];
  /**
   * What the exhibit camera frames and must see unblocked when this exhibit's
   * chip is pressed — the animals that react, read live (several move). An
   * object with nothing drawn under it counts as a point at its own origin
   * (the snake grove's greeter's low spot). See `exhibitCamera.ts`.
   */
  subjects(): readonly Object3D[];
  /**
   * Every animal in the exhibit, reacting or not — never an obstacle to the
   * camera's view of the others (a grove snake in front of the greeter, a
   * python's own coil in front of her head). Defaults to {@link subjects}.
   */
  cast?(): readonly Object3D[];
}

/**
 * Empty markers at points along a pooled snake's body, in `parent`'s frame. A
 * pooled snake draws its body from the shared segment pool, so its own root
 * holds only the head; these give the camera the body's extent to frame.
 */
function bodyMarkers(parent: Object3D, points: readonly Vector3[], name: string): Object3D[] {
  return asCrowd(points.map((point, index) => {
    const marker = new Group();
    marker.name = `${name}-body-${index}`;
    marker.position.copy(point);
    parent.add(marker);
    return marker;
  }));
}

interface HiddenBaby {
  readonly index: number;
  readonly snake: SnakeHandle;
  readonly at: LocalPoint;
  readonly restY: number;
  found: boolean;
}

export class Exhibits {
  private readonly ctx: HallContext;
  private readonly exhibits: Exhibit[] = [];
  private readonly babies: HiddenBaby[] = [];
  private readonly babyZones: InteractZone[] = [];
  private readonly greeted = new Set<string>();
  private noodle: NoodleRock | null = null;
  private nurseryBabies: SnakeHandle[] = [];
  private noodleLift = 0;
  private noodleMood = 0;
  private tailTickle = 0;
  private readonly logWorms: Mesh[] = [];
  private logGlow = 0;

  constructor(ctx: HallContext) {
    this.ctx = ctx;
    for (const placement of EXHIBIT_PLACEMENTS) this.exhibits.push(this.build(placement));
    this.buildPiers();
    this.buildHollowLog();
    this.buildGrotto();
    this.buildFoyerPot();
  }

  zones(): InteractZone[] {
    return [...this.exhibits.map((exhibit) => exhibit.zone), ...this.babyZones];
  }

  /** Every exhibit's id, in table order — for the exhibit-camera check. */
  get ids(): readonly string[] {
    return this.exhibits.map((exhibit) => exhibit.id);
  }

  /** The animals an exhibit's camera shot frames — see {@link Exhibit.subjects}. */
  subjectsOf(id: string): readonly Object3D[] {
    const exhibit = this.exhibits.find((row) => row.id === id);
    if (!exhibit) throw new Error(`Reptile House: no exhibit '${id}'`);
    return exhibit.subjects();
  }

  /** Every animal in an exhibit — see {@link Exhibit.cast}. */
  castOf(id: string): readonly Object3D[] {
    const exhibit = this.exhibits.find((row) => row.id === id);
    if (!exhibit) throw new Error(`Reptile House: no exhibit '${id}'`);
    return exhibit.cast ? exhibit.cast() : exhibit.subjects();
  }

  /** Hall-local spots of every animal, with the exhibit it belongs to. */
  animalSpots(): { id: string; x: number; z: number }[] {
    return this.exhibits.flatMap((exhibit) => exhibit.animals().map((at) => ({ id: exhibit.id, x: at.x, z: at.z })));
  }

  get babiesFound(): number {
    return this.babies.filter((baby) => baby.found).length;
  }

  get exhibitsGreeted(): number {
    return this.greeted.size;
  }

  update(dt: number, elapsed: number, player: LocalPoint | null): void {
    for (const exhibit of this.exhibits) exhibit.update(dt, elapsed, player);
    this.updateNoodle(dt, elapsed, player);
    for (const baby of this.babies) {
      const near = player !== null && Math.hypot(player.x - baby.at.x, player.z - baby.at.z) <= PEEK_RANGE;
      baby.snake.update(dt, elapsed);
      const peek = baby.found ? 0.22 : near ? Math.abs(Math.sin(elapsed * 2.2)) * 0.06 : 0;
      baby.snake.root.position.y = baby.restY + peek;
    }
    const nearLog = player !== null && Math.abs(player.x - REPTILE_LOG_CENTRE_X) < REPTILE_LOG_LENGTH / 2 + 4 && Math.abs(player.z) < 5;
    this.logGlow += ((nearLog ? 1 : 0) - this.logGlow) * Math.min(1, dt * 2);
    for (const [index, worm] of this.logWorms.entries()) {
      const material = worm.material as MeshToonMaterial;
      material.emissiveIntensity = 0.2 + this.logGlow * (0.6 + Math.sin(elapsed * 3 + index) * 0.4);
    }
  }

  /** The nursery's tickle: the tail wriggles, the babies tumble, and Noodle's head, 14 m away, notices. */
  tickleTail(): void {
    this.tailTickle = 2;
    this.noodleMood = 2.6;
    this.noodle?.setFace('surprised');
  }

  // ------------------------------------------------------------- builders

  private build(placement: ExhibitPlacement): Exhibit {
    switch (placement.id) {
      case 'noodle':
        return this.buildNoodle(placement);
      case 'rainbowBoa':
        return this.buildRainbowBoa(placement);
      case 'hatchery':
        return this.buildHatchery(placement);
      case 'cornSnakes':
        return this.buildCornSnakes(placement);
      case 'chameleon':
        return this.buildChameleon(placement);
      case 'geckoWall':
        return this.buildGeckoWall(placement);
      case 'treeSnake':
        return this.buildTreeSnake(placement);
      case 'milkSnake':
        return this.buildMilkSnake(placement);
      case 'skink':
        return this.buildSkink(placement);
      case 'snakeGrove':
        return this.buildSnakeGrove(placement);
      case 'tortoiseGarden':
        return this.buildTortoiseGarden(placement);
      case 'lagoon':
        return this.buildLagoon(placement);
      case 'iguanaRocks':
        return this.buildIguanaRocks(placement);
      case 'nursery':
        return this.buildNursery(placement);
      case 'frogJar':
        return this.buildFrogJar(placement);
      default:
        throw new Error(`Reptile House: no builder for exhibit '${placement.id}'`);
    }
  }

  private copy(id: string): ExhibitCopy {
    const found = EXHIBITS.find((row) => row.id === id);
    if (!found) throw new Error(`Reptile House: no copy for exhibit '${id}'`);
    return found;
  }

  /** The exhibit's one zone: at the animals, stood at the layout's spot, chip from the table. */
  private zone(
    id: string,
    focus: LocalPoint,
    stand: StandSpot,
    highlight: Object3D,
    run: () => void,
    extra?: () => ZoneAction[],
  ): InteractZone {
    const copy = this.copy(id);
    const greetAndRun = (): void => {
      const first = !this.greeted.has(id);
      this.greeted.add(id);
      this.ctx.greet(id);
      run();
      // The first hello gets the exhibit's one line as a bubble over it —
      // after `run`, so it wins over the reaction's own 'peep!' this once.
      if (first) this.ctx.say(copy.blurb, focus, BLURB_BUBBLE_Y);
    };
    return {
      id: `reptile:${id}`,
      label: copy.title,
      x: REPTILE_HOUSE_ORIGIN_X + focus.x,
      y: 1,
      z: REPTILE_HOUSE_ORIGIN_Z + focus.z,
      pickRadius: PICK_RADIUS,
      standX: REPTILE_HOUSE_ORIGIN_X + stand.x,
      standZ: REPTILE_HOUSE_ORIGIN_Z + stand.z,
      verb: copy.verb,
      highlight: highlightObject(highlight),
      actions: () => [{ id: PRIMARY_ACTION, label: copy.chip, glyph: copy.glyph, run: greetAndRun }, ...(extra ? extra() : [])],
    };
  }

  private shapeCentre(shape: ExhibitShape): LocalPoint {
    if (shape.kind === 'disc') return shape.centre;
    return { x: (shape.a.x + shape.b.x) / 2, z: (shape.a.z + shape.b.z) / 2 };
  }

  private registerShape(id: string, shape: ExhibitShape, top: number): void {
    if (shape.kind === 'disc') this.ctx.props.disc(`${id}'s enclosure`, shape.centre.x, shape.centre.z, shape.radius, top, { stand: false });
    else this.ctx.props.wall(`${id}'s enclosure`, shape.a, shape.b, shape.half, top, { stand: false });
  }

  // ---------------------------------------------------------- glass cases

  /**
   * A glass wall case: the kit's stadium plinth, rim, back board and relief,
   * three panes recessed 0.06 m inside the plinth's outline, a heat lamp on
   * the rim and the nameplate on the front. `group` sits at the plinth's
   * centre, yawed so local +Z is the glass front; the floor inside is at
   * `REPTILE_CASE_PLINTH_HEIGHT`.
   */
  private buildCase(placement: ExhibitPlacement): Group {
    const shape = placement.shape;
    if (shape.kind !== 'stadium') throw new Error(`${placement.id} is not a glass case`);
    const centre = this.shapeCentre(shape);
    const alongX = Math.abs(shape.b.x - shape.a.x) > Math.abs(shape.b.z - shape.a.z);
    const group = new Group();
    group.name = `case:${placement.id}`;
    group.position.set(centre.x, 0, centre.z);
    // A north case faces +Z as authored; a west case is the same nodes yawed
    // so local +Z becomes +X.
    group.rotation.y = alongX ? 0 : Math.PI / 2;
    this.ctx.root.add(group);
    for (const name of ['rc-case-plinth', 'rc-case-rim', 'rc-case-backboard', 'rc-case-backboard-relief']) {
      group.add(reptileCaseMesh(name));
    }
    const half = REPTILE_CASE_HALF_DEPTH;
    const length = REPTILE_CASE_SEGMENT + 2 * half;
    const glassHeight = REPTILE_GLASS_TOP - REPTILE_CASE_PLINTH_HEIGHT;
    const glassY = (REPTILE_GLASS_TOP + REPTILE_CASE_PLINTH_HEIGHT) / 2;
    const recess = 0.06;
    const front = new Mesh(new PlaneGeometry(length - 2 * recess, glassHeight), GLASS);
    front.position.set(0, glassY, half - recess);
    front.castShadow = false;
    group.add(front);
    for (const side of [-1, 1] as const) {
      const end = new Mesh(new PlaneGeometry(half + 0.95 - recess, glassHeight), GLASS);
      end.position.set(side * (length / 2 - recess), glassY, (half - 0.95) / 2);
      end.rotation.y = (side * Math.PI) / 2;
      end.castShadow = false;
      group.add(end);
    }
    const lamp = new Sprite(new SpriteMaterial({ map: glowTexture(PALETTE.fairyWarm), transparent: true, depthWrite: false }));
    lamp.scale.setScalar(0.9);
    lamp.position.set(0, REPTILE_GLASS_TOP + 0.25, half - 0.3);
    group.add(lamp);
    this.registerShape(placement.id, shape, REPTILE_GLASS_TOP);
    return group;
  }

  private buildRainbowBoa(placement: ExhibitPlacement): Exhibit {
    const group = this.buildCase(placement);
    const floor = REPTILE_CASE_PLINTH_HEIGHT;
    const branch = reptilePlantMesh('rp-branch');
    branch.position.set(-1.3, floor, -0.3);
    branch.rotation.y = 0.6;
    group.add(branch);
    const loop = [
      new Vector3(-1.7, floor, 0.5),
      new Vector3(-0.4, floor + 0.55, -0.1),
      new Vector3(1.4, floor, -0.5),
      new Vector3(1.8, floor, 0.4),
      new Vector3(0.2, floor, 0.7),
    ];
    const boa = createSnake({ length: 3.2, radius: 0.2, colourway: 'rainbow', seed: 101, path: loop, crawl: 0.18, pool: this.ctx.adults });
    group.add(boa.root);
    const boaBody = bodyMarkers(group, loop, 'boa');
    const centre = this.shapeCentre(placement.shape);
    return {
      id: placement.id,
      subjects: () => [boa.head, ...boaBody],
      zone: this.zone(placement.id, centre, placement.stand, boa.head, () => {
        boa.poke();
        this.ctx.hearts(centre, 2.6);
      }),
      update: (dt, elapsed) => boa.update(dt, elapsed),
      animals: () => [centre],
    };
  }

  private buildHatchery(placement: ExhibitPlacement): Exhibit {
    const group = this.buildCase(placement);
    const floor = REPTILE_CASE_PLINTH_HEIGHT;
    const straw = decal(new Mesh(SMALL_SPHERE, toonMaterial(PALETTE.markerLemon)));
    straw.position.set(0, floor + 0.02, 0.1);
    straw.scale.set(2.1, 0.06, 0.8);
    group.add(straw);
    const eggs: EggHandle[] = [];
    const spots: [number, number, boolean][] = [
      [-1.5, 0.3, false],
      [-0.9, -0.3, true],
      [-0.3, 0.4, false],
      [0.4, -0.2, true],
      [1.0, 0.35, false],
      [1.6, -0.3, true],
    ];
    for (const [index, [x, z, cracked]] of spots.entries()) {
      const egg = createEgg(200 + index, cracked);
      egg.root.position.set(x, floor, z);
      egg.root.rotation.y = this.ctx.rng.range(-0.5, 0.5);
      group.add(egg.root);
      eggs.push(egg);
    }
    const hatchlings: SnakeHandle[] = [];
    for (let i = 0; i < 3; i += 1) {
      const baby = createSnake({ length: 0.3, radius: 0.05, colourway: i === 1 ? 'coral' : 'mint', seed: 210 + i, pool: this.ctx.babies });
      baby.root.position.set(-1.2 + i * 1.1, floor, 0.75);
      baby.root.rotation.y = Math.PI + this.ctx.rng.range(-0.6, 0.6);
      group.add(baby.root);
      hatchlings.push(baby);
    }
    const centre = this.shapeCentre(placement.shape);
    let nextEgg = 0;
    return {
      id: placement.id,
      subjects: () => asCrowd([...eggs.map((egg) => egg.root), ...hatchlings.map((baby) => baby.head)]),
      cast: () => [...eggs.map((egg) => egg.root), ...hatchlings.map((baby) => baby.root)],
      zone: this.zone(placement.id, centre, placement.stand, group, () => {
        const egg = eggs[nextEgg];
        if (egg) {
          egg.hatch();
          nextEgg = (nextEgg + 2) % eggs.length;
        }
        this.ctx.say('peep!', centre, 3.1);
      }),
      update: (dt, elapsed) => {
        for (const egg of eggs) egg.update(dt, elapsed);
        for (const baby of hatchlings) baby.update(dt, elapsed);
      },
      animals: () => [centre],
    };
  }

  private buildCornSnakes(placement: ExhibitPlacement): Exhibit {
    const group = this.buildCase(placement);
    const floor = REPTILE_CASE_PLINTH_HEIGHT;
    const snakes: SnakeHandle[] = [];
    const cornBodies: Object3D[] = [];
    const anchors: [number, number, number][] = [
      [-1.5, 0, -0.2],
      [0, 0.4, 0.1],
      [1.5, 0.1, -0.3],
    ];
    for (const [index, [x, lift, z]] of anchors.entries()) {
      const branch = reptilePlantMesh('rp-branch');
      branch.position.set(x - 0.6, floor, z - 0.2);
      branch.rotation.y = index * 2.1;
      branch.scale.setScalar(0.8);
      group.add(branch);
      const loop = [
        new Vector3(x - 0.7, floor, z + 0.4),
        new Vector3(x, floor + 0.6 + lift, z - 0.3),
        new Vector3(x + 0.7, floor, z + 0.2),
        new Vector3(x, floor, z + 0.6),
      ];
      const snake = createSnake({ length: 1.6, radius: 0.1, colourway: 'corn', seed: 300 + index, path: loop, crawl: 0.12 + index * 0.03, pool: this.ctx.adults });
      group.add(snake.root);
      snakes.push(snake);
      cornBodies.push(...bodyMarkers(group, loop, `corn-${index}`));
    }
    const centre = this.shapeCentre(placement.shape);
    return {
      id: placement.id,
      // They crawl their loops the whole time, so any one head may be round the
      // back of a branch: a crowd of three.
      subjects: () => [...asCrowd(snakes.map((snake) => snake.head)), ...cornBodies],
      zone: this.zone(placement.id, centre, placement.stand, group, () => {
        for (const snake of snakes) snake.poke();
      }),
      update: (dt, elapsed) => {
        for (const snake of snakes) snake.update(dt, elapsed);
      },
      animals: () => [centre],
    };
  }

  private buildChameleon(placement: ExhibitPlacement): Exhibit {
    const group = this.buildCase(placement);
    const floor = REPTILE_CASE_PLINTH_HEIGHT;
    const branch = reptilePlantMesh('rp-branch');
    branch.position.set(-1.4, floor, -0.5);
    branch.rotation.y = -0.4;
    group.add(branch);
    const cammy = createChameleon(400);
    cammy.root.position.set(0.3, floor, 0.1);
    cammy.root.rotation.y = 0.3;
    group.add(cammy.root);
    const centre = this.shapeCentre(placement.shape);
    return {
      id: placement.id,
      subjects: () => [cammy.root],
      zone: this.zone(placement.id, centre, placement.stand, cammy.root, () => cammy.poke()),
      update: (dt, elapsed) => cammy.update(dt, elapsed),
      animals: () => [{ x: centre.x + 0.3, z: centre.z + 0.1 }],
    };
  }

  private buildGeckoWall(placement: ExhibitPlacement): Exhibit {
    const group = this.buildCase(placement);
    const geckos: GeckoHandle[] = [];
    const boardZ = -0.88;
    const anchors: [number, number][] = [
      [-1.6, 1.4],
      [-0.7, 2.3],
      [0.2, 1.7],
      [1.1, 2.6],
      [1.7, 1.3],
    ];
    for (let i = 0; i < 5; i += 1) {
      const gecko = createGecko(500 + i);
      const [x, y] = anchors[i]!;
      if (i === 4) {
        // One upside down on the rim.
        gecko.root.position.set(x, REPTILE_GLASS_TOP - 0.02, 0.4);
        gecko.root.rotation.set(Math.PI, 0.6, 0);
      } else {
        gecko.root.position.set(x, y, boardZ);
        gecko.root.rotation.set(Math.PI / 2, 0, i % 2 === 0 ? 0 : Math.PI);
      }
      group.add(gecko.root);
      geckos.push(gecko);
    }
    const timers = geckos.map(() => this.ctx.rng.range(3, 6));
    const centre = this.shapeCentre(placement.shape);
    return {
      id: placement.id,
      subjects: () => asCrowd(geckos.map((gecko) => gecko.root)),
      zone: this.zone(placement.id, centre, placement.stand, group, () => {
        for (const gecko of geckos) gecko.poke();
      }),
      update: (dt, elapsed) => {
        geckos.forEach((gecko, index) => {
          gecko.update(dt, elapsed);
          if (index === 4) return;
          timers[index] = (timers[index] ?? 3) - dt;
          if ((timers[index] ?? 0) <= 0) {
            timers[index] = this.ctx.rng.range(3, 6);
            gecko.scuttleTo(this.ctx.rng.range(-1.7, 1.7), this.ctx.rng.range(1.3, 2.7), boardZ);
          }
        });
      },
      animals: () => [centre],
    };
  }

  private buildTreeSnake(placement: ExhibitPlacement): Exhibit {
    const group = this.buildCase(placement);
    const floor = REPTILE_CASE_PLINTH_HEIGHT;
    const branch = reptilePlantMesh('rp-branch');
    branch.position.set(-1.6, floor + 0.2, 0.2);
    branch.rotation.y = 0.2;
    branch.rotation.z = -0.3;
    group.add(branch);
    const loops = [
      new Vector3(-1.2, floor + 1.4, -0.5),
      new Vector3(-0.8, floor + 0.7, 0.2),
      new Vector3(-0.3, floor + 1.4, -0.4),
      new Vector3(0.2, floor + 0.7, 0.3),
      new Vector3(0.7, floor + 1.3, -0.3),
      new Vector3(1.0, floor + 0.5, 0.5),
    ];
    const emmy = createSnake({ length: 2.4, radius: 0.14, colourway: 'emerald', seed: 600, path: loops, headLookAt: new Vector3(1.2, floor + 0.3, 1.5), pool: this.ctx.adults });
    group.add(emmy.root);
    const emmyBody = bodyMarkers(group, loops, 'emmy');
    const centre = this.shapeCentre(placement.shape);
    return {
      id: placement.id,
      subjects: () => [emmy.head, ...emmyBody],
      zone: this.zone(placement.id, centre, placement.stand, emmy.head, () => emmy.poke()),
      update: (dt, elapsed) => emmy.update(dt, elapsed),
      animals: () => [centre],
    };
  }

  private buildMilkSnake(placement: ExhibitPlacement): Exhibit {
    const group = this.buildCase(placement);
    const floor = REPTILE_CASE_PLINTH_HEIGHT;
    const log = reptilePlantMesh('rp-log-small');
    log.position.set(0.2, floor, -0.2);
    log.scale.setScalar(0.5);
    group.add(log);
    const path = [
      new Vector3(1.0, floor, -0.2),
      new Vector3(0.0, floor, -0.25),
      new Vector3(-0.9, floor, -0.1),
      new Vector3(-1.4, floor, 0.4),
      new Vector3(-0.9, floor, 0.7),
    ];
    const minty = createSnake({ length: 2, radius: 0.12, colourway: 'milk', seed: 700, path, pool: this.ctx.adults });
    group.add(minty.root);
    // Only the coils out in the open: the rest of her is in her log on purpose.
    const mintyBody = bodyMarkers(group, path.slice(2), 'minty');
    const centre = this.shapeCentre(placement.shape);
    return {
      id: placement.id,
      subjects: () => [minty.head, ...mintyBody],
      zone: this.zone(placement.id, centre, placement.stand, minty.head, () => minty.poke()),
      update: (dt, elapsed) => minty.update(dt, elapsed),
      animals: () => [centre],
    };
  }

  private buildSkink(placement: ExhibitPlacement): Exhibit {
    const group = this.buildCase(placement);
    const smudge = createSkink(800);
    smudge.root.position.set(0, REPTILE_CASE_PLINTH_HEIGHT, 0.2);
    group.add(smudge.root);
    const centre = this.shapeCentre(placement.shape);
    return {
      id: placement.id,
      subjects: () => [smudge.root],
      zone: this.zone(placement.id, centre, placement.stand, smudge.root, () => smudge.poke()),
      update: (dt, elapsed) => smudge.update(dt, elapsed),
      animals: () => [centre],
    };
  }

  // ------------------------------------------------------ open enclosures

  /** A rounded 1.4 m wall from the kit, stood at an enclosure's centre, and its one filled collider. */
  private buildWall(placement: ExhibitPlacement, node: string): Group {
    const centre = this.shapeCentre(placement.shape);
    const group = new Group();
    group.name = `enclosure:${placement.id}`;
    group.position.set(centre.x, 0, centre.z);
    this.ctx.root.add(group);
    group.add(reptileCaseMesh(node));
    this.registerShape(placement.id, placement.shape, REPTILE_ENCLOSURE_WALL_HEIGHT);
    return group;
  }

  /** A stadium's inside, as a flat shape at `y` — the lagoon's water, the tortoise garden's soil. */
  private stadiumFloor(shape: ExhibitShape, inset: number, y: number, colour: number, emissive = 0): Mesh {
    if (shape.kind !== 'stadium') throw new Error('not a stadium');
    const halfLength = Math.abs(shape.b.x - shape.a.x) / 2;
    const r = shape.half - inset;
    const outline = new Shape();
    outline.absarc(-halfLength, 0, r, Math.PI / 2, (Math.PI * 3) / 2, false);
    outline.absarc(halfLength, 0, r, (Math.PI * 3) / 2, Math.PI / 2 + Math.PI * 2, false);
    const mesh = decal(new Mesh(new ShapeGeometry(outline, 24), toonMaterial(colour, emissive ? { emissive: colour, emissiveIntensity: emissive } : {})));
    mesh.rotation.x = -Math.PI / 2; // flat-ok: a floor decal laid flat in the hall; the reptile house is its own flat space at x 600, floor y 0, off the sphere
    mesh.position.y = y;
    return mesh;
  }

  /**
   * Six tree snakes hanging from the banyan, on the side a child can see.
   *
   * They hang from the canopy's underside on the stand spot's own side of the
   * tree (which is the fixed +X+Z camera's side too), spread either side of
   * its bearing at two metres from the trunk — outside the root cage, above
   * the wall, in front of the trunk. The first cut hung them from the kit's
   * three anchors inside the cage, 1.4 m long and `leafDeep` against a
   * `leafDeep` canopy: from the stand spot the chip promised six snakes and a
   * six-year-old saw a tree in a pot (the brief review, 2 October 2026). Now
   * two metres long, bright, and looking at her; "Hiss hello!" sends one
   * sliding down the trunk to say it and back up, as the spec has it.
   */
  private buildSnakeGrove(placement: ExhibitPlacement): Exhibit {
    const group = this.buildWall(placement, 'rc-round-wall');
    const banyan = new Group();
    banyan.scale.setScalar(BANYAN_SCALE);
    banyan.add(reptilePlantMesh('rp-banyan'), reptilePlantMesh('rp-banyan-canopy'));
    group.add(banyan);
    const centre = this.shapeCentre(placement.shape);
    const toward = Math.atan2(placement.stand.x - centre.x, placement.stand.z - centre.z);
    // The tail buried a little way up into the leaves, the body emerging.
    const hangY = reptilePlantBottom('rp-banyan-canopy') * BANYAN_SCALE + 0.25;
    const hangR = 2.0;
    const childAt = new Vector3(placement.stand.x - centre.x, 1.0, placement.stand.z - centre.z);
    const snakes: SnakeHandle[] = [];
    const hangs: Vector3[] = [];
    for (let i = 0; i < 6; i += 1) {
      const bearing = toward + ((i - 2.5) * 14 * Math.PI) / 180;
      const hang = new Vector3(Math.sin(bearing) * hangR, hangY, Math.cos(bearing) * hangR);
      const side = i % 2 === 0 ? 1 : -1;
      const path = [
        new Vector3(0, 0, 0),
        new Vector3(0.22 * side, -0.55, 0.12),
        new Vector3(-0.18 * side, -1.1, -0.06),
        new Vector3(0.12 * side, -1.65, 0.18),
      ];
      const snake = createSnake({
        length: 2,
        radius: 0.12,
        colourway: 'grove',
        seed: 900 + i,
        path,
        headLookAt: childAt.clone().sub(hang),
        pool: this.ctx.babies,
      });
      snake.root.position.copy(hang);
      group.add(snake.root);
      snakes.push(snake);
      hangs.push(hang);
    }
    // The greeter: the one nearest the stand's bearing slides down the trunk
    // to just above the wall top and back, head still on the child.
    const greeter = snakes[3]!;
    const greeterHang = hangs[3]!;
    const low = new Vector3(Math.sin(toward) * 1.1, REPTILE_ENCLOSURE_WALL_HEIGHT + 1.0, Math.cos(toward) * 1.1);
    // Where the greeter's head comes down to say hello — what the exhibit
    // camera frames, rather than her starting perch up in the canopy.
    const greetSpot = new Group();
    greetSpot.name = 'grove-greet-spot';
    group.add(greetSpot);
    const DESCEND = 1.8;
    const HOLD = 2.0;
    const total = DESCEND * 2 + HOLD;
    let greet = 0;
    const ease = (t: number): number => t * t * (3 - 2 * t);
    return {
      id: placement.id,
      subjects: () => {
        // Where her head will be once she has slid down: the head's offset
        // from her root now, carried to the low spot.
        greeter.root.updateWorldMatrix(true, true);
        const head = greeter.head.getWorldPosition(new Vector3()).sub(greeter.root.getWorldPosition(new Vector3()));
        greetSpot.position.copy(low).add(head);
        return [greetSpot, ...asCrowd(snakes.filter((snake) => snake !== greeter).map((snake) => snake.head))];
      },
      cast: () => [greetSpot, ...snakes.map((snake) => snake.root)],
      zone: this.zone(placement.id, centre, placement.stand, banyan, () => {
        for (const snake of snakes) snake.poke();
        greet = total;
      }),
      update: (dt, elapsed) => {
        for (const snake of snakes) snake.update(dt, elapsed);
        if (greet > 0) {
          greet = Math.max(0, greet - dt);
          const t = total - greet;
          const f = t < DESCEND ? ease(t / DESCEND) : t < DESCEND + HOLD ? 1 : ease(Math.max(0, greet / DESCEND));
          greeter.root.position.lerpVectors(greeterHang, low, f);
        }
      },
      animals: () => [centre],
    };
  }

  private buildTortoiseGarden(placement: ExhibitPlacement): Exhibit {
    const group = this.buildWall(placement, 'rc-tortoise-wall');
    group.add(this.stadiumFloor(placement.shape, 0.4, 0.1, PALETTE.barkDark));
    const tock = createTortoise(1000);
    group.add(tock.root);
    const sleepers: TortoiseHandle[] = [];
    for (const [index, [x, z]] of ([[-2.2, 1.6], [2.6, -1.6]] as const).entries()) {
      const small = createTortoise(1010 + index, 0.42);
      small.root.position.set(x, 0.1, z);
      small.root.rotation.y = index * 2.4;
      group.add(small.root);
      sleepers.push(small);
    }
    // Hidden baby #4 rides on Tock's shell.
    const rider = createSnake({ length: 0.3, radius: 0.05, colourway: 'coral', seed: 1020, pool: this.ctx.babies });
    rider.root.position.set(0, 0.85, 0);
    tock.shell.add(rider.root);
    const centre = this.shapeCentre(placement.shape);
    const baby: HiddenBaby = { index: 3, snake: rider, at: centre, restY: 0.85, found: false };
    this.babies.push(baby);
    // Tock's loop, inside the wall.
    const loop = new CatmullRomCurve3(
      [new Vector3(-2.5, 0.1, 0), new Vector3(-0.5, 0.1, -1.7), new Vector3(2.5, 0.1, -0.9), new Vector3(2.0, 0.1, 1.6), new Vector3(-1.0, 0.1, 1.8)],
      true,
      'centripetal',
    );
    const length = loop.getLength();
    let along = 0;
    let phase = 0;
    const speed = 0.15;
    const at = new Vector3();
    const ahead = new Vector3();
    return {
      id: placement.id,
      subjects: () => [tock.root],
      cast: () => [tock.root, ...sleepers.map((small) => small.root)],
      zone: this.zone(
        placement.id,
        centre,
        placement.stand,
        tock.root,
        () => tock.poke(),
        () => (baby.found ? [] : [{ id: 'found', label: FOUND_YOU_CHIP, glyph: '🐍', run: () => this.found(baby) }]),
      ),
      update: (dt, elapsed) => {
        along = (along + speed * dt) % length;
        loop.getPointAt(along / length, at);
        loop.getPointAt(((along + 0.3) % length) / length, ahead);
        tock.root.position.copy(at);
        tock.root.lookAt(ahead.x + group.position.x, ahead.y, ahead.z + group.position.z);
        phase = (phase + dt * 0.9) % 1;
        tock.setWalkPhase(phase, 1);
        tock.update(dt, elapsed);
        for (const small of sleepers) small.update(dt, elapsed);
      },
      animals: () => [
        { x: centre.x + tock.root.position.x, z: centre.z + tock.root.position.z },
        ...sleepers.map((small) => ({ x: centre.x + small.root.position.x, z: centre.z + small.root.position.z })),
      ],
    };
  }

  private buildLagoon(placement: ExhibitPlacement): Exhibit {
    const group = this.buildWall(placement, 'rc-lagoon-wall');
    group.add(this.stadiumFloor(placement.shape, 0.4, 0.3, PALETTE.waterTop, 0.15));
    const island = reptilePlantMesh('rp-rock-a');
    island.position.set(0.5, 0.05, -0.8);
    group.add(island);
    const pads = instancedPlant(
      'rp-lily-pad',
      [...Array(8)].map((_, i) => ({ x: Math.cos(i * 0.8) * (1.6 + (i % 2) * 1.2), y: 0.31, z: Math.sin(i * 0.8) * 1.6, yaw: i, scale: 0.9 })),
    );
    group.add(...pads);
    const snappy = createCroc(1100);
    group.add(snappy.root);
    const baby = createCroc(1101);
    baby.root.scale.setScalar(0.33);
    baby.root.position.set(0.5, 0.7, -0.8);
    baby.root.rotation.y = 2.4;
    group.add(baby.root);
    const bubbles: Mesh[] = [];
    for (let i = 0; i < 12; i += 1) {
      const bubble = decal(new Mesh(SMALL_SPHERE, toonMaterial(PALETTE.waterFoam)));
      bubble.scale.setScalar(0.06);
      bubble.visible = false;
      // Parked apart under the water, not twelve spheres in one spot, so the
      // coplanar sweep (which sees hidden meshes too) has nothing to report.
      bubble.position.set(-1.5 + i * 0.25, -0.5, 0);
      group.add(bubble);
      bubbles.push(bubble);
    }
    const drift = new CatmullRomCurve3([new Vector3(-2.2, 0.28, 0.4), new Vector3(1.5, 0.28, 1.2), new Vector3(-1.0, 0.28, -1.4)], true, 'centripetal');
    const length = drift.getLength();
    let along = 0;
    let bubbleTime = 0;
    const at = new Vector3();
    const ahead = new Vector3();
    const centre = this.shapeCentre(placement.shape);
    return {
      id: placement.id,
      subjects: () => [snappy.root],
      cast: () => [snappy.root, baby.root],
      zone: this.zone(placement.id, centre, placement.stand, snappy.root, () => {
        snappy.poke();
        bubbleTime = 1.5;
      }),
      update: (dt, elapsed, player) => {
        const near = player !== null && Math.hypot(player.x - placement.stand.x, player.z - placement.stand.z) < 3;
        along = (along + (near ? 0.05 : 0.25) * dt) % length;
        drift.getPointAt(along / length, at);
        drift.getPointAt(((along + 0.5) % length) / length, ahead);
        snappy.root.position.copy(at);
        snappy.root.lookAt(ahead.x + group.position.x, ahead.y, ahead.z + group.position.z);
        snappy.update(dt, elapsed);
        baby.update(dt, elapsed);
        if (bubbleTime > 0) {
          bubbleTime = Math.max(0, bubbleTime - dt);
          bubbles.forEach((bubble, index) => {
            const t = (1.5 - bubbleTime + index * 0.12) % 1.5;
            bubble.visible = index < 6;
            bubble.position.set(at.x + Math.sin(index * 2.1) * 0.4, 0.3 + t * 0.9, at.z + Math.cos(index * 1.7) * 0.4);
          });
        } else for (const bubble of bubbles) bubble.visible = false;
      },
      animals: () => [
        { x: centre.x + snappy.root.position.x, z: centre.z + snappy.root.position.z },
        { x: centre.x + baby.root.position.x, z: centre.z + baby.root.position.z },
      ],
    };
  }

  private buildIguanaRocks(placement: ExhibitPlacement): Exhibit {
    const group = this.buildWall(placement, 'rc-round-wall');
    for (const [name, x, z, yaw] of [['rp-rock-b', -0.9, 0.4, 0.4], ['rp-rock-c', 0.8, -0.3, 2.2]] as const) {
      const rock = reptilePlantMesh(name);
      rock.position.set(x, 0, z);
      rock.rotation.y = yaw;
      group.add(rock);
    }
    const iguanas: ReptileHandle[] = [];
    for (const [index, [x, y, z, yaw]] of ([[-0.9, 0.42, 0.4, 0.9], [0.8, 0.5, -0.3, 0.2]] as const).entries()) {
      const iguana = createIguana(1200 + index);
      iguana.root.position.set(x, y, z);
      iguana.root.rotation.y = yaw;
      group.add(iguana.root);
      iguanas.push(iguana);
    }
    const centre = this.shapeCentre(placement.shape);
    return {
      id: placement.id,
      subjects: () => iguanas.map((iguana) => iguana.root),
      zone: this.zone(placement.id, centre, placement.stand, group, () => {
        for (const iguana of iguanas) iguana.poke();
      }),
      update: (dt, elapsed) => {
        for (const iguana of iguanas) iguana.update(dt, elapsed);
      },
      animals: () => iguanas.map((iguana) => ({ x: centre.x + iguana.root.position.x, z: centre.z + iguana.root.position.z })),
    };
  }

  private buildNursery(placement: ExhibitPlacement): Exhibit {
    const shape = placement.shape;
    if (shape.kind !== 'disc') throw new Error('the nursery is a disc');
    const centre = shape.centre;
    const group = new Group();
    group.name = 'enclosure:nursery';
    group.position.set(centre.x, 0, centre.z);
    this.ctx.root.add(group);
    group.add(reptileCaseMesh('rc-nursery-kerb'), reptileCaseMesh('rc-nursery-rail'));
    const glassRadius = REPTILE_NURSERY_GLASS_RADIUS;
    // Inside the rail's posts and ring by a clear margin, so no pane face
    // lies in a plane with the rail's.
    const glass = new Mesh(
      new CylinderGeometry(glassRadius - 0.2, glassRadius - 0.2, REPTILE_NURSERY_RAIL_TOP - REPTILE_NURSERY_KERB_HEIGHT - 0.05, 32, 1, true),
      GLASS,
    );
    glass.position.y = (REPTILE_NURSERY_RAIL_TOP + REPTILE_NURSERY_KERB_HEIGHT) / 2;
    glass.castShadow = false;
    group.add(glass);
    const bedding = decal(new Mesh(new CylinderGeometry(shape.radius - 0.3, shape.radius - 0.3, 0.12, 32), toonMaterial(ART.hothouseClay)));
    bedding.position.y = 0.08;
    group.add(bedding);
    const mound = createNoodleTailMound();
    mound.root.position.set(-1.0, 0.1, -0.5);
    group.add(mound.root);
    const tailPath = [
      new Vector3(-1.0, 0.45, -0.5),
      new Vector3(-0.4, 0.2, 0.2),
      new Vector3(0.4, 0.18, -0.3),
      new Vector3(1.1, 0.16, 0.5),
      new Vector3(0.6, 0.15, 1.2),
    ];
    const tail = createSnake({ length: 2.6, radius: 0.3, colourway: 'mint', seed: 1300, path: tailPath, headless: true, taper: 0.25, pool: this.ctx.adults });
    group.add(tail.root);
    // Not the first point: that is where the tail comes out of its mound.
    const tailBody = bodyMarkers(group, tailPath.slice(1), 'nursery-tail');
    const colourways = ['mint', 'coral', 'corn', 'rainbow'] as const;
    const sizes = [
      [0.3, 0.05],
      [0.5, 0.07],
      [0.8, 0.09],
    ] as const;
    this.registerShape(placement.id, shape, REPTILE_NURSERY_RAIL_TOP);
    for (let i = 0; i < 12; i += 1) {
      const [length, radius] = sizes[i % 3]!;
      const angle = (i / 12) * Math.PI * 2 + 0.4;
      const r = 0.5 + (i % 4) * 0.35;
      const baby = createSnake({ length, radius, colourway: colourways[i % 4]!, seed: 1310 + i, pool: this.ctx.babies });
      baby.root.position.set(Math.cos(angle) * r, 0.14 + (i % 3) * 0.08, Math.sin(angle) * r);
      baby.root.rotation.y = this.ctx.rng.range(0, Math.PI * 2);
      group.add(baby.root);
      this.nurseryBabies.push(baby);
    }
    // The post runs from inside the bedding to inside the shade — both ends
    // hidden, so it is open-ended — and its top is derived from the rail's
    // with a margin: a typed 0.8 + 1.4 once landed exactly on
    // `REPTILE_NURSERY_RAIL_TOP` and fought the rail (`check:coplanar`).
    const postBottom = 0.1;
    const postTop = REPTILE_NURSERY_RAIL_TOP + 0.1;
    const lampPost = solid(new Mesh(new CylinderGeometry(0.03, 0.03, postTop - postBottom, 8, 1, true), toonMaterial(PALETTE.liftFrame)));
    lampPost.position.set(1.8, (postTop + postBottom) / 2, -1.4);
    group.add(lampPost);
    const shade = solid(new Mesh(new CylinderGeometry(0.16, 0.26, 0.22, 12, 1, true), toonMaterial(ART.hothouseClay)));
    shade.position.set(1.8, postTop - 0.05, -1.4);
    group.add(shade);
    const lampGlow = new Sprite(new SpriteMaterial({ map: glowTexture(PALETTE.fairyPink), transparent: true, depthWrite: false }));
    lampGlow.scale.setScalar(0.8);
    lampGlow.position.set(1.8, 1.45, -1.4);
    group.add(lampGlow);
    return {
      id: placement.id,
      subjects: () => [...asCrowd(this.nurseryBabies.map((baby) => baby.head)), ...tailBody],
      cast: () => [...this.nurseryBabies.map((baby) => baby.root), tail.root, ...tailBody],
      zone: this.zone(
        placement.id,
        centre,
        placement.stand,
        group,
        () => this.tickleTail(),
        () => [{ id: 'adopt', label: ADOPT_CHIP, glyph: '🏠', run: () => this.ctx.openShop('reptileNursery') }],
      ),
      update: (dt, elapsed) => {
        if (this.tailTickle > 0) this.tailTickle = Math.max(0, this.tailTickle - dt);
        tail.setWriggle(this.tailTickle > 0 ? 3 : 1);
        tail.update(dt, elapsed);
        const heap = 1 + Math.sin(elapsed * 0.8 * Math.PI * 2) * 0.03;
        for (const baby of this.nurseryBabies) {
          baby.setWriggle(this.tailTickle > 0 ? 3 : 1);
          baby.body.scale.y = heap;
          baby.update(dt, elapsed);
        }
      },
      animals: () => this.nurseryBabies.map((baby) => ({ x: centre.x + baby.root.position.x, z: centre.z + baby.root.position.z })),
    };
  }

  private buildFrogJar(placement: ExhibitPlacement): Exhibit {
    const shape = placement.shape;
    if (shape.kind !== 'disc') throw new Error('the frog jar is a disc');
    const centre = shape.centre;
    const group = new Group();
    group.name = 'enclosure:frogJar';
    group.position.set(centre.x, 0, centre.z);
    this.ctx.root.add(group);
    group.add(reptileCaseMesh('rc-jar-base'), reptileCaseMesh('rc-jar-rim'));
    const glass = new Mesh(new CylinderGeometry(REPTILE_JAR_RADIUS, REPTILE_JAR_RADIUS, REPTILE_GLASS_TOP - REPTILE_JAR_BASE_HEIGHT, 32, 1, true), GLASS);
    glass.position.y = (REPTILE_GLASS_TOP + REPTILE_JAR_BASE_HEIGHT) / 2;
    glass.castShadow = false;
    group.add(glass);
    const floor = REPTILE_JAR_BASE_HEIGHT;
    const water = decal(new Mesh(new CylinderGeometry(REPTILE_JAR_RADIUS - 0.08, REPTILE_JAR_RADIUS - 0.08, 0.04, 32), toonMaterial(PALETTE.waterTop, { emissive: PALETTE.waterTop, emissiveIntensity: 0.15 })));
    water.position.y = floor + 0.04;
    group.add(water);
    const twig = reptilePlantMesh('rp-branch');
    twig.position.set(-0.6, floor, -0.3);
    twig.scale.setScalar(0.7);
    twig.rotation.y = 2.4;
    group.add(twig);
    const padSpots: LocalPoint[] = [0, 1, 2, 3, 4, 5].map((i) => ({ x: Math.cos(i * 1.05) * (0.5 + (i % 2) * 0.45), z: Math.sin(i * 1.05) * (0.5 + (i % 2) * 0.45) }));
    group.add(...instancedPlant('rp-lily-pad', padSpots.map((spot, i) => ({ x: spot.x, y: floor + 0.06, z: spot.z, yaw: i * 0.7, scale: 0.75 }))));
    const frogs: FrogHandle[] = [];
    const timers: number[] = [];
    for (let i = 0; i < 5; i += 1) {
      const frog = createFrog(1400 + i);
      const spot = padSpots[i]!;
      frog.root.position.set(spot.x, floor + 0.1, spot.z);
      frog.root.rotation.y = i * 1.3;
      group.add(frog.root);
      frogs.push(frog);
      timers.push(this.ctx.rng.range(3, 7));
    }
    // Hidden baby #5, wearing a lily pad as a hat.
    const baby = createSnake({ length: 0.3, radius: 0.05, colourway: 'mint', seed: 1450, pool: this.ctx.babies });
    const hatSpot = padSpots[5]!;
    baby.root.position.set(hatSpot.x, floor + 0.08, hatSpot.z);
    baby.root.rotation.y = 0.8;
    group.add(baby.root);
    const hat = instancedPlant('rp-lily-pad', [{ x: 0, y: 0.13, z: 0.18, yaw: 0, scale: 0.35 }]);
    baby.head.add(...hat);
    const hidden: HiddenBaby = { index: 4, snake: baby, at: { x: centre.x + hatSpot.x, z: centre.z + hatSpot.z }, restY: floor + 0.08, found: false };
    this.babies.push(hidden);
    this.registerShape(placement.id, shape, REPTILE_GLASS_TOP);
    let chorus = 0;
    return {
      id: placement.id,
      subjects: () => asCrowd(frogs.map((frog) => frog.root)),
      zone: this.zone(
        placement.id,
        centre,
        placement.stand,
        group,
        () => {
          chorus = 1;
          this.ctx.say('ribbit!', centre, 3.2);
        },
        () => (hidden.found ? [] : [{ id: 'found', label: FOUND_YOU_CHIP, glyph: '🐍', run: () => this.found(hidden) }]),
      ),
      update: (dt, elapsed) => {
        if (chorus > 0) chorus = Math.max(0, chorus - dt);
        frogs.forEach((frog, index) => {
          frog.update(dt, elapsed);
          timers[index] = (timers[index] ?? 3) - dt;
          const due = (timers[index] ?? 0) <= 0 || (chorus > 0 && chorus < 1 - index * 0.15 && chorus > 0.95 - index * 0.15);
          if (due && !frog.hopping) {
            timers[index] = this.ctx.rng.range(3, 7);
            const pad = padSpots[this.ctx.rng.int(0, 4)]!;
            frog.hopTo(pad.x, floor + 0.1, pad.z);
            if (chorus > 0) frog.poke();
          }
        });
      },
      animals: () => frogs.map((frog) => ({ x: centre.x + frog.root.position.x, z: centre.z + frog.root.position.z })),
    };
  }

  // ------------------------------------------------------------- Noodle

  private buildNoodle(placement: ExhibitPlacement): Exhibit {
    const shape = placement.shape;
    if (shape.kind !== 'disc') throw new Error("Noodle's rock is a disc");
    const rock = createNoodleRock();
    this.ctx.root.add(rock.root);
    this.ctx.root.add(reptileCaseMesh('rc-island-kerb'));
    this.noodle = rock;
    // A ring of big leaves round the kerb, the visible solid a jump cannot clear.
    const leaves = [...Array(14)].map((_, i) => {
      const angle = (i / 14) * Math.PI * 2 + 0.2;
      // None where her head rests on the kerb, so the face stays in view.
      return { x: Math.cos(angle) * 2.85, y: 0.1, z: Math.sin(angle) * 2.85, yaw: angle + Math.PI / 2, scale: 1.1 };
    }).filter((leaf) => !(leaf.x > 1.4 && leaf.z > 1.4));
    this.ctx.root.add(...instancedPlant('rp-monstera-leaf', leaves), ...instancedPlant('rp-monstera-stalk', leaves));
    this.registerShape(placement.id, shape, 2.4);
    // Her snout reaches past the kerb's collider: one small disc under it,
    // from the measured reach rather than a typed number.
    const over = rock.snoutReach - REPTILE_ISLAND_COLLIDER_RADIUS;
    if (over > 0) {
      const at = (REPTILE_ISLAND_COLLIDER_RADIUS + rock.snoutReach) / 2;
      this.ctx.props.disc("Noodle's snout", Math.SQRT1_2 * at, Math.SQRT1_2 * at, over / 2 + 0.15, 1.3, { stand: false });
    }
    const headAt: LocalPoint = { x: rock.head.position.x, z: rock.head.position.z };
    return {
      id: placement.id,
      subjects: () => [rock.head],
      cast: () => [rock.head, rock.coil],
      zone: this.zone(placement.id, headAt, placement.stand, rock.head, () => {
        this.noodleLift = 1.6;
        this.noodleMood = 2.2;
        rock.setFace('happy');
        this.ctx.say('Hisss-ello!', headAt, 1.8);
        this.ctx.hearts(headAt, 1.4);
      }),
      update: () => {},
      animals: () => [headAt],
    };
  }

  private updateNoodle(dt: number, elapsed: number, player: LocalPoint | null): void {
    const rock = this.noodle;
    if (!rock) return;
    const breath = 1 + Math.sin(elapsed * 0.25 * Math.PI * 2) * 0.015;
    rock.coil.scale.set(breath, 1, breath);
    if (this.noodleLift > 0) this.noodleLift = Math.max(0, this.noodleLift - dt);
    if (this.noodleMood > 0) {
      this.noodleMood = Math.max(0, this.noodleMood - dt);
      if (this.noodleMood === 0) rock.setFace('neutral');
      else if (this.tailTickle > 0 && this.noodleMood < 1.4) rock.setFace('happy');
    }
    const lift = this.noodleLift > 0 ? Math.sin(Math.min(1, this.noodleLift / 1.6) * Math.PI) * 0.4 : 0;
    const tickleHop = this.tailTickle > 0 ? Math.abs(Math.sin(elapsed * 9)) * 0.2 : 0;
    rock.head.position.y = REPTILE_NOODLE_HEAD_Y + lift + tickleHop;
    // She turns to watch a child within six metres, by no more than 20°.
    let yaw = 0;
    if (player) {
      const dx = player.x - rock.head.position.x;
      const dz = player.z - rock.head.position.z;
      if (Math.hypot(dx, dz) < 6) {
        const wanted = Math.atan2(dx, dz) - Math.PI / 4;
        yaw = Math.max(-0.35, Math.min(0.35, Math.atan2(Math.sin(wanted), Math.cos(wanted))));
      }
    }
    rock.head.rotation.y += (yaw - rock.head.rotation.y) * Math.min(1, dt * 3);
    const flick = Math.sin(elapsed * 0.9) > 0.97;
    rock.tongue.scale.setScalar(flick || this.noodleMood > 1.8 ? 1 : 0.001);
  }

  // -------------------------------------------------------- the rest

  /** Vine-wrapped pier posts sealing the gaps between plinths. */
  private buildPiers(): void {
    for (const [index, post] of PIER_POSTS.entries()) {
      const group = new Group();
      group.position.set(post.x, 0, post.z);
      group.rotation.y = index * 1.3;
      group.add(reptileCaseMesh('rc-pier-post'), reptileCaseMesh('rc-pier-vine'));
      this.ctx.root.add(group);
      this.ctx.props.disc(`pier post ${index}`, post.x, post.z, REPTILE_PIER_POST_RADIUS, 'wall');
    }
  }

  /** The Hollow Log short-cut: the kit's split log, its knothole, twenty glow-worms and hidden baby #1. */
  private buildHollowLog(): void {
    const log = new Group();
    log.position.set(REPTILE_LOG_CENTRE_X, 0, 0);
    log.add(reptilePlantMesh('rp-log-hollow'), reptilePlantMesh('rp-log-knothole'));
    this.ctx.root.add(log);
    const half = REPTILE_LOG_LENGTH / 2;
    const wallZ = REPTILE_LOG_INNER_RADIUS + 0.3;
    for (const side of [-1, 1] as const) {
      this.ctx.props.wall(
        `the hollow log's ${side < 0 ? 'north' : 'south'} wall`,
        { x: REPTILE_LOG_CENTRE_X - half, z: side * wallZ },
        { x: REPTILE_LOG_CENTRE_X + half, z: side * wallZ },
        0.3,
        'wall',
      );
    }
    for (let i = 0; i < 20; i += 1) {
      const worm = decal(new Mesh(SMALL_SPHERE, toonMaterial(PALETTE.markerMint, { emissive: PALETTE.markerMint, emissiveIntensity: 0.2 })));
      const angle = this.ctx.rng.range(0.3, Math.PI - 0.3);
      worm.position.set(this.ctx.rng.range(-half + 0.3, half - 0.3), 0.3 + Math.sin(angle) * (REPTILE_LOG_INNER_RADIUS + 0.9), Math.cos(angle) * (REPTILE_LOG_INNER_RADIUS - 0.05));
      worm.scale.setScalar(0.05);
      log.add(worm);
      this.logWorms.push(worm);
    }
    const knothole = reptilePlantAnchor('rp-log-knothole');
    const baby = createSnake({ length: 0.3, radius: 0.05, colourway: 'coral', seed: 1500, pool: this.ctx.babies });
    baby.root.position.set(knothole.x, knothole.y - 0.1, knothole.z - 0.12);
    log.add(baby.root);
    const at: LocalPoint = { x: REPTILE_LOG_CENTRE_X + knothole.x, z: knothole.z };
    this.hiddenBaby(0, baby, at, knothole.y - 0.1, HIDDEN_BABY_SPOTS[0]!, 'the Hollow Log');
  }

  /** The grotto: the kit's rock face yawed to face the walk, a pool, a waterfall and hidden baby #2. */
  private buildGrotto(): void {
    const group = new Group();
    group.position.set(GROTTO_ROCK.x, 0, GROTTO_ROCK.z);
    group.rotation.y = (GROTTO_ROCK_YAW * Math.PI) / 180;
    group.add(reptileCaseMesh('rc-grotto-rock'), reptileCaseMesh('rc-grotto-moss'));
    this.ctx.root.add(group);
    // The pool basin and the waterfall lip, where the kit puts them (local).
    const basinX = GROTTO_BASIN.x;
    const basinZ = GROTTO_BASIN.z;
    const pool = decal(new Mesh(new CylinderGeometry(1.15, 1.15, 0.04, 24), toonMaterial(PALETTE.waterTop, { emissive: PALETTE.waterTop, emissiveIntensity: 0.15 })));
    pool.position.set(basinX, 0.3, basinZ);
    group.add(pool);
    const sheet = decal(new Mesh(new PlaneGeometry(0.5, 1.75), toonMaterial(PALETTE.waterFoam, { transparent: true, opacity: 0.7 })));
    sheet.position.set(basinX, 1.25, 0.47);
    group.add(sheet);
    group.add(...instancedPlant('rp-lily-pad', [0, 1, 2, 3, 4, 5].map((i) => ({ x: basinX + Math.cos(i * 1.1) * 0.7, y: 0.32, z: basinZ + Math.sin(i * 1.1) * 0.7, yaw: i, scale: 0.7 }))));
    const baby = createSnake({ length: 0.3, radius: 0.05, colourway: 'mint', seed: 1600, pool: this.ctx.babies });
    baby.root.position.set(basinX + 0.3, 0.2, basinZ + 0.2);
    group.add(baby.root);
    this.hiddenBaby(1, baby, grottoLocal(basinX + 0.3, basinZ + 0.2), 0.2, HIDDEN_BABY_SPOTS[1]!, 'the grotto pool');
  }

  /** The foyer's tall-banana pot, with hidden baby #3 peeking over its rim. */
  private buildFoyerPot(): void {
    const group = new Group();
    group.position.set(FOYER_POT.x, 0, FOYER_POT.z);
    this.ctx.root.add(group);
    const pot = solid(new Mesh(new CylinderGeometry(FOYER_POT_RADIUS - 0.05, FOYER_POT_RADIUS - 0.15, 0.9, 16), toonMaterial(ART.hothouseClay)));
    pot.position.y = 0.45;
    group.add(pot);
    const soil = decal(new Mesh(new CylinderGeometry(FOYER_POT_RADIUS - 0.08, FOYER_POT_RADIUS - 0.08, 0.04, 16), toonMaterial(PALETTE.barkDark)));
    soil.position.y = 0.9;
    group.add(soil);
    group.add(...instancedPlant('rp-banana-leaf', [0, 1, 2].map((i) => ({ x: 0, y: 0.88, z: 0, yaw: i * 2.1 + 0.5, scale: 1.2 }))));
    this.ctx.props.disc('the foyer pot', FOYER_POT.x, FOYER_POT.z, FOYER_POT_RADIUS, 2.4, { stand: false });
    const baby = createSnake({ length: 0.3, radius: 0.05, colourway: 'rainbow', seed: 1700, pool: this.ctx.babies });
    baby.root.position.set(0.1, 0.75, 0.25);
    baby.root.rotation.y = 0.3;
    group.add(baby.root);
    this.hiddenBaby(2, baby, { x: FOYER_POT.x + 0.1, z: FOYER_POT.z + 0.25 }, 0.75, HIDDEN_BABY_SPOTS[2]!, 'the banana pot');
  }

  private hiddenBaby(index: number, snake: SnakeHandle, at: LocalPoint, restY: number, stand: StandSpot, label: string): void {
    const baby: HiddenBaby = { index, snake, at, restY, found: false };
    this.babies.push(baby);
    this.babyZones.push({
      id: `reptile:baby:${index}`,
      label,
      x: REPTILE_HOUSE_ORIGIN_X + at.x,
      y: 1,
      z: REPTILE_HOUSE_ORIGIN_Z + at.z,
      pickRadius: PICK_RADIUS,
      standX: REPTILE_HOUSE_ORIGIN_X + stand.x,
      standZ: REPTILE_HOUSE_ORIGIN_Z + stand.z,
      verb: 'Found you',
      highlight: highlightObject(snake.head),
      actions: () => (baby.found ? [] : [{ id: PRIMARY_ACTION, label: FOUND_YOU_CHIP, glyph: '🐍', run: () => this.found(baby) }]),
    });
  }

  private found(baby: HiddenBaby): void {
    if (baby.found) return;
    baby.found = true;
    baby.snake.poke();
    this.ctx.hearts(baby.at, baby.restY + 0.8);
    this.ctx.say(`${this.babiesFound} of 5 babies found!`, baby.at, baby.restY + 1.1);
    this.ctx.findBaby(baby.index);
  }
}
