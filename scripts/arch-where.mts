import './headless-canvas.mjs';
import { Box3, Vector3 } from 'three';
import { buildHeadlessPark } from './park-harness.mts';
const park = buildHeadlessPark();
park.scene.updateMatrixWorld(true);
const a = park.scene.getObjectByName('park-gate-arch');
if (!a) { console.log('park-gate-arch NOT IN SCENE'); process.exit(1); }
const root = a.getWorldPosition(new Vector3());
const box = new Box3().setFromObject(a);
const c = box.getCenter(new Vector3());
console.log('root world  ', root.toArray().map(n=>n.toFixed(2)).join(', '));
console.log('drawn centre', c.toArray().map(n=>n.toFixed(2)).join(', '));
console.log('centre is', c.distanceTo(root).toFixed(2), 'm from its own root');
let vis = true; let o: any = a; const chain: string[] = [];
while (o) { chain.push(`${o.name||o.type}=${o.visible}`); if (!o.visible) vis = false; o = o.parent; }
console.log('visible chain:', chain.join(' < '));
