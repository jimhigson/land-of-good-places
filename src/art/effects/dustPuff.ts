import { Group, Mesh, MeshBasicMaterial, SphereGeometry } from 'three';
import { Anchor } from '../../world/geo';
import { anchorAt } from '../../world/up';
import { PALETTE } from '../../core/palette';
import { clamp01, smoothstep } from '../../core/mathUtils';
import { decal } from '../style/materials';

/**
 * Little puffs of dust off the player's heels while she runs.
 *
 * GAME_DESIGN.md, "Other cute features", 27 July 2026: *"little puffs of dust
 * kick up behind the player while they run, fading as they settle. Only while
 * running, not walking, so running feels different rather than just faster."*
 *
 * Same rules as `rainbowRing.ts`, the reference effect:
 *
 * - **A fixed pool, allocated at construction.** Nothing is `new`'d per puff,
 *   per trigger or per frame. This one matters more than most: a six-year-old
 *   holds the run button down, so a puff is not a rare event — it is two a
 *   stride, for as long as she likes. Per-puff allocation is exactly the
 *   pattern behind the GC-pause complaint in ARCHITECTURE-REVIEW.md, and this
 *   effect is not going on that list. `puff()` writes into a slot it already
 *   owns; the only per-call work is arithmetic.
 * - **Pigment, not light.** Normal blending, never additive — a pale dust
 *   colour would blow straight out to white over the sand paths, which is
 *   where a child runs most.
 * - **Fade on a curve, hold at the start.** A puff that fades linearly reads
 *   as being switched off. This one holds, then goes.
 * - `decal()`, so it casts no shadow and catches none.
 *
 * The pool is a ring buffer. When it wraps, the oldest puff is reused
 * mid-life, which at this size means one that is already nearly transparent —
 * cheaper and less noticeable than growing the pool for a case that only
 * happens if she runs flat out for longer than the whole pool's lifetime.
 *
 * Puffs live in the *parent's* coordinates, not the player's, so they stay on
 * the ground where they were dropped instead of being dragged along behind
 * her. The same trick `hopRings` uses.
 *
 * **Each slot hangs off its own {@link Anchor}, and the drift is written in
 * that anchor's local space.** The anchor is stood on the ground where the
 * puff was dropped and *turned to face the way she is running*, so "back" is
 * simply local `-Z` and "up" is local `+Y` — both exactly right on ground that
 * leans up to 45°, with no trigonometry in this file at all. Before that, the
 * `DRIFT_UP` lift was world `+Y`, which at the park's rim drove the puff
 * sideways into the hill as much as upwards, and the `scale.y · 0.62` squash —
 * the thing that makes a puff read as *settling on the grass* rather than
 * bouncing off it — was squashed along the wrong axis entirely.
 */

/**
 * Two a stride at a sprint is roughly 5 a second, and a puff lives for
 * {@link LIFETIME} — so twelve is comfortably more than can ever be alive at
 * once, with room for the pool never to have to wrap in normal running.
 */
const POOL_SIZE = 12;

/** Seconds. Short: dust behind a runner settles almost at once. */
const LIFETIME = 0.55;

/** How far a puff drifts back and up over its life, in metres. */
const DRIFT_BACK = 0.42;
const DRIFT_UP = 0.34;

/** Scale at birth and at death — it billows out as it thins. */
const START_SCALE = 0.42;
const END_SCALE = 1.35;

export interface DustPuffs {
  /**
   * The group to add to the world. Puffs are positioned in its parent's
   * coordinates, so add it to whatever the player is in, not to the player.
   */
  readonly root: Group;
  /**
   * Drops one puff at a world point, drifting along (`backX`, `backZ`) —
   * which should point *behind* the runner, normalised.
   */
  puff(x: number, y: number, z: number, backX: number, backZ: number): void;
  /** Advances every live puff. Free to call when none are alive. */
  update(dt: number): void;
  dispose(): void;
}

interface Puff {
  readonly mesh: Mesh;
  /**
   * The ground frame the puff was dropped in, turned so that local `-Z` points
   * behind the runner. Everything below is written in here.
   */
  readonly anchor: Anchor;
  readonly material: MeshBasicMaterial;
  /** Seconds lived, or `LIFETIME` when the slot is idle. */
  age: number;
}

export function createDustPuffs(): DustPuffs {
  const root = new Group();
  root.name = 'effect.dustPuffs';

  // One low-poly blob, shared by every slot. Squashed on Y so it reads as
  // something settling on the ground rather than a ball bouncing off it.
  const geometry = new SphereGeometry(0.22, 8, 6);

  const puffs: Puff[] = [];
  for (let i = 0; i < POOL_SIZE; i += 1) {
    // One material per slot rather than a shared one: per-puff opacity is the
    // whole animation, and a pool of twelve is far too small for the draw-call
    // saving of sharing to be worth losing that.
    const material = new MeshBasicMaterial({
      color: PALETTE.pathSand,
      transparent: true,
      opacity: 0,
      depthWrite: false,
    });
    const mesh = decal(new Mesh(geometry, material));
    mesh.visible = false;
    // Above the ground and the path decals, below the hop rainbow.
    mesh.renderOrder = 3;
    const anchor = new Anchor();
    anchor.add(mesh);
    root.add(anchor);
    puffs.push({ mesh, anchor, material, age: LIFETIME });
  }

  let next = 0;
  let alive = 0;

  function puff(x: number, y: number, z: number, backX: number, backZ: number): void {
    const slot = puffs[next % puffs.length];
    next += 1;
    if (!slot) return;
    if (slot.age >= LIFETIME) alive += 1;

    // The bearing that puts local `+Z` along the way she is *facing*, so the
    // drift below is a plain walk backwards along `-Z`.
    anchorAt(slot.anchor, x, y, z, Math.atan2(-backX, -backZ));
    slot.age = 0;
    slot.mesh.position.set(0, 0, 0);
    slot.mesh.scale.set(START_SCALE, START_SCALE * 0.62, START_SCALE);
    slot.mesh.visible = true;
    slot.material.opacity = 0.75;
  }

  function update(dt: number): void {
    if (alive === 0) return;
    for (const slot of puffs) {
      if (slot.age >= LIFETIME) continue;
      slot.age += dt;
      const t = clamp01(slot.age / LIFETIME);
      if (t >= 1) {
        slot.age = LIFETIME;
        slot.mesh.visible = false;
        alive -= 1;
        continue;
      }

      // Eased so it leaps away from her heel and then loiters, which is what
      // dust actually does — most of the travel is in the first third.
      const ease = smoothstep(0, 1, t);
      // Local to the anchor: back is `-Z`, up is `+Y`, and both are the
      // ground's own directions wherever this puff happens to be.
      slot.mesh.position.set(0, DRIFT_UP * ease, -DRIFT_BACK * ease);

      const scale = START_SCALE + (END_SCALE - START_SCALE) * ease;
      slot.mesh.scale.set(scale, scale * 0.62, scale);
      // Holds for the first third, then goes. Linear reads as switched off.
      slot.material.opacity = 0.75 * (1 - smoothstep(0.33, 1, t));
    }
  }

  function dispose(): void {
    geometry.dispose();
    for (const slot of puffs) slot.material.dispose();
  }

  return { root, puff, update, dispose };
}
