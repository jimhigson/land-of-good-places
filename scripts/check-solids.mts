/**
 * **Anything solid is somewhere she can land, and nothing she can land on is a
 * way out** — the engine rework of 17 Oct 2026 (HANDOFF-engine-solids.md).
 *
 * ```
 * node --no-warnings --import ./scripts/ts-extension-resolver-register.mjs scripts/check-solids.mts
 * ```
 *
 * Jim: *"anything should be jumpable with no special 'floor' being marked to
 * make it so, rework the engine this way."* A solid is a 3-D body — its sides
 * are what she bumps, its top is where she lands, gravity drops her on the
 * highest thing beneath her — and guards stop her by being taller than she can
 * reach, never by a flag. This check holds the built park to that:
 *
 * 1. **Real tops.** Every solid in every space stands to a real, finite top.
 *    The only exceptions are invisible solids with nothing drawn to measure,
 *    each named below with the reason it exists.
 * 2. **Tops where they are drawn.** Every solid low enough to be landed on
 *    stands to the top its mesh is drawn at — raycast off the real scene
 *    (`lib/drawnTops.mts`), never re-read from the constant that placed it.
 * 3. **The precedents land, and her own movement is the instrument.**
 *    (`playerSim.mts`) — walking up onto what is no higher than a step, a
 *    sprint and a hop onto what is — she comes down on a castle bench, a
 *    hotel sofa, a library cushion and a banquet table; and, as controls, on a
 *    test block a metre tall and *not* on one 1.6 m tall.
 * 4. **The census.** Every top she can reach, jumps and chains of jumps
 *    included (`lib/solidReach.mts`), in the park and inside every building,
 *    grouped by kind with a deep link to one of each. No escape is reached —
 *    a roof, an enclosure, the railway (its corridor, or any place inside its
 *    fences), the edge of a space — and every region she can drop into, she
 *    can leave. A guard stood on but not passed (a fence's top, a bridge's
 *    parapet) is reported on stderr, not failed: what it guards is asserted.
 * 5. **Marches.** Every kind of solid this rework added is walked at from
 *    sixteen bearings at 5 cm and at `PLAYER_LONGEST_STEP`, and no body ends up
 *    inside one below its top.
 * 6. **Headroom.** Every top she can reach has room for all of her over it.
 * 7. **The boundary at height.** The park's edge holds a body pushed at it at
 *    every height from the grass to ten metres up.
 *
 * And where only the jet pack takes her, said on stderr and asserted nowhere:
 * she flies out the way she flew in (see the note at the end).
 *
 * Every clause is proved red by `SOLIDS_PROVE=<name>` (see {@link PROVE}),
 * which breaks the one thing the clause is for and must turn it red, and the
 * coverage of every clause is said on stderr on every run.
 */
import './headless-canvas.mjs';
import { Vector3 } from 'three';
import { buildHeadlessPark } from './park-harness.mts';
import { indexDrawnTops } from './lib/drawnTops.mts';
import { reachWithJumps, joinsMain, runAndJump, type ReachCost, type ReachedTop, type Stand } from './lib/solidReach.mts';
import { GRAVITY, JUMP_APEX_HEIGHT, JUMP_SPEED, SimPlayer, playerHopProbe } from './playerSim.mts';
import { CollisionWorld, FOOT_HALF_WIDTH, JUMP_CLEARANCE_GRACE, type SolidView } from '../src/world/Collision.ts';
import { playerNavGrid } from '../src/world/playerLattice.ts';
import { BUILDING_STEP_UP, HOTEL_PLAY_RADIUS, PLAYER_LONGEST_STEP, PLAYER_RADIUS, MAX_FRAME_DELTA } from '../src/core/constants.ts';
import { KID_HEIGHT } from '../src/art/models/kidHeight.ts';
import { SPACE_GARDEN, spaceAt } from '../src/world/spaces.ts';
import { GARDEN_PLAY_BOUNDARY, circleBoundary, type ParkBoundary } from '../src/world/boundary.ts';
import { ENTRANCE_PLAYER_X, ENTRANCE_PLAYER_Z } from '../src/world/entrance/layout.ts';
import { CASTLE_FLOORS, floorX, floorZ } from '../src/world/building/floors.ts';
import { castleFloorBounds } from '../src/world/building/floorBounds.ts';
import { LIFT_DOOR_MAX_Z, LIFT_DOOR_MIN_Z, LIFT_STAND_X } from '../src/world/building/layout.ts';
import { LOBBY, ROOMS } from '../src/world/hotel/layout.ts';
import { LIBRARY_ARRIVAL, LIBRARY_ORIGIN_X, LIBRARY_ORIGIN_Z } from '../src/world/library/layout.ts';
import { REPTILE_ARRIVAL_X, REPTILE_ARRIVAL_Z, REPTILE_HOUSE_ORIGIN_X, REPTILE_HOUSE_ORIGIN_Z } from '../src/world/reptileHouse/layout.ts';
import { PARK_SEED_ASKED } from '../src/world/parkManifest.ts';
import { FENCE_OFFSET } from '../src/world/train/clearance.ts';
import { altitudeAt, terrainHeight } from '../src/world/terrain.ts';
import { carryReference } from '../src/world/building/stepReach.ts';
import { standingHeight } from '../src/world/standing.ts';

/**
 * **The red proofs.** Each breaks one thing and must turn its clause red, in
 * the part (`--part`) that clause runs in:
 *
 * - `infinite` (core): registers an invisible pillar with no top — clause 1.
 * - `tall-top` (park): a prop made too tall — a solid round a station bench
 *   half a metre over its drawn seat — clause 2 finds her standing on air.
 * - `too-tall` (core): the precedent bench made 1 m taller — clause 3 cannot
 *   land.
 * - `rail-step`, `low-roof`, `low-exhibit` (park): a step by the gate carrying
 *   the kind of the railway's corridor, a stall's roof, an exhibit — each of
 *   clause 4's escapes must find her on it.
 * - `trap` (core): a ring of tall walls round a castle crate, so dropping off
 *   the crate leaves her nowhere to go — clause 4's trap clause.
 * - `ghost` (core): a bench drawn and never registered — clause 5's march
 *   walks into it.
 * - `stranded` (park): a 0.8 m block filling a ring of 2.4 m walls she climbs
 *   to by a staircase of blocks — clause 4's every-top-leavable clause.
 * - `no-headroom` (park): a canopy hung 1 m over a reached top — clause 6.
 * - `no-bounds` (core): the park's leash taken off — clause 7.
 */
const PROVE = process.env['SOLIDS_PROVE'] ?? '';
/** The frame rate the census simulates her at: 60 unless `SOLIDS_FPS` asks for another (never in the chain). */
const CENSUS_FPS = Number(process.env['SOLIDS_FPS'] ?? 60);
/** The top of her jump as a frame clock at `fps` samples it — the sim's own integration, from the ground. */
function sampledApex(fps: number): number {
  const dt = 1 / fps;
  let v = JUMP_SPEED;
  let y = 0;
  let top = 0;
  while (v > -JUMP_SPEED) {
    v -= GRAVITY * dt;
    y += v * dt;
    top = Math.max(top, y);
  }
  return top;
}
/** Clause 4 is minutes long; `SOLIDS_SKIP_CENSUS=1` runs the rest alone (never in the chain). */
const SKIP_CENSUS = process.env['SOLIDS_SKIP_CENSUS'] === '1';
/** And `SOLIDS_SPACES=park,library` runs the census over the spaces whose names hold one of those words (never in the chain). */
const ONLY_SPACES = (process.env['SOLIDS_SPACES'] ?? '').split(',').map((word) => word.trim()).filter(Boolean);

/**
 * **Which part of the check this run is: `--part=core` or `--part=park`** — or
 * every clause, with no `--part`. The chain runs the two as two steps, so that
 * each fits a CI shard on its own:
 *
 * - `core` (`check:solids`): clauses 1, 3, 5 and 7, the census (4, with 2 and
 *   6 over what it reached) inside every building — the castle's floors, the
 *   hotel's lobby, the library, the reptile house — and the jet pack's report.
 * - `park` (`check:solids-park`): the census of the park, with 2 and 6 over
 *   what it reached.
 */
const PARTS = ['core', 'park'] as const;
type Part = (typeof PARTS)[number];
const PART_ASKED = process.argv.find((arg: string) => arg.startsWith('--part='))?.slice('--part='.length) ?? null;
if (PART_ASKED !== null && !(PARTS as readonly string[]).includes(PART_ASKED)) {
  console.error(`check:solids: --part is one of ${PARTS.join(', ')}, not '${PART_ASKED}'`);
  process.exit(2);
}
/** Does this run do `part`'s clauses? */
const inPart = (part: Part): boolean => PART_ASKED === null || PART_ASKED === part;
const STEP_OF: Readonly<Record<Part, string>> = { core: 'check:solids', park: 'check:solids-park' };

let failures = 0;
function say(ok: boolean, line: string): void {
  console.log(`  ${ok ? '✓' : '✗'} ${line}`);
  if (!ok) failures += 1;
}
function note(line: string): void {
  process.stderr.write(`check:solids — ${line}\n`);
}
/** A search's spend, by stage, for a coverage line: seconds, and the simulations each stage ran. */
function costLine(cost: ReachCost): string {
  const stages = Object.entries(cost.ms).map(([stage, ms]) => `${stage} ${(ms / 1000).toFixed(0)} s`).join(', ');
  const sims = Object.entries(cost.sims).map(([kind, n]) => `${kind} ${n}`).join(', ');
  const kinds = [...cost.byKind].sort((a, b) => b[1].sims - a[1].sims).slice(0, 8).map(([kind, k]) => `${kind} ${k.sims}/${k.won}`).join(', ');
  return `${stages} (simulated: ${sims}; jumps aimed/won by kind: ${kinds})`;
}


if (PART_ASKED !== null) {
  note(`this is --part=${PART_ASKED}: the rest of the check is ${PARTS.filter((part) => part !== PART_ASKED).map((part) => `${STEP_OF[part]} (--part=${part})`).join(' and ')}, run as their own steps`);
}

const park = buildHeadlessPark();
const world = park.world;
const collision = world.collision;
const sample = park.sample;

/**
 * **The escapes, by what she reaches** (the brief: out of the park, onto the
 * railway, into an enclosure, over a ride's fence, onto a roof). Each is
 * asserted as the place itself, never as a guard's top: a guard stood on but
 * not passed has guarded, and is reported, not failed.
 *
 * - Roofs: standing on one is the escape.
 * - Enclosures: an exhibit's solid is its habitat — standing on it is
 *   standing over the animals.
 * - The railway: its own clause below, and any top of its corridor.
 * - Out of the park: clause 7, at every height.
 */
const ROOF_KINDS: Readonly<Record<string, string>> = {
  'stall awning': "a stall's roof",
  'stall parasol': "the keychain cart's parasol",
  'station canopy': "a station's roof",
  'bus shelter canopy': "the bus shelter's roof",
  'castle roof deck': "the castle's roof",
  'library roof': "the library's roof",
  'reptile house roof': "the reptile house's roof",
  'roof pavilion': "the roof garden pavilion's roof",
  'roof turret': "a roof garden turret's top",
  'toilet privacy roof': "a hotel bathroom nook's roof",
};
// The proofs that add a solid add it here, before anything is measured. None
// edits a solid in place: a clause must go red because the park it measures is
// broken, never because its own bookkeeping was.
{
  const before: SolidView[] = [];
  collision.forEachSolid((solid) => before.push(solid));
  if (PROVE === 'infinite') collision.kinded('proof: a pillar with no top', () => collision.addCircle(ENTRANCE_PLAYER_X + 4, ENTRANCE_PLAYER_Z, 0.4));
  if (PROVE === 'tall-top') {
    // A prop made too tall: a solid round a station bench, half a metre over
    // its drawn seat — she stands on air over the bench.
    const bench = before.find((s) => s.kind === 'station bench');
    if (bench) collision.kinded('station bench', () => collision.addCircle(bench.centreX, bench.centreZ, 1.2, bench.topAt(bench.centreX, bench.centreZ) + 0.5, false, true));
  }
  if (PROVE === 'too-tall') {
    const bench = before.find((s) => s.owner === 'castle' && s.shape === 'box' && Math.abs(s.halfWidth - 0.36) < 0.02);
    if (bench) collision.kinded('proof: the bench a metre taller', () => collision.addCircle(bench.centreX, bench.centreZ, bench.reach, bench.topAt(bench.centreX, bench.centreZ) + 1, false, true));
  }
  // A step a child walks onto, 3 m in front of the gate, carrying the kind of
  // an escape: each must turn its own clause red through the census.
  const stepNearGate = (kind: string): void => {
    const x = ENTRANCE_PLAYER_X + 3;
    const z = ENTRANCE_PLAYER_Z;
    collision.kinded(kind, () => collision.addCircle(x, z, 0.7, sample(x, z, 50) + 0.4, false, true));
  };
  if (PROVE === 'stranded') {
    // A pit whose floor is too high to be the ground and too low to jump out
    // of: a ring of thick 2.4 m walls round a 0.8 m block that fills it, and
    // a staircase up to the ring — a 1.0 m block she jumps onto from the
    // grass, a 1.9 m one beside it, the ring beside that. From the ring she
    // jumps down onto the pit's floor, and from the floor nothing she can do
    // gets her out: its edges are the walls, and the ring is 1.6 m over it.
    const cx = ENTRANCE_PLAYER_X;
    const cz = ENTRANCE_PLAYER_Z - 8;
    const g = sample(cx, cz, 50);
    collision.kinded('proof: the first step up', () => collision.addCircle(cx + 5.2, cz, 1.3, g + 1.0, false, true));
    collision.kinded('proof: the second step up', () => collision.addCircle(cx + 2.9, cz, 1.0, g + 1.9, false, true));
    for (let i = 0; i < 12; i += 1) {
      const a = (i / 12) * Math.PI * 2;
      const b = ((i + 1) / 12) * Math.PI * 2;
      collision.kinded('proof: the ring round the pit', () =>
        collision.addWall(cx + Math.cos(a) * 1.6, cz + Math.sin(a) * 1.6, cx + Math.cos(b) * 1.6, cz + Math.sin(b) * 1.6, 0.35, g + 2.4, false, true),
      );
    }
    collision.kinded("proof: the pit's floor", () => collision.addCircle(cx, cz, 1.3, g + 0.8, false, true));
  }
  if (PROVE === 'rail-step') stepNearGate('railway corridor');
  // **The railway's guards, by height alone** (PR #722's review): every top as
  // wide as its footprint — the width rule off, so no rail, post or parapet is
  // kept from being stood on by how narrow it is. The corridor between the
  // fences is a closure, never a body, so nothing invisible holds her either.
  // What must hold her off the line is then the height of the fence and the
  // railings she can see: the railway clause stays green. (The one proof that
  // edits solids in place, by design; the clauses about where she stands go
  // red with rails for floors, as they should.)
  if (PROVE === 'guards-alone') collision.everyTopWide();
  // ... and its control: a crate a metre tall against the fence nearest the
  // gate, the kind of thing that lets her over a fence — from its top a jump
  // clears the fence, and the railway clause must see her land on the line.
  if (PROVE === 'fence-crate') {
    const route = world.train.route;
    const post = before
      .filter((s) => s.kind === 'railway fence post')
      .sort((a, b) => Math.hypot(a.centreX - ENTRANCE_PLAYER_X, a.centreZ - ENTRANCE_PLAYER_Z) - Math.hypot(b.centreX - ENTRANCE_PLAYER_X, b.centreZ - ENTRANCE_PLAYER_Z))[0];
    if (post) {
      const rail = route.pointAt(route.distanceNear(post.centreX, post.centreZ), new Vector3());
      const out = Math.hypot(post.centreX - rail.x, post.centreZ - rail.z) || 1;
      const ux = (post.centreX - rail.x) / out;
      const uz = (post.centreZ - rail.z) / out;
      const cx = post.centreX + ux * (post.reach + 0.75);
      const cz = post.centreZ + uz * (post.reach + 0.75);
      collision.kinded('proof: a crate against the fence', () => collision.addBox(cx, cz, 0.6, 0.6, Math.atan2(ux, uz), 0, sample(cx, cz, 50) + 1.0, false, true));
    }
  }
  if (PROVE === 'low-roof') stepNearGate('stall awning');
  // The review's own control (PR #722): a step kinded as one of the roofs the
  // clause used not to know. It stayed green; it must go red.
  if (PROVE === 'reptile-roof') stepNearGate('reptile house roof');
  // Every roof the clause names, one step each, in a ring round the gate's
  // arrival: the clause must name all of them.
  if (PROVE === 'every-roof') {
    const roofs = Object.keys(ROOF_KINDS);
    roofs.forEach((kind, i) => {
      const a = (i / roofs.length) * Math.PI * 2;
      const x = ENTRANCE_PLAYER_X + Math.cos(a) * 4.5;
      const z = ENTRANCE_PLAYER_Z + Math.sin(a) * 4.5;
      collision.kinded(kind, () => collision.addCircle(x, z, 0.7, sample(x, z, 50) + 0.4, false, true));
    });
  }
  // A roof nobody told the clause about: the kinds guard must name it.
  if (PROVE === 'new-roof') stepNearGate('proof: a garage roof');
  if (PROVE === 'low-exhibit') stepNearGate("proof's enclosure");
}

const solids: SolidView[] = [];
collision.forEachSolid((solid) => solids.push(solid));

// ---------------------------------------------------------------------------
// 1. Real tops
// ---------------------------------------------------------------------------
if (inPart('core')) {
console.log('1. REAL TOPS — every solid stands to a real top:');
  const flagged = new Map<string, number>();
  for (const solid of solids) {
    const finite = solid.topIsAbsolute && Number.isFinite(solid.topHeight);
    if (finite) continue;
    const key = `${solid.kind || `(no kind, owner '${solid.owner}', ${solid.shape} ${solid.halfWidth.toFixed(2)})`}${solid.topIsAbsolute ? '' : ' [relative top]'}`;
    flagged.set(key, (flagged.get(key) ?? 0) + 1);
  }
  const without = [...flagged.values()].reduce((a, b) => a + b, 0);
  say(flagged.size === 0, `${solids.length} solids, ${solids.length - without} with a real top, ${without} without one${flagged.size ? `: ${[...flagged].map(([k, n]) => `${k} ×${n}`).join('; ')}` : ''}`);
  // The railway's corridor between its fences is no solid at all: a closure
  // the route lattice and the planner read, which no body meets
  // (`CollisionWorld.asClosure`). Nothing invisible stops her.
  note(`clause 1 covers ${solids.length} solids in every space, every one with nothing exempt; ${collision.closureCount} closures (the railway's corridor) are not solids — the route lattice and the planner read them, and no body meets them`);
}

// ---------------------------------------------------------------------------
// 3. The precedents land
// ---------------------------------------------------------------------------
/**
 * Her own jump at a solid, the census's way (`runAndJump`): a sprint from
 * `from` at a point just inside its near edge, hopping at several distances,
 * and where she settled when one of them stood her on it — or null.
 */
function hopOnto(world: CollisionWorld, ground: (x: number, z: number, y: number) => number, solid: SolidView, from: Stand): Stand | null {
  // Something no higher than a step she walks onto: the step rule, not a jump.
  {
    const sim = new SimPlayer(world, { ground, hopProbe: playerHopProbe(world) });
    sim.position.set(from.x, from.y, from.z);
    sim.previousPosition.copy(sim.position);
    sim.groundHeight = from.y;
    sim.groundY = from.y;
    for (let frame = 0; frame < 240; frame += 1) {
      const ax = solid.centreX - sim.position.x;
      const az = solid.centreZ - sim.position.z;
      const d = Math.hypot(ax, az);
      if (d < 0.1) break;
      // Easing off as she arrives, so she stops on a cushion rather than
      // sliding off its far side on her own momentum.
      const ease = Math.min(1, d / 1.2);
      sim.step(1 / 60, (ax / d) * ease, (az / d) * ease, false);
    }
    for (let frame = 0; frame < 30; frame += 1) sim.step(1 / 60, 0, 0, false);
    const at = { x: sim.position.x, z: sim.position.z, y: sim.groundHeight };
    if (!sim.airborne && solid.depthAt(at.x, at.z) >= 0 && Math.abs(at.y - solid.topAt(at.x, at.z)) < 0.05) return at;
  }
  const dx = solid.centreX - from.x;
  const dz = solid.centreZ - from.z;
  const d = Math.hypot(dx, dz);
  // The point of its edge facing her, and a little in from it.
  let edge = 0;
  for (let t = 0; t <= d; t += 0.02) {
    if (solid.depthAt(from.x + (dx / d) * t, from.z + (dz / d) * t) >= 0) {
      edge = t;
      break;
    }
  }
  const aimX = from.x + (dx / d) * (edge + Math.min(0.3, solid.halfWidth));
  const aimZ = from.z + (dz / d) * (edge + Math.min(0.3, solid.halfWidth));
  for (const jumpAt of [PLAYER_RADIUS + 0.9, PLAYER_RADIUS + 1.6, PLAYER_RADIUS + 0.4, PLAYER_RADIUS + 2.2]) {
    const landed = runAndJump({ collision: world, sample: ground }, from, aimX, aimZ, jumpAt, 60);
    if (landed && solid.depthAt(landed.x, landed.z) >= 0 && Math.abs(landed.y - solid.topAt(landed.x, landed.z)) < 0.05) return landed;
  }
  return null;
}

if (inPart('core')) {
  console.log('\n3. PRECEDENTS — her own jump comes down on what was always landable:');
  const precedents: { what: string; kind: (s: SolidView) => boolean }[] = [
    { what: 'a castle bench', kind: (s) => s.owner === 'castle' && s.shape === 'box' && Math.abs(s.halfWidth - 0.36) < 0.02 },
    { what: 'a hotel sofa', kind: (s) => s.owner === 'hotel' && s.shape === 'box' && Math.abs(s.halfWidth - 0.48) < 0.02 },
    { what: 'a library cushion', kind: (s) => s.owner === 'library' && s.shape === 'circle' && Math.abs(s.halfWidth - 0.45) < 0.02 },
    { what: 'a banquet table', kind: (s) => s.kind === 'banquet table' },
  ];
  for (const precedent of precedents) {
    const solid = solids.find(precedent.kind);
    if (!solid) {
      say(false, `${precedent.what}: none found in the built park — the precedent this control stands on is gone`);
      continue;
    }
    const top = solid.topAt(solid.centreX, solid.centreZ);
    // Run at it from 3.2 m out along whichever bearing leaves room.
    let landedOn: Stand | null = null;
    for (let i = 0; i < 8 && !landedOn; i += 1) {
      const a = (i / 8) * Math.PI * 2;
      const sx = solid.centreX + Math.cos(a) * (solid.reach + 3.2);
      const sz = solid.centreZ + Math.sin(a) * (solid.reach + 3.2);
      const sy = sample(sx, sz, top);
      if (!(collision.deepestSolidOverlap(new Vector3(sx, sy, sz), PLAYER_RADIUS) <= 0)) continue;
      landedOn = hopOnto(collision, sample, solid, { x: sx, z: sz, y: sy });
    }
    say(landedOn !== null, `${precedent.what} (top ${(top - sample(solid.centreX + solid.reach + 1, solid.centreZ, top)).toFixed(2)} m): ${landedOn ? `a sprint and a hop stands her on it at y ${landedOn.y.toFixed(2)}` : 'no run at it from any side came down on it'}`);
  }
  // The instrument can say yes and can say no, on a world built for it.
  const test = new CollisionWorld();
  const flat = (): number => 0;
  test.setPlayBounds(circleBoundary(1e4));
  test.kinded('control block', () => test.addBox(0, 0, 0.6, 0.6, 0, 0, 1.0, false, true));
  test.kinded('control block', () => test.addBox(20, 0, 0.6, 0.6, 0, 0, 1.6, false, true));
  const blocks: SolidView[] = [];
  test.forEachSolid((solid) => blocks.push(solid));
  const low = hopOnto(test, flat, blocks.find((b) => b.centreX === 0)!, { x: -4, z: 0, y: 0 });
  const high = hopOnto(test, flat, blocks.find((b) => b.centreX === 20)!, { x: 16, z: 0, y: 0 });
  say(low !== null, `CONTROL: a 1.0 m block is landed on${low ? ` (at y ${low.y.toFixed(2)})` : ' — NOT, so this instrument cannot say yes'}`);
  say(high === null, `CONTROL: a 1.6 m block is not${high ? ` — she stood on it at y ${high.y.toFixed(2)}, so this instrument cannot say no` : ''}`);
}

// ---------------------------------------------------------------------------
// 4. The census
// ---------------------------------------------------------------------------
interface SpaceRun {
  readonly name: string;
  readonly start: Stand;
  readonly bounds: ParkBoundary;
  readonly link: (stand: Stand) => string;
}
const seed = PARK_SEED_ASKED;
/** The deep link into each hotel room (`main.ts`'s list); the corridor has none of its own. */
const HOTEL_ROOM_LINKS: Readonly<Record<string, string>> = {
  'hotel.breakfast': '/hotel-bathroom',
  'hotel.garden': '/hotel-bathroom-garden',
  'hotel.ocean': '/hotel-bathroom-ocean',
  'hotel.suite': '/hotel-suite',
};
const yaw = (dx: number, dz: number): number => Math.round((Math.atan2(dx, dz) * 180) / Math.PI);
const spaceRuns: SpaceRun[] = [
  {
    name: 'the park',
    start: { x: ENTRANCE_PLAYER_X, z: ENTRANCE_PLAYER_Z, y: sample(ENTRANCE_PLAYER_X, ENTRANCE_PLAYER_Z, 500) },
    bounds: GARDEN_PLAY_BOUNDARY,
    link: (s) => `/spawn?pos=${s.x.toFixed(1)},${s.z.toFixed(1)}&facing=${yaw(-s.x, -s.z)}&seed=${seed}`,
  },
  ...CASTLE_FLOORS.map((floor) => ({
    name: `the castle's ${floor.name.replace(/^The /, '').toLowerCase()}`,
    start: (() => {
      const x = floorX(floor, LIFT_STAND_X);
      const z = floorZ(floor, (LIFT_DOOR_MIN_Z + LIFT_DOOR_MAX_Z) / 2);
      return { x, z, y: sample(x, z, 50) };
    })(),
    bounds: castleFloorBounds(floor),
    link: (s: Stand) => `/castle?deck=${floor.index}&at=${(s.x - floor.originX).toFixed(1)},${(s.z - floor.originZ).toFixed(1)}&seed=${seed}`,
  })),
  {
    name: "the hotel's lobby",
    start: { x: LOBBY.originX, z: LOBBY.originZ + 8, y: 0 },
    bounds: circleBoundary(60, LOBBY.originX, LOBBY.originZ),
    link: () => `/hotel?seed=${seed}`,
  },
  // Every other room of the hotel, each from its own way in, in the play
  // bounds the game gives it (PR #722's review: the suite's beds and pet beds
  // became solids here, and five rooms went uncensused).
  ...ROOMS.filter((room) => room !== LOBBY).map((room) => {
    const way = world.hotel.openArea(room)[0] ?? { x: room.originX, z: room.originZ };
    const link = HOTEL_ROOM_LINKS[room.space] ?? '/hotel';
    return {
      name: `the hotel's ${room.space.replace(/^hotel\./, '')} room`,
      start: { x: way.x, z: way.z, y: sample(way.x, way.z, 3) },
      bounds: circleBoundary(HOTEL_PLAY_RADIUS, room.originX, room.originZ),
      link: () => `${link}?seed=${seed}`,
    };
  }),
  {
    name: 'the library',
    start: { x: LIBRARY_ORIGIN_X + LIBRARY_ARRIVAL.x, z: LIBRARY_ORIGIN_Z + LIBRARY_ARRIVAL.z, y: 0 },
    bounds: circleBoundary(60, LIBRARY_ORIGIN_X, LIBRARY_ORIGIN_Z),
    link: (s) => `/library?at=${(s.x - LIBRARY_ORIGIN_X).toFixed(1)},${(s.z - LIBRARY_ORIGIN_Z).toFixed(1)}&seed=${seed}`,
  },
  {
    name: 'the reptile house',
    start: { x: REPTILE_HOUSE_ORIGIN_X + REPTILE_ARRIVAL_X, z: REPTILE_HOUSE_ORIGIN_Z + REPTILE_ARRIVAL_Z, y: 0 },
    bounds: circleBoundary(70, REPTILE_HOUSE_ORIGIN_X, REPTILE_HOUSE_ORIGIN_Z),
    link: (s) => `/reptile-house?at=${(s.x - REPTILE_HOUSE_ORIGIN_X).toFixed(1)},${(s.z - REPTILE_HOUSE_ORIGIN_Z).toFixed(1)}&seed=${seed}`,
  },
];

/**
 * **A kind named like a roof must be one of the roofs above, or say here why it
 * is not** — so a roof added later cannot be missing from the clause, as the
 * castle's, the library's, the reptile house's and the roof garden's were
 * (PR #722's review: a step kinded `reptile house roof` stayed green).
 */
const ROOFISH = /\b(roof|canopy|awning|parasol|turret|pavilion|lid)\b/i;
const NOT_ROOF_KINDS: Readonly<Record<string, string>> = {
  'roof trough': "a trough of shrubs standing on the roof garden's floor, the floor she walks",
  'castle roof battlement': "the roof garden's parapet: a guard, held by the garden's bounds (`castleFloorBounds`)",
  'station canopy post': "a post under a station's roof, its top under the roof",
};
const isEnclosure = (kind: string): boolean => /'s enclosure$/.test(kind);
/** Guards whose top she may stand on without getting past them: reported with how, never failed. */
const PERCH_KINDS: Readonly<Record<string, string>> = {
  'railway fence': 'the railway',
  'railway fence post': 'the railway',
  'bridge parapet': 'the drop beside a bridge',
  'castle roof battlement': "the drop off the castle's roof garden",
};
if (inPart('core')) {
  console.log('\n4a. ROOFS — every kind named like a roof is one the census asserts, or says why not:');
  const kinds = [...new Set(solids.map((solid) => solid.kind))].filter((kind) => ROOFISH.test(kind));
  const unclassified = kinds.filter((kind) => !(kind in ROOF_KINDS) && !(kind in NOT_ROOF_KINDS));
  say(
    unclassified.length === 0,
    `${kinds.length} kinds named like a roof in the built park and its buildings: ${kinds.filter((kind) => kind in ROOF_KINDS).length} roofs the census asserts, ${kinds.filter((kind) => kind in NOT_ROOF_KINDS).length} not roofs, with their reasons${unclassified.length ? ` — and ${unclassified.length} neither: ${unclassified.join(', ')}` : ''}`,
  );
}

const allReached: { space: string; top: ReachedTop }[] = [];
/** The census's spaces in this part: the park in `park`, every building in `core`. */
const spacesInPart = spaceRuns.filter((run) => (run.name === 'the park' ? inPart('park') : inPart('core')));
if (SKIP_CENSUS) {
  note('clause 4 (the census) SKIPPED by SOLIDS_SKIP_CENSUS=1 — this run says nothing about what she can reach');
} else {
  console.log('\n4. THE CENSUS — what she can reach by jumping, chains included:');
  if (PROVE === 'trap') {
    const crate = solids.find((s) => s.kind === 'crate');
    if (crate) {
      for (let i = 0; i < 12; i += 1) {
        const a = (i / 12) * Math.PI * 2;
        const b = ((i + 1) / 12) * Math.PI * 2;
        collision.kinded('proof: a pit round a crate', () =>
          collision.addWall(crate.centreX + Math.cos(a) * 3, crate.centreZ + Math.sin(a) * 3, crate.centreX + Math.cos(b) * 3, crate.centreZ + Math.sin(b) * 3, 0.2, sample(crate.centreX, crate.centreZ, 50) + 4, false, true),
        );
      }
    }
  }
  const grid = playerNavGrid(world);
  const route = world.train.route;
  const railScratch = new Vector3();
  const runs = ONLY_SPACES.length ? spacesInPart.filter((run) => ONLY_SPACES.some((word) => run.name.includes(word))) : spacesInPart;
  if (runs.length < spaceRuns.length) {
    const others = spaceRuns.filter((run) => !runs.includes(run));
    note(
      `clause 4 ran over ${runs.length} of ${spaceRuns.length} spaces (${[PART_ASKED !== null ? `--part=${PART_ASKED}` : '', ONLY_SPACES.length ? `SOLIDS_SPACES=${ONLY_SPACES.join(',')}` : ''].filter(Boolean).join(', ')}) — it says nothing about ${others.map((run) => `${run.name}${spacesInPart.includes(run) ? '' : ` (${STEP_OF[run.name === 'the park' ? 'park' : 'core']}'s)`}`).join(', ')}`,
    );
  }
  for (const run of runs) {
    collision.setPlayBounds(run.bounds);
    const id = spaceAt(run.start.x, run.start.z);
    const t0 = performance.now();
    const result = reachWithJumps({
      collision,
      sample,
      grid,
      start: run.start,
      inSpace: (x, z) => spaceAt(x, z) === id,
      fps: CENSUS_FPS,
    });
    const main = result.regions[0]!.has;
    for (const top of result.tops) allReached.push({ space: run.name, top });
    const byKind = new Map<string, { n: number; how: Map<string, number>; example: ReachedTop }>();
    for (const top of result.tops) {
      const key = top.solid.kind || `(${top.solid.owner || 'unowned'} ${top.solid.shape})`;
      let entry = byKind.get(key);
      if (!entry) byKind.set(key, (entry = { n: 0, how: new Map(), example: top }));
      entry.n += 1;
      entry.how.set(top.how, (entry.how.get(top.how) ?? 0) + 1);
    }
    console.log(`  ${run.name}: ${result.tops.length} tops reached, ${result.regions.length - 1} region(s) she can drop into, ${result.jumps} jumps simulated, ${((performance.now() - t0) / 1000).toFixed(0)} s`);
    note(`clause 4, ${run.name}: ${costLine(result.cost)}`);
    for (const [kind, entry] of [...byKind].sort((a, b) => b[1].n - a[1].n)) {
      console.log(`    ${String(entry.n).padStart(4)}  ${kind.padEnd(34)} [${[...entry.how].map(([h, n]) => `${h} ${n}`).join(', ')}]  ${run.link(entry.example.at)}`);
    }
    // Roofs and enclosures: the places themselves.
    const roofs = result.tops.filter((top) => top.solid.kind in ROOF_KINDS);
    say(roofs.length === 0, `${run.name}: no roof reached${roofs.length ? ` — ${roofs.length}: ${[...new Set(roofs.map((t) => ROOF_KINDS[t.solid.kind]))].join(', ')}, e.g. ${run.link(roofs[0]!.at)}` : ''}`);
    const exhibits = result.tops.filter((top) => isEnclosure(top.solid.kind));
    say(exhibits.length === 0, `${run.name}: no enclosure reached${exhibits.length ? ` — ${exhibits.length}: ${[...new Set(exhibits.map((t) => t.solid.kind))].join(', ')}, e.g. ${run.link(exhibits[0]!.at)}` : ''}`);
    // Guards stood on but not passed: what they guard is asserted directly.
    const perched = result.tops.filter((top) => top.solid.kind in PERCH_KINDS);
    if (perched.length) {
      const byKind = new Map<string, ReachedTop[]>();
      for (const top of perched) byKind.set(top.solid.kind, [...(byKind.get(top.solid.kind) ?? []), top]);
      note(`${run.name}: guards stood on but not passed — ${[...byKind].map(([kind, tops]) => `${kind} ×${tops.length} (${[...new Set(tops.map((t) => t.how))].join('/')}), e.g. ${run.link(tops[0]!.at)}`).join('; ')}`);
    }
    // On the railway: a reached place inside the fences that walking from the start does not reach.
    if (run.name === 'the park') {
      const onRail: { stand: Stand; how: string }[] = [];
      const consider = (stand: Stand, how: string): void => {
        const at = route.pointAt(route.distanceNear(stand.x, stand.z), railScratch);
        const off = Math.hypot(at.x - stand.x, at.z - stand.z);
        if (off > FENCE_OFFSET - 0.2) return;
        if (stand.y > terrainHeight(stand.x, stand.z) + 2.5) return; // a bridge deck over it
        if (main(stand.x, stand.z, stand.y)) return; // a level crossing: walked to
        onRail.push({ stand, how: `${how}, ${off.toFixed(2)} m off the rail's centre, ${altitudeAt(stand.x, stand.y, stand.z).toFixed(2)} m up` });
      };
      for (const top of result.tops) {
        // The corridor's own top — the seam under a bridge deck — is the railway wherever it stands.
        if (top.solid.kind === 'railway corridor') onRail.push({ stand: top.at, how: `on the railway's corridor (${top.how}), ${altitudeAt(top.at.x, top.at.y, top.at.z).toFixed(2)} m up` });
        else consider(top.at, `on a ${top.solid.kind || 'solid'} (${top.how})`);
      }
      for (const region of result.regions.slice(1)) consider(region.entry, `${region.via}`);
      say(onRail.length === 0, `the railway is out of reach: ${onRail.length} place(s) inside its fences reached off the walk${onRail.length ? `:\n${onRail.slice(0, 12).map((r) => `      ${run.link(r.stand)} — ${r.how}`).join('\n')}` : ''}`);
    }
    // Off the edge of a space: a drop to well below where she started.
    const below = result.regions.slice(1).filter((region) => region.entry.y < run.start.y - 1.5 && run.name !== 'the park');
    say(below.length === 0, `${run.name}: nowhere off its own floor${below.length ? ` — ${below.map((r) => `${r.via} lands at y ${r.entry.y.toFixed(1)}`).join('; ')}` : ''}`);
    // Every region leavable: from where she landed, her own jumps get her back.
    const stuck: string[] = [];
    for (const region of result.regions.slice(1)) {
      let out = false;
      // Out is anywhere her walking from the start reaches, or any top she
      // walks off into it; the search stops at the first.
      const outside = (at: Stand): boolean => main(at.x, at.z, at.y) || joinsMain({ collision, sample }, main, at, 60);
      try {
        out = reachWithJumps({
          collision,
          sample,
          grid,
          start: region.entry,
          inSpace: (x, z) => spaceAt(x, z) === id && Math.hypot(x - region.entry.x, z - region.entry.z) < 14,
          fps: CENSUS_FPS,
          until: outside,
        }).stopped;
      } catch {
        out = joinsMain({ collision, sample }, main, region.entry, 60, 14);
      }
      if (!out) stuck.push(`${region.via} → ${run.link(region.entry)}`);
    }
    say(stuck.length === 0, `${run.name}: every one of ${result.regions.length - 1} region(s) she can drop into, she can get out of again${stuck.length ? ` — trapped: ${stuck.join('; ')}` : ''}`);
    // Every top leavable: a top she walked off an edge of, she has left; one
    // she could not — hemmed in, or level with the next top along — is asked
    // the region's question: from where she stood on it, do her own walking
    // and jumping get her back to the walk?
    const strandedOn: string[] = [];
    for (const top of result.hemmedIn) {
      const outside = (at: Stand): boolean => main(at.x, at.z, at.y) || joinsMain({ collision, sample }, main, at, 60);
      let out = false;
      try {
        out = reachWithJumps({
          collision,
          sample,
          grid,
          start: top.at,
          inSpace: (x, z) => spaceAt(x, z) === id && Math.hypot(x - top.at.x, z - top.at.z) < 14,
          fps: CENSUS_FPS,
          until: outside,
        }).stopped;
      } catch {
        out = joinsMain({ collision, sample }, main, top.at, 60, 14);
      }
      if (!out) strandedOn.push(`${top.solid.kind || top.solid.owner || 'a solid'} → ${run.link(top.at)}`);
    }
    say(strandedOn.length === 0, `${run.name}: every one of ${result.tops.length} top(s) she reaches, she can get down from again (${result.hemmedIn.length} with no edge to walk off, each searched)${strandedOn.length ? ` — stranded on: ${strandedOn.join('; ')}` : ''}`);
  }
  collision.setPlayBounds(GARDEN_PLAY_BOUNDARY);
  note(
    `clause 4 simulated her jumps at ${CENSUS_FPS} fps over ${runs.length} spaces and reached ${allReached.length} tops. ` +
      `A faster frame rate jumps higher: her jump's top is ${sampledApex(CENSUS_FPS).toFixed(4)} m at ${CENSUS_FPS} fps and ` +
      `${sampledApex(120).toFixed(4)} m at 120 fps (${JUMP_APEX_HEIGHT.toFixed(4)} m in the limit), so a faster screen can reach ` +
      `a little higher than this run measured; SOLIDS_FPS=120 runs the census at 120 fps (PR #722's review did, on seed 5: clean)`,
  );
  note(`clause 4 censused seed ${PARK_SEED_ASKED}'s park and nothing else: the other shipped parks are not censused by this run (LGP_SEED=<n> asks for another)`);
}

// ---------------------------------------------------------------------------
// 2. Tops where they are drawn — at every place the census stood her
// ---------------------------------------------------------------------------
if (spacesInPart.length) {
console.log('\n2. DRAWN TOPS — where she lands on a solid, its drawn top is under her feet:');
  /**
   * Kinds whose top is not their mesh's highest point by a ruling, each with
   * it. Foliage is soft — leaves are what she brushes through — so a solid
   * under a plant stands to the solid and she stands in the leaves.
   */
  // Every building's inside is hidden while she is in the park, which is where
  // this one world stands; the census stood her in each, so each is measured
  // as drawn while she is there. Spaces are disjoint in plan, so showing all
  // four roots at once draws nothing over another space's floor. A building
  // missing here reads "nothing drawn under her" at every landing in it.
  const drawn = indexDrawnTops(park.scene, [world.building.interiorRoot, world.hotel.hotelRoot, world.library.roomRoot, world.reptileHouse.hallRoot]);
  const SOFT_OVER: Readonly<Record<string, string>> = {
    'roof trough': 'the shrubs in it are foliage (planters ruling, 7 Aug 2026)',
    'mall planter': 'the shrubs in it are foliage (planters ruling, 7 Aug 2026)',
    bush: 'she stands in its leaves (the planters ruling); its solid is its crown over the clump',
    'water fight hedge': 'its top is puffs of leaves (the planters ruling)',
    tree: 'its top is the crown of leaves (the planters ruling)',
    'shop counter': "the stock on display is the shop's dressing: she stands on the counter's board among it",
    'palm at': 'its fronds are foliage',
    "bed '": "a planting bed's plants are foliage",
  };
  /**
   * Her feet: where she stands is a footprint, not a point — her two feet a
   * stance apart (`Player`'s dust trail puts them 0.14 m either side) and
   * half a foot beyond that (`FOOT_HALF_WIDTH`). The drawn top under her is, of the drawn surfaces
   * within it, the one nearest her feet: an arm of the throne beside the
   * seat she stands on is not what she stands on.
   */
  const FEET = 0.14 + FOOT_HALF_WIDTH;
  /**
   * **Leaves are not what she stands on** (the planters ruling): a wall or a
   * post with a bush grown over it is measured to its own top, not to the
   * puff of leaves beside her feet (seed 12: "0.34 m sunk into the drawn
   * bushes", standing on a garden wall).
   */
  const FOLIAGE = /^(bushes|tree-canopies|tree-cones|treeline-canopies)(\[|$)/;
  const underFeet = (x: number, z: number, from: number): { y: number; name: string } | null => {
    let best: { y: number; name: string } | null = null;
    for (const [dx, dz] of [[0, 0], [FEET, 0], [-FEET, 0], [0, FEET], [0, -FEET], [FEET * Math.SQRT1_2, FEET * Math.SQRT1_2], [-FEET * Math.SQRT1_2, FEET * Math.SQRT1_2], [FEET * Math.SQRT1_2, -FEET * Math.SQRT1_2], [-FEET * Math.SQRT1_2, -FEET * Math.SQRT1_2]] as const) {
      const hit = drawn.topAt(x + dx, z + dz, from - 1.2, 2, 1.2 + 0.4, FOLIAGE);
      // Carried to her own column at its distance from the planet's centre,
      // so the comparison below is still in her one column.
      const y = hit ? carryReference(x + dx, z + dz, hit.y, x, z) : Number.NaN;
      if (hit && (!best || Math.abs(y - from) < Math.abs(best.y - from))) best = { y, name: hit.name };
    }
    return best;
  };
  const TOLERANCE = 0.15;
  let measured = 0;
  let foliage = 0;
  let nothing = 0;
  const off: { kind: string; line: string }[] = [];
  for (const { space, top } of allReached) {
    const kind = top.solid.kind || top.solid.owner;
    if (Object.keys(SOFT_OVER).some((k) => kind.startsWith(k))) {
      foliage += 1;
      continue;
    }
    const at = top.at;
    // The drawn surface under her feet: the highest drawn thing below her
    // head, between a step under her feet and a little over them.
    const hit = underFeet(at.x, at.z, at.y);
    if (!hit) {
      nothing += 1;
      off.push({ kind, line: `${kind} in ${space} at (${at.x.toFixed(1)}, ${at.z.toFixed(1)}): she stands at y ${at.y.toFixed(2)} with nothing drawn under her` });
      continue;
    }
    measured += 1;
    const delta = at.y - hit.y; // flat-ok: both in her one column, her feet and the drawn top under them
    if (Math.abs(delta) > TOLERANCE) {
      off.push({ kind, line: `${kind} in ${space} at (${at.x.toFixed(1)}, ${at.z.toFixed(1)}): she stands ${delta > 0 ? `${delta.toFixed(2)} m over` : `${(-delta).toFixed(2)} m sunk into`} the drawn ${hit.name.split('<')[0]}` });
    }
  }
  const byKind = new Map<string, string[]>();
  for (const entry of off) byKind.set(entry.kind, [...(byKind.get(entry.kind) ?? []), entry.line]);
  say(
    off.length === 0,
    `${measured} landings on solids measured against the drawn scene: ${off.length} more than ${TOLERANCE} m off the drawn top${off.length ? `, by kind:\n      ${[...byKind].map(([k, lines]) => `${k} ×${lines.length}: ${lines[0]}`).join('\n      ')}` : ''}`,
  );
  note(`clause 2 measured ${measured} of ${allReached.length} reached tops; ${foliage} were foliage-topped by ruling (${Object.entries(SOFT_OVER).map(([k, why]) => `${k}: ${why}`).join('; ')})${SKIP_CENSUS ? ' — and the census was skipped, so this asserted nothing' : ''}`);
}

// ---------------------------------------------------------------------------
// 5. Marches at the new solids
// ---------------------------------------------------------------------------
if (inPart('core')) {
console.log('\n5. MARCHES — walked at from sixteen bearings, at 5 cm and at a sprint stride:');
  /** The kinds this rework made solid that had no collider at all before it. */
  const NEW_KINDS = [
    'dodgems post',
    'ferris deck',
    'ferris deck rail',
    'paddling pool rim',
    'water fight sprinkler',
    'bus shelter bench',
    'station bench',
    'crate',
    'woodpile',
    'roof trough',
    'throne dais',
    'throne',
    'throne back',
    'armour on its plinth',
    'treasure chest',
    'fireside bench',
  ];
  const all: SolidView[] = [];
  collision.forEachSolid((s) => all.push(s));
  if (PROVE === 'ghost') {
    // A station bench drawn and never registered: the march must walk into it.
    const bench = all.find((s) => s.kind === 'station bench');
    if (bench) {
      const cx = bench.centreX + 6;
      const cz = bench.centreZ + 6;
      const top = sample(cx, cz, 50) + 0.45;
      all.unshift({
        ...bench,
        kind: 'station bench',
        centreX: cx,
        centreZ: cz,
        reach: 0.5,
        halfWidth: 0.25,
        depthAt: (x, z) => 0.5 - Math.hypot(x - cx, z - cz),
        topAt: () => top,
      });
    }
  }
  let marches = 0;
  const into: string[] = [];
  const missing: string[] = [];
  for (const kind of NEW_KINDS) {
    const ofKind = all.filter((s) => s.kind === kind);
    if (ofKind.length === 0) {
      missing.push(kind);
      continue;
    }
    for (const solid of ofKind.slice(0, 3)) {
      const space = spaceAt(solid.centreX, solid.centreZ);
      collision.setPlayBounds(space === SPACE_GARDEN ? GARDEN_PLAY_BOUNDARY : circleBoundary(1e4, solid.centreX, solid.centreZ));
      for (let i = 0; i < 16; i += 1) {
        const a = (i / 16) * Math.PI * 2;
        for (const step of [0.05, PLAYER_LONGEST_STEP]) {
          marches += 1;
          const from = solid.reach + PLAYER_RADIUS + 1.5;
          const p = new Vector3(solid.centreX + Math.cos(a) * from, 0, solid.centreZ + Math.sin(a) * from);
          p.y = sample(p.x, p.z, solid.topAt(solid.centreX, solid.centreZ) + 1);
          // Only from ground she could be standing on, on the solid's own
          // floor: not off the edge of a roof, not inside something else.
          const base = sample(solid.centreX, solid.centreZ, solid.topAt(solid.centreX, solid.centreZ));
          if (Math.abs(p.y - base) > 0.7 || collision.deepestSolidOverlap(p, PLAYER_RADIUS) > 0) {
            marches -= 1;
            continue;
          }
          let deepest = -Infinity;
          for (let t = 0; t < from + 1; t += step) {
            collision.resolveMovement(p, -Math.cos(a) * step, -Math.sin(a) * step, PLAYER_RADIUS, 0, MAX_FRAME_DELTA);
            p.y = sample(p.x, p.z, p.y);
            // Inside it: her body overlapping its footprint between its base
            // and its top — not stood on it, not walked under it.
            if (p.y + JUMP_CLEARANCE_GRACE < solid.topAt(p.x, p.z) && p.y + KID_HEIGHT > solid.baseAt(p.x, p.z)) {
              deepest = Math.max(deepest, solid.depthAt(p.x, p.z) + PLAYER_RADIUS);
            }
          }
          if (deepest > 0.07) into.push(`${kind} at (${solid.centreX.toFixed(1)}, ${solid.centreZ.toFixed(1)}), ${(a * 180 / Math.PI).toFixed(0)}° at ${step} m: ${deepest.toFixed(2)} m into it`);
        }
      }
    }
  }
  collision.setPlayBounds(GARDEN_PLAY_BOUNDARY);
  say(into.length === 0, `${marches} marches at ${NEW_KINDS.length - missing.length} new kinds of solid: ${into.length} got a body into one below its top${into.length ? `:\n      ${into.slice(0, 8).join('\n      ')}` : ''}`);
  if (missing.length) note(`clause 5: no ${missing.join(', ')} in this park (a seed may not build one), so none was marched at`);
}

// ---------------------------------------------------------------------------
// 6. Headroom
// ---------------------------------------------------------------------------
if (spacesInPart.length) {
console.log('\n6. HEADROOM — every top she reaches has room for all of her:');
  if (PROVE === 'no-headroom') {
    const victim = allReached.find((r) => r.space === 'the park');
    if (victim) collision.kinded('proof: a low canopy', () => collision.addCircle(victim.top.at.x, victim.top.at.z, 0.5, victim.top.at.y + 1.5, false, true, victim.top.at.y + 1.0));
  }
  const cramped = allReached.filter(({ top }) => collision.ceilingAt(top.at.x, top.at.z, top.at.y + 1e-3) < top.at.y + KID_HEIGHT - 1e-3);
  say(cramped.length === 0, `${allReached.length} reached tops: ${cramped.length} with something over them lower than her head${cramped.length ? ` — e.g. ${cramped[0]!.top.solid.kind} at (${cramped[0]!.top.at.x.toFixed(1)}, ${cramped[0]!.top.at.z.toFixed(1)})` : ''}`);
  if (SKIP_CENSUS) note('clause 6 asserted nothing: it measures the census, which was skipped');
}

// ---------------------------------------------------------------------------
// 7. The boundary at height
// ---------------------------------------------------------------------------
if (inPart('core')) {
console.log('\n7. THE BOUNDARY AT HEIGHT — the park\'s edge holds her at every height:');
  if (PROVE === 'no-bounds') collision.setPlayBounds(circleBoundary(1e5));
  let pushes = 0;
  let unplaced = 0;
  const out: string[] = [];
  for (let i = 0; i < 64; i += 1) {
    const a = (i / 64) * Math.PI * 2;
    // March outward from well inside the edge along this bearing until the edge.
    let r = 20;
    while (GARDEN_PLAY_BOUNDARY.distanceToEdge(Math.cos(a) * r, Math.sin(a) * r) > 1.5 && r < 400) r += 0.5;
    for (const lift of [0, 1.5, 4, 10]) {
      // From somewhere her body fits: inward from there until nothing holds
      // it. A start inside a solid is a body the resolver pushes out of it,
      // wherever that is — the railway's corridor runs within a body of the
      // edge on some bearings, and a start in it measured the corridor, not
      // the edge.
      let from = r;
      const p = new Vector3();
      const place = (at: number): void => {
        p.set(Math.cos(a) * at, terrainHeight(Math.cos(a) * at, Math.sin(a) * at) + lift, Math.sin(a) * at);
      };
      place(from);
      while (collision.deepestSolidOverlap(p, PLAYER_RADIUS, lift, undefined, KID_HEIGHT) > 0 && from > r - 12) place((from -= 0.25));
      if (collision.deepestSolidOverlap(p, PLAYER_RADIUS, lift, undefined, KID_HEIGHT) > 0) {
        unplaced += 1;
        continue;
      }
      pushes += 1;
      for (let k = 0; k < 40; k += 1) collision.resolveMovement(p, Math.cos(a) * 0.3, Math.sin(a) * 0.3, PLAYER_RADIUS, lift, MAX_FRAME_DELTA);
      const gap = GARDEN_PLAY_BOUNDARY.distanceToEdge(p.x, p.z);
      if (gap < PLAYER_RADIUS - 0.05) out.push(`${(a * 180 / Math.PI).toFixed(0)}° at ${lift} m up: ${gap.toFixed(2)} m from the edge`);
    }
  }
  collision.setPlayBounds(GARDEN_PLAY_BOUNDARY);
  say(out.length === 0, `${pushes} bodies pushed 12 m outward at 64 bearings, from the grass to 10 m up: ${out.length} got past the edge${out.length ? ` — ${out.slice(0, 6).join('; ')}` : ''}`);
  if (unplaced) note(`clause 7: ${unplaced} of ${64 * 4} bearing-heights had no room for her within 12 m of the edge and pushed nothing`);
}

// ---------------------------------------------------------------------------
// Where only the jet pack takes her — said, not asserted
// ---------------------------------------------------------------------------
/**
 * **Somewhere only the jet pack takes her is not a trap: she flies out the way
 * she flew in.** With every solid at its real height the jet pack now comes
 * down on any top it is flown over — a roof, a fence, the far side of the
 * railway — where before an infinitely tall rule turned it away. That is
 * reported here for whoever wonders where she can now get to, and asserted
 * nowhere: a place she can walk or jump to is the census's (clause 4: every
 * region she can drop into, she can leave), and a place she has to fly to,
 * she can fly from — `Player.canFlyHere` holds anywhere in the park the pack
 * is worn, and it is hers to put back on.
 *
 * (Until 17 Oct 2026 this was a clause, "open to the sky", that searched her
 * jumps out of every such place. It failed on the strip of grass beyond the
 * railway's far fence — 708 cells she cannot walk to and cannot jump out of,
 * because the fence is now a guard — which is exactly a place she flew to.)
 */
if (inPart('core') && !(ONLY_SPACES.length && !ONLY_SPACES.some((word) => 'the park'.includes(word)))) {
  collision.setPlayBounds(GARDEN_PLAY_BOUNDARY);
  const grid = playerNavGrid(world);
  const startY = sample(ENTRANCE_PLAYER_X, ENTRANCE_PLAYER_Z, 500);
  const main = grid.floodFrom(ENTRANCE_PLAYER_X, ENTRANCE_PLAYER_Z, startY, sample)!.has;
  const STEP = 0.5;
  const body = new Vector3();
  const cells = new Map<string, Stand & { on: string }>();
  const keyOf = (i: number, j: number): string => `${i},${j}`;
  for (let x = -130; x <= 130; x += STEP) {
    for (let z = -130; z <= 130; z += STEP) {
      if (spaceAt(x, z) !== SPACE_GARDEN) continue;
      if (GARDEN_PLAY_BOUNDARY.distanceToEdge(x, z) < PLAYER_RADIUS) continue;
      // Where she comes down from high above: the highest thing she can stand on.
      const ground = sample(x, z, 1e3);
      const y = standingHeight(ground, collision, x, z, 1e3);
      if (!Number.isFinite(y)) continue;
      body.set(x, y, z);
      if (collision.deepestSolidOverlap(body, PLAYER_RADIUS, 0, undefined, KID_HEIGHT) > 0.02) continue;
      if (collision.ceilingAt(x, z, y + 1e-3) < Infinity) continue;
      if (main(x, z, y)) continue;
      let on = 'the ground';
      if (y > ground + 0.02) {
        collision.forEachSolid((solid) => {
          if (on === 'the ground' && solid.standsAt(x, z) && Math.abs(solid.topAt(x, z) - y) < 1e-6) on = solid.kind || solid.owner || 'a solid';
        });
      }
      cells.set(keyOf(Math.round(x / STEP), Math.round(z / STEP)), { x, z, y, on });
    }
  }
  const seen = new Set<string>();
  const pockets: { at: Stand; n: number; on: string }[] = [];
  let besideTheWalk = 0;
  for (const key of cells.keys()) {
    if (seen.has(key)) continue;
    seen.add(key);
    const stack = [key];
    let n = 0;
    let lowest = cells.get(key)!;
    // Ground on the walk within a metre, no higher than a step up from it:
    // she walks or drops straight off, and the place is the walk's edge — the
    // lattice keeps a body's width off every solid — rather than a place.
    let offTheEdge = false;
    while (stack.length) {
      const k = stack.pop()!;
      const cell = cells.get(k)!;
      n += 1;
      if (cell.y < lowest.y) lowest = cell;
      const [i, j] = k.split(',').map(Number) as [number, number];
      for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const nk = keyOf(i + di, j + dj);
        const next = cells.get(nk);
        // Within a step of each other as heights over the ground, which is
        // what she climbs — not as world y, which the planet bends.
        if (next && Math.abs(altitudeAt(next.x, next.y, next.z) - altitudeAt(cell.x, cell.y, cell.z)) <= BUILDING_STEP_UP) {
          if (!seen.has(nk)) {
            seen.add(nk);
            stack.push(nk);
          }
          continue;
        }
        for (const reach of [1, 2]) {
          if (offTheEdge) break;
          const nx = (i + di * reach) * STEP;
          const nz = (j + dj * reach) * STEP;
          const ny = sample(nx, nz, cell.y + BUILDING_STEP_UP);
          if (ny <= cell.y + BUILDING_STEP_UP && main(nx, nz, ny)) offTheEdge = true;
        }
      }
    }
    if (offTheEdge) besideTheWalk += 1;
    else pockets.push({ at: lowest, n, on: lowest.on });
  }
  pockets.sort((a, b) => b.n - a.n);
  const byOn = new Map<string, number>();
  for (const pocket of pockets) byOn.set(pocket.on, (byOn.get(pocket.on) ?? 0) + 1);
  const link = (at: Stand): string => `/spawn?pos=${at.x.toFixed(1)},${at.z.toFixed(1)}&seed=${PARK_SEED_ASKED}`;
  note(
    `the jet pack: ${cells.size} places (${STEP} m apart) it can set her down off the walk — ${besideTheWalk} clusters she steps or drops straight off into it, and ${pockets.length} pockets she does not: ${[...byOn].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([on, k]) => `${k} on ${on}`).join(', ')}; the largest ${pockets.slice(0, 4).map((p) => `${p.n} on ${p.on} at ${link(p.at)}`).join('; ')}. She flies out the way she came; asserted nowhere`,
  );
}

console.log(failures ? `\n${failures} clause(s) FAILED.` : '\ncheck:solids OK');
process.exit(failures ? 1 : 0);
