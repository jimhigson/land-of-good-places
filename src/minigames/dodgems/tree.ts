import {
  CanvasTexture,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DoubleSide,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  Quaternion,
  SRGBColorSpace,
  SphereGeometry,
  Sprite,
  SpriteMaterial,
  Vector3,
} from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { PALETTE, hexToCss } from '../../core/palette';
import { Rng, TAU, clamp01, damp, lerp } from '../../core/mathUtils';
import { addOutline, decal, solid, toonMaterial } from '../../art/style/materials';
import { createFacePatch } from '../../art/style/faces';
import { CAR_RADIUS } from './layout';

/**
 * **The fake wooden tree.** The whole reason the dodgems exist.
 *
 * It stands in the middle of the rink looking like a tree that a very cheerful
 * carpenter made out of planks, and it is the funniest thing in the game.
 * Bonking it fires **all four gags at once**, which is the point — the design
 * doc lists them as one event, not four, and staggering them would turn a
 * firework into a queue:
 *
 * 1. the whole tree **wobbles** about on its base,
 * 2. **apples** bonk down and bounce off the cars,
 * 3. **leaves** rain down over everyone,
 * 4. a surprised **bird** pops out of the top going "TWEET!?".
 *
 * Implementation notes worth keeping:
 *
 * - The apples are real little physics objects, because "an apple bounced off
 *   my car" is only funny if it actually did. They are a fixed pool of eight,
 *   allocated once (ART_DIRECTION.md §5: never `new` a mesh per trigger).
 * - The leaves are one `InstancedMesh` of 90 quads with baked per-instance
 *   colour — one draw call for the entire downpour.
 * - The bird's "TWEET!?" is a `Sprite`, so it faces the camera from every angle
 *   without any billboard maths, and the canvas is drawn once at module level.
 */

const APPLE_COUNT = 8;
const LEAF_CAPACITY = 90;

/** Seconds the bird stays up before sinking back into the canopy, offended. */
const BIRD_UP_SECONDS = 2.9;

const LEAF_COLOURS = [
  PALETTE.leafMid,
  PALETTE.leafLight,
  PALETTE.leafDeep,
  PALETTE.leafBlue,
  PALETTE.flowerYellow,
];

/** A car, as far as a falling apple is concerned. */
export interface AppleTarget {
  readonly x: number;
  readonly z: number;
  /** Shoves the car. The apple is small, so the shove is small — but it is felt. */
  push(dx: number, dz: number, power: number): void;
  /** Called when an apple lands on this car, so the game can giggle about it. */
  onApple(): void;
}

export interface WobblyTree {
  readonly root: Group;
  /**
   * Somebody drove into the tree.
   *
   * `dirX`/`dirZ` is the direction of the wallop (the tree leans away from it),
   * `strength` is 0..1 of a really good clout.
   */
  bonk(dirX: number, dirZ: number, strength: number): void;
  /** True while the bird is out — the HUD uses it to keep the cheer on screen. */
  readonly birdOut: boolean;
  update(dt: number, elapsed: number, cars: readonly AppleTarget[]): void;
  dispose(): void;
}

export function createWobblyTree(): WobblyTree {
  const root = new Group();
  root.name = 'dodgems:tree';
  const rng = new Rng(0x7ee0a9);

  const barkMaterial = toonMaterial(PALETTE.wood);
  const barkDarkMaterial = toonMaterial(PALETTE.woodDark);
  const leafMaterial = toonMaterial(PALETTE.leafMid);
  const leafLightMaterial = toonMaterial(PALETTE.leafLight);
  const appleMaterial = toonMaterial(PALETTE.flowerRed);
  const stalkMaterial = toonMaterial(PALETTE.barkDark);

  // --- the base -------------------------------------------------------------
  // A wide painted plinth. It sells "fairground prop bolted to the floor"
  // rather than "tree that grew through the tarmac", and it gives the wobble
  // something to pivot on that obviously is not roots.
  const plinth = solid(
    new Mesh(new CylinderGeometry(1.85, 2.05, 0.42, 20), toonMaterial(PALETTE.markerLemon)),
  );
  plinth.position.y = 0.21;
  root.add(plinth);
  addOutline(plinth, 0.026);

  const plinthRing = decal(
    new Mesh(new CylinderGeometry(1.9, 1.9, 0.1, 20), toonMaterial(PALETTE.markerPink)),
  );
  plinthRing.position.y = 0.44;
  root.add(plinthRing);

  // `trunkPivot` is what wobbles. Everything above the plinth hangs off it.
  const trunkPivot = new Group();
  trunkPivot.position.y = 0.42;
  root.add(trunkPivot);

  // --- trunk: planks, because it is a FAKE tree ------------------------------
  const trunk = solid(new Mesh(new CylinderGeometry(0.62, 0.82, 3.1, 12), barkMaterial));
  trunk.position.y = 1.55;
  trunkPivot.add(trunk);
  addOutline(trunk, 0.026);

  // Plank seams: four dark slabs stuck to the trunk. Nothing says "carpentry"
  // like a visible joint.
  for (let i = 0; i < 4; i += 1) {
    const angle = (i / 4) * TAU + 0.4;
    const plank = decal(new Mesh(new RoundedBoxGeometry(0.16, 2.9, 0.1, 3, 0.04), barkDarkMaterial));
    plank.position.set(Math.cos(angle) * 0.68, 1.55, Math.sin(angle) * 0.68);
    plank.lookAt(new Vector3(Math.cos(angle) * 4, 1.55, Math.sin(angle) * 4));
    trunkPivot.add(plank);
  }

  // A painted knot-hole with a friendly little door, because a fake tree in a
  // fairground would definitely have one.
  const knot = decal(new Mesh(new SphereGeometry(0.3, 14, 10), barkDarkMaterial));
  knot.scale.set(1, 1.25, 0.35);
  knot.position.set(0, 1.6, 0.72);
  trunkPivot.add(knot);

  // --- canopy ---------------------------------------------------------------
  // `canopyPivot` lags behind the trunk when the tree wobbles, which is the
  // single detail that makes a rigid prop look springy.
  const canopyPivot = new Group();
  canopyPivot.position.y = 3.1;
  trunkPivot.add(canopyPivot);

  const canopyBlobs: Mesh[] = [];
  const blobSpec: [number, number, number, number][] = [
    [0, 0.55, 0, 1.75],
    [-1.25, 0.05, 0.35, 1.2],
    [1.2, 0.15, -0.3, 1.3],
    [0.3, -0.05, 1.2, 1.05],
    [-0.4, 0.15, -1.25, 1.1],
    [0.1, 1.4, 0.1, 1.05],
  ];
  blobSpec.forEach(([x, y, z, radius], index) => {
    const blob = solid(
      new Mesh(new SphereGeometry(radius, 18, 14), index % 2 === 0 ? leafMaterial : leafLightMaterial),
    );
    blob.position.set(x, y, z);
    blob.scale.set(1, 0.88, 1);
    canopyPivot.add(blob);
    if (index < 3) addOutline(blob, 0.03);
    canopyBlobs.push(blob);
  });

  // --- apples ---------------------------------------------------------------
  // Eight of them, hanging in the canopy until they are knocked loose.
  interface Apple {
    readonly mesh: Group;
    readonly home: Vector3;
    falling: boolean;
    x: number;
    y: number;
    z: number;
    vx: number;
    vy: number;
    vz: number;
    life: number;
    spin: number;
  }

  const apples: Apple[] = [];
  const appleGeometry = new SphereGeometry(0.26, 14, 10);
  const stalkGeometry = new CylinderGeometry(0.035, 0.035, 0.2, 6);
  for (let i = 0; i < APPLE_COUNT; i += 1) {
    const angle = (i / APPLE_COUNT) * TAU + 0.3;
    const radius = rng.range(1.1, 1.75);
    const group = new Group();
    const apple = solid(new Mesh(appleGeometry, appleMaterial));
    apple.scale.set(1, 0.92, 1);
    group.add(apple);
    addOutline(apple, 0.018);
    const stalk = decal(new Mesh(stalkGeometry, stalkMaterial));
    stalk.position.y = 0.28;
    stalk.rotation.z = 0.3;
    group.add(stalk);
    const leaf = decal(new Mesh(new ConeGeometry(0.09, 0.2, 3), leafLightMaterial));
    leaf.position.set(0.1, 0.34, 0);
    leaf.rotation.z = -1.1;
    group.add(leaf);

    const home = new Vector3(
      Math.cos(angle) * radius,
      rng.range(-0.35, 0.6),
      Math.sin(angle) * radius,
    );
    group.position.copy(home);
    canopyPivot.add(group);

    apples.push({
      mesh: group,
      home,
      falling: false,
      x: 0,
      y: 0,
      z: 0,
      vx: 0,
      vy: 0,
      vz: 0,
      life: 0,
      spin: 0,
    });
  }

  // --- leaves ---------------------------------------------------------------
  interface Leaf {
    x: number;
    y: number;
    z: number;
    vx: number;
    vy: number;
    vz: number;
    angle: number;
    spin: number;
    life: number;
    ttl: number;
    size: number;
  }

  const leafGeometry = new PlaneGeometry(0.26, 0.34);
  const leafParticleMaterial = new MeshBasicMaterial({ side: DoubleSide, toneMapped: false });
  const leafMesh = new InstancedMesh(leafGeometry, leafParticleMaterial, LEAF_CAPACITY);
  leafMesh.frustumCulled = false;
  leafMesh.count = 0;
  root.add(leafMesh);

  const leaves: Leaf[] = [];
  const leafMatrix = new Matrix4();
  const leafPosition = new Vector3();
  const leafQuaternion = new Quaternion();
  const leafScale = new Vector3();
  const leafAxis = new Vector3(0.4, 0.7, 0.6).normalize();
  const leafColour = new Color();

  // --- the bird -------------------------------------------------------------
  const bird = createBird();
  // Parked down inside the canopy, out of sight, until it is startled.
  const birdHome = 0.4;
  bird.root.position.set(0.15, birdHome, 0.1);
  canopyPivot.add(bird.root);
  bird.root.visible = false;

  const bubbleTexture = tweetTexture();
  const bubbleMaterial = new SpriteMaterial({
    map: bubbleTexture,
    transparent: true,
    depthWrite: false,
    toneMapped: false,
  });
  const bubble = new Sprite(bubbleMaterial);
  bubble.scale.set(2.3, 1.5, 1);
  bubble.position.set(1.25, 1.5, 0);
  bubble.visible = false;
  bird.root.add(bubble);

  // --- state ----------------------------------------------------------------
  let wobble = 0;
  let wobbleX = 0;
  let wobbleZ = 0;
  let wobblePhase = 0;
  let birdTimer = 0;
  let birdHeight = 0;

  function dropApples(strength: number): void {
    let dropped = 0;
    const wanted = 3 + Math.round(strength * 3);
    for (const apple of apples) {
      if (apple.falling || dropped >= wanted) continue;
      dropped += 1;
      apple.falling = true;
      apple.life = 0;
      apple.spin = rng.range(-7, 7);
      // Positions are kept in TREE-LOCAL space (the tree sits at the rink's
      // centre, so local and world agree in X/Z) and the mesh is re-parented to
      // the root, out from under the wobbling canopy.
      const world = apple.mesh.getWorldPosition(new Vector3());
      root.worldToLocal(world);
      apple.x = world.x;
      apple.y = world.y;
      apple.z = world.z;
      const fling = rng.range(1.6, 4.2) * (0.5 + strength);
      const angle = rng.range(0, TAU);
      apple.vx = Math.cos(angle) * fling;
      apple.vz = Math.sin(angle) * fling;
      apple.vy = rng.range(0.4, 2.2);
      root.add(apple.mesh);
      apple.mesh.position.set(apple.x, apple.y, apple.z);
    }
  }

  function rainLeaves(strength: number): void {
    const count = Math.round(lerp(18, 42, clamp01(strength)));
    for (let i = 0; i < count; i += 1) {
      if (leaves.length >= LEAF_CAPACITY) break;
      const angle = rng.range(0, TAU);
      const radius = rng.range(0.2, 2.3);
      leaves.push({
        x: Math.cos(angle) * radius,
        y: rng.range(3.4, 5.6),
        z: Math.sin(angle) * radius,
        vx: Math.cos(angle) * rng.range(0.4, 2.4),
        vy: rng.range(0.6, 2.4),
        vz: Math.sin(angle) * rng.range(0.4, 2.4),
        angle: rng.range(0, TAU),
        spin: rng.range(-5, 5),
        life: 0,
        ttl: rng.range(2.6, 4.4),
        size: rng.range(0.7, 1.5),
      });
      leafColour.setHex(rng.pick(LEAF_COLOURS));
      leafMesh.setColorAt(leaves.length - 1, leafColour);
    }
    if (leafMesh.instanceColor) leafMesh.instanceColor.needsUpdate = true;
  }

  return {
    root,

    get birdOut(): boolean {
      return birdTimer > 0;
    },

    bonk(dirX: number, dirZ: number, strength: number): void {
      const power = clamp01(strength);
      // A second bonk while the tree is still going tops the wobble up rather
      // than restarting it, so a child who rams it four times running gets one
      // long glorious wobble instead of four stutters.
      wobble = Math.min(1.4, wobble + 0.55 + power * 0.7);
      const length = Math.hypot(dirX, dirZ) || 1;
      wobbleX = dirX / length;
      wobbleZ = dirZ / length;
      wobblePhase = 0;

      dropApples(power);
      rainLeaves(power);

      // The bird. Startled awake every single time — a bird that got used to it
      // would not be funny.
      birdTimer = BIRD_UP_SECONDS;
      bird.root.visible = true;
      bird.setExpression('surprised');
      bubble.visible = true;
      bubbleMaterial.opacity = 1;
    },

    update(dt: number, elapsed: number, cars: readonly AppleTarget[]): void {
      // --- wobble ---------------------------------------------------------
      if (wobble > 0) {
        wobble = Math.max(0, wobble - dt * 0.62);
        wobblePhase += dt;
        const swing = Math.sin(wobblePhase * 11) * wobble * 0.2;
        trunkPivot.rotation.x = wobbleZ * swing;
        trunkPivot.rotation.z = -wobbleX * swing;
        // The canopy lags a fifth of a wobble behind the trunk and swings
        // further, like a heavy head on a springy neck.
        const lag = Math.sin(wobblePhase * 11 - 0.9) * wobble * 0.16;
        canopyPivot.rotation.x = wobbleZ * lag;
        canopyPivot.rotation.z = -wobbleX * lag;
        canopyPivot.scale.setScalar(1 + Math.sin(wobblePhase * 13) * wobble * 0.05);
      } else if (trunkPivot.rotation.x !== 0 || trunkPivot.rotation.z !== 0) {
        trunkPivot.rotation.set(0, 0, 0);
        canopyPivot.rotation.set(0, 0, 0);
        canopyPivot.scale.setScalar(1);
      }

      // A permanent, tiny breeze so the tree is never completely still.
      canopyPivot.rotation.y = Math.sin(elapsed * 0.9) * 0.05;

      // --- apples ---------------------------------------------------------
      for (const apple of apples) {
        if (!apple.falling) continue;
        apple.life += dt;
        apple.vy -= 15 * dt;
        apple.x += apple.vx * dt;
        apple.y += apple.vy * dt;
        apple.z += apple.vz * dt;

        // Bounce off the cars. This is the gag: an apple that lands on a
        // dodgem should ping off it and make the driver squeak.
        if (apple.y < 1.5 && apple.y > 0.1 && apple.vy < 0) {
          for (const car of cars) {
            const dx = apple.x - car.x;
            const dz = apple.z - car.z;
            const distance = Math.hypot(dx, dz);
            if (distance > CAR_RADIUS + 0.3) continue;
            apple.vy = Math.abs(apple.vy) * 0.62 + 2.2;
            const away = distance || 1;
            apple.vx += (dx / away) * 2.4;
            apple.vz += (dz / away) * 2.4;
            car.push(-dx / away, -dz / away, 0.5);
            car.onApple();
            break;
          }
        }

        // …and off the floor, twice, before rolling to a stop.
        if (apple.y < 0.26) {
          apple.y = 0.26;
          if (apple.vy < -0.6) {
            apple.vy = -apple.vy * 0.45;
            apple.vx *= 0.7;
            apple.vz *= 0.7;
          } else {
            apple.vy = 0;
            apple.vx *= 0.9;
            apple.vz *= 0.9;
          }
        }

        apple.mesh.position.set(apple.x, apple.y, apple.z);
        apple.mesh.rotation.z += apple.spin * dt;

        // Back up into the canopy after a while, so the tree never runs out of
        // apples and nobody has to watch a bald tree.
        if (apple.life > 6) {
          apple.falling = false;
          canopyPivot.add(apple.mesh);
          apple.mesh.position.copy(apple.home);
          apple.mesh.rotation.set(0, 0, 0);
          apple.mesh.scale.setScalar(1);
        } else if (apple.life > 5) {
          apple.mesh.scale.setScalar(1 - (apple.life - 5));
        }
      }

      // --- leaves ---------------------------------------------------------
      for (let i = leaves.length - 1; i >= 0; i -= 1) {
        const leaf = leaves[i];
        if (!leaf) continue;
        leaf.life += dt;
        if (leaf.life >= leaf.ttl || leaf.y < 0.02) {
          const last = leaves[leaves.length - 1];
          if (last && last !== leaf) {
            leaves[i] = last;
            leafMesh.getColorAt(leaves.length - 1, leafColour);
            leafMesh.setColorAt(i, leafColour);
          }
          leaves.pop();
          continue;
        }
        // Leaves fall slowly and swing side to side: gravity, heavy drag, and a
        // sideways drift that reverses with the spin.
        leaf.vy = damp(leaf.vy, -1.35, 0.5, dt);
        leaf.vx += Math.sin(leaf.angle) * 2.4 * dt;
        leaf.vz += Math.cos(leaf.angle * 0.7) * 1.8 * dt;
        leaf.vx *= 0.98;
        leaf.vz *= 0.98;
        leaf.x += leaf.vx * dt;
        leaf.y += leaf.vy * dt;
        leaf.z += leaf.vz * dt;
        leaf.angle += leaf.spin * dt;
      }

      leafMesh.count = leaves.length;
      for (let i = 0; i < leaves.length; i += 1) {
        const leaf = leaves[i];
        if (!leaf) continue;
        // Hold, then fade on a curve — a linear fade reads as being switched off.
        const fade = 1 - Math.max(0, leaf.life / leaf.ttl - 0.72) / 0.28;
        leafPosition.set(leaf.x, leaf.y, leaf.z);
        leafQuaternion.setFromAxisAngle(leafAxis, leaf.angle);
        leafScale.setScalar(leaf.size * fade);
        leafMatrix.compose(leafPosition, leafQuaternion, leafScale);
        leafMesh.setMatrixAt(i, leafMatrix);
      }
      leafMesh.instanceMatrix.needsUpdate = true;
      if (leafMesh.instanceColor) leafMesh.instanceColor.needsUpdate = true;

      // --- the bird -------------------------------------------------------
      if (birdTimer > 0) {
        birdTimer = Math.max(0, birdTimer - dt);
        // Pops up fast, hovers, drops back. The pop overshoots — it is a
        // startled bird, not a lift.
        const up = BIRD_UP_SECONDS - birdTimer;
        const rise = up < 0.35 ? Math.sin((up / 0.35) * 1.9) * 1.14 : 1;
        birdHeight = damp(birdHeight, birdTimer > 0.5 ? rise : 0, 0.09, dt);
        bird.root.position.y = birdHome + birdHeight * 2.4;
        bird.root.rotation.y = Math.sin(elapsed * 7) * 0.55;
        bird.flap(elapsed);
        bubble.position.y = 1.4 + Math.sin(elapsed * 8) * 0.06;
        bubbleMaterial.opacity = clamp01(birdTimer * 1.6);
        if (birdTimer === 0) {
          bird.root.visible = false;
          bubble.visible = false;
          bird.setExpression('happy');
        }
      }
    },

    dispose(): void {
      leafGeometry.dispose();
      leafParticleMaterial.dispose();
      leafMesh.dispose();
      appleGeometry.dispose();
      stalkGeometry.dispose();
      // The bubble texture is module-cached and shared with the next visit, so
      // it is deliberately NOT disposed here — only its material is.
      bubbleMaterial.dispose();
      bird.dispose();
      barkMaterial.dispose();
      barkDarkMaterial.dispose();
      leafMaterial.dispose();
      leafLightMaterial.dispose();
      appleMaterial.dispose();
      stalkMaterial.dispose();
      root.traverse((object) => {
        const mesh = object as Partial<Mesh>;
        mesh.geometry?.dispose();
      });
      canopyBlobs.length = 0;
    },
  };
}

// ------------------------------------------------------------------- the bird

interface Bird {
  readonly root: Group;
  flap(elapsed: number): void;
  setExpression(expression: 'happy' | 'surprised'): void;
  dispose(): void;
}

/**
 * A very small, very surprised bird.
 *
 * Built to the same rules as everything else in the park: painted face on a
 * patch, round everything, no colour that is not in the palette.
 */
function createBird(): Bird {
  const root = new Group();
  root.name = 'dodgems:bird';

  const featherMaterial = toonMaterial(PALETTE.markerSky);
  const bellyMaterial = toonMaterial(PALETTE.blossomWhite);
  const beakMaterial = toonMaterial(PALETTE.flowerYellow);

  const bodyMesh = solid(new Mesh(new SphereGeometry(0.34, 16, 12), featherMaterial));
  bodyMesh.scale.set(1, 0.92, 0.94);
  root.add(bodyMesh);
  addOutline(bodyMesh, 0.018);

  const belly = decal(new Mesh(new SphereGeometry(0.24, 14, 10), bellyMaterial));
  belly.scale.set(0.9, 0.85, 0.5);
  belly.position.set(0, -0.06, 0.19);
  root.add(belly);

  const beak = decal(new Mesh(new ConeGeometry(0.075, 0.2, 8), beakMaterial));
  beak.rotation.x = Math.PI / 2;
  beak.position.set(0, 0.02, 0.36);
  root.add(beak);

  const tail = decal(new Mesh(new ConeGeometry(0.16, 0.34, 3), featherMaterial));
  tail.rotation.x = -1.3;
  tail.position.set(0, 0.02, -0.36);
  root.add(tail);

  const wings: Mesh[] = [];
  for (const side of [-1, 1] as const) {
    const wing = decal(new Mesh(new SphereGeometry(0.2, 12, 8), featherMaterial));
    wing.scale.set(0.34, 0.9, 1.15);
    wing.position.set(side * 0.3, 0.02, -0.02);
    root.add(wing);
    wings.push(wing);
  }

  // A single startled feather sticking straight up. Half the joke.
  const crest = decal(new Mesh(new ConeGeometry(0.05, 0.28, 5), featherMaterial));
  crest.position.set(0, 0.36, -0.04);
  crest.rotation.z = 0.3;
  root.add(crest);

  const face = createFacePatch({
    radius: 0.34,
    size: 256,
    spreadX: 1.9,
    spreadY: 1.8,
    tilt: 0.02,
    eyeY: 0.44,
    eyeGap: 0.5,
    eyeW: 0.12,
    eyeH: 0.16,
    eyeStyle: 'wide',
    mouth: 'none',
    blush: PALETTE.cheek,
    blushStyle: 'soft',
    blushR: 0.09,
    brows: true,
  });
  face.mesh.position.z = 0.02;
  root.add(face.mesh);

  return {
    root,
    flap(elapsed: number): void {
      const beat = Math.sin(elapsed * 26);
      const left = wings[0];
      const right = wings[1];
      if (left) left.rotation.z = -0.5 - beat * 0.8;
      if (right) right.rotation.z = 0.5 + beat * 0.8;
      crest.rotation.z = 0.3 + beat * 0.25;
    },
    setExpression(expression: 'happy' | 'surprised'): void {
      face.setExpression(expression);
    },
    dispose(): void {
      featherMaterial.dispose();
      bellyMaterial.dispose();
      beakMaterial.dispose();
      root.traverse((object) => {
        const mesh = object as Partial<Mesh>;
        mesh.geometry?.dispose();
      });
    },
  };
}

// -------------------------------------------------------------- speech bubble

let tweetTextureCache: CanvasTexture | null = null;

/**
 * The "TWEET!?" bubble.
 *
 * Drawn once and shared, like everything else in `core/textures.ts` — it lives
 * here rather than there only because it belongs to nothing but this tree.
 */
function tweetTexture(): CanvasTexture {
  if (tweetTextureCache) return tweetTextureCache;

  const width = 512;
  const height = 320;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas context unavailable — cannot draw the bird.');

  const cx = width / 2;
  const cy = height * 0.42;

  // A wobbly cartoon burst rather than a tidy oval: this is a shout, not a
  // thought.
  ctx.save();
  ctx.translate(cx, cy);
  ctx.beginPath();
  const points = 14;
  for (let i = 0; i <= points; i += 1) {
    const angle = (i / points) * Math.PI * 2;
    const spike = i % 2 === 0 ? 1 : 0.82;
    ctx.lineTo(Math.cos(angle) * 226 * spike, Math.sin(angle) * 128 * spike);
  }
  ctx.closePath();
  ctx.fillStyle = '#fff6ea';
  ctx.fill();
  ctx.strokeStyle = hexToCss(PALETTE.ink);
  ctx.lineWidth = 9;
  ctx.lineJoin = 'round';
  ctx.stroke();
  ctx.restore();

  // The tail, pointing down-left towards the bird's beak.
  ctx.beginPath();
  ctx.moveTo(cx - 96, cy + 96);
  ctx.lineTo(cx - 176, cy + 158);
  ctx.lineTo(cx - 40, cy + 112);
  ctx.closePath();
  ctx.fillStyle = '#fff6ea';
  ctx.fill();
  ctx.stroke();

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = 'bold 96px "Trebuchet MS", "Segoe UI", sans-serif';
  ctx.fillStyle = hexToCss(PALETTE.markerSky);
  ctx.strokeStyle = hexToCss(PALETTE.ink);
  ctx.lineWidth = 7;
  ctx.strokeText('TWEET!?', cx, cy);
  ctx.fillText('TWEET!?', cx, cy);

  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.anisotropy = 4;
  texture.needsUpdate = true;
  tweetTextureCache = texture;
  return texture;
}
