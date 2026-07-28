import {
  BoxGeometry,
  CylinderGeometry,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  Quaternion,
  Vector3,
} from 'three';
import { CoasterRoute, checkCoasterClearances, STATION_HEIGHT } from './route';
import { RideCamera } from '../../core/RideCamera';
import { toonMaterial } from '../../art/style/materials';
import { addOutline } from '../../art/style/materials';
import { PALETTE } from '../../core/palette';
import { terrainHeight } from '../terrain';
import { distanceToPath } from '../paths';
import { PARK_LAYOUT } from '../parkLayout';
import type { CollisionWorld } from '../Collision';
import type { FrameContext, GameSystem } from '../../core/types';
import type { Player } from '../../entities/Player';
import type { ParkTrain } from '../train';
import { placedEntry } from '../parkLayout';

/**
 * The rollercoaster — the rail racer grown up (Decision 4 C4/C5).
 *
 * The 2D mini-scene is retired: the rail racer's stall is now the way onto a
 * real elevated ride in the real park, on a track the solver grew
 * (`coaster/route.ts`), ridden in first person through the same shared
 * {@link RideCamera} as the ferris wheel and the train — with the coaster's
 * one difference, a ±120° yaw limit, so a child looks *along* the ride the
 * way the real thing insists you do.
 *
 * The cart is honest, gentle physics: a chain lift to the first crest, then
 * energy trade the rest of the way round, braked into the station. You
 * cannot fall out, fall off, or lose — this is still Land of Good Places.
 */

const CHAIN_SPEED = 3.4;
const MIN_SPEED = 4.2;
const MAX_SPEED = 15;
const STATION_SPEED = 2.6;
const GRAVITY = 6.5; // gentler than earth; a cosy park has cosy physics
const EYE = { x: 0, y: 0.95, z: 0 };

export interface CoasterOptions {
  readonly name: string;
  readonly routeSalt: number;
  readonly stationStallId: string;
  /**
   * 'firstPerson': the eye in her head, model hidden (the Sky Cruiser).
   * 'chase': the camera just behind and above her head, model visible —
   * the Rail Race, where seeing her duck is the game.
   */
  readonly camera: 'firstPerson' | 'chase';
  /** The Rail Race: hold to accelerate, release to duck under barriers. */
  readonly race?: boolean;
  readonly avoid?: Coaster | null;
  readonly bandMin?: number;
  readonly bandMax?: number;
  readonly nominal?: number;
}

export class Coaster implements GameSystem {
  readonly name: string;
  /** True when the camera style leaves her model on screen. */
  readonly playerStaysVisible: boolean;
  readonly group = new Group();
  readonly route: CoasterRoute;

  rideView: RideCamera | null = null;
  onRideChange: ((riding: boolean) => void) | null = null;

  private readonly cart: Group;
  private readonly cartMount: Group;
  private player: Player | null = null;
  private riding = false;
  private distance: number;
  private speed = 0;
  private phase: 'waiting' | 'chain' | 'coasting' | 'braking' = 'waiting';
  private readonly point = new Vector3();
  private readonly tangent = new Vector3();
  private crestDistance = 0;

  // --- the race (options.race) -------------------------------------------
  /** Distances along the loop of the duck-under barriers. */
  readonly barrierDistances: number[] = [];
  private ducking = false;
  private bonkWobble = 0;
  /** The rival's cart: same loop, the parallel track's offset. Its child,
   *  its AI polish and the race framing are the delegated half. */
  private rivalCart: Group | null = null;
  private rivalDistance = 0;
  private rivalSpeed = 0;

  private readonly options: CoasterOptions;

  constructor(collision: CollisionWorld, train: ParkTrain, options: CoasterOptions) {
    this.options = options;
    this.name = options.name;
    this.playerStaysVisible = options.camera === 'chase';
    this.group.name = options.name;
    this.route = new CoasterRoute({
      salt: options.routeSalt,
      stationStallId: options.stationStallId,
      avoid: options.avoid?.route ?? null,
      ...(options.bandMin !== undefined ? { bandMin: options.bandMin } : {}),
      ...(options.bandMax !== undefined ? { bandMax: options.bandMax } : {}),
      ...(options.nominal !== undefined ? { nominal: options.nominal } : {}),
    });
    this.distance = this.route.stationDistance;

    // Boot assert, in the claim-versus-fact tradition: report loudly and
    // refuse to pretend, never quietly adjust.
    const complaints = checkCoasterClearances(this.route, (x, z) => {
      const d = train.route.distanceNear(x, z);
      const p = train.route.pointAt(d, new Vector3());
      return { y: p.y, distance: Math.hypot(p.x - x, p.z - z) };
    });
    for (const complaint of complaints) console.warn(`${options.name}: ${complaint}`);

    this.buildTrack(collision);
    if (options.race) this.buildRace();

    // Find the highest crest's distance, for the chain phase.
    let bestY = -Infinity;
    for (let d = 0; d < this.route.length; d += 1) {
      const y = this.route.pointAt(d, this.point).y;
      if (y > bestY) {
        bestY = y;
        this.crestDistance = d;
      }
    }

    // --- the cart ---------------------------------------------------------
    this.cart = new Group();
    const body = toonBox(1.5, 0.7, 2.2, PALETTE.markerPink);
    body.position.y = 0.35;
    this.cart.add(body);
    const nose = toonBox(1.1, 0.4, 0.5, PALETTE.markerLemon);
    nose.position.set(0, 0.35, 1.3);
    this.cart.add(nose);
    this.cartMount = new Group();
    this.cartMount.position.set(0, 0.6, 0);
    this.cart.add(this.cartMount);
    this.group.add(this.cart);
    this.placeCart();
  }

  /** Lazily, as the train does: the headless park has no player and no DOM. */
  attachPlayer(player: Player): void {
    this.player = player;
    if (this.options.camera === 'firstPerson') {
      this.rideView = new RideCamera({ yawLimit: 2.1, startPitch: -0.06 });
      this.rideView.mountOn(this.cartMount, EYE);
    } else {
      // The chase view: the same shared camera, mounted behind and above the
      // seat, looking along the track with only a little look-around — the
      // point of this view is watching her duck, not steering the eye.
      this.rideView = new RideCamera({ yawLimit: 0.55, startPitch: -0.14, fov: 60 });
      this.rideView.mountOn(this.cartMount, { x: 0, y: 2.1, z: -3.4 });
    }
  }

  /** The stall's interact press lands here instead of opening the 2D game. */
  requestBoard(): boolean {
    if (this.riding || !this.player || this.phase !== 'waiting') return false;
    this.riding = true;
    this.player.beginRide();
    this.phase = 'chain';
    this.speed = CHAIN_SPEED;
    this.onRideChange?.(true);
    return true;
  }

  update(context: FrameContext): void {
    const { dt } = context;

    if (this.options.race && this.phase !== 'waiting') {
      // The old racer's one button, on real rails: HOLD to go fast, RELEASE
      // to duck. Not holding while passing under a barrier is enough to
      // clear it (the family's rule); a bonk is a wobble and lost speed.
      const input = context.input;
      const holding = input.isDown('jump') || input.isDown('interact');
      this.ducking = !holding;
      const target = holding ? MAX_SPEED * 0.9 : MIN_SPEED * 0.9;
      this.speed += (target - this.speed) * Math.min(1, 3.2 * dt);
      for (const barrier of this.barrierDistances) {
        const gap = Math.abs(this.route.wrap(this.distance - barrier + this.route.length / 2) - this.route.length / 2);
        if (gap < 0.9 && !this.ducking && this.bonkWobble <= 0) {
          this.speed = Math.max(2.5, this.speed * 0.35);
          this.bonkWobble = 1.1;
        }
      }
      this.bonkWobble = Math.max(0, this.bonkWobble - dt);
      const toStation = this.route.wrap(this.route.stationDistance - this.distance);
      if (toStation < 0.8 || toStation > this.route.length - 5) this.arrive();
      this.distance = this.route.wrap(this.distance + this.speed * dt);

      // The rival rubber-bands so the race is always close: quicker when
      // behind, easing when ahead. Personality is the delegated half.
      const lead = this.route.wrap(this.distance - this.rivalDistance + this.route.length / 2) - this.route.length / 2;
      this.rivalSpeed += ((lead > 0 ? 10.5 : 8.2) - this.rivalSpeed) * Math.min(1, 1.6 * dt);
      this.rivalDistance = this.route.wrap(this.rivalDistance + this.rivalSpeed * dt);
      this.placeRival();
    } else if (this.phase !== 'waiting') {
      const height = this.route.pointAt(this.distance, this.point).y;
      const crestHeight = this.route.pointAt(this.crestDistance, this.point).y;
      if (this.phase === 'chain') {
        this.speed = CHAIN_SPEED;
        const pastCrest =
          this.route.wrap(this.distance - this.route.stationDistance) >
          this.route.wrap(this.crestDistance - this.route.stationDistance);
        if (pastCrest) this.phase = 'coasting';
      } else if (this.phase === 'coasting') {
        const drop = Math.max(0, crestHeight - height);
        this.speed = Math.min(MAX_SPEED, Math.max(MIN_SPEED, Math.sqrt(2 * GRAVITY * drop + CHAIN_SPEED ** 2)));
        const toStation = this.route.wrap(this.route.stationDistance - this.distance);
        if (toStation < 24) this.phase = 'braking';
      } else {
        const toStation = this.route.wrap(this.route.stationDistance - this.distance);
        this.speed = Math.max(STATION_SPEED, this.speed - 9 * dt);
        if (toStation < 0.6 || toStation > this.route.length - 5) {
          this.arrive();
        }
      }
      this.distance = this.route.wrap(this.distance + this.speed * dt);
    }

    this.placeCart();

    if (this.riding && this.player) {
      this.rideView?.update(dt, context.elapsed);
      const seat = this.cartMount.getWorldPosition(this.point);
      // Ducking reads from behind: she drops into the cart. The wobble after
      // a bonk shakes the seat a little, cosy not punishing.
      const duckDrop = this.options.race && this.ducking ? 0.52 : 0;
      const wobble = this.bonkWobble > 0 ? Math.sin(this.bonkWobble * 34) * 0.08 * this.bonkWobble : 0;
      this.player.setRidePose(
        seat.x + wobble,
        seat.y - 0.55 - duckDrop,
        seat.z,
        this.cart.rotation.y,
      );
    }
  }

  /** The race's furniture: barriers to duck, and the rival's cart. Placeholder
   *  visuals — the delegated half dresses them. */
  private buildRace(): void {
    const rng = (seed => () => (seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31)(
      this.route.length | 0,
    );
    let d = this.route.stationDistance + 30;
    while (d < this.route.stationDistance + this.route.length - 34) {
      this.barrierDistances.push(this.route.wrap(d));
      d += 22 + rng() * 18;
    }
    const barMaterial = toonMaterial(PALETTE.markerLemon);
    for (const distance of this.barrierDistances) {
      this.route.pointAt(distance, this.point);
      this.route.tangentAt(distance, this.tangent);
      const bar = new Mesh(new BoxGeometry(4.4, 0.22, 0.22), barMaterial);
      bar.position.set(this.point.x, this.point.y + 1.05, this.point.z);
      bar.rotation.y = Math.atan2(this.tangent.x, this.tangent.z) + Math.PI / 2;
      this.group.add(bar);
    }
    this.rivalCart = new Group();
    const body = toonBox(1.5, 0.7, 2.2, PALETTE.markerSky);
    body.position.y = 0.35;
    this.rivalCart.add(body);
    this.group.add(this.rivalCart);
    this.rivalDistance = this.route.stationDistance;
    this.placeRival();
  }

  private placeRival(): void {
    if (!this.rivalCart) return;
    this.route.pointAt(this.rivalDistance, this.point);
    this.route.tangentAt(this.rivalDistance, this.tangent);
    // The parallel track: a cart-width to the side of the solved centre line.
    const sideX = this.tangent.z;
    const sideZ = -this.tangent.x;
    this.rivalCart.position.set(this.point.x + sideX * 1.9, this.point.y, this.point.z + sideZ * 1.9);
    this.rivalCart.rotation.y = Math.atan2(this.tangent.x, this.tangent.z);
  }

  private arrive(): void {
    this.phase = 'waiting';
    this.distance = this.route.stationDistance;
    this.speed = 0;
    if (this.riding && this.player) {
      this.riding = false;
      const stall = placedEntry(this.options.stationStallId);
      const offX = stall.x + (stall.entranceX - stall.x) * 0.4;
      const offZ = stall.z + (stall.entranceZ - stall.z) * 0.4;
      this.player.setRidePose(offX, terrainHeight(offX, offZ), offZ, 0);
      this.player.endRide();
      this.onRideChange?.(false);
    }
  }

  private placeCart(): void {
    this.route.pointAt(this.distance, this.point);
    this.route.tangentAt(this.distance, this.tangent);
    this.cart.position.copy(this.point);
    this.cart.rotation.y = Math.atan2(this.tangent.x, this.tangent.z);
    // Pitch with the track, gently — the mount (and so the rider's eye and
    // the cart's nose) follows the hill it is on.
    this.cart.rotation.x = -Math.asin(Math.max(-0.6, Math.min(0.6, this.tangent.y)));
  }

  private buildTrack(collision: CollisionWorld): void {
    const railMaterial = toonMaterial(PALETTE.markerPink);
    const tieMaterial = toonMaterial(PALETTE.woodLight);
    const pylonMaterial = toonMaterial(PALETTE.stonePinkLight);

    const step = 1.4;
    const segments = Math.ceil(this.route.length / step);
    const railGauge = 0.55;
    const left = new InstancedMesh(new BoxGeometry(0.14, 0.14, step + 0.25), railMaterial, segments);
    const right = new InstancedMesh(new BoxGeometry(0.14, 0.14, step + 0.25), railMaterial, segments);
    const ties = new InstancedMesh(new BoxGeometry(1.5, 0.08, 0.3), tieMaterial, segments);
    const matrix = new Matrix4();
    const rotation = new Quaternion();
    const up = new Vector3(0, 1, 0);
    const forward = new Vector3();
    const side = new Vector3();
    const position = new Vector3();
    const one = new Vector3(1, 1, 1);
    const mid = new Vector3();
    const next = new Vector3();

    const pylonSpots: { x: number; z: number; height: number }[] = [];
    for (let i = 0; i < segments; i += 1) {
      const d = i * step;
      this.route.pointAt(d, mid);
      this.route.pointAt(d + step, next);
      forward.subVectors(next, mid).normalize();
      side.crossVectors(up, forward).normalize();
      rotation.setFromUnitVectors(new Vector3(0, 0, 1), forward);
      for (const [mesh, sideSign] of [
        [left, 1],
        [right, -1],
      ] as const) {
        matrix.compose(position.copy(mid).addScaledVector(side, sideSign * railGauge), rotation, one);
        mesh.setMatrixAt(i, matrix);
      }
      matrix.compose(position.copy(mid).setY(mid.y - 0.12), rotation, one);
      ties.setMatrixAt(i, matrix);

      // A pylon roughly every 6 m, where the ground is genuinely clear —
      // clear of *collision*, clear of the walking network, and clear of the
      // corridors between plots. `isClearCircle` knows nothing about either:
      // a 0.32 m post inflates past a lane's half-width in the nav lattice
      // (one on a spur stranded the ball pit's own doormat), and one in the
      // 5 m gap between two plots pinched it shut for strolling NPCs. The
      // track shrugs off a missing pylon; the walk network cannot shrug off
      // a misplaced one.
      if (i % 4 === 2) {
        const ground = terrainHeight(mid.x, mid.z);
        const height = mid.y - ground;
        const pinchesCorridor = [...PARK_LAYOUT.entries.values()].some(
          (entry) =>
            Math.hypot(mid.x - entry.x, mid.z - entry.z) < entry.boundingRadius + 2.4,
        );
        if (
          height > 1.4 &&
          collision.isClearCircle(mid.x, mid.z, 1.0) &&
          distanceToPath(mid.x, mid.z) > 2.8 &&
          !pinchesCorridor
        ) {
          pylonSpots.push({ x: mid.x, z: mid.z, height });
          collision.addCircle(mid.x, mid.z, 0.32);
        }
      }
    }
    left.instanceMatrix.needsUpdate = true;
    right.instanceMatrix.needsUpdate = true;
    ties.instanceMatrix.needsUpdate = true;

    const pylons = new InstancedMesh(
      new CylinderGeometry(0.22, 0.3, 1, 8),
      pylonMaterial,
      Math.max(1, pylonSpots.length),
    );
    pylons.count = pylonSpots.length;
    const stretch = new Vector3();
    pylonSpots.forEach((spot, index) => {
      const ground = terrainHeight(spot.x, spot.z);
      position.set(spot.x, ground + spot.height / 2 - 0.15, spot.z);
      stretch.set(1, spot.height, 1);
      matrix.compose(position, rotation.identity(), stretch);
      pylons.setMatrixAt(index, matrix);
    });
    pylons.instanceMatrix.needsUpdate = true;
    this.group.add(left, right, ties, pylons);

    // The station platform: a low deck beside the boarding dip.
    const stationPoint = this.route.pointAt(this.route.stationDistance, new Vector3());
    const deck = toonBox(3.2, 0.25, 6, PALETTE.woodLight);
    deck.position.set(
      stationPoint.x,
      terrainHeight(stationPoint.x, stationPoint.z) + STATION_HEIGHT - 0.5,
      stationPoint.z,
    );
    this.group.add(deck);
  }

  interactZones(): [] {
    return [];
  }

  dispose(): void {
    this.rideView?.dispose();
  }
}

/** A toon box with the house outline — tiny local helper. */
function toonBox(w: number, h: number, d: number, colour: number): Mesh {
  const mesh = new Mesh(new BoxGeometry(w, h, d), toonMaterial(colour));
  addOutline(mesh, 0.02);
  return mesh;
}
