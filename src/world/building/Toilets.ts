import {
  BoxGeometry,
  CylinderGeometry,
  Group,
  Mesh,
  type MeshToonMaterial,
  SphereGeometry,
  TorusGeometry,
} from 'three';
import { BUILDING_FADE_SECONDS } from '../../core/constants';
import { PALETTE } from '../../core/palette';
import { playFlush, playHandwash } from '../../ui/chime';
import { castAndReceive, interiorMaterial, softMaterial } from './parts';
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
 *
 * ## The privacy roof
 *
 * GAME_DESIGN.md, 27 July 2026: *"the character walks into the room and goes
 * in, and once they are inside a roof slides over the room so you cannot see
 * them. You hear the flush. Then, as they move to the basin to wash their
 * hands, the roof vanishes again"*.
 *
 * So: **walk in → roof covers → flush → roof lifts → wash hands → leave.**
 *
 * Two rules shape how it is written, and both are about the same thing —
 * the roof describes where the child *is*, and is never a thing that has been
 * *done to* her:
 *
 * 1. **It is on before she is out of sight, not after.** A lid that arrives a
 *    beat late reads as a bug rather than as discretion, so the trigger
 *    rectangle reaches {@link APPROACH} metres past the doorway and the fade
 *    takes `BUILDING_FADE_SECONDS` — she crosses the threshold and it has
 *    already closed over her.
 * 2. **She can never be stuck under it.** `updateRoof` recomputes the target
 *    from her position every frame; nothing latches except `lifted`, and
 *    stepping out of the room clears that too. Walk out mid-flush and it
 *    lifts. Reload a save taken mid-visit — `save.ts` restores a space id and
 *    a local offset, and this class is rebuilt with `timer === null` — and the
 *    roof simply asks where she is and answers correctly, with no sequence to
 *    resume.
 */

/** Seconds: flush, then a beat, then the tap, then everything settles. */
const FLUSH_AT = 0.05;
const WASH_AT = 1.5;
const ROUTINE_LENGTH = 3.4;

/**
 * How far outside the room the roof already counts you as in it, in metres.
 *
 * Rule 1 above: the lid has to lead her, so it starts closing as she reaches
 * the doorway rather than once she is through it. At a walking pace this is
 * very nearly `BUILDING_FADE_SECONDS` of travel, so the two land together.
 */
const APPROACH = 0.9;

/**
 * Underside of the lid.
 *
 * Above the 2.1m screens so it reads as a roof over them rather than as a
 * shelf resting on them, and a long way under the deck above at
 * `BUILDING_FLOOR_HEIGHT` (3.6). The camera is orthographic, 90 units out at
 * 38°, so it is always far above this and can never end up inside the lid.
 */
const ROOF_Y = 2.42;

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

interface RoofParts {
  readonly group: Group;
  /** Every material the lid is made of, faded together. */
  readonly materials: readonly MeshToonMaterial[];
}

export class Toilets {
  readonly deck = TOILET_DECK;
  /** Interior-local spot a child stands on to use them. */
  readonly standX = TOILET_STAND_X;
  readonly standZ = TOILET_STAND_Z;

  private readonly pan: PanParts;
  private readonly basin: BasinParts;
  private readonly roof: RoofParts;

  /** Seconds into the routine, or `null` when nobody is using them. */
  private timer: number | null = null;
  private flushed = false;
  private washed = false;

  /** Whether she is in the room — recomputed from her position every frame. */
  private visiting = false;
  /**
   * Whether the wash beat has lifted the roof for this visit.
   *
   * The one thing that latches, because "she has finished and is at the basin"
   * has to outlive the routine timer that said so — otherwise the lid would
   * drop back over her the moment the tap stopped running. Cleared the instant
   * she leaves the room, which is what keeps it from ever trapping her.
   */
  private lifted = false;

  /** 0 = fully lifted, 1 = fully covering. */
  private roofAmount = 0;

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
    this.roof = buildRoof(centreX, centreZ, width, depth);
    room.add(this.pan.group, this.basin.group, this.roof.group);
    this.applyRoof();

    // The "Toilets / wash your hands!" board over the door is gone with every
    // other sign in the park (28 July 2026). Its words live on the `toilets`
    // interact zone now — see `building/interactZones.ts`.
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

  /**
   * Is a child at these interior-local coordinates in the room?
   *
   * Generous by {@link APPROACH} on every side, because this drives the roof
   * and the roof has to lead her. The *strict* rectangle — the one that says
   * whether she has really gone in far enough to use the loo — is
   * `TOILET_ROOM` itself, tested by `Building.handleInteractPress`.
   */
  occupies(localX: number, localZ: number): boolean {
    return (
      localX >= TOILET_ROOM.minX - APPROACH &&
      localX <= TOILET_ROOM.maxX + APPROACH &&
      localZ >= TOILET_ROOM.minZ - APPROACH &&
      localZ <= TOILET_ROOM.maxZ + APPROACH
    );
  }

  /**
   * @param occupied Whether a child is in the room right now. The roof is
   * driven entirely by this and by the routine's own clock — see the class
   * comment on why it is a question asked every frame rather than a state the
   * sequence sets.
   */
  update(dt: number, elapsed: number, occupied: boolean): void {
    this.updateFittings(dt, elapsed);
    this.updateRoof(dt, occupied);
  }

  // -------------------------------------------------------------- internals

  private updateFittings(dt: number, elapsed: number): void {
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

  /**
   * The lid, driven from where she is.
   *
   * Runs after `updateFittings`, so the frame the tap starts running is the
   * same frame the roof begins to lift — the two halves of the joke land
   * together rather than a beat apart.
   */
  private updateRoof(dt: number, occupied: boolean): void {
    if (occupied) {
      this.visiting = true;
      // The wash beat is the cue to lift, and it stays lifted for the rest of
      // the visit however long she dawdles at the basin afterwards.
      if (this.timer !== null && this.timer >= WASH_AT) this.lifted = true;
    } else {
      // Out of the room: nothing is remembered, so however far the sequence
      // had got, the next visit starts clean and this one ends uncovered.
      this.visiting = false;
      this.lifted = false;
    }

    const target = this.visiting && !this.lifted ? 1 : 0;
    if (this.roofAmount !== target) {
      const step = BUILDING_FADE_SECONDS > 0 ? dt / BUILDING_FADE_SECONDS : 1;
      const delta = target - this.roofAmount;
      this.roofAmount += Math.sign(delta) * Math.min(Math.abs(delta), step);
    }
    // Applied unconditionally, not only while it is moving. The lid lives in a
    // floor group, so `FloorFader` has claimed its materials and will write
    // their opacity whenever deck one fades; re-stating ours every frame costs
    // two number writes and means the two can never disagree.
    this.applyRoof();
  }

  private applyRoof(): void {
    const amount = this.roofAmount;
    this.roof.group.visible = amount > 0.002;
    for (const material of this.roof.materials) material.opacity = amount;
  }
}

// ------------------------------------------------------------ privacy roof

/**
 * A lid over `TOILET_ROOM`, in the tower's own roof colours so it reads as the
 * little room having grown a roof rather than as a slab dropped on it.
 *
 * Built once and faded, never rebuilt. The materials start transparent at zero
 * opacity on purpose: `FloorFader` claims every material on the deck and
 * records the opacity it finds, so the base it will fade *to* is invisible —
 * which means the worst a clash between the two can do is hide the lid, never
 * strand it opaque over an empty room.
 *
 * It does not cast a shadow. A shadow is a lid you can see from outside the
 * room, and the whole point is that from outside nothing has changed except
 * that you cannot see in.
 */
function buildRoof(centreX: number, centreZ: number, width: number, depth: number): RoofParts {
  const group = new Group();
  group.name = 'toilet-roof';
  group.visible = false;

  const materials: MeshToonMaterial[] = [];
  const fading = (colour: number): MeshToonMaterial => {
    const material = interiorMaterial(colour);
    material.transparent = true;
    material.opacity = 0;
    // Off, so the lid never punches a hole in what is drawn behind it while it
    // is halfway faded. It is the topmost thing in the room, so it has nothing
    // to sort against anyway.
    material.depthWrite = false;
    materials.push(material);
    return material;
  };

  // Exactly the room's footprint, with no overhang in any direction. The
  // screens sit inside these bounds so there is no seam to cover, and the
  // "Toilets" sign stands 6cm clear of the front edge — an overhang would put
  // the lid straight through it.
  const band = new Mesh(new BoxGeometry(width, 0.1, depth), fading(PALETTE.buildingRoofDeep));
  band.position.set(centreX, ROOF_Y + 0.05, centreZ);
  group.add(band);

  // An inset panel on top, the same two-tone as the tower's own roof.
  const panel = new Mesh(new BoxGeometry(width - 0.5, 0.12, depth - 0.5), fading(PALETTE.buildingRoof));
  panel.position.set(centreX, ROOF_Y + 0.16, centreZ);
  group.add(panel);

  return { group, materials };
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
