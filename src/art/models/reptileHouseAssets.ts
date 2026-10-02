import { Group, Mesh, MeshToonMaterial } from 'three';
import { PALETTE } from '../../core/palette';
import { ART } from '../style/artPalette';
import { REPTILE_HOUSE_GLB_BASE64 } from '../assets/reptileHouseGlb';
import type { AssetHandle } from '../style/asset';
import { visibleTop } from '../style/measure';
import {
  REPTILE_ARCH_HEIGHT,
  REPTILE_ARCH_WIDTH,
  REPTILE_BOUNDING_RADIUS,
  REPTILE_SHELL_RADIUS,
} from '../../world/reptileHouse/layout';
import { assertMeasured, loadReptileKit, partBox, partRadiusXZ, partReachXZ, type PartStyle } from './reptileKit';
import { TALLEST_CHILD_HEIGHT } from './kid';
import type { BufferAttribute } from 'three';
import { sunnyFaceTextures, type SnakeExpression } from './snakeFace';

/**
 * **"Sunny, the snake who is the building"** — the Reptile House's exterior
 * (`docs/design/REPTILE-HOUSE.md` §2, ASSET GROUPS 1): a mint snake coiled
 * round a cream greenhouse, **her head on the ground in front of the door
 * with her mouth open — the mouth is the door** (Jim, 2 October 2026: *"Why
 * beside the door and not the door as its mouth? That sounds cooler so do
 * that."*), her tail curling down beside it as the signpost. GAME_DESIGN.md's
 * novelty architecture rule taken literally — *the building is the thing it
 * holds*.
 *
 * `art/blend/reptile_house_build.py` → `reptileHouse.glb` → here. Shape only in
 * the file; every colour is in {@link STYLES}, which
 * `art/blend/reptile_house_render.py` reads back for the review renders.
 *
 * Origin on the ground at the building's centre, **door and head facing
 * +Z**. Two nodes carry UVs: `rh-head` wears Sunny's own face (`snakeFace.ts`
 * — eyes and blush only, the mouth being a bore through the mesh lined by
 * `rh-mouth`) and `rh-sign` the anchor sign. `rh-tongue` is the doormat
 * itself, lolling out of the mouth onto the paving, and the one node with a
 * transform — a pure translation to its root on the mouth's floor — so a wag
 * is a yaw on the node.
 */
const STYLES: Readonly<Record<string, PartStyle>> = {
  'rh-plinth': { colour: PALETTE.stonePink, outline: 0.02 },
  'rh-coil': { colour: ART.snakeMint, outline: 0.03 },
  'rh-coil-belly': { colour: ART.snakeBelly },
  'rh-coil-spots': { colour: PALETTE.markerLilac },
  'rh-house-wall': { colour: PALETTE.buildingWall, outline: 0.02 },
  'rh-windows': { colour: PALETTE.buildingWindowWarm, flat: true },
  'rh-head': { colour: ART.snakeMint, outline: 0.03 },
  'rh-mouth': { colour: PALETTE.blossomPink, outline: 0.02 },
  'rh-tongue': { colour: PALETTE.markerPink, outline: 0.016 },
  'rh-tail': { colour: ART.snakeMint, outline: 0.024 },
  'rh-tail-bell': { colour: PALETTE.flowerYellow, outline: 0.012 },
  'rh-sign': { colour: PALETTE.signBoard },
};

let kit: ReturnType<typeof loadReptileKit> | null = null;

function houseKit(): ReturnType<typeof loadReptileKit> {
  if (!kit) {
    kit = loadReptileKit('reptileHouse.glb', REPTILE_HOUSE_GLB_BASE64, STYLES);
    // **The shipped mesh is held to the game's own numbers at load**, the way
    // `gateArch.ts` holds the arch to its gateway: the collision ring is a
    // 16-gon at `REPTILE_SHELL_RADIUS`, and a plinth built to anything else
    // is a plinth a child can stand inside of, or be stopped a metre short of.
    assertMeasured('reptileHouse.glb', 'the plinth circumradius', partRadiusXZ(kit.part('rh-plinth')), REPTILE_SHELL_RADIUS, 0.01);
    // The mouth's clear bore is `REPTILE_ARCH_WIDTH × REPTILE_ARCH_HEIGHT`
    // above the plinth top; the bounding box can only see the outside of the
    // lining, so what is held here is that the lining is at least big enough
    // to hold that opening — a smaller mouth would be a doorway the band and
    // the jambs are wider than. The build script measures the bore itself.
    const mouth = partBox(kit.part('rh-mouth'));
    const plinthTop = partBox(kit.part('rh-plinth')).maxY;
    if (mouth.maxX - mouth.minX < REPTILE_ARCH_WIDTH || mouth.maxY - plinthTop < REPTILE_ARCH_HEIGHT) {
      throw new Error(
        `reptileHouse.glb: the mouth measures ${(mouth.maxX - mouth.minX).toFixed(2)} × ` +
          `${(mouth.maxY - plinthTop).toFixed(2)} m outside, smaller than the ${REPTILE_ARCH_WIDTH} × ` +
          `${REPTILE_ARCH_HEIGHT} m opening layout.ts promises.`,
      );
    }
    for (const name of kit.names) {
      const reach = partReachXZ(kit.part(name));
      if (reach > REPTILE_BOUNDING_RADIUS + 0.05) {
        throw new Error(
          `reptileHouse.glb: '${name}' reaches ${reach.toFixed(2)} m from the centre, past ` +
            `REPTILE_BOUNDING_RADIUS ${REPTILE_BOUNDING_RADIUS} — the plot the placement agents reserve would not hold it.`,
        );
      }
    }
  }
  return kit;
}

export interface ReptileHouseExterior extends AssetHandle {
  /** The head, pivoted about its own centre — tilt it a few hundredths for the tickle; it is the door. */
  readonly head: Group;
  /** The tongue — the doormat — pivoted at its root on the mouth's floor; yaw it for a wag. */
  readonly tongue: Mesh;
  /** The tail and its bell — the signpost by the door. */
  readonly tail: Group;
  /** The plank the anchor sign is painted on (planar UVs authored the gate arch's way; dress it from the hall's `SignAtlas`, which flips the canvas via `planarUvCanvasTexture`). */
  readonly sign: Mesh;
  /** The twelve porthole panes, lit after dark. */
  readonly windows: Mesh;
  setFace(expression: SnakeExpression): void;
  /** 0 by day, 1 at full night: the portholes glow and Sunny falls asleep. */
  setNight(night: number): void;
}

/**
 * **Everything of the dressing that stands low enough to meet a child,
 * outside the collision ring, as discs** — derived from the mesh, never
 * typed. The head lies in front of the plinth with the door through it, the
 * tail curls down beside it and the sign hangs from the tail at head height;
 * all are outside the 16-gon, so the ring does not cover them. Every vertex
 * between the ground and `TALLEST_CHILD_HEIGHT` and outside the shell is
 * bucketed into half-metre cells, and each occupied cell becomes a disc a
 * little wider than its own diagonal — **except inside the doorway strip**,
 * `|across| < bore`, which is the mouth's bore and lips: the jambs
 * `shell.ts` registers own that strip, flush with the bore, and a disc there
 * would be a disc in the doorway. The facade march in `check:reptile-house`
 * is what says whether that cover is complete.
 */
export function reptileHouseLowDiscs(bore: number): { x: number; z: number; radius: number }[] {
  const parts = houseKit();
  const cell = 0.5;
  const cells = new Map<string, { x: number; z: number }>();
  for (const name of ['rh-head', 'rh-mouth', 'rh-tail', 'rh-sign', 'rh-tail-bell']) {
    const part = parts.part(name);
    const position = part.geometry.getAttribute('position') as BufferAttribute;
    for (let i = 0; i < position.count; i += 1) {
      const x = position.getX(i) + part.position.x;
      const y = position.getY(i) + part.position.y;
      const z = position.getZ(i) + part.position.z;
      if (y > TALLEST_CHILD_HEIGHT || y < 0) continue;
      if (Math.hypot(x, z) < REPTILE_SHELL_RADIUS - 0.3) continue;
      if (Math.abs(x) < bore && z > 0) continue;
      const key = `${Math.floor(x / cell)},${Math.floor(z / cell)}`;
      if (!cells.has(key)) cells.set(key, { x: (Math.floor(x / cell) + 0.5) * cell, z: (Math.floor(z / cell) + 0.5) * cell });
    }
  }
  // A cell straddling the strip's edge has its disc's inner rim in the
  // doorway: pull those centres out so the disc stops at the strip.
  return [...cells.values()].map((centre) => {
    const radius = cell * 0.8;
    const x = centre.z > 0 && Math.abs(centre.x) < bore + radius ? Math.sign(centre.x) * (bore + radius) : centre.x;
    return { x, z: centre.z, radius };
  });
}

/**
 * How far out along the door bearing the mouth's lips reach at walking
 * height, measured off the lining — where the jambs' colliders end, so no
 * invisible jamb runs on past the lips onto the paving (the solidity review's
 * finding on the first cut's 1.6 m of bare jamb, 2 October 2026).
 */
export function reptileHouseLipsReach(): number {
  const part = houseKit().part('rh-mouth');
  const position = part.geometry.getAttribute('position') as BufferAttribute;
  let reach = 0;
  for (let i = 0; i < position.count; i += 1) {
    if (position.getY(i) > TALLEST_CHILD_HEIGHT || position.getY(i) < 0) continue;
    reach = Math.max(reach, position.getZ(i) + part.position.z);
  }
  return reach;
}

/** How thick the lips are round the bore: the lining's outer edge over the bore's top. */
export function reptileHouseLipThickness(): number {
  const mouth = partBox(houseKit().part('rh-mouth'));
  return mouth.maxY - (reptileHousePlinthTop() + REPTILE_ARCH_HEIGHT);
}

/** Where the head's centre sits, in building-local metres — measured off the mesh. */
export function reptileHouseHeadCentre(): { x: number; y: number; z: number } {
  const box = partBox(houseKit().part('rh-head'));
  return { x: (box.minX + box.maxX) / 2, y: (box.minY + box.maxY) / 2, z: (box.minZ + box.maxZ) / 2 };
}

/** The plinth's top — the step she walks up onto through the arch. */
export function reptileHousePlinthTop(): number {
  return partBox(houseKit().part('rh-plinth')).maxY;
}

/** The sign plank's centre, in building-local metres. */
export function reptileHouseSignCentre(): { x: number; y: number; z: number } {
  const box = partBox(houseKit().part('rh-sign'));
  return { x: (box.minX + box.maxX) / 2, y: (box.minY + box.maxY) / 2, z: (box.minZ + box.maxZ) / 2 };
}

export function createReptileHouseExterior(): ReptileHouseExterior {
  const parts = houseKit();
  const root = new Group();
  root.name = 'reptileHouse.exterior';

  for (const name of ['rh-plinth', 'rh-coil', 'rh-coil-belly', 'rh-coil-spots', 'rh-house-wall']) {
    root.add(parts.mesh(name));
  }

  const windows = parts.mesh('rh-windows');
  root.add(windows);

  // The head pivots about its own centre so a sway reads as a head turning,
  // not as a head orbiting the roof: the mesh is moved back by the centre and
  // the group forward by it.
  const centre = reptileHouseHeadCentre();
  const head = new Group();
  head.name = 'rh-head-pivot';
  head.position.set(centre.x, centre.y, centre.z);
  const headMesh = parts.mesh('rh-head');
  headMesh.position.set(-centre.x, -centre.y, -centre.z);
  const faces = sunnyFaceTextures();
  const headMaterial = headMesh.material as MeshToonMaterial;
  headMaterial.map = faces.neutral;
  headMaterial.needsUpdate = true;
  head.add(headMesh);
  // The mouth's lining tilts with the head — it is the head's own flesh.
  const mouth = parts.mesh('rh-mouth');
  mouth.position.add(headMesh.position);
  head.add(mouth);
  root.add(head);
  // The tongue lies on the ground and the paving: under the root, not the
  // head, so a head-tilt never lifts the doormat. Its node origin is its root.
  const tongue = parts.mesh('rh-tongue');
  root.add(tongue);

  const tail = new Group();
  tail.name = 'rh-tail-group';
  tail.add(parts.mesh('rh-tail'), parts.mesh('rh-tail-bell'));
  root.add(tail);

  const sign = parts.mesh('rh-sign');
  root.add(sign);

  const windowMaterial = windows.material as MeshToonMaterial;
  windowMaterial.emissive.setHex(PALETTE.buildingWindowWarm);
  windowMaterial.emissiveIntensity = 0;

  let night = 0;
  let asked: SnakeExpression = 'neutral';
  const apply = (): void => {
    headMaterial.map = faces[night > 0.6 ? 'asleep' : asked];
    headMaterial.needsUpdate = true;
  };

  return {
    root,
    height: visibleTop(root),
    head,
    tongue,
    tail,
    sign,
    windows,
    setFace(expression) {
      asked = expression;
      apply();
    },
    setNight(value) {
      night = value;
      windowMaterial.emissiveIntensity = value * 1.1;
      apply();
    },
  };
}
