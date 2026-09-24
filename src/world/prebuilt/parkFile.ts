import { Vector3 } from 'three';
import { parkFileProblem, unnum, unplain, type Json } from './plainData';
// Re-exported: the format's readers and writer have always asked this module.
export { parkFileProblem, unnum, unplain, type Json };
import type { ParkLayout, PlacedEntry } from '../parkLayout';
import { buildRoute, type SolveReport, type SolvedRailRoute } from '../rail/generate';
import type { CubicSegment } from '../rail/segments';
import { coasterCurve } from '../coaster/route';
import { cruiserPlanFromDecisions, type PlannedCoaster } from '../coaster/planned';
import type { PlannedSlide } from '../slide/planned';
import type { SolvedCrossingSites } from '../train/crossingSite';
import { TrainRoute } from '../train/route';
import type { PlannedStation } from '../train/plan';
import type { LatticeStateSnapshot, PathGraph } from '../paths';
import type { WorldDecisions } from '../worldPhase';
import type { BridgeDecision } from '../train/bridgeFootprint';
import type { Claim, ClaimKind, FeatureContribution } from '../../boot/groundClaims';
import { Rng } from '../../core/mathUtils';
import { terrainHeight } from '../terrain';
import { rollTree, type TreeKind } from '../treeModel';
import { bushClaim, rollBush, treeClaim, type BushDecision, type TreeDecision } from '../Scenery';
import { BUILT_DECISIONS, PARK_FILE_FEATURES, type BuiltDecision, type ParkFileFeature } from './parkFileName';
export { BUILT_DECISIONS, PARK_FILE_FEATURES, type BuiltDecision, type ParkFileFeature };

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
  /** The stations as the search placed them (`procgen/world/train/stations.ts`). */
  readonly stations: Json;
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
    /** Every world-phase decision (`worldPhase.ts`'s `WorldDecisions`), as plain data. */
    readonly world: Json;
    /**
     * Decisions made while the `World` builds (and the boundary, decided when
     * the park is first asked about), each by a search that exists only in
     * build tooling — keyed by {@link BUILT_DECISIONS}. `bridges` is one
     * `BridgeDecision` or null per crossing; the rest are their own values as
     * plain data (`built.ts`).
     */
    readonly built: { readonly [key: string]: Json };
  };
  /** The plan's features in the order the driver committed them to the claims registry. */
  readonly planOrder: readonly string[];
}



/** The decided plan, as `parkPlan.ts` holds it — what {@link encodeParkFile} reads. */
export interface DecidedPlan {
  readonly layout: ParkLayout;
  readonly cruiser: PlannedCoaster;
  readonly train: { readonly route: TrainRoute; readonly stations: readonly PlannedStation[] };
  readonly slide: PlannedSlide;
  readonly crossings: SolvedCrossingSites;
  readonly pathGraph: PathGraph;
  readonly pathLattice: LatticeStateSnapshot;
  readonly planOrder: readonly string[];
  readonly world: WorldDecisions;
  /** Every {@link BUILT_DECISIONS} value, as the searches returned it. */
  readonly built: Readonly<Record<string, unknown>>;
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

export const SEGMENT_KEYS = ['x0', 'z0', 'x1', 'z1', 'x2', 'z2', 'x3', 'z3', 'length', 'turn', 'kind'] as const;

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
  return { route, stations: unplain(record.stations, 'train.stations') as readonly PlannedStation[] };
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

// -------------------------------------------------------------- the world

/**
 * The world phase, compactly. Most of it is plain data; three parts are
 * written as decisions rather than as what was built from them, because what
 * was built is nine-tenths of the bytes:
 *
 * - a **tree** is `[x, z, kind, climbable, rollState]` and a **bush**
 *   `[x, z, rollState]` — the stream state it was rolled from ({@link Rng.state}),
 *   re-rolled on read by the same {@link rollTree}/{@link rollBush} the
 *   scatter used, from the same ground height;
 * - a **claim** is `[kind, x, z, radius]` (a disc) or
 *   `[kind, x1, z1, x2, z2, halfWidth]` (a capsule), `kind` an index into
 *   {@link CLAIM_KINDS};
 * - and the **trees' and bushes' claims** are not written at all when they are
 *   exactly one {@link treeClaim}/{@link bushClaim} per decision, section `i`
 *   for decision `i` — the writer checks that against what was committed and
 *   writes them out in full if it is ever not so.
 */
export const DERIVED = 'derived';

/** A feature's sections as `treeClaim`/`bushClaim` would make them from its decisions. */
export function derivedSections(
  feature: string,
  world: Pick<WorldDecisions, 'trees' | 'bushes'>,
): readonly (readonly [number, FeatureContribution])[] | null {
  if (feature === 'trees') return world.trees.map((t, i) => [i, { claims: [treeClaim(t.x, t.z)] }] as const);
  if (feature === 'bushes') return world.bushes.map((b, i) => [i, { claims: [bushClaim(b.x, b.z)] }] as const);
  return null;
}
export const CLAIM_KINDS: readonly ClaimKind[] = ['footprint', 'corridor', 'walkable', 'surface'];

function readClaim(record: Json, path: string): Claim {
  const r = record as readonly Json[];
  const kind = CLAIM_KINDS[r[0] as number];
  if (!kind) throw new Error(`park file: ${path} has claim kind ${String(r[0])}`);
  const n = (i: number): number => unnum(r[i] as Json, `${path}[${i}]`);
  if (r.length === 4) return { kind, shape: { shape: 'disc', x: n(1), z: n(2), radius: n(3) } };
  if (r.length === 6) return { kind, shape: { shape: 'capsule', x1: n(1), z1: n(2), x2: n(3), z2: n(4), halfWidth: n(5) } };
  throw new Error(`park file: ${path} is a claim of ${r.length} fields`);
}

function readContribution(record: Json, path: string): FeatureContribution {
  const r = record as { readonly [key: string]: Json };
  const claims = (r['claims'] as readonly Json[]).map((c, i) => readClaim(c, `${path}.claims[${i}]`));
  return {
    claims,
    ...(r['crossings'] !== undefined ? { crossings: unplain(r['crossings'], `${path}.crossings`) as FeatureContribution['crossings'] } : {}),
    ...(r['demands'] !== undefined ? { demands: unplain(r['demands'], `${path}.demands`) as FeatureContribution['demands'] } : {}),
  } as FeatureContribution;
}

export function readWorld(record: Json): WorldDecisions {
  const r = record as { readonly [key: string]: Json };
  const trees = (r['trees'] as readonly Json[]).map((raw): TreeDecision => {
    const [xr, zr, kind, climbable, state] = raw as readonly Json[];
    const x = unnum(xr as Json, 'world.trees.x');
    const z = unnum(zr as Json, 'world.trees.z');
    const tree = rollTree(new Rng(state as number), kind as TreeKind, x, terrainHeight(x, z), z);
    return { x, z, kind: kind as TreeKind, tree, climbable: climbable === 1, resume: { attempts: 0, phase: 'scatter', cell: 0 } };
  });
  const bushes = (r['bushes'] as readonly Json[]).map((raw): BushDecision => {
    const [xr, zr, state] = raw as readonly Json[];
    const x = unnum(xr as Json, 'world.bushes.x');
    const z = unnum(zr as Json, 'world.bushes.z');
    return { x, z, rollState: state as number, blobs: rollBush(new Rng(state as number), x, z), resume: 0 };
  });
  const claims = (r['claims'] as readonly Json[]).map((raw) => {
    const [feature, sections] = raw as readonly [string, readonly Json[] | typeof DERIVED];
    if (sections === DERIVED) {
      const derived = derivedSections(feature, { trees, bushes });
      if (!derived) throw new Error(`park file: world.claims.${feature} is derived, but only trees and bushes can be`);
      return { feature, sections: derived };
    }
    return {
      feature,
      sections: sections.map((entry) => {
        const [section, c] = entry as readonly [number, Json];
        return [section, readContribution(c, `world.claims.${feature}.${section}`)] as const;
      }),
    };
  });
  return {
    stallMoves: unplain(r['stallMoves'] as Json, 'world.stallMoves') as WorldDecisions['stallMoves'],
    walls: unplain(r['walls'] as Json, 'world.walls') as WorldDecisions['walls'],
    trees,
    bushes,
    fairyPoles: unplain(r['fairyPoles'] as Json, 'world.fairyPoles') as WorldDecisions['fairyPoles'],
    lamps: unplain(r['lamps'] as Json, 'world.lamps') as WorldDecisions['lamps'],
    trestles: unplain(r['trestles'] as Json, 'world.trestles') as WorldDecisions['trestles'],
    claims,
  };
}

/** One bridge decision (or null) per crossing, in crossing order. */
export function readBridges(file: ParkFile): readonly (BridgeDecision | null)[] {
  return unplain(file.features.built['bridges'] ?? null, 'built.bridges') as readonly (BridgeDecision | null)[];
}
