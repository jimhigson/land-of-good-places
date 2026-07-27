import {
  BufferAttribute,
  Color,
  Group,
  Mesh,
  MeshBasicMaterial,
  RingGeometry,
} from 'three';
import { ART } from '../style/artPalette';
import { decal } from '../style/materials';

/**
 * The rainbow hop ring.
 *
 * Eleri asked for a rainbow when you jump. This is that: a flat ring that flicks
 * out from under the character's feet, grows, rises a little and fades — the
 * whole thing over in six-tenths of a second, which is about how long the hop
 * itself lasts.
 *
 * Three decisions worth knowing about before you change it:
 *
 *  - **The rainbow is baked into the geometry, not a shader.** One `RingGeometry`
 *    gets a per-vertex colour ramp across its width, so the bands cost nothing at
 *    all to draw and the effect needs no custom material, no uniforms and no
 *    shader to keep in sync with the rest of the park's lighting.
 *  - **`MeshBasicMaterial` on purpose.** ART_DIRECTION forbids it on anything
 *    *solid*, because a matte painted toy must shade. This is not solid: it is
 *    an effect, and toon-banding a rainbow would drop a shadow across it.
 *  - **Nothing is allocated while the game is running.** The rings are a fixed
 *    pool built once at construction; a burst reuses the oldest. Effects that
 *    `new` a mesh per trigger are how a cosy park starts stuttering when a
 *    six-year-old holds down the jump button.
 */

/** Rings alive at once. A hop lasts ~0.7 s, so four covers frantic bouncing. */
const POOL_SIZE = 4;

/** Seconds from flick-out to gone. */
const LIFETIME = 0.62;

/** Ring radius in metres at birth and at death. */
const START_RADIUS = 0.3;
const END_RADIUS = 2.35;

/** How far the ring floats up over its life, in metres. */
const RISE = 0.34;

/** Clearance above the ground, so the ring does not z-fight with the grass. */
const GROUND_CLEARANCE = 0.06;

export interface RainbowRings {
  /** Parent this in **world space** — the rings must not follow the player. */
  readonly root: Group;
  /**
   * Fires a ring centred on a point, in the coordinates of `root`'s parent.
   * `strength` scales peak opacity (1 = the usual hop rainbow) — the
   * wall-clearing poof reuses this pool at a lower strength so it reads as a
   * little sparkle rather than a second full rainbow.
   */
  burst(x: number, y: number, z: number, strength?: number): void;
  /** Advances every live ring. Safe (and free) to call when none are alive. */
  update(dt: number): void;
  dispose(): void;
}

/**
 * Builds the shared ring geometry with the rainbow painted into its vertices.
 *
 * `RingGeometry` lies in the XY plane with the hole at the origin, so a vertex's
 * distance from the origin is exactly how far across the band it sits. The ramp
 * is interpolated rather than stepped: hard band edges look like a colour chart,
 * and a rainbow that has been through a bit of sky is softer than that.
 *
 * Exported because the interaction highlight (`world/Highlights.ts`) draws the
 * same ring around anything that has not named an object to outline — one
 * rainbow motif, built once, rather than a second one that drifts out of step.
 */
export function rainbowRingGeometry(inner = 0.62, outer = 1): RingGeometry {
  const geometry = new RingGeometry(inner, outer, 56, ART.rainbow.length * 2);

  const position = geometry.getAttribute('position');
  const colours = new Float32Array(position.count * 3);
  const from = new Color();
  const to = new Color();
  const mixed = new Color();
  const lastBand = ART.rainbow.length - 1;

  for (let i = 0; i < position.count; i += 1) {
    const radius = Math.hypot(position.getX(i), position.getY(i));
    const across = Math.min(1, Math.max(0, (radius - inner) / (outer - inner)));
    const band = across * lastBand;
    const index = Math.min(lastBand - 1, Math.floor(band));
    from.setHex(ART.rainbow[index] ?? 0xffffff);
    to.setHex(ART.rainbow[index + 1] ?? 0xffffff);
    mixed.copy(from).lerp(to, band - index);
    colours[i * 3] = mixed.r;
    colours[i * 3 + 1] = mixed.g;
    colours[i * 3 + 2] = mixed.b;
  }

  geometry.setAttribute('color', new BufferAttribute(colours, 3));
  return geometry;
}

/** Ease-out: fast flick outwards, then a drift. A linear ring looks mechanical. */
function easeOut(t: number): number {
  return 1 - (1 - t) * (1 - t) * (1 - t);
}

export function createRainbowRings(): RainbowRings {
  const root = new Group();
  root.name = 'effect.rainbowRings';

  const geometry = rainbowRingGeometry();
  const meshes: Mesh<RingGeometry, MeshBasicMaterial>[] = [];
  const materials: MeshBasicMaterial[] = [];
  /** Seconds elapsed for each ring, or `LIFETIME` (= finished) when idle. */
  const ages: number[] = [];
  /** Ground height each ring was born at, so it rises from where you jumped. */
  const bases: number[] = [];
  /** Peak-opacity multiplier each ring was born with (see `burst`'s `strength`). */
  const strengths: number[] = [];
  let next = 0;
  let alive = 0;

  for (let i = 0; i < POOL_SIZE; i += 1) {
    const material = new MeshBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0,
      // NORMAL blending, not additive. Additive was tried first and it blew out
      // to a flat white halo the moment the ring crossed the pale sand path —
      // the rainbow only survived over grass. In a park made of painted things a
      // rainbow is pigment, not light, so it is drawn as paint.
      depthWrite: false,
    });
    const mesh = decal(new Mesh(geometry, material));
    mesh.rotation.x = -Math.PI / 2;
    mesh.visible = false;
    mesh.renderOrder = 4;
    root.add(mesh);
    meshes.push(mesh);
    materials.push(material);
    ages.push(LIFETIME);
    bases.push(0);
    strengths.push(1);
  }

  return {
    root,

    burst(x, y, z, strength = 1) {
      const index = next;
      next = (next + 1) % POOL_SIZE;
      const mesh = meshes[index];
      if (!mesh) return;
      mesh.position.set(x, y + GROUND_CLEARANCE, z);
      mesh.scale.setScalar(START_RADIUS);
      mesh.visible = true;
      ages[index] = 0;
      bases[index] = y + GROUND_CLEARANCE;
      strengths[index] = strength;
      alive += 1;
    },

    update(dt) {
      if (alive === 0) return;
      for (let i = 0; i < POOL_SIZE; i += 1) {
        const age = ages[i] ?? LIFETIME;
        if (age >= LIFETIME) continue;

        const next_ = age + dt;
        ages[i] = next_;
        const mesh = meshes[i];
        const material = materials[i];
        if (!mesh || !material) continue;

        if (next_ >= LIFETIME) {
          mesh.visible = false;
          material.opacity = 0;
          alive -= 1;
          continue;
        }

        const t = next_ / LIFETIME;
        const eased = easeOut(t);
        mesh.scale.setScalar(START_RADIUS + (END_RADIUS - START_RADIUS) * eased);
        mesh.position.y = (bases[i] ?? 0) + RISE * eased;
        // Hold full strength for the first fifth, then fade on a curve — a
        // linear fade reads as the ring being switched off.
        const peak = 0.95 * (strengths[i] ?? 1);
        material.opacity = t < 0.2 ? peak : peak * (1 - (t - 0.2) / 0.8) ** 1.5;
      }
    },

    dispose() {
      geometry.dispose();
      for (const material of materials) material.dispose();
    },
  };
}
