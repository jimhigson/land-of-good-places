/**
 * **Where can she get to, jumping included?** — the reachability instrument
 * behind `check:solids` and its census (HANDOFF-engine-solids.md).
 *
 * Walking is her own lattice's question (`playerLattice.ts`: the ground, and
 * every solid within a step of it, which she climbs as a deck). Jumping is
 * asked of **her own movement**: `scripts/playerSim.mts`'s copy of
 * `Player.update`, driving the real `CollisionWorld` and the real ground
 * sampler, run up to a solid at a sprint and hopping — so a top counts as
 * reached only when a simulated child actually ended up standing on it, never
 * because a formula said her apex was high enough. That is the lesson the
 * repo paid for twice: a flood fill that agrees with you for the wrong reason
 * is worse than none (CLAUDE.md), and a jump is exactly the place a formula
 * would.
 *
 * Then she walks off what she reached: every edge of every top she stood on
 * is a place she can drop to, and a drop onto ground her lattice cannot walk
 * to from where she started is a **region** — the inside of an enclosure, the
 * far side of a fence, a roof's neighbour — flooded in its turn, and searched
 * for more tops. Repeated until nothing new turns up: chains of jumps, falls
 * and climbs included.
 */
import { Vector3 } from 'three';
import type { CollisionWorld, SolidView } from '../../src/world/Collision.ts';
import type { NavGrid } from '../../src/world/NavGrid.ts';
import { PLAYER_RADIUS, BUILDING_STEP_UP } from '../../src/core/constants.ts';
import { SimPlayer } from '../playerSim.mts';
import { stepCeilingAt } from '../../src/world/building/stepReach.ts';
import { solidStepCeiling, standingHeight } from '../../src/world/standing.ts';

export type Sampler = (x: number, z: number, y: number) => number;

/** A place she stood: where, at what height, and how she got there. */
export interface Stand {
  readonly x: number;
  readonly z: number;
  readonly y: number;
}

/** A solid whose top she reached, and the first way she was found to get there. */
export interface ReachedTop {
  readonly solid: SolidView;
  readonly top: number;
  /** `'step'`: walked up onto it. `'jump'`: from the ground beside it. `'chain'`: from another top. `'fall'`: walked off something onto it. */
  readonly how: 'step' | 'jump' | 'chain';
  /** Where she stood on it. */
  readonly at: Stand;
  /** The stand she left to get there. */
  readonly from: Stand;
}

export interface ReachOptions {
  readonly collision: CollisionWorld;
  /** The walk sampler: the ground, the decks, the ramps — without the solids, which `standingHeight` adds. */
  readonly sample: Sampler;
  /** A lattice that stands on solids (`playerNavGrid`), for this space. */
  readonly grid: NavGrid;
  /** Where she enters the space. */
  readonly start: Stand;
  /** Only solids this says are in the space (their centre). */
  readonly inSpace: (x: number, z: number) => boolean;
  /** Frames per second to simulate the jumps at. 60 is the everyday; 30 is a slow phone. */
  readonly fps?: number;
  /** Progress lines, to stderr. */
  readonly say?: (line: string) => void;
}

export interface ReachResult {
  /** Every solid top reached, first way found. */
  readonly tops: readonly ReachedTop[];
  /** Ground regions reached that walking from the start does not reach — each a drop or a jump away. */
  readonly regions: readonly { readonly entry: Stand; readonly via: string; readonly has: (x: number, z: number, y: number) => boolean }[];
  /** Is a ground point reached (any region)? */
  readonly groundReached: (x: number, z: number, y: number) => boolean;
  /** Simulated jumps attempted, for the coverage line. */
  readonly jumps: number;
}

/** Points round a solid's outline, each with the outward direction there. */
function outline(solid: SolidView, spacing: number): { x: number; z: number; nx: number; nz: number }[] {
  const out: { x: number; z: number; nx: number; nz: number }[] = [];
  // March rays out from the centre and find where `depthAt` crosses zero: works
  // for every shape `forEachSolid` offers without knowing which it is.
  const perimeter = Math.max(2 * Math.PI * solid.reach, 1);
  const count = Math.max(8, Math.min(96, Math.ceil(perimeter / spacing)));
  for (let i = 0; i < count; i += 1) {
    const a = (i / count) * Math.PI * 2;
    const dx = Math.cos(a);
    const dz = Math.sin(a);
    let lo = 0;
    let hi = solid.reach + 0.05;
    if (solid.depthAt(solid.centreX + dx * lo, solid.centreZ + dz * lo) < 0) continue;
    for (let k = 0; k < 24; k += 1) {
      const mid = (lo + hi) / 2;
      if (solid.depthAt(solid.centreX + dx * mid, solid.centreZ + dz * mid) >= 0) lo = mid;
      else hi = mid;
    }
    out.push({ x: solid.centreX + dx * lo, z: solid.centreZ + dz * lo, nx: dx, nz: dz });
  }
  return out;
}

/**
 * One run-and-jump at a solid, simulated: from `from`, sprint at `aim`, hop
 * when within `jumpAt` of it, keep steering at it until she lands, then let
 * her settle. Returns where she settled (grounded), or null if she never did.
 */
export function runAndJump(
  options: Pick<ReachOptions, 'collision' | 'sample'>,
  from: Stand,
  aimX: number,
  aimZ: number,
  jumpAt: number,
  fps: number,
): Stand | null {
  const dt = 1 / fps;
  let fire = false;
  const sim = new SimPlayer(options.collision, {
    ground: options.sample,
    hopProbe: () => {
      if (!fire) return false;
      fire = false;
      return true;
    },
  });
  sim.position.set(from.x, from.y, from.z);
  sim.previousPosition.copy(sim.position);
  sim.groundHeight = from.y;
  sim.groundY = from.y;
  let jumped = false;
  let landedAt = -1;
  const frames = Math.ceil(3 / dt);
  for (let frame = 0; frame < frames; frame += 1) {
    const dx = aimX - sim.position.x;
    const dz = aimZ - sim.position.z;
    const d = Math.hypot(dx, dz);
    if (!jumped && !sim.airborne && d <= jumpAt) {
      fire = true;
      jumped = true;
    }
    const wasAirborne = sim.airborne;
    // Steer at the aim until she has landed after the jump, then stand still.
    const steer = landedAt < 0 && d > 0.15;
    sim.step(dt, steer ? dx / d : 0, steer ? dz / d : 0, true);
    if (jumped && landedAt < 0 && wasAirborne && !sim.airborne) landedAt = frame;
    if (landedAt >= 0 && frame >= landedAt + Math.ceil(0.6 / dt)) break;
  }
  if (!jumped || landedAt < 0 || sim.airborne) return null;
  return { x: sim.position.x, z: sim.position.z, y: sim.groundHeight };
}

/**
 * She walks off a top: from just inside its edge at `o`, along the outward
 * normal, for a second at a walk — her own movement, so a wall beyond the
 * edge stops her as it would. Returns where she settled if she left the top
 * and came to rest on something lower, or null.
 */
function walkOff(options: Pick<ReachOptions, 'collision' | 'sample'>, source: SolidView, o: { x: number; z: number; nx: number; nz: number }, fps: number): Stand | null {
  const dt = 1 / fps;
  const sim = new SimPlayer(options.collision, { ground: options.sample, hopProbe: () => false });
  const x = o.x - o.nx * 0.1;
  const z = o.z - o.nz * 0.1;
  const top = source.topAt(x, z);
  sim.position.set(x, top, z);
  sim.previousPosition.copy(sim.position);
  sim.groundHeight = top;
  sim.groundY = top;
  for (let frame = 0; frame < Math.ceil(1.2 / dt); frame += 1) sim.step(dt, o.nx, o.nz, false);
  for (let frame = 0; frame < Math.ceil(1 / dt); frame += 1) sim.step(dt, 0, 0, false);
  if (sim.airborne) return null;
  if (source.depthAt(sim.position.x, sim.position.z) >= -0.05 && Math.abs(sim.groundHeight - top) < 0.05) return null;
  if (!(sim.groundHeight < top - 0.05)) return null;
  return { x: sim.position.x, z: sim.position.z, y: sim.groundHeight };
}

/**
 * **Does she walk from `from` onto ground the start already reaches?** — her
 * own movement, steered at the nearest cell of `main` within `reach` metres,
 * for a few seconds. The lattice cannot be asked this: it answers for a cell
 * whatever height it is asked at, and a stair it blocks near its flanks is a
 * stair she walks along. A "region" that this says joins the start is the
 * lattice's blind spot, not a place she was cut off in.
 */
export function joinsMain(
  options: Pick<ReachOptions, 'collision' | 'sample'>,
  main: (x: number, z: number, y: number) => boolean,
  from: Stand,
  fps: number,
  reach = 8,
): boolean {
  const targets: { x: number; z: number }[] = [];
  for (let r = 0.5; r <= reach; r += 0.5) {
    const count = Math.max(8, Math.ceil((2 * Math.PI * r) / 0.75));
    for (let i = 0; i < count; i += 1) {
      const a = (i / count) * Math.PI * 2;
      const x = from.x + Math.cos(a) * r;
      const z = from.z + Math.sin(a) * r;
      if (main(x, z, options.sample(x, z, from.y + 1))) targets.push({ x, z });
    }
    if (targets.length >= 6) break;
  }
  const dt = 1 / fps;
  for (const target of targets.slice(0, 6)) {
    const sim = new SimPlayer(options.collision, { ground: options.sample, hopProbe: () => false });
    sim.position.set(from.x, from.y, from.z);
    sim.previousPosition.copy(sim.position);
    sim.groundHeight = from.y;
    sim.groundY = from.y;
    for (let frame = 0; frame < Math.ceil(4 / dt); frame += 1) {
      const dx = target.x - sim.position.x;
      const dz = target.z - sim.position.z;
      const d = Math.hypot(dx, dz);
      if (d < 0.3) break;
      sim.step(dt, dx / d, dz / d, false);
    }
    if (Math.hypot(target.x - sim.position.x, target.z - sim.position.z) < 0.5 && !sim.airborne) return true;
  }
  return false;
}

/** Does `stand` stand on `solid`'s top? */
function standsOn(solid: SolidView, stand: Stand): boolean {
  if (solid.depthAt(stand.x, stand.z) < 0) return false;
  return Math.abs(stand.y - solid.topAt(stand.x, stand.z)) < 0.05;
}

export function reachWithJumps(options: ReachOptions): ReachResult {
  const fps = options.fps ?? 60;
  const say = options.say ?? (() => {});
  const { grid, sample, collision } = options;

  const solids: SolidView[] = [];
  collision.forEachSolid((solid) => {
    if (!solid.topIsAbsolute || !Number.isFinite(solid.topHeight)) return;
    if (!options.inSpace(solid.centreX, solid.centreZ)) return;
    solids.push(solid);
  });
  // Bucketed on an 8 m grid by footprint, for "which solids are near here".
  const BUCKET = 8;
  const buckets = new Map<string, SolidView[]>();
  for (const solid of solids) {
    const r = solid.reach;
    for (let bx = Math.floor((solid.centreX - r) / BUCKET); bx <= Math.floor((solid.centreX + r) / BUCKET); bx += 1) {
      for (let bz = Math.floor((solid.centreZ - r) / BUCKET); bz <= Math.floor((solid.centreZ + r) / BUCKET); bz += 1) {
        const key = `${bx},${bz}`;
        let list = buckets.get(key);
        if (!list) buckets.set(key, (list = []));
        list.push(solid);
      }
    }
  }
  const near = (x: number, z: number, reach: number): Set<SolidView> => {
    const found = new Set<SolidView>();
    for (let bx = Math.floor((x - reach) / BUCKET); bx <= Math.floor((x + reach) / BUCKET); bx += 1) {
      for (let bz = Math.floor((z - reach) / BUCKET); bz <= Math.floor((z + reach) / BUCKET); bz += 1) {
        for (const solid of buckets.get(`${bx},${bz}`) ?? []) found.add(solid);
      }
    }
    return found;
  };

  const regions: { entry: Stand; via: string; has: (x: number, z: number, y: number) => boolean }[] = [];
  const first = grid.reachableFrom(options.start.x, options.start.z, options.start.y, sample);
  if (!first) throw new Error(`solidReach: no lattice under the start (${options.start.x.toFixed(1)}, ${options.start.z.toFixed(1)})`);
  regions.push({ entry: options.start, via: 'the start', has: first });
  const groundReached = (x: number, z: number, y: number): boolean => regions.some((region) => region.has(x, z, y));

  const reached = new Map<SolidView, ReachedTop>();
  let jumps = 0;

  // Tops she stood on and has not yet jumped or dropped from — each is
  // searched from exactly once (a simulated jump between the same two things
  // never comes out differently a second time).
  let fresh: ReachedTop[] = [];
  // Run-ups from the ground already simulated, so a later round only tries
  // the ground a new region opened up.
  const triedRunUps = new Set<string>();

  const markReached = (top: ReachedTop): void => {
    if (reached.has(top.solid)) return;
    reached.set(top.solid, top);
    fresh.push(top);
  };

  let changed = true;
  let round = 0;
  while (changed) {
    changed = false;
    round += 1;
    // 1. Tops she walks up onto: from reached ground just outside a solid's
    //    edge, its top within the step she can take from there
    //    (`solidStepCeiling`: one step's reach, with room for her head).
    //
    //    Asked from the ground *beside* the solid, at that ground's own
    //    height — never "is the point over the solid in a reached region",
    //    because a region's membership test answers for the cell whatever
    //    height it is asked at, and so read a station's roof as reached by
    //    whoever walked under it.
    for (const solid of solids) {
      if (reached.has(solid)) continue;
      for (const o of outline(solid, 0.6)) {
        const top = solid.topAt(o.x, o.z);
        const sx = o.x + o.nx * (PLAYER_RADIUS + 0.1);
        const sz = o.z + o.nz * (PLAYER_RADIUS + 0.1);
        const ground = sample(sx, sz, top - BUILDING_STEP_UP);
        if (!(top > ground + 0.02)) continue;
        if (!groundReached(sx, sz, ground)) continue;
        if (top > solidStepCeiling(collision, o.x, o.z, ground)) continue;
        const ix = o.x - o.nx * 0.05;
        const iz = o.z - o.nz * 0.05;
        // Only if her feet would actually come to rest on THIS top there.
        if (Math.abs(standingHeight(sample(ix, iz, ground), collision, ix, iz, ground) - top) > 0.05) continue;
        markReached({ solid, top, how: 'step', at: { x: ix, z: iz, y: top }, from: { x: sx, z: sz, y: ground } });
        changed = true;
        break;
      }
    }

    // 2. Jumps from the ground beside a solid onto it.
    for (const solid of solids) {
      if (reached.has(solid)) continue;
      const points = outline(solid, 1.0);
      let done = false;
      for (const o of points) {
        if (done) break;
        // A run-up: 2.4 m out from the face, on ground she can reach.
        const sx = o.x + o.nx * (PLAYER_RADIUS + 2.4);
        const sz = o.z + o.nz * (PLAYER_RADIUS + 2.4);
        const sy = sample(sx, sz, solid.topAt(o.x, o.z) + 2);
        // Out of any jump's reach from there: not worth a simulation.
        if (solid.topAt(o.x, o.z) - sy > 1.6) continue;
        if (!groundReached(sx, sz, sy)) continue;
        const key = `${sx.toFixed(2)},${sz.toFixed(2)},${sy.toFixed(2)}`;
        if (triedRunUps.has(key)) continue;
        triedRunUps.add(key);
        const aimX = o.x - o.nx * Math.min(solid.halfWidth, 0.6);
        const aimZ = o.z - o.nz * Math.min(solid.halfWidth, 0.6);
        for (const jumpAt of [PLAYER_RADIUS + 0.9, PLAYER_RADIUS + 1.6, PLAYER_RADIUS + 0.4]) {
          jumps += 1;
          const landed = runAndJump(options, { x: sx, z: sz, y: sy }, aimX, aimZ, jumpAt, fps);
          if (landed && standsOn(solid, landed)) {
            markReached({ solid, top: landed.y, how: 'jump', at: landed, from: { x: sx, z: sz, y: sy } });
            changed = true;
            done = true;
            break;
          }
        }
      }
    }

    // 3 and 4, from every top first stood on since the last round.
    const sources = fresh;
    fresh = [];
    for (const source of sources) {
      // 3. Chains: onto any other top within a long jump of it.
      for (const solid of near(source.solid.centreX, source.solid.centreZ, source.solid.reach + 6 + 8)) {
        if (reached.has(solid)) continue;
        const gap = Math.hypot(solid.centreX - source.solid.centreX, solid.centreZ - source.solid.centreZ) - solid.reach - source.solid.reach;
        if (gap > 6) continue;
        const rise = solid.topAt(solid.centreX, solid.centreZ) - source.top;
        if (rise > 1.6) continue;
        // Start on the source's top, at the point of it nearest the target.
        let best: Stand | null = null;
        let bestD = Infinity;
        for (const o of outline(source.solid, 0.4)) {
          const ix = o.x - o.nx * 0.05;
          const iz = o.z - o.nz * 0.05;
          const d = Math.hypot(solid.centreX - ix, solid.centreZ - iz);
          if (d < bestD) {
            bestD = d;
            best = { x: ix, z: iz, y: source.solid.topAt(ix, iz) };
          }
        }
        if (!best) continue;
        // Back off along the top for a run-up, if it has room.
        const bx = best.x + (source.at.x - best.x) * 0.8;
        const bz = best.z + (source.at.z - best.z) * 0.8;
        const start = { x: bx, z: bz, y: source.solid.topAt(bx, bz) };
        if (source.solid.depthAt(bx, bz) < 0) continue;
        for (const jumpAt of [Math.max(0.3, bestD - 0.3), bestD + 0.6]) {
          jumps += 1;
          const landed = runAndJump(options, start, solid.centreX, solid.centreZ, jumpAt, fps);
          if (landed && standsOn(solid, landed)) {
            markReached({ solid, top: landed.y, how: 'chain', at: landed, from: start });
            changed = true;
            break;
          }
        }
      }
      // 4. Drops: she walks off every edge of it (her own movement, so a wall
      //    past the edge stops her) and comes down on whatever is below — a
      //    new region when walking from anywhere reached does not get there,
      //    and her own walking cannot rejoin the start from it either.
      for (const o of outline(source.solid, 0.8)) {
        const landed = walkOff(options, source.solid, o, fps);
        if (!landed) continue;
        if (groundReached(landed.x, landed.z, landed.y)) continue;
        if (joinsMain(options, groundReached, landed, fps)) continue;
        const flood = grid.reachableFrom(landed.x, landed.z, landed.y, sample);
        const has = flood && flood(landed.x, landed.z, landed.y) ? flood : (x: number, z: number) => Math.hypot(x - landed.x, z - landed.z) < 0.5;
        regions.push({ entry: landed, via: `a drop off ${source.solid.kind || source.solid.owner || 'a solid'} at (${o.x.toFixed(1)}, ${o.z.toFixed(1)})`, has });
        changed = true;
      }
    }
    say(`  round ${round}: ${reached.size} tops, ${regions.length} region(s), ${jumps} jumps simulated`);
  }

  return { tops: [...reached.values()], regions, groundReached, jumps };
}

/** Within one step of `fromY` at (x, z) — the reach her walking spends. */
export function withinOneStep(x: number, z: number, fromY: number, y: number): boolean {
  return y <= stepCeilingAt(x, z, fromY) && y >= fromY - BUILDING_STEP_UP;
}

/** A scratch vector for callers. */
export const scratch = new Vector3();
