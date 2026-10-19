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
import { SimPlayer, playerHopProbe, type SimOptions } from '../playerSim.mts';
import { stepCeilingAt } from '../../src/world/building/stepReach.ts';
import { WEDGE_DEPTH, solidStepCeiling, standingHeight, wedgeDepth } from '../../src/world/standing.ts';

export type Sampler = (x: number, z: number, y: number) => number;

/**
 * How long after her last landing a jump or a drop is asked where it ended,
 * seconds: long enough for the pushes out of whatever she came down against
 * to have had their way — a crack she does not fit holds her far longer.
 */
const SETTLE_SECONDS = 1.2;

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
  /**
   * **Told of every landing that leaves her wedged** (`standing.ts`'s
   * `wedgeDepth`, the game's own rescue's measure): where, and the jump or
   * walk-off that put her there. A wedged landing is never a place she
   * reached — the search goes on without it — and it is never thrown away
   * either: `check:solids` fails on every one (QA on PR #722: the census
   * discarded them, and so could not see the library's armchairs pop her
   * out, nor a wall and a bush blink her back to where she started).
   */
  readonly onWedged?: (at: Stand, how: string) => void;
  /**
   * What counts her as wedged where a landing leaves her: the game's own
   * rescue's measure (`standing.ts`'s `wedgeDepth`) unless a proof asks for
   * another (`check:solids`' `narrow-wedges`).
   */
  readonly wedgedBy?: (collision: CollisionWorld, position: Vector3, feetY: number) => number;
  /** Her movement's options for every simulation the search runs — a proof's girl (`crackRules: false`), or `Player`'s own. */
  readonly sim?: Pick<SimOptions, 'crackRules'>;
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
  /**
   * Tops she reached and never came down from by walking off an edge — every
   * walk-off stopped at a wall or kept her at the same height. Not stuck by
   * that alone (a jump may take her off, or the next top along), so the
   * caller asks each one whether she can get back.
   */
  readonly hemmedIn: readonly ReachedTop[];
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
 *
 * With `trail`, every frame's plan position is pushed onto it, the start
 * first: the path she took, for a caller asking what she crossed rather than
 * only where she came down.
 */
export function runAndJump(
  options: Pick<ReachOptions, 'collision' | 'sample' | 'onWedged' | 'wedgedBy' | 'sim'>,
  from: Stand,
  aimX: number,
  aimZ: number,
  jumpAt: number,
  fps: number,
  onto: SolidView | null = null,
  trail?: { x: number; z: number }[],
): Stand | null {
  const dt = 1 / fps;
  let fire = false;
  // Her own auto-hop as well as the jump this run presses: a run at a low wall
  // hops it as she would, and a run along a wall's top does not.
  const autoHop = playerHopProbe(options.collision);
  const sim = new SimPlayer(options.collision, {
    ...options.sim,
    ground: options.sample,
    hopProbe: (probe, feet, feetAt) => {
      if (!fire) return autoHop(probe, feet, feetAt);
      fire = false;
      return true;
    },
  });
  sim.position.set(from.x, from.y, from.z);
  sim.previousPosition.copy(sim.position);
  sim.groundHeight = from.y;
  sim.groundY = from.y;
  trail?.push({ x: sim.position.x, z: sim.position.z });
  let jumped = false;
  let landedAt = -1;
  const frames = Math.ceil(4.5 / dt);
  // Where she was a tenth of a second ago, to tell a run that has stopped.
  const recent: number[] = [];
  const stall = Math.max(1, Math.round(0.1 / dt));
  for (let frame = 0; frame < frames; frame += 1) {
    const dx = aimX - sim.position.x;
    const dz = aimZ - sim.position.z;
    const d = Math.hypot(dx, dz);
    recent.push(d);
    // At the distance asked — or pressed against whatever stands between her
    // and the aim, her run stopped short of it: a child running at a fence
    // presses jump there, and so does she (PR #722: a crate against the
    // railway fence was a way over it that a jump only at the distances
    // asked never tried, because the fence held her further off than that).
    const stalled = recent.length > stall && (recent[recent.length - 1 - stall] ?? d) - d < 0.01;
    if (!jumped && !sim.airborne && (d <= jumpAt || stalled)) {
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
    trail?.push({ x: sim.position.x, z: sim.position.z });
    // Settled after her last landing, not her first: a landing that bounces
    // her off one top onto the ground beside it is asked where it ends, once
    // the pushes there have had their way — not one frame after she came
    // down overlapping the bush she slid off (seed 5, the open line: 0.53 m in
    // a bush a frame after landing, out of it twelve frames later). As long
    // as `SETTLE_SECONDS`: come down beside a bush with her body most of the
    // way into its crown, she is walked out of it over the best part of a
    // second (seed 9: 0.55 m in, out after 0.6 s of pushes; the escort's own
    // pace, `MAX_DEPENETRATION_SPEED`).
    if (jumped && wasAirborne && !sim.airborne) landedAt = frame;
    if (landedAt >= 0 && frame >= landedAt + Math.ceil(SETTLE_SECONDS / dt)) break;
  }
  if (!jumped || landedAt < 0 || sim.airborne) return null;
  // Where she can be, not where a landing wedged her — and said, never
  // dropped (`onWedged`).
  if ((options.wedgedBy ?? wedgeDepth)(options.collision, wedged.set(sim.position.x, sim.position.y, sim.position.z), sim.groundHeight) > WEDGE_DEPTH) {
    options.onWedged?.(
      { x: sim.position.x, z: sim.position.z, y: sim.groundHeight },
      `a run-and-jump from (${from.x.toFixed(2)}, ${from.y.toFixed(2)}, ${from.z.toFixed(2)}) at (${aimX.toFixed(2)}, ${aimZ.toFixed(2)}), jumping ${jumpAt.toFixed(2)} m out`,
    );
    return null;
  }
  return { x: sim.position.x, z: sim.position.z, y: sim.groundHeight };
}

/**
 * She walks off a top: from just inside its edge at `o`, along the outward
 * normal, for a second at a walk — her own movement, so a wall beyond the
 * edge stops her as it would. Returns where she settled if she left the top
 * and came to rest on something lower, or null.
 */
function walkOff(options: Pick<ReachOptions, 'collision' | 'sample' | 'onWedged' | 'wedgedBy' | 'sim'>, source: SolidView, o: { x: number; z: number; nx: number; nz: number }, fps: number): Stand | null {
  const dt = 1 / fps;
  const sim = new SimPlayer(options.collision, { ...options.sim, ground: options.sample, hopProbe: playerHopProbe(options.collision) });
  const x = o.x - o.nx * 0.1;
  const z = o.z - o.nz * 0.1;
  const top = source.topAt(x, z);
  // Only from where she can stand on it: a square-ended wall's footprint
  // reaches past its top, and an outline point there is the ground beside
  // the wall's end — which the first cut of the wedge clause stood her on,
  // overlapping the wall and a lamp post, and reported as a wedge.
  if (!source.standsAt(x, z) || Math.abs(standingHeight(options.sample(x, z, top), options.collision, x, z, top) - top) > 0.05) return null;
  sim.position.set(x, top, z);
  sim.previousPosition.copy(sim.position);
  sim.groundHeight = top;
  sim.groundY = top;
  // Walking for up to 1.2 s, then standing for up to a second — but where she
  // comes down is the answer, so once she has fallen and landed she stops
  // walking and settles: walking on across the ground below was most of what
  // a drop cost, and told nothing. Settled as `runAndJump` settles, after her
  // last landing (`SETTLE_SECONDS`): the pushes out of whatever she came down
  // against take that long to have their way, and a landing asked sooner read
  // as a wedge she was already being walked out of (seed 5, the open line).
  const walkFrames = Math.ceil(1.2 / dt);
  const settleFrames = Math.ceil(SETTLE_SECONDS / dt);
  let fell = false;
  let landedAt = -1;
  for (let frame = 0; frame < walkFrames + Math.ceil((SETTLE_SECONDS + 0.5) / dt); frame += 1) {
    const walking = frame < walkFrames && landedAt < 0;
    const was = sim.airborne;
    sim.step(dt, walking ? o.nx : 0, walking ? o.nz : 0, false);
    if (sim.airborne) fell = true;
    else if (fell && (was || landedAt < 0)) landedAt = frame;
    if (landedAt >= 0 && frame >= landedAt + settleFrames) break;
  }
  // Where she can be, not where a drop wedged her: off a bush into the crack
  // between two more, her body comes down overlapping them by half a metre —
  // a place she cannot stand, which the census called a trap four times
  // (seeds 2, 7, 8, 9). A drop that leaves her overlapping lands her nowhere.
  // (Not settled out: the resolver eases a body that deep out by the shortest
  // way, which can be through a thin wall or off the edge of a floor — the
  // stranded proof's pit was left through its ring, and a rock in the reptile
  // house dropped her out of the building, 17 Oct 2026.)
  if (sim.airborne) return null;
  // Measured against the top in the column she ended in, not the one she
  // set off from: out in the park a top is a height over the planet's centre,
  // and its world y falls away a fifth of a metre per metre outward at 44 m —
  // so a walk that ended on the same top, further out, read as a drop off it.
  const here = source.topAt(sim.position.x, sim.position.z);
  if (source.depthAt(sim.position.x, sim.position.z) >= -0.05 && Math.abs(sim.groundHeight - here) < 0.05) return null;
  if (!(sim.groundHeight < Math.min(top, here) - 0.05)) return null;
  // Came down, and wedged where she came down: said, never dropped.
  if ((options.wedgedBy ?? wedgeDepth)(options.collision, wedged.set(sim.position.x, sim.position.y, sim.position.z), sim.groundHeight) > WEDGE_DEPTH) {
    options.onWedged?.(
      { x: sim.position.x, z: sim.position.z, y: sim.groundHeight },
      `walking off ${source.kind || source.owner || 'a solid'} at (${o.x.toFixed(2)}, ${o.z.toFixed(2)})`,
    );
    return null;
  }
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
    const sim = new SimPlayer(options.collision, { ground: options.sample, hopProbe: playerHopProbe(options.collision) });
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

/** A scratch vector for the overlap test in {@link walkOff}. */
const wedged = new Vector3();

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
  // And everything she might clear, by the same grid: a fence's rail holds
  // nobody, but a top beside it may get her over it (stage 4b).
  const overBuckets = new Map<string, SolidView[]>();
  for (const solid of overable) {
    const r = solid.reach;
    for (let bx = Math.floor((solid.centreX - r) / BUCKET); bx <= Math.floor((solid.centreX + r) / BUCKET); bx += 1) {
      for (let bz = Math.floor((solid.centreZ - r) / BUCKET); bz <= Math.floor((solid.centreZ + r) / BUCKET); bz += 1) {
        const key = `${bx},${bz}`;
        let list = overBuckets.get(key);
        if (!list) overBuckets.set(key, (list = []));
        list.push(solid);
      }
    }
  }
  const nearIn = (index: Map<string, SolidView[]>, x: number, z: number, reach: number): Set<SolidView> => {
    const found = new Set<SolidView>();
    for (let bx = Math.floor((x - reach) / BUCKET); bx <= Math.floor((x + reach) / BUCKET); bx += 1) {
      for (let bz = Math.floor((z - reach) / BUCKET); bz <= Math.floor((z + reach) / BUCKET); bz += 1) {
        for (const solid of index.get(`${bx},${bz}`) ?? []) found.add(solid);
      }
    }
    return found;
  };
  /** Tops near here: what she might land on. */
  const near = (x: number, z: number, reach: number): Set<SolidView> => nearIn(buckets, x, z, reach);
  /** Everything near here she might clear, stood on or not. */
  const nearOverable = (x: number, z: number, reach: number): Set<SolidView> => nearIn(overBuckets, x, z, reach);

  const regions: { entry: Stand; via: string; has: (x: number, z: number, y: number) => boolean }[] = [];
  // She may start on a solid's top — a place a drop put her can be a stool —
  // and then that top is her first source: its chains and drops are tried
  // like any other's. Treated as ground only, a start on a top had no lattice
  // under it and every way off it went untried, so a stool in a cubicle read
  // as a trap.
  const startTop = solids.find((solid) => standsOn(solid, options.start)) ?? null;
  // Her lattice's flood from where she starts — **if it is where she starts.**
  // A start whose own cell the lattice has stamped solid (on a top higher than
  // a step, or a body's width from a wall) floods from the nearest free cell
  // instead, which can be on the far side of whatever shuts her in: a pit's
  // floor read as the walk outside its ring, and the search "left" the pit
  // before it began (the stranded proof, 17 Oct 2026). A drop's flood is held
  // to the same test below; the start never was.
  //
  // A start on the ground in a stamped cell — a body's width off a bush, where
  // she stands perfectly well — keeps the nearest free cell's flood if her own
  // walking takes her into it; failing that, the start is the ground within
  // half a metre of her, and the search begins from there.
  const flood = grid.reachableFrom(options.start.x, options.start.z, options.start.y, sample);
  const start = options.start;
  let first: ((x: number, z: number, y: number) => boolean) | null = null;
  if (flood && flood(start.x, start.z, start.y)) first = flood;
  else if (flood && !startTop && joinsMain(options, flood, start, options.fps ?? 60, 3)) first = flood;
  const aroundStart = (x: number, z: number): boolean => Math.hypot(x - start.x, z - start.z) < 0.5;
  regions.push({ entry: start, via: 'the start', has: first ?? (startTop ? () => false : aroundStart) });
  const groundReached = (x: number, z: number, y: number): boolean => regions.some((region) => region.has(x, z, y));

  const reached = new Map<SolidView, ReachedTop>();
  let jumps = 0;
  const beyond = new Vector3();
  /** Tops a walk-off brought her down from. */
  const walkedOffFrom = new Set<SolidView>();
  /** Regions whose entry she has hopped from (stage 2a), each once. */
  const hoppedFrom = new Set<object>();
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
        // Only if her feet would actually come to rest on THIS top there — on
        // it, not on ground that happens to stand as high (a wall's uphill end
        // on a bank: seeds 10, 11 and 15 read the grass beside a wall's end as
        // the wall's top, past its drawn coping).
        if (!solid.standsAt(ix, iz)) continue;
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
        const aimX = o.x - o.nx * Math.min(solid.halfWidth, 0.6);
        const aimZ = o.z - o.nz * Math.min(solid.halfWidth, 0.6);
        // Only where her middle may be: the leash holds it off whatever lies
        // past the space's edge — every point of the park's own wall, 7974
        // jumps of the park's census that could never stand her on it.
        if (collision.playBounds.distanceToEdge(aimX, aimZ) < PLAYER_RADIUS) continue;
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

    // 2a. Hops from where she came down. A drop into a pocket — between two
    //     bushes and a wall, a body's width wide — leaves her lattice no cell
    //     to run up from, so stage 2's run-ups, laid out from each face along
    //     its own normal, never stand in it. From the very spot she landed on,
    //     she hops at whatever stands within a few metres of her (seed 5: off
    //     a bush into such a gap and straight back onto the next bush, which
    //     the census had called a trap).
    for (const region of regions) {
      if (stopped) break;
      if (hoppedFrom.has(region)) continue;
      hoppedFrom.add(region);
      const from = region.entry;
      for (const solid of near(from.x, from.z, 3)) {
        if (stopped) break;
        if (reached.has(solid)) continue;
        const gap = -solid.depthAt(from.x, from.z);
        if (gap > 2.5 || solid.topAt(solid.centreX, solid.centreZ) - from.y > 1.6) continue;
        // The face nearest her, and a little in from it.
        let best: { x: number; z: number } | null = null;
        let bestD = Infinity;
        for (const o of outline(solid, 0.4)) {
          const d = Math.hypot(o.x - from.x, o.z - from.z);
          if (d < bestD) {
            bestD = d;
            best = { x: o.x - o.nx * Math.min(solid.halfWidth, 0.3), z: o.z - o.nz * Math.min(solid.halfWidth, 0.3) };
          }
        }
        if (!best || collision.playBounds.distanceToEdge(best.x, best.z) < PLAYER_RADIUS) continue;
        for (const jumpAt of [0.3, 0.8, 1.3]) {
          jumps += 1;
          cost.sims.jump += 1;
          aimedAt(solid, false);
          const landed = runAndJump(options, from, best.x, best.z, jumpAt, fps, solid);
          if (landed && standsOn(solid, landed)) {
            aimedAt(solid, true);
            markReached({ solid, top: landed.y, how: 'jump', at: landed, from });
            changed = true;
            break;
          }
        }
      }
      // And, asking for a way out (`until`), a hop every way the compass
      // points from where she landed — the pocket's own exits, whatever they
      // are, where every stage above asks about one solid at a time.
      if (options.until) {
        for (let k = 0; k < 16 && !stopped; k += 1) {
          const a = (k / 16) * Math.PI * 2;
          const tx = from.x + Math.cos(a) * 2.5;
          const tz = from.z + Math.sin(a) * 2.5;
          if (collision.playBounds.distanceToEdge(tx, tz) < PLAYER_RADIUS) continue;
          for (const jumpAt of [2.2, 1.0]) {
            jumps += 1;
            cost.sims.over += 1;
            const landed = runAndJump(options, from, tx, tz, jumpAt, fps);
            if (!landed || groundReached(landed.x, landed.z, landed.y)) continue;
            if (options.until(landed)) {
              stopped = true;
              break;
            }
          }
        }
      }
      // And over whatever stands within a few metres of her, to the ground
      // beyond it — stage 2b's question, asked from where she is (seed 2: a
      // hop from the gap between a pylon and a wall, over the low wall, and
      // she walks home).
      for (const solid of overable) {
        if (stopped) break;
        if (-solid.depthAt(from.x, from.z) > 2.5) continue;
        const dx = solid.centreX - from.x;
        const dz = solid.centreZ - from.z;
        const d = Math.hypot(dx, dz);
        if (d < 1e-6) continue;
        const ux = dx / d;
        const uz = dz / d;
        // Along the line through its middle to its far face, and a body beyond.
        let through = Math.max(0, d - solid.reach);
        while (through < d + solid.reach && solid.depthAt(from.x + ux * through, from.z + uz * through) < -0.02) through += 0.05;
        while (through < d + solid.reach + 0.1 && solid.depthAt(from.x + ux * through, from.z + uz * through) >= -0.02) through += 0.05;
        const lx = from.x + ux * (through + PLAYER_RADIUS + 0.3);
        const lz = from.z + uz * (through + PLAYER_RADIUS + 0.3);
        if (collision.playBounds.distanceToEdge(lx, lz) < PLAYER_RADIUS) continue;
        const top = solid.topAt(solid.centreX, solid.centreZ);
        if (top - from.y > 1.6) continue;
        const ly = sample(lx, lz, top + 2);
        if (!Number.isFinite(ly) || groundReached(lx, lz, ly)) continue;
        for (const jumpAt of [0.3, 0.8, 1.3]) {
          jumps += 1;
          cost.sims.over += 1;
          const landed = runAndJump(options, from, lx, lz, jumpAt, fps);
          if (!landed || groundReached(landed.x, landed.z, landed.y)) continue;
          if (options.until?.(landed)) {
            stopped = true;
            break;
          }
          if (walksBack(landed)) break;
          const flood = grid.floodFrom(landed.x, landed.z, landed.y, sample);
          const has = flood && flood.has(landed.x, landed.z, landed.y) ? flood.has : (x: number, z: number) => Math.hypot(x - landed.x, z - landed.z) < 0.5;
          regions.push({ entry: landed, via: `a hop over ${solid.kind || solid.owner || 'a solid'} from (${from.x.toFixed(1)}, ${from.z.toFixed(1)})`, has });
          changed = true;
          break;
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
            // Out, if that is what the caller is asking — before anything
            // else: a landing she can walk back into the search's start from
            // is still the way out if it is also outside (a pocket's own
            // search found the walk, landed on it, and threw it away).
            if (options.until?.(landed)) {
              stopped = true;
              break;
            }
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
        if (collision.playBounds.distanceToEdge(solid.centreX, solid.centreZ) < PLAYER_RADIUS) continue;
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
        walkedOffFrom.add(source.solid);
        if (groundReached(landed.x, landed.z, landed.y)) continue;
        if (options.until?.(landed)) {
          stopped = true;
          break;
        }
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
      // 4b. Hops from the top over whatever stands beside it, to the ground
      //     beyond: a crate against a fence is a way over the fence (PR #722:
      //     the railway's corridor is no body now, so nothing invisible
      //     catches her there — only the fence, by its height, and only this
      //     stage asks whether a top beside a guard gets her past it).
      // Every solid beside it, stood on or not — a fence's rail holds nobody,
      // and is exactly what a crate against it gets her over (the first cut
      // asked only the tops she lands on, and so never tried a fence).
      for (const solid of nearOverable(source.solid.centreX, source.solid.centreZ, source.solid.reach + 2.5)) {
        if (stopped) break;
        if (solid === source.solid) continue;
        const rise = solid.topAt(solid.centreX, solid.centreZ) - source.top;
        if (rise <= 0 || rise > 1.6) continue;
        // From the point of the top nearest it, backed off for a run-up.
        let best: Stand | null = null;
        let bestD = Infinity;
        for (const o of outline(source.solid, 0.4)) {
          const ix = o.x - o.nx * 0.05;
          const iz = o.z - o.nz * 0.05;
          const d = -solid.depthAt(ix, iz);
          if (d < bestD) {
            bestD = d;
            best = { x: ix, z: iz, y: source.solid.topAt(ix, iz) };
          }
        }
        if (!best || bestD > 2.5) continue;
        const bx = best.x + (source.at.x - best.x) * 0.8;
        const bz = best.z + (source.at.z - best.z) * 0.8;
        if (source.solid.depthAt(bx, bz) < 0) continue;
        const start = { x: bx, z: bz, y: source.solid.topAt(bx, bz) };
        // Through it, along the line from her start, to a body's width beyond its far face.
        const dx = solid.centreX - start.x;
        const dz = solid.centreZ - start.z;
        const d = Math.hypot(dx, dz);
        if (d < 1e-6) continue;
        const ux = dx / d;
        const uz = dz / d;
        let through = Math.max(0, d - solid.reach);
        while (through < d + solid.reach && solid.depthAt(start.x + ux * through, start.z + uz * through) < -0.02) through += 0.05;
        while (through < d + solid.reach + 0.1 && solid.depthAt(start.x + ux * through, start.z + uz * through) >= -0.02) through += 0.05;
        const lx = start.x + ux * (through + PLAYER_RADIUS + 0.3);
        const lz = start.z + uz * (through + PLAYER_RADIUS + 0.3);
        if (collision.playBounds.distanceToEdge(lx, lz) < PLAYER_RADIUS) continue;
        for (const jumpAt of [0.3, 0.8, 1.3]) {
          jumps += 1;
          cost.sims.over += 1;
          const landed = runAndJump(options, start, lx, lz, jumpAt, fps);
          if (!landed || groundReached(landed.x, landed.z, landed.y)) continue;
          if (reached.has(solid) && standsOn(solid, landed)) continue;
          if (options.until?.(landed)) {
            stopped = true;
            break;
          }
          if (walksBack(landed)) break;
          const flood = grid.floodFrom(landed.x, landed.z, landed.y, sample);
          const has = flood && flood.has(landed.x, landed.z, landed.y) ? flood.has : (x: number, z: number) => Math.hypot(x - landed.x, z - landed.z) < 0.5;
          regions.push({ entry: landed, via: `a hop over ${solid.kind || solid.owner || 'a solid'} from the top of ${source.solid.kind || source.solid.owner || 'a solid'}`, has });
          changed = true;
          break;
        }
      }
      spent('over');
    }
    say(`  round ${round}: ${reached.size} tops, ${regions.length} region(s), ${jumps} jumps simulated`);
  }

  const tops = [...reached.values()];
  return { tops, regions, groundReached, jumps, stopped, cost, hemmedIn: stopped ? [] : tops.filter((top) => !walkedOffFrom.has(top.solid)) };
}

/** Within one step of `fromY` at (x, z) — the reach her walking spends. */
export function withinOneStep(x: number, z: number, fromY: number, y: number): boolean {
  return y <= stepCeilingAt(x, z, fromY) && y >= fromY - BUILDING_STEP_UP;
}

/** A scratch vector for callers. */
export const scratch = new Vector3();
