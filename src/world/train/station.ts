import {
  BoxGeometry,
  CylinderGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  SphereGeometry,
  Vector3,
} from 'three';
import { PALETTE } from '../../core/palette';
import { signTexture, woodTexture } from '../../core/textures';
import { toonMaterial } from '../../art/style/materials';
import { ART } from '../../art/style/artPalette';
import { terrainHeight } from '../terrain';
import type { CollisionWorld } from '../Collision';
import type { InteractZone } from '../interact';
import type { MovingPlatform } from '../building/surfaces';
import type { TrainRoute } from './route';

/**
 * A little station: a platform, a stripy canopy, a sign and a bench.
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

const PLATFORM_LENGTH = 7.2;
const PLATFORM_WIDTH = 2.6;

/** Centre of the platform, out from the track centre line. */
const PLATFORM_OFFSET = 2.15;

const CANOPY_HEIGHT = 2.9;

export interface StationOptions {
  readonly index: number;
  readonly name: string;
  readonly subtitle: string;
  readonly glyph: string;
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

  interactZone(): InteractZone {
    return {
      id: `train-station-${this.index}`,
      label: this.name,
      x: this.standX,
      y: this.surfaceY,
      z: this.standZ,
      pickRadius: 4.2,
      standX: this.standX,
      standZ: this.standZ,
      // Nothing to press: standing on the platform when the train is in is what
      // gets you a seat, exactly as standing on the slide pad starts the slide.
      pressInteract: false,
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
    const deck = new Mesh(
      new BoxGeometry(PLATFORM_WIDTH, PLATFORM_HEIGHT, PLATFORM_LENGTH),
      deckMaterial,
    );
    deck.position.y = PLATFORM_HEIGHT / 2;
    deck.castShadow = true;
    deck.receiveShadow = true;
    this.group.add(deck);

    // A painted stripe along the platform edge, the side the train comes to.
    const stripe = new Mesh(
      new BoxGeometry(0.3, PLATFORM_HEIGHT + 0.02, PLATFORM_LENGTH),
      edgeMaterial,
    );
    stripe.position.set(trackSide * (PLATFORM_WIDTH / 2 - 0.15), PLATFORM_HEIGHT / 2, 0);
    stripe.castShadow = false;
    stripe.receiveShadow = true;
    this.group.add(stripe);

    // --- canopy --------------------------------------------------------------
    const postGeometry = new CylinderGeometry(0.1, 0.12, CANOPY_HEIGHT, 8);
    // Along the back of the platform, so the canopy never stands between the
    // train and the child waiting for it.
    const postX = -trackSide * (PLATFORM_WIDTH / 2 - 0.35);
    for (const along of [-2.4, 0, 2.4] as const) {
      const post = new Mesh(postGeometry, postMaterial);
      post.position.set(postX, PLATFORM_HEIGHT + CANOPY_HEIGHT / 2, along);
      post.castShadow = true;
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
      new BoxGeometry(PLATFORM_WIDTH + 0.7, 0.16, PLATFORM_LENGTH - 0.6),
      roofMaterial,
    );
    roof.position.set(trackSide * 0.1, PLATFORM_HEIGHT + CANOPY_HEIGHT, 0);
    // Tipped down towards the track, the way a platform awning sheds rain.
    roof.rotation.z = trackSide * 0.06;
    roof.castShadow = true;
    roof.receiveShadow = true;
    this.group.add(roof);

    // Scalloped valance along the front — the one detail that turns a slab of
    // roof into a seaside station.
    const valance = new Mesh(
      new BoxGeometry(0.12, 0.34, PLATFORM_LENGTH - 0.6),
      toonMaterial(ART.cream),
    );
    valance.position.set(
      trackSide * (PLATFORM_WIDTH / 2 + 0.24),
      PLATFORM_HEIGHT + CANOPY_HEIGHT - 0.2,
      0,
    );
    valance.castShadow = false;
    this.group.add(valance);

    // --- bench ---------------------------------------------------------------
    const benchSeat = new Mesh(new BoxGeometry(0.52, 0.1, 2.0), boardMaterial);
    benchSeat.position.set(-trackSide * (PLATFORM_WIDTH / 2 - 0.55), PLATFORM_HEIGHT + 0.42, -1.4);
    benchSeat.castShadow = true;
    benchSeat.receiveShadow = true;
    this.group.add(benchSeat);

    const benchBack = new Mesh(new BoxGeometry(0.1, 0.44, 2.0), boardMaterial);
    benchBack.position.set(-trackSide * (PLATFORM_WIDTH / 2 - 0.32), PLATFORM_HEIGHT + 0.66, -1.4);
    benchBack.castShadow = true;
    this.group.add(benchBack);

    for (const along of [-2.3, -0.5] as const) {
      const leg = new Mesh(new BoxGeometry(0.44, 0.42, 0.12), postMaterial);
      leg.position.set(-trackSide * (PLATFORM_WIDTH / 2 - 0.55), PLATFORM_HEIGHT + 0.21, along);
      leg.castShadow = true;
      this.group.add(leg);
    }

    // --- the sign ------------------------------------------------------------
    const signGroup = new Group();
    signGroup.name = 'station-sign';
    signGroup.position.set(-trackSide * (PLATFORM_WIDTH / 2 + 0.05), PLATFORM_HEIGHT, 2.9);
    // Turned to face out into the park, so it can be read on the walk up: the
    // sign's own +Z has to end up pointing away from the track.
    signGroup.rotation.y = -trackSide * (Math.PI / 2);
    this.group.add(signGroup);

    const signPost = new Mesh(new CylinderGeometry(0.09, 0.11, 2.1, 8), postMaterial);
    signPost.position.y = 1.05;
    signPost.castShadow = true;
    signGroup.add(signPost);

    const board = new Mesh(new BoxGeometry(2.5, 1.0, 0.12), boardMaterial);
    board.position.y = 2.15;
    board.castShadow = true;
    board.receiveShadow = true;
    signGroup.add(board);

    const face = new Mesh(
      new PlaneGeometry(2.36, 0.9),
      new MeshBasicMaterial({
        map: signTexture({
          title: options.name,
          subtitle: options.subtitle,
          glyph: options.glyph,
          accent: options.accent,
        }),
        toneMapped: false,
      }),
    );
    face.position.z = 0.07;
    board.add(face);

    // --- lamps ---------------------------------------------------------------
    for (const along of [-2.4, 2.4] as const) {
      const lampMaterial = new MeshBasicMaterial({ color: PALETTE.fairyWarm, fog: true });
      const lamp = new Mesh(new SphereGeometry(0.15, 12, 9), lampMaterial);
      lamp.position.set(postX, PLATFORM_HEIGHT + CANOPY_HEIGHT - 0.32, along);
      this.group.add(lamp);
      this.lamps.push(lampMaterial);
    }
  }
}
