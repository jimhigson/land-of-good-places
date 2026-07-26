import {
  CanvasTexture,
  Color,
  Group,
  InstancedMesh,
  Matrix4,
  MeshBasicMaterial,
  PlaneGeometry,
  Quaternion,
  RingGeometry,
  SRGBColorSpace,
  Vector3,
} from 'three';
import { PALETTE, hexToCss } from '../../core/palette';
import { Rng, clamp01 } from '../../core/mathUtils';

/**
 * All the water in the water fight: flying droplets, ground splashes, and the
 * running count of how much of it is in the air.
 *
 * **This is the one place the park allows billboard sprites.** ART_DIRECTION
 * reserves them for particles, and water is the reason that exception exists: a
 * squirt is a few hundred droplets a frame, and a droplet modelled as a sphere
 * would cost geometry, shading and a shadow for something on screen for four
 * hundred milliseconds. Every droplet here is one instance of a single
 * camera-facing quad with a painted highlight on it, so the whole fight — six
 * children squirting at once — is **two draw calls**.
 *
 * Three rules this file will not break:
 *
 * - **Nothing is allocated after construction.** The droplet pool, the ring
 *   pool and every scratch vector are built once. A garden that garbage-collects
 *   mid-squirt stutters exactly when a child is watching most closely.
 * - **Droplets are dumb.** They are position, velocity, life. They do not know
 *   what they hit; hits are decided by the shot that spawned them (see
 *   `WaterFight.ts`), because a hit that depends on which particle happened to
 *   land is a hit a child cannot predict.
 * - **Water is pigment, not light.** Normal blending, never additive — the same
 *   call `art/effects/rainbowRing.ts` made, and for the same reason: additive
 *   water blows out to a white smear the moment two squirts cross.
 */

/** Droplets alive at once. Six children squirting hard peaks at about 500. */
const DROPLET_CAPACITY = 900;

/** Expanding ground rings alive at once. */
const RING_CAPACITY = 22;

/** Gravity for droplets, m/s². Under real gravity the arcs read as gravel. */
const GRAVITY = 15.5;

/** Ground level in the garden. Droplets die here. */
const GROUND_Y = 0.02;

/**
 * How many droplets in the air count as "lots of water flying".
 *
 * This is the number the rainbow hangs off (GAME_DESIGN: *"when lots of water
 * flies, a little rainbow appears"*). Tuned so that one child squirting alone
 * never quite gets there, two at the same time just about do, and a proper
 * free-for-all pins it — the rainbow has to feel like a reward for the fight
 * getting bigger, not like weather.
 */
const DENSITY_FULL = 190;

/** Half-life of the air-wetness reading, in seconds. */
const DENSITY_HALF_LIFE = 0.75;

/** Seconds a ground ring takes to spread out and vanish. */
const RING_LIFE = 0.5;

interface Droplet {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  life: number;
  ttl: number;
  size: number;
  /** Droplets thrown up by a splash fall slower — they are foam, not water. */
  drag: number;
}

export interface WaterSystem {
  readonly root: Group;
  /**
   * How much water is in the air, 0..1+.
   *
   * A smoothed count of live droplets rather than an instantaneous one, so the
   * rainbow does not flicker between two squirts.
   */
  readonly density: number;
  /** A puff of spray trailing a shot in flight. */
  trail(x: number, y: number, z: number, vx: number, vy: number, vz: number, power: number): void;
  /** The moment a squirt lands: droplets everywhere and a ring on the ground. */
  splash(x: number, y: number, z: number, power: number): void;
  /** The gentle fan of a garden sprinkler. */
  mist(x: number, y: number, z: number, angle: number): void;
  /** The muzzle burst as a very big water gun goes off. */
  muzzle(x: number, y: number, z: number, dx: number, dy: number, dz: number, power: number): void;
  update(dt: number, cameraQuaternion: Quaternion): void;
  dispose(): void;
}

export function createWaterSystem(): WaterSystem {
  const root = new Group();
  root.name = 'waterfight:water';

  // --- the droplet pool -----------------------------------------------------
  const dropletTexture = paintDroplet();
  const dropletMaterial = new MeshBasicMaterial({
    map: dropletTexture,
    transparent: true,
    depthWrite: false,
    toneMapped: false,
  });
  const dropletGeometry = new PlaneGeometry(1, 1);
  const droplets = new InstancedMesh(dropletGeometry, dropletMaterial, DROPLET_CAPACITY);
  droplets.frustumCulled = false;
  droplets.count = 0;
  droplets.renderOrder = 6;
  root.add(droplets);

  // --- the ground rings -----------------------------------------------------
  const ringGeometry = new RingGeometry(0.45, 1, 26, 1);
  const ringMaterial = new MeshBasicMaterial({
    color: PALETTE.waterFoam,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    toneMapped: false,
  });
  const rings = new InstancedMesh(ringGeometry, ringMaterial, RING_CAPACITY);
  rings.frustumCulled = false;
  rings.count = RING_CAPACITY;
  rings.renderOrder = 5;
  root.add(rings);

  // Pools, built once and never grown. `alive` is the high-water mark inside
  // each array; everything past it is a dead particle waiting to be reused.
  const pool: Droplet[] = [];
  for (let i = 0; i < DROPLET_CAPACITY; i += 1) {
    pool.push({ x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, life: 0, ttl: 0, size: 1, drag: 0 });
  }
  let alive = 0;

  const ringAge: number[] = [];
  const ringRadius: number[] = [];
  const ringX: number[] = [];
  const ringZ: number[] = [];
  for (let i = 0; i < RING_CAPACITY; i += 1) {
    ringAge.push(RING_LIFE);
    ringRadius.push(1);
    ringX.push(0);
    ringZ.push(0);
  }
  let nextRing = 0;

  const rng = new Rng(0x5a1a5b);
  const matrix = new Matrix4();
  const position = new Vector3();
  const scale = new Vector3();
  const ringQuaternion = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), -Math.PI / 2);
  const tint = new Color();

  /** Droplets that landed since the last ring — every sixth one leaves a mark. */
  let landings = 0;
  let densityValue = 0;
  /** Droplets spawned this frame, which is what feeds the air-wetness reading. */
  let spawnedThisFrame = 0;

  function spawn(
    x: number,
    y: number,
    z: number,
    vx: number,
    vy: number,
    vz: number,
    size: number,
    ttl: number,
    drag: number,
  ): void {
    if (alive >= DROPLET_CAPACITY) return;
    const droplet = pool[alive];
    if (!droplet) return;
    alive += 1;
    spawnedThisFrame += 1;
    droplet.x = x;
    droplet.y = y;
    droplet.z = z;
    droplet.vx = vx;
    droplet.vy = vy;
    droplet.vz = vz;
    droplet.life = 0;
    droplet.ttl = ttl;
    droplet.size = size;
    droplet.drag = drag;
    // Every droplet is a slightly different water colour — a squirt painted in
    // one flat blue reads as a ribbon rather than as a spray.
    tint.setHex(rng.chance(0.3) ? PALETTE.waterFoam : rng.chance(0.5) ? PALETTE.waterTop : PALETTE.waterDeep);
    droplets.setColorAt(alive - 1, tint);
  }

  function ring(x: number, z: number, radius: number): void {
    const index = nextRing;
    nextRing = (nextRing + 1) % RING_CAPACITY;
    ringAge[index] = 0;
    ringRadius[index] = radius;
    ringX[index] = x;
    ringZ[index] = z;
  }

  return {
    root,

    get density(): number {
      return densityValue;
    },

    trail(x, y, z, vx, vy, vz, power): void {
      const count = 2 + Math.round(power * 4);
      for (let i = 0; i < count; i += 1) {
        // Fanned around the direction of travel and slowed a little, so the
        // stream frays behind the shot into a proper arc of water rather than
        // a line of dots.
        spawn(
          x + rng.range(-0.07, 0.07),
          y + rng.range(-0.07, 0.07),
          z + rng.range(-0.07, 0.07),
          vx * 0.34 + rng.range(-1.5, 1.5),
          vy * 0.34 + rng.range(-0.6, 1.2),
          vz * 0.34 + rng.range(-1.5, 1.5),
          rng.range(0.1, 0.2) * (0.7 + power * 0.6),
          rng.range(0.35, 0.75),
          0.6,
        );
      }
    },

    splash(x, y, z, power): void {
      const count = 16 + Math.round(power * 34);
      for (let i = 0; i < count; i += 1) {
        const angle = rng.range(0, Math.PI * 2);
        const speed = rng.range(1.4, 5.4) * (0.6 + power * 0.8);
        spawn(
          x,
          y,
          z,
          Math.cos(angle) * speed,
          rng.range(2.2, 6.5) * (0.6 + power * 0.7),
          Math.sin(angle) * speed,
          rng.range(0.13, 0.3) * (0.8 + power * 0.5),
          rng.range(0.5, 1.05),
          1.1,
        );
      }
      ring(x, z, 0.7 + power * 1.3);
    },

    mist(x, y, z, angle): void {
      const speed = rng.range(2.4, 4.2);
      spawn(
        x,
        y,
        z,
        Math.cos(angle) * speed,
        rng.range(2.6, 3.8),
        Math.sin(angle) * speed,
        rng.range(0.07, 0.13),
        rng.range(0.7, 1.1),
        0.5,
      );
    },

    muzzle(x, y, z, dx, dy, dz, power): void {
      const count = 6 + Math.round(power * 14);
      for (let i = 0; i < count; i += 1) {
        spawn(
          x,
          y,
          z,
          dx * rng.range(0.2, 0.5) + rng.range(-1.1, 1.1),
          dy * rng.range(0.2, 0.5) + rng.range(0.2, 1.8),
          dz * rng.range(0.2, 0.5) + rng.range(-1.1, 1.1),
          rng.range(0.1, 0.24) * (0.8 + power * 0.6),
          rng.range(0.22, 0.5),
          0.9,
        );
      }
    },

    update(dt: number, cameraQuaternion: Quaternion): void {
      // --- droplets ---------------------------------------------------------
      for (let i = alive - 1; i >= 0; i -= 1) {
        const droplet = pool[i];
        if (!droplet) continue;
        droplet.life += dt;
        droplet.vy -= GRAVITY * dt;
        const slow = 1 - droplet.drag * dt;
        droplet.vx *= slow;
        droplet.vz *= slow;
        droplet.x += droplet.vx * dt;
        droplet.y += droplet.vy * dt;
        droplet.z += droplet.vz * dt;

        const landed = droplet.y <= GROUND_Y && droplet.vy < 0;
        if (landed) {
          landings += 1;
          // Only every sixth landing leaves a mark. Any more and the lawn is
          // solid white rings; any fewer and a squirt lands without a trace.
          if (landings % 6 === 0) ring(droplet.x, droplet.z, 0.28);
        }

        if (droplet.life >= droplet.ttl || landed) {
          // Swap-remove, colour and all, so the live range stays contiguous.
          const last = pool[alive - 1];
          if (last && last !== droplet) {
            pool[i] = last;
            pool[alive - 1] = droplet;
            droplets.getColorAt(alive - 1, tint);
            droplets.setColorAt(i, tint);
          }
          alive -= 1;
        }
      }

      droplets.count = alive;
      for (let i = 0; i < alive; i += 1) {
        const droplet = pool[i];
        if (!droplet) continue;
        const t = droplet.life / droplet.ttl;
        // Stretched slightly along the fall and shrinking as it goes: a droplet
        // that keeps its size to the last frame pops out of existence.
        const fade = t > 0.6 ? 1 - (t - 0.6) / 0.4 : 1;
        position.set(droplet.x, droplet.y, droplet.z);
        scale.set(droplet.size * fade, droplet.size * fade * 1.35, 1);
        matrix.compose(position, cameraQuaternion, scale);
        droplets.setMatrixAt(i, matrix);
      }
      droplets.instanceMatrix.needsUpdate = true;
      if (droplets.instanceColor) droplets.instanceColor.needsUpdate = true;

      // --- ground rings -----------------------------------------------------
      let ringsLive = false;
      for (let i = 0; i < RING_CAPACITY; i += 1) {
        const age = (ringAge[i] ?? RING_LIFE) + dt;
        ringAge[i] = age;
        if (age >= RING_LIFE) {
          scale.setScalar(0);
          position.set(0, -50, 0);
          matrix.compose(position, ringQuaternion, scale);
          rings.setMatrixAt(i, matrix);
          continue;
        }
        ringsLive = true;
        const t = age / RING_LIFE;
        const spread = (ringRadius[i] ?? 1) * (0.35 + t * 1.15);
        position.set(ringX[i] ?? 0, GROUND_Y + 0.03, ringZ[i] ?? 0);
        scale.set(spread, spread, 1);
        matrix.compose(position, ringQuaternion, scale);
        rings.setMatrixAt(i, matrix);
      }
      rings.instanceMatrix.needsUpdate = true;
      // One material for all the rings, so they share a fade. They are born
      // within a few frames of each other in practice, and the alternative is
      // twenty-two materials for a puddle mark.
      ringMaterial.opacity = ringsLive ? 0.42 : 0;
      rings.visible = ringsLive;

      // --- how wet is the air? ----------------------------------------------
      const target = clamp01(spawnedThisFrame / (DENSITY_FULL * Math.max(dt, 1 / 120)));
      spawnedThisFrame = 0;
      // Rises fast, falls slowly: the rainbow should appear the instant the
      // fight gets big and then linger for a moment after it calms down.
      const rate = target > densityValue ? 0.12 : DENSITY_HALF_LIFE;
      densityValue = target + (densityValue - target) * Math.pow(2, -dt / rate);
    },

    dispose(): void {
      dropletGeometry.dispose();
      dropletMaterial.dispose();
      dropletTexture.dispose();
      droplets.dispose();
      ringGeometry.dispose();
      ringMaterial.dispose();
      rings.dispose();
    },
  };
}

// ------------------------------------------------------------------ internals

/**
 * One painted droplet: a soft blob with a highlight up and to the left.
 *
 * A plain radial gradient looked like fog. The highlight is what makes a
 * sixty-pixel quad read as a bead of water — it is the same trick the eye
 * catchlights in `art/style/faces.ts` use, at a tenth of the size.
 */
function paintDroplet(): CanvasTexture {
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas context unavailable — cannot paint a droplet.');

  const body = ctx.createRadialGradient(size * 0.5, size * 0.5, 0, size * 0.5, size * 0.5, size * 0.5);
  body.addColorStop(0, 'rgba(255,255,255,1)');
  body.addColorStop(0.45, `${hexToCss(PALETTE.waterTop)}f0`);
  body.addColorStop(0.82, `${hexToCss(PALETTE.waterDeep)}7a`);
  body.addColorStop(1, `${hexToCss(PALETTE.waterDeep)}00`);
  ctx.fillStyle = body;
  ctx.fillRect(0, 0, size, size);

  const shine = ctx.createRadialGradient(size * 0.37, size * 0.34, 0, size * 0.37, size * 0.34, size * 0.2);
  shine.addColorStop(0, 'rgba(255,255,255,0.95)');
  shine.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = shine;
  ctx.fillRect(0, 0, size, size);

  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  return texture;
}
