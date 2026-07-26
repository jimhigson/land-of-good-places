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
import { BALL_PIT_COUNT } from '../../core/constants';
import { PALETTE } from '../../core/palette';
import { Rng, TAU } from '../../core/mathUtils';
import { castAndReceive, softMaterial } from './parts';
import { BALL_PIT_DEPTH, BALL_PIT_RADIUS } from './layout';

/** The bowl takes light but does not cast: it sits in its own hole. */
function receiveOnly(mesh: Mesh): Mesh {
  mesh.castShadow = false;
  mesh.receiveShadow = true;
  return mesh;
}

const BALL_RADIUS = 0.34;
/** Spring constant and damping for a ball finding its way home again. */
const SPRING = 26;
const DAMPING = 5.2;

const COLOURS = [
  PALETTE.ballPitA,
  PALETTE.ballPitB,
  PALETTE.ballPitC,
  PALETTE.ballPitD,
  PALETTE.ballPitE,
];

interface Ball {
  readonly restX: number;
  readonly restY: number;
  readonly restZ: number;
  readonly phase: number;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
}

/**
 * The pit of squishy balls the ginormous slide lands in.
 *
 * One instanced mesh, one draw call, and no physics engine: every ball is a
 * spring pulling it back to the spot it belongs in. Land in the middle and they
 * all shove outwards and then come bobbing back, which is the whole gag.
 *
 * Local space — the group sits on the `ballPit` anchor, so y = 0 is the grass.
 */
export class BallPit {
  readonly group = new Group();

  private readonly balls: Ball[] = [];
  private readonly mesh: InstancedMesh;
  private readonly matrix = new Matrix4();
  private readonly position = new Vector3();
  private readonly rotation = new Quaternion();
  private readonly scale = new Vector3(1, 1, 1);
  private settled = false;

  constructor() {
    this.group.name = 'ball-pit';

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
    rim.rotation.x = Math.PI / 2;
    rim.position.y = -BALL_PIT_DEPTH + 1.1;
    this.group.add(rim);

    // The balls: two loose layers on a jittered spiral, so no grid shows.
    this.mesh = new InstancedMesh(
      new SphereGeometry(BALL_RADIUS, 12, 9),
      softMaterial(0xffffff, 0.42),
      BALL_PIT_COUNT,
    );
    this.mesh.name = 'balls';
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    this.group.add(this.mesh);

    const rng = new Rng(90210);
    const colour = new Color();
    for (let i = 0; i < BALL_PIT_COUNT; i += 1) {
      const radius = Math.sqrt(rng.unit()) * (BALL_PIT_RADIUS - BALL_RADIUS - 0.5);
      const angle = rng.unit() * TAU;
      const layer = i % 2;
      const ball: Ball = {
        restX: Math.cos(angle) * radius,
        restY: -BALL_PIT_DEPTH + BALL_RADIUS + layer * BALL_RADIUS * 1.5 + rng.range(0, 0.12),
        restZ: Math.sin(angle) * radius,
        phase: rng.unit() * TAU,
        x: 0,
        y: 0,
        z: 0,
        vx: 0,
        vy: 0,
        vz: 0,
      };
      this.balls.push(ball);
      colour.setHex(COLOURS[i % COLOURS.length] ?? PALETTE.ballPitA);
      this.mesh.setColorAt(i, colour);
    }
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
    this.writeMatrices(0);
  }

  /**
   * Something landed. `x`/`z` are local to the pit; everything nearby is shoved
   * outwards and upwards, hardest at the point of impact.
   */
  splash(x: number, z: number, strength = 1): void {
    for (const ball of this.balls) {
      const dx = ball.restX + ball.x - x;
      const dz = ball.restZ + ball.z - z;
      const distance = Math.hypot(dx, dz);
      if (distance > 4.2) continue;
      const falloff = (1 - distance / 4.2) ** 2;
      const push = (5.6 * strength * falloff) / Math.max(0.45, distance);
      ball.vx += dx * push;
      ball.vz += dz * push;
      ball.vy += (2.8 + falloff * 4.5) * strength;
    }
    this.settled = false;
  }

  update(dt: number, elapsed: number): void {
    if (this.settled) {
      this.writeMatrices(elapsed);
      return;
    }

    let moving = false;
    for (const ball of this.balls) {
      ball.vx += (-ball.x * SPRING - ball.vx * DAMPING) * dt;
      ball.vy += (-ball.y * SPRING - ball.vy * DAMPING) * dt;
      ball.vz += (-ball.z * SPRING - ball.vz * DAMPING) * dt;
      ball.x += ball.vx * dt;
      ball.y += ball.vy * dt;
      ball.z += ball.vz * dt;
      if (!moving && Math.abs(ball.x) + Math.abs(ball.y) + Math.abs(ball.z) > 0.004) moving = true;
    }
    this.settled = !moving;
    this.writeMatrices(elapsed);
  }

  private writeMatrices(elapsed: number): void {
    for (let i = 0; i < this.balls.length; i += 1) {
      const ball = this.balls[i];
      if (!ball) continue;
      // A permanent lazy bob keeps the pit alive even when nothing has landed.
      const idle = Math.sin(elapsed * 1.3 + ball.phase) * 0.035;
      this.position.set(
        ball.restX + ball.x,
        ball.restY + ball.y + idle,
        ball.restZ + ball.z,
      );
      this.matrix.compose(this.position, this.rotation, this.scale);
      this.mesh.setMatrixAt(i, this.matrix);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}
