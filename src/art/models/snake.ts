import {
  BackSide,
  CatmullRomCurve3,
  Color,
  Group,
  InstancedMesh,
  Matrix4,
  MeshBasicMaterial,
  MeshToonMaterial,
  Object3D,
  Quaternion,
  SphereGeometry,
  Vector3,
} from 'three';
import { PALETTE } from '../../core/palette';
import { Rng } from '../../core/mathUtils';
import { ART } from '../style/artPalette';
import type { AssetHandle, CreatureHandle } from '../style/asset';
import type { Expression } from '../style/faces';
import { createFaceLife, type FaceLife } from '../style/faceLife';
import { visibleBounds } from '../style/measure';
import { inkTint, markShared, outlineGeometry, toonMaterial } from '../style/materials';
import { reptileCreatureMesh } from './reptileCreaturesAssets';
import { PET_RENDER_HEIGHT } from './pets';
import { snakeFaceTextures, type SnakeExpression } from './snakeFace';

/**
 * **The snake rig** — every snake in the Reptile House, and the one you adopt.
 *
 * No bones, no skin: the glb reader ignores both, and a snake does not need
 * them. A snake is N squashed spheres strung along a path, each one offset
 * sideways by a travelling sine — `A·sin(k·s − ω·t)` — so the body ripples
 * from head to tail, plus the `creatures` kit's one authored head under a
 * sizer. The head is where the snake *is*; the spheres are where it was.
 *
 * ## Why the body is instanced
 *
 * A hall of thirty snakes at fifteen segments each is 450 meshes if each
 * segment is a `Mesh`, and 450 draw calls is the whole indoor budget. So the
 * segments are instances of one unit sphere in a {@link SnakeSegmentPool}: the
 * house hands every adult the same pool and every baby another, two draw
 * calls (plus two for their ink outlines, which **share the body's own
 * `instanceMatrix`** so they cannot drift). `instanceColor` is what gives
 * Ribbon her rainbow and the corn snakes their saddles for free. A snake
 * built without a pool — the pet, the plush — makes a private one of its own
 * size, so it is one draw call and travels in the parade like any toy.
 *
 * ## Colourways
 *
 * One table, keyed by name, read by the nursery, the cases and the shop, so
 * "a coral snake" is the same coral everywhere.
 */
export type SnakeColourway = 'mint' | 'coral' | 'rainbow' | 'corn' | 'emerald' | 'milk' | 'grove';

interface ColourwaySpec {
  /** Segment colours, cycled along the body. */
  readonly bands: readonly number[];
  /** The head's colour — the first band unless said otherwise. */
  readonly head?: number;
}

const COLOURWAYS: Readonly<Record<SnakeColourway, ColourwaySpec>> = {
  mint: { bands: [ART.snakeMint, ART.snakeMint, ART.snakeBelly] },
  coral: { bands: [ART.snakeCoral, ART.snakeCoral, ART.snakeBelly] },
  rainbow: {
    bands: [PALETTE.markerPink, PALETTE.markerSky, PALETTE.markerLemon, PALETTE.markerLilac, PALETTE.markerMint],
    head: PALETTE.markerPink,
  },
  corn: { bands: [ART.cornOrange, ART.cornOrange, ART.cornSaddle] },
  emerald: { bands: [PALETTE.leafMid, PALETTE.leafLight] },
  milk: { bands: [PALETTE.markerMint, ART.cream, PALETTE.blossomPink], head: PALETTE.markerMint },
  grove: { bands: [PALETTE.leafDeep, PALETTE.leafDeep, PALETTE.leafDeep, PALETTE.flowerYellow] },
};

/** The kit head is 0.38 m wide at scale 1 — the width an adult body of this radius wants. */
const HEAD_NATIVE_RADIUS = 0.19;

const UNIT_SPHERE = markShared(new SphereGeometry(1, 14, 10));
const UNIT_OUTLINE = markShared(outlineGeometry(UNIT_SPHERE, 0.08));

/**
 * A fixed pool of instanced segments shared by many snakes. Add {@link meshes}
 * to the scene where the snakes' roots live; each snake writes its own slots
 * every frame in that parent's space.
 */
export class SnakeSegmentPool {
  readonly body: InstancedMesh;
  readonly outline: InstancedMesh;
  readonly meshes: readonly Object3D[];
  /** The object the pool's meshes are parented to; snakes write matrices in its space. */
  readonly parent: Object3D;
  private used = 0;
  private readonly capacity: number;

  constructor(parent: Object3D, capacity: number, label: string) {
    this.capacity = capacity;
    this.parent = parent;
    this.body = new InstancedMesh(UNIT_SPHERE, toonMaterial(0xffffff), capacity);
    this.body.name = `${label}:segments`;
    this.body.castShadow = false;
    this.body.receiveShadow = false;
    this.body.count = 0;
    this.outline = new InstancedMesh(UNIT_OUTLINE, new MeshBasicMaterial({ color: 0xffffff, side: BackSide }), capacity);
    this.outline.name = `${label}:outline`;
    this.outline.instanceMatrix = this.body.instanceMatrix;
    this.outline.renderOrder = -1;
    this.outline.castShadow = false;
    this.outline.receiveShadow = false;
    this.outline.count = 0;
    this.meshes = [this.body, this.outline];
    parent.add(this.body, this.outline);
  }

  /** Reserves `count` slots; returns the first. Throws rather than silently drawing nothing. */
  allocate(count: number): number {
    if (this.used + count > this.capacity) {
      throw new Error(`SnakeSegmentPool: ${this.used + count} segments asked of a pool of ${this.capacity}`);
    }
    const start = this.used;
    this.used += count;
    this.body.count = this.used;
    this.outline.count = this.used;
    return start;
  }

  setColour(index: number, colour: number): void {
    SCRATCH_COLOUR.setHex(colour);
    this.body.setColorAt(index, SCRATCH_COLOUR);
    SCRATCH_COLOUR.setHex(inkTint(colour));
    this.outline.setColorAt(index, SCRATCH_COLOUR);
    if (this.body.instanceColor) this.body.instanceColor.needsUpdate = true;
    if (this.outline.instanceColor) this.outline.instanceColor.needsUpdate = true;
  }

  setMatrix(index: number, matrix: Matrix4): void {
    this.body.setMatrixAt(index, matrix);
  }

  commit(): void {
    this.body.instanceMatrix.needsUpdate = true;
  }
}

const SCRATCH_COLOUR = new Color();
const SCRATCH_POSITION = new Vector3();
const SCRATCH_TANGENT = new Vector3();
const SCRATCH_NORMAL = new Vector3();
const SCRATCH_QUATERNION = new Quaternion();
const SCRATCH_SCALE = new Vector3();
const SCRATCH_MATRIX = new Matrix4();
const SCRATCH_TO_POOL = new Matrix4();
const SCRATCH_LOOK = new Vector3();
const FORWARD = new Vector3(0, 0, 1);

export interface SnakeOptions {
  /** Body length from neck to tail tip, metres. */
  readonly length: number;
  /** Body radius, metres. */
  readonly radius: number;
  readonly colourway: SnakeColourway;
  readonly seed: number;
  /**
   * The path the body lies along, in the snake root's own metres, **tail
   * first, head last**. Omitted, a resting S on the ground.
   */
  readonly path?: readonly Vector3[];
  /** Crawl round the path for ever (it is closed) at this many metres a second. */
  readonly crawl?: number;
  /** Where the head looks, local — omitted, along the path. */
  readonly headLookAt?: Vector3;
  /** Share this pool; omitted, the snake makes a private one under its own body. */
  readonly pool?: SnakeSegmentPool;
  /** No head — a tail coming up out of the ground (Noodle's, in the nursery). */
  readonly headless?: true;
  /** The tail end's radius as a fraction of `radius`; 1 (the default) is a uniform body. */
  readonly taper?: number;
}

export interface SnakeHandle extends CreatureHandle {
  /** Advance the slither. Call every frame the snake is on screen. */
  update(dt: number, elapsed: number): void;
  /** "Say hi!" — a happy face, a tongue flick and a two-second wriggle. */
  poke(): void;
  /** Multiplies the wave amplitude: 1 at rest, the nursery's tumble runs it up to 3. */
  setWriggle(amount: number): void;
  readonly segmentCount: number;
}

/**
 * One snake. `root` at the base, +Z forward (the resting S faces +Z and the
 * head looks that way); `body` holds everything, `head` is the authored head
 * group at the neck.
 */
export function createSnake(options: SnakeOptions): SnakeHandle {
  const rng = new Rng(options.seed);
  const colourway = COLOURWAYS[options.colourway];
  const radius = options.radius;
  const spacing = radius * 1.6;
  const count = Math.max(4, Math.round(options.length / spacing));

  const root = new Group();
  root.name = `snake.${options.colourway}`;
  const body = new Group();
  body.name = 'snake.body';
  root.add(body);

  const pool = options.pool ?? new SnakeSegmentPool(body, count, root.name);
  const privatePool = options.pool === undefined;
  const first = pool.allocate(count);
  for (let i = 0; i < count; i += 1) {
    pool.setColour(first + i, colourway.bands[i % colourway.bands.length] ?? colourway.bands[0]!);
  }

  // The head: the kit's one, under a sizer so the pet and the hatchling wear
  // the same face at their own sizes.
  const head = new Group();
  head.name = 'snake.head';
  const headScale = radius / HEAD_NATIVE_RADIUS;
  const headMesh = reptileCreatureMesh('rr-snake-head', {
    colour: colourway.head ?? colourway.bands[0]!,
    outline: 0.012 / Math.max(0.3, headScale),
  });
  headMesh.scale.setScalar(headScale);
  const faces = snakeFaceTextures();
  const headMaterial = headMesh.material as MeshToonMaterial;
  headMaterial.map = faces.neutral;
  headMaterial.needsUpdate = true;
  const tongue = reptileCreatureMesh('rr-snake-tongue');
  tongue.scale.set(1, 1, 0.001);
  if (!options.headless) {
    head.add(headMesh);
    headMesh.add(tongue);
  }
  body.add(head);
  const taper = options.taper ?? 1;

  const path = new CatmullRomCurve3(
    (options.path ?? restingS(options.length, radius)).map((p) => p.clone()),
    options.crawl !== undefined,
    'centripetal',
  );
  const pathLength = path.getLength();
  const crawl = options.crawl ?? 0;

  let headAt = pathLength; // arc position of the neck; the body trails behind
  let wave = 0;
  let waveSpeed = crawl > 0 ? 2.5 : 0.6;
  let wriggle = 1;
  let reaction = 0;
  let tongueFor = 0;
  let nextTongue = rng.range(4, 9);
  let resting: SnakeExpression = 'neutral';
  let walkPhase: number | null = null;
  const faceLife: FaceLife = createFaceLife((expression) => showFace(expression));

  const showFace = (expression: Expression): void => {
    const snake: SnakeExpression =
      expression === 'blink' ? 'blink' : expression === 'happy' ? 'happy' : expression === 'surprised' ? 'surprised' : 'neutral';
    headMaterial.map = faces[snake];
    headMaterial.needsUpdate = true;
  };

  const wavelength = 0.8;
  const k = (Math.PI * 2) / wavelength;

  const update = (dt: number, elapsed: number): void => {
    if (crawl > 0) headAt = (headAt + crawl * dt) % pathLength;
    // A house snake's wave runs on its own clock. A parade snake's is the
    // walk phase, **scaled by speed** — so standing still it carries only the
    // idle wiggle on `elapsed`, and `check:assets`' rest-pose rule (a walk
    // cycle at zero speed moves nothing) holds: the swing is added to the
    // rest, never assigned over it.
    if (walkPhase === null) wave += waveSpeed * dt;
    else wave = elapsed * 0.6 + walkPhase * Math.PI * 2 * waveSpeed;
    if (reaction > 0) reaction = Math.max(0, reaction - dt);
    const amplitude = radius * 0.5 * wriggle * (reaction > 0 ? 2.2 : 1);

    tongueFor -= dt;
    nextTongue -= dt;
    if (nextTongue <= 0) {
      nextTongue = rng.range(4, 9);
      tongueFor = 0.12;
    }
    tongue.scale.z = tongueFor > 0 ? 1 : 0.001;
    faceLife.update(dt, reaction > 0 ? 'happy' : resting === 'neutral' ? 'neutral' : 'happy');

    // Segments are written in the pool parent's space.
    body.updateWorldMatrix(true, false);
    if (privatePool) SCRATCH_TO_POOL.identity();
    else {
      pool.parent.updateWorldMatrix(true, false);
      SCRATCH_TO_POOL.copy(pool.parent.matrixWorld).invert().multiply(body.matrixWorld);
    }

    for (let i = 0; i < count; i += 1) {
      const s = wrap(headAt - i * spacing, pathLength, crawl > 0);
      const u = Math.max(0, Math.min(1, s / pathLength));
      path.getPointAt(u, SCRATCH_POSITION);
      path.getTangentAt(u, SCRATCH_TANGENT);
      SCRATCH_NORMAL.set(-SCRATCH_TANGENT.z, 0, SCRATCH_TANGENT.x);
      if (SCRATCH_NORMAL.lengthSq() < 1e-6) SCRATCH_NORMAL.set(1, 0, 0);
      SCRATCH_NORMAL.normalize();
      const offset = amplitude * Math.sin(k * s - wave) * (i === 0 ? 0.35 : 1);
      SCRATCH_POSITION.addScaledVector(SCRATCH_NORMAL, offset);
      const r = radius * (1 - (1 - taper) * (i / Math.max(1, count - 1)));
      SCRATCH_POSITION.y += r;
      if (i === 0) {
        head.position.copy(SCRATCH_POSITION);
        if (options.headLookAt) SCRATCH_LOOK.copy(options.headLookAt);
        else SCRATCH_LOOK.copy(SCRATCH_POSITION).add(SCRATCH_TANGENT);
        head.lookAt(SCRATCH_LOOK.applyMatrix4(body.matrixWorld));
      }
      SCRATCH_QUATERNION.setFromUnitVectors(FORWARD, SCRATCH_TANGENT);
      SCRATCH_SCALE.set(r, r * 0.86, r * 1.3);
      SCRATCH_MATRIX.compose(SCRATCH_POSITION, SCRATCH_QUATERNION, SCRATCH_SCALE);
      if (!privatePool) SCRATCH_MATRIX.premultiply(SCRATCH_TO_POOL);
      pool.setMatrix(first + i, SCRATCH_MATRIX);
    }
    pool.commit();
  };
  // Pose it now, so a measurement at construction sees a snake rather than
  // a pool of unit spheres at the origin.
  update(0, 0);

  return {
    root,
    body,
    head,
    limbs: null,
    height: visibleBounds(root).top,
    segmentCount: count,
    update,
    setExpression(name) {
      resting = name === 'happy' ? 'happy' : 'neutral';
      showFace(name);
    },
    setWalkPhase(phase, speed) {
      walkPhase = phase;
      waveSpeed = speed;
      body.position.y = Math.abs(Math.sin(phase * Math.PI * 2)) * 0.02 * speed;
    },
    poke() {
      reaction = 2;
      tongueFor = 0.15;
    },
    setWriggle(amount) {
      wriggle = amount;
    },
  };
}

function wrap(s: number, length: number, closed: boolean): number {
  if (closed) return ((s % length) + length) % length;
  return Math.max(0, Math.min(length, s));
}

/** A resting S on the ground, tail at −Z, neck at +Z, facing +Z. */
function restingS(length: number, radius: number): Vector3[] {
  const half = length / 2;
  const sway = Math.min(0.35, length * 0.16);
  return [
    new Vector3(sway * 0.4, 0, -half),
    new Vector3(-sway, 0, -half * 0.55),
    new Vector3(sway, 0, 0),
    new Vector3(-sway * 0.7, 0, half * 0.55),
    new Vector3(0, 0, half),
  ].map((p) => p.add(new Vector3(0, 0, radius)));
}

// ---------------------------------------------------------------------------
// The adoptable pet and the plush — the catalogue's two snakes
// ---------------------------------------------------------------------------

/**
 * **The snake you adopt at the nursery.** The same `createSnake` as the
 * hatchlings on Noodle's tail — the pet she takes home is the pet she saw —
 * posed in a resting S with its head reared, and sized to the pets' common
 * {@link PET_RENDER_HEIGHT} through a sizer group, as every pet is: a flat
 * snake measured for height would be scaled five times over, so the rear is
 * what makes the measurement honest. Walks in the parade as a walker: the
 * wave answers `setWalkPhase`.
 */
export function createPetSnake(colourway: SnakeColourway): SnakeHandle {
  const radius = 0.11;
  const path = [
    new Vector3(-0.22, 0, -0.75),
    new Vector3(0.2, 0, -0.4),
    new Vector3(-0.2, 0, -0.02),
    new Vector3(0.08, 0, 0.3),
    new Vector3(0, 0.42, 0.44),
    new Vector3(0, 0.78, 0.4),
  ];
  const snake = createSnake({
    length: 1.9,
    radius,
    colourway,
    seed: 0x5e4a + colourway.length,
    path,
    headLookAt: new Vector3(0, 0.9, 1.6),
  });
  snake.root.name = `pet.snake.${colourway}`;
  // The sizer between root and body — `root.scale` is the parade's, `body`
  // is bobbed every frame, so neither may carry the size (`pets.ts`).
  const sizer = new Group();
  sizer.name = 'petSizer';
  snake.root.remove(snake.body);
  sizer.add(snake.body);
  snake.root.add(sizer);
  const { bottom, top } = visibleBounds(snake.body);
  const extent = top - bottom;
  if (extent > 1e-4) {
    const scale = PET_RENDER_HEIGHT / extent;
    sizer.scale.setScalar(scale);
    sizer.position.y = -bottom * scale;
  }
  return { ...snake, height: PET_RENDER_HEIGHT };
}

/** Noodle Plush — a soft coiled toy snake, 1.2 m across, origin at its base. A hopper in the parade. */
export function createNoodlePlush(): AssetHandle {
  const turns = 2.2;
  const path: Vector3[] = [];
  const steps = 18;
  for (let i = 0; i <= steps; i += 1) {
    const t = i / steps;
    const angle = t * turns * Math.PI * 2;
    const r = 0.5 - t * 0.38;
    path.push(new Vector3(Math.cos(angle) * r, t * 0.26, Math.sin(angle) * r));
  }
  const snake = createSnake({ length: 3.6, radius: 0.12, colourway: 'mint', seed: 0x9100d, path, headLookAt: new Vector3(0, 0.5, 1.2) });
  snake.root.name = 'toy.noodlePlush';
  // Origin at the base, as the shop contract promises: the coil's lowest
  // sphere sits a few centimetres up its own path, so the body comes down by
  // the measured amount rather than a guessed one.
  const { bottom } = visibleBounds(snake.root);
  snake.body.position.y -= bottom;
  return { root: snake.root, height: visibleBounds(snake.root).top, update: snake.update };
}

/** A snake's body colour, for anything that wants to match one — a nameplate's trim, a hat. */
export function snakeColour(colourway: SnakeColourway): number {
  return COLOURWAYS[colourway].head ?? COLOURWAYS[colourway].bands[0]!;
}
