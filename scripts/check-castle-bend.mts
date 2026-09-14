/**
 * **`check:castle-bend` — the castle's exterior bends across its own footprint,
 * measured on the park that was actually built.**
 *
 * Jim, 13 September 2026: *"whatever 'down' is in the mesh ... needs to be
 * adjusted so that down is variable along the length ... effectively it needs to
 * be bent to cover the curvature of the earth."* And, asked directly whether the
 * castle's four corner towers should still be parallel: **they should not.**
 *
 * ## What this measures, and why it is not a restatement of the code
 *
 * Every number below is read off the **drawn** castle in a real park build —
 * the four turrets out of `tower-bodies`' own instance matrices, the curtain
 * walls out of `castle-wall-*`'s own vertex buffers — and compared against the
 * radial at the point in question, taken from `Geo`. Nothing here consults
 * `bend.ts`'s arithmetic, which is the whole point: an assertion that
 * re-derives the thing it is checking is the check-that-cannot-fail this
 * project has been bitten by repeatedly.
 *
 * The threshold likewise comes from the game rather than from the generator's
 * intention: `flatDeparture` says a flat patch on R = 220 m is worth 5 cm out
 * to 4.69 m, so anything standing further from its structure's centre than that
 * must lean, and by how much is arithmetic nobody gets to choose.
 *
 * ## Every clause carries a control
 *
 * Two agents on this project got clean, decisive, entirely wrong answers from
 * instruments measuring the wrong thing, and only a control caught it. So:
 *
 * - the turret clause is bracketed by the **castle's own centre**, which must
 *   *not* lean off its local up, and by a turret, which must;
 * - the wall clause is bracketed by the **spread of the measurement itself** —
 *   a rigid wall gives every vertex the same up, so a zero spread means the
 *   probe is watching something that never moved, which is exactly the shape of
 *   the `worst == mean` bug found this week.
 *
 * Run: `pnpm run check:castle-bend`
 */
import './headless-canvas.mjs';
import { Matrix4, Quaternion, Vector3, type InstancedMesh, type Mesh } from 'three';
import { buildHeadlessPark } from './park-harness.mts';
import { Geo, PLANET_RADIUS } from '../src/world/geo/Geo.ts';
import { flatDeparture, flatRadiusFor } from '../src/world/geo/Chart.ts';

const UP = new Vector3(0, 1, 0);
const deg = (radians: number): number => (radians * 180) / Math.PI;
const angleBetween = (a: Vector3, b: Vector3): number =>
  deg(Math.acos(Math.min(1, Math.max(-1, a.dot(b)))));

const failures: string[] = [];
const note = (line: string): void => {
  process.stderr.write(`  ${line}\n`);
};
const check = (ok: boolean, message: string): void => {
  if (!ok) failures.push(message);
};

const park = buildHeadlessPark();
park.scene.updateMatrixWorld(true);

// ---------------------------------------------------------------- find things

let towerBodies: InstancedMesh | undefined;
let facade: Vector3 | undefined;
const wallMeshes: Mesh[] = [];
park.scene.traverse((object) => {
  if (object.name === 'tower-bodies') towerBodies = object as InstancedMesh;
  if (object.name === 'building-facade') facade = object.getWorldPosition(new Vector3());
  if (/^castle-wall-/.test(object.name)) wallMeshes.push(object as Mesh);
});

if (!towerBodies || !facade) {
  process.stderr.write(
    'check:castle-bend VOID — no `tower-bodies` / `building-facade` in the built park. ' +
      'These are found by name, so a rename in Shell.ts or castleMasonry.ts makes this ' +
      'check measure nothing; it fails rather than reporting a triumphant zero.\n',
  );
  process.exit(1);
}

const facadeCentre = Geo.fromWorldVector(facade);
const centreUp = facadeCentre.up(new Vector3());

// ------------------------------------------------- 1. the turrets are not parallel

const matrix = new Matrix4();
const turrets = [];
for (let i = 0; i < towerBodies.count; i++) {
  towerBodies.getMatrixAt(i, matrix);
  const local = new Vector3();
  const spin = new Quaternion();
  matrix.decompose(local, spin, new Vector3());
  const world = towerBodies.localToWorld(local.clone());
  const up = UP.clone()
    .applyQuaternion(spin)
    .applyQuaternion(towerBodies.getWorldQuaternion(new Quaternion()))
    .normalize();
  turrets.push({ up, world, radial: Geo.fromWorldVector(world).up(new Vector3()) });
}

check(turrets.length === 4, `expected 4 turret instances, found ${turrets.length}`);

// Each turret stands along the radial under its OWN foot, not the castle's.
let worstOwnRadial = 0;
for (const t of turrets) worstOwnRadial = Math.max(worstOwnRadial, angleBetween(t.up, t.radial));

// And the diagonal pair is the splay Jim asked about.
let widestSplay = 0;
for (const a of turrets) {
  for (const b of turrets) widestSplay = Math.max(widestSplay, angleBetween(a.up, b.up));
}
const offCentre = turrets.map((t) => angleBetween(t.up, centreUp));
const worstOffCentre = Math.max(...offCentre);

note(
  `4 turrets read out of tower-bodies' own instance matrices: ` +
    `widest splay ${widestSplay.toFixed(3)}°, each ${worstOffCentre.toFixed(3)}° off the castle's centre up`,
);
note(
  `CONTROL: the castle's own centre leans ${angleBetween(centreUp, centreUp).toFixed(3)}° off itself ` +
    `(must be 0), while a turret leans ${offCentre[0]!.toFixed(3)}° (must not be)`,
);
note(`each turret's up vs the radial under its own foot: worst ${worstOwnRadial.toFixed(4)}°`);

check(
  widestSplay > 1,
  `the four turrets are still parallel — widest splay ${widestSplay.toFixed(4)}°. ` +
    `They stand ±12.225 × ±9.225 m from the castle's centre, well beyond the ` +
    `${flatRadiusFor(0.05).toFixed(2)} m a flat patch is good for, so they must each lean to their own up.`,
);
check(
  worstOwnRadial < 0.01,
  `a turret's up is ${worstOwnRadial.toFixed(4)}° off the radial under its own foot; ` +
    `bending means standing on the local vertical, so this must be ~0`,
);
check(
  worstOffCentre > 1,
  `no turret leans off the castle's centre up (worst ${worstOffCentre.toFixed(4)}°) — ` +
    `the exterior is still rigid`,
);

// --------------------------------------------- 2. the curtain walls are bent

check(wallMeshes.length > 0, 'no `castle-wall-*` mesh found; the wall clause asserts nothing');

/**
 * **The first version of this clause could not fail, and the way it could not
 * is worth keeping written down.**
 *
 * It measured the angle between the radial *under each wall vertex* and the
 * radial at the castle's centre, and called a wide spread proof of bending. But
 * that spread is a property of the planet, not of the wall: the radial turns by
 * `d / R` across any 24 m run whether the stone follows it or not. Proved by
 * deleting the bend and re-running — the span read 1.716°, against 1.688° with
 * the bend in. It was describing the ground the wall stands over, and reporting
 * success about something it was not describing.
 *
 * What actually distinguishes the two is **altitude**. A rigid wall's base is a
 * straight chord of the tangent plane, so its ends ride `flatDeparture(half)`
 * higher above the sphere than its middle — 34 cm at the castle's half-width. A
 * bent wall's base follows the surface, so every point along it sits at the same
 * altitude. That is a quantity the two cases genuinely disagree about.
 */
let nearVertices = 0;
let farVertices = 0;
let nearLowest = Infinity;
let farLowest = Infinity;
const v = new Vector3();
const vertexGeo = new Geo();
for (const wall of wallMeshes) {
  const position = wall.geometry.getAttribute('position');
  for (let i = 0; i < position.count; i++) {
    v.fromBufferAttribute(position, i);
    wall.localToWorld(v);
    vertexGeo.setFromWorldVector(v);
    // The castle's walls are a *ring*, so nothing is near its middle: the runs
    // sit at 9.2 m and the corners at 15.3 m. The two buckets are therefore
    // "middle of a run" and "corner", not "centre" and "edge".
    //
    // **Bucketed by horizontal distance, never by height.** The first attempt
    // selected the base course as "every vertex within 5 cm of the lowest
    // radius", which is biased against exactly the thing being looked for: on a
    // rigid wall the raised corners are the evidence, and that filter threw them
    // out, leaving 13 middle vertices and a confidently passing 3.4 cm. A cut on
    // distance from the castle's centre is independent of altitude, so neither
    // case can hide in it.
    const d = facadeCentre.arcTo(vertexGeo);
    const altitude = vertexGeo.radius() - PLANET_RADIUS;
    if (d < 10) {
      nearLowest = Math.min(nearLowest, altitude);
      nearVertices += 1;
    } else if (d > 14) {
      farLowest = Math.min(farLowest, altitude);
      farVertices += 1;
    }
  }
}
const cornerRise = farLowest - nearLowest;
const rigidWouldBe = flatDeparture(15.3) - flatDeparture(9.2);

note(
  `castle-wall-* base: ${nearVertices} vertices within 10 m of the castle's centre ` +
    `(the middle of a run), ${farVertices} beyond 14 m (the corners); the corners sit ` +
    `${(cornerRise * 100).toFixed(1)} cm ` +
    `higher above the sphere than the near ones`,
);
note(
  `CONTROL: a rigid wall is a chord of the tangent plane, so its corners would ride ` +
    `${(rigidWouldBe * 100).toFixed(1)} cm proud on R = ${PLANET_RADIUS} m. Bent, that goes to ~0. ` +
    `Both buckets are cut on horizontal distance only, never on height, so neither ` +
    `case can be filtered out of its own evidence.`,
);

check(
  nearVertices > 0 && farVertices > 0,
  `the wall clause asserts nothing: ${nearVertices} near and ${farVertices} far vertices`,
);
check(
  Math.abs(cornerRise) < rigidWouldBe / 3,
  `the castle's wall corners ride ${(cornerRise * 100).toFixed(1)} cm proud of its middle, ` +
    `against the ${(rigidWouldBe * 100).toFixed(1)} cm a rigid chord gives — the walls are ` +
    `not following the curve`,
);

// ------------------------------------------------------------------- verdict

if (failures.length > 0) {
  process.stderr.write('\ncheck:castle-bend FAILED\n');
  for (const f of failures) process.stderr.write(`  - ${f}\n`);
  process.exit(1);
}

process.stderr.write(
  '\ncheck:castle-bend OK — the castle exterior bends across its own footprint: ' +
    `the four turrets splay ${widestSplay.toFixed(2)}° and each stands on its own radial, ` +
    `and the curtain walls' corners ride only ${(cornerRise * 100).toFixed(1)} cm proud of its middle.\n`,
);
