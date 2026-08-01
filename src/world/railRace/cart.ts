import {
  Color,
  CylinderGeometry,
  Group,
  Material,
  Mesh,
  Object3D,
  SphereGeometry,
  SpotLight,
} from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { PALETTE } from '../../core/palette';
import { addOutline, decal, solid, toonMaterial } from '../../art/style/materials';
import { heartGeometry } from '../../art/style/shapes';
import { RIDE_SCALE } from './route';
import { RAIL_GAUGE } from './track';

/**
 * **A cart for the Rail Race** — one per rail, four on the ring.
 *
 * Replaces the two-box placeholder (a body and a nose, no wheels, no colour
 * discipline) with a proper mine-cart-style car: a tub with a driver's bench
 * and a smaller pet perch beside it, four wheels spaced to actually sit on
 * this ride's rails, and a pair of headlamps on the nose.
 *
 * Built the same way `minigames/dodgems/car.ts` builds its car — that file is
 * this one's model, down to the wheel-spin idiom (`rotation.z = PI/2` once,
 * then `rotation.y` driven every frame). The one real difference: a dodgem is
 * steered and bumped, so its geometry lives on a `chassis` sub-group that
 * leans and squashes independently of `root`. A rail cart never leaves its
 * rail and never bumps anything — `RailRace.ts` already drives this cart's
 * `root` position and rotation directly, every frame, off the route — so
 * there is no second transform to keep in sync here. Simpler on purpose.
 *
 * ## Scale
 *
 * Built at natural size, in the same metres the old two-box cart used
 * (`RailRace.ts`'s `buildCarts` applies `RIDE_SCALE` to the whole group
 * externally, once, alongside the rider riding inside it — baking a second
 * scale in here would double it up). The wheel gauge is the one number that
 * has to agree exactly with the world the cart is dropped into, so it is
 * *derived* from `RAIL_GAUGE` (already in world/post-scale metres) divided
 * back down by `RIDE_SCALE`, rather than a second hand-picked constant that
 * could quietly drift from the rails it needs to straddle.
 *
 * ## Why the colour bug this replaces happened
 *
 * The old caller passed each rival's own `RIVALS[].cart` colour — a second,
 * hand-maintained copy of "which colour is this racer" that was never checked
 * against `track.ts`'s `LANE_COLOURS` and had drifted out of step with it
 * (and the player's cart was not even parameterised — hardcoded to
 * `markerPink` regardless of which lane, i.e. rail colour, she was actually
 * on). `RailRace.ts` now derives every cart's colour from `LANE_COLOURS` by
 * lane, the same array the rails themselves are painted from, so there is
 * only one fact to ever get right.
 */

/** Wheel radius, in this cart's own (pre-`RIDE_SCALE`) metres. */
const WHEEL_RADIUS = 0.16;

/**
 * How high the seat's own sitting surface is, in this cart's own
 * (pre-`RIDE_SCALE`) metres — the one fact `RailRace.ts`'s `poseRider()` and
 * `buildCarts()` both need to actually put a rider *on* the seat rather than
 * hovering over the cart's floor, which is what a stray `+ 0.05` (a leftover
 * from the old placeholder cart, which had no distinct seat mesh at all) did
 * once this cart gained a real one roughly `RIDE_SCALE` metres taller.
 */
export const SEAT_HEIGHT = 0.47;

/** Half the wheel gauge, worked back down from the world-scale `RAIL_GAUGE`. */
const WHEEL_HALF_GAUGE = RAIL_GAUGE / RIDE_SCALE / 2;

/** Wheelbase: how far the front axle sits from the back one. */
const WHEEL_Z = 0.62;

/**
 * The headlamp beams.
 *
 * **These are real `SpotLight`s, on Jim's explicit call (1 August 2026),
 * overriding PR #153's review — which chose emissive-only discs for the perf
 * reason spelled out below.** The ask is that the lamps actually light the
 * rails ahead of the rider rather than only glowing themselves, and no amount
 * of emissive does that: an emissive material lights *itself* and nothing else.
 *
 * Three deliberate choices keep the bill payable:
 *
 * - **They cast no shadows.** Eight shadow-casting spots would mean eight extra
 *   shadow-map passes a frame over trestle-heavy scenery, which is the part of
 *   a dynamic light that is genuinely expensive. A headlamp reads entirely from
 *   the pool of warm light it throws down the rail.
 * - **They are off unless somebody is riding** (see {@link CartHandle.setHeadlamps}).
 *   The park scene has *no* other point or spot lights in it — only the day/night
 *   rig's directionals — so leaving eight on permanently would put a per-fragment
 *   spot-light loop into every material in the whole park for the sake of four
 *   carts idling round an empty ring. Toggling `visible` is what three.js counts,
 *   so an off lamp costs exactly nothing.
 * - **Distances and angles are in world metres**, not the cart's own. `RailRace.ts`
 *   scales the cart group by `RIDE_SCALE`, and three.js scales a light's
 *   *position* by its parent's matrix but **not** its `distance` — so a range
 *   picked in cart-local metres would come out 2.5x short.
 */
const HEADLAMP_RANGE = 26;
const HEADLAMP_ANGLE = 0.5;
const HEADLAMP_PENUMBRA = 0.55;
const HEADLAMP_DECAY = 1.4;
/**
 * Bright, because of that decay and range: illuminance falls as
 * `intensity / distance^HEADLAMP_DECAY`, so lighting rail twelve metres ahead
 * takes a number that looks alarming next to the spooky house's 3.2 candela
 * room lantern throwing 2 m. Tuned by eye against the ride at night.
 */
const HEADLAMP_INTENSITY = 90;

export interface CartHandle {
  readonly root: Group;
  /**
   * Spins the wheels to match how far the cart has rolled.
   *
   * Takes **absolute** metres travelled (`Rider.travelled`), not a per-frame
   * delta, and sets each wheel's angle outright (`distance / (WHEEL_RADIUS *
   * RIDE_SCALE)`) rather than accumulating one — so a fresh race, which
   * resets `Rider.travelled` to 0, resets the wheels to the same start angle
   * too, and there is no drift to accumulate over a long race.
   *
   * `travelled` is real, unscaled world arc-length (`route.ts`), but the
   * wheel actually drawn is `RIDE_SCALE` bigger than `WHEEL_RADIUS` — the
   * external `group.scale.setScalar(RIDE_SCALE)` this cart relies on grows it
   * along with everything else. Dividing by the bare, pre-scale radius spins
   * the wheel `RIDE_SCALE`× too fast for the ground it is actually rolling
   * over; the rendered circumference is what has to match the distance.
   */
  spinWheels(travelled: number): void;
  /**
   * Lights or douses this cart's two headlamp beams.
   *
   * Off is the default and is genuinely free: three.js counts only *visible*
   * lights when it builds a material's shader, so a doused lamp costs nothing
   * at all rather than costing a little. `RailRace.ts` lights them when a race
   * starts and douses them when she is set back down — the rivals idling round
   * an empty ring do not get to put a spot-light loop into every material in
   * the park. See {@link HEADLAMP_RANGE}'s note.
   */
  setHeadlamps(on: boolean): void;
  dispose(): void;
}

/**
 * Builds one cart, painted to match its lane's rail colour.
 *
 * @param colour - This cart's own colour. Callers should pass
 *   `LANE_COLOURS[lane]` (`track.ts`) so a cart always matches the rail it
 *   is riding, never a second, independently chosen colour.
 */
export function createCart(colour: number): CartHandle {
  const root = new Group();
  root.name = 'railRace:cart';

  const bodyMaterial = toonMaterial(colour);
  const deepMaterial = toonMaterial(new Color(colour).multiplyScalar(0.8).getHex());
  const petMaterial = toonMaterial(new Color(colour).lerp(new Color(PALETTE.buildingWall), 0.5).getHex());
  const wheelMaterial = toonMaterial(PALETTE.ink);
  const lampMaterial = toonMaterial(PALETTE.fairyWarm, {
    emissive: PALETTE.fairyWarm,
    emissiveIntensity: 1,
  });
  const petMarkMaterial = toonMaterial(PALETTE.buildingWall);
  const disposables: Material[] = [
    bodyMaterial,
    deepMaterial,
    petMaterial,
    wheelMaterial,
    lampMaterial,
    petMarkMaterial,
  ];

  // --- tub --------------------------------------------------------------
  // Wider than the rail gauge on purpose — a mine cart's body oversails its
  // wheels, the same way a real train's carriage does; the wheels themselves
  // are the part that has to agree with the rails, not the tub.
  const body = solid(new Mesh(new RoundedBoxGeometry(1.15, 0.6, 1.7, 4, 0.1), bodyMaterial));
  body.position.y = 0.34;
  addOutline(body, 0.02);
  root.add(body);

  // Nose panel, tinted a shade darker than the tub rather than a hardcoded
  // colour of its own — the old nose was always `markerLemon`, whatever the
  // cart's own colour, which is the same "second fact that can drift" bug
  // `LANE_COLOURS` fixes for the rails.
  const nose = solid(new Mesh(new RoundedBoxGeometry(0.85, 0.34, 0.42, 3, 0.06), deepMaterial));
  nose.position.set(0, 0.32, 1.0);
  addOutline(nose, 0.02);
  root.add(nose);

  // --- headlamps ----------------------------------------------------------
  // A warm glowing disc either side of the nose, and — since 1 August 2026 — a
  // real `SpotLight` behind each one, throwing warm light down the rail ahead.
  // See the constants above for why they cast no shadows and why they are dark
  // until somebody boards.
  //
  // Both beams aim at one shared target sitting forward and a little below the
  // nose, so they converge down the track exactly the way a pair of real
  // headlamps do. A target per lamp would let the two drift apart, and it is
  // the *pair* that has to point where the cart is going.
  const lampAim = new Object3D();
  lampAim.position.set(0, -0.55, 9);
  root.add(lampAim);

  const beams: SpotLight[] = [];
  for (const side of [-1, 1] as const) {
    const lamp = decal(new Mesh(new SphereGeometry(0.09, 10, 8), lampMaterial));
    lamp.scale.z = 0.5;
    lamp.position.set(side * 0.3, 0.34, 1.21);
    root.add(lamp);

    const beam = new SpotLight(
      PALETTE.fairyWarm,
      HEADLAMP_INTENSITY,
      HEADLAMP_RANGE,
      HEADLAMP_ANGLE,
      HEADLAMP_PENUMBRA,
      HEADLAMP_DECAY,
    );
    // Just in front of the glowing disc, so the disc is not itself the first
    // thing the beam lights.
    beam.position.set(side * 0.3, 0.34, 1.3);
    beam.target = lampAim;
    // The expensive half of a dynamic light, and the half a headlamp does not
    // need. See `HEADLAMP_RANGE`'s note.
    beam.castShadow = false;
    beam.visible = false;
    root.add(beam);
    beams.push(beam);
  }

  // --- wheels ---------------------------------------------------------------
  // Gauge matches `RAIL_GAUGE` exactly (see the file header): these are the
  // one part of the cart that has to sit where the rails actually are.
  const wheelGeometry = new CylinderGeometry(WHEEL_RADIUS, WHEEL_RADIUS, 0.1, 12);
  const wheels: Mesh[] = [];
  for (const side of [-1, 1] as const) {
    for (const z of [-WHEEL_Z / 2, WHEEL_Z / 2]) {
      const wheel = solid(new Mesh(wheelGeometry, wheelMaterial));
      // Same idiom as `minigames/dodgems/car.ts`: lay the cylinder on its side
      // once, then drive its rolling angle through `rotation.y` every frame.
      wheel.rotation.z = Math.PI / 2;
      wheel.position.set(side * WHEEL_HALF_GAUGE, WHEEL_RADIUS, z);
      root.add(wheel);
      wheels.push(wheel);
    }
  }

  // --- rider's seat -----------------------------------------------------
  // Centred on the cart's own origin, because that is where `RailRace.ts`
  // actually stands the rider (rivals' `kid.root` and the player's own model
  // both sit at `x = 0` inside/against this cart) — the backrest has to be
  // where she really is, not just somewhere in the tub.
  const seatBack = solid(new Mesh(new RoundedBoxGeometry(0.58, 0.46, 0.12, 3, 0.06), deepMaterial));
  seatBack.position.set(0, 0.58, -0.5);
  addOutline(seatBack, 0.016);
  root.add(seatBack);

  const seatBase = solid(new Mesh(new RoundedBoxGeometry(0.58, 0.1, 0.5, 3, 0.05), deepMaterial));
  seatBase.position.set(0, SEAT_HEIGHT - 0.05, -0.28);
  root.add(seatBase);

  // --- pet perch --------------------------------------------------------
  // A second, smaller bench beside the rider's — the physical space the brief
  // asks for. It is never occupied by a live model here: the park's existing
  // "a pet comes with you" feature is `entities/parade/BackpackPeek.ts`, which
  // already rides along for free wherever the character herself goes (it is
  // driven off her own body's `backpackAnchor`, not off any ride-specific
  // code), so whichever pet she has out already pops its head up beside her
  // during this ride exactly as it does everywhere else in the park. Actually
  // seating a *specific* walking pet down here — one of `entities/parade`'s
  // own members, sat rather than walked — would need new per-ride wiring
  // (which pet, spawned and posed for the ride, torn down at the dismount)
  // and is future work; see `HANDOFF-rail-cart-upgrade.md`.
  const petSeat = solid(new Mesh(new RoundedBoxGeometry(0.38, 0.22, 0.42, 3, 0.06), petMaterial));
  petSeat.position.set(-0.34, 0.44, -0.2);
  addOutline(petSeat, 0.014);
  root.add(petSeat);

  const petBack = solid(new Mesh(new RoundedBoxGeometry(0.38, 0.26, 0.1, 3, 0.05), petMaterial));
  petBack.position.set(-0.34, 0.56, -0.4);
  root.add(petBack);

  // A little paw-print stand-in — a heart, the shape the park already uses
  // for "a pet belongs here" (`art/models/backpacks.ts`'s heart backpack
  // decal) — marking the perch as a pet's spot at a glance, without needing a
  // second bespoke decal shape.
  const petMark = decal(new Mesh(heartGeometry(0.08, 0.02), petMarkMaterial));
  petMark.position.set(-0.34, 0.57, -0.245);
  petMark.rotation.x = -0.3;
  root.add(petMark);

  return {
    root,

    spinWheels(travelled: number): void {
      const angle = -travelled / (WHEEL_RADIUS * RIDE_SCALE);
      for (const wheel of wheels) wheel.rotation.y = angle;
    },

    setHeadlamps(on: boolean): void {
      for (const beam of beams) beam.visible = on;
    },

    dispose(): void {
      root.traverse((object) => {
        const mesh = object as Partial<Mesh>;
        mesh.geometry?.dispose();
      });
      for (const beam of beams) beam.dispose();
      for (const material of disposables) material.dispose();
    },
  };
}
