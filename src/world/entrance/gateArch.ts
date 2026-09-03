import { CylinderGeometry, Group, Mesh, SphereGeometry, TorusGeometry, type Material } from 'three';
import { ENTRANCE_GATE_HALF_WIDTH, ENTRANCE_GATE_POST_HEIGHT } from './layout';

/**
 * **The park's front gate: two posts, two caps, and the arch over the gap.**
 *
 * There is exactly one gate in this game and it is built twice — once in the
 * park itself ({@link Entrance}) and once at the end of the bus ride, seen
 * from the road ({@link BusJourney}'s `buildParkAhead`), where the cut between
 * the two scenes lands squarely on it. Both used to carry their own copy of
 * the posts, the caps and the crossbar, sharing only the two numbers in
 * `layout.ts`, and the copies drifted: that is issue #480.
 *
 * **What drifted, and why it could not be seen from the code.** `Entrance.ts`'s
 * crossbar carried `rotation.z = Math.PI` *and* `rotation.y = Math.PI / 2`.
 * `TorusGeometry`'s arc runs anticlockwise from `+X` in the XY plane, so an arc
 * of π is the **upper** half — the arch shape, feet down, apex up.
 * `rotation.z = Math.PI` turns that into the *lower* half, so the arch hung
 * downwards from the tops of the posts and buried its apex in the ground; the
 * extra quarter-turn about Y laid it *along* the path instead of across it.
 * Measured on the built park, the mesh was 0.53 m thin across the gateway,
 * 9.16 m long down it, and reached 1.34 m below the paving. What a child saw
 * was two curved prongs sticking out of the ground either side of the way in —
 * "a weird segment of a taurus near the park edge".
 *
 * Neither rotation is wrong in a way a reader can catch: `π` and `π/2` on a
 * symmetric shape read like framing, and the second copy in `BusJourney` had
 * only *one* of the two mistakes, so the two gates were differently wrong.
 * Hence one owner.
 *
 * **Everything is derived from one `yaw`.** The posts are not positioned by
 * their own formula — they are placed on the same axis the crossbar is turned
 * onto, so a crossbar spanning somewhere the posts do not stand is no longer a
 * state this code can be in.
 *
 * **Solidity.** The feet of the arch land exactly on the posts, and the posts
 * are what a child walks into: the caller registers a collider on each
 * {@link GateArch.feet}, whose radius covers both the post (0.5 m) and the
 * crossbar's tube (0.28 m). The span between them is
 * {@link GateArch.clearHeightY} above the ground and must stay clear — it is
 * the way into the park. See `test/procgen/invariants.ts`'s
 * `theParkGateArchStandsOverItsGateway`.
 *
 * **Appearance is deliberately untouched here.** Jim commissioned an authored
 * Blender arch (ferris-wheel logo, "LAND OF GOOD PLACES" painted into its UV
 * texture) on 3 September 2026; this file owns *where the gate is and how it
 * is turned*, so that asset can replace the meshes without moving the gate.
 */
export interface GateArchOptions {
  /** Gate centre, in the coordinates of the scene this arch is going into. */
  readonly centreX: number;
  readonly centreZ: number;
  /**
   * Rotation about Y that takes the arch's local `+X` — the line its feet
   * stand on — onto the axis the gateway spans, i.e. the boundary wall's
   * tangent. `0` puts the posts either side of the centre along world X.
   */
  readonly yaw: number;
  /** Ground height at a point in that scene: the park's terrain, or the road's. */
  readonly groundAt: (x: number, z: number) => number;
  /** The posts. */
  readonly stoneMaterial: Material;
  /** The caps and the crossbar. */
  readonly capMaterial: Material;
  /**
   * Names the gate's meshes `<prefix>-arch`, `<prefix>-post-0` and
   * `<prefix>-post-1`, so the scene can be asked where the gate stands and
   * which way it faces.
   *
   * `Entrance` passes `park-gate`: `check:park-map` reads `park-gate-arch` as
   * the independent truth of where the gate is, and
   * `theParkGateArchStandsOverItsGateway` reads the posts beside it to ask
   * whether the arch is still standing on them.
   *
   * Left unnamed otherwise, on purpose: `getObjectByName` returns the *first*
   * match in the scene, so a second gate under the same names would silently
   * answer for the park's own.
   */
  readonly namePrefix?: string;
}

export interface GateArch {
  /** Posts, caps and crossbar. Add it wherever the gate belongs. */
  readonly group: Group;
  /**
   * Where the two posts stand — and therefore where the arch's feet come
   * down. The one owner of that question: a caller registering colliders or
   * keeping paving out from under the gate reads these rather than
   * recomputing them.
   */
  readonly feet: readonly [{ readonly x: number; readonly z: number }, { readonly x: number; readonly z: number }];
  /** Radius a foot's collider must cover: the post, plus the crossbar's tube. */
  readonly footRadius: number;
  /**
   * The lowest the span gets between the posts, in world Y. Below this the
   * gateway is empty and must stay so.
   */
  readonly clearHeightY: number;
}

/**
 * What a gate post's collider covers, and therefore what a child bumps into:
 * whichever of the post's splayed base or the arch's tube is wider, plus a
 * hand's width. Exported because a check asking "is the gate solid where it
 * should be, and open where a child walks?" has to know the reach it is
 * probing against rather than write 0.55 down a second time.
 */
export const GATE_POST_COLLIDER_RADIUS = 0.55;

/**
 * How far off its own post an arch foot may land and still be standing on it.
 *
 * The crossbar's bounding box overshoots the post centre by one {@link
 * ARCH_TUBE} by construction, so this is that plus a hand's width. The arch
 * turned a quarter-turn out of the gate plane (issue #480) put its feet
 * **6.28 m** from the nearest post, so nothing about this number is delicately
 * chosen.
 *
 * Exported for the same reason as {@link GATE_POST_COLLIDER_RADIUS}: the
 * checks that ask whether the gate is still pointing the right way live in two
 * places (`test/procgen/invariants.ts` and `scripts/probe-gate-pool.mts`), and
 * a tolerance hand-copied into either of them is the exact disease this file
 * exists to cure.
 */
export const GATE_FOOT_TOLERANCE = 0.6;

/**
 * How far inside the park a gate probe stands, in metres.
 *
 * Both are derived from the reach a gate post has over a child —
 * `PLAYER_RADIUS` (0.62) + {@link GATE_POST_COLLIDER_RADIUS} (0.55) = 1.17 m:
 *
 * - `solid` is **inside** that reach, so a child there must be pushed out.
 *   That is what proves the posts carry colliders at all.
 * - `clear` is **outside** it, so no post can be what answers there. A probe
 *   that comes back blocked at `clear` is being answered by something that is
 *   not the gate — the boundary, on the seeds of issue #481 — and the `solid`
 *   reading beside it therefore proves nothing. This is how the check knows
 *   when its own control has been masked instead of assuming it has not.
 * - `open` is what the withheld walkability clause uses, kept here for
 *   whoever lands it with #481's fix.
 *
 * None of them may be pointed at the gate line itself: the park boundary keeps
 * a child *inside* the park, so a `PLAYER_RADIUS` body standing on the line
 * overlaps the outside and every probe along it comes back blocked — 33 of 33
 * across the gate on the canonical seed, whatever the gate is doing.
 */
export const GATE_PROBE_INSET = { solid: 1.0, clear: 1.5, open: 1.5 } as const;

/** Half the gap between the posts, and the arch's own radius. */
const HALF_WIDTH = ENTRANCE_GATE_HALF_WIDTH;
/** The crossbar's tube. */
const ARCH_TUBE = 0.28;
/** The post's widest radius (a slight taper, wider at the foot). */
const POST_FOOT_RADIUS = 0.5;
const POST_TOP_RADIUS = 0.42;
/** The cap sits a little proud of the post, and the arch springs from there. */
const CAP_RISE = 0.15;

export function buildGateArch(options: GateArchOptions): GateArch {
  const { centreX, centreZ, yaw, groundAt, stoneMaterial, capMaterial } = options;
  const group = new Group();

  // The axis the gateway spans: the arch's local +X, turned by `yaw`. A
  // rotation about Y takes (1,0,0) to (cos yaw, 0, -sin yaw), so this is the
  // *same* direction the crossbar's own feet point along once it is rotated —
  // which is the whole point of deriving the posts from it.
  const axisX = Math.cos(yaw);
  const axisZ = -Math.sin(yaw);

  const postGeometry = new CylinderGeometry(POST_TOP_RADIUS, POST_FOOT_RADIUS, ENTRANCE_GATE_POST_HEIGHT, 12);
  const capGeometry = new SphereGeometry(0.62, 14, 10);
  const feet: { x: number; z: number }[] = [];

  for (const side of [-1, 1] as const) {
    const x = centreX + side * HALF_WIDTH * axisX;
    const z = centreZ + side * HALF_WIDTH * axisZ;
    const ground = groundAt(x, z);
    feet.push({ x, z });

    const post = new Mesh(postGeometry, stoneMaterial);
    if (options.namePrefix !== undefined) post.name = `${options.namePrefix}-post-${feet.length - 1}`;
    post.position.set(x, ground + ENTRANCE_GATE_POST_HEIGHT / 2, z);
    post.castShadow = true;
    post.receiveShadow = true;
    group.add(post);

    const cap = new Mesh(capGeometry, capMaterial);
    cap.position.set(x, ground + ENTRANCE_GATE_POST_HEIGHT + CAP_RISE, z);
    cap.scale.set(1, 0.75, 1);
    cap.castShadow = true;
    group.add(cap);
  }

  // The upper half of a torus — feet down, apex up — turned onto the axis its
  // posts stand on. No `rotation.z`: see the note above about #480.
  const crossbar = new Mesh(new TorusGeometry(HALF_WIDTH, ARCH_TUBE, 10, 24, Math.PI), capMaterial);
  const springY = groundAt(centreX, centreZ) + ENTRANCE_GATE_POST_HEIGHT + CAP_RISE;
  crossbar.position.set(centreX, springY, centreZ);
  crossbar.rotation.y = yaw;
  crossbar.castShadow = true;
  if (options.namePrefix !== undefined) crossbar.name = `${options.namePrefix}-arch`;
  group.add(crossbar);

  return {
    group,
    feet: [feet[0]!, feet[1]!],
    footRadius: GATE_POST_COLLIDER_RADIUS,
    clearHeightY: springY,
  };
}
