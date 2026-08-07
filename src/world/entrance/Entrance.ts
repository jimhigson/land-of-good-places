import {
  BoxGeometry,
  CylinderGeometry,
  Group,
  Mesh,
  SphereGeometry,
  TorusGeometry,
} from 'three';
import { PALETTE } from '../../core/palette';
import { pinkStoneTexture, woodTexture } from '../../core/textures';
import { toonMaterial } from '../../art/style/materials';
import { terrainHeight } from '../terrain';
import type { FrameContext, GameSystem } from '../../core/types';
import type { CollisionWorld } from '../Collision';
import type { Player } from '../../entities/Player';
import { buildPawPrint } from './catBus';
import { ArrivalSequence, arrivalIsDue } from './ArrivalSequence';
import {
  ENTRANCE_ANGLE,
  ENTRANCE_BUS_STOP_Z,
  ENTRANCE_GATE_X,
  ENTRANCE_GATE_Z,
} from './layout';

export interface EntranceOptions {
  /**
   * Whether the cat bus brings her in.
   *
   * **Defaults to {@link arrivalIsDue}** — i.e. to the arrival *happening* —
   * so that forgetting to wire this up fails loud (a bus turns up when it
   * should not) rather than silent (no bus, ever, and nobody notices for
   * twelve days). Only a caller that positively knows better passes `false`:
   * a ride deep link, or `/view`'s debug camera.
   */
  readonly arriveByBus?: boolean;
}

/**
 * The park entrance: a gated arch in the boundary wall, and a little bus stop
 * with a shelter just inside — always present, whether or not the cat bus is
 * mid-arrival. See `Garden.ts`'s `buildBoundaryWall` for the matching gap left
 * in the wall itself, and `paths.ts`'s `spur-entrance` route for the path that
 * leads up to it.
 *
 * **The park's name is no longer painted on a board under the arch.** The
 * family had every sign in the park taken out on 28 July 2026 — a canvas face
 * on a rectangle seen from the camera's one fixed angle is hard to read, which
 * is exactly why it needed a full-screen reader to go with it. The name is not
 * lost: `ui/Hud.ts`'s park pill has said it, in ordinary DOM text at the
 * ordinary minimum size, since long before this. The arch keeps its posts, its
 * caps, its paw prints and its crossbar, which is what makes it a gate.
 */
export class Entrance implements GameSystem {
  readonly name = 'entrance';
  readonly group = new Group();

  /**
   * The cat bus arrival, or `null` if she has already arrived on this save.
   *
   * Built here rather than in `Game` on purpose — see `ArrivalSequence`'s own
   * note. `Game` cannot be constructed in a test (it builds a real
   * `WebGLRenderer`); `World`, and therefore this, can, which is what puts the
   * bus inside reach of the invariant suite CI blocks the merge on.
   */
  readonly arrival: ArrivalSequence | null;

  constructor(collision: CollisionWorld, options: EntranceOptions = {}) {
    this.group.name = 'entrance';

    const stoneMaterial = toonMaterial(0xffffff, { map: pinkStoneTexture(2, 1) });
    const capMaterial = toonMaterial(PALETTE.stonePinkLight);

    // --- the gate arch ---------------------------------------------------
    const halfWidth = 4.3;
    const postHeight = 3.3;
    const postGeometry = new CylinderGeometry(0.42, 0.5, postHeight, 12);
    // The posts sit either side of the gate along the wall's own tangent —
    // perpendicular to the radius out to `ENTRANCE_GATE_X/Z` — so the arch
    // reads as a gap cut straight through the ring, whatever angle it is at.
    const tangentX = -Math.sin(ENTRANCE_ANGLE);
    const tangentZ = Math.cos(ENTRANCE_ANGLE);

    for (const side of [-1, 1] as const) {
      const x = ENTRANCE_GATE_X + side * halfWidth * tangentX;
      const z = ENTRANCE_GATE_Z + side * halfWidth * tangentZ;
      const ground = terrainHeight(x, z);

      const post = new Mesh(postGeometry, stoneMaterial);
      post.position.set(x, ground + postHeight / 2, z);
      post.castShadow = true;
      post.receiveShadow = true;
      this.group.add(post);

      const cap = new Mesh(new SphereGeometry(0.62, 14, 10), capMaterial);
      cap.position.set(x, ground + postHeight + 0.15, z);
      cap.scale.set(1, 0.75, 1);
      cap.castShadow = true;
      this.group.add(cap);

      // Nudged back towards the gate centre from the post's own position.
      const pawA = buildPawPrint(toonMaterial(PALETTE.stonePinkDark));
      pawA.position.set(x - side * 0.46 * tangentX, ground + postHeight * 0.55, z - side * 0.46 * tangentZ);
      pawA.rotation.y = side > 0 ? -Math.PI / 2 : Math.PI / 2;
      pawA.scale.setScalar(1.6);
      this.group.add(pawA);

      collision.addCircle(x, z, 0.55);
    }

    // A curved crossbar joining the two posts, following the wall's own
    // pink-stone material family so the gate reads as part of the boundary,
    // not a separate prop dropped in front of it.
    const crossbar = new Mesh(new TorusGeometry(halfWidth, 0.28, 10, 24, Math.PI), capMaterial);
    const archGround = terrainHeight(ENTRANCE_GATE_X, ENTRANCE_GATE_Z);
    crossbar.position.set(ENTRANCE_GATE_X, archGround + postHeight + 0.15, ENTRANCE_GATE_Z);
    crossbar.rotation.z = Math.PI;
    crossbar.rotation.y = Math.PI / 2;
    crossbar.castShadow = true;
    this.group.add(crossbar);

    // --- the bus stop shelter ----------------------------------------------
    // **On the pavement, outside the gate** — because that is where the bus
    // stops. It used to stand at `ENTRANCE_STOP_X + 3.5, ENTRANCE_STOP_Z`,
    // 8 m *inside* the park, under a comment claiming the bus's kerb-side door
    // opened onto it. That was only ever true of a bus parked inside the park,
    // which is exactly the thing Jim saw and objected to on 7 August 2026.
    //
    // Now it sits between the wall and the kerb the bus pulls up along, off to
    // one side of the opening so it never blocks the way in, and clear of the
    // bus's own footprint.
    const shelterX = -9;
    const shelterZ = (ENTRANCE_GATE_Z + ENTRANCE_BUS_STOP_Z) / 2;
    const shelterGround = terrainHeight(shelterX, shelterZ);
    const woodMaterial = toonMaterial(0xffffff, { map: woodTexture(2, 1) });

    const shelterPostGeometry = new CylinderGeometry(0.14, 0.16, 2.3, 8);
    for (const dz of [-1, 1] as const) {
      const post = new Mesh(shelterPostGeometry, woodMaterial);
      post.position.set(shelterX, shelterGround + 1.15, shelterZ + dz * 0.9);
      post.castShadow = true;
      post.receiveShadow = true;
      this.group.add(post);
      collision.addCircle(post.position.x, post.position.z, 0.2);
    }

    const canopy = new Mesh(
      new BoxGeometry(1.6, 0.14, 2.3),
      toonMaterial(PALETTE.buildingTrim),
    );
    canopy.position.set(shelterX + 0.3, shelterGround + 2.3, shelterZ);
    canopy.rotation.z = 0.1;
    canopy.castShadow = true;
    canopy.receiveShadow = true;
    this.group.add(canopy);

    const bench = new Mesh(new BoxGeometry(1.4, 0.42, 0.5), woodMaterial);
    bench.position.set(shelterX, shelterGround + 0.21, shelterZ);
    bench.castShadow = true;
    bench.receiveShadow = true;
    this.group.add(bench);

    // The little "Bus Stop 🚌" lollipop went with every other sign, and its
    // post went with it rather than being left standing on the verge holding
    // nothing. The shelter, the bench and the cat's paw prints are what say
    // "the bus comes here", and the bus itself says the rest.

    const pawB = buildPawPrint(toonMaterial(PALETTE.stonePinkDark));
    pawB.position.set(shelterX, shelterGround + 0.02, shelterZ - 1.1);
    pawB.rotation.x = -Math.PI / 2;
    pawB.scale.setScalar(2.1);
    this.group.add(pawB);

    // --- the arrival ---------------------------------------------------------
    // Built last, and added to this group, so the whole sequence lives under
    // the gate it happens at and goes away with it.
    const arriving = options.arriveByBus ?? arrivalIsDue();
    this.arrival = arriving ? new ArrivalSequence() : null;
    if (this.arrival) this.group.add(this.arrival.group);
  }

  /**
   * The player, once `Game` has built her — reached through
   * `World.attachPlayer`, same as every other system that needs her.
   *
   * She is put aboard the bus the moment she exists, so there is never a frame
   * in which she stands in the park watching her own bus arrive without her.
   */
  attachPlayer(player: Player): void {
    this.arrival?.attachPlayer(player);
  }

  /**
   * Drives the arrival, while there is one.
   *
   * The stonework is stonework and does not move; `Entrance` was already a
   * {@link GameSystem} with an empty `update` against the day something here
   * wanted a frame, and the cat bus is that day.
   */
  update(context: FrameContext): void {
    this.arrival?.update(context);
  }
}
