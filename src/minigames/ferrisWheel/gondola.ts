import {
  BoxGeometry,
  Color,
  CylinderGeometry,
  DoubleSide,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  PointLight,
  Quaternion,
  RingGeometry,
  SphereGeometry,
  TorusGeometry,
  Vector3,
  type Object3D,
} from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { PALETTE } from '../../core/palette';
import { TAU, angleDelta, clamp, clamp01 } from '../../core/mathUtils';
import { addOutline, decal, disposeTree, solid, toonMaterial } from '../../art/style/materials';
import type { CreatureHandle } from '../../art/style/asset';
import type { AssetHandle } from '../../art/style/asset';
import type { Expression } from '../../art/style/faces';
import { gameStore } from '../../state';
import { shopItem, type ShopItem } from '../../world/building/shops/catalogue';
import { FERRIS_CAR_COLOURS } from './wheelProp';
import { ART } from '../../art/style/artPalette';
import { createKid } from '../../art/models/kid';
import { PET_KINDS, createPet } from '../../art/models/pets';

/**
 * The car you ride in, and the piece of wheel it hangs from.
 *
 * The camera lives inside this, parented to {@link Gondola.seat} — which is the
 * whole reason the ride feels like a ride. The car sways on its hanger, and
 * because the view is bolted to the car, the horizon sways with it. Move the
 * camera independently and you get a slideshow of space; hang it off the car
 * and you get a fairground ride.
 *
 * **You cannot see your own ferris wheel through the front window**, which is
 * true of real ones too and was a genuine surprise when the first version came
 * out looking like a bus. The fix is the **skylight**: a glass panel in the roof
 * with the hanger, the rim and the spokes sweeping past above it. That one
 * detail is what tells a child what they are riding.
 *
 * **Your parade rides with you.** Up to three cute things you own and have not
 * stowed are read straight out of the store and sat in the little chairs
 * facing the window. Nothing is written back — the ride never touches saved
 * state, so leaving it, however you leave it, cannot lose anything.
 *
 * **Two heights of seat (27 July 2026).** The family's note: *"the pet should
 * sit on a chair that is lower than the player's so it is easier to see above
 * their head, restructure the car to fit."* So the car now has a **raised
 * window seat at the back for the player** and a **row of low tub chairs at
 * the front for the pets** — and it grew a little in every direction to hold
 * them. The numbers are chosen together and checked by
 * `scripts/checkGondolaSightline.mjs`: the tallest thing that can ride sits
 * with the top of its head **below the player's eye line**, so the horizon and
 * everything above it is yours, and the pet is something you look down at
 * fondly rather than around.
 */

/** How many of your cute things come along. One chair each. */
const SEATS = 3;

/**
 * The floor between the pet chairs (facing the window, at `z ≈ -0.64`) and the
 * player's seat (at `z ≈ 0.95`, against the back glass) is deliberately left
 * bare. A future NPC companion sitting opposite the player (queued in
 * GAME_DESIGN.md, not built here) belongs there, facing back towards the
 * seat — do not fill this gap with more furniture or parade overflow. The car
 * was made deeper when the two seats went in partly to keep this gap; a puff
 * is 1.26 m across and three chairs' worth of passenger reaches `z ≈ 0`, so
 * there is about 0.6 m of clear floor and no more.
 */

/** Interior dimensions of the car, in metres. */
const CAR_WIDTH = 3.6;
const CAR_DEPTH = 2.8;
const CAR_HEIGHT = 2.6;

/** Radius of the wheel this car hangs off, in the ride's own world. */
const RIDE_RIM_R = 7;

/** Height above the car floor of the rim point it hangs from. */
const ATTACH_Y = 3.05;

/** Half-thickness of the rim's own tube. The rims are torus sections. */
const RIM_TUBE_R = 0.16;

/**
 * How far apart the two rims sit — clear outside the car's shoulders.
 *
 * **Derived, not dialled in.** It was a bare 1.9, which put the rim's *inner
 * surface* at 1.74 — inboard of the car's own half-width of 1.8, and further
 * still inside the floor skirt at 1.88. So the two big circles cut straight
 * through the car's edges, which is what Jim saw from inside it.
 *
 * The arithmetic, so it cannot drift again if the car is ever resized: the
 * widest part of the car is the floor skirt at `(CAR_WIDTH + 0.16) / 2`, the
 * rim's inner surface is `RIM_HALF_GAP - RIM_TUBE_R`, and the difference is
 * {@link RIM_CLEARANCE} — enough that the car can swing on its hanger without
 * ever touching, since it swings and the rig does not.
 */
const RIM_CLEARANCE = 0.26;
const RIM_HALF_GAP = (CAR_WIDTH + 0.16) / 2 + RIM_TUBE_R + RIM_CLEARANCE;

/** Spokes on the ride's wheel. Matches the landmark. */
const SPOKES = 12;

/** How far a passenger's own head sits above its seat, near enough for aiming. */
const PASSENGER_EYE_Y = 1.1;

/**
 * How a passenger turns to look at something.
 *
 * **The whole toy turns, not its neck.** Jim's call, and it is the right one:
 * these are squashed-sphere toys, the face comes round with the body, and a
 * separate head yaw was a second formula tracking the first for nothing
 * visible. It went through two wrong shapes first — a neck clamped so tight
 * that anything over a shoulder barely moved anybody, then a neck-plus-body
 * split with three constants and two ease rates to keep in step. One rotation,
 * one number.
 *
 * There is no clamp either. `angleDelta` already turns whichever way is
 * nearer, so a passenger takes the short way round to anything at all — and
 * there is no direction it should refuse, since half this show deliberately
 * happens behind you and the car is glass on every side.
 *
 * **Pitch stays on the head**, and only pitch. A seated toy tipped backwards
 * to look up at the Moon reads as one that has fallen over; a head that looks
 * up reads as one that is looking up. That is a genuinely different axis
 * rather than a duplicate of this one.
 */
const WATCH_PITCH_LIMIT = 0.5;

/** How quickly a passenger comes round onto whatever it is looking at. */
const TURN_EASE = 2.6;

/** How far below its rim point a neighbouring car's middle hangs. */
const NEIGHBOUR_HANG = 1.7;

/**
 * The neighbouring cars' own size — the park wheel's, not yours.
 *
 * Yours is deliberately roomy because you are sitting in it with three cute
 * things; theirs stay the size the wheel's twelve cars actually are, since at
 * this radius cars this far apart are already almost touching.
 */
const NEIGHBOUR_WIDTH = 1.75;
const NEIGHBOUR_DEPTH = 1.5;
const NEIGHBOUR_HEIGHT = 1.45;

/**
 * Blinking, on the same beat the player herself uses (`Player.ts`).
 *
 * Nobody in this car blinked at all until Jim asked. The face is painted onto
 * a canvas, so a blink is a **texture swap** — cheap, but only if it happens on
 * the two transitions; calling `setExpression` every frame would flip
 * `needsUpdate` every frame and re-upload the texture to the GPU. Hence the
 * "only when it changes" guard in `blink`.
 *
 * Each face gets its own starting phase, so a car full of toys does not blink
 * in unison — which is considerably more unsettling than not blinking at all.
 */
const BLINK_DURATION = 0.11;
const BLINK_GAP_MIN = 2.6;
const BLINK_GAP_RANGE = 3.4;

/**
 * The rim lamps: how big, and how far proud of the rim they stand.
 *
 * They were centred *on* the rim, which put a 0.16 m ball inside a 0.16 m tube
 * — embedded rather than fitted, so all you saw was a glow in the metal. They
 * sit on the **outer face** of each rim now, far enough out to read as lamps
 * bolted to the sides of the wheel and just far enough in that they are
 * plainly attached to it.
 */
const BULB_R = 0.16;
const BULB_STAND = RIM_TUBE_R + 0.1;

/** Scaled down to their car, which is about half the size of yours. */
const NEIGHBOUR_RIDER_SCALE = 0.52;

/** Their pet, a little smaller again — same idea as your own low tub chairs. */
const NEIGHBOUR_PET_SCALE = 0.34;

/** Where the two of them sit, across the car. */
const NEIGHBOUR_SEAT_X = 0.36;
const NEIGHBOUR_SEAT_Y = 0.2;

/** So the four of them are not quadruplets. Indexed, not random: same wheel every ride. */
const NEIGHBOUR_HAIR = [ART.kidHair, PALETTE.hair, PALETTE.wood, PALETTE.stonePinkDark];
const NEIGHBOUR_OUTFIT = [
  PALETTE.markerSky,
  PALETTE.markerLemon,
  PALETTE.markerMint,
  PALETTE.markerPink,
];

// ------------------------------------------------------- the two seat heights
//
// These numbers are one decision, not four, and they are why the car is the
// size it is.
//
// Every pet is normalised to `PET_RENDER_HEIGHT` (1.46 m — see
// `art/models/pets.ts`, and note that the normaliser had to be *fixed* to
// include ears before that was true: a bunny used to render 2.12 m tall). Sat
// on a 0.16 m cushion its head tops out at 1.62, and RiPika — the tallest
// thing in the catalogue that reads as a creature — at 1.64. The player's eye
// is at 1.80, a metre above their own cushion, which is where a child's eye
// sits when their feet are on the footrest. That leaves **0.16 m of daylight
// over the tallest head**, and the whole sky is the player's.
//
// If you change one of these, run `node scripts/checkGondolaSightline.mjs`,
// which recomputes the clearance from these exact numbers and fails if any
// passenger's head reaches the eye line.

/** Top of the pets' cushions, above the car floor. */
const PET_CHAIR_SEAT_Y = 0.16;

/** Top of the player's cushion. Their seat is the high one on purpose. */
const PLAYER_SEAT_Y = 0.8;

/** Where the pet chairs stand, across the front of the car. */
const PET_CHAIR_X = 1.05;
const PET_CHAIR_Z = -0.64;

/**
 * Where the player's eye sits, in car space — i.e. where the ride parents its
 * camera (`SpaceFerrisWheel.init`).
 *
 * Exported rather than written out again over there, because it is not a free
 * choice: it is `PLAYER_SEAT_Y` plus a seated child, and it is the number the
 * pet chairs are kept below. The two used to drift apart in two files.
 *
 * **Position only.** The ride sets the camera's *rotation* itself and the
 * look-around directions are family-confirmed correct — this must stay a pure
 * translation, with no rotation of the seat group, or those directions change.
 */
export const GONDOLA_EYE = Object.freeze({ x: 0, y: 1.8, z: 0.78 });

/** One face's blink clock. Its own phase, so nobody blinks in unison. */
interface FaceLife {
  until: number;
  shut: number;
  showing: Expression;
}

function newFace(): FaceLife {
  return { until: BLINK_GAP_MIN * Math.random(), shut: 0, showing: 'neutral' };
}

interface Passenger {
  readonly handle: AssetHandle;
  readonly creature: CreatureHandle | null;
  readonly baseY: number;
  /** The way its chair faces. Everything below is measured out from here. */
  readonly baseYaw: number;
  readonly phase: number;
  readonly face: FaceLife;
}

export interface Gondola {
  readonly root: Group;
  /** Parent the camera to this. It sways with the car. */
  readonly seat: Group;
  /** How many of the player's cute things came along. */
  readonly passengerCount: number;
  /**
   * How far round the wheel the car has travelled, in radians.
   *
   * Zero is the bottom of the wheel. The car itself never moves — the hub
   * swings around it — which is what keeps the camera rig simple.
   */
  setWheelAngle(angle: number): void;
  /** Everyone in the car looks delighted and turns to look at you. */
  rejoice(): void;
  /**
   * Turn the passengers to watch something out of the window.
   *
   * `point` is in **car space** — the same coordinates `space.ts`'s `fromAngle`
   * lays the show out in. `null` puts their noses back to the glass.
   *
   * A wave still wins: being looked *at* by your own pet is the point of
   * bringing it, and a passing planet does not get to interrupt that.
   */
  watch(point: Vector3 | null): void;
  /** Warm lamp inside, off in daylight and on once you are in the dark. */
  setLampGlow(glow: number): void;
  update(dt: number, elapsed: number): void;
  dispose(): void;
}

export function createGondola(): Gondola {
  const root = new Group();
  root.name = 'ferris:gondola';

  /** The car, which hangs and swings. Everything you sit in is under here. */
  const car = new Group();
  car.name = 'car';
  root.add(car);

  const seat = new Group();
  seat.name = 'seat';
  car.add(seat);

  const shellColour = FERRIS_CAR_COLOURS[0] ?? PALETTE.markerPink;
  // The frame — posts, rails, window bars — is all one light cream, so it
  // reads as one thin structure rather than four different walls.
  const cream = toonMaterial(PALETTE.buildingWall);
  const woodMaterial = toonMaterial(PALETTE.wood);
  const cushion = toonMaterial(PALETTE.markerLilac);
  // Not quite clear: a faint tint is what tells the eye there is glass there at
  // all, and a window you cannot see is just a hole.
  const glass = toonMaterial(PALETTE.glassTint, { transparent: true, opacity: 0.13 });
  // The floor and roof are glass too, and they are the two panes a child looks
  // *through* rather than out of — so they carry a little more tint than the
  // windows do. A floor you cannot see is a floor a six-year-old will not
  // believe is there, and the first thing she does on a glass floor is check it
  // is holding her up.
  const floorGlass = toonMaterial(PALETTE.glassTint, { transparent: true, opacity: 0.22 });

  const halfWidth = CAR_WIDTH / 2;
  const halfDepth = CAR_DEPTH / 2;

  // --- floor and roof: glass, like everything between them --------------------
  //
  // **The gondola rebuild (27 July 2026).** The first car had opaque walls on
  // three sides and a porthole apiece for the other two — "a box with a
  // porthole", in the family's own words, and exactly what this rebuild
  // removes. What is left holding the roof up is four corner posts thin
  // enough to get a hand between, a low handrail, and glass the rest of the
  // way round on all four sides: front, back and both flanks alike. The child
  // is meant to feel like they are riding in a glass bubble, not a room with
  // a window in it.
  //
  // **The floor and the roof are glass too (28 July 2026).** The family asked
  // for it, and it is what finishes the bubble: the car had glass on four
  // sides and a wooden floor and a painted lid, which is a lantern, not a
  // bubble. Now a child can look **straight down at the park** through her own
  // feet and **straight up at the sky** through the roof — and the pitch limits
  // in `SpaceFerrisWheel.ts` were opened up in the same breath so she can
  // actually reach both. The two changes are one change; if you narrow the
  // pitch again, this glass stops being worth its transparency.
  //
  // Still `solid()`: the floor catches the lamp and the passengers' shadows,
  // and a glass floor that receives nothing looks like a hole rather than a
  // pane.
  const floor = solid(
    new Mesh(new RoundedBoxGeometry(CAR_WIDTH, 0.14, CAR_DEPTH, 3, 0.06), floorGlass),
  );
  floor.position.y = -0.07;
  car.add(floor);

  // The rug used to be a mint disc across the middle of the floor, which is
  // precisely the patch of floor the family now wants to see through. It stays
  // as a **ring** round the edge instead: the same colour note in the same
  // place, and it reads as the frame of a very big porthole, which is what the
  // floor now is.
  const rug = decal(
    new Mesh(new RingGeometry(1.5, 1.72, 32), toonMaterial(PALETTE.markerMint, { side: DoubleSide })),
  );
  rug.rotation.x = -Math.PI / 2;
  rug.position.set(0, 0.02, -0.1);
  // Squashed down the car's short axis, and no further: at 0.74 the ring's
  // outer edge lands at z ±1.27 about its own centre, which keeps it inside the
  // front and back glass at ±1.4. It is rotated flat, so this scales what was
  // the geometry's Y before the rotation — the car's Z.
  rug.scale.set(1, 0.74, 1);
  car.add(rug);

  // No outline on the roof any more: `addOutline` builds a back-facing hull in
  // a flat ink colour, and on a pane you are looking through that is an opaque
  // ceiling with extra steps.
  const roof = solid(
    new Mesh(new RoundedBoxGeometry(CAR_WIDTH + 0.16, 0.13, CAR_DEPTH + 0.16, 3, 0.06), floorGlass),
  );
  roof.position.y = CAR_HEIGHT;
  car.add(roof);

  // --- the frame: four corner posts and a handrail, and nothing else ----------
  const postRadius = 0.05;
  const corners: readonly (readonly [number, number])[] = [
    [-halfWidth, -halfDepth],
    [halfWidth, -halfDepth],
    [-halfWidth, halfDepth],
    [halfWidth, halfDepth],
  ];
  for (const [cx, cz] of corners) {
    const post = solid(
      new Mesh(new CylinderGeometry(postRadius, postRadius * 1.15, CAR_HEIGHT, 10), cream),
    );
    post.position.set(cx, CAR_HEIGHT / 2, cz);
    car.add(post);
    addOutline(post, 0.012);
  }

  // A low rail running the whole way round inside the glass — a real thing a
  // child could imagine holding onto, and the one piece of "frame" that is not
  // also a window mullion.
  const railY = 0.98;
  const railBar = (length: number, x: number, z: number, alongX: boolean): void => {
    const bar = solid(
      new Mesh(
        new RoundedBoxGeometry(alongX ? length : 0.05, 0.05, alongX ? 0.05 : length, 2, 0.02),
        cream,
      ),
    );
    bar.position.set(x, railY, z);
    car.add(bar);
  };
  railBar(CAR_WIDTH, 0, -halfDepth, true);
  railBar(CAR_WIDTH, 0, halfDepth, true);
  railBar(CAR_DEPTH, -halfWidth, 0, false);
  railBar(CAR_DEPTH, halfWidth, 0, false);

  // --- windows, all the way round ----------------------------------------------
  // A frame around a hole, plus a pane of the faintest glass — on all four
  // sides. There is no direction from the seat that looks out onto a wall.
  // The glass runs higher than it used to. The player's eye went up with the
  // new seat, and if the top rail had stayed where it was, the amount of sky
  // you can see by looking up through the front window would have gone down
  // with it — the one thing this rebuild must not cost.
  const windowTop = 2.46;
  const windowBottom = 0.42;
  const windowSpan = 0.28; // clearance eaten by each corner post

  const frameBar = (
    length: number,
    height: number,
    x: number,
    z: number,
    y: number,
    alongX: boolean,
  ): void => {
    const bar = solid(
      new Mesh(
        new RoundedBoxGeometry(alongX ? length : 0.14, height, alongX ? 0.14 : length, 3, 0.05),
        cream,
      ),
    );
    bar.position.set(x, y, z);
    car.add(bar);
  };

  const glassPane = (length: number, x: number, z: number, alongX: boolean): void => {
    const pane = decal(
      new Mesh(new BoxGeometry(alongX ? length : 0.04, windowTop - windowBottom, alongX ? 0.04 : length), glass),
    );
    pane.position.set(x, (windowTop + windowBottom) / 2, z);
    car.add(pane);
  };

  // Front and back.
  for (const z of [-halfDepth, halfDepth] as const) {
    glassPane(CAR_WIDTH - windowSpan, 0, z, true);
    frameBar(CAR_WIDTH, windowBottom, 0, z, windowBottom / 2, true);
    frameBar(CAR_WIDTH, CAR_HEIGHT - windowTop, 0, z, (CAR_HEIGHT + windowTop) / 2, true);
  }
  // Left and right.
  for (const x of [-halfWidth, halfWidth] as const) {
    glassPane(CAR_DEPTH - windowSpan, x, 0, false);
    frameBar(CAR_DEPTH, windowBottom, x, 0, windowBottom / 2, false);
    frameBar(CAR_DEPTH, CAR_HEIGHT - windowTop, x, 0, (CAR_HEIGHT + windowTop) / 2, false);
  }

  // A pair of diagonal highlight streaks on the front glass — enough to tell
  // the eye there is glass there at all, without doing it on all four panes.
  const streakMaterial = new MeshBasicMaterial({
    color: PALETTE.blossomWhite,
    transparent: true,
    opacity: 0.08,
    depthWrite: false,
  });
  for (const [offset, width] of [
    [-0.55, 0.16],
    [-0.2, 0.07],
  ] as const) {
    const streak = decal(new Mesh(new BoxGeometry(width, 2.3, 0.02), streakMaterial));
    streak.position.set(offset, 1.35, -halfDepth - 0.03);
    streak.rotation.z = 0.42;
    car.add(streak);
  }

  // A cheerful scalloped valance along the top of the front window, the same
  // shape the fairground booths wear.
  const scallopMaterial = toonMaterial(PALETTE.markerLemon);
  const scallops = 7;
  for (let i = 0; i < scallops; i += 1) {
    const scallop = decal(
      new Mesh(
        new CylinderGeometry(0.11, 0.11, (CAR_WIDTH - 0.5) / scallops, 10, 1, false, 0, Math.PI),
        i % 2 === 0 ? scallopMaterial : toonMaterial(shellColour),
      ),
    );
    scallop.rotation.z = Math.PI / 2;
    scallop.position.set(
      -halfWidth + 0.25 + (i + 0.5) * ((CAR_WIDTH - 0.5) / scallops),
      windowTop - 0.02,
      -halfDepth + 0.12,
    );
    car.add(scallop);
  }

  // --- the skylight ring --------------------------------------------------------
  //
  // The skylight used to be a pane of glass let into an opaque roof, and it was
  // the one window that showed you what you were riding. **The whole roof is
  // that window now**, so the pane itself has gone — laying one sheet of glass
  // over another only doubled the tint in the exact spot the wheel goes past.
  //
  // The cream ring stays. It is what a child's eye actually reads as "look up
  // here", it frames the hub and the spokes sweeping past, and without it a
  // fully glazed roof is just an absence.
  const skylightRing = solid(new Mesh(new TorusGeometry(0.95, 0.08, 8, 24), cream));
  skylightRing.rotation.x = Math.PI / 2;
  skylightRing.position.set(0, CAR_HEIGHT + 0.04, -0.15);
  skylightRing.scale.set(1, 0.78, 1);
  car.add(skylightRing);

  // --- the player's seat: the high one, at the back --------------------------
  //
  // You never see yourself in here, so this exists for two reasons only: the
  // back of it is in shot whenever a child turns round to look out of the rear
  // glass, and it is the thing the pets' chairs are lower *than*. The footrest
  // is the tell — a seat with a bar to swing your feet against is obviously a
  // high one.
  const playerSeat = solid(
    new Mesh(new RoundedBoxGeometry(CAR_WIDTH - 0.7, 0.2, 0.68, 3, 0.08), cushion),
  );
  playerSeat.position.set(0, PLAYER_SEAT_Y - 0.1, 0.95);
  car.add(playerSeat);
  addOutline(playerSeat, 0.016);

  const playerBack = solid(
    new Mesh(new RoundedBoxGeometry(CAR_WIDTH - 0.7, 0.62, 0.16, 3, 0.07), cushion),
  );
  playerBack.position.set(0, PLAYER_SEAT_Y + 0.31, 1.23);
  car.add(playerBack);
  addOutline(playerBack, 0.016);

  for (const side of [-1, 1] as const) {
    const legMesh = solid(
      new Mesh(new CylinderGeometry(0.08, 0.09, PLAYER_SEAT_Y - 0.2, 8), woodMaterial),
    );
    legMesh.position.set(side * (halfWidth - 0.62), (PLAYER_SEAT_Y - 0.2) / 2, 0.95);
    car.add(legMesh);
  }

  const footrest = solid(
    new Mesh(new RoundedBoxGeometry(CAR_WIDTH - 0.9, 0.07, 0.07, 2, 0.03), cream),
  );
  footrest.position.set(0, 0.3, 0.5);
  car.add(footrest);

  // --- the pets' chairs: three low ones, across the front --------------------
  //
  // One each, built to fit a pet rather than the pet scaled to fit it (pets are
  // size-normalised and `root.scale` is spoken for — see `art/models/pets.ts`).
  // They are here whether anybody is riding in them or not: three matching
  // little chairs in a row read as *the pets' seats, empty today*, where one
  // gap in a bench would just read as a bench.
  const chairCushion = toonMaterial(PALETTE.markerLemon);
  const petChair = (x: number): Group => {
    const chair = new Group();
    chair.name = 'petChair';

    const pad = solid(new Mesh(new RoundedBoxGeometry(0.72, 0.11, 0.64, 3, 0.05), chairCushion));
    pad.position.y = PET_CHAIR_SEAT_Y - 0.055;
    chair.add(pad);
    addOutline(pad, 0.014);

    // A low back, so it is a chair and not a step — and no higher, because a
    // tall back would hide the very thing sitting in it.
    const back = solid(new Mesh(new RoundedBoxGeometry(0.72, 0.34, 0.1, 3, 0.045), woodMaterial));
    back.position.set(0, PET_CHAIR_SEAT_Y + 0.17, -0.3);
    chair.add(back);
    addOutline(back, 0.014);

    for (const fx of [-1, 1] as const) {
      for (const fz of [-1, 1] as const) {
        const foot = solid(new Mesh(new CylinderGeometry(0.045, 0.05, 0.11, 8), woodMaterial));
        foot.position.set(fx * 0.27, 0.055, fz * 0.22);
        chair.add(foot);
      }
    }

    // Built facing +Z with its back at -Z, like every other asset in the park,
    // then turned to face the window — and turned a few degrees further, in
    // towards the middle, so a face is catchable from the seat behind. Nothing
    // in this park is plumb (ART_DIRECTION.md §4); three chairs squared off in
    // a row look like a waiting room.
    chair.position.set(x, 0, PET_CHAIR_Z);
    chair.rotation.y = facing(x);
    car.add(chair);
    return chair;
  };

  /** Left, centre, right. {@link CHAIR_ORDER} decides who gets which. */
  const petChairs = [petChair(-PET_CHAIR_X), petChair(0), petChair(PET_CHAIR_X)];

  // --- lamp --------------------------------------------------------------------
  const lampShade = decal(
    new Mesh(new SphereGeometry(0.16, 14, 10), new MeshBasicMaterial({ color: PALETTE.fairyWarm, toneMapped: false })),
  );
  lampShade.position.set(0, CAR_HEIGHT - 0.22, 0.5);
  car.add(lampShade);

  const lamp = new PointLight(PALETTE.fairyWarm, 0, 7, 2);
  lamp.position.set(0, CAR_HEIGHT - 0.3, 0.2);
  car.add(lamp);

  // --- passengers ----------------------------------------------------------------
  const passengers: Passenger[] = [];
  const bench = new Group();
  bench.name = 'passengers';
  car.add(bench);

  const owned = gameStore
    .get()
    .inventory.filter((item) => item.paradeable && !item.stowed)
    .slice(0, SEATS);

  // Tallest to the outside, shortest into the middle of the window. Read off
  // each handle's own `height` rather than a table here, so a cute thing added
  // next month sorts itself. Everything that can ride already clears the eye
  // line (see the seat-height block at the top of this file); this is the extra
  // courtesy of putting the biggest heads where the view matters least.
  const boarding = owned
    .map((item) => shopItem(item.id))
    .filter((entry): entry is ShopItem => entry !== null)
    .map((entry) => ({ entry, handle: entry.model() }))
    .sort((a, b) => b.handle.height - a.handle.height);

  boarding.forEach(({ entry, handle }, index) => {
    const chairIndex = CHAIR_ORDER[boarding.length]?.[index] ?? 1;
    const chair = petChairs[chairIndex];
    if (!chair) return;

    // A balloon is **tied** to its chair rather than sat in it. Its origin is
    // the bottom of the string — the hand-hold, per the asset contract — so
    // the string starts at the chair's feet and the animal floats over the
    // seat, which is both what you actually do with a balloon and what keeps
    // the one passenger taller than a pet under the player's eye line.
    const seatY = entry.kind === 'balloon' ? 0 : PET_CHAIR_SEAT_Y;
    handle.root.position.set(chair.position.x, seatY, chair.position.z);
    handle.root.rotation.y = chair.rotation.y;
    bench.add(handle.root);

    passengers.push({
      handle,
      creature: asCreature(handle),
      baseY: seatY,
      baseYaw: chair.rotation.y,
      phase: index * 1.7,
      face: newFace(),
    });
  });

  // Sit them down: legs forward, arms resting. A toy standing to attention on a
  // bench looks like it was dropped there.
  for (const passenger of passengers) {
    const limbs = passenger.creature?.limbs;
    if (!limbs) continue;
    limbs.leftLeg.rotation.x = -1.25;
    limbs.rightLeg.rotation.x = -1.15;
    limbs.leftArm.rotation.x = 0.25;
    limbs.rightArm.rotation.x = 0.25;
  }

  /** Where a passenger looks when it looks at *you*: the player's own eye. */
  const playerLookPoint = new Vector3(GONDOLA_EYE.x, GONDOLA_EYE.y, GONDOLA_EYE.z);

  /** What the passengers are watching, in car space. See `watch`. */
  const watchPoint = new Vector3();
  let watching = false;
  /** Scratch for working out where a neighbour's occupant actually is. */
  const occupantOrigin = new Vector3();

  /**
   * Keeps a face alive: blinks it, over whatever it is otherwise doing.
   *
   * `resting` is what the face should show between blinks — 'happy' while
   * somebody is being waved at, 'neutral' the rest of the time — so this can
   * punch a blink through without arguing with the joy state.
   */
  const blink = (face: FaceLife, creature: CreatureHandle | null, resting: Expression, dt: number): void => {
    if (!creature) return;
    face.until -= dt;
    if (face.until <= 0) {
      face.until = BLINK_GAP_MIN + Math.random() * BLINK_GAP_RANGE;
      face.shut = BLINK_DURATION;
    }
    if (face.shut > 0) face.shut -= dt;
    const wanted: Expression = face.shut > 0 ? 'blink' : resting;
    if (wanted === face.showing) return;
    face.showing = wanted;
    creature.setExpression(wanted);
  };

  /**
   * Turns a seated figure to look at something, or lets it idle.
   *
   * **The whole toy turns, not its neck** — the face comes round with the body,
   * so a separate head yaw would be a second formula tracking the first. Pitch
   * stays on the head, and only pitch: a seated toy tipped backwards to look up
   * at the Moon reads as one that has fallen over, whereas a head that looks up
   * reads as one that is looking up.
   *
   * Shared by the people in *your* car and the people in the four cars you
   * watch go past, so a change to how anybody looks around is a change to how
   * everybody does.
   *
   * `origin` and `target` are both in car space; `baseYaw` is the way the seat
   * faces, which everything else is measured out from.
   */
  const turnToward = (
    figure: Object3D,
    head: Object3D | null,
    baseYaw: number,
    origin: Vector3,
    target: Vector3 | null,
    phase: number,
    dt: number,
    elapsed: number,
  ): void => {
    let yaw = Math.sin(elapsed * 0.5 + phase) * 0.16;
    let pitch = -0.12 + Math.sin(elapsed * 1.1 + phase) * 0.05;

    if (target) {
      const dx = target.x - origin.x;
      const dz = target.z - origin.z;
      const dy = target.y - (origin.y + PASSENGER_EYE_Y);
      // `angleDelta` takes the short way, so a passenger turns whichever way is
      // nearer and there is nothing it will refuse to turn to.
      yaw = angleDelta(baseYaw, Math.atan2(dx, dz));
      pitch = clamp(Math.atan2(dy, Math.hypot(dx, dz)), -WATCH_PITCH_LIMIT, WATCH_PITCH_LIMIT);
    }

    // Eased, never snapped — the difference between noticing something and
    // snapping to it.
    const ease = Math.min(1, dt * TURN_EASE);
    figure.rotation.y += (baseYaw + yaw - figure.rotation.y) * ease;
    if (head) {
      head.rotation.x += (pitch - head.rotation.x) * ease;
      // Anything an older neck-turn left behind, unwound.
      head.rotation.y += (0 - head.rotation.y) * ease;
    }
  };

  // --- the wheel above -------------------------------------------------------------
  // **The wheel's plane runs away through the window, not across it.**
  //
  // The first build had the axle pointing out of the window, which is how a
  // gondola is really strung — and it put a rim two feet in front of the glass
  // and a spoke straight down the middle of the view, and you still could not
  // tell what you were riding. Turned a quarter, the two rims sit outside the
  // side walls where a real gondola's do, and the wheel itself arcs away ahead
  // of you with its spokes converging on the hub and the next cars hanging off
  // it. That view is the entire reason anybody knows this is a ferris wheel.
  const rigPivot = new Group();
  rigPivot.name = 'wheel-plane';
  rigPivot.rotation.y = Math.PI / 2;
  root.add(rigPivot);

  const rig = new Group();
  rig.name = 'wheel-rig';
  rigPivot.add(rig);

  const frameMaterial = toonMaterial(PALETTE.stonePink);
  const rimMaterial = toonMaterial(PALETTE.stonePinkDark);

  for (const side of [-1, 1] as const) {
    const rim = solid(new Mesh(new TorusGeometry(RIDE_RIM_R, RIM_TUBE_R, 8, 48), rimMaterial));
    rim.position.z = side * RIM_HALF_GAP;
    rig.add(rim);
  }

  const hub = solid(new Mesh(new CylinderGeometry(0.7, 0.7, RIM_HALF_GAP * 2, 18), frameMaterial));
  hub.rotation.x = Math.PI / 2;
  rig.add(hub);

  const spokeGeometry = new CylinderGeometry(0.08, 0.08, RIDE_RIM_R, 6);
  const spokes = new InstancedMesh(spokeGeometry, toonMaterial(PALETTE.buildingWall), SPOKES * 2);
  spokes.frustumCulled = false;
  const matrix = new Matrix4();
  const position = new Vector3();
  const quaternion = new Quaternion();
  const unit = new Vector3(1, 1, 1);
  const zAxis = new Vector3(0, 0, 1);
  for (let i = 0; i < SPOKES; i += 1) {
    const angle = (i / SPOKES) * TAU;
    for (let side = 0; side < 2; side += 1) {
      position.set(
        (Math.cos(angle) * RIDE_RIM_R) / 2,
        (Math.sin(angle) * RIDE_RIM_R) / 2,
        (side === 0 ? -1 : 1) * RIM_HALF_GAP,
      );
      quaternion.setFromAxisAngle(zAxis, angle - Math.PI / 2);
      matrix.compose(position, quaternion, unit);
      spokes.setMatrixAt(i * 2 + side, matrix);
    }
  }
  spokes.instanceMatrix.needsUpdate = true;
  rig.add(spokes);

  // Bulbs on the rim, seen through the skylight once it gets dark.
  const bulbMaterial = new MeshBasicMaterial({ color: PALETTE.fairyWarm, toneMapped: false });
  // **On the rims, not between them.** They used to sit at z = 0 — dead centre
  // in the gap the car hangs in — and the bulb circle passes exactly through
  // the point the car hangs from, so every one of them sailed 30 cm over the
  // middle of the glass roof, directly above a child's head. Jim saw "a yellow
  // ball that flies straight through your carriage", and it was 24 of them,
  // once per revolution each.
  //
  // Exactly the mistake the rims themselves had before RIM_HALF_GAP was
  // derived rather than dialled in — the bulbs simply did not move with them.
  // A real wheel carries its lamps on the rims anyway.
  const bulbCount = 24;
  const bulbs = new InstancedMesh(new SphereGeometry(BULB_R, 8, 6), bulbMaterial, bulbCount * 2);
  bulbs.frustumCulled = false;
  for (let i = 0; i < bulbCount; i += 1) {
    const angle = (i / bulbCount) * TAU;
    for (let side = 0; side < 2; side += 1) {
      position.set(
        Math.cos(angle) * RIDE_RIM_R,
        Math.sin(angle) * RIDE_RIM_R,
        (side === 0 ? -1 : 1) * (RIM_HALF_GAP + BULB_STAND),
      );
      matrix.compose(position, new Quaternion(), unit);
      bulbs.setMatrixAt(i * 2 + side, matrix);
    }
  }
  bulbs.instanceMatrix.needsUpdate = true;
  rig.add(bulbs);

  // The hanger: from the rim point straight above the car, down to its roof.
  const hanger = solid(new Mesh(new CylinderGeometry(0.09, 0.09, 1.1, 8), rimMaterial));
  hanger.position.set(0, -(RIDE_RIM_R + 0.55), 0);
  rig.add(hanger);

  const pivot = solid(new Mesh(new SphereGeometry(0.19, 12, 9), frameMaterial));
  pivot.position.set(0, -RIDE_RIM_R, 0);
  rig.add(pivot);

  // --- the cars ahead of you on the rim ---------------------------------------
  // Four of them, in the park's own gondola colours. They hang level while the
  // wheel turns underneath them, so they are placed in car space every frame
  // rather than parented to the rig — which is also what lets them swing on
  // their own, slightly out of step with yours.
  //
  // **They are the same design as the car you are in**: a coloured floor and
  // roof, corner posts, and glass all the way round. They used to be solid
  // painted boxes, which was fine while nothing was expected to be inside one
  // and wrong the moment you looked: a ferris wheel whose every other car is
  // a sealed crate reads as scenery, and yours as the odd one out. Jim's note,
  // 3 August 2026 — and once they were glass there was obviously somebody
  // missing, so **there is a child in each of them**.
  //
  // They stay at the park wheel's own car size rather than growing to match
  // yours: at this radius, cars this far apart on the rim are already almost
  // touching, and yours is deliberately roomy because you are sitting in it.
  const neighbourOffsets = [-2, -1, 1, 2].map((step) => (step * TAU) / SPOKES);
  const neighbours = neighbourOffsets.map((offset, index) => {
    const car = new Group();
    car.name = `neighbour:${index}`;
    const colour = FERRIS_CAR_COLOURS[(index + 1) % FERRIS_CAR_COLOURS.length] ?? PALETTE.markerMint;
    const shell = toonMaterial(colour);

    // Floor and roof, with the posts between them. Same read as your own car:
    // the colour is the frame, everything between it is glass.
    for (const y of [0, NEIGHBOUR_HEIGHT] as const) {
      const slab = solid(
        new Mesh(new RoundedBoxGeometry(NEIGHBOUR_WIDTH, 0.12, NEIGHBOUR_DEPTH, 3, 0.05), shell),
      );
      slab.position.y = y - NEIGHBOUR_HEIGHT / 2;
      car.add(slab);
      addOutline(slab, 0.02);
    }

    for (const px of [-1, 1] as const) {
      for (const pz of [-1, 1] as const) {
        const post = solid(
          new Mesh(new CylinderGeometry(0.05, 0.05, NEIGHBOUR_HEIGHT, 6), shell),
        );
        post.position.set(
          (px * (NEIGHBOUR_WIDTH - 0.1)) / 2,
          0,
          (pz * (NEIGHBOUR_DEPTH - 0.1)) / 2,
        );
        car.add(post);
      }
    }

    // The same glass as your own windows, so the whole wheel is one material.
    // Four panes: two across the width at either end of the depth, two along
    // the depth at either end of the width.
    const paneHeight = NEIGHBOUR_HEIGHT - 0.16;
    for (const alongX of [true, false] as const) {
      const length = (alongX ? NEIGHBOUR_WIDTH : NEIGHBOUR_DEPTH) - 0.1;
      const stand = ((alongX ? NEIGHBOUR_DEPTH : NEIGHBOUR_WIDTH) - 0.1) / 2;
      for (const side of [-1, 1] as const) {
        const pane = decal(
          new Mesh(
            new BoxGeometry(alongX ? length : 0.03, paneHeight, alongX ? 0.03 : length),
            glass,
          ),
        );
        pane.position.set(alongX ? 0 : side * stand, 0, alongX ? side * stand : 0);
        car.add(pane);
      }
    }

    const canopy = solid(
      new Mesh(new CylinderGeometry(1.02, 1.02, 0.24, 14), toonMaterial(PALETTE.buildingWall)),
    );
    canopy.position.y = 0.78;
    car.add(canopy);

    const stem = solid(new Mesh(new CylinderGeometry(0.07, 0.07, 1.1, 6), rimMaterial));
    stem.position.y = 1.05;
    car.add(stem);

    // Two seats, side by side, facing out of the wheel. The same bench-and-
    // cushion idea as your own car, at this car's size.
    const floorY = -NEIGHBOUR_HEIGHT / 2 + 0.06;
    const cushion = toonMaterial(PALETTE.markerLilac);
    for (const seatX of [-NEIGHBOUR_SEAT_X, NEIGHBOUR_SEAT_X] as const) {
      const pad = solid(
        new Mesh(new RoundedBoxGeometry(0.52, 0.1, 0.42, 2, 0.04), cushion),
      );
      pad.position.set(seatX, floorY + NEIGHBOUR_SEAT_Y, 0.16);
      car.add(pad);
      const back = solid(
        new Mesh(new RoundedBoxGeometry(0.52, 0.34, 0.08, 2, 0.03), cushion),
      );
      back.position.set(seatX, floorY + NEIGHBOUR_SEAT_Y + 0.2, 0.37);
      car.add(back);
    }

    // Somebody in it, and their pet beside them — because nobody rides this
    // wheel on their own, and the car you are in is proof of it. Scaled to
    // this car rather than to yours, since these are the wheel's own size.
    const rider = createKid({
      hair: NEIGHBOUR_HAIR[index % NEIGHBOUR_HAIR.length] ?? ART.kidHair,
      outfit: NEIGHBOUR_OUTFIT[index % NEIGHBOUR_OUTFIT.length] ?? ART.kidOutfit,
      hairStyle: index % 2 === 0 ? 'bunches' : 'bob',
      backpack: false,
    });
    rider.root.scale.setScalar(NEIGHBOUR_RIDER_SCALE);
    rider.root.position.set(-NEIGHBOUR_SEAT_X, floorY + NEIGHBOUR_SEAT_Y + 0.05, 0.16);
    car.add(rider.root);

    const pet = createPet(PET_KINDS[index % PET_KINDS.length] ?? 'bunny');
    pet.root.scale.setScalar(NEIGHBOUR_PET_SCALE);
    pet.root.position.set(NEIGHBOUR_SEAT_X, floorY + NEIGHBOUR_SEAT_Y + 0.05, 0.16);
    car.add(pet.root);

    // Sat, not stood to attention — the same courtesy the pets in your own car
    // get, and the difference between a passenger and a doll in a box.
    for (const limbs of [rider.limbs, pet.limbs]) {
      if (!limbs) continue;
      limbs.leftLeg.rotation.x = -1.25;
      limbs.rightLeg.rotation.x = -1.15;
      limbs.leftArm.rotation.x = 0.2;
      limbs.rightArm.rotation.x = 0.2;
    }

    root.add(car);
    return {
      root: car,
      offset,
      phase: index * 1.9,
      rider,
      // Both of them look around, so `turnToward` gets one list to walk.
      occupants: [
        { root: rider.root, head: rider.head, phase: index * 1.9, creature: rider, face: newFace() },
        { root: pet.root, head: pet.head, phase: index * 1.9 + 0.8, creature: pet, face: newFace() },
      ],
    };
  });

  const bulbColour = new Color();
  const litColour = new Color(PALETTE.fairyWarm);
  const dimColour = new Color(PALETTE.stonePinkLight);

  let wheelAngle = 0;
  let joy = 0;
  let lampGlow = 0;

  return {
    root,
    seat,
    passengerCount: passengers.length,

    setWheelAngle(angle: number): void {
      wheelAngle = angle;
    },

    watch(point: Vector3 | null): void {
      if (!point) {
        watching = false;
        return;
      }
      watchPoint.copy(point);
      watching = true;
    },

    rejoice(): void {
      // The face itself is left to `blink`, which shows 'happy' as its resting
      // expression for as long as `joy` lasts. Setting it here as well would be
      // two things writing one texture.
      joy = 1.6;
    },

    setLampGlow(glow: number): void {
      lampGlow = clamp01(glow);
    },

    update(dt: number, elapsed: number): void {
      // The hub orbits the car rather than the car orbiting the hub, so the
      // camera rig never has to move and the swing stays in one place. The two
      // transforms below are chosen together so that the rim point the car
      // hangs from stays at exactly (0, ATTACH_Y, 0) at every angle — the car
      // dangles from directly above itself all the way round, as it must.
      rig.position.set(
        Math.sin(wheelAngle) * RIDE_RIM_R,
        ATTACH_Y + Math.cos(wheelAngle) * RIDE_RIM_R,
        0,
      );
      rig.rotation.z = -wheelAngle;

      // The neighbours, hanging level off their own bit of rim. The hub in car
      // space is straight up from the attach point, rotated back through the
      // ride angle — the same two numbers the rig above is placed with, only
      // read out into the plane the window looks along.
      const hubY = ATTACH_Y + Math.cos(wheelAngle) * RIDE_RIM_R;
      const hubZ = -Math.sin(wheelAngle) * RIDE_RIM_R;
      for (const neighbour of neighbours) {
        const around = wheelAngle + neighbour.offset;
        const swing = Math.sin(elapsed * 0.7 + neighbour.phase) * 0.05;
        neighbour.root.position.set(
          0,
          hubY - Math.cos(around) * RIDE_RIM_R - NEIGHBOUR_HANG,
          hubZ + Math.sin(around) * RIDE_RIM_R,
        );
        neighbour.root.rotation.x = swing;
        neighbour.rider.update(dt);

        // They are watching the same sky you are. Their car has moved this
        // frame, so where each of them *is* has to be worked out fresh before
        // asking which way to turn.
        for (const occupant of neighbour.occupants) {
          occupantOrigin.copy(neighbour.root.position).add(occupant.root.position);
          turnToward(
            occupant.root,
            occupant.head,
            0,
            occupantOrigin,
            watching ? watchPoint : null,
            occupant.phase,
            dt,
            elapsed,
          );
          blink(occupant.face, occupant.creature, 'neutral', dt);
        }
      }

      // The car hangs level and sways. Two frequencies, so it never repeats
      // obviously — and gently, because this is the cosy ride.
      const sway = Math.sin(elapsed * 0.62) * 0.035 + Math.sin(elapsed * 1.13 + 0.7) * 0.014;
      car.rotation.z = sway;
      car.rotation.x = Math.sin(elapsed * 0.47 + 2.1) * 0.011;
      car.position.set(0, Math.sin(elapsed * 0.9) * 0.012, 0);

      if (joy > 0) joy = Math.max(0, joy - dt);

      for (let i = 0; i < passengers.length; i += 1) {
        const passenger = passengers[i];
        if (!passenger) continue;
        const bob = Math.sin(elapsed * 1.6 + passenger.phase) * 0.012;
        passenger.handle.root.position.y = passenger.baseY + bob + (joy > 0 ? Math.abs(Math.sin(elapsed * 7)) * 0.05 : 0);
        passenger.handle.update?.(dt, elapsed);

        // What, if anything, this passenger is looking at — in car space.
        //
        //  - **somebody waved**: it turns to *you*, and nothing interrupts
        //    that; being looked at by your own pet is the reason you brought
        //    it along;
        //  - **something is out of the window**: the alien, RiPika, the
        //    turtles. Half the show deliberately happens behind and beside
        //    you, so this is often most of the way round;
        //  - **otherwise**: back to the glass, with a slow idle drift.
        const target = joy > 0 ? playerLookPoint : watching ? watchPoint : null;
        turnToward(
          passenger.handle.root,
          passenger.creature?.head ?? null,
          passenger.baseYaw,
          passenger.handle.root.position,
          target,
          passenger.phase,
          dt,
          elapsed,
        );
        blink(passenger.face, passenger.creature, joy > 0 ? 'happy' : 'neutral', dt);
      }

      lamp.intensity = lampGlow * 3.2;
      lampShade.scale.setScalar(0.85 + lampGlow * 0.3);

      const chase = elapsed * 2.4;
      for (let i = 0; i < bulbCount; i += 1) {
        const wave = 0.55 + 0.45 * Math.sin(chase - (i / bulbCount) * TAU * 3);
        bulbColour.copy(litColour).multiplyScalar(0.5 + wave * 0.8);
        bulbColour.lerp(dimColour, 1 - lampGlow);
        // The pair either side of the wheel chase together, so the two rims
        // read as one string of lights rather than two out of step.
        bulbs.setColorAt(i * 2, bulbColour);
        bulbs.setColorAt(i * 2 + 1, bulbColour);
      }
      if (bulbs.instanceColor) bulbs.instanceColor.needsUpdate = true;
    },

    dispose(): void {
      for (const passenger of passengers) passenger.handle.dispose?.();
      disposeTree(root);
      spokes.dispose();
      bulbs.dispose();
    },
  };
}

/**
 * Which chairs get used, by how many cute things came along.
 *
 * Indices are left, centre, right, and the list is in *boarding* order —
 * which is tallest first (see the sort where passengers are seated). One
 * passenger takes the middle chair and rides as your co-pilot; two take the
 * outside pair and leave the middle of the window clear; three fill the row
 * with the smallest head in the middle.
 */
const CHAIR_ORDER: Readonly<Record<number, readonly number[]>> = {
  1: [1],
  2: [0, 2],
  3: [0, 2, 1],
};

/**
 * Which way a chair at `x` faces: at the window, and a few degrees in towards
 * the middle so whoever is sitting in it can be seen from the seat behind.
 */
function facing(x: number): number {
  return Math.PI + x * 0.12;
}

/**
 * Is this asset a creature — something with a head, limbs and a face?
 *
 * Duck-typed rather than declared, exactly as the parade does it: a new cute
 * thing then rides the wheel correctly on the day it is written, without anybody
 * remembering to add it to a list.
 */
function asCreature(handle: AssetHandle): CreatureHandle | null {
  const candidate = handle as Partial<CreatureHandle>;
  return typeof candidate.setWalkPhase === 'function' && candidate.head ? (handle as CreatureHandle) : null;
}
