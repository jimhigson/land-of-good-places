import {
  BoxGeometry,
  CylinderGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  SphereGeometry,
  Vector3,
} from 'three';
import { PALETTE } from '../../core/palette';
import { woodTexture } from '../../core/textures';
import { toonMaterial } from '../../art/style/materials';
import { ART } from '../../art/style/artPalette';
import { terrainHeight } from '../terrain';
import type { CollisionWorld } from '../Collision';
import type { InteractZone } from '../interact';
import type { MovingPlatform } from '../building/surfaces';
import type { TrainRoute } from './route';
import { PLATFORM_LENGTH } from './clearance';

/**
 * A little station: a platform, a stripy canopy, lamps and a bench.
 *
 * Two of them, at opposite ends of the loop. They sit on the *inside* of the
 * track — the side the park is on — so a child walks up to one from the park
 * rather than from the boundary wall.
 *
 * The platform is walkable the way the lift car is: it registers as a
 * {@link MovingPlatform} with `WalkSurfaces`, which is the game's whole answer
 * to "how high is the ground?" (ARCHITECTURE.md, *the big building*). It never
 * actually moves, but a platform that answers a question every frame is exactly
 * the same interface as one that answers a different answer every frame.
 */

/**
 * How high the platform stands.
 *
 * Has to stay under `BUILDING_STEP_UP` (0.62) *including* the roll of the
 * ground under it, or a child walks into the side of it and stops. 0.34 leaves
 * room for a quarter-metre of hillside.
 */
const PLATFORM_HEIGHT = 0.34;

const PLATFORM_WIDTH = 2.6;

/**
 * How much of {@link PLATFORM_WIDTH} the painted edge stripe takes.
 *
 * One constant rather than a `0.3` in the stripe's size and a `0.15` in its
 * position: the deck now has to stop exactly where the stripe starts, so three
 * places have to agree, and CLAUDE.md's most common bug in this repo is two
 * definitions of one thing kept in step by hand.
 */
const STRIPE_WIDTH = 0.3;

/** Centre of the platform, out from the track centre line. */
const PLATFORM_OFFSET = 2.15;

const CANOPY_HEIGHT = 2.9;

/** The sheltered end: how much of the platform it covers, and where. */
const CANOPY_LENGTH = 3.4;
const CANOPY_CENTRE = -1.4;

export interface StationOptions {
  readonly index: number;
  readonly name: string;
  readonly accent: number;
  /** Where on the loop it stands, in metres along the route. */
  readonly distance: number;
}

export class Station {
  readonly group = new Group();
  readonly name: string;
  readonly index: number;

  /** Distance along the route the train stops at. */
  readonly distance: number;

  /** Centre of the platform, where a child waits. */
  readonly standX: number;
  readonly standZ: number;

  /** Top of the platform, in world units. */
  readonly surfaceY: number;

  /** Lamp materials, brightened after dark. */
  readonly lamps: MeshBasicMaterial[] = [];

  private readonly halfLength = PLATFORM_LENGTH / 2;
  private readonly halfWidth = PLATFORM_WIDTH / 2;
  private readonly cosYaw: number;
  private readonly sinYaw: number;

  constructor(options: StationOptions, route: TrainRoute, collision: CollisionWorld) {
    this.index = options.index;
    this.name = options.name;
    this.distance = options.distance;

    const centre = route.pointAt(options.distance, new Vector3());
    const tangent = route.tangentAt(options.distance, new Vector3());

    // The platform goes on whichever side of the track faces the middle of the
    // park, so a child walks up to it from the park rather than from the wall.
    //
    // Local +X of the station group maps to world (cos yaw, -sin yaw), which is
    // (tangent.z, -tangent.x): the track's right-hand side. `trackSide` is the
    // local X direction the *rails* end up in once the platform has moved off
    // the centre line, and everything below is placed relative to it.
    const rightX = tangent.z;
    const rightZ = -tangent.x;
    // Park to the right of the track means the platform goes right, which puts
    // the rails away to its left — hence the flip.
    const parkIsRight = rightX * -centre.x + rightZ * -centre.z >= 0;
    const trackSide = parkIsRight ? -1 : 1;

    this.standX = centre.x - rightX * trackSide * PLATFORM_OFFSET;
    this.standZ = centre.z - rightZ * trackSide * PLATFORM_OFFSET;

    const ground = terrainHeight(this.standX, this.standZ);
    this.surfaceY = ground + PLATFORM_HEIGHT;

    const yaw = Math.atan2(tangent.x, tangent.z);
    this.cosYaw = Math.cos(yaw);
    this.sinYaw = Math.sin(yaw);

    this.group.name = `train-station-${options.index}`;
    this.group.position.set(this.standX, ground, this.standZ);
    this.group.rotation.y = yaw;

    this.build(options, trackSide, collision);
  }

  /** The platform deck, for `WalkSurfaces.addPlatform`. */
  asPlatform(): MovingPlatform {
    return {
      surfaceY: this.surfaceY,
      covers: (x: number, z: number): boolean => this.covers(x, z),
    };
  }

  /** Is this point on the platform deck? */
  covers(x: number, z: number): boolean {
    const dx = x - this.standX;
    const dz = z - this.standZ;
    // Rotate into the platform's own frame. Its length runs along +Z local.
    const along = dx * this.sinYaw + dz * this.cosYaw;
    const across = dx * this.cosYaw - dz * this.sinYaw;
    return Math.abs(along) <= this.halfLength && Math.abs(across) <= this.halfWidth;
  }

  /**
   * The platform as a tap target. `ParkTrain` adds the actions — "Get on",
   * "Get off" — because only the train knows whether it is standing here.
   */
  interactZone(): Omit<InteractZone, 'actions'> {
    return {
      id: `train-station-${this.index}`,
      label: this.name,
      x: this.standX,
      y: this.surfaceY,
      z: this.standZ,
      pickRadius: 4.2,
      standX: this.standX,
      standZ: this.standZ,
      // Wider than the default three metres, and measured from the middle of a
      // 7.2 m platform: a child at either end of it, or sitting in the far
      // carriage, is still "at this station" as far as the chip is concerned.
      standRadius: 5.5,
      // Above everything else in the park, and only ever *while* the train is
      // standing here — a station with no train offers no actions at all, so it
      // is not selectable and the rank never comes up. The eight seconds it is
      // in are eight seconds when "Get on" beats the flower growing beside the
      // platform, which is exactly what QA found it losing to.
      selectRank: 1,
      // So that "Get off" is on screen while the ride owns her — see
      // `InteractZone.selectableWhileRiding`.
      selectableWhileRiding: true,
    };
  }

  // ---------------------------------------------------------------- internals

  /** `trackSide` is the local X direction the rails lie in. */
  private build(options: StationOptions, trackSide: number, collision: CollisionWorld): void {
    const deckMaterial = toonMaterial(ART.cream);
    const edgeMaterial = toonMaterial(options.accent);
    const postMaterial = toonMaterial(PALETTE.wood);
    const roofMaterial = toonMaterial(options.accent);
    const boardMaterial = toonMaterial(0xffffff, { map: woodTexture(1, 1) });

    // --- the deck ------------------------------------------------------------
    // The deck stops where the edge stripe starts, rather than running the
    // platform's full width with the stripe laid on top of it.
    //
    // Flush is what the stripe used to be: a 0.3 m box whose outer face landed
    // *exactly* on the deck's own outer face, so 2.45 m² — the deck's whole
    // trackside face, 7.2 m × 0.34 m — was two surfaces in one plane at 1e-16 m,
    // on both stations. `ART_DIRECTION.md` §7's answer is to delete the face
    // that is never seen, and the deck's trackside face is never seen: the
    // stripe is in front of every square centimetre of it.
    //
    // So the two boxes abut instead of overlapping. They meet along one plane,
    // but their touching faces point *opposite* ways (culling draws one) and
    // their top faces share only an edge — which is how every tiled floor in
    // this game is built, and is not a finding. Nothing is nudged and nothing
    // moved: `covers()` still spans the full `PLATFORM_WIDTH`, because deck plus
    // stripe still add up to it.
    const deck = new Mesh(
      new BoxGeometry(PLATFORM_WIDTH - STRIPE_WIDTH, PLATFORM_HEIGHT, PLATFORM_LENGTH),
      deckMaterial,
    );
    deck.position.set(-trackSide * (STRIPE_WIDTH / 2), PLATFORM_HEIGHT / 2, 0);
    deck.castShadow = true;
    deck.receiveShadow = true;
    this.group.add(deck);

    // A painted stripe along the platform edge, the side the train comes to.
    const stripe = new Mesh(
      new BoxGeometry(STRIPE_WIDTH, PLATFORM_HEIGHT + 0.02, PLATFORM_LENGTH),
      edgeMaterial,
    );
    stripe.position.set(trackSide * (PLATFORM_WIDTH / 2 - STRIPE_WIDTH / 2), PLATFORM_HEIGHT / 2, 0);
    stripe.castShadow = false;
    stripe.receiveShadow = true;
    this.group.add(stripe);

    // --- canopy --------------------------------------------------------------
    // A shelter over one end of the platform, not a roof over all of it.
    //
    // The camera is fixed at 38° and the park has two stations on opposite
    // sides, so whichever way a full-length canopy faces, one of them ends up
    // with its roof between the camera and the child standing under it. Half a
    // platform of shelter reads exactly as well and always leaves somewhere to
    // watch the train come in from.
    //
    // Only the deck and the roof cast: every caster is drawn twice, and a
    // station's shadow is a slab and an awning. Nobody looks for the shadow of
    // a bench leg (ARCHITECTURE.md, *rendering notes*).
    const postGeometry = new CylinderGeometry(0.1, 0.12, CANOPY_HEIGHT, 8);
    // Along the back of the platform, so the canopy never stands between the
    // train and the child waiting for it.
    const postX = -trackSide * (PLATFORM_WIDTH / 2 - 0.35);
    for (const along of [-2.6, -0.2] as const) {
      const post = new Mesh(postGeometry, postMaterial);
      post.position.set(postX, PLATFORM_HEIGHT + CANOPY_HEIGHT / 2, along);
      post.castShadow = false;
      post.receiveShadow = true;
      this.group.add(post);

      // Solid, so nobody walks through the canopy support.
      collision.addCircle(
        this.standX + postX * this.cosYaw + along * this.sinYaw,
        this.standZ - postX * this.sinYaw + along * this.cosYaw,
        0.22,
      );
    }

    const roof = new Mesh(
      new BoxGeometry(PLATFORM_WIDTH + 0.5, 0.16, CANOPY_LENGTH),
      roofMaterial,
    );
    roof.position.set(trackSide * 0.1, PLATFORM_HEIGHT + CANOPY_HEIGHT, CANOPY_CENTRE);
    // Tipped down towards the track, the way a platform awning sheds rain.
    roof.rotation.z = trackSide * 0.06;
    roof.castShadow = true;
    roof.receiveShadow = true;
    this.group.add(roof);

    // Scalloped valance along the front — the one detail that turns a slab of
    // roof into a seaside station.
    const valance = new Mesh(
      new BoxGeometry(0.12, 0.34, CANOPY_LENGTH),
      toonMaterial(ART.cream),
    );
    valance.position.set(
      trackSide * (PLATFORM_WIDTH / 2 + 0.14),
      PLATFORM_HEIGHT + CANOPY_HEIGHT - 0.2,
      CANOPY_CENTRE,
    );
    valance.castShadow = false;
    this.group.add(valance);

    // --- bench ---------------------------------------------------------------
    const benchSeat = new Mesh(new BoxGeometry(0.52, 0.1, 2.0), boardMaterial);
    benchSeat.position.set(-trackSide * (PLATFORM_WIDTH / 2 - 0.55), PLATFORM_HEIGHT + 0.42, -1.4);
    benchSeat.castShadow = false;
    benchSeat.receiveShadow = true;
    this.group.add(benchSeat);

    const benchBack = new Mesh(new BoxGeometry(0.1, 0.44, 2.0), boardMaterial);
    benchBack.position.set(-trackSide * (PLATFORM_WIDTH / 2 - 0.32), PLATFORM_HEIGHT + 0.66, -1.4);
    benchBack.castShadow = false;
    this.group.add(benchBack);

    for (const along of [-2.3, -0.5] as const) {
      const leg = new Mesh(new BoxGeometry(0.44, 0.42, 0.12), postMaterial);
      leg.position.set(-trackSide * (PLATFORM_WIDTH / 2 - 0.55), PLATFORM_HEIGHT + 0.21, along);
      leg.castShadow = false;
      this.group.add(leg);
    }

    // The name board on its post is gone (family ruling, 28 July 2026: in-world
    // signs are hard to read). It used to have to be turned to cancel the
    // group's own yaw and face the camera's one fixed angle, which is a fair
    // sign in itself that a board seen from a fixed 45° was never going to be
    // easy reading. The name travels on the platform's interact zone now — see
    // {@link Station.sign} — and the platform keeps its canopy, bench and lamps.

    // --- lamps ---------------------------------------------------------------
    for (const along of [-2.6, -0.2] as const) {
      const lampMaterial = new MeshBasicMaterial({ color: PALETTE.fairyWarm, fog: true });
      const lamp = new Mesh(new SphereGeometry(0.15, 12, 9), lampMaterial);
      lamp.position.set(postX, PLATFORM_HEIGHT + CANOPY_HEIGHT - 0.32, along);
      this.group.add(lamp);
      this.lamps.push(lampMaterial);
    }
  }
}
