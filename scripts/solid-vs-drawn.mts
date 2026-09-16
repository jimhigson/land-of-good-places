import './headless-canvas.mjs';
import { Matrix4, Quaternion, Vector3, type InstancedMesh } from 'three';
import { buildHeadlessPark } from './park-harness.mts';
import { CASTLE_TOWERS } from '../src/world/building/layout.ts';
import { TOWER_HEIGHT } from '../src/world/building/layout.ts';
const park = buildHeadlessPark();
park.scene.updateMatrixWorld(true);
let bodies: InstancedMesh | undefined;
park.scene.traverse((o) => { if (o.name === 'tower-bodies') bodies = o as InstancedMesh; });
if (!bodies) { console.log('no tower-bodies'); process.exit(1); }
const m = new Matrix4();
const solids = CASTLE_TOWERS.filter(t => t.name.startsWith('tower-body-'));
console.log('drawn instance foot/axis vs the CASTLE_TOWERS solid a ride routes around:');
for (let i=0;i<bodies.count;i++){
  bodies.getMatrixAt(i,m);
  const p=new Vector3(), q=new Quaternion(), sc=new Vector3();
  m.decompose(p,q,sc);
  const axis = new Vector3(0,1,0).applyQuaternion(q).applyQuaternion(bodies.getWorldQuaternion(new Quaternion())).normalize();
  const centre = bodies.localToWorld(p.clone());
  // the drawn shaft runs TOWER_HEIGHT along its own axis, centred at `centre`
  const foot = centre.clone().addScaledVector(axis, -TOWER_HEIGHT/2);
  // nearest declared solid
  let best = solids[0]!, bestD = Infinity;
  for (const s of solids) { const d = Math.hypot(s.x-foot.x, s.z-foot.z); if (d<bestD){bestD=d;best=s;} }
  const sAxis = new Vector3(best.axisX,best.axisY,best.axisZ);
  const deg = Math.acos(Math.min(1,Math.max(-1,axis.dot(sAxis))))*180/Math.PI;
  const footGap = Math.hypot(best.x-foot.x, best.bottomY-foot.y, best.z-foot.z);
  console.log(`  ${best.name}: foot gap ${footGap.toFixed(3)} m, axis differs ${deg.toFixed(3)} deg`);
}
