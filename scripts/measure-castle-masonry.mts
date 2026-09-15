/**
 * Scratch measurement for issue #625: how high is the castle's stonework,
 * measured with a plumb line (AABB `max.y`) and measured radially (distance
 * from the planet's centre)? And where does the chute cross the south wall,
 * in both frames?
 *
 * Not a check. Deleted before the PR opens.
 */
import './headless-canvas.mjs';
import { Box3, Mesh, Vector3 } from 'three';
import { buildHeadlessPark } from './park-harness.mts';
import { GROUND_SPHERE_RADIUS, BUILDING_HALF_X, BUILDING_HALF_Z } from '../src/core/constants.ts';

const R = GROUND_SPHERE_RADIUS;
const radiusOf = (x: number, y: number, z: number): number => Math.hypot(x, y + R, z);

const { world, scene } = buildHeadlessPark();
scene.updateMatrixWorld(true);

// --- the masonry ----------------------------------------------------------
let boxTopY = -Infinity;
let bestRadius = -Infinity;
const bestAt = new Vector3();
let bestName = '';
const names: string[] = [];

const box = new Box3();
const v = new Vector3();

scene.traverse((object) => {
  if (!/^(castle-wall-|crenellations$)/.test(object.name)) return;
  names.push(object.name);
  box.setFromObject(object);
  if (box.max.y > boxTopY) boxTopY = box.max.y;

  object.traverse((node) => {
    if (!(node instanceof Mesh)) return;
    const pos = node.geometry.getAttribute('position');
    if (!pos) return;
    node.updateWorldMatrix(true, false);
    for (let i = 0; i < pos.count; i += 1) {
      v.fromBufferAttribute(pos, i).applyMatrix4(node.matrixWorld);
      const r = radiusOf(v.x, v.y, v.z);
      if (r > bestRadius) {
        bestRadius = r;
        bestAt.copy(v);
        bestName = node.name || object.name;
      }
    }
  });
});

console.log('masonry objects matched   :', names.length, names.join(', '));
console.log('AABB max.y                :', boxTopY.toFixed(3));
console.log('radial top (r)            :', bestRadius.toFixed(3), ` => r - R = ${(bestRadius - R).toFixed(3)}`);
console.log('  at world                :', bestAt.toArray().map((n) => n.toFixed(2)).join(', '));
console.log('  on mesh                 :', bestName);
console.log('under-report              :', (bestRadius - R - boxTopY).toFixed(3));

// --- the roof garden ------------------------------------------------------
{
  let roofRoot: import('three').Object3D | null = null;
  scene.traverse((o) => { if (o.name === 'castle-roof-garden') roofRoot = o; });
  if (roofRoot) {
    const b = new Box3().setFromObject(roofRoot);
    let rBest = -Infinity;
    const rAt = new Vector3();
    (roofRoot as import('three').Object3D).traverse((node) => {
      if (!(node instanceof Mesh)) return;
      const pos = node.geometry.getAttribute('position');
      if (!pos) return;
      node.updateWorldMatrix(true, false);
      for (let i = 0; i < pos.count; i += 1) {
        v.fromBufferAttribute(pos, i).applyMatrix4(node.matrixWorld);
        const r = radiusOf(v.x, v.y, v.z);
        if (r > rBest) { rBest = r; rAt.copy(v); }
      }
    });
    console.log('\nroof garden AABB max.y    :', b.max.y.toFixed(3));
    console.log('roof garden radial top    :', rBest.toFixed(3), ` => r - R = ${(rBest - R).toFixed(3)}`);
    console.log('  at world                :', rAt.toArray().map((n) => n.toFixed(2)).join(', '));
  } else {
    console.log('\nno castle-roof-garden found');
  }
}

// --- the chute crossing the south wall ------------------------------------
const slide = world.building.ginormousSlide;
slide.group.updateMatrixWorld(true);
if (slide.group.parent) slide.group.parent.updateMatrixWorld(true);
const chute: [number, number, number][] = [];
{
  const probe = new Vector3();
  const steps = Math.max(96, Math.round(slide.length / 0.4));
  for (let i = 0; i <= steps; i += 1) {
    slide.pointAt(i / steps, probe);
    slide.group.localToWorld(probe);
    chute.push([probe.x, probe.y, probe.z]);
  }
}

const { BUILDING_CENTRE_X, BUILDING_CENTRE_Z } = await import('../src/world/building/layout.ts');
void BUILDING_CENTRE_X;
void BUILDING_HALF_X;
const wallZ = BUILDING_CENTRE_Z + BUILDING_HALF_Z;

let crossing: { x: number; y: number; z: number } | null = null;
for (let i = 1; i < chute.length; i += 1) {
  const before = chute[i - 1]!;
  const here = chute[i]!;
  if (before[2] > wallZ || here[2] < wallZ) continue;
  const span = here[2] - before[2];
  const t = Math.abs(span) < 1e-9 ? 0 : (wallZ - before[2]) / span;
  crossing = {
    x: before[0] + (here[0] - before[0]) * t,
    y: before[1] + (here[1] - before[1]) * t,
    z: wallZ,
  };
  break;
}

const CHUTE_HALF_WIDTH = 1.11;
console.log('\nsouth wall plane z        :', wallZ.toFixed(3));
if (!crossing) {
  console.log('chute never crosses it');
} else {
  const cr = radiusOf(crossing.x, crossing.y, crossing.z);
  console.log('crossing world            :', `${crossing.x.toFixed(2)}, ${crossing.y.toFixed(2)}, ${crossing.z.toFixed(2)}`);
  console.log('crossing radius           :', cr.toFixed(3), ` => r - R = ${(cr - R).toFixed(3)}`);
  console.log('--- plumb-line frame (what ships today) ---');
  console.log('  underside y             :', (crossing.y - CHUTE_HALF_WIDTH).toFixed(3));
  console.log('  stone top y             :', boxTopY.toFixed(3));
  console.log('  clearance               :', (crossing.y - CHUTE_HALF_WIDTH - boxTopY).toFixed(3));
  console.log('--- radial frame (the honest one) ---');
  console.log('  underside radius        :', (cr - CHUTE_HALF_WIDTH).toFixed(3));
  console.log('  stone top radius        :', bestRadius.toFixed(3));
  console.log('  clearance               :', (cr - CHUTE_HALF_WIDTH - bestRadius).toFixed(3));
  console.log('--- the frame mix in the issue (radial stone vs plumb underside) ---');
  console.log('  clearance               :', (crossing.y - CHUTE_HALF_WIDTH - (bestRadius - R)).toFixed(3));
}
