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
import { CASTLE_WINDOWS, checkCastleWindows } from './castleWindows';
import {
  CART_BODY_HEIGHT,
  CART_BODY_LENGTH,
  CART_BODY_WIDTH,
  CART_EYE_HEIGHT,
  CART_SEAT_HEIGHT,
} from './cart';
import {
  drawnOnSphere,
  railFrameAt,
  railTurn,
  sweptRails,
  type RailFrame,
} from '../rail/sweptRail';
import { decideBuilt } from '../prebuilt/built';
import type { CruiserPylon } from './pylons';
import { POST_FOOT_RADIUS, POST_TOP_RADIUS } from '../railRace/trestleGeometry';
import type { PlannedCoaster } from './plan';
import { RideCamera } from '../../core/RideCamera';
import { toonMaterial } from '../../art/style/materials';
import { addOutline } from '../../art/style/materials';
import { PALETTE } from '../../core/palette';
import { placeOnSphere, terrainHeight } from '../terrain';
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

/**
 * Rail centre-to-centre and the distance between ties. Exported so
 * `scripts/check-tie-frame.mts` can sample the same points the track itself
 * is built from, rather than a second guess at them that could drift.
 */
export const RAIL_GAUGE = 1.1;
/**
 * Metres between sleepers.
 *
 * Jim, 5 August 2026: "the sky ride and race should have cross-bars like
 * railway sleepers between the tracks at about 1m intervals". It was 1.4.
 *
 * Costed before changing it: a 217 m loop at 1 m is 217 ties against 155, so
 * +62 boxes and +744 triangles on a scene that already draws 2.37 M. It is one
 * `InstancedMesh` either way, so the draw call count does not move at all.
 */
export const TIE_STEP = 1;

const CHAIN_SPEED = 3.4;
const MIN_SPEED = 4.2;
const MAX_SPEED = 15;
const STATION_SPEED = 2.6;
const GRAVITY = 6.5; // gentler than earth; a cosy park has cosy physics
// The eye within the seat. Written as the difference so that the two numbers
// `cart.ts` publishes — where the seat is and where the eye ends up — cannot
// disagree with where this actually puts the camera.
const EYE = { x: 0, y: CART_EYE_HEIGHT - CART_SEAT_HEIGHT, z: 0 };

/** Somewhere for `placeOnSphere`'s rotation to go when only its point is wanted. */
const DISCARDED_SPIN = /* @__PURE__ */ new Quaternion();
/** Half the span, in metres, the rails' drawn direction is read across. */
const DRAWN_STEP = 0.05;
const DRAWN_AHEAD = /* @__PURE__ */ new Vector3();
const DRAWN_BEHIND = /* @__PURE__ */ new Vector3();

/** Scratch for the cart's own up, used to seat the rider down into the tub. */
const SEAT_DROP = /* @__PURE__ */ new Vector3();

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
  /**
   * Fells every tree standing in a disc at (x, z, radius) and reports how
   * many it actually felled — `Scenery.clearTreesNear`, threaded through
   * rather than reaching for `Scenery` directly, so this file only ever
   * touches the collision world and the trees through the one door the park
   * already keeps for it. See `pylons.ts`'s search for why it needs one.
   */
  readonly clearTreesNear: (x: number, z: number, radius: number) => number;
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
  /** Kept so `buildTrack`'s pylon search can ask each real, already-built
   * bridge's own footprint — see that method's own note. */
  private readonly train: ParkTrain;
  private player: Player | null = null;
  private riding = false;
  private distance: number;
  private speed = 0;
  private phase: 'waiting' | 'chain' | 'coasting' | 'braking' = 'waiting';
  private readonly point = new Vector3();
  private readonly tangent = new Vector3();
  /**
   * The cart's heading, kept because `cart.rotation.y` no longer carries it.
   *
   * Once the cart's quaternion leans with the track, the Euler three.js
   * decomposes back out of it is a mixture of the lean, the yaw and the pitch,
   * and its `.y` is none of the three. Anything wanting "which way is the cart
   * pointing" — the rider's facing, the face-turn towards the camera — asks
   * this instead.
   */
  private cartYaw = 0;
  private crestDistance = 0;

  private readonly options: CoasterOptions;

  constructor(collision: CollisionWorld, train: ParkTrain, options: CoasterOptions) {
    this.options = options;
    this.collision = collision;
    this.train = train;
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
    for (const complaint of checkCastleWindows(this.route, CASTLE_WINDOWS)) {
      console.warn(`${options.plan.name}: ${complaint}`);
    }

    this.buildTrack(collision);

    // Find the highest crest's distance, for the chain phase.
    //
    // **Highest above the ground, not highest `y`** — same fault as the energy
    // drop in `update`, and worse in its way. A bare `y` over a loop that spans
    // 100 m of park finds the point where the sphere's *cap* is highest, which
    // is simply whichever part of the circuit passes nearest the park's origin.
    // The chain then hauls the cart to there and lets go, rather than letting go
    // at the top of the lift hill.
    let bestClearance = -Infinity;
    for (let d = 0; d < this.route.length; d += 1) {
      const clearance = this.route.clearanceAt(d);
      if (clearance > bestClearance) {
        bestClearance = clearance;
        this.crestDistance = d;
      }
    }

    // --- the cart ---------------------------------------------------------
    this.cart = new Group();
    const body = toonBox(CART_BODY_WIDTH, CART_BODY_HEIGHT, CART_BODY_LENGTH, PALETTE.markerPink);
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
    this.cartMount.position.set(0, CART_SEAT_HEIGHT, 0);
    this.cart.add(this.cartMount);

    // The eye's own mount, turned half a turn — and the reason the ride used
    // to look backwards (family report, 28 July).
    //
    // Everything modelled in this park faces **+Z** (ASSET_MANIFEST), and
    // `placeCart` duly points the cart's +Z along `atan2(tangent.x, tangent.z)`,
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
    // Named so an instrument can find the thing that actually gets drawn,
    // rather than re-deriving where it thinks the cart ought to be — the
    // difference `check:swept-bus` was written to make, after a check measured
    // trestle *feet* and reported a confident, wrong zero.
    this.cart.name = `${options.plan.name}-cart`;
    this.group.add(this.cart);
    this.placeCart();
  }

  /** Lazily, as the train does: the headless park has no player and no DOM. */
  attachPlayer(player: Player): void {
    this.player = player;
    if (this.options.camera === 'firstPerson') {
      // **First person, so the view is unbounded and the phone can drive it.**
      // Jim's rule, 3 August 2026: tilt-to-look belongs to first-person rides
      // and to nothing else, and a first-person ride does not fence off part of
      // its own sky. It used to stop at ±2.1 rad, which is most of the way
      // round and therefore reads as a fault rather than as a limit.
      this.rideView = new RideCamera({ startPitch: -0.06 });
      this.rideView.mountOn(this.eyeMount, EYE);
    } else {
      // The chase view: the same shared camera, mounted behind and above the
      // seat, looking along the track with only a little look-around — the
      // point of this view is watching her duck, not steering the eye.
      //
      // `z` is **positive** because `eyeMount` faces the camera's way round:
      // +Z here is behind the cart, which is where a chase camera goes.
      // **Not first person, so no tilt-to-look at all.** This is the chase
      // camera: it looks at the child from behind rather than out of her own
      // eyes, so turning the phone should move nothing — a third-person view
      // that swings with the handset is a camera that has come loose. Its yaw
      // stays clamped for the same reason: the ride is ahead of you.
      this.rideView = new RideCamera({
        yawLimit: 0.55,
        startPitch: -0.14,
        fov: 60,
        sensorLook: false,
      });
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
      // **Height above the GROUND, not world `y`** — the cart's energy is a fact
      // about how far it has fallen, and since #511 those two are different
      // numbers by tens of metres.
      //
      // The route is authored in the flat frame, where a point's `y` is
      // `terrainHeight(x, z)` plus its clearance — so it carries the sphere's
      // own cap inside it. The loop reaches about 100 m from the park's origin,
      // where the cap alone is 23 m down. Differencing two `y`s across it
      // therefore handed the cart 23 m of drop it had not fallen on the way out
      // (straight to `MAX_SPEED`, for free) and took the same 23 m away coming
      // back, where it stalled at `MIN_SPEED`. Nothing to do with the lean; it
      // is the cap, and it was invisible while the park was flat.
      //
      // `clearanceAt` is the route's own name for the right quantity and had
      // **zero readers** — it subtracts the terrain under each point, which is
      // exactly what removes the cap. It is also what survives `placeOnSphere`:
      // that map preserves a height above the ground, so the flat frame's
      // clearance *is* the drawn cart's real altitude.
      const height = this.route.clearanceAt(this.distance);
      const crestHeight = this.route.clearanceAt(this.crestDistance);
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
      // Down **into the seat**, along the cart's own up rather than along world
      // `+Y`. The cart leans with the track now (see `placeCart`), so a bare
      // `seat.y - 0.55` would drop her 0.55 m vertically out of a tub that is
      // no longer vertical — sliding her towards the park's centre by
      // `0.55 · sin(tilt)` and, at the far side of the loop, out through the
      // side of it.
      //
      // The yaw is carried in `cartYaw` rather than read back off
      // `cart.rotation.y`. That property stopped meaning "the way the cart is
      // pointing" the moment the cart's quaternion began carrying a lean: the
      // Euler three.js decomposes out of `tilt * yaw * pitch` mixes all three,
      // so reading `.y` off it hands her a facing that is wrong by the lean and
      // wrong in a way that grows as the ride goes round.
      // flat-ok: local axis, leant by the cart's own quaternion
      const down = SEAT_DROP.set(0, 1, 0).applyQuaternion(this.cart.quaternion);
      // **Turned by the cart's own frame, handed over whole** — not by
      // `setRidePose`, which rebuilt her turn from `cartYaw` alone: no pitch,
      // leant about the sphere at her own seat, so on every climb she sat bolt
      // upright in a tub pitched up to 28° under her.
      this.player.setRideFrame(
        seat.addScaledVector(down, -0.55),
        this.cart.quaternion,
        this.cartYaw,
      );
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

  /**
   * **On the rails, not merely near them.**
   *
   * The route is solved flat and the rails are drawn through `drawnOnSphere`
   * (see `buildTrack`). The cart has to make the same journey, or it rides a
   * track that is no longer where it is. It used to make neither half of it —
   * flat position, flat Euler — and on seed 428 that left it **10.83 m from its
   * own rails** at the worst point of the 213.5 m circuit, 3.42 m on average.
   *
   * So: the position through `placeOnSphere`, exactly as `drawnOnSphere` maps
   * each drawn rail point, and the orientation from **the direction the rails
   * are drawn in there** — two more drawn points either side — stood up by
   * `railTurn`, the side/up convention the rails and ties are swept with.
   * Everything hung off the cart — `cartMount`, `eyeMount`, and so both ride
   * cameras — inherits this for free, which is why there is nothing to change
   * in `RideCamera`.
   *
   * **Not `rideFrame`, which it used to be.** That leans a flat heading about
   * the flat column: yaw and pitch off the flat tangent, then the sphere's tilt
   * on top. Measured every 0.5 m round the canonical loop against the rails as
   * drawn, with the heading composed `XYZ` (pitch about the world's X) the nose
   * was **29.4°** off and the up **40.6°**; composed `YXZ` the up came right
   * (0.88°) and the nose was still **17.3°** off, because the flat tangent here
   * already runs where the drawn rails do (0.26° apart) and the tilt turns it a
   * second time. Taking the drawn direction itself has no heading to compose
   * and nothing to lean twice. `check:tie-frame` holds it to a degree.
   */
  private placeCart(): void {
    this.route.pointAt(this.distance, this.point);
    this.route.tangentAt(this.distance, this.tangent);
    const yaw = Math.atan2(this.tangent.x, this.tangent.z);
    // `placeOnSphere` is asked only for the position; the spare quaternion is
    // thrown away rather than written to the cart, so nothing reads as though
    // the rotation were set twice.
    placeOnSphere(this.point, yaw, this.cart.position, DISCARDED_SPIN);
    this.route.pointAt(this.route.wrap(this.distance + DRAWN_STEP), DRAWN_AHEAD);
    placeOnSphere(DRAWN_AHEAD, 0, DRAWN_AHEAD, DISCARDED_SPIN);
    this.route.pointAt(this.route.wrap(this.distance - DRAWN_STEP), DRAWN_BEHIND);
    placeOnSphere(DRAWN_BEHIND, 0, DRAWN_BEHIND, DISCARDED_SPIN);
    railTurn(this.cart.position, DRAWN_AHEAD.sub(DRAWN_BEHIND).normalize(), this.cart.quaternion);
    this.cartYaw = yaw;
  }

  private buildTrack(collision: CollisionWorld): void {
    const railMaterial = toonMaterial(PALETTE.markerPink);
    const tieMaterial = toonMaterial(PALETTE.woodLight);
    const pylonMaterial = toonMaterial(PALETTE.stonePinkLight);

    const step = TIE_STEP;
    const segments = Math.ceil(this.route.length / step);

    // The rails are **swept**, not chopped (family note, 28 July): a rail built
    // from one straight box per 1.4 m read as a row of disjointed sticks
    // wherever the loop bends, which on a coaster is most of it.
    //
    // The sweep itself lives in `world/rail/sweptRail.ts` — the park's one way
    // of turning a route into rail geometry, shared with the Rail Race's four
    // lanes. This used to be its own copy of the same twenty lines, which had
    // already drifted: it called its offset `railGauge = 0.55` and applied it as
    // a **half**-offset, while the shared helper (and `train/track.ts` before
    // it) take `gauge` to mean the railway's own centre-to-centre. Hence 1.1
    // here: the same rails, the standard name for the number.
    // **Drawn on the sphere, solved flat.** `drawnOnSphere` leans every sampled
    // point as it is drawn; the route object itself stays in the flat frame,
    // which is where its clearance solve, its physics and its invariants all
    // want to be. See that function for why the two frames give the same
    // answers to every question except "where does this get drawn".
    const drawn = drawnOnSphere(this.route);
    const railGeometries = sweptRails(drawn, {
      gauge: RAIL_GAUGE,
      radius: 0.075,
      // Denser than the 1.4 m this used to sample at, and a real fix rather than
      // a tidy-up. Measured against the solved track, the old sweep's rails
      // strayed up to 224 mm from it through the tightest bends — three times
      // the rail's own radius, so the rail visibly left the ties it is supposed
      // to be bolted to. At 0.45 m that is 20 mm, comfortably invisible. It
      // costs control points, not vertices: the tube's segment count is set by
      // `tubularPerMetre` and is unchanged, so this is the same two draw calls.
      step: 0.45,
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
    // Named so `scripts/check-tie-frame.mts` can find the real instance
    // buffer in a headless build rather than guessing at group order.
    ties.name = 'ties';
    const matrix = new Matrix4();
    const basis = new Matrix4();
    const rotation = new Quaternion();
    const position = new Vector3();
    const one = new Vector3(1, 1, 1);
    // A tie's long (1.5 m) axis is local X, its along-track thickness is
    // local Z — so it must be oriented with local X on the rails' own
    // horizontal `side` and local Z on `forward`, not by a minimal rotation
    // onto `forward` alone. A minimal rotation only pins Z; it leaves X free
    // to roll wherever the route climbs or dives, and a tie that rolls off
    // horizontal stops bridging both rails. `railFrameAt` hands back exactly
    // the horizontal `side` the rails themselves are swept with (see
    // `sweptRail.ts`), so the ties land on the rails by shared construction,
    // not by coincidence.
    const mid = new Vector3();
    const frame: RailFrame = {
      position: mid,
      forward: new Vector3(),
      side: new Vector3(),
      up: new Vector3(),
    };

    for (let i = 0; i < segments; i += 1) {
      const d = i * step;
      railFrameAt(drawn, d, frame);
      basis.makeBasis(frame.side, frame.up, frame.forward);
      rotation.setFromRotationMatrix(basis);
      // **Dropped along the frame's own up, not along world `−Y`.** The 0.12 m
      // is the tie sitting under the rail so the rail visibly rests on top of
      // the sleeper — a distance across the track's own cross-section, which is
      // what `frame.up` is. `setY(mid.y - 0.12)` was the same thing only while
      // the world was flat; out at the park's edge the track leans by up to 40°
      // and a plumb drop slides the tie 29 mm sideways off the rails it is
      // meant to be bolted to.
      matrix.compose(position.copy(mid).addScaledVector(frame.up, -0.12), rotation, one);
      ties.setMatrixAt(i, matrix);
    }
    ties.instanceMatrix.needsUpdate = true;

    // Where the pylons stand is now `pylons.ts`'s job — a pure planner, the way
    // `slide/supports.ts` splits `planSlideLegs` out of building the meshes, so
    // `test/procgen/invariants.ts` can measure the choice. It also fixes the
    // reason this ride had **four** supports on 217 m of track: see that file's
    // header.
    //
    // A bridge's real deck and ramps too — `Coaster` is built *after*
    // `ParkTrain` (`World.ts`'s own build order), so they already exist
    // here, but neither registers ground-plane collision (a walkable
    // platform is not a solid circle or wall), so `isClearCircle` alone
    // cannot see one. Without this a pylon foot could plant itself dead
    // centre on a bridge's own ramp — found live, issue #319's own
    // follow-up work on this file's neighbour, `bridgeFootprint.ts`: a
    // Sky Cruiser pylon (`POST_FOOT_RADIUS`, 0.68 m) landed 0.08 m from a
    // ramp edge that had cleared everything the bridge's own planner could
    // see at *its* plan time, because the pylon did not exist yet then
    // either.
    //
    // Asks each real, built `Bridge.footprintNear` rather than
    // `bridgeKeepout.ts`'s `isInBridgeFootprint` — that keepout is sized for
    // callers built *before* a single bridge exists (`Scenery`, `LampPosts`)
    // and pads a crossing's reservation by its own full lateral-shift
    // budget, which can run to several dozen metres across on a wide,
    // oblique crossing. Asked here, after every bridge is already built for
    // real, that padding excludes far more ground than the bridge actually
    // standing there occupies — found reviewing PR #330, seed 11: a 37 m
    // stretch of track with no legitimate obstacle at all. `footprintNear`
    // is the bridge's own real, final edge plus this file's own
    // `GROUND_CLEARANCE`-derived margin, nothing more.
    // Read from the park file; searched only in build tooling
    // (`procgen/world/coaster/pylons.ts`, `docs/design/PREBUILT-PARKS.md`).
    const pylonSpots: readonly CruiserPylon[] = decideBuilt('pylons', (solver) =>
      solver.cruiserPylons(
        this.route,
        (x, z, radius) =>
          collision.isClearCircle(x, z, radius) &&
          !this.train.bridges.some((bridge) => bridge.footprintNear(x, z, radius)),
        this.options.clearTreesNear,
      ),
    );
    const pylons = new InstancedMesh(
      // Straight and vertical, and the **same thickness as the Rail Race's base
      // post** — Jim, 5 August 2026: "the skyride also needs supports, same
      // thickness as the rail ride but straight up vertical". Imported rather
      // than copied, so "same as the rail ride" stays true when that changes.
      new CylinderGeometry(POST_TOP_RADIUS, POST_FOOT_RADIUS, 1, 8),
      pylonMaterial,
      Math.max(1, pylonSpots.length),
    );
    // Named so `test/procgen/invariants.ts` can find the real instance buffer.
    // It had no name at all, which is why nothing had ever measured it.
    pylons.name = 'skyCruiser:pylons';
    pylons.count = pylonSpots.length;
    const stretch = new Vector3();
    const PYLON_UP = new Vector3(0, 1, 0);
    const pylonFoot = new Vector3();
    const pylonFlatTop = new Vector3();
    const pylonTop = new Vector3();
    const pylonSpan = new Vector3();
    pylonSpots.forEach((spot, index) => {
      // Top at `ground + height` exactly, which `pylons.ts` derives as
      // `route.pointAt(d).y` — **the middle of the track**, the same rule the
      // Rail Race's branches now end on.
      //
      // This used to subtract 0.15, sinking the top below the centre line.
      // Measured off the built scene on 7 August, that left the tops 0.131 to
      // 0.152 m under the track while the ties occupy 0.08–0.16 m below it: an
      // overlap of about a centimetre at best, and at the far end of the range
      // no overlap at all. A support whose contact with what it carries is
      // measured in millimetres and varies by pylon is not joined on purpose —
      // it is joined by luck, which is the fault Jim reported on the Rail Race.
      // **A strut from its foot to where the track now is**, not a vertical
      // cylinder. The track is drawn leant onto the sphere, so its centre line
      // out at the ride's radius stands metres further out than the flat frame
      // put it; a pylon left plumb to world `+Y` would no longer reach the
      // thing it carries. The foot stays exactly where the planner found clear
      // ground — `tryPlace` checked *that* square metre against the paving and
      // the plots — and the lean falls out of the two ends, which is also how
      // the Rail Race's trestles are drawn.
      pylonFoot.set(spot.x, spot.ground, spot.z);
      pylonFlatTop.set(spot.x, spot.ground + spot.height, spot.z);
      placeOnSphere(pylonFlatTop, 0, pylonTop, rotation);
      pylonSpan.subVectors(pylonTop, pylonFoot);
      const pylonLength = pylonSpan.length() || spot.height;
      position.copy(pylonFoot).addScaledVector(pylonSpan, 0.5);
      rotation.setFromUnitVectors(PYLON_UP, pylonSpan.divideScalar(pylonLength));
      stretch.set(1, pylonLength, 1);
      matrix.compose(position, rotation, stretch);
      pylons.setMatrixAt(index, matrix);
      // Registered here rather than inside the planner, so a pure function stays
      // pure and the collision world gains a post exactly once.
      collision.addCircle(spot.x, spot.z, POST_FOOT_RADIUS);
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
