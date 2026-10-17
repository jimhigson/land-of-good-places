import {
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
import { addOutline, disposeTree, solid, toonMaterial } from '../../art/style/materials';
import { gameStore } from '../../state';
import { groundInPlot, plotSolid } from '../../world/AnchorPlots';
import type { AnchorDefinition } from '../../world/anchors';
import type { CollisionWorld } from '../../world/Collision';

/**
 * The Space Ferris Wheel, as it stands in the park.
 *
 * This is the landmark, not the ride — the ride is a mini-game in its own
 * little world (`SpaceFerrisWheel.ts`). What stands here is the thing you can
 * see from the fountain, turning slowly against the sky, that lights up at
 * dusk and tells a child there is something over there worth walking to.
 *
 * It lives in `minigames/ferrisWheel/` rather than in `world/` for the same
 * reason `minigames/stallProp.ts` does: the booth and the game behind it are
 * one feature, and splitting them across two folders only means two places to
 * look when the ride changes.
 *
 * **Three things shape the build.**
 *
 * *It faces the camera.* The wheel is authored as a disc in local XY with its
 * axle down local +Z, and the whole root is then turned by {@link WHEEL_YAW} —
 * 45°, which is exactly where the default isometric camera stands. A ferris
 * wheel seen edge-on is a pole, and the one thing this ride must never be is a
 * pole.
 *
 * *Everything that repeats is instanced.* Twelve gondolas are three
 * `InstancedMesh`es rather than thirty-six meshes, the twelve spokes are one
 * (doubled up to twenty-four instances across the two rims), and the
 * twenty-four bulbs are one more. The finished landmark is about sixteen draw
 * calls, which is what lets it stand in a park that is already drawing four
 * hundred.
 *
 * *You can walk underneath it.* Only the four feet and the boarding deck are
 * solid. The plot is a place to run about in, exactly as it was when it was an
 * empty patch of pegs.
 */

/** Where the camera stands, so this is where the wheel faces. */
/**
 * Fallback only: the real yaw is derived per-park so the boarding deck's
 * local -X side faces the anchor's entrance wherever the layout solver put
 * it (Decision 5). The authored constant aimed the deck at where the
 * entrance *used* to be, which pocketed the doormat the first time the park
 * regenerated.
 */
const WHEEL_YAW = Math.PI / 4;

/**
 * Height of the axle above the plot, in metres.
 *
 * Set by the bottom of the wheel, not the top: the lowest car has to clear the
 * boarding deck. Hub minus rim minus {@link HANG} minus half a car is the
 * ground clearance, and at 9.9 that comes out at about 80 cm.
 */
const HUB_Y = 9.9;

/** Radius out to the rim the gondolas hang from. */
const RIM_R = 7;

/** How far below its rim point a car hangs. */
const HANG = 1.5;

/** How far apart the two rims sit along the axle. */
const RIM_GAP = 1.05;

/** A leg's radius at its foot, and the solid round the foot (and the bottom of its leg). */
const LEG_FOOT_RADIUS = 0.34;
const FOOT_SOLID_RADIUS = 0.85;

/** The boarding deck: its platform's size and corner rounding, and its two railings. */
const DECK_WIDTH = 3.2;
const DECK_HEIGHT = 0.44;
const DECK_LENGTH = 4.2;
const DECK_ROUNDING = 0.12;
const DECK_RAIL_TUBE = 0.09;
const DECK_RAIL_LENGTH = 3.1;
const DECK_RAIL_Y = 1.05;
const DECK_RAIL_Z = 2;
/** A railing's solid half-width: the rail and its posts (0.12 m), and a little for the hand. */
const DECK_RAIL_COLLISION_HALF = 0.15;

/** Gondolas, spokes and rim lamps all come in this many. */
const CARS = 12;

/** Seconds for one full revolution. Slow: this is scenery, not a ride. */
const TURN_SECONDS = 44;

/** The gondola colours, taken in turn around the rim. */
const CAR_COLOURS = [
  PALETTE.markerPink,
  PALETTE.markerLemon,
  PALETTE.markerMint,
  PALETTE.markerSky,
  PALETTE.markerLilac,
  PALETTE.blossomWhite,
];

/**
 * How high the lowest car's centre sits above the plot's ground.
 *
 * Exported because the ride has to put the car a child actually sits in at
 * exactly the same height as the car she watched come down to meet her — see
 * `world/ferrisWheel/FerrisWheelRide.ts`. Derived here rather than copied
 * there, so the two cannot drift if the wheel is ever resized.
 */
export const FERRIS_CAR_LOW_Y = HUB_Y - RIM_R - HANG;

export interface FerrisWheelProp {
  /** Add to the anchor plot group. Origin at the plot centre, on the ground. */
  readonly root: Group;
  /**
   * Shows or hides the whole wheel.
   *
   * Hidden for the length of a ride. The ride brings its own wheel — the
   * gondola carries the rim, spokes and hanger it swings from
   * (`ferrisWheel/gondola.ts`), which is what a child sees through the
   * skylight and what tells her what she is riding — so leaving this one
   * standing put **two** ferris wheels on screen at once. Jim rode it and
   * said so.
   *
   * Hiding the lot rather than just the twelve scenery cars, because the
   * doubling was the wheel itself, not the cars.
   */
  setVisible(visible: boolean): void;
  update(dt: number, elapsed: number): void;
  dispose(): void;
}

/**
 * Builds the wheel for an anchor plot and registers its collision.
 *
 * Collision coordinates are world-space (see ARCHITECTURE.md), so the anchor is
 * needed for more than its footprint: every foot is seated on its own
 * `terrainHeight`, because the park is a gentle hill and four legs on one
 * average height leaves one of them in the air.
 */
export function createFerrisWheelProp(
  anchor: AnchorDefinition,
  collision: CollisionWorld,
): FerrisWheelProp {
  const root = new Group();
  root.name = 'prop.ferrisWheel';

  const [centreX, centreZ] = anchor.position;
  // Aim the boarding deck (local -X) at the entrance: local -X maps to world
  // (-cos yaw, +sin yaw), so yaw = atan2(dz, -dx) for entrance direction d.
  const entranceDx = anchor.entrance[0] - centreX;
  const entranceDz = anchor.entrance[1] - centreZ;
  const wheelYaw =
    Math.hypot(entranceDx, entranceDz) > 1e-6
      ? Math.atan2(entranceDz, -entranceDx)
      : WHEEL_YAW;
  root.rotation.y = wheelYaw;
  /** Plot-local (x, z) to world (x, z), through the wheel's own yaw. */
  const toWorld = (lx: number, lz: number): [number, number] => [
    centreX + lx * Math.cos(wheelYaw) + lz * Math.sin(wheelYaw),
    centreZ - lx * Math.sin(wheelYaw) + lz * Math.cos(wheelYaw),
  ];

  const frame = toonMaterial(PALETTE.stonePink);
  const frameDeep = toonMaterial(PALETTE.stonePinkDark);
  const cream = toonMaterial(PALETTE.buildingWall);
  const trim = toonMaterial(PALETTE.markerLilac);
  const woodMaterial = toonMaterial(PALETTE.wood);

  // --- legs ------------------------------------------------------------------
  // Two splayed A-frames, one either side of the wheel. Each leg is a tapered
  // cylinder leaned in towards the axle; nothing here is plumb, which is the
  // rule for everything in this park.
  const footSpreadX = 3.2;
  const footSpreadZ = 4.5;
  const axleHalf = RIM_GAP / 2 + 0.35;

  for (const sx of [-1, 1] as const) {
    for (const sz of [-1, 1] as const) {
      const [footWorldX, footWorldZ] = toWorld(sx * footSpreadX, sz * footSpreadZ);
      // In the plot's own leaning frame, not as a difference of two world
      // heights: the plot group's `+Y` is already the local up, so the sphere's
      // fall across the wheel's footprint has been taken out by the parent and
      // subtracting world heights would hand it back — driving the downhill
      // feet into the grass by twice the cap's drop. What is left is the waves,
      // which is what a foot should follow.
      const footY = groundInPlot(centreX, centreZ, footWorldX - centreX, footWorldZ - centreZ);

      const top = new Vector3(0, HUB_Y, sz * axleHalf);
      const foot = new Vector3(sx * footSpreadX, footY + 0.1, sz * footSpreadZ);
      const span = top.clone().sub(foot);

      const leg = solid(new Mesh(new CylinderGeometry(0.19, LEG_FOOT_RADIUS, span.length(), 10), frame));
      leg.position.copy(foot).addScaledVector(span, 0.5);
      leg.quaternion.setFromUnitVectors(new Vector3(0, 1, 0), span.clone().normalize());
      root.add(leg);
      addOutline(leg, 0.02);

      // A fat pad under each foot, so the wheel sits ON the grass rather than
      // being stuck into it.
      const pad = solid(new Mesh(new CylinderGeometry(0.62, 0.72, 0.34, 12), frameDeep));
      pad.position.set(sx * footSpreadX, footY + 0.17, sz * footSpreadZ);
      root.add(pad);

      // The foot and the bottom of its leg, as one solid: its top is how high
      // the leg has climbed by the time it leaves the foot's footprint (its
      // centre line, plus its own girth there) — the drawn top over the circle.
      const legRise = span.y * (FOOT_SOLID_RADIUS / Math.hypot(span.x, span.z)) + LEG_FOOT_RADIUS;
      const standing = plotSolid(centreX, centreZ, footWorldX, footWorldZ, footY, foot.y + legRise);
      collision.kinded('ferris wheel leg', () =>
        collision.addCircle(standing.x, standing.z, FOOT_SOLID_RADIUS, standing.top, false, true),
      );
    }
  }

  // A cross-brace between each A-frame's feet, at knee height.
  for (const sz of [-1, 1] as const) {
    const brace = solid(new Mesh(new CylinderGeometry(0.13, 0.13, footSpreadX * 2, 8), frameDeep));
    brace.rotation.z = Math.PI / 2;
    brace.position.set(0, 2.4, sz * (footSpreadZ * 0.62));
    root.add(brace);
  }

  // --- axle, hub and the star on top ----------------------------------------
  const axle = solid(new Mesh(new CylinderGeometry(0.34, 0.34, axleHalf * 2 + 0.5, 14), cream));
  axle.rotation.x = Math.PI / 2;
  axle.position.y = HUB_Y;
  root.add(axle);
  addOutline(axle, 0.02);

  /** Everything that turns. */
  const wheel = new Group();
  wheel.name = 'wheel';
  wheel.position.y = HUB_Y;
  root.add(wheel);

  for (const sz of [-1, 1] as const) {
    const hub = solid(new Mesh(new CylinderGeometry(0.95, 0.95, 0.3, 20), trim));
    hub.rotation.x = Math.PI / 2;
    hub.position.z = sz * (RIM_GAP / 2);
    wheel.add(hub);

    const rim = solid(new Mesh(new TorusGeometry(RIM_R, 0.15, 8, 46), frame));
    rim.position.z = sz * (RIM_GAP / 2);
    wheel.add(rim);
  }

  // A mast with a pennant, because a landmark wants a top.
  const mast = solid(new Mesh(new CylinderGeometry(0.09, 0.11, 1.5, 8), cream));
  mast.position.y = HUB_Y + RIM_R + 0.8;
  root.add(mast);

  const finial = solid(new Mesh(new SphereGeometry(0.34, 14, 11), trim));
  finial.position.y = HUB_Y + RIM_R + 1.6;
  finial.scale.set(1, 1.12, 1);
  root.add(finial);
  addOutline(finial, 0.018);

  // --- spokes ----------------------------------------------------------------
  // One instanced mesh, two rims' worth of instances. Thin geometry, so no
  // outline: an inverted hull on a 9 cm bar is a bar.
  const spokeGeometry = new CylinderGeometry(0.075, 0.075, RIM_R, 6);
  const spokes = new InstancedMesh(spokeGeometry, cream, CARS * 2);
  spokes.name = 'spokes';
  spokes.castShadow = true;
  spokes.frustumCulled = false;
  const matrix = new Matrix4();
  const position = new Vector3();
  const quaternion = new Quaternion();
  const scale = new Vector3(1, 1, 1);

  for (let i = 0; i < CARS; i += 1) {
    const angle = (i / CARS) * TAU;
    for (let side = 0; side < 2; side += 1) {
      const z = (side === 0 ? -1 : 1) * (RIM_GAP / 2);
      position.set((Math.cos(angle) * RIM_R) / 2, (Math.sin(angle) * RIM_R) / 2, z);
      quaternion.setFromAxisAngle(new Vector3(0, 0, 1), angle - Math.PI / 2);
      matrix.compose(position, quaternion, scale);
      spokes.setMatrixAt(i * 2 + side, matrix);
    }
  }
  spokes.instanceMatrix.needsUpdate = true;
  wheel.add(spokes);

  // --- gondolas ---------------------------------------------------------------
  // Three instanced meshes for twelve cars. They hang from the rim and are
  // re-posed every frame: a gondola that turned with the wheel instead of
  // hanging level would tip its passengers out at the top.
  const podGeometry = new RoundedBoxGeometry(1.75, 1.45, 1.5, 4, 0.36);
  const pods = new InstancedMesh(podGeometry, toonMaterial(0xffffff), CARS);
  pods.name = 'gondolas';
  pods.castShadow = true;
  pods.receiveShadow = true;
  pods.frustumCulled = false;

  const canopyGeometry = new CylinderGeometry(1.02, 1.02, 0.24, 14);
  const canopies = new InstancedMesh(canopyGeometry, toonMaterial(0xffffff), CARS);
  canopies.name = 'gondola-canopies';
  canopies.castShadow = true;
  canopies.frustumCulled = false;

  const hangerGeometry = new CylinderGeometry(0.07, 0.07, 1.15, 6);
  const hangers = new InstancedMesh(hangerGeometry, frameDeep, CARS);
  hangers.name = 'gondola-hangers';
  hangers.frustumCulled = false;

  const carColour = new Color();
  for (let i = 0; i < CARS; i += 1) {
    carColour.setHex(CAR_COLOURS[i % CAR_COLOURS.length] ?? PALETTE.markerPink);
    pods.setColorAt(i, carColour);
    canopies.setColorAt(i, carColour.clone().lerp(new Color(PALETTE.buildingWall), 0.55));
  }
  if (pods.instanceColor) pods.instanceColor.needsUpdate = true;
  if (canopies.instanceColor) canopies.instanceColor.needsUpdate = true;

  wheel.add(pods, canopies, hangers);

  // --- bulbs ------------------------------------------------------------------
  // Unlit spheres, one instanced mesh, and one real light at the hub. Bulbs are
  // `MeshBasicMaterial` for the same reason the plot markers are: they have to
  // read as *light* at every hour of the day, and a lit material at dusk reads
  // as a dark bead.
  const bulbCount = CARS * 2;
  const bulbMaterial = new MeshBasicMaterial({ toneMapped: false });
  const bulbs = new InstancedMesh(new SphereGeometry(0.17, 10, 8), bulbMaterial, bulbCount);
  bulbs.name = 'wheel-bulbs';
  bulbs.frustumCulled = false;
  for (let i = 0; i < bulbCount; i += 1) {
    const angle = (i / bulbCount) * TAU;
    position.set(Math.cos(angle) * RIM_R, Math.sin(angle) * RIM_R, 0);
    matrix.compose(position, new Quaternion(), scale);
    bulbs.setMatrixAt(i, matrix);
  }
  bulbs.instanceMatrix.needsUpdate = true;
  wheel.add(bulbs);

  const hubLight = new PointLight(PALETTE.fairyPink, 0, 26, 2);
  hubLight.position.y = HUB_Y;
  root.add(hubLight);

  // --- the boarding deck ------------------------------------------------------
  // Tucked under the low shoulder of the wheel on the local -X side — which the
  // wheel's yaw aims north-west, at the plot entrance and the ticket kiosk. The
  // cars come down between its two railings the way they do on the real thing,
  // which is worth the two metres of authenticity it costs.
  const deckX = -2.6;
  const deck = new Group();
  deck.position.set(deckX, 0, 0);
  root.add(deck);

  const [deckWorldX, deckWorldZ] = toWorld(deckX, 0);
  deck.position.y = groundInPlot(centreX, centreZ, deckWorldX - centreX, deckWorldZ - centreZ);

  const platform = solid(
    new Mesh(new RoundedBoxGeometry(DECK_WIDTH, DECK_HEIGHT, DECK_LENGTH, 3, DECK_ROUNDING), woodMaterial),
  );
  platform.position.y = DECK_HEIGHT / 2;
  deck.add(platform);
  addOutline(platform, 0.02);

  for (const sz of [-1, 1] as const) {
    const rail = solid(new Mesh(new CylinderGeometry(DECK_RAIL_TUBE, DECK_RAIL_TUBE, DECK_RAIL_LENGTH, 8), trim));
    rail.rotation.z = Math.PI / 2;
    rail.position.set(0, DECK_RAIL_Y, sz * DECK_RAIL_Z);
    deck.add(rail);

    for (const sx of [-1, 1] as const) {
      const postMesh = solid(new Mesh(new CylinderGeometry(0.1, 0.12, 1.05, 8), cream));
      postMesh.position.set(sx * 1.45, 0.66, sz * DECK_RAIL_Z);
      deck.add(postMesh);
    }
  }

  // The deck is a solid she steps up onto (it is no higher than a step), and
  // its two railings are solid to their tops. They run along the deck's
  // `±Z` edges, where they are drawn, the cars coming down between them; the
  // open `±X` ends are how you get on.
  //
  // These walls used to stand on the *other* two edges — across the open ends,
  // where nothing is drawn — while the railings she could see had no collider:
  // an invisible wall across the way on, and a pair of railings she walked
  // straight through.
  const deckY = deck.position.y;
  {
    const platformSolid = plotSolid(centreX, centreZ, deckWorldX, deckWorldZ, deckY, deckY + DECK_HEIGHT);
    collision.kinded('ferris deck', () =>
      collision.addBox(
        platformSolid.x,
        platformSolid.z,
        DECK_WIDTH / 2 - DECK_ROUNDING,
        DECK_LENGTH / 2 - DECK_ROUNDING,
        -wheelYaw,
        DECK_ROUNDING,
        platformSolid.top,
        false,
        true,
      ),
    );
    const railTop = deckY + DECK_RAIL_Y + DECK_RAIL_TUBE;
    for (const sz of [-1, 1] as const) {
      const [ax, az] = toWorld(deckX - DECK_RAIL_LENGTH / 2, sz * DECK_RAIL_Z);
      const [bx, bz] = toWorld(deckX + DECK_RAIL_LENGTH / 2, sz * DECK_RAIL_Z);
      const [mx, mz] = toWorld(deckX, sz * DECK_RAIL_Z);
      const a = plotSolid(centreX, centreZ, ax, az, deckY, railTop);
      const b = plotSolid(centreX, centreZ, bx, bz, deckY, railTop);
      const middle = plotSolid(centreX, centreZ, mx, mz, deckY, railTop);
      collision.kinded('ferris deck rail', () =>
        collision.addWall(a.x, a.z, b.x, b.z, DECK_RAIL_COLLISION_HALF, middle.top, false, true),
      );
    }
  }

  // --------------------------------------------------------------- animation
  // Every vector here is allocated once: this runs twelve times a frame, and a
  // system that allocates per car is a system that stutters on a phone.
  const podMatrix = new Matrix4();
  const rimPoint = new Vector3();
  const hangDown = new Vector3();
  const carCentre = new Vector3();
  const podPlace = new Vector3();
  const podQuaternion = new Quaternion();
  const zAxis = new Vector3(0, 0, 1);
  const bulbColour = new Color();
  const litColour = new Color(PALETTE.fairyWarm);
  const chaseColour = new Color(PALETTE.fairyPink);
  const dimColour = new Color(PALETTE.stonePinkLight);

  /** 0 in daylight, 1 once the fairy lights are on. Eased, never snapped. */
  let lit = 0;

  return {
    root,

    setVisible(visible: boolean): void {
      root.visible = visible;
    },

    update(dt: number, elapsed: number): void {
      const spin = (elapsed / TURN_SECONDS) * TAU;
      wheel.rotation.z = spin;

      // Gondolas hang level: the wheel's rotation is undone on each car, and a
      // little pendulum swing is added on top, out of step car to car.
      for (let i = 0; i < CARS; i += 1) {
        const angle = spin + (i / CARS) * TAU;
        const swing = Math.sin(elapsed * 0.9 + i * 1.31) * 0.07;

        rimPoint.set(Math.cos(angle) * RIM_R, Math.sin(angle) * RIM_R, 0);
        // "Down", tilted by the swing. The wheel's own rotation is subtracted so
        // the car stays level however far round the rim it has travelled — a
        // gondola that turned with the wheel would tip its passengers out at the
        // top, which is a different ride entirely.
        hangDown.set(Math.sin(swing), -Math.cos(swing), 0);
        podQuaternion.setFromAxisAngle(zAxis, -spin + swing);

        podPlace.copy(rimPoint).addScaledVector(hangDown, 0.45);
        podMatrix.compose(podPlace, podQuaternion, scale);
        hangers.setMatrixAt(i, podMatrix);

        carCentre.copy(rimPoint).addScaledVector(hangDown, HANG);
        podMatrix.compose(carCentre, podQuaternion, scale);
        pods.setMatrixAt(i, podMatrix);

        podPlace.copy(carCentre).addScaledVector(hangDown, -0.78);
        podMatrix.compose(podPlace, podQuaternion, scale);
        canopies.setMatrixAt(i, podMatrix);
      }
      pods.instanceMatrix.needsUpdate = true;
      canopies.instanceMatrix.needsUpdate = true;
      hangers.instanceMatrix.needsUpdate = true;

      // Lights. `lightsOn` is a hard boolean on the store, so it is eased here
      // rather than switched — a fairground does not come on like a light bulb
      // in a hallway.
      const wanted = gameStore.get().world.lightsOn ? 1 : 0;
      lit += (wanted - lit) * clamp01(dt * 1.6);

      const chase = elapsed * 2.2;
      for (let i = 0; i < bulbCount; i += 1) {
        // A wave of brightness running round the rim, and every third bulb
        // pink — the whole trick that makes a ring of dots read as "fairground".
        const wave = 0.55 + 0.45 * Math.sin(chase - (i / bulbCount) * TAU * 3);
        bulbColour.copy(i % 3 === 0 ? chaseColour : litColour).multiplyScalar(0.55 + wave * 0.7);
        bulbColour.lerp(dimColour, 1 - lit);
        bulbs.setColorAt(i, bulbColour);
      }
      if (bulbs.instanceColor) bulbs.instanceColor.needsUpdate = true;

      hubLight.intensity = lit * 14;
    },

    dispose(): void {
      disposeTree(root);
      spokes.dispose();
      pods.dispose();
      canopies.dispose();
      hangers.dispose();
      bulbs.dispose();
    },
  };
}

/**
 * The car colours, in rim order.
 *
 * Shared with the ride so that the gondola you sit in is the same paint as the
 * ones a child watched go round from the grass — the one detail that joins the
 * landmark and the little world behind it into one machine.
 */
export const FERRIS_CAR_COLOURS = CAR_COLOURS;
