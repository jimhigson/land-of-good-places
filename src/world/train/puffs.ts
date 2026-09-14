import {
  Color,
  Group,
  IcosahedronGeometry,
  InstancedMesh,
  Matrix4,
  MeshBasicMaterial,
  Quaternion,
  Vector3,
} from 'three';
import { upFor } from '../up';

/**
 * Chuff-chuff: the little clouds out of the funnel.
 *
 * A ring buffer of instances on one mesh, so the whole effect is a single draw
 * call however hard the engine is working. Each puff grows, drifts up and
 * backwards, and shrinks away to nothing.
 *
 * It fades by **shrinking**, not by going transparent. One `MeshBasicMaterial`
 * is shared by every instance, so per-puff opacity is not available without a
 * custom shader — and a puff that shrinks out reads as smoke thinning far
 * better than a fixed-size ball popping out of existence would. The colour is
 * driven per instance, from a faint warm grey towards white, which does the
 * rest of the work.
 *
 * **Smoke leaves the funnel along the ground's up, not the world's.** There is
 * no {@link Anchor} here to do it — a puff is an instance matrix, not a child
 * object, and it goes on drifting long after the loco that made it has moved
 * on — so `emit` asks `upFor` once, at the funnel, and the puff's whole rise is
 * along that. Before this the loco leaned with the railway while its smoke went
 * up world `+Y`, which at the park's rim is 45° off the chimney and reads as
 * smoke blowing sideways out of the side of the engine.
 */

/** Plenty: at one puff every 1.5 m and a two-second life, a dozen is the peak. */
const MAX_PUFFS = 20;

const LIFETIME = 2.1;
const RISE_SPEED = 1.15;
const START_RADIUS = 0.16;
const END_RADIUS = 0.72;

export class SmokePuffs {
  readonly group = new Group();

  private readonly mesh: InstancedMesh;
  private readonly age = new Float32Array(MAX_PUFFS);
  private readonly alive = new Uint8Array(MAX_PUFFS);
  private readonly positions: Vector3[] = [];
  private readonly drift: Vector3[] = [];

  private next = 0;

  private readonly matrix = new Matrix4();
  private readonly scale = new Vector3();
  private readonly rotation = new Quaternion();
  private readonly colour = new Color();
  private readonly up = new Vector3(0, 1, 0);
  private readonly wander = new Vector3();

  constructor() {
    this.group.name = 'train-smoke';

    this.mesh = new InstancedMesh(
      // Subdivision 1: faceted enough to be hand-made, cheap enough to be free.
      new IcosahedronGeometry(1, 1),
      new MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.78, depthWrite: false, fog: true }),
      MAX_PUFFS,
    );
    this.mesh.name = 'smoke-puffs';
    this.mesh.frustumCulled = false;
    this.mesh.count = MAX_PUFFS;
    this.group.add(this.mesh);

    for (let i = 0; i < MAX_PUFFS; i += 1) {
      this.positions.push(new Vector3());
      this.drift.push(new Vector3());
      this.age[i] = LIFETIME;
    }
    this.hideAll();
  }

  /** A new puff at the top of the funnel. */
  emit(x: number, y: number, z: number): void {
    const index = this.next;
    this.next = (this.next + 1) % MAX_PUFFS;

    this.positions[index]?.set(x, y, z);
    // The up at the funnel — the same answer the loco itself is standing on.
    upFor(x, y, z, this.up);
    // A gentle random sideways wander, so the trail is not a ruler-straight line
    // of identical balls. Kept in the tangent plane by taking the wander in
    // world x/z and then removing whatever component of it points along the up,
    // so a leaning chimney's smoke wanders across the sky rather than into it.
    this.wander.set((Math.random() - 0.5) * 0.5, 0, (Math.random() - 0.5) * 0.5);
    this.wander.addScaledVector(this.up, -this.wander.dot(this.up));
    this.drift[index]
      ?.copy(this.wander)
      .addScaledVector(this.up, RISE_SPEED * (0.85 + Math.random() * 0.3));
    this.age[index] = 0;
    this.alive[index] = 1;
  }

  update(dt: number): void {
    let any = false;

    for (let i = 0; i < MAX_PUFFS; i += 1) {
      if (!this.alive[i]) continue;

      const age = (this.age[i] ?? 0) + dt;
      this.age[i] = age;
      if (age >= LIFETIME) {
        this.alive[i] = 0;
        this.hide(i);
        continue;
      }
      any = true;

      const position = this.positions[i];
      const drift = this.drift[i];
      if (!position || !drift) continue;

      position.addScaledVector(drift, dt);
      // Slowing as it rises, the way a real puff loses its shove.
      drift.multiplyScalar(1 - Math.min(0.9, dt * 1.4));

      const t = age / LIFETIME;
      // Grow quickly, then shrink away over the last third.
      const grow = START_RADIUS + (END_RADIUS - START_RADIUS) * Math.sqrt(t);
      const fade = t < 0.66 ? 1 : 1 - (t - 0.66) / 0.34;
      const radius = grow * fade;

      this.scale.setScalar(Math.max(0.0001, radius));
      this.matrix.compose(position, this.rotation, this.scale);
      this.mesh.setMatrixAt(i, this.matrix);

      // Warm grey when it leaves the funnel, white by the time it has spread.
      const tint = 0.72 + 0.28 * t;
      this.colour.setRGB(tint, tint * 0.985, tint * 0.96);
      this.mesh.setColorAt(i, this.colour);
    }

    this.mesh.instanceMatrix.needsUpdate = true;
    if (any && this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    (this.mesh.material as MeshBasicMaterial).dispose();
  }

  private hide(index: number): void {
    this.scale.setScalar(0.0001);
    this.matrix.compose(ORIGIN, this.rotation, this.scale);
    this.mesh.setMatrixAt(index, this.matrix);
  }

  private hideAll(): void {
    for (let i = 0; i < MAX_PUFFS; i += 1) this.hide(i);
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}

const ORIGIN = new Vector3(0, -1000, 0);
