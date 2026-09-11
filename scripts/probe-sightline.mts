/**
 * **Which planter put a thing in front of the arriving bus, and what did it
 * think that thing's height was?**
 *
 * `test:procgen` flags foliage hiding the bus on seeds 5 and 11. Both the
 * planter (`Scenery.ts`) and the test call the same `hidesTheArrivingBus`, so
 * the disagreement has to be in the *arguments*: a nominal height that the built
 * model exceeds, or a position the planter asked about that the instance does
 * not stand at. This prints the offenders with the group that owns them.
 *
 * ```
 * LGP_SEED=5 node --no-warnings --import ./scripts/ts-extension-resolver-register.mjs scripts/probe-sightline.mts
 * ```
 */
import './headless-canvas.mjs';
import { InstancedMesh, Matrix4, Vector3, type Object3D } from 'three';
import { buildHeadlessPark } from './park-harness.mts';
import { PARK_SEED } from '../src/world/parkManifest.ts';
import { hidesTheArrivingBus } from '../src/world/entrance/arrivalSightline.ts';
import { terrainHeight } from '../src/world/terrain.ts';

const park = buildHeadlessPark();

/** The named ancestor a planter would recognise — `foliage` or `treeline`. */
function owner(object: Object3D): string {
  let at: Object3D | null = object;
  while (at) {
    if (at.name === 'foliage' || at.name === 'treeline') return at.name;
    at = at.parent;
  }
  return '(neither)';
}

const matrix = new Matrix4();
const at = new Vector3();
const scale = new Vector3();
const roots: Object3D[] = [];
park.scene.traverse((object) => {
  if (object.name === 'foliage' || object.name === 'treeline') roots.push(object);
});

console.log(`seed ${PARK_SEED}`);
let found = 0;
for (const root of roots) {
  root.traverse((object) => {
    if (!(object instanceof InstancedMesh)) return;
    object.geometry.computeBoundingBox();
    const bounds = object.geometry.boundingBox;
    if (!bounds) return;
    for (let index = 0; index < object.count; index += 1) {
      object.getMatrixAt(index, matrix);
      matrix.premultiply(object.matrixWorld);
      at.setFromMatrixPosition(matrix);
      scale.setFromMatrixScale(matrix);
      const top = at.y + bounds.max.y * scale.y;
      if (!hidesTheArrivingBus(at.x, at.z, top)) continue;
      found += 1;
      const ground = terrainHeight(at.x, at.z);
      console.log(
        `  ${owner(object).padEnd(9)} ${object.name.padEnd(16)} at ${at.x.toFixed(2)}, ${at.z.toFixed(2)}  ` +
          `top ${top.toFixed(2)}  centreY ${at.y.toFixed(2)}  scaleY ${scale.y.toFixed(2)}  ` +
          `geomMaxY ${bounds.max.y.toFixed(2)}  groundHere ${ground.toFixed(2)}  ` +
          `heightAboveGround ${(top - ground).toFixed(2)}`,
      );
    }
  });
}
if (found === 0) console.log('  nothing hides the arriving bus on this seed');
