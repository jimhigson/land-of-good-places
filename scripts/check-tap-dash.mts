/**
 * **Tap to go: does a long journey dash, and does the dash stay a walk in
 * everything but speed?**
 *
 * ```
 * pnpm run check:tap-dash
 * ```
 *
 * Jim, 11 November 2026: *"if selecting a place on the map more than a short
 * distance away, the player should run there at super-speed … normal for
 * journeys of less than 1.5s seconds, and ramp up linearly to provide a max
 * travel time of about 4s."* The curve is `src/entities/tapDash.ts`, one owner;
 * this proves three things about it, on the real park.
 *
 * ## 1. The curve (pure, in the parent)
 *
 * Asked of `tapDash.ts`'s own functions over a 0.05 m grid to 1 km: a walk up
 * to 1.5 s of walking; continuous at the threshold; travel time never falling
 * as the journey grows; never reaching 4 s; at or above a sprint for every
 * journey of 3.5 s or more at a walk; and a stride that fits inside every
 * radius the navigator steers by and inside `PLAYER_LONGEST_STEP`.
 *
 * ## 2. Real journeys on real parks (a child per seed)
 *
 * Each seed's park is built headlessly (`park-harness.mts`) and the **real**
 * `Player` is walked by the **real** `TapNavigator`, frame by frame, through the
 * game's own stride loop (`entities/frameStrides.ts`, which `Game.tick` runs).
 * Nothing about movement is modelled here. Journeys are drawn from the park's
 * own routes with a seeded RNG — the longest few the park has, a spread of the
 * rest, and some under the threshold — and each one is run three times at
 * frame steps of 1/60, 1/30 and the clamp (1/12 s, `MAX_FRAME_DELTA`), the
 * frame on which a dash covers the most ground at once.
 *
 * Per journey it asserts:
 *
 * - **Short ones are walks**: under the threshold she never goes faster than
 *   the walk.
 * - **Long ones arrive in about 4 s**: every dash arrives within
 *   {@link ARRIVE_BY} seconds, and the longest route on each seed takes at
 *   least {@link LONGEST_AT_LEAST} — the cap is reached, not merely respected.
 * - **Arrival is the walk's arrival**: the same journey is also *walked*
 *   (the dash forced off — the control), and the dash must arrive wherever the
 *   walk does, come to rest no further from the marker than the walk does
 *   (+{@link REST_SLACK}), and never fail a journey the walk completes.
 * - **No tunnelling.** Every stride of the dash is swept at 5 cm, and at every
 *   sample her centre is asked of `CollisionWorld.deepestSolidOverlap` — the
 *   very rule `resolve` pushes her out by — at the height she was at: a point
 *   more than {@link TUNNEL_DEPTH} inside something solid to her is a tunnel.
 *   No stride may exceed `PLAYER_LONGEST_STEP`.
 *
 * ## 3. The instrument's control, every run
 *
 * An instrument that cannot find a tunnel is not evidence there is none. So
 * every seed also sweeps a straight line across the park at foot level from
 * its longest journey's start to its end — what a dash with no collision at
 * all would trace — and the sweep must find tunnels in it; and the walked
 * journeys must give none, which says the sweep's zero on the dash is not a
 * sweep that flags everything either. Both counts are printed on every run.
 * (Switching collision off in the real player is no control: her wedge and
 * drop guards keep her out of solids on their own, and measured so — 0 of
 * 544 strides.)
 *
 * Proven red — see the PR for the transcripts: the curve's clause with
 * `DASH_MAX_SECONDS` raised to 5; arrival with the brake removed
 * (`DASH_BRAKE_SECONDS = 0`); and the sweep by its own control above.
 */
import './headless-canvas.mjs';
import { execFile } from 'node:child_process';
import { cpus } from 'node:os';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import {
  DASH_BRAKE_SECONDS,
  DASH_CADENCE_SPEED,
  DASH_CRUISE_SECONDS,
  DASH_MAX_SECONDS,
  DASH_STRIDE,
  DASH_THRESHOLD_METRES,
  DASH_WALK_SECONDS,
  dashBoost,
  dashBoostNow,
  dashCruiseSpeed,
  dashSeconds,
  dashSubsteps,
  DASH_MAX_STRIDES,
} from '../src/entities/tapDash.ts';
import { MAX_FRAME_DELTA, PLAYER_LONGEST_STEP, PLAYER_MAX_SPEED, PLAYER_SPRINT_MULTIPLIER } from '../src/core/constants.ts';
import { ARRIVE_RADIUS, WAYPOINT_RADIUS } from '../src/entities/TapNavigator.ts';

/** The seeds walked: the canonical park and three more from the pool. */
const SEEDS = [5, 0, 9, 13];
/** Frame steps each journey is run at. The clamp is where a dash's frame is longest. */
const FRAME_STEPS = [1 / 60, 1 / 30, MAX_FRAME_DELTA];
/** Every dash must have arrived by this, in seconds. "About 4 s". */
const ARRIVE_BY = DASH_MAX_SECONDS + 0.35;
/** The longest route on a seed must take at least this: the cap is reached. */
const LONGEST_AT_LEAST = 3.6;
/** How much further from the marker than the walk a dash may come to rest. */
const REST_SLACK = 0.1;
/** Metres inside something solid, at her centre, that count as a tunnel. */
const TUNNEL_DEPTH = 0.1;

const run = promisify(execFile);
const HERE = fileURLToPath(import.meta.url);

// ===================================================================== child

interface Stride {
  x: number;
  y: number;
  z: number;
  ground: number;
  hop: number;
  speed: number;
}

interface JourneyRun {
  readonly arrived: boolean;
  readonly seconds: number;
  readonly restDistance: number;
  readonly maxSpeed: number;
  readonly maxStride: number;
  readonly maxStrides: number;
  readonly tunnels: number;
  readonly firstTunnel: string | null;
}

interface JourneyReport {
  readonly from: readonly [number, number];
  readonly to: readonly [number, number];
  readonly metres: number;
  readonly cruise: number;
  readonly dt: number;
  readonly dash: JourneyRun;
  readonly walk: JourneyRun;
}

interface SeedReport {
  readonly seed: number;
  readonly longestRoute: number;
  readonly journeys: readonly JourneyReport[];
  readonly controlTunnels: number;
  readonly controlSamples: number;
}

async function child(seed: number): Promise<void> {
  // Deterministic: nothing below may depend on the wall clock or Math.random.
  let state = (seed * 2654435761) >>> 0 || 1;
  const random = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  Math.random = random;

  const { Vector3 } = await import('three');
  const { buildHeadlessPark, quietly } = await import('./park-harness.mts');
  const { Player } = await import('../src/entities/Player.ts');
  const { TapNavigator } = await import('../src/entities/TapNavigator.ts');
  const { FrameStrides } = await import('../src/entities/frameStrides.ts');
  const { playerNavGrid } = await import('../src/world/playerLattice.ts');
  const { MAX_ROUTE_WAYPOINTS } = await import('../src/world/NavGrid.ts');
  const { PARK_BOUNDARY } = await import('../src/world/boundary.ts');
  const { terrainHeight } = await import('../src/world/terrain.ts');
  const { PLAYER_RADIUS } = await import('../src/core/constants.ts');
  const { KID_HEIGHT } = await import('../src/art/models/kidHeight.ts');

  const park = quietly(() => buildHeadlessPark());
  const world = park.world;
  const collision = world.collision;
  const camera = park.camera;
  const player = quietly(() => new Player(collision, camera, new Vector3(0, 0, 0)));
  park.scene.add(player.group);
  quietly(() => world.attachPlayer(player));
  // Attaching her starts the cat-bus arrival, which holds her as a ride until
  // `Game` hands her the controls. There is no arrival here: hand them over.
  if (player.riding) quietly(() => player.endRide({ x: 0, y: terrainHeight(0, 0), z: 0 } as never));
  if (player.riding) throw new Error('check:tap-dash: the player is still riding after endRide — nothing below could move her');
  const navGrid = quietly(() => playerNavGrid(world));

  /**
   * The input surface `Player` and `TapNavigator` use, with no devices behind
   * it. `setNavigationMove` clamps to the unit stick as `InputSystem`'s does.
   */
  const input = {
    moveX: 0,
    moveY: 0,
    manualMoveActive: false,
    sprint: false,
    setNavigationMove(x: number, y: number): void {
      const length = Math.hypot(x, y);
      this.moveX = length > 1 ? x / length : x;
      this.moveY = length > 1 ? y / length : y;
    },
    setNavigationSprint(active: boolean): void {
      this.sprint = active;
    },
    isDown(action: string): boolean {
      return action === 'sprint' && this.sprint;
    },
    justPressed(): boolean {
      return false;
    },
  };
  const navigator = quietly(() => new TapNavigator(player, camera, input as never, navGrid));
  const strides = new FrameStrides();
  const context = {
    dt: 1 / 60,
    elapsed: 0,
    input: input as never,
    playerPosition: player.position,
    cameraForward: camera.forward,
    frame: 0,
  };
  if (Math.hypot(camera.right.x, camera.right.z) < 0.5 || Math.hypot(camera.forward.x, camera.forward.z) < 0.5) {
    throw new Error('check:tap-dash: the headless camera has no ground basis — the stick would steer nowhere');
  }

  // Private state read, not modelled: the navigator's own route length and
  // target, and the player's own ground and hop height.
  const nav = navigator as unknown as {
    remainingRoute(): number;
    cruiseBoost: number;
    target: { x: number; y: number; z: number };
  };
  const body = player as unknown as { groundHeight: number; hopClearance: number };

  // ---- the journeys, from the park's own routes
  const sampler = player.groundSampler;
  if (!sampler) throw new Error('check:tap-dash: attachPlayer installed no ground sampler');
  const R = PARK_BOUNDARY.maxRadius;
  const spot = (): { x: number; z: number } | null => {
    for (let tries = 0; tries < 200; tries += 1) {
      const x = (random() * 2 - 1) * R;
      const z = (random() * 2 - 1) * R;
      if (PARK_BOUNDARY.distanceToEdge(x, z) < 4) continue;
      if (!collision.isClearCircle(x, z, PLAYER_RADIUS + 0.4)) continue;
      if (collision.inAnotherSpace(x, z)) continue;
      return { x, z };
    }
    return null;
  };
  const out = new Float32Array(MAX_ROUTE_WAYPOINTS * 2);
  interface Pair {
    from: { x: number; z: number };
    to: { x: number; z: number };
    metres: number;
  }
  const pairs: Pair[] = [];
  for (let attempt = 0; attempt < 500; attempt += 1) {
    const from = spot();
    const to = spot();
    if (!from || !to) continue;
    const fy = terrainHeight(from.x, from.z);
    const ty = terrainHeight(to.x, to.z);
    const count = navGrid.findRoute(from.x, from.z, fy, to.x, to.z, ty, sampler, out);
    if (count === 0 || !navGrid.lastRouteReachedGoal) continue;
    let metres = Math.hypot((out[0] ?? 0) - from.x, (out[1] ?? 0) - from.z);
    for (let i = 0; i < count - 1; i += 1) {
      metres += Math.hypot((out[i * 2 + 2] ?? 0) - (out[i * 2] ?? 0), (out[i * 2 + 3] ?? 0) - (out[i * 2 + 1] ?? 0));
    }
    pairs.push({ from, to, metres });
  }
  pairs.sort((a, b) => b.metres - a.metres);
  const longest = pairs.slice(0, 4);
  const short = pairs.filter((pair) => pair.metres < DASH_THRESHOLD_METRES * 0.9).slice(0, 4);
  const rest = pairs.slice(4).filter((pair) => pair.metres >= DASH_THRESHOLD_METRES * 0.9);
  const spread: Pair[] = [];
  for (let i = 0; i < 6 && rest.length > 0; i += 1) spread.push(rest[Math.floor((i / 6) * rest.length)] as Pair);
  const chosen = [...longest, ...spread, ...short];

  // ---- one journey, one way
  type Mode = 'dash' | 'walk';
  const realBoost = player.setTravelBoost.bind(player);

  const tunnelAt = (a: Stride, b: Stride): string | null => {
    const length = Math.hypot(b.x - a.x, b.z - a.z);
    const samples = Math.max(1, Math.ceil(length / 0.05));
    const probe = new Vector3();
    for (let i = 0; i <= samples; i += 1) {
      const t = i / samples;
      probe.set(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, a.z + (b.z - a.z) * t);
      // Lenient on height, strict on depth. Her feet are the higher of the
      // surface she stood on at either end and her own height there — in the
      // air that is where her feet are, over a wall the auto-hop is carrying
      // her across; on the ground the damped height lags at most a few cm
      // above the ground. A step-up or a hop is never mistaken for a tunnel;
      // a point well inside the shape itself, below its top, always is.
      const feet = Math.max(a.ground, b.ground, probe.y);
      const depth = collision.deepestSolidOverlap(probe, 0.01, Math.max(a.hop, b.hop), undefined, KID_HEIGHT, feet) - 0.01;
      if (depth > TUNNEL_DEPTH) {
        return `centre ${depth.toFixed(2)} m inside ${collision.describeNear(probe.x, probe.z, 0.05)[0] ?? 'a solid'} at (${probe.x.toFixed(2)}, ${probe.z.toFixed(2)})`;
      }
    }
    return null;
  };

  // `LGP_TAP_DASH_DEBUG=x,z` prints every stride within 1.5 m of a point.
  const debugAt = process.env['LGP_TAP_DASH_DEBUG']?.split(',').map(Number) ?? null;
  const runJourney = (pair: Pair, dt: number, mode: Mode): { run: JourneyRun; metres: number; cruise: number; samples: number } => {
    player.setTravelBoost = mode === 'walk' ? () => realBoost(1) : realBoost;

    quietly(() => player.teleport(pair.from.x, pair.from.z));
    quietly(() => navigator.navigateTo(pair.to.x, terrainHeight(pair.to.x, pair.to.z), pair.to.z));
    const metres = nav.remainingRoute();
    const cruise = nav.cruiseBoost;
    const target = { x: nav.target.x, z: nav.target.z };
    const trace: Stride[] = [];
    const record = (): void => {
      trace.push({
        x: player.position.x,
        y: player.position.y,
        z: player.position.z,
        ground: body.groundHeight,
        hop: body.hopClearance,
        speed: Math.hypot(player.velocity.x, player.velocity.z),
      });
    };
    record();
    context.dt = dt;
    let seconds = 0;
    let arrived = false;
    let maxStrides = 1;
    while (navigator.isNavigating && seconds < 90) {
      context.elapsed += dt;
      context.frame += 1;
      strides.step(context, navigator, player, null, record);
      maxStrides = Math.max(maxStrides, strides.lastStrides);
      seconds += dt;
      if (!navigator.isNavigating) {
        arrived = Math.hypot(target.x - player.position.x, target.z - player.position.z) <= ARRIVE_RADIUS + 1e-6;
      }
    }
    // Hands off: she comes to rest wherever she comes to rest.
    for (let i = 0; i < Math.ceil(1.5 / dt); i += 1) {
      context.elapsed += dt;
      strides.step(context, navigator, player, null, record);
    }
    const restDistance = Math.hypot(target.x - player.position.x, target.z - player.position.z);
    let tunnels = 0;
    let firstTunnel: string | null = null;
    let maxStride = 0;
    let maxSpeed = 0;
    for (let i = 1; i < trace.length; i += 1) {
      const a = trace[i - 1] as Stride;
      const b = trace[i] as Stride;
      maxStride = Math.max(maxStride, Math.hypot(b.x - a.x, b.z - a.z));
      maxSpeed = Math.max(maxSpeed, b.speed);
      const hit = tunnelAt(a, b);
      if (debugAt && Math.hypot(b.x - debugAt[0], b.z - debugAt[1]) < 1.5) {
        process.stderr.write(`${mode} dt=${dt.toFixed(3)} (${b.x.toFixed(2)},${b.y.toFixed(2)},${b.z.toFixed(2)}) ground=${b.ground.toFixed(2)} hop=${b.hop.toFixed(2)} speed=${b.speed.toFixed(1)} ${hit ?? ''}\n`);
      }
      if (hit) {
        tunnels += 1;
        firstTunnel ??= hit;
      }
    }
    player.setTravelBoost = realBoost;
    return {
      run: { arrived, seconds, restDistance, maxSpeed, maxStride, maxStrides, tunnels, firstTunnel },
      metres,
      cruise,
      samples: trace.length,
    };
  };

  const journeys: JourneyReport[] = [];
  for (const pair of chosen) {
    for (const dt of FRAME_STEPS) {
      const dash = runJourney(pair, dt, 'dash');
      const walk = runJourney(pair, dt, 'walk');
      journeys.push({
        from: [pair.from.x, pair.from.z],
        to: [pair.to.x, pair.to.z],
        metres: dash.metres,
        cruise: dash.cruise,
        dt,
        dash: dash.run,
        walk: walk.run,
      });
    }
  }
  // **The instrument's control.** A child walked straight across the park at
  // foot level, through whatever stands in the way, in 0.5 m strides — what a
  // dash with no collision at all would trace. The sweep must find tunnels in
  // it; switching collision off in the real player cannot give this, because
  // her wedge and drop guards keep her out of solids on their own, and a
  // routed journey goes round them anyway.
  const across = longest[0] as Pair;
  const straight: Stride[] = [];
  const acrossMetres = Math.hypot(across.to.x - across.from.x, across.to.z - across.from.z);
  for (let d = 0; d <= acrossMetres; d += DASH_STRIDE) {
    const x = across.from.x + ((across.to.x - across.from.x) * d) / acrossMetres;
    const z = across.from.z + ((across.to.z - across.from.z) * d) / acrossMetres;
    const ground = terrainHeight(x, z);
    straight.push({ x, y: ground, z, ground, hop: 0, speed: 0 });
  }
  let controlTunnels = 0;
  for (let i = 1; i < straight.length; i += 1) {
    if (tunnelAt(straight[i - 1] as Stride, straight[i] as Stride)) controlTunnels += 1;
  }
  const control = { run: { tunnels: controlTunnels }, samples: straight.length };
  const report: SeedReport = {
    seed,
    longestRoute: pairs[0]?.metres ?? 0,
    journeys,
    controlTunnels: control.run.tunnels,
    controlSamples: control.samples,
  };
  console.log(JSON.stringify(report));
}

// ==================================================================== parent

const failures: string[] = [];
const check = (ok: boolean, what: string): void => {
  console.log(`${ok ? '  ok ' : 'FAIL '} ${what}`);
  if (!ok) failures.push(what);
};

function curve(): void {
  console.log('\n— the curve (tapDash.ts) —');
  const v = PLAYER_MAX_SPEED;
  const sprint = v * PLAYER_SPRINT_MULTIPLIER;
  let walkBelow = true;
  let firstNonWalk = '';
  let monotonic = true;
  let worstDrop = '';
  let underCap = true;
  let overCap = '';
  let sprintPast = true;
  let slowPast = '';
  let previous = 0;
  for (let L = 0.05; L <= 1000; L += 0.05) {
    const t = dashSeconds(L);
    const speed = dashCruiseSpeed(L);
    if (L / v <= DASH_WALK_SECONDS && speed !== v && walkBelow) {
      walkBelow = false;
      firstNonWalk = `${L.toFixed(2)} m runs at ${speed.toFixed(3)} m/s`;
    }
    if (t < previous - 1e-9 && monotonic) {
      monotonic = false;
      worstDrop = `${L.toFixed(2)} m takes ${t.toFixed(4)} s, the journey before it ${previous.toFixed(4)} s`;
    }
    if (!(t < DASH_CRUISE_SECONDS) && underCap) {
      underCap = false;
      overCap = `${L.toFixed(2)} m takes ${t.toFixed(3)} s`;
    }
    if (L / v >= 3.5 && speed < sprint - 1e-9 && sprintPast) {
      sprintPast = false;
      slowPast = `${L.toFixed(2)} m (${(L / v).toFixed(2)} s at a walk) runs at ${speed.toFixed(2)} m/s`;
    }
    previous = t;
  }
  check(walkBelow, `every journey of ${DASH_WALK_SECONDS} s or less at a walk (≤ ${DASH_THRESHOLD_METRES.toFixed(2)} m) is walked at ${v} m/s${walkBelow ? '' : ` — ${firstNonWalk}`}`);
  const jump = dashCruiseSpeed(DASH_THRESHOLD_METRES + 1e-6) - v;
  check(Math.abs(jump) < 1e-4, `continuous at the threshold: speed just past ${DASH_THRESHOLD_METRES.toFixed(2)} m differs from the walk by ${jump.toExponential(2)} m/s`);
  check(monotonic, `travel time never falls as the journey grows (0-1000 m at 5 cm)${monotonic ? '' : ` — ${worstDrop}`}`);
  check(
    underCap && DASH_CRUISE_SECONDS < DASH_MAX_SECONDS,
    `no journey cruises for ${DASH_CRUISE_SECONDS} s (1 km: ${dashSeconds(1000).toFixed(3)} s), under the ${DASH_MAX_SECONDS} s door-to-door cap${underCap ? '' : ` — ${overCap}`}`,
  );
  check(sprintPast, `every journey of 3.5 s or more at a walk runs at least a sprint (${sprint.toFixed(1)} m/s)${sprintPast ? '' : ` — ${slowPast}`}`);
  check(
    DASH_STRIDE <= PLAYER_LONGEST_STEP && DASH_STRIDE < ARRIVE_RADIUS && DASH_STRIDE < WAYPOINT_RADIUS,
    `a stride (${DASH_STRIDE} m) fits PLAYER_LONGEST_STEP (${PLAYER_LONGEST_STEP.toFixed(3)}), ARRIVE_RADIUS (${ARRIVE_RADIUS}) and WAYPOINT_RADIUS (${WAYPOINT_RADIUS})`,
  );
  const fastest = dashCruiseSpeed(300);
  check(
    (fastest * MAX_FRAME_DELTA) / dashSubsteps(fastest, MAX_FRAME_DELTA) <= DASH_STRIDE + 1e-9 && dashSubsteps(fastest, MAX_FRAME_DELTA) <= DASH_MAX_STRIDES,
    `a 300 m dash at the clamped frame is cut into ${dashSubsteps(fastest, MAX_FRAME_DELTA)} strides of ≤ ${DASH_STRIDE} m`,
  );
  check(dashBoostNow(dashBoost(150), 0.5) === 1, `the brake hands over to the walk by the marker (boost ${dashBoostNow(dashBoost(150), 0.5)} at 0.5 m out; brake starts ${(v * DASH_BRAKE_SECONDS).toFixed(2)} m out)`);
  check(DASH_CADENCE_SPEED > sprint, `the leg cadence cap (${DASH_CADENCE_SPEED.toFixed(1)} m/s) is above a sprint, so no walk or sprint cycle changes`);
  console.log('    route   at a walk   dash speed   travel');
  for (const L of [5, DASH_THRESHOLD_METRES, 24, 50, 100, 200, 280]) {
    console.log(`  ${L.toFixed(1).padStart(6)} m ${(L / v).toFixed(2).padStart(8)} s ${dashCruiseSpeed(L).toFixed(1).padStart(9)} m/s ${dashSeconds(L).toFixed(2).padStart(6)} s`);
  }
}

async function parent(): Promise<void> {
  curve();
  const lanes = Math.max(1, Math.min(Number(process.env['LGP_LANES'] ?? 2), cpus().length, SEEDS.length));
  process.stderr.write(`check:tap-dash: ${SEEDS.length} parks, ${lanes} at a time\n`);
  const queue = [...SEEDS];
  const reports = new Map<number, SeedReport>();
  await Promise.all(
    Array.from({ length: lanes }, async () => {
      for (;;) {
        const seed = queue.shift();
        if (seed === undefined) return;
        const started = Date.now();
        const { stdout } = await run(process.execPath, [...process.execArgv, HERE], {
          env: { ...process.env, LGP_SEED: String(seed), LGP_TAP_DASH_CHILD: '1' },
          maxBuffer: 64 * 1024 * 1024,
        });
        reports.set(seed, JSON.parse(stdout.trim().split('\n').pop() as string) as SeedReport);
        process.stderr.write(`  seed ${seed} walked in ${((Date.now() - started) / 1000).toFixed(1)} s\n`);
      }
    }),
  );

  for (const seed of SEEDS) {
    const report = reports.get(seed);
    if (!report) {
      check(false, `seed ${seed}: the park never reported back`);
      continue;
    }
    console.log(`\n— seed ${seed}: ${report.journeys.length} runs, longest route ${report.longestRoute.toFixed(1)} m —`);
    // The instrument first: it must see tunnels where there are tunnels.
    check(
      report.controlTunnels > 0,
      `seed ${seed}: control — the sweep finds ${report.controlTunnels} tunnel stride(s) of ${report.controlSamples} on a straight line through the park`,
    );
    const walkTunnels = report.journeys.reduce((sum, j) => sum + j.walk.tunnels, 0);
    check(walkTunnels === 0, `seed ${seed}: control — the sweep finds ${walkTunnels} tunnel stride(s) on the walked journeys`);

    console.log('      route   dt     cruise  cruise s  dash s  walk s  rest dash/walk  max stride  strides');
    const shortOnes: string[] = [];
    const gaveUp: string[] = [];
    const restWorse: string[] = [];
    const late: string[] = [];
    const tunnelled: string[] = [];
    const longStride: string[] = [];
    let shortCount = 0;
    let comparable = 0;
    let arrivedCount = 0;
    let longestSeconds = Infinity;
    let longestMetres = 0;
    let slowest = 0;
    for (const journey of report.journeys) {
      const { dash, walk } = journey;
      const label = `${journey.metres.toFixed(1)} m at dt 1/${Math.round(1 / journey.dt)}`;
      console.log(
        `   ${journey.metres.toFixed(1).padStart(7)} m 1/${String(Math.round(1 / journey.dt)).padEnd(3)} ${journey.cruise.toFixed(2).padStart(6)}x ${dashSeconds(journey.metres).toFixed(2).padStart(7)} s ${dash.seconds.toFixed(2).padStart(6)} ${walk.seconds.toFixed(2).padStart(7)} ${dash.restDistance.toFixed(2).padStart(8)}/${walk.restDistance.toFixed(2)} ${dash.maxStride.toFixed(2).padStart(9)} m ${String(dash.maxStrides).padStart(5)}`,
      );
      if (journey.metres <= DASH_THRESHOLD_METRES) {
        shortCount += 1;
        if (!(journey.cruise === 1 && dash.maxSpeed <= PLAYER_MAX_SPEED + 1e-6)) {
          shortOnes.push(`${label}: cruise ${journey.cruise.toFixed(2)}x, top speed ${dash.maxSpeed.toFixed(2)} m/s`);
        }
      }
      if (walk.arrived) {
        comparable += 1;
        if (!dash.arrived) gaveUp.push(`${label}: the walk arrives, the dash gave up ${dash.restDistance.toFixed(2)} m out`);
        if (dash.restDistance > Math.max(walk.restDistance, ARRIVE_RADIUS) + REST_SLACK) {
          restWorse.push(`${label}: rests ${dash.restDistance.toFixed(2)} m from the marker, the walk ${walk.restDistance.toFixed(2)} m`);
        }
      }
      if (dash.arrived) {
        arrivedCount += 1;
        slowest = Math.max(slowest, dash.seconds);
        if (dash.seconds > ARRIVE_BY) late.push(`${label}: ${dash.seconds.toFixed(2)} s`);
        if (journey.metres > longestMetres + 1e-6) {
          longestMetres = journey.metres;
          longestSeconds = dash.seconds;
        } else if (Math.abs(journey.metres - longestMetres) <= 1e-6) {
          longestSeconds = Math.min(longestSeconds, dash.seconds);
        }
      }
      if (dash.tunnels > 0) tunnelled.push(`${label}: ${dash.tunnels} stride(s), first ${dash.firstTunnel}`);
      if (dash.maxStride > PLAYER_LONGEST_STEP + 1e-6) longStride.push(`${label}: ${dash.maxStride.toFixed(3)} m`);
    }
    const listed = (items: readonly string[]): string => (items.length === 0 ? '' : ` — ${items.slice(0, 4).join('; ')}${items.length > 4 ? `; and ${items.length - 4} more` : ''}`);
    check(shortCount > 0 && shortOnes.length === 0, `seed ${seed}: ${shortCount} short journeys (≤ ${DASH_WALK_SECONDS} s at a walk) never go faster than the walk${listed(shortOnes)}`);
    check(comparable > 0 && gaveUp.length === 0, `seed ${seed}: the dash arrives on all ${comparable} runs the walk completes${listed(gaveUp)}`);
    check(restWorse.length === 0, `seed ${seed}: the dash comes to rest no further from the marker than the walk (+${REST_SLACK} m)${listed(restWorse)}`);
    check(arrivedCount > 0 && late.length === 0, `seed ${seed}: every dash arrives within ${ARRIVE_BY} s door to door (slowest ${slowest.toFixed(2)} s)${listed(late)}`);
    check(
      longestSeconds >= LONGEST_AT_LEAST && longestSeconds <= ARRIVE_BY,
      `seed ${seed}: the longest route walked (${longestMetres.toFixed(1)} m) takes ${longestSeconds.toFixed(2)} s — "about 4 s" (${LONGEST_AT_LEAST}-${ARRIVE_BY} s)`,
    );
    check(tunnelled.length === 0, `seed ${seed}: no tunnelling on any of ${report.journeys.length} dashes${listed(tunnelled)}`);
    check(longStride.length === 0, `seed ${seed}: no stride longer than PLAYER_LONGEST_STEP (${PLAYER_LONGEST_STEP.toFixed(3)} m)${listed(longStride)}`);
    const skipped = report.journeys.filter((j) => !j.walk.arrived).length;
    process.stderr.write(`check:tap-dash: seed ${seed}: ${skipped} of ${report.journeys.length} runs the walk itself could not finish — their arrival clauses assert nothing\n`);
  }

  if (failures.length > 0) {
    console.log(`\ncheck:tap-dash: ${failures.length} failure(s)`);
    process.exit(1);
  }
  console.log('\ncheck:tap-dash: all clear');
}

if (process.env['LGP_TAP_DASH_CHILD'] === '1') {
  await child(Number(process.env['LGP_SEED']));
} else {
  await parent();
}
