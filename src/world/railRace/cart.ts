import { Color, Group, Mesh, Object3D, Quaternion, SpotLight, Vector3 } from 'three';
import { PALETTE } from '../../core/palette';
import { cartAssetMesh, cartAssetPart } from '../../art/models/cartAsset';
import { addOutline, decal, disposeTree, solid, toonMaterial } from '../../art/style/materials';
import { heartGeometry } from '../../art/style/shapes';
import { RIDE_SCALE } from './route';

/**
 * **A cart for the Rail Race** — one per rail, four on the ring.
 *
 * The cart is an **authored asset** (`art/blend/cart.blend` →
 * `src/art/assets/cart.glb` → `cartGlb.ts` → `art/models/cartAsset.ts`), the
 * same `.glb` pipeline the player kid's body and head already use
 * (`ART-AGENT-NOTES.md` §6a). It replaces a hand-tuned procedural version
 * that shipped with the tub's own walls and floor completely burying every
 * wheel — twice, in two separate review passes.
 *
 * ## Three rounds of live feedback
 *
 * **Round 1** (playtest, "just rectangles with headlights"): a first Blender
 * pass fixed wheel visibility geometrically (ray-cast verified) but Jim's
 * next live look found "half-wheels vanishing at random below a weird
 * looking box thing" — the first asset only cleared the wheel by a partial
 * margin (tub floor at the wheel's own axle height), which held up at zero
 * pitch/roll but not once the whole rigid cart pitches on this route's real
 * hills (`RailRace.ts`: `cart.group.rotation.x = -Math.asin(tangent.y)`)
 * combined with the ride's own camera looking down at a real angle
 * (`camera.ts`, ~20° declination).
 *
 * **Round 2** (Jim, same day): reshape to read as an actual mine cart — a
 * hopper that flares wider at the rim than at the floor, on a visible
 * wheeled underframe. Fixed both at once by setting the hopper's floor
 * **entirely above the wheel's own top point** — full vertical separation,
 * so there is no pitch/camera angle at which the floor plane can sweep down
 * into the wheel's silhouette.
 *
 * **Round 3** (Jim, same day, two more live reports): (a) the wheels were
 * spinning on the wrong axis — a flat, coin-like spin in the ground plane,
 * not a forward roll; and (b) even once rolling correctly, a featureless
 * disc barely reads as turning. Root cause of (a), and why it is a **code**
 * bug, not an asset-orientation one: `wheel.rotation.z = Math.PI / 2` once,
 * then mutating `wheel.rotation.y` every frame, does not compose as "spin
 * about the tilted local axle axis" — three.js's Euler field mutation
 * doesn't work that way. Verified with a bare `Object3D` and a marked rim
 * point (no mesh needed — this is purely about how `.rotation` composes):
 * sweeping `.rotation.y` while `.rotation.z` stays fixed traces the point
 * through the **world X-Z (ground) plane**, not the Y-Z plane a rolling
 * wheel needs. This is the *exact same code idiom* `minigames/dodgems/car.ts`
 * uses, so that cart almost certainly has the identical bug, unreported —
 * out of scope to fix here, but worth flagging separately. Fixed by
 * composing an explicit `Quaternion` each frame instead of mutating Euler
 * fields — see {@link WHEEL_LAY_DOWN} and `spinWheels`. (b) is addressed by
 * doubling the wheel's size and modelling it with a hub, rim band and three
 * spokes (`art/blend/cart.blend`) instead of a plain disc, so the now-correct
 * roll is actually visible.
 *
 * **What the asset owns:** each part's shape and its own local transform —
 * `hopper`, `frame-rail-l/r` (shared geometry), `seat-back`, `seat-base`,
 * `pet-seat`, `pet-back`, four wheels (`wheel-fl/fr/bl/br`, shared geometry,
 * hub+rim+3-spoke) and two headlamps (`lamp-l/r`, shared geometry) —
 * modelled in Blender against this file's own reference numbers
 * (`WHEEL_RADIUS`, the rail gauge, `SEAT_HEIGHT`), not copied from them.
 *
 * **What stays in code**, same split the kid uses for skin/hair colour:
 * every material (this cart's whole colour comes from `LANE_COLOURS[lane]`
 * at runtime — see the file-level colour-bug note below), the wheel-spin
 * quaternion logic, and the headlamp beams (real `SpotLight`s — see
 * {@link HEADLAMP_RANGE}'s note for why, and {@link CartHandle.setHeadlamps}).
 *
 * ## Scale
 *
 * Built at natural size, in the same metres the old two-box cart used
 * (`RailRace.ts`'s `buildCarts` applies `RIDE_SCALE` to the whole group
 * externally, once, alongside the rider riding inside it — baking a second
 * scale into the asset would double it up, which is why `blend:cart` never
 * touches `RIDE_SCALE`). The wheel gauge is the one number that has to agree
 * exactly with the world the cart is dropped into: it is baked into the
 * asset at `0.31` m either side of centre, which is `RAIL_GAUGE / RIDE_SCALE
 * / 2` — and, because `RAIL_GAUGE := 0.62 * RIDE_SCALE` (`track.ts`), that
 * ratio is `0.62 / 2` regardless of what `RIDE_SCALE` is set to, so baking it
 * is safe rather than a second hand-picked constant that could drift.
 * `scripts/check-cart-shape.mts` asserts the asset's actual baked gauge
 * against `RAIL_GAUGE` so a future change to either number is caught rather
 * than silently decoupled. The wheel's own *size* (radius/thickness) doubled
 * in round 3, but its gauge — where it sits relative to the rails — did not.
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

/** Every named part `art/blend/cart.blend` exports. */
export const CART_PARTS = [
  'hopper',
  'frame-rail-l',
  'frame-rail-r',
  'seat-back',
  'seat-base',
  'pet-seat',
  'pet-back',
  'wheel-fl',
  'wheel-fr',
  'wheel-bl',
  'wheel-br',
  'lamp-l',
  'lamp-r',
] as const;

export type CartPart = (typeof CART_PARTS)[number];

/**
 * Wheel radius, in this cart's own (pre-`RIDE_SCALE`) metres — baked into the
 * asset's `wheel` mesh at this same radius, and still needed here for
 * {@link CartHandle.spinWheels}'s circumference math. Doubled in round 3
 * (Jim, live: "make the wheels 100% larger... so the rotation is actually
 * visible") from the original 0.16 — the wheel's *gauge* (lateral position,
 * baked into the asset) is unchanged; only its own size is.
 */
export const WHEEL_RADIUS = 0.32;

/**
 * How high the seat's own sitting surface is, in this cart's own
 * (pre-`RIDE_SCALE`) metres — the one fact `RailRace.ts`'s `poseRider()` and
 * `buildCarts()` both need to actually put a rider *on* the seat rather than
 * hovering over the cart's floor. Baked into the asset's `seat-base` node at
 * this same height (its top surface sits at exactly `SEAT_HEIGHT`); kept as
 * an explicit exported constant, same discipline as the kid rig's own
 * `KID_HEAD_HEIGHT` staying in code rather than something a caller would have
 * to measure out of the mesh. Raised from round 2's 0.47 because the hopper's
 * own floor rose (to stay above the now-doubled wheel's top point) and the
 * seat has to sit above *that* floor, not float below it.
 */
export const SEAT_HEIGHT = 0.83;

/**
 * Where a pet mark sits, relative to the asset's own `pet-seat` node —
 * derived from that node's authored position rather than a second, absolute
 * hand-picked coordinate that could quietly stop matching it if the perch
 * ever moves in Blender.
 */
const PET_MARK_OFFSET = new Vector3(0, 0.1, -0.045);

/**
 * The one-time "lay the wheel on its side" reorientation, as a quaternion
 * rather than an Euler-field mutation.
 *
 * The wheel's own geometry (`wheel-fl` etc.) is a disc lying flat in the
 * local X-Z plane, thin axis Y — matching three.js's own default
 * `CylinderGeometry` orientation before any rotation. Rotating 90° about Z
 * tips it up so its thin axis points along X (the axle direction, matching
 * the rail gauge's lateral spacing) and its disc face now shows in the Y-Z
 * plane — confirmed correct, both by the ray-cast/clearance checks in
 * `check:cart-shape` and directly: a marked point at local `(WHEEL_RADIUS, 0,
 * 0)` maps to world `(0, WHEEL_RADIUS, 0)` after this rotation, i.e. the
 * wheel now stands on its edge as it should.
 *
 * **The bug this fixes was never in this initial orientation — it was in how
 * the per-frame spin was composed on top of it.** The previous code set
 * `wheel.rotation.z = Math.PI / 2` once and then mutated `wheel.rotation.y`
 * every frame, on the (reasonable-looking, and apparently also
 * `minigames/dodgems/car.ts`'s own) assumption that this "spins around the
 * now-tilted local Y/axle axis". It does not: three.js's `Euler` field
 * mutation does not recompose that way, and the actual result — verified
 * directly with a bare `Object3D` and a marked rim point, no mesh needed —
 * is a flat spin in the world X-Z (ground) plane, like a coin on a table,
 * regardless of the fixed Z rotation.
 *
 * The fix: keep the lay-down as an explicit quaternion, and compose the
 * per-frame spin as a **second** quaternion multiplied onto it —
 * `WHEEL_LAY_DOWN.multiply(spinAboutOriginalLocalY)` — which is genuinely
 * body-fixed (the spin quaternion is expressed in the wheel's own original,
 * pre-tilt local frame, and quaternion multiplication carries it along with
 * the tilt correctly). Verified with the same marked-rim-point technique:
 * this composition traces the point through the Y-Z plane with X held
 * constant — a real forward roll about the axle.
 */
const WHEEL_LAY_DOWN = new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), Math.PI / 2);

/** The axis `WHEEL_LAY_DOWN`'s own per-frame spin quaternion rotates about — see its doc comment. */
const WHEEL_SPIN_AXIS = new Vector3(0, 1, 0);

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
   *
   * Composes a quaternion (`WHEEL_LAY_DOWN` × a spin about
   * {@link WHEEL_SPIN_AXIS}) rather than mutating `rotation.y` — see
   * `WHEEL_LAY_DOWN`'s doc comment for why the Euler-mutation idiom this
   * replaced spun the wheel on the wrong axis entirely.
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
  const frameMaterial = toonMaterial(PALETTE.ink);
  const lampMaterial = toonMaterial(PALETTE.fairyWarm, {
    emissive: PALETTE.fairyWarm,
    emissiveIntensity: 1,
  });
  const petMarkMaterial = toonMaterial(PALETTE.buildingWall);

  // --- hopper -------------------------------------------------------------
  const hopper = solid(cartAssetMesh('hopper', bodyMaterial));
  addOutline(hopper, 0.02);
  root.add(hopper);

  // --- underframe -----------------------------------------------------------
  // Dark, metal-toned rails connecting the hopper down to the wheels — a
  // deliberately thin, inboard chassis (nowhere near the wheels' own
  // x-position) so it reads as "on a frame" without ever being a second
  // thing that could occlude a wheel the way the hopper itself once did.
  for (const name of ['frame-rail-l', 'frame-rail-r'] as const) {
    root.add(solid(cartAssetMesh(name, frameMaterial)));
  }

  // --- headlamps ----------------------------------------------------------
  // A warm glowing disc either side of the hopper's front slope — at the
  // asset's own authored position, not a hand-picked coordinate — and a real
  // `SpotLight` behind each one, throwing warm light down the rail ahead. See
  // the constants above for why they cast no shadows and why they are dark
  // until somebody boards.
  //
  // Both beams aim at one shared target sitting forward and a little below
  // the hopper, so they converge down the track exactly the way a pair of
  // real headlamps do. A target per lamp would let the two drift apart, and
  // it is the *pair* that has to point where the cart is going.
  const lampAim = new Object3D();
  lampAim.position.set(0, -0.55, 9);
  root.add(lampAim);

  const beams: SpotLight[] = [];
  for (const name of ['lamp-l', 'lamp-r'] as const) {
    root.add(decal(cartAssetMesh(name, lampMaterial)));

    const beam = new SpotLight(
      PALETTE.fairyWarm,
      HEADLAMP_INTENSITY,
      HEADLAMP_RANGE,
      HEADLAMP_ANGLE,
      HEADLAMP_PENUMBRA,
      HEADLAMP_DECAY,
    );
    // Just in front of the lamp mesh's own authored position (not the mesh's
    // own centre), so the disc is not itself the first thing the beam lights.
    beam.position.copy(cartAssetPart(name).position).add(new Vector3(0, 0, 0.09));
    beam.target = lampAim;
    // The expensive half of a dynamic light, and the half a headlamp does not
    // need. See `HEADLAMP_RANGE`'s note.
    beam.castShadow = false;
    beam.visible = false;
    root.add(beam);
    beams.push(beam);
  }

  // --- wheels ---------------------------------------------------------------
  // Gauge matches `RAIL_GAUGE` exactly (see the file header): baked into the
  // asset, checked against it by `scripts/check-cart-shape.mts`. The
  // hopper's floor sits entirely above the wheel's own top point, so there
  // is no pitch or camera angle at which the hopper occludes it.
  const wheels: Mesh[] = [];
  for (const name of ['wheel-fl', 'wheel-fr', 'wheel-bl', 'wheel-br'] as const) {
    const wheel = solid(cartAssetMesh(name, wheelMaterial));
    // The one-time "stand it on its edge" reorientation — see
    // `WHEEL_LAY_DOWN`'s doc comment for why this is a quaternion, not
    // `rotation.z = PI/2`, and why that distinction is exactly the bug fix.
    wheel.quaternion.copy(WHEEL_LAY_DOWN);
    root.add(wheel);
    wheels.push(wheel);
  }
  // Reused every frame in `spinWheels` rather than allocated per call — see
  // `WHEEL_LAY_DOWN`'s doc comment for the composition this builds.
  const spinQuaternion = new Quaternion();

  // --- rider's seat -----------------------------------------------------
  // Centred on the cart's own origin, because that is where `RailRace.ts`
  // actually stands the rider (rivals' `kid.root` and the player's own model
  // both sit at `x = 0` inside/against this cart) — the backrest has to be
  // where she really is, not just somewhere in the hopper.
  const seatBack = solid(cartAssetMesh('seat-back', deepMaterial));
  addOutline(seatBack, 0.016);
  root.add(seatBack);

  root.add(solid(cartAssetMesh('seat-base', deepMaterial)));

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
  const petSeat = solid(cartAssetMesh('pet-seat', petMaterial));
  addOutline(petSeat, 0.014);
  root.add(petSeat);

  root.add(solid(cartAssetMesh('pet-back', petMaterial)));

  // A little paw-print stand-in — a heart, the shape the park already uses
  // for "a pet belongs here" (`art/models/backpacks.ts`'s heart backpack
  // decal) — marking the perch as a pet's spot at a glance, without needing a
  // second bespoke decal shape. Not part of the asset: it reuses an existing
  // shared primitive rather than being a unique modelled surface, so it stays
  // procedural, positioned off the asset's own `pet-seat` placement.
  const petMark = decal(new Mesh(heartGeometry(0.08, 0.02), petMarkMaterial));
  petMark.position.copy(cartAssetPart('pet-seat').position).add(PET_MARK_OFFSET);
  petMark.rotation.x = -0.3;
  root.add(petMark);

  return {
    root,

    spinWheels(travelled: number): void {
      const angle = -travelled / (WHEEL_RADIUS * RIDE_SCALE);
      spinQuaternion.setFromAxisAngle(WHEEL_SPIN_AXIS, angle);
      for (const wheel of wheels) wheel.quaternion.copy(WHEEL_LAY_DOWN).multiply(spinQuaternion);
    },

    setHeadlamps(on: boolean): void {
      for (const beam of beams) beam.visible = on;
    },

    dispose(): void {
      // `disposeTree`, not a hand-rolled mesh walk: every part's geometry now
      // comes from the shared asset cache (`cartAsset.ts`, `markShared`) —
      // four carts, and every future one, all point at the same wheel and
      // lamp buffers, so freeing them here would corrupt the other carts
      // still on the ring. `disposeTree` already knows to skip anything
      // `markShared` marked and to free only this cart's own materials.
      disposeTree(root);
      // Lights are not meshes — `disposeTree`'s walk treats every object as a
      // `Partial<Mesh>` and has no `.geometry`/`.material` to find here, so
      // each `SpotLight` needs its own explicit dispose.
      for (const beam of beams) beam.dispose();
    },
  };
}
