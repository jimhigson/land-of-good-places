/**
 * Issue #625, measured two independent ways, on one seed (`LGP_SEED`).
 *
 * **A** — the invariant's own shape: one scalar for the stone, one for the
 *   chute's underside where it crosses the south wall plane. Reported in both
 *   frames, and in the mixed frame the issue quotes.
 * **B** — a control on A that shares none of its arithmetic: the shortest
 *   distance in space between the built chute's centre line and every triangle
 *   vertex of the built masonry. A clip needs this under `CHUTE_HALF_WIDTH`.
 *
 * Both are then run again against a **deliberately broken park** — the masonry
 * pushed radially outward until it must swallow the chute — so neither is
 * believed until it has been seen to fail.
 *
 * Not a check. Deleted before the PR opens.
 */
import './headless-canvas.mjs';
import { Box3, Mesh, Vector3 } from 'three';
import { buildHeadlessPark } from './park-harness.mts';
import { GROUND_SPHERE_RADIUS, BUILDING_HALF_Z } from '../src/core/constants.ts';

const R = GROUND_SPHERE_RADIUS;
const CHUTE_HALF_WIDTH = 1.11;
const rOf = (p: { x: number; y: number; z: number }): number => Math.hypot(p.x, p.y + R, p.z);

const { world, scene } = buildHeadlessPark();
scene.updateMatrixWorld(true);
const { BUILDING_CENTRE_Z } = await import('../src/world/building/layout.ts');

// --- the masonry, as world vertices --------------------------------------
const stone: Vector3[] = [];
const box = new Box3();
let boxTopY = -Infinity;
{
  const v = new Vector3();
  scene.traverse((object) => {
    if (!/^(castle-wall-|crenellations$)/.test(object.name)) return;
    box.setFromObject(object);
    if (box.max.y > boxTopY) boxTopY = box.max.y;
    object.traverse((node) => {
      if (!(node instanceof Mesh)) return;
      const pos = node.geometry.getAttribute('position');
      if (!pos) return;
      node.updateWorldMatrix(true, false);
      for (let i = 0; i < pos.count; i += 1) {
        stone.push(v.fromBufferAttribute(pos, i).applyMatrix4(node.matrixWorld).clone());
      }
    });
  });
}

// --- the chute -----------------------------------------------------------
const slide = world.building.ginormousSlide;
slide.group.updateMatrixWorld(true);
if (slide.group.parent) slide.group.parent.updateMatrixWorld(true);
const chute: Vector3[] = [];
{
  const probe = new Vector3();
  const steps = Math.max(96, Math.round(slide.length / 0.4));
  for (let i = 0; i <= steps; i += 1) {
    slide.pointAt(i / steps, probe);
    slide.group.localToWorld(probe);
    chute.push(probe.clone());
  }
}

const wallZ = BUILDING_CENTRE_Z + BUILDING_HALF_Z;

/** Instrument A. `lift` pushes every stone vertex radially outward first. */
const instrumentA = (lift: number): string => {
  let topY = -Infinity;
  let topR = -Infinity;
  for (const s of stone) {
    const r = rOf(s) + lift;
    if (r > topR) topR = r;
    const k = r / rOf(s);
    const y = (s.y + R) * k - R;
    if (y > topY) topY = y;
  }
  let crossing: Vector3 | null = null;
  for (let i = 1; i < chute.length; i += 1) {
    const a = chute[i - 1]!;
    const b = chute[i]!;
    if (a.z > wallZ || b.z < wallZ) continue;
    const span = b.z - a.z;
    const t = Math.abs(span) < 1e-9 ? 0 : (wallZ - a.z) / span;
    crossing = new Vector3(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, wallZ);
    break;
  }
  if (!crossing) return 'A: the chute never crosses the south wall plane';
  const cr = rOf(crossing);
  const plumb = crossing.y - CHUTE_HALF_WIDTH - topY;
  const radial = cr - CHUTE_HALF_WIDTH - topR;
  const mixed = crossing.y - CHUTE_HALF_WIDTH - (topR - R);
  return (
    `A: crossing (${crossing.x.toFixed(2)}, ${crossing.y.toFixed(2)}) r=${cr.toFixed(3)}\n` +
    `     stone top: y ${topY.toFixed(3)} | r ${topR.toFixed(3)} (r-R ${(topR - R).toFixed(3)})\n` +
    `     clearance  plumb-y ${plumb.toFixed(3)} | RADIAL ${radial.toFixed(3)} ` +
    `${radial < 0 ? 'CLIP' : 'clear'} | mixed(issue) ${mixed.toFixed(3)}`
  );
};

/** Instrument B, sharing no arithmetic with A. */
const instrumentB = (lift: number): string => {
  let best = Infinity;
  let bc = new Vector3();
  let bs = new Vector3();
  const lifted = new Vector3();
  for (const s of stone) {
    const r = rOf(s);
    const k = (r + lift) / r;
    lifted.set(s.x * k, (s.y + R) * k - R, s.z * k);
    for (const c of chute) {
      const d = c.distanceTo(lifted);
      if (d < best) { best = d; bc = c.clone(); bs = lifted.clone(); }
    }
  }
  return (
    `B: closest centre-line-to-stone ${best.toFixed(3)} m ` +
    `${best < CHUTE_HALF_WIDTH ? 'CLIP' : `clear by ${(best - CHUTE_HALF_WIDTH).toFixed(3)} m of trough`}\n` +
    `     chute (${bc.x.toFixed(2)}, ${bc.y.toFixed(2)}, ${bc.z.toFixed(2)}) r=${rOf(bc).toFixed(3)}` +
    `  stone (${bs.x.toFixed(2)}, ${bs.y.toFixed(2)}, ${bs.z.toFixed(2)}) r=${rOf(bs).toFixed(3)}`
  );
};

console.log(`seed ${process.env['LGP_SEED']}: ${stone.length} masonry vertices, ${chute.length} chute samples`);
console.log(`  masonry AABB max.y ${boxTopY.toFixed(3)}  (the number that ships today)`);
for (const lift of [0, 6, 8, 12]) {
  console.log(`\n--- masonry pushed ${lift} m radially outward ---`);
  console.log('  ' + instrumentA(lift).replace(/\n/g, '\n  '));
  console.log('  ' + instrumentB(lift).replace(/\n/g, '\n  '));
}
