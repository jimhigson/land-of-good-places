import {
  CircleGeometry,
  ConeGeometry,
  CylinderGeometry,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  Quaternion,
  RingGeometry,
  SphereGeometry,
  TorusGeometry,
  Vector3,
} from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { PALETTE } from '../../core/palette';
import { Rng, TAU } from '../../core/mathUtils';
import { addOutline, decal, softMaterial, solid, toonMaterial } from '../../art/style/materials';
import { ARENA_RADIUS } from './layout';

/**
 * The dodgems rink: a sparkly floor, a striped barrier all the way round and a
 * ring of fairy lights over the top of it.
 *
 * Two art decisions worth keeping if this is ever rebuilt:
 *
 * **The sparkle is geometry, not a texture.** A hundred and forty little cream
 * discs scattered on the floor in one `InstancedMesh` cost a single draw call,
 * twinkle by *scale* (which needs no material churn), and survive being viewed
 * from six metres up — a glitter texture at this camera distance turns into
 * grey noise the moment the phone downsamples it.
 *
 * **The barrier is chunky boxes, not a cylinder with a striped map.** Same
 * reasoning as the fun-fair stalls' awning: at this scale the eye reads the
 * silhouette, and separate blocks with a rounded top rail read as *padded
 * bumper wall* where a painted tube reads as a sticker.
 */

const SPARKLE_COUNT = 140;
const BARRIER_SEGMENTS = 30;
const BULB_COUNT = 24;

const BULB_COLOURS = [PALETTE.fairyWarm, PALETTE.fairyPink, PALETTE.fairyMint, PALETTE.fairyBlue];

export interface Arena {
  readonly root: Group;
  /** Twinkles the floor sparkles and the fairy lights. */
  update(elapsed: number): void;
  dispose(): void;
}

export function createArena(): Arena {
  const root = new Group();
  root.name = 'dodgems:arena';
  const rng = new Rng(0xd0d6e5);

  // --- the floor ------------------------------------------------------------
  // Not toon-shaded: this is a 25-metre slab and the four-band ramp turns big
  // flat surfaces into visible steps. Same call the park's terrain makes.
  const floorMaterial = softMaterial(PALETTE.trampolinePad, 0.42);
  const floor = new Mesh(new CircleGeometry(ARENA_RADIUS + 0.5, 64), floorMaterial);
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  root.add(floor);

  // Two pale rings so the floor has somewhere for the eye to rest and the cars
  // have something to read their speed against.
  const ringMaterial = new MeshBasicMaterial({
    color: PALETTE.buildingFloorAlt,
    transparent: true,
    opacity: 0.28,
    depthWrite: false,
  });
  for (const radius of [ARENA_RADIUS * 0.42, ARENA_RADIUS * 0.78]) {
    const ring = decal(new Mesh(new RingGeometry(radius - 0.16, radius + 0.16, 72), ringMaterial));
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.012;
    root.add(ring);
  }

  // --- sparkles -------------------------------------------------------------
  const sparkleGeometry = new CircleGeometry(0.13, 6);
  const sparkleMaterial = new MeshBasicMaterial({
    color: PALETTE.blossomWhite,
    transparent: true,
    opacity: 0.9,
    depthWrite: false,
    toneMapped: false,
  });
  const sparkles = new InstancedMesh(sparkleGeometry, sparkleMaterial, SPARKLE_COUNT);
  sparkles.frustumCulled = false;
  root.add(sparkles);

  const sparklePoints: { x: number; z: number; phase: number; size: number }[] = [];
  for (let i = 0; i < SPARKLE_COUNT; i += 1) {
    // sqrt keeps them evenly spread rather than crowding the middle.
    const radius = Math.sqrt(rng.unit()) * (ARENA_RADIUS - 0.4);
    const angle = rng.range(0, TAU);
    sparklePoints.push({
      x: Math.cos(angle) * radius,
      z: Math.sin(angle) * radius,
      phase: rng.range(0, TAU),
      size: rng.range(0.55, 1.35),
    });
  }

  const sparkleMatrix = new Matrix4();
  const sparklePosition = new Vector3();
  const sparkleQuaternion = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), -Math.PI / 2);
  const sparkleScale = new Vector3(1, 1, 1);

  // --- barrier --------------------------------------------------------------
  const barrier = new Group();
  root.add(barrier);

  const padA = toonMaterial(PALETTE.markerPink);
  const padB = toonMaterial(PALETTE.buildingWall);
  const railMaterial = toonMaterial(PALETTE.buildingTrim);
  const postMaterial = toonMaterial(PALETTE.woodLight);

  const segmentGeometry = new RoundedBoxGeometry(2.7, 1.05, 0.55, 4, 0.2);
  for (let i = 0; i < BARRIER_SEGMENTS; i += 1) {
    const angle = (i / BARRIER_SEGMENTS) * TAU;
    const pad = solid(new Mesh(segmentGeometry, i % 2 === 0 ? padA : padB));
    pad.position.set(
      Math.cos(angle) * (ARENA_RADIUS + 0.55),
      0.55,
      Math.sin(angle) * (ARENA_RADIUS + 0.55),
    );
    // Tangent, not radius: a Y-rotation maps local +X to (cos φ, -sin φ) in
    // (x, z), so the tangent at θ wants φ = -θ + π/2. Getting this wrong leaves
    // the wall as a ring of blocks all facing the middle, which is exactly what
    // it looked like the first time.
    pad.rotation.y = -angle + Math.PI / 2;
    // Leaned out a few degrees, like a real bumper wall — it also means the
    // camera sees the painted face rather than the top edge.
    pad.rotation.x = 0.08;
    barrier.add(pad);
  }

  const rail = solid(
    new Mesh(new TorusGeometry(ARENA_RADIUS + 0.6, 0.16, 8, 96), railMaterial),
  );
  rail.rotation.x = Math.PI / 2;
  rail.position.y = 1.14;
  barrier.add(rail);
  addOutline(rail, 0.02);

  const kerb = solid(
    new Mesh(new TorusGeometry(ARENA_RADIUS + 0.2, 0.14, 8, 96), toonMaterial(PALETTE.buildingTrimDeep)),
  );
  kerb.rotation.x = Math.PI / 2;
  kerb.position.y = 0.1;
  barrier.add(kerb);

  // --- fairy lights ---------------------------------------------------------
  // Posts around the outside carrying a swagged wire of bulbs. The bulbs are
  // individual meshes sharing four materials, and they twinkle by *scale*: a
  // per-bulb emissive would be a material per bulb, which is how a cheerful
  // little scene quietly becomes forty draw calls.
  const bulbs: { mesh: Mesh; phase: number; base: number }[] = [];
  const bulbMaterials = BULB_COLOURS.map((colour) =>
    toonMaterial(colour, { emissive: colour, emissiveIntensity: 0.9 }),
  );
  const bulbGeometry = new SphereGeometry(0.17, 10, 8);
  const postGeometry = new CylinderGeometry(0.09, 0.12, 3.2, 8);
  const wireGeometry = new TorusGeometry(ARENA_RADIUS + 1.05, 0.035, 5, 96);

  const wire = decal(new Mesh(wireGeometry, new MeshBasicMaterial({ color: PALETTE.woodDark })));
  wire.rotation.x = Math.PI / 2;
  wire.position.y = 3.05;
  root.add(wire);

  for (let i = 0; i < 8; i += 1) {
    const angle = (i / 8) * TAU + 0.2;
    const post = solid(new Mesh(postGeometry, postMaterial));
    post.position.set(
      Math.cos(angle) * (ARENA_RADIUS + 1.05),
      1.6,
      Math.sin(angle) * (ARENA_RADIUS + 1.05),
    );
    root.add(post);

    // A little flag on top of every post, because everything here has one.
    const flag = decal(
      new Mesh(new ConeGeometry(0.22, 0.6, 3), bulbMaterials[i % bulbMaterials.length] ?? padA),
    );
    flag.position.set(post.position.x, 3.5, post.position.z);
    flag.rotation.z = -0.4;
    root.add(flag);
  }

  for (let i = 0; i < BULB_COUNT; i += 1) {
    const angle = (i / BULB_COUNT) * TAU;
    const material = bulbMaterials[i % bulbMaterials.length];
    if (!material) continue;
    const bulb = decal(new Mesh(bulbGeometry, material));
    // The wire sags between posts: three posts' worth of sag per lap.
    const sag = Math.abs(Math.sin(((i / BULB_COUNT) * TAU * 8) / 2)) * 0.22;
    bulb.position.set(
      Math.cos(angle) * (ARENA_RADIUS + 1.05),
      3.05 - sag - 0.14,
      Math.sin(angle) * (ARENA_RADIUS + 1.05),
    );
    root.add(bulb);
    bulbs.push({ mesh: bulb, phase: rng.range(0, TAU), base: 1 });
  }

  // --- beyond the barrier ---------------------------------------------------
  // A ring of grass so the rink is standing somewhere rather than floating in
  // the void, and a low fence of bunting poles to close the picture off.
  const surround = new Mesh(
    new CircleGeometry(ARENA_RADIUS + 26, 48),
    softMaterial(PALETTE.grass, 0.85),
  );
  surround.rotation.x = -Math.PI / 2;
  surround.position.y = -0.06;
  surround.receiveShadow = true;
  root.add(surround);

  // Bushes, mostly green with the odd flowering one — from above, a ring of
  // bright discs reads as spilled confetti rather than as planting.
  const bushMaterials = [
    toonMaterial(PALETTE.leafMid),
    toonMaterial(PALETTE.leafDeep),
    toonMaterial(PALETTE.leafLight),
    toonMaterial(PALETTE.leafBlue),
    toonMaterial(PALETTE.blossomPink),
  ];
  for (let i = 0; i < 26; i += 1) {
    const angle = (i / 26) * TAU + 0.12;
    const radius = ARENA_RADIUS + rng.range(4, 11);
    const material = bushMaterials[i % 5 === 4 ? 4 : rng.int(0, 3)];
    const bush = solid(new Mesh(new SphereGeometry(rng.range(0.9, 1.7), 12, 9), material ?? padA));
    bush.position.set(Math.cos(angle) * radius, 0.35, Math.sin(angle) * radius);
    bush.scale.y = 0.86;
    root.add(bush);
  }

  return {
    root,

    update(elapsed: number): void {
      for (let i = 0; i < sparklePoints.length; i += 1) {
        const point = sparklePoints[i];
        if (!point) continue;
        // A slow shimmer that never fully goes out — the floor should look wet
        // and glittery, not like a field of blinking LEDs.
        const twinkle = 0.45 + 0.55 * (0.5 + 0.5 * Math.sin(elapsed * 2.4 + point.phase));
        sparklePosition.set(point.x, 0.02, point.z);
        sparkleScale.setScalar(point.size * twinkle);
        sparkleMatrix.compose(sparklePosition, sparkleQuaternion, sparkleScale);
        sparkles.setMatrixAt(i, sparkleMatrix);
      }
      sparkles.instanceMatrix.needsUpdate = true;

      for (let i = 0; i < bulbs.length; i += 1) {
        const bulb = bulbs[i];
        if (!bulb) continue;
        bulb.mesh.scale.setScalar(bulb.base * (0.82 + 0.28 * Math.sin(elapsed * 3.1 + bulb.phase)));
      }
    },

    dispose(): void {
      floorMaterial.dispose();
      ringMaterial.dispose();
      sparkleGeometry.dispose();
      sparkleMaterial.dispose();
      sparkles.dispose();
      segmentGeometry.dispose();
      bulbGeometry.dispose();
      postGeometry.dispose();
      wireGeometry.dispose();
      padA.dispose();
      padB.dispose();
      railMaterial.dispose();
      postMaterial.dispose();
      for (const material of bulbMaterials) material.dispose();
      for (const material of bushMaterials) material.dispose();
      root.traverse((object) => {
        const mesh = object as Partial<Mesh>;
        mesh.geometry?.dispose();
      });
    },
  };
}
