/**
 * **Why does a post still stand in the bus after `groundIsClear` learned to test
 * the whole lean?** (#488, session 7)
 *
 * Reads the *drawn* posts out of the built park and, for every one the bus
 * sweeps, prints where up the post the intrusion is and how the drawn post's
 * geometry compares with the model `track.ts`'s `postClearsEntranceRoad` used to
 * decide it was clear. Two definitions of one post is the suspicion; this is
 * what says whether that is true rather than plausible.
 *
 * ```
 * LGP_SEED=11 node --no-warnings --import ./scripts/ts-extension-resolver-register.mjs scripts/probe-post-lean.mts
 * ```
 */
import './headless-canvas.mjs';
import { InstancedMesh, Matrix4, type Object3D, Vector3 } from 'three';

const { buildHeadlessPark } = await import('./park-harness.mts');
const { CAT_BUS_LENGTH, CAT_BUS_WIDTH, CAT_BUS_BODY_BOTTOM_Y, CAT_BUS_BODY_TOP_Y } = await import(
  '../src/world/entrance/catBus.ts'
);
const { POST_FOOT_RADIUS, POST_TOP_RADIUS } = await import('../src/world/railRace/trestleGeometry.ts');
const { PARK_SEED } = await import('../src/world/parkManifest.ts');
const { entranceRoadAt, entranceRoadBrow, distanceToEntranceCorridor } = await import(
  '../src/world/entrance/roadRoute.ts'
);

const park = buildHeadlessPark();

interface Post {
  readonly id: string;
  readonly ring: string;
  readonly footX: number;
  readonly footY: number;
  readonly footZ: number;
  readonly topX: number;
  readonly topY: number;
  readonly topZ: number;
  readonly across: number;
}

const posts: Post[] = [];
const matrix = new Matrix4();
const centre = new Vector3();
const axis = new Vector3();
park.scene.traverse((object) => {
  const mesh = object as InstancedMesh;
  if (!mesh.isInstancedMesh || mesh.name !== 'railRace:trestle-legs') return;
  let ring = 'unknown';
  for (let node: Object3D | null = mesh; node; node = node.parent) {
    if (node.name.includes('walk-past')) { ring = 'walk-past'; break; }
    if (node.name.includes('race-ring')) { ring = 'race'; break; }
  }
  for (let i = 0; i < mesh.count; i += 1) {
    mesh.getMatrixAt(i, matrix);
    centre.setFromMatrixPosition(matrix);
    axis.setFromMatrixColumn(matrix, 1);
    const length = axis.length() || 1;
    axis.divideScalar(length);
    const across = new Vector3().setFromMatrixColumn(matrix, 0).length();
    posts.push({
      id: `${ring}:${i}`,
      ring,
      footX: centre.x - axis.x * (length / 2),
      footY: centre.y - axis.y * (length / 2),
      footZ: centre.z - axis.z * (length / 2),
      topX: centre.x + axis.x * (length / 2),
      topY: centre.y + axis.y * (length / 2),
      topZ: centre.z + axis.z * (length / 2),
      across,
    });
  }
});

const halfLength = CAT_BUS_LENGTH / 2;
const halfWidth = CAT_BUS_WIDTH / 2;
const POST_STEP = 0.25;
const STEP = 0.25;
const brow = entranceRoadBrow();

/** For each post, the worst (reach, height) the bus ever gets to. */
const worstByPost = new Map<string, { reach: number; up: number; t: number }>();
for (const post of posts) {
  const dx = post.topX - post.footX;
  const dy = post.topY - post.footY;
  const dz = post.topZ - post.footZ;
  const length = Math.hypot(dx, dy, dz) || 1;
  for (let along = 0; along <= length; along += POST_STEP) {
    const t = along / length;
    const up = dy * t;
    if (up < CAT_BUS_BODY_BOTTOM_Y || up > CAT_BUS_BODY_TOP_Y) continue;
    const x = post.footX + dx * t;
    const z = post.footZ + dz * t;
    const radius = (POST_FOOT_RADIUS + (POST_TOP_RADIUS - POST_FOOT_RADIUS) * t) * post.across;
    for (let at = brow; at >= -brow; at -= STEP) {
      const station = entranceRoadAt(at);
      const ddx = x - station.x;
      const ddz = z - station.z;
      const along2 = Math.abs(ddx * station.headingX + ddz * station.headingZ) - halfLength;
      const across2 = Math.abs(ddx * -station.headingZ + ddz * station.headingX) - halfWidth;
      const outside = Math.hypot(Math.max(0, along2), Math.max(0, across2));
      const inside = along2 <= 0 && across2 <= 0 ? Math.min(-along2, -across2) : -outside;
      const reach = inside + radius;
      const seen = worstByPost.get(post.id);
      if (reach > 0 && (!seen || reach > seen.reach)) {
        worstByPost.set(post.id, { reach, up, t });
      }
    }
  }
}

process.stdout.write(`seed ${PARK_SEED}: ${posts.length} posts drawn, ${worstByPost.size} in the bus\n`);
process.stdout.write(
  `bus body occupies ${CAT_BUS_BODY_BOTTOM_Y.toFixed(2)} .. ${CAT_BUS_BODY_TOP_Y.toFixed(2)} m up\n\n`,
);
process.stdout.write(
  'post              reach   at up   drawn rise  horiz lean  foot outside corridor  lean at bus top\n',
);
for (const [id, worst] of [...worstByPost].sort((a, b) => b[1].reach - a[1].reach)) {
  const post = posts.find((p) => p.id === id)!;
  const rise = post.topY - post.footY;
  const lean = Math.hypot(post.topX - post.footX, post.topZ - post.footZ);
  const footOutside = distanceToEntranceCorridor(post.footX, post.footZ);
  const leanAtBusTop = lean * Math.min(1, CAT_BUS_BODY_TOP_Y / rise);
  process.stdout.write(
    `${id.padEnd(16)} ${worst.reach.toFixed(2).padStart(6)} ${worst.up.toFixed(2).padStart(7)} ` +
      `${rise.toFixed(2).padStart(11)} ${lean.toFixed(2).padStart(11)} ${footOutside.toFixed(2).padStart(22)} ` +
      `${leanAtBusTop.toFixed(2).padStart(16)}\n`,
  );
}
