import {
  BoxGeometry,
  type BufferAttribute,
  ConeGeometry,
  CylinderGeometry,
  Group,
  Mesh,
  type MeshStandardMaterial,
  PlaneGeometry,
  SphereGeometry,
  Vector3,
} from 'three';
import { PALETTE } from '../../core/palette';
import {
  pinkStoneTexture,
  WELCOME_SIGN_CANVAS_HEIGHT,
  WELCOME_SIGN_CANVAS_WIDTH,
  welcomeSignTexture,
  woodTexture,
} from '../../core/textures';
import { addOutline, decal, solid, toonMaterial } from '../../art/style/materials';
import { terrainHeight } from '../terrain';
import type { FrameContext, GameSystem } from '../../core/types';
import type { CollisionWorld } from '../Collision';
import type { Player } from '../../entities/Player';
import { buildPawPrint, CAT_BUS_LENGTH } from './catBus';
import { buildGateArch } from './gateArch';
import { ROAD_HALF_WIDTH, ROAD_TILE_METRES, roadMaterial } from './road';
import {
  entranceRoadAt,
  entranceRoadInnerEdge,
  entranceRoadInnerEdgeAcross,
  entranceRoadInnerEdgeRing,
  entranceRoadInnerNormal,
  entranceRoadStations,
  type RoadStation,
} from './roadRoute';
import { PARK_BOUNDARY, edgeRadiusAt } from '../boundary';
import { PATH_KERB_OVERHANG } from '../../core/constants';
import {
  addPathQuilt,
  GeometryBuilder,
  PATH_KERB_LIFT,
  PATH_SURFACE_LIFT,
  pathKerbMaterial,
  pathSurfaceMaterial,
} from '../pathSurface';

import { forEachPavedDisc } from '../paving';
import { ArrivalSequence, arrivalIsDue } from './ArrivalSequence';
import type { NpcCharacter } from '../../entities/npc/NpcCharacter';
import { highlightObject } from '../highlight';
import { pressAction, type InteractZone } from '../interact';
import { playOpenChime } from '../../ui/chime';
import {
  ENTRANCE_ANGLE,
  ENTRANCE_CLEAR_RADIUS,
  ENTRANCE_CLEAR_X,
  ENTRANCE_CLEAR_Z,
  ENTRANCE_GATE_POST_HEIGHT,
  ENTRANCE_GATE_X,
  ENTRANCE_GATE_Z,
  ENTRANCE_STOP_Z,
} from './layout';
import { TRACK_CLEARANCE, type TrainRoute } from '../train/route';
import { BALLAST_HALF_WIDTH } from '../train/track';
import { TRAIN_PLAN } from '../train/plan';
import { CARRIAGE_BODY_HALF_WIDTH } from '../train/trainDimensions';

/** Candy colours for the welcome sign's bulbs — the fairground palette used everywhere else in the park. */
const WELCOME_SIGN_BULB_COLOURS = [
  PALETTE.fairyWarm,
  PALETTE.fairyPink,
  PALETTE.fairyMint,
  PALETTE.fairyBlue,
] as const;

/**
 * Where the welcome sign **prefers** to stand: just inside the gate, off to
 * the east of the gate-approach path (`paths.ts`'s `gate-approach` is 3.2 m
 * wide, centred on x = 0, so anything past |x| ≈ 1.6 is clear of it) and well
 * inside `ENTRANCE_CLEAR_RADIUS`'s scenery-free pocket around the gate, so no
 * bush or tree scatter can land on it. Mirrors the bus shelter's offset on
 * the west side, so the gate reads as symmetric even though only one side has
 * a prop.
 *
 * **Not where it always ends up.** {@link findWelcomeSignSpot} searches
 * outward from here for the nearest point that clears the train's *solved*
 * centre line — see that function's own comment for why a fixed coordinate
 * cannot be right here.
 */
const WELCOME_SIGN_PREFERRED_X = 7;
const WELCOME_SIGN_PREFERRED_Z = 56;
/** Near the +45° every sign and anchor in the park uses — the one angle the fixed isometric camera reads square-on (ARCHITECTURE.md). */
const WELCOME_SIGN_YAW = Math.PI * 0.25;

/** Local x-offsets of the sign's two posts from its own centre — see {@link buildWelcomeSign}. */
const WELCOME_SIGN_POST_OFFSETS = [-1.9, 1.9] as const;
/** Collision radius of each post, as actually built below. */
const WELCOME_SIGN_POST_RADIUS = 0.35;
/** Half the board's own width (it is 4.4 m across), for sampling its far corners. */
const WELCOME_SIGN_BOARD_HALF_WIDTH = 2.2;

/**
 * What the board says — the one owner of this string. Both the painted
 * plaque ({@link Entrance.buildWelcomeSign}) and its interact chip read from
 * here, so the two can never say something different from each other.
 */
const WELCOME_SIGN_TEXT = 'Welcome to the Land of Good Places.';

/**
 * **How far the sign's board and posts must clear the train's centre line.**
 *
 * `TRACK_CLEARANCE` (`train/route.ts`) is the half-width anything is "inside
 * the train" within; `CARRIAGE_BODY_HALF_WIDTH` (`train/trainDimensions.ts`)
 * is the carriage's own real body half-width, and a prop closer than their
 * sum (2.1 m) is standing where the carriage's body actually passes. This
 * asks for a metre more than that sum on top: "clears" means clears with
 * room, not sits a centimetre outside one of the two numbers — which is
 * exactly what happened before this fix (issue #303 QA: the nearest post
 * measured 0.63 m off the centre line, inside *both* numbers at once).
 */
const WELCOME_SIGN_TRACK_MARGIN = 1.0;
export const WELCOME_SIGN_MIN_TRACK_CLEARANCE =
  TRACK_CLEARANCE + CARRIAGE_BODY_HALF_WIDTH + WELCOME_SIGN_TRACK_MARGIN;

/**
 * The closest distance any sampled point of the welcome sign's real footprint
 * — both posts (less their own collision radius) and the board's full width —
 * comes to the train's *solved* centre line, were the sign centred at (x, z).
 *
 * Sampled rather than measured from the centre alone because the board is
 * 4.4 m wide: a centre point can clear the line by metres while one end of
 * the board does not, which is exactly the shape of bug this function exists
 * to catch rather than repeat.
 */
function welcomeSignFootprintClearance(route: TrainRoute, x: number, z: number): number {
  let worst = Infinity;
  const point = new Vector3();
  const sample = (localX: number, radius: number): void => {
    const px = x + Math.cos(WELCOME_SIGN_YAW) * localX;
    const pz = z - Math.sin(WELCOME_SIGN_YAW) * localX;
    route.pointAt(route.distanceNear(px, pz), point);
    const gap = Math.hypot(point.x - px, point.z - pz) - radius;
    if (gap < worst) worst = gap;
  };
  for (const offset of WELCOME_SIGN_POST_OFFSETS) sample(offset, WELCOME_SIGN_POST_RADIUS);
  // Five samples across the board's own width — wider spacing than the posts
  // themselves catch, and the part actually likely to clip the train if the
  // two posts happened to straddle it.
  for (let t = -WELCOME_SIGN_BOARD_HALF_WIDTH; t <= WELCOME_SIGN_BOARD_HALF_WIDTH; t += 1.1) {
    sample(t, 0);
  }
  return worst;
}

/**
 * **Finds somewhere for the welcome sign that genuinely clears the train.**
 *
 * The QA finding on issue #303 (PR #303): the sign's preferred spot put its
 * nearest post 0.63 m from the rail centre line, inside both `TRACK_CLEARANCE`
 * (1.3 m) and the carriage's own body half-width (0.8 m). Cause: `train/route.ts`
 * solves the train's loop from `PARK_LAYOUT` alone (see that module's own doc),
 * and the entrance — the welcome sign included — is built afterwards, from a
 * fixed coordinate the solver never knew existed. **The gate itself is the one
 * fixed thing in the park** (`entrance/layout.ts`), but the train's loop is not:
 * `TRAIN_LENGTH_FRACTIONS`'s ladder, the search's own restarts and `PARK_SEED`
 * all mean the *solved* centre line runs somewhere different — sometimes close
 * to the gate, sometimes not — on every one of the five CI seeds. A single
 * hand-placed coordinate could only ever be checked against one of them.
 *
 * So this asks the *actual, already-solved* route the same question
 * `test/procgen`'s new invariant asks of the built park: searching outward
 * from the sign's preferred spot, in the scenery-free pocket `Scenery.ts`
 * already keeps clear around the gate (`ENTRANCE_CLEAR_X/Z/RADIUS`) and clear
 * of the gate-approach path, for the nearest point whose whole footprint
 * clears the centre line by {@link WELCOME_SIGN_MIN_TRACK_CLEARANCE}. On a
 * seed where the preferred spot is already clear (most of them), this returns
 * it unchanged — the search is a safety net, not a redesign.
 */
function findWelcomeSignSpot(route: TrainRoute): { x: number; z: number } {
  let bestPassing: { x: number; z: number; distance: number } | null = null;
  // Kept in case *no* candidate clears — which should never happen given the
  // search area, but a best-effort spot is a better failure than a crash, and
  // the new invariant is what would catch it actually happening.
  let bestOverall = { x: WELCOME_SIGN_PREFERRED_X, z: WELCOME_SIGN_PREFERRED_Z, clearance: -Infinity };

  for (let dz = -6; dz <= 4; dz += 0.5) {
    for (let dx = -3; dx <= 4; dx += 0.5) {
      const x = WELCOME_SIGN_PREFERRED_X + dx;
      const z = WELCOME_SIGN_PREFERRED_Z + dz;

      // Off the gate-approach path (half-width 1.6 m, see the preferred spot's
      // own comment), and inside the scenery-free pocket with margin left for
      // the sign's own ~2.5 m reach — straying outside it risks a tree or bush
      // nobody re-scattered to make room.
      if (x < 3) continue;
      if (Math.hypot(x - ENTRANCE_CLEAR_X, z - ENTRANCE_CLEAR_Z) > ENTRANCE_CLEAR_RADIUS - 3) continue;

      const clearance = welcomeSignFootprintClearance(route, x, z);
      if (clearance > bestOverall.clearance) bestOverall = { x, z, clearance };
      if (clearance < WELCOME_SIGN_MIN_TRACK_CLEARANCE) continue;

      const distance = Math.hypot(x - WELCOME_SIGN_PREFERRED_X, z - WELCOME_SIGN_PREFERRED_Z);
      if (!bestPassing || distance < bestPassing.distance) bestPassing = { x, z, distance };
    }
  }

  return bestPassing ?? bestOverall;
}

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
 * **There is a welcome sign, just inside it, and it does carry words** —
 * painted, on the board itself, readable on approach rather than only after
 * a button press. That is a deliberate, one-off exception to the 28 July
 * ruling against painted signage (Jim, 23 August 2026, on PR #303: the board
 * shipped blank, with the words hiding on its interact chip, which was not
 * what "make the sign have actual text on it" meant) — see the note on
 * {@link welcomeSignTexture} in `core/textures.ts` for why this one board
 * gets to break the rule. The interact chip still says the same words
 * (`world/interact.ts`), for a player who reads it that way instead. It is
 * the board that used to stand, blank and unreachable, at the dodgems' own
 * doorway on a dead-end path spur that led nowhere a child could read or
 * press (issue #298, Jim playing 18 August 2026). Moved here rather than
 * rebuilt: same posts, same candy-coloured bulbs, same little pennant, just
 * given somewhere to stand and something to say. See {@link buildWelcomeSign}.
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

  /**
   * @param trainRoute The park train's already-*solved* route
   * (`World.ts` builds `ParkTrain` — and therefore this — before `Entrance`,
   * precisely so the welcome sign can be placed against the real centre line
   * rather than a coordinate the solver never knew about). See
   * {@link findWelcomeSignSpot}.
   */
  constructor(collision: CollisionWorld, trainRoute: TrainRoute, options: EntranceOptions = {}) {
    this.group.name = 'entrance';

    const stoneMaterial = toonMaterial(0xffffff, { map: pinkStoneTexture(2, 1) });
    const capMaterial = toonMaterial(PALETTE.stonePinkLight);

    // --- the gate arch ---------------------------------------------------
    // One owner, `gateArch.ts`: the bus ride builds this same gate at the end
    // of its lane, and the cut between the two lands squarely on it. It used
    // to be built twice, and the copies drifted — issue #480.
    //
    // The posts sit either side of the gate along the wall's own tangent —
    // perpendicular to the radius out to `ENTRANCE_GATE_X/Z` — so the arch
    // reads as a gap cut straight through the ring, whatever angle it is at.
    // A rotation of `yaw` about Y takes the arch's local `+X` onto
    // `(cos yaw, -sin yaw)`, and the tangent is `(-sin A, cos A)`, so the yaw
    // the gate wants is `-(A + π/2)`. The posts come back out of the same
    // rotation rather than being placed from the tangent a second time.
    const arch = buildGateArch({
      centreX: ENTRANCE_GATE_X,
      centreZ: ENTRANCE_GATE_Z,
      yaw: -(ENTRANCE_ANGLE + Math.PI / 2),
      groundAt: terrainHeight,
      stoneMaterial,
      capMaterial,
      // The crossbar is named `park-gate-arch` so `scripts/check-park-map.mts` can ask the *scene* where the
      // gate stands, rather than re-reading the constant the park map already
      // read. The crossbar spans the opening and is centred on it, so its
      // world position is the gate — independent truth for the map's `gate`
      // feature.
      //
      // **`park-gate-`, not just `entrance-`, and that is not fussiness.** The
      // obvious name `entrance-arch` is already taken, by the archway over the
      // castle's own front door in `building/facade.ts`. `getObjectByName`
      // walks the scene and returns the *first* match, and the castle is added
      // under `anchor-plots` before the entrance group is added at all — so
      // the check silently measured the park gate against the castle door and
      // reported the map 65.65 m wrong. Caught the same hour the check was
      // written, which is the argument for scene names being qualified by what
      // owns them.
      namePrefix: 'park-gate',
    });
    this.group.add(arch.group);

    // **The gate is solid at its feet and open above them.** A collider on
    // each post, sized by the arch itself (`footRadius` covers the post's
    // splayed base and the crossbar's tube where it comes down onto it), and
    // deliberately nothing under the span — that span is the way into the
    // park, 3.45 m of headroom over a 1.24 m-wide child, and a collider there
    // would shut the gateway. Proved both ways by
    // `theParkGateArchStandsOverItsGateway` in `test/procgen/invariants.ts`.
    const tangentX = -Math.sin(ENTRANCE_ANGLE);
    const tangentZ = Math.cos(ENTRANCE_ANGLE);
    for (const [index, foot] of arch.feet.entries()) {
      const side = index === 0 ? -1 : 1;
      const ground = terrainHeight(foot.x, foot.z);

      // Nudged back towards the gate centre from the post's own position.
      const pawA = buildPawPrint(toonMaterial(PALETTE.stonePinkDark));
      pawA.position.set(
        foot.x - side * 0.46 * tangentX,
        ground + ENTRANCE_GATE_POST_HEIGHT * 0.55,
        foot.z - side * 0.46 * tangentZ,
      );
      pawA.rotation.y = side > 0 ? -Math.PI / 2 : Math.PI / 2;
      pawA.scale.setScalar(1.6);
      this.group.add(pawA);

      collision.addCircle(foot.x, foot.z, arch.footRadius);
    }

    // --- the welcome sign ----------------------------------------------------
    this.welcomeSignZone = this.buildWelcomeSign(collision, trainRoute);

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
    // Halfway between the arch and where the bus's door actually comes to rest,
    // asked of the road rather than of a constant that used to describe it.
    const shelterZ = (ENTRANCE_GATE_Z + entranceRoadAt(0).z) / 2;
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
   *
   * **Two more bugs fixed here, both found by QA on PR #303:**
   *
   * 1. The zone's `y` used to be the board's *visual centre height*
   *    (`ground + 2.6`), not a ground-level surface like every other interact
   *    zone in the codebase (`minigames/stalls.ts`, `FacePaintStall.ts`) — so it
   *    sat outside `ZONE_HEIGHT_TOLERANCE` (2.2 m) of a standing player's own
   *    `y` and the chip could never be selected in normal play. Fixed by using
   *    `ground` itself, the same pattern everywhere else.
   * 2. The sign's position used to be the fixed preferred spot outright, which
   *    on the canonical seed put a post 0.63 m from the train's centre line.
   *    Fixed by {@link findWelcomeSignSpot} — see its own comment.
   */
  private buildWelcomeSign(collision: CollisionWorld, trainRoute: TrainRoute): InteractZone {
    const { x: signX, z: signZ } = findWelcomeSignSpot(trainRoute);
    const ground = terrainHeight(signX, signZ);
    const signGroup = new Group();
    signGroup.name = 'welcome-sign';
    signGroup.position.set(signX, ground, signZ);
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
    for (const offset of WELCOME_SIGN_POST_OFFSETS) {
      const post = solid(new Mesh(postGeometry, toonMaterial(PALETTE.wood)));
      post.position.set(offset, 1.3, 0);
      signGroup.add(post);
      collision.addCircle(
        signX + Math.cos(WELCOME_SIGN_YAW) * offset,
        signZ - Math.sin(WELCOME_SIGN_YAW) * offset,
        WELCOME_SIGN_POST_RADIUS,
      );
    }

    const board = solid(new Mesh(new BoxGeometry(4.4, 1.9, 0.16), toonMaterial(PALETTE.woodLight)));
    board.position.y = 2.6;
    signGroup.add(board);
    addOutline(board, 0.02);

    // The plaque: a cream mount recessed into the board's own face, with the
    // greeting painted onto a flush plane in front of that — the same
    // frame/mount/canvas layering `world/hotel/dressing.ts`'s
    // `paintedPicture` uses for the hotel's paintings. Each layer pokes a
    // few centimetres past the one behind it (board → mount → text plane) so
    // nothing z-fights and the text sits flush against real wood rather than
    // floating off it on a formula of its own — the exact trap CLAUDE.md's
    // note on painted faces warns against.
    //
    // Built on **both** faces of the board, not just the one a box's
    // default winding calls "front": the sign stands astride the path a
    // player walks in both directions (arriving through the gate, and later
    // heading back out to it), and a plaque only one soul could ever read is
    // exactly the kind of bug this file's own doc comment on debug cameras
    // warns is invisible until someone stands on the wrong side of it. The
    // second copy is the mirror image of the first — z negated, yawed 180°
    // — so the text reads correctly rather than backwards from that side.
    //
    // This is the one board in the park allowed a painted face: see the
    // "deliberate, one-off exception" note on `welcomeSignTexture` itself.
    const plaqueWidth = 3.9;
    const plaqueHeight = plaqueWidth * (WELCOME_SIGN_CANVAS_HEIGHT / WELCOME_SIGN_CANVAS_WIDTH);
    const plaqueTexture = welcomeSignTexture(WELCOME_SIGN_TEXT);

    for (const faceSide of [1, -1] as const) {
      const mount = decal(
        new Mesh(
          new BoxGeometry(plaqueWidth + 0.2, plaqueHeight + 0.2, 0.08),
          toonMaterial(PALETTE.signBoard),
        ),
      );
      mount.position.set(0, 2.6, faceSide * 0.06);
      signGroup.add(mount);

      const textPlane = decal(
        new Mesh(
          new PlaneGeometry(plaqueWidth, plaqueHeight),
          toonMaterial(0xffffff, {
            map: plaqueTexture,
            // Same self-lift `paintedPicture` gives the hotel's paintings — legible
            // walking past at dusk, not just at noon.
            emissive: 0xffffff,
            emissiveIntensity: 0.18,
          }),
        ),
      );
      textPlane.position.set(0, 2.6, faceSide * 0.105);
      // The back copy is spun 180° about Y rather than mirrored in X: that
      // flips the plane's normal (so it still faces outward, away from the
      // board) *and* its local x-axis together, which is what keeps the
      // painted words reading left-to-right instead of mirrored for someone
      // standing on that side.
      if (faceSide < 0) textPlane.rotation.y = Math.PI;
      signGroup.add(textPlane);
    }

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
      x: signX,
      // Ground level, like every other interact zone — see this method's own
      // doc for why `ground + 2.6` (the board's visual centre) was wrong.
      y: ground,
      z: signZ,
      pickRadius: 3.2,
      // Stood between the sign and the gate-approach path, so walking up to
      // read it never means stepping behind the board.
      standX: signX - 2.4,
      standZ: signZ,
      verb: 'Read',
      highlight: highlightObject(signGroup),
      actions: () => pressAction(WELCOME_SIGN_TEXT, () => playOpenChime(), '👋'),
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
 *    Built from `road.ts` — the same width, the same slab courses, the same
 *    dashed line as the lane the ride is driven down, because they are meant to
 *    be the same road and the cut between the two scenes is the one place a
 *    child's eye is on nothing else.
 * 2. **The run in through the gate**, from that kerb to the park's own paving,
 *    so you can trace a walkable surface from outside the wall to inside it
 *    without leaving it. That one is an **ordinary park path** and is built
 *    from `pathSurface.ts` — see {@link buildGatewayPath}.
 *
 * ## Grey, and only here
 *
 * Jim, 3 September 2026 (issue #477): *"the paving outside the park that the
 * bus arrives on should be grey during gameplay - don't change the intro
 * sequence."* Sandy slabs made this read as another of the park's own paths
 * laid outside the wall; a road is grey.
 *
 * The tone is asked for **at this one call site**, which is what makes the
 * second half of that sentence structural rather than a promise. `roadMaterial`
 * defaults to sand, and the only other caller is `BusJourney.ts` — the intro
 * ride, in its own scene, built before any park exists — so it takes the
 * default and draws exactly the bytes it drew before. There is no shared
 * material to accidentally repaint: each caller builds its own from the shared
 * *specification*, and the specification is dimensions, not colour.
 *
 * **The grey stops at the wall**, because that is where the road stops. This
 * used to say the opposite — that the spur through the arch had to be grey too,
 * since cutting one road surface in half at the boundary would put a sand/grey
 * seam down the middle of it, and that the apron inside the arch was bus-stop
 * rather than garden. Jim looked at it and disagreed (3 September): the run in
 * through the gate is a path, so there is no road to cut in half.
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
  const material = roadMaterial('grey');

  /**
   * How far in through the gate the spur can run before the park's own paving
   * is already under it.
   *
   * The spur used to run all the way to `ENTRANCE_STOP_Z`, which is inside the
   * plaza's paving — so its last five and a half metres were a road slab drawn
   * 5 mm under a path slab, 24 m² of shared plane and the fourth-worst seam in
   * the game (#472). The paving wins that argument anyway (`path-surface`
   * carries `polygonOffset: -2`), so the road under it is a hidden face, and
   * `ART_DIRECTION.md` §7's answer to a hidden face is to not draw it.
   *
   * The stopping line is *asked for*, not written down. `paving.ts` is where
   * `buildPaths()` publishes the discs it actually drew, and `Garden` builds
   * the path network long before `Entrance` is constructed, so it is live by
   * the time this runs. A hard-coded z here would be exactly CLAUDE.md's "two
   * definitions of one thing, kept in step by hand" — the paths are generated
   * per seed and this line moves with them. It reads `forEachPavedDisc` rather
   * than `pathGraph`'s own `distanceToPath` for the reason that module exists:
   * importing `pathGraph` *runs the whole path solve*, and this file must not
   * be the thing that triggers it.
   *
   * The road's centre is the part that reaches the paving first, because the
   * path arrives head-on; stopping the whole ribbon there therefore keeps its
   * wings off the paving too. Nothing walkable is lost — the paving carries on
   * from the exact line the road stops at, which is the castle roof deck's fix
   * in a different material.
   */
  const spurReach = (): SpurReach => {
    const from = entranceRoadInnerEdge(0).z;
    for (let z = from; z >= ENTRANCE_STOP_Z; z -= 0.1) {
      let met: number | null = null;
      const known = forEachPavedDisc((x, discZ, radius) => {
        if (Math.hypot(ENTRANCE_GATE_X - x, z - discZ) < radius) {
          // The narrowest path covering the axis here, because that is the one
          // whose width the gateway path should match: joining a 1.3 m-wide
          // street with a ribbon sized off the plaza would step out at the seam.
          if (met === null || radius < met) met = radius;
        }
      });
      // Nothing published — an interior harness with no garden. Behave as
      // before rather than guessing.
      if (!known) return { z: ENTRANCE_STOP_Z, halfWidth: null };
      if (met !== null) return { z, halfWidth: met };
    }
    // No paving reaches the gate on this seed: run the whole way in, as before.
    return { z: ENTRANCE_STOP_Z, halfWidth: null };
  };

  /**
   * The same question asked **down one column** of the gateway path rather than
   * down its middle: how far in can `x` run before the park's own paving is
   * under it?
   *
   * Asking only about the middle is not enough, and the coplanar sweep is what
   * said so. Paving arrives at the gate as a ribbon with a straight end and two
   * straight sides, and the gateway path is a few metres wide: stopping the
   * whole width where the *centre* first meets paving left 0.64 m² of the path
   * lying on `path-surface`, and its kerb 1.53 m² on `path-kerb` — two surfaces
   * in one plane, which is the thing this exists to avoid. Every column stops
   * on its own, so the join follows the shape of what it meets.
   */
  const columnReach = (x: number, from: number, margin: number, floor: number): number => {
    for (let z = from; z >= floor; z -= 0.05) {
      // **The railway's ballast is a surface too, and it gets here first.** On
      // seed 288 the train crosses the gate's own approach 4.5 m inside the
      // wall, so a path run to the paving beyond it is laid straight down the
      // ballast — 3.1 m² of shared plane, and it only appeared when the run
      // became park paving, because a road at its own lift cleared the sweep's
      // one-centimetre tolerance and sandy paving at the path's lift does not.
      // The level crossing paves that band itself, so stopping here leaves no
      // grass behind: one surface hands over to the next.
      if (distanceToTrackCentre(x, z) < BALLAST_HALF_WIDTH + margin) return z;
      let paved = false;
      const known = forEachPavedDisc((discX, discZ, radius) => {
        if (Math.hypot(x - discX, z - discZ) < radius + margin) paved = true;
      });
      if (!known) return floor;
      if (paved) return z;
    }
    // **A column that meets no paving stops level with the middle**, rather
    // than running on to the bus stop on its own. Letting it run was measured
    // and it is worse than it sounds: on seed 288 the columns off the end of
    // the path's own approach found nothing, ran twelve metres in, and laid the
    // path across the railway's ballast — 2.7 m² of shared plane where a
    // metre-long stub was wanted.
    return floor;
  };

  const meshes: Mesh[] = [];

  // --- the kerb, along the road the bus actually drives ---------------------
  //
  // **Swept along `entranceRoadStations()`, which is the same object
  // `ArrivalSequence` drives the bus along** — so the road on screen and the
  // road the bus is on cannot be two things. `check:entrance-road`'s third
  // clause holds them together: every vertex laid here has to fall inside the
  // corridor that check sweeps, and while this ribbon was still the old straight
  // chord it reported 63 to 113 stray vertices a seed, up to 6.43 m out.
  //
  // It runs the road's whole length, tails and all: away from the park, across
  // the Rail Race's line, and over the hilltop's brow, which is where a road
  // leaving a hilltop goes and is as far as the game draws in that direction.
  // Nothing here picks that length — `roadRoute.ts` takes it from `TERRAIN_APRON`,
  // the ground the terrain disc is actually built out to.
  meshes.push(curvedRoadRibbon('entrance-road-kerb', material, entranceRoadStations()));

  meshes.push(...buildGatewayPath(spurReach(), columnReach));

  return meshes;
}

/**
 * How far this point is from the middle of the railway.
 *
 * `TRAIN_PLAN` is a module-load constant — the route is a pure pre-scene plan
 * (`train/plan.ts`) — so asking it here costs nothing and cannot depend on
 * build order, which is the same reason `Scenery.ts`'s `onRailway` asks it.
 */
function distanceToTrackCentre(x: number, z: number): number {
  const route = TRAIN_PLAN.route;
  const near = route.pointAt(route.distanceNear(x, z), trackProbe);
  return Math.hypot(near.x - x, near.z - z);
}
const trackProbe = new Vector3();

/** Where the run in from the road stops, and how wide the paving it meets is. */
interface SpurReach {
  readonly z: number;
  /** Half-width of the narrowest path covering the gate axis there, if any. */
  readonly halfWidth: number | null;
}

/**
 * Fallback width for the run in through the gate on a seed whose paving never
 * reaches the gate (and in an interior harness with no garden at all), where
 * there is no path to take a width from. The park's own streets are 2.6 to
 * 3.6 m across, so this is one of them rather than a number of its own.
 */
const GATEWAY_PATH_FALLBACK_HALF_WIDTH = 1.6;

/**
 * **The short run in through the gate — an ordinary park path.**
 *
 * Jim, 3 September 2026, looking out through the arch: *"the small run of path
 * from the road into the park should be just a normal path, make that change
 * before merging that work"*.
 *
 * It used to be road: the same grey slabs as the kerb outside, running through
 * the arch to meet the park's own pink-and-cream paving at a visible seam a few
 * metres in. The note this replaces argued that cutting the surface at the
 * boundary would put a sand/grey join down the middle of a road, and that the
 * apron inside the arch was bus-stop, not garden. Jim's eye says otherwise, and
 * he is right: the road is the thing outside the wall that the bus drives on.
 * Inside the wall it is a path like every other path, and now it is drawn out
 * of `pathSurface.ts` — the same two materials, the same lifts, the same slab
 * size as the network it joins, rather than a copy of any of them.
 *
 * **Its width comes from the path it meets**, and its far end from that path's
 * own paving (`spurReach`), so nothing here is a number picked to look right on
 * one seed: on the sixteen in the pool the run is 5.9 to 10.2 m long and the
 * paving it joins is 2.8 to 3.2 m across, and it follows both.
 *
 * **Its road end is the road's own boundary, point for point.** Not a straight
 * line at one representative `z`: the kerb is curved, and across even a path's
 * width its inner edge wanders up to 0.93 m — so a straight join lies across
 * the road (a coplanar seam, which is what the road-width spur left behind) or
 * opens a wedge of grass between the two surfaces at the one place every child
 * walks. `entranceRoadInnerEdgeAcross` hands back the kerb's own vertices and
 * the quilt is built onto them.
 */
function buildGatewayPath(
  reach: SpurReach,
  columnReach: (x: number, from: number, margin: number, floor: number) => number,
): Mesh[] {
  const halfWidth = reach.halfWidth ?? GATEWAY_PATH_FALLBACK_HALF_WIDTH;

  /**
   * One band of the run, between two signed offsets from the gate's axis, at
   * its own lift, stopping `margin` short of the published paving — which is
   * the paving's *surface*, so a band that has to stop clear of the network's
   * **kerb** says so with the same overhang the network draws it at.
   */
  const band = (
    name: string,
    fromX: number,
    toX: number,
    lift: number,
    margin: number,
    material: MeshStandardMaterial,
  ): Mesh | null => {
    const road = densify(
      entranceRoadInnerEdgeAcross((fromX + toX) / 2, Math.abs(toX - fromX) / 2),
      GATEWAY_PATH_COLUMN,
    );
    if (road.length < 2) return null;
    // **Each column stops where the paving under *it* starts**, so the far end
    // follows the edge of what it meets instead of cutting across it.
    const park = road.map((point) => ({ x: point.x, z: columnReach(point.x, point.z, margin, reach.z) }));
    // A row per metre or so of run, for the same reason the road is sampled at
    // a metre: the ground under the arch is not flat and a ribbon laid in two
    // rows cuts the corner of it.
    const rows = Math.max(2, Math.round(Math.abs((road[0] as { z: number }).z - reach.z)));
    const builder = new GeometryBuilder();
    addPathQuilt(builder, road, park, rows, lift);
    const mesh = new Mesh(builder.build(), material);
    mesh.name = name;
    mesh.receiveShadow = true;
    return mesh;
  };

  // **The kerb is the two bands you can see, not a slab under the path.** The
  // network's own kerb was rebuilt this way (`pathGraph.ts`'s `addRibbonKerb`)
  // because a full-width kerb ribbon laid 25 mm under an opaque surface only
  // 0.425 m narrower is buried everywhere except its two edges — 3.99 m² of
  // shared plane, the largest garden seam in the whole baseline. Drawing this
  // one the same way is not imitation for its own sake: built as a slab it
  // reproduced exactly that seam here, 1.53 m² of it against `path-kerb`,
  // measured. Nothing changes on screen; the deleted middle was never visible.
  const centre = ENTRANCE_GATE_X;
  return [
    band(
      'entrance-gateway-path-kerb-left',
      centre - halfWidth - PATH_KERB_OVERHANG,
      centre - halfWidth,
      PATH_KERB_LIFT,
      PATH_KERB_OVERHANG,
      pathKerbMaterial(),
    ),
    band(
      'entrance-gateway-path-kerb-right',
      centre + halfWidth,
      centre + halfWidth + PATH_KERB_OVERHANG,
      PATH_KERB_LIFT,
      PATH_KERB_OVERHANG,
      pathKerbMaterial(),
    ),
    band(
      'entrance-gateway-path',
      centre - halfWidth,
      centre + halfWidth,
      PATH_SURFACE_LIFT,
      0,
      pathSurfaceMaterial(),
    ),
  ].filter((mesh): mesh is Mesh => mesh !== null);
}

/**
 * How finely the gateway path is cut across its width, in metres.
 *
 * The far end of each column stops on its own, so the end of the path is a
 * staircase approximating the edge of the paving it meets — and the width of a
 * step is how far that approximation can be wrong. At the road ring's own
 * spacing (about a metre) the error left 0.22 m² of path lying on
 * `path-surface`; the sweep drops any overlap under a square centimetre, so the
 * step has to be small enough that no single one of them reaches that.
 */
const GATEWAY_PATH_COLUMN = 0.15;

/**
 * Splits a polyline so no segment is longer than `spacing`, **without moving
 * any of its points**.
 *
 * Safe on the road's inner edge specifically because a point interpolated along
 * one of its segments still lies exactly on the drawn kerb's own boundary — the
 * boundary between two ring vertices *is* that straight segment. This is the
 * distinction that made the earlier attempt fail: resampling the road's *centre
 * line* and offsetting produces points that are near the kerb rather than on
 * it, and near is a seam.
 */
function densify(
  points: readonly { readonly x: number; readonly z: number }[],
  spacing: number,
): { x: number; z: number }[] {
  const out: { x: number; z: number }[] = [];
  for (let i = 0; i < points.length; i += 1) {
    const a = points[i] as { x: number; z: number };
    out.push({ x: a.x, z: a.z });
    const b = points[i + 1];
    if (!b) break;
    const steps = Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / spacing);
    for (let s = 1; s < steps; s += 1) {
      out.push({ x: a.x + ((b.x - a.x) * s) / steps, z: a.z + ((b.z - a.z) * s) / steps });
    }
  }
  return out;
}

/**
 * **One curved ribbon of road, swept along the route's own stations.**
 *
 * The straight {@link roadRibbon} below cannot lay this: it builds an
 * axis-aligned `PlaneGeometry` and asks `applyRoadUvs` to read `u` and `v` off
 * world `x`/`z`, which only says anything while the road runs down an axis. A
 * road that turns needs its `v` measured **along itself**.
 *
 * **The scale is still owned by `road.ts`.** `u` spans `ROAD_HALF_WIDTH * 2`
 * exactly once and `v` counts `ROAD_TILE_METRES`, which are the same two
 * divisors `applyRoadUvs` uses — so the slabs, the kerbs and the centre line
 * come out the same size on this ribbon as on the straight spur it abuts, and
 * a change to either constant moves both. Writing a `repeat` here instead, or
 * a tile size of its own, is precisely the second definition CLAUDE.md warns
 * about, and it would show up as a visible step in the paving at the join.
 *
 * Vertices are placed in **world coordinates and the mesh is never moved**,
 * for the reason `applyRoadUvs` documents at length: a geometry displaced after
 * its vertices are laid describes where it used to be.
 */
function curvedRoadRibbon(
  name: string,
  material: ReturnType<typeof roadMaterial>,
  stations: readonly RoadStation[],
): Mesh {
  const across = 8;
  const geometry = new PlaneGeometry(1, 1, across, stations.length - 1);
  const position = geometry.getAttribute('position') as BufferAttribute;
  const uv = geometry.getAttribute('uv') as BufferAttribute;

  // **Column 0 is the road's own inner edge**, taken from `roadRoute.ts`'s ring
  // rather than recomputed from the station's frame here. The path through the
  // gate is built onto that same list, so the two meshes share a boundary by
  // construction. While this loop worked the edge out for itself the agreement
  // was a measurement — 0 of 143 stations disagreed on seed 326 — and a
  // measurement is not a mechanism.
  const innerRing = entranceRoadInnerEdgeRing();
  for (let row = 0; row < stations.length; row += 1) {
    const station = stations[row] as RoadStation;
    const inner = innerRing[row] as { x: number; z: number };
    const normal = entranceRoadInnerNormal(station);
    for (let column = 0; column <= across; column += 1) {
      const t = column / across;
      const offset = t * ROAD_HALF_WIDTH * 2;
      const x = inner.x - normal.x * offset;
      const z = inner.z - normal.z * offset;
      const index = row * (across + 1) + column;
      // A hand's breadth up, so it never z-fights the lawn — the same lift the
      // park's own paths take.
      position.setXYZ(index, x, terrainHeight(x, z) + 0.06, z);
      uv.setXY(index, t, station.at / ROAD_TILE_METRES);
    }
  }
  position.needsUpdate = true;
  uv.needsUpdate = true;

  // **Every triangle has to be turned over, and without this the whole road is
  // invisible.**
  //
  // `PlaneGeometry` is authored in the XY plane facing **+Z**, and its index is
  // wound to be front-facing seen from there. The loop above keeps that index
  // and rewrites the vertices into the **XZ** plane — rows running along the
  // road, columns across it. Going from (right, up) to (across, along) flips the
  // handedness of the surface, so every one of those triangles ends up wound the
  // other way and the finished road faces the *ground*.
  //
  // Nothing about that is visible to a check that reads vertex positions —
  // `check:entrance-road` proved all 1287 of them were inside the corridor and
  // 0.06 m above the lawn, on all sixteen seeds, while the road could not be seen
  // at all: `MeshToonMaterial` is `FrontSide`, so a road facing down is culled
  // and you look straight through it at the grass. The only thing on screen was
  // the faint band of its own shading. Measured before the fix: 2272 of 2272
  // triangles facing down, mean vertex normal.y **-0.822**, against the gateway
  // spur beside it — a plain `roadRibbon`, built in world space — at +1.000.
  //
  // `check:entrance-road` now asserts the drawn road faces the sky, which is the
  // assertion that was missing rather than a second copy of this reasoning.
  //
  // **Whether to flip is measured off the first triangle**, not asserted once
  // and left. Which way the columns run is `roadRoute.ts`'s business now — its
  // inner normal turns round if the park is on the other side of the heading —
  // so a fixed "always reverse" would be right on the geometry it was written
  // against and silently wrong on any other. This asks.
  const index = geometry.getIndex();
  if (index && facesTheGround(position, index)) {
    for (let i = 0; i < index.count; i += 3) {
      const second = index.getX(i + 1);
      const third = index.getX(i + 2);
      index.setX(i + 1, third);
      index.setX(i + 2, second);
    }
    index.needsUpdate = true;
  }
  geometry.computeVertexNormals();

  const mesh = new Mesh(geometry, material);
  mesh.name = name;
  mesh.receiveShadow = true;
  return mesh;
}

/**
 * Does this indexed, near-horizontal geometry face downwards? Read off the
 * first triangle, which is enough for a ribbon: every quad in one is wound the
 * same way as its neighbours, and it is the *inherited* winding of the whole
 * sheet that flips, never one triangle of it.
 */
function facesTheGround(position: BufferAttribute, index: BufferAttribute): boolean {
  if (index.count < 3) return false;
  const a = index.getX(0);
  const b = index.getX(1);
  const c = index.getX(2);
  const abx = position.getX(b) - position.getX(a);
  const abz = position.getZ(b) - position.getZ(a);
  const acx = position.getX(c) - position.getX(a);
  const acz = position.getZ(c) - position.getZ(a);
  return abz * acx - abx * acz < 0;
}

