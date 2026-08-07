/**
 * **Does the ginormous slide clip the castle's corner towers?**
 *
 * Jim rode it and said it does. This measures whether it does, and by how much,
 * before anything is changed — a fix for a bug nobody measured is a fix nobody
 * can defend.
 *
 * ### Why the towers were never checked
 *
 * `slide/plan.ts` exempts the castle and ball-pit plots from `clearOfPlots` —
 * it has to, their bounding circles overlap — and re-imposes the castle
 * "precisely, as its actual footprint rectangle". But the towers stand at
 * `(±outerX, ±outerZ)`, which is *outside* that rectangle, and bulge a further
 * ~2.45 m beyond it. So the one solid the chute passes closest to is exactly
 * the one the rectangle excludes, and the chute wraps the south-east corner at
 * roof height by design.
 *
 * ### Measured off the built scene, not off the constants
 *
 * Tower positions and radii are read from the **instanced meshes that were
 * actually built**, through `getMatrixAt` per instance. Two traps this avoids:
 *
 * - `Box3.setFromObject` on an `InstancedMesh` returns the union of every
 *   instance — one park-sized box that every test passes.
 * - A headless park is never rendered, so every `matrixWorld` is the identity
 *   until something forces an update. Sampling without `updateMatrixWorld(true)`
 *   yields local coordinates wearing world coordinates' clothes.
 *
 * `LGP_SEED=n` to check any seed.
 */
import { InstancedMesh, Matrix4, Vector3 } from 'three';
import { buildHeadlessPark } from './park-harness.mts';
import { PARK_SEED } from '../src/world/parkManifest';
import { CHUTE_ENVELOPE } from '../src/world/building/SlideRide';

const { world, scene } = buildHeadlessPark();

// Compose every world matrix before reading a single one. See the note above.
scene.updateMatrixWorld(true);

interface Solid {
  readonly name: string;
  /** Axis position in world space. */
  readonly x: number;
  readonly z: number;
  /** World-space vertical span of the solid. */
  readonly bottomY: number;
  readonly topY: number;
  /** Radius at the bottom and at the top; linear between (cylinder or cone). */
  readonly radiusBottom: number;
  readonly radiusTop: number;
}

const solids: Solid[] = [];

scene.traverse((object) => {
  if (!(object instanceof InstancedMesh)) return;
  if (!/tower-(bodies|roofs)/.test(object.name)) return;

  const params = object.geometry.parameters as {
    radiusTop?: number;
    radiusBottom?: number;
    radius?: number;
    height: number;
  };
  // A cone reports `radius` (its base) and tapers to a point; a cylinder
  // reports both ends. Read whichever the built geometry actually carries
  // rather than assuming which mesh is which.
  const radiusBottom = params.radiusBottom ?? params.radius ?? 0;
  const radiusTop = params.radiusTop ?? 0;
  const height = params.height;

  const local = new Matrix4();
  const world4 = new Matrix4();
  const centre = new Vector3();
  for (let i = 0; i < object.count; i += 1) {
    object.getMatrixAt(i, local);
    world4.multiplyMatrices(object.matrixWorld, local);
    centre.setFromMatrixPosition(world4);
    solids.push({
      name: `${object.name}[${i}]`,
      x: centre.x,
      z: centre.z,
      bottomY: centre.y - height / 2,
      topY: centre.y + height / 2,
      radiusBottom,
      radiusTop,
    });
  }
});

/** The solid's radius at world height `y`, or null if `y` is outside it. */
function radiusAt(solid: Solid, y: number): number | null {
  if (y < solid.bottomY || y > solid.topY) return null;
  const span = solid.topY - solid.bottomY;
  const t = span <= 1e-9 ? 0 : (y - solid.bottomY) / span;
  return solid.radiusBottom + (solid.radiusTop - solid.radiusBottom) * t;
}

// The built chute, pushed out through the scene graph into world space.
const slide = world.building.ginormousSlide;
slide.group.updateMatrixWorld(true);
const probe = new Vector3();
const steps = Math.max(400, Math.round(slide.length / 0.15));

let worst = Infinity;
let worstAt: { x: number; y: number; z: number; solid: string } | null = null;
let overlapSamples = 0;

for (let i = 0; i <= steps; i += 1) {
  slide.pointAt(i / steps, probe);
  slide.group.localToWorld(probe);
  for (const solid of solids) {
    const radius = radiusAt(solid, probe.y);
    if (radius === null) continue;
    // Gap between the chute's outer edge and the solid's surface. Negative
    // means the trough is inside the masonry.
    const gap = Math.hypot(probe.x - solid.x, probe.z - solid.z) - radius - CHUTE_ENVELOPE.halfWidth;
    if (gap < worst) {
      worst = gap;
      worstAt = { x: probe.x, y: probe.y, z: probe.z, solid: solid.name };
    }
    if (gap < 0) overlapSamples += 1;
  }
}

{
  const a = new Vector3(); slide.pointAt(0, a); slide.group.localToWorld(a);
  const b = new Vector3(); slide.pointAt(1, b); slide.group.localToWorld(b);
  console.log(`chute start       (${a.x.toFixed(2)}, ${a.y.toFixed(2)}, ${a.z.toFixed(2)})`);
  console.log(`chute end         (${b.x.toFixed(2)}, ${b.y.toFixed(2)}, ${b.z.toFixed(2)})`);
}
console.log(`seed              ${PARK_SEED}`);
console.log(`tower solids      ${solids.length}`);
for (const solid of solids) {
  console.log(
    `  ${solid.name.padEnd(18)} axis (${solid.x.toFixed(2)}, ${solid.z.toFixed(2)}) ` +
      `y ${solid.bottomY.toFixed(2)}…${solid.topY.toFixed(2)} ` +
      `r ${solid.radiusBottom.toFixed(2)}→${solid.radiusTop.toFixed(2)}`,
  );
}
console.log(`chute samples     ${steps + 1}`);
console.log(`chute half-width  ${CHUTE_ENVELOPE.halfWidth.toFixed(2)} m`);
if (worstAt === null) {
  console.log('RESULT            the chute never reaches any tower height');
} else {
  console.log(
    `worst gap         ${worst.toFixed(3)} m against ${worstAt.solid} ` +
      `at (${worstAt.x.toFixed(2)}, ${worstAt.y.toFixed(2)}, ${worstAt.z.toFixed(2)})`,
  );
  console.log(`samples inside    ${overlapSamples}`);
  console.log(`RESULT            ${worst < 0 ? 'CLIPS' : 'clear'}`);
}
