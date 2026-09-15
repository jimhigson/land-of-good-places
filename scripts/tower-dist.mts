import './headless-canvas.mjs';
import { Matrix4, Quaternion, Vector3, type InstancedMesh } from 'three';
import { buildHeadlessPark } from './park-harness.mts';
const park = buildHeadlessPark();
park.scene.updateMatrixWorld(true);
let bodies: InstancedMesh | undefined; let facade: any;
park.scene.traverse((o) => { if (o.name === 'tower-bodies') bodies = o as InstancedMesh; if (o.name === 'building-facade') facade = o; });
if (!bodies || !facade) { console.log('NOT FOUND'); process.exit(1); }
const anchor = facade.getWorldPosition(new Vector3());
const m = new Matrix4();
console.log('facade anchor world:', anchor.toArray().map(n=>n.toFixed(3)).join(', '));
for (let i=0;i<bodies.count;i++){
  bodies.getMatrixAt(i, m);
  const p = new Vector3(); m.decompose(p, new Quaternion(), new Vector3());
  const w = bodies.localToWorld(p.clone());
  console.log(`  instance ${i}: local(${p.x.toFixed(3)}, ${p.y.toFixed(3)}, ${p.z.toFixed(3)})  world dist from anchor ${w.distanceTo(anchor).toFixed(3)} m`);
}
