import {
  BoxGeometry,
  Color,
  CylinderGeometry,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  PointLight,
  Quaternion,
  SphereGeometry,
  TorusGeometry,
  Vector3,
} from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { PALETTE } from '../../core/palette';
import { TAU, clamp01 } from '../../core/mathUtils';
import { addOutline, decal, disposeTree, solid, toonMaterial } from '../../art/style/materials';
import type { CreatureHandle } from '../../art/style/asset';
import type { AssetHandle } from '../../art/style/asset';
import type { Expression } from '../../art/style/faces';
import { gameStore } from '../../state';
import { shopItem } from '../../world/building/shops/catalogue';
import { FERRIS_CAR_COLOURS } from './wheelProp';

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
 * stowed are read straight out of the store and sat on the bench facing the
 * window. Nothing is written back — the ride never touches saved state, so
 * leaving it, however you leave it, cannot lose anything.
 */

/** How many of your cute things fit on the bench. */
const SEATS = 3;

/**
 * The floor between the bench (facing the window, at `z ≈ -0.55`) and the
 * camera (at `z ≈ 0.78`, near the back glass) is deliberately left bare. A
 * future NPC companion sitting opposite the player (queued in GAME_DESIGN.md,
 * not built here) belongs there, facing back towards the seat — do not fill
 * this gap with more furniture or parade overflow.
 */

/** Interior dimensions of the car, in metres. */
const CAR_WIDTH = 2.9;
const CAR_DEPTH = 2.4;
const CAR_HEIGHT = 2.45;

/** Radius of the wheel this car hangs off, in the ride's own world. */
const RIDE_RIM_R = 7;

/** Height above the car floor of the rim point it hangs from. */
const ATTACH_Y = 2.9;

/** How far apart the two rims sit — just outside the car's shoulders. */
const RIM_HALF_GAP = 1.55;

/** Spokes on the ride's wheel. Matches the landmark. */
const SPOKES = 12;

/** How far below its rim point a neighbouring car's middle hangs. */
const NEIGHBOUR_HANG = 1.7;

interface Passenger {
  readonly handle: AssetHandle;
  readonly creature: CreatureHandle | null;
  readonly baseY: number;
  readonly phase: number;
  expression: Expression;
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
  const shellDeep = toonMaterial(PALETTE.outfitDark);
  // The frame — posts, rails, window bars — is all one light cream, so it
  // reads as one thin structure rather than four different walls.
  const cream = toonMaterial(PALETTE.buildingWall);
  const woodMaterial = toonMaterial(PALETTE.wood);
  const cushion = toonMaterial(PALETTE.markerLilac);
  // Not quite clear: a faint tint is what tells the eye there is glass there at
  // all, and a window you cannot see is just a hole.
  const glass = toonMaterial(PALETTE.glassTint, { transparent: true, opacity: 0.13 });

  const halfWidth = CAR_WIDTH / 2;
  const halfDepth = CAR_DEPTH / 2;

  // --- floor and roof: slim, everything between them is glass -----------------
  //
  // **The gondola rebuild (27 July 2026).** The first car had opaque walls on
  // three sides and a porthole apiece for the other two — "a box with a
  // porthole", in the family's own words, and exactly what this rebuild
  // removes. What is left holding the roof up is four corner posts thin
  // enough to get a hand between, a low handrail, and glass the rest of the
  // way round on all four sides: front, back and both flanks alike. The child
  // is meant to feel like they are riding in a glass bubble, not a room with
  // a window in it.
  const floor = solid(
    new Mesh(new RoundedBoxGeometry(CAR_WIDTH, 0.14, CAR_DEPTH, 3, 0.06), woodMaterial),
  );
  floor.position.y = -0.07;
  car.add(floor);

  const rug = decal(new Mesh(new CylinderGeometry(1.0, 1.0, 0.03, 24), toonMaterial(PALETTE.markerMint)));
  rug.position.y = 0.015;
  rug.scale.set(1, 1, 0.75);
  car.add(rug);

  const roof = solid(
    new Mesh(new RoundedBoxGeometry(CAR_WIDTH + 0.16, 0.13, CAR_DEPTH + 0.16, 3, 0.06), shellDeep),
  );
  roof.position.y = CAR_HEIGHT;
  car.add(roof);
  addOutline(roof, 0.016);

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
  const windowTop = 2.2;
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
    const streak = decal(new Mesh(new BoxGeometry(width, 2.6, 0.02), streakMaterial));
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
        new CylinderGeometry(0.13, 0.13, (CAR_WIDTH - 0.5) / scallops, 10, 1, false, 0, Math.PI),
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

  // --- the skylight ------------------------------------------------------------
  // The one window that shows you what you are riding.
  const skylight = decal(new Mesh(new BoxGeometry(1.7, 0.05, 1.3), glass));
  skylight.position.set(0, CAR_HEIGHT + 0.01, -0.15);
  car.add(skylight);

  const skylightRing = solid(new Mesh(new TorusGeometry(0.95, 0.08, 8, 24), cream));
  skylightRing.rotation.x = Math.PI / 2;
  skylightRing.position.set(0, CAR_HEIGHT + 0.04, -0.15);
  skylightRing.scale.set(1, 0.78, 1);
  car.add(skylightRing);

  // --- the bench ----------------------------------------------------------------
  const benchSeat = solid(
    new Mesh(new RoundedBoxGeometry(CAR_WIDTH - 0.5, 0.22, 0.72, 3, 0.09), cushion),
  );
  benchSeat.position.set(0, 0.44, -0.55);
  car.add(benchSeat);
  addOutline(benchSeat, 0.016);

  for (const side of [-1, 1] as const) {
    const legMesh = solid(new Mesh(new CylinderGeometry(0.07, 0.08, 0.34, 8), woodMaterial));
    legMesh.position.set(side * (halfWidth - 0.6), 0.17, -0.55);
    car.add(legMesh);
  }

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

  owned.forEach((item, index) => {
    const catalogueItem = shopItem(item.id);
    if (!catalogueItem) return;
    const handle = catalogueItem.model();
    // Spread across the bench, and never dead centre in front of the window —
    // the window is the point of the ride and a teddy is not going to block it.
    const spread = owned.length === 1 ? 0 : (index / (owned.length - 1) - 0.5) * 1.7;
    handle.root.position.set(spread, 0.55, -0.55);
    // Facing the window, turned a little towards the camera so a face is always
    // catchable when they look round.
    handle.root.rotation.y = Math.PI + (spread <= 0 ? 0.4 : -0.4);
    bench.add(handle.root);

    passengers.push({
      handle,
      creature: asCreature(handle),
      baseY: 0.55,
      phase: index * 1.7,
      expression: 'neutral',
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
    const rim = solid(new Mesh(new TorusGeometry(RIDE_RIM_R, 0.16, 8, 48), rimMaterial));
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
  const bulbCount = 24;
  const bulbs = new InstancedMesh(new SphereGeometry(0.16, 8, 6), bulbMaterial, bulbCount);
  bulbs.frustumCulled = false;
  for (let i = 0; i < bulbCount; i += 1) {
    const angle = (i / bulbCount) * TAU;
    position.set(Math.cos(angle) * RIDE_RIM_R, Math.sin(angle) * RIDE_RIM_R, 0);
    matrix.compose(position, new Quaternion(), unit);
    bulbs.setMatrixAt(i, matrix);
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
  const neighbourOffsets = [-2, -1, 1, 2].map((step) => (step * TAU) / SPOKES);
  const neighbours = neighbourOffsets.map((offset, index) => {
    const car = new Group();
    car.name = `neighbour:${index}`;
    const colour = FERRIS_CAR_COLOURS[(index + 1) % FERRIS_CAR_COLOURS.length] ?? PALETTE.markerMint;

    const body = solid(new Mesh(new RoundedBoxGeometry(1.75, 1.45, 1.5, 4, 0.36), toonMaterial(colour)));
    car.add(body);
    addOutline(body, 0.02);

    const canopy = solid(
      new Mesh(new CylinderGeometry(1.02, 1.02, 0.24, 14), toonMaterial(PALETTE.buildingWall)),
    );
    canopy.position.y = 0.78;
    car.add(canopy);

    const stem = solid(new Mesh(new CylinderGeometry(0.07, 0.07, 1.1, 6), rimMaterial));
    stem.position.y = 1.05;
    car.add(stem);

    root.add(car);
    return { root: car, offset, phase: index * 1.9 };
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

    rejoice(): void {
      joy = 1.6;
      for (const passenger of passengers) {
        if (passenger.expression === 'happy') continue;
        passenger.expression = 'happy';
        passenger.creature?.setExpression('happy');
      }
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

        const head = passenger.creature?.head;
        if (head) {
          // Nose to the glass, until somebody waves — then they turn and look
          // back at you, which is the whole reason they came along.
          const look = joy > 0 ? 0.85 : Math.sin(elapsed * 0.5 + passenger.phase) * 0.16;
          head.rotation.y = look * (passenger.handle.root.rotation.y > Math.PI ? -1 : 1);
          head.rotation.x = -0.12 + Math.sin(elapsed * 1.1 + passenger.phase) * 0.05;
        }
        if (joy <= 0 && passenger.expression !== 'neutral') {
          passenger.expression = 'neutral';
          passenger.creature?.setExpression('neutral');
        }
      }

      lamp.intensity = lampGlow * 3.2;
      lampShade.scale.setScalar(0.85 + lampGlow * 0.3);

      const chase = elapsed * 2.4;
      for (let i = 0; i < bulbCount; i += 1) {
        const wave = 0.55 + 0.45 * Math.sin(chase - (i / bulbCount) * TAU * 3);
        bulbColour.copy(litColour).multiplyScalar(0.5 + wave * 0.8);
        bulbColour.lerp(dimColour, 1 - lampGlow);
        bulbs.setColorAt(i, bulbColour);
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
