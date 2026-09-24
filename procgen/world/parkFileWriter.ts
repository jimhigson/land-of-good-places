import { Vector3 } from 'three';
import { type SolvedRailRoute } from '../../src/world/rail/generate';
import { PARK_FILE_FORMAT } from '../../src/world/prebuilt/parkFileName';
import { type Claim, type FeatureContribution } from '../../src/boot/groundClaims';
import { type WorldDecisions } from '../../src/world/worldPhase';
import { CLAIM_KINDS, DERIVED, SEGMENT_KEYS, derivedSections, type DecidedPlan, type Json, type ParkFile, type RouteRecord, type SegmentRecord } from '../../src/world/prebuilt/parkFile';
/**
 * **Writing a park file** — the encoder half of the format, which only
 * `build:parks` runs. The format itself, and the reader the game uses, are
 * `src/world/prebuilt/parkFile.ts`: one owner of the shape, two halves.
 */

function num(value: number): Json {
  if (Number.isNaN(value)) return { $n: 'NaN' };
  if (value === Infinity) return { $n: 'Infinity' };
  if (value === -Infinity) return { $n: '-Infinity' };
  if (Object.is(value, -0)) return { $n: '-0' };
  return value;
}


/**
 * Plain data out: numbers tagged where JSON would lose them, and anything that
 * is not plain data — a class instance, a function, `undefined`, a symbol —
 * refused with its path.
 */
function plain(value: unknown, path: string): Json {
  if (value === null) return null;
  switch (typeof value) {
    case 'number':
      return num(value);
    case 'string':
    case 'boolean':
      return value;
    case 'object':
      break;
    default:
      throw new Error(`park file: ${path} is ${typeof value}, which a park file cannot carry`);
  }
  if (Array.isArray(value)) return value.map((item, i) => plain(item, `${path}[${i}]`));
  if (value instanceof Vector3) return { $v: [num(value.x), num(value.y), num(value.z)] };
  const proto = Object.getPrototypeOf(value) as unknown;
  if (proto !== Object.prototype && proto !== null) {
    const name = (proto as { constructor?: { name?: string } }).constructor?.name ?? '?';
    throw new Error(`park file: ${path} is a ${name}, not plain data — teach parkFile.ts to write it`);
  }
  const out: { [key: string]: Json } = {};
  for (const [key, item] of Object.entries(value)) out[key] = plain(item, `${path}.${key}`);
  return out;
}


function flatPoints(points: readonly Vector3[]): Json[] {
  const out: Json[] = [];
  for (const p of points) out.push(num(p.x), num(p.y), num(p.z));
  return out;
}

/** What `buildRoute` returns. A new field fails the encoder rather than going missing. */
const ROUTE_KEYS = new Set(['length', 'closed', 'segments', 'report', 'minCurvature', 'pointAt', 'tangentAt']);


function writeRoute(route: SolvedRailRoute, path: string): RouteRecord {
  for (const key of Object.keys(route)) {
    if (!ROUTE_KEYS.has(key)) throw new Error(`park file: ${path} has a field '${key}' the route record does not carry`);
  }
  const segments = route.segments.map((segment, i): SegmentRecord => {
    const keys = Object.keys(segment);
    if (keys.length !== SEGMENT_KEYS.length || !SEGMENT_KEYS.every((key) => keys.includes(key))) {
      throw new Error(`park file: ${path}.segments[${i}] has fields [${keys.join(', ')}], not [${SEGMENT_KEYS.join(', ')}]`);
    }
    return [
      segment.x0,
      segment.z0,
      segment.x1,
      segment.z1,
      segment.x2,
      segment.z2,
      segment.x3,
      segment.z3,
      segment.length,
      segment.turn,
      segment.kind,
    ];
  });
  // `elapsedMs` is how long the search took on the machine that ran it — a
  // timing, not a decision. Zeroed so that one park always writes one file.
  const report = plain({ ...route.report, elapsedMs: 0 }, `${path}.report`);
  return { closed: route.closed, segments, report };
}


// ------------------------------------------------------------------- write

/** The decided plan as a park file. `build` is stamped later, by the bundle that ships it. */
export function encodeParkFile(seed: number, plan: DecidedPlan, build = 'unstamped'): ParkFile {
  const { layout, cruiser, train, slide, crossings, pathGraph, pathLattice, planOrder, world, bridges } = plan;

  const entries: Json[] = [];
  for (const [id, entry] of layout.entries) {
    if (id !== entry.id) throw new Error(`park file: layout entry keyed '${id}' is '${entry.id}'`);
    entries.push(plain(entry, `layout.entries.${id}`));
  }

  const { route: slideRoute, points: slidePoints, ...slideRest } = slide;
  const scalars: { [key: string]: Json } = {};
  for (const [key, value] of Object.entries(slideRest)) {
    if (typeof value === 'object' && value !== null) {
      throw new Error(`park file: slide.${key} is not a scalar — teach parkFile.ts to write it`);
    }
    scalars[key] = plain(value, `slide.${key}`);
  }

  return {
    format: PARK_FILE_FORMAT,
    build,
    seed,
    features: {
      layout: { seed: layout.seed, fountain: plain(layout.fountain, 'layout.fountain'), entries },
      cruiser: {
        plan: writeRoute(cruiser.route.plan, 'cruiser.plan'),
        profile: {
          points: flatPoints(cruiser.route.curve.points),
          length: num(cruiser.route.length),
          stationDistance: num(cruiser.route.stationDistance),
          castleSpan: plain(cruiser.route.castleSpan, 'cruiser.castleSpan'),
          crestY: num(cruiser.route.crestY),
        },
        exitX: num(cruiser.exitX),
        exitZ: num(cruiser.exitZ),
      },
      train: { plan: writeRoute(train.route.solvedRoute, 'train.plan') },
      slide: {
        route: writeRoute(slideRoute, 'slide.route'),
        points: flatPoints(slidePoints),
        scalars,
      },
      crossings: plain(crossings, 'crossings'),
      pathGraph: { graph: plain(pathGraph, 'pathGraph'), lattice: plain(pathLattice, 'pathGraph.lattice') },
      world: writeWorld(world),
      built: { bridges: plain(bridges, 'built.bridges') },
    },
    planOrder: [...planOrder],
  };
}


function writeClaim(claim: Claim, path: string): Json {
  const kind = CLAIM_KINDS.indexOf(claim.kind);
  if (kind < 0) throw new Error(`park file: ${path} has claim kind '${claim.kind}' the format does not know`);
  const shape = claim.shape;
  const keys = Object.keys(claim);
  if (keys.length !== 2) throw new Error(`park file: ${path} has fields [${keys.join(', ')}] beyond kind and shape`);
  if (shape.shape === 'disc') return [kind, num(shape.x), num(shape.z), num(shape.radius)];
  return [kind, num(shape.x1), num(shape.z1), num(shape.x2), num(shape.z2), num(shape.halfWidth)];
}


function writeContribution(c: FeatureContribution, path: string): Json {
  const out: { [key: string]: Json } = { claims: c.claims.map((claim, i) => writeClaim(claim, `${path}.claims[${i}]`)) };
  if (c.crossings) out['crossings'] = plain(c.crossings, `${path}.crossings`);
  if (c.demands) out['demands'] = plain(c.demands, `${path}.demands`);
  return out;
}


function writeWorld(world: WorldDecisions): Json {
  return {
    stallMoves: plain(world.stallMoves, 'world.stallMoves'),
    walls: plain(world.walls, 'world.walls'),
    trees: world.trees.map((t) => [num(t.x), num(t.z), t.kind, t.climbable ? 1 : 0, t.tree.rollState]),
    bushes: world.bushes.map((b) => [num(b.x), num(b.z), b.rollState]),
    fairyPoles: plain(world.fairyPoles, 'world.fairyPoles'),
    lamps: plain(world.lamps, 'world.lamps'),
    trestles: plain(world.trestles, 'world.trestles'),
    claims: world.claims.map(({ feature, sections }) => {
      const written = sections.map(([section, c]) => [section, writeContribution(c, `world.claims.${feature}.${section}`)]);
      const derived = derivedSections(feature, world);
      const same =
        derived !== null &&
        JSON.stringify(derived.map(([section, c]) => [section, writeContribution(c, 'derived')])) === JSON.stringify(written);
      return [feature, same ? DERIVED : written];
    }),
  };
}
