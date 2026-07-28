import {
  BoxGeometry,
  CircleGeometry,
  ConeGeometry,
  CylinderGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  RingGeometry,
  SphereGeometry,
  TorusGeometry,
  Vector3,
} from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { PALETTE } from '../../core/palette';
import { Rng, TAU } from '../../core/mathUtils';
import { addOutline, decal, softMaterial, solid, toonMaterial } from '../../art/style/materials';
import { ANCHORS_BY_ID } from '../../world/anchors';
import { terrainHeight } from '../../world/terrain';
import type { AnchorPlots } from '../../world/AnchorPlots';
import type { CollisionWorld } from '../../world/Collision';
import type { FrameContext, GameSystem } from '../../core/types';
import { createCar } from './car';

/**
 * The dodgems as they stand **in the park**: the ride you walk up to, before
 * you climb in and the world swaps for the rink's own.
 *
 * This is the outside of the same building the mini-game is the inside of, so
 * it is built from the same parts — striped bumper wall, fairy lights on posts,
 * a lilac glitter floor and, unmistakably from right across the garden, the
 * fake wooden tree standing in the middle of it. A child should be able to see
 * the tree from the fountain and want to go and hit it.
 *
 * Everything is authored around `(0, 0, 0)`, because the anchor group already
 * sits at the plot centre with its origin on the ground
 * (ARCHITECTURE.md, "Dropping a build into an anchor plot").
 */

/** Radius of the rink as it appears in the park. Fits the plot's 12 × 10 footprint. */
const RINK_RADIUS = 8.4;
/** Half-width of the gap in the barrier where the entrance is, in radians. */
const GAP_HALF_ANGLE = 0.34;
const BARRIER_SEGMENTS = 26;

const BULB_COLOURS = [PALETTE.fairyWarm, PALETTE.fairyPink, PALETTE.fairyMint, PALETTE.fairyBlue];

export interface DodgemsPlot extends GameSystem {
  dispose(): void;
}

/**
 * Builds the ride into the `dodgems` anchor plot and retires its "coming soon"
 * dressing.
 *
 * Returns a small system: the only thing that moves is the fairy lights, and
 * they twinkle on `elapsed` like the rest of the park's lighting.
 */
export function buildDodgemsPlot(
  anchorPlots: AnchorPlots,
  collision: CollisionWorld,
): DodgemsPlot {
  const anchor = ANCHORS_BY_ID.dodgems;
  const [centreX, centreZ] = anchor.position;
  const ground = terrainHeight(centreX, centreZ);

  const plot = anchorPlots.getGroup('dodgems');
  const root = new Group();
  root.name = 'dodgems:ride';
  plot.add(root);
  anchorPlots.setPlaceholderVisible('dodgems', false);

  const rng = new Rng(0xd0d6b1);

  // Which way the entrance faces, in plot-local space.
  const [entranceX, entranceZ] = anchor.entrance;
  const gapAngle = Math.atan2(entranceZ - centreZ, entranceX - centreX);

  // --- the floor ------------------------------------------------------------
  // Lifted a hand's width off the grass and given a kerb, which hides the fact
  // that the ground under a seventeen-metre disc is not actually flat.
  const deck = 0.16;
  const floorMaterial = softMaterial(PALETTE.trampolinePad, 0.42);
  const floor = new Mesh(new CircleGeometry(RINK_RADIUS, 56), floorMaterial);
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = deck;
  floor.receiveShadow = true;
  root.add(floor);

  const skirt = solid(
    new Mesh(new CylinderGeometry(RINK_RADIUS, RINK_RADIUS + 0.25, deck + 0.5, 56, 1, true), toonMaterial(PALETTE.buildingTrimDeep)),
  );
  skirt.position.y = deck - 0.25;
  root.add(skirt);

  const glitterMaterial = new MeshBasicMaterial({
    color: PALETTE.blossomWhite,
    transparent: true,
    opacity: 0.75,
    depthWrite: false,
    toneMapped: false,
  });
  const glitterGeometry = new CircleGeometry(0.11, 6);
  for (let i = 0; i < 54; i += 1) {
    const radius = Math.sqrt(rng.unit()) * (RINK_RADIUS - 0.5);
    const angle = rng.range(0, TAU);
    const fleck = decal(new Mesh(glitterGeometry, glitterMaterial));
    fleck.rotation.x = -Math.PI / 2;
    fleck.position.set(Math.cos(angle) * radius, deck + 0.01, Math.sin(angle) * radius);
    root.add(fleck);
  }

  const ringMaterial = new MeshBasicMaterial({
    color: PALETTE.buildingFloorAlt,
    transparent: true,
    opacity: 0.3,
    depthWrite: false,
  });
  const ring = decal(new Mesh(new RingGeometry(RINK_RADIUS * 0.56, RINK_RADIUS * 0.62, 56), ringMaterial));
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = deck + 0.012;
  root.add(ring);

  // --- the barrier ----------------------------------------------------------
  const padA = toonMaterial(PALETTE.markerPink);
  const padB = toonMaterial(PALETTE.buildingWall);
  const railMaterial = toonMaterial(PALETTE.buildingTrim);
  const woodMaterial = toonMaterial(PALETTE.woodLight);

  const segmentGeometry = new RoundedBoxGeometry(2.05, 0.95, 0.5, 4, 0.18);
  for (let i = 0; i < BARRIER_SEGMENTS; i += 1) {
    const angle = (i / BARRIER_SEGMENTS) * TAU;
    // Leave the doorway open.
    if (Math.abs(shortestAngle(angle - gapAngle)) < GAP_HALF_ANGLE) continue;

    const x = Math.cos(angle) * (RINK_RADIUS + 0.4);
    const z = Math.sin(angle) * (RINK_RADIUS + 0.4);
    const pad = solid(new Mesh(segmentGeometry, i % 2 === 0 ? padA : padB));
    pad.position.set(x, deck + 0.5, z);
    pad.rotation.y = -angle + Math.PI / 2; // tangent to the ring, not radial
    root.add(pad);

    // Solid: a child should bounce off the outside of the ride, not walk
    // through the bumper wall. Collision is in WORLD space, not plot-local.
    const half = 1.05;
    const tx = -Math.sin(angle) * half;
    const tz = Math.cos(angle) * half;
    collision.addWall(
      centreX + x - tx,
      centreZ + z - tz,
      centreX + x + tx,
      centreZ + z + tz,
      0.32,
    );
  }

  // --- posts, lights and flags ---------------------------------------------
  const bulbMaterials = BULB_COLOURS.map((colour) =>
    toonMaterial(colour, { emissive: colour, emissiveIntensity: 0.85 }),
  );
  const bulbGeometry = new SphereGeometry(0.16, 10, 8);
  const postGeometry = new CylinderGeometry(0.11, 0.14, 3.4, 8);
  const bulbs: Mesh[] = [];

  for (let i = 0; i < 8; i += 1) {
    const angle = (i / 8) * TAU + 0.4;
    if (Math.abs(shortestAngle(angle - gapAngle)) < GAP_HALF_ANGLE) continue;
    const x = Math.cos(angle) * (RINK_RADIUS + 0.9);
    const z = Math.sin(angle) * (RINK_RADIUS + 0.9);
    const post = solid(new Mesh(postGeometry, woodMaterial));
    post.position.set(x, 1.7, z);
    root.add(post);

    const flag = decal(new Mesh(new ConeGeometry(0.24, 0.62, 3), bulbMaterials[i % 4] ?? padA));
    flag.position.set(x, 3.6, z);
    flag.rotation.z = -0.42;
    root.add(flag);
  }

  const wire = decal(
    new Mesh(new TorusGeometry(RINK_RADIUS + 0.9, 0.035, 5, 72), new MeshBasicMaterial({ color: PALETTE.woodDark })),
  );
  wire.rotation.x = Math.PI / 2;
  wire.position.y = 3.3;
  root.add(wire);

  for (let i = 0; i < 22; i += 1) {
    const angle = (i / 22) * TAU;
    const material = bulbMaterials[i % bulbMaterials.length];
    if (!material) continue;
    const bulb = decal(new Mesh(bulbGeometry, material));
    bulb.position.set(
      Math.cos(angle) * (RINK_RADIUS + 0.9),
      3.16,
      Math.sin(angle) * (RINK_RADIUS + 0.9),
    );
    root.add(bulb);
    bulbs.push(bulb);
  }

  const railRing = solid(
    new Mesh(new TorusGeometry(RINK_RADIUS + 0.45, 0.14, 8, 72), railMaterial),
  );
  railRing.rotation.x = Math.PI / 2;
  railRing.position.y = deck + 1.0;
  root.add(railRing);

  // --- the entrance arch ------------------------------------------------------
  // This began life as the "coming soon" board's replacement and is now an arch
  // rather than a sign: two posts, a plain wooden lintel, a string of fairground
  // bulbs along the top and a cone on the peak. The painted face that used to
  // name the ride is gone with every other sign in the park (family ruling, 28
  // July 2026); the lintel stays because it is what the bulbs and the topper sit
  // on and what makes the two posts read as a gateway. `signYaw` stays too — an
  // arch you walk *through* still wants to be square to the one camera angle.
  const signGroup = new Group();
  signGroup.position.set(
    entranceX - centreX,
    terrainHeight(entranceX, entranceZ) - ground,
    entranceZ - centreZ,
  );
  signGroup.rotation.y = anchor.signYaw;
  root.add(signGroup);

  // 1.9 m out, not 1.35: the nav lattice fattens each post by the walker
  // radius, and at 1.35 the gap between the arch's posts inflated shut —
  // 0.76 m of walkable slot that pocketed the whole doorway behind it.
  const signPostGeometry = new CylinderGeometry(0.14, 0.16, 2.6, 8);
  for (const offset of [-1.9, 1.9]) {
    const post = solid(new Mesh(signPostGeometry, toonMaterial(PALETTE.wood)));
    post.position.set(offset, 1.3, 0);
    signGroup.add(post);
    collision.addCircle(
      entranceX + Math.cos(anchor.signYaw) * offset,
      entranceZ - Math.sin(anchor.signYaw) * offset,
      0.35,
    );
  }

  const board = solid(
    new Mesh(new BoxGeometry(4.4, 1.9, 0.16), toonMaterial(PALETTE.woodLight)),
  );
  board.position.y = 2.6;
  signGroup.add(board);
  addOutline(board, 0.02);

  // Bulbs along the lintel, like a real fairground arch.
  for (let i = 0; i < 10; i += 1) {
    const t = i / 9;
    const bulb = decal(new Mesh(bulbGeometry, bulbMaterials[i % 4] ?? padA));
    bulb.position.set(-1.5 + t * 3, 3.62, 0.06);
    signGroup.add(bulb);
    bulbs.push(bulb);
  }

  const topper = decal(new Mesh(new ConeGeometry(0.3, 0.7, 5), toonMaterial(PALETTE.markerLemon)));
  topper.position.set(0, 3.95, 0);
  signGroup.add(topper);

  // --- the fake wooden tree -------------------------------------------------
  const tree = buildStaticTree(rng);
  tree.position.y = deck;
  root.add(tree);
  collision.addCircle(centreX, centreZ, 1.9);

  // --- a parked car ---------------------------------------------------------
  // RiPika is already sitting in one, waiting. It is the single strongest hint
  // that the thing in the middle of the garden is a ride you can get into.
  const parked = createCar({ body: PALETTE.markerLemon, driver: { kind: 'ripika' } });
  parked.root.position.set(
    Math.cos(gapAngle + 1.1) * 4.6,
    deck,
    Math.sin(gapAngle + 1.1) * 4.6,
  );
  parked.root.rotation.y = -gapAngle + 0.6;
  root.add(parked.root);
  collision.addCircle(
    centreX + parked.root.position.x,
    centreZ + parked.root.position.z,
    1.1,
  );

  return {
    name: 'dodgemsPlot',

    update({ elapsed }: FrameContext): void {
      // The one moving part in the park: the lights round the ride, twinkling
      // the same way the rink's own do.
      for (let i = 0; i < bulbs.length; i += 1) {
        const bulb = bulbs[i];
        if (!bulb) continue;
        bulb.scale.setScalar(0.82 + 0.3 * Math.sin(elapsed * 3 + i * 0.7));
      }
    },

    dispose(): void {
      parked.dispose();
      floorMaterial.dispose();
      glitterMaterial.dispose();
      glitterGeometry.dispose();
      ringMaterial.dispose();
      segmentGeometry.dispose();
      bulbGeometry.dispose();
      postGeometry.dispose();
      signPostGeometry.dispose();
      padA.dispose();
      padB.dispose();
      railMaterial.dispose();
      woodMaterial.dispose();
      for (const material of bulbMaterials) material.dispose();
      root.traverse((object) => {
        const mesh = object as Partial<Mesh>;
        mesh.geometry?.dispose();
      });
    },
  };
}

/**
 * The park-side wooden tree: the same silhouette as the one in the rink, minus
 * everything that moves.
 *
 * Kept separate from `tree.ts` on purpose — the rink's tree carries an apple
 * pool, a leaf system and a bird, and none of that should be sitting in the
 * park's scene graph being updated every frame for a prop nobody can hit.
 */
function buildStaticTree(rng: Rng): Group {
  const tree = new Group();
  tree.name = 'dodgems:fakeTree';

  const barkMaterial = toonMaterial(PALETTE.wood);
  const barkDarkMaterial = toonMaterial(PALETTE.woodDark);
  const leafMaterial = toonMaterial(PALETTE.leafMid);
  const leafLightMaterial = toonMaterial(PALETTE.leafLight);
  const appleMaterial = toonMaterial(PALETTE.flowerRed);

  const plinth = solid(
    new Mesh(new CylinderGeometry(1.75, 1.95, 0.4, 20), toonMaterial(PALETTE.markerLemon)),
  );
  plinth.position.y = 0.2;
  tree.add(plinth);
  addOutline(plinth, 0.026);

  const trunk = solid(new Mesh(new CylinderGeometry(0.6, 0.8, 3.0, 12), barkMaterial));
  trunk.position.y = 1.9;
  tree.add(trunk);
  addOutline(trunk, 0.026);

  for (let i = 0; i < 4; i += 1) {
    const angle = (i / 4) * TAU + 0.4;
    const plank = decal(new Mesh(new RoundedBoxGeometry(0.16, 2.8, 0.1, 3, 0.04), barkDarkMaterial));
    plank.position.set(Math.cos(angle) * 0.66, 1.9, Math.sin(angle) * 0.66);
    plank.lookAt(new Vector3(Math.cos(angle) * 4, 1.9, Math.sin(angle) * 4));
    tree.add(plank);
  }

  const canopy = new Group();
  canopy.position.y = 3.4;
  tree.add(canopy);

  const blobs: [number, number, number, number][] = [
    [0, 0.5, 0, 1.7],
    [-1.2, 0, 0.3, 1.15],
    [1.15, 0.1, -0.3, 1.25],
    [0.3, -0.1, 1.15, 1.0],
    [-0.4, 0.1, -1.2, 1.05],
  ];
  blobs.forEach(([x, y, z, radius], index) => {
    const blob = solid(
      new Mesh(new SphereGeometry(radius, 16, 12), index % 2 === 0 ? leafMaterial : leafLightMaterial),
    );
    blob.position.set(x, y, z);
    blob.scale.y = 0.88;
    canopy.add(blob);
    if (index < 2) addOutline(blob, 0.03);
  });

  const appleGeometry = new SphereGeometry(0.24, 12, 9);
  for (let i = 0; i < 6; i += 1) {
    const angle = (i / 6) * TAU + 0.4;
    const radius = rng.range(1.1, 1.6);
    const apple = solid(new Mesh(appleGeometry, appleMaterial));
    apple.position.set(Math.cos(angle) * radius, rng.range(-0.3, 0.5), Math.sin(angle) * radius);
    canopy.add(apple);
  }

  return tree;
}

/** Wraps an angle difference into (-π, π]. */
function shortestAngle(delta: number): number {
  let d = delta % TAU;
  if (d > Math.PI) d -= TAU;
  if (d < -Math.PI) d += TAU;
  return d;
}
