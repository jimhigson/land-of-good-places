/**
 * **Is the slide's trough open to the sky, or tipped sideways?**
 *
 * `SlideRide.sampleFrames` built its cross-section frame against world `+Y`,
 * and the class docblock promised that "however the slide loops, the bit you sit
 * in faces the sky". On a flat park those are the same sentence. On a sphere
 * they are not: the ginormous slide runs 99-148 m from the park's centre, where
 * the ground leans by tens of degrees, so a trough held open towards world `+Y`
 * is banked by that much against the ground it runs over — and a child slides
 * down a chute tipped sideways.
 *
 * This measures the angle between the trough's own up and the local up, along
 * the whole chute. Controls first.
 */
import { CatmullRomCurve3, Vector3 } from 'three';
import { SLIDE_PLAN } from '../src/world/slide/plan';
import { placeOnSphere, terrainHeight } from '../src/world/terrain';
import { upFor } from '../src/world/up';
import { Quaternion } from 'three';

const WORLD_UP = new Vector3(0, 1, 0);
const deg = (a: Vector3, b: Vector3): number =>
  (Math.acos(Math.min(1, Math.max(-1, a.dot(b)))) * 180) / Math.PI;

// Control 1: at the park's origin the local up IS world up.
{
  const up = upFor(0, terrainHeight(0, 0), 0, new Vector3());
  console.log(`control 1  local up at the origin vs world up: ${deg(up, WORLD_UP).toFixed(3)}°`);
}
// Control 2: at 157 m the cap table says 45.5°.
{
  const up = upFor(157, terrainHeight(157, 0), 0, new Vector3());
  console.log(`control 2  local up at r=157 vs world up: ${deg(up, WORLD_UP).toFixed(2)}°  (table: 45.5°)`);
}

const points = SLIDE_PLAN.points;
const flatCurve = new CatmullRomCurve3(points.map((p) => p.clone()), false, 'catmullrom', 0.5);
const spin = new Quaternion();
const leantPoints = points.map((p) => {
  const out = new Vector3();
  placeOnSphere(p, 0, out, spin);
  return out;
});
const leantCurve = new CatmullRomCurve3(leantPoints, false, 'catmullrom', 0.5);

/**
 * **The trough's BANK, in degrees** — not its pitch.
 *
 * The first version of this measured the angle between the trough's up and the
 * local up, and that conflates two quite different things: a chute that dives
 * steeply *should* have its up tilted away from the local up by the slope, and
 * that is the ride working. What matters is the **roll** — whether the axis
 * across the trough stays level with the ground, or one lip is higher than the
 * other so a child slides into the side of it.
 *
 * `right` is the across-chute axis `sampleFrames` builds. If the trough is not
 * banked it is perpendicular to the local up, so the bank is how far off
 * perpendicular it has gone.
 */
function troughBank(curve: CatmullRomCurve3, t: number, sky: Vector3, localUp: Vector3): number {
  const tangent = curve.getTangentAt(t, new Vector3()).normalize();
  const right = new Vector3().crossVectors(tangent, sky);
  if (right.lengthSq() < 1e-6) right.set(1, 0, 0);
  right.normalize();
  return Math.abs(90 - deg(right, localUp));
}

const localUp = new Vector3();
let worstBefore = 0;
let worstAfter = 0;
let worstAtR = 0;
const steps = 200;
for (let i = 0; i <= steps; i += 1) {
  const t = i / steps;
  // BEFORE: flat points, trough built against world +Y.
  const flatAt = flatCurve.getPointAt(t, new Vector3());
  upFor(flatAt.x, flatAt.y, flatAt.z, localUp);
  const before = troughBank(flatCurve, t, WORLD_UP, localUp);
  // AFTER: leaned points, trough built against the local up.
  const leantAt = leantCurve.getPointAt(t, new Vector3());
  upFor(leantAt.x, leantAt.y, leantAt.z, localUp);
  const after = troughBank(leantCurve, t, localUp, localUp);
  if (before > worstBefore) {
    worstBefore = before;
    worstAtR = Math.hypot(flatAt.x, flatAt.z);
  }
  if (after > worstAfter) worstAfter = after;
}

console.log(`\nginormous slide, ${points.length} points, ${steps + 1} samples:`);
console.log(`  trough BANK (roll off level), BEFORE: worst ${worstBefore.toFixed(2)}° (at r = ${worstAtR.toFixed(0)} m)`);
console.log(`  trough BANK (roll off level), AFTER : worst ${worstAfter.toFixed(2)}°`);
console.log(
  `\n  a trough banked ${worstBefore.toFixed(0)}° tips a child sideways across it; the chute's own\n` +
    `  half-width is ${(0.9).toFixed(2)} m, so that is ${(Math.sin((worstBefore * Math.PI) / 180) * 0.9).toFixed(2)} m of sideways fall across the trough.`,
);
