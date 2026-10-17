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
import { JUMP_CLEARANCE_GRACE, type CollisionWorld, type SolidView } from '../../src/world/Collision.ts';
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
  readonly how: 'start' | 'step' | 'jump' | 'chain';
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
  /**
   * Stop as soon as she stands somewhere this says yes to — a top reached or
   * a place dropped into. For "can she get out of here?", where the first way
   * out is the whole answer and the rest of the search is wasted.
   */
  readonly until?: (stand: Stand) => boolean;
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
  /** True when `until` said yes and the search stopped there. */
  readonly stopped: boolean;
  /** What the search spent, by stage: wall-clock milliseconds and simulations run — for the coverage line, and for whoever has to make it faster. */
  readonly cost: ReachCost;
}

/** The stages of {@link reachWithJumps}, in the order each round runs them. */
export type ReachStage = 'step' | 'jump' | 'over' | 'chain' | 'drop';
export interface ReachCost {
  readonly ms: Record<ReachStage, number>;
  /** Her own movement, simulated: run-and-jumps per stage, walk-offs and walk-backs (`joinsMain`). */
  readonly sims: Record<'jump' | 'over' | 'chain' | 'walkOff' | 'joinsMain', number>;
  /** Run-and-jumps aimed at each kind of solid (stages 2, 2b and 3), and how many of those kinds' solids they reached or cleared. */
  readonly byKind: ReadonlyMap<string, { sims: number; won: number }>;
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
 *
 * With `onto`, the jump is for that solid's top alone, and it is given up as
 * soon as it has missed: once she is coming down with her feet past its top
 * (and the clearance grace), nothing she can do lands her on it — the contact
 * rule now meets it side-on. The rest of the fall and the settle are spent on
 * nothing; on the park they were most of what the census cost.
 */
export function runAndJump(
  options: Pick<ReachOptions, 'collision' | 'sample'>,
  from: Stand,
  aimX: number,
  aimZ: number,
  jumpAt: number,
  fps: number,
  onto: SolidView | null = null,
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
    // Falling (her own vertical speed, which the flight carry keeps as height
    // over the ground rather than world y), and below its top in her column.
    if (onto && jumped && sim.airborne && sim.verticalVelocity < 0 && sim.position.y + JUMP_CLEARANCE_GRACE < onto.topAt(sim.position.x, sim.position.z) - 0.02) return null;
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
  // Ground the start reaches, nearest first and spread round her: one target
  // per 30° sector, the nearest in each, so a bush between her and the
  // nearest cell does not hide the open ground on her other side.
  const bySector = new Map<number, { x: number; z: number; r: number }>();
  for (let r = 0.5; r <= reach; r += 0.5) {
    const count = Math.max(8, Math.ceil((2 * Math.PI * r) / 0.75));
    for (let i = 0; i < count; i += 1) {
      const a = (i / count) * Math.PI * 2;
      const sector = Math.floor((a / (Math.PI * 2)) * 12);
      if (bySector.has(sector)) continue;
      const x = from.x + Math.cos(a) * r;
      const z = from.z + Math.sin(a) * r;
      if (main(x, z, options.sample(x, z, from.y + 1))) bySector.set(sector, { x, z, r });
    }
    if (bySector.size >= 12) break;
  }
  const targets = [...bySector.values()].sort((a, b) => a.r - b.r);
  const dt = 1 / fps;
  for (const target of targets) {
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
  if (!solid.standsAt(stand.x, stand.z)) return false;
  return Math.abs(stand.y - solid.topAt(stand.x, stand.z)) < 0.05;
}

/** How far from a solid's face she runs up to a jump: room to run, less room, a standing hop. */
const RUN_UPS = [2.4, 1.2, 0.4] as const;

export function reachWithJumps(options: ReachOptions): ReachResult {
  const fps = options.fps ?? 60;
  const say = options.say ?? (() => {});
  const { grid, sample, collision } = options;

  const solids: SolidView[] = [];
  // Everything with a top she might clear, stood on or not: what she jumps over.
  const overable: SolidView[] = [];
  collision.forEachSolid((solid) => {
    if (!solid.topIsAbsolute || !Number.isFinite(solid.topHeight)) return;
    if (!options.inSpace(solid.centreX, solid.centreZ)) return;
    overable.push(solid);
    // A top too narrow for her feet is never somewhere she lands.
    if (!solid.standsAt(solid.centreX, solid.centreZ)) return;
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
  // She may start on a solid's top — a place a drop put her can be a stool —
  // and then that top is her first source: its chains and drops are tried
  // like any other's. Treated as ground only, a start on a top had no lattice
  // under it and every way off it went untried, so a stool in a cubicle read
  // as a trap.
  const startTop = solids.find((solid) => standsOn(solid, options.start)) ?? null;
  const first = grid.reachableFrom(options.start.x, options.start.z, options.start.y, sample);
  if (!first && !startTop) throw new Error(`solidReach: no lattice under the start (${options.start.x.toFixed(1)}, ${options.start.z.toFixed(1)})`);
  regions.push({ entry: options.start, via: 'the start', has: first ?? (() => false) });
  const groundReached = (x: number, z: number, y: number): boolean => regions.some((region) => region.has(x, z, y));

  const reached = new Map<SolidView, ReachedTop>();
  let jumps = 0;
  const beyond = new Vector3();
  const byKind = new Map<string, { sims: number; won: number }>();
  const cost = {
    ms: { step: 0, jump: 0, over: 0, chain: 0, drop: 0 },
    sims: { jump: 0, over: 0, chain: 0, walkOff: 0, joinsMain: 0 },
    byKind,
  };
  const aimedAt = (solid: SolidView, won: boolean): void => {
    const key = solid.kind || solid.owner || solid.shape;
    let entry = byKind.get(key);
    if (!entry) byKind.set(key, (entry = { sims: 0, won: 0 }));
    if (won) entry.won += 1;
    else entry.sims += 1;
  };
  let clock = performance.now();
  const spent = (stage: ReachStage): void => {
    const now = performance.now();
    cost.ms[stage] += now - clock;
    clock = now;
  };
  const walksBack = (from: Stand): boolean => {
    cost.sims.joinsMain += 1;
    return joinsMain(options, groundReached, from, fps);
  };

  // Tops she stood on and has not yet jumped or dropped from — each is
  // searched from exactly once (a simulated jump between the same two things
  // never comes out differently a second time).
  let fresh: ReachedTop[] = [];
  // Run-ups from the ground already simulated, so a later round only tries
  // the ground a new region opened up.
  const triedRunUps = new Set<string>();

  let stopped = false;
  const markReached = (top: ReachedTop): void => {
    if (reached.has(top.solid)) return;
    reached.set(top.solid, top);
    fresh.push(top);
    if (options.until?.(top.at)) stopped = true;
  };
  if (startTop) markReached({ solid: startTop, top: options.start.y, how: 'start', at: options.start, from: options.start });

  let changed = true;
  let round = 0;
  while (changed && !stopped) {
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
      if (stopped) break;
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

    spent('step');
    // 2. Jumps from the ground beside a solid onto it.
    for (const solid of solids) {
      if (stopped) break;
      if (reached.has(solid)) continue;
      const points = outline(solid, 1.0);
      let done = false;
      for (const o of points) {
        if (done) break;
        // A run-up on ground she can reach: 2.4 m out from the face, or — in
        // a pocket with no room for one — 1.2 m, or a standing hop.
        for (const runUp of RUN_UPS) {
          if (done) break;
          const sx = o.x + o.nx * (PLAYER_RADIUS + runUp);
          const sz = o.z + o.nz * (PLAYER_RADIUS + runUp);
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
            cost.sims.jump += 1;
            aimedAt(solid, false);
            const landed = runAndJump(options, { x: sx, z: sz, y: sy }, aimX, aimZ, jumpAt, fps, solid);
            if (landed && standsOn(solid, landed)) {
              aimedAt(solid, true);
              markReached({ solid, top: landed.y, how: 'jump', at: landed, from: { x: sx, z: sz, y: sy } });
              changed = true;
              done = true;
              break;
            }
          }
        }
      }
    }

    spent('jump');
    // 2b. Jumps over a solid, to ground beyond it that nothing has reached
    //     yet — a bush, a rim, a low wall between her and a pocket. Leaves
    //     are not a ledge, so no stage above lands her on a bush; this is how
    //     she clears one. Asked only where the far side is not already
    //     reached, which is almost nowhere.
    for (const solid of overable) {
      if (stopped) break;
      for (const o of outline(solid, 1.0)) {
        if (stopped) break;
        const top = solid.topAt(o.x, o.z);
        // Through the solid along the inward normal to its far face, and a
        // body's width beyond it: where she would come down.
        let through = 0.05;
        while (through < 2 * solid.reach + 0.1 && solid.depthAt(o.x - o.nx * through, o.z - o.nz * through) >= -0.02) through += 0.05;
        if (through >= 2 * solid.reach + 0.1) continue;
        const lx = o.x - o.nx * (through + PLAYER_RADIUS + 0.3);
        const lz = o.z - o.nz * (through + PLAYER_RADIUS + 0.3);
        // Nowhere to come down past the space's own edge — the leash holds
        // her inside it at every height, which is clause 7's to prove, and
        // every outline point of the park's boundary wall was otherwise nine
        // jumps at the void (15078 of the park's 39003, seed 5).
        if (collision.playBounds.distanceToEdge(lx, lz) < PLAYER_RADIUS) continue;
        const ly = sample(lx, lz, top + 2);
        if (!Number.isFinite(ly) || groundReached(lx, lz, ly)) continue;
        // Nor inside another solid: what is beyond is that solid's side, and
        // its top is stage 2's and 3's.
        if (collision.deepestSolidOverlap(beyond.set(lx, ly, lz), PLAYER_RADIUS) > 0.02) continue;
        // A run-up on her side, on ground she has reached, within a jump of the top.
        let over = false;
        for (const runUp of RUN_UPS) {
          if (over || stopped) break;
          const sx = o.x + o.nx * (PLAYER_RADIUS + runUp);
          const sz = o.z + o.nz * (PLAYER_RADIUS + runUp);
          const sy = sample(sx, sz, top + 2);
          if (top - sy > 1.6) continue;
          if (!groundReached(sx, sz, sy)) continue;
          const key = `over ${sx.toFixed(2)},${sz.toFixed(2)},${sy.toFixed(2)}`;
          if (triedRunUps.has(key)) continue;
          triedRunUps.add(key);
          for (const jumpAt of [PLAYER_RADIUS + 0.9, PLAYER_RADIUS + 1.6, PLAYER_RADIUS + 2.3]) {
            jumps += 1;
            cost.sims.over += 1;
            aimedAt(solid, false);
            const landed = runAndJump(options, { x: sx, z: sz, y: sy }, lx, lz, jumpAt, fps);
            if (!landed || groundReached(landed.x, landed.z, landed.y)) continue;
            over = true;
            aimedAt(solid, true);
            // Over, and somewhere new: her walking first, then her lattice, as a drop's.
            if (walksBack(landed)) break;
            const flood = grid.floodFrom(landed.x, landed.z, landed.y, sample);
            const has = flood && flood.has(landed.x, landed.z, landed.y) ? flood.has : (x: number, z: number) => Math.hypot(x - landed.x, z - landed.z) < 0.5;
            regions.push({ entry: landed, via: `a jump over ${solid.kind || solid.owner || 'a solid'} at (${o.x.toFixed(1)}, ${o.z.toFixed(1)})`, has });
            changed = true;
            if (options.until?.(landed)) stopped = true;
            break;
          }
        }
      }
    }

    spent('over');
    // 3 and 4, from every top first stood on since the last round.
    const sources = fresh;
    fresh = [];
    for (const source of sources) {
      if (stopped) break;
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
          cost.sims.chain += 1;
          aimedAt(solid, false);
          const landed = runAndJump(options, start, solid.centreX, solid.centreZ, jumpAt, fps, solid);
          if (landed && standsOn(solid, landed)) {
            aimedAt(solid, true);
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
      spent('chain');
      for (const o of outline(source.solid, 0.8)) {
        cost.sims.walkOff += 1;
        const landed = walkOff(options, source.solid, o, fps);
        if (!landed) continue;
        if (groundReached(landed.x, landed.z, landed.y)) continue;
        // Her own walking first — cheap, local, and the common answer: she
        // came down beside ground already reached and walks onto it.
        if (walksBack(landed)) continue;
        // Then her lattice from where she landed: if it walks into ground
        // already reached, this is the same place by another door.
        const flood = grid.floodFrom(landed.x, landed.z, landed.y, sample);
        let joins = false;
        if (flood && flood.has(landed.x, landed.z, landed.y)) {
          flood.forEachCell((x, z) => {
            if (!joins && groundReached(x, z, sample(x, z, landed.y + 1))) joins = true;
          });
        }
        if (joins) continue;
        const has = flood && flood.has(landed.x, landed.z, landed.y) ? flood.has : (x: number, z: number) => Math.hypot(x - landed.x, z - landed.z) < 0.5;
        regions.push({ entry: landed, via: `a drop off ${source.solid.kind || source.solid.owner || 'a solid'} at (${o.x.toFixed(1)}, ${o.z.toFixed(1)})`, has });
        changed = true;
        if (options.until?.(landed)) {
          stopped = true;
          break;
        }
      }
      spent('drop');
    }
    say(`  round ${round}: ${reached.size} tops, ${regions.length} region(s), ${jumps} jumps simulated`);
  }

  return { tops: [...reached.values()], regions, groundReached, jumps, stopped, cost };
}

/** Within one step of `fromY` at (x, z) — the reach her walking spends. */
export function withinOneStep(x: number, z: number, fromY: number, y: number): boolean {
  return y <= stepCeilingAt(x, z, fromY) && y >= fromY - BUILDING_STEP_UP;
}

/** A scratch vector for callers. */
export const scratch = new Vector3();
