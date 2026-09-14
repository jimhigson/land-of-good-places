/**
 * A bench for `geo/bend.ts`, run by hand while building it. Not a check — the
 * shipped assertion lives in `test/procgen/invariants.ts`.
 */
import { Object3D, Quaternion, Vector3 } from 'three';
import { Frame } from '../src/world/geo/Frame.ts';
import { Geo, PLANET_RADIUS } from '../src/world/geo/Geo.ts';
import { curvedChart, resetCharts } from '../src/world/geo/Chart.ts';
import { bendChildren, bendError, bentFrame, segmentsFor } from '../src/world/geo/bend.ts';

resetCharts();

// The castle stands about 150 m out from the park's origin; put the anchor
// there so the numbers are the ones the real building sees.
const centre = Geo.fromWorld(105, 0, -105);
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
//    the bend puts it.
{
  const rigid = new Vector3(0, 1, 0).applyQuaternion(chart.anchor.q);
  const tilt = new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), rigid);
  let worstGap = 0;
  for (const [name, x, z] of corners) {
    for (const h of [0, 14]) {
      const bent = bentFrame(chart, v(x, h, z)).at.toWorld(new Vector3());
      const flat = new Vector3(x, h, z)
        .applyQuaternion(tilt)
        .add(centre.toWorld(new Vector3()));
      const gap = bent.distanceTo(flat);
      if (gap > worstGap) worstGap = gap;
      console.log(`  ${name} at h=${h}: rigid is ${gap.toFixed(3)} m from bent`);
    }
  }
  console.log('worst rigid-vs-bent gap:', worstGap.toFixed(3), 'm');
}

// 5. bendChildren keeps the tree and re-solves the transforms.
{
  const group = new Object3D();
  group.position.copy(centre.toWorld(new Vector3()));
  for (const [name, x, z] of corners) {
    const tower = new Object3D();
    tower.name = `castle-tower-${name}`;
    tower.position.set(x, 3, z);
    tower.rotation.y = 0.7;
    group.add(tower);
  }
  bendChildren(group, chart, 0);
  group.updateMatrixWorld(true);
  console.log('children after bend:', group.children.map((c) => c.name).join(', '));
  console.log('group quaternion is identity:', group.quaternion.equals(new Quaternion()));
  const worldUps = group.children.map((c) =>
    new Vector3(0, 1, 0).applyQuaternion(c.getWorldQuaternion(new Quaternion())),
  );
  const spread =
    (Math.acos(Math.min(1, worldUps[0]!.dot(worldUps[3]!))) * 180) / Math.PI;
  console.log('diagonal tower splay through the scene graph:', spread.toFixed(3), '°');
}

console.log('segmentsFor(24 m):', segmentsFor(24), 'segmentsFor(9 m):', segmentsFor(9));
console.log('PLANET_RADIUS', PLANET_RADIUS);
