import {
  CylinderGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  SphereGeometry,
  TorusGeometry,
  Vector3,
} from 'three';
import { PALETTE } from '../../core/palette';
import { TAU, clamp01, damp } from '../../core/mathUtils';
import { addOutline, decal, disposeTree, solid, toonMaterial } from '../../art/style/materials';
import { createFacePatch } from '../../art/style/faces';
import { blob, stub } from '../../art/style/asset';
import { createRipika } from '../../art/models/ripika';

/**
 * The two friends who come to the window: the alien in their flying saucer, and
 * Space RiPika in a tiny astronaut helmet.
 *
 * They are the reason this ride has any interactivity at all. A ninety-second
 * cut-scene is a lovely thing to watch once; something you can *wave at* is a
 * thing a small hand comes back to. So both of them:
 *
 * - drift across the window on a slow arc, never straight at you;
 * - carry a generous invisible hit sphere, because a finger aimed at a mouse
 *   forty metres away is aimed at roughly where the mouse is;
 * - wave back with their whole body when tapped, and keep waving for a moment
 *   afterwards, so the answer is never in doubt.
 *
 * Space RiPika is the park's own `createRipika({ space: true })` — the helmet
 * has been waiting in that model file for exactly this ride.
 */

/** Seconds a friend keeps waving after being waved at. */
const WAVE_SECONDS = 2.6;

export type FriendId = 'alien' | 'ripika';

export interface SpaceFriend {
  readonly id: FriendId;
  readonly root: Group;
  /** What a tap has to hit. Deliberately much bigger than the model. */
  readonly hitTarget: Object3D;
  /** True once the friend has drifted into view and can be tapped. */
  readonly greetable: boolean;
  /** Where sparks should be thrown from, in world space. */
  sparkPoint(into: Vector3): Vector3;
  /** They saw you! */
  wave(): void;
  /** Has this friend been waved at at least once? */
  readonly greeted: boolean;
  /** 0 = not here yet, 1 = fully arrived. Drives the pop-in. */
  setPresence(presence: number): void;
  update(dt: number, elapsed: number): void;
  dispose(): void;
}

/**
 * A hit proxy: a sphere that raycasts but never draws.
 *
 * `visible = false` would be simpler and does not work — the raycaster skips
 * invisible objects. Writing neither colour nor depth leaves a shape a finger
 * can find and the frame cannot see.
 */
function hitSphere(radius: number): Mesh {
  const mesh = new Mesh(
    new SphereGeometry(radius, 8, 6),
    new MeshBasicMaterial({ colorWrite: false, depthWrite: false }),
  );
  mesh.name = 'hit';
  mesh.renderOrder = -10;
  return mesh;
}

// --------------------------------------------------------------- the alien

export function createAlienSaucer(): SpaceFriend {
  const root = new Group();
  root.name = 'ferris:alien';
  root.scale.setScalar(0.001);

  const shell = toonMaterial(PALETTE.markerSky);
  const shellDeep = toonMaterial(PALETTE.buildingRoofDeep);
  const glass = toonMaterial(PALETTE.glassTint, { transparent: true, opacity: 0.42 });
  const skin = toonMaterial(PALETTE.markerMint);
  const skinDeep = toonMaterial(PALETTE.buildingTrimDeep);

  // --- the saucer -------------------------------------------------------------
  const hull = solid(new Mesh(new SphereGeometry(2.6, 30, 16), shell));
  hull.scale.set(1, 0.28, 1);
  root.add(hull);
  addOutline(hull, 0.03);

  const underside = solid(new Mesh(new SphereGeometry(1.5, 24, 14), shellDeep));
  underside.scale.set(1, 0.5, 1);
  underside.position.y = -0.5;
  root.add(underside);

  // Lamps around the rim — unlit, like every bulb in this park.
  const lampMaterial = new MeshBasicMaterial({ color: PALETTE.markerLemon, toneMapped: false });
  const lamps: Mesh[] = [];
  for (let i = 0; i < 8; i += 1) {
    const angle = (i / 8) * TAU;
    const lamp = decal(new Mesh(new SphereGeometry(0.19, 10, 8), lampMaterial));
    lamp.position.set(Math.cos(angle) * 2.4, -0.12, Math.sin(angle) * 2.4);
    root.add(lamp);
    lamps.push(lamp);
  }

  const dome = decal(new Mesh(new SphereGeometry(1.35, 24, 16, 0, TAU, 0, Math.PI / 2), glass));
  dome.position.y = 0.18;
  root.add(dome);

  const domeRing = solid(new Mesh(new TorusGeometry(1.35, 0.11, 8, 26), shellDeep));
  domeRing.rotation.x = Math.PI / 2;
  domeRing.position.y = 0.18;
  root.add(domeRing);

  // --- the pilot ---------------------------------------------------------------
  const pilot = new Group();
  pilot.position.y = 0.1;
  root.add(pilot);

  const body = blob(0.44, skin, [1, 1.05, 0.92], 20);
  body.position.y = 0.34;
  pilot.add(body);
  addOutline(body, 0.014);

  const head = new Group();
  head.position.y = 0.86;
  pilot.add(head);

  // Big skull, small chin: the head is 60% of the pilot, which is where all the
  // cuteness in this park comes from (ART_DIRECTION §4).
  const skullRadius = 0.46;
  const skull = blob(skullRadius, skin, [1.12, 0.94, 1], 26);
  head.add(skull);
  addOutline(skull, 0.014);

  const face = createFacePatch({
    radius: skullRadius,
    spreadX: 1.9,
    spreadY: 1.9,
    tilt: 0.18,
    size: 512,
    eyeY: 0.44,
    eyeGap: 0.5,
    eyeW: 0.135,
    eyeH: 0.18,
    mouth: 'bigSmile',
    mouthW: 0.09,
    mouthDrop: 0.24,
    blush: PALETTE.markerMint,
    blushStyle: 'soft',
    blushR: 0.1,
    iris: PALETTE.markerLilac,
  });
  face.mesh.scale.set(1.12, 0.94, 1);
  head.add(face.mesh);

  // Two antennae with bobbles, one longer than the other — nothing is plumb.
  const antennae: Group[] = [];
  for (const side of [-1, 1] as const) {
    const antenna = new Group();
    antenna.position.set(side * 0.2, 0.36, -0.02);
    antenna.rotation.z = side * 0.34;
    head.add(antenna);

    const stalk = solid(new Mesh(new CylinderGeometry(0.035, 0.045, side < 0 ? 0.42 : 0.34, 8), skinDeep));
    stalk.position.y = side < 0 ? 0.21 : 0.17;
    antenna.add(stalk);

    const bobble = solid(new Mesh(new SphereGeometry(0.11, 12, 9), toonMaterial(PALETTE.markerLemon)));
    bobble.position.y = side < 0 ? 0.46 : 0.38;
    antenna.add(bobble);
    antennae.push(antenna);
  }

  const arms: Group[] = [];
  for (const side of [-1, 1] as const) {
    const arm = new Group();
    arm.position.set(side * 0.42, 0.52, 0.02);
    pilot.add(arm);

    const limb = stub(0.075, 0.2, skin);
    limb.position.y = -0.14;
    arm.add(limb);

    const hand = blob(0.11, skinDeep, [1, 0.95, 1], 14);
    hand.position.y = -0.3;
    arm.add(hand);
    arms.push(arm);
  }

  const hit = hitSphere(3.4);
  root.add(hit);

  let waveTimer = 0;
  let greetedYet = false;
  let presence = 0;

  return {
    id: 'alien',
    root,
    hitTarget: hit,
    get greetable(): boolean {
      return presence > 0.6;
    },
    get greeted(): boolean {
      return greetedYet;
    },

    sparkPoint(into: Vector3): Vector3 {
      return into.set(0, 1.1, 0).applyMatrix4(root.matrixWorld);
    },

    wave(): void {
      waveTimer = WAVE_SECONDS;
      greetedYet = true;
      face.setExpression('happy');
    },

    setPresence(next: number): void {
      presence = clamp01(next);
      // The same overshooting pop everything else in this game arrives with.
      const eased = presence * (1 + Math.sin(presence * Math.PI) * 0.22);
      root.scale.setScalar(Math.max(0.001, eased));
      root.visible = presence > 0.002;
    },

    update(dt: number, elapsed: number): void {
      if (!root.visible) return;

      if (waveTimer > 0) {
        waveTimer = Math.max(0, waveTimer - dt);
        if (waveTimer === 0) face.setExpression('neutral');
      }
      const excited = waveTimer > 0 ? 1 : 0;

      // The saucer rocks gently and bobs; when waved at it bounces.
      root.rotation.z = Math.sin(elapsed * 0.9) * 0.07 + Math.sin(elapsed * 7) * 0.05 * excited;
      root.rotation.x = Math.cos(elapsed * 0.7) * 0.05;
      pilot.position.y = 0.1 + Math.sin(elapsed * 2.4) * 0.03 + excited * 0.06;

      // The near arm waves: a big slow arc normally, a fast happy one when
      // somebody has just waved first.
      const nearArm = arms[1];
      const farArm = arms[0];
      const rate = excited > 0 ? 9 : 1.8;
      const swing = Math.sin(elapsed * rate);
      if (nearArm) {
        nearArm.rotation.z = -1.5 - swing * (excited > 0 ? 0.6 : 0.35);
        nearArm.rotation.x = 0.2;
      }
      if (farArm) farArm.rotation.z = 0.35 + Math.sin(elapsed * 1.2) * 0.12;

      for (let i = 0; i < antennae.length; i += 1) {
        const antenna = antennae[i];
        if (!antenna) continue;
        antenna.rotation.x = Math.sin(elapsed * 3 + i * 1.7) * (0.12 + excited * 0.25);
      }

      // The rim lamps chase round the saucer.
      for (let i = 0; i < lamps.length; i += 1) {
        const lamp = lamps[i];
        if (!lamp) continue;
        const pulse = 0.55 + 0.45 * Math.sin(elapsed * 4 - (i / lamps.length) * TAU * 2);
        lamp.scale.setScalar(0.7 + pulse * 0.6);
      }
    },

    dispose(): void {
      disposeTree(root);
    },
  };
}

// ---------------------------------------------------------- Space RiPika

export function createSpaceRipika(): SpaceFriend {
  const root = new Group();
  root.name = 'ferris:spaceRipika';
  root.scale.setScalar(0.001);

  // The park's own RiPika, wearing the helmet its model file has always known
  // how to put on. Space RiPika is not a different mouse.
  const ripika = createRipika({ space: true });
  const tumbler = new Group();
  tumbler.add(ripika.root);
  // Origin at the feet, so the mouse is lifted to float about its middle.
  ripika.root.position.y = -0.55;
  // Bigger than life. RiPika comes closest to the window of anything in the
  // show and is meant to fill it — this is the moment of the whole ride, and a
  // strictly-scaled 1.46 m mouse five metres away is a thumbnail.
  tumbler.scale.setScalar(1.7);
  root.add(tumbler);

  // A little tank on its back, because a helmet on its own reads as a fishbowl.
  const tank = solid(new Mesh(new CylinderGeometry(0.13, 0.13, 0.42, 12), toonMaterial(PALETTE.markerSky)));
  tank.position.set(0, -0.18, -0.3);
  tank.rotation.x = 0.2;
  tumbler.add(tank);

  const tankCap = solid(new Mesh(new SphereGeometry(0.14, 12, 9), toonMaterial(PALETTE.markerLemon)));
  tankCap.position.set(0, 0.04, -0.32);
  tumbler.add(tankCap);

  const hit = hitSphere(1.7);
  root.add(hit);

  let waveTimer = 0;
  let greetedYet = false;
  let presence = 0;
  let spinRate = 0.32;
  let expression: 'neutral' | 'happy' = 'neutral';

  return {
    id: 'ripika',
    root,
    hitTarget: hit,
    get greetable(): boolean {
      return presence > 0.6;
    },
    get greeted(): boolean {
      return greetedYet;
    },

    sparkPoint(into: Vector3): Vector3 {
      return into.set(0, 0.2, 0).applyMatrix4(root.matrixWorld);
    },

    wave(): void {
      waveTimer = WAVE_SECONDS;
      greetedYet = true;
      // A delighted spin, because a mouse in zero gravity would absolutely do
      // a delighted spin.
      spinRate = 3.4;
    },

    setPresence(next: number): void {
      presence = clamp01(next);
      const eased = presence * (1 + Math.sin(presence * Math.PI) * 0.22);
      root.scale.setScalar(Math.max(0.001, eased));
      root.visible = presence > 0.002;
    },

    update(dt: number, elapsed: number): void {
      if (!root.visible) return;

      if (waveTimer > 0) waveTimer = Math.max(0, waveTimer - dt);
      const excited = waveTimer > 0;

      // Faces are canvas textures — only ever swapped on a transition.
      const wanted = excited ? 'happy' : 'neutral';
      if (wanted !== expression) {
        expression = wanted;
        ripika.setExpression(wanted);
      }

      spinRate = damp(spinRate, 0.32, 0.5, dt);
      tumbler.rotation.y += spinRate * dt;
      tumbler.rotation.z = Math.sin(elapsed * 0.7) * 0.24;
      tumbler.rotation.x = Math.sin(elapsed * 0.5 + 1.2) * 0.16;

      // Paddling: there is nothing to walk on, so the legs and arms drift, and
      // both arms go up when it is being waved at.
      ripika.setWalkPhase((elapsed * 0.28) % 1, excited ? 0.85 : 0.3);
      if (ripika.limbs) {
        const lift = excited ? -1.5 : -0.5 + Math.sin(elapsed * 1.4) * 0.2;
        ripika.limbs.leftArm.rotation.x = lift;
        ripika.limbs.rightArm.rotation.x = lift - (excited ? Math.sin(elapsed * 11) * 0.5 : 0);
      }
      ripika.head.rotation.x = -0.12;
    },

    dispose(): void {
      disposeTree(root);
    },
  };
}
