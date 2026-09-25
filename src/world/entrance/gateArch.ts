import { Group, Object3D } from 'three';
import {
  createGateArch,
  GATE_ARCH_CLEAR_HEIGHT,
  GATE_ARCH_PIER_KEEP_OUT,
} from '../../art/models/gateArch';
import {
  ENTRANCE_ANGLE,
  ENTRANCE_GATE_HALF_WIDTH,
  ENTRANCE_GATE_X,
  ENTRANCE_GATE_Z,
} from './layout';
import { standOnSphere } from '../terrain';

/**
 * **The park's front gate: the authored arch, seated on its gateway.**
 *
 * There is exactly one gate in this game and it is built twice — once in the
 * park itself ({@link Entrance}) and once at the end of the bus ride, seen
 * from the road ({@link BusJourney}'s `buildParkAhead`), where the cut between
 * the two scenes lands squarely on it. Both used to carry their own copy of
 * the posts, the caps and the crossbar, sharing only the two numbers in
 * `layout.ts`, and the copies drifted: that is issue #480. This file is the one
 * owner both call.
 *
 * **What it draws is now `art/models/gateArch.ts`'s authored `.glb`** — two
 * pink piers, a segmental band with nine lemon bobbles, a hanging plank
 * lettered LAND OF GOOD PLACES and a ferris-wheel roundel — commissioned by
 * Jim on 3 September 2026 and approved with *"perfect. Add the arch please to
 * the game."* It replaced a half-`TorusGeometry` crossbar on two cylinders.
 *
 * ## Who owns which number
 *
 * Nothing here is a copy of anything, and that is the whole design:
 *
 * * **`layout.ts`** owns the gateway — where it is, how wide, how tall. This
 *   file reads {@link ENTRANCE_GATE_HALF_WIDTH} to say where the feet stand
 *   and passes the centre through from its caller.
 * * **The mesh** owns every shape number, and `art/models/gateArch.ts`
 *   measures them off the shipped vertices: {@link GATE_ARCH_PIER_KEEP_OUT} is
 *   the collider radius each pier actually needs, and
 *   {@link GATE_ARCH_CLEAR_HEIGHT} is the air under the lowest thing over the
 *   gateway. It also re-measures the `.glb` against `layout.ts` **at load** and
 *   throws if the two have drifted apart, because a rigid model of a gateway
 *   the park sizes for itself can go stale and must not do so quietly.
 * * **This file** owns only the seating: where the arch stands, which way it
 *   faces, and what a child bumps into.
 *
 * ## Which way it faces, and why that is not a `yaw`
 *
 * The arch is authored with its origin in the middle of the gateway on the
 * ground, its piers along local `±X`, and **local `+Z` pointing out of the
 * park at the arriving child** — the lettering is on that face. So the two
 * placements that put the piers in the right place are 180° apart, and the
 * wrong one of them is not visibly wrong from inside the park: the gate looks
 * perfect and the sign faces the wrong way, which is precisely the class of
 * silent half-turn issue #480 was.
 *
 * A bare `yaw` cannot express which of the two is meant, so this takes
 * {@link GateArchOptions.outward}: the direction the *front* of the arch looks
 * along. The feet come out of the perpendicular to it, so the piers and the
 * lettering are one decision and cannot disagree.
 *
 * ## Solidity
 *
 * Two circles, one per pier, radius {@link GATE_ARCH_PIER_KEEP_OUT}, and
 * **nothing under the span** — the caller registers them on {@link GateArch.feet}.
 * That is not an omission: the span is the way into the park, and a collider
 * there would shut the park's own front door, which CLAUDE.md names as the
 * worst outcome a solidity fix can have. Everything the arch carries above the
 * piers is over {@link GATE_ARCH_CLEAR_HEIGHT} up, well clear of the tallest
 * child in the tallest hat. Proved both ways by
 * `theParkGateArchStandsOverItsGateway` in `test/procgen/invariants.ts` and by
 * `scripts/probe-gate-pool.mts`.
 */
export interface GateArchOptions {
  /** Gate centre, in the coordinates of the scene this arch is going into. */
  readonly centreX: number;
  readonly centreZ: number;
  /**
   * The direction the **front** of the arch faces — out of the park, at
   * whoever is arriving. Need not be normalised. The piers stand on the
   * perpendicular to it, so this one vector decides both.
   */
  readonly outward: { readonly x: number; readonly z: number };
  /** Ground height at a point in that scene: the park's terrain, or the road's. */
  readonly groundAt: (x: number, z: number) => number;
  /**
   * Names the arch's root `<prefix>-arch` and two markers at its feet
   * `<prefix>-post-0` / `<prefix>-post-1`, so the scene can be asked where the
   * gate stands and which way it faces.
   *
   * `Entrance` passes `park-gate`: `check:park-map` reads `park-gate-arch` as
   * the independent truth of where the gate is, and
   * `theParkGateArchStandsOverItsGateway` reads the two markers beside it to
   * ask whether the arch is still standing on its own gateway.
   *
   * Left unnamed otherwise, on purpose: `getObjectByName` returns the *first*
   * match in the scene, so a second gate under the same names would silently
   * answer for the park's own.
   */
  readonly namePrefix?: string;
  /**
   * **True when this gate stands on the park's own ground**, and so leans with
   * it — the arch's up is the radial of `terrain.ts`'s ground sphere rather
   * than world `+Y`. The park's gate is nearly a hundred metres out from the
   * centre, where that is several degrees; a gate standing bolt upright in
   * ground that leans reads as a gate about to fall over.
   *
   * It is a flag rather than something derived here because the *other* caller
   * is not on the park at all: `BusJourney` builds this same arch on its
   * synthetic lane, whose ground is `laneHeight` and whose coordinates mean
   * nothing to the park's sphere — `spaceAt` would nonetheless call that patch
   * of lane "the garden", so asking it is not an available shortcut. The
   * caller passing `groundAt` is the one that knows which world it is in, and
   * it says so here too.
   */
  readonly onParkSphere?: boolean;
}

export interface GateArch {
  /** The whole gate. Add it wherever the gate belongs. */
  readonly group: Group;
  /**
   * Where the two piers stand. The one owner of that question: a caller
   * registering colliders, or keeping paving out from under the gate, reads
   * these rather than recomputing them from the gateway's half-width and a
   * bearing a second time.
   */
  readonly feet: readonly [
    { readonly x: number; readonly z: number },
    { readonly x: number; readonly z: number },
  ];
  /** Radius a foot's collider must cover — the pier, measured off the mesh. */
  readonly footRadius: number;
  /**
   * The lowest the arch gets over the gateway, in world Y. Below this the
   * gateway is empty and must stay so.
   */
  readonly clearHeightY: number;
  /** Frees the arch's own geometry and materials. */
  readonly dispose: () => void;
}

/**
 * What a gate pier's collider covers, and therefore what a child bumps into.
 *
 * Re-exported rather than redefined: the number is measured off the shipped
 * `.glb` in `art/models/gateArch.ts` and this is the name the checks and the
 * invariant already import. A check asking "is the gate solid where it should
 * be, and open where a child walks?" has to know the reach it is probing
 * against, and it must be the same reach the collider was given.
 */
export const GATE_POST_COLLIDER_RADIUS = GATE_ARCH_PIER_KEEP_OUT;

/**
 * **Where an arch's two piers stand**, for an arch centred at
 * `(centreX, centreZ)` whose lettered face points along `outward`.
 *
 * The one owner of that arithmetic: {@link buildGateArch} registers its
 * colliders on these points and places its markers on them, and anything that
 * has to steer round the piers — the cat bus's children, walking in on routes
 * the collision world never sees — asks here rather than working the feet out
 * a second time.
 *
 * A rotation of `yaw` about Y takes local (0,0,1) to (sin yaw, 0, cos yaw), so
 * `yaw = atan2(out.x, out.z)` points the face along `outward`; it takes local
 * (1,0,0) to (cos yaw, 0, -sin yaw), which is the line the piers stand on.
 */
export function gateArchFeet(
  centreX: number,
  centreZ: number,
  outward: { readonly x: number; readonly z: number },
): [{ x: number; z: number }, { x: number; z: number }] {
  const yaw = Math.atan2(outward.x, outward.z);
  const axisX = Math.cos(yaw);
  const axisZ = -Math.sin(yaw);
  const foot = (side: number): { x: number; z: number } => ({
    x: centreX + side * ENTRANCE_GATE_HALF_WIDTH * axisX,
    z: centreZ + side * ENTRANCE_GATE_HALF_WIDTH * axisZ,
  });
  return [foot(-1), foot(1)];
}

/** Which way the park's own gate faces: out along its bearing, away from the park. */
export const PARK_GATE_OUTWARD = { x: Math.cos(ENTRANCE_ANGLE), z: Math.sin(ENTRANCE_ANGLE) } as const;

/** The park gate's two piers, where {@link Entrance} builds them. */
export function parkGateFeet(): [{ x: number; z: number }, { x: number; z: number }] {
  return gateArchFeet(ENTRANCE_GATE_X, ENTRANCE_GATE_Z, PARK_GATE_OUTWARD);
}

export function buildGateArch(options: GateArchOptions): GateArch {
  const { centreX, centreZ, outward, groundAt } = options;
  const group = new Group();

  const length = Math.hypot(outward.x, outward.z);
  if (length < 1e-6) {
    throw new Error('buildGateArch: `outward` has no direction — the arch would face nowhere.');
  }
  const outX = outward.x / length;
  const outZ = outward.z / length;

  // A rotation of `yaw` about Y takes local (0,0,1) to (sin yaw, 0, cos yaw),
  // so this is the yaw that points the arch's lettered face along `outward`.
  // The same yaw {@link gateArchFeet} stands the piers by, so the feet the
  // collider uses are the feet the mesh actually has.
  const yaw = Math.atan2(outX, outZ);

  const ground = groundAt(centreX, centreZ);

  const arch = createGateArch();
  arch.root.position.set(centreX, ground, centreZ);
  arch.root.rotation.y = yaw;
  // Piers, span and lettering are one authored mesh under this root, so the
  // whole gate leans as the single object it is. The feet below are the pivot
  // and do not move, which is what keeps the colliders honest.
  if (options.onParkSphere) standOnSphere(arch.root);
  if (options.namePrefix !== undefined) arch.root.name = `${options.namePrefix}-arch`;
  group.add(arch.root);

  const feet = gateArchFeet(centreX, centreZ, outward);
  for (const [index, { x, z }] of feet.entries()) {
    // A marker, not a mesh: the piers are one node of the authored `.glb` and
    // there is no per-side geometry to hang the name on. It is placed from the
    // same `feet` the collider is registered on, so a scene that says the gate
    // is here and a collision world that says it is there is not a state this
    // code can be in.
    if (options.namePrefix !== undefined) {
      const marker = new Object3D();
      marker.name = `${options.namePrefix}-post-${index}`;
      marker.position.set(x, groundAt(x, z), z);
      group.add(marker);
    }
  }

  return {
    group,
    feet,
    footRadius: GATE_ARCH_PIER_KEEP_OUT,
    clearHeightY: ground + GATE_ARCH_CLEAR_HEIGHT,
    // `AssetHandle.dispose` is optional on the interface; `createGateArch`
    // always supplies one, and this stays correct either way.
    dispose: () => arch.dispose?.(),
  };
}
