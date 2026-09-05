/**
 * **Does the cat bus drive through a trestle POST, at the height the bus
 * actually occupies?** — a one-off measurement, not a ratchet.
 *
 * `check:entrance-road` resolves each leg to its **foot** and asks only there.
 * On a leaning leg the foot is up to 2 m from the drawn trunk, so a clean
 * "0 legs hit" from that instrument means the bus clears the *feet*, which is
 * not the question a child watching the bus arrive is asking. This asks about
 * the drawn post over the bus's own height band.
 *
 * Deliberately separate from the swept-bus ratchet another Engineer is
 * building: this exists to choose a number (the road's outset) and to settle
 * one prediction, and it prints both the foot verdict and the post verdict side
 * by side so the difference between them is the output rather than a footnote.
 *
 * **Recovering the post from the instanced mesh.** `railRace:trestle-legs` is
 * an `InstancedMesh` whose per-instance matrix is composed about the
 * **midpoint** of foot-to-top, with the trunk running up local +Y. So column 1
 * of the matrix, already scaled, is the half-segment vector: the foot is
 * `centre - half` and the top is `centre + half`. Taking only `centre` (or only
 * the foot) is what loses the lean.
 *
 * Run: LGP_SEED=<n> node --no-warnings --import ./scripts/ts-extension-resolver-register.mjs scripts/measure-posts-vs-bus.mts
 */
import { InstancedMesh, Matrix4, Vector3 } from 'three';
import { buildHeadlessPark } from './park-harness.mts';
import { isInEntranceRoad } from '../src/world/entrance/roadRoute.ts';
import { CAT_BUS_BODY_TOP_Y } from '../src/world/entrance/catBus.ts';
import { POST_FOOT_RADIUS } from '../src/world/railRace/trestleGeometry.ts';

/** How finely the post is walked, in metres. Finer than anything measuring it. */
const SAMPLE_SPACING = 0.2;

interface Leg {
  readonly footX: number;
  readonly footZ: number;
  readonly topX: number;
  readonly topZ: number;
  readonly footY: number;
  readonly topY: number;
  readonly mesh: string;
}

export function legsOf(scene: import('three').Object3D): Leg[] {
  const out: Leg[] = [];
  const matrix = new Matrix4();
  const centre = new Vector3();
  const half = new Vector3();
  scene.traverse((object) => {
    if (!(object instanceof InstancedMesh)) return;
    if (!object.name.includes('trestle-legs')) return;
    object.updateWorldMatrix(true, false);
    for (let i = 0; i < object.count; i += 1) {
      object.getMatrixAt(i, matrix);
      matrix.premultiply(object.matrixWorld);
      centre.setFromMatrixPosition(matrix);
      // Column 1 is local +Y, already carrying the instance's scale, so it is
      // the half-segment from the midpoint to the trunk's top.
      half.setFromMatrixColumn(matrix, 1).multiplyScalar(0.5);
      out.push({
        footX: centre.x - half.x,
        footZ: centre.z - half.z,
        footY: centre.y - half.y,
        topX: centre.x + half.x,
        topZ: centre.z + half.z,
        topY: centre.y + half.y,
        mesh: object.name,
      });
    }
  });
  return out;
}

/** Is any part of this post inside the bus's corridor, over the bus's own height? */
function postHits(leg: Leg, radius: number): boolean {
  const rise = leg.topY - leg.footY;
  if (rise <= 0) return isInEntranceRoad(leg.footX, leg.footZ, radius);
  // Only as far up the trunk as there is bus to meet — the same reach
  // `postClearsEntranceRoad` uses, so the measurement and the placement
  // predicate are asking one question rather than two similar ones.
  const reach = Math.min(1, CAT_BUS_BODY_TOP_Y / rise);
  const lean = Math.hypot(leg.topX - leg.footX, leg.topZ - leg.footZ);
  const steps = Math.max(1, Math.ceil((lean * reach) / SAMPLE_SPACING));
  for (let i = 0; i <= steps; i += 1) {
    const t = (i / steps) * reach;
    if (
      isInEntranceRoad(
        leg.footX + (leg.topX - leg.footX) * t,
        leg.footZ + (leg.topZ - leg.footZ) * t,
        radius,
      )
    ) {
      return true;
    }
  }
  return false;
}

const seed = Number(process.env.LGP_SEED ?? 20260728);
const { scene } = buildHeadlessPark();
const legs = legsOf(scene);

const feet = legs.filter((l) => isInEntranceRoad(l.footX, l.footZ, POST_FOOT_RADIUS));
const posts = legs.filter((l) => postHits(l, POST_FOOT_RADIUS));
const leaning = legs.filter((l) => Math.hypot(l.topX - l.footX, l.topZ - l.footZ) > 0.05);
const worstLean = legs.reduce(
  (m, l) => Math.max(m, Math.hypot(l.topX - l.footX, l.topZ - l.footZ)),
  0,
);

// The control: the foot verdict and the post verdict must be capable of
// disagreeing, or this measurement says nothing that `check:entrance-road`
// does not already say. A run where they agree AND nothing leans is a run
// where the instrument had no opportunity to discriminate — say so.
const discriminating = leaning.length > 0;

process.stderr.write(
  `seed ${seed}: ${legs.length} legs, ${leaning.length} leaning (worst lean ${worstLean.toFixed(2)} m)\n` +
    `  FEET inside the bus corridor : ${feet.length}\n` +
    `  POSTS inside it at bus height: ${posts.length}\n` +
    `  difference (what a foot-only instrument cannot see): ${posts.length - feet.length}\n` +
    (discriminating
      ? ''
      : '  NOTE: no leg leans on this seed, so foot and post cannot differ here —\n' +
        '        this run discriminates nothing and must not be quoted as cover.\n'),
);
