import { Group, Mesh, MeshToonMaterial } from 'three';
import {
  createLiftCar,
  createLiftDial,
  createLiftDoors,
  createLiftFrame,
  type LiftDialHandle,
  type SlidingDoorsHandle,
} from '../../art/models/hotelAssets';
import { disposeTree } from '../../art/style/materials';
import { glbCanvasTexture } from '../../art/style/glb';

/**
 * **The lift you stand in** — car, architrave, sliding doors and pointer dial,
 * assembled into one wall, for every building in the park that has a lift.
 *
 * ## Why this is not in `world/hotel/`
 *
 * It was. `Hotel.fitLiftAlcove` built these four assets and `Hotel.updateDoors`
 * drove them, and the castle — whose lift is the *only* way between its three
 * floors since they became disjoint spaces (#377/#380) — had **nothing at all**
 * in its alcove. `GlassLift` was deleted with the split and never replaced, so
 * `LiftRide` glided a six-year-old out through the hole in the east wall and
 * held her, mid-air, over open nothing, for the whole ride. Issue #450, and
 * Jim's own words: *"it should be like in the hotel — ie, actually show a lift
 * space."*
 *
 * The instruction was explicit, and it is CLAUDE.md's rule anyway: **reuse the
 * hotel's, do not write a second one.** So the alcove moved out from under the
 * hotel to here, unchanged, and both buildings hang one on a wall.
 *
 * ## The geometry is the hotel's, mirrored by a single yaw
 *
 * The assets are authored facing **+Z** with their origin on the floor in the
 * doorway. {@link LiftAlcoveOptions.yaw} turns that to face out of the wall,
 * and **every other offset is derived from it** — the car sits
 * {@link CAR_DEPTH} *behind* the doorway, the dial {@link DIAL_STANDOFF} in
 * front. The hotel's alcove is in a west wall (`yaw = +π/2`, out along +X); the
 * castle's is in an east wall (`yaw = −π/2`, out along −X) and needs no second
 * set of numbers, only the opposite quarter turn. Hard-coding `wallX - 1.72`
 * for one of them, as this did while it lived in the hotel, is exactly the
 * formula that cannot be mirrored.
 *
 * The fit is not a coincidence either way round: the castle's east-wall gap is
 * 3.0 m against the hotel's 3.2 m, and the 3.28 m architrave plugs both, with
 * *more* overlap in the castle rather than less.
 */

/**
 * How far behind the doorway the car's centre stands, in metres.
 *
 * The car is 2.2 m deep inside, so its back wall is at 2.82 m and its mouth at
 * 0.62 m — which is what makes the rider's own spot (1.7 m back, in both
 * buildings' layouts) land comfortably inside it with the doors clear of her.
 */
export const CAR_DEPTH = 1.72;

/** How far the dial stands proud of the architrave. */
export const DIAL_STANDOFF = 0.3;

/**
 * The dial's pivot height. Over the doors and under the ceiling: the frame is
 * 2.96 m tall and the shortest rooms with a lift in them have 3.0 m walls.
 */
export const DIAL_PIVOT_Y = 2.46;

/** One number written on the dial's face, at the point the needle reaches it. */
export interface LiftDialLabel {
  /** In the dial's own units — a hotel storey, or a castle floor index. */
  readonly at: number;
  /** What to write there. One or two characters; a child has to read it. */
  readonly text: string;
}

export interface LiftAlcoveOptions {
  /**
   * The middle of the doorway, in the parent group's own metres: on the wall's
   * centre line, on the floor.
   */
  readonly wallX: number;
  readonly wallZ: number;
  /**
   * Which way **out of the alcove** points, as a yaw — `+π/2` for a lift that
   * opens towards +X, `−π/2` for one that opens towards −X.
   */
  readonly yaw: number;
  /** The dial's top of scale, in the same units as {@link LiftDialLabel.at}. */
  readonly topOfScale: number;
  /** What is written on the dial. Only the floors that exist (see below). */
  readonly labels: readonly LiftDialLabel[];
}

/**
 * One building's lift, on one wall. Add {@link root} to the group that owns
 * that wall; a castle floor group and a hotel room shell both work, because
 * everything here is in the parent's metres.
 */
export class LiftAlcove {
  readonly root = new Group();

  private readonly doors: SlidingDoorsHandle;
  private readonly dial: LiftDialHandle;
  private readonly topOfScale: number;

  constructor(options: LiftAlcoveOptions) {
    const { wallX, wallZ, yaw } = options;
    this.topOfScale = options.topOfScale === 0 ? 1 : options.topOfScale;
    this.root.name = 'lift-alcove';

    // Out of the doorway, in the parent's metres. Every offset below is this
    // vector scaled, so there is one direction to get right rather than four.
    const outX = Math.sin(yaw);
    const outZ = Math.cos(yaw);

    // The car, at the back of the alcove, open side facing the room.
    const car = createLiftCar();
    car.root.position.set(wallX - outX * CAR_DEPTH, 0, wallZ - outZ * CAR_DEPTH);
    car.root.rotation.y = yaw;
    this.root.add(car.root);

    // The architrave, plugging the wall gap.
    const frame = createLiftFrame();
    frame.root.position.set(wallX, 0, wallZ);
    frame.root.rotation.y = yaw;
    this.root.add(frame.root);

    const doors = createLiftDoors();
    doors.root.position.set(wallX, 0, wallZ);
    doors.root.rotation.y = yaw;
    doors.setOpen(0);
    this.root.add(doors.root);
    this.doors = doors;

    // The dial, over the doors and standing proud of the architrave, which is
    // where a lift dial goes and the only place there is room for one.
    const dial = createLiftDial();
    dial.root.position.set(
      wallX + outX * DIAL_STANDOFF,
      DIAL_PIVOT_Y,
      wallZ + outZ * DIAL_STANDOFF,
    );
    dial.root.rotation.y = yaw;
    paintDialFace(dial.face, options.labels, this.topOfScale);
    dial.setSweep(0);
    this.root.add(dial.root);
    this.dial = dial;
  }

  /** 0 shut, 1 wide open. Feed it `liftDoorOpenness` from `lift/phases.ts`. */
  setOpen(open01: number): void {
    this.doors.setOpen(open01);
  }

  /**
   * Point the needle at a floor, in {@link LiftDialLabel.at}'s units.
   *
   * Takes the storey rather than a fraction so the caller cannot divide by a
   * different top of scale than the face was painted with — that division was
   * `Hotel.updateDoors`'s job and is now nobody's but this class's.
   */
  setStorey(storey: number): void {
    this.dial.setSweep(storey / this.topOfScale);
  }

  /**
   * The whole assembly at once, rather than each handle's own `dispose` — four
   * calls that between them have to name every part is four chances to forget
   * the one added last, and `disposeTree` cannot forget a child.
   */
  dispose(): void {
    disposeTree(this.root);
  }
}

/**
 * Paints the floor numbers onto the dial's **own** UV map (ART_DIRECTION §7,
 * CLAUDE.md's hood-face rule) — never a second mesh floated in front of it.
 *
 * **`flipY = false`, via `glbCanvasTexture`** — this face's UVs came out of a
 * `.glb`, so the default flip would print the numbers upside-down.
 *
 * The face's UVs are `u = x / 0.9 + 0.5`, `v = z / 0.9 + 0.5` off the disc's
 * own vertices (`hotel_build.py`'s `uv_from_xz`), so a point at dial angle φ
 * lands at `u = cos φ / 2 + 0.5`, `v = sin φ / 2 + 0.5`. With the flip off,
 * v = 1 is the *bottom* of the canvas while it is the *top* of the dial — so
 * the canvas is mirrored vertically once, here, and everything below can then
 * be written in ordinary dial coordinates.
 *
 * **Only the floors that exist are labelled.** Eleven evenly-spaced numbers is
 * what a real lift dial has and what a six-year-old cannot read; four is the
 * hotel she is actually in, and three is the castle.
 */
function paintDialFace(
  face: Mesh,
  labels: readonly LiftDialLabel[],
  topOfScale: number,
): void {
  const SIZE = 512;
  const canvas = document.createElement('canvas');
  canvas.width = SIZE;
  canvas.height = SIZE;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  ctx.fillStyle = '#fff3c9';
  ctx.fillRect(0, 0, SIZE, SIZE);

  // The one mirror, so the arithmetic below is in dial space: +y is up the
  // dial, and a glyph drawn upright here reads upright on the plaque.
  ctx.translate(0, SIZE);
  ctx.scale(1, -1);

  ctx.fillStyle = '#4a3a52';
  ctx.font = 'bold 46px "Trebuchet MS", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  // Radius the labels sit at, as a fraction of the face — inside the ticks,
  // which are geometry and stand at about 0.85 of it.
  const LABEL_RADIUS = 0.64;
  for (const { at, text } of labels) {
    // Left-hand end of the arc is the ground floor, right-hand end the top.
    const phi = Math.PI * (1 - at / topOfScale);
    ctx.fillText(
      text,
      SIZE / 2 + Math.cos(phi) * LABEL_RADIUS * (SIZE / 2),
      SIZE / 2 - Math.sin(phi) * LABEL_RADIUS * (SIZE / 2),
    );
  }

  face.material = new MeshToonMaterial({ map: glbCanvasTexture(canvas) });
}
