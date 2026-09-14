/**
 * A bench for `geo/bend.ts`, run by hand while building it. Not a check — the
 * shipped assertion lives in `test/procgen/invariants.ts`.
 */
import { BoxGeometry, CylinderGeometry, InstancedMesh, Matrix4, Mesh, MeshBasicMaterial, Object3D, Quaternion, Vector3 } from 'three';
import { Frame } from '../src/world/geo/Frame.ts';
import { Geo, PLANET_RADIUS } from '../src/world/geo/Geo.ts';
import { curvedChart, resetCharts } from '../src/world/geo/Chart.ts';
import { bendError, bendOntoPlanet, bentFrame, segmentsFor } from '../src/world/geo/bend.ts';

resetCharts();

// The castle stands about 150 m out from the park's origin; put the anchor
// there so the numbers are the ones the real building sees.
// The anchor must sit ON the sphere: `Chart.toGeo` reads a local `y` as an
// altitude above PLANET_RADIUS, so a chart anchored off it would shift the whole
// structure by the difference. Getting this wrong is what made an earlier run of
// this probe report a 46 m 'rigid vs bent gap' that was nothing but the anchor
// floating 45 m up.
const centre = Geo.fromWorld(105, 0, -105).setRadius(PLANET_RADIUS);
const chart = curvedChart('probe', Frame.fromBearing(centre, 0.4));

const v = (x: number, y: number, z: number) => new Vector3(x, y, z);

console.log('anchor world', centre.toWorld(new Vector3()).toArray().map((n) => n.toFixed(2)).join(', '));

// 1. The control: does the bent basis agree with the exp map's own tangent?
let worst = 0;
for (let x = -12; x <= 12; x += 1.5) {
  for (let z = -12; z <= 12; z += 1.5) {
    for (const y of [0, 6, 14]) {
      const e = bendError(chart, v(x, y, z));
      if (e > worst) worst = e;
    }
  }
}
console.log('worst bendError over a 24x24 m footprint:', worst.toExponential(3), 'm of arc');

// 2. The thing Jim asked about: do the four corner towers splay?
const HALF_X = 12;
const HALF_Z = 9;
const corners = [
  ['-x -z', -HALF_X, -HALF_Z],
  ['+x -z', HALF_X, -HALF_Z],
  ['-x +z', -HALF_X, HALF_Z],
  ['+x +z', HALF_X, HALF_Z],
] as const;
const ups = corners.map(([name, x, z]) => {
  const f = bentFrame(chart, v(x, 0, z));
  const up = new Vector3(0, 1, 0).applyQuaternion(f.q);
  return { name, up };
});
for (const a of ups) {
  for (const b of ups) {
    if (a.name >= b.name) continue;
    const deg = (Math.acos(Math.min(1, a.up.dot(b.up))) * 180) / Math.PI;
    console.log(`splay ${a.name} vs ${b.name}: ${deg.toFixed(3)}°`);
  }
}
const anchorUp = new Vector3(0, 1, 0).applyQuaternion(chart.anchor.q);
for (const a of ups) {
  const deg = (Math.acos(Math.min(1, a.up.dot(anchorUp))) * 180) / Math.PI;
  console.log(`  tower ${a.name} leans ${deg.toFixed(3)}° off the castle's centre up`);
}

// 3. Does a bent tower's up actually match the radial at its own foot?
for (const [name, x, z] of corners) {
  const f = bentFrame(chart, v(x, 0, z));
  const claimed = new Vector3(0, 1, 0).applyQuaternion(f.q);
  const radial = f.at.up(new Vector3());
  console.log(`  ${name} up-vs-radial residual:`, claimed.distanceTo(radial).toExponential(2));
}

// 4. What the rigid tilt costs: how far a corner drawn rigidly sits from where
//    the bend puts it. This is the error the castle ships today.
{
  // The rigid frame must be the chart's own anchor frame, bearing included.
  // Building it from a minimal +Y->up tilt instead drops the anchor's bearing,
  // and the bend then reads as a 6 m re-yaw rather than a 0.5 m bend — which is
  // what this probe reported until the frames were made to agree.
  const tilt = chart.anchor.q;
  const origin = centre.toWorld(new Vector3());
  let worstGap = 0;
  for (const [name, x, z] of corners) {
    for (const h of [0, 14.8]) {
      const bent = bentFrame(chart, v(x, h, z)).at.toWorld(new Vector3());
      const flat = new Vector3(x, h, z).applyQuaternion(tilt).add(origin);
      const gap = bent.distanceTo(flat);
      if (gap > worstGap) worstGap = gap;
      console.log(`  ${name} at h=${h}: rigid is ${gap.toFixed(3)} m from bent`);
    }
  }
  console.log('worst rigid-vs-bent gap:', worstGap.toFixed(3), 'm');
}

// 5. The real shape of the castle's towers: four INSTANCES in one InstancedMesh,
//    which is why re-parenting children could never have splayed them.
{
  const root = new Object3D();
  root.name = 'building-facade';
  root.position.copy(centre.toWorld(new Vector3()));
  // Same contract: the structure's rigid frame IS the chart's anchor frame.
  root.quaternion.copy(chart.anchor.q);

  const bodies = new InstancedMesh(
    new CylinderGeometry(2.05, 2.214, 10.6, 16),
    new MeshBasicMaterial(),
    4,
  );
  bodies.name = 'tower-bodies';
  const m = new Matrix4();
  corners.forEach(([, x, z], i) => {
    m.compose(new Vector3(x, 5.3, z), new Quaternion(), new Vector3(1, 1, 1));
    bodies.setMatrixAt(i, m);
  });
  root.add(bodies);

  // And one merged wall band standing in for `castle-wall-lower`.
  const wall = new Mesh(new BoxGeometry(24.45, 3.6, 0.45), new MeshBasicMaterial());
  wall.name = 'castle-wall-lower';
  wall.position.set(0, 1.8, -9);
  root.add(wall);

  const before = wall.geometry.getAttribute('position').array.slice() as Float32Array;

  const report = bendOntoPlanet(root, chart, 0);
  console.log('report', JSON.stringify(report, (_k, val) =>
    typeof val === 'number' ? Number(val.toFixed(4)) : val));
  console.log('tree after bend:', root.children.map((c) => `${c.name}(${c.type})`).join(', '));

  // The towers, read back out of the instance matrices exactly as a renderer
  // would, and turned into the one number Jim asked about.
  root.updateMatrixWorld(true);
  const ups = corners.map(([name], i) => {
    bodies.getMatrixAt(i, m);
    const q = new Quaternion();
    m.decompose(new Vector3(), q, new Vector3());
    const up = new Vector3(0, 1, 0)
      .applyQuaternion(q)
      .applyQuaternion(bodies.getWorldQuaternion(new Quaternion()));
    return { name, up };
  });
  console.log('--- tower splay, read back from the instance matrices ---');
  for (const a of ups) {
    for (const b of ups) {
      if (a.name >= b.name) continue;
      const deg = (Math.acos(Math.min(1, a.up.dot(b.up))) * 180) / Math.PI;
      console.log(`  ${a.name} vs ${b.name}: ${deg.toFixed(3)}°`);
    }
  }
  // And each tower's up against the true radial under its own foot.
  corners.forEach(([name, x, z], i) => {
    bodies.getMatrixAt(i, m);
    const p = new Vector3();
    m.decompose(p, new Quaternion(), new Vector3());
    const footWorld = bodies.localToWorld(p.clone());
    const radial = Geo.fromWorldVector(footWorld).up(new Vector3());
    const deg = (Math.acos(Math.min(1, ups[i]!.up.dot(radial))) * 180) / Math.PI;
    console.log(`  ${name} up vs the radial at its own foot: ${deg.toFixed(4)}°`);
    void x; void z;
  });

  const after = wall.geometry.getAttribute('position').array as Float32Array;
  let worstVertex = 0;
  for (let i = 0; i < after.length; i += 3) {
    const d = Math.hypot(after[i]! - before[i]!, after[i + 1]! - before[i + 1]!, after[i + 2]! - before[i + 2]!);
    if (d > worstVertex) worstVertex = d;
  }
  console.log('worst wall vertex displacement:', worstVertex.toFixed(4), 'm');
}

console.log('segmentsFor(24 m):', segmentsFor(24), 'segmentsFor(9 m):', segmentsFor(9));
console.log('PLANET_RADIUS', PLANET_RADIUS);
