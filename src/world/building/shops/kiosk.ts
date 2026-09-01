import {
  BoxGeometry,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  Quaternion,
  Vector3,
  type Material,
} from 'three';
import { PALETTE } from '../../../core/palette';
import { interiorMaterial } from '../parts';
import type { ShopUnitDefinition } from '../layout';
import {
  BACK_PANEL_HEIGHT,
  BACK_PANEL_THICKNESS,
  BACK_PANEL_Z,
  COUNTER_HALF_WIDTH,
  COUNTER_Z,
  SHELF_HALF_WIDTH,
  SHELF_Z,
  buildStallDress,
} from './stallShape';

/**
 * Re-exported so `fitouts.ts` keeps taking the counter top and the shelf line
 * from the module that builds them. They are *defined* in `stallShape.ts`,
 * which this file calls into — the arrow only points one way, so the constants
 * have to live at the far end of it.
 */
export { COUNTER_TOP_Y, COUNTER_Z, SHELF_HALF_WIDTH, SHELF_Z } from './stallShape';

/**
 * The part of a market stall that every stall has.
 *
 * A counter in the shop's accent colour with a pale top plank, and a back wall
 * of shelves to stand the stock on. That is the family resemblance, and it is
 * built here, once, for all seven.
 *
 * **What makes each stall different is in `stallShape.ts`** — its skirt, its
 * legs, the shape of its canopy and the giant piece of its own stock standing
 * on top of it. Until #444 there was no such file: the awning and the valance
 * were built here too, identically, and the seven stalls differed only by an
 * accent colour. Jim's verdict on that was *"they were better before"*, and he
 * was right — see that file's own note for what went missing and when.
 *
 * The split is the point. Shared things live here so seven very different roofs
 * still sit on one recognisable shop; different things live there so a child
 * can pick her stall out from the end of the aisle.
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

function fitting(geometry: BoxGeometry, material: Material): Mesh {
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
export function buildKiosk(unit: ShopUnitDefinition): KioskShell {
  const group = new Group();
  group.name = `kiosk:${unit.id}`;

  const accent = interiorMaterial(unit.accent, 0.66);
  const cream = interiorMaterial(PALETTE.buildingWall, 0.7);

  // --- counter ------------------------------------------------------------
  const counter = fitting(new BoxGeometry(COUNTER_HALF_WIDTH * 2, 0.95, 0.7), accent);
  counter.position.set(0, 0.475, COUNTER_Z);
  group.add(counter);

  // A pale top plank, overhanging a little. It is the one edge the player's eye
  // follows along the whole row of shops, so it is the same on every one.
  const top = fitting(new BoxGeometry(COUNTER_HALF_WIDTH * 2 + 0.24, 0.12, 0.86), cream);
  top.position.set(0, 0.98, COUNTER_Z);
  group.add(top);

  // --- shelving -----------------------------------------------------------
  // 1.5 m, not the 1.8 it was: the canopies now have something standing on
  // them (see `stallShape.ts`), and the 30 cm this gives back is 30 cm of
  // emblem. Nothing stands higher than 1.3 m on these shelves anyway — see the
  // note on `SHELF_Y` — so the top of the old panel was holding up nothing but
  // the roof it forced upwards.
  const back = fitting(
    new BoxGeometry(COUNTER_HALF_WIDTH * 2, BACK_PANEL_HEIGHT, BACK_PANEL_THICKNESS),
    cream,
  );
  back.position.set(0, BACK_PANEL_HEIGHT / 2, BACK_PANEL_Z);
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
    new BoxGeometry(0.14, 1.45, 0.5),
    interiorMaterial(PALETTE.woodDark, 0.74),
    2,
  );
  uprights.castShadow = false;
  uprights.receiveShadow = true;
  [-1, 1].forEach((side, index) => {
    position.set(side * (SHELF_HALF_WIDTH + 0.07), 0.725, SHELF_Z);
    matrix.compose(position, rotation, scale);
    uprights.setMatrixAt(index, matrix);
  });
  uprights.instanceMatrix.needsUpdate = true;
  group.add(uprights);

  // --- what makes this stall itself ---------------------------------------
  // Skirt, legs, canopy and the giant piece of its own stock on top. There used
  // to be one awning and one scalloped valance built right here, the same on
  // all seven; that is what #444 replaced.
  group.add(buildStallDress(unit));

  // The hanging name board is gone (family ruling, 28 July 2026: signs in the
  // world are hard to read). The shop's name and its line of patter travel on
  // its `shop-<id>` interact zone instead — see `building/interactZones.ts` —
  // which also gives the stock back the shelf-width the board used to cover.

  return { group, shelfY: SHELF_Y };
}
