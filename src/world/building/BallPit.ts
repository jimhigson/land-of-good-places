import {
  Color,
  CylinderGeometry,
  DoubleSide,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  Quaternion,
  SphereGeometry,
  TorusGeometry,
  Vector3,
} from 'three';
import { PALETTE } from '../../core/palette';
import { castAndReceive, softMaterial } from './parts';
import { BALL_PIT_COUNT } from '../../core/constants';
import { BALL_PIT_DEPTH, BALL_PIT_RADIUS, BALL_PIT_X, BALL_PIT_Z } from './layout';
import { terrainHeight } from '../terrain';
import {
  BALL_PHYSICS_STEP,
  BallPitSimulation,
  type PlayerContact,
  type StepStats,
} from './ballPhysics';
import type { Player } from '../../entities/Player';

/** The bowl takes light but does not cast: it sits in its own hole. */
function receiveOnly(mesh: Mesh): Mesh {
  mesh.castShadow = false;
  mesh.receiveShadow = true;
  return mesh;
}

/**
 * Smaller than the old spring pit's 0.34 — deliberately. At 4x-plus the
 * count, balls this size packed into the same floor area take a genuinely
 * long time (many seconds of simmering) for the AABB/MTV solver to untangle
 * down to a still pile; a bit smaller gives everyone enough elbow room that
 * the pit reaches a proper rest instead of a permanent low-grade jiggle —
 * see the PR description for the before/after numbers.
 */
const BALL_RADIUS = 0.28;

/** How close to the wall a ball's centre is allowed, so it never visibly clips it. */
const CONTAIN_RADIUS = BALL_PIT_RADIUS - BALL_RADIUS - 0.5;
const REST_Y = -BALL_PIT_DEPTH + BALL_RADIUS;

/** Wading: how big a bubble around the player's feet shoves balls aside. */
const PLAYER_PUSH_RADIUS = 0.95;
const PLAYER_PUSH_HEIGHT = 1.3;
/** Only bother finding/pushing the player when within this much of the pit —
 *  cheap early-out for every frame spent anywhere else in the park. */
const PLAYER_RELEVANCE_MARGIN = 2;

/** Landing: bigger than the old spring pit's 4.2, so a splash reaches the walls. */
const SPLASH_RADIUS = 6.6;
const SPLASH_OUT_STRENGTH = 9;
const SPLASH_UP_STRENGTH = 6.5;

/**
 * Spawned balls start stacked in loose layers, not resting — dropping 900 of
 * them from scratch takes a few seconds of simulated time to fall and settle
 * into a pile. That settling has to happen *somewhere*, but not all at once
 * in the constructor: running 6 seconds of simulation synchronously before
 * the first frame renders would visibly delay boot. Instead it is spread
 * across the first real frames of `update()` (see `warmupSecondsRemaining`
 * below) — a handful of frames' worth of extra physics, invisible against a
 * game that has plenty else to draw before anyone could possibly reach the
 * pit, and the player still always finds an already-settled pile.
 */
const WARMUP_SECONDS = 6;
/** {@link WARMUP_SECONDS} in the simulation's own sub-steps — 360. */
const WARMUP_SUBSTEPS = Math.round(WARMUP_SECONDS / BALL_PHYSICS_STEP);
/**
 * How much of a frame the warm-up may spend, in milliseconds: a quarter of a
 * 120 Hz frame (8.3 ms). At least one sub-step runs every frame regardless, so
 * a slow device still settles the pile, just over more frames.
 *
 * It used to catch up a fixed five sub-steps (5/60 s) a frame, the most a real
 * frame's `step()` can do. With all 900 balls awake and falling that cost
 * **34–41 ms a frame** for the first second (docs/perf/FRAME-DROPS-2026-11.md,
 * "ball physics start-up") — four 120 Hz frames' worth, every frame. The
 * sub-steps, their order and their count are unchanged, so the settled pile is
 * bit-for-bit the one the old schedule reached (`test/building/ballPacing.test.ts`);
 * only how many land in each frame is different.
 */
const WARMUP_FRAME_BUDGET_MS = 2;

const COLOURS = [
  PALETTE.ballPitA,
  PALETTE.ballPitB,
  PALETTE.ballPitC,
  PALETTE.ballPitD,
  PALETTE.ballPitE,
];

/**
 * The pit of squishy balls the ginormous slide lands in.
 *
 * One instanced mesh, one draw call — but real (if deliberately simple)
 * physics underneath: a uniform spatial hash grid for broad phase, AABB
 * overlap + minimum-translation-vector separation for narrow phase, and a
 * sleep system so a settled pile costs nothing per frame. See
 * `ballPhysics.ts` for the simulation itself; this file is just the three.js
 * wiring — geometry, the instanced mesh, and translating world events
 * (a landing, the player wading through) into pit-local physics calls.
 *
 * Local space — the group sits on the `ballPit` anchor, so y = 0 is the grass.
 */
export class BallPit {
  readonly group = new Group();

  private readonly sim: BallPitSimulation;
  private readonly mesh: InstancedMesh;
  private readonly matrix = new Matrix4();
  private readonly position = new Vector3();
  private readonly rotation = new Quaternion();
  private readonly scale = new Vector3(1, 1, 1);

  /** Handed in by `Building.attachPlayer`, which already holds the real
   *  reference — see {@link attachPlayer}. */
  private player: Player | null = null;
  /** World-space Y of the pit's own anchor, so the player's world Y can be
   *  converted to pit-local. Computed once: the anchor never moves. */
  private readonly groundWorldY: number;
  private lastAwake = -1; // -1 = "never stepped yet", forces the first step to run.
  /** Sub-steps still owed to the settling warm-up — see `WARMUP_SECONDS`
   *  above. Paid off within a per-frame budget from `update()` rather than all
   *  at once in the constructor. */
  private warmupSubstepsRemaining = WARMUP_SUBSTEPS;

  /** Timing/activity from the most recent physics step. Not read by gameplay
   *  — poke `window.game.world.building.ballPit.lastStats` from the console
   *  when profiling. */
  lastStats: StepStats | null = null;

  constructor() {
    this.group.name = 'ball-pit';
    this.groundWorldY = terrainHeight(BALL_PIT_X, BALL_PIT_Z);

    // The scooped floor and a chunky rim to sit on.
    const floor = receiveOnly(
      new Mesh(
        new CylinderGeometry(BALL_PIT_RADIUS, BALL_PIT_RADIUS * 0.94, 0.3, 40),
        softMaterial(PALETTE.stonePinkLight, 0.9),
      ),
    );
    floor.position.y = -BALL_PIT_DEPTH - 0.15;
    this.group.add(floor);

    // Open-ended cylinder, drawn on both sides: you look into the bowl.
    const wallMaterial = softMaterial(PALETTE.stonePink, 0.88);
    wallMaterial.side = DoubleSide;
    const wall = receiveOnly(
      new Mesh(
        new CylinderGeometry(BALL_PIT_RADIUS + 0.35, BALL_PIT_RADIUS + 0.45, 1.1, 40, 1, true),
        wallMaterial,
      ),
    );
    wall.position.y = -BALL_PIT_DEPTH + 0.55;
    this.group.add(wall);

    const rim = castAndReceive(
      new Mesh(
        new TorusGeometry(BALL_PIT_RADIUS + 0.4, 0.3, 10, 44),
        softMaterial(PALETTE.markerPink, 0.6),
      ),
    );
    // Sits at the rim of the hole, not inside it — but it never casts either:
    // like the bowl, its shadow would land on a hole nobody can see into.
    rim.castShadow = false;
    rim.rotation.x = Math.PI / 2;
    rim.position.y = -BALL_PIT_DEPTH + 1.1;
    this.group.add(rim);

    // The balls: one instanced mesh, real physics underneath. They sit inside
    // the pit's own hole (ARCHITECTURE.md: nothing in a hole casts a shadow
    // — there is nothing down there for it to land on), so casting is off;
    // they still receive, so the pile reads as lit rather than flat.
    this.mesh = new InstancedMesh(
      new SphereGeometry(BALL_RADIUS, 12, 9),
      softMaterial(0xffffff, 0.42),
      BALL_PIT_COUNT,
    );
    this.mesh.name = 'balls';
    this.mesh.castShadow = false;
    this.mesh.receiveShadow = true;
    this.group.add(this.mesh);

    this.sim = new BallPitSimulation(
      BALL_PIT_COUNT,
      BALL_RADIUS,
      { radius: CONTAIN_RADIUS, restY: REST_Y },
      90210,
    );
    // No synchronous warm-up here any more — it's paid off gradually from
    // `update()` instead, see `warmupSubstepsRemaining`.

    const colour = new Color();
    for (let i = 0; i < BALL_PIT_COUNT; i += 1) {
      colour.setHex(COLOURS[i % COLOURS.length] ?? PALETTE.ballPitA);
      this.mesh.setColorAt(i, colour);
    }
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;

    // One full write up front so the very first rendered frame already shows
    // the spawn layout, rather than a flash of default (origin) matrices.
    this.writeAllMatrices();
  }

  /** Hands the pit the player, so wading can push the balls aside. Called
   *  from `Building.attachPlayer`, which already holds the real reference —
   *  see the field doc on {@link player}. */
  attachPlayer(player: Player): void {
    this.player = player;
  }

  /**
   * Something landed. `x`/`z` are local to the pit; everything nearby is
   * shoved outwards and upwards, hardest at the point of impact.
   */
  splash(x: number, z: number, strength = 1): void {
    this.sim.impulse(
      x,
      z,
      SPLASH_RADIUS,
      SPLASH_OUT_STRENGTH * strength,
      SPLASH_UP_STRENGTH * strength,
    );
    this.lastAwake = this.sim.count; // wake the fast-path check below immediately
  }

  /**
   * **Pays off the whole settling warm-up now**, without the per-frame budget.
   * For `?clock=` only (`core/checkClock.ts`): a check that audits one moment
   * cannot have the pile half-fallen on a slow machine and settled on a fast
   * one, and spread over frames by milliseconds it would be. The pile reached
   * is the same either way — {@link WARMUP_FRAME_BUDGET_MS}'s note: the
   * sub-steps, their order and their count do not depend on how many land in
   * each frame. A no-op once the warm-up is paid.
   */
  settleNow(): void {
    if (this.warmupSubstepsRemaining <= 0) return;
    this.warmupSubstepsRemaining -= this.sim.settle(this.warmupSubstepsRemaining, Number.POSITIVE_INFINITY);
    this.writeDirtyMatrices();
  }

  update(dt: number, elapsed: number): void {
    void elapsed; // kept in the signature: Building.ts calls update(dt, elapsed)

    // Settling the freshly-spawned pile is spread across the first real
    // frames rather than done synchronously in the constructor (see
    // `WARMUP_SECONDS` above) — a bounded slice of each frame, invisible
    // against everything else the game has to draw before anyone could
    // possibly reach the pit.
    if (this.warmupSubstepsRemaining > 0) {
      this.warmupSubstepsRemaining -= this.sim.settle(
        this.warmupSubstepsRemaining,
        WARMUP_FRAME_BUDGET_MS,
      );
      this.writeDirtyMatrices();
      return;
    }

    const contact = this.buildPlayerContact();

    // Nothing to simulate: the pile is fully asleep and nobody is wading.
    if (!contact && this.lastAwake === 0) return;

    const stats = this.sim.step(dt, contact);
    this.lastAwake = stats.awake;
    this.lastStats = stats;

    this.writeDirtyMatrices();
  }

  /**
   * The player's position, converted to pit-local coordinates, or `null` if
   * they are nowhere near the pit (or haven't been attached yet).
   */
  private buildPlayerContact(): PlayerContact | null {
    if (!this.player) return null;

    const world = this.player.position;
    const localX = world.x - BALL_PIT_X;
    const localZ = world.z - BALL_PIT_Z;
    const horizontalDistance = Math.hypot(localX, localZ);
    const relevantWithin = CONTAIN_RADIUS + PLAYER_PUSH_RADIUS + PLAYER_RELEVANCE_MARGIN;
    if (horizontalDistance > relevantWithin) return null;

    return {
      x: localX,
      z: localZ,
      y: world.y - this.groundWorldY,
      radius: PLAYER_PUSH_RADIUS,
      height: PLAYER_PUSH_HEIGHT,
    };
  }

  private writeAllMatrices(): void {
    for (let i = 0; i < this.sim.count; i += 1) this.writeMatrix(i);
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  /** Only balls whose *drawn* position moved this frame get a matrix rewrite
   *  — a settled pile with nobody nearby costs one boolean check per ball.
   *  Drawn, not simulated: at 120 Hz half the frames run no sub-step at all,
   *  and a moving ball still has to move on those (`ballPhysics.ts`). */
  private writeDirtyMatrices(): void {
    let changed = false;
    for (let i = 0; i < this.sim.count; i += 1) {
      if (!this.sim.drawDirty[i]) continue;
      this.writeMatrix(i);
      changed = true;
    }
    if (changed) this.mesh.instanceMatrix.needsUpdate = true;
  }

  /** Draws ball `i` where the simulation says to draw it this frame — its
   *  interpolated position ({@link BallPitSimulation.drawX}), never the raw
   *  physics state, which only moves on frames that ran a sub-step. */
  private writeMatrix(i: number): void {
    this.position.set(this.sim.drawX[i] ?? 0, this.sim.drawY[i] ?? 0, this.sim.drawZ[i] ?? 0);
    this.matrix.compose(this.position, this.rotation, this.scale);
    this.mesh.setMatrixAt(i, this.matrix);
  }
}
