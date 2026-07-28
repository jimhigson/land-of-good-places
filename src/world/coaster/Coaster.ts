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

export class Coaster implements GameSystem {
  readonly name = 'coaster';
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

  constructor(collision: CollisionWorld, train: ParkTrain) {
    this.group.name = 'coaster';
    this.route = new CoasterRoute();
    this.distance = this.route.stationDistance;

    // Boot assert, in the claim-versus-fact tradition: report loudly and
    // refuse to pretend, never quietly adjust.
    const complaints = checkCoasterClearances(this.route, (x, z) => {
      const d = train.route.distanceNear(x, z);
      const p = train.route.pointAt(d, new Vector3());
      return { y: p.y, distance: Math.hypot(p.x - x, p.z - z) };
    });
    for (const complaint of complaints) console.warn(`coaster: ${complaint}`);

    this.buildTrack(collision);

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
    this.rideView = new RideCamera({ yawLimit: 2.1, startPitch: -0.06 });
    this.rideView.mountOn(this.cartMount, EYE);
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

    if (this.phase !== 'waiting') {
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
      this.player.setRidePose(seat.x, seat.y - 0.55, seat.z, this.cart.rotation.y);
    }
  }

  private arrive(): void {
    this.phase = 'waiting';
    this.distance = this.route.stationDistance;
    this.speed = 0;
    if (this.riding && this.player) {
      this.riding = false;
      const stall = placedEntry('stall.railRacer');
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

      // A pylon roughly every 6 m, where the ground is genuinely clear.
      if (i % 4 === 2) {
        const ground = terrainHeight(mid.x, mid.z);
        const height = mid.y - ground;
        if (height > 1.4 && collision.isClearCircle(mid.x, mid.z, 1.0)) {
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
