import {
  BoxGeometry,
  type BufferAttribute,
  ConeGeometry,
  CylinderGeometry,
  Group,
  Mesh,
  PlaneGeometry,
  SphereGeometry,
  TorusGeometry,
} from 'three';
import { PALETTE } from '../../core/palette';
import { pinkStoneTexture, woodTexture } from '../../core/textures';
import { addOutline, decal, solid, toonMaterial } from '../../art/style/materials';
import { terrainHeight } from '../terrain';
import type { FrameContext, GameSystem } from '../../core/types';
import type { CollisionWorld } from '../Collision';
import type { Player } from '../../entities/Player';
import { buildPawPrint, CAT_BUS_LENGTH } from './catBus';
import { ROAD_HALF_WIDTH, applyRoadUvs, roadMaterial } from './road';
import { PARK_BOUNDARY, edgeRadiusAt } from '../boundary';
import { ArrivalSequence, arrivalIsDue } from './ArrivalSequence';
import type { NpcCharacter } from '../../entities/npc/NpcCharacter';
import { highlightObject } from '../highlight';
import { pressAction, type InteractZone } from '../interact';
import { playOpenChime } from '../../ui/chime';
import {
  ENTRANCE_ANGLE,
  ENTRANCE_BUS_ARRIVE_X,
  ENTRANCE_BUS_STOP_Z,
  ENTRANCE_BUS_VANISH_X,
  ENTRANCE_GATE_HALF_WIDTH,
  ENTRANCE_GATE_POST_HEIGHT,
  ENTRANCE_GATE_X,
  ENTRANCE_GATE_Z,
  ENTRANCE_STOP_Z,
} from './layout';

/** Candy colours for the welcome sign's bulbs — the fairground palette used everywhere else in the park. */
const WELCOME_SIGN_BULB_COLOURS = [
  PALETTE.fairyWarm,
  PALETTE.fairyPink,
  PALETTE.fairyMint,
  PALETTE.fairyBlue,
] as const;

/**
 * Where the welcome sign stands: just inside the gate, off to the east of the
 * gate-approach path (`paths.ts`'s `gate-approach` is 3.2 m wide, centred on
 * x = 0, so anything past |x| ≈ 1.6 is clear of it) and well inside
 * `ENTRANCE_CLEAR_RADIUS`'s scenery-free pocket around the gate, so no bush or
 * tree scatter can land on it. Mirrors the bus shelter's offset on the west
 * side, so the gate reads as symmetric even though only one side has a prop.
 */
const WELCOME_SIGN_X = 7;
const WELCOME_SIGN_Z = 56;
/** Near the +45° every sign and anchor in the park uses — the one angle the fixed isometric camera reads square-on (ARCHITECTURE.md). */
const WELCOME_SIGN_YAW = Math.PI * 0.25;

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
 * **The park's name is no longer painted on a board under the arch itself.**
 * The family had every sign in the park taken out on 28 July 2026 — a canvas
 * face on a rectangle seen from the camera's one fixed angle is hard to read,
 * which is exactly why it needed a full-screen reader to go with it. The name
 * is not lost: `ui/Hud.ts`'s park pill has said it, in ordinary DOM text at
 * the ordinary minimum size, since long before this. The arch keeps its
 * posts, its caps, its paw prints and its crossbar, which is what makes it a
 * gate.
 *
 * **There is a welcome sign, just inside it, and it does carry words** — on
 * its interact chip, the same way every other sign in the park says its piece
 * now (`world/interact.ts`). It is the board that used to stand, blank and
 * unreachable, at the dodgems' own doorway on a dead-end path spur that led
 * nowhere a child could read or press (issue #298, Jim playing 18 August
 * 2026). Moved here rather than rebuilt: same posts, same candy-coloured
 * bulbs, same little pennant, just given somewhere to stand and something to
 * say. See {@link buildWelcomeSign}.
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

  /** The welcome sign's bulbs, twinkling on `elapsed` like every other fairy light in the park. */
  private readonly welcomeSignBulbs: Mesh[] = [];
  /** The welcome sign's own tap target — see {@link interactZones}. */
  private readonly welcomeSignZone: InteractZone;

  constructor(collision: CollisionWorld, options: EntranceOptions = {}) {
    this.group.name = 'entrance';

    const stoneMaterial = toonMaterial(0xffffff, { map: pinkStoneTexture(2, 1) });
    const capMaterial = toonMaterial(PALETTE.stonePinkLight);

    // --- the gate arch ---------------------------------------------------
    // One owner, in `layout.ts`: the ride builds this same arch at the end of
    // its lane, and the cut between the two lands squarely on it.
    const halfWidth = ENTRANCE_GATE_HALF_WIDTH;
    const postHeight = ENTRANCE_GATE_POST_HEIGHT;
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

    // --- the welcome sign ----------------------------------------------------
    this.welcomeSignZone = this.buildWelcomeSign(collision);

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

    // --- the road ------------------------------------------------------------
    for (const mesh of buildEntranceRoad()) this.group.add(mesh);

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
   * The eleven children riding in, once `World` has built the crowd.
   *
   * These are ordinary park NPCs — the arrival borrows them, it does not own
   * them and never disposes of them. When the sequence ends they carry on
   * being exactly what they already were, which is the whole point of Jim's
   * ruling: *"These are the park NPCs, and should continue as such when they
   * are in the park."*
   */
  attachNpcs(children: readonly NpcCharacter[]): void {
    this.arrival?.attachNpcs(children);
  }

  /**
   * Re-applies the pose {@link update} already computed for the player.
   *
   * Called at the very end of `World.update` because several systems in
   * between may nudge her, while {@link update} itself has to run *before* the
   * crowd so its passengers reach the instance buffer on the right frame. One
   * pose, computed once, applied at both points — never two.
   */
  reassertPlayerPose(): void {
    this.arrival?.reassertPlayerPose();
  }

  /**
   * Drives the arrival, and twinkles the welcome sign's bulbs.
   *
   * The stonework is stonework and does not move; `Entrance` was already a
   * {@link GameSystem} with an empty `update` against the day something here
   * wanted a frame, and the cat bus was the first thing to need one — the
   * sign's bulbs are the second, on the same `elapsed`-driven sine every other
   * string of fairy lights in the park uses (`minigames/dodgems/plot.ts`,
   * `world/TreeLights.ts`).
   */
  update(context: FrameContext): void {
    this.arrival?.update(context);
    for (let i = 0; i < this.welcomeSignBulbs.length; i += 1) {
      const bulb = this.welcomeSignBulbs[i];
      if (!bulb) continue;
      bulb.scale.setScalar(0.82 + 0.3 * Math.sin(context.elapsed * 3 + i * 0.7));
    }
  }

  /** The welcome sign's own tap target — the park's one piece of readable text. */
  interactZones(): InteractZone[] {
    return [this.welcomeSignZone];
  }

  /**
   * Builds the welcome sign and its interact zone.
   *
   * The prop itself — two posts, a board, a lintel of candy-coloured bulbs and
   * a little pennant — is the one that used to stand at the dodgems' own
   * doorway, unread and unreachable (issue #298). It carries no painted text
   * (the TEXT RULE took every canvas face off a board on 28 July 2026): the
   * words live on the interact chip instead, exactly where every other sign in
   * the park keeps its words now.
   *
   * **The action has to be real**, not a bare label with nothing behind it —
   * `Selection` drops any zone whose `actions()` comes back empty, so a sign
   * with no press was a sign nobody could ever select (`world/hotel/Hotel.ts`'s
   * "your door" zone hit this exact bug on 7 August 2026). A soft chime is a
   * small thing to press for, but it is a real one — the same one the shop
   * counter and the backpack already use for "something opened", not a new
   * sound invented for a one-off prop.
   */
  private buildWelcomeSign(collision: CollisionWorld): InteractZone {
    const ground = terrainHeight(WELCOME_SIGN_X, WELCOME_SIGN_Z);
    const signGroup = new Group();
    signGroup.name = 'welcome-sign';
    signGroup.position.set(WELCOME_SIGN_X, ground, WELCOME_SIGN_Z);
    signGroup.rotation.y = WELCOME_SIGN_YAW;
    this.group.add(signGroup);

    const bulbMaterials = WELCOME_SIGN_BULB_COLOURS.map((colour) =>
      toonMaterial(colour, { emissive: colour, emissiveIntensity: 0.85 }),
    );
    const bulbGeometry = new SphereGeometry(0.16, 10, 8);

    // 1.9 m out: the nav lattice fattens each post by the walker radius, and
    // any tighter than this the gap between the two posts inflates shut (the
    // dodgems arch this was moved from found that the hard way).
    const postGeometry = new CylinderGeometry(0.14, 0.16, 2.6, 8);
    for (const offset of [-1.9, 1.9]) {
      const post = solid(new Mesh(postGeometry, toonMaterial(PALETTE.wood)));
      post.position.set(offset, 1.3, 0);
      signGroup.add(post);
      collision.addCircle(
        WELCOME_SIGN_X + Math.cos(WELCOME_SIGN_YAW) * offset,
        WELCOME_SIGN_Z - Math.sin(WELCOME_SIGN_YAW) * offset,
        0.35,
      );
    }

    const board = solid(new Mesh(new BoxGeometry(4.4, 1.9, 0.16), toonMaterial(PALETTE.woodLight)));
    board.position.y = 2.6;
    signGroup.add(board);
    addOutline(board, 0.02);

    // Bulbs along the lintel, like a real fairground arch.
    for (let i = 0; i < 10; i += 1) {
      const t = i / 9;
      const bulb = decal(new Mesh(bulbGeometry, bulbMaterials[i % 4] ?? bulbMaterials[0]));
      bulb.position.set(-1.5 + t * 3, 3.62, 0.06);
      signGroup.add(bulb);
      this.welcomeSignBulbs.push(bulb);
    }

    const topper = decal(new Mesh(new ConeGeometry(0.3, 0.7, 5), toonMaterial(PALETTE.markerLemon)));
    topper.position.set(0, 3.95, 0);
    signGroup.add(topper);

    return {
      id: 'welcome-sign',
      label: 'welcome sign',
      x: WELCOME_SIGN_X,
      y: ground + 2.6,
      z: WELCOME_SIGN_Z,
      pickRadius: 3.2,
      // Stood between the sign and the gate-approach path, so walking up to
      // read it never means stepping behind the board.
      standX: WELCOME_SIGN_X - 2.4,
      standZ: WELCOME_SIGN_Z,
      verb: 'Read',
      highlight: highlightObject(signGroup),
      actions: () => pressAction('Welcome to the Land of Good Places.', () => playOpenChime(), '👋'),
    };
  }
}

/**
 * **The road, arriving at the park and going in through the gate.**
 *
 * Jim, 7 August 2026, having ridden the whole thing: *"it doesn't actually drive
 * up to the park, the road needs to actually go to the park."*
 *
 * He was looking at two absences at once, and this is the second of them. The
 * bus pulled up on **grass**: there was no road at the entrance at all, so a
 * vehicle that had spent twenty seconds on a lane arrived somewhere no lane
 * reached. (The first absence — that the ride showed no park ahead of it — is
 * fixed in `BusJourney.buildParkAhead`.)
 *
 * Two ribbons, and the second is the one that answers him literally:
 *
 * 1. **The kerb**, running along the bus's own stopping line outside the wall.
 * 2. **The spur**, running from that kerb straight through the gate opening and
 *    on to the bus stop inside. You can trace the road surface from outside the
 *    wall to inside it without leaving it.
 *
 * Both are built from `road.ts` — the same width, the same slabs, the same
 * dashed line as the lane the ride is driven down, because they are meant to be
 * the same road and the cut between the two scenes is the one place a child's
 * eye is on nothing else.
 *
 * ## The kerb's length is measured, not chosen
 *
 * The park boundary is a spline pinned to 60 m on the gate's bearing and bulging
 * to 92 m within 40 degrees of it (#115), so a *straight* kerb road outside the
 * gate dives back **inside the park** at both ends of its run — the same trap
 * that made `ENTRANCE_BUS_ARRIVE_X` a measured number rather than a symmetrical
 * one. So the run is found by walking outward from the gate axis and stopping
 * where the road's inner edge would cross the boundary, asking `PARK_BOUNDARY`
 * itself rather than restating a number once derived from it.
 */
function buildEntranceRoad(): Mesh[] {
  const material = roadMaterial();

  /** How far along the kerb the road can run before it is inside the park. */
  const kerbReach = (direction: -1 | 1): number => {
    // The road's inner edge is the part that would enter the park first.
    const edgeZ = ENTRANCE_BUS_STOP_Z - ROAD_HALF_WIDTH;
    let reach = 0;
    for (let x = 0; x <= 60; x += 0.5) {
      const at = direction * x;
      if (Math.hypot(at, edgeZ) < edgeRadiusAt(PARK_BOUNDARY, Math.atan2(edgeZ, at))) break;
      reach = x;
    }
    return reach;
  };

  const meshes: Mesh[] = [];

  // --- the kerb, along the bus's stopping line -------------------------------
  // Long enough to cover the whole run the bus drives, so it is never on grass:
  // `ENTRANCE_BUS_ARRIVE_X` in, `ENTRANCE_BUS_VANISH_X` out, plus half a bus
  // either end for its own length. Clipped to what the boundary allows.
  const halfBus = CAT_BUS_LENGTH / 2;
  const kerbTo = Math.min(kerbReach(1), ENTRANCE_BUS_ARRIVE_X + halfBus);
  const kerbFrom = -Math.min(kerbReach(-1), Math.abs(ENTRANCE_BUS_VANISH_X) + halfBus);
  meshes.push(
    roadRibbon({
      name: 'entrance-road-kerb',
      material,
      from: { x: kerbFrom, z: ENTRANCE_BUS_STOP_Z },
      to: { x: kerbTo, z: ENTRANCE_BUS_STOP_Z },
      across: 'z',
      along: 'x',
      centre: ENTRANCE_BUS_STOP_Z,
    }),
  );

  // --- the spur, in through the gate ----------------------------------------
  // From the outer edge of the kerb road to the bus stop inside the park, so it
  // crosses the wall through the gate's own opening and meets ground the
  // plaza's paths already reach.
  meshes.push(
    roadRibbon({
      name: 'entrance-road-gateway',
      material,
      from: { x: ENTRANCE_GATE_X, z: ENTRANCE_BUS_STOP_Z + ROAD_HALF_WIDTH },
      to: { x: ENTRANCE_GATE_X, z: ENTRANCE_STOP_Z },
      across: 'x',
      along: 'z',
      centre: ENTRANCE_GATE_X,
    }),
  );

  return meshes;
}

interface RoadRibbonOptions {
  readonly name: string;
  readonly material: ReturnType<typeof roadMaterial>;
  readonly from: { x: number; z: number };
  readonly to: { x: number; z: number };
  readonly across: 'x' | 'z';
  readonly along: 'x' | 'z';
  readonly centre: number;
}

/**
 * One straight ribbon of road, draped on the terrain.
 *
 * Built in **world coordinates before anything is displaced**, and then not
 * moved: `applyRoadUvs` reads the geometry's own positions, so a mesh translated
 * after its vertices are placed gets UVs describing where it used to be. That is
 * the mistake that put the journey's hills 100 m out of step with everything
 * driving on them (`BusJourney.buildGround`), in the form it would take here.
 */
function roadRibbon(options: RoadRibbonOptions): Mesh {
  const { name, material, from, to, across, along, centre } = options;
  const length = Math.hypot(to.x - from.x, to.z - from.z);
  const alongSegments = Math.max(4, Math.round(length / 2));
  // Eight segments across: the texture pins its kerbs at fixed `u`, so too few
  // samples across puts the nearest vertex metres from the kerb it should draw.
  const geometry = new PlaneGeometry(
    across === 'x' ? ROAD_HALF_WIDTH * 2 : length,
    across === 'x' ? length : ROAD_HALF_WIDTH * 2,
    across === 'x' ? 8 : alongSegments,
    across === 'x' ? alongSegments : 8,
  );
  geometry.rotateX(-Math.PI / 2);
  geometry.translate((from.x + to.x) / 2, 0, (from.z + to.z) / 2);

  const position = geometry.getAttribute('position') as BufferAttribute;
  for (let i = 0; i < position.count; i += 1) {
    // Lifted a hand's breadth so it never z-fights the lawn, as the park's own
    // paths are.
    position.setY(i, terrainHeight(position.getX(i), position.getZ(i)) + 0.06);
  }
  position.needsUpdate = true;
  geometry.computeVertexNormals();
  applyRoadUvs(geometry, { across, along, centre });

  const mesh = new Mesh(geometry, material);
  mesh.name = name;
  mesh.receiveShadow = true;
  return mesh;
}
