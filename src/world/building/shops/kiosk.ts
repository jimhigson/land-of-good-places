import {
  BoxGeometry,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  Quaternion,
  SphereGeometry,
  Vector3,
  type Material,
} from 'three';
import { PALETTE } from '../../../core/palette';
import { cuteSign, interiorMaterial } from '../parts';
import type { ShopUnitDefinition } from '../layout';

/**
 * The shared kiosk shell every shop is fitted out with.
 *
 * One shape, seven skins: a counter in the shop's accent colour, a back wall of
 * shelves to stand the stock on, a stripy awning and a painted name board. Only
 * the colours and the sign change from shop to shop, which is what makes the row
 * of them read as one shopping centre rather than seven unrelated huts.
 *
 * Unit-local space: the origin is the unit's front-centre on its deck, and **+Z
 * points into the room**, so the back wall is behind you at z ≈ 0 and a child
 * stands at z ≈ 2.5.
 *
 * Draw-call discipline (ARCHITECTURE.md, "Rendering notes"): everything here is
 * `receiveShadow` only. Seven kiosks under a shell that already casts a deep
 * shadow across the whole floor plate buys nothing in the shadow pass but pays
 * for it twice over.
 */

/** Where the counter front sits, and where a child stands to be served. */
export const COUNTER_Z = 1.15;
export const COUNTER_TOP_Y = 1.02;

/**
 * One shelf, not three — and this is the single most important number in the
 * kiosk.
 *
 * At a 38° top-down camera an object in front of the shop appears *higher* on
 * screen than one behind it: screen height goes as `0.79·y − 0.62·z` in unit
 * space. The name board hangs off the front of the awning at z ≈ 1, so its
 * bottom edge lands at about the same screen height as something 1.3 m tall on
 * the back wall. Anything taller than that is behind the sign, and a shop whose
 * stock is hidden behind its own sign is not a shop.
 *
 * So: one shelf, the counter top, and nothing over 1.3 m at the back. Both were
 * tried the other way round first, and the toys vanished.
 */
const SHELF_Y = [0.72] as const;
/**
 * Shelf boards sit at this z, just in front of the back panel.
 *
 * Pushed almost back to the wall (the unit origin is 0.5 m off it) on purpose:
 * the shopkeeper has to fit in the gap between the shelving and the counter, and
 * at the original depth their tummy came out through the middle shelf.
 */
export const SHELF_Z = -0.05;
export const SHELF_HALF_WIDTH = 1.55;

function fitting(geometry: BoxGeometry | SphereGeometry, material: Material): Mesh {
  const mesh = new Mesh(geometry, material);
  mesh.castShadow = false;
  mesh.receiveShadow = true;
  return mesh;
}

export interface KioskShell {
  readonly group: Group;
  /** Y of each shelf board's top surface, lowest first. */
  readonly shelfY: readonly number[];
}

/** Builds one kiosk shell into a fresh group, ready to add to the unit anchor. */
export function buildKiosk(unit: ShopUnitDefinition, subtitle: string): KioskShell {
  const group = new Group();
  group.name = `kiosk:${unit.id}`;

  const accent = interiorMaterial(unit.accent, 0.66);
  const cream = interiorMaterial(PALETTE.buildingWall, 0.7);

  // --- counter ------------------------------------------------------------
  const counter = fitting(new BoxGeometry(3.5, 0.95, 0.7), accent);
  counter.position.set(0, 0.475, COUNTER_Z);
  group.add(counter);

  // A pale top plank, overhanging a little. It is the one edge the player's eye
  // follows along the whole row of shops, so it is the same on every one.
  const top = fitting(new BoxGeometry(3.74, 0.12, 0.86), cream);
  top.position.set(0, 0.98, COUNTER_Z);
  group.add(top);

  // --- shelving -----------------------------------------------------------
  const back = fitting(new BoxGeometry(3.4, 1.8, 0.1), cream);
  back.position.set(0, 0.9, SHELF_Z - 0.25);
  group.add(back);

  // Three identical boards and two identical uprights: the only repeated
  // geometry in a kiosk, and therefore the only thing worth instancing.
  const boards = new InstancedMesh(
    new BoxGeometry(SHELF_HALF_WIDTH * 2, 0.09, 0.44),
    interiorMaterial(PALETTE.wood, 0.72),
    SHELF_Y.length,
  );
  boards.castShadow = false;
  boards.receiveShadow = true;
  const matrix = new Matrix4();
  const rotation = new Quaternion();
  const scale = new Vector3(1, 1, 1);
  const position = new Vector3();
  SHELF_Y.forEach((y, index) => {
    position.set(0, y, SHELF_Z);
    matrix.compose(position, rotation, scale);
    boards.setMatrixAt(index, matrix);
  });
  boards.instanceMatrix.needsUpdate = true;
  group.add(boards);

  const uprights = new InstancedMesh(
    new BoxGeometry(0.14, 1.7, 0.5),
    interiorMaterial(PALETTE.woodDark, 0.74),
    2,
  );
  uprights.castShadow = false;
  uprights.receiveShadow = true;
  [-1, 1].forEach((side, index) => {
    position.set(side * (SHELF_HALF_WIDTH + 0.07), 0.85, SHELF_Z);
    matrix.compose(position, rotation, scale);
    uprights.setMatrixAt(index, matrix);
  });
  uprights.instanceMatrix.needsUpdate = true;
  group.add(uprights);

  // --- awning -------------------------------------------------------------
  // Shallow and high: a deep awning looks lovely from the ground and hides the
  // sign completely from a camera looking down at 38°.
  const awning = fitting(new BoxGeometry(4.8, 0.26, 0.95), accent);
  awning.position.set(0, 2.86, 0.42);
  awning.rotation.x = -0.16;
  group.add(awning);

  // Scalloped valance: seven half-spheres along the awning's lip, instanced.
  const scallops = 7;
  const valance = new InstancedMesh(
    new SphereGeometry(0.24, 12, 8),
    interiorMaterial(PALETTE.blossomWhite, 0.7),
    scallops,
  );
  valance.castShadow = false;
  valance.receiveShadow = true;
  const scallopScale = new Vector3(1, 0.8, 0.5);
  for (let i = 0; i < scallops; i += 1) {
    const t = scallops > 1 ? i / (scallops - 1) : 0.5;
    position.set(-2.1 + t * 4.2, 2.74, 0.86);
    matrix.compose(position, rotation, scallopScale);
    valance.setMatrixAt(i, matrix);
  }
  valance.instanceMatrix.needsUpdate = true;
  group.add(valance);

  // --- name board ---------------------------------------------------------
  const sign = cuteSign({
    title: unit.title,
    subtitle,
    glyph: unit.glyph,
    accent: unit.accent,
    // Narrow. The board hangs in the middle of the shop front and the camera
    // looks in at 45°, so every centimetre of width is a centimetre of shelf it
    // covers up diagonally.
    width: 1.6,
  });
  // Hung off the front of the awning: high enough that its bottom edge clears
  // the stock on screen (see the note on SHELF_Y), low enough that its top edge
  // clears the ceiling slab 3.3 m up.
  sign.position.set(0, 2.8, 0.98);
  // Tipped back a little so it points at the isometric camera rather than at
  // the opposite wall.
  sign.rotation.x = -0.24;
  group.add(sign);

  return { group, shelfY: SHELF_Y };
}
