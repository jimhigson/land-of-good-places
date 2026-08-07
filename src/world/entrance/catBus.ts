import {
  CanvasTexture,
  Color,
  ConeGeometry,
  CylinderGeometry,
  Group,
  Mesh,
  SphereGeometry,
} from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { PALETTE, hexToCss } from '../../core/palette';
import { TALLEST_CHILD_HEIGHT } from '../../art/models/kid';
import { RIDER_HEADROOM } from '../train/clearance';
import { clamp01, lerp } from '../../core/mathUtils';
import { addOutline, decal, solid, toonMaterial } from '../../art/style/materials';
import { paintFace, facePatchGeometry } from '../../art/style/faces';
import { blob } from '../../art/style/asset';

/**
 * The cat bus.
 *
 * An original design — a pastel toy minibus with a cat's face on the front,
 * not a copy of any existing cartoon catbus: one body (no legs), a painted
 * face rather than a lit-in-the-dark grin, triangular ears on the roof, a
 * curled tail at the back and paw-print livery down the flanks. Built from the
 * same chunky-primitive-plus-toon-material kit as every other vehicle in the
 * park (compare `minigames/dodgems/car.ts`) so it drops straight into the
 * house style.
 *
 * The front third of the body is a big squashed sphere rather than a flat
 * panel — exactly the trick every character's head uses — so the painted face
 * patch (`art/style/faces.ts`) can hug it the same way a kid's or RiPika's
 * face does, instead of floating over a flat windscreen.
 */

/**
 * **The bus is sized by what it has to hold, not by a number picked by eye.**
 *
 * Jim, 7 August 2026, watching the first run anyone had ever seen: *"the bus is
 * also barely bigger than a child, and smaller vertically than one child with a
 * hat"*, and then *"the seats should have children on them too, and there
 * should be about 12 seats total on the bus"*.
 *
 * He was right and the old numbers were unarguable: the bus stood 2.66 m, a
 * child is 2.12 m, and a child in a party hat is `TALLEST_CHILD_HEIGHT` 2.97 m.
 * It was a garden shed with a cat painted on it.
 *
 * So **the seat plan is the source and every body dimension is derived from
 * it.** Twelve seats in six rows of two either side of an aisle; the length is
 * whatever six rows take, the width is whatever two seats and an aisle take,
 * and the height is whatever lets a child stand up in the aisle and walk to the
 * door. Nothing here agrees with anything else by coincidence — which is the
 * trap the Rail Race cart hit, where lane spacing and cart width were two
 * independent `1.04`s that matched by luck.
 */

/** Rows of seats, and seats per row — one either side of the aisle. */
const SEAT_ROWS = 6;
const SEATS_PER_ROW = 2;
/** Jim asked for "about 12 seats total". This is that number, derived once. */
export const CAT_BUS_SEAT_COUNT = SEAT_ROWS * SEATS_PER_ROW;

/**
 * Row-to-row spacing, and the **one owner** of it: the cabin's length is
 * `SEAT_ROWS * SEAT_PITCH`, never a length that happens to fit.
 */
const SEAT_PITCH = 1.0;
/** Across the bus: how wide one child's seat is, and the gangway between them. */
const SEAT_WIDTH = 0.92;
const AISLE_WIDTH = 0.9;
/** A low cushion. Children are seated with their feet on the floor — see below. */
const SEAT_PAD_HEIGHT = 0.3;

/**
 * The cabin floor, above the ground — a **low-floor bus**.
 *
 * Deliberately low: it is one easy step down for a child, and every centimetre
 * of floor height is a centimetre added to the overall height of an already
 * tall vehicle.
 */
const BODY_BOTTOM_Y = 0.62;

/**
 * Interior height, floor to ceiling.
 *
 * `TALLEST_CHILD_HEIGHT` rather than `KID_HEIGHT`, per ARCHITECTURE-DECISIONS
 * §147 — *"a child's height is `TALLEST_CHILD_HEIGHT` (2.97 m), not
 * `KID_HEIGHT`"* — because children wear hats on rides and a ceiling that
 * clips a party hat is the same bug as a duck bar that does. `RIDER_HEADROOM`
 * (0.4 m) is the park train's own allowance over a rider's head, borrowed here
 * so the two vehicles answer "how much room over a child?" with one number.
 *
 * **Children are seated with their origins on the floor**, not on top of the
 * cushions. That is not a fudge: the rig has no knees and `applyRidePose`
 * leaves a seated character's head at full standing height above its origin,
 * so seating them on a 0.3 m pad would demand a 0.3 m taller bus for no visible
 * gain. Feet on the floor, cushion drawn under them, and sitting costs exactly
 * what standing costs.
 */
const CABIN_HEIGHT = TALLEST_CHILD_HEIGHT + RIDER_HEADROOM;

/** Wall thickness either side of the seats. */
const WALL_THICKNESS = 0.16;

const BODY_HEIGHT = CABIN_HEIGHT;
const BODY_WIDTH = SEATS_PER_ROW * SEAT_WIDTH + AISLE_WIDTH + WALL_THICKNESS * 2;
/** Six rows, plus the driver's area up front and a little behind the back row. */
const CABIN_LENGTH_FROM_SEATS = SEAT_ROWS * SEAT_PITCH;
const DRIVER_AREA_LENGTH = 1.45;
const FACE_RADIUS = BODY_WIDTH * 0.52;
const BODY_LENGTH = CABIN_LENGTH_FROM_SEATS + DRIVER_AREA_LENGTH + FACE_RADIUS * 1.1;

const WHEEL_RADIUS = BODY_BOTTOM_Y * 0.86;

/**
 * How much bigger every *small* feature is than in the original drawing.
 *
 * The body above is now stated in real metres, but the ears, whiskers, paw
 * prints, bumpers and door furniture were all drawn against a 1.55 m body. Left
 * alone they would stay shed-sized details stuck on a bus. One factor, applied
 * at each of them, keeps the drawing's proportions.
 */
const DETAIL = BODY_HEIGHT / 1.55;

/**
 * The doorway, sized by the child who walks down out of it.
 *
 * `TALLEST_CHILD_HEIGHT` again, not `KID_HEIGHT`: a door that decapitates a
 * party hat is the same bug as a ceiling that does.
 */
const DOOR_HEIGHT = TALLEST_CHILD_HEIGHT + 0.2;
const DOOR_WIDTH = SEAT_WIDTH * 1.15;

/** How far the door swings open, in radians, at `doorOpen = 1`. */
const DOOR_SWING = 2.05;

/** One paw print: a palm oval plus three toe dots, proud of whatever it sits on. */
export function buildPawPrint(material: ReturnType<typeof toonMaterial>): Group {
  const group = new Group();
  const palm = decal(new Mesh(new SphereGeometry(0.09, 10, 8), material));
  palm.scale.set(1, 0.85, 0.5);
  group.add(palm);
  for (let i = 0; i < 3; i += 1) {
    const toe = decal(new Mesh(new SphereGeometry(0.045, 8, 7), material));
    const a = (i - 1) * 0.55;
    toe.position.set(Math.sin(a) * 0.11, 0.13 + Math.cos(a) * 0.03, 0);
    toe.scale.setScalar(0.9);
    group.add(toe);
  }
  return group;
}

export interface CatBusHandle {
  readonly root: Group;
  readonly height: number;
  /**
   * Where anyone riding inside is parented — a child of the chassis, so a
   * passenger put in here travels with the bus for free rather than being
   * re-positioned every frame by a formula that has to track it.
   */
  readonly cabin: Group;
  /** Where the driver sits, at the wheel. A child of {@link cabin}. */
  readonly driverSeat: Group;
  /** Where a passenger sits, by the door. One of {@link seats}. */
  readonly passengerSeat: Group;
  /**
   * **The twelve seats**, each an anchor at floor level for one child.
   *
   * Exposed so the arrival can fill them and so a check can count what was
   * actually built rather than trust {@link CAT_BUS_SEAT_COUNT}. Jim asked for
   * "about 12 seats total on the bus" with "children on them too".
   */
  readonly seats: readonly Group[];
  /**
   * Where somebody stepping out of the open door lands, **in the bus's own
   * local space** (`x` across, `z` along, `y` is the ground).
   *
   * Exported because the bus is the only thing that knows where its own door
   * is: `doorGroup`, the step and the doorway are all positioned from
   * `BODY_WIDTH`/`cabinLength` in here, and none of those are exported. A
   * sequence that re-derived the drop point from its own copy of those numbers
   * would be a second definition of "where the door is", kept in step by hand —
   * the repo's most common bug by a distance.
   */
  readonly doorDrop: { readonly x: number; readonly z: number };
  /** 0 = fully shut, 1 = fully open. Tweened by the arrival sequence. */
  setDoorOpen(amount01: number): void;
  /** Spins the wheels and gives the tail a gentle idle swish. */
  animate(dt: number, elapsed: number, speed: number): void;
  dispose(): void;
}

export function createCatBus(): CatBusHandle {
  const root = new Group();
  root.name = 'cat-bus';

  const bodyColour = PALETTE.pathEdge; // cream — a friendly, toy-bright base coat
  const bodyMaterial = toonMaterial(bodyColour);
  const roofColour = new Color(PALETTE.flowerYellow).lerp(new Color(0xffffff), 0.35).getHex();
  const roofMaterial = toonMaterial(roofColour);
  const trimMaterial = toonMaterial(PALETTE.stonePink);
  const earInnerMaterial = toonMaterial(PALETTE.stonePinkLight);
  // **Glazed, not painted.** These were opaque, which was fine while the bus was
  // empty scenery and useless the moment there were twelve children inside it
  // to look at — Jim's Stage B ask is that they are visible through the windows,
  // and you cannot see anybody through a solid panel. Transparent glass with
  // `depthWrite` off (which `toonMaterial` does for us) lets the cabin read
  // through it.
  const windowMaterial = toonMaterial(PALETTE.buildingWindow, {
    emissive: PALETTE.buildingWindow,
    emissiveIntensity: 0.08,
    transparent: true,
    opacity: 0.34,
  });
  const wheelMaterial = toonMaterial(PALETTE.ink);
  const hubMaterial = toonMaterial(PALETTE.markerLemon);
  const pawMaterial = toonMaterial(PALETTE.stonePinkDark);
  const tailMaterial = toonMaterial(bodyColour);
  const bumperMaterial = toonMaterial(PALETTE.woodLight);

  const chassis = new Group();
  chassis.name = 'chassis';
  root.add(chassis);

  // --- main body -------------------------------------------------------------
  // Stops short of the very front — the face sphere below picks up from there —
  // so the join between "boxy body" and "round cat face" reads as one shape
  // rather than a sphere glued onto a box.
  const cabinLength = BODY_LENGTH - FACE_RADIUS * 1.1;
  const body = solid(
    new Mesh(
      new RoundedBoxGeometry(BODY_WIDTH, BODY_HEIGHT, cabinLength, 5, 0.26 * DETAIL),
      bodyMaterial,
    ),
  );
  body.position.set(0, BODY_BOTTOM_Y + BODY_HEIGHT / 2, BODY_LENGTH / 2 - cabinLength / 2 - FACE_RADIUS * 0.55);
  chassis.add(body);
  addOutline(body, 0.02 * DETAIL);

  // A paler roof cap, rounded, so the bus doesn't read as a single flat-topped
  // box — every shop and ride in this park gets a bobble or a cap on top.
  const roof = solid(
    new Mesh(new RoundedBoxGeometry(BODY_WIDTH * 0.94, 0.34 * DETAIL, cabinLength * 0.92, 4, 0.16 * DETAIL), roofMaterial),
  );
  roof.position.set(0, BODY_BOTTOM_Y + BODY_HEIGHT + 0.05 * DETAIL, body.position.z);
  chassis.add(roof);
  addOutline(roof, 0.016 * DETAIL);

  // --- the face ---------------------------------------------------------------
  // A big squashed sphere at the front, flattened toward the windscreen — the
  // same "nose" trick `dodgems/car.ts` uses, just scaled up to be the whole
  // front of the bus.
  const faceZ = BODY_LENGTH / 2 - FACE_RADIUS * 0.62;
  const faceY = BODY_BOTTOM_Y + BODY_HEIGHT * 0.62;
  const faceSphere = blob(FACE_RADIUS, bodyMaterial, [1, 0.92, 0.6]);
  faceSphere.position.set(0, faceY, faceZ);
  chassis.add(faceSphere);
  addOutline(faceSphere, 0.02 * DETAIL);

  const faceTexture = paintCatBusFace();
  const faceMaterial = toonMaterial(0xffffff, { map: faceTexture, transparent: true });
  faceMaterial.alphaTest = 0.02;
  const facePatch = decal(
    new Mesh(facePatchGeometry(FACE_RADIUS * 1.02, 2.0, 1.7, 0.08), faceMaterial),
  );
  facePatch.position.copy(faceSphere.position);
  facePatch.renderOrder = 2;
  chassis.add(facePatch);

  // --- ears --------------------------------------------------------------------
  // Triangular, on the roof, leaning outward a touch — "nothing is plumb".
  const earGeometry = new ConeGeometry(0.34 * DETAIL, 0.56 * DETAIL, 4);
  const earInnerGeometry = new ConeGeometry(0.18 * DETAIL, 0.32 * DETAIL, 4);
  for (const side of [-1, 1] as const) {
    const ear = solid(new Mesh(earGeometry, roofMaterial));
    ear.position.set(side * BODY_WIDTH * 0.3, BODY_BOTTOM_Y + BODY_HEIGHT + 0.28 * DETAIL, faceZ - 0.35 * DETAIL);
    ear.rotation.z = side * -0.22;
    ear.rotation.y = Math.PI / 4;
    chassis.add(ear);
    addOutline(ear, 0.016 * DETAIL);

    const innerEar = decal(new Mesh(earInnerGeometry, earInnerMaterial));
    innerEar.position.set(0, 0.03 * DETAIL, 0.06 * DETAIL);
    innerEar.rotation.copy(ear.rotation);
    innerEar.scale.set(0.92, 0.8, 0.92);
    ear.add(innerEar);
  }

  // --- windows -------------------------------------------------------------
  // **One window per row of seats, derived from where the rows actually are.**
  // A window count and a seat count that agreed by hand would be two
  // definitions of the same thing; `rowZ` is the only one, so a window cannot
  // end up between two rows however the seat plan changes.
  const cabinBackZ = body.position.z - cabinLength / 2;
  const rowZ = (row: number): number => cabinBackZ + SEAT_PITCH * (row + 0.5);
  const seatX = (column: number): number =>
    (column === 0 ? -1 : 1) * (AISLE_WIDTH / 2 + SEAT_WIDTH / 2);

  const windowGeometry = new RoundedBoxGeometry(
    SEAT_PITCH * 0.72,
    CABIN_HEIGHT * 0.44,
    0.06 * DETAIL,
    3,
    0.1 * DETAIL,
  );
  for (const side of [-1, 1] as const) {
    for (let row = 0; row < SEAT_ROWS; row += 1) {
      const win = decal(new Mesh(windowGeometry, windowMaterial));
      win.position.set(
        side * (BODY_WIDTH / 2 + 0.02),
        BODY_BOTTOM_Y + CABIN_HEIGHT * 0.6,
        rowZ(row),
      );
      win.rotation.y = Math.PI / 2;
      chassis.add(win);
    }
  }

  // --- the seats ---------------------------------------------------------
  // Twelve of them, six rows of two either side of the aisle, because Jim asked
  // for "about 12 seats total" and for children to be sitting on them. Each
  // cushion gets an **anchor group at floor level** rather than on top of it —
  // see `CABIN_HEIGHT` for why feet go on the floor.
  const seatPadGeometry = new RoundedBoxGeometry(
    SEAT_WIDTH * 0.86,
    SEAT_PAD_HEIGHT,
    SEAT_PITCH * 0.62,
    3,
    0.08 * DETAIL,
  );
  const seatBackGeometry = new RoundedBoxGeometry(
    SEAT_WIDTH * 0.86,
    SEAT_PAD_HEIGHT * 1.5,
    0.12 * DETAIL,
    3,
    0.06 * DETAIL,
  );
  const seatMaterial = toonMaterial(PALETTE.stonePink);
  const seats: Group[] = [];
  for (let row = 0; row < SEAT_ROWS; row += 1) {
    for (let column = 0; column < SEATS_PER_ROW; column += 1) {
      const x = seatX(column);
      const z = rowZ(row);

      const pad = solid(new Mesh(seatPadGeometry, seatMaterial));
      pad.position.set(x, BODY_BOTTOM_Y + SEAT_PAD_HEIGHT / 2, z);
      chassis.add(pad);

      const back = solid(new Mesh(seatBackGeometry, seatMaterial));
      back.position.set(x, BODY_BOTTOM_Y + SEAT_PAD_HEIGHT * 1.35, z - SEAT_PITCH * 0.3);
      chassis.add(back);

      // Where a child goes. Feet on the floor, facing the front of the bus.
      const seat = new Group();
      seat.name = `cat-bus-seat-${seats.length}`;
      seat.position.set(x, BODY_BOTTOM_Y, z);
      chassis.add(seat);
      seats.push(seat);
    }
  }

  // --- door --------------------------------------------------------------------
  // A single hinged panel on the left (-X, local) side, swinging open like a
  // friendly little flap. The hinge sits at its front edge.
  const doorGroup = new Group();
  doorGroup.name = 'door-hinge';
  doorGroup.position.set(
    -(BODY_WIDTH / 2),
    BODY_BOTTOM_Y,
    body.position.z + cabinLength * 0.28,
  );
  chassis.add(doorGroup);

  const doorPanel = solid(
    new Mesh(new RoundedBoxGeometry(0.06 * DETAIL, DOOR_HEIGHT, DOOR_WIDTH, 2, 0.08 * DETAIL), bodyMaterial),
  );
  doorPanel.position.set(0, DOOR_HEIGHT / 2, DOOR_WIDTH / 2);
  doorGroup.add(doorPanel);
  addOutline(doorPanel, 0.014 * DETAIL);

  const doorWindow = decal(
    new Mesh(new RoundedBoxGeometry(0.04 * DETAIL, DOOR_HEIGHT * 0.42, DOOR_WIDTH * 0.7, 2, 0.06 * DETAIL), windowMaterial),
  );
  doorWindow.position.set(0.02, DOOR_HEIGHT * 0.68, DOOR_WIDTH / 2);
  doorGroup.add(doorWindow);

  // A dark opening behind the door, so swinging it away actually reveals a
  // doorway instead of a hole showing the sky through the cabin.
  const doorway = decal(
    new Mesh(
      new RoundedBoxGeometry(0.5 * DETAIL, DOOR_HEIGHT, DOOR_WIDTH, 2, 0.1 * DETAIL),
      toonMaterial(new Color(PALETTE.ink).multiplyScalar(0.7).getHex()),
    ),
  );
  doorway.position.set(
    doorGroup.position.x - 0.12 * DETAIL,
    BODY_BOTTOM_Y + DOOR_HEIGHT / 2,
    doorGroup.position.z + DOOR_WIDTH / 2,
  );
  chassis.add(doorway);

  // A couple of friendly steps, always visible, so hopping down reads clearly.
  const step = solid(
    new Mesh(
      new RoundedBoxGeometry(0.5 * DETAIL, 0.1 * DETAIL, DOOR_WIDTH * 0.8, 2, 0.04 * DETAIL),
      bumperMaterial,
    ),
  );
  step.position.set(
    -(BODY_WIDTH / 2 + 0.16 * DETAIL),
    BODY_BOTTOM_Y / 2,
    doorGroup.position.z + DOOR_WIDTH / 2,
  );
  chassis.add(step);

  // --- bumpers ---------------------------------------------------------------
  const rearBumper = solid(
    new Mesh(new RoundedBoxGeometry(BODY_WIDTH * 0.98, 0.3 * DETAIL, 0.22 * DETAIL, 3, 0.08 * DETAIL), bumperMaterial),
  );
  rearBumper.position.set(0, BODY_BOTTOM_Y + 0.05 * DETAIL, -BODY_LENGTH / 2 + 0.08 * DETAIL);
  chassis.add(rearBumper);

  // --- paw-print livery --------------------------------------------------------
  for (const side of [-1, 1] as const) {
    for (let i = 0; i < 3; i += 1) {
      const paw = buildPawPrint(pawMaterial);
      paw.position.set(
        side * (BODY_WIDTH / 2 + 0.005),
        BODY_BOTTOM_Y + BODY_HEIGHT * 0.34,
        body.position.z - cabinLength * 0.3 + i * 0.85 * DETAIL,
      );
      paw.rotation.y = side > 0 ? Math.PI / 2 : -Math.PI / 2;
      paw.scale.setScalar(DETAIL);
      chassis.add(paw);
    }
  }

  // --- wheels --------------------------------------------------------------
  const wheelGeometry = new CylinderGeometry(WHEEL_RADIUS, WHEEL_RADIUS, 0.34 * DETAIL, 14);
  const hubGeometry = new CylinderGeometry(WHEEL_RADIUS * 0.42, WHEEL_RADIUS * 0.42, 0.36 * DETAIL, 10);
  const wheels: Mesh[] = [];
  for (const x of [-(BODY_WIDTH / 2 - 0.05 * DETAIL), BODY_WIDTH / 2 - 0.05 * DETAIL]) {
    for (const z of [BODY_LENGTH * 0.28, -BODY_LENGTH * 0.3]) {
      const wheel = solid(new Mesh(wheelGeometry, wheelMaterial));
      wheel.rotation.z = Math.PI / 2;
      wheel.position.set(x, WHEEL_RADIUS, z);
      chassis.add(wheel);
      wheels.push(wheel);

      const hub = decal(new Mesh(hubGeometry, hubMaterial));
      hub.rotation.z = Math.PI / 2;
      hub.position.copy(wheel.position);
      chassis.add(hub);
    }
  }

  // --- tail ------------------------------------------------------------------
  // A gentle curl of three stacked, shrinking blobs, leaning to one side —
  // nothing in this park is perfectly plumb or perfectly symmetrical.
  const tail = new Group();
  tail.name = 'tail';
  tail.position.set(0.18 * DETAIL, BODY_BOTTOM_Y + BODY_HEIGHT * 0.58, -BODY_LENGTH / 2 + 0.05 * DETAIL);
  chassis.add(tail);

  let tailCursor = new Group();
  tail.add(tailCursor);
  tailCursor.rotation.x = -0.3;
  const tailSegments: Group[] = [];
  for (let i = 0; i < 3; i += 1) {
    const segRadius = (0.16 - i * 0.03) * DETAIL;
    const seg = solid(new Mesh(new SphereGeometry(segRadius, 12, 10), tailMaterial));
    seg.scale.set(1, 1, 1.4);
    tailCursor.add(seg);
    tailSegments.push(tailCursor);

    const next = new Group();
    next.position.z = -segRadius * 1.7;
    next.rotation.x = -0.55;
    tailCursor.add(next);
    tailCursor = next;
  }
  const tailTip = solid(new Mesh(new SphereGeometry(0.13 * DETAIL, 12, 10), tailMaterial));
  tailCursor.add(tailTip);
  addOutline(tailTip, 0.012 * DETAIL);

  // --- who is riding inside ---------------------------------------------------
  // A child of the chassis, so anybody seated in here travels with the bus and
  // nothing has to re-position them every frame.
  const cabin = new Group();
  cabin.name = 'cabin';
  chassis.add(cabin);

  // At the wheel: front of the cabin, on the far side from the door so the
  // driver is not standing in the doorway everyone is climbing out of.
  const driverSeat = new Group();
  driverSeat.name = 'driver-seat';
  driverSeat.position.set(
    -seatX(0),
    BODY_BOTTOM_Y,
    body.position.z + cabinLength / 2 - DRIVER_AREA_LENGTH * 0.5,
  );
  cabin.add(driverSeat);

  // **The player's seat is one of the twelve, not a thirteenth.** Picked as the
  // real seat nearest the door on the door's own side, by measuring the seats
  // that were built — so she is sitting somewhere a child could sit, and
  // "twelve seats, all occupied" stays true with her in one of them.
  const doorSideX = seatX(0);
  let passengerSeat = seats[0] as Group;
  let bestGap = Infinity;
  for (const seat of seats) {
    if (Math.sign(seat.position.x) !== Math.sign(doorSideX)) continue;
    const gap = Math.abs(seat.position.z - doorGroup.position.z);
    if (gap < bestGap) {
      bestGap = gap;
      passengerSeat = seat;
    }
  }

  // --- height ----------------------------------------------------------------
  // Measured to the **actual top**, ear tips included, per ART_DIRECTION §7's
  // asset contract — not to the roof, which would crop a name label.
  const height = BODY_BOTTOM_Y + BODY_HEIGHT + (0.28 + 0.56 / 2) * DETAIL;

  // Straight out from the step, clear of the sill. Derived from the step's own
  // position rather than restated, so moving the door moves this with it.
  const doorDrop = {
    x: step.position.x - 0.77 * DETAIL,
    z: step.position.z,
  } as const;

  let doorOpenAmount = 0;
  let wheelSpin = 0;

  return {
    root,
    height,
    cabin,
    driverSeat,
    passengerSeat,
    seats,
    doorDrop,

    setDoorOpen(amount01: number): void {
      doorOpenAmount = clamp01(amount01);
      doorGroup.rotation.y = -DOOR_SWING * doorOpenAmount;
    },

    animate(dt: number, elapsed: number, speed: number): void {
      wheelSpin += speed * dt * 3.1;
      for (const wheel of wheels) wheel.rotation.x = wheelSpin;

      // A lazy idle swish, faster and wider whenever the bus is moving — reads
      // as "happy", especially while it is pulling away at the end.
      const swishSpeed = lerp(0.9, 2.6, clamp01(Math.abs(speed) / 6));
      tail.rotation.y = Math.sin(elapsed * swishSpeed) * 0.5;
      tail.rotation.z = 0.12 + Math.sin(elapsed * swishSpeed * 0.7 + 1.1) * 0.08;
    },

    dispose(): void {
      root.traverse((object) => {
        const mesh = object as Partial<Mesh>;
        mesh.geometry?.dispose();
      });
      bodyMaterial.dispose();
      roofMaterial.dispose();
      trimMaterial.dispose();
      earInnerMaterial.dispose();
      windowMaterial.dispose();
      wheelMaterial.dispose();
      hubMaterial.dispose();
      pawMaterial.dispose();
      tailMaterial.dispose();
      bumperMaterial.dispose();
      faceTexture.dispose();
    },
  };
}

/**
 * The face: reuses `paintFace()` for the eyes, nose and cat "w" mouth (the
 * same painter every character's face patch uses), then draws whiskers
 * straight onto the same canvas — whiskers are not part of the shared face
 * painter (no other character has any), so this is the one bespoke addition.
 */
function paintCatBusFace(): CanvasTexture {
  const texture = paintFace({
    size: 512,
    eyeY: 0.4,
    eyeGap: 0.48,
    eyeW: 0.13,
    eyeH: 0.165,
    eyeStyle: 'open',
    iris: PALETTE.markerSky,
    mouth: 'cat',
    mouthW: 0.1,
    mouthDrop: 0.22,
    blush: PALETTE.cheek,
    blushStyle: 'soft',
    blushR: 0.085,
    nose: PALETTE.cheek,
  });

  const canvas = texture.image as HTMLCanvasElement;
  const ctx = canvas.getContext('2d');
  if (ctx) paintWhiskers(ctx, canvas.width);
  texture.needsUpdate = true;
  return texture;
}

function paintWhiskers(ctx: CanvasRenderingContext2D, size: number): void {
  const ink = hexToCss(PALETTE.ink);
  ctx.strokeStyle = ink;
  ctx.lineCap = 'round';
  ctx.lineWidth = size * 0.011;
  ctx.globalAlpha = 0.78;
  const y0 = size * 0.62;
  for (const side of [-1, 1] as const) {
    for (let i = 0; i < 3; i += 1) {
      const rise = (i - 1) * size * 0.05;
      ctx.beginPath();
      ctx.moveTo(size / 2 + side * size * 0.2, y0 + rise * 0.35);
      ctx.quadraticCurveTo(
        size / 2 + side * size * 0.34,
        y0 + rise * 0.7,
        size / 2 + side * size * 0.48,
        y0 + rise,
      );
      ctx.stroke();
    }
  }
  ctx.globalAlpha = 1;
}
