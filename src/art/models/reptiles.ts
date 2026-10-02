import {
  Color,
  CylinderGeometry,
  Group,
  Mesh,
  MeshToonMaterial,
  SphereGeometry,
  TorusGeometry,
  Vector3,
} from 'three';
import { PALETTE } from '../../core/palette';
import { Rng } from '../../core/mathUtils';
import { ART } from '../style/artPalette';
import type { AssetHandle } from '../style/asset';
import { visibleBounds } from '../style/measure';
import { addOutline, decal, markShared, solid, toonMaterial } from '../style/materials';
import { reptileCreatureBox, reptileCreatureMesh } from './reptileCreaturesAssets';

/**
 * **The house's reptiles that are not snakes** — the crocodile, the tortoises,
 * the chameleon, the frogs, the geckos, the skink and the iguanas. Each is the
 * `creatures` kit's authored body plus TypeScript for everything that moves or
 * has a face: leg stubs, eyes, a tongue, a crest. Every face is **geometry**
 * — ink eye blobs with a catchlight, a blush disc, a w-mouth torus — the stall
 * kit's own precedent, so a hall of twenty animals spends no canvas at all.
 *
 * Every one faces +Z with its origin on the floor under its belly, obeys
 * `update(dt, elapsed)` for its idle, and has a `poke()` for the chip's
 * reaction: a two-second state on the creature, no new UI. Nothing has teeth;
 * the crocodile's bite is a yawn.
 */
export interface ReptileHandle extends AssetHandle {
  update(dt: number, elapsed: number): void;
  /** The chip's reaction — a couple of seconds of doing its one trick. */
  poke(): void;
}

const SCRATCH_COLOUR = new Color();
const EYE = markShared(new SphereGeometry(1, 10, 8));
const SHINE = markShared(new SphereGeometry(1, 6, 5));
const BLUSH = markShared(new SphereGeometry(1, 8, 6));

/**
 * The house face in three primitives per side: an ink eye taller than wide,
 * a catchlight high and inward, a soft blush below and outward. `size` is the
 * eye's half-height; everything else is a fraction of it (ART_DIRECTION §4).
 */
export function geometryFace(parent: Group, x: number, y: number, z: number, size: number, blush = true): void {
  for (const side of [-1, 1] as const) {
    const eye = decal(new Mesh(EYE, toonMaterial(ART.ink)));
    eye.position.set(side * x, y, z);
    eye.scale.set(size * 0.78, size, size * 0.5);
    parent.add(eye);
    const shine = decal(new Mesh(SHINE, toonMaterial(ART.shine)));
    shine.position.set(side * (x - size * 0.25), y + size * 0.35, z + size * 0.42);
    shine.scale.setScalar(size * 0.28);
    parent.add(shine);
    if (blush) {
      const cheek = decal(new Mesh(BLUSH, toonMaterial(ART.blush)));
      cheek.position.set(side * (x + size * 0.9), y - size * 0.9, z - size * 0.1);
      cheek.scale.set(size * 0.7, size * 0.45, size * 0.3);
      parent.add(cheek);
    }
  }
}

/** A w-mouth: two little arcs side by side, in ink. */
export function wMouth(parent: Group, y: number, z: number, size: number): void {
  for (const side of [-1, 1] as const) {
    const arc = decal(new Mesh(new TorusGeometry(size, size * 0.18, 6, 10, Math.PI), toonMaterial(ART.ink)));
    arc.position.set(side * size, y, z);
    arc.rotation.z = Math.PI;
    arc.rotation.x = Math.PI / 2 - 0.4;
    parent.add(arc);
  }
}

function stubLeg(radius: number, length: number, colour: number): Mesh {
  const leg = solid(new Mesh(new CylinderGeometry(radius * 0.8, radius, length, 10), toonMaterial(colour)));
  addOutline(leg, 0.01);
  return leg;
}

// ---------------------------------------------------------------------------
// Snappy
// ---------------------------------------------------------------------------

export interface CrocHandle extends ReptileHandle {
  /** `true` while the jaw is open. */
  readonly yawning: boolean;
}

/** Snappy, 3.6 m nose to tail, floating or sat; four round cream bumps where teeth would be. */
export function createCroc(seed: number): CrocHandle {
  const rng = new Rng(seed);
  const root = new Group();
  root.name = 'reptile.croc';
  const body = new Group();
  root.add(body);
  body.add(reptileCreatureMesh('rr-croc-body'));
  const head = reptileCreatureMesh('rr-croc-head');
  body.add(head);
  const jaw = reptileCreatureMesh('rr-croc-jaw');
  body.add(jaw);
  const tail = reptileCreatureMesh('rr-croc-tail');
  body.add(tail);
  for (const [x, z] of [
    [-0.62, 0.35],
    [0.62, 0.35],
    [-0.6, -0.4],
    [0.6, -0.4],
  ] as const) {
    const leg = stubLeg(0.13, 0.3, PALETTE.leafDeep);
    leg.position.set(x, 0.15, z);
    leg.rotation.z = x < 0 ? 0.5 : -0.5;
    body.add(leg);
  }
  // Eye domes at the kit's own anchors, in game axes.
  const eyes = new Group();
  body.add(eyes);
  geometryFace(eyes, 0.205, 0.72, 0.72, 0.1);
  wMouth(eyes, 0.46, 1.5, 0.06);

  let yawn = 0;
  let nextYawn = rng.range(18, 30);
  let wave = 0;
  const bob = body.position;
  return {
    root,
    height: visibleBounds(root).top,
    get yawning() {
      return yawn > 0;
    },
    update(dt, elapsed) {
      bob.y = Math.sin(elapsed * 0.3 * Math.PI * 2) * 0.05;
      tail.rotation.y = Math.sin(elapsed * 1.2) * 0.25;
      nextYawn -= dt;
      if (nextYawn <= 0) {
        nextYawn = rng.range(18, 30);
        yawn = 1.2;
      }
      if (yawn > 0) {
        yawn = Math.max(0, yawn - dt);
        const t = yawn / 1.2;
        jaw.rotation.x = Math.sin(t * Math.PI) * 0.5;
      } else jaw.rotation.x = 0;
      if (wave > 0) {
        wave = Math.max(0, wave - dt);
        const leg = body.children[5];
        if (leg) leg.rotation.x = Math.sin(wave * 14) * 0.5;
      }
    },
    poke() {
      yawn = 1.2;
      wave = 1.6;
    },
  };
}

// ---------------------------------------------------------------------------
// Grandpa Tock and the small tortoises
// ---------------------------------------------------------------------------

export interface TortoiseHandle extends ReptileHandle {
  /** The shell, for a baby snake to ride on. */
  readonly shell: Mesh;
  setWalkPhase(phase: number, speed: number): void;
}

export function createTortoise(seed: number, scale = 1): TortoiseHandle {
  const rng = new Rng(seed);
  const root = new Group();
  root.name = 'reptile.tortoise';
  const body = new Group();
  body.scale.setScalar(scale);
  root.add(body);
  const shell = reptileCreatureMesh('rr-tortoise-shell');
  body.add(shell);
  const head = reptileCreatureMesh('rr-tortoise-head');
  const headRest = head.position.clone();
  body.add(head);
  const legs: Mesh[] = [];
  for (const [x, z] of [
    [-0.36, 0.3],
    [0.36, 0.3],
    [-0.36, -0.3],
    [0.36, -0.3],
  ] as const) {
    const leg = stubLeg(0.09, 0.26, ART.biscuitMuzzle);
    leg.position.set(x, 0.13, z);
    body.add(leg);
    legs.push(leg);
  }
  const face = new Group();
  face.position.copy(headRest);
  head.add(face);
  face.position.set(0, 0, 0);
  geometryFace(face, 0.075, 0.14, 0.4, 0.045, true);
  wMouth(face, 0.03, 0.5, 0.025);

  let stretch = 0;
  let blink = rng.range(3, 8);
  let phase = 0;
  let speed = 0;
  return {
    root,
    shell,
    height: visibleBounds(root).top,
    update(dt, elapsed) {
      if (stretch > 0) stretch = Math.max(0, stretch - dt);
      const reach = stretch > 0 ? Math.sin((stretch / 2) * Math.PI) * 0.18 : 0;
      head.position.set(headRest.x, headRest.y + Math.sin(elapsed * 1.5) * 0.01, headRest.z + reach);
      blink -= dt;
      if (blink <= 0) blink = rng.range(3, 8);
      const slowBlink = blink < 0.6 ? 1 - Math.sin((blink / 0.6) * Math.PI) * 0.8 : 1;
      face.scale.y = slowBlink;
      const swing = Math.sin(phase * Math.PI * 2) * 0.5 * speed;
      legs.forEach((leg, index) => {
        leg.rotation.x = index % 3 === 0 ? swing : -swing;
      });
    },
    setWalkPhase(walkPhase, walkSpeed) {
      phase = walkPhase;
      speed = walkSpeed;
    },
    poke() {
      stretch = 2;
    },
  };
}

// ---------------------------------------------------------------------------
// Cammy the chameleon
// ---------------------------------------------------------------------------

const CAMMY_COLOURS = [PALETTE.leafMid, PALETTE.markerMint, PALETTE.blossomPink] as const;
const RAINBOW = [PALETTE.markerPink, PALETTE.markerLemon, PALETTE.markerMint, PALETTE.markerSky, PALETTE.markerLilac] as const;

export function createChameleon(seed: number): ReptileHandle {
  const rng = new Rng(seed);
  const root = new Group();
  root.name = 'reptile.chameleon';
  const bodyMesh = reptileCreatureMesh('rr-chameleon-body');
  root.add(bodyMesh);
  const material = bodyMesh.material as MeshToonMaterial;
  const eyes: Mesh[] = [];
  for (const side of [-1, 1] as const) {
    const eye = solid(new Mesh(EYE, toonMaterial(PALETTE.leafLight)));
    eye.position.set(side * 0.095, 0.3, 0.293);
    eye.scale.setScalar(0.05);
    const pupil = decal(new Mesh(EYE, toonMaterial(ART.ink)));
    pupil.position.set(0, 0, 0.75);
    pupil.scale.set(0.45, 0.5, 0.35);
    eye.add(pupil);
    root.add(eye);
    eyes.push(eye);
  }
  wMouth(root, 0.2, 0.4, 0.02);
  const tongue = solid(new Mesh(new CylinderGeometry(0.012, 0.012, 1, 6), toonMaterial(PALETTE.markerPink)));
  tongue.rotation.x = Math.PI / 2;
  tongue.position.set(0, 0.2, 0.4);
  tongue.scale.set(1, 0.001, 1);
  root.add(tongue);
  const fly = decal(new Mesh(EYE, toonMaterial(ART.ink)));
  fly.scale.setScalar(0.03);
  fly.position.set(0.3, 0.6, 1.1);
  root.add(fly);

  let aim = rng.range(1, 1.5);
  let reaction = 0;
  let zap = 0;
  return {
    root,
    height: visibleBounds(root).top,
    update(dt, elapsed) {
      if (reaction > 0) {
        reaction = Math.max(0, reaction - dt);
        const index = Math.floor(((2 - reaction) / 2) * RAINBOW.length) % RAINBOW.length;
        material.color.setHex(RAINBOW[index] ?? RAINBOW[0]);
        eyes[0]?.lookAt(fly.getWorldPosition(new Vector3()));
        eyes[1]?.lookAt(fly.getWorldPosition(new Vector3()));
      } else {
        const t = (elapsed % 20) / 20;
        const from = CAMMY_COLOURS[Math.floor(t * 3) % 3] ?? CAMMY_COLOURS[0];
        const to = CAMMY_COLOURS[(Math.floor(t * 3) + 1) % 3] ?? CAMMY_COLOURS[0];
        material.color.setHex(from).lerp(SCRATCH_COLOUR.setHex(to), (t * 3) % 1);
        aim -= dt;
        if (aim <= 0) {
          aim = rng.range(1, 1.5);
          for (const eye of eyes) eye.rotation.set(rng.range(-0.5, 0.5), rng.range(-0.7, 0.7), 0);
        }
      }
      if (zap > 0) {
        zap = Math.max(0, zap - dt);
        const length = Math.sin((zap / 0.4) * Math.PI) * 1.2;
        tongue.scale.y = Math.max(0.001, length);
        tongue.position.z = 0.4 + length / 2;
      } else tongue.scale.y = 0.001;
      fly.position.y = 0.6 + Math.sin(elapsed * 7) * 0.05;
    },
    poke() {
      reaction = 2;
      zap = 0.4;
    },
  };
}

// ---------------------------------------------------------------------------
// Frogs, geckos, the skink and the iguanas
// ---------------------------------------------------------------------------

export interface FrogHandle extends ReptileHandle {
  /** Hop to a spot (local metres); the parabola plays out over `update`. */
  hopTo(x: number, y: number, z: number): void;
  readonly hopping: boolean;
}

export function createFrog(seed: number): FrogHandle {
  const rng = new Rng(seed);
  const root = new Group();
  root.name = 'reptile.frog';
  const body = new Group();
  root.add(body);
  body.add(reptileCreatureMesh('rr-frog-body'));
  geometryFace(body, 0.081, 0.2, 0.15, 0.03, false);
  wMouth(body, 0.09, 0.15, 0.018);
  const sac = solid(new Mesh(EYE, toonMaterial(ART.cream)));
  sac.position.set(0, 0.06, 0.12);
  sac.scale.setScalar(0.06);
  body.add(sac);
  for (const side of [-1, 1] as const) {
    const toes = decal(new Mesh(EYE, toonMaterial(PALETTE.flowerRed)));
    toes.position.set(side * 0.14, 0.02, 0.12);
    toes.scale.set(0.05, 0.02, 0.05);
    body.add(toes);
  }
  let croak = rng.range(2, 6);
  let hop = 0;
  const from = new Vector3();
  const to = new Vector3();
  let reaction = 0;
  return {
    root,
    height: visibleBounds(root).top,
    get hopping() {
      return hop > 0;
    },
    hopTo(x, y, z) {
      from.copy(root.position);
      to.set(x, y, z);
      hop = 0.5;
    },
    update(dt, elapsed) {
      croak -= dt;
      if (croak <= 0) croak = rng.range(2, 6);
      const puff = croak < 0.5 || reaction > 0 ? 1 + Math.abs(Math.sin(elapsed * 12)) * 1.2 : 1;
      sac.scale.setScalar(0.06 * puff);
      if (reaction > 0) reaction = Math.max(0, reaction - dt);
      if (hop > 0) {
        hop = Math.max(0, hop - dt);
        const t = 1 - hop / 0.5;
        root.position.lerpVectors(from, to, t);
        root.position.y += Math.sin(t * Math.PI) * 0.4;
        body.scale.set(1 + Math.sin(t * Math.PI) * 0.1, 1 - Math.sin(t * Math.PI) * 0.2, 1);
        root.lookAt(to.x, root.position.y, to.z);
      } else body.scale.set(1, 1, 1);
    },
    poke() {
      reaction = 1.5;
    },
  };
}

export interface GeckoHandle extends ReptileHandle {
  /** Scuttle to a spot (local metres) over 0.4 s. */
  scuttleTo(x: number, y: number, z: number): void;
}

export function createGecko(seed: number): GeckoHandle {
  const root = new Group();
  root.name = 'reptile.gecko';
  root.add(reptileCreatureMesh('rr-gecko-body'));
  geometryFace(root, 0.04, 0.09, 0.08, 0.016, false);
  for (let i = 0; i < 3; i += 1) {
    const spot = decal(new Mesh(BLUSH, toonMaterial(PALETTE.flowerYellow)));
    spot.position.set((i - 1) * 0.04, 0.105, -0.06 - i * 0.03);
    spot.scale.set(0.02, 0.006, 0.02);
    root.add(spot);
  }
  void seed;
  let move = 0;
  const from = new Vector3();
  const to = new Vector3();
  return {
    root,
    height: visibleBounds(root).top,
    scuttleTo(x, y, z) {
      from.copy(root.position);
      to.set(x, y, z);
      move = 0.4;
    },
    update(dt) {
      if (move <= 0) return;
      move = Math.max(0, move - dt);
      root.position.lerpVectors(from, to, 1 - move / 0.4);
    },
    poke() {
      move = 0.4;
      from.copy(root.position);
      to.copy(root.position).add(new Vector3(0.2, 0, 0));
    },
  };
}

export function createSkink(seed: number): ReptileHandle {
  const root = new Group();
  root.name = 'reptile.skink';
  root.add(reptileCreatureMesh('rr-skink-body'));
  geometryFace(root, 0.06, 0.13, 0.36, 0.028);
  const tongue = decal(new Mesh(EYE, toonMaterial(PALETTE.markerSky)));
  tongue.position.set(0, 0.04, 0.45);
  tongue.scale.set(0.05, 0.015, 0.001);
  root.add(tongue);
  let amble = 0;
  let tongueOut = 0;
  void seed;
  return {
    root,
    height: visibleBounds(root).top,
    update(dt, elapsed) {
      amble = Math.sin(elapsed * 0.5) * 0.5;
      root.position.x = amble;
      if (tongueOut > 0) {
        tongueOut = Math.max(0, tongueOut - dt);
        tongue.scale.z = 0.12;
        tongue.position.z = 0.5;
      } else tongue.scale.z = 0.001;
    },
    poke() {
      tongueOut = 0.6;
    },
  };
}

export function createIguana(seed: number): ReptileHandle {
  const rng = new Rng(seed);
  const root = new Group();
  root.name = 'reptile.iguana';
  const body = new Group();
  root.add(body);
  body.add(reptileCreatureMesh('rr-iguana-body'));
  const crest = new Group();
  body.add(crest);
  for (let i = 0; i < 6; i += 1) {
    const spine = solid(new Mesh(EYE, toonMaterial(PALETTE.leafLight)));
    spine.position.set(0, 0.4 - i * 0.02, 0.25 - i * 0.17);
    spine.scale.set(0.02, 0.06, 0.03);
    crest.add(spine);
  }
  geometryFace(body, 0.07, 0.3, 0.47, 0.035);
  let pushUps = rng.range(2, 5);
  let doing = 0;
  return {
    root,
    height: visibleBounds(root).top,
    update(dt, elapsed) {
      pushUps -= dt;
      if (pushUps <= 0) {
        pushUps = 5;
        doing = 1.5;
      }
      if (doing > 0) {
        doing = Math.max(0, doing - dt);
        body.position.y = Math.abs(Math.sin(doing * Math.PI * 2)) * 0.08;
        crest.scale.y = 1 + Math.abs(Math.sin(doing * Math.PI * 2)) * 0.6;
      } else {
        body.position.y = Math.sin(elapsed * 1.3) * 0.005;
        crest.scale.y = 1;
      }
    },
    poke() {
      doing = 1.5;
    },
  };
}

// ---------------------------------------------------------------------------
// The hatchery's eggs
// ---------------------------------------------------------------------------

export interface EggHandle extends ReptileHandle {
  /** Crack open: a hatchling pops its head out. */
  hatch(): void;
}

export function createEgg(seed: number, cracked: boolean): EggHandle {
  const rng = new Rng(seed);
  const root = new Group();
  root.name = 'reptile.egg';
  const shell = solid(new Mesh(EYE, toonMaterial(ART.cream)));
  shell.scale.set(0.14, 0.175, 0.14);
  shell.position.y = 0.17;
  addOutline(shell, 0.012);
  root.add(shell);
  const peeper = new Group();
  peeper.position.set(0, 0.26, 0.04);
  peeper.scale.setScalar(0.001);
  const head = reptileCreatureMesh('rr-snake-head');
  head.scale.setScalar(0.45);
  head.rotation.x = -0.6;
  peeper.add(head);
  root.add(peeper);
  let wobble = rng.range(0, 6);
  let hatched = cracked ? 1 : 0;
  let pop = 0;
  if (cracked) {
    shell.scale.y = 0.12;
    peeper.scale.setScalar(1);
  }
  return {
    root,
    height: visibleBounds(root).top,
    update(dt, elapsed) {
      wobble += dt;
      root.rotation.z = Math.sin(wobble * 4) * (pop > 0 ? 0.25 : 0.1) * (hatched ? 0 : 1);
      if (pop > 0) {
        pop = Math.max(0, pop - dt);
        if (pop < 0.6 && !hatched) {
          hatched = 1;
          shell.scale.y = 0.12;
          peeper.scale.setScalar(1);
        }
      }
      if (hatched) peeper.position.y = 0.26 + Math.sin(elapsed * 3) * 0.015;
    },
    hatch() {
      if (!hatched) pop = 1.2;
    },
    poke() {
      if (!hatched) pop = 1.2;
    },
  };
}

/** The snake head's own length, so a hatchery can space eggs by it. */
export function snakeHeadLength(): number {
  return reptileCreatureBox('rr-snake-head').maxZ;
}
