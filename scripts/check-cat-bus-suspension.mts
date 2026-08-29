/**
 * **Do the cat bus's doubled wheels sit on the road, stay out of the bus, and
 * stay clear of their own mudguards — through the whole range of the bob?**
 *
 * ```
 * npm run check:cat-bus-suspension
 * ```
 *
 * `check:cat-bus` owns whether the arrival *plays* and whether the children
 * survive it. This owns the one thing that got harder when the wheels doubled
 * (#364): whether the vehicle's own parts still clear each other **while it is
 * moving**, which is a question no still frame can answer and no bounding box
 * measured at rest can either.
 *
 * ## Why "at rest" is not good enough, in one number
 *
 * A tyre 2.13 m tall and a mudguard 0.69 m above it clear each other by 0.69 m
 * standing still. The body drops up to `CAT_BUS_MAX_HEAVE` on a bump, tips up
 * to `CAT_BUS_MAX_PITCH` about the middle — another 0.133 m at the rear axle —
 * and leans `CAT_BUS_MAX_ROLL`, another 0.161 m out at the track. Add them and
 * **0.53 m of that 0.69 m is eaten at the worst corner**, leaving 0.159 m. That
 * margin is real but it is not large, and every one of those three limits is a
 * number somebody could raise later while looking only at how it feels — as
 * indeed happened, when the bob was raised eight-fold to make it visible.
 *
 * So this measures the **built meshes at the corners of the travel envelope**,
 * and separately drives the real `animate()` hard enough to prove the envelope
 * is actually enforced. Either half alone would pass a bus that bottoms out.
 *
 * ## And why it measures a bob at all
 *
 * Issue #328's lesson, from `check:cat-bus`'s own pinned-kid branch: a
 * clearance assertion is trivially satisfied by there being no motion. **A bus
 * that never moves clears everything.** So the drive below asserts a *floor* on
 * how much the body actually travels as well as a ceiling — a suspension that
 * silently stopped working fails here rather than passing with room to spare.
 */
import './headless-canvas.mjs';
import { Box3, Matrix4, Mesh, Object3D, Vector3 } from 'three';
import {
  CAT_BUS_ARCH_GAP,
  CAT_BUS_MAX_HEAVE,
  CAT_BUS_MAX_PITCH,
  CAT_BUS_MAX_ROLL,
  CAT_BUS_RIDE_LIFT,
  CAT_BUS_TRACK_WIDTH,
  CAT_BUS_WHEEL_SCALE,
  CAT_BUS_WIDTH,
  createCatBus,
} from '../src/world/entrance/catBus.ts';
import { ROAD_HALF_WIDTH } from '../src/world/entrance/road.ts';

const failures: string[] = [];
const notes: string[] = [];

function check(ok: boolean, message: string): void {
  if (!ok) failures.push(message);
}

function note(message: string): void {
  notes.push(message);
}

const bus = createCatBus();
const root = bus.root;
root.updateMatrixWorld(true);

// ---------------------------------------------------------------- find things

function collect(from: Object3D, name: string): Object3D[] {
  const found: Object3D[] = [];
  from.traverse((object) => {
    if (object.name === name) found.push(object);
  });
  return found;
}

/** Every world-space vertex of a mesh, and of every mesh under an object. */
function worldVertices(object: Object3D): Vector3[] {
  const points: Vector3[] = [];
  const scratch = new Vector3();
  object.updateMatrixWorld(true);
  object.traverse((child) => {
    const mesh = child as Mesh;
    if (!(mesh as Partial<Mesh>).isMesh) return;
    const position = mesh.geometry.getAttribute('position');
    if (!position) return;
    for (let i = 0; i < position.count; i += 1) {
      scratch.fromBufferAttribute(position, i).applyMatrix4(mesh.matrixWorld);
      points.push(scratch.clone());
    }
  });
  return points;
}

/**
 * A mesh's **surface**, sampled — not just the corners of it.
 *
 * **Vertices are not a surface, and measuring them instead of one hid a real
 * hole for two shapes running.** The mudguard is now a single `ExtrudeGeometry`
 * swept round the wheel, and an extrusion carries vertices only on its two end
 * caps: there is not one vertex anywhere on the tyre's own centre plane, which
 * is precisely where a mudguard is nearest the tyre it covers. Measured at the
 * vertices the tightest gap came out *larger* than the arch gap the shape was
 * built with — the check could no longer see the closest point at all, and it
 * still said OK.
 *
 * It had only ever worked by luck: `RoundedBoxGeometry`, which the plates used,
 * happens to carry interior vertices across each face. Swap in any shape that
 * does not and the assertion quietly stops describing anything, which is this
 * repo's oldest bug (CLAUDE.md, "A check can pass without checking anything").
 *
 * So every triangle is sampled on a barycentric grid as well as at its corners.
 * Returned in the mesh's **own** space, with its matrix, so the poses below can
 * transform a fixed set of points twenty-seven times rather than re-deriving
 * them.
 */
const BARYCENTRIC_STEPS = 4;
interface SampledMesh {
  readonly mesh: Mesh;
  readonly points: readonly Vector3[];
}

function localSurfaceSamples(object: Object3D): SampledMesh[] {
  const sampled: SampledMesh[] = [];
  object.traverse((child) => {
    const mesh = child as Mesh;
    if (!(mesh as Partial<Mesh>).isMesh) return;
    const position = mesh.geometry.getAttribute('position');
    if (!position) return;
    const index = mesh.geometry.getIndex();
    const count = index ? index.count : position.count;
    const at = (i: number): number => (index ? index.getX(i) : i);
    const points: Vector3[] = [];
    const a = new Vector3();
    const b = new Vector3();
    const c = new Vector3();
    for (let i = 0; i + 2 < count; i += 3) {
      a.fromBufferAttribute(position, at(i));
      b.fromBufferAttribute(position, at(i + 1));
      c.fromBufferAttribute(position, at(i + 2));
      for (let u = 0; u <= BARYCENTRIC_STEPS; u += 1) {
        for (let v = 0; u + v <= BARYCENTRIC_STEPS; v += 1) {
          const wu = u / BARYCENTRIC_STEPS;
          const wv = v / BARYCENTRIC_STEPS;
          points.push(
            new Vector3(
              a.x * (1 - wu - wv) + b.x * wu + c.x * wv,
              a.y * (1 - wu - wv) + b.y * wu + c.y * wv,
              a.z * (1 - wu - wv) + b.z * wu + c.z * wv,
            ),
          );
        }
      }
    }
    sampled.push({ mesh, points });
  });
  return sampled;
}

const wheels = collect(root, 'cat-bus-wheel') as Mesh[];
const fenders = collect(root, 'cat-bus-fender');
const chassis = bus.chassis;
const axles = root.getObjectByName('axles');

check(
  wheels.length === 4,
  `found ${wheels.length} meshes named 'cat-bus-wheel', expected 4 — this check cannot measure a bus it cannot find the wheels of`,
);
check(
  fenders.length === 4,
  `found ${fenders.length} objects named 'cat-bus-fender', expected 4 — nothing is guarding the tyres`,
);
check(axles !== undefined, "the bus has no 'axles' group — the wheels are parented to the sprung body and will bob with it");
if (wheels.length !== 4 || fenders.length !== 4) {
  report();
}

/**
 * Each wheel as the cylinder it is, **measured off its own vertices** rather
 * than read from the constant that built it.
 *
 * The radius is the furthest a vertex gets from the axle. `sides` is how many
 * facets the rim actually has, counted from the distinct angles its vertices
 * stand at — from which the sagitta `R * (1 - cos(PI / sides))` is the exact
 * amount a flat-bottomed polygon sits proud of the circle it approximates.
 *
 * That sagitta is the honest tolerance for "the tyre touches the road": a
 * faceted wheel genuinely does rest on a flat, and a picked tolerance would be
 * a number chosen to make the answer come out right.
 *
 * **Two wrong ways to get it were tried first, and both are instructive.** The
 * minimum radial distance over every vertex returns *zero*, because
 * `CylinderGeometry` carries a vertex at the dead centre of each end cap — so
 * the tolerance became the whole radius, a ceiling of "the wheel may float
 * 1.07 m above the road", which passes anything. Excluding the caps then
 * returns *R exactly*, because every rim vertex is on the circle: the flat is
 * between them and no vertex ever sits on it. Both were caught by reading the
 * number the check printed rather than its verdict.
 */
interface Tyre {
  readonly mesh: Mesh;
  readonly centre: Vector3;
  readonly axis: Vector3;
  readonly radius: number;
  readonly sides: number;
  readonly halfWidth: number;
}

function measureTyre(mesh: Mesh): Tyre {
  // The hub's own world position, not a bounding-box centre. A bounding box
  // round a *spinning* faceted cylinder wanders — three builds it from the
  // geometry's box corners, so a wheel a third of a turn round reports an AABB
  // half a metre taller than the wheel is. That is how this check first claimed
  // the wheels were 'riding the suspension' by 0.447 m, which is exactly
  // `R * (sqrt(2) - 1)` and nothing to do with the suspension at all.
  const centre = mesh.getWorldPosition(new Vector3());
  // **The axle is the bus's own x, taken from the axle group's frame.** Taken
  // from the wheel mesh's frame it comes out as world *y*: the wheel is a
  // cylinder rolled onto its side, so its local x is not its axis. That gave a
  // 1.129 m 'radius', a 0.759 m 'faceting' and a mudguard reported 0.70 m
  // inside a tyre it does not touch.
  const axis = new Vector3(1, 0, 0)
    .transformDirection((axles ?? mesh).matrixWorld)
    .normalize();
  let radius = 0;
  let halfWidth = 0;
  const offset = new Vector3();
  const points = worldVertices(mesh);
  for (const point of points) {
    offset.copy(point).sub(centre);
    const along = offset.dot(axis);
    const radial = Math.sqrt(Math.max(0, offset.lengthSq() - along * along));
    radius = Math.max(radius, radial);
    halfWidth = Math.max(halfWidth, Math.abs(along));
  }
  // Two axes across the wheel, so a rim vertex's angle round it can be read.
  const acrossA = new Vector3(0, 1, 0).cross(axis).normalize();
  const acrossB = new Vector3().copy(axis).cross(acrossA).normalize();
  const angles = new Set<string>();
  for (const point of points) {
    offset.copy(point).sub(centre);
    const along = offset.dot(axis);
    const radial = Math.sqrt(Math.max(0, offset.lengthSq() - along * along));
    // Rim vertices only — see the note above about the end caps' hub vertex.
    if (radial < radius * 0.99) continue;
    // Wrapped into [0, 2*PI) before rounding: `atan2` returns the seam column's
    // two coincident vertices as -PI and +PI, which are the same angle and
    // would otherwise be counted as two facets — an 18-sided wheel reported as
    // 19-sided, and a sagitta 10% short of the truth.
    const raw = Math.atan2(offset.dot(acrossB), offset.dot(acrossA));
    angles.add((((raw % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2)).toFixed(4));
  }
  return { mesh, centre, axis, radius, sides: angles.size, halfWidth };
}

/** How far a faceted wheel's flat sits proud of the circle it approximates. */
function sagitta(tyre: Tyre): number {
  if (tyre.sides < 3) return 0;
  return tyre.radius * (1 - Math.cos(Math.PI / tyre.sides));
}

const tyres = wheels.map(measureTyre);

/** The shortest distance from `point` to a tyre's surface. Negative is inside. */
function distanceToTyre(tyre: Tyre, point: Vector3): number {
  const offset = point.clone().sub(tyre.centre);
  const along = offset.dot(tyre.axis);
  const radial = Math.sqrt(Math.max(0, offset.lengthSq() - along * along));
  // Beside the tyre rather than over it: the gap is measured to the rim of the
  // sidewall, which is what a mudguard overhanging the tread is doing.
  const outsideAxially = Math.max(0, Math.abs(along) - tyre.halfWidth);
  const outsideRadially = radial - tyre.radius;
  if (outsideAxially > 0) {
    return outsideRadially > 0
      ? Math.hypot(outsideAxially, outsideRadially)
      : outsideAxially;
  }
  return outsideRadially;
}

/** Each mudguard, paired with the tyre it is actually nearest. */
const guards = fenders.map((fender) => {
  const at = new Vector3();
  fender.getWorldPosition(at);
  let nearest = tyres[0] as Tyre;
  let best = Infinity;
  for (const tyre of tyres) {
    const gap = at.distanceTo(tyre.centre);
    if (gap < best) {
      best = gap;
      nearest = tyre;
    }
  }
  return { fender, tyre: nearest };
});

// ------------------------------------------- 1. the wheels really did double

const nominalRadius = tyres.reduce((most, tyre) => Math.max(most, tyre.radius), 0);
note(`tyre radius ${nominalRadius.toFixed(3)} m (${(nominalRadius * 2).toFixed(2)} m tall)`);
check(
  CAT_BUS_WHEEL_SCALE === 2,
  `CAT_BUS_WHEEL_SCALE is ${CAT_BUS_WHEEL_SCALE}, not 2 — Jim asked for wheels double their old size, corrected from "50% larger" on 29 August 2026`,
);
// The wheels were `BODY_BOTTOM_Y * 0.86` = 0.5332 m before #364. Held against
// the built model rather than against the formula, so a change that quietly
// re-derived the radius from something else has to say so here.
const OLD_WHEEL_RADIUS = 0.5332;
check(
  Math.abs(nominalRadius - OLD_WHEEL_RADIUS * 2) < 0.01,
  `the built tyre measures ${nominalRadius.toFixed(3)} m, but double the old 0.533 m wheel is ${(OLD_WHEEL_RADIUS * 2).toFixed(3)} m`,
);

// -------------------------------------------- 2. the wheels are on the road

for (const tyre of tyres) {
  const lowest = worldVertices(tyre.mesh).reduce((low, p) => Math.min(low, p.y), Infinity);
  // A faceted wheel rests on a flat, so its lowest *vertex* is the polygon's
  // inradius below the axle, not its radius. Measured, not assumed.
  const faceting = sagitta(tyre);
  check(
    lowest >= -1e-6,
    `a wheel at z=${tyre.centre.z.toFixed(2)} is ${(-lowest).toFixed(4)} m below the road`,
  );
  check(
    lowest <= faceting + 1e-6,
    `a wheel at z=${tyre.centre.z.toFixed(2)} floats ${lowest.toFixed(4)} m above the road (its own faceting only accounts for ${faceting.toFixed(4)} m)`,
  );
}
note(
  `wheels rest ${(tyres[0] as Tyre).radius.toFixed(3)} m up on ${(tyres[0] as Tyre).sides}-sided rims, touching within their own ${sagitta(tyres[0] as Tyre).toFixed(4)} m sagitta`,
);

// ------------------------------- 3. no wheel is inside the bus, at any pose

/**
 * **The branch's headline claim, measured against the bus that got built.**
 *
 * The whole design argument for #364 is *"the wheels stand entirely outboard of
 * the bodywork, and that is the whole answer"* — the clearance is guaranteed by
 * lateral separation rather than by a ride height a downstroke can eat. This is
 * where that is either true or not.
 *
 * **It used to assert against a number typed into this file**, `CAT_BUS_WIDTH /
 * 2 - 0.16`, which is 0.19 m more permissive than the bodywork's real outer
 * surface. The review fooled it in one line: `WHEEL_CLEARANCE` from 0.08 to
 * -0.25 drives each tyre 0.185 m into the flank of the bus, and this printed
 * `OK (10 measurements)` with a wheel sunk a fifth of a metre into the
 * passenger cabin. A constant standing in for a surface is the same disease as
 * a comment promising two numbers agree.
 *
 * So it asks the built shells where they are, at **every pose** — the shells
 * roll and heave, the tyres do not, and it is at full roll that a flank leans
 * furthest over a wheel.
 *
 * ## And it asks the shell's *box*, not its vertices, which took two goes
 *
 * The obvious way round — sample the shells' surfaces and ask `distanceToTyre`
 * about each point — was written first and **did not catch the fool either**.
 * `RoundedBoxGeometry` tessellates its flat faces astonishingly coarsely: the
 * lower shell is 12.9 m long and carries **not one vertex within a metre of
 * either axle**, so the sampling had nothing local to the wheel to interpolate
 * between and reported the flank a comfortable 0.0971 m clear of a tyre that
 * was 0.185 m inside it.
 *
 * A shell *is* a box, so the exact question is whether any point of the tyre is
 * inside that box — and a box needs no tessellation to answer it. Each shell's
 * extent is measured once in its own frame (the chassis moves above it, so the
 * local box does not change), and each pose transforms the **tyre's** surface
 * into that frame, which is the finely faceted side of the pair and the side
 * that can be sampled honestly.
 *
 * Conservative in the right direction: it treats the bodywork as the solid box
 * it is drawn as, so a wheel poking into a window aperture counts as a wheel in
 * the bus, which it is.
 */
const shellNames = ['cat-bus-shell-lower', 'cat-bus-shell-upper'] as const;

/** An object's extent in **its own** frame, children and outline shells and all. */
function localBox(object: Object3D): Box3 {
  const box = new Box3();
  const toLocal = new Matrix4().copy(object.matrixWorld).invert();
  const point = new Vector3();
  object.traverse((child) => {
    const mesh = child as Mesh;
    if (!(mesh as Partial<Mesh>).isMesh) return;
    const position = mesh.geometry.getAttribute('position');
    if (!position) return;
    for (let i = 0; i < position.count; i += 1) {
      point
        .fromBufferAttribute(position, i)
        .applyMatrix4(mesh.matrixWorld)
        .applyMatrix4(toLocal);
      box.expandByPoint(point);
    }
  });
  return box;
}

/** How far outside a box a point is. Negative is inside, by the shallowest face. */
function distanceOutsideBox(box: Box3, point: Vector3): number {
  const outside = Math.hypot(
    Math.max(box.min.x - point.x, 0, point.x - box.max.x),
    Math.max(box.min.y - point.y, 0, point.y - box.max.y),
    Math.max(box.min.z - point.z, 0, point.z - box.max.z),
  );
  if (outside > 0) return outside;
  return -Math.min(
    point.x - box.min.x,
    box.max.x - point.x,
    point.y - box.min.y,
    box.max.y - point.y,
    point.z - box.min.z,
    box.max.z - point.z,
  );
}

const bodywork = shellNames.flatMap((name) => {
  const shell = root.getObjectByName(name);
  if (!shell) {
    failures.push(`the bus has no '${name}' — the bodywork cannot be measured, so nothing is checking the wheels are outside it`);
    return [];
  }
  return [{ shell, box: localBox(shell) }];
});
/** The tyres' own surfaces — the finely faceted half of the pair. */
const tyreSurfaces = tyres.map((tyre) => localSurfaceSamples(tyre.mesh));

let worstBodyworkGap = Infinity;
let worstBodyworkPose = '';
const scratchPoint = new Vector3();
const toShell = new Matrix4();
for (const p of posesToTest()) {
  pose(p.heave, p.pitch, p.roll);
  for (const { shell, box } of bodywork) {
    toShell.copy(shell.matrixWorld).invert();
    for (const surface of tyreSurfaces) {
      for (const { mesh, points } of surface) {
        for (const local of points) {
          scratchPoint
            .copy(local)
            .applyMatrix4(mesh.matrixWorld)
            .applyMatrix4(toShell);
          const gap = distanceOutsideBox(box, scratchPoint);
          if (gap < worstBodyworkGap) {
            worstBodyworkGap = gap;
            worstBodyworkPose = p.label;
          }
        }
      }
    }
  }
}
pose(0, 0, 0);
check(
  worstBodyworkGap > 0,
  `a tyre reaches ${(-worstBodyworkGap).toFixed(4)} m INSIDE the bodywork at "${worstBodyworkPose}" — there is a wheel standing in the bus, which is the one thing doubling the wheels had to avoid`,
);
note(
  `closest a tyre comes to the built bodywork, over the whole envelope: ${worstBodyworkGap.toFixed(4)} m, at "${worstBodyworkPose}"`,
);
note(
  `track ${CAT_BUS_TRACK_WIDTH.toFixed(2)} m over a ${CAT_BUS_WIDTH.toFixed(2)} m body`,
);

// ------------------------------ 3b. the tyres are on the road, not the verge

/**
 * **The bus fits the road it drives down.**
 *
 * `ROAD_HALF_WIDTH` is derived from the *bodywork*, and deliberately: sized on
 * the track instead it comes out at 9.75 m and will not go through the 8.6 m
 * gate arch, which took five procgen seeds red the once it was tried. So the
 * fit is a coincidence of two numbers rather than a derivation — 7.25 m of
 * track inside 7.78 m of tarmac — and coincidences of that shape are this
 * repo's most expensive bug. Asserted here so it cannot quietly stop being
 * true the next time either number moves.
 */
const verge = ROAD_HALF_WIDTH - CAT_BUS_TRACK_WIDTH / 2;
check(
  verge > 0,
  `the bus is ${CAT_BUS_TRACK_WIDTH.toFixed(2)} m across its wheels on a ${(ROAD_HALF_WIDTH * 2).toFixed(2)} m road — it drives with ${(-verge).toFixed(2)} m of tyre in the grass on each side`,
);
note(`verge either side of the tyres: ${verge.toFixed(3)} m of a ${(ROAD_HALF_WIDTH * 2).toFixed(2)} m carriageway`);

// ---------------- 4. the mudguards clear the tyres across the WHOLE bob range

/**
 * The corners of the travel envelope.
 *
 * Every combination of the three limits at full deflection, both ways — eight
 * poses, of which one is the worst case at each corner of the bus. Sampling the
 * *corners* rather than the middle of a drive is the point: a bob that only
 * ever reaches half its clamp on the journey this check happens to simulate
 * would sail through, and then bottom out the first time the game gave it a
 * rougher ride.
 */
function posesToTest(): { label: string; heave: number; pitch: number; roll: number }[] {
  const poses: { label: string; heave: number; pitch: number; roll: number }[] = [];
  for (const h of [-1, 0, 1]) {
    for (const p of [-1, 0, 1]) {
      for (const r of [-1, 0, 1]) {
        poses.push({
          label: `heave ${h > 0 ? '+' : h < 0 ? '-' : '0'} pitch ${p > 0 ? '+' : p < 0 ? '-' : '0'} roll ${r > 0 ? '+' : r < 0 ? '-' : '0'}`,
          heave: h * CAT_BUS_MAX_HEAVE,
          pitch: p * CAT_BUS_MAX_PITCH,
          roll: r * CAT_BUS_MAX_ROLL,
        });
      }
    }
  }
  return poses;
}

function pose(heave: number, pitch: number, roll: number): void {
  chassis.position.y = CAT_BUS_RIDE_LIFT + heave;
  chassis.rotation.x = -pitch;
  chassis.rotation.z = roll;
  root.updateMatrixWorld(true);
}

/** Each mudguard's surface, in its own space, sampled once. */
const guardSurfaces = guards.map(({ fender, tyre }) => ({
  tyre,
  sampled: localSurfaceSamples(fender),
}));

/** The tightest a mudguard comes to its tyre at one pose. */
function tightestGuardGap(heave: number, pitch: number, roll: number): number {
  pose(heave, pitch, roll);
  let tightest = Infinity;
  for (const { tyre, sampled } of guardSurfaces) {
    for (const { mesh, points } of sampled) {
      for (const local of points) {
        scratchPoint.copy(local).applyMatrix4(mesh.matrixWorld);
        tightest = Math.min(tightest, distanceToTyre(tyre, scratchPoint));
      }
    }
  }
  return tightest;
}

let worstGap = Infinity;
let worstPose = '';
for (const p of posesToTest()) {
  const gap = tightestGuardGap(p.heave, p.pitch, p.roll);
  if (gap < worstGap) {
    worstGap = gap;
    worstPose = p.label;
  }
}
check(
  worstGap > 0,
  `a mudguard is ${(-worstGap).toFixed(4)} m INSIDE its tyre at "${worstPose}" — the bus bottoms out and drives its own arch through its own wheel`,
);
note(
  `tightest mudguard-to-tyre gap over the whole travel envelope: ${worstGap.toFixed(4)} m, at "${worstPose}" (arch gap at rest ${CAT_BUS_ARCH_GAP.toFixed(4)} m)`,
);

/**
 * **The mudguards ride the sprung body, so the gap opens and closes.**
 *
 * `catBus.ts` says *"the fender rides on the chassis, so this gap genuinely
 * opens and closes as the bus bobs — that is what makes the suspension visible
 * from outside"*. Nothing was checking it, and the review proved the sentence
 * unguarded by moving `chassis.add(fender)` to `axles.add(fender)`: the arch
 * then hangs off the axle beside the wheel, moves with it, and every clearance
 * assertion above stays green while the one visible symptom of the whole
 * feature quietly disappears.
 *
 * Two poses is all it takes. On the chassis the gap differs by twice the heave
 * between them; on the axles it is the same number twice.
 */
const gapAtTop = tightestGuardGap(CAT_BUS_MAX_HEAVE, 0, 0);
const gapAtBottom = tightestGuardGap(-CAT_BUS_MAX_HEAVE, 0, 0);
const gapSwing = Math.abs(gapAtTop - gapAtBottom);
check(
  gapSwing > CAT_BUS_MAX_HEAVE,
  `the mudguard-to-tyre gap only changes by ${gapSwing.toFixed(5)} m between full bump and full droop (a chassis-mounted arch swings well over ${CAT_BUS_MAX_HEAVE.toFixed(2)} m; one bolted to the axle swings nothing at all) — the mudguards are not riding the sprung body, so the suspension is invisible from outside however far the chassis moves`,
);
note(
  `mudguard-to-tyre gap swings ${gapAtBottom.toFixed(3)}..${gapAtTop.toFixed(3)} m across the bob — ${gapSwing.toFixed(3)} m of visible travel`,
);
pose(0, 0, 0);

// ----------------------------- 5. nothing on the sprung body touches the road

let lowestChassis = Infinity;
let lowestPose = '';
for (const p of posesToTest()) {
  pose(p.heave, p.pitch, p.roll);
  const box = new Box3().setFromObject(chassis);
  if (box.min.y < lowestChassis) {
    lowestChassis = box.min.y;
    lowestPose = p.label;
  }
}
check(
  lowestChassis > 0,
  `the bodywork reaches y=${lowestChassis.toFixed(4)} at "${lowestPose}" — the bus grounds out on the road`,
);
note(`lowest point of the sprung body over the envelope: ${lowestChassis.toFixed(3)} m, at "${lowestPose}"`);

pose(0, 0, 0);

// ------------------------------------- 6. drive it, and watch what it does

/**
 * A minute of driving with everything in it: pulling away, cruising, braking to
 * a stop, sitting still with the door open, then pulling away again round a
 * bend. The speeds and the heading are what the two real callers hand over —
 * `ArrivalSequence` a measured speed and a fixed `rotation.y`, `BusJourney` a
 * constant speed and a heading set by `lookAt`.
 */
const DT = 1 / 60;
const SECONDS = 60;
let elapsed = 0;
let peakHeave = 0;
let peakPitch = 0;
let peakRoll = 0;
let travelLow = Infinity;
let travelHigh = -Infinity;
// The hubs' own heights, for the same reason `measureTyre` uses them.
const wheelYAtStart = tyres.map((tyre) => tyre.mesh.getWorldPosition(new Vector3()).y);
let wheelDrift = 0;
/** Peak-to-peak heave over the last second, used twice below. */
const recentHeave: number[] = [];
let stoppedPeakToPeak = Number.NaN;
let drivingPeakToPeak = 0;

for (let frame = 0; frame < SECONDS / DT; frame += 1) {
  elapsed += DT;
  // 0-8 s pulling away, 8-24 s cruising, 24-30 s braking, 30-38 s stopped,
  // 38-60 s away again and turning.
  let speed = 0;
  if (elapsed < 8) speed = (elapsed / 8) * 6;
  else if (elapsed < 24) speed = 6;
  else if (elapsed < 30) speed = 6 * (1 - (elapsed - 24) / 6);
  else if (elapsed < 38) speed = 0;
  else speed = Math.min(6, (elapsed - 38) * 2);
  if (elapsed > 44) root.rotation.y += 0.35 * DT;

  bus.animate(DT, speed);
  root.updateMatrixWorld(true);

  peakHeave = Math.max(peakHeave, Math.abs(chassis.position.y - CAT_BUS_RIDE_LIFT));
  peakPitch = Math.max(peakPitch, Math.abs(chassis.rotation.x));
  peakRoll = Math.max(peakRoll, Math.abs(chassis.rotation.z));
  travelLow = Math.min(travelLow, chassis.position.y - CAT_BUS_RIDE_LIFT);
  travelHigh = Math.max(travelHigh, chassis.position.y - CAT_BUS_RIDE_LIFT);

  for (let i = 0; i < tyres.length; i += 1) {
    const at = (tyres[i] as Tyre).mesh.getWorldPosition(new Vector3()).y;
    wheelDrift = Math.max(wheelDrift, Math.abs(at - (wheelYAtStart[i] as number)));
  }

  recentHeave.push(chassis.position.y - CAT_BUS_RIDE_LIFT);
  if (recentHeave.length > 60) recentHeave.shift();
  const spread = Math.max(...recentHeave) - Math.min(...recentHeave);
  if (elapsed > 20 && elapsed < 24) drivingPeakToPeak = Math.max(drivingPeakToPeak, spread);
  // Sampled at the very end of the stopped stretch, by which time an
  // under-damped spring has had eight seconds to settle.
  if (elapsed > 37.9 && elapsed < 38) stoppedPeakToPeak = spread;
}

// 6a. The clamps that `CAT_BUS_ARCH_GAP` is derived from are actually enforced.
check(
  peakHeave <= CAT_BUS_MAX_HEAVE + 1e-9,
  `the body heaved ${peakHeave.toFixed(4)} m, past its published limit of ${CAT_BUS_MAX_HEAVE} — the arch gap is derived from that limit, so the clearance measured above is a fiction`,
);
check(
  peakPitch <= CAT_BUS_MAX_PITCH + 1e-9,
  `the body pitched ${peakPitch.toFixed(5)} rad, past its published limit of ${CAT_BUS_MAX_PITCH}`,
);
check(
  peakRoll <= CAT_BUS_MAX_ROLL + 1e-9,
  `the body rolled ${peakRoll.toFixed(5)} rad, past its published limit of ${CAT_BUS_MAX_ROLL}`,
);

// 6b. The wheels stayed on the road while the body moved. This is what lets
// "the wheels touch the ground" be measured once, at rest, and still be true
// at every pose — and it is the whole reason they hang off `axles`.
check(
  wheelDrift < 1e-9,
  `a wheel moved ${wheelDrift.toFixed(5)} m vertically during the drive — the wheels are riding the suspension instead of the road`,
);

// 6c. **There is actually a bob.** Issue #328's zero-scale trap: every
// clearance assertion above is trivially satisfied by a bus that never moves.
// The floor is a third of the published travel, which a working spring clears
// comfortably on this road and a dead one cannot reach at all.
const HEAVE_FLOOR = CAT_BUS_MAX_HEAVE / 3;
check(
  drivingPeakToPeak > HEAVE_FLOOR,
  `the body only moved ${drivingPeakToPeak.toFixed(4)} m peak-to-peak while cruising at 6 m/s — that is not a suspension bob (expected more than ${HEAVE_FLOOR.toFixed(4)} m)`,
);
note(
  `cruising: ${drivingPeakToPeak.toFixed(4)} m peak-to-peak heave; envelope used ${travelLow.toFixed(4)}..${travelHigh.toFixed(4)} m of +/-${CAT_BUS_MAX_HEAVE}`,
);
note(`peak pitch ${peakPitch.toFixed(5)} / ${CAT_BUS_MAX_PITCH} rad, peak roll ${peakRoll.toFixed(5)} / ${CAT_BUS_MAX_ROLL} rad`);

// 6d. **And it stops when the bus stops.** The road is sampled on distance
// travelled rather than on the clock precisely so that a bus standing at the
// kerb with its door open is still. A fixed sine on `elapsed` — the obvious
// implementation, and the one the brief rules out — passes every other
// assertion in this file and fails this one.
check(
  stoppedPeakToPeak < HEAVE_FLOOR / 10,
  `the body was still moving ${stoppedPeakToPeak.toFixed(5)} m peak-to-peak after eight seconds parked — the bob is running off the clock rather than off the road`,
);
note(`parked and settled: ${stoppedPeakToPeak.toFixed(6)} m peak-to-peak`);

// --------------------------------- 7. the stripes are one pattern, one scale

const shells = ['cat-bus-shell-lower', 'cat-bus-shell-upper'].map(
  (name) => root.getObjectByName(name) as Mesh | undefined,
);

/**
 * How many texture tiles one metre along the bus covers, on a given mesh.
 *
 * The whole claim of the drape unwrap is that a stripe is the same width in
 * metres wherever it lands. Two meshes reporting different numbers here means
 * one of them kept its `RoundedBoxGeometry`'s own 0..1-per-face UVs — which
 * looks completely fine in the source and puts stripes four times as wide on
 * the front of the bus as on its flank.
 */
function tilesPerMetreAlong(mesh: Mesh): number {
  const position = mesh.geometry.getAttribute('position');
  const uv = mesh.geometry.getAttribute('uv');
  if (!position || !uv) return Number.NaN;
  let lowZ = Infinity;
  let highZ = -Infinity;
  let uAtLow = 0;
  let uAtHigh = 0;
  for (let i = 0; i < position.count; i += 1) {
    const z = position.getZ(i);
    if (z < lowZ) {
      lowZ = z;
      uAtLow = uv.getX(i);
    }
    if (z > highZ) {
      highZ = z;
      uAtHigh = uv.getX(i);
    }
  }
  return (uAtHigh - uAtLow) / (highZ - lowZ);
}

for (const shell of shells) {
  check(shell !== undefined, 'a named cat bus shell is missing — the stripes cannot be measured');
}
if (shells.every((shell) => shell !== undefined)) {
  const [lower, upper] = shells as [Mesh, Mesh];
  for (const shell of [lower, upper]) {
    const material = shell.material as { map?: unknown };
    check(
      material.map !== undefined && material.map !== null,
      `${shell.name} carries no texture map — the bus has no tiger stripes on it`,
    );
  }
  const lowerScale = tilesPerMetreAlong(lower);
  const upperScale = tilesPerMetreAlong(upper);
  check(
    Number.isFinite(lowerScale) && Math.abs(lowerScale - upperScale) < 1e-9,
    `the stripes run at ${lowerScale.toFixed(5)} tiles/m on the lower shell and ${upperScale.toFixed(5)} on the header band — two different stripe widths on one bus`,
  );
  note(`stripes run at ${(1 / lowerScale).toFixed(2)} m per tile along the bus, on both shells`);
}

// -------------------------------------------------------------------- report

function report(): never {
  for (const line of notes) console.log(`  ${line}`);
  if (failures.length === 0) {
    console.log(`\ncheck:cat-bus-suspension — OK (${notes.length} measurements)`);
    bus.dispose();
    process.exit(0);
  }
  console.error(`\ncheck:cat-bus-suspension — ${failures.length} problem(s):`);
  for (const line of failures) console.error(`  - ${line}`);
  process.exit(1);
}

report();
