import {
  Box3,
  BoxGeometry,
  BufferAttribute,
  DirectionalLight,
  Fog,
  Group,
  HemisphereLight,
  InstancedMesh,
  Matrix4,
  Mesh,
  PerspectiveCamera,
  PlaneGeometry,
  Quaternion,
  Scene,
  SphereGeometry,
  Vector3,
  type WebGLRenderer,
} from 'three';
import { PALETTE } from '../../core/palette';
import { CAMERA_PITCH_DEGREES, CAMERA_YAW_DEGREES } from '../../core/constants';
// The declared one owner of "what a camera does in a portrait window". A leaf
// module — three, mathUtils and the look controls — so the ride can reach it
// without dragging the park in behind it.
import { fitCameraToViewport } from '../../core/RideCamera';
import { Rng, createRandom, clamp01, lerp, smoothstep } from '../../core/mathUtils';
// **The lane plants the park's own trees, not lookalikes of them.** See
// `world/treeModel.ts`; `PARK_SEED` is a load-time constant (a literal, or
// `LGP_SEED` from the environment), so reading it here costs nothing and
// cannot race the park's generation — see {@link LANE_SCATTER_SEED}.
import {
  FOLIAGE_GEOMETRY,
  TREE_REACH,
  fileTreeParts,
  foliageMaterial,
  makeInstanced,
  pickTreeKind,
  rollTree,
  type InstanceItem,
} from '../treeModel';
import { PARK_SEED } from '../parkManifest';
import { toonMaterial } from '../../art/style/materials';
import {
  createKid,
  KID_SHOULDER_HEIGHT,
  KID_SKIN_TONES,
  type KidHandle,
} from '../../art/models/kid';
import { CROWD_HAIR_STYLES, type HairStyle } from '../../art/models/hair';
import { HAIR_COLOURS, OUTFIT_COLOURS } from '../../art/models/kidLooks';
import {
  createCatBus,
  CAT_BUS_CABIN_CEILING_Y,
  CAT_BUS_SEAT_COUNT,
  CAT_BUS_SEAT_Y,
  CAT_BUS_LENGTH,
  type CatBusHandle,
} from './catBus';
import { createBusDriver, type BusDriver } from './busDriver';
// The game's own seated pose. A leaf module precisely so the ride can reach it
// without dragging `PARK_BOUNDARY` in behind it — see `entities/ridePose.ts`.
import { applyRidePose } from '../../entities/ridePose';
import { ROAD_HALF_WIDTH, ROAD_TILE_METRES, applyRoadUvs, roadMaterial } from './road';
// The park's own gate dimensions. Not a copy — `layout.ts` is the one owner, and
// it is reachable from here precisely because it depends on nothing heavier than
// two import-free core modules. See its note on why the arch is built twice.
import {
  ENTRANCE_GATE_HALF_WIDTH as GATE_HALF_WIDTH,
} from './layout';
import { buildGateArch } from './gateArch';

/**
 * **The ride to the park — the twenty seconds before the gate.**
 *
 * Jim, 7 August 2026:
 *
 * > *"the bus should drive down a narrow lane with the camera rotating around
 * > it until it arrives at the park, with various hills and going past trees,
 * > but in an otherwise straight line"*
 *
 * ## Straight, and that is the point
 *
 * The lane is **one axis**. There is no route to solve, no curve to fit and no
 * interaction with the park boundary: the bus drives down world −Z, the ground
 * rises and falls beneath it, and scenery stands either side. The variety comes
 * entirely from {@link ORBIT} — the camera swinging round the bus — which is
 * why the brief specifies the two together, and why adding curves "for
 * interest" would be spending the expensive half of the budget to duplicate
 * what the cheap half already does.
 *
 * ## Why it is its own `Scene`
 *
 * Two reasons, and the second is the load-bearing one.
 *
 * The park's terrain is a **disc** that stops a couple of metres past the
 * boundary (`TERRAIN_EDGE_RADIUS = maxRadius + TERRAIN_APRON`) and then falls
 * away — measured, on the gate's own axis: −0.13 m at z = 72, −1.35 at 74,
 * −14 at 80. It is a diorama on a hilltop. A road "just outside the park" would
 * mean fighting the boundary system for ground that does not exist.
 *
 * But more than that: **this has to be on screen before the park exists at
 * all.** The whole ride is the park's loading screen, so it cannot borrow
 * `Player`, `NpcSystem` or anything else `World` owns — none of them have been
 * built yet. Hence its own scene, its own lights, its own bus and its own
 * passengers, depending on nothing heavier than the art modules.
 *
 * ## The passengers are copies, and that is fine — once
 *
 * The eleven children who ride here are **not** the park NPCs who get off at
 * the gate; they cannot be, because the crowd does not exist yet. They are
 * one-off `createKid()` models, like the driver.
 *
 * That is a second definition of "who is on the bus", which this repo has been
 * bitten by repeatedly — so it is worth being explicit about why it is safe
 * here and would not be anywhere else. The two sets are only ever compared
 * across **a single cut**, seen through translucent glass, at a distance, in
 * one frame. Nothing is ever on screen twice. The player's own look *is*
 * carried across, because that is the one a child would notice: it comes from
 * the same `CharacterCreationChoice` she chose sixty seconds ago.
 */

/** How long the ride lasts. Jim asked for "about 20s". */
export const JOURNEY_SECONDS = 20;

/** How fast the bus travels, in metres a second. A bus, not a rocket. */
const BUS_SPEED = 11;

/**
 * **The drive is its own world, and it repeats exactly every this many metres.**
 *
 * Jim, 9 August 2026: *"The drive should be its own infinitely repeating world
 * and a small jump cut takes it adjacent to the park when loaded."* On a slow
 * device the park build outlasts the twenty-second ride; rather than park the
 * bus at the gate and idle (a *stopped* bus reads as waiting), the lane loops
 * for ever and the park arrives via a deliberate cut once it is ready.
 *
 * **The loop is designed in, not faked.** {@link laneHeight} and the ground's
 * cross-slope are sums of sines whose wavelengths are exact harmonics of this
 * length (5, 2 and 1 waves per loop), so the height at `z` and at `z ± LANE_LOOP`
 * is *identically* equal — the repeat is byte-exact and therefore seamless. This
 * is the whole difference from a treadmill that scrolls a non-periodic world (a
 * visible seam) or re-places props every frame (the two-owners bug this repo
 * pays for most): a world built to loop has no seam by construction. The scatter
 * (verge trees, hedges) is tiled at the same period, and the countryside mesh is
 * shifted to follow the bus by whole multiples of this, which moves identical
 * geometry onto identical geometry and so is invisible.
 *
 * **A whole number of road tiles.** The countryside is shifted by whole loops to
 * follow the bus, and the road's dashes and slabs repeat every
 * {@link ROAD_TILE_METRES} along `v` ({@link applyRoadUvs}). If the loop were not
 * an exact multiple of that tile the shift would jump the road markings even
 * though the hills stayed put, so the loop is defined *as* 46 road tiles —
 * ≈358 m, a little over eleven seconds of driving, longer than the ~7 s the three
 * incommensurable sines used to take to stop repeating. A normal ride never
 * completes a loop; even a slow overrun sees the same country at most once or
 * twice.
 */
const ROAD_TILES_PER_LOOP = 46;
export const LANE_LOOP = ROAD_TILE_METRES * ROAD_TILES_PER_LOOP;

/** Base angular frequency of the loop — one full wave over {@link LANE_LOOP}. */
const LOOP_W = (2 * Math.PI) / LANE_LOOP;

/**
 * How much countryside is built, in metres: three whole loops.
 *
 * The mesh is translated by whole loops to stay centred on the bus (see
 * {@link BusJourney.update}), so it only ever has to cover the fog's reach either
 * side of the bus plus the half-loop of slack the whole-loop snapping leaves.
 * `Fog` fades out by 235 m, and the bus sits within ±½ loop of the tile centre,
 * so three loops (±540 m of tile against ±415 m ever needed) keep the far edge
 * comfortably inside the fog, whichever way the camera looks.
 */
const TILE_LENGTH = LANE_LOOP * 3;

/** Half-width of the grass verge the ground mesh covers either side. */
const GROUND_HALF_WIDTH = 90;

/**
 * How far apart the two points are that the bus's pitch is taken from.
 *
 * A long vehicle bridges a dip rather than folding into it, so the bus lies
 * along the chord between the road under its front axle and the road under its
 * back one. Derived from the bus's own length — a wheelbase is most of it —
 * rather than the 14 m that used to be written here twice, so a bus that is
 * resized still bridges its own length.
 */
const BUS_PITCH_SPAN = CAT_BUS_LENGTH * 0.78;

/**
 * **How far short of the park's gate the bus stops.**
 *
 * Far enough that the arch is whole in the frame and the wall reads as a wall
 * rather than filling the screen; close enough that it is plainly *there*. At
 * {@link BUS_SPEED} this is the last two and a half seconds of the ride, which
 * is the stretch where a child works out where she is going.
 */
const PARK_STANDOFF = 30;

/**
 * How high a child bounces in her seat, at most, in metres.
 *
 * A ceiling on the excitement rather than the excitement itself: each rider gets
 * this or whatever fits over her head, whichever is less. See `riderBounce`.
 */
const RIDER_BOUNCE = 0.13;

/**
 * Air kept between the top of a bouncing child and the header band.
 *
 * Small — this is a clearance, not a design gap — but not zero: a child whose
 * hair grazes the ceiling on the peak of every bounce is the same defect as one
 * through the floor, seen from the other end.
 */
const RIDER_BOUNCE_MARGIN = 0.04;

/**
 * Where the ride's closing shot leaves the bus, in metres down the lane.
 *
 * The arrival (after the jump-cut) drives the bus to exactly here — the same
 * place, moving at the same speed, that an on-time ride has always handed over
 * from. Exported for the lane probe.
 */
export const RIDE_END_Z = -JOURNEY_SECONDS * BUS_SPEED;

/**
 * Where the park's gate stands, down the lane. Derived from where the ride ends.
 *
 * The gate lives in its own group ({@link BusJourney}'s `parkAhead`), hidden for
 * the whole of the looping drive and shown by the jump-cut, so it never repeats
 * with the countryside. Exported so a check can measure the arrival against it.
 */
export const JOURNEY_GATE_Z = -JOURNEY_SECONDS * BUS_SPEED - PARK_STANDOFF;
const PARK_AHEAD_Z = JOURNEY_GATE_Z;


/**
 * **How far out the park-behind-the-wall silhouettes have to start.**
 *
 * Jim, playing the deployed game, 9 August 2026: *"the cat bus never reached
 * its destination due to there being a cone shaped object in the middle of the
 * road."*
 *
 * He was right about the cone and right about where it was. `buildParkAhead`
 * scattered its rooftops over `x = (rng() - 0.5) * 120` and its trees over
 * `* 130`, with nothing excluding the carriageway — and `journey-road` runs
 * from `z = 120` all the way to `z = -320`, seventy metres **past** the gate,
 * so the scatter's whole range sat on top of the road it was scattered around.
 * Measured off the built scene, a six-metre `ConeGeometry` rooftop stood at
 * `x = -1.46, z = -258.7`, spanning `x = -6.3 .. 3.4` against a 7.78 m
 * carriageway: it filled the arch. Four more intruded by 6.9 m or worse. The
 * scatter's seed is a literal (`20260808`), so this was **identical on every
 * park seed, in dev and in production** — which is why nobody ever saw it vary
 * and why no seed sweep could have found it.
 *
 * Nothing collided: the bus's `z` is arithmetic off the ride clock, so a cone
 * could not stop it and did not. The ride simply ends {@link PARK_STANDOFF}
 * short of the gate, which put the cone squarely between the stopped bus and
 * the arch — and a bus that halts short of a park with a cone in the road ahead
 * of it has exactly one reading available to a player.
 *
 * **The number is the wall's own.** `buildParkAhead` already lays its masonry
 * from `GATE_HALF_WIDTH + 1.2` outward; the things standing behind that wall
 * now start at the same place, so they line up with it instead of floating in
 * the gateway. Taking the gate's number rather than the road's is deliberate:
 * it is the wider of the two (4.3 against `ROAD_HALF_WIDTH`'s 3.89), so the
 * guard in `test/procgen/invariants.ts` — which measures against the *road*,
 * the game's own number, never this one — keeps real headroom rather than
 * sitting exactly on the line it is checking.
 */
const PARK_AHEAD_CLEAR = GATE_HALF_WIDTH + 1.2;

/**
 * **The lane's two scatters draw from the park's seed, not from a literal.**
 *
 * This is the part of the cone bug worth remembering after the cone itself is
 * forgotten. Both scatters down here used to be seeded from a hard-coded number
 * — `createRandom(20260808)` behind the wall, `createRandom(19470116)` along
 * the verges — sitting inside a park that is otherwise generated end to end
 * from {@link PARK_SEED}.
 *
 * A fixed seed in a procedural world is a **hazard, not a simplification**, and
 * it is the reason the cone survived to production. Every guard this project
 * has runs across five seeds precisely so that one unlucky arrangement cannot
 * hide; a literal seed opts its scatter out of that sweep entirely and quietly
 * turns five samples back into one. The lane was byte-identical on every seed,
 * in dev and in production, so there was no arrangement for a sweep to *find* —
 * the six-metre rooftop stood in the same place in the road for everybody.
 *
 * Xor'd with the park's seed rather than used raw, and one salt per scatter,
 * which is the convention `world/Scenery.ts`'s `TREE_SALT`/`BUSH_SALT` already
 * follow: the two populations stay independent of each other, and both now vary
 * with the park. The five CI seeds therefore measure five genuinely different
 * lanes, which is what makes `nothing stands in the journey lane carriageway`
 * worth its runtime.
 *
 * This costs nothing at load: `PARK_SEED` is a module constant resolved when
 * the bundle is first imported (a literal, or `LGP_SEED` in Node), never a
 * value chosen part-way through a run — so reading it from a scene built
 * *before* the park exists is safe, which is exactly what the lane is.
 */
const LANE_SCATTER_SEED = 0x1a5e01 ^ PARK_SEED;
/** @see LANE_SCATTER_SEED — one salt per scatter, so the two never interlock. */
const PARK_AHEAD_SEED = 0x9a12ee ^ PARK_SEED;

/**
 * How many trees line the lane, and how many stand behind the park's wall.
 *
 * **The verge count came down when the trees became real ones**, and the reason
 * is parts, not trees: the old lookalike was a trunk plus exactly one ball,
 * where a `treeModel.ts` tree is a trunk plus one to four canopy pieces on a
 * rounder `IcosahedronGeometry(1, 2)`. Measured on the built lane, 400 trees
 * produce **1218 instances** across three meshes — so the verges are *busier*
 * than the 920 the old 460 drew, not thinner. Density on screen is what was
 * worth preserving here; the tree count never was.
 *
 * Measured off both built lanes, this **doubles** the lane: 233 536 triangles
 * against 116 260. Worth writing down rather than waving at, and affordable for
 * a reason that is also measured rather than assumed — the park this sequence
 * is a loading screen for draws **3 670 100** triangles across 4223 nodes, so
 * the entire lane is 6% of the scene that replaces it twenty seconds later, and
 * it is still three instanced draw calls' worth of trees. What is expensive
 * about this sequence has always been generating that park on the CPU beside
 * it, never drawing the lane.
 *
 * Behind the wall the count went **up**, from 54 trees (beside 54 rooftops) to
 * 76, because the rooftops that used to fill half that silhouette are gone and
 * a treeline with gaps in it reads as a field with some trees in it.
 */
const LANE_TREES_PER_LOOP = 260;
/** @see LANE_TREES_PER_LOOP */
const PARK_AHEAD_TREES = 76;
/** Kerbside hedge blobs per loop, marched evenly and tiled with the trees. */
const HEDGE_PER_LOOP = 300;

/**
 * How many whole waves of each hill fit in one {@link LANE_LOOP}.
 *
 * The three were sines of *incommensurable* wavelength (0.0755, 0.0412, 0.0169
 * rad/m ≈ 83, 153, 372 m) so the ride never repeated within its own length. That
 * property is exactly wrong for a world that has to loop: a non-periodic sum has
 * no repeat to hide, so scrolling it always seams. So the wavelengths are now
 * **exact harmonics** of the loop — 5, 2 and 1 whole waves in 360 m (≈ 72, 180,
 * 360 m), close to the old three — and because `gcd(5, 2, 1) = 1` the sum's true
 * period is the whole {@link LANE_LOOP}, not a fraction of it. `laneHeight(z)`
 * and `laneHeight(z ± LANE_LOOP)` are then identically equal, which is what lets
 * the countryside be shifted by whole loops with no seam.
 */
const HILL_WAVES_SHORT = 5;
const HILL_WAVES_MID = 2;
const HILL_WAVES_LONG = 1;

/**
 * The hills, as a function of distance down the lane — **periodic** in
 * {@link LANE_LOOP}.
 *
 * A short ripple, a mid roll and a long swell, so the bus is never level for
 * long. Amplitudes are unchanged from the old incommensurable version, so the
 * feel and — the number that matters — {@link LANE_MAX_GRADIENT} are the same; only
 * the wavelengths were nudged onto loop harmonics (see {@link HILL_WAVES_SHORT}).
 * This is a lane over rolling country, not a rollercoaster, and the camera is
 * orbiting, so vertical motion that reads as gentle from one bearing reads as
 * lurching from another.
 */
export function laneHeight(z: number): number {
  return (
    Math.sin(z * LOOP_W * HILL_WAVES_SHORT) * 1.25 +
    Math.sin(z * LOOP_W * HILL_WAVES_MID + 1.7) * 2.0 +
    Math.sin(z * LOOP_W * HILL_WAVES_LONG + 0.4) * 2.8
  );
}

/**
 * The steepest the lane ever gets, as a gradient — `sum of amplitude x
 * frequency`, which is the worst case of the derivative of the sum above.
 *
 * Exported because it is the number that decides whether this reads as a
 * country lane or a rollercoaster, and it is not obvious from the amplitudes:
 * shortening a wavelength makes a hill steeper without making it taller. The
 * first tuning kept sensible-looking amplitudes (3.1 / 4.4 / 3.2) and shortened
 * the wavelengths to make the hills visible, which took the worst gradient to
 * **27 degrees** — the captured frames show a bus diving nose-first down what
 * is plainly a ski slope. A real road tops out around 6.
 */
export const LANE_MAX_GRADIENT =
  1.25 * LOOP_W * HILL_WAVES_SHORT +
  2.0 * LOOP_W * HILL_WAVES_MID +
  2.8 * LOOP_W * HILL_WAVES_LONG;

/**
 * Cross-slope, so the verges fall away and the lane sits in the land.
 *
 * **Periodic in `z` as well, so the whole ground loops.** The one `z` term that
 * is not {@link laneHeight} — the verge roll — used `z * 0.019`, a wavelength of
 * 331 m that is not a loop harmonic, so away from the tarmac the land would not
 * repeat and the shift would seam there even though the road itself was clean.
 * It is now `z * LOOP_W` (one wave per loop, ≈ the old 0.019), so `groundHeight`
 * is periodic everywhere it is sampled.
 */
function groundHeight(x: number, z: number): number {
  const across = Math.abs(x) - ROAD_HALF_WIDTH;
  if (across <= 0) return laneHeight(z);
  // Away from the tarmac the land rolls in its own right, and drops off at the
  // far edge so the mesh never ends in a visible cliff against the sky.
  const roll = Math.sin(x * 0.043 + z * LOOP_W) * 1.9 + Math.sin(x * 0.017) * 2.4;
  const fade = smoothstep(GROUND_HALF_WIDTH * 0.55, GROUND_HALF_WIDTH, Math.abs(x));
  return laneHeight(z) + roll * clamp01(across / 22) - fade * 26;
}

/**
 * How the camera swings round the bus.
 *
 * **The orbit is the shot** — its rate carries the whole twenty seconds, and
 * the brief says so. Slow enough that nothing swims (a six-year-old watching a
 * screen a foot from her face is the constraint, not a monitor at arm's
 * length), fast enough that it never reads as a static three-quarter view: a
 * little over one full turn across the ride.
 *
 * It **ends where the park's own camera begins**. `CAMERA_YAW_DEGREES` and
 * `CAMERA_PITCH_DEGREES` are the isometric rig's, taken from `core/constants`
 * rather than restated, and the last three seconds ease the orbit onto exactly
 * that bearing and elevation. So the cut into the park is a cut between two
 * frames of the same bus, the same size, at the same angle, moving the same way
 * — which is what makes an arrival out of what would otherwise be a jump.
 */
/**
 * How long the closing shot spends easing onto the park camera's bearing.
 *
 * Exported so `check:bus-journey` can assert the **shot list's** last beat is
 * at least this long: a cut to the inside during the settle would throw away
 * the 0.00-degree hand-over the arrival depends on. One owner, asked by the
 * check rather than restated in it.
 */
export const SETTLE_SECONDS = 3.2;

/**
 * **The earliest the drive may cut to the park, in seconds.**
 *
 * The loop runs until *both* the park is ready *and* this much ride has been
 * seen — so a fast device still gets the whole cinematic rather than being
 * jump-cut at eight seconds. It is `JOURNEY_SECONDS − SETTLE_SECONDS` on purpose:
 * the jump-cut is followed by the closing settle ({@link SETTLE_SECONDS}), so on a
 * fast device the cut lands at 16.8 s and the hand-over at exactly 20 s — the same
 * length, and the same 0.00-degree closing shot, the ride has always had. On a
 * slow device the loop simply runs longer before the same cut and settle play.
 *
 * The director owns this decision ({@link JourneyDirector.readyToArrive}); it is
 * exported so the check can assert the cut cannot happen before it.
 */
export const MIN_LOOP_SECONDS = JOURNEY_SECONDS - SETTLE_SECONDS;

const ORBIT = {
  /** Turns completed over the ride, before the settle. */
  turns: 1.15,
  /** Where the swing starts, so the cat's face leads the first shot. */
  startYawDegrees: CAMERA_YAW_DEGREES + 150,
  /** Seconds at the end spent easing onto the park camera's own bearing. */
  settleSeconds: SETTLE_SECONDS,
} as const;

/**
 * How far back the camera sits, and how high.
 *
 * Framed on the **whole bus**, which is the fault this had to fix: Stage A's
 * opening put an 18 m vehicle in a frame that cropped the cat's face off the
 * top-left. The distance is derived from the bus's own length rather than
 * chosen, so a bus that grows is still fully in shot.
 */
const CAMERA_BACK = 26;
const CAMERA_LIFT = 11;
const CAMERA_FOV = 42;

/**
 * A **wider** lens for the view from inside — and the swap from narrow to wide
 * is the same correction as turning the camera round.
 *
 * This was 33 degrees, and the reasoning was sound for the shot it was serving:
 * with the lens beside the front row, two heads 0.53 m either side filled the
 * frame edges, and the only way to crop them out was to narrow the lens.
 *
 * From the back seat looking forward there is nothing beside the lens to crop —
 * the whole busload is *in front of* it — so the narrow lens stopped buying
 * anything and started costing. What a bus interior is made of is a **long**
 * shape: an aisle running away, seat backs down both sides, the window band and
 * the ceiling over them. A 33-degree lens sees a keyhole of that and none of its
 * edges, which is a large part of why the shot had no seat, window, pillar or
 * ceiling in it. This is wide enough to hold all four.
 */
const INSIDE_FOV = 52;

/**
 * How far beyond the end row the pan begins, in seat rows.
 *
 * Just over a third of a row clear of the endmost cushion: far enough that the
 * first row is in front of the lens rather than either side of it, and not so
 * far that the lens is in the bulkhead.
 */
const INSIDE_CAMERA_ROWS_BACK = 0.35;

/**
 * **How far off the aisle the inside camera looks, in degrees.**
 *
 * Jim, 8 August 2026, settling the inside shot for good: *"In all modes, not
 * just portrait, make the camera pan down the aisle of the bus, at 45º so that
 * it is moving along the row of seats with children on them."*
 *
 * Square down the aisle — which is what it did — a tall frame has nothing to
 * find but the floor below and the roof above, because along its length the
 * cabin is 2.7 m tall and 11 m long. Turned across the rows it is 2.7 m tall
 * and 2.6 m wide, and the frame lands on cushion, seat back, child and header
 * band the whole way up. Measured independently before Jim's note arrived: the
 * best static angle available was **35.8 degrees**, which is his 45 to within a
 * few degrees of the same answer.
 */
const INSIDE_PAN_DEGREES = 45;

/**
 * **How far the lens looks *down*, in degrees.**
 *
 * The lens rides on the seat-back line, and that line is also the window sill —
 * `catBus.ts` builds the backrest to exactly `CAT_BUS_SEAT_Y +
 * KID_SHOULDER_HEIGHT`, which is where the glazing starts. So a perfectly level
 * lens splits the frame on the one horizontal edge that runs the whole length
 * of the cabin, and everything above it is header band and roof.
 *
 * Measured, over the whole pan, on the phone — the frame where it costs most:
 *
 * | depression | roof in frame | barest third | pillar |
 * |---|---|---|---|
 * | 0 deg | 17% | **47%** (top) | 5% |
 * | **5 deg** | **10%** | **28%** (top) | 4% |
 * | 8 deg | 5% | 25% (bottom) | 3% |
 *
 * Five degrees buys most of the roof back and costs almost no pillar; eight
 * starts putting the floor pan back into the bottom third and loses a pillar
 * for it. **This is a tilt *down*, and it is the opposite of the change that
 * was tried and reverted on 8 August** — that one tilted the aim *up* while
 * looking along the aisle and turned 33% of floor into 37% of ceiling. Across
 * the rows there is bus in both directions, so a few degrees down lands on
 * cushions and seat bases rather than on a blank pan.
 */
const INSIDE_PAN_DEPRESSION_DEGREES = 5;

/**
 * **How far the lens hugs the near side of the aisle**, away from the flank it
 * is looking at, in metres.
 *
 * A chibi child's head is most of a metre across, and at 45 degrees a lens on
 * the centre line crosses the far seat column 1.84 m away — so one head can be
 * a third of a wide frame and most of a narrow one. On a phone, whose
 * *horizontal* field is only 45 degrees however far `fitCameraToViewport` opens
 * the vertical one, that is a head cropped by the frame edges with nothing else
 * in shot: the same "you cannot tell it is a bus" fault QA rejected, wearing a
 * different surface.
 *
 * Sliding the lens to the *other* side of the gangway is the only distance
 * available in a cabin this wide. It is worth 0.35 m — a fifth further — and
 * measured over the whole pan it takes the largest single surface from **44% to
 * 31%** of the frame. Seen by eye the difference is not subtle: the opening
 * frame goes from one amorphous tan mass to a row of four faces receding down
 * the bus, which is the shot Jim asked for.
 *
 * `AISLE_WIDTH` is 0.8, so this is three quarters of the way to the seat edge —
 * as far as it can go while leaving the lens in the gangway rather than in
 * somebody's lap. `check:bus-journey` holds the other end of that: nothing may
 * come within 0.3 m of the lens, and it measures 0.76 m.
 */
const AISLE_HUG = 0.3;

const DEG = Math.PI / 180;

/**
 * What the ride needs to know about the girl riding it.
 *
 * Her own look, straight from the character creator she has just closed. The
 * other eleven are dressed from the park crowd's own lists
 * (`art/models/kidLooks.ts`) rather than a palette invented here, so the
 * children in the windows are drawn from the same population as the children
 * who will be in the park.
 */
export interface JourneyRider {
  readonly skin: number;
  readonly hair: number;
  readonly outfit: number;
  readonly hairStyle: HairStyle;
}

/** One passenger, dressed out of the park crowd's own lists. */
function rollLook(rng: () => number): JourneyRider {
  const pick = <T,>(list: readonly T[], fallback: T): T =>
    list[Math.floor(rng() * list.length)] ?? fallback;
  return {
    skin: pick(KID_SKIN_TONES, { colour: PALETTE.skin, label: 'Fair' }).colour,
    hair: pick(HAIR_COLOURS, PALETTE.hair),
    outfit: pick(OUTFIT_COLOURS, PALETTE.outfit),
    hairStyle: pick(CROWD_HAIR_STYLES, 'bunches'),
  };
}

/**
 * Where the ride is watched from.
 *
 * Jim, 7 August 2026: *"we would like to be able to see inside the bus, switch
 * between the view inside of the children riding it and looking excited and the
 * outside."*
 */
export type JourneyView = 'outside' | 'inside';

/**
 * **How the ride is cut**, as a shot list.
 *
 * Jim, correcting a first reading of *"switch between"* as a player control:
 * *"the view shouldn't be switchable, it should switch by itself."* So this is
 * direction. There is no button; the ride cuts between the two on its own
 * schedule, the way an on-ride video cuts between a trackside camera and a cart
 * cam.
 *
 * Modelled on `world/slide/cameras.ts`, which does the same job for the
 * ginormous slide and is the pattern this repo already has for "a ride that
 * cuts between cameras on its own": plan a list of shots over the ride's own
 * parameter, and have something *pure* answer which shot is playing, so a check
 * can hold the schedule without a renderer.
 *
 * ## The rhythm
 *
 * Five equal beats over twenty seconds — a cut every four seconds, four cuts in
 * all. Fewer and the inside shot is a single event you might blink through;
 * many more and a twenty-second ride becomes a trailer. Four seconds is also
 * long enough for the orbit to move visibly between cuts, which is what stops
 * the two outside shots reading as the same frame twice.
 *
 * **Odd, so the ride opens and closes outside** — the same trick the slide uses
 * with an even `BEATS`, for two reasons here:
 *
 * - It **opens** on the bus, the establishing shot: a child has to see what she
 *   is riding in before being put inside it.
 * - It **closes** outside, which is a requirement rather than a preference. The
 *   last {@link SETTLE_SECONDS} ease the camera onto the park's own bearing so
 *   the hand-over to the arrival is a cut between two frames of the same bus at
 *   the same angle — measured at 0.00 degrees off. A cut to the inside during
 *   the settle would throw that away. `check:bus-journey` asserts the closing
 *   beat is at least that long, so neither number can move without the other
 *   being reconsidered.
 *
 * ## Hard cuts, not blends
 *
 * A blend between a camera inside a vehicle and one outside it is a shot of the
 * lens travelling through the bodywork — here, through a giant cat's face. It
 * would read as a rendering fault rather than a transition. The slide hard-cuts
 * between its chase and trackside cameras and it reads well.
 */
export const JOURNEY_BEATS = 5;

/** How long one shot lasts. */
export const JOURNEY_BEAT_SECONDS = JOURNEY_SECONDS / JOURNEY_BEATS;

export interface JourneyShot {
  readonly view: JourneyView;
  /** When this shot starts, in seconds. Inclusive. */
  readonly from: number;
  /** When it ends. Exclusive, except the last shot, which owns the end. */
  readonly to: number;
}

/**
 * The whole shot list, in order. Pure and exported so a check can assert the
 * schedule — that it opens and closes outside, that both views get real time,
 * and that the beats tile the ride with no gap — without building a bus.
 */
export function planJourneyShots(): JourneyShot[] {
  const shots: JourneyShot[] = [];
  for (let beat = 0; beat < JOURNEY_BEATS; beat += 1) {
    shots.push({
      // Even beats outside. With an odd `JOURNEY_BEATS` that opens and closes
      // outside, which is what the settle needs.
      view: beat % 2 === 0 ? 'outside' : 'inside',
      from: beat * JOURNEY_BEAT_SECONDS,
      to: (beat + 1) * JOURNEY_BEAT_SECONDS,
    });
  }
  return shots;
}

const JOURNEY_SHOTS = planJourneyShots();

/**
 * **How long the ride spends inside the bus, over the whole journey.**
 *
 * The pan down the aisle is paced by this, so it covers the cabin exactly once
 * across the two interior beats however the shot list is re-cut. Summed off the
 * list itself rather than written as `2 * JOURNEY_BEAT_SECONDS`, which would be
 * a second opinion about how the ride is cut and would go quietly wrong the
 * first time {@link JOURNEY_BEATS} changed.
 */
export const INSIDE_SECONDS = JOURNEY_SHOTS.filter((shot) => shot.view === 'inside').reduce(
  (total, shot) => total + (shot.to - shot.from),
  0,
);

/** Which shot is playing at `t` seconds. The last one owns the end of the ride. */
export function shotAt(t: number): JourneyShot {
  for (const shot of JOURNEY_SHOTS) {
    if (t < shot.to) return shot;
  }
  return JOURNEY_SHOTS[JOURNEY_SHOTS.length - 1] as JourneyShot;
}

export class BusJourney {
  readonly scene = new Scene();
  readonly camera: PerspectiveCamera;

  private readonly bus: CatBusHandle;
  private readonly driver: BusDriver;
  private readonly riders: KidHandle[] = [];
  /**
   * How far each rider may bounce, **measured against the ceiling over her own
   * head** rather than shared.
   *
   * The bounce was a flat 0.13 m for everybody, and once the children were
   * actually sat *on* the cushions rather than sunk through the floor that put
   * the tallest of them 0.016 m up inside the header band at the top of her
   * bob — measured, one seat in twelve, on the canonical look. A spiky-haired
   * child is 0.22 m taller than a bunched one, so a single amplitude is either
   * wrong for her or wasted on everybody else.
   *
   * Same seat, same cushion, same pose; only the hair differs, so the room left
   * over differs. Each child is measured after she is posed and gets what is
   * actually above her.
   */
  private readonly riderBounce: number[] = [];
  /**
   * The looping countryside — ground, road, verge trees and hedges.
   *
   * Periodic in {@link LANE_LOOP} and shifted by whole loops each frame to follow
   * the bus, which is what makes the drive an *infinitely repeating world* with no
   * seam (see {@link update}).
   */
  private readonly lane = new Group();
  /**
   * The park at the end of the road — gate, wall, and the woodland behind it.
   *
   * Its **own** group, at the fixed gate z, that the loop's shift never touches:
   * a destination does not repeat with the scenery. Hidden for the whole of the
   * looping drive and revealed by the jump-cut ({@link update}). Kept in the scene
   * graph while hidden so the lane facts (`parkFacts`) still measure it.
   */
  private readonly parkAhead = new Group();

  /**
   * **How far the bus has driven, in seconds — a clock that never stops.**
   *
   * The loop runs on this: `busZ = -elapsedSeconds * BUS_SPEED`, the orbit spins
   * on it, and the shot list cuts on it. It is no longer clamped at
   * {@link JOURNEY_SECONDS} — the drive is a loop, so the bus keeps going until the
   * jump-cut, and freezing this is exactly the stopped-bus wait this change exists
   * to remove.
   */
  private elapsedSeconds = 0;
  /**
   * **A clock that never stops** — the one everything drawn reads.
   *
   * Once identical in spirit to {@link elapsedSeconds}; kept separate because the
   * two diverge during the arrival, where the lane clock is held at the closing
   * shot's start while the children keep bouncing and the wheels keep turning on
   * this one.
   */
  private animationSeconds = 0;
  /**
   * **The drive has cut to the park and is playing its closing approach.**
   *
   * False for the whole looping drive; set once, by the jump-cut, when the
   * director says the park is ready and the minimum ride has been seen. While it
   * is true the bus drives the closing stretch to {@link RIDE_END_Z} and the
   * camera eases onto the park's 0.00° bearing — the arrival exactly as an on-time
   * ride has always played it.
   */
  private arriving = false;
  /** Seconds since the jump-cut; drives the closing settle, 0 → {@link SETTLE_SECONDS}. */
  private arrivalSeconds = 0;
  private busZ = 0;

  private viewMode: JourneyView = 'outside';
  /** The lens this shot asks for, before the window's shape is taken into account. */
  private baseFov = CAMERA_FOV;
  /** The last base lens `render` fitted, so a cut re-fits and a still frame does not. */
  private fittedFov = -1;
  /**
   * The inside camera's eye and aim, **in the bus's own local space**.
   *
   * Computed once, off the seats that were actually built, and then carried
   * into world space through the bus's own matrix every frame. That is the
   * whole reason they are stored local: the bus climbs, dips and pitches, and a
   * camera inside it has to do all three exactly with it. A world-space pose
   * recomputed from a formula each frame is a second definition of where the
   * bus is, and this repo has paid for that shape repeatedly — most recently
   * with a face patch that had to track a surface it had left.
   */
  private readonly insideEye = new Vector3();
  private readonly insideAim = new Vector3();
  private readonly worldEye = new Vector3();
  private readonly worldAim = new Vector3();
  /** Where the pan down the aisle starts and ends, in the bus's own z. */
  private panFromZ = 0;
  private panToZ = 0;
  /** The lens's height, and how far ahead of it the aim lands. */
  private panEyeHeight = 0;
  private panReach = 1;
  /**
   * **Seconds spent inside the bus so far**, which is what the pan runs on.
   *
   * Not the ride's clock: the interior is two four-second beats with four
   * seconds of exterior between them, and a pan on the ride's clock would spend
   * that gap travelling where nobody can see it and arrive at the second beat
   * having skipped a third of the bus. On this clock the two beats are one
   * continuous eight-second journey from the back seat to the front, cut in
   * half — the second beat picks up exactly where the first was interrupted.
   */
  private insideSeconds = 0;

  constructor(rider: JourneyRider) {
    this.scene.name = 'cat-bus-journey';
    // The same linear fog the park uses, pulled in tight: the lane has to end
    // somewhere, and it should end in haze rather than in a visible edge.
    this.scene.fog = new Fog(PALETTE.skyDayBottom, 60, 235);

    // `near` at 0.2 rather than 0.5 because this camera also goes *inside* the
    // bus, where 0.5 m clips away the nearest row of children entirely.
    this.camera = new PerspectiveCamera(CAMERA_FOV, 1, 0.2, 900);

    // --- lighting -----------------------------------------------------------
    // `DayNight`'s own daytime rig, at its daytime values. Not shared with it:
    // `DayNight` needs a `Scene` and a `Sky` and drives a clock, none of which
    // exist yet, and a twenty-second ride does not have a time of day.
    const key = new DirectionalLight(PALETTE.sunDay, 2.2);
    key.position.set(-40, 70, 30);
    this.scene.add(key, key.target);
    const fill = new DirectionalLight(PALETTE.skyDayBottom, 0.5);
    fill.position.set(30, 20, -40);
    this.scene.add(fill);
    this.scene.add(new HemisphereLight(PALETTE.ambientDay, PALETTE.grass, 1.1));

    this.scene.add(this.lane);
    // The park is its own group, hidden until the jump-cut reveals it. Added to
    // the scene (not the lane) so the loop's shift never moves it, and left in the
    // graph while hidden so `parkFacts` still measures the gate and its woodland.
    this.parkAhead.visible = false;
    this.scene.add(this.parkAhead);
    this.buildGround();
    this.buildScenery();
    this.buildParkAhead();

    // --- the bus ------------------------------------------------------------
    this.bus = createCatBus();
    this.bus.setDoorOpen(0);
    // Nose-first down the lane. **No `rotation.y` here**: `place()` owns the
    // whole orientation, yaw and pitch together, by aiming the bus at the road
    // ahead of it. A separate yaw set once in a constructor is what let the
    // pitch be applied about the wrong axis and go unnoticed — see `place`.
    this.scene.add(this.bus.root);

    this.driver = createBusDriver();
    this.bus.driverSeat.add(this.driver.root);

    this.seatRiders(rider);
    // `place` first: `aimTheInsideCamera` converts the seated children's heads
    // out of world space through the bus's own matrix, so the bus has to be
    // somewhere before it can be asked where its passengers' faces are.
    this.place(0);
    this.bus.root.updateMatrixWorld(true);
    this.aimTheInsideCamera();
  }

  /**
   * Where the inside camera sits, **measured off the seats that were built**.
   *
   * ## It faces the front now, and it sits down among the seats
   *
   * QA, 8 August 2026, refusing to sign the shot off: *"the bottom 35–40% is
   * featureless cream floor, the two near heads are cropped by the frame edges,
   * and there is no seat, window, pillar or ceiling in shot — you cannot tell it
   * is a bus."* Jim agreed, and pointed at the fix QA had found by trying it:
   * *"the interior camera aims at the rear. **Aim it forward.**"*
   *
   * Two things were wrong, and the second is the one that mattered.
   *
   * **It was aimed backwards.** The seats face the nose; their backs are behind
   * their cushions. A lens at the front looking aft therefore sees the one thing
   * a bus interior has none of — the *fronts* of twelve seats, which is to say
   * nothing but children. Turned round, the same cabin is rows of seat backs
   * running away to the driver, which is what the inside of a coach looks like
   * from the back seat, and what a six-year-old has actually sat in.
   *
   * **And it was above the shoulder line, where there is no bus.** Everything
   * below {@link WINDOW_SILL_Y} — seats, cushions, floor pan, twelve bodies — is
   * *inside* the solid `cat-bus-shell-lower` block. Above it there is only the
   * flat top of that block, which is exactly the "featureless cream floor" in
   * QA's note: not a floor at all, but the lid of a box, with heads sticking out
   * of it. No shot from up there can contain a seat, because no seat reaches it:
   * the backs stop dead level with the sill.
   *
   * So the lens goes **down into the cabin proper**, and `catBus.ts`'s
   * `setCutaway` drops the one shell that would otherwise be all it could see.
   *
   * ## Everything here is measured, not chosen
   *
   * Asking `bus.seats` rather than restating `catBus.ts`'s seat plan matters
   * here more than usual: that plan has already been re-derived once, when a
   * child turned out to be 1.53 m across rather than the 0.6 m somebody had
   * imagined, and every number that had been copied out of it was wrong
   * afterwards.
   */
  private aimTheInsideCamera(): void {
    const seats = this.bus.seats;
    let front = -Infinity;
    let back = Infinity;
    let cushion = 0;
    /** How far off the centre line a seat column sits — measured, not restated. */
    let column = 0;
    for (const seat of seats) {
      front = Math.max(front, seat.position.z);
      back = Math.min(back, seat.position.z);
      cushion = seat.position.y;
      column = Math.max(column, Math.abs(seat.position.x));
    }

    // **Behind the back row, in the gangway.** `AISLE_WIDTH` is 0.8 m and a
    // seated child's shoulders start 0.53 m off the centre line, so `x = 0` is
    // the one column of clear air running the length of this bus — that much is
    // unchanged, and it is still the only place a lens can go.
    //
    // Half a row behind the rearmost cushion puts the whole busload in front of
    // the lens rather than beside it, which is what stops the near pair being
    // cropped by the frame edges: there is no near pair any more, only a first
    // row. `SEAT_PITCH` comes off the built seats — the gap between the two
    // rearmost rows — so a bus with a different seat plan still sits its camera
    // one row back.
    const pitch = seats.length > 2 ? Math.abs(seats[2]!.position.z - seats[0]!.position.z) : 1.8;

    // **On the seat-back line**, which is the same line as the window sill:
    // `catBus.ts` builds the backrest from `CAT_BUS_SEAT_Y +
    // KID_SHOULDER_HEIGHT` and starts the glazing at the same height, so this
    // is one landmark rather than two. Taken off the cushion the children are
    // actually sitting on plus the game's own shoulder constant — the same two
    // numbers the seat back is built from — so a re-planned seat moves the lens
    // with it instead of leaving it hanging.
    //
    // The height matters because of what is either side of it: below, cushions,
    // seat backs and twelve bodies; above, the window band, the pillars and the
    // heads standing proud of the backs. A lens on the line gets both, and it is
    // the only height in the cabin that does.
    const eyeHeight = cushion + KID_SHOULDER_HEIGHT;

    // **The pan runs front to back, and the lens looks the way it is going.**
    //
    // This is the half of the shot that was wrong, and it was wrong in a way no
    // amount of tuning would have reached. The seats face the nose and each
    // child is turned 0.6 rad in towards the gangway, so **a lens looking
    // forward is behind every head on the bus**: measured over the whole pan,
    // aimed forward, the number of children whose face is actually turned
    // towards the lens bottoms out at **zero**. Aimed aft it never drops below
    // **two**, and averages three and a half. Jim asked for children who read as
    // excited; you cannot read excitement off the back of a head.
    //
    // Travelling aft as well as looking aft makes it a dolly rather than a
    // reversing shot: each row is approached, grows, and passes. The alternative
    // — travelling forward while looking back — shows the same faces receding,
    // which is the same information arriving in the less interesting order.
    //
    // Both ends come off the seat plan, so a bus with more rows pans further
    // without anybody adjusting a second number. The far end stops one column
    // short because at 45 degrees the sightline reaches the far seat column one
    // column-width along, so a lens that ran level with the last row would be
    // aiming at the bulkhead past it.
    this.panEyeHeight = eyeHeight;
    this.panFromZ = front + pitch * INSIDE_CAMERA_ROWS_BACK;
    this.panToZ = back + column;
    // Far enough along for the aim to land on the far seat column rather than
    // in the air short of it.
    this.panReach = column / Math.sin(INSIDE_PAN_DEGREES * DEG);
    this.insideEye.set(-AISLE_HUG, eyeHeight, this.panFromZ);
    this.placeTheInsideCamera();
  }

  /**
   * **Where the inside lens is now**, as it travels down the aisle.
   *
   * Bus-local, so the pose can be carried through the bus's own matrix and
   * climb, dip and pitch with it exactly.
   *
   * Linear in {@link insideSeconds}, with no ease at either end: the beats are
   * hard cuts, so an ease-in would only ever be seen as the shot arriving
   * already moving, and a steady travel is what makes seat after seat land at
   * the same rhythm. Over eight seconds it covers the cabin at roughly one
   * metre a second — a row every 1.7 s, which is slow enough to read a face and
   * fast enough that it is plainly a moving shot.
   */
  private placeTheInsideCamera(): void {
    const travelled = clamp01(this.insideSeconds / INSIDE_SECONDS);
    const z = lerp(this.panFromZ, this.panToZ, travelled);
    this.insideEye.set(-AISLE_HUG, this.panEyeHeight, z);
    // **45 degrees off the aisle**, towards the **far** side and towards the
    // back. That side because the door is cut into the other flank —
    // `catBus.ts` skips a pillar and a pane at the doorway — so this is the one
    // with an unbroken run of both, and it is the difference between a pillar
    // being in the frame and not: measured over the pan, aimed at this flank a
    // pillar is up to 4% of the picture, and aimed forward it is 0%.
    //
    // Down by {@link INSIDE_PAN_DEPRESSION_DEGREES}, so the horizon of the shot
    // is the row of seat backs rather than the header band above them.
    const drop = Math.sin(INSIDE_PAN_DEPRESSION_DEGREES * DEG) * this.panReach;
    const along = Math.cos(INSIDE_PAN_DEPRESSION_DEGREES * DEG) * this.panReach;
    this.insideAim.set(
      -AISLE_HUG + Math.sin(INSIDE_PAN_DEGREES * DEG) * along,
      this.panEyeHeight - drop,
      z - Math.cos(INSIDE_PAN_DEGREES * DEG) * along,
    );
  }

  /**
   * Puts the inside camera where it belongs and points it at {@link insideAim}.
   *
   * Through the bus's own matrix, so the camera climbs, dips and pitches with
   * it exactly — you feel the hills from inside, which is half of why being
   * able to sit in there is worth having.
   *
   * Its own method because **two** callers need it: `update` every frame, and
   * `render` again on the one frame a window changes shape, so the swing lands
   * on the frame that caused it rather than on the next one.
   */
  private pointTheInsideCamera(): void {
    this.bus.root.updateMatrixWorld(true);
    // **Through the chassis, not the root** (#364). The chassis is the sprung
    // body: it heaves, pitches and rolls on the suspension while the wheels
    // stay on the road. Pushed through `root` instead, this lens would sit
    // perfectly still inside a cabin that was visibly moving around it — which
    // reads as the seats bouncing rather than the bus, and is the "passengers
    // stay rigid" fault wearing a camera. `insideEye` and `insideAim` are
    // written in the vehicle's own space, and the chassis sits at the origin of
    // that space at rest, so nothing about them changes.
    const ride = this.bus.chassis.matrixWorld;
    this.worldEye.copy(this.insideEye).applyMatrix4(ride);
    this.worldAim.copy(this.insideAim).applyMatrix4(ride);
    this.camera.position.copy(this.worldEye);
    this.camera.lookAt(this.worldAim);
  }

  /**
   * Seconds of **driving** — how far down the looping lane the bus has come.
   *
   * No longer clamped: the drive is an infinite loop, so this keeps climbing
   * until the jump-cut. **Still not the clock for anything that must keep moving
   * on screen** — during the arrival it is held at the closing shot's start while
   * {@link animationTime} runs on. Feeding the title card this one is the whole of
   * the frozen-title fault QA found: see `ui/JourneyTitle.ts`.
   */
  get elapsed(): number {
    return this.elapsedSeconds;
  }

  /**
   * **The clock that never stops**, in seconds — the one for anything drawn.
   *
   * Jim, 8 August 2026, on the overrun: *"Anything that should keep moving
   * during the idle needs a clock that keeps running. Find every such thing."*
   * This is that clock, and it was already here driving the children and the
   * tail — which is exactly why those two were the only things QA measured
   * still moving. Exposed so everything else that must stay alive can read the
   * same one rather than grow a second.
   */
  get animationTime(): number {
    return this.animationSeconds;
  }

  /** True once the jump-cut has fired and the closing approach is playing. */
  get arrivingNow(): boolean {
    return this.arriving;
  }

  /** Seconds into the closing approach; 0 until the jump-cut. */
  get arrivalTime(): number {
    return this.arrivalSeconds;
  }

  /** Where the bus is down the lane, in metres. Negative is towards the park. */
  get busPositionZ(): number {
    return this.busZ;
  }

  /** Whether the ride is being watched from outside the bus or in it. */
  get view(): JourneyView {
    return this.viewMode;
  }

  /**
   * Cuts to a shot. Private: **the ride decides, not the player.**
   *
   * There was a "Look inside!" button here, built from a first reading of Jim's
   * *"switch between"*. He corrected it — *"the view shouldn't be switchable,
   * it should switch by itself"* — and the correction makes the feature both
   * simpler and better: a six-year-old watching her first twenty seconds of the
   * game should be shown the ride, not asked to operate it.
   */
  private cutTo(view: JourneyView): void {
    this.viewMode = view;
    // **The shot chooses a lens; `render` decides what that lens does in this
    // window.** Writing `camera.fov` here as well would be two owners of one
    // number, and the portrait rule would be silently undone on every cut.
    this.baseFov = view === 'inside' ? INSIDE_FOV : CAMERA_FOV;
    // **The cabin is only a cabin from inside a cutaway.** The lower body's
    // outline shell is a lightless `BackSide` box round every seat in the bus,
    // and it is the only part of that body a lens in there can see. Dropped for
    // the inside shot and put straight back for the outside one, where it is
    // what draws the bus's own dark edge. See `catBus.ts`'s `setCutaway`.
    this.bus.setCutaway(view === 'inside');
  }

  /** True once the closing approach has finished and the park may take over. */
  get finished(): boolean {
    return this.arriving && this.arrivalSeconds >= SETTLE_SECONDS;
  }

  /**
   * Eleven passengers plus her, in the bus's own seats.
   *
   * Seated by asking the bus where its seats are, exactly as `ArrivalSequence`
   * does — `catBus.ts` is the only thing that knows where a seat is, and a
   * second copy of that arithmetic is a second thing to keep in step.
   *
   * Parented **into** the seat rather than posed at its world position every
   * frame. The park has to do the latter because a crowd member's rig root is
   * where `NpcSystem` writes a world coordinate; these are one-off models that
   * belong to nobody else, so they can simply ride along for free.
   */
  private seatRiders(player: JourneyRider): void {
    const rng = createRandom(20260807);
    // Hers is the seat nearest the door, so she is the one you see best — and
    // so it is the same seat the arrival will put her in on the other side of
    // the cut.
    const seats = this.bus.seats;
    const playerSeat = this.bus.passengerSeat;

    for (let index = 0; index < CAT_BUS_SEAT_COUNT; index += 1) {
      const seat = seats[index];
      if (!seat) continue;
      const isPlayer = seat === playerSeat;
      const look: JourneyRider = isPlayer ? player : rollLook(rng);
      const kid = createKid({
        skin: look.skin,
        hair: look.hair,
        outfit: look.outfit,
        hairStyle: look.hairStyle,
        backpack: false,
      });
      kid.setExpression('happy');
      // **Turned in towards the gangway**, which is where the excitement is.
      //
      // A kid's painted face points along its own +Z (measured, not assumed),
      // so twelve children all facing the bus's nose sit in two lines with
      // their faces pointing *past* anyone in the aisle: from the inside camera
      // they are a corridor of profiles and the backs of heads. Turned inboard
      // they are children talking to each other on a bus, which is both what
      // happens on a bus and the only arrangement that puts faces where they
      // can be seen.
      //
      // Kept to 0.6 rad rather than a full quarter turn because they are also
      // looked at side-on **through the side windows from outside**, which is
      // the thing the previous round's glazing work existed to make possible.
      // At this angle they read as three-quarter faces from both places.
      const inboard = -Math.sign(seat.position.x || 1) * 0.6;
      kid.root.rotation.y = inboard + rng() * 0.4 - 0.2;
      // **Actually sitting.** This line is the fix for Jim's *"the children on
      // the bus aren't sitting on seats"*: there was no pose here at all, so
      // twelve children rode the whole way stood bolt upright with the cushions
      // through their shins, and the guard that counted twelve occupied seats
      // was perfectly happy about it. `applyRidePose` is the game's own seated
      // pose — the same one the ferris wheel and the Rail Race use — reached
      // through `entities/ridePose.ts` rather than copied, so the bus cannot
      // drift from what sitting means everywhere else.
      applyRidePose({ root: kid.root, body: kid.body, head: kid.head, ...kid.limbs }, 0, 0);
      // **How much air is over this particular child**, measured on her, posed,
      // before she is parented into anything — so `box.max.y` is plainly "how
      // far she reaches above her own origin" and her origin is about to become
      // the cushion top. See `riderBounce`.
      kid.root.updateMatrixWorld(true);
      const reach = new Box3().setFromObject(kid.root).max.y;
      const headroom = CAT_BUS_CABIN_CEILING_Y - (CAT_BUS_SEAT_Y + reach);
      this.riderBounce.push(Math.max(0, Math.min(RIDER_BOUNCE, headroom - RIDER_BOUNCE_MARGIN)));
      seat.add(kid.root);
      this.riders.push(kid);
    }
  }

  /**
   * The lane's ground, as one displaced plane.
   *
   * Vertices are displaced by {@link groundHeight}, which is the same function
   * the bus's own wheels and every tree read — one definition of "where the
   * ground is", so nothing here can ever float or sink.
   */
  private buildGround(): void {
    // Roughly the old two-metre spacing, over the longer looping tile.
    const segmentsZ = Math.round(TILE_LENGTH / 2);
    const segmentsX = 40;
    const geometry = new PlaneGeometry(
      GROUND_HALF_WIDTH * 2,
      TILE_LENGTH,
      segmentsX,
      segmentsZ,
    );
    geometry.rotateX(-Math.PI / 2);
    // **Built centred on the origin, and never baked-offset.** The countryside is
    // shifted by whole loops each frame to follow the bus (see `update`), so its
    // z is a *loop-relative* coordinate: a vertex at built z sits, after the
    // group's whole-loop shift, at a world z that differs by a multiple of
    // {@link LANE_LOOP} — and because {@link groundHeight} is periodic in exactly
    // that, the baked height is correct wherever the tile lands. (The earlier
    // baked 100 m offset that put the hills out of step with the road is gone with
    // the offset it corrected: there is no world offset here any more, only the
    // runtime shift, which lands identical hills on identical hills.)
    const position = geometry.getAttribute('position') as BufferAttribute;
    for (let i = 0; i < position.count; i += 1) {
      position.setY(i, groundHeight(position.getX(i), position.getZ(i)));
    }
    position.needsUpdate = true;
    geometry.computeVertexNormals();

    const ground = new Mesh(geometry, toonMaterial(PALETTE.grass));
    ground.name = 'journey-ground';
    ground.receiveShadow = true;
    this.lane.add(ground);

    // The carriageway, a narrow ribbon laid on the same hills a hand's breadth
    // up so it never z-fights the grass.
    //
    // **Segmented across as well as along**, at 8 rather than 2: the texture now
    // carries kerbs at fixed `u`, and two segments across a 5.7 m road put the
    // nearest UV sample 2.9 m from the kerb it is meant to draw.
    //
    // The road's dashes repeat every {@link ROAD_TILE_METRES} along `v`, and
    // {@link LANE_LOOP} is an exact multiple of that (see its note), so the
    // whole-loop shift lands the markings on themselves as cleanly as the hills.
    const roadGeometry = new PlaneGeometry(ROAD_HALF_WIDTH * 2, TILE_LENGTH, 8, segmentsZ);
    roadGeometry.rotateX(-Math.PI / 2);
    const roadPosition = roadGeometry.getAttribute('position') as BufferAttribute;
    for (let i = 0; i < roadPosition.count; i += 1) {
      roadPosition.setY(i, laneHeight(roadPosition.getZ(i)) + 0.07);
    }
    roadPosition.needsUpdate = true;
    roadGeometry.computeVertexNormals();
    // Slabs, kerbs and a dashed centre line, in metres — the same road the park
    // lays at its own gate. Jim: *"the texture on the road is too plain"*; it was
    // one flat fill, so nothing moved past under the bus for twenty seconds.
    applyRoadUvs(roadGeometry, { across: 'x', along: 'z' });
    const road = new Mesh(roadGeometry, roadMaterial());
    road.name = 'journey-road';
    road.receiveShadow = true;
    this.lane.add(road);
  }

  /**
   * **Plants real park trees, and adds the meshes they are drawn in.**
   *
   * `where` is asked for each tree's spot and is handed that tree's own
   * {@link TREE_REACH} — how far this kind can possibly grow sideways — so a
   * caller sets the *near face* of the canopy against its clearance line
   * instead of the trunk. That is the whole discipline of this fix in one
   * parameter: **a thing is placed by its own width, never sampled across a
   * range and hoped to miss.** A wide lollipop is pushed out by its own width;
   * a narrow stack is allowed closer.
   *
   * Three meshes per population — one per shape in {@link FOLIAGE_GEOMETRY} —
   * and every tree of every kind shares them, so a lane full of trees is three
   * draw calls, exactly as the park's lawn is.
   */
  private plantTrees(
    name: string,
    count: number,
    rng: Rng,
    where: (rng: Rng, index: number, reach: number) => { x: number; z: number },
    target: Group,
    tile: boolean,
  ): void {
    const trunk: InstanceItem[] = [];
    const round: InstanceItem[] = [];
    const cone: InstanceItem[] = [];

    // **Tiled at exactly one loop, so the shift is seamless.** A verge tree is
    // rolled once and filed at three loop offsets, giving an identical tree one
    // whole {@link LANE_LOOP} up and down the lane. The countryside is shifted by
    // whole loops to follow the bus (see `update`), so under that shift the tree
    // that leaves the far edge is replaced *exactly* by its own copy arriving at
    // the near one — there is no pop, because it is the same tree. The park-ahead
    // woodland is `tile: false`: it lives in a group the shift never touches, and
    // it is a one-off backdrop, not a thing the bus drives past.
    const offsets = tile ? [-LANE_LOOP, 0, LANE_LOOP] : [0];

    for (let i = 0; i < count; i += 1) {
      const kind = pickTreeKind(rng);
      const { x, z } = where(rng, i, TREE_REACH[kind]);
      const { parts } = rollTree(rng, kind, x, groundHeight(x, z), z);
      for (const dz of offsets) {
        const copies =
          dz === 0
            ? parts
            : parts.map((part) => ({
                ...part,
                position: part.position.clone().setZ(part.position.z + dz),
              }));
        fileTreeParts(copies, { trunk, round, cone });
      }
    }

    target.add(
      makeInstanced(`${name}-trunks`, FOLIAGE_GEOMETRY.trunk, foliageMaterial(0.95), trunk, true),
      makeInstanced(`${name}-canopies`, FOLIAGE_GEOMETRY.round, foliageMaterial(0.85), round, true),
      makeInstanced(`${name}-cones`, FOLIAGE_GEOMETRY.cone, foliageMaterial(0.85), cone, true),
    );
  }

  /**
   * Trees and hedges either side, instanced.
   *
   * Two populations doing two different jobs, which is why there are two:
   * **hedge posts close to the road** give the speed something to be measured
   * against — a distant tree at 11 m/s barely moves — and **trees further out**
   * give the lane somewhere to be. Everything sits on {@link groundHeight}, so
   * the scenery rides the hills with the bus.
   *
   * ## The trees are the park's own
   *
   * Jim, 9 August 2026: *"Use the actual tree models same as the game uses by
   * the side of the road but not on it."*
   *
   * They were a lookalike — a `CylinderGeometry` trunk under one
   * `IcosahedronGeometry(1, 1)` ball, scattered by the loop below — while the
   * park's are four kinds with layered canopies, blossom, and per-instance
   * colour. So the last trees a child saw from the bus were not the trees she
   * then walked among, and the two had already drifted apart with nothing to
   * stop them drifting further. They now come from `world/treeModel.ts`, which
   * the park's lawn builds from too: **one owner, and a new tree kind arrives
   * on this lane for free.**
   */
  private buildScenery(): void {
    const rng = new Rng(LANE_SCATTER_SEED);

    // Scattered over **one loop, centred on the origin**, then tiled up and down
    // the lane by `plantTrees`. `z` is a loop-relative coordinate in
    // [−LANE_LOOP/2, LANE_LOOP/2); the three tiles fill the whole countryside.
    this.plantTrees(
      'journey-tree',
      LANE_TREES_PER_LOOP,
      rng,
      (r, i, reach) => {
        const side = i % 2 === 0 ? 1 : -1;
        // Clear of the tarmac, thinning outwards so the lane has a near edge and
        // a soft far one.
        //
        // **The canopy is what has to clear it, not the trunk.** The tree is
        // pushed out by `reach`, its own kind's widest possible canopy, so the
        // 2.6 m verge is measured from the leaves inward — same discipline as
        // {@link PARK_AHEAD_CLEAR}: the thing's own size decides where it stands.
        const x = side * (ROAD_HALF_WIDTH + reach + 2.6 + r.unit() * r.unit() * 60);
        const z = (r.unit() - 0.5) * LANE_LOOP;
        return { x, z };
      },
      this.lane,
      true,
    );

    const matrix = new Matrix4();
    const at = new Vector3();
    const scale = new Vector3();
    const spin = new Quaternion();

    // The hedge: little rounded blobs marching along both verges, close enough
    // to the camera to sell the speed. Marched evenly over one loop and tiled
    // three times, exactly like the trees, so it scrolls seamlessly.
    const HEDGE = HEDGE_PER_LOOP * 3;
    const hedge = new InstancedMesh(
      new SphereGeometry(1, 8, 6),
      toonMaterial(PALETTE.leafDeep),
      HEDGE,
    );
    hedge.name = 'journey-hedge';
    // **One loop rolled, then stamped three times.** Every random draw is made
    // once per slot and reused for that slot's copy in each of the three tiles,
    // so a hedge and its copies one loop up and down the lane are *identical*.
    // That is what the seamless shift needs: rolling fresh randoms per tile would
    // make the same slot a different blob in each loop, and the shift would pop.
    let placed = 0;
    for (let slot = 0; slot < HEDGE_PER_LOOP; slot += 1) {
      const side = slot % 2 === 0 ? 1 : -1;
      const baseZ = (slot / HEDGE_PER_LOOP - 0.5) * LANE_LOOP;
      const radius = 0.75 + rng.unit() * 0.45;
      // **Its own width.** The near face sits at the kerb — the offset is applied
      // to the blob's near edge, not its centre, so none of it reaches onto the
      // carriageway however wide the blob is.
      const spread = radius * 1.35;
      const x = side * (ROAD_HALF_WIDTH + spread + rng.unit() * 0.4);
      const spinY = rng.unit() * Math.PI;
      for (const dz of [-LANE_LOOP, 0, LANE_LOOP]) {
        const z = baseZ + dz;
        at.set(x, groundHeight(x, z) + radius * 0.55, z);
        scale.set(spread, radius, spread);
        spin.setFromAxisAngle(new Vector3(0, 1, 0), spinY);
        matrix.compose(at, spin, scale);
        hedge.setMatrixAt(placed, matrix);
        placed += 1;
      }
    }
    hedge.instanceMatrix.needsUpdate = true;
    hedge.castShadow = true;
    this.lane.add(hedge);
  }

  /**
   * **The park, at the end of the lane.**
   *
   * Jim, 7 August 2026: *"it doesn't actually drive up to the park, the road
   * needs to actually go to the park."*
   *
   * The road went nowhere. The lane ran on past the horizon, the ride simply
   * stopped after twenty seconds, and the cut put a child beside a gate she had
   * never seen coming. Nothing on screen ever said where the bus was going, so
   * "driving to the park" was a caption rather than a thing you watched happen.
   *
   * Now the park is **built at the far end of the road**: its boundary wall
   * across the view, its gate arch dead ahead with the carriageway running
   * through it, and its trees and rooftops standing over the wall behind. It
   * begins the ride buried in {@link Scene.fog} — 250 m out against a fog that
   * ends at 235 — and emerges over the last third, so the arrival is something
   * that grows in the windscreen rather than something that is announced.
   *
   * ## It is the park's own gate, not a lookalike
   *
   * The posts, the caps and the crossbar are built to `Entrance.ts`'s own
   * dimensions and out of the same `stonePink` family, and the road through it
   * is `road.ts`'s road at `road.ts`'s width. That matters at exactly one
   * moment — the cut — where a child is looking at a gate and a road and
   * nothing else, and any disagreement between the two scenes is a jump.
   *
   * The bus stops {@link PARK_STANDOFF} short of the arch, which is what makes
   * it an arrival rather than a collision.
   */
  private buildParkAhead(): void {
    const gateZ = PARK_AHEAD_Z;
    const stone = toonMaterial(PALETTE.stonePink);
    const capStone = toonMaterial(PALETTE.stonePinkLight);

    // --- the boundary wall, either side of the opening -----------------------
    // Blocks laid along the ground it stands on, so the wall rides the same
    // hills as everything else rather than hovering over them.
    const BLOCK = 2.2;
    const WALL_HEIGHT = 2.6;
    const blockGeometry = new BoxGeometry(BLOCK * 0.96, WALL_HEIGHT, 1.1);
    const perSide = 26;
    const wall = new InstancedMesh(blockGeometry, stone, perSide * 2);
    wall.name = 'journey-park-wall';
    const matrix = new Matrix4();
    const at = new Vector3();
    const spin = new Quaternion();
    const one = new Vector3(1, 1, 1);
    let laid = 0;
    for (const side of [-1, 1] as const) {
      for (let i = 0; i < perSide; i += 1) {
        // Starts clear of the gate opening and marches outward.
        const x = side * (GATE_HALF_WIDTH + 1.2 + i * BLOCK);
        at.set(x, groundHeight(x, gateZ) + WALL_HEIGHT / 2 - 0.3, gateZ);
        matrix.compose(at, spin, one);
        wall.setMatrixAt(laid, matrix);
        laid += 1;
      }
    }
    wall.instanceMatrix.needsUpdate = true;
    wall.castShadow = true;
    wall.receiveShadow = true;
    this.parkAhead.add(wall);

    // --- the gate arch -------------------------------------------------------
    // **`gateArch.ts`, the same call `Entrance` makes.** This is the gate she
    // is about to walk through, seen from outside, and the cut between the two
    // scenes lands squarely on it — so it cannot be a lookalike. It used to be
    // a second copy of the posts, the caps and the crossbar, and the copies
    // drifted (issue #480): both inverted the arch so it hung down from the
    // post tops, and only the park's own gate also had it turned across the
    // path. Nothing about the shape is written down here any more.
    //
    // This road runs along Z, so the gateway spans world X and the yaw is 0.
    const gate = buildGateArch({
      centreX: 0,
      centreZ: gateZ,
      yaw: 0,
      groundAt: groundHeight,
      stoneMaterial: stone,
      capMaterial: capStone,
      // Deliberately unnamed: `check:park-map` finds the park's gate by
      // `park-gate-arch`, and `getObjectByName` returns the first match.
    }).group;
    gate.name = 'journey-park-gate';
    this.parkAhead.add(gate);

    // --- what stands over the wall -------------------------------------------
    //
    // **Woodland, and nothing else.** Jim, 9 August 2026, on the deployed game:
    // *"Can we just remove these mystery items? Use the actual tree models same
    // as the game uses by the side of the road but not on it."*
    //
    // There used to be a second population here: `journey-park-rooftops`, 54
    // `ConeGeometry(1, 1, 7)` spikes in `markerPink`, 2.4-4.6 m across and 5-12 m
    // tall. They were meant to read as *rooftops glimpsed over the wall* — the
    // reason the wall has anything behind it at all is so the other side looks
    // like somewhere worth arriving at rather than a walled field.
    //
    // They did not read as rooftops. They read as pink cones standing in a
    // field, because that is what they were: **a roof with no building under
    // it, meeting the grass at a point.** Jim could not identify them, and the
    // one that had wandered into the carriageway he reasonably took for a
    // traffic cone blocking the bus. A silhouette that has to be *explained* is
    // not doing a silhouette's job, and the fix for a shape nobody recognises is
    // not to move it — it is to delete it.
    //
    // What is left is the park's own trees, which everybody recognises, and
    // which the park really does have standing inside its wall. Roughly a fifth
    // of them roll `blossom`, so the pink that the rooftops were there to
    // provide arrives anyway — from a thing a six-year-old can name.
    //
    // Real trees at real scale, not oversized stand-ins: `TREE_TOP` tops out at
    // 7.25 m against a 2.6 m wall, so they clear it by a comfortable margin at
    // the only distance anyone ever sees them from.
    this.plantTrees(
      'journey-park-tree',
      PARK_AHEAD_TREES,
      new Rng(PARK_AHEAD_SEED),
      (r, _i, reach) => {
        // Alternate sides, and start each one where the masonry starts — placed
        // **outward from the edge of the gate opening** rather than sampled across
        // the whole width and hoped to miss (see {@link PARK_AHEAD_CLEAR}), by the
        // tree's own widest possible canopy, so the near leaves begin at the
        // clearance line rather than the trunk.
        const side = r.chance(0.5) ? 1 : -1;
        const x = side * (PARK_AHEAD_CLEAR + reach + r.unit() * 54);
        const z = gateZ - 4 - r.unit() * 58;
        return { x, z };
      },
      // A one-off backdrop in the untranslated group — never tiled, never shifted.
      this.parkAhead,
      false,
    );
  }

  /**
   * Puts the bus at a point down the lane, on the hills, **lying along the
   * slope it is standing on**.
   *
   * ## Why this is a `lookAt` and not an angle
   *
   * It was an angle, and the angle was backwards. `rotation.x` was set to
   * `atan2(behind − ahead, 14)`, which — once the constructor's separate
   * `rotation.y = π` had turned the bus to face −Z — pitched its nose **down**
   * every time the road went up. Measured over a whole ride, the bus disagreed
   * with the ground on **every one of 1200 frames**: at t = 10 s the lane climbs
   * at +0.12 m per metre and the bus's nose pointed 0.11 *below* the horizontal.
   * Jim, 7 August 2026: *"the bus doesn't tilt up when going over a hill"* — it
   * tilted the other way, which reads as not tilting at all right up until it
   * reads as wrong.
   *
   * A sign is exactly the kind of thing that is invisible in review and obvious
   * on screen, so there is no longer a sign here to get wrong. The bus is simply
   * pointed at the piece of road under its own nose: `Object3D.lookAt` aims
   * local **+Z** — the bus's own length, the way `catBus.ts` builds it — at a
   * target, so yaw and pitch both fall out of where the road *is*. There is
   * nothing left to invert.
   *
   * The nose and tail points are {@link BUS_PITCH_SPAN} apart rather than
   * sampled at a point, so the bus lies along the hill the way a long vehicle
   * does instead of pivoting on its middle.
   *
   * {@link laneHeight} is the one owner: the ground mesh, the road ribbon, every
   * tree, every hedge and this all read it, so the bus cannot drift from the
   * road it is driving on.
   */
  private place(z: number): void {
    const half = BUS_PITCH_SPAN / 2;
    // The bus drives towards −Z, so its nose rests at the smaller z.
    const rise = laneHeight(z - half) - laneHeight(z + half);
    this.bus.root.position.set(0, laneHeight(z), z);
    // Aim the bus's length along the chord from where its tail rests to where
    // its nose rests. Uphill means `rise > 0` means the target is above the bus
    // means the nose comes up — which is a statement about the road, not about
    // a rotation convention.
    this.bus.root.lookAt(0, laneHeight(z) + rise, z - BUS_PITCH_SPAN);
  }

  /**
   * Where the camera goes this frame.
   *
   * Exported shape rather than an inline lump because {@link cameraPoseAt} is
   * pure: a check can ask where the camera will be at t = 19.9 s without
   * building a bus, which is the only way to assert that the ride ends on the
   * park's own bearing.
   */
  /**
   * One frame of the ride.
   *
   * `canArrive` is the director's {@link JourneyDirector.readyToArrive}: the park
   * has generated *and* the minimum ride has been seen. Until it is true the bus
   * drives the looping world for ever — the drive never stops, so there is never
   * a parked wait. The first frame it is true, the jump-cut fires and the closing
   * approach plays: the bus rolls the last stretch to {@link RIDE_END_Z} and the
   * camera eases onto the park's 0.00° bearing, exactly as an on-time ride always
   * has. On a fast device that cut lands at {@link MIN_LOOP_SECONDS} and hand-over
   * at 20 s, unchanged.
   */
  update(dt: number, canArrive = false): void {
    if (dt <= 0) return;
    this.animationSeconds += dt;

    // **The jump-cut, once.** From here the bus is on its closing approach and the
    // lane clock is frozen; `arrivalSeconds` takes over.
    if (!this.arriving && canArrive) this.jumpCutToPark();

    if (this.arriving) {
      this.arrivalSeconds = Math.min(SETTLE_SECONDS, this.arrivalSeconds + dt);
    } else {
      // The loop clock, never clamped — the world repeats, so the bus keeps going.
      this.elapsedSeconds += dt;
    }

    // **The shot's own time.** During the loop it is the drive clock; during the
    // approach it is the closing window `[MIN_LOOP_SECONDS, JOURNEY_SECONDS]`, so
    // `busZ` runs −184.8 → −220 and `cameraPoseAt` settles onto the park bearing —
    // the same arithmetic the last {@link SETTLE_SECONDS} of an on-time ride used.
    const t = this.arriving ? MIN_LOOP_SECONDS + this.arrivalSeconds : this.elapsedSeconds;
    this.busZ = -t * BUS_SPEED;
    this.place(this.busZ);

    // **The world follows the bus by whole loops.** Snapping the countryside's
    // offset to a multiple of {@link LANE_LOOP} keeps ground under the bus for
    // ever, and because everything in `lane` is periodic in exactly that, the
    // snap lands identical hills, road markings, trees and hedges on top of the
    // old ones — the infinite drive with no seam. The park (`parkAhead`) is not
    // in this group, so the gate never repeats.
    this.lane.position.z = Math.round(this.busZ / LANE_LOOP) * LANE_LOOP;

    // Full road speed throughout: the bus is always driving, whether looping or
    // making its final approach, so the wheels never stop turning.
    this.bus.animate(dt, BUS_SPEED);
    this.exciteRiders(this.animationSeconds);

    // **The cut between inside and outside.** During the loop the five-beat shot
    // list cycles (`% JOURNEY_SECONDS`), so it keeps switching for as long as the
    // drive lasts; during the approach it is forced outside, so the settle onto
    // the park bearing is never interrupted by an interior beat.
    this.cutTo(this.arriving ? 'outside' : shotAt(this.elapsedSeconds % JOURNEY_SECONDS).view);

    if (this.viewMode === 'inside') {
      // **The pan's own clock, which only runs while the shot is on screen.**
      // Advanced here rather than in `update`'s preamble so the exterior beats
      // between interior ones are not spent travelling down a bus nobody sees.
      this.insideSeconds += dt;
      this.placeTheInsideCamera();
      this.pointTheInsideCamera();
      return;
    }

    // The looping orbit spins on for ever; the approach eases it onto the park's
    // own bearing. Two owners of "where the outside camera is", one per phase —
    // and `cameraPoseAt(JOURNEY_SECONDS)` is the 0.00° pose the hand-over cuts to,
    // which `check:bus-journey` asserts.
    const pose = this.arriving
      ? cameraPoseAt(MIN_LOOP_SECONDS + this.arrivalSeconds)
      : loopCameraPoseAt(this.elapsedSeconds);
    const height = laneHeight(this.busZ);
    this.camera.position.set(
      Math.sin(pose.yaw) * pose.horizontal,
      height + pose.lift,
      this.busZ + Math.cos(pose.yaw) * pose.horizontal,
    );
    // Aimed at the bus, its height taken off `bus.root` rather than recomputed —
    // one definition of where the bus is, which is this repo's most expensive bug
    // shape avoided.
    this.camera.lookAt(0, this.bus.root.position.y + 2.2, this.busZ);
  }

  /**
   * **The small jump cut that takes the bus adjacent to the park.**
   *
   * Jim, 9 August 2026: *"a small jump cut takes it adjacent to the park when
   * loaded."* One deliberate hard cut, the same grammar as the ride's inside/
   * outside cuts: the looping countryside is left behind, the park is revealed,
   * and the bus is placed at the start of its closing approach. `update` reads the
   * bus and camera from `arrivalSeconds` from here on, so nothing else needs to
   * know the loop has ended.
   *
   * On a fast device this fires at {@link MIN_LOOP_SECONDS}, where the loop and the
   * approach happen to agree on the bus's position and the camera's pose to the
   * metre and the degree — so there the only thing the cut changes is that the
   * gate appears, and the closing shot then plays exactly as it always has.
   */
  private jumpCutToPark(): void {
    this.arriving = true;
    this.arrivalSeconds = 0;
    this.parkAhead.visible = true;
  }

  /**
   * **The children, riding and looking excited.**
   *
   * Jim asked for the inside view to show *"the children riding it and looking
   * excited"*, and a `setExpression('happy')` on a body that never moves is a
   * photograph of a smile rather than excitement. So they bounce in their seats,
   * throw their arms up, and look about at the countryside going past — each on
   * their own phase, so twelve children are not one child twelve times.
   *
   * Driven every frame **whatever the view is**, not only from inside. They are
   * visible through the glazing from outside too — that glazing was the whole
   * point of the previous round — and a bus full of children who freeze the
   * moment you step out of it is a worse bug than one full of still children.
   */
  private exciteRiders(elapsed: number): void {
    for (let i = 0; i < this.riders.length; i += 1) {
      const kid = this.riders[i];
      if (!kid) continue;
      const phase = i * 1.31;
      // Bouncing on the seat. `body` is the rig's own bob target, and the
      // amplitude is this child's own — measured against the ceiling over her
      // head when she was seated. See `riderBounce`.
      kid.body.position.y =
        Math.abs(Math.sin(elapsed * 3.2 + phase)) * (this.riderBounce[i] ?? 0);
      // Looking out at what is going past, and up at each other.
      // Glancing about, not turning away: at ±0.55 rad most of the bus had its
      // face pointed somewhere other than forward, and the inside view is a
      // shot of faces or it is nothing.
      kid.head.rotation.y = Math.sin(elapsed * 0.9 + phase) * 0.26;
      kid.head.rotation.z = Math.sin(elapsed * 1.7 + phase) * 0.09;
      if (kid.limbs) {
        // Arms up: negative `rotation.x` raises an arm, as the ferris wheel's
        // excited riders do it.
        const lift = -1.35 + Math.sin(elapsed * 6.5 + phase) * 0.32;
        kid.limbs.leftArm.rotation.x = lift;
        kid.limbs.rightArm.rotation.x = lift + Math.sin(elapsed * 7.4 + phase) * 0.3;
        kid.limbs.leftArm.rotation.z = 0.34;
        kid.limbs.rightArm.rotation.z = -0.34;
      }
    }
  }

  /**
   * Draws the ride, **fitted to the window it is being drawn into**.
   *
   * This used to set `aspect` and nothing else, which is the whole of QA's
   * *"the bus is cropped at both ends mid-orbit"* on a phone: a
   * `PerspectiveCamera`'s `fov` is its *vertical* one, so on a portrait window
   * the horizontal field narrows with the width and an 18 m vehicle broadside
   * to the lens runs off both edges. Every other ride camera in the game
   * already widens for this, through `fitCameraToViewport` — the declared one
   * owner of the portrait rule — and the ride was the one camera that did not
   * ask it.
   */
  render(renderer: WebGLRenderer, width: number, height: number): void {
    const aspect = width / Math.max(1, height);
    if (this.camera.aspect !== aspect || this.fittedFov !== this.baseFov) {
      this.fittedFov = this.baseFov;
      fitCameraToViewport(this.camera, this.baseFov, width, height);
      // **The inside shot is the same shot in every window**, per Jim on 8
      // August: *"in all modes, not just portrait."* So there is nothing to
      // decide here beyond the lens — the pan down the aisle is what makes a
      // tall frame work, and it is the same pan a wide one gets.
    }
    renderer.render(this.scene, this.camera);
  }

  dispose(): void {
    this.driver.dispose();
    for (const rider of this.riders) rider.root.removeFromParent();
    this.riders.length = 0;
    this.bus.dispose();
    this.scene.clear();
  }
}

/**
 * Where the camera is, as a bearing and a distance from the bus, at time `t`.
 *
 * Pure and exported so a check can measure the shot without a renderer — in
 * particular that the ride **ends on the park's own camera bearing**, which is
 * what makes the hand-over a cut rather than a jump, and which is exactly the
 * kind of claim that is easy to write in a comment and never verify.
 */
export function cameraPoseAt(t: number): {
  readonly yaw: number;
  readonly horizontal: number;
  readonly lift: number;
} {
  const settleStart = JOURNEY_SECONDS - ORBIT.settleSeconds;
  const spun = ORBIT.startYawDegrees * DEG + (t / JOURNEY_SECONDS) * ORBIT.turns * Math.PI * 2;
  const parkYaw = CAMERA_YAW_DEGREES * DEG;

  // Ease onto the park's bearing over the last few seconds, taking the shortest
  // way round from wherever the orbit has got to, so the settle never spins
  // back on itself.
  let yaw = spun;
  if (t > settleStart) {
    const settle = smoothstep(0, 1, clamp01((t - settleStart) / ORBIT.settleSeconds));
    const target = parkYaw + Math.round((spun - parkYaw) / (Math.PI * 2)) * Math.PI * 2;
    yaw = lerp(spun, target, settle);
  }

  // The park's camera is a fixed elevation; the ride's drifts a little so the
  // shot breathes, and lands on the park's own by the end.
  const parkPitch = CAMERA_PITCH_DEGREES * DEG;
  const settle = t > settleStart ? smoothstep(0, 1, clamp01((t - settleStart) / ORBIT.settleSeconds)) : 0;
  const drift = Math.sin(t * 0.42) * 0.09;
  const pitch = lerp(parkPitch + drift, parkPitch, settle);
  const distance = lerp(CAMERA_BACK + Math.sin(t * 0.31) * 3.5, CAMERA_BACK, settle);

  return {
    yaw,
    horizontal: Math.cos(pitch) * distance,
    lift: lerp(Math.sin(pitch) * distance, CAMERA_LIFT, settle * 0.25),
  };
}

/**
 * Where the camera is during the **looping drive** — the orbit that never
 * settles.
 *
 * It is deliberately {@link cameraPoseAt}'s pre-settle branch, with no easing onto
 * the park bearing: the loop must keep orbiting however long the park takes, and
 * `cameraPoseAt` would start settling the instant `t` passed
 * {@link MIN_LOOP_SECONDS}. Because they share that branch exactly, the two agree
 * to the metre and the degree at `t = MIN_LOOP_SECONDS` — so on a fast device the
 * jump-cut from this to `cameraPoseAt` is seamless, and the only thing the cut
 * changes is that the gate appears.
 *
 * Pure and exported so a check can assert the loop keeps moving without a bus.
 */
export function loopCameraPoseAt(t: number): {
  readonly yaw: number;
  readonly horizontal: number;
  readonly lift: number;
} {
  const yaw = ORBIT.startYawDegrees * DEG + (t / JOURNEY_SECONDS) * ORBIT.turns * Math.PI * 2;
  const pitch = CAMERA_PITCH_DEGREES * DEG + Math.sin(t * 0.42) * 0.09;
  const distance = CAMERA_BACK + Math.sin(t * 0.31) * 3.5;
  return {
    yaw,
    horizontal: Math.cos(pitch) * distance,
    lift: Math.sin(pitch) * distance,
  };
}
