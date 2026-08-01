import {
  BoxGeometry,
  CatmullRomCurve3,
  CylinderGeometry,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  Quaternion,
  TubeGeometry,
  Vector3,
} from 'three';
import { CoasterRoute, checkCoasterClearances, STATION_HEIGHT } from './route';
import type { PlannedCoaster } from './plan';
import { RideCamera } from '../../core/RideCamera';
import { toonMaterial } from '../../art/style/materials';
import { addOutline } from '../../art/style/materials';
import { PALETTE } from '../../core/palette';
import { terrainHeight } from '../terrain';
import { distanceToPath } from '../paths';
import { PARK_LAYOUT } from '../parkLayout';
import type { CollisionWorld } from '../Collision';
import { resolveDismount } from '../dismount';
import { PLAYER_RADIUS } from '../../core/constants';
import type { FrameContext, GameSystem } from '../../core/types';
import type { Player } from '../../entities/Player';
import type { ParkTrain } from '../train';

/**
 * The rollercoaster — the **Sky Cruiser** (Decision 4 C4/C5).
 *
 * A serene, passive ride on a track the solver grew (`coaster/route.ts`),
 * ridden in first person through the same shared {@link RideCamera} as the
 * ferris wheel and the train — with the coaster's one difference, a ±120° yaw
 * limit, so a child looks *along* the ride the way the real thing insists you
 * do.
 *
 * It used to be two rides in one class: passing `race: true` turned it into the
 * Rail Race, with barriers, a rival and a countdown bolted on. That ended on
 * 31 July 2026, when the family asked for the Rail Race to become a side-on
 * four-lane race round the park's perimeter — a different track, a different
 * camera and a different game, which now lives in `world/railRace/`. What is
 * left here is the ride this class was always actually good at.
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
  /**
   * The solved plan (`coaster/plan.ts`) — route, station stall and exit
   * point, all decided before any scene object exists. `Coaster` builds what
   * was planned; it no longer solves its own route.
   */
  readonly plan: PlannedCoaster;
  /**
   * 'firstPerson': the eye in her head, model hidden (the Sky Cruiser).
   * 'chase': the camera just behind and above her head, model visible.
   *   Nothing uses it since the Rail Race moved out; kept because it is three
   *   lines and the next ride that wants a chase view should not re-derive it.
   */
  readonly camera: 'firstPerson' | 'chase';
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
  /** The seat: +Z along the direction of travel, like every model in the park. */
  private readonly cartMount: Group;
  /** The seat, turned to face the camera's convention. See the constructor. */
  private readonly eyeMount: Group;
  /** Kept for {@link arrive}'s dismount safety net — see `world/dismount.ts`. */
  private readonly collision: CollisionWorld;
  private player: Player | null = null;
  private riding = false;
  private distance: number;
  private speed = 0;
  private phase: 'waiting' | 'chain' | 'coasting' | 'braking' = 'waiting';
  private readonly point = new Vector3();
  private readonly tangent = new Vector3();
  private crestDistance = 0;

  private readonly options: CoasterOptions;

  constructor(collision: CollisionWorld, train: ParkTrain, options: CoasterOptions) {
    this.options = options;
    this.collision = collision;
    this.name = options.plan.name;
    this.playerStaysVisible = options.camera === 'chase';
    this.group.name = options.plan.name;
    // Solved already, at module load (`coaster/plan.ts`) — built here, not
    // re-solved. Mirrors `ParkTrain` taking `TRAIN_PLAN.route` as given.
    this.route = options.plan.route;
    this.distance = this.route.stationDistance;

    // Boot assert, in the claim-versus-fact tradition: report loudly and
    // refuse to pretend, never quietly adjust.
    const complaints = checkCoasterClearances(this.route, (x, z) => {
      const d = train.route.distanceNear(x, z);
      const p = train.route.pointAt(d, new Vector3());
      return { y: p.y, distance: Math.hypot(p.x - x, p.z - z) };
    });
    for (const complaint of complaints) console.warn(`${options.plan.name}: ${complaint}`);

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
    // The cart's own body casts — one more draw call, and it is the shadow the
    // eye actually follows round the loop. The nose does not: it is inside the
    // body's silhouette from every angle the fixed camera can see.
    body.castShadow = true;
    this.cart.add(body);
    const nose = toonBox(1.1, 0.4, 0.5, PALETTE.markerLemon);
    nose.position.set(0, 0.35, 1.3);
    this.cart.add(nose);
    this.cartMount = new Group();
    this.cartMount.position.set(0, 0.6, 0);
    this.cart.add(this.cartMount);

    // The eye's own mount, turned half a turn — and the reason the ride used
    // to look backwards (family report, 28 July).
    //
    // Everything modelled in this park faces **+Z** (ASSET_MANIFEST), and
    // `placeCart` duly sets `cart.rotation.y = atan2(tangent.x, tangent.z)`,
    // which points the cart's +Z along the direction of travel. But a three.js
    // `PerspectiveCamera` looks down its own local **−Z**. Bolt an unrotated
    // camera into a seat whose +Z is forward and it faces the way you have just
    // come — measured at `dot(cameraForward, travel) = -1.000`, not guessed.
    //
    // The flip belongs here rather than in `core/RideCamera.ts` (which is
    // parity-gated by `npm run check:ride-camera` and must not learn about it)
    // and rather than on `cartMount` itself, which is the *seat*: the rider's
    // pose hangs off that, and it should keep meaning what every other mount in
    // the park means. So the eye gets a child of its own, and camera offsets
    // below are written in camera terms — +Z is behind the cart.
    this.eyeMount = new Group();
    this.eyeMount.rotation.y = Math.PI;
    this.cartMount.add(this.eyeMount);
    this.group.add(this.cart);
    this.placeCart();
  }

  /** Lazily, as the train does: the headless park has no player and no DOM. */
  attachPlayer(player: Player): void {
    this.player = player;
    if (this.options.camera === 'firstPerson') {
      this.rideView = new RideCamera({ yawLimit: 2.1, startPitch: -0.06 });
      this.rideView.mountOn(this.eyeMount, EYE);
    } else {
      // The chase view: the same shared camera, mounted behind and above the
      // seat, looking along the track with only a little look-around — the
      // point of this view is watching her duck, not steering the eye.
      //
      // `z` is **positive** because `eyeMount` faces the camera's way round:
      // +Z here is behind the cart, which is where a chase camera goes.
      this.rideView = new RideCamera({ yawLimit: 0.55, startPitch: -0.14, fov: 60 });
      this.rideView.mountOn(this.eyeMount, { x: 0, y: 2.1, z: 3.4 });
    }
  }

  /** The stall's interact press lands here instead of opening the 2D game. */
  requestBoard(): boolean {
    if (this.riding || !this.player || this.phase !== 'waiting') return false;
    this.riding = true;
    this.player.beginRide();
    this.onRideChange?.(true);
    this.phase = 'chain';
    this.speed = CHAIN_SPEED;
    // Inside the interact press, where the phone-tilt look needs to be armed:
    // it takes "forward" from here, and iOS only grants the sensors from a
    // gesture. No-op on desktop, and harmless if it is refused.
    this.rideView?.board();
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
      // The planned exit (`coaster/plan.ts`) — beside the station, clear of
      // every plot blocker — with the runtime safety net on top (see
      // `world/dismount.ts`): this used to put a rider 40% of the way from
      // the booth's own centre towards its doormat, which is still inside
      // the booth's four walls and trapped her there for good.
      const { x, z } = resolveDismount(
        this.collision,
        this.options.plan.exitX,
        this.options.plan.exitZ,
        PLAYER_RADIUS,
      );
      this.player.setRidePose(x, terrainHeight(x, z), z, 0);
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
    // The rails are **swept**, not chopped (family note, 28 July): a rail built
    // from one straight box per 1.4 m read as a row of disjointed sticks
    // wherever the loop bends, which on a coaster is most of it. Two closed
    // curves — the solved centre line offset left and right — tubed along their
    // whole length instead, so a bend is a bend.
    //
    // A circular cross-section is why this can be a plain `TubeGeometry`: the
    // Frenet frame `TubeGeometry` builds may twist along a curve with torsion,
    // and on a tube of circular section that twist is invisible. Two draw calls
    // per coaster, and the ties and pylons stay instanced.
    const railGeometries = [1, -1].map((sideSign) => {
      const points: Vector3[] = [];
      const centre = new Vector3();
      const along = new Vector3();
      for (let i = 0; i < segments; i += 1) {
        const d = i * step;
        this.route.pointAt(d, centre);
        this.route.tangentAt(d, along);
        // Sideways in the ground plane: the track has no banking, so "left of
        // the rail" is the horizontal normal, not a rolled one.
        const sideX = along.z;
        const sideZ = -along.x;
        const norm = Math.hypot(sideX, sideZ) || 1;
        points.push(
          new Vector3(
            centre.x + (sideX / norm) * sideSign * railGauge,
            centre.y,
            centre.z + (sideZ / norm) * sideSign * railGauge,
          ),
        );
      }
      const railCurve = new CatmullRomCurve3(points, true, 'catmullrom', 0.5);
      // Two tubular segments a metre: enough that the tightest bend the solver
      // can produce still reads as a curve rather than a polygon.
      return new TubeGeometry(railCurve, Math.ceil(this.route.length * 2), 0.075, 6, true);
    });
    // The rails cast (ARCHITECTURE.md, *rendering notes*: shadow casting is
    // opt-out and every caster is drawn twice). A coaster is a thing in the
    // sky, and without a shadow on the lawn under it there is nothing telling
    // a child how high up it is — which is the whole feeling of the ride. Two
    // tubes is two extra draw calls for the entire loop, which is exactly the
    // "shapes doing the silhouette's work" the note asks for.
    for (const geometry of railGeometries) {
      const rail = new Mesh(geometry, railMaterial);
      rail.castShadow = true;
      this.group.add(rail);
    }

    const ties = new InstancedMesh(new BoxGeometry(1.5, 0.08, 0.3), tieMaterial, segments);
    const matrix = new Matrix4();
    const rotation = new Quaternion();
    const forward = new Vector3();
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
      rotation.setFromUnitVectors(new Vector3(0, 0, 1), forward);
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
    // The pylons cast too: they are what plants the track on the ground, and
    // an `InstancedMesh` is one draw call however many posts there are, so the
    // whole colonnade costs one more.
    //
    // The **ties do not**, and that is a judgement rather than a saving: they
    // are 8 cm slats every 1.4 m, and a shadow of them is a fine stripey comb
    // that `VSMShadowMap`'s soft edges turn to mush at this scale. Nobody looks
    // for the shadow of a sleeper — see the station canopy's note in
    // `train/station.ts` and ARCHITECTURE.md's *rendering notes*.
    pylons.castShadow = true;
    this.group.add(ties, pylons);

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
