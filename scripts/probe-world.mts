import './headless-dom.mjs';
import { Vector3 } from 'three';
await import('./headless-canvas.mjs');
const { Scene } = await import('three');
const { World } = await import('../src/world/World.ts');
const { Sky } = await import('../src/world/Sky.ts');
const { IsoCamera } = await import('../src/core/IsoCamera.ts');
const liveControls = { cancelWalk: () => {}, iris: (m: () => void) => m(), flash: () => {}, snapCamera: () => {} };
const scene = new Scene();
const world = new World(scene, new Sky(), liveControls as never, new IsoCamera());
scene.updateMatrixWorld(true);
// hash the whole scene graph: names in traversal order + world positions
const parts: string[] = [];
const v = new Vector3();
scene.traverse((o: any) => {
  v.setFromMatrixPosition(o.matrixWorld);
  parts.push(`${o.type}|${o.name}|${v.x.toExponential(17)},${v.y.toExponential(17)},${v.z.toExponential(17)}`);
});
const crypto = await import('node:crypto');
console.log('nodes', parts.length);
console.log('sceneHash', crypto.createHash('sha256').update(parts.join('\n')).digest('hex'));
// also the slide chute
const slide = (world as any).building.ginormousSlide;
slide.group.updateMatrixWorld(true);
const probe = new Vector3();
const chute: string[] = [];
for (let i = 0; i <= 400; i++) { slide.pointAt(i / 400, probe); const w = slide.group.localToWorld(probe.clone()); chute.push(`${w.x.toExponential(17)},${w.y.toExponential(17)},${w.z.toExponential(17)}`); }
console.log('chuteHash', crypto.createHash('sha256').update(chute.join('\n')).digest('hex'));
