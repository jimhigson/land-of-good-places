import {
  BoxGeometry,
  CylinderGeometry,
  Group,
  Mesh,
  SphereGeometry,
  TorusGeometry,
} from 'three';
import { PALETTE } from '../../core/palette';
import { playFlush, playHandwash } from '../../ui/chime';
import { castAndReceive, cuteSign, interiorMaterial, softMaterial } from './parts';
import {
  TOILET_BASIN_X,
  TOILET_BASIN_Z,
  TOILET_DECK,
  TOILET_PAN_X,
  TOILET_PAN_Z,
  TOILET_ROOM,
  TOILET_STAND_X,
  TOILET_STAND_Z,
} from './layout';

/**
 * The cute toilets, on deck one.
 *
 * Straight out of the design document: *"The building has cute toilets. When you
 * use one, a flushing sound plays, then a tap/faucet sound as you wash your
 * hands at the basin. (Good manners are part of the game!)"* — so using one is a
 * little two-beat scripted routine rather than a single sound effect. The lid
 * flips up, the pan swirls and flushes, then the tap runs while you wash.
 *
 * The sounds are synthesised inline in `ui/chime.ts`, the same way the shop
 * chime is: no assets, no audio system, and nothing for the real sound designer
 * to unpick at build step 9.
 *
 * Nothing here registers collision. Collision in this game is height-blind, so a
 * cubicle wall on deck one would be an invisible cubicle wall on all five decks;
 * the little room is open-fronted geometry you walk into and out of freely.
 */

/** Seconds: flush, then a beat, then the tap, then everything settles. */
const FLUSH_AT = 0.05;
const WASH_AT = 1.5;
const ROUTINE_LENGTH = 3.4;

interface PanParts {
  readonly group: Group;
  /** Hinged at the back, so a rotation on x swings it up like a real one. */
  readonly lid: Group;
  readonly swirl: Mesh;
}

interface BasinParts {
  readonly group: Group;
  readonly stream: Mesh;
}

export class Toilets {
  readonly deck = TOILET_DECK;
  /** Interior-local spot a child stands on to use them. */
  readonly standX = TOILET_STAND_X;
  readonly standZ = TOILET_STAND_Z;

  private readonly pan: PanParts;
  private readonly basin: BasinParts;

  /** Seconds into the routine, or `null` when nobody is using them. */
  private timer: number | null = null;
  private flushed = false;
  private washed = false;

  constructor(floorGroups: readonly Group[]) {
    const room = new Group();
    room.name = 'toilets';
    floorGroups[TOILET_DECK]?.add(room);

    const { minX, maxX, minZ, maxZ } = TOILET_ROOM;
    const width = maxX - minX;
    const depth = maxZ - minZ;
    const centreX = (minX + maxX) / 2;
    const centreZ = (minZ + maxZ) / 2;

    // A patch of shiny tiles, so the room reads as a different sort of place the
    // moment you catch sight of it from across the floor.
    const tiles = new Mesh(
      new BoxGeometry(width, 0.06, depth),
      interiorMaterial(PALETTE.buildingFloorAlt, 0.5),
    );
    tiles.receiveShadow = true;
    tiles.position.set(centreX, 0.03, centreZ);
    room.add(tiles);

    // Two side walls and a low screen across the front with a gap in the middle
    // to walk through. Waist-high, so the camera can still see in at 38°.
    const wall = (x: number, z: number, sx: number, sz: number): void => {
      const mesh = castAndReceive(
        new Mesh(new BoxGeometry(sx, 2.1, sz), softMaterial(PALETTE.buildingTrimDeep, 0.74)),
      );
      mesh.position.set(x, 1.05, z);
      room.add(mesh);
    };
    wall(minX + 0.15, centreZ, 0.3, depth);
    wall(maxX - 0.15, centreZ, 0.3, depth);
    wall(minX + 1.1, maxZ - 0.15, 2.2, 0.3);
    wall(maxX - 1.1, maxZ - 0.15, 2.2, 0.3);

    this.pan = buildPan(TOILET_PAN_X, TOILET_PAN_Z);
    this.basin = buildBasin(TOILET_BASIN_X, TOILET_BASIN_Z);
    room.add(this.pan.group, this.basin.group);

    const sign = cuteSign({
      title: 'Toilets',
      subtitle: 'wash your hands!',
      glyph: '🚻',
      accent: PALETTE.markerMint,
      width: 2.6,
    });
    sign.position.set(centreX, 2.5, maxZ + 0.06);
    room.add(sign);
  }

  /** True while the flush-and-wash routine is playing. */
  get busy(): boolean {
    return this.timer !== null;
  }

  /** Use the toilet. Ignored while a routine is already running. */
  use(): void {
    if (this.timer !== null) return;
    this.timer = 0;
    this.flushed = false;
    this.washed = false;
  }

  update(dt: number, elapsed: number): void {
    const { lid, swirl } = this.pan;
    const { stream } = this.basin;

    if (this.timer === null) {
      lid.rotation.x = Math.min(0, lid.rotation.x + dt * 3);
      swirl.visible = false;
      stream.visible = false;
      return;
    }

    this.timer += dt;

    if (!this.flushed && this.timer >= FLUSH_AT) {
      this.flushed = true;
      playFlush();
    }
    if (!this.washed && this.timer >= WASH_AT) {
      this.washed = true;
      playHandwash();
    }

    // The lid flips up for the flush and drops back once the washing starts.
    const lidUp = this.timer > FLUSH_AT && this.timer < WASH_AT + 0.4;
    lid.rotation.x = lidUp
      ? Math.max(-1.5, lid.rotation.x - dt * 8)
      : Math.min(0, lid.rotation.x + dt * 4);

    // Water in the pan for the first beat, water at the tap for the second.
    swirl.visible = this.timer > FLUSH_AT && this.timer < WASH_AT;
    swirl.rotation.y = elapsed * 9;
    swirl.scale.setScalar(0.85 + Math.sin(elapsed * 14) * 0.12);

    stream.visible = this.timer > WASH_AT && this.timer < WASH_AT + 1.5;
    stream.scale.y = 0.85 + Math.sin(elapsed * 22) * 0.15;

    if (this.timer > ROUTINE_LENGTH) this.timer = null;
  }
}

// --------------------------------------------------------------- fittings

function buildPan(x: number, z: number): PanParts {
  const group = new Group();
  group.name = 'toilet-pan';
  group.position.set(x, 0, z);

  const pedestal = new Mesh(
    new CylinderGeometry(0.24, 0.3, 0.42, 14),
    interiorMaterial(PALETTE.blossomWhite, 0.4),
  );
  pedestal.position.y = 0.21;
  pedestal.receiveShadow = true;
  group.add(pedestal);

  const bowl = new Mesh(
    new CylinderGeometry(0.36, 0.28, 0.24, 16),
    interiorMaterial(PALETTE.blossomWhite, 0.4),
  );
  bowl.position.y = 0.54;
  bowl.receiveShadow = true;
  group.add(bowl);

  const rim = new Mesh(
    new TorusGeometry(0.34, 0.07, 8, 18),
    interiorMaterial(PALETTE.markerPink, 0.5),
  );
  rim.rotation.x = Math.PI / 2;
  rim.position.y = 0.67;
  group.add(rim);

  const swirl = new Mesh(
    new CylinderGeometry(0.27, 0.2, 0.1, 14),
    interiorMaterial(PALETTE.waterTop, 0.3),
  );
  swirl.position.y = 0.62;
  swirl.visible = false;
  group.add(swirl);

  const lid = new Group();
  lid.position.set(0, 0.7, -0.34);
  const lidPlate = new Mesh(
    new CylinderGeometry(0.36, 0.36, 0.07, 16),
    interiorMaterial(PALETTE.markerLilac, 0.5),
  );
  lidPlate.position.z = 0.34;
  lid.add(lidPlate);
  group.add(lid);

  const cistern = new Mesh(
    new BoxGeometry(0.72, 0.62, 0.28),
    interiorMaterial(PALETTE.blossomWhite, 0.42),
  );
  cistern.position.set(0, 1.02, -0.48);
  cistern.receiveShadow = true;
  group.add(cistern);

  const handle = new Mesh(
    new SphereGeometry(0.09, 10, 8),
    interiorMaterial(PALETTE.markerLemon, 0.4),
  );
  handle.position.set(0.28, 1.2, -0.33);
  group.add(handle);

  return { group, lid, swirl };
}

function buildBasin(x: number, z: number): BasinParts {
  const group = new Group();
  group.name = 'toilet-basin';
  group.position.set(x, 0, z);

  const column = new Mesh(
    new CylinderGeometry(0.16, 0.2, 0.7, 12),
    interiorMaterial(PALETTE.blossomWhite, 0.42),
  );
  column.position.y = 0.35;
  column.receiveShadow = true;
  group.add(column);

  // An open half-sphere: the cheapest thing that reads as a basin you could
  // actually put your hands in.
  const bowl = new Mesh(
    new SphereGeometry(0.36, 16, 10, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2),
    interiorMaterial(PALETTE.blossomWhite, 0.4),
  );
  bowl.position.y = 0.82;
  bowl.scale.y = 0.7;
  bowl.receiveShadow = true;
  group.add(bowl);

  const tap = new Mesh(
    new CylinderGeometry(0.05, 0.05, 0.34, 10),
    interiorMaterial(PALETTE.markerLemon, 0.4),
  );
  tap.position.set(0, 1.02, -0.26);
  group.add(tap);

  const spout = new Mesh(
    new CylinderGeometry(0.045, 0.045, 0.2, 10),
    interiorMaterial(PALETTE.markerLemon, 0.4),
  );
  spout.rotation.x = Math.PI / 2;
  spout.position.set(0, 1.16, -0.16);
  group.add(spout);

  const stream = new Mesh(
    new CylinderGeometry(0.035, 0.05, 0.36, 8),
    interiorMaterial(PALETTE.waterTop, 0.3),
  );
  stream.position.set(0, 0.94, -0.08);
  stream.visible = false;
  group.add(stream);

  const mirror = new Mesh(
    new BoxGeometry(0.7, 0.8, 0.08),
    interiorMaterial(PALETTE.buildingWindow, 0.3),
  );
  mirror.position.set(0, 1.72, -0.42);
  group.add(mirror);

  return { group, stream };
}
