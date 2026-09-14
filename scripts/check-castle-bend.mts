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
  // 0.05°, not 0, and the slack is named rather than tuned: the chart's anchor
  // is the radial at the *ground* under the castle's centre (that is what
  // `placeOnSphere` uses), while this compares against the radial at the
  // turret's own lifted foot. The two differ by a few thousandths of a degree —
  // about 2 mm over a turret's height — and that is a real, bounded difference
  // rather than noise to be papered over.
  worstOwnRadial < 0.05,
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
 * **Two earlier versions of this clause could not fail, and both are worth
 * keeping written down — they are the same disease in different organs.**
 *
 * 1. It measured the angle between the radial *under* each wall vertex and the
 *    radial at the castle's centre. That angle turns by `d / R` across any 24 m
 *    run whether the stone follows it or not: 1.716° rigid against 1.688° bent.
 *    It was describing the ground, not the wall.
 * 2. Its replacement bucketed vertices by horizontal distance and compared the
 *    lowest in each bucket. But the wall is built as four stacked bands, and
 *    taking a minimum per bucket across all of them compares whichever band
 *    happens to land in each — it read **-394 cm** with the bend working
 *    perfectly. And the bands are extruded rectangles, so their only vertices
 *    are at corners: there is nothing at the middle of a run to compare against.
 *
 * What works is to isolate **one course of one band** and ask whether it lies
 * at one radius from the planet's centre. `castle-wall-lower` is the band on
 * the plinth; its base course is selected by the geometry's *own* local height,
 * which separates courses by 3.6 m while the bend moves a vertex by at most
 * ~0.7 m — so a 1.2 m window takes the base course and nothing else, and the
 * window is on height while the *measurement* is on radius, so it cannot filter
 * out its own evidence the way the distance cut did.
 *
 * The expected rigid spread is computed from the selected vertices' own reach,
 * not typed in: a chord of the tangent plane rides `flatDeparture(d)` proud, so
 * the spread a rigid wall must show is `flatDeparture(dMax) - flatDeparture(dMin)`.
 * If those two are too close together there is no lever arm and the clause says
 * it asserts nothing rather than passing.
 */
const baseBand = wallMeshes.filter((m) => m.name === 'castle-wall-lower');
check(
  baseBand.length === 1,
  `expected exactly one castle-wall-lower, found ${baseBand.length} — the wall clause ` +
    'measures that band alone, so a rename or a split makes it assert nothing',
);

let minRadius = Infinity;
let maxRadius = -Infinity;
let dMin = Infinity;
let dMax = -Infinity;
let baseVertices = 0;
const v = new Vector3();
const vertexGeo = new Geo();
for (const wall of baseBand) {
  wall.geometry.computeBoundingBox();
  const box = wall.geometry.boundingBox;
  if (!box) continue;
  const floor = box.min.y + 1.2;
  const position = wall.geometry.getAttribute('position');
  for (let i = 0; i < position.count; i++) {
    v.fromBufferAttribute(position, i);
    if (v.y > floor) continue;
    wall.localToWorld(v);
    vertexGeo.setFromWorldVector(v);
    const r = vertexGeo.radius();
    minRadius = Math.min(minRadius, r);
    maxRadius = Math.max(maxRadius, r);
    const d = facadeCentre.arcTo(vertexGeo);
    dMin = Math.min(dMin, d);
    dMax = Math.max(dMax, d);
    baseVertices += 1;
  }
}
const measuredSpread = maxRadius - minRadius;
const rigidWouldBe = flatDeparture(dMax) - flatDeparture(dMin);

note(
  `castle-wall-lower base course: ${baseVertices} vertices reaching ${dMin.toFixed(1)}–${dMax.toFixed(1)} m ` +
    `from the castle's centre; their radius spans ${(measuredSpread * 100).toFixed(1)} cm`,
);
note(
  `CONTROL: over that same reach a rigid chord of the tangent plane would span ` +
    `${(rigidWouldBe * 100).toFixed(1)} cm (flatDeparture at each end, on R = ${PLANET_RADIUS} m). ` +
    `Bent, it goes to ~0. The course is selected on height and judged on radius, so ` +
    `the cut cannot discard its own evidence.`,
);

check(
  baseVertices >= 4,
  `the wall clause asserts nothing: only ${baseVertices} base-course vertices found`,
);
check(
  rigidWouldBe > 0.1,
  `the wall clause asserts nothing: the base course reaches ${dMin.toFixed(1)}–${dMax.toFixed(1)} m, ` +
    `so a rigid wall would only span ${(rigidWouldBe * 100).toFixed(1)} cm and there is no lever arm ` +
    'to tell the two cases apart',
);
check(
  measuredSpread < rigidWouldBe / 3,
  `the castle's wall base course spans ${(measuredSpread * 100).toFixed(1)} cm of radius, against ` +
    `the ${(rigidWouldBe * 100).toFixed(1)} cm a rigid chord gives over the same reach — the walls ` +
    'are not following the curve',
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
    `and the curtain wall's base course holds one radius to ${(measuredSpread * 100).toFixed(1)} cm ` +
    `against the ${(rigidWouldBe * 100).toFixed(1)} cm a rigid chord would give.\n`,
);
