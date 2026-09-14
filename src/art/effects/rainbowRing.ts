import {
  BufferAttribute,
  Color,
  Group,
  Mesh,
  MeshBasicMaterial,
  Quaternion,
  RingGeometry,
  Vector3,
} from 'three';
import { INDOOR_UP } from '../../world/terrain';
import { upFor } from '../../world/up';
import { ART } from '../style/artPalette';
import { decal } from '../style/materials';
import { starGeometry } from '../style/shapes';

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

  // Leaned into the XZ plane **in the geometry**, once, so each mesh's own
  // quaternion is free to carry the lean of the ground it was fired on. A
  // `mesh.rotation.x = -PI/2` here would have to be composed with that lean
  // every frame, which is the pre-multiply trap `world/up.ts` documents.
  const geometry = rainbowRingGeometry();
  geometry.rotateX(-Math.PI / 2);
  const meshes: Mesh<RingGeometry, MeshBasicMaterial>[] = [];
  const materials: MeshBasicMaterial[] = [];
  /** Seconds elapsed for each ring, or `LIFETIME` (= finished) when idle. */
  const ages: number[] = [];
  /** Where each ring was born, so it rises from the spot you jumped off. */
  const bases: Vector3[] = [];
  /**
   * Which way "up" was at each ring's birthplace. The rise, the clearance and
   * the plane of the ring are all along this, not along world `+Y` — outdoors
   * the two differ by 10.5 degrees at 40 m from the park's origin and 45.5 at
   * the rim, and a rainbow that lay in the world XZ plane on ground leaning
   * that far was half buried and half floating on **every landing**.
   */
  const ups: Vector3[] = [];
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
    mesh.visible = false;
    mesh.renderOrder = 4;
    root.add(mesh);
    meshes.push(mesh);
    materials.push(material);
    ages.push(LIFETIME);
    bases.push(new Vector3());
    ups.push(new Vector3(0, 1, 0));
    strengths.push(1);
  }

  return {
    root,

    burst(x, y, z, strength = 1) {
      const index = next;
      next = (next + 1) % POOL_SIZE;
      const mesh = meshes[index];
      const base = bases[index];
      const up = ups[index];
      if (!mesh || !base || !up) return;
      upFor(x, y, z, up);
      base.set(x, y, z).addScaledVector(up, GROUND_CLEARANCE);
      mesh.position.copy(base);
      // Assigned, not pre-multiplied: `update` rewrites the position of a live
      // ring every frame, and a ring that inherited its own tilt each time
      // would spin out of the ground it was fired on.
      mesh.quaternion.setFromUnitVectors(INDOOR_UP, up);
      mesh.scale.setScalar(START_RADIUS);
      mesh.visible = true;
      ages[index] = 0;
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
        const base = bases[i];
        const up = ups[i];
        if (base && up) mesh.position.copy(base).addScaledVector(up, RISE * eased);
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

/* -------------------------------------------------------------------------
 * The "you touched it" sparkles.
 *
 * The second half of the activation flash in GAME_DESIGN.md's HIGHLIGHT RULE:
 * the ring above radiates, and a handful of little rainbow stars scatter with
 * it. They live in this file rather than a new one on purpose — they are the
 * same motif, they take their colours from the same `ART.rainbow`, and a
 * separate module is how two rainbows end up drifting apart.
 *
 * Same rules as everything else in here: a fixed pool allocated once, normal
 * blending, and a fade on a curve. A six-year-old confirming every tap will
 * fire this hundreds of times a session, and nothing about that may allocate.
 * ------------------------------------------------------------------------- */

/** Stars alive at once. Two full bursts overlapping, which is as many as a fast tapper gets. */
const SPARK_POOL_SIZE = 16;
const SPARKS_PER_BURST = 8;
const SPARK_LIFETIME = 0.52;
/** How far a star travels from the burst point, as a multiple of the burst radius. */
const SPARK_TRAVEL = 0.85;
/** How far it lifts as it goes, in metres — enough to arc rather than skate. */
const SPARK_RISE = 0.55;

export interface RainbowSparks {
  /** Parent this in **world space**. */
  readonly root: Group;
  /** Scatters a burst of stars from a point. `radius` is roughly the size of the thing touched. */
  burst(x: number, y: number, z: number, radius: number): void;
  update(dt: number): void;
  dispose(): void;
}

interface Spark {
  readonly mesh: Mesh;
  readonly material: MeshBasicMaterial;
  readonly origin: Vector3;
  /** Outward, in the **tangent plane** at `origin` — not in the world XZ plane. */
  readonly direction: Vector3;
  /** Local up at `origin`; the arc lifts along this. */
  readonly up: Vector3;
  distance: number;
  age: number;
}

const _sparkTilt = /* @__PURE__ */ new Quaternion();
const _sparkUp = /* @__PURE__ */ new Vector3();

export function createRainbowSparks(): RainbowSparks {
  const root = new Group();
  root.name = 'effect.rainbowSparks';

  const geometry = starGeometry(0.13, 0.02, 5);
  const sparks: Spark[] = [];
  let next = 0;
  let alive = 0;

  for (let i = 0; i < SPARK_POOL_SIZE; i += 1) {
    // One material per star: the pool is small, and per-star opacity is what
    // makes "fade and shrink" a single line rather than a shared-material dance.
    const material = new MeshBasicMaterial({
      color: ART.rainbow[i % ART.rainbow.length] ?? 0xffffff,
      transparent: true,
      opacity: 0,
      depthWrite: false,
    });
    const mesh = decal(new Mesh(geometry, material));
    mesh.visible = false;
    mesh.renderOrder = 5;
    root.add(mesh);
    sparks.push({
      mesh,
      material,
      origin: new Vector3(),
      direction: new Vector3(),
      up: new Vector3(0, 1, 0),
      distance: 1,
      age: SPARK_LIFETIME,
    });
  }

  return {
    root,

    burst(x, y, z, radius) {
      // One lookup for the whole burst: every star leaves the same point, so
      // they share a tangent plane. Outdoors that plane leans with the ground,
      // which is what stops half the stars diving into the grass and half
      // shooting at the sky — and this burst is, per `world/Highlights.ts`,
      // the only "yes, that one" a child gets on a phone.
      upFor(x, y, z, _sparkUp);
      _sparkTilt.setFromUnitVectors(INDOOR_UP, _sparkUp);
      for (let i = 0; i < SPARKS_PER_BURST; i += 1) {
        const spark = sparks[next];
        next = (next + 1) % SPARK_POOL_SIZE;
        if (!spark) continue;
        // Evenly around the compass with a fixed quarter-turn offset per burst
        // slot, so two bursts in the same place do not land star-on-star.
        const angle = ((i + next * 0.25) / SPARKS_PER_BURST) * Math.PI * 2;
        if (spark.age >= SPARK_LIFETIME) alive += 1;
        spark.up.copy(_sparkUp);
        spark.origin.set(x, y, z).addScaledVector(_sparkUp, radius * 0.35);
        spark.direction.set(Math.cos(angle), 0, Math.sin(angle)).applyQuaternion(_sparkTilt);
        spark.distance = Math.max(0.7, radius) * SPARK_TRAVEL;
        spark.age = 0;
        spark.mesh.visible = true;
      }
    },

    update(dt) {
      if (alive === 0) return;
      for (const spark of sparks) {
        if (spark.age >= SPARK_LIFETIME) continue;
        spark.age += dt;
        if (spark.age >= SPARK_LIFETIME) {
          spark.mesh.visible = false;
          spark.material.opacity = 0;
          alive -= 1;
          continue;
        }

        const t = spark.age / SPARK_LIFETIME;
        const eased = easeOut(t);
        spark.mesh.position
          .copy(spark.origin)
          .addScaledVector(spark.direction, spark.distance * eased)
          // Up fast, then over the top: a star that only travels outwards
          // reads as a diagram of an explosion rather than a sparkle. "Up" is
          // the local up at the burst, so the arc leans with the ground.
          .addScaledVector(spark.up, SPARK_RISE * Math.sin(eased * Math.PI * 0.9));
        spark.mesh.rotation.z = t * 3.4;
        spark.mesh.scale.setScalar(1 - 0.45 * t);
        spark.material.opacity = t < 0.25 ? 0.95 : 0.95 * (1 - (t - 0.25) / 0.75) ** 1.4;
      }
    },

    dispose() {
      geometry.dispose();
      for (const spark of sparks) spark.material.dispose();
    },
  };
}
