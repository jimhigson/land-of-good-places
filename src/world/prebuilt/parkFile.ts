import { Vector3 } from 'three';
import type { ParkLayout, PlacedEntry } from '../parkLayout';
import { buildRoute, type SolveReport, type SolvedRailRoute } from '../rail/generate';
import type { CubicSegment } from '../rail/segments';
import { coasterCurve } from '../coaster/route';
import { cruiserPlanFromDecisions, type PlannedCoaster } from '../../../procgen/world/coaster/solve';
import type { PlannedSlide } from '../../../procgen/world/slide/solve';
import type { SolvedCrossingSites } from '../../../procgen/world/train/crossingPlanSolve';
import { TrainRoute } from '../train/route';
import { planStations, type PlannedStation } from '../train/plan';
import type { LatticeStateSnapshot, PathGraph } from '../paths';
import { PARK_FILE_FORMAT } from './parkFileName';

/**
 * **A park's solved decisions, as a small JSON file** — the format a prebuilt
 * park is shipped in, and the one owner of how it is written and read.
 *
 * Jim, 23 September 2026: *"procgen should be build-time and downloaded by the
 * game instead of done on the client that is playing"*, and *"it probably
 * needs to invent a file format for this that is the park's layout as json,
 * but not every mesh etc, so that the client can load a reasonably small park
 * with all decisions made."* The design, with the measurements behind it, is
 * `docs/design/PREBUILT-PARKS.md`.
 *
 * ## What goes in
 *
 * **What a search decided, never what is derived from it.** A route is its
 * chosen cubic segments; the arc-length table, the samplers and `TrainRoute`'s
 * lookup are rebuilt from them by the very functions that build them after a
 * fresh solve ({@link buildRoute}, `new TrainRoute`, `new CoasterRoute`). So a
 * hydrated feature and a searched one share every line after the search, and
 * the only thing this file can get wrong is the search's own output — which
 * `check:prebuilt-park` compares, by whole-park digest, against a fresh solve.
 *
 * Format 1 carries the plan's layout, cruiser, train, slide and crossings —
 * 7.8 of the plan's 7.9 s of search on the canonical seed. `pathGraph` and
 * `road` still run on the client (~50 ms): the path search leaves state in
 * `paths.ts` that the `World` reads, and that has to become data before it can
 * be shipped. The world phase (`worldPhase.ts`) is likewise still solved.
 *
 * ## Strict on the way out
 *
 * The encoder refuses anything it does not understand — a class instance
 * where plain data was expected, a function, a route with a field it has not
 * been taught, an `undefined` — rather than writing a lossy file. A new field
 * in a plan type therefore fails `build:parks` loudly, with the path, instead
 * of shipping a park that silently differs. Numbers JSON cannot carry
 * (`Infinity`, `NaN`, `-0`) are tagged, not lost.
 */

// ------------------------------------------------------------------- the shape

/** Any JSON value. */
export type Json = null | boolean | number | string | readonly Json[] | { readonly [key: string]: Json };

/** A cubic piece as `[x0, z0, x1, z1, x2, z2, x3, z3, length, turn, kind]`. */
export type SegmentRecord = readonly [number, number, number, number, number, number, number, number, number, number, string];

export interface RouteRecord {
  readonly closed: boolean;
  readonly segments: readonly SegmentRecord[];
  /** The search's own report, timing zeroed so the same park writes the same bytes. */
  readonly report: Json;
}

export interface LayoutRecord {
  readonly seed: number;
  readonly fountain: Json;
  /** Every placed plot, in the layout's own order. */
  readonly entries: readonly Json[];
}

export interface CruiserRecord {
  readonly plan: RouteRecord;
  readonly profile: {
    /** The loop's control points, flat `x, y, z` triples. */
    readonly points: readonly Json[];
    readonly length: Json;
    readonly stationDistance: Json;
    readonly castleSpan: Json;
    readonly crestY: Json;
  };
  readonly exitX: Json;
  readonly exitZ: Json;
}

export interface TrainRecord {
  readonly plan: RouteRecord;
}

export interface SlideRecord {
  readonly route: RouteRecord;
  /** The chute's centre line, flat `x, y, z` triples. */
  readonly points: readonly Json[];
  /** Every other field of `PlannedSlide` — all scalars. */
  readonly scalars: { readonly [key: string]: Json };
}

export interface PathGraphRecord {
  readonly graph: Json;
  /** The street paving the path search left in `paths.ts`, which the drawn paths read. */
  readonly lattice: Json;
}

export interface ParkFile {
  /** {@link PARK_FILE_FORMAT} of the writer. */
  readonly format: number;
  /** `__APP_VERSION__` of the bundle this file ships in; stamped by `vite.config.ts`. */
  readonly build: string;
  readonly seed: number;
  readonly features: {
    readonly layout: LayoutRecord;
    readonly cruiser: CruiserRecord;
    readonly train: TrainRecord;
    readonly slide: SlideRecord;
    readonly crossings: Json;
    readonly pathGraph: PathGraphRecord;
  };
  /** The plan's features in the order the driver committed them to the claims registry. */
  readonly planOrder: readonly string[];
}

/** The features a park file carries, in the driver's build order. */
export const PARK_FILE_FEATURES = ['layout', 'cruiser', 'train', 'slide', 'crossings', 'pathGraph'] as const;
export type ParkFileFeature = (typeof PARK_FILE_FEATURES)[number];

/** The decided plan, as `parkPlan.ts` holds it — what {@link encodeParkFile} reads. */
export interface DecidedPlan {
  readonly layout: ParkLayout;
  readonly cruiser: PlannedCoaster;
  readonly train: { readonly route: TrainRoute };
  readonly slide: PlannedSlide;
  readonly crossings: SolvedCrossingSites;
  readonly pathGraph: PathGraph;
  readonly pathLattice: LatticeStateSnapshot;
  readonly planOrder: readonly string[];
}

// ---------------------------------------------------------------- plain data

/** A number JSON cannot carry, tagged. */
interface TaggedNumber {
  readonly $n: 'Infinity' | '-Infinity' | 'NaN' | '-0';
}

function isTagged(value: unknown): value is TaggedNumber {
  return typeof value === 'object' && value !== null && !Array.isArray(value) && Object.keys(value).length === 1 && '$n' in value;
}

function num(value: number): Json {
  if (Number.isNaN(value)) return { $n: 'NaN' };
  if (value === Infinity) return { $n: 'Infinity' };
  if (value === -Infinity) return { $n: '-Infinity' };
  if (Object.is(value, -0)) return { $n: '-0' };
  return value;
}

function unnum(value: Json, path: string): number {
  if (typeof value === 'number') return value;
  if (isTagged(value)) {
    switch (value.$n) {
      case 'NaN':
        return NaN;
      case 'Infinity':
        return Infinity;
      case '-Infinity':
        return -Infinity;
      case '-0':
        return -0;
    }
  }
  throw new Error(`park file: ${path} is not a number (${JSON.stringify(value)})`);
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
  const proto = Object.getPrototypeOf(value) as unknown;
  if (proto !== Object.prototype && proto !== null) {
    const name = (proto as { constructor?: { name?: string } }).constructor?.name ?? '?';
    throw new Error(`park file: ${path} is a ${name}, not plain data — teach parkFile.ts to write it`);
  }
  const out: { [key: string]: Json } = {};
  for (const [key, item] of Object.entries(value)) out[key] = plain(item, `${path}.${key}`);
  return out;
}

/** Plain data back in: tagged numbers restored, everything else as written. */
function unplain(value: Json, path: string): unknown {
  if (value === null || typeof value !== 'object') return value;
  if (isTagged(value)) return unnum(value, path);
  if (Array.isArray(value)) return (value as readonly Json[]).map((item, i) => unplain(item, `${path}[${i}]`));
  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as { readonly [key: string]: Json })) {
    out[key] = unplain(item, `${path}.${key}`);
  }
  return out;
}

function flatPoints(points: readonly Vector3[]): Json[] {
  const out: Json[] = [];
  for (const p of points) out.push(num(p.x), num(p.y), num(p.z));
  return out;
}

function vectors(flat: readonly Json[], path: string): Vector3[] {
  if (flat.length % 3 !== 0) throw new Error(`park file: ${path} has ${flat.length} numbers, not triples`);
  const out: Vector3[] = [];
  for (let i = 0; i < flat.length; i += 3) {
    out.push(
      new Vector3(
        unnum(flat[i] as Json, `${path}[${i}]`),
        unnum(flat[i + 1] as Json, `${path}[${i + 1}]`),
        unnum(flat[i + 2] as Json, `${path}[${i + 2}]`),
      ),
    );
  }
  return out;
}

// ------------------------------------------------------------------- routes

const SEGMENT_KEYS = ['x0', 'z0', 'x1', 'z1', 'x2', 'z2', 'x3', 'z3', 'length', 'turn', 'kind'] as const;
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

function readRoute(record: RouteRecord, path: string): SolvedRailRoute {
  const segments = record.segments.map((s, i): CubicSegment => {
    if (s.length !== SEGMENT_KEYS.length) throw new Error(`park file: ${path}.segments[${i}] has ${s.length} fields`);
    return {
      x0: s[0],
      z0: s[1],
      x1: s[2],
      z1: s[3],
      x2: s[4],
      z2: s[5],
      x3: s[6],
      z3: s[7],
      length: s[8],
      turn: s[9],
      kind: s[10],
    };
  });
  return buildRoute(segments, record.closed, unplain(record.report, `${path}.report`) as SolveReport);
}

// ------------------------------------------------------------------- write

/** The decided plan as a park file. `build` is stamped later, by the bundle that ships it. */
export function encodeParkFile(seed: number, plan: DecidedPlan, build = 'unstamped'): ParkFile {
  const { layout, cruiser, train, slide, crossings, pathGraph, pathLattice, planOrder } = plan;

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
    },
    planOrder: [...planOrder],
  };
}

// -------------------------------------------------------------------- read

/**
 * Why a file cannot be used for this park, or null if it can. Asked once, by
 * the driver, before it trusts any of it: a file that fails here is ignored
 * whole and the park is solved, never half-hydrated.
 */
export function parkFileProblem(file: unknown, seed: number): string | null {
  if (typeof file !== 'object' || file === null) return 'not an object';
  const candidate = file as Partial<ParkFile>;
  if (candidate.format !== PARK_FILE_FORMAT) return `format ${String(candidate.format)}, this build reads ${PARK_FILE_FORMAT}`;
  if (candidate.seed !== seed) return `seed ${String(candidate.seed)}, this park is ${seed}`;
  const features = candidate.features as Record<string, unknown> | undefined;
  if (!features) return 'no features';
  const missing = PARK_FILE_FEATURES.filter((name) => features[name] === undefined);
  if (missing.length > 0) return `missing ${missing.join(', ')}`;
  if (!Array.isArray(candidate.planOrder)) return 'no planOrder';
  return null;
}

export function readLayout(record: LayoutRecord): ParkLayout {
  const entries = new Map<string, PlacedEntry>();
  record.entries.forEach((raw, i) => {
    const entry = unplain(raw, `layout.entries[${i}]`) as PlacedEntry;
    entries.set(entry.id, entry);
  });
  return {
    seed: record.seed,
    fountain: unplain(record.fountain, 'layout.fountain') as ParkLayout['fountain'],
    entries,
  };
}

/** Needs the layout decided first: `CoasterRoute` reads its station's plot. */
export function readCruiser(record: CruiserRecord): PlannedCoaster {
  const plan = readRoute(record.plan, 'cruiser.plan');
  const profile = {
    curve: coasterCurve(vectors(record.profile.points, 'cruiser.profile.points')),
    length: unnum(record.profile.length, 'cruiser.profile.length'),
    stationDistance: unnum(record.profile.stationDistance, 'cruiser.profile.stationDistance'),
    castleSpan: unplain(record.profile.castleSpan, 'cruiser.profile.castleSpan') as {
      readonly from: number;
      readonly to: number;
    } | null,
    crestY: unnum(record.profile.crestY, 'cruiser.profile.crestY'),
  };
  return cruiserPlanFromDecisions(plan, profile, {
    exitX: unnum(record.exitX, 'cruiser.exitX'),
    exitZ: unnum(record.exitZ, 'cruiser.exitZ'),
  });
}

/** The train's route and stations — the stations derived exactly as the solve derives them. */
export function readTrain(record: TrainRecord): { route: TrainRoute; stations: readonly PlannedStation[] } {
  const route = new TrainRoute(readRoute(record.plan, 'train.plan'));
  return { route, stations: planStations(route) };
}

export function readSlide(record: SlideRecord): PlannedSlide {
  const scalars = unplain(record.scalars, 'slide.scalars') as Record<string, unknown>;
  return {
    ...scalars,
    route: readRoute(record.route, 'slide.route'),
    points: vectors(record.points, 'slide.points'),
  } as unknown as PlannedSlide;
}

export function readCrossings(record: Json): SolvedCrossingSites {
  return unplain(record, 'crossings') as SolvedCrossingSites;
}

export function readPathGraph(record: PathGraphRecord): { graph: PathGraph; lattice: LatticeStateSnapshot } {
  return {
    graph: unplain(record.graph, 'pathGraph') as PathGraph,
    lattice: unplain(record.lattice, 'pathGraph.lattice') as LatticeStateSnapshot,
  };
}
