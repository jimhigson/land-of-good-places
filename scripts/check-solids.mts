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
 *    a building's roof (an open-air canopy is an ordinary top), an
 *    enclosure, the edge of a space — and every region she can
 *    drop into, she can leave. **The line is open** (Jim, 19 Oct 2026): she
 *    may hop its fence onto the track and back, so from every point along it
 *    she gets off it again, walking or hopping its fence; how many places on
 *    it the census reaches is said on stderr. A fence's top or a bridge's
 *    parapet stood on is reported there too, not failed.
 * 5. **Marches.** Every kind of solid this rework added is walked at from
 *    sixteen bearings at 5 cm and at `PLAYER_LONGEST_STEP`, and no body ends up
 *    inside one below its top.
 * 6. **Headroom.** Every top she can reach has room for all of her over it.
 * 7. **The boundary at height.** The park's edge holds a body pushed at it at
 *    every height from the grass to ten metres up.
 * 8. **The train.** Through `Game`'s own wiring — a real `Player` and her
 *    real `Parade` with three pets out — standing on the line ahead of it at
 *    every station, on the loop and in a tunnel, her line left on the track
 *    behind her, and a child of the crowd: the train stops at least her own
 *    width short of each, waits, and goes on once they have gone — and at
 *    every station, once she is up on the platform where its chip stands her,
 *    it leaves. And she rides it a whole lap with her pets out — one beside
 *    her, the rest in her backpack — and gets off at a stop.
 * 9. **Along the tops.** She walks every wall top and rim she reaches end to
 *    end without the auto-hop throwing her off, and walks up every hoppable
 *    wall where it stands a step high instead of hopping it.
 * 10. **Spawns.** A teleport with no height (`/spawn?pos=x,z`) never stands
 *    her on a roof.
 * 12. **Tunnels.** She walks the line under every bridge, both ways: through
 *    the tunnel, never wedged, her head never through its soffit.
 * 11. **Steps.** Pushing into a top she steps up onto steps her up or holds
 *    her at its face — never shuttles her in and out.
 * 13. **The train is solid.** She bumps its sides, its nose and its tail,
 *    standing and moving; stands on it, and it waits until she steps off; and
 *    no put-down beside it, nor any drop into a slot beside it, leaves her
 *    inside it or wedged against it. Its moving bodies are not in the census
 *    (4) — they are never where the census found them — and this clause is
 *    what asks them; that is said on stderr.
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
import type { FrameContext } from '../src/core/types.ts';
import { Player, type RideHolder } from '../src/entities/Player.ts';
import { Parade } from '../src/entities/parade/Parade.ts';
import { IsoCamera } from '../src/core/IsoCamera.ts';
import { gameStore } from '../src/state/index.ts';
import { shopItem } from '../src/world/building/shops/catalogue.ts';
import { CLEAR_TOLERANCE } from '../src/world/dismount.ts';
import { CARRIAGE_BODY_HALF_WIDTH, CAR_FLOOR_Y } from '../src/world/train/trainDimensions.ts';
import { CAR_GAP, CARRIAGE_LENGTH, LOCO_LENGTH } from '../src/world/train/trainModel.ts';
import { AUTO_HOP_LOOKAHEAD, GRAVITY, JUMP_APEX_HEIGHT, JUMP_SPEED, SimPlayer, playerHopProbe, type HopProbe } from './playerSim.mts';
import { CollisionWorld, FOOT_HALF_WIDTH, JUMP_CLEARANCE_GRACE, MAX_AUTO_HOP_HEIGHT, type SolidView } from '../src/world/Collision.ts';
import { playerNavGrid } from '../src/world/playerLattice.ts';
import { BUILDING_STEP_UP, HOTEL_PLAY_RADIUS, NPC_RADIUS, PARADE_MEMBER_RADIUS, PLAYER_LONGEST_STEP, PLAYER_MAX_SPEED, PLAYER_RADIUS, MAX_FRAME_DELTA } from '../src/core/constants.ts';
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
import { carryReference, riseBetween } from '../src/world/building/stepReach.ts';
import { STEP_MARGIN, STEP_SAMPLES, WEDGE_DEPTH, solidStepCeiling, standingHeight, teleportHeight, wedgeDepth } from '../src/world/standing.ts';

/**
 * **The red proofs.** Each breaks one thing and must turn its clause red, in
 * the part (`--part`) that clause runs in:
 *
 * - `infinite` (core): registers an invisible pillar with no top — clause 1.
 * - `tall-top` (park): a prop made too tall — a solid round a station bench
 *   half a metre over its drawn seat — clause 2 finds her standing on air.
 * - `too-tall` (core): the precedent bench made 1 m taller — clause 3 cannot
 *   land.
 * - `low-roof`, `low-exhibit` (park): a step by the gate carrying the kind of
 *   the castle's roof (an open-air canopy is an ordinary top now), an exhibit
 *   — each of clause 4's escapes must find her on it.
 * - `trap` (core): a ring of tall walls round a castle crate, so dropping off
 *   the crate leaves her nowhere to go — clause 4's trap clause.
 * - `ghost` (core): a bench drawn and never registered — clause 5's march
 *   walks into it.
 * - `stranded` (park): a 0.8 m block filling a ring of 2.4 m walls she climbs
 *   to by a staircase of blocks — clause 4's every-top-leavable clause.
 * - `no-headroom` (park): a canopy hung 1 m over a reached top — clause 6.
 * - `no-bounds` (core): the park's leash taken off — clause 7.
 * - `reptile-roof` (park): a step by the gate kinded as the reptile house's
 *   roof (the review's control) — clause 4's roofs.
 * - `every-roof` (park): one such step for every kind in `ROOF_KINDS`, in a
 *   ring round the gate — clause 4 must name every one.
 * - `new-roof` (core): a step kinded `proof: a garage roof`, named like a roof
 *   and in neither list — clause 4a.
 * - `sealed-line` (park): every railway fence bay and post given a twin four
 *   metres taller, and each box's end closed across the track as tall — a
 *   fence raised above her jump — so off the line there is no way: clause 4's
 *   line must find points she cannot get off it from.
 * - `blind-hop` (park): the auto-hop judged from nothing, as it was — clause 9.
 * - `no-crack-rules` (park): her census's girl with nothing to keep her out
 *   of a crack she does not fit — no step-down hold, no walk into a wedge
 *   refused, no crack floor, squeeze lift or nearest fit, as before seed 5's
 *   wall and bush blinked her back where she started — clause 4's wedged
 *   landings must find her wedged.
 * - `narrow-wedges` (core): a landing judged wedged by the rescue's old
 *   measure, which counted a top within a step of her feet when it was too
 *   narrow to stand on — clause 4's wedged landings must find her in the
 *   library's armchairs, between their rolled arms.
 * - `drawn-step` (park): the step-up asks where a top is drawn, as it did,
 *   not the body she walks into — clause 9 must find her stopped dead at seed
 *   5's knee-high stone wall at (-49.6, 61.6).
 * - `feet-judged` (park): the step-up and the auto-hop judge a face from her
 *   feet wherever she is when they ask, with no point where her body meets
 *   it, as before round three — clause 9 must find a face that gets a hop on
 *   one frame clock and a step on another, and a step-high face hopped. Seed 5
 *   has no face near the line on a slope, so it is green there: run it on seed
 *   6 (`LGP_SEED=6`), whose stone wall at (22.9, 0.5) it must find.
 * - `parapets-to-ground` (park): every bridge parapet piece twinned from the
 *   ground up, straight across the open arch, as before the tunnel was
 *   modelled — clause 12 must find her stopped under a bridge.
 * - `train-ignores-her`, `train-ignores-pets`, `train-ignores-npcs` (park): the
 *   train no longer looking out for her, for her line (her parade never
 *   introduced to it — the review's M5), or for the crowd — clause 8 must find
 *   it run into each.
 * - `platform-holds-train` (park): her platform counted as the line — standing
 *   on one, she reads as on the line's middle, so the train waits for her
 *   where its chip stands her, as it once waited for a child of the crowd
 *   idling at a platform's edge — clause 8's every-station case must find it
 *   never leaving a station she stands at.
 * - `pets-count-aboard` (park): her companion counted as standing while it
 *   rides beside her — clause 8's ride must find the train never leaving.
 * - `pets-stay-out` (park): no backpack — every ride taken as no ride, so her
 *   line walks the track behind the train, the blocker as it was — clause 8's
 *   ride must find it.
 * - `ghost-train` (park): the train's pieces registered in a world of their
 *   own — clause 13 must find her walking through it.
 * - `frozen-train` (park): its pieces never moved after clause 8 — clause 13
 *   must find her walking through it where it has gone on to.
 * - `train-ignores-on-top` (park): the train blind to anybody higher than its
 *   floor — clause 13 must find it leaving with her standing on it.
 * - `put-down-ignores-train` (park): the put-down rule asked of the world
 *   without the train in it — clause 13 must find a put-down, or a rescue,
 *   leaving her inside it or wedged against it.
 * - `spawn-highest` (park): a spawn asked from `Infinity`, as it was — clause 10.
 * - `single-step`, `drawn-feet` (core): the step-up's one point past her front
 *   edge, and her drawn height as her feet, as each was — clause 11.
 */
const PROVE = process.env['SOLIDS_PROVE'] ?? '';
/** Every proof this script knows: a name it does not know would run the check unbroken, and a proof that comes back green proves nothing. */
const PROOFS = [
  'infinite', 'tall-top', 'too-tall', 'low-roof', 'low-exhibit', 'trap', 'ghost', 'stranded', 'no-headroom', 'no-bounds',
  'reptile-roof', 'every-roof', 'new-roof', 'blind-hop', 'spawn-highest', 'single-step', 'drawn-feet',
  'sealed-line', 'train-ignores-her', 'train-ignores-pets', 'train-ignores-npcs', 'platform-holds-train', 'parapets-to-ground', 'drawn-step', 'no-crack-rules', 'narrow-wedges', 'feet-judged',
  'pets-count-aboard', 'pets-stay-out', 'ghost-train', 'frozen-train', 'train-ignores-on-top', 'put-down-ignores-train',
];
if (PROVE && !PROOFS.includes(PROVE)) throw new Error(`SOLIDS_PROVE=${PROVE} is no proof this check knows (${PROOFS.join(', ')})`);
/** The frame rate the census simulates her at: 60 unless `SOLIDS_FPS` asks for another (never in the chain). */
const CENSUS_FPS = Number(process.env['SOLIDS_FPS'] ?? 60);
/** The census's girl and its verdict on a wedge: `Player`'s own, unless a proof breaks one. */
const CENSUS_SIM = PROVE === 'no-crack-rules' ? { crackRules: false } : {};
const CENSUS_WEDGED_BY =
  PROVE === 'narrow-wedges'
    ? { wedgedBy: (world: CollisionWorld, position: Vector3, feetY: number): number => world.deepestSolidOverlap(position, PLAYER_RADIUS, 0, (x, z) => solidStepCeiling(world, x, z, feetY), KID_HEIGHT) }
    : {};
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

// `ghost-train`'s break, before anything is built: every moving body (the
// train's pieces) registered in a world of its own, which no mover asks.
if (PROVE === 'ghost-train') {
  const register = CollisionWorld.prototype.addMovingBox;
  const elsewhere = new CollisionWorld();
  CollisionWorld.prototype.addMovingBox = function (...args: Parameters<typeof register>) {
    return register.apply(elsewhere, args);
  };
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
  'castle roof deck': "the castle's roof",
  'library roof': "the library's roof",
  'reptile house roof': "the reptile house's roof",
  'roof pavilion': "the roof garden pavilion's roof",
  'roof turret': "a roof garden turret's top",
  'toilet privacy roof': "a hotel bathroom nook's roof",
};
/**
 * **Open-air canopies are ordinary tops** (Jim, 19 Oct 2026, of a stall's
 * awning reached by a jump from a tall garden wall and from a bridge's
 * parapet: *"yes this is fine"*). A canopy over a stall, a cart, a platform or
 * a bus stop stands in the open where the camera follows her, and she walks
 * off its edge to the ground; it is not a building's roof, where it cannot.
 * Reaching one is reported on stderr, never failed. A teleport with no height
 * still never stands her on one (clause 10): she arrives on the floor.
 */
const CANOPY_KINDS: Readonly<Record<string, string>> = {
  'stall awning': "a stall's awning",
  'stall parasol': "the keychain cart's parasol",
  'station canopy': "a station's canopy",
  'bus shelter canopy': "the bus shelter's canopy",
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
  // **A fence raised above her jump** — the line's own control: every bay and
  // post of the railway's fence twinned four metres taller, and each box's
  // end closed across the track as tall (each end cap's stub, run on across
  // to the far post). Off the line there is then no way but along it to a
  // platform, so the line's clause must find points she cannot leave.
  if (PROVE === 'sealed-line') {
    const route = world.train.route;
    const rail = new Vector3();
    const tangent = new Vector3();
    for (const guard of before) {
      if (guard.kind !== 'railway fence' && guard.kind !== 'railway fence post') continue;
      if (guard.shape === 'circle') {
        const top = guard.topAt(guard.centreX, guard.centreZ) + 4;
        collision.kinded(guard.kind, () => collision.toppedNarrow(0.05, () => collision.addCircle(guard.centreX, guard.centreZ, guard.halfWidth, top, false, true)));
        continue;
      }
      const seg = guardSegment(guard);
      collision.kinded(guard.kind, () =>
        collision.toppedNarrow(0.05, () => collision.addWall(seg.ax, seg.az, seg.bx, seg.bz, guard.halfWidth, guard.topAt(seg.ax, seg.az) + 4, false, true, -Infinity, false, Number.NaN, guard.topAt(seg.bx, seg.bz) + 4)),
      );
      // A cap's stub runs across the line: on to its mirror over the middle.
      const mx = (seg.ax + seg.bx) / 2;
      const mz = (seg.az + seg.bz) / 2;
      const at = route.distanceNear(mx, mz);
      route.pointAt(at, rail);
      route.tangentAt(at, tangent);
      const length = Math.hypot(seg.bx - seg.ax, seg.bz - seg.az) || 1;
      const along = Math.abs(((seg.bx - seg.ax) * tangent.x + (seg.bz - seg.az) * tangent.z) / length);
      if (along > 0.5) continue;
      const outer = Math.hypot(seg.ax - rail.x, seg.az - rail.z) > Math.hypot(seg.bx - rail.x, seg.bz - rail.z) ? { x: seg.ax, z: seg.az } : { x: seg.bx, z: seg.bz };
      const far = { x: 2 * rail.x - outer.x, z: 2 * rail.z - outer.z };
      collision.kinded('railway fence', () => collision.addWall(outer.x, outer.z, far.x, far.z, guard.halfWidth, sample(rail.x, rail.z, rail.y + 0.5) + 4.6, false, true));
    }
  }
  // **The walls back to the ground** — the tunnels' own control: every bridge
  // parapet piece twinned from the ground up, as the side walls stood before
  // the tunnel was modelled, straight across the open arch. Walking the line
  // under a bridge must then stop at its side.
  if (PROVE === 'parapets-to-ground') {
    for (const wall of before) {
      if (wall.kind !== 'bridge parapet' || wall.shape !== 'capsule') continue;
      const seg = guardSegment(wall);
      collision.kinded('bridge parapet', () =>
        collision.addWall(seg.ax, seg.az, seg.bx, seg.bz, wall.halfWidth, wall.topAt(seg.ax, seg.az), false, true, -Infinity, false, Number.NaN, wall.topAt(seg.bx, seg.bz)),
      );
    }
  }
  if (PROVE === 'low-roof') stepNearGate('castle roof deck');
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
let movingBodies = 0;
collision.forEachSolid((solid) => {
  // A body that moves (the train) is never where the census would find it:
  // clause 13 asks it, standing and moving. The census's own search
  // (`lib/solidReach.mts`) leaves them out too — neither aimed at nor hopped
  // over — so no clause over what it reached (2, 6) can meet one.
  if (solid.moving) movingBodies += 1;
  else solids.push(solid);
});
note(`${movingBodies} moving bodies (the train's engine and carriages) are not in the census (4, and 2 and 6 over what it reached), clauses 1, 5, 9 and 10, or the jet pack's report — they move; clause 13 asks them, standing and moving`);

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
    // With her height: a link with none stands her on the floor there
    // (`teleportHeight`), and these are tops she stood on.
    link: (s) => `/spawn?pos=${s.x.toFixed(1)},${s.y.toFixed(2)},${s.z.toFixed(1)}&facing=${yaw(-s.x, -s.z)}&seed=${seed}`,
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
  const unclassified = kinds.filter((kind) => !(kind in ROOF_KINDS) && !(kind in CANOPY_KINDS) && !(kind in NOT_ROOF_KINDS));
  say(
    unclassified.length === 0,
    `${kinds.length} kinds named like a roof in the built park and its buildings: ${kinds.filter((kind) => kind in ROOF_KINDS).length} roofs the census asserts, ${kinds.filter((kind) => kind in CANOPY_KINDS).length} open-air canopies (ordinary tops), ${kinds.filter((kind) => kind in NOT_ROOF_KINDS).length} not roofs, with their reasons${unclassified.length ? ` — and ${unclassified.length} neither: ${unclassified.join(', ')}` : ''}`,
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
    // Every landing that left her wedged, in this space's searches — each a
    // failure (QA on PR #722: the census used to drop them unseen).
    const wedgedLandings: { at: Stand; how: string }[] = [];
    const onWedged = (at: Stand, how: string): void => {
      if (!wedgedLandings.some((w) => Math.hypot(w.at.x - at.x, w.at.z - at.z) < 0.3)) wedgedLandings.push({ at, how });
    };
    const result = reachWithJumps({
      collision,
      sample,
      grid,
      start: run.start,
      inSpace: (x, z) => spaceAt(x, z) === id,
      fps: CENSUS_FPS,
      onWedged,
      sim: CENSUS_SIM,
      ...CENSUS_WEDGED_BY,
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
    const canopies = result.tops.filter((top) => top.solid.kind in CANOPY_KINDS);
    if (canopies.length) note(`${run.name}: ${canopies.length} open-air canop${canopies.length === 1 ? 'y' : 'ies'} reached — ordinary tops (Jim, 19 Oct 2026), not escapes: ${[...new Set(canopies.map((t) => CANOPY_KINDS[t.solid.kind]))].join(', ')}, e.g. ${run.link(canopies[0]!.at)}`);
    const exhibits = result.tops.filter((top) => isEnclosure(top.solid.kind));
    say(exhibits.length === 0, `${run.name}: no enclosure reached${exhibits.length ? ` — ${exhibits.length}: ${[...new Set(exhibits.map((t) => t.solid.kind))].join(', ')}, e.g. ${run.link(exhibits[0]!.at)}` : ''}`);
    // Guards stood on but not passed: what they guard is asserted directly.
    const perched = result.tops.filter((top) => top.solid.kind in PERCH_KINDS);
    if (perched.length) {
      const byKind = new Map<string, ReachedTop[]>();
      for (const top of perched) byKind.set(top.solid.kind, [...(byKind.get(top.solid.kind) ?? []), top]);
      note(`${run.name}: guards stood on but not passed — ${[...byKind].map(([kind, tops]) => `${kind} ×${tops.length} (${[...new Set(tops.map((t) => t.how))].join('/')}), e.g. ${run.link(tops[0]!.at)}`).join('; ')}`);
    }
    /**
     * Is `at` on the line — inside its fences, down at the track rather than
     * on a bridge's deck over it? Once the line has a way off from every
     * point of it (below), coming down on it is a way out of anywhere: the
     * strip beyond its far fence is left over the line (seeds 1, 3, 4, 7, 10).
     */
    let lineLeavable = false;
    const onTheLine = (at: Stand): boolean => {
      if (run.name !== 'the park') return false;
      const rail = route.pointAt(route.distanceNear(at.x, at.z), railScratch);
      return Math.hypot(at.x - rail.x, at.z - rail.z) < FENCE_OFFSET - 0.2 && at.y < rail.y + 1.5 && at.y > rail.y - 1.5;
    };
    // **The line, open** (Jim, 19 Oct 2026: she may hop its fence onto the
    // track and back; the train stops for her — clause 8). So it is not an
    // escape any more, and what matters is the way back off it: from every
    // point along it, on the track bed, she gets off it again — walking (along
    // the track and up onto a platform), or hopping its fence. Every point,
    // not only those the census happened to land her on: anywhere she could
    // walk along the line to is somewhere she may be.
    if (run.name === 'the park') {
      const outside = (at: Stand): boolean => main(at.x, at.z, at.y) || joinsMain({ collision, sample }, main, at, 60);
      const tangent = new Vector3();
      /** A hop at the fence either side, from a standstill on the track: the quick way off. */
      const hopsOff = (at: Stand): boolean => {
        const d = route.distanceNear(at.x, at.z);
        route.tangentAt(d, tangent);
        for (const side of [1, -1]) {
          const aimX = at.x + tangent.z * side * 4.5;
          const aimZ = at.z - tangent.x * side * 4.5;
          const landed = runAndJump({ collision, sample, sim: CENSUS_SIM }, at, aimX, aimZ, 0.5, CENSUS_FPS);
          if (landed && outside(landed)) return true;
        }
        return false;
      };
      /**
       * Along the line and off it: walked along the track either way — under
       * a bridge, through its tunnel — for up to `ALONG_METRES`, hopping at
       * the fences every metre and a bit of the way. The way off a point in a
       * tunnel, where both fences stand by the abutments.
       */
      const ALONG_METRES = 12;
      /**
       * Under a bridge, in its tunnel: where the walk's lattice answers for the
       * deck over her head (it is height-blind, `joinsMain`'s own note), so a
       * point there is asked by her walk along the line, never by the lattice.
       */
      const underBridge = (at: Stand): boolean => world.train.bridges.some((bridge) => bridge.soffitYAt(at.x, at.z) !== null);
      const walksAlongOff = (at: Stand): boolean => {
        for (const dir of [1, -1]) {
          const sim = new SimPlayer(collision, { ...CENSUS_SIM, ground: sample, hopProbe: playerHopProbe(collision) });
          sim.position.set(at.x, at.y, at.z);
          sim.previousPosition.copy(sim.position);
          sim.groundHeight = at.y;
          sim.groundY = at.y;
          let last = route.distanceNear(at.x, at.z);
          let along = 0;
          let nextHop = 1.2;
          for (let f = 0; f < 60 * 8 && along < ALONG_METRES; f += 1) {
            route.tangentAt(last, tangent);
            sim.step(1 / 60, tangent.x * dir, tangent.z * dir, false);
            const now = route.distanceNear(sim.position.x, sim.position.z);
            let moved = route.forwardGap(last, now);
            if (moved > route.length / 2) moved -= route.length;
            along += moved * dir;
            last = now;
            if (!sim.airborne && along >= nextHop) {
              nextHop += 1.2;
              const there: Stand = { x: sim.position.x, z: sim.position.z, y: sim.groundHeight };
              if (!underBridge(there) && (outside(there) || hopsOff(there))) return true;
            }
          }
        }
        return false;
      };
      const LINE_STEP = 2.4;
      let points = 0;
      let walked = 0;
      let hopped = 0;
      let along = 0;
      let searched = 0;
      const trapped: string[] = [];
      const t4b = performance.now();
      for (let d = 0; d < route.length; d += LINE_STEP) {
        const rail = route.pointAt(d, railScratch);
        const y = sample(rail.x, rail.z, rail.y + 0.5);
        if (!Number.isFinite(y)) continue;
        const at: Stand = { x: rail.x, z: rail.z, y: standingHeight(y, collision, rail.x, rail.z, y) };
        points += 1;
        const tunnel = underBridge(at);
        if (!tunnel && outside(at)) {
          walked += 1;
          continue;
        }
        if (!tunnel && hopsOff(at)) {
          hopped += 1;
          continue;
        }
        if (walksAlongOff(at)) {
          along += 1;
          continue;
        }
        searched += 1;
        let out = false;
        try {
          out = reachWithJumps({
            collision,
            sample,
            grid,
            start: at,
            inSpace: (x, z) => spaceAt(x, z) === id && Math.hypot(x - at.x, z - at.z) < 20,
            fps: CENSUS_FPS,
            until: outside,
            sim: CENSUS_SIM,
            ...CENSUS_WEDGED_BY,
          }).stopped;
        } catch {
          out = false;
        }
        if (!out) trapped.push(`/spawn?pos=${at.x.toFixed(1)},${at.y.toFixed(2)},${at.z.toFixed(1)}&seed=${seed} (${d.toFixed(0)} m round the loop)`);
      }
      lineLeavable = points > 0 && trapped.length === 0;
      say(
        points > 0 && trapped.length === 0,
        `the line: from every one of ${points} points along it, ${LINE_STEP} m apart on the track bed, she gets off it again (${walked} walking, ${hopped} with a hop over its fence, ${along} walking along it — through a tunnel — and hopping off, ${searched} by her own search)${trapped.length ? ` — ${trapped.length} with no way off: ${trapped.slice(0, 6).join('; ')}` : ''}`,
      );
      // How many places on the line her census reached from the walk — that
      // the line is open is the ruling; this says it is (on stderr).
      let onLine = 0;
      const isOnLine = (stand: Stand): boolean => {
        const at = route.pointAt(route.distanceNear(stand.x, stand.z), railScratch);
        return Math.hypot(at.x - stand.x, at.z - stand.z) < FENCE_OFFSET - 0.2 && stand.y < terrainHeight(stand.x, stand.z) + 2.5 && !main(stand.x, stand.z, stand.y);
      };
      for (const region of result.regions.slice(1)) if (isOnLine(region.entry)) onLine += 1;
      note(`clause 4, the line: ${points} points along it searched for a way off in ${((performance.now() - t4b) / 1000).toFixed(0)} s; her census came down on it ${onLine} time(s) from the walk (a hop over its fence, a drop off a platform or a bridge), each a region the regions clause asks the same of`);
    }
    // Off the edge of a space: a drop to well below where she started.
    const below = result.regions.slice(1).filter((region) => region.entry.y < run.start.y - 1.5 && run.name !== 'the park');
    say(below.length === 0, `${run.name}: nowhere off its own floor${below.length ? ` — ${below.map((r) => `${r.via} lands at y ${r.entry.y.toFixed(1)}`).join('; ')}` : ''}`);
    // Every region leavable: from where she landed, her own jumps get her back.
    const stuck: string[] = [];
    for (const region of result.regions.slice(1)) {
      let out = false;
      // Out is anywhere her walking from the start reaches, or any top she
      // walks off into it, or the line once it has a way off everywhere; the
      // search stops at the first.
      const outside = (at: Stand): boolean => main(at.x, at.z, at.y) || (lineLeavable && onTheLine(at)) || joinsMain({ collision, sample }, main, at, 60);
      try {
        out = reachWithJumps({
          collision,
          sample,
          grid,
          start: region.entry,
          inSpace: (x, z) => spaceAt(x, z) === id && Math.hypot(x - region.entry.x, z - region.entry.z) < 14,
          fps: CENSUS_FPS,
          until: outside,
          onWedged,
          sim: CENSUS_SIM,
          ...CENSUS_WEDGED_BY,
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
      const outside = (at: Stand): boolean => main(at.x, at.z, at.y) || (lineLeavable && onTheLine(at)) || joinsMain({ collision, sample }, main, at, 60);
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
          onWedged,
          sim: CENSUS_SIM,
          ...CENSUS_WEDGED_BY,
        }).stopped;
      } catch {
        out = joinsMain({ collision, sample }, main, top.at, 60, 14);
      }
      if (!out) strandedOn.push(`${top.solid.kind || top.solid.owner || 'a solid'} → ${run.link(top.at)}`);
    }
    say(strandedOn.length === 0, `${run.name}: every one of ${result.tops.length} top(s) she reaches, she can get down from again (${result.hemmedIn.length} with no edge to walk off, each searched)${strandedOn.length ? ` — stranded on: ${strandedOn.join('; ')}` : ''}`);
    // Never wedged: a jump or a walk-off that leaves her inside something
    // that holds her is a place the game's own rescue would have to lift her
    // out of (`standing.ts`'s `wedgeDepth`).
    say(
      wedgedLandings.length === 0,
      `${run.name}: no jump or walk-off of ${result.jumps} leaves her wedged${wedgedLandings.length ? ` — ${wedgedLandings.length}: ${wedgedLandings.slice(0, 6).map((w) => `${w.how}, came down at ${run.link(w.at)}`).join('; ')}` : ''}`,
    );
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
  // Every solid that stands still: the train's pieces are clause 13's.
  const all: SolidView[] = [...solids];
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
        // Named after a solid that stands still; the train is wherever it is now.
        collision.forEachSolid((solid) => {
          if (on === 'the ground' && !solid.moving && solid.standsAt(x, z) && Math.abs(solid.topAt(x, z) - y) < 1e-6) on = solid.kind || solid.owner || 'a solid';
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

// ---------------------------------------------------------------------------
// 9. Along the tops, and up the low walls
// ---------------------------------------------------------------------------
/**
 * **She walks the length of every wall top and rim she reaches, and steps up
 * a wall a step high — her auto-hop never throws her off either** (QA on PR
 * #722: the first step along a garden wall or the fountain's rim auto-hopped
 * her a metre and a half up and off, and walking into a garden wall standing
 * 0.1 m over the grass hopped her over it). Her own hop probe, the one `Player`
 * asks (`playerHopProbe`), never one that cannot fire.
 */
/** Her auto-hop as `Player` asks it — or, for the proof, without her feet: the hop the first cut judged from nothing. */
const hopProbeFor = (world: CollisionWorld): HopProbe =>
  PROVE === 'blind-hop' ? (probe) => world.wouldAutoHopClear(probe, PLAYER_RADIUS, JUMP_APEX_HEIGHT) : playerHopProbe(world);
/** A wall's long axis: the direction its footprint reaches furthest from its middle, and how far (its ends, less its own half-width). */
function wallAxis(solid: SolidView): { ux: number; uz: number; half: number } {
  let best = { ux: 1, uz: 0, half: 0 };
  for (let k = 0; k < 90; k += 1) {
    const a = (k / 90) * Math.PI;
    const ux = Math.cos(a);
    const uz = Math.sin(a);
    let lo = 0;
    let hi = solid.reach + 0.05;
    for (let i = 0; i < 24; i += 1) {
      const mid = (lo + hi) / 2;
      if (solid.depthAt(solid.centreX + ux * mid, solid.centreZ + uz * mid) >= 0) lo = mid;
      else hi = mid;
    }
    if (lo > best.half) best = { ux, uz, half: lo };
  }
  return { ...best, half: Math.max(0, best.half - solid.halfWidth) };
}
/** A wall's line: its core segment, end to end (its footprint less its half-width at each end). */
function guardSegment(solid: SolidView): { ax: number; az: number; bx: number; bz: number } {
  const axis = wallAxis(solid);
  return {
    ax: solid.centreX - axis.ux * axis.half,
    az: solid.centreZ - axis.uz * axis.half,
    bx: solid.centreX + axis.ux * axis.half,
    bz: solid.centreZ + axis.uz * axis.half,
  };
}
const scratchBody = new Vector3();
const boundsOfSpace = (name: string): ParkBoundary => spaceRuns.find((run) => run.name === name)?.bounds ?? GARDEN_PLAY_BOUNDARY;
if (spacesInPart.length) {
  console.log('\n9. ALONG THE TOPS — the length of every wall top and rim she reaches, and up every wall a step high, without a hop:');
  const dt = 1 / CENSUS_FPS;
  let walks = 0;
  let thrown = 0;
  let fellOff = 0;
  const firstThrown: string[] = [];
  const firstFell: string[] = [];
  const walls = new Map<SolidView, string>();
  for (const { space, top } of allReached) if (top.solid.shape === 'capsule') walls.set(top.solid, space);
  for (const [wall, space] of walls) {
    const axis = wallAxis(wall);
    if (axis.half < 0.5) continue;
    collision.setPlayBounds(boundsOfSpace(space));
    for (const sign of [1, -1]) {
      // From the end, or as near it as her body is clear of anything else —
      // at an L's corner the other arm and its post stand there — to the far
      // end's like point.
      const clearAt = (t: number): boolean => {
        const x = wall.centreX + axis.ux * t;
        const z = wall.centreZ + axis.uz * t;
        return wall.standsAt(x, z) && collision.deepestSolidOverlap(scratchBody.set(x, wall.topAt(x, z), z), PLAYER_RADIUS, 0, undefined, KID_HEIGHT) <= 0.02;
      };
      // Each search stops at the other end: a wall whose top has no clear
      // stretch at all (under something, or never wide enough to stand on) is
      // walked nowhere (seeds 4, 11 and 15: searched while |t| > 0, it ran
      // past the far end and never stopped).
      let t0 = -axis.half * sign;
      while (t0 * sign <= axis.half && !clearAt(t0)) t0 += 0.1 * sign;
      let t1 = axis.half * sign;
      while ((t1 - t0) * sign >= 0.5 && !clearAt(t1)) t1 -= 0.1 * sign;
      if ((t1 - t0) * sign < 0.5) continue;
      const from = { x: wall.centreX + axis.ux * t0, z: wall.centreZ + axis.uz * t0 };
      const to = { x: wall.centreX + axis.ux * t1, z: wall.centreZ + axis.uz * t1 };
      const startY = wall.topAt(from.x, from.z);
      if (!Number.isFinite(startY)) continue;
      walks += 1;
      const sim = new SimPlayer(collision, { ground: sample, hopProbe: hopProbeFor(collision) });
      sim.position.set(from.x, startY, from.z);
      sim.previousPosition.copy(sim.position);
      sim.groundHeight = startY;
      sim.groundY = startY;
      let hopped = false;
      const frames = Math.ceil((2 * axis.half) / (PLAYER_MAX_SPEED * 0.5) / dt) + Math.ceil(1 / dt);
      for (let f = 0; f < frames && !hopped; f += 1) {
        const dx = to.x - sim.position.x;
        const dz = to.z - sim.position.z;
        const d = Math.hypot(dx, dz);
        if (d < 0.2) break;
        const was = sim.airborne;
        // At a walk: half her speed, which the stick gives her held half over.
        sim.step(dt, (dx / d) * 0.5, (dz / d) * 0.5, false);
        if (!was && sim.airborne && sim.verticalVelocity > JUMP_SPEED * 0.5) {
          // A hop is hers to take where the wall's end meets something more
          // than a step over its top within her probe's reach — an L's taller
          // arm, its corner post: that is the auto-hop doing its job. Thrown
          // off is a hop with nothing of the kind ahead of her.
          let taller = false;
          collision.forEachSolid((other) => {
            if (taller || other === wall || other.moving) return;
            const reach = PLAYER_RADIUS + AUTO_HOP_LOOKAHEAD + 0.1;
            if (other.depthAt(sim.position.x, sim.position.z) < -reach) return;
            const step = other.topAt(sim.position.x, sim.position.z) - wall.topAt(sim.position.x, sim.position.z);
            if (step > BUILDING_STEP_UP) taller = true;
          });
          if (!taller) hopped = true;
          break;
        }
        // Off its top without a hop — stepped off its side: a fall, not the
        // auto-hop, and the walk along this top is over (seeds 9 and 12: a
        // bush beside the wall nudged her off its edge, and the first cut
        // walked on and counted her hop back over the wall from the grass).
        if (!was && sim.airborne) {
          fellOff += 1;
          if (firstFell.length < 3) firstFell.push(`${wall.kind || wall.owner} in ${space} at (${sim.position.x.toFixed(1)}, ${sim.position.z.toFixed(1)})`);
          break;
        }
      }
      if (hopped) {
        thrown += 1;
        if (firstThrown.length < 4) firstThrown.push(`along ${wall.kind || wall.owner} in ${space} from (${from.x.toFixed(1)}, ${from.z.toFixed(1)}): hopped off at (${sim.position.x.toFixed(1)}, ${sim.position.z.toFixed(1)})`);
      }
    }
  }
  say(walks > 0 && thrown === 0, `${walks} walks along ${walls.size} wall tops and rims she reaches, end to end at a walk: ${thrown} hopped her off${firstThrown.length ? ` — ${firstThrown.join('; ')}` : ''}`);
  note(
    `clause 9: of ${walks} walks along a top, ${fellOff} stepped off its side before its end${firstFell.length ? ` (e.g. ${firstFell.join('; ')})` : ''} — ` +
      `a fall, not a hop, so not asserted here: what it asserts is that the auto-hop never throws her off (a bush's crown beside a wall can nudge her off a narrow top)`,
  );
  // **Every face of every wall she can hop, from both sides: a step she steps
  // up, a hop she hops, never stopped dead — and the same whatever the frame
  // clock** (QA on PR #722, round two: seed 5's knee-high stone wall at
  // (-49.6, 61.6), 0.12-0.41 m over her feet, stopped her at its face — its
  // top drawn out along the lean beyond her step's reach, and the hop rightly
  // calling it a step; and 15 of 49 faces hopped on one sweep, 12 on the
  // next). A walk in at every metre of every face, both sides, at a walk and
  // a sprint, at 60 fps (three phases of the clock), 30, 120 and a jittered
  // clock. What she should do is the face's own rise over the ground where
  // her body meets it (the hop's own judgement, `CollisionWorld.hopsOver`):
  // a step at most `BUILDING_STEP_UP`, a hop up to `MAX_AUTO_HOP_HEIGHT`.
  let faces = 0;
  let stepFaces = 0;
  let hopFaces = 0;
  const stoppedAt: string[] = [];
  const hoppedInstead: string[] = [];
  const unsteady: string[] = [];
  let hopsAtTaller = 0;
  const noRoomFaces = new Set<string>();
  let obstructed = 0;
  let noRoomAt = '';
  const hoppable: SolidView[] = [];
  collision.forEachSolid((solid) => {
    if (!solid.autoHoppable || !solid.topIsAbsolute || solid.moving) return;
    if (!spacesInPart.some((run) => spaceAt(solid.centreX, solid.centreZ) === spaceAt(run.start.x, run.start.z))) return;
    hoppable.push(solid);
  });
  type Outcome = 'on' | 'over' | 'hop' | 'stopped' | 'no room' | 'other';
  /** One walk in at a face: from `(sx, sz)` along `(dx, dz)` until she stands on the wall, crosses it, hops, or 2 s pass. */
  const walkIn = (solid: SolidView, sx: number, sz: number, dx: number, dz: number, clock: (f: number) => number, sprint: boolean, nx: number, nz: number): { outcome: Outcome; asked: { px: number; pz: number; fx: number; fy: number; fz: number } | null } => {
    const probe = hopProbeFor(collision);
    let asked: { px: number; pz: number; fx: number; fy: number; fz: number } | null = null;
    const sim = new SimPlayer(collision, {
      ground: sample,
      hopProbe: (at, feet, feetAt) => {
        const hop = probe(at, feet, feetAt);
        if (hop && !asked) asked = { px: at.x, pz: at.z, fx: feet.x, fy: feet.y, fz: feet.z };
        return hop;
      },
      drawnStep: PROVE === 'drawn-step',
      faceFromFeet: PROVE === 'feet-judged',
    });
    sim.placeOnGround(sx, sz);
    const sideOf = (x: number, z: number): number => (x - solid.centreX) * nx + (z - solid.centreZ) * nz;
    const startSide = sideOf(sx, sz);
    let elapsed = 0;
    for (let f = 0; elapsed < 2; f += 1) {
      const step = clock(f);
      elapsed += step;
      const was = sim.airborne;
      sim.step(step, dx, dz, sprint);
      if (!was && sim.airborne && sim.verticalVelocity > JUMP_SPEED * 0.5) return { outcome: 'hop', asked };
      if (!sim.airborne && solid.standsAt(sim.position.x, sim.position.z) && Math.abs(sim.groundHeight - solid.topAt(sim.position.x, sim.position.z)) < 0.03) return { outcome: 'on', asked };
      if (!sim.airborne && sideOf(sim.position.x, sim.position.z) * startSide < 0 && solid.depthAt(sim.position.x, sim.position.z) < -0.05) return { outcome: 'over', asked };
    }
    const gap = -solid.depthAt(sim.position.x, sim.position.z);
    if (gap > PLAYER_RADIUS + 0.05) return { outcome: 'other', asked };
    // Stopped at its face — unless there is no room for her on its top there:
    // stood on it just inside the face, straight ahead of where she stopped,
    // something taller than a step over the top would be inside her. A bush
    // hard behind a wall a step high is a wall to her there, not a step (seed
    // 15's wooden wall at (31.4, 58.6): a bush 0.07 m past its far face, 0.65 m
    // over its top).
    const inX = sim.position.x + dx * (gap + 0.02);
    const inZ = sim.position.z + dz * (gap + 0.02);
    const roomless = solid.depthAt(inX, inZ) >= 0 && collision.deepestSolidOverlap(scratchBody.set(inX, solid.topAt(inX, inZ), inZ), PLAYER_RADIUS, 0, undefined, KID_HEIGHT) > 0.02;
    return { outcome: roomless ? 'no room' : 'stopped', asked };
  };
  let jitterSeed = 1;
  const jitter = (): number => {
    jitterSeed = (jitterSeed * 1103515245 + 12345) & 0x7fffffff;
    return jitterSeed / 0x7fffffff;
  };
  const CLOCKS: readonly { name: string; clock: () => (f: number) => number; phase: number }[] = [
    { name: '60 fps', clock: () => () => 1 / 60, phase: 0 },
    { name: '60 fps, 4 cm on', clock: () => () => 1 / 60, phase: 0.037 },
    { name: '60 fps, 7 cm on', clock: () => () => 1 / 60, phase: 0.071 },
    { name: '30 fps', clock: () => () => 1 / 30, phase: 0 },
    { name: '120 fps', clock: () => () => 1 / 120, phase: 0 },
    { name: 'a jittered clock', clock: () => () => 1 / (45 + jitter() * 30), phase: 0 },
  ];
  for (const solid of hoppable) {
    if (solid.shape !== 'capsule') continue;
    const axis = wallAxis(solid);
    const nx = -axis.uz;
    const nz = axis.ux;
    collision.setPlayBounds(spaceAt(solid.centreX, solid.centreZ) === SPACE_GARDEN ? GARDEN_PLAY_BOUNDARY : boundsOfSpace(spacesInPart.find((run) => spaceAt(run.start.x, run.start.z) === spaceAt(solid.centreX, solid.centreZ))?.name ?? ''));
    const n = Math.max(1, Math.round((axis.half * 2) / 1));
    for (let k = 0; k <= n; k += 1) {
      const t = -axis.half * 0.9 + (axis.half * 1.8 * k) / n;
      for (const side of [1, -1]) {
        const ex = solid.centreX + axis.ux * t;
        const ez = solid.centreZ + axis.uz * t;
        // Where her body meets the face, and a run-up behind it.
        const cx = ex + nx * side * (solid.halfWidth + PLAYER_RADIUS);
        const cz = ez + nz * side * (solid.halfWidth + PLAYER_RADIUS);
        const sx = ex + nx * side * (solid.halfWidth + PLAYER_RADIUS + 1.2);
        const sz = ez + nz * side * (solid.halfWidth + PLAYER_RADIUS + 1.2);
        const top = solid.topAt(ex, ez);
        const contactGround = sample(cx, cz, top + 0.5);
        const startGround = sample(sx, sz, top + 0.5);
        if (!Number.isFinite(contactGround) || !Number.isFinite(startGround)) continue;
        // Only a face she can walk up to with nothing else in her way.
        if (collision.deepestSolidOverlap(scratchBody.set(sx, startGround, sz), PLAYER_RADIUS, 0, undefined, KID_HEIGHT) > 0.02) continue;
        if (collision.deepestSolidOverlap(scratchBody.set(cx, contactGround, cz), PLAYER_RADIUS - 0.05, 0, undefined, KID_HEIGHT) > 0.02) continue;
        const rise = riseBetween(cx, contactGround, cz, ex, top, ez);
        if (rise < 0.05) continue;
        // What she should do, by the line both halves draw (`STEP_MARGIN`):
        // a step, or — within the auto-hop's height — a hop.
        const want = rise <= BUILDING_STEP_UP - STEP_MARGIN ? 'step' : rise <= MAX_AUTO_HOP_HEIGHT ? 'hop' : null;
        if (!want) continue;
        // …and nothing on the way: brushed aside by a pole beside her path,
        // she meets the face somewhere else, where it is another height (seed
        // 8's wooden wall at (-23.9, 22.1): a fairy-light pole put her 0.2 m
        // along it, where it stands 0.592 m, a hop).
        let clear = true;
        for (let k = 1; k < 12 && clear; k += 1) {
          const wx = sx + ((cx - sx) * k) / 12;
          const wz = sz + ((cz - sz) * k) / 12;
          const wy = sample(wx, wz, top + 0.5);
          if (Number.isFinite(wy) && collision.deepestSolidOverlap(scratchBody.set(wx, wy, wz), PLAYER_RADIUS, 0, undefined, KID_HEIGHT) > 0.02) clear = false;
        }
        if (!clear) {
          obstructed += 1;
          continue;
        }
        faces += 1;
        if (want === 'step') stepFaces += 1;
        else hopFaces += 1;
        const where = `${solid.kind || solid.owner} at (${ex.toFixed(1)}, ${ez.toFixed(1)}), ${rise.toFixed(2)} m over where she meets it, from /spawn?pos=${sx.toFixed(1)},${sz.toFixed(1)}&seed=${PARK_SEED_ASKED}`;
        const classes = new Set<string>();
        for (const { name, clock, phase } of CLOCKS) {
          for (const sprint of [false, true]) {
            const { outcome, asked } = walkIn(solid, sx - nx * side * phase, sz - nz * side * phase, -nx * side, -nz * side, clock(), sprint, nx, nz);
            if (outcome === 'no room') {
              if (!noRoomFaces.has(where)) {
                noRoomFaces.add(where);
                if (!noRoomAt) noRoomAt = where;
              }
              classes.add('no room');
              continue;
            }
            if (outcome === 'stopped') {
              if (stoppedAt.length < 6 && !stoppedAt.some((w) => w.startsWith(where))) stoppedAt.push(`${where} (${want}, ${name}${sprint ? ', a sprint' : ''})`);
              classes.add('stopped');
              continue;
            }
            if (want === 'step' && outcome === 'hop') {
              // A hop is hers to take where something more than a step over
              // her feet stands at her probe — an L's other arm, taller where
              // they meet: the hop doing its job.
              const at = asked as { px: number; pz: number; fx: number; fy: number; fz: number } | null;
              let overStep = false;
              if (at) {
                collision.forEachSolid((other) => {
                  if (overStep || other === solid || other.moving || !other.autoHoppable || other.depthAt(at.px, at.pz) <= -PLAYER_RADIUS) return;
                  if (riseBetween(at.fx, at.fy, at.fz, at.px, other.topAt(at.px, at.pz), at.pz) > BUILDING_STEP_UP) overStep = true;
                });
              }
              if (overStep) {
                hopsAtTaller += 1;
                classes.add('step');
                continue;
              }
              if (hoppedInstead.length < 6 && !hoppedInstead.some((w) => w.startsWith(where))) hoppedInstead.push(`${where} (${name}${sprint ? ', a sprint' : ''})`);
            }
            classes.add(outcome === 'hop' ? 'hop' : outcome === 'other' ? 'other' : 'step');
          }
        }
        if (classes.size > 1) unsteady.push(`${where}: ${[...classes].join(' / ')}`);
      }
    }
  }
  if (hoppable.length === 0) note(`clause 9: no wall in ${spacesInPart.map((run) => run.name).join(', ')} is auto-hoppable, so its step-or-hop half asserts nothing in this part`);
  else {
    say(faces > 0 && stoppedAt.length === 0, `${faces} faces of ${hoppable.length} hoppable walls, both sides, every metre (${stepFaces} a step high, ${hopFaces} a hop), each walked into at a walk and a sprint on ${CLOCKS.length} frame clocks: ${stoppedAt.length} stopped her dead${stoppedAt.length ? ` — ${stoppedAt.join('; ')}` : ''}`);
    say(hoppedInstead.length === 0, `of those a step high, ${hoppedInstead.length} hopped her over instead of stepping up${hoppedInstead.length ? ` — ${hoppedInstead.join('; ')}` : ''}`);
    say(unsteady.length === 0, `every face got one answer on every frame clock: ${unsteady.length} did not${unsteady.length ? ` — ${unsteady.slice(0, 6).join('; ')}` : ''}`);
    note(`clause 9: of the walks into a face a step high, ${hopsAtTaller} hopped where something more than a step over her feet stood at her probe (an L's other arm, taller where they meet) — the hop doing its job, so not counted against the face`);
    note(`clause 9: ${obstructed} face point(s) left out where something stands beside the straight walk up to it (a pole she brushes, a post) — she meets the face elsewhere, and is asked there`);
    note(`clause 9: ${noRoomFaces.size} face(s) held her where something taller than a step over its top, straight ahead of where she stopped, leaves her no room to stand on it — a wall to her there, not counted as stopped dead${noRoomAt ? ` (e.g. ${noRoomAt})` : ''}`);
  }
}

// ---------------------------------------------------------------------------
// 10. Spawned with no height
// ---------------------------------------------------------------------------
/**
 * **`/spawn?pos=x,z` stands her on the floor or a step's top, never a roof**
 * (QA on PR #722: the station-bench link stood her on the station's awning,
 * and another on the reptile house's roof). Every roof of the park, all over
 * its footprint, through `Player.teleport`'s own rule (`teleportHeight`).
 */
if (inPart('park')) {
  console.log('\n10. SPAWNS — a teleport with no height never stands her on a roof:');
  const spawnHeight = (x: number, z: number): number =>
    PROVE === 'spawn-highest' ? standingHeight(sample(x, z, Infinity), collision, x, z, Infinity) : teleportHeight(sample, collision, x, z);
  let asked = 0;
  let onRoof = 0;
  const firstOn: string[] = [];
  const roofsAsked = new Set<string>();
  collision.forEachSolid((roof) => {
    if (roof.moving || !(roof.kind in ROOF_KINDS || roof.kind in CANOPY_KINDS) || spaceAt(roof.centreX, roof.centreZ) !== SPACE_GARDEN) return;
    roofsAsked.add(roof.kind);
    for (let x = roof.centreX - roof.reach; x <= roof.centreX + roof.reach; x += 0.5) {
      for (let z = roof.centreZ - roof.reach; z <= roof.centreZ + roof.reach; z += 0.5) {
        if (roof.depthAt(x, z) < 0.1) continue;
        asked += 1;
        const y = spawnHeight(x, z);
        if (Math.abs(y - roof.topAt(x, z)) < 0.05 || (roof.banded && y >= roof.baseAt(x, z) - 1e-6)) {
          onRoof += 1;
          if (firstOn.length < 3) firstOn.push(`${roof.kind} at /spawn?pos=${x.toFixed(1)},${z.toFixed(1)}&seed=${PARK_SEED_ASKED}`);
        }
      }
    }
  });
  say(asked > 0 && onRoof === 0, `${asked} spawn points over ${roofsAsked.size} kinds of roof (${[...roofsAsked].join(', ')}): ${onRoof} stood her on one${firstOn.length ? ` — ${firstOn.join('; ')}` : ''}`);
}

// ---------------------------------------------------------------------------
// 11. Steps
// ---------------------------------------------------------------------------
/**
 * **Pushing into a step-high top steps her up it, or holds her still at its
 * face — never shuttles her** (QA on PR #722: the reptile house's foyer log,
 * 0.59 m, threw her 0.6 m in and out eight times a second while she held
 * towards it; a castle bench stuttered six frames first). Every top the census
 * walked up onto, from eight bearings.
 */
if (spacesInPart.length) {
  console.log('\n11. STEPS — walking into a step-high top steps her up or holds her, never shuttles her:');
  const dt = 1 / CENSUS_FPS;
  let pushes = 0;
  let shuttled = 0;
  let steppedUp = 0;
  const firstShuttle: string[] = [];
  for (const { space, top } of allReached) {
    if (top.how !== 'step') continue;
    const solid = top.solid;
    collision.setPlayBounds(boundsOfSpace(space));
    for (let k = 0; k < 8; k += 1) {
      const a = (k / 8) * Math.PI * 2;
      const ux = Math.cos(a);
      const uz = Math.sin(a);
      // From a body's width outside its edge on this bearing, walking in.
      let edge = 0;
      while (edge < solid.reach + 0.1 && solid.depthAt(solid.centreX + ux * edge, solid.centreZ + uz * edge) >= 0) edge += 0.05;
      const sx = solid.centreX + ux * (edge + PLAYER_RADIUS + 0.4);
      const sz = solid.centreZ + uz * (edge + PLAYER_RADIUS + 0.4);
      const ground = sample(sx, sz, solid.topAt(solid.centreX, solid.centreZ) + 1);
      if (altitudeAt(sx, solid.topAt(solid.centreX, solid.centreZ), sz) - altitudeAt(sx, ground, sz) > BUILDING_STEP_UP) continue;
      if (collision.deepestSolidOverlap(scratchBody.set(sx, ground, sz), PLAYER_RADIUS, 0, undefined, KID_HEIGHT) > 0.02) continue;
      pushes += 1;
      const sim = new SimPlayer(collision, { ground: sample, hopProbe: hopProbeFor(collision), stepSamples: PROVE === 'single-step' ? 1 : STEP_SAMPLES, feetOnGround: PROVE !== 'drawn-feet' });
      sim.position.set(sx, ground, sz);
      sim.previousPosition.copy(sim.position);
      sim.groundHeight = ground;
      sim.groundY = ground;
      // How far in she has got along her push, frame by frame, for 2 s; a
      // shuttle is the push still swinging in and out once she has had time
      // to step up or come to rest — in its last 0.75 s, three or more swings
      // of 5 cm or more. A stutter on the way up (a step's edge, a chair she
      // steps off towards its table) settles; the foyer log's never did.
      // Until she has stood on the top for a fifth of a second — stepped up,
      // which is what this asks — or for the whole 2 s if she never does.
      const inward: number[] = [];
      let onTop = 0;
      for (let f = 0; f < Math.ceil(2 / dt); f += 1) {
        sim.step(dt, -ux * 0.5, -uz * 0.5, false);
        inward.push(-((sim.position.x - sx) * ux + (sim.position.z - sz) * uz));
        const standing = !sim.airborne && solid.depthAt(sim.position.x, sim.position.z) >= 0 && Math.abs(sim.groundY - solid.topAt(sim.position.x, sim.position.z)) < 0.05;
        onTop = standing ? onTop + dt : 0;
        if (onTop >= 0.2) break;
      }
      if (onTop >= 0.2) {
        steppedUp += 1;
        continue;
      }
      const tail = inward.slice(-Math.ceil(0.75 / dt));
      let swings = 0;
      let extreme = tail[0] ?? 0;
      let rising: boolean | null = null;
      for (const at of tail) {
        if (rising !== false && at < extreme - 0.05) {
          if (rising === true) swings += 1;
          rising = false;
          extreme = at;
        } else if (rising !== true && at > extreme + 0.05) {
          if (rising === false) swings += 1;
          rising = true;
          extreme = at;
        } else if ((rising === true && at > extreme) || (rising === false && at < extreme)) extreme = at;
      }
      if (swings >= 3) {
        shuttled += 1;
        if (firstShuttle.length < 4) firstShuttle.push(`${solid.kind || solid.owner} in ${space} from (${sx.toFixed(1)}, ${sz.toFixed(1)}): ${swings} swings in her last 0.75 s of pushing`);
      }
    }
  }
  say(pushes > 0 && shuttled === 0, `${pushes} pushes into the tops she steps up onto, 8 bearings each: ${steppedUp} stood her on the top, ${pushes - steppedUp - shuttled} walked her across it or held her at its face, ${shuttled} shuttled her${firstShuttle.length ? ` — ${firstShuttle.join('; ')}` : ''}`);
  note(`clause 11 asks the step up and stops once she has stood on the top for 0.2 s: it says nothing about walking on across it — off its far side into a gap narrower than her body, against a wall, she jitters at the edge (a bed's far side in the suite on seed 5), written down on PR #722 as a gap`);
}

/** The line's tunnels, as stretches of the loop (route distances, unwrapped from outside one): clause 12's, for clause 8's stop in a tunnel. */
let tunnelsOnLine: readonly { readonly from: number; readonly to: number }[] = [];
// ---------------------------------------------------------------------------
// 12. The line under every bridge
// ---------------------------------------------------------------------------
/**
 * **She walks the line under every bridge, both ways** (Jim, 19 Oct 2026:
 * *"they should have a modelled tunnel"*): from 6 m before each tunnel to 6 m
 * past it, along the track's own middle, at a walk. She gets through, she is
 * never wedged, and her head never rises through the soffit
 * (`Bridge.soffitYAt`, the drawn arch's one owner). Every bridge the line
 * runs under, every park asked.
 */
if (inPart('park')) {
  console.log('\n12. TUNNELS — the line under every bridge, both ways:');
  collision.setPlayBounds(GARDEN_PLAY_BOUNDARY);
  const route = world.train.route;
  const bridges = world.train.bridges;
  const at = new Vector3();
  const along = new Vector3();
  const TUNNEL_STEP = 0.25;
  const inTunnel = (d: number): boolean => {
    route.pointAt(d, at);
    return bridges.some((bridge) => bridge.soffitYAt(at.x, at.z) !== null);
  };
  // The tunnels, as stretches of the loop: from outside one, all the way round.
  const n = Math.ceil(route.length / TUNNEL_STEP);
  let start = 0;
  while (start < n && inTunnel(start * TUNNEL_STEP)) start += 1;
  const tunnels: { from: number; to: number }[] = [];
  let open: number | null = null;
  for (let k = 0; k <= n; k += 1) {
    const d = (start + k) * TUNNEL_STEP;
    const inside = inTunnel(route.wrap(d));
    if (inside && open === null) open = d;
    if (!inside && open !== null) {
      tunnels.push({ from: open, to: d });
      open = null;
    }
  }
  tunnelsOnLine = tunnels;
  const failed: string[] = [];
  let walks = 0;
  for (const tunnel of tunnels) {
    for (const dir of [1, -1]) {
      walks += 1;
      const from = dir > 0 ? tunnel.from - 6 : tunnel.to + 6;
      const goal = tunnel.to - tunnel.from + 12;
      route.pointAt(route.wrap(from), at);
      const sim = new SimPlayer(collision, { ground: sample, hopProbe: playerHopProbe(collision) });
      sim.placeOnGround(at.x, at.z);
      const link = `/spawn?pos=${at.x.toFixed(1)},${at.z.toFixed(1)}&seed=${PARK_SEED_ASKED}`;
      let last = route.wrap(from);
      let travelled = 0;
      let worstWedge = 0;
      let worstHead = -Infinity;
      for (let f = 0; f < 60 * 15 && travelled < goal; f += 1) {
        route.tangentAt(last, along);
        sim.step(1 / 60, along.x * dir, along.z * dir, false);
        const now = route.distanceNear(sim.position.x, sim.position.z);
        let moved = route.forwardGap(last, now);
        if (moved > route.length / 2) moved -= route.length;
        travelled += moved * dir;
        last = now;
        worstWedge = Math.max(worstWedge, wedgeDepth(collision, sim.position, sim.groundHeight));
        for (const bridge of bridges) {
          const soffit = bridge.soffitYAt(sim.position.x, sim.position.z);
          if (soffit !== null) worstHead = Math.max(worstHead, sim.position.y + KID_HEIGHT - soffit);
        }
      }
      const where = `the tunnel at ${route.wrap(tunnel.from).toFixed(1)}–${route.wrap(tunnel.to).toFixed(1)} m round the loop, walked ${dir > 0 ? 'with' : 'against'} the train from ${link}`;
      if (travelled < goal - 0.5) failed.push(`${where}: stopped after ${travelled.toFixed(1)} of ${goal.toFixed(1)} m`);
      else if (worstWedge > WEDGE_DEPTH) failed.push(`${where}: wedged ${worstWedge.toFixed(2)} m on the way`);
      else if (worstHead > 0) failed.push(`${where}: her head ${worstHead.toFixed(2)} m through the soffit`);
    }
  }
  say(
    tunnels.length > 0 && failed.length === 0,
    `${tunnels.length} tunnel(s) under ${bridges.length} bridge(s), walked both ways along the line's middle: ${failed.length} stopped, wedged or through the soffit${failed.length ? ` — ${failed.slice(0, 6).join('; ')}` : ''}`,
  );
  if (tunnels.length === 0) note('clause 12: this park\'s line runs under no bridge, so the clause asserts nothing here');
}

// ---------------------------------------------------------------------------
// 8. The train stops for anyone on the line — and never keeps her aboard
// ---------------------------------------------------------------------------
/**
 * **On the line ahead of the train, it stops short of anyone, waits, and goes
 * on once they have gone** (Jim, 19 Oct 2026: *"make the fence around the
 * track back to its old height, and make the train stop if anyone is in front
 * of it"*) — **and with her pets out she can ride it all the way round and get
 * off** (Jim, 19 Oct 2026: *"all the pets except one jump into her backpack on
 * getting on any ride, then one rides on the seat alongside the player"*).
 *
 * Driven through `Game`'s own wiring and nothing else: a real `Player` with
 * three pets out in a real `Parade`, introduced to the park by the two calls
 * `Game` makes (`World.attachPlayer`, `World.attachParade`), ticked in
 * `Game`'s order (her, the world, her line). The train is told of nobody here:
 * it looks out for her and her line itself, and for the crowd through
 * `World`'s own wiring.
 *
 * Her, standing just past its nose while it waits at a station, then on the
 * loop well ahead of it, then gone; her line, left on the line behind her as
 * she steps up onto a platform; her, in a tunnel; a child of the crowd; and
 * the ride: she boards with her line out, it leaves, goes all the way round,
 * stands at a stop and offers "Get off", she takes it, and it goes on. Its
 * nose must stand at least **her own width** (`2 × PLAYER_RADIUS`, the game's
 * measure of her, not the train's own `TRAIN_STOPS_SHORT`) short of anybody's
 * body, stand still while they are there, and pass the spot once they have
 * left.
 */
/** Nobody touching anything — the real `Player`'s input, still. */
const STILL_INPUT = {
  moveX: 0,
  moveY: 0,
  moveAmount: 0,
  manualMoveActive: false,
  isDown: () => false,
  justPressed: () => false,
  setMouseCaptureActive: (): void => {},
  setNavigationMove: (): void => {},
  setNavigationSprint: (): void => {},
};
/** The stick held along world `(dx, dz)`, through the camera's ground basis, as a thumb holds it. */
function walkAlong(camera: IsoCamera, dx: number, dz: number): typeof STILL_INPUT {
  const length = Math.hypot(dx, dz) || 1;
  const r = camera.right;
  const f = camera.forward;
  return {
    ...STILL_INPUT,
    moveX: (dx * r.x + dz * r.z) / length,
    moveY: (dx * f.x + dz * f.z) / length,
    moveAmount: 1,
    manualMoveActive: true,
  };
}
const SHE_IS = { player: null as Player | null, parade: null as Parade | null, camera: null as IsoCamera | null };
if (inPart('park')) {
  console.log('\n8. THE TRAIN — it stops short of anyone on the line, waits, goes on once they have gone, and with her pets out takes her all the way round and lets her off:');
  const train = world.train;
  const route = train.route;
  // Her line, three of them, out — the hotel is built already, so they have no
  // beds here; nothing below sleeps.
  gameStore.earn(1000);
  for (const id of ['pet.bunny', 'pet.kitten', 'pet.mouse']) {
    const spec = shopItem(id);
    if (spec) gameStore.buy(spec);
  }
  gameStore.setCarried(null);
  const camera = new IsoCamera();
  const player = new Player(collision, camera, new Vector3(ENTRANCE_PLAYER_X, 0, ENTRANCE_PLAYER_Z));
  park.scene.add(player.group);
  world.attachPlayer(player);
  const parade = new Parade(player, collision, camera);
  park.scene.add(parade.group);
  world.attachParade(parade);
  SHE_IS.player = player;
  SHE_IS.parade = parade;
  SHE_IS.camera = camera;
  // The proofs' breaks, each of one thing the clause is for.
  if (PROVE === 'train-ignores-her') {
    const lookingOut = train as unknown as { lookout(): Iterable<{ radius: number }> };
    const looked = lookingOut.lookout.bind(train);
    lookingOut.lookout = function* () {
      for (const body of looked()) if (body.radius !== PLAYER_RADIUS) yield body;
    } as never;
  }
  // M5, as the review named it: her line never introduced to the train.
  if (PROVE === 'train-ignores-pets') (train as unknown as { parade: unknown }).parade = null;
  if (PROVE === 'platform-holds-train') {
    // Her platform counted as the line: wherever she stands on one, she reads
    // as standing on the line's middle, and the train waits for her there.
    const looking = train as unknown as { nearLine(x: number, y: number, z: number): { at: number; lateral: number; onPlatform: boolean } | null };
    const nearLine = looking.nearLine.bind(train);
    looking.nearLine = (x, y, z) => {
      const near = nearLine(x, y, z);
      if (near && near.onPlatform && x === player.position.x && z === player.position.z) near.lateral = 0;
      return near;
    };
  }
  if (PROVE === 'train-ignores-npcs') world.npcs.onTheLine = function* () {};
  if (PROVE === 'pets-count-aboard') {
    // Her companion counted as standing while it rides beside her.
    (Parade.prototype as unknown as { standing: () => Iterable<Readonly<Vector3>> }).standing = function* (this: { members: { root: { visible: boolean; position: Vector3 } }[] }) {
      for (const member of this.members) if (member.root.visible) yield member.root.position;
    };
  }
  if (PROVE === 'pets-stay-out') {
    // No backpack: every ride treated as no ride, so her line walks the track behind the train.
    (Parade.prototype as unknown as { embark: (holder: RideHolder) => void }).embark = function (this: { aboard: unknown }, holder: RideHolder) {
      this.aboard = { holder, ride: 'not a ride', companion: null, stays: true };
    };
  }
  if (player.riding) player.letGo(); // the cat bus she arrives on
  const MARGIN = 2 * PLAYER_RADIUS;
  const at = new Vector3();
  const clock = { dt: 1 / 60, elapsed: 0, frame: 0, input: STILL_INPUT as unknown as FrameContext['input'], playerPosition: player.position, cameraForward: camera.forward };
  /** `Game`'s frame, in `Game`'s order: her, the world (the train among it), her line. */
  const play = (seconds: number, input: unknown = STILL_INPUT, dt = 1 / 60, each?: () => boolean | void, before?: () => void): void => {
    for (let t = 0; t < seconds - 1e-9; t += dt) {
      clock.dt = dt;
      clock.elapsed += dt;
      clock.frame += 1;
      clock.input = input as FrameContext['input'];
      before?.();
      player.update(clock as unknown as FrameContext);
      world.update(clock as unknown as FrameContext);
      parade.update(clock as unknown as FrameContext);
      if (each?.() === true) return;
    }
  };
  /** Stood on the track bed `d` round the loop, by a hand (a check's own placement: the put-down rule keeps her off the line). */
  const standOnLine = (d: number): void => {
    route.pointAt(route.wrap(d), at);
    player.position.set(at.x, sample(at.x, at.z, at.y + 0.5) + 0.05, at.z);
    player.launch(0);
    play(0.5);
  };
  /** How far a body's edge is in front of the nose, metres: negative once the nose is past it. */
  const edgeAhead = (x: number, z: number, radius: number): number => {
    let ahead = route.forwardGap(train.noseDistance(), route.distanceNear(x, z));
    if (ahead > route.length / 2) ahead -= route.length;
    return ahead - radius;
  };
  /** The train run for `seconds`: the nearest its nose came to her body, how long it stood, how far it went. */
  const drive = (seconds: number, dt = 1 / 60): { nearest: number; stood: number; moved: number } => {
    let nearest = Infinity;
    let stood = 0;
    let moved = 0;
    play(seconds, STILL_INPUT, dt, () => {
      moved += train.runningSpeed * dt;
      if (train.runningSpeed === 0) stood += dt;
      nearest = Math.min(nearest, edgeAhead(player.position.x, player.position.z, PLAYER_RADIUS));
    });
    return { nearest, stood, moved };
  };
  // **At every station**, the one it starts at first and then each in turn:
  // standing on the line just past its nose while it waits, it stays; then up
  // on the platform where its chip stands her ("Get on"'s own spot), with her
  // line formed up round her, it leaves. Each platform is its own geometry —
  // its canopy, its open end, which side of the line it stands — and the
  // train's reach beside a platform (`PLATFORM_AHEAD`, `PLATFORM_BESIDE`) is
  // what says a child on the platform is not in its way: a child of the crowd
  // idling at a platform's edge once held it there for minutes.
  {
    const stations = train.stations;
    const first = train.stoppedAt();
    const stayed: string[] = [];
    const held: string[] = [];
    let asked = 0;
    for (let k = 0; k < stations.length; k += 1) {
      const index = ((first ?? 0) + k) % stations.length;
      const station = stations[index]!;
      // Until it stands at this one (the first: now, in its first dwell).
      play(300, STILL_INPUT, 1 / 30, () => train.stoppedAt() === index && train.runningSpeed === 0);
      if (train.stoppedAt() !== index) {
        held.push(`${station.name}: it never came to stand there (its nose at ${train.noseDistance().toFixed(1)} m round, moving ${train.runningSpeed.toFixed(2)})`);
        continue;
      }
      asked += 1;
      standOnLine(train.noseDistance() + 2.2 + PLAYER_RADIUS);
      const waiting = drive(14);
      if (!(waiting.nearest >= MARGIN && waiting.stood > 10)) stayed.push(`${station.name}: it stays ${waiting.nearest.toFixed(2)} m short of her and stands ${waiting.stood.toFixed(1)} s of 14`);
      // Up onto the platform where the chip stands her; her line catches her up.
      player.teleportTo(station.standX, sample(station.standX, station.standZ, 50), station.standZ);
      let leftIn = -1;
      let t = 0;
      const from = train.noseDistance();
      play(20, STILL_INPUT, 1 / 30, () => {
        t += 1 / 30;
        if (route.forwardGap(from, train.noseDistance()) > 1) leftIn = t;
        return leftIn >= 0;
      });
      if (leftIn < 0) {
        const near = [...parade.standing()].filter((p) => train.onTheLine(p.x, p.y, p.z, PARADE_MEMBER_RADIUS)).length;
        held.push(`${station.name}: with her on its platform at (${station.standX.toFixed(1)}, ${station.standZ.toFixed(1)}) it never left in 20 s (${near} of her line on the line)`);
      }
    }
    say(asked === stations.length && stayed.length === 0, `at every station (${asked} of ${stations.length}): on the line 2.2 m past its nose as it waits, the train stays at least her own width (${MARGIN.toFixed(2)} m) short of her and stands the 14 s${stayed.length ? ` — ${stayed.join('; ')}` : ''}`);
    say(asked === stations.length && held.length === 0, `at every station: up on the platform where its chip stands her, with her line about her, it leaves${held.length ? ` — ${held.join('; ')}` : ''}`);
  }
  // Out on the loop, well ahead of it: it brakes, stands, waits.
  standOnLine(train.noseDistance() + 20 + PLAYER_RADIUS);
  const spot = route.distanceNear(player.position.x, player.position.z);
  const coming = drive(20);
  say(coming.nearest >= MARGIN && coming.stood > 3, `on the loop: 20 m ahead of it, the train comes on ${coming.moved.toFixed(1)} m and stops ${coming.nearest.toFixed(2)} m short of her (${MARGIN.toFixed(2)} asked), standing ${coming.stood.toFixed(1)} s`);
  // She leaves the line: it goes on past where she stood.
  player.teleportTo(ENTRANCE_PLAYER_X, terrainHeight(ENTRANCE_PLAYER_X, ENTRANCE_PLAYER_Z), ENTRANCE_PLAYER_Z);
  drive(12);
  let past = route.forwardGap(train.noseDistance(), spot);
  if (past > route.length / 2) past -= route.length;
  say(past < -2, `once she has gone, it goes on: its nose ${(-past).toFixed(1)} m past where she stood`);

  // **Her line, left on the line behind her.** Out on the loop ahead of the
  // train she walks along the track, then hops its fence out of the
  // corridor and stands there; her line follows her trail, so the animals at
  // its back are still down on the track bed while she waits beyond the fence.
  {
    // Ahead of it as it stands at a station: room to walk the line before it comes.
    play(240, STILL_INPUT, 1 / 30, () => train.stoppedAt() !== null);
    const herLine = (): { x: number; y: number; z: number }[] => [...parade.standing()].map((p) => ({ x: p.x, y: p.y, z: p.z }));
    let start = route.wrap(train.noseDistance() + 30);
    // Clear of every platform and bridge for the walk: along until it is.
    const clearAt = (d: number): boolean => {
      for (let k = -2; k <= 12; k += 1) {
        route.pointAt(route.wrap(d + k), at);
        if (train.stations.some((station) => station.covers(at.x, at.z)) || train.bridges.some((bridge) => bridge.covers(at.x, at.z))) return false;
      }
      return true;
    };
    for (let k = 0; k < 40 && !clearAt(start); k += 1) start = route.wrap(start + 2);
    standOnLine(start);
    route.tangentAt(start, at);
    play(0.6, walkAlong(camera, at.x, at.z));
    // Out over the fence on the side away from the park's middle, with a hop:
    // square across the line (its normal there — on a stretch running out from
    // the middle, "away from the middle" would be along the track), on the side
    // the park's middle is not.
    const d = route.distanceNear(player.position.x, player.position.z);
    route.pointAt(d, at);
    const here = { x: at.x, z: at.z };
    route.tangentAt(d, at);
    const side = Math.sign(at.z * here.x - at.x * here.z) || 1;
    const outX = at.z * side;
    const outZ = -at.x * side;
    const hop = { ...walkAlong(camera, outX, outZ), justPressed: (key: string) => key === 'jump', isDown: (key: string) => key === 'jump' };
    play(1 / 60, hop);
    play(0.45, walkAlong(camera, outX, outZ));
    play(1);
    route.pointAt(route.distanceNear(player.position.x, player.position.z), at);
    const beyond = Math.hypot(player.position.x - at.x, player.position.z - at.z);
    const onLine = herLine().filter((p) => train.onTheLine(p.x, p.y, p.z, PARADE_MEMBER_RADIUS));
    if (beyond < FENCE_OFFSET + 0.4) say(false, `her line on the line: she did not get out over the fence (${beyond.toFixed(2)} m from the line's middle), so the case asks nothing of her line`);
    else if (onLine.length === 0) say(false, `her line on the line: none of her ${herLine().length} companions was left on the line behind her, so the case asserts nothing`);
    else {
      // Until the train has come up to the nearest of them and stood there.
      let nearest = Infinity;
      let stood = 0;
      play(90, STILL_INPUT, 1 / 30, () => {
        let gap = Infinity;
        for (const p of herLine()) if (train.onTheLine(p.x, p.y, p.z, PARADE_MEMBER_RADIUS)) gap = Math.min(gap, edgeAhead(p.x, p.z, PARADE_MEMBER_RADIUS));
        nearest = Math.min(nearest, gap);
        stood = gap < 10 && train.runningSpeed === 0 ? stood + 1 / 30 : 0;
        return stood > 4;
      });
      say(nearest >= MARGIN && nearest < 10 && stood > 3, `her line on the line: ${onLine.length} of her companions left on the track behind her as she hopped the fence, the train comes up and stops ${nearest.toFixed(2)} m short of the nearest (${MARGIN.toFixed(2)} asked), standing ${stood.toFixed(1)} s`);
      // She walks on; her line follows her off the line, over the fence, and the train goes by.
      const spot = route.distanceNear(player.position.x, player.position.z);
      play(4, walkAlong(camera, outX, outZ));
      let past = false;
      play(40, STILL_INPUT, 1 / 30, () => {
        const ahead = route.forwardGap(spot, train.noseDistance());
        return (past = ahead > 2 && ahead < route.length / 2);
      });
      say(past, `once her line has followed her off it, the train goes on past where they stood${past ? '' : ' — it never did in 40 s'}`);
    }
  }

  // In a tunnel: her on the line under a bridge, the train coming up to it.
  const tunnel = tunnelsOnLine[0];
  if (!tunnel) note('clause 8: this park\'s line runs under no bridge, so the stop in a tunnel asserts nothing here');
  else {
    const mid = route.wrap((tunnel.from + tunnel.to) / 2);
    // Run it round, with nobody on the line, until it is 15-30 m short of the tunnel.
    player.teleportTo(ENTRANCE_PLAYER_X, terrainHeight(ENTRANCE_PLAYER_X, ENTRANCE_PLAYER_Z), ENTRANCE_PLAYER_Z);
    play(240, STILL_INPUT, 1 / 30, () => {
      const gap = route.forwardGap(train.noseDistance(), mid);
      return gap > 15 && gap < 30 && train.runningSpeed > 1;
    });
    standOnLine(mid);
    const inTunnel = drive(20);
    say(inTunnel.nearest >= MARGIN && inTunnel.stood > 3, `in a tunnel: under the bridge at ${route.wrap(tunnel.from).toFixed(1)}–${route.wrap(tunnel.to).toFixed(1)} m round the loop, the train stops ${inTunnel.nearest.toFixed(2)} m short of her (${MARGIN.toFixed(2)} asked), standing ${inTunnel.stood.toFixed(1)} s`);
    player.teleportTo(ENTRANCE_PLAYER_X, terrainHeight(ENTRANCE_PLAYER_X, ENTRANCE_PLAYER_Z), ENTRANCE_PLAYER_Z);
    play(12, STILL_INPUT, 1 / 30);
  }
  // A child of the crowd on the line ahead, through World's own wiring.
  const kid = world.npcs.all.find((character) => !((character.driver as { trainSeat?: number | null }).trainSeat ?? null));
  if (!kid) say(false, 'a child of the crowd: the headless park has no child in its crowd to stand on the line');
  else {
    const d = route.wrap(train.noseDistance() + 20 + NPC_RADIUS);
    route.pointAt(d, at);
    let nearest = Infinity;
    let stood = 0;
    const kidY = sample(at.x, at.z, at.y + 0.5);
    play(
      20,
      STILL_INPUT,
      1 / 60,
      () => {
        if (train.runningSpeed === 0) stood += 1 / 60;
        nearest = Math.min(nearest, edgeAhead(at.x, at.z, NPC_RADIUS));
      },
      // Stood there and held there, every frame before the crowd moves.
      () => {
        kid.position.set(at.x, kidY, at.z);
        kid.setCarriedPose(at.x, at.z);
      },
    );
    say(nearest >= MARGIN && stood > 3, `a child of the crowd: 20 m ahead of it, through World's own wiring, the train stops ${nearest.toFixed(2)} m short of them (${MARGIN.toFixed(2)} asked), standing ${stood.toFixed(1)} s`);
    kid.position.set(ENTRANCE_PLAYER_X + 3, terrainHeight(ENTRANCE_PLAYER_X + 3, ENTRANCE_PLAYER_Z), ENTRANCE_PLAYER_Z);
  }

  // **The ride** — the blocker this replaced: with a pet out, the train once
  // never left the platform with her aboard, and she could not get off.
  {
    const before = parade.lineNow().out;
    let boarded = false;
    play(200, STILL_INPUT, 1 / 30, () => {
      const zone = train.interactZones().find((z) => z.actions?.().some((action) => action.label === 'Get on'));
      if (!zone) return false;
      player.teleportTo(zone.standX, sample(zone.standX, zone.standZ, player.position.y + 2), zone.standZ);
      play(0.5, STILL_INPUT, 1 / 30);
      zone.actions?.().find((action) => action.label === 'Get on')?.run();
      return (boarded = player.riding);
    });
    if (!boarded) say(false, 'the ride: the train never stood at a platform she could board in 200 s');
    else {
      play(0.5, STILL_INPUT, 1 / 30);
      const aboard = parade.lineNow();
      let last = train.noseDistance();
      let travelled = 0;
      let leftIn = -1;
      let offered = false;
      let t = 0;
      play(240, STILL_INPUT, 1 / 30, () => {
        t += 1 / 30;
        travelled += route.forwardGap(last, train.noseDistance());
        last = train.noseDistance();
        if (leftIn < 0 && travelled > 1) leftIn = t;
        if (travelled < route.length - 1) return false;
        return (offered = train.interactZones().some((z) => z.actions?.().some((action) => action.label === 'Get off')));
      });
      if (offered) train.interactZones().find((z) => z.actions?.().some((action) => action.label === 'Get off'))?.actions?.().find((action) => action.label === 'Get off')?.run();
      const off = !player.riding;
      play(2, STILL_INPUT, 1 / 30);
      const back = parade.lineNow();
      const stuck = [...parade.standing()].filter((p) => train.onTheLine(p.x, p.y, p.z, PARADE_MEMBER_RADIUS) || collision.deepestSolidOverlap(new Vector3(p.x, p.y, p.z), PARADE_MEMBER_RADIUS, 0, undefined, 1.55) > CLEAR_TOLERANCE);
      const leaving = train.noseDistance();
      play(15, STILL_INPUT, 1 / 30);
      const goneOn = route.forwardGap(leaving, train.noseDistance());
      say(
        aboard.out === Math.min(1, before) && aboard.seated === Math.min(1, before) && leftIn >= 0 && leftIn < 15 && travelled >= route.length - 1 && offered && off && back.out === before && back.seated === 0 && stuck.length === 0 && goneOn > 2,
        `the ride, with her ${before} pets out: aboard, ${aboard.seated} beside her and ${before - aboard.out} in her backpack; it left in ${leftIn < 0 ? 'never' : `${leftIn.toFixed(1)} s`}, went ${travelled.toFixed(0)} of its ${route.length.toFixed(0)} m lap and ${offered ? 'offered "Get off" at a stop' : 'never offered "Get off"'}; ${off ? 'she got off' : 'she could NOT get off'}, ${back.out} of ${before} back out (${stuck.length} on the line or in something), and it went on ${goneOn.toFixed(1)} m without her`,
      );
    }
  }
  note(`clause 8 drove the park's own train ${clock.elapsed.toFixed(0)} s through Game's own wiring — a real Player, a real Parade with her three pets out, World.attachPlayer and World.attachParade, ticked in Game's order — with her own width (${MARGIN.toFixed(2)} m) asked of every stop`);
}

// ---------------------------------------------------------------------------
// 13. The train is solid
// ---------------------------------------------------------------------------
/**
 * **She bumps the train, stands on it, and is never wedged against it**
 * (Jim, 19 Oct 2026: *"also solid trains"*). Its engine and carriages are
 * bodies in the collision world, moved by the train every frame
 * (`CollisionWorld.addMovingBox`, `ParkTrain.moveBodies`). With the same real
 * `Player` and wiring as clause 8:
 *
 * - **Walking into it standing**: from its platform at every carriage, and
 *   along the line at its nose and its tail, she stops at its side — never
 *   nearer the line's middle than the drawn carriage's half-width and her own
 *   radius, never past its nose or tail.
 * - **Walking into it moving**: from the platform as it pulls in, never inside
 *   any piece of it.
 * - **Standing on it**: on a carriage at a platform, it waits — through its
 *   dwell and twenty seconds more — and goes once she has stepped off.
 * - **Put down beside it**: every exit asked inside it, in the slot between it
 *   and its far fence, and between two of its cars, puts her where no piece of
 *   it holds her and she is not wedged.
 * - **Dropped into a slot beside it**: the far side of every car and the gaps
 *   between them — the wedge rescue frees her within a few seconds, and the
 *   train does not move while she is there.
 */
if (inPart('park')) {
  console.log('\n13. THE TRAIN IS SOLID — she bumps it, stands on it, and is never wedged against it:');
  const player = SHE_IS.player;
  const parade = SHE_IS.parade;
  const camera = SHE_IS.camera;
  if (!player || !parade || !camera) say(false, 'the solid train: clause 8 built no player to walk at it');
  else {
    const train = world.train;
    const route = train.route;
    const at = new Vector3();
    // The proofs' breaks, each of one thing the clause is for.
    if (PROVE === 'frozen-train') CollisionWorld.prototype.moveBox = function () {};
    if (PROVE === 'train-ignores-on-top') {
      const looking = train as unknown as { nearLine(x: number, y: number, z: number): { at: number } | null };
      const nearLine = looking.nearLine.bind(train);
      const floor = new Vector3();
      looking.nearLine = (x, y, z) => {
        const near = nearLine(x, y, z);
        if (!near) return near;
        route.pointAt(near.at, floor);
        return y > floor.y + CAR_FLOOR_Y ? null : near;
      };
    }
    if (PROVE === 'put-down-ignores-train') {
      const near = CollisionWorld.prototype.near;
      CollisionWorld.prototype.near = function (this: CollisionWorld, x: number, z: number, reach: number) {
        const view = near.call(this, x, z, reach) as unknown as { boxes: { moving: boolean }[] };
        view.boxes = view.boxes.filter((box) => !box.moving);
        return view as unknown as CollisionWorld;
      };
    }
    const clock = { dt: 1 / 60, elapsed: 0, frame: 0, input: STILL_INPUT as unknown as FrameContext['input'], playerPosition: player.position, cameraForward: camera.forward };
    /**
     * **Holding it standing**, while a test needs it to stand still rather than
     * to decide to: a child of the crowd stood on the line just ahead of its
     * nose, every frame — the train waits for her as it waits for anybody
     * (clause 8). `null` lets it go.
     */
    let holdAt: Vector3 | null = null;
    const holder = world.npcs.all.find((character) => !((character.driver as { trainSeat?: number | null }).trainSeat ?? null)) ?? null;
    const hold = (on: boolean): void => {
      if (!on || !holder) {
        if (holdAt && holder) holder.position.set(ENTRANCE_PLAYER_X + 3, terrainHeight(ENTRANCE_PLAYER_X + 3, ENTRANCE_PLAYER_Z), ENTRANCE_PLAYER_Z);
        holdAt = null;
        return;
      }
      route.pointAt(route.wrap(train.noseDistance() + 3 + NPC_RADIUS), at);
      holdAt = new Vector3(at.x, sample(at.x, at.z, at.y + 0.5), at.z);
    };
    const play = (seconds: number, input: unknown = STILL_INPUT, dt = 1 / 60, each?: () => boolean | void): void => {
      for (let t = 0; t < seconds - 1e-9; t += dt) {
        clock.dt = dt;
        clock.elapsed += dt;
        clock.frame += 1;
        clock.input = input as FrameContext['input'];
        if (holdAt && holder) {
          holder.position.copy(holdAt);
          holder.setCarriedPose(holdAt.x, holdAt.z);
        }
        player.update(clock as unknown as FrameContext);
        world.update(clock as unknown as FrameContext);
        parade.update(clock as unknown as FrameContext);
        if (each?.() === true) return;
      }
    };
    /** The train's own pieces, as the collision world holds them. */
    const pieces: SolidView[] = [];
    collision.forEachSolid((solid) => {
      if (solid.moving) pieces.push(solid);
    });
    /**
     * How far her body reaches inside any piece of the train that stands more
     * than a step over her feet, metres: 0 when nothing of it holds her. A
     * piece within a step she walks up onto (a carriage from a high platform);
     * one above that is a side she must bump.
     */
    const insideTrain = (p: Vector3): number => {
      let deepest = 0;
      for (const piece of pieces) {
        if (piece.topAt(p.x, p.z) - p.y <= BUILDING_STEP_UP - STEP_MARGIN) continue;
        if (p.y < piece.baseAt(p.x, p.z) - KID_HEIGHT) continue;
        deepest = Math.max(deepest, piece.depthAt(p.x, p.z) + PLAYER_RADIUS);
      }
      return deepest;
    };
    /** Is she down at the line's own level — on the track bed, not up on a carriage? */
    const downOnTrack = (p: Vector3): boolean => {
      route.pointAt(route.distanceNear(p.x, p.z), at);
      return p.y < at.y + 0.3;
    };
    /** Which side of the line she is on, seen from a station's platform: positive is the platform's side. */
    const sideOf = (p: Vector3, station: { standX: number; standZ: number; distance: number }): number => {
      route.pointAt(route.distanceNear(p.x, p.z), at);
      const tx = station.standX - at.x;
      const tz = station.standZ - at.z;
      return (p.x - at.x) * tx + (p.z - at.z) * tz;
    };
    const lineGap = (p: Vector3): number => {
      route.pointAt(route.distanceNear(p.x, p.z), at);
      return Math.hypot(p.x - at.x, p.z - at.z);
    };
    // Standing at a station: wait for it to come in to one.
    play(240, STILL_INPUT, 1 / 30, () => train.stoppedAt() !== null);
    const stopped = train.stoppedAt();
    const station = stopped === null ? null : train.stations[stopped] ?? null;
    if (!station) say(false, 'the solid train: it never stood at a station in 240 s');
    else {
      hold(true);
      // Let it come up to the child holding it and stand, before anything is measured against where it is.
      play(4, STILL_INPUT, 1 / 30);
      const carsNow = (): number[] => {
        const front = train.noseDistance();
        return [front - LOCO_LENGTH / 2, ...[0, 1, 2].map((i) => front - LOCO_LENGTH / 2 - (LOCO_LENGTH / 2 + CAR_GAP + CARRIAGE_LENGTH / 2 + i * (CARRIAGE_LENGTH + CAR_GAP)))];
      };
      const nose = train.noseDistance();
      const carCentres = carsNow();
      const tail = nose - LOCO_LENGTH - 3 * CARRIAGE_LENGTH - 3 * CAR_GAP;
      // --- walking into it standing, from the platform at each carriage ---
      const bumped: string[] = [];
      let asked = 0;
      for (const centre of carCentres.slice(1)) {
        route.pointAt(route.wrap(centre), at);
        const outX = station.standX - at.x;
        const outZ = station.standZ - at.z;
        const out = Math.hypot(outX, outZ) || 1;
        const fromX = at.x + (outX / out) * 2.6;
        const fromZ = at.z + (outZ / out) * 2.6;
        if (!station.covers(fromX, fromZ)) continue;
        asked += 1;
        player.teleportTo(fromX, sample(fromX, fromZ, at.y + 2), fromZ);
        play(0.3);
        let deepest = 0;
        let through = false;
        let over = false;
        play(2.5, walkAlong(camera, -outX, -outZ), 1 / 60, () => {
          deepest = Math.max(deepest, insideTrain(player.position));
          // Up on it on the way is over it, not through it.
          if (pieces.some((piece) => piece.standsAt(player.position.x, player.position.z) && player.position.y >= piece.topAt(player.position.x, player.position.z) - 0.1)) over = true;
          const her = route.distanceNear(player.position.x, player.position.z);
          const span = LOCO_LENGTH + 3 * CARRIAGE_LENGTH + 3 * CAR_GAP;
          const alongside = route.forwardGap(route.wrap(train.noseDistance() - span), her) <= span;
          if (!over && alongside && downOnTrack(player.position) && sideOf(player.position, station) < 0) through = true;
        });
        if (through || deepest > 0.03) bumped.push(`at the carriage ${route.wrap(centre).toFixed(1)} m round: ${through ? 'through to its far side, ' : ''}${deepest.toFixed(2)} m inside it`);
      }
      say(asked > 0 && bumped.length === 0, `walking into it standing at ${station.name}, from the platform at ${asked} carriage(s): she bumps its side, or steps up onto it where the platform is a step below its rim — never inside it, never through it${bumped.length ? ` — ${bumped.join('; ')}` : ''}`);
      // --- and along the line at its nose and its tail ---
      const ends: string[] = [];
      for (const [label, start, toward] of [['its nose', nose + 6, -1], ['its tail', tail - 6, 1]] as const) {
        route.pointAt(route.wrap(start), at);
        player.position.set(at.x, sample(at.x, at.z, at.y + 0.5) + 0.05, at.z);
        player.launch(0);
        play(0.5);
        route.tangentAt(route.wrap(start), at);
        // At its end she stops against it, or slides round its corner into
        // the corridor beside it — never into it.
        let deepest = 0;
        play(3, walkAlong(camera, at.x * toward, at.z * toward), 1 / 60, () => {
          deepest = Math.max(deepest, insideTrain(player.position));
        });
        if (deepest > 0.03) ends.push(`${label}: ${deepest.toFixed(2)} m inside it, at (${player.position.x.toFixed(2)}, ${player.position.y.toFixed(2)}, ${player.position.z.toFixed(2)})`);
      }
      say(ends.length === 0, `walking into it along the line: at its nose and its tail she is never inside it${ends.length ? ` — ${ends.join('; ')}` : ''}`);
      // --- standing on it: put up on it while it is held, then nobody but her holding it ---
      // Somewhere on it beside the platform with room for her over it — under
      // a platform's canopy a carriage's top has none, and she cannot get
      // onto it there at all (stepping up, her head meets the canopy;
      // jumping, it caps her) — on a carriage no child of the crowd is
      // riding in: one sat in it is furniture to her
      // (`NpcSystem.separateFromPlayer`), and shoulders her straight off its
      // top. On a carriage that is its middle, between its two backrests —
      // the one place on one she fits, all of her: they stand 0.70 m either
      // side of it, and she is 0.62 m round. Or the engine's cab roof. With
      // nowhere like that at this stop, it goes on to its next, and she
      // looks there.
      type Stop = NonNullable<typeof station>;
      const spotAt = (stop: Stop): { what: string; d: number; top: number } | null => {
        route.pointAt(stop.distance, at);
        const acrossX = stop.standX - at.x;
        const acrossZ = stop.standZ - at.z;
        const across = Math.hypot(acrossX, acrossZ) || 1;
        const riders = new Set(world.npcs.all.map((character) => (character.driver as { trainSeat?: number | null }).trainSeat).filter((seat): seat is number => seat !== null && seat !== undefined));
        const cars = carsNow();
        const candidates = [
          ...[0, 1, 2].filter((carriage) => !riders.has(carriage * 2) && !riders.has(carriage * 2 + 1)).map((carriage) => ({ what: `carriage ${carriage + 1}`, d: cars[carriage + 1]! })),
          { what: "the engine's cab roof", d: cars[0]! - 1.05 },
        ];
        for (const candidate of candidates) {
          route.pointAt(route.wrap(candidate.d), at);
          const x = at.x;
          const z = at.z;
          // Beside the platform: straight off it there, she is on it.
          if (!stop.covers(x + (acrossX / across) * 2.2, z + (acrossZ / across) * 2.2)) continue;
          const top = pieces.filter((piece) => piece.depthAt(x, z) >= 0 && piece.standsAt(x, z)).reduce((t, piece) => Math.max(t, piece.topAt(x, z)), -Infinity);
          if (!Number.isFinite(top)) continue;
          if (collision.deepestSolidOverlap(new Vector3(x, top, z), PLAYER_RADIUS, 0, undefined, KID_HEIGHT, top) > 0.01) continue;
          // And room over her, all the way off it to the platform.
          let headroom = true;
          for (let k = 0; headroom && k <= 11; k += 1) {
            if (collision.ceilingAt(x + (acrossX / across) * k * 0.2, z + (acrossZ / across) * k * 0.2, top + 0.05) - top < KID_HEIGHT + 0.1) headroom = false;
          }
          if (headroom) return { what: candidate.what, d: candidate.d, top };
        }
        return null;
      };
      let stop: Stop = station;
      let spot = spotAt(stop);
      const passedBy: string[] = [];
      for (let stops = 0; !spot && stops < 6; stops += 1) {
        passedBy.push(stop.name);
        // Back on the platform while it goes on to its next stop.
        player.teleportTo(stop.standX, sample(stop.standX, stop.standZ, 50), stop.standZ);
        hold(false);
        play(60, STILL_INPUT, 1 / 30, () => train.stoppedAt() === null);
        play(240, STILL_INPUT, 1 / 30, () => train.stoppedAt() !== null);
        const next = train.stoppedAt() === null ? null : train.stations[train.stoppedAt()!] ?? null;
        if (!next) break;
        stop = next;
        hold(true);
        play(4, STILL_INPUT, 1 / 30);
        spot = spotAt(stop);
      }
      const passed = passedBy.length ? ` (at ${passedBy.join(', then ')}, nowhere beside the platform with room for her and no child of the crowd in it)` : '';
      if (!spot) {
        // Nobody left holding it: the cases below need it running.
        hold(false);
        say(false, `standing on it: in ${passedBy.length} stops, nowhere on it beside a platform with room for her and no child of the crowd in it — NOTHING ASKED`);
      } else {
        route.pointAt(route.wrap(spot.d), at);
        // Up on it by a hand, as a jump from its platform puts her (the
        // put-down rule never stands her on a train: the router knows
        // nothing that moves).
        player.position.set(at.x, spot.top + 0.05, at.z);
        player.launch(0);
        play(0.5);
        hold(false);
        const onAt = player.position.clone();
        const onGap = lineGap(player.position);
        const topHere = pieces.filter((piece) => piece.standsAt(onAt.x, onAt.z)).reduce((t, piece) => Math.max(t, piece.topAt(onAt.x, onAt.z)), -Infinity);
        const onIt = Math.abs(onAt.y - topHere) < 0.05 && onGap < CARRIAGE_BODY_HALF_WIDTH + 0.15;
        const heldFrom = train.noseDistance();
        play(30, STILL_INPUT, 1 / 30);
        const heldFor = route.forwardGap(heldFrom, train.noseDistance());
        // She steps off straight onto the platform — square off its side —
        // and walks a little way onto it.
        route.pointAt(stop.distance, at);
        play(1.2, walkAlong(camera, stop.standX - at.x, stop.standZ - at.z));
        play(0.5);
        const offIt = !pieces.some((piece) => piece.standsAt(player.position.x, player.position.z) && player.position.y >= piece.topAt(player.position.x, player.position.z) - 0.1) && sideOf(player.position, stop) > CARRIAGE_BODY_HALF_WIDTH + PLAYER_RADIUS - 0.05;
        const leftFrom = train.noseDistance();
        play(20, STILL_INPUT, 1 / 30);
        const leftBy = route.forwardGap(leftFrom, train.noseDistance());
        say(onIt && heldFor < 0.01 && offIt && leftBy > 2, `standing on it: put on ${spot.what} at ${stop.name}${passed} ${onIt ? `(on its top, ${spot.top.toFixed(2)})` : `— she was NOT on it (her feet ${onAt.y.toFixed(2)} against its top ${spot.top.toFixed(2)}, ${onGap.toFixed(2)} m off the line's middle)`}, it moved ${heldFor.toFixed(2)} m in 30 s; ${offIt ? 'she stepped off onto the platform' : 'she could NOT step off'}, and it went on ${leftBy.toFixed(1)} m in 20 s`);
      }
    }
    // --- walking into it moving: from a platform as it pulls in ---
    {
      const coming = train.stations.find((s) => s.index !== train.stoppedAt()) ?? null;
      if (!coming) say(false, 'walking into it moving: no other station to meet it at');
      else {
        player.teleportTo(coming.standX, sample(coming.standX, coming.standZ, 50), coming.standZ);
        play(0.5);
        // Until its engine has passed her, its carriages coming by her, still moving.
        let movingBy = false;
        play(240, STILL_INPUT, 1 / 30, () => (movingBy = route.forwardGap(coming.distance, train.noseDistance()) < route.length / 2 && route.forwardGap(coming.distance, train.noseDistance()) > 2 && train.runningSpeed > 0.3));
        route.pointAt(coming.distance, at);
        let deepest = 0;
        let through = false;
        let slidPast = 0;
        let wedged = 0;
        let lastNose = train.noseDistance();
        play(6, walkAlong(camera, at.x - coming.standX, at.z - coming.standZ), 1 / 60, () => {
          deepest = Math.max(deepest, insideTrain(player.position));
          const her = route.distanceNear(player.position.x, player.position.z);
          const span = LOCO_LENGTH + 3 * CARRIAGE_LENGTH + 3 * CAR_GAP;
          const alongside = route.forwardGap(route.wrap(train.noseDistance() - span), her) <= span;
          if (alongside && downOnTrack(player.position) && sideOf(player.position, coming) < 0) through = true;
          wedged = Math.max(wedged, wedgeDepth(collision, player.position, sample(player.position.x, player.position.z, player.position.y)));
          const moved = route.forwardGap(lastNose, train.noseDistance());
          lastNose = train.noseDistance();
          if (moved > 1e-4 && lineGap(player.position) < CARRIAGE_BODY_HALF_WIDTH + PLAYER_RADIUS + 0.05) slidPast += moved;
        });
        // Against its side as it slides by, she is in contact — a frame's walk
        // into it and a frame of its travel at the deepest — and never pushed
        // into anything (never wedged): a train pulling in slides past a child
        // at its side, it does not carry her.
        const CONTACT = (PLAYER_MAX_SPEED + 4) / 60;
        say(movingBy && deepest <= CONTACT && !through, `walking into it moving: from ${coming.name} as its carriages come by her${movingBy ? '' : ' (it never came by moving — NOTHING ASKED)'}, she is never inside it beyond contact (${deepest.toFixed(2)} m at the deepest, ${CONTACT.toFixed(2)} allowed) and never through it (pressed to it ${wedged.toFixed(2)} m at the most); it slid ${slidPast.toFixed(2)} m past her side`);
        // Back on the platform where its chip stands her, and she waits there
        // for it to come round: standing still, the crowd walking up to its
        // waiting spots goes round her (`NpcSystem.separateFromPlayer`) — it
        // used to push her a metre across the platform into the train's way,
        // and the train stood short of the station for her.
        player.teleportTo(coming.standX, sample(coming.standX, coming.standZ, 50), coming.standZ);
        play(15, STILL_INPUT, 1 / 30);
      }
    }
    // --- put down beside it, and dropped into a slot beside it ---
    play(240, STILL_INPUT, 1 / 30, () => train.stoppedAt() !== null);
    const standing = train.stoppedAt() === null ? null : train.stations[train.stoppedAt()!] ?? null;
    if (!standing) {
      const t13 = train as unknown as { lookout(): Iterable<{ x: number; y: number; z: number; radius: number }>; nearLine(x: number, y: number, z: number): { at: number; lateral: number; onPlatform: boolean } | null };
      const holders: string[] = [];
      for (const b of t13.lookout()) {
        const n = t13.nearLine(b.x, b.y, b.z);
        if (n && n.lateral < 2.5) holders.push(`r${b.radius} at ${n.at.toFixed(1)} (${n.lateral.toFixed(2)} off, ${n.onPlatform ? 'platform' : 'line'})`);
      }
      say(false, `put down beside it: it never stood at a station again — its nose at ${train.noseDistance().toFixed(1)}, moving ${train.runningSpeed.toFixed(2)}; near the line: ${holders.join(', ') || 'nobody'}`);
    }
    else {
      hold(true);
      play(4, STILL_INPUT, 1 / 30);
      const nose = train.noseDistance();
      const centres = [0, 1, 2].map((i) => nose - LOCO_LENGTH / 2 - (LOCO_LENGTH / 2 + CAR_GAP + CARRIAGE_LENGTH / 2 + i * (CARRIAGE_LENGTH + CAR_GAP)));
      const gaps = [nose - LOCO_LENGTH - CAR_GAP / 2, ...[0, 1].map((i) => nose - LOCO_LENGTH - CAR_GAP - (i + 1) * CARRIAGE_LENGTH - i * CAR_GAP - CAR_GAP / 2)];
      const far = (d: number, lateral: number): Vector3 => {
        route.pointAt(route.wrap(d), at);
        const outX = standing.standX - at.x;
        const outZ = standing.standZ - at.z;
        const out = Math.hypot(outX, outZ) || 1;
        return new Vector3(at.x - (outX / out) * lateral, at.y, at.z - (outZ / out) * lateral);
      };
      const exits = [
        ...centres.map((d) => ({ what: `inside the carriage ${route.wrap(d).toFixed(1)} m round`, at: far(d, 0) })),
        ...centres.map((d) => ({ what: `in the slot beyond the carriage ${route.wrap(d).toFixed(1)} m round`, at: far(d, 1.3) })),
        ...gaps.map((d) => ({ what: `between two cars ${route.wrap(d).toFixed(1)} m round`, at: far(d, 0) })),
      ];
      const badPuts: string[] = [];
      for (const exit of exits) {
        const x = exit.at.x;
        const z = exit.at.z;
        player.endRide({ x, y: terrainHeight(x, z), z });
        // The spot the rule chose, as chosen: the rule's own answer must be
        // clear of the train, not made clear by the resolver's push or the
        // wedge rescue in the second after (which, at a platform's far side,
        // can lift her out of a slot the rule should never have put her in —
        // and did not, at the other station).
        const putAt = insideTrain(player.position);
        const putWedged = wedgeDepth(collision, player.position, sample(player.position.x, player.position.z, player.position.y));
        play(1);
        const inside = insideTrain(player.position);
        const wedged = wedgeDepth(collision, player.position, sample(player.position.x, player.position.z, player.position.y));
        if (putAt > 0.03 || putWedged > WEDGE_DEPTH) badPuts.push(`${exit.what}: put down ${putAt.toFixed(2)} m inside it, wedged ${putWedged.toFixed(2)}`);
        else if (inside > 0.03 || wedged > WEDGE_DEPTH) badPuts.push(`${exit.what}: a second later ${inside.toFixed(2)} m inside it, wedged ${wedged.toFixed(2)}`);
      }
      say(badPuts.length === 0, `put down beside it: ${exits.length} exits asked inside it, in the slot beyond it and between its cars at ${standing.name} — none puts her inside it or wedged, as put down or a second later${badPuts.length ? ` — ${badPuts.join('; ')}` : ''}`);
      hold(false);
      const badDrops: string[] = [];
      // Each asked of the train standing where it stands now: a fresh stop
      // before each drop, nothing holding it but her.
      const span = LOCO_LENGTH + 3 * CARRIAGE_LENGTH + 3 * CAR_GAP;
      const fromNose = [
        ...[0, 1, 2].map((i) => ({ what: `the slot beyond carriage ${i + 1}`, back: LOCO_LENGTH + CAR_GAP + CARRIAGE_LENGTH / 2 + i * (CARRIAGE_LENGTH + CAR_GAP), lateral: 1.3 })),
        { what: 'the gap between the engine and carriage 1', back: LOCO_LENGTH + CAR_GAP / 2, lateral: 0 },
        ...[0, 1].map((i) => ({ what: `the gap between carriages ${i + 1} and ${i + 2}`, back: LOCO_LENGTH + CAR_GAP + (i + 1) * CARRIAGE_LENGTH + i * CAR_GAP + CAR_GAP / 2, lateral: 0 })),
      ];
      let dropsAsked = 0;
      for (const drop of fromNose) {
        play(240, STILL_INPUT, 1 / 30, () => train.stoppedAt() !== null && train.runningSpeed === 0);
        const here = train.stoppedAt() === null ? null : train.stations[train.stoppedAt()!] ?? null;
        if (!here) {
          badDrops.push(`${drop.what}: the train never stood at a station to drop her beside`);
          continue;
        }
        dropsAsked += 1;
        const d = route.wrap(train.noseDistance() - drop.back);
        route.pointAt(d, at);
        const outX = here.standX - at.x;
        const outZ = here.standZ - at.z;
        const out = Math.hypot(outX, outZ) || 1;
        const x = at.x - (outX / out) * drop.lateral;
        const z = at.z - (outZ / out) * drop.lateral;
        player.position.set(x, terrainHeight(x, z) + 1.2, z);
        player.launch(0);
        let freeFor = 0;
        let worst = 0;
        let lastNose = train.noseDistance();
        let movedBeside = 0;
        play(10, STILL_INPUT, 1 / 60, () => {
          const wedged = wedgeDepth(collision, player.position, sample(player.position.x, player.position.z, player.position.y));
          worst = Math.max(worst, wedged);
          freeFor = !player.isAirborne && wedged <= WEDGE_DEPTH ? freeFor + 1 / 60 : 0;
          // Beside it — between its nose and its tail, on the line — it must stand.
          const moved = route.forwardGap(lastNose, train.noseDistance());
          lastNose = train.noseDistance();
          const her = route.distanceNear(player.position.x, player.position.z);
          const beside = route.forwardGap(route.wrap(train.noseDistance() - span), her) <= span + PLAYER_RADIUS;
          if (moved > 1e-4 && beside && train.onTheLine(player.position.x, player.position.y, player.position.z, PLAYER_RADIUS)) movedBeside += moved;
          return freeFor > 1;
        });
        if (freeFor <= 1) badDrops.push(`${drop.what} at ${here.name} (${x.toFixed(2)}, ${z.toFixed(2)}): still wedged ${worst.toFixed(2)} m after 10 s`);
        else if (movedBeside > 0.01) badDrops.push(`${drop.what} at ${here.name}: the train moved ${movedBeside.toFixed(2)} m while she was beside it`);
        player.teleportTo(here.standX, sample(here.standX, here.standZ, 50), here.standZ);
        play(0.5);
      }
      const drops = fromNose;
      say(dropsAsked === drops.length && badDrops.length === 0, `dropped into a slot beside it: ${dropsAsked} of ${drops.length} drops — the far side of every carriage and the gaps between its cars — each freed by the wedge rescue within 10 s, the train standing meanwhile${badDrops.length ? ` — ${badDrops.join('; ')}` : ''}`);
    }
    note(`clause 13 walked her at the park's own train through Game's own wiring: ${pieces.length} moving bodies, every one of them the train's own`);
  }
}

console.log(failures ? `\n${failures} clause(s) FAILED.` : '\ncheck:solids OK');
process.exit(failures ? 1 : 0);
