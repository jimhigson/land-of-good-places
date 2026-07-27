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

const WHEEL_RADIUS = 0.42;
const BODY_BOTTOM_Y = 0.5;
const BODY_HEIGHT = 1.55;
const BODY_WIDTH = 2.05;
const BODY_LENGTH = 4.2;
const FACE_RADIUS = 1.04;

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
  const windowMaterial = toonMaterial(PALETTE.buildingWindow, { emissive: PALETTE.buildingWindow, emissiveIntensity: 0.08 });
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
      new RoundedBoxGeometry(BODY_WIDTH, BODY_HEIGHT, cabinLength, 5, 0.26),
      bodyMaterial,
    ),
  );
  body.position.set(0, BODY_BOTTOM_Y + BODY_HEIGHT / 2, BODY_LENGTH / 2 - cabinLength / 2 - FACE_RADIUS * 0.55);
  chassis.add(body);
  addOutline(body, 0.02);

  // A paler roof cap, rounded, so the bus doesn't read as a single flat-topped
  // box — every shop and ride in this park gets a bobble or a cap on top.
  const roof = solid(
    new Mesh(new RoundedBoxGeometry(BODY_WIDTH * 0.94, 0.34, cabinLength * 0.92, 4, 0.16), roofMaterial),
  );
  roof.position.set(0, BODY_BOTTOM_Y + BODY_HEIGHT + 0.05, body.position.z);
  chassis.add(roof);
  addOutline(roof, 0.016);

  // --- the face ---------------------------------------------------------------
  // A big squashed sphere at the front, flattened toward the windscreen — the
  // same "nose" trick `dodgems/car.ts` uses, just scaled up to be the whole
  // front of the bus.
  const faceZ = BODY_LENGTH / 2 - FACE_RADIUS * 0.62;
  const faceY = BODY_BOTTOM_Y + BODY_HEIGHT * 0.62;
  const faceSphere = blob(FACE_RADIUS, bodyMaterial, [1, 0.92, 0.6]);
  faceSphere.position.set(0, faceY, faceZ);
  chassis.add(faceSphere);
  addOutline(faceSphere, 0.02);

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
  const earGeometry = new ConeGeometry(0.34, 0.56, 4);
  const earInnerGeometry = new ConeGeometry(0.18, 0.32, 4);
  for (const side of [-1, 1] as const) {
    const ear = solid(new Mesh(earGeometry, roofMaterial));
    ear.position.set(side * 0.62, BODY_BOTTOM_Y + BODY_HEIGHT + 0.28, faceZ - 0.35);
    ear.rotation.z = side * -0.22;
    ear.rotation.y = Math.PI / 4;
    chassis.add(ear);
    addOutline(ear, 0.016);

    const innerEar = decal(new Mesh(earInnerGeometry, earInnerMaterial));
    innerEar.position.set(0, 0.03, 0.06);
    innerEar.rotation.copy(ear.rotation);
    innerEar.scale.set(0.92, 0.8, 0.92);
    ear.add(innerEar);
  }

  // --- windows -------------------------------------------------------------
  const windowGeometry = new RoundedBoxGeometry(0.62, 0.5, 0.06, 3, 0.1);
  for (const side of [-1, 1] as const) {
    for (let i = 0; i < 2; i += 1) {
      const win = decal(new Mesh(windowGeometry, windowMaterial));
      win.position.set(
        side * (BODY_WIDTH / 2 + 0.02),
        BODY_BOTTOM_Y + BODY_HEIGHT * 0.68,
        body.position.z + (i === 0 ? 0.75 : -0.55),
      );
      win.rotation.y = Math.PI / 2;
      chassis.add(win);
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
    new Mesh(new RoundedBoxGeometry(0.06, BODY_HEIGHT * 0.86, 1.05, 2, 0.08), bodyMaterial),
  );
  doorPanel.position.set(0, BODY_HEIGHT * 0.43, 0.5);
  doorGroup.add(doorPanel);
  addOutline(doorPanel, 0.014);

  const doorWindow = decal(
    new Mesh(new RoundedBoxGeometry(0.04, BODY_HEIGHT * 0.36, 0.75, 2, 0.06), windowMaterial),
  );
  doorWindow.position.set(0.02, BODY_HEIGHT * 0.58, 0.5);
  doorGroup.add(doorWindow);

  // A dark opening behind the door, so swinging it away actually reveals a
  // doorway instead of a hole showing the sky through the cabin.
  const doorway = decal(
    new Mesh(
      new RoundedBoxGeometry(0.5, BODY_HEIGHT * 0.82, 1.1, 2, 0.1),
      toonMaterial(new Color(PALETTE.ink).multiplyScalar(0.7).getHex()),
    ),
  );
  doorway.position.set(-0.24, BODY_HEIGHT * 0.42, 0.5);
  chassis.add(doorway);

  // A couple of friendly steps, always visible, so hopping down reads clearly.
  const step = solid(new Mesh(new RoundedBoxGeometry(0.5, 0.1, 0.7, 2, 0.04), bumperMaterial));
  step.position.set(-(BODY_WIDTH / 2 + 0.16), BODY_BOTTOM_Y - 0.08, doorGroup.position.z + 0.5);
  chassis.add(step);

  // --- bumpers ---------------------------------------------------------------
  const rearBumper = solid(
    new Mesh(new RoundedBoxGeometry(BODY_WIDTH * 0.98, 0.3, 0.22, 3, 0.08), bumperMaterial),
  );
  rearBumper.position.set(0, BODY_BOTTOM_Y + 0.05, -BODY_LENGTH / 2 + 0.08);
  chassis.add(rearBumper);

  // --- paw-print livery --------------------------------------------------------
  for (const side of [-1, 1] as const) {
    for (let i = 0; i < 3; i += 1) {
      const paw = buildPawPrint(pawMaterial);
      paw.position.set(
        side * (BODY_WIDTH / 2 + 0.005),
        BODY_BOTTOM_Y + BODY_HEIGHT * 0.34,
        body.position.z - cabinLength * 0.3 + i * 0.85,
      );
      paw.rotation.y = side > 0 ? Math.PI / 2 : -Math.PI / 2;
      chassis.add(paw);
    }
  }

  // --- wheels --------------------------------------------------------------
  const wheelGeometry = new CylinderGeometry(WHEEL_RADIUS, WHEEL_RADIUS, 0.34, 14);
  const hubGeometry = new CylinderGeometry(WHEEL_RADIUS * 0.42, WHEEL_RADIUS * 0.42, 0.36, 10);
  const wheels: Mesh[] = [];
  for (const x of [-(BODY_WIDTH / 2 - 0.05), BODY_WIDTH / 2 - 0.05]) {
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
  tail.position.set(0.18, BODY_BOTTOM_Y + BODY_HEIGHT * 0.58, -BODY_LENGTH / 2 + 0.05);
  chassis.add(tail);

  let tailCursor = new Group();
  tail.add(tailCursor);
  tailCursor.rotation.x = -0.3;
  const tailSegments: Group[] = [];
  for (let i = 0; i < 3; i += 1) {
    const segRadius = 0.16 - i * 0.03;
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
  const tailTip = solid(new Mesh(new SphereGeometry(0.13, 12, 10), tailMaterial));
  tailCursor.add(tailTip);
  addOutline(tailTip, 0.012);

  // --- height ----------------------------------------------------------------
  const height = BODY_BOTTOM_Y + BODY_HEIGHT + 0.05 + 0.56; // roof cap + ear tip

  let doorOpenAmount = 0;
  let wheelSpin = 0;

  return {
    root,
    height,

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
